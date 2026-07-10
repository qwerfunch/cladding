// Cladding · optimizer · prior-attempts reducer — F-59af798d
//
// Fills the seam postmortem.ts:18-24 names as open: cladding CAPTURES failure
// history (events.log `drift_detected` / `done_attempted{kept:false}` /
// `feature_rolled_back`, plus post-mortem markdown on rollback) but never
// COMPILES it back into the next iteration's context — so a host loop, after
// context compaction or in a resumed session, starts blind to WHY attempts
// 1..N-1 failed (loop-engineering mistake #1). This module reduces those
// ledgers into ONE compact `prior_attempts` summary the working-set assembler
// attaches (within its existing token budget), so iteration N reads
// "attempts: 2, last failed stage_2.2 coverage, rolled back to <sha>".
//
// Two-layer split (AC-586795f9 — PURITY):
//   • reducePriorAttempts(...)  — PURE. Derives the summary from in-memory
//     ledger arrays only. No IO, no gate run, no source analysis. An UPPER
//     BOUND on available memory, never a claim iteration quality improves.
//   • buildPriorAttempts(...)   — thin IO shell. Reads the events log
//     (rolled + live) and the feature's post-mortem files, then calls the
//     reducer. Best-effort: any read error degrades to `undefined` so a
//     telemetry problem can never crash the working set.
//
// BOUNDED (AC-13df5e54 — the ZERO-side-effect lock): the summary is small by
// construction — `drift_history` is capped to the N most-recent entries, each
// carrying only `{detector, message}` with the message truncated; raw
// post-mortem markdown is NEVER embedded (only a single derived recovery line).
// working-set.ts measures it inside the SAME token budget and drops it first
// under pressure, so it can never bloat context.
//
// NULL-OMIT (AC-c3db73f1): a feature with no recorded failure history returns
// `undefined` — never an empty structure pretending to be memory. Most features
// have no history, so the common path costs nothing.

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {readEventsIncludingRolled, type Event} from '../events/log.js';

/** The N most-recent drift-history entries carried in a summary (BOUND #1). */
const DRIFT_HISTORY_CAP = 5;
/** Per-entry message / recovery-hint length cap in chars (BOUND #2). */
const MESSAGE_MAX = 120;

/**
 * Compact failure-history summary for one feature, attached to its working set.
 * Every field beyond `attempts` is optional and OMITTED when unknown (never an
 * empty placeholder) — the same null-omit discipline the whole structure follows.
 */
export interface PriorAttempts {
  /** Count of failed attempts observed in the (rotation-bounded) ledger:
   *  `drift_detected` events + `done_attempted` events with `kept === false`. */
  readonly attempts: number;
  /** The most-recent named gate/stage a failure landed on, e.g. `stage_2.2`.
   *  Sourced from the newest `drift_detected.gate`, else the newest post-mortem. */
  readonly last_failed_gate?: string;
  /** The drive loop's own retry counter at the last rollback (from the newest
   *  post-mortem). Distinct from `attempts`, which is ledger-observed and may be
   *  under-counted after rotation — see `truncated_history`. */
  readonly retry_count?: number;
  /** Up to DRIFT_HISTORY_CAP most-recent failures, compacted. `detector` is the
   *  failing gate id for loop-emitted drift (the harness records gate-level
   *  drift, not detector-level, in the loop); `message` is a truncated one-liner. */
  readonly drift_history?: readonly {readonly detector: string; readonly message: string}[];
  /** The git head the last `feature_rolled_back` targeted (rolled back TO <sha>). */
  readonly rolled_back_at?: string;
  /** A single derived line from the newest post-mortem (recovery command +
   *  context) — NEVER the whole file. Truncated to MESSAGE_MAX. */
  readonly recovery_hint?: string;
  /** True when a rotated events-log generation is gone, so the summary is known
   *  to be partial rather than silently under-reported (AC-6bfaa04e). */
  readonly truncated_history?: boolean;
}

/**
 * A post-mortem markdown file parsed down to the fields the reducer needs.
 * `buildPriorAttempts` produces these from disk; the reducer stays pure over
 * them. Every field but `featureId`/`timestamp` is best-effort/optional.
 */
