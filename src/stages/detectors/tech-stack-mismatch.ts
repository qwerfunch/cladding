// Cladding · drift detector · TECH_STACK_MISMATCH
//
// Detector #4 from the catalog (axis: spec_vs_code, severity: warn).
// Compares `spec.project.language` against the language `detectToolchain`
// resolves from the actual project manifest. A mismatch means the spec
// claims one language while the codebase is shaped like another — the
// classic "we ported to TS but spec.yaml still says python" drift.

import {detectToolchain} from '../toolchain/detect.js';
import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'TECH_STACK_MISMATCH';

function runTechStackMismatch(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const detected = detectToolchain(cwd).language;
  if (detected === 'unknown') {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: 'no manifest matched — language cannot be cross-checked',
      },
    ];
  }
  if (spec.project.language === detected) return [];
  return [
    {
      detector: NAME,
      severity: 'warn',
      message:
        `spec.project.language='${spec.project.language}' but the manifest` +
        ` chain detects '${detected}'`,
    },
  ];
}

export const techStackMismatch: DriftDetector = {
  name: NAME,
  run: runTechStackMismatch,
};
