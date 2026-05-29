// Cladding · drift detector · STATUS_DRIFT
//
// Detector #14 from the catalog (axis: spec_vs_test, severity: error).
// Cross-checks `features[].status` against the filesystem:
//   - status='done' but at least one declared module is missing → error
//     (the feature is marked complete yet its implementation is absent)
//   - status='in_progress' but every declared module is missing → warn
//     (likely a stale feature that never started)
//
// Note: we deliberately do NOT consult git log in this brick — the goal
// is a cheap signal, not a deep audit. The richer git-based version
// can land as STATUS_DRIFT_DEEP later, or be folded in once T8 brings
// the events.log subsystem online.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'STATUS_DRIFT';

function runStatusDrift(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    const modules = feature.modules ?? [];
    if (modules.length === 0) continue;
    const missing = modules.filter((m) => !existsSync(join(cwd, m)));
    if (missing.length === 0) continue;
    if (feature.status === 'done') {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `feature ${feature.id} status='done' but ${missing.length}/${modules.length}` +
          ` module(s) missing: ${missing.join(', ')}`,
      });
    } else if (feature.status === 'in_progress' && missing.length === modules.length) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message:
          `feature ${feature.id} status='in_progress' but every declared module is missing` +
          ' — likely a stale start',
      });
    }
  }
  return findings;
}

export const statusDrift: DriftDetector = {
  name: NAME,
  run: runStatusDrift,
};