export interface PostMortemRecord {
  /** The feature the post-mortem documents. */
  readonly featureId: string;
  /** ISO 8601 rollback time — used only to pick the newest record. */
  readonly timestamp: string;
  /** The gate the failure landed on, e.g. `stage_2.2`. */
  readonly lastFailedGate?: string;
  /** The loop's retry count at rollback time. */
  readonly retryCount?: number;
  /** The single recommended recovery command line. */
  readonly recovery?: string;
}

/** Options for the pure reducer. `truncated` is an IO-derived fact (a rotated
 *  generation is gone) the shell supplies; the reducer cannot know it from the
 *  events alone, so it is threaded in here to keep truncation purely testable. */
export interface ReduceOptions {
  readonly truncated?: boolean;
}

/** Trim + cap a string to `max` chars, appending an ellipsis when clipped. */
function truncate(s: string, max: number = MESSAGE_MAX): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** Compacts one failed-attempt event into a `{detector, message}` entry. */
function toDriftEntry(e: Event): {detector: string; message: string} {
  const p = e.payload ?? {};
  if (e.type === 'drift_detected') {
    const gate = typeof p.gate === 'string' && p.gate ? p.gate : 'drift';
    return {detector: gate, message: truncate(`drift detected at gate ${gate}`)};
  }
  // done_attempted with kept === false — a done flip the pre-push gate reverted.
  const worst = typeof p.worst === 'number' ? ` (worst ${p.worst})` : '';
  return {detector: 'done_attempted', message: truncate(`done reverted — pre-push strict gate red${worst}`)};
}

/** Millisecond timestamp for ordering post-mortems newest-last; 0 when unparseable. */
function pmTime(p: PostMortemRecord): number {
  const t = Date.parse(p.timestamp);
  return Number.isFinite(t) ? t : 0;
}

/** Derives a SINGLE recovery line from a post-mortem — never the whole file. */
function buildRecoveryHint(pm: PostMortemRecord): string {
  const ctx: string[] = [];
  if (pm.lastFailedGate) ctx.push(`failed ${pm.lastFailedGate}`);
  if (typeof pm.retryCount === 'number') ctx.push(`${pm.retryCount} retries`);
  const suffix = ctx.length ? ` (${ctx.join(', ')})` : '';
  const line = pm.recovery ? `recover: ${pm.recovery}${suffix}` : `rolled back${suffix}`;
  return truncate(line);
}

/**
 * PURE reducer — compiles a feature's failure history from in-memory ledger
 * arrays into a bounded `PriorAttempts`, or `undefined` when the feature has no
 * failure history at all (NULL-OMIT, AC-c3db73f1). Deterministic and total:
 * malformed payloads degrade to safe defaults, never throw.
 *
 * @param events      every lifecycle event (rolled + live), any feature.
 * @param postmortems parsed post-mortem records, any feature.
 * @param featureId   the feature to summarize.
 * @param opts.truncated  IO-derived: a rotated events generation is gone.
 */
export function reducePriorAttempts(
  events: readonly Event[],
  postmortems: readonly PostMortemRecord[],
  featureId: string,
  opts: ReduceOptions = {},
): PriorAttempts | undefined {
  const mine = events.filter((e) => e && e.payload && e.payload.feature === featureId);
  const pms = postmortems
    .filter((p) => p && p.featureId === featureId)
    .slice()
    .sort((a, b) => pmTime(a) - pmTime(b)); // oldest → newest

  const failed = mine.filter(
    (e) => e.type === 'drift_detected' || (e.type === 'done_attempted' && e.payload.kept === false),
  );
  const rollbacks = mine.filter((e) => e.type === 'feature_rolled_back');

  // NULL-OMIT: no drift, no reverted done, no rollback, no post-mortem → no memory.
  if (failed.length === 0 && rollbacks.length === 0 && pms.length === 0) return undefined;

  const newestPm = pms.length ? pms[pms.length - 1] : undefined;

  // last_failed_gate — prefer the newest named gate from a drift event, then the
  // newest post-mortem (a reverted done carries only a severity, never a gate id).
  let lastFailedGate: string | undefined;
  for (let i = failed.length - 1; i >= 0; i--) {
    const g = failed[i].payload.gate;
    if (failed[i].type === 'drift_detected' && typeof g === 'string' && g) {
      lastFailedGate = g;
      break;
    }
  }
  if (!lastFailedGate && newestPm?.lastFailedGate) lastFailedGate = newestPm.lastFailedGate;

  // drift_history — last N failed events, compacted (BOUNDED, AC-13df5e54).
  const driftHistory = failed.slice(-DRIFT_HISTORY_CAP).map(toDriftEntry);

  // rolled_back_at — the git head the last rollback targeted.
  let rolledBackAt: string | undefined;
  for (let i = rollbacks.length - 1; i >= 0; i--) {
    const h = rollbacks[i].payload.to_git_head;
    if (typeof h === 'string' && h) {
      rolledBackAt = h;
      break;
    }
  }

  const retryCount = typeof newestPm?.retryCount === 'number' ? newestPm.retryCount : undefined;
  const recoveryHint = newestPm ? buildRecoveryHint(newestPm) : undefined;

  return {
    attempts: failed.length,
    ...(lastFailedGate ? {last_failed_gate: lastFailedGate} : {}),
    ...(retryCount !== undefined ? {retry_count: retryCount} : {}),
    ...(driftHistory.length ? {drift_history: driftHistory} : {}),
    ...(rolledBackAt ? {rolled_back_at: rolledBackAt} : {}),
    ...(recoveryHint ? {recovery_hint: recoveryHint} : {}),
    ...(opts.truncated ? {truncated_history: true} : {}),
  };
}

