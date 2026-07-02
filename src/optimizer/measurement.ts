// Cladding · optimizer · graph efficiency measurement — F-16138071
//
// The graph tooling's GOAL is search-efficiency + context-efficiency + stable dev at scale —
// NOT making an agent "smarter". Four correctness-framed A/Bs returned NULL, but correctness
// was never the goal. This measures what the goal actually is, DETERMINISTICALLY (no agent, no
// test run, no NULL risk): for every feature, what does the graph hand you FOR FREE vs what you
// would have to search/read by hand to reconstruct the same working context?
//
//   • CONTEXT EFFICIENCY — working-set tokens vs the naive baseline (the feature shard + the
//     full text of all its module files, which is what you'd load without the slice). The ratio
//     is the context the slice saves you.
//   • SEARCH EFFICIENCY — the dependency depth + edge count the graph resolves for you (each hop
//     is a "find all dependents" round an agent would otherwise grep by hand).
//   • STABILITY / REGRESSION-SET QUALITY — the iterative slice's stop reason + coverage: how
//     much of the true blast radius the surfaced regression set covers, and how honestly it
//     reports partial coverage.
//
// Pure given (spec, file reader). Reuses buildWorkingSet / buildIterativeImpactSlice /
// reverseIndexOf / estTokens — no new graph algorithm. The reader is injected (impure I/O stays
// out, like code-excerpt.ts), so this is headless-testable.
//
// HONEST SCOPE: this is the efficiency the infrastructure CAN provide (an upper bound vs one
// naive baseline) — NOT proof that a strong agent adopts it (the A/Bs show strong agents grep
// anyway). It answers "what does the graph give you", not "does the agent use it".

import {estTokens} from './code-excerpt.js';
import {buildIterativeImpactSlice} from './iterative-slice.js';
import {buildWorkingSet} from './working-set.js';
import {reverseIndexOf} from '../spec/reverse-index.js';
import type {Spec} from '../spec/types.js';

/**
 * The single source of the honest-scope caveat every measure surface must carry
 * (the CLI report block AND the persisted-ledger trend). Exported so neither
 * copy can drift from the other — a trend that drops this caveat becomes the
 * stale-claim factory F-39609db4 exists to prevent.
 */
export const MEASUREMENT_DISCLAIMER =
  '(deterministic upper bound vs the shard+all-modules baseline — not an agent-adoption measurement)';

export type ModuleReader = (path: string) => string | null;

export interface FeatureEfficiency {
  readonly id: string;
  /** working-set payload tokens (what the slice hands you, at the default budget). */
  readonly sliceTokens: number;
  /** working-set payload tokens with the budget lifted — the STRUCTURAL slice size. */
  readonly structuralTokens: number;
  /** naive baseline tokens: the shard + the full text of every module file. */
  readonly naiveTokens: number;
  /** sliceTokens / naiveTokens — < 1 means the slice is smaller (the context it saves). */
  readonly contextRatio: number;
  /** True when the default budget truncated anything — the shrink is then CAP-DRIVEN. */
  readonly budgetSaturated: boolean;
  /** hops the iterative slice expanded (≈ grep rounds to reconstruct the radius by hand). */
  readonly searchDepth: number;
  /** forward depends_on + backward dependents the graph resolves for you. */
  readonly edgesResolved: number;
  /** iterative stop reason — coverage = confident, marginal-yield/max-depth = honest partial. */
  readonly stoppedBy: string;
  /** fraction of the true transitive blast radius the surfaced regression set covers (0..1);
   *  null when zero dependents are known (no denominator — F-c6a32fff honesty contract). */
  readonly coverage: number | null;
  /** count of regression tests the slice hands you to run. */
  readonly regressionTests: number;
}

