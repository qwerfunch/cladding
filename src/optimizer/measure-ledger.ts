// Cladding · optimizer · measure ledger — F-39609db4
//
// `clad measure` computes deterministic context/search/stability metrics but,
// until now, wrote them only to stdout — the numbers evaporated on exit, which
// is exactly why the README "4×" claim went stale (no re-derivable record ever
// existed). This module persists a one-line summary snapshot per measure run to
// .cladding/measure.jsonl and renders a signed-delta trend over the tail.
//
// Two of the three functions are pure (`renderTrend`) or tolerant readers
// (`readMeasureSnapshots`); the append does real I/O following the best-effort
// contract of events/log.ts — a telemetry failure never breaks the command
// (AC-2c4f07d8: the ledger observes `clad measure`, it does not gate it).
//
// DEDUPE GRANULARITY = commit + spec-file state, NOT working-tree state.
//   • `head`        moves only on a commit (readGitHead → git rev-parse HEAD).
//     No HEAD at all (outside a repo / before the first commit) ⇒ the snapshot
//     is unreproducible — no `git checkout <head>` target exists and the dedupe
//     key degenerates to spec_digest alone — so the append is SKIPPED with
//     reason 'no_head' rather than persisting an unanchorable line.
//   • `spec_digest` (computeSpecDigest) hashes spec.yaml + spec/features/*.yaml
//     + spec/scenarios/*.yaml ONLY — it does NOT hash src/.
// So an *uncommitted edit to a source module* — which CAN change the measured
// token numbers, since measurement reads the module file contents — leaves both
// dedupe keys unchanged and is treated as a duplicate (zero lines appended).
// A snapshot is therefore guaranteed fresh per commit and per uncommitted spec
// edit, but NOT per uncommitted src edit. This is intentional: the ledger tracks
// the re-derivable (committed) state, and the git-clean measurement is the
// reproducible one worth trending.

import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {computeSpecDigest, readGitHead} from '../core/checkpoint.js';
import {MEASUREMENT_DISCLAIMER, type EfficiencyReport} from './measurement.js';

const LEDGER_DIR = '.cladding';
const LEDGER_FILE = 'measure.jsonl';

/** One persisted line: the report's SUMMARY aggregates only — never the
 *  per-feature `features[]` rows (they'd blow the ≤1KB line budget and aren't
 *  trendable). Keys mirror EfficiencyReport so a reader can drill in. */
export interface MeasureSnapshot {
  /** ISO 8601 time the snapshot was recorded. */
  readonly timestamp: string;
  /** git HEAD sha; null outside a repo / before the first commit — such a
   *  snapshot exists only in memory (snapshotFromReport): the append skips it
   *  with reason 'no_head', so a persisted line always carries a real sha. */
  readonly head: string | null;
  /** SHA-256 of the spec surface (spec.yaml + spec/features + spec/scenarios). */
  readonly spec_digest: string;
  readonly featureCount: number;
  readonly measured: number;
  readonly context: EfficiencyReport['context'];
  readonly search: EfficiencyReport['search'];
  readonly stability: EfficiencyReport['stability'];
}

/** Outcome of an append attempt — never a throw. The CLI may pulse a note. */
export interface AppendResult {
  readonly appended: boolean;
  readonly reason: 'appended' | 'deduped' | 'no_head' | 'error';
}

function ledgerPath(cwd: string): string {
  return join(cwd, LEDGER_DIR, LEDGER_FILE);
}

/** Builds the summary snapshot from a report + current commit/spec state. */
export function snapshotFromReport(cwd: string, report: EfficiencyReport): MeasureSnapshot {
  return {
    timestamp: new Date().toISOString(),
    head: readGitHead(cwd),
    spec_digest: computeSpecDigest(cwd),
    featureCount: report.featureCount,
    measured: report.measured,
    context: report.context,
    search: report.search,
    stability: report.stability,
  };
}

/**
 * Appends one summary snapshot to .cladding/measure.jsonl. Skips the write when
 * git HEAD is unavailable (reason 'no_head' — a head:null line has no reproduce
 * target and a degenerate dedupe key, see the header note) and when the newest
 * existing snapshot carries an identical (head, spec_digest) pair, so repeated
 * runs on an unchanged commit+spec state add zero lines (AC-cf43f71c).
 * BEST-EFFORT: any I/O failure degrades to {appended:false, reason:'error'} and
 * never throws (AC-2c4f07d8).
 */
export function appendMeasureSnapshot(cwd: string, report: EfficiencyReport): AppendResult {
  try {
    const snap = snapshotFromReport(cwd, report);
    // Unreproducible without a commit: `git checkout <head>` has no target.
    if (snap.head === null) return {appended: false, reason: 'no_head'};
    const existing = readMeasureSnapshots(cwd);
    const newest = existing[existing.length - 1];
    if (newest && newest.head === snap.head && newest.spec_digest === snap.spec_digest) {
      return {appended: false, reason: 'deduped'};
    }
    const path = ledgerPath(cwd);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    appendFileSync(path, `${JSON.stringify(snap)}\n`, 'utf8');
    return {appended: true, reason: 'appended'};
  } catch {
    // error-as-data at the boundary: the measure command's outcome is unchanged.
    return {appended: false, reason: 'error'};
  }
}

