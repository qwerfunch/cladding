// Cladding · Token Optimizer · Spec Pruning
//
// Per ironclad-design/04-token-efficiency.md §Dependency Pruning: when
// an agent is reasoning about one feature, it should only see *that*
// feature plus the features it transitively depends on — never the
// whole catalog. This module produces that pruned slice.
//
// Pruning preserves: project, the requested feature, all features it
// depends_on (transitively), and any scenario that mentions any of
// those features. Architecture is kept as-is (small, stable).

import type {Feature, Scenario, Spec} from '../spec/types.js';

function collectAncestors(featureId: string, byId: ReadonlyMap<string, Feature>): Set<string> {
  const visited = new Set<string>();
  const stack = [featureId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const f = byId.get(id);
    for (const dep of f?.depends_on ?? []) stack.push(dep);
  }
  return visited;
}

/**
 * Returns a Spec containing only the features required to reason about
 * `featureId` (the feature itself plus its transitive dependencies),
 * and the scenarios that mention any of them.
 *
 * @param spec - The full spec.
 * @param featureId - The focus feature.
 * @returns A new Spec with the pruned feature / scenario sets. Returns
 *   the original spec unchanged when `featureId` is not present.
 * @see ironclad-design/04-token-efficiency.md §Dependency Pruning.
 */
export function pruneToFeature(spec: Spec, featureId: string): Spec {
  const byId = new Map(spec.features.map((f) => [f.id, f]));
  if (!byId.has(featureId)) return spec;

  const keep = collectAncestors(featureId, byId);
  const features: Feature[] = spec.features.filter((f) => keep.has(f.id));
  const scenarios: Scenario[] = (spec.scenarios ?? []).filter((s) =>
    (s.features ?? []).some((id) => keep.has(id)),
  );
  const pruned: Spec = {...spec, features, scenarios};
  return pruned;
}
