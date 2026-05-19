// Cladding · drift detector · MISSING_TESTS
//
// Detector #7 from the catalog (axis: code_vs_test, severity: warn).
// Floor heuristic: a `status: done` AC must declare *some* verification —
// either `test_refs` (executable test files) or `evidence_refs` (npm
// scripts, conformance fixtures, doc artifacts). Both empty → `warn`.
//
// Why warn, not error: real projects iterate spec faster than tests,
// and an undeclared-but-real test should not block ship. The opt-in
// `--strict` mode (v0.2.2, F-051) escalates warn to error for CI.
//
// Why count evidence_refs as satisfying (v0.2.3, F-052): not every AC
// is verified by a vitest assertion — some run via `npm run stage:X`,
// some via conformance fixtures, some via docs/measurement reports.
// Lumping all of these into `test_refs` was the dishonesty the v0.2.2
// detector-honesty cycle exposed; the split lets each AC declare what
// kind of evidence it actually has.
//
// Status policy: only `status: done` features are checked. Features in
// other lifecycle states (planned, in_progress, blocked, archived) are
// intentionally not yet bound — flagging them would drown the signal
// with progress-noise.

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
      const hasTestRefs = (ac.test_refs?.length ?? 0) > 0;
      const hasEvidenceRefs = (ac.evidence_refs?.length ?? 0) > 0;
      if (!hasTestRefs && !hasEvidenceRefs) {
        findings.push({
          detector: NAME,
          severity: 'warn',
          message: `${feature.id}.${ac.id} declares no test_refs or evidence_refs — AC is unverified`,
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
