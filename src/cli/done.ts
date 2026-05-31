// Cladding · `clad done <featureId>` — the gated done-transition.
//
// WHY this exists: `status: done` is normally just the host AI writing YAML, so
// a feature can be declared "done" while its code does not typecheck or its
// tests are missing. The A/B run observed exactly this — a host marked 23
// features done while `clad check --tier=pre-push --strict` was RED (Type / Lint
// / Coverage failing). `done` claimed more than it had earned.
//
// `clad done` makes the transition EARN itself: flip the shard to done, run the
// pre-push strict gate, and KEEP done only if that gate is GREEN — otherwise
// revert. It is the floor that keeps `done` honest even outside the per-feature
// driver loop (a host that hand-writes `status: done` bypasses this verb, but
// the same gate at push/CI then fails on that feature's red stages).
//
// FLIP-THEN-GATE ORDER is deliberate: the done-aware detectors UNTESTED_AC and
// MISSING_TESTS skip features that are not yet `done`, so gating BEFORE the flip
// would green-light a feature that has no tests. We flip first so the gate
// evaluates the feature as done, then revert if it does not hold.

import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {parseSpec} from '../spec/parse.js';

/** Gate runner injected so tests can drive `performDone` without spawning tsc/vitest. */
export interface DoneDeps {
  /** Runs a tier's stages; returns the worst exit code (0 = GREEN). */
  readonly checkStages: (opts: {strict?: boolean; tier?: string}) => {worst: number};
}

/** Outcome of a `clad done` attempt — `code` is the process exit code. */
export interface DoneResult {
  readonly ok: boolean;
  readonly code: number;
  readonly featureId: string;
  readonly prevStatus?: string;
  readonly shardPath?: string;
  readonly reason: string;
}

interface ShardHit {
  readonly path: string;
  readonly status: string;
}

/**
 * Finds the `spec/features/` shard file whose top-level `id` equals `featureId`,
 * returning its path and current status. Returns null when no shard matches
 * (e.g. the feature is inlined in spec.yaml, or the id is unknown).
 */
export function findShardFile(cwd: string, featureId: string): ShardHit | null {
  const dir = join(cwd, 'spec', 'features');
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
    const path = join(dir, f);
    let doc: unknown;
    try {
      doc = parseSpec(path);
    } catch {
      continue;
    }
    const rec = doc as {id?: unknown; status?: unknown};
    if (rec && rec.id === featureId) {
      return {path, status: typeof rec.status === 'string' ? rec.status : ''};
    }
  }
  return null;
}

/**
 * Rewrites a shard body's top-level `status:` line to `status: <status>`,
 * preserving every other byte (comments, ordering, quoting elsewhere). Falls
 * back to inserting the line after `id:` when no status line exists.
 */
export function setStatus(body: string, status: string): string {
  if (/^status:[ \t]*.*$/m.test(body)) {
    return body.replace(/^status:[ \t]*.*$/m, `status: ${status}`);
  }
  if (/^id:[ \t]*.*$/m.test(body)) {
    return body.replace(/^(id:[ \t]*.*)$/m, `$1\nstatus: ${status}`);
  }
  return `status: ${status}\n${body}`;
}

/**
 * Flips `featureId` to `done` iff the pre-push strict gate is GREEN with the
 * feature evaluated as done; reverts the shard byte-for-byte on a red gate.
 * All IO is the shard file under `cwd` plus the injected gate runner, so this
 * is unit-testable without the real toolchain.
 */
export function performDone(cwd: string, featureId: string, deps: DoneDeps): DoneResult {
  if (!featureId) {
    return {ok: false, code: 2, featureId, reason: 'feature id required (e.g. clad done F-001)'};
  }
  const hit = findShardFile(cwd, featureId);
  if (!hit) {
    return {
      ok: false,
      code: 1,
      featureId,
      reason:
        `no feature shard under spec/features/ declares id '${featureId}'` +
        ' (inline features: edit spec.yaml then run `clad check --tier=pre-push --strict` manually)',
    };
  }
  const original = readFileSync(hit.path, 'utf8');
  // Flip to done BEFORE gating so the done-aware detectors evaluate this
  // feature's test evidence (see module header).
  writeFileSync(hit.path, setStatus(original, 'done'));
  const {worst} = deps.checkStages({tier: 'pre-push', strict: true});
  if (worst === 0) {
    return {
      ok: true,
      code: 0,
      featureId,
      prevStatus: hit.status,
      shardPath: hit.path,
      reason: `strict gate GREEN — status: ${hit.status || 'unset'} → done`,
    };
  }
  // Red gate: the feature has not earned done. Revert to exactly what was there.
  writeFileSync(hit.path, original);
  return {
    ok: false,
    code: 1,
    featureId,
    prevStatus: hit.status,
    shardPath: hit.path,
    reason:
      `strict gate not GREEN — status left at '${hit.status || 'unset'}'.` +
      ' Fix the failing stage(s) above, then re-run `clad done`.',
  };
}
