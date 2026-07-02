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
