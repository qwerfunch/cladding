// Cladding · drift detector · AC_DRIFT
//
// Detector #3 from the catalog (axis: spec_vs_code, severity: error).
// Ships two complementary checks:
//
//   1. Structural floor (always on)
//      An AC must have *either* rendered `text` *or* at least one EARS
//      field (`condition` / `action` / `response`). Anything else is a
//      structurally empty AC — un-readable and un-verifiable.
//
//   2. EARS syntactic check (T5)
//      For ACs that *do* declare an EARS pattern, the `condition`
//      string must match the pattern's expected trigger keyword
//      (when / while / where / if), or be empty for `ubiquitous`.
//      Delegated to `spec/ears.ts`.
//
// The full semantic AC↔implementation drift requires LLM-assisted
// inference and lands in T9 alongside the agent orchestrator.

import {checkAllFeatures} from '../../spec/ears.js';
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

  // (1) structural floor.
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

  // (2) EARS syntactic check.
  for (const issue of checkAllFeatures(spec.features)) {
    findings.push({
      detector: NAME,
      severity: 'error',
      message: `${issue.featureId}.${issue.acId} EARS: ${issue.message}`,
    });
  }

  return findings;
}

export const acDrift: DriftDetector = {
  name: NAME,
  run: runAcDrift,
};
