// Cladding · drift detector · AC_DRIFT
//
// Detector #3 from the catalog (axis: spec_vs_code, severity: error).
// The full version of AC_DRIFT requires LLM-assisted semantic checks
// (AC text vs implementation fingerprint) — that lands later when the
// agent-orchestration track (T9) brings deterministic LLM use online.
//
// This brick ships the *minimal deterministic floor*: an AC is in
// drift when it carries neither a rendered `text` nor any EARS field
// (`condition`/`action`/`response`). Such an AC is structurally
// incomplete — no human can read it, no system can verify against it.
// Catching it now is cheap; the richer semantic variant can land
// behind the same detector name once LLM infra exists.

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'AC_DRIFT';

function runAcDrift(opts: CommandStageOptions): readonly DriftFinding[] {
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
    for (const ac of feature.acceptance_criteria ?? []) {
      const hasText = Boolean(ac.text?.trim());
      const hasEars = Boolean(ac.condition?.trim() || ac.action?.trim() || ac.response?.trim());
      if (!hasText && !hasEars) {
        findings.push({
          detector: NAME,
          severity: 'error',
          message:
            `${feature.id}.${ac.id} has neither rendered text nor any EARS field` +
            ' (condition/action/response) — structurally empty AC',
        });
      }
    }
  }
  return findings;
}

export const acDrift: DriftDetector = {
  name: NAME,
  run: runAcDrift,
};
