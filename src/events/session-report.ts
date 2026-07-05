// Cladding · events · value-delivery summary — F-6ba22c5c
//
// A PURE reducer over the event ledger (no I/O) that answers ONE honest
// question: did cladding's value surfaces actually FIRE? The 0.7.1 "impact
// card fired 0%" bug was invisible because the surfaces left no trace; this
// turns the recorded fired/skipped/served telemetry into a fire-rate.
//
// HONEST FRAMING: this measures DELIVERY (whether a surface produced output),
// never ADOPTION (whether the agent then used it). Adoption claims were
// falsified by A/B; delivery is what the ledger can support.
//
// eligible = fired + skips EXCLUDING the aggregated high-frequency reasons
// (not_write_tool / unwatched_path — non-source-edit noise) AND the push
// governor's by-design suppressions (dedup / ledger_exhausted — a card that
// WOULD have fired but was intentionally withheld, F-35954d19). Counting
// either as a missed card would deflate the fire-rate dishonestly.

import type {Event} from './log.js';

/** The two skip reasons aggregated across a debounce window (AC-8fc6bea0). They
 * are non-source-edit noise, so they never contribute to the eligible denominator. */
const AGGREGATED_REASONS: ReadonlySet<string> = new Set(['not_write_tool', 'unwatched_path']);

/** The push governor's by-design suppressions (F-35954d19): dedup (repeated
 * (focus,file) fingerprint) and ledger_exhausted (session push budget). Excluded
 * from eligible — they are deliberate withholdings, not missed fires — and
 * surfaced separately via the `suppressed` field so they stay visible. */
const SUPPRESSED_REASONS: ReadonlySet<string> = new Set(['dedup', 'ledger_exhausted']);

export interface ValueDeliverySummary {
  /** Impact cards that produced output. */
  readonly fired: number;
  /** All skip occurrences (aggregate counts expanded). */
  readonly skipped: number;
  /** Per-reason skip histogram (aggregates expand into their per-reason counts). */
  readonly byReason: Readonly<Record<string, number>>;
  /** fired + substantive skips (excludes not_write_tool / unwatched_path noise
   *  AND the by-design suppressions dedup / ledger_exhausted). */
  readonly eligible: number;
  /** Push-governor suppressions by design (F-35954d19) — withheld, not missed. */
  readonly suppressed: {readonly dedup: number; readonly ledger_exhausted: number};
  /** fired / eligible, rounded to 3dp; 0 when eligible is 0 (never NaN). */
  readonly firedPct: number;
  /** MCP read-tool serves (working-set / context / impact). */
  readonly servedWorkingSets: number;
  /** Serves grouped by MCP tool name. */
  readonly servedByTool: Readonly<Record<string, number>>;
  /** truncated serves / resolved serves, rounded to 3dp; 0 when none resolved. */
  readonly truncationRate: number;
  /** SessionStart cards rendered (non-empty). */
  readonly sessionCards: number;
  /** UserPromptSubmit suggestions served (non-empty). */
  readonly promptSuggestions: number;
  /** Total value-delivery events considered — 0 means the ledger carries none. */
  readonly total: number;
}

/**
 * Reduces an event stream to the value-delivery summary. Pure and deterministic:
 * identical input events yield an identical summary. Unknown/legacy event types
 * are ignored; malformed payload fields degrade to safe defaults rather than throw.
 */
