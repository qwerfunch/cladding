// Cladding · optimizer · blast-radius impact slice — F-7794a6bc
//
// clad_get_context answers "what does this feature NEED?" (forward: walk
// depends_on up). This module answers the missing complement: "what BREAKS if
// I change this?" (backward: walk the reverse-index dependents down). For a
// module path it resolves the many-to-many owners first, so changing a shared
// file surfaces every feature that touches it and everything downstream.
//
// The returned slice is the LLM's safe-refactor working set in a long project:
// the impacted features, the scenarios at risk, the deduped union of tests to
// re-run (the regression set), and the modules in the blast radius — bounded
// and deterministic so a host can cache and diff it.

import {reverseIndexOf} from '../spec/reverse-index.js';
import type {Feature, Spec} from '../spec/types.js';

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
}

export interface ImpactLookupMiss {
  readonly not_found: string;
  readonly accepted_forms: readonly string[];
  readonly discovery: string;
}

/**
 * Collects the transitive dependents of a seed set by walking reverse edges
 * breadth-first, bounded to `depth` hops (default unbounded). The returned set
 * EXCLUDES the seeds — it is the downstream blast radius only.
 */
export function collectDependents(
  seedIds: Iterable<string>,
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
  depth: number = Infinity,
): Set<string> {
  const result = new Set<string>();
  const seen = new Set<string>(seedIds);
  let frontier = [...seen];
  let hop = 0;
  while (frontier.length > 0 && hop < depth) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dep of dependents.get(id) ?? []) {
        if (!seen.has(dep)) {
          seen.add(dep);
          result.add(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
    hop++;
  }
  return result;
}

/** id (F-…) or slug → the feature; else null. */
function resolveFeature(spec: Spec, query: string): Feature | null {
  const features = spec.features ?? [];
  return (
    features.find((f) => f.id === query) ??
    features.find((f) => (f as {slug?: string}).slug === query) ??
    null
  );
}

/**
 * Builds the backward (blast-radius) slice for a feature id/slug or a module
 * path. Returns a not_found result when the query resolves to neither.
 *
 * @param spec  The loaded spec.
 * @param query Feature id, slug, or module path.
 * @param opts.depth  Bound the dependent walk to N hops (default: unbounded).
 */
export function buildImpactSlice(
  spec: Spec,
  query: string,
  opts: {readonly depth?: number} = {},
): ImpactSlice | ImpactLookupMiss {
  const depth = opts.depth ?? Infinity;
  const ri = reverseIndexOf(spec);
  const byId = new Map((spec.features ?? []).map((f) => [f.id, f]));

  // Resolve: a feature query is one seed; a module query fans out to all owners.
  let seedFeatures: Feature[] = [];
  let moduleQuery: string | undefined;
  const direct = resolveFeature(spec, query);
  if (direct) {
    seedFeatures = [direct];
  } else {
    const owners = ri.moduleOwners.get(query);
    if (owners && owners.size > 0) {
      moduleQuery = query;
      seedFeatures = [...owners].map((id) => byId.get(id)).filter((f): f is Feature => Boolean(f));
    }
  }

  if (seedFeatures.length === 0) {
    return {
      not_found: query,
      accepted_forms: ['feature id (F-…)', 'slug', 'module path (e.g. src/spec/load.ts)'],
      discovery: 'grep spec/index.yaml — one line per feature; module paths live in each shard’s modules:',
    };
  }

  const seedIds = seedFeatures.map((f) => f.id);
  const dependentIds = collectDependents(seedIds, ri.dependents, depth);

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

  return {focus, impacted, impacted_modules, scenarios, test_refs};
}
