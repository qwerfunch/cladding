// Cladding · `clad measure --sessions` / `--trend` internals — value-delivery,
// B1 adoption and trend renderers extracted from clad.ts (F-1e9ef827).
//
// runMeasureCommand stays in clad.ts as the thin command wrapper (~40 shards bind
// clad.ts as the measure feature's module, so moving the exported surface would
// ripple across spec shards); these three cohesive internal renderers move here with
// zero shard edits. Output is byte-identical to the pre-extraction clad.ts.

import process from 'node:process';

import {readEvents, readEventsIncludingRolled} from '../events/log.js';
import {B1_ADOPTION_THRESHOLDS, summarizeAdoption, summarizeValueDelivery, type AdoptionSummary, type AdoptionVerdict} from '../events/session-report.js';
import {readMeasureSnapshots, renderTrend} from '../optimizer/measure-ledger.js';

/**
 * `clad measure --sessions` (F-6ba22c5c) — summarize the recorded value-delivery
 * telemetry: impact-card fire rate over eligible edits, the per-reason skip histogram,
 * and MCP read-serve counts. HONEST FRAMING: this measures DELIVERY (whether the value
 * surfaces produced output), NEVER adoption (whether the agent then used them). Zero
 * value-delivery events prints an honest can't-distinguish message and exits 0 — absence
 * of telemetry must never render as 0% value nor as success.
 */
export function runSessionsMeasure(opts: {json?: boolean}): void {
  let events;
  try {
    events = readEvents('.');
  } catch {
    events = []; // unreadable/corrupt ledger → treat as no telemetry (never crash the report)
  }
  const summary = summarizeValueDelivery(events);
  // The B1 adoption verdict (F-1e7a10c3) reads the ROLLED generation too — a recent
  // rotation must not drop completed cycles from view — and is gated ONLY on
  // hasSignal, NEVER on summary.total. A cycles-only ledger (CLI usage, value lane
  // silent/unwired) has total 0 yet hasSignal true, and is the strongest
  // non-adoption evidence, so it must render alongside the SILENT/UNWIRED note.
  let adoption: AdoptionSummary;
  try {
    adoption = summarizeAdoption(readEventsIncludingRolled('.'));
  } catch {
    adoption = summarizeAdoption([]); // unreadable ledger → no adoption signal
  }
  if (opts.json) {
    // Additive `adoption` key (always present); every existing summary key stays byte-stable.
    process.stdout.write(`${JSON.stringify({...summary, adoption}, null, 2)}\n`);
    process.exit(0);
    return;
  }
  const adoptionLines = adoption.hasSignal ? renderAdoptionSection(adoption) : [];
  if (summary.total === 0) {
    process.stdout.write(
      'no value-delivery telemetry was recorded — the value surfaces (impact card, session card, ' +
        'prompt suggestion, MCP working-set serves) may simply be SILENT this session, OR their emission ' +
        'may be UNWIRED. These two cases are indistinguishable from an empty ledger.\n',
    );
    // Co-render the adoption verdict when cycles ran but the value lane stayed silent
    // (AC-95686e07): the SILENT/UNWIRED note above is byte-identical, the section follows.
    if (adoptionLines.length > 0) process.stdout.write(`${adoptionLines.join('\n')}\n`);
    process.exit(0);
    return;
  }
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const suppressedTotal = summary.suppressed.dedup + summary.suppressed.ledger_exhausted;
  const lines = [
    'value delivery — measures whether cladding’s surfaces FIRED, not whether the agent ADOPTED them',
    `  impact card: ${summary.fired} fired / ${summary.eligible} eligible edit(s) = ${pct(summary.firedPct)} fired`,
    `  skips by reason: ${JSON.stringify(summary.byReason)}`,
    // Push-governor withholdings (F-35954d19) are deliberate, so they get their own
    // line instead of deflating the fired% denominator.
    ...(suppressedTotal > 0
      ? [`  suppressed by design: ${summary.suppressed.dedup} dedup, ${summary.suppressed.ledger_exhausted} budget-exhausted (excluded from eligible)`]
      : []),
    `  MCP serves: ${summary.servedWorkingSets} read-serve(s) ${JSON.stringify(summary.servedByTool)} · ${pct(summary.truncationRate)} truncated`,
    `  other surfaces: ${summary.sessionCards} session card(s), ${summary.promptSuggestions} prompt suggestion(s)`,
    '  (eligible = fired + substantive skips; not_write_tool / unwatched_path noise and by-design suppressions excluded)',
  ];
  // A value-delivery ledger always carries adoption signal (every counted event type
  // sets hasSignal), so the section renders here too — delivery first, then adoption.
  process.stdout.write(`${[...lines, ...adoptionLines].join('\n')}\n`);
  process.exit(0);
}

/**
 * The B1 adoption section for `clad measure --sessions` (F-1e7a10c3) — renders the
 * pull-vs-push verdict in the SAME visual register as the value-delivery summary above
 * (a column-0 header, then 2-space-indented `label: value` lines). At most 8 lines: the
 * unmet-gate line is omitted when reasons is empty (a confirmed verdict). PULL (a resolved
 * MCP read-serve) is the only adoption signal; the pushes cladding sent never raise a
 * number, so the section reads WHY the verdict landed where it did.
 */
function renderAdoptionSection(a: AdoptionSummary): string[] {
  const T = B1_ADOPTION_THRESHOLDS;
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const verdictLabel: Record<AdoptionVerdict, string> = {
    confirmed: 'confirmed',
    not_confirmed: 'not confirmed',
    insufficient_data: 'insufficient data',
  };
  const lines = [
    'adoption — did an agent CHOOSE to pull context, not just receive what cladding pushed',
    `  verdict: ${verdictLabel[a.verdict]}`,
    `  completed cycles: ${a.completedCycles} (min ${T.minCompletedCycles} to judge)`,
    `  pulls: ${a.pullsTotal} resolved read-serve(s) ${JSON.stringify(a.pullsByTool)} (threshold ${T.minPulls}; pushes never counted)`,
    `  cycle-pull rate: ${a.cyclesWithPull}/${a.completedCycles} = ${pct(a.cyclePullRate)} (threshold ${pct(T.minCyclePullRate)})`,
    `  distinct heads: ${a.distinctHeads} (threshold ${T.minDistinctHeads})`,
  ];
  if (a.reasons.length > 0) lines.push(`  unmet: ${a.reasons.join(', ')}`);
  return lines;
}

/**
 * `clad measure --trend [n]` (F-39609db4) — render the last N (default 5)
 * recorded snapshots with signed deltas so a regression/improvement over time is
 * visible without re-reading raw stdout. With <2 snapshots there is no delta to
 * show: state how many exist and exit 0, never fabricating one (AC-220944e2).
 */
export function runTrendMeasure(opts: {json?: boolean; trend?: boolean | string}): void {
  let snapshots;
  try {
    snapshots = readMeasureSnapshots('.');
  } catch {
    snapshots = []; // unreadable/corrupt ledger → treat as no history (never crash)
  }
  const n = typeof opts.trend === 'string' && Number.isFinite(Number(opts.trend)) ? Number(opts.trend) : 5;
  const window = Math.max(1, Math.floor(n));
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(snapshots.slice(-window), null, 2)}\n`);
    process.exit(0);
    return;
  }
  if (snapshots.length < 2) {
    process.stdout.write(`no trend yet — ${snapshots.length} snapshot(s) recorded\n`);
    process.exit(0);
    return;
  }
  process.stdout.write(`${renderTrend(snapshots, window)}\n`);
  process.exit(0);
}
