// Cladding · events.log — append-only lifecycle event stream
//
// Distinct from .cladding/audit.log.jsonl (HITL evidence): events.log
// captures *state transitions* — when a stage starts/stops, when a
// feature activates, when a drift fires. Audit is "proof of work";
// events is "what happened, when". They live in the same directory
// but each has its own append-only file.

import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {appendFileSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, realpathSync} from 'node:fs';
import {userInfo} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';

import type {Identity} from '../hitl/identity.js';

const EVENTS_DIR = '.cladding';
const EVENTS_FILE = 'events.log.jsonl';
const EVENTS_ROLL = 'events.log.1.jsonl';
const SPEC_TRANSACTION_LOCK = 'spec-transaction.lock';
const SPEC_TRANSACTION_JOURNAL = 'spec-transaction.json';
/** Roll the live log past this size (F-b84c38 AC — bounded reads). */
const ROTATE_BYTES = 5 * 1024 * 1024;

/** Types of lifecycle events the harness records. */
export type EventType =
  | 'stage_started'
  | 'stage_completed'
  | 'feature_activated'
  | 'feature_completed'
  | 'evidence_recorded'
  | 'drift_detected'
  | 'feature_checkpoint'
  | 'feature_rolled_back'
  // v0.3.39 — sentinel-miss telemetry. Emitted when the LLM dispatcher
  // returns a reply that misses one of the labelled sentinels
  // (=== CONVENTIONS_MD === / === ARCHITECTURE_YAML === / === SCENARIO_FLOWS ===
  // / === CAPABILITIES_YAML === / === WHY === / === WHAT === / === PURPOSE ===)
  // and the scan or project-context refinement falls back to the deterministic
  // body. Standard payload:
  //   phase:           'scan_artifacts' | 'project_context'
  //   cause:           'blank_section'  | 'dispatcher_error'
  //   fallback:        'total'          | 'per_artifact'
  //   missed_sections: readonly string[]  // present iff cause === 'blank_section'
  //   error:           string              // present iff cause === 'dispatcher_error' (truncated)
  // Configured-no-LLM paths (dispatcher === null or ctx === null) do NOT emit;
  // they are deliberate offline/greenfield runs, not a miss.
  | 'sentinel_miss'
  // v0.6.0 (F-b84c38) — the supported per-feature cadence finally leaves a
  // trace. Each payload carries `identity` (git author or OS user) and `head`
  // (git HEAD sha) added by recordEvent; 23 hand-flipped dones proved the
  // ledger must say WHO, and the attestation/engagement work needs WHEN.
  | 'feature_created' // payload: feature, slug
  | 'design_impact_resolved' // payload: feature
  | 'scenario_created' // payload: scenario, slug
  | 'done_attempted' // payload: feature, worst, anyFailed, kept, blockers[]
  | 'gate_run' // payload: tier, strict, worst, anyFailed, blockers[], stopFingerprint
  // v0.6.0 (F-1d23a6) — the Stop host hook blocked a session end on a FRESH
  // deterministic-trio failure (drift strict / arch / secret). Fingerprint-
  // keyed: an identical failure set demotes to allow without an event, so
  // this fires only on new breakage — the demotion itself persists as
  // .cladding/stop-block.json and resurfaces on the SessionStart card.
  | 'stop_blocked' // payload: count, fingerprint, detectors[], introduced, preexisting, dirty_hit
  // v0.9.4 (F-1aab1bba) — an identical Stop fingerprint took the existing
  // demotion path, allowing the known-failing session to exit. The payload
  // mirrors stop_blocked attribution so later analysis has both denominator
  // arms; observer-only, never consulted by the hook decision.
  | 'stop_exit_recorded'
  // v0.8.0 (F-6ba22c5c) — value-delivery telemetry. cladding's value surfaces
  // (PostToolUse impact card, SessionStart card, UserPromptSubmit suggestion, MCP
  // read serves) left ZERO trace, so the 0.7.1 "impact card fired 0%" bug was
  // invisible to the harness's own ledger. Each surface now records whether it
  // produced output. Payloads:
  //   impact_card_fired:        file, feature, impacted (n), tests (n), unledgered (bool),
  //                             tier (1|2 — Tier-2 is the rich impact card, F-35954d19),
  //                             lane ('bash' when the mutation was attributed via the Bash
  //                             git-delta lane, F-e7d59c88; ABSENT on native write-tool
  //                             edits — additive field per the F-6ba22c5c precedent)
  //   impact_card_skipped:      reason ∈ ImpactSkipReason (closed enum, one per degrade
  //                             branch of runPostToolUseDrift). The two high-frequency
  //                             reasons (not_write_tool, unwatched_path) are AGGREGATED
  //                             across a DRIFT_DEBOUNCE_MS window into ONE flushed event
  //                             carrying {aggregate:true, counts:{not_write_tool, unwatched_path}}
  //                             so per-call skips cannot rotate gate_run history out of the
  //                             5MB log; the rest emit per occurrence.
  //   session_card_rendered:    bytes
  //   prompt_suggestion_served: kind ('completion' | intent verb)
  //   working_set_served:       tool, query, resolved (bool), truncated?, sliceTokens?
  | 'impact_card_fired'
  | 'impact_card_skipped'
  | 'session_card_rendered'
  | 'prompt_suggestion_served'
  | 'working_set_served';

