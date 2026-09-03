// Cladding · Spec 0.2 F4 · shared durable transaction authority.

import {createHash, randomBytes} from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  readlinkSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';

import yaml from 'yaml';

import {readGitHead} from '../core/checkpoint.js';
import {isReadableId} from './compiler/id-policy.js';
import {resolveManagedWrite} from './compiler/artifact-registry.js';

const LOCK_NAME = 'spec-transaction.lock';
const JOURNAL_NAME = 'spec-transaction.json';
const ABSENT = '<cladding:absent>';
const SNAPSHOT_WAIT_MS = 5_000;
const SNAPSHOT_RETRY_MS = 25;

/** Machine-readable outcomes shared by every F4 transaction consumer. */
export type SpecEditCode =
  | 'STALE_INPUT'
  | 'BUSY'
  | 'INVALID_OPERATION'
  | 'UNKNOWN_REFERENCE'
  | 'LIFECYCLE'
  | 'MIGRATION_UNRESOLVED'
  | 'DIRTY_PLANNED_PATH'
  | 'RECOVERY_FAILED';

/** Error carrying one stable F4 transaction result code. */
export class SpecEditError extends Error {
  /** @param code - Stable internal reason. @param message - Caller-safe diagnostic. */
  constructor(readonly code: SpecEditCode, message: string) {
    super(message);
    this.name = 'SpecEditError';
  }
}

/** Exact registry-owned top-level regions a root replacement can claim. */
export type RootWriteRegion = 'schema' | 'project' | 'inventory';

/** One complete replacement travelling through the sole durable authority. */
export interface TransactionFile {
  /** Managed repository-relative artifact path. */
  readonly path: string;
  /** Exact source bytes observed while the transaction lock is held. */
  readonly before: string | null;
  /** Complete replacement bytes, or null to delete the artifact. */
  readonly after: string | null;
  /** Exact root ownership when and only when `path` is spec.yaml. */
  readonly rootRegions?: readonly RootWriteRegion[];
}

interface TransactionJournal {
  readonly format: 1;
  readonly id: string;
  readonly phase: 'prepared';
  readonly paths: readonly string[];
  readonly preflight: {readonly head: string | null; readonly paths: readonly string[]};
  readonly files: readonly {readonly path: string; readonly before: string | null; readonly after: string | null; readonly rootRegions?: readonly RootWriteRegion[]}[];
  readonly createdDirs: readonly string[];
}

/** A validated, narrow recovery receipt safe for human migration guidance. */
export interface SpecTransactionRecoveryReceipt {
  /** Git commit observed before the transaction, when the workspace was a repository. */
  readonly head: string | null;
  /** Exact managed artifact paths owned by the pending transaction. */
  readonly paths: readonly string[];
}

interface WorkspaceLock {
  readonly fd: number;
  readonly path: string;
  readonly nonce: string;
  readonly createdDirectory: boolean;
  readonly directoryInode: number;
}

/** Holds the one five-second F4 lock and recovers a journal before a snapshot. */
export function withSpecWorkspaceLock<T>(cwd: string, work: () => T): T {
  const root = resolve(cwd);
  const transactionDirectory = join(root, '.cladding');
  if (existsSync(transactionDirectory) && lstatSync(transactionDirectory).isFile()) return work();
  const lock = acquireLock(root);
  if (lock === null) throw new SpecEditError('BUSY', 'A specification transaction is still committing; try again shortly.');
  let recovered = false;
  try {
    recovered = recoverSpecTransactionUnderLock(root);
    return work();
  } finally {
    releaseLock(lock);
    if (recovered) removeEmptyTransactionStateDirectory(transactionDirectory);
  }
}

