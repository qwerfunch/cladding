// Cladding · drift detector · AC_DUPLICATE_WITHIN_FEATURE (v0.3.9, F-084)
//
// AC ids are scoped to the feature, not globally (v0.3.9 onward).
// Two distinct features may both declare `AC-001`; uniqueness is the
// composite `<feature.id>.<ac.id>`. This detector catches the only
// remaining failure mode: the same `AC-NNN` appearing twice inside
// a single feature's `acceptance_criteria` list — usually a copy-paste
// error during AC authoring.
//
// Distinct from AC_DRIFT, which checks structure + EARS syntax but
// not uniqueness. Kept as a separate detector so a future audit can
// turn it off independently.

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'AC_DUPLICATE_WITHIN_FEATURE';

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
  for (const feature of spec.features) {
    const acIds = (feature.acceptance_criteria ?? []).map((ac) => ac.id);
    const counts = new Map<string, number>();
    for (const id of acIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [acId, count] of counts) {
      if (count > 1) {
        findings.push({
          detector: NAME,
          severity: 'error',
          message:
            `${feature.id}.${acId} appears ${count} times — AC ids must be unique within a feature`,
        });
      }
    }
  }
  return findings;
}

export const acDuplicateWithinFeature: DriftDetector = {name: NAME, run};
