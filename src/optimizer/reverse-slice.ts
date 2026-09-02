// Cladding · optimizer · blast-radius impact slice — F-7794a6bc
//
// clad_get_context answers "what does this feature NEED?" (forward: walk
// depends_on up). This module answers the missing complement: "what BREAKS if
// I change this?" (backward: walk the dependent edges down). For a module path
// it resolves the many-to-many owners first, so changing a shared file surfaces
// every feature that touches it and everything downstream.
//
// Every graph question here goes through the one GraphConsumerView contract, so
// the answer comes from GraphIR whenever the caller supplies (or affords) the
// canonical view and from the parity-checked structural projection otherwise.
//
// The returned slice is the LLM's safe-refactor working set in a long project:
// the impacted features, the scenarios at risk, the deduped union of tests to
// re-run (the regression set), and the modules in the blast radius — bounded
// and deterministic so a host can cache and diff it.

import {viewFor, type GraphConsumerView} from '../graph/consumers.js';
import type {Feature, Spec} from '../spec/types.js';

/**
 * Spec-wide edge counts — the FALLBACK-SAFETY disambiguator (F-c6a32fff).
 * `impacted: []` on a blank ledger (zero depends_on edges anywhere — every
 * freshly adopted project) is byte-identical to a verified leaf on a dense
 * map; measured on a vapt clone, a feature with 10 real dependents answered
 * "nothing breaks, coverage 1.0". These counts make the two distinguishable,
 * and the hints tell the agent to fall back to its baseline behavior.
 */
export interface LedgerSummary {
  /** Total depends_on edges declared spec-wide (sum over the reverse index). */
  readonly depends_on_edges: number;
  /** Total test_ref citations declared spec-wide (anchor-stripped, pseudo-refs excluded). */
  readonly test_ref_edges: number;
  /** Present ONLY when depends_on_edges === 0 — the answer means unknown, not safe. */
  readonly fallback_hint?: string;
  /** Present ONLY when test_ref_edges === 0 — the regression set is unknown. */
  readonly regression_hint?: string;
}

export interface ImpactSlice {
  /** What was queried. Either a feature (id/title/status) or a module (path + owning features). */
  readonly focus: {
    readonly id?: string;
    readonly title?: string;
    readonly status?: string;
    readonly module?: string;
    /** For a module query: the feature ids that declare it (many-to-many). */
    readonly owners?: readonly string[];
  };
  /** Transitive dependents of the focus — the features a change could break (summaries). */
  readonly impacted: ReadonlyArray<{readonly id: string; readonly title: string; readonly status?: string}>;
  /** Union of module paths touched by any feature in the radius (focus ∪ impacted). */
  readonly impacted_modules: readonly string[];
  /** Scenarios bound to any feature in the radius — the flows at risk. */
  readonly scenarios: ReadonlyArray<{readonly id: string; readonly title: string}>;
  /** Deduped, sorted union of test_refs across the radius — the regression set to run. */
  readonly test_refs: readonly string[];
  /** Spec-wide ledger counts + blank-map fallback hints. Optional for payload compat. */
  readonly ledger?: LedgerSummary;
  /** Which graph authority answered — `graph-ir` is canonical, `spec-structural` is the
   *  parity-checked projection a latency-bounded lane reads. Additive: every other field
   *  is byte-identical across the two. */
  readonly authority?: GraphConsumerView['authority'];
}

export interface ImpactLookupMiss {
  readonly not_found: string;
  readonly accepted_forms: readonly string[];
  readonly discovery: string;
}

/**
 * Collects the transitive dependents of a seed set from one graph view, bounded
 * to `depth` hops (default unbounded). The returned set EXCLUDES the seeds — it
 * is the downstream blast radius only.
 */
export function collectDependents(
  seedIds: Iterable<string>,
  view: GraphConsumerView,
  depth: number = Infinity,
): Set<string> {
  return new Set(view.dependents([...seedIds], depth).ids);
}