/**
 * Reads one coherent managed-spec snapshot without taking the exclusive writer
 * lock. A reader retries if the cooperative F4 epoch moves around its work.
 *
 * An ownerless journal is recovered through the normal exclusive authority
 * before a snapshot begins. Active writers retain their five-second bounded
 * wait; readers never publish a result or parser error from a moving epoch.
 *
 * @param cwd - Workspace root.
 * @param work - Pure parser/compiler work over managed specification bytes.
 * @returns The value created from one stable managed-spec snapshot.
 * @throws Error when stable parser work or a safe snapshot probe fails; BUSY
 *     when the workspace cannot settle in time.
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 */
export function withStableSpecWorkspaceSnapshot<T>(cwd: string, work: () => T): T {
  const root = resolve(cwd);
  const until = Date.now() + SNAPSHOT_WAIT_MS;
  while (Date.now() < until) {
    const state = stableSnapshotState(root);
    if (state === undefined) {
      waitForSnapshotRetry();
      continue;
    }
    if (state.pending) {
      // Recovery remains a writer operation. Only an ownerless journal reaches
      // this path, so pure readers never contend with an active commit lock.
      if (!state.locked) {
        try {
          recoverSpecTransaction(root);
        } catch (error) {
          if (!isTransientSnapshotRace(error)) throw error;
        }
      }
      waitForSnapshotRetry();
      continue;
    }
    if (state.locked) {
      waitForSnapshotRetry();
      continue;
    }
    const before = stableSnapshotEpochOrRetry(root);
    if (before === undefined) {
      waitForSnapshotRetry();
      continue;
    }
    let completed = false;
    let result: T | undefined;
    let failure: unknown;
    try {
      result = work();
      completed = true;
    } catch (error) {
      failure = error;
    }
    const after = stableSnapshotEpochOrRetry(root);
    const afterState = stableSnapshotState(root);
    // Parser errors are publishable only when the bytes and transaction epoch
    // observed on both sides agree. A replacement race retries instead.
    if (after !== undefined && afterState !== undefined
      && !afterState.pending && !afterState.locked && before === after) {
      if (!completed) throw failure;
      return result as T;
    }
    waitForSnapshotRetry();
  }
  throw new SpecEditError('BUSY', 'A specification transaction is still settling; try again shortly.');
}

/**
 * Hashes every managed specification byte in deterministic path order.
 *
 * This is the optimistic whole-workspace revision and the byte half of the
 * stable-reader seqlock. Callers that mutate still validate under the writer
 * lock before using it as an optimistic input precondition.
 *
 * @param cwd - Workspace root.
 * @returns SHA-256 over sorted compiler/loader inputs and regular evidence
 *     bytes, with evidence symlink path/type/spelling represented opaquely.
 * @throws Error when a canonical compiler/loader input is symbolic or managed
 *     bytes and link spelling cannot be read safely.
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 */
export function managedSpecWorkspaceDigest(cwd: string): string {
  const root = resolve(cwd);
  const digest = createHash('sha256');
  for (const entry of managedSpecWorkspaceEntries(root)) {
    digest.update(entry.path);
    digest.update('\0');
    if (entry.kind === 'file') {
      digest.update(readFileSync(join(root, entry.path)));
    } else {
      // Evidence is an observed proof channel, not compiler input. Its link
      // identity invalidates a snapshot without following external bytes.
      digest.update('<cladding:evidence-symlink>');
      digest.update('\0');
      digest.update(entry.target);
    }
    digest.update('\0');
  }
  return digest.digest('hex');
}

/** Recovers a pending F4 journal through the same bounded workspace lock. */
export function recoverSpecTransaction(cwd: string = '.'): boolean {
  const root = resolve(cwd);
  const lock = acquireLock(root);
  if (lock === null) throw new SpecEditError('BUSY', 'A specification transaction is still committing; try again shortly.');
  let recovered = false;
  try {
    recovered = recoverSpecTransactionUnderLock(root);
    return recovered;
  } finally {
    releaseLock(lock);
    if (recovered) removeEmptyTransactionStateDirectory(join(root, '.cladding'));
  }
}

