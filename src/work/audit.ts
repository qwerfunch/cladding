// Cladding · work · Layer-D auditor (0.4.6, F-89406c)
//
// Reads .cladding/events.log.jsonl and reports on work-transaction
// compliance: which transactions are still open, which timed-out or
// were abandoned, and the temporal windows between transactions
// where the host AI may have edited code outside any work scope
// (Layer-C hook territory — until the per-host PreToolUse adapter
// lands in 0.4.7, those windows are the best signal Layer-D has).
//
// File-system diff comparison (= cross-reference these windows with
// actual `git diff` to flag specific unmapped edits) lands in 0.4.7.
// 0.4.6 is event-log-only — caller-facing report so the host AI's
// orchestrator can warn on suspicious patterns and Layer-D-aware
// agents can request explicit `enter_work` before continuing.

import {spawnSync} from 'node:child_process';

import {readEvents, type Event} from '../events/log.js';
import {listActiveWork} from './registry.js';

const WORK_EVENT_TYPES = new Set([
  'work_entered',
  'work_completed',
  'work_abandoned',
  'work_timed_out',
]);

/** Tier values that natively support sub-agent dispatch. Used by drift detection. */
const TIERS_WITH_SUB_AGENT_SUPPORT: ReadonlySet<number> = new Set([1, 2]);

export type WorkTransactionStatus = 'open' | 'completed' | 'abandoned' | 'timed_out';

export interface TransactionRecord {
  readonly featureId: string;
  readonly status: WorkTransactionStatus;
  readonly enteredAt: string;
  readonly closedAt?: string;
  readonly durationMs?: number;
}

export interface OrphanWindow {
  /** ISO timestamp of the prior close (or session start, if first). */
  readonly startedAt: string;
  /** ISO timestamp of the next open (or "now", if still ongoing). */
  readonly endedAt: string;
  readonly durationMs: number;
}

/**
 * Per-open-transaction file diff (0.4.7). Tracks tracked-file changes
 * via `git diff baseRef..HEAD` and classifies them against the work's
 * declared scope. Untracked files are NOT scanned in 0.4.7 — the
 * heuristic favours git-controlled work over scratch experiments.
 */
export interface FileDiffReport {
  readonly featureId: string;
  readonly baseRef: string;
  /** Files inside `work.scope.modules` (prefix-or-exact match). */
  readonly inScope: readonly string[];
  /** Files outside the work scope — Layer-D flags these for caller review. */
  readonly unmapped: readonly string[];
}

/**
 * 0.4.11 PR-B — dispatch_drift report. Flags work_entered events
 * where a Tier 1 / Tier 2 host (native sub-agent support) chose
 * the 'host-self-inject' dispatch mode instead of 'sub-agent'.
 * Non-blocking — the auditor only surfaces the divergence so the
 * orchestrator can decide whether to nudge future dispatches back
 * onto the sub-agent surface.
 *
 * Backward-compat work_entered events (pre-0.4.11, no host/tier
 * fields) are silently omitted from the report — the auditor cannot
 * fabricate dispatch decisions from absent data.
 */
export interface DispatchDriftReport {
  readonly featureId: string;
  readonly enteredAt: string;
  readonly host: string;
  readonly tier: number;
  readonly dispatchMode: string;
  /** Human-readable diagnostic for the orchestrator to surface. */
  readonly reason: string;
}

export interface WorkComplianceReport {
  readonly openTransactions: ReadonlyArray<{
    readonly featureId: string;
    readonly enteredAt: string;
    readonly ageMs: number;
  }>;
  readonly transactions: ReadonlyArray<TransactionRecord>;
  readonly orphanWindows: ReadonlyArray<OrphanWindow>;
  /** Present only when `auditOptions.includeFileDiff === true`. */
  readonly fileDiffs?: ReadonlyArray<FileDiffReport>;
  /**
   * 0.4.11 PR-B — dispatch divergences detected by inspecting
   * work_entered events' host/tier/dispatchMode fields. Empty array
   * when nothing diverged; never undefined so callers can iterate
   * safely.
   */
  readonly dispatchDrifts: ReadonlyArray<DispatchDriftReport>;
  readonly summary: {
    readonly totalEntered: number;
    readonly totalCompleted: number;
    readonly totalAbandoned: number;
    readonly totalTimedOut: number;
    readonly stillOpen: number;
    /** 0.4.11 PR-B — count of dispatchDrifts. */
    readonly dispatchDriftCount: number;
  };
}

