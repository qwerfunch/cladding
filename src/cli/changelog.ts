// Cladding · `clad changelog` — the spec rendered into human-facing change documents
//
// Thin CLI wrapper (I/O + exit codes only); all logic lives in
// src/changelog/. Four surfaces:
//
//   default    — capability-grouped markdown (Soft Shell prose, no internal ids)
//   --json     — the deterministic ChangelogManifest (hosts render release
//                notes FROM this, in the project's language(s))
//   --audit    — the id-keeping `feature | AC | EARS | refs ✓/✗` table
//   --catalog  — the full capability → feature → AC catalog (no git range)
//
// Exit codes: 0 rendered · 2 bad/missing since ref (usage-style — an unknown
// ref must never render a silently empty changelog) · 1 other failure.

import process from 'node:process';

import {collectChangelog, defaultSinceRef} from '../changelog/collect.js';
import type {ChangelogManifest} from '../changelog/collect.js';
import {renderAuditTable, renderCatalog, renderChangelogMarkdown, renderMeasuredBlock} from '../changelog/render.js';
import {readGitHead} from '../core/checkpoint.js';
import {resolveRefToCommit} from '../core/git-ops.js';
import {readMeasureLedger, type MeasureSnapshot} from '../optimizer/measure-ledger.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

export interface ChangelogCommandOptions {
  readonly since?: string;
  readonly json?: boolean;
  readonly catalog?: boolean;
  readonly audit?: boolean;
  /** Embed the release's own re-derivable measurement (F-ede6fa75). */
  readonly measure?: boolean;
  /** Project root (tests inject; the CLI always runs from the project root). */
  readonly cwd?: string;
}

/** The resolved measurement, plus the explicit reason when nothing matched HEAD. */
interface MeasuredResolution {
  readonly snapshot: MeasureSnapshot | null;
  readonly sinceSnapshot: MeasureSnapshot | null;
  /** null when matched; the reason string when `snapshot` is null. */
  readonly reason: 'no snapshot at HEAD' | 'ledger unreadable' | null;
}

/** Newest snapshot whose head equals `sha` (full-sha compare), or null. */
function latestForHead(snapshots: readonly MeasureSnapshot[], sha: string): MeasureSnapshot | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].head === sha) return snapshots[i];
  }
  return null;
}

/**
 * Resolves the measurement for `--measure`, impurely (git HEAD + the ledger).
 * NEVER returns a non-HEAD snapshot as `snapshot`: a match requires a real HEAD
 * sha equal to a stored head (a null==null coincidence outside a repo is not a
 * match). An unreadable ledger yields a null snapshot with the explicit reason —
 * the changelog still renders (AC-8969e2af); measurement embellishes, never breaks.
 */
function resolveMeasured(cwd: string, sinceRef: string): MeasuredResolution {
  const {snapshots, unreadable} = readMeasureLedger(cwd);
  if (unreadable) return {snapshot: null, sinceSnapshot: null, reason: 'ledger unreadable'};
  const head = readGitHead(cwd);
  const snapshot = head ? latestForHead(snapshots, head) : null;
  const sinceCommit = resolveRefToCommit(cwd, sinceRef);
  const sinceSnapshot = sinceCommit ? latestForHead(snapshots, sinceCommit) : null;
  return {snapshot, sinceSnapshot, reason: snapshot ? null : 'no snapshot at HEAD'};
}

/** Handler for `clad changelog [--since <ref>] [--json] [--catalog] [--audit]`. */
export function runChangelogCommand(opts: ChangelogCommandOptions): void {
  const cwd = opts.cwd ?? '.';

  // --catalog renders the whole living spec — no git range involved.
  if (opts.catalog) {
    try {
      process.stdout.write(`${renderCatalog(loadSpec(cwd))}\n`);
      process.exit(0);
    } catch (err) {
      pulse('fail', 'changelog', (err as Error).message);
      process.exit(1);
    }
    return;
  }

  let manifest: ChangelogManifest;
  let sinceRef: string;
  try {
    sinceRef = opts.since ?? defaultSinceRef(cwd);
    manifest = collectChangelog(cwd, sinceRef);
  } catch (err) {
    pulse('fail', 'changelog', (err as Error).message);
    process.exit(2);
    return;
  }

  try {
    if (opts.json) {
      // --measure augments the manifest with EXPLICIT presence/absence: the
      // consumer never has to infer why a number is missing (AC-8969e2af).
      const payload = opts.measure
        ? {...manifest, ...measuredJsonFields(cwd, sinceRef)}
        : manifest;
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else if (opts.audit) {
      process.stdout.write(`${renderAuditTable(manifest, loadSpec(cwd), cwd)}\n`);
    } else {
      // Default prose surface. --measure appends the release's own re-derivable
      // numbers (or the not-measured notice) — never a block, never a break.
      const body = renderChangelogMarkdown(manifest);
      const suffix = opts.measure ? `\n\n${measuredBlock(cwd, sinceRef)}` : '';
      process.stdout.write(`${body}${suffix}\n`);
    }
    process.exit(0);
  } catch (err) {
    pulse('fail', 'changelog', (err as Error).message);
    process.exit(1);
  }
}

/** The `measured` + `measured_reason` fields for the --json + --measure manifest. */
function measuredJsonFields(
  cwd: string,
  sinceRef: string,
): {measured: MeasureSnapshot | null; measured_reason: MeasuredResolution['reason']} {
  const m = resolveMeasured(cwd, sinceRef);
  return {measured: m.snapshot, measured_reason: m.reason};
}

/** The rendered Measured block (or not-measured notice) for the prose surface. */
function measuredBlock(cwd: string, sinceRef: string): string {
  const m = resolveMeasured(cwd, sinceRef);
  return renderMeasuredBlock({snapshot: m.snapshot, sinceSnapshot: m.sinceSnapshot, sinceRef});
}