/** Commits complete replacements while the caller holds `withSpecWorkspaceLock`. */
export function commitSpecTransactionFiles(
  cwd: string,
  files: readonly TransactionFile[],
  faultAfter?: number,
  errorAfter?: number,
  beforeReplacement?: (path: string) => void,
): void {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  for (const file of ordered) validateWriteTarget(file);
  const transactionId = randomBytes(16).toString('hex');
  const journal: TransactionJournal = {
    format: 1, id: transactionId, phase: 'prepared', paths: ordered.map((file) => file.path),
    preflight: {head: readGitHead(cwd), paths: ordered.map((file) => file.path)},
    files: ordered.map((file) => ({
      path: file.path,
      before: file.before === null ? null : Buffer.from(file.before).toString('base64'),
      after: file.after === null ? null : Buffer.from(file.after).toString('base64'),
      ...(file.rootRegions === undefined ? {} : {rootRegions: file.rootRegions}),
    })),
    createdDirs: transactionCreatedDirectories(cwd, ordered),
  };
  publishJournal(cwd, journal);
  let replacements = 0;
  try {
    for (const file of ordered) {
      beforeReplacement?.(file.path);
      replaceOne(cwd, file, false, transactionId);
      replacements++;
      if (faultAfter !== undefined && replacements >= faultAfter) throw new Error('InjectedTransactionFault');
      if (errorAfter !== undefined && replacements >= errorAfter) throw new Error('InjectedTransactionIoError');
    }
  } catch (error) {
    if ((error as Error).message === 'InjectedTransactionFault') throw error;
    recoverSpecTransactionUnderLock(cwd);
    throw error;
  }
  cleanupTransactionDirectories(cwd, journal.createdDirs);
  unlinkSync(journalPath(cwd));
  fsyncDirectory(dirname(journalPath(cwd)));
}

/** Reads managed bytes without following an observed symbolic link. */
export function readSpecTransactionBytes(cwd: string, path: string): string | null {
  assertSafePath(cwd, path);
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) return null;
  if (lstatSync(absolute).isSymbolicLink()) throw invalid(`Managed path may not be a symbolic link: ${path}.`);
  return readFileSync(absolute, 'utf8');
}

/** Requires the exact root schema selector before any managed mutation. */
export function requiredRootSchema(cwd: string): '0.1' | '0.2' {
  const bytes = readSpecTransactionBytes(cwd, 'spec.yaml');
  if (bytes === null) throw invalid('An initialized specification needs spec.yaml with schema "0.1" or "0.2" before it can be mutated.');
  let schema: unknown;
  try { schema = objectValue(yaml.parse(bytes)).schema; } catch { throw invalid('spec.yaml must be valid YAML with an exact supported schema.'); }
  if (schema !== '0.1' && schema !== '0.2') throw invalid('spec.yaml must declare an exact supported schema ("0.1" or "0.2").');
  return schema;
}

/** Returns whether a durable journal currently exists after validating its path ancestry. */
export function hasPendingSpecTransaction(cwd: string): boolean {
  const root = resolve(cwd);
  assertSafePath(root, `.cladding/${JOURNAL_NAME}`);
  return existsSync(journalPath(root));
}

/** Returns whether the F4 lock pathname is currently occupied after a safe probe. */
export function hasSpecWorkspaceLock(cwd: string): boolean {
  const root = resolve(cwd);
  assertSafePath(root, `.cladding/${LOCK_NAME}`);
  return existsSync(join(root, '.cladding', LOCK_NAME));
}

/** Hashes the bytes plus the two F4 epoch markers observed by stable readers. */
function stableSnapshotEpoch(cwd: string): string {
  return digestText(
    `${managedSpecWorkspaceDigest(cwd)}\0${transactionMarker(cwd, JOURNAL_NAME)}\0${transactionMarker(cwd, LOCK_NAME)}`,
  );
}

/** Returns undefined only for a transient writer replacement race. */
function stableSnapshotEpochOrRetry(cwd: string): string | undefined {
  try {
    return stableSnapshotEpoch(cwd);
  } catch (error) {
    if (isTransientSnapshotRace(error)) return undefined;
    throw error;
  }
}

/** Reads the cooperative transaction state, retrying only a disappearing path race. */
function stableSnapshotState(cwd: string): {readonly pending: boolean; readonly locked: boolean} | undefined {
  try {
    return {pending: hasPendingSpecTransaction(cwd), locked: hasSpecWorkspaceLock(cwd)};
  } catch (error) {
    if (isTransientSnapshotRace(error)) return undefined;
    throw error;
  }
}

