// Cladding · drift detector · SLUG_CONFLICT (v0.3.9 + v0.3.12)
//
// Catches the case where two features OR two scenarios in the loaded
// spec carry the same `slug`. The slug is the multi-developer-safe
// filename anchor (`spec/{features,scenarios}/<slug>-<hash8>.yaml`);
// two distinct items with the same slug means two branches
// independently chose the same name and the merge silently produced
// a semantic duplicate.
//
// Feature slugs and scenario slugs live in separate namespaces — a
// feature `login-flow` and a scenario `login-flow` are NOT a
// conflict because they reference different yaml directories.

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'SLUG_CONFLICT';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch {
    // Load-failure policy (see detectors/with-spec.ts): within-spec-validity
    // detector — nothing to check without a loaded spec; ABSENCE_OF_GOVERNANCE
    // + the info-emitting spec-vs-reality detectors already surface the failure.
    return [];
  }
  const findings: DriftFinding[] = [];

  // Features
  checkSlugs(
    spec.features.map((f) => ({id: f.id, slug: (f as {slug?: string}).slug})),
    'features',
    findings,
  );

  // Scenarios (v0.3.12) — separate namespace from features
  checkSlugs(
    (spec.scenarios ?? []).map((s) => ({id: s.id, slug: (s as {slug?: string}).slug})),
    'scenarios',
    findings,
  );

  return findings;
}

function checkSlugs(
  items: readonly {id: string; slug?: string}[],
  namespace: string,
  findings: DriftFinding[],
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.slug) continue;
    const prior = seen.get(item.slug);
    if (prior) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `slug '${item.slug}' is used by both ${prior} and ${item.id} in ${namespace}/ — ` +
          'two items in the same namespace cannot share a slug; pick a different slug for one',
      });
    } else {
      seen.set(item.slug, item.id);
    }
  }
}

export const slugConflict: DriftDetector = {name: NAME, run};
