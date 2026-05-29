// Cladding · drift detector · MISSING_TESTS
//
// Detector #7 from the catalog (axis: code_vs_test, severity: error).
// Floor heuristic: a `status: done` AC must declare *some* verification —
// either `test_refs` (executable test files) or `evidence_refs` (npm
// scripts, conformance fixtures, doc artifacts). Both empty → `error`.
//
// Severity promoted from warn to error in v0.2.18 (F-067). The earlier
// warn level was a soft gate during the v0.2.2–v0.2.4 honesty cleanup
// while cladding's own self-spec still had 56 empty done ACs. The
// cleanup landed in v0.2.4 (zero empty ACs as of that release); v0.2.18
// converts that one-time achievement into a permanent invariant —
// shipping a new done AC without evidence now fails `clad check`
// outright, not just under `--strict`.
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

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'MISSING_TESTS';

function runMissingTests(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, detect);
}

function detect(spec: Spec): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      const hasTestRefs = (ac.test_refs?.length ?? 0) > 0;
      const hasEvidenceRefs = (ac.evidence_refs?.length ?? 0) > 0;
      if (!hasTestRefs && !hasEvidenceRefs) {
        findings.push({
          detector: NAME,
          severity: 'error',
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