/** Node can expose these two codes while a cooperative writer replaces a path. */
function isTransientSnapshotRace(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Reads a transaction marker without following a symbolic link. */
function transactionMarker(cwd: string, name: string): string {
  const path = join(cwd, '.cladding', name);
  try {
    if (!existsSync(path)) return ABSENT;
    if (lstatSync(path).isSymbolicLink()) return '<cladding:symlink>';
    return digestText(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ABSENT;
    return `<cladding:unreadable:${(error as Error).name}>`;
  }
}

/** One fingerprint input: regular bytes or a non-followed evidence link spelling. */
type ManagedSpecWorkspaceEntry =
  | {readonly path: string; readonly kind: 'file'}
  | {readonly path: string; readonly kind: 'evidence-symlink'; readonly target: string};

/** Enumerates compiler/loader files and opaque evidence-link epoch inputs. */
function managedSpecWorkspaceEntries(cwd: string): readonly ManagedSpecWorkspaceEntry[] {
  const entries: ManagedSpecWorkspaceEntry[] = [];
  const visit = (path: string): void => {
    const absolute = join(cwd, path);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (isEvidenceWorkspacePath(path)) {
        entries.push({path, kind: 'evidence-symlink', target: readlinkSync(absolute, 'utf8')});
        return;
      }
      throw new SpecEditError('INVALID_OPERATION', `Managed workspace path may not be a symbolic link: ${path}`);
    }
    if (stat.isDirectory()) {
      for (const child of readdirSync(absolute).sort()) visit(`${path}/${child}`);
      return;
    }
    if (stat.isFile() && (path === 'spec.yaml' || path.startsWith('spec/'))) entries.push({path, kind: 'file'});
  };
  visit('spec.yaml');
  visit('spec');
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/** Evidence links remain opaque so proof safety owns their rejection. */
function isEvidenceWorkspacePath(path: string): boolean {
  return path === 'spec/evidence' || path.startsWith('spec/evidence/');
}

/** Keeps the bounded polling policy consistent with the exclusive lock. */
function waitForSnapshotRetry(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SNAPSHOT_RETRY_MS);
}

function digestText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Reads only a fully validated pending receipt without acquiring a lock. */
export function readSpecTransactionRecoveryReceipt(cwd: string = '.'): SpecTransactionRecoveryReceipt | null {
  const root = resolve(cwd);
  assertSafePath(root, `.cladding/${JOURNAL_NAME}`);
  const path = journalPath(root);
  if (!existsSync(path)) return null;
  let journal: TransactionJournal;
  try { journal = JSON.parse(readFileSync(path, 'utf8')) as TransactionJournal; } catch {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal is unreadable.');
  }
  if (journal.format !== 1 || journal.phase !== 'prepared' || !Array.isArray(journal.files)) {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has an unsupported format.');
  }
  validateJournal(root, journal);
  return {head: journal.preflight.head, paths: [...journal.preflight.paths]};
}

/** Exercises stale-owner retirement without exposing a second writer. */
export function reclaimSpecTransactionLockForTesting(cwd: string, beforeRetire?: () => void): void {
  reclaimDeadLock(join(resolve(cwd), '.cladding', LOCK_NAME), beforeRetire);
}

function recoverSpecTransactionUnderLock(cwd: string): boolean {
  const root = resolve(cwd);
  assertSafePath(root, `.cladding/${JOURNAL_NAME}`);
  const path = journalPath(root);
  if (!existsSync(path)) { cleanupUnpublishedJournalTemps(root); return false; }
  let journal: TransactionJournal;
  try { journal = JSON.parse(readFileSync(path, 'utf8')) as TransactionJournal; } catch {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal is unreadable.');
  }
  if (journal.format !== 1 || journal.phase !== 'prepared' || !Array.isArray(journal.files)) {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has an unsupported format.');
  }
  try {
    validateJournal(root, journal);
    for (const file of journal.files) {
      const current = readSpecTransactionBytes(root, file.path);
      const before = file.before === null ? null : Buffer.from(file.before, 'base64').toString('utf8');
      const after = file.after === null ? null : Buffer.from(file.after, 'base64').toString('utf8');
      if (current !== before && current !== after) throw new SpecEditError('RECOVERY_FAILED', `The pending transaction target ${file.path} changed outside the transaction.`);
    }
    for (const file of journal.files) {
      removeTransactionTemp(root, file.path, journal.id);
      const current = readSpecTransactionBytes(root, file.path);
      replaceOne(root, {path: file.path, before: current === null ? null : Buffer.from(current).toString('base64'), after: file.before}, true, journal.id);
    }
    cleanupTransactionDirectories(root, journal.createdDirs);
    unlinkSync(path);
    fsyncDirectory(dirname(path));
    return true;
  } catch (error) {
    throw new SpecEditError('RECOVERY_FAILED', `Unable to restore the pending specification transaction: ${(error as Error).message}`);
  }
}

function replaceOne(cwd: string, file: TransactionFile, encoded: boolean, transactionId?: string): void {
  assertSafePath(cwd, file.path);
  const absolute = join(cwd, file.path);
  const expectedBefore = encoded && file.before !== null ? Buffer.from(file.before, 'base64').toString('utf8') : file.before;
  if (readSpecTransactionBytes(cwd, file.path) !== expectedBefore) {
    throw new SpecEditError('RECOVERY_FAILED', `Transaction preimage changed before replacement: ${file.path}.`);
  }
  if (file.after === null) {
    if (existsSync(absolute)) { unlinkSync(absolute); fsyncDirectory(dirname(absolute)); }
    return;
  }
  const contents = encoded ? Buffer.from(file.after, 'base64').toString('utf8') : file.after;
  mkdirSync(dirname(absolute), {recursive: true});
  const temp = join(dirname(absolute), `.${basename(absolute)}.cladding-txn-${transactionId ?? randomBytes(16).toString('hex')}.tmp`);
  writeDurable(temp, contents);
  assertSafePath(cwd, file.path);
  if (readSpecTransactionBytes(cwd, file.path) !== expectedBefore) {
    try { unlinkSync(temp); fsyncDirectory(dirname(temp)); } catch { /* Recovery retains its journal. */ }
    throw new SpecEditError('RECOVERY_FAILED', `Transaction preimage changed before replacement: ${file.path}.`);
  }
  renameSync(temp, absolute);
  fsyncDirectory(dirname(absolute));
}

function publishJournal(cwd: string, journal: TransactionJournal): void {
  const path = journalPath(cwd);
  assertSafePath(cwd, `.cladding/${JOURNAL_NAME}`);
  const temp = join(dirname(path), `.${JOURNAL_NAME}.cladding-txn-${journal.id}.tmp`);
  writeDurable(temp, `${JSON.stringify(journal)}\n`);
  renameSync(temp, path);
  fsyncDirectory(dirname(path));
}

function cleanupUnpublishedJournalTemps(cwd: string): void {
  const directory = join(cwd, '.cladding');
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    if (!/^\.spec-transaction\.json\.cladding-txn-[a-f0-9]{32}\.tmp$/.test(name)) continue;
    const path = `.cladding/${name}`;
    assertSafePath(cwd, path);
    unlinkSync(join(cwd, path));
  }
  fsyncDirectory(directory);
}