export function summarizeValueDelivery(events: readonly Event[]): ValueDeliverySummary {
  let fired = 0;
  let skipped = 0;
  let eligibleSkips = 0;
  let servedWorkingSets = 0;
  let servedResolved = 0;
  let servedTruncated = 0;
  let sessionCards = 0;
  let promptSuggestions = 0;
  const byReason: Record<string, number> = {};
  const servedByTool: Record<string, number> = {};
  const suppressed = {dedup: 0, ledger_exhausted: 0};

  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case 'impact_card_fired':
        fired++;
        break;
      case 'impact_card_skipped': {
        // Aggregate flush (AC-8fc6bea0): one event carries per-reason counts for
        // the two high-frequency reasons. Expand into the histogram; never eligible.
        if (p.aggregate === true && p.counts && typeof p.counts === 'object') {
          const counts = p.counts as Record<string, unknown>;
          for (const reason of AGGREGATED_REASONS) {
            const n = Number(counts[reason]);
            if (Number.isFinite(n) && n > 0) {
              byReason[reason] = (byReason[reason] ?? 0) + n;
              skipped += n;
            }
          }
          break;
        }
        const reason = typeof p.reason === 'string' ? p.reason : 'unknown';
        byReason[reason] = (byReason[reason] ?? 0) + 1;
        skipped += 1;
        if (reason === 'dedup') suppressed.dedup += 1;
        else if (reason === 'ledger_exhausted') suppressed.ledger_exhausted += 1;
        if (!AGGREGATED_REASONS.has(reason) && !SUPPRESSED_REASONS.has(reason)) eligibleSkips += 1;
        break;
      }
      case 'working_set_served': {
        servedWorkingSets++;
        const tool = typeof p.tool === 'string' ? p.tool : 'unknown';
        servedByTool[tool] = (servedByTool[tool] ?? 0) + 1;
        if (p.resolved === true) {
          servedResolved++;
          if (p.truncated === true) servedTruncated++;
        }
        break;
      }
      case 'session_card_rendered':
        sessionCards++;
        break;
      case 'prompt_suggestion_served':
        promptSuggestions++;
        break;
      default:
        break; // non-value-delivery events (stage_started, gate_run, …) ignored
    }
  }

  const eligible = fired + eligibleSkips;
  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const firedPct = eligible > 0 ? round3(fired / eligible) : 0;
  const truncationRate = servedResolved > 0 ? round3(servedTruncated / servedResolved) : 0;
  const total = fired + skipped + servedWorkingSets + sessionCards + promptSuggestions;

  return {
    fired,
    skipped,
    byReason,
    eligible,
    suppressed,
    firedPct,
    servedWorkingSets,
    servedByTool,
    truncationRate,
    sessionCards,
    promptSuggestions,
    total,
  };
}

// --- Adoption reducer (F-0023ba22) -----------------------------------------
//
// summarizeValueDelivery above answers "did a surface FIRE?" (delivery). This
// answers the harder, adversarially-guarded question the B1 backlog item
// (deprecate clad_get_context) is gated on: "did an agent CHOOSE to pull?"
// (adoption). The guard against vacuous confirmation is the pull/push split:
//
//   PULL = a resolved working_set_served — an agent asked an MCP read tool for
//          context and got a real slice back. This is the ONLY adoption signal.
//   PUSH = impact_card_fired / impact_card_skipped / session_card_rendered /
//          prompt_suggestion_served — hook-fired delivery. It proves cladding
//          spoke, NOT that the agent listened, so it can never raise an adoption
//          number or the verdict (AC-3362d108). The exclusion is STRUCTURAL: the
//          push types below feed only the hasSignal flag; their payloads are
//          never read for any adoption count.

/** Three-valued adoption verdict. `insufficient_data` when the ledger is too
 *  thin to judge (no signal, or fewer than the minimum completed cycles). */
export type AdoptionVerdict = 'confirmed' | 'not_confirmed' | 'insufficient_data';

/**
 * B1 confirmation thresholds (F-0023ba22 AC-b200151f). Plain constants so they
 * are trivially adjustable before release; the B1 protocol doc cites these exact
 * values. EVERY one must clear for a `confirmed` verdict — a single accidental
 * call or a push-only ledger falls short of all four.
 */
export const B1_ADOPTION_THRESHOLDS = {
  /** Kept `clad done` flips required before adoption is even judgeable. */
  minCompletedCycles: 3,
  /** Resolved pull serves across the whole ledger. */
  minPulls: 10,
  /** Fraction of completed cycles whose window contained ≥1 pull. */
  minCyclePullRate: 0.6,
  /** Distinct git HEADs across pulls + dones — one busy session can't confirm. */
  minDistinctHeads: 3,
} as const;

export interface AdoptionSummary {
  /** The ledger carries at least one completed cycle or value-delivery event, so
   *  a verdict is computable. Derived structurally from event types present —
   *  NEVER from ValueDeliverySummary.total (AC-0d7273dd). */
  readonly hasSignal: boolean;
  /** done_attempted events that kept the flip (payload.kept === true). */
  readonly completedCycles: number;
  /** Resolved working_set_served serves (pushes never counted). */
  readonly pullsTotal: number;
  /** Resolved serves grouped by MCP tool name. */
  readonly pullsByTool: Readonly<Record<string, number>>;
  /** Completed cycles whose [start..done] window contained ≥1 pull. */
  readonly cyclesWithPull: number;
  /** cyclesWithPull / completedCycles, rounded to 3dp; 0 when no cycles (never NaN). */
  readonly cyclePullRate: number;
  /** Distinct git HEADs across pull + done_attempted events (real work states). */
  readonly distinctHeads: number;
  readonly verdict: AdoptionVerdict;
  /** Machine-readable names of every unmet gate; empty iff verdict is confirmed. */
  readonly reasons: readonly string[];
}

