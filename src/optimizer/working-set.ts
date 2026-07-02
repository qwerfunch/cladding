// Cladding · optimizer · working-set assembler — F-06dfdad6
//
// Additive over F-d2c806 (forward context-slice) and F-7794a6bc (backward impact-slice):
// reuses both, then ENRICHES with focus-module CODE excerpts, EARS risk flags, and a HARD
// token budget — producing ONE structured, code-bearing payload for an LLM coding task, so
// a single call replaces "read the shard + open N module files + grep deps + grep tests".
//
// buildContextSlice stays pure/frozen (sim verdict: backward-compat); this NEW function does
// the impure file reads via code-excerpt.ts. Deterministic given identical spec + file content.

import {codeExcerpt, estTokens, type CodeExcerpt} from './code-excerpt.js';
import {buildContextSlice, type ContextLookupMiss} from './context-slice.js';
import {buildIterativeImpactSlice} from './iterative-slice.js';
import {buildImpactSlice} from './reverse-slice.js';
import {reverseIndexOf} from '../spec/reverse-index.js';
import type {Feature, Spec} from '../spec/types.js';

type Summary = {readonly id: string; readonly title: string; readonly status?: string};

export interface WorkingSet {
  /** What you are editing: the focus feature in full + the actual code of its modules. */
  readonly must_edit: {
    readonly id: string;
    readonly title: string;
    readonly status?: string;
    readonly modules: readonly string[];
    readonly acceptance_criteria: Feature['acceptance_criteria'];
    readonly code: readonly CodeExcerpt[];
    /** Present only when the query was a module path claimed by several features. */
    readonly co_owners?: readonly string[];
  };
  /** What it needs: transitive depends_on ancestors (forward). */
  readonly needs: readonly Summary[];
  /** What breaks if you change it: dependents + the regression set (backward). A module query
   *  seeds ALL co-owners (fan-out). Under budget pressure deeper dependents and their tests are
   *  clipped — the depth-1 direct set is always retained — with a `breaks: omitted …` entry in
   *  budget.truncated. */
  readonly breaks_if_changed: {
    readonly impacted: readonly Summary[];
    readonly regression_tests: readonly string[];
    /** Self-describing radius: how far the blast-radius search widened + why it stopped + coverage of known dependents. */
    readonly radius?: {readonly depth: number; readonly stopped_by: string; readonly coverage: number};
  };
  /** How to verify: scenarios, tests, oracle refs, and the high-risk (EARS unwanted/state) ACs. */
  readonly verify: {
    readonly scenarios: ReadonlyArray<{readonly id: string; readonly title: string}>;
    readonly test_refs: readonly string[];
    readonly oracle_refs: readonly string[];
    readonly high_risk_acs: ReadonlyArray<{readonly id: string; readonly ears: string}>;
  };
  /** Project standing instructions (ai_hints.preferred_patterns). */
  readonly guidance: {
    readonly preferred_patterns: ReadonlyArray<{readonly when: string; readonly prefer: string; readonly over?: string}>;
  };
  /** Token accounting + what was dropped to fit (must_edit is always retained). */
  readonly budget: {readonly max_tokens: number; readonly used_tokens: number; readonly truncated: readonly string[]};
}

