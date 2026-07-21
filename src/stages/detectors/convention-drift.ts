// Cladding · drift detector · CONVENTION_DRIFT
//
// Detector #6 from the catalog (axis: spec_vs_code, severity: warn).
// LLM-assisted variant (real semantic AC ↔ code comparison) lands
// behind the `reviewer` agent in v0.2. This brick ships the
// deterministic v0.1 floor:
//
//   For every feature module in the project's configured language, verify the
//   first non-empty line begins a language-appropriate comment or docstring. The intent
//   is the "Documentation: Why > What" guardrail from
//   ironclad-design/13-philosophical-guardrails.md — code without a
//   header comment is the cheapest, highest-signal style violation
//   to catch deterministically.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import {resolveLanguageConfig} from '../toolchain/language-config.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'CONVENTION_DRIFT';

function startsWithComment(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''")
  );
}

function runConventionDrift(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const cfg = resolveLanguageConfig(cwd, spec.project?.language);
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    for (const modulePath of feature.modules ?? []) {
      if (!cfg.extensions.some((e) => modulePath.endsWith(e))) continue;
      const abs = join(cwd, modulePath);
      if (!existsSync(abs)) continue;
      const content = readFileSync(abs, 'utf8');
      if (!startsWithComment(content)) {
        findings.push({
          detector: NAME,
          severity: 'warn',
          path: modulePath,
          message:
            `${modulePath} has no file-header comment — Why>What guardrail recommends a one-line intent`,
        });
      }
    }
  }
  return findings;
}

export const conventionDrift: DriftDetector = {
  name: NAME,
  run: runConventionDrift,
};