/**
 * Reduces an event stream to the B1 adoption verdict. PURE, DETERMINISTIC, and
 * NEVER THROWS: identical input yields an identical summary; malformed payload
 * fields and unparseable timestamps degrade to safe defaults.
 *
 * COMPLETED CYCLE — a done_attempted whose payload.kept === true (done.ts emits
 * `kept: worst === 0`, so this is a flip the pre-push gate let stand). Its window
 * is [start .. done timestamp], where start is the nearest prior feature_created
 * for the same feature id, or — when none is recorded (the shard predates this
 * ledger generation) — the earliest event timestamp, a session-start anchor. A
 * cycle "has a pull" when a resolved serve's timestamp falls inside that window
 * (bounds inclusive, so a same-instant serve still counts).
 */
export function summarizeAdoption(events: readonly Event[]): AdoptionSummary {
  const T = B1_ADOPTION_THRESHOLDS;
  const parseTs = (e: Event): number => Date.parse(e.timestamp);

  // Session-start anchor for completed cycles with no matching feature_created.
  let earliest = Number.POSITIVE_INFINITY;
  for (const e of events) {
    const t = parseTs(e);
    if (Number.isFinite(t) && t < earliest) earliest = t;
  }

  const pullTimes: number[] = [];
  const pullsByTool: Record<string, number> = {};
  let pullsTotal = 0;
  const createdByFeature = new Map<string, number[]>();
  const cycleWindows: {feature?: string; end: number}[] = [];
  const heads = new Set<string>();
  let hasSignal = false;

  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case 'working_set_served': {
        hasSignal = true; // any serve is value-delivery signal, even an unresolved miss
        if (p.resolved === true) {
          const tool = typeof p.tool === 'string' ? p.tool : 'unknown';
          pullTimes.push(parseTs(e));
          pullsByTool[tool] = (pullsByTool[tool] ?? 0) + 1;
          pullsTotal++;
          if (typeof p.head === 'string') heads.add(p.head);
        }
        break;
      }
      case 'feature_created': {
        hasSignal = true;
        const fid = typeof p.feature === 'string' ? p.feature : undefined;
        const t = parseTs(e);
        if (fid && Number.isFinite(t)) {
          const arr = createdByFeature.get(fid);
          if (arr) arr.push(t);
          else createdByFeature.set(fid, [t]);
        }
        break;
      }
      case 'done_attempted': {
        hasSignal = true;
        if (typeof p.head === 'string') heads.add(p.head);
        if (p.kept === true) {
          cycleWindows.push({feature: typeof p.feature === 'string' ? p.feature : undefined, end: parseTs(e)});
        }
        break;
      }
      // PUSH surfaces — signal only, never an adoption number (AC-3362d108).
      case 'impact_card_fired':
      case 'impact_card_skipped':
      case 'session_card_rendered':
      case 'prompt_suggestion_served':
        hasSignal = true;
        break;
      default:
        break; // pre-0.8 / non-signal events (stage_started, gate_run, scenario_created, …)
    }
  }

  const completedCycles = cycleWindows.length;
  let cyclesWithPull = 0;
  for (const cyc of cycleWindows) {
    const end = cyc.end;
    let start = Number.isFinite(earliest) ? earliest : end;
    if (cyc.feature) {
      const created = createdByFeature.get(cyc.feature);
      if (created) {
        let best = Number.NEGATIVE_INFINITY;
        for (const c of created) if (c <= end && c > best) best = c;
        if (Number.isFinite(best)) start = best;
      }
    }
    if (pullTimes.some((t) => Number.isFinite(t) && t >= start && t <= end)) cyclesWithPull++;
  }

  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const cyclePullRate = completedCycles > 0 ? round3(cyclesWithPull / completedCycles) : 0;
  const distinctHeads = heads.size;

  // reasons name every unmet gate (empty iff confirmed); the verdict then reads
  // straight off them. The rate gate uses the rounded rate so the reported number
  // and the decision can never disagree.
  const reasons: string[] = [];
  if (!hasSignal) reasons.push('no_signal');
  if (completedCycles < T.minCompletedCycles) reasons.push('insufficient_cycles');
  if (pullsTotal < T.minPulls) reasons.push('insufficient_pulls');
  if (cyclePullRate < T.minCyclePullRate) reasons.push('low_cycle_pull_rate');
  if (distinctHeads < T.minDistinctHeads) reasons.push('insufficient_distinct_heads');

  let verdict: AdoptionVerdict;
  if (!hasSignal || completedCycles < T.minCompletedCycles) {
    verdict = 'insufficient_data';
  } else if (pullsTotal >= T.minPulls && cyclePullRate >= T.minCyclePullRate && distinctHeads >= T.minDistinctHeads) {
    verdict = 'confirmed';
  } else {
    verdict = 'not_confirmed';
  }

  return {hasSignal, completedCycles, pullsTotal, pullsByTool, cyclesWithPull, cyclePullRate, distinctHeads, verdict, reasons};
}