/** Tolerant line parse: skips malformed / foreign lines, keeps chronological order. */
function parseSnapshotLines(raw: string): MeasureSnapshot[] {
  const snaps: MeasureSnapshot[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      const obj = JSON.parse(t) as MeasureSnapshot;
      if (obj && typeof obj === 'object' && obj.context && obj.search && obj.stability) {
        snaps.push(obj);
      }
    } catch {
      // skip malformed line — a torn write must not abort the whole read.
    }
  }
  return snaps;
}

/**
 * Reads the ledger in append (chronological) order, tolerantly: malformed lines
 * are skipped rather than aborting the parse, so one bad write never blinds the
 * trend. `limit` (when given) returns only the newest `limit` snapshots.
 */
export function readMeasureSnapshots(cwd: string, limit?: number): readonly MeasureSnapshot[] {
  const path = ledgerPath(cwd);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const snaps = parseSnapshotLines(raw);
  return typeof limit === 'number' && limit >= 0 ? snaps.slice(-limit) : snaps;
}

/** Ledger read that distinguishes "genuinely empty" from "present but unparseable". */
export interface MeasureLedgerRead {
  /** Parsed snapshots in append order (empty when absent OR unreadable). */
  readonly snapshots: readonly MeasureSnapshot[];
  /**
   * True when the ledger file exists with non-blank content but NO line parsed
   * into a snapshot — a torn write, a foreign file, or an unreadable path. Lets
   * a caller report `ledger unreadable` distinctly from `no snapshot` (the
   * changelog --measure JSON manifest needs the explicit reason, F-ede6fa75).
   */
  readonly unreadable: boolean;
}

/**
 * Reads the ledger AND reports readability. `readMeasureSnapshots` collapses
 * "absent", "empty", and "unparseable" all to `[]`; this keeps them apart so a
 * caller can say WHY there are no snapshots instead of guessing.
 */
export function readMeasureLedger(cwd: string): MeasureLedgerRead {
  const path = ledgerPath(cwd);
  if (!existsSync(path)) return {snapshots: [], unreadable: false};
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {snapshots: [], unreadable: true};
  }
  const snapshots = parseSnapshotLines(raw);
  const hadContent = raw.trim().length > 0;
  return {snapshots, unreadable: hadContent && snapshots.length === 0};
}

/**
 * Formats a numeric delta with an explicit sign (`+3`, `-2`, `0`, `+0.05`).
 * The signed-delta primitive `renderTrend` uses — exported (F-ede6fa75) so the
 * changelog's release-over-release delta line reuses the same math instead of
 * re-deriving it and drifting.
 */
export function signed(n: number, digits = 0): string {
  const v = digits > 0 ? Math.round(n * 10 ** digits) / 10 ** digits : Math.round(n);
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s; // negatives already carry '-'; 0 → "0"
}

/**
 * Renders the last `window` (default 5) snapshots as a trend: one row per
 * snapshot with its featureCount and signed deltas vs the immediately preceding
 * snapshot for median slice tokens, median structural ratio, median coverage,
 * p95 depth, and truncated count. The first shown row shows values without a
 * delta only when it is the very first snapshot ever (no predecessor exists).
 * Carries MEASUREMENT_DISCLAIMER verbatim (AC-cbd294d4). Pure.
 */
export function renderTrend(snapshots: readonly MeasureSnapshot[], window = 5): string {
  const start = Math.max(0, snapshots.length - window);
  const shown = snapshots.slice(start);
  const lines: string[] = [`measure trend · last ${shown.length} of ${snapshots.length} snapshot(s)`];
  for (let i = start; i < snapshots.length; i++) {
    const cur = snapshots[i];
    const prev = i > 0 ? snapshots[i - 1] : null;
    const d = (get: (s: MeasureSnapshot) => number, digits = 0): string =>
      prev ? ` (${signed(get(cur) - get(prev), digits)})` : '';
    const ts = cur.timestamp.slice(0, 19);
    const head = cur.head ? cur.head.slice(0, 7) : 'nogit';
    lines.push(
      `  ${ts} ${head} · ${cur.featureCount} feat` +
        ` · slice ${cur.context.medianSliceTokens}${d((s) => s.context.medianSliceTokens)}` +
        ` · struct ${cur.context.medianStructuralRatio.toFixed(2)}${d((s) => s.context.medianStructuralRatio, 2)}` +
        ` · cov ${cur.stability.medianCoverage.toFixed(2)}${d((s) => s.stability.medianCoverage, 2)}` +
        ` · p95depth ${cur.search.p95Depth}${d((s) => s.search.p95Depth)}` +
        ` · trunc ${cur.context.truncatedCount}${d((s) => s.context.truncatedCount)}`,
    );
  }
  lines.push(`  ${MEASUREMENT_DISCLAIMER}`);
  return lines.join('\n');
}
