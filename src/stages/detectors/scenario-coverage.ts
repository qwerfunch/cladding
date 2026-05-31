// Cladding · drift detector · SCENARIO_COVERAGE
//
// The deferred detector from docs/ssot-model.md (Q-audit). Scenarios are the
// cross-feature user-journey flows — Tier A, but with thin enforcement: the
// reference detectors validate a scenario's `features[]` resolve, yet nothing
// requires a grown project to have ANY scenario, nor flags a scenario that binds
// no features. Both A/B builds shipped 0 scenarios over 20+ features and stayed
// GREEN.
//
// This detector adds two coverage signals:
//   1. SCALE-GATED — once a project passes a feature threshold but declares NO
//      scenarios, warn: a non-trivial product with zero captured cross-feature
//      flows is under-specified. (status-blind on total feature count, like
//      HOLLOW_GOVERNANCE — the gap appeared on all-`done` builds.)
//   2. UNCONDITIONAL — a scenario whose `features[]` is empty is hollow (it
//      claims to cover a flow but binds nothing), warn regardless of size.
//
// warn, not error: a small or genuinely flow-free project (e.g. a pure library)
// must not hard-break; the signal rides the warn/strict dial — advisory locally,
// blocking under --strict. Threshold is a constant (ai_hints override seam later).

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

/** Constant for now; an ai_hints override can plug in here later (cf. PLANNED_BACKLOG). */
function resolveThreshold(): number {
  return DEFAULT_MIN_FEATURES_FOR_SCENARIOS;
}

function detect(spec: Spec): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  const featureCount = spec.features.length;
  const scenarios = spec.scenarios ?? [];

  // 1. Grown project with no cross-feature flows captured.
  if (featureCount >= resolveThreshold() && scenarios.length === 0) {
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

  return findings;
}

export const scenarioCoverage: DriftDetector = {name: NAME, run: runScenarioCoverage};