export interface AuditOptions {
  readonly cwd?: string;
  /** Only consider events newer than this many ms ago. Default: 24h. */
  readonly sinceMs?: number;
  /** Wall-clock "now" — injectable for deterministic tests. */
  readonly now?: () => number;
  /**
   * Orphan windows shorter than this many ms are ignored as no-ops
   * (gap between automated agent calls). Default: 5_000 (5s).
   */
  readonly orphanThresholdMs?: number;
  /**
   * 0.4.7 — when true, additionally cross-reference every open
   * transaction with `git diff baseRef..HEAD` and classify changed
   * files as in-scope vs unmapped. Requires git available + the
   * cwd to be a git working tree; transactions without baseRef are
   * silently omitted from the file-diff array.
   */
  readonly includeFileDiff?: boolean;
}

/**
 * Reads the event log and produces a Layer-D compliance report.
 * Read-only — never mutates state. Safe to call from any MCP tool
 * handler, hook, or scheduled audit.
 */
export function auditWorkCompliance(opts: AuditOptions = {}): WorkComplianceReport {
  const cwd = opts.cwd ?? '.';
  const sinceMs = opts.sinceMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ? opts.now() : Date.now();
  const orphanThresholdMs = opts.orphanThresholdMs ?? 5_000;
  const cutoff = now - sinceMs;

  const events = readEvents(cwd);
  const workEvents = events
    .filter((e) => WORK_EVENT_TYPES.has(e.type as string))
    .filter((e) => {
      const t = Date.parse(e.timestamp);
      return Number.isFinite(t) && t >= cutoff;
    });

  const transactions = buildTransactions(workEvents);
  const openTransactions = transactions
    .filter((t) => t.status === 'open')
    .map((t) => ({
      featureId: t.featureId,
      enteredAt: t.enteredAt,
      ageMs: now - Date.parse(t.enteredAt),
    }));

  const orphanWindows = buildOrphanWindows(transactions, now, cutoff, orphanThresholdMs);
  const dispatchDrifts = detectDispatchDrifts(workEvents);

  const summary = {
    totalEntered: transactions.length,
    totalCompleted: transactions.filter((t) => t.status === 'completed').length,
    totalAbandoned: transactions.filter((t) => t.status === 'abandoned').length,
    totalTimedOut: transactions.filter((t) => t.status === 'timed_out').length,
    stillOpen: openTransactions.length,
    dispatchDriftCount: dispatchDrifts.length,
  };

  const fileDiffs = opts.includeFileDiff ? collectFileDiffs(cwd) : undefined;

  return {openTransactions, transactions, orphanWindows, fileDiffs, dispatchDrifts, summary};
}

/**
 * Walks `work_entered` events and flags any where the host has native
 * sub-agent support (Tier 1 or Tier 2) but the dispatchMode is
 * 'host-self-inject'. Backward-compat events lacking host/tier/
 * dispatchMode fields are skipped silently.
 */
function detectDispatchDrifts(workEvents: readonly Event[]): DispatchDriftReport[] {
  const out: DispatchDriftReport[] = [];
  for (const e of workEvents) {
    if (e.type !== 'work_entered') continue;
    const payload = e.payload as Record<string, unknown>;
    const host = typeof payload.host === 'string' ? payload.host : undefined;
    const tier = typeof payload.tier === 'number' ? payload.tier : undefined;
    const dispatchMode = typeof payload.dispatchMode === 'string' ? payload.dispatchMode : undefined;
    const feature =
      typeof payload.feature === 'string'
        ? payload.feature
        : typeof payload.featureId === 'string'
          ? payload.featureId
          : undefined;
    if (!host || tier === undefined || !dispatchMode || !feature) continue;
    if (!TIERS_WITH_SUB_AGENT_SUPPORT.has(tier)) continue;
    if (dispatchMode !== 'host-self-inject') continue;
    out.push({
      featureId: feature,
      enteredAt: e.timestamp,
      host,
      tier,
      dispatchMode,
      reason: `Tier ${tier} host (${host}) used host-self-inject instead of native sub-agent dispatch.`,
    });
  }
  return out;
}