function removeTransactionTemp(cwd: string, path: string, transactionId: string): void {
  const absolute = join(cwd, path);
  const temp = join(dirname(absolute), `.${basename(absolute)}.cladding-txn-${transactionId}.tmp`);
  if (existsSync(temp)) { unlinkSync(temp); fsyncDirectory(dirname(temp)); }
}

function transactionCreatedDirectories(cwd: string, files: readonly TransactionFile[]): readonly string[] {
  const directories = new Set<string>();
  for (const file of files) {
    if (file.after === null) continue;
    let cursor = dirname(file.path);
    while (cursor !== '.' && cursor !== '') {
      assertSafePath(cwd, `${cursor}/.cladding-directory-probe`);
      if (existsSync(join(cwd, cursor))) break;
      if (!isManagedTransactionDirectory(cursor)) throw invalid(`Transaction would create an unmanaged directory ${cursor}.`);
      directories.add(cursor);
      cursor = dirname(cursor);
    }
  }
  return [...directories].sort();
}

function cleanupTransactionDirectories(cwd: string, directories: readonly string[]): void {
  for (const directory of [...directories].sort((left, right) => right.length - left.length || right.localeCompare(left))) {
    const absolute = join(cwd, directory);
    try {
      assertSafePath(cwd, `${directory}/.cladding-directory-probe`);
      if (existsSync(absolute) && lstatSync(absolute).isDirectory()) {
        rmdirSync(absolute);
        fsyncDirectory(dirname(absolute));
      }
    } catch { /* A populated or externally retained parent remains safe. */ }
  }
}

