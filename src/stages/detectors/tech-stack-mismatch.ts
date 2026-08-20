// Cladding · drift detector · TECH_STACK_MISMATCH
//
// Detector #4 from the catalog (axis: spec_vs_code, severity: warn).
// Compares `spec.project.language` against the language `detectToolchain`
// resolves from the actual project manifest. A mismatch means the spec
// claims one language while the codebase is shaped like another — the
// classic "we ported to TS but spec.yaml still says python" drift.
//
// `.cladding/config.yaml::gate.language` is the declared-label escape hatch.
// The manifest chain reads BUILD ORCHESTRATION, so a repository whose product
// language differs from its build host — a C++ SDK driven by Gradle, a Rust
// core shipped through npm — is mislabelled by construction, and the only way
// to green the check used to be rewriting spec.yaml to adopt the mislabel.
// With a declaration the spec stays truthful: the detector cross-checks the
// spec against the declaration instead of the heuristic, and still warns when
// the two disagree, so the check keeps its teeth.

import {detectToolchain} from '../toolchain/detect.js';
import {readGateConfig} from '../toolchain/gate-config.js';
import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'TECH_STACK_MISMATCH';

function runTechStackMismatch(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const declared = readGateConfig(cwd).language;
  if (declared !== undefined) {
    // A declaration replaces the manifest heuristic entirely — including the
    // no-manifest case, where the declaration IS the cross-check anchor.
    if (spec.project.language === declared) return [];
    return [
      {
        detector: NAME,
        severity: 'warn',
        message:
          `spec.project.language='${spec.project.language}' but` +
          ` .cladding/config.yaml::gate.language declares '${declared}'`,
      },
    ];
  }
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
