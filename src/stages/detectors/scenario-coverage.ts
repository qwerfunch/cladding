// Cladding · drift detector · SCENARIO_COVERAGE
//
// The deferred detector from docs/ssot-model.md (Q-audit). Scenarios are the
// cross-feature user-journey flows — Tier A, but with thin enforcement: the
// reference detectors validate a scenario's `features[]` resolve, yet nothing
// requires a grown project to have ANY scenario, nor flags a scenario that binds
// no features. Both A/B builds shipped 0 scenarios over 20+ features and stayed
// GREEN.
//
// This detector adds three coverage signals:
//   1. SCALE-GATED — once a project passes a feature threshold but declares NO
//      scenarios, warn: a non-trivial product with zero captured cross-feature
//      flows is under-specified. (status-blind on total feature count, like
//      HOLLOW_GOVERNANCE — the gap appeared on all-`done` builds.)
//   2. UNCONDITIONAL HOLLOW — a scenario whose `features[]` is empty is hollow (it
//      claims to cover a flow but binds nothing), warn regardless of size.
//   3. UNDER-BOUND — a scenario whose `flow` names a feature by its slug (the
//      `(feature-slug)` convention) that it doesn't bind in `features[]`, so its
//      declared coverage under-states the flow it walks. Exact-slug match only, so
//      free prose / non-slug parentheticals never false-fire. (The A/B re-measurement
//      surfaced a scenario that named 10 features in its flow but bound 7.)
//
// warn, not error: a small or genuinely flow-free project (e.g. a pure library)
// must not hard-break; the signal rides the warn/strict dial — advisory locally,
// blocking under --strict. Threshold is a constant.

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'SCENARIO_COVERAGE';

/** Below this feature count a project may legitimately have no scenarios yet. */
export const DEFAULT_MIN_FEATURES_FOR_SCENARIOS = 8;

function runScenarioCoverage(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec));
}

function detect(spec: Spec): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  const featureCount = spec.features.length;
  const scenarios = spec.scenarios ?? [];

  // 1. Grown project with no cross-feature flows captured.
  if (featureCount >= DEFAULT_MIN_FEATURES_FOR_SCENARIOS && scenarios.length === 0) {
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: 'spec/scenarios/',
      message:
        `${featureCount} features but no scenarios declared — cross-feature user-journey ` +
        'flows are not captured. Author at least one with `clad_create_scenario`.',
    });
  }

  // 2. A scenario that binds no features is hollow (claims a flow, covers nothing).
  for (const s of scenarios) {
    if ((s.features ?? []).length === 0) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        path: 'spec/scenarios/',
        message:
          `scenario ${s.id} binds no features (features: []) — a scenario must cover at least ` +
          "one feature's flow, or it should be removed.",
      });
    }
  }

  // 3. UNDER-BOUND scenario: the flow narrative references a feature by its slug
  // (the `(feature-slug)` convention) that the scenario does not bind in features[].
  // A flow that walks features it doesn't declare under-states its coverage — the
  // A/B's onboarding scenario named 10 features in its flow but bound only 7, and
  // checks 1+2 cannot see it. Only EXACT feature-slug matches count, so free prose
  // and non-slug parentheticals (e.g. `(type/lint/drift)`) never false-fire.
  const slugToId = new Map(
    spec.features.filter((f) => typeof f.slug === 'string' && f.slug.length > 0).map((f) => [f.slug as string, f.id]),
  );
  for (const s of scenarios) {
    if (!s.flow) continue;
    const bound = new Set(s.features ?? []);
    const unbound = new Map<string, string>(); // slug → id, deduped
    for (const paren of s.flow.matchAll(/\(([^)]+)\)/g)) {
      for (const token of paren[1].split(/[,/·]/)) {
        const slug = token.trim();
        const id = slugToId.get(slug);
        if (id && !bound.has(id)) unbound.set(slug, id);
      }
    }
    if (unbound.size > 0) {
      const named = [...unbound].map(([slug, id]) => `${slug} (${id})`).join(', ');
      findings.push({
        detector: NAME,
        severity: 'warn',
        path: 'spec/scenarios/',
        message:
          `scenario ${s.id} flow references ${named} but features[] does not bind ${unbound.size === 1 ? 'it' : 'them'} ` +
          '— bind every feature the flow walks, or trim the flow so coverage is not under-stated.',
      });
    }
  }

  return findings;
}

export const scenarioCoverage: DriftDetector = {name: NAME, run: runScenarioCoverage};