/**
 * The closed set of reasons the PostToolUse impact card can be skipped —
 * ONE per degrade branch of `runPostToolUseDrift` (F-6ba22c5c AC-238a3658).
 * The enum makes silent (surface fired nothing) distinguishable from broken
 * (emission unwired) directly from the ledger. `no_spec` is a valid disposition
 * but is never emitted: a spec-less cwd gets no `.cladding/` writes (parity).
 * `dedup`/`ledger_exhausted` were added by the Tier-2 impact card
 * (F-35954d19): a repeated (focus,file) fingerprint and an exhausted per-session
 * push-token budget are suppressions of a card that WOULD have fired, not misses.
 */
export type ImpactSkipReason =
  | 'not_write_tool'
  | 'unwatched_path'
  | 'no_spec'
  | 'debounced'
  | 'trivial_edit'
  | 'owner_miss'
  | 'spec_unreadable'
  | 'dedup'
  | 'ledger_exhausted';

/** One JSONL line in events.log.jsonl. */
export interface Event {
  /** Stable id, e.g. `ev-yyyyMMddHHmmss-rand`. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  readonly type: EventType;
  /** Free-form context payload. Always JSON-serialisable. */
  readonly payload: Record<string, unknown>;
}

interface EventWorkspace {
  readonly root: string;
  readonly directory: string;
  readonly eventPath: string;
  readonly rollPath: string;
  readonly lockPath: string;
  readonly reclaimPath: string;
  readonly journalPath: string;
}

/**
 * Resolves the complete observer-owned path set without following a managed
 * symbolic link. Event telemetry is non-authoritative, so uncertainty is a
 * no-op rather than a path traversal or a partial observer write.
 */
function eventWorkspace(cwd: string, createDirectory: boolean): EventWorkspace | undefined {
  try {
    const requestedRoot = resolve(cwd);
    const rootState = lstatSync(requestedRoot);
    if (rootState.isSymbolicLink() || !rootState.isDirectory()) return undefined;
    const root = realpathSync(requestedRoot);
    const directory = join(root, EVENTS_DIR);
    let directoryState = lstatOrUndefined(directory);
    if (!directoryState && createDirectory) {
      try { mkdirSync(directory); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return undefined;
      }
      directoryState = lstatOrUndefined(directory);
    }
    if (!directoryState || directoryState.isSymbolicLink() || !directoryState.isDirectory()) return undefined;
    const realDirectory = realpathSync(directory);
    if (!isInsideRealWorkspace(root, realDirectory)) return undefined;
    const workspace: EventWorkspace = {
      root,
      directory: realDirectory,
      eventPath: join(realDirectory, EVENTS_FILE),
      rollPath: join(realDirectory, EVENTS_ROLL),
      lockPath: join(realDirectory, SPEC_TRANSACTION_LOCK),
      reclaimPath: join(realDirectory, `${SPEC_TRANSACTION_LOCK}.reclaim`),
      journalPath: join(realDirectory, SPEC_TRANSACTION_JOURNAL),
    };
    return managedEventDestinationsAreSafe(workspace) ? workspace : undefined;
  } catch {
    return undefined;
  }
}