function validateJournal(cwd: string, journal: TransactionJournal): void {
  if (!/^[a-f0-9]{32}$/.test(journal.id)) throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has an invalid identity.');
  if (!Array.isArray(journal.paths) || !journal.preflight || !Array.isArray(journal.preflight.paths) || !Array.isArray(journal.files) || !Array.isArray(journal.createdDirs)
    || journal.paths.length === 0 || journal.preflight.paths.length === 0 || journal.files.length === 0
    || !sortedUnique(journal.paths) || !sortedUnique(journal.preflight.paths)) {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has an invalid path manifest.');
  }
  const paths = journal.files.map((file) => file?.path);
  if (!sortedUnique(paths) || canonicalJson(paths) !== canonicalJson(journal.paths) || canonicalJson(paths) !== canonicalJson(journal.preflight.paths)) {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal path sets disagree.');
  }
  if (journal.preflight.head !== null && (typeof journal.preflight.head !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(journal.preflight.head))) {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has an invalid preflight.');
  }
  if (!sortedUnique(journal.createdDirs) || journal.createdDirs.some((directory) => !isManagedTransactionDirectory(directory))) {
    throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has an invalid created-directory manifest.');
  }
  for (const file of journal.files) {
    if (!file || typeof file.path !== 'string' || !isManagedTransactionPath(file.path)) {
      throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal names an unmanaged path.');
    }
    assertSafePath(cwd, file.path);
    if (!validBase64(file.before) || !validBase64(file.after)) throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has invalid before-images.');
    if (file.path === 'spec.yaml') {
      if (!Array.isArray(file.rootRegions) || file.rootRegions.length === 0 || new Set(file.rootRegions).size !== file.rootRegions.length
        || file.rootRegions.some((region: unknown) => region !== 'schema' && region !== 'project' && region !== 'inventory')) {
        throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal has invalid root ownership metadata.');
      }
      for (const region of file.rootRegions) resolveManagedWrite({path: file.path, region, operation: file.after === null ? 'delete' : file.before === null ? 'create' : 'update'});
    } else if (file.rootRegions !== undefined) {
      throw new SpecEditError('RECOVERY_FAILED', 'The pending specification transaction journal assigns root ownership to a non-root artifact.');
    }
  }
}

function validateWriteTarget(file: TransactionFile): void {
  const operation = file.after === null ? 'delete' : file.before === null ? 'create' : 'update';
  if (file.path === '.cladding/events.log.jsonl' || file.path === '.cladding/audit.log.jsonl') {
    resolveManagedWrite({path: file.path, operation});
    return;
  }
  if (file.path.startsWith('.cladding/')) throw invalid(`Transaction may not write unmanaged workspace state ${file.path}.`);
  if (file.path === 'spec.yaml') {
    if (!file.rootRegions || file.rootRegions.length === 0 || new Set(file.rootRegions).size !== file.rootRegions.length) {
      throw invalid('A spec.yaml transaction write must declare one or more exact owned regions.');
    }
    for (const region of file.rootRegions) resolveManagedWrite({path: file.path, region, operation});
    assertRootSemanticOwnership(file.before, file.after, file.rootRegions);
    return;
  }
  resolveManagedWrite({path: file.path, operation});
}

function assertRootSemanticOwnership(before: string | null, after: string | null, regions: readonly RootWriteRegion[]): void {
  const prior = before === null ? {} : objectValue(yaml.parse(before));
  const next = after === null ? {} : objectValue(yaml.parse(after));
  const keys = new Set([...Object.keys(prior), ...Object.keys(next)]);
  const ownership: Readonly<Record<string, RootWriteRegion>> = {
    schema: 'schema', project: 'project', inventory: 'inventory',
    features: 'schema', scenarios: 'schema', capabilities: 'schema', architecture: 'schema',
  };
  for (const key of keys) {
    if (canonicalJson(prior[key]) === canonicalJson(next[key])) continue;
    const owner = ownership[key];
    if (!owner || !regions.includes(owner)) throw invalid(`spec.yaml semantic change to ${key} is outside its declared transaction ownership.`);
  }
}