/** Spec-wide edge counts from one graph view — sub-millisecond on either lane. */
export function ledgerOf(view: GraphConsumerView): LedgerSummary {
  const {depends_on_edges: dep, test_ref_edges: test} = view.ledger();
  return {
    depends_on_edges: dep,
    test_ref_edges: test,
    ...(dep === 0
      ? {fallback_hint: 'dependency ledger is empty — impacted: [] means unknown, not safe; fall back to grep/imports'}
      : {}),
    ...(test === 0
      ? {regression_hint: 'no test_refs declared project-wide — the regression set is unknown; run the full suite'}
      : {}),
  };
}

/**
 * Builds the backward (blast-radius) slice for a feature id/slug or a module
 * path. Returns a not_found result when the query resolves to neither.
 *
 * @param spec  The loaded spec.
 * @param query Feature id, slug, or module path.
 * @param opts.depth  Bound the dependent walk to N hops (default: unbounded).
 * @param opts.graph  An already-built graph view; omitted reads the structural projection.
 */
export function buildImpactSlice(
  spec: Spec,
  query: string,
  opts: {readonly depth?: number; readonly graph?: GraphConsumerView} = {},
): ImpactSlice | ImpactLookupMiss {
  const depth = opts.depth ?? Infinity;
  const view = viewFor(spec, {graph: opts.graph});
  const byId = new Map((spec.features ?? []).map((f) => [f.id, f]));

  // Resolve: a feature query is one seed; a module query fans out to all owners.
  let seedFeatures: Feature[] = [];
  let moduleQuery: string | undefined;
  const direct = view.resolveFeature(query);
  if (direct) {
    seedFeatures = [direct];
  } else {
    const owners = view.owners(query);
    if (owners.length > 0) {
      moduleQuery = query;
      seedFeatures = owners.map((id) => byId.get(id)).filter((f): f is Feature => Boolean(f));
    }
  }

  if (seedFeatures.length === 0) {
    return {
      not_found: query,
      accepted_forms: ['feature id (F-…)', 'slug', 'module path (e.g. src/spec/load.ts)'],
      discovery:
        'grep spec/index.yaml — one line per feature (run clad sync if missing); module paths live in each ' +
        'shard’s modules:; if the query is a file, fall back to normal code search — the graph only knows declared modules',
    };
  }

  const seedIds = seedFeatures.map((f) => f.id);
  const dependentIds = collectDependents(seedIds, view, depth);

  const impacted = [...dependentIds]
    .map((id) => byId.get(id))
    .filter((f): f is Feature => Boolean(f))
    .map((f) => ({id: f.id, title: f.title, status: f.status}))
    .sort((a, b) => a.id.localeCompare(b.id));

  // The full radius (seeds ∪ dependents) drives module / scenario / test unions.
  const radiusIds = new Set<string>([...seedIds, ...dependentIds]);
  const radiusFeatures = [...radiusIds]
    .map((id) => byId.get(id))
    .filter((f): f is Feature => Boolean(f));

  const impacted_modules = [
    ...new Set(radiusFeatures.flatMap((f) => f.modules ?? [])),
  ].sort();

  const scenarios = (spec.scenarios ?? [])
    .filter((s) => (s.features ?? []).some((id) => radiusIds.has(id)))
    .map((s) => ({id: s.id, title: s.title}))
    .sort((a, b) => a.id.localeCompare(b.id));

  const test_refs = [
    ...new Set(
      radiusFeatures.flatMap((f) => (f.acceptance_criteria ?? []).flatMap((ac) => ac.test_refs ?? [])),
    ),
  ].sort();

  const focus = moduleQuery
    ? {module: moduleQuery, owners: [...seedIds].sort()}
    : {id: seedFeatures[0].id, title: seedFeatures[0].title, status: seedFeatures[0].status};

  return {focus, impacted, impacted_modules, scenarios, test_refs, ledger: ledgerOf(view), authority: view.authority};
}