/**
 * Cross-references every open transaction's `baseRef` with the
 * current git HEAD via `git diff --name-only`. Returns a per-work
 * classification (in-scope vs unmapped) so the host AI can surface
 * "you edited files outside the active work scope" warnings.
 *
 * Silent fallback when git is missing / cwd is not a git repo /
 * a specific transaction has no baseRef — Layer-D is opt-in and
 * the auditor cannot fabricate diffs from nothing.
 */
function collectFileDiffs(cwd: string): FileDiffReport[] {
  const out: FileDiffReport[] = [];
  for (const work of listActiveWork(cwd)) {
    if (!work.baseRef) continue;
    const result = spawnSync('git', ['diff', '--name-only', work.baseRef, 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.status !== 0) continue;
    const changed = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const {inScope, unmapped} = partitionByScope(changed, work.scope.modules);
    out.push({featureId: work.featureId, baseRef: work.baseRef, inScope, unmapped});
  }
  return out;
}

function partitionByScope(
  files: readonly string[],
  modules: readonly string[],
): {inScope: string[]; unmapped: string[]} {
  const inScope: string[] = [];
  const unmapped: string[] = [];
  for (const file of files) {
    if (isFileInScope(file, modules)) inScope.push(file);
    else unmapped.push(file);
  }
  return {inScope, unmapped};
}

function isFileInScope(file: string, modules: readonly string[]): boolean {
  for (const m of modules) {
    if (!m) continue;
    if (file === m) return true;
    const prefix = m.endsWith('/') ? m : `${m}/`;
    if (file.startsWith(prefix)) return true;
  }
  return false;
}

function buildTransactions(workEvents: readonly Event[]): TransactionRecord[] {
  // Walk events in order, pairing `work_entered` with the next matching
  // `work_completed | _abandoned | _timed_out` for the same featureId.
  const records: TransactionRecord[] = [];
  const open = new Map<string, {enteredAt: string}>();

  for (const e of workEvents) {
    const feature = (e.payload.feature ?? e.payload.featureId) as string | undefined;
    if (!feature) continue;

    if (e.type === 'work_entered') {
      // Re-entry on the same featureId is idempotent in the transaction
      // layer; reflect that here by keeping the first enteredAt.
      if (!open.has(feature)) open.set(feature, {enteredAt: e.timestamp});
      continue;
    }

    const entry = open.get(feature);
    if (!entry) continue; // close without an open — skip silently

    let status: WorkTransactionStatus = 'completed';
    if (e.type === 'work_abandoned') status = 'abandoned';
    else if (e.type === 'work_timed_out') status = 'timed_out';

    const enteredMs = Date.parse(entry.enteredAt);
    const closedMs = Date.parse(e.timestamp);
    records.push({
      featureId: feature,
      status,
      enteredAt: entry.enteredAt,
      closedAt: e.timestamp,
      durationMs: Number.isFinite(enteredMs) && Number.isFinite(closedMs) ? closedMs - enteredMs : undefined,
    });
    open.delete(feature);
  }

  // Whatever is still in `open` after the walk is genuinely open.
  for (const [feature, entry] of open.entries()) {
    records.push({
      featureId: feature,
      status: 'open',
      enteredAt: entry.enteredAt,
    });
  }

  return records;
}

function buildOrphanWindows(
  transactions: readonly TransactionRecord[],
  now: number,
  cutoff: number,
  thresholdMs: number,
): OrphanWindow[] {
  // Sort transactions by enteredAt to walk in chronological order.
  const sorted = [...transactions].sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt));
  const windows: OrphanWindow[] = [];

  let cursor = cutoff;
  for (const t of sorted) {
    const enteredMs = Date.parse(t.enteredAt);
    if (Number.isFinite(enteredMs) && enteredMs - cursor >= thresholdMs) {
      windows.push({
        startedAt: new Date(cursor).toISOString(),
        endedAt: t.enteredAt,
        durationMs: enteredMs - cursor,
      });
    }
    // Advance cursor past this transaction's close (or to its enter
    // time if still open).
    if (t.status === 'open') {
      cursor = Math.max(cursor, enteredMs);
    } else if (t.closedAt) {
      const closedMs = Date.parse(t.closedAt);
      if (Number.isFinite(closedMs)) cursor = Math.max(cursor, closedMs);
    }
  }

  // Trailing window — from the last close to now.
  if (now - cursor >= thresholdMs) {
    windows.push({
      startedAt: new Date(cursor).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: now - cursor,
    });
  }

  return windows;
}
