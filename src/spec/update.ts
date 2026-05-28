// Cladding · spec · update — atomic writers for feature shards (0.4.2).
//
// 0.5.0 work/drive transaction model needs a SSoT writer layer:
//   - status transitions (planned → in_progress → done | blocked | archived)
//   - evidence_refs append on acceptance criteria
//   - read-only scope query for the scope-aware iron law
//
// Why line-based for `status:` and full-parse for `evidence_refs`:
// the `status:` field is a top-level scalar so a precise line replace
// preserves comments / key ordering / spacing exactly. evidence_refs
// lives inside an array of objects and a precise edit there would need
// a YAML position-aware editor — too brittle. Round-tripping with
// `yaml`'s Document API keeps comments on most kept nodes (lost on
// reflowed sub-trees), which is the right trade for an append-only
// mutation.

import {existsSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'yaml';

import type {FeatureStatus} from './types.js';

const FEATURES_DIR = ['spec', 'features'];

/** Valid forward transitions. Anything else throws. */
const STATUS_TRANSITIONS: Readonly<Record<FeatureStatus, readonly FeatureStatus[]>> = {
  planned: ['in_progress', 'blocked', 'archived'],
  in_progress: ['done', 'blocked', 'archived'],
  blocked: ['planned', 'in_progress', 'archived'],
  done: ['archived'],
  archived: [],
};

export class FeatureNotFoundError extends Error {
  constructor(featureId: string) {
    super(`cladding: no feature shard for id ${featureId} under spec/features/`);
    this.name = 'FeatureNotFoundError';
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: FeatureStatus, to: FeatureStatus) {
    super(`cladding: invalid status transition ${from} → ${to}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

/**
 * Locates the yaml file for a given feature id by scanning
 * `spec/features/`. Supports both legacy `<id>.yaml` and the v0.3.9+
 * `<slug>-<hash>.yaml` layout. Returns the absolute path or throws
 * {@link FeatureNotFoundError}.
 *
 * Hash-prefix shortcut: if the id is `F-<hash6>`, we try the suffix
 * match first (`*-<hash6>.yaml`) before falling back to a full body
 * scan. Keeps the hot path O(N) on directory listing only.
 */
export function findFeatureFile(cwd: string, featureId: string): string {
  const dir = join(cwd, ...FEATURES_DIR);
  if (!existsSync(dir)) throw new FeatureNotFoundError(featureId);
  const entries = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

  const hashMatch = /^F-([0-9a-f]{6})$/.exec(featureId);
  if (hashMatch) {
    const suffix = `-${hashMatch[1]}.yaml`;
    const hit = entries.find((f) => f.endsWith(suffix));
    if (hit) return join(dir, hit);
  }

  // Legacy `F-NNN.yaml` direct match.
  const direct = `${featureId}.yaml`;
  if (entries.includes(direct)) return join(dir, direct);

  // Fallback: parse each file's `id:` line. Cheap regex on first 5 lines.
  for (const name of entries) {
    const abs = join(dir, name);
    const head = readFileSync(abs, 'utf8').split('\n', 5).join('\n');
    if (new RegExp(`^id:\\s*${featureId}\\s*$`, 'm').test(head)) return abs;
  }

  throw new FeatureNotFoundError(featureId);
}

/** Reads the current status field from a feature yaml without parsing the rest. */
function readStatus(filePath: string): FeatureStatus {
  const body = readFileSync(filePath, 'utf8');
  const match = /^status:\s*([a-z_]+)\s*$/m.exec(body);
  if (!match) throw new Error(`cladding: ${filePath} has no top-level status: field`);
  return match[1] as FeatureStatus;
}

/**
 * Replaces the top-level `status:` line atomically. Preserves all other
 * lines, comments, and ordering. Validates the transition and throws
 * {@link InvalidStatusTransitionError} for disallowed jumps (e.g.
 * `planned → done` must go through `in_progress`).
 *
 * Returns the previous status so callers can log the transition.
 */
export function updateFeatureStatus(
  cwd: string,
  featureId: string,
  newStatus: FeatureStatus,
): FeatureStatus {
  const filePath = findFeatureFile(cwd, featureId);
  const body = readFileSync(filePath, 'utf8');
  const match = /^(status:\s*)([a-z_]+)(\s*)$/m.exec(body);
  if (!match) throw new Error(`cladding: ${filePath} has no top-level status: field`);
  const oldStatus = match[2] as FeatureStatus;

  if (oldStatus === newStatus) return oldStatus; // idempotent no-op

  const allowed = STATUS_TRANSITIONS[oldStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new InvalidStatusTransitionError(oldStatus, newStatus);
  }

  const rewritten = body.replace(match[0], `${match[1]}${newStatus}${match[3]}`);
  atomicWrite(filePath, rewritten);
  return oldStatus;
}

/**
 * Read-only scope query for the scope-aware iron law: returns the
 * feature's slug + modules. Drives `clad check --scope <glob>` and the
 * work-transaction's fitted drift scan.
 */
export function getFeatureScope(
  cwd: string,
  featureId: string,
): {readonly slug: string; readonly modules: readonly string[]} {
  const filePath = findFeatureFile(cwd, featureId);
  const parsed = yaml.parse(readFileSync(filePath, 'utf8')) as {
    slug?: string;
    modules?: readonly string[];
  } | null;
  const slug = parsed?.slug ?? '';
  const modules = Array.isArray(parsed?.modules) ? parsed!.modules! : [];
  return {slug, modules};
}

/**
 * Appends an evidence ref to a specific acceptance criterion. Uses
 * the yaml Document API to preserve comments where possible (the kept
 * nodes retain their leading comments; reflowed scalars may lose
 * trailing line comments — acceptable for an append-only mutation).
 *
 * Idempotent: if the same evidence string is already present on the
 * AC, the call is a no-op and the file is not rewritten.
 *
 * Throws when the feature has no `acceptance_criteria:` array or
 * when no AC matches `acId`.
 */
export function appendEvidence(
  cwd: string,
  featureId: string,
  acId: string,
  evidence: string,
): {readonly appended: boolean} {
  const filePath = findFeatureFile(cwd, featureId);
  const doc = yaml.parseDocument(readFileSync(filePath, 'utf8'));

  const acs = doc.get('acceptance_criteria');
  if (!yaml.isSeq(acs)) {
    throw new Error(`cladding: ${filePath} has no acceptance_criteria: array`);
  }

  let targetAc: yaml.YAMLMap | null = null;
  for (const item of acs.items) {
    if (yaml.isMap(item) && item.get('id') === acId) {
      targetAc = item;
      break;
    }
  }
  if (!targetAc) {
    throw new Error(`cladding: ${filePath} has no acceptance_criterion with id ${acId}`);
  }

  let refs = targetAc.get('evidence_refs');
  if (!yaml.isSeq(refs)) {
    refs = doc.createNode([]);
    targetAc.set('evidence_refs', refs);
  }

  const refsSeq = refs as yaml.YAMLSeq;
  const existing = refsSeq.items.map((n) => (yaml.isScalar(n) ? n.value : n));
  if (existing.includes(evidence)) return {appended: false}; // idempotent

  refsSeq.add(evidence);
  atomicWrite(filePath, String(doc));
  return {appended: true};
}

/**
 * Concurrency safety — write to a sibling temp file then rename. Rename
 * is atomic on POSIX (single inode swap) and best-effort on Windows
 * (Node implements it via `MoveFileEx` with REPLACE_EXISTING). Either
 * way the readers never observe a half-written file.
 */
function atomicWrite(filePath: string, body: string): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, filePath);
}