export interface WorkingSetOptions {
  readonly cwd?: string;
  readonly maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 3000;
/** Always keep at least this many (nearest-by-id) ancestors even under budget pressure. */
const MIN_KEEP_NEEDS = 3;

/** estTokens of the assembled payload with the given needs + code substituted in. */
function sizeOf(base: WorkingSet, needs: readonly Summary[], code: readonly CodeExcerpt[]): number {
  return estTokens(JSON.stringify({...base, needs, must_edit: {...base.must_edit, code}}));
}

/**
 * Assembles the token-budgeted working set for one feature/module. Returns the SAME
 * not_found miss contract as buildContextSlice on an unrecognized query.
 */
export function buildWorkingSet(spec: Spec, query: string, opts: WorkingSetOptions = {}): WorkingSet | ContextLookupMiss {
  const cwd = opts.cwd ?? '.';
  const maxTokens = opts.maxTokens && opts.maxTokens > 0 ? opts.maxTokens : DEFAULT_MAX_TOKENS;

  // Resolve focus DETERMINISTICALLY: for a module path with owners, the alphabetically-first
  // owner id is the focus (independent of feature-array order — buildContextSlice would pick
  // array-first); all co-owners are surfaced so the LLM sees the shared-module fan-out.
  let resolvedQuery = query;
  let coOwners: readonly string[] | undefined;
  const owners = reverseIndexOf(spec).moduleOwners.get(query);
  if (owners && owners.size > 0) {
    const sorted = [...owners].sort();
    resolvedQuery = sorted[0];
    if (sorted.length > 1) coOwners = sorted;
  }

  const ctx = buildContextSlice(spec, resolvedQuery);
  if ('not_found' in ctx) return ctx; // identical miss contract — never diverge from F-d2c806
  const focus = ctx.focus;

  // backward blast radius — ITERATIVE: widen from depth 1 until a deterministic sufficiency
  // criterion holds (coverage / exhaustion / marginal-yield), instead of a fixed depth-1 slice
  // that under-reports 2nd-hop dependents (the "narrow miss"). The depth/coverage/stop reason
  // are surfaced in `breaks_if_changed` so the result is self-describing, not a blind bound.
  // A MODULE query keeps its original form so the slice seeds EVERY co-owner (the fan-out) —
  // seeding only the alphabetically-first owner under-reported shared files (src/cli/clad.ts:
  // impacted 0 vs 83 measured on cladding-self). Co-owners sit in the seed set, so they appear
  // in co_owners, not impacted; their dependents and tests are what the fan-out adds.
  const backQuery = owners && owners.size > 0 ? query : focus.id;
  const iter = buildIterativeImpactSlice(spec, backQuery);
  const impact = 'not_found' in iter ? null : iter.slice;
  const impacted: readonly Summary[] = impact ? impact.impacted : [];
  const regression: readonly string[] = impact ? impact.test_refs : [];
  const radius =
    'not_found' in iter
      ? null
      : {depth: iter.depthUsed, stopped_by: iter.stoppedBy, coverage: Math.round(iter.analysis.coverage * 100) / 100};

  const acs = focus.acceptance_criteria ?? [];
  const highRiskAcs = acs
    .filter((ac) => ac.ears === 'unwanted' || ac.ears === 'state')
    .map((ac) => ({id: ac.id, ears: String(ac.ears)}));
  const oracleRefs = [...new Set(acs.flatMap((ac) => ac.oracle_refs ?? []))].sort();

  const truncated: string[] = [];
  const base: WorkingSet = {
    must_edit: {
      id: focus.id,
      title: focus.title,
      status: focus.status,
      modules: focus.modules ?? [],
      acceptance_criteria: acs,
      code: [],
      ...(coOwners ? {co_owners: coOwners} : {}),
    },
    needs: ctx.ancestors,
    breaks_if_changed: {impacted, regression_tests: regression, ...(radius ? {radius} : {})},
    verify: {scenarios: ctx.scenarios, test_refs: ctx.test_refs, oracle_refs: oracleRefs, high_risk_acs: highRiskAcs},
    guidance: {preferred_patterns: ctx.preferred_patterns},
    budget: {max_tokens: maxTokens, used_tokens: 0, truncated},
  };

  // 1. Clip droppable NEEDS first (distant ancestors — drop highest id last, keep ≥ MIN_KEEP_NEEDS).
  const needs = [...ctx.ancestors];
  while (needs.length > MIN_KEEP_NEEDS && sizeOf(base, needs, []) > maxTokens) needs.pop();
  if (needs.length < ctx.ancestors.length) {
    truncated.push(`needs: dropped ${ctx.ancestors.length - needs.length} distant ancestor(s)`);
  }

  // 2. Fill CODE excerpts with the remaining budget; measure the TRUE serialized size each
  //    step (JSON-escaping inflates code) and skip any excerpt that would breach the cap —
  //    unless the structural core alone already exceeds it (then must-edit is kept regardless).
  const structuralTokens = sizeOf(base, needs, []);
  const code: CodeExcerpt[] = [];
  for (const m of [...(focus.modules ?? [])].sort()) {
    const before = sizeOf(base, needs, code);
    if (maxTokens - before <= 40) {
      truncated.push(`code: omitted ${m} (budget)`);
      continue;
    }
    const ex = codeExcerpt(m, cwd, Math.floor((maxTokens - before) * 4 * 0.8)); // 0.8 = JSON-escape headroom
    if (structuralTokens <= maxTokens && sizeOf(base, needs, [...code, ex]) > maxTokens) {
      truncated.push(`code: omitted ${m} (budget)`);
      continue;
    }
    code.push(ex);
    if (ex.truncated) truncated.push(`code: clipped ${m}`);
  }

  if (structuralTokens > maxTokens) {
    truncated.push('must-edit exceeds budget — retained in full (focus is never dropped)');
  }

  // 3. Clip the BACKWARD radius last (needs → code → breaks; simulation showed clipping breaks
  //    before the code fill is strictly worse — marker inflation with zero code recovered).
  //    Deeper dependents drop from the far end first, then tests outside the depth-1 floor;
  //    the depth-1 direct set is never dropped (the must-edit precedent). Every fit check
  //    measures WITH the pending 'breaks: omitted …' marker so the marker itself cannot push
  //    the payload over — the +3..10-token overshoot the old loops carried. A payload already
  //    inside the budget is returned byte-identical (the clip is a pure no-op).
  const breaksOf = (imp: readonly Summary[], reg: readonly string[]): WorkingSet['breaks_if_changed'] => ({
    impacted: imp,
    regression_tests: reg,
    ...(radius ? {radius} : {}),
  });
  const overWith = (imp: readonly Summary[], reg: readonly string[], di: number, dr: number): boolean => {
    const marker = di + dr > 0 ? [`breaks: omitted ${di} feature(s) / ${dr} test(s)`] : [];
    const trial = {
      ...base,
      needs,
      must_edit: {...base.must_edit, code},
      breaks_if_changed: breaksOf(imp, reg),
      budget: {...base.budget, truncated: [...truncated, ...marker]},
    };
    return estTokens(JSON.stringify(trial)) > maxTokens;
  };
  let impKeep: readonly Summary[] = impacted;
  let regKeep: readonly string[] = regression;
  if (overWith(impKeep, regKeep, 0, 0)) {
    const direct = buildImpactSlice(spec, backQuery, {depth: 1});
    const directIds = new Set('not_found' in direct ? [] : direct.impacted.map((f) => f.id));
    const floorTests = new Set('not_found' in direct ? [] : direct.test_refs);
    // Retention order: direct dependents first, deeper ones behind them (drop from the end).
    const ordered = [...impacted.filter((f) => directIds.has(f.id)), ...impacted.filter((f) => !directIds.has(f.id))];
    let imp: readonly Summary[] = ordered;
    let di = 0;
    while (imp.length > directIds.size && overWith(imp, regKeep, di, 0)) {
      imp = imp.slice(0, -1);
      di++;
    }
    const reg = [...regression];
    let dr = 0;
    while (overWith(imp, reg, di, dr)) {
      let cut = -1;
      for (let i = reg.length - 1; i >= 0; i--) {
        if (!floorTests.has(reg[i])) {
          cut = i;
          break;
        }
      }
      if (cut < 0) break; // only depth-1-floor tests remain — never dropped
      reg.splice(cut, 1);
      dr++;
    }
    impKeep = imp;
    regKeep = reg;
    if (di + dr > 0) truncated.push(`breaks: omitted ${di} feature(s) / ${dr} test(s)`);
    if (overWith(impKeep, regKeep, 0, 0)) {
      truncated.push('breaks: direct set retained in full — exceeds budget');
    }
  }

  const finalBreaks = breaksOf(impKeep, regKeep);
  const used = estTokens(
    JSON.stringify({...base, needs, must_edit: {...base.must_edit, code}, breaks_if_changed: finalBreaks}),
  );
  return {
    ...base,
    needs,
    must_edit: {...base.must_edit, code},
    breaks_if_changed: finalBreaks,
    budget: {max_tokens: maxTokens, used_tokens: used, truncated},
  };
}
