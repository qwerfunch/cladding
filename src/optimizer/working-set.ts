// Cladding · optimizer · working-set assembler — F-06dfdad6
//
// Additive over F-d2c806 (forward context-slice) and F-7794a6bc (backward impact-slice):
// reuses both, then ENRICHES with focus-module CODE excerpts, EARS risk flags, and a HARD
// token budget — producing ONE structured, code-bearing payload for an LLM coding task, so
// a single call replaces "read the shard + open N module files + grep deps + grep tests".
//
// buildContextSlice stays pure/frozen (sim verdict: backward-compat); this NEW function does
// the impure file reads via code-excerpt.ts. Deterministic given identical spec + file content.

import {codeExcerpt, estTokens, type CodeExcerpt, type ExcerptReader} from './code-excerpt.js';
import {buildContextSlice, type ContextLookupMiss} from './context-slice.js';
import {buildIterativeImpactSlice} from './iterative-slice.js';
import {buildPriorAttempts, type PriorAttempts} from './prior-attempts.js';
import {buildImpactSlice} from './reverse-slice.js';
import {viewFor, type GraphConsumerView} from '../graph/consumers.js';
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
    /** Self-describing radius: how far the blast-radius search widened + why it stopped + coverage
     *  of known dependents (null when zero dependents are known — never a vacuous 1.0) + the
     *  denominator itself so "0 known" survives to the consumer. */
    readonly radius?: {
      readonly depth: number;
      readonly stopped_by: string;
      readonly coverage: number | null;
      readonly total_known_dependents: number;
    };
    /** Spec-wide ledger counts + blank-map fallback hints (from the impact slice — F-c6a32fff). */
    readonly ledger?: import('./reverse-slice.js').LedgerSummary;
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
  /** Prior failure history for the focus feature, compiled from the events log +
   *  post-mortems (F-59af798d). OMITTED entirely when the feature has no recorded
   *  history — so iteration N sees "attempts: 2, last failed stage_2.2" instead of
   *  starting blind, and pays nothing on the common (no-history) path. Bounded +
   *  measured inside `budget`; dropped first under budget pressure. */
  readonly prior_attempts?: PriorAttempts;
  /** Token accounting + what was dropped to fit (must_edit is always retained). */
  readonly budget: {readonly max_tokens: number; readonly used_tokens: number; readonly truncated: readonly string[]};
  /** Which graph authority answered the needs/breaks questions — `graph-ir` is canonical,
   *  `spec-structural` is the parity-checked projection the latency-bounded hook lane reads. */
  readonly authority?: GraphConsumerView['authority'];
}

export interface WorkingSetOptions {
  readonly cwd?: string;
  readonly maxTokens?: number;
  /** Injected source reader — replaces the filesystem for code excerpts (measurement/tests). */
  readonly read?: ExcerptReader;
  /** When false, skip the code-excerpt fill entirely (the hook push lane — the agent just
   *  edited the file, so its content is already in context). Default true (F-35954d19). */
  readonly includeCode?: boolean;
  /** An already-built graph view; omitted reads the structural projection. `cwd` never
   *  selects the lane — it is the code-excerpt root, and the hook lane passes one while
   *  needing the sub-millisecond projection. */
  readonly graph?: GraphConsumerView;
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
  const view = viewFor(spec, {graph: opts.graph});
  let resolvedQuery = query;
  let coOwners: readonly string[] | undefined;
  const owners = view.owners(query);
  if (owners.length > 0) {
    resolvedQuery = owners[0];
    if (owners.length > 1) coOwners = owners;
  }

  const ctx = buildContextSlice(spec, resolvedQuery);
  if ('not_found' in ctx) return ctx; // identical miss contract — never diverge from F-d2c806
  const focus = ctx.focus;

  // Failure memory for the focus feature (F-59af798d). Best-effort + null-omit:
  // `undefined` for a feature with no history (the common path), so the branch
  // below is a pure no-op and the payload stays byte-identical to before.
  const priorAttempts = buildPriorAttempts(cwd, focus.id);