/** Pulls a single capture group from `body`, or `undefined`. */
function matchGroup(body: string, re: RegExp): string | undefined {
  const m = body.match(re);
  return m && m[1] ? m[1].trim() : undefined;
}

/** Extracts the first non-empty line of the fenced block under "Recommended recovery". */
function extractRecovery(body: string): string | undefined {
  const idx = body.indexOf('## Recommended recovery');
  if (idx < 0) return undefined;
  const m = body.slice(idx).match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) return undefined;
  const first = m[1]
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return first || undefined;
}

/** Parses one post-mortem markdown body into a record (tolerant, never throws). */
function parsePostMortem(body: string, featureId: string, filename: string): PostMortemRecord {
  const rolledAt = matchGroup(body, /_Rolled back at_\s*`([^`]+)`/);
  const gate = matchGroup(body, /Last failed gate:\s*`([^`]+)`/);
  const retryStr = matchGroup(body, /Retry attempts:\s*(\d+)/);
  const recovery = extractRecovery(body);
  return {
    featureId,
    // The body's ISO timestamp is authoritative; the filename is a lossy,
    // colon-sanitized fallback used only when the body line is missing.
    timestamp: rolledAt ?? filename,
    ...(gate ? {lastFailedGate: gate} : {}),
    ...(retryStr ? {retryCount: Number(retryStr)} : {}),
    ...(recovery ? {recovery} : {}),
  };
}

/** Reads + parses every post-mortem file for `featureId`. Best-effort: an
 *  unreadable file is skipped, a missing directory yields []. */
function readPostMortems(cwd: string, featureId: string): PostMortemRecord[] {
  const dir = join(cwd, '.cladding', 'post-mortems');
  if (!existsSync(dir)) return [];
  const prefix = `post-mortem-${featureId}-`;
  const out: PostMortemRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.md')) continue;
    try {
      out.push(parsePostMortem(readFileSync(join(dir, entry), 'utf8'), featureId, entry));
    } catch {
      // skip an unreadable post-mortem — partial history beats a crash.
    }
  }
  return out;
}

/**
 * IO shell — reads the events log (rolled + live) and the feature's post-mortem
 * files, then calls the pure reducer. BEST-EFFORT BY CONTRACT: any read failure
 * degrades to `undefined` so a broken/absent ledger can never crash the working
 * set (the ZERO-side-effect lock). Returns `undefined` for a feature with no
 * failure history (NULL-OMIT).
 *
 * Truncation (AC-6bfaa04e): the events log keeps a SINGLE rolled generation, so
 * once `events.log.1.jsonl` exists a rotation has occurred and the rolled+live
 * window is no longer guaranteed to span the full history. We flag
 * `truncated_history` conservatively on that existence — over-marking "possibly
 * partial" is the honest direction; the AC forbids only silent under-reporting.
 */
export function buildPriorAttempts(cwd: string, featureId: string): PriorAttempts | undefined {
  try {
    const events = readEventsIncludingRolled(cwd);
    const postmortems = readPostMortems(cwd, featureId);
    const truncated = existsSync(join(cwd, '.cladding', 'events.log.1.jsonl'));
    return reducePriorAttempts(events, postmortems, featureId, {truncated});
  } catch {
    return undefined; // error-as-data at the boundary — the working set is unchanged.
  }
}
