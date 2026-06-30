// Cladding · optimizer · iterative graph-anchored impact slice — F-96250595
//
// The fixed-depth impact slice (buildImpactSlice depth=1) has a real flaw: a feature whose
// breakage reaches a 2nd-hop dependent is under-reported at depth 1 (a "narrow miss"). This
// wraps buildImpactSlice in a SEED → WIDEN → STOP loop: start at depth 1, and expand the
// radius hop-by-hop until a DETERMINISTIC sufficiency criterion is met — then report WHY it
// stopped (`stoppedBy`) and HOW MUCH of the known blast radius it covers (`coverage`). The
// caller never has to blindly trust a fixed bound: the expansion is self-justifying and the
// result is self-describing.
//
// Pure + deterministic (no LLM, no test execution, no fs beyond what buildImpactSlice/spec
// already use): every stop criterion is a graph query over the spec's reverse-index.
//
// Stop criteria + DEFAULTS were calibrated on cladding-self (522 queries, two simulation
// rounds), NOT guessed: the originally-proposed 'target-nodes' default fired at depth 1
// everywhere (test_refs ride along immediately) → it reproduced the fixed-depth behavior and
// stopped at ~50% coverage (false completeness). coverage(0.9) + marginal-yield(0.05) +
// exhaustion is what actually widens on narrow-misses, stops instantly when already complete,
// and degrades to an HONEST partial-coverage stop on cladding's large fan-out hubs (where no
// depth yields ≥90% — there, "report 79%, stop at diminishing returns" is the correct move).

import {buildImpactSlice, collectDependents, type ImpactLookupMiss, type ImpactSlice} from './reverse-slice.js';
import {reverseIndexOf} from '../spec/reverse-index.js';
import type {Spec} from '../spec/types.js';

export type StopReason = 'exhaustion' | 'coverage' | 'marginal-yield' | 'max-depth';

export interface IterativeImpactOptions {
  readonly initialDepth?: number;
  readonly maxDepth?: number;
  /** Stop once the radius covers this fraction of ALL known transitive dependents (default 0.9). */
  readonly coverageThreshold?: number;
  /** Stop after two consecutive hops each add < this fraction of new nodes (default 0.05). */
  readonly marginYieldThreshold?: number;
}

export interface IterativeImpactResult {
  /** The impact slice at the depth where iteration stopped. */
  readonly slice: ImpactSlice;
  /** Depth (hops) the radius was expanded to. */
  readonly depthUsed: number;
  /** Which deterministic criterion ended the expansion. */
  readonly stoppedBy: StopReason;
  /** Self-describing sufficiency signals — the caller decides whether to trust or widen further. */
  readonly analysis: {
    /** The k-th ring added 0 new dependents → the reachable graph boundary was hit. */
    readonly frontierExhausted: boolean;
    /** Fraction of all known transitive dependents now in the radius (0..1). */
    readonly coverage: number;
    /** New-node fraction per hop: [yield@d1, yield@d2, …] — the expansion curve. */
    readonly marginalYields: readonly number[];
    /** Total transitive dependents reachable at unbounded depth (the coverage denominator). */
    readonly totalKnownDependents: number;
  };
}

const DEFAULTS = {initialDepth: 1, maxDepth: 10, coverageThreshold: 0.9, marginYieldThreshold: 0.05};

/** Count of impacted dependents in a slice (0 for a module-with-no-dependents). */
function impactedCount(slice: ImpactSlice): number {
  return slice.impacted.length;
}

/**
 * Expands the impact radius from `initialDepth` outward, stopping at the first depth where a
 * deterministic sufficiency criterion holds. Returns the slice at that depth plus the analysis
 * that justifies the stop. Same not_found contract as buildImpactSlice on an unresolved query.
 */
export function buildIterativeImpactSlice(
  spec: Spec,
  query: string,
  opts: IterativeImpactOptions = {},
): IterativeImpactResult | ImpactLookupMiss {
  const initialDepth = opts.initialDepth ?? DEFAULTS.initialDepth;
  const maxDepth = opts.maxDepth ?? DEFAULTS.maxDepth;
  const covT = opts.coverageThreshold ?? DEFAULTS.coverageThreshold;
  const margT = opts.marginYieldThreshold ?? DEFAULTS.marginYieldThreshold;

  // Resolve once + establish the coverage denominator (all reachable dependents, unbounded).
  const ri = reverseIndexOf(spec);
  const byId = new Map((spec.features ?? []).map((f) => [f.id, f]));
  let seedIds: string[] = [];
  const direct = (spec.features ?? []).find((f) => f.id === query || (f as {slug?: string}).slug === query);
  if (direct) seedIds = [direct.id];
  else {
    const owners = ri.moduleOwners.get(query);
    if (owners && owners.size > 0) seedIds = [...owners].filter((id): id is string => byId.has(id));
  }
  if (seedIds.length === 0) {
    // Delegate the canonical miss shape to buildImpactSlice (single source of truth).
    const miss = buildImpactSlice(spec, query, {depth: 1});
    return 'not_found' in miss ? miss : (miss as never);
  }
  const totalKnown = collectDependents(seedIds, ri.dependents, Infinity).size;

  const yields: number[] = [];
  let prevCount = 0;
  let lastSlice: ImpactSlice | null = null;

  for (let depth = initialDepth; depth <= maxDepth; depth++) {
    const slice = buildImpactSlice(spec, query, {depth});
    if ('not_found' in slice) return slice; // defensive; resolution already succeeded
    lastSlice = slice;
    const n = impactedCount(slice);
    const added = n - prevCount;
    const marginalYield = n > 0 ? added / n : 0;
    yields.push(marginalYield);
    const coverage = totalKnown > 0 ? n / totalKnown : 1;
    const frontierExhausted = added === 0 && depth > initialDepth;

    const analysis = {frontierExhausted, coverage, marginalYields: [...yields], totalKnownDependents: totalKnown};

    // Stop checks (deterministic; order = which reason is reported when several hold at once).
    if (frontierExhausted) return {slice, depthUsed: depth, stoppedBy: 'exhaustion', analysis};
    if (coverage >= covT) return {slice, depthUsed: depth, stoppedBy: 'coverage', analysis};
    if (yields.length >= 2 && yields[yields.length - 1] < margT && yields[yields.length - 2] < margT) {
      return {slice, depthUsed: depth, stoppedBy: 'marginal-yield', analysis};
    }
    prevCount = n;
  }

  // Hit the hard cap — report honestly (slice is the widest we computed).
  const slice = lastSlice ?? (buildImpactSlice(spec, query, {depth: maxDepth}) as ImpactSlice);
  const n = impactedCount(slice);
  return {
    slice,
    depthUsed: maxDepth,
    stoppedBy: 'max-depth',
    analysis: {
      frontierExhausted: false,
      coverage: totalKnown > 0 ? n / totalKnown : 1,
      marginalYields: [...yields],
      totalKnownDependents: totalKnown,
    },
  };
}