  // backward blast radius — ITERATIVE: widen from depth 1 until a deterministic sufficiency
  // criterion holds (coverage / exhaustion / marginal-yield), instead of a fixed depth-1 slice
  // that under-reports 2nd-hop dependents (the "narrow miss"). The depth/coverage/stop reason
  // are surfaced in `breaks_if_changed` so the result is self-describing, not a blind bound.
  // A MODULE query keeps its original form so the slice seeds EVERY co-owner (the fan-out) —
  // seeding only the alphabetically-first owner under-reported shared files (src/cli/clad.ts:
  // impacted 0 vs 83 measured on cladding-self). Co-owners sit in the seed set, so they appear
  // in co_owners, not impacted; their dependents and tests are what the fan-out adds.
  const backQuery = owners.length > 0 ? query : focus.id;
  const iter = buildIterativeImpactSlice(spec, backQuery, {graph: view});
  const impact = 'not_found' in iter ? null : iter.slice;
  const impacted: readonly Summary[] = impact ? impact.impacted : [];
  const regression: readonly string[] = impact ? impact.test_refs : [];
  const radius =
    'not_found' in iter
      ? null
      : {
          depth: iter.depthUsed,
          stopped_by: iter.stoppedBy,
          // Explicit null guard: JS coerces null*100 to 0, which would render the
          // no-known-dependents state as a legitimate-looking FALSE "coverage: 0".
          coverage: iter.analysis.coverage === null ? null : Math.round(iter.analysis.coverage * 100) / 100,
          total_known_dependents: iter.analysis.totalKnownDependents,
        };

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
  // includeCode:false skips the excerpt fill wholesale (hook push lane — no code in stdout).
  if (opts.includeCode !== false) {
    for (const m of [...(focus.modules ?? [])].sort()) {
      const before = sizeOf(base, needs, code);
      if (maxTokens - before <= 40) {
        truncated.push(`code: omitted ${m} (budget)`);
        continue;
      }
      const ex = codeExcerpt(m, cwd, Math.floor((maxTokens - before) * 4 * 0.8), opts.read); // 0.8 = JSON-escape headroom
      if (structuralTokens <= maxTokens && sizeOf(base, needs, [...code, ex]) > maxTokens) {
        truncated.push(`code: omitted ${m} (budget)`);
        continue;
      }
      code.push(ex);
      if (ex.truncated) truncated.push(`code: clipped ${m}`);
    }
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
    ...(impact?.ledger ? {ledger: impact.ledger} : {}),
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
    const direct = buildImpactSlice(spec, backQuery, {depth: 1, graph: view});
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
  const core = {...base, needs, must_edit: {...base.must_edit, code}, breaks_if_changed: finalBreaks};

  // 4. Attach prior_attempts LAST, within LEFTOVER budget only (F-59af798d /
  //    AC-13df5e54, the ZERO-side-effect lock). It competes inside the SAME
  //    envelope and is the first section sacrificed under pressure, so it can
  //    never push the set over budget or perturb any other section. Absent →
  //    null-omit (AC-c3db73f1) and `core` is byte-identical to the pre-feature
  //    output, so no existing consumer changes.
  let payload: WorkingSet = core;
  if (priorAttempts) {
    const trial: WorkingSet = {...core, prior_attempts: priorAttempts};
    if (estTokens(JSON.stringify(trial)) <= maxTokens) payload = trial;
    else truncated.push('prior_attempts: omitted (budget)');
  }

  // `authority` is attached AFTER the budget is measured and every clip decided. It is a
  // provenance label, not payload the caller asked for, and letting its two spellings differ
  // in length would make the same query clip differently on the two lanes — the one thing the
  // parity contract cannot allow.
  const used = estTokens(JSON.stringify(payload));
  return {...payload, budget: {max_tokens: maxTokens, used_tokens: used, truncated}, authority: view.authority};
}
