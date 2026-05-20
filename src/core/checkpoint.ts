// Cladding · core · checkpoint registry
//
// Phase 1 of the Iron Law backbone (ironclad-design 02-iron-law §2.5).
// A checkpoint pins a (featureId, git HEAD, spec digest, timestamp)
// tuple into events.log so a maintainer — or, in a later phase, the
// drive loop after exhausting `maxRetriesPerFeature` — can roll the
// working tree back to a known-good state.
//
// Phase 1 deliberately stops at event recording. Cladding does **not**
// execute the actual git checkout / spec restore — that boundary stays
// with the maintainer because the right command depends on the host's
// branch policy (force-with-lease vs reset --hard vs revert commits)
// and on whether un-checkpointed files exist in the working tree. The
// `clad rollback` subcommand prints the exact restore instructions
// the maintainer needs and records `feature_rolled_back` once they
// confirm the operation succeeded.
//
// Later phases (v0.3.21+) will layer auto-rollback hooks on top of
// this event surface, but the recording contract stays stable: every
// checkpoint or rollback transition produces exactly one event.
//
// @see iron-law.md §2.5 — Integrity Checkpoint & Rollback.
// @see ironclad-design audit (2026-05-20) — Tier-1 gap #3.

import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

import {appendEvent, newEvent, readEvents, type Event} from '../events/log.js';

/** Snapshot tuple persisted on the `feature_checkpoint` event payload. */
export interface Checkpoint {
  /** F-NNN or F-<hash> the checkpoint pins. */
  readonly featureId: string;
  /** `git rev-parse HEAD` at the moment of recording, or `null` outside a git repo. */
  readonly gitHead: string | null;
  /** SHA-256 of the spec contents (spec.yaml + spec/features/*.yaml + spec/scenarios/*.yaml). */
  readonly specDigest: string;
  /** ISO 8601 timestamp the checkpoint was recorded at. */
  readonly timestamp: string;
}

/**
 * Reads `git rev-parse HEAD` from `cwd`. Returns `null` when the
 * directory is not inside a git repo or when git is unavailable —
 * Phase 1 does not require a git repo to operate (the digest alone
 * is enough to detect spec drift between checkpoint and rollback).
 */
export function readGitHead(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString('utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Computes the deterministic SHA-256 of the spec surface a checkpoint
 * cares about. Order-invariant by sorting file paths first — this
 * keeps the digest stable across filesystems that enumerate directory
 * entries differently. Files that do not exist are silently skipped
 * so a fresh project (no `spec/features/` yet) can still checkpoint.
 */
export function computeSpecDigest(cwd: string): string {
  const targets: string[] = [];
  const root = join(cwd, 'spec.yaml');
  if (existsSync(root) && statSync(root).isFile()) targets.push(root);
  for (const sub of ['features', 'scenarios']) {
    const subdir = join(cwd, 'spec', sub);
    if (!existsSync(subdir) || !statSync(subdir).isDirectory()) continue;
    for (const entry of readdirSync(subdir)) {
      if (!entry.endsWith('.yaml')) continue;
      targets.push(join(subdir, entry));
    }
  }
  targets.sort();
  const hash = createHash('sha256');
  for (const t of targets) {
    // The relative path goes into the hash too so re-ordering a
    // rename doesn't accidentally collide with the original.
    const rel = t.slice(cwd.length + 1);
    hash.update(`${rel}\0`);
    hash.update(readFileSync(t));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Records a `feature_checkpoint` event capturing the current git HEAD
 * and spec digest for `featureId`. Returns the persisted Checkpoint
 * tuple so callers can echo it back to the user.
 */
export function recordCheckpoint(cwd: string, featureId: string): Checkpoint {
  const checkpoint: Checkpoint = {
    featureId,
    gitHead: readGitHead(cwd),
    specDigest: computeSpecDigest(cwd),
    timestamp: new Date().toISOString(),
  };
  appendEvent(
    cwd,
    newEvent('feature_checkpoint', {
      feature: featureId,
      git_head: checkpoint.gitHead,
      spec_digest: checkpoint.specDigest,
    }),
  );
  return checkpoint;
}

/**
 * Walks events.log in reverse order and returns the most recent
 * `feature_checkpoint` event for `featureId`, or `null` when none
 * exists. The reverse walk avoids loading the whole log into a Map.
 */
export function findLatestCheckpoint(cwd: string, featureId: string): Checkpoint | null {
  const events = readEvents(cwd);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'feature_checkpoint') continue;
    if (e.payload.feature !== featureId) continue;
    return {
      featureId,
      gitHead: (e.payload.git_head ?? null) as string | null,
      specDigest: String(e.payload.spec_digest ?? ''),
      timestamp: e.timestamp,
    };
  }
  return null;
}

/**
 * Records a `feature_rolled_back` event. Phase 1 does not perform the
 * git checkout — the maintainer or downstream tooling does — but the
 * event marks the transition so the audit trail stays complete. The
 * `fromCheckpointId` parameter is the timestamp of the checkpoint the
 * rollback targets so a later analysis can reconstruct the lineage.
 */
export function recordRollback(
  cwd: string,
  featureId: string,
  toCheckpoint: Checkpoint,
  reason?: string,
): Event {
  const event = newEvent('feature_rolled_back', {
    feature: featureId,
    to_git_head: toCheckpoint.gitHead,
    to_spec_digest: toCheckpoint.specDigest,
    to_checkpoint_at: toCheckpoint.timestamp,
    reason: reason ?? null,
  });
  appendEvent(cwd, event);
  return event;
}