/** Returns a final-component lstat without accidentally following a dangling link. */
function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Every existing event-controlled destination must be a regular in-root file. */
function managedEventDestinationsAreSafe(workspace: EventWorkspace): boolean {
  if (!isInsideRealWorkspace(workspace.root, workspace.directory)) return false;
  for (const path of [workspace.eventPath, workspace.rollPath, workspace.lockPath, workspace.reclaimPath, workspace.journalPath]) {
    if (!isInsideRealWorkspace(workspace.root, path)) return false;
    const state = lstatOrUndefined(path);
    if (!state) continue;
    if (state.isSymbolicLink() || !state.isFile()) return false;
    try {
      if (!isInsideRealWorkspace(workspace.root, realpathSync(path))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Tests a resolved candidate, never a prefix string, against the real workspace root. */
function isInsideRealWorkspace(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Append a single event. Creates the directory if needed. Rolls the live log
 * to `events.log.1.jsonl` (single generation, newest kept live) past
 * ROTATE_BYTES so reads stay bounded. */
export function appendEvent(cwd: string, event: Event): void {
  try {
    const workspace = eventWorkspace(cwd, true);
    if (!workspace) return;
    const release = acquireSpecEventLock(workspace);
    if (!release) return;
    try {
      // A dead writer's durable journal belongs to F4 recovery. Appending into
      // its before-image would create a third state that recovery must not
      // silently discard, so best-effort telemetry waits for a later call.
      if (hasPendingSpecTransaction(workspace)) return;
      appendEventUnlocked(workspace, event);
    } finally { release(); }
  } catch {
    // Observer telemetry cannot change the primary command outcome.
  }
}

/** Performs the actual append while ownership of the F4 workspace lock is held. */
function appendEventUnlocked(workspace: EventWorkspace, event: Event): void {
  if (!managedEventDestinationsAreSafe(workspace)) return;
  const path = workspace.eventPath;
  try {
    if (existsSync(path) && statSync(path).size > ROTATE_BYTES) {
      if (!managedEventDestinationsAreSafe(workspace)) return;
      renameSync(path, workspace.rollPath); // replaces any previous roll
    }
  } catch {
    // Rotation is best-effort; a failed roll must not lose the append.
  }
  if (!managedEventDestinationsAreSafe(workspace)) return;
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
}

/** A pending journal makes event observers defer until F4 recovery restores one canonical state. */
function hasPendingSpecTransaction(workspace: EventWorkspace): boolean {
  return managedEventDestinationsAreSafe(workspace) && lstatOrUndefined(workspace.journalPath) !== undefined;
}

/**
 * Serializes legacy telemetry appenders with journaled F4 event replacements.
 * The lock publication matches the transaction boundary's durable hard-link
 * shape, so a reader never mistakes a partially written owner for permission.
 */
function acquireSpecEventLock(workspace: EventWorkspace): (() => void) | undefined {
  const directory = workspace.directory;
  const path = workspace.lockPath;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!managedEventDestinationsAreSafe(workspace)) return undefined;
    const nonce = randomBytes(12).toString('hex');
    const temporary = join(directory, `.${SPEC_TRANSACTION_LOCK}.event-${nonce}.tmp`);
    let published = false;
    try {
      const fd = openSync(temporary, 'wx');
      try { writeFileSync(fd, `${JSON.stringify({pid: process.pid, nonce})}\n`); fsyncSync(fd); } finally { closeSync(fd); }
      linkSync(temporary, path);
      published = true;
      unlinkSync(temporary);
      fsyncDirectory(directory);
      return () => {
        try {
          if (!managedEventDestinationsAreSafe(workspace)) return;
          const owner = JSON.parse(readFileSync(path, 'utf8')) as {nonce?: unknown};
          if (owner.nonce === nonce) { unlinkSync(path); fsyncDirectory(directory); }
        } catch { /* A replacement owner is never unlinked by this append. */ }
      };
    } catch (error) {
      try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* Not published. */ }
      if (published) {
        // A failure after hard-link publication must retire only this
        // append's owner. Never leave a best-effort event lock to make the
        // transaction authority permanently BUSY.
        try {
          const owner = JSON.parse(readFileSync(path, 'utf8')) as {nonce?: unknown};
          if (owner.nonce === nonce) { unlinkSync(path); fsyncDirectory(directory); }
        } catch { /* A successor or stale-lock recovery owns the pathname. */ }
        return undefined;
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return undefined;
      reclaimDeadSpecEventLock(workspace);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return undefined;
}

/** Retires only a demonstrably dead event/transaction owner. */
function reclaimDeadSpecEventLock(workspace: EventWorkspace): void {
  if (!managedEventDestinationsAreSafe(workspace)) return;
  const path = workspace.lockPath;
  let observed = '';
  let inode: number | undefined;
  try { observed = readFileSync(path, 'utf8'); inode = lstatSync(path).ino; } catch { return; }
  const nonce = randomBytes(12).toString('hex');
  const reclaimPath = workspace.reclaimPath;
  try {
    const fd = openSync(reclaimPath, 'wx');
    try { writeFileSync(fd, `${JSON.stringify({pid: process.pid, nonce})}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') retireExpiredSpecEventReclaimer(workspace);
    return;
  }
  const release = (): void => {
    try {
      if (!managedEventDestinationsAreSafe(workspace)) return;
      const guard = JSON.parse(readFileSync(reclaimPath, 'utf8')) as {nonce?: unknown};
      if (guard.nonce === nonce) { unlinkSync(reclaimPath); fsyncDirectory(dirname(reclaimPath)); }
    } catch { /* A concurrent stale-lock cleanup owns any replacement. */ }
  };
  const retireObserved = (): void => {
    try {
      if (!managedEventDestinationsAreSafe(workspace)) return;
      if (lstatSync(path).ino !== inode || readFileSync(path, 'utf8') !== observed) return;
      const tombstone = `${path}.retired-${nonce}`;
      renameSync(path, tombstone); fsyncDirectory(dirname(path));
      unlinkSync(tombstone); fsyncDirectory(dirname(path));
    } catch { /* A successor or concurrent release owns the pathname. */ }
  };
  try {
    const owner = JSON.parse(observed) as {pid?: unknown};
    if (!Number.isInteger(owner.pid) || (owner.pid as number) <= 0) {
      if (Date.now() - lstatSync(path).mtimeMs > 30_000) retireObserved();
      return;
    }
    try { process.kill(owner.pid as number, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') retireObserved();
    }
  } catch {
    // A fresh malformed lock may be a live process between publication and
    // inspection on a foreign implementation; it is never stolen here.
  } finally { release(); }
}

/** Removes only a reclaimer guard whose owner cannot still be active. */
function retireExpiredSpecEventReclaimer(workspace: EventWorkspace): void {
  if (!managedEventDestinationsAreSafe(workspace)) return;
  const path = workspace.reclaimPath;
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
    renameSync(path, tombstone); fsyncDirectory(dirname(path));
    unlinkSync(tombstone); fsyncDirectory(dirname(path));
  } catch { /* A successor guard owns the pathname. */ }
}

/** Directory fsync is unavailable on a few platforms; rename remains atomic there. */
function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* platform durability fallback */ }
}

/** Parse one events-log file in append order; a missing or empty file → []. */
function readEventsFile(path: string): Event[] {
  return readEventLinesFile(path).map((line) => JSON.parse(line) as Event);
}

/** Reads raw live-log records after one complete managed-path safety check. */
function readEventLinesFile(path: string): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  return raw.length === 0 ? [] : raw.split('\n').filter((line) => line.length > 0);
}

/**
 * Returns live event-log lines only when every observer-managed path is safe.
 * `undefined` means no safe readable log exists, whether the destination is
 * absent or unsafe, so transport adapters never probe an untrusted pathname.
 */
export function readEventLogLines(cwd: string): readonly string[] | undefined {
  const workspace = eventWorkspace(cwd, false);
  return workspace && lstatOrUndefined(workspace.eventPath)
    ? readEventLinesFile(workspace.eventPath)
    : undefined;
}

/** Read every event in the live log in append order. */
export function readEvents(cwd: string): readonly Event[] {
  const lines = readEventLogLines(cwd);
  return lines ? lines.map((line) => JSON.parse(line) as Event) : [];
}

/**
 * Read the rolled generation (`events.log.1.jsonl` — the older half a size
 * rotation left behind) followed by the live log, in append order. Missing
 * files contribute nothing. `appendEvent` keeps a SINGLE rolled generation, so
 * at most two files are concatenated. The adoption reducer (F-0023ba22) reads
 * through this so a recent rotation can't drop completed cycles out of view
 * (AC-345af0b5).
 */
export function readEventsIncludingRolled(cwd: string): readonly Event[] {
  const workspace = eventWorkspace(cwd, false);
  return workspace ? [...readEventsFile(workspace.rollPath), ...readEventsFile(workspace.eventPath)] : [];
}

/** Convenience constructor — fills id + timestamp. */
export function newEvent(type: EventType, payload: Record<string, unknown>): Event {
  return {
    id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type,
    payload,
  };
}

/** Adds the standard immutable actor and repository context without appending bytes. */
export function enrichEventPayload(cwd: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {...payload, head: gitHead(cwd), identity: resolveActorIdentity(cwd)};
}

/** Actor identity for lifecycle events: git author when resolvable (the
 * stable handle a team recognizes), else the OS user. Never throws. */
function resolveActorIdentity(cwd: string): Identity {
  let name: string | undefined;
  try {
    name = execFileSync('git', ['config', 'user.name'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() || undefined;
  } catch {
    /* git absent or unconfigured */
  }
  if (!name) {
    try {
      name = userInfo().username;
    } catch {
      name = undefined;
    }
  }
  return {author: 'human', name, timestamp: new Date().toISOString()};
}

function gitHead(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return undefined;
  }
}

/** Latest event of a type, or null. Scans the (rotation-bounded) live log. */
export function latestEventOfType(cwd: string, type: EventType): Event | null {
  try {
    const events = readEvents(cwd);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === type) return events[i];
    }
  } catch {
    /* unreadable ledger = no precedent */
  }
  return null;
}

/**
 * Record a lifecycle event with actor identity + git HEAD stamped into the
 * payload (F-b84c38). BEST-EFFORT BY CONTRACT: the ledger observes the
 * harness; a telemetry failure must never break the calling command, so every
 * failure path degrades to a silent no-op.
 *
 * `gate_run` dedupe: when the latest gate_run already carries the identical
 * head/tier/strict/worst plus blocker evidence, the append is skipped — except
 * when a stop_blocked event occurred after that gate. The first later gate must
 * remain observable so Stop's fingerprint can be correlated without a second
 * state file; subsequent identical gates dedupe normally.
 */
export function recordEvent(cwd: string, type: EventType, payload: Record<string, unknown>): void {
  try {
    const full = enrichEventPayload(cwd, payload);
    if (type === 'gate_run') {
      recordGateRunUnderEventLock(cwd, full, payload);
      return;
    }
    appendEvent(cwd, newEvent(type, full));
  } catch {
    // error-as-data at the boundary: the command outcome is unchanged.
  }
}

/**
 * Reads, deduplicates, and appends a gate observation under one F4 lock.
 * A concurrent caller can therefore only observe either the old decision or
 * the complete prior append, never the pre-lock dedupe gap.
 */
function recordGateRunUnderEventLock(cwd: string, full: Record<string, unknown>, payload: Record<string, unknown>): void {
  const workspace = eventWorkspace(cwd, true);
  if (!workspace) return;
  const release = acquireSpecEventLock(workspace);
  if (!release) return;
  try {
    if (hasPendingSpecTransaction(workspace) || !managedEventDestinationsAreSafe(workspace)) return;
    const events = readEventsFile(workspace.eventPath);
    let prevIndex = -1;
    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index].type === 'gate_run') {
        prevIndex = index;
        break;
      }
    }
    const prev = prevIndex >= 0 ? events[prevIndex] : undefined;
    const stopBlockedSince = prevIndex >= 0 && events.slice(prevIndex + 1).some((event) => event.type === 'stop_blocked');
    if (
      prev &&
      !stopBlockedSince &&
      prev.payload.head === full.head &&
      prev.payload.tier === payload.tier &&
      prev.payload.strict === payload.strict &&
      prev.payload.worst === payload.worst &&
      prev.payload.stopFingerprint === payload.stopFingerprint &&
      JSON.stringify(prev.payload.blockers ?? []) === JSON.stringify(payload.blockers ?? [])
    ) return;
    appendEventUnlocked(workspace, newEvent('gate_run', full));
  } finally {
    release();
  }
}
