// Cladding · drift detector · MISSING_TESTS
//
// Detector #7 from the catalog (axis: code_vs_test, severity: error).
// v0.1 floor: any AC whose `test_refs` field is empty (or absent) gets
// flagged as `warn` — error severity would be too noisy on real
// projects that haven't yet wired AC ↔ test mappings. The full
// directly-resolve-the-test-function variant lands once an in-process
// vitest runner can introspect declared test names (T7c).
//
// Status policy: only `status: done` features are checked. Features in
// other lifecycle states (planned, in_progress, blocked, archived) are
// intentionally not yet bound to tests — flagging them would drown the
// signal with progress-noise.

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'MISSING_TESTS';

function runMissingTests(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `spec.yaml not loaded: ${(err as Error).message}`,
      },
    ];
  }
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      if (!ac.test_refs || ac.test_refs.length === 0) {
        findings.push({
          detector: NAME,
          severity: 'warn',
          message: `${feature.id}.${ac.id} declares no test_refs — AC is unverified`,
        });
      }
    }
  }
  return findings;
}

export const missingTests: DriftDetector = {
  name: NAME,
  run: runMissingTests,
};
