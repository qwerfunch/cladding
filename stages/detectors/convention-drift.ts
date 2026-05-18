// Cladding · drift detector · CONVENTION_DRIFT
//
// Detector #6 from the catalog (axis: spec_vs_code, severity: warn).
// LLM-assisted variant (real semantic AC ↔ code comparison) lands
// behind the `reviewer` agent in v0.2. This brick ships the
// deterministic v0.1 floor:
//
//   For every features[].modules[] file ending in `.ts`, verify the
//   first non-empty line begins a comment (line or block). The intent
//   is the "Documentation: Why > What" guardrail from
//   ironclad-design/13-philosophical-guardrails.md — code without a
//   header comment is the cheapest, highest-signal style violation
//   to catch deterministically.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'CONVENTION_DRIFT';

function startsWithComment(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*');
}

function runConventionDrift(opts: CommandStageOptions): readonly DriftFinding[] {
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
    for (const modulePath of feature.modules ?? []) {
      if (!modulePath.endsWith('.ts')) continue;
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
