// Cladding · drift detector · STALE_EVIDENCE
//
// Detector #15 from the catalog (axis: spec_vs_test, severity: warn).
// v0.1 floor: any evidence entry whose identity.timestamp is older
// than 90 days emits a warn finding. Tunable later via cladding.config
// or spec.architecture; the default fits typical sprint cadence.

import {readEvidence} from '../../hitl/audit.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'STALE_EVIDENCE';
const STALE_DAYS = 90;

function runStaleEvidence(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const evidence = readEvidence(cwd);
  if (evidence.length === 0) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: 'no audit log present — detector is opt-in on prior stage_4 runs',
      },
    ];
  }
  const now = Date.now();
  const findings: DriftFinding[] = [];
  for (const e of evidence) {
    const recorded = Date.parse(e.identity.timestamp);
    if (Number.isNaN(recorded)) continue;
    const ageDays = (now - recorded) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_DAYS) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message: `evidence ${e.id} is ${Math.round(ageDays)} days old (floor ${STALE_DAYS})`,
      });
    }
  }
  return findings;
}

export const staleEvidence: DriftDetector = {
  name: NAME,
  run: runStaleEvidence,
};