export interface EfficiencyReport {
  readonly featureCount: number;
  readonly measured: number; // features that resolved (not miss)
  readonly context: {
    /** median sliceTokens / naiveTokens across measured features (< 1 = smaller). */
    readonly medianContextRatio: number;
    /**
     * median naive / slice at the default budget. HONEST ATTRIBUTION: when
     * `truncatedCount` > 0 this number is largely the BUDGET CAP doing the
     * shrinking, not the graph — read it as "the budget enforces this
     * reduction", and read `medianStructuralRatio` for what the slice
     * structurally is without a cap.
     */
    readonly medianShrinkFactor: number;
    /** features whose working set fit the default budget untouched. */
    readonly fitsCount: number;
    /** features the default budget truncated (code/needs/breaks clipped) — cap-driven shrink. */
    readonly truncatedCount: number;
    /** median naive/slice over fitting features only (the graph's own shrink). */
    readonly medianShrinkFit: number;
    /** median naive/slice over truncated features only (cap arithmetic, labeled as such). */
    readonly medianShrinkTruncated: number;
    /** median structuralTokens / naiveTokens — the uncapped slice vs naive (≈0.9 on cladding-self:
     *  the slice is the code PLUS structured metadata; its value is the bounded budget + the
     *  needs/breaks/verify wiring, NOT raw byte shrink). */
    readonly medianStructuralRatio: number;
    readonly medianSliceTokens: number;
    readonly medianNaiveTokens: number;
  };
  readonly search: {
    readonly medianDepth: number;
    readonly p95Depth: number;
    readonly medianEdges: number;
    readonly maxEdges: number;
  };
  readonly stability: {
    readonly byStopReason: Readonly<Record<string, number>>;
    readonly medianCoverage: number;
    readonly medianRegressionTests: number;
  };
  /** Per-feature rows (deterministically sorted by id) — for drill-down / audit. */
  readonly features: readonly FeatureEfficiency[];
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/**
 * Measures the search/context/stability efficiency the graph provides for every feature.
 * Deterministic given identical spec + file contents.
 */
export function measureGraphEfficiency(spec: Spec, read: ModuleReader, cwd = '.'): EfficiencyReport {
  const ri = reverseIndexOf(spec);
  const features = spec.features ?? [];
  const rows: FeatureEfficiency[] = [];

  for (const f of features) {
    // The injected reader feeds BOTH sides — slice and baseline read the same universe
    // (before this, buildWorkingSet read the real fs while the baseline read `read`,
    // so any virtual universe silently inflated the shrink factor).
    const ws = buildWorkingSet(spec, f.id, {cwd, read});
    if ('not_found' in ws) continue;
    const structural = buildWorkingSet(spec, f.id, {cwd, read, maxTokens: Number.MAX_SAFE_INTEGER});
    const it = buildIterativeImpactSlice(spec, f.id);
    const itOk = !('not_found' in it);

    // slice tokens = the assembled working-set payload.
    const sliceTokens = estTokens(JSON.stringify(ws));
    const structuralTokens = 'not_found' in structural ? sliceTokens : estTokens(JSON.stringify(structural));
    // naive baseline = the shard object + the full text of every module file.
    let naive = estTokens(JSON.stringify(f));
    for (const m of f.modules ?? []) {
      const src = read(m);
      if (src) naive += estTokens(src);
    }
    const forward = (f.depends_on ?? []).length;
    const backward = ri.dependents.get(f.id)?.size ?? 0;

    rows.push({
      id: f.id,
      sliceTokens,
      structuralTokens,
      naiveTokens: naive,
      contextRatio: naive > 0 ? sliceTokens / naive : 1,
      budgetSaturated: ws.budget.truncated.length > 0,
      searchDepth: itOk ? it.depthUsed : 1,
      edgesResolved: forward + backward,
      stoppedBy: itOk ? it.stoppedBy : 'n/a',
      coverage: itOk ? it.analysis.coverage : 1,
      regressionTests: ws.breaks_if_changed.regression_tests.length,
    });
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  const ratios = rows.map((r) => r.contextRatio);
  const shrinkOf = (rs: readonly FeatureEfficiency[]): number[] =>
    rs.filter((r) => r.sliceTokens > 0).map((r) => r.naiveTokens / r.sliceTokens);
  const fits = rows.filter((r) => !r.budgetSaturated);
  const capped = rows.filter((r) => r.budgetSaturated);
  const structuralRatios = rows
    .filter((r) => r.naiveTokens > 0)
    .map((r) => r.structuralTokens / r.naiveTokens);
  const byStop: Record<string, number> = {};
  for (const r of rows) byStop[r.stoppedBy] = (byStop[r.stoppedBy] ?? 0) + 1;

  return {
    featureCount: features.length,
    measured: rows.length,
    context: {
      medianContextRatio: Math.round(median(ratios) * 1000) / 1000,
      medianShrinkFactor: Math.round(median(shrinkOf(rows)) * 10) / 10,
      fitsCount: fits.length,
      truncatedCount: capped.length,
      medianShrinkFit: Math.round(median(shrinkOf(fits)) * 10) / 10,
      medianShrinkTruncated: Math.round(median(shrinkOf(capped)) * 10) / 10,
      medianStructuralRatio: Math.round(median(structuralRatios) * 100) / 100,
      medianSliceTokens: Math.round(median(rows.map((r) => r.sliceTokens))),
      medianNaiveTokens: Math.round(median(rows.map((r) => r.naiveTokens))),
    },
    search: {
      medianDepth: median(rows.map((r) => r.searchDepth)),
      p95Depth: percentile(rows.map((r) => r.searchDepth), 95),
      medianEdges: median(rows.map((r) => r.edgesResolved)),
      maxEdges: rows.reduce((m, r) => Math.max(m, r.edgesResolved), 0),
    },
    stability: {
      byStopReason: byStop,
      // Null coverages (no-known-dependents — no denominator) are excluded, not counted as 0/1.
      medianCoverage:
        Math.round(median(rows.map((r) => r.coverage).filter((c): c is number => c !== null)) * 100) / 100,
      medianRegressionTests: median(rows.map((r) => r.regressionTests)),
    },
    features: rows,
  };
}
