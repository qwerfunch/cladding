// Cladding · drift detector · EVIDENCE_MISMATCH
//
// Detector #10 from the catalog (axis: code_vs_test, severity: error).
// v0.1 floor: scans the audit log for evidence entries with an
// `artifact` field, and verifies that the artifact path still exists.
// A vanished artifact means the evidence is no longer reproducible —
// the audit trail has drifted from the codebase.
//
// Future enhancement (T9+): record + verify a content hash of each
// artifact so silent content changes also surface.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {readEvidence} from '../../hitl/audit.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'EVIDENCE_MISMATCH';

function runEvidenceMismatch(opts: CommandStageOptions): readonly DriftFinding[] {
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
  const findings: DriftFinding[] = [];
  for (const e of evidence) {
    if (!e.artifact) continue;
    if (existsSync(join(cwd, e.artifact))) continue;
    findings.push({
      detector: NAME,
      severity: 'error',
      path: e.artifact,
      message: `evidence ${e.id} references missing artifact '${e.artifact}'`,
    });
  }
  return findings;
}

export const evidenceMismatch: DriftDetector = {
  name: NAME,
  run: runEvidenceMismatch,
};