function acquireLock(cwd: string): WorkspaceLock | null {
  assertSafePath(cwd, `.cladding/${LOCK_NAME}`);
  const path = join(cwd, '.cladding', LOCK_NAME);
  const directory = dirname(path);
  const createdDirectory = !existsSync(directory);
  mkdirSync(directory, {recursive: true});
  const directoryInode = lstatSync(directory).ino;
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const nonce = randomBytes(12).toString('hex');
    const temporary = join(directory, `.${LOCK_NAME}.owner-${nonce}.tmp`);
    let published = false;
    try {
      writeDurable(temporary, `${JSON.stringify({pid: process.pid, nonce})}\n`);
      linkSync(temporary, path);
      published = true;
      unlinkSync(temporary);
      fsyncDirectory(directory);
      return {fd: openSync(path, 'r'), path, nonce, createdDirectory, directoryInode};
    } catch (error) {
      try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* No owner was published. */ }
      if (published) {
        try {
          const owner = JSON.parse(readFileSync(path, 'utf8')) as {nonce?: unknown};
          if (owner.nonce === nonce) {
            unlinkSync(path);
            fsyncDirectory(directory);
            removeOwnedEmptyLockDirectory(directory, createdDirectory, directoryInode);
          }
        } catch { /* An unverified successor remains safe. */ }
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      reclaimDeadLock(path);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return null;
}

function releaseLock(lock: WorkspaceLock): void {
  try { closeSync(lock.fd); } finally {
    try {
      const owner = JSON.parse(readFileSync(lock.path, 'utf8')) as {nonce?: unknown};
      if (owner.nonce === lock.nonce) { unlinkSync(lock.path); fsyncDirectory(dirname(lock.path)); }
    } catch { /* A successor or cleanup already owns the pathname. */ }
    removeOwnedEmptyLockDirectory(dirname(lock.path), lock.createdDirectory, lock.directoryInode);
  }
}

function removeOwnedEmptyLockDirectory(directory: string, created: boolean, inode: number): void {
  if (!created) return;
  try {
    if (lstatSync(directory).ino !== inode) return;
    rmdirSync(directory);
    fsyncDirectory(dirname(directory));
  } catch { /* A journal, event, or successor retained the directory. */ }
}

function reclaimDeadLock(path: string, beforeRetire?: () => void): void {
  let observed = '';
  let observedInode: number | undefined;
  try { observed = readFileSync(path, 'utf8'); observedInode = lstatSync(path).ino; } catch { return; }
  const nonce = randomBytes(12).toString('hex');
  const reclaimPath = `${path}.reclaim`;
  try { writeDurable(reclaimPath, `${JSON.stringify({pid: process.pid, nonce})}\n`); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') retireExpiredReclaimerGuard(reclaimPath);
    return;
  }
  const releaseReclaimer = (): void => {
    try {
      const owner = JSON.parse(readFileSync(reclaimPath, 'utf8')) as {nonce?: unknown};
      if (owner.nonce === nonce) { unlinkSync(reclaimPath); fsyncDirectory(dirname(reclaimPath)); }
    } catch { /* A later reclaimer owns this guard. */ }
  };
  const retireObserved = (): void => {
    try {
      beforeRetire?.();
      if (lstatSync(path).ino !== observedInode || readFileSync(path, 'utf8') !== observed) return;
      const tombstone = `${path}.retired-${nonce}`;
      renameSync(path, tombstone);
      fsyncDirectory(dirname(path));
      unlinkSync(tombstone);
      fsyncDirectory(dirname(path));
    } catch { /* A successor owns the pathname. */ }
  };
  try {
    let pid: unknown;
    try { pid = (JSON.parse(observed) as {pid?: unknown}).pid; } catch {
      try { if (Date.now() - lstatSync(path).mtimeMs > 30_000) retireObserved(); } catch { /* Leave fresh malformed ownership alone. */ }
      return;
    }
    if (!Number.isInteger(pid) || (pid as number) <= 0) {
      try { if (Date.now() - lstatSync(path).mtimeMs > 30_000) retireObserved(); } catch { /* Leave fresh malformed ownership alone. */ }
      return;
    }
    try { process.kill(pid as number, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') retireObserved();
    }
  } finally { releaseReclaimer(); }
}

function retireExpiredReclaimerGuard(path: string): void {
  let observed: string;
  let inode: number;
  let age: number;
  try {
    observed = readFileSync(path, 'utf8');
    const state = lstatSync(path);
    inode = state.ino;
    age = Date.now() - state.mtimeMs;
  } catch { return; }
  if (age <= 30_000) return;
  const tombstone = `${path}.retired-${randomBytes(12).toString('hex')}`;
  try {
    if (lstatSync(path).ino !== inode || readFileSync(path, 'utf8') !== observed) return;
    renameSync(path, tombstone);
    fsyncDirectory(dirname(path));
    unlinkSync(tombstone);
    fsyncDirectory(dirname(path));
  } catch { /* A successor owns the guard. */ }
}

function removeEmptyTransactionStateDirectory(directory: string): void {
  try {
    if (lstatSync(directory).isDirectory()) {
      rmdirSync(directory);
      fsyncDirectory(dirname(directory));
    }
  } catch { /* Observer or lock state retained the directory. */ }
}

function journalPath(cwd: string): string { return join(cwd, '.cladding', JOURNAL_NAME); }

function assertSafePath(cwd: string, path: string): void {
  if (!path || isAbsolute(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe transaction path ${path}.`);
  const root = resolve(cwd);
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith('..')) throw new Error(`Transaction path escapes workspace: ${path}.`);
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Transaction path has a symbolic-link ancestor: ${path}.`);
  }
  let parent = dirname(absolute);
  while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
  const realRoot = realpathSync(root);
  const realParent = realpathSync(parent);
  if (realParent !== realRoot && relative(realRoot, realParent).startsWith('..')) throw new Error(`Transaction path escapes workspace through its parent: ${path}.`);
}

function writeDurable(path: string, contents: string): void {
  mkdirSync(dirname(path), {recursive: true});
  const fd = openSync(path, 'wx');
  try { writeFileSync(fd, contents, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
}

function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* Atomic rename remains the portable fallback. */ }
}

function isManagedTransactionPath(path: string): boolean {
  return path === 'spec.yaml'
    || path === 'spec/capabilities.yaml'
    || path === 'spec/architecture.yaml'
    || path === 'spec/index.yaml'
    || path === 'spec/_doc-links.yaml'
    || path === 'spec/attestation.yaml'
    || path === 'spec/trust/issuers.yaml'
    || path === 'docs/project-context.md'
    || path === 'spec/generated/migration-baseline-0.1-to-0.2.yaml'
    || path === '.cladding/events.log.jsonl'
    || path === '.cladding/audit.log.jsonl'
    || /^spec\/(?:features|scenarios)\/[^/]+\.ya?ml$/.test(path)
    || isManagedEvidencePath(path);
}

function isManagedTransactionDirectory(path: string): boolean {
  return path === '.cladding' || path === 'docs' || path === 'spec' || path === 'spec/features' || path === 'spec/scenarios'
    || path === 'spec/evidence' || path === 'spec/generated' || path === 'spec/trust' || /^spec\/evidence\/F-[^/]+$/.test(path);
}

function isManagedEvidencePath(path: string): boolean {
  const match = /^spec\/evidence\/(F-[^/]+)\/([a-f0-9]{64})\.yaml$/.exec(path);
  return match !== null && isReadableId('feature', match[1]);
}

function sortedUnique(values: readonly unknown[]): values is readonly string[] {
  return values.every((value): value is string => typeof value === 'string')
    && values.every((value, index) => index === 0 || (values[index - 1] as string) < value);
}

function validBase64(value: unknown): boolean {
  return value === null || (typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value);
}

function canonicalJson(value: unknown): string { return JSON.stringify(sortJson(value)); }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  return value;
}
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function invalid(message: string): SpecEditError { return new SpecEditError('INVALID_OPERATION', message); }
