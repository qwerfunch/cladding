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
  /** What breaks if you change it: direct dependents + the regression set (backward). */
  readonly breaks_if_changed: {
    readonly impacted: readonly Summary[];
    readonly regression_tests: readonly string[];
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

  // backward blast radius — DIRECT dependents only (depth 1) + regression test union.
  const impact = buildImpactSlice(spec, focus.id, {depth: 1});
  const impacted: readonly Summary[] = 'not_found' in impact ? [] : impact.impacted;
  const regression: readonly string[] = 'not_found' in impact ? [] : impact.test_refs;

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
    breaks_if_changed: {impacted, regression_tests: regression},
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

  const used = sizeOf(base, needs, code);
  return {
    ...base,
    needs,
    must_edit: {...base.must_edit, code},
    budget: {max_tokens: maxTokens, used_tokens: used, truncated},
  };
}
