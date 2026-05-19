// Cladding · drift detector · STALE_SPECIFICATION
//
// Detector #16 from the catalog (axis: spec_vs_test, severity: warn).
// Surfaces specs whose lifecycle metadata is inconsistent:
//   - feature has `archived_at` but `status !== 'archived'`
//   - feature has `superseded_by` but `archived_at` is missing
//   - feature.status='archived' but its modules still exist on disk
//     (archived code not yet removed → warn, not error, because the
//     removal cadence is project-owned)

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'STALE_SPECIFICATION';

function runStaleSpecification(opts: CommandStageOptions): readonly DriftFinding[] {
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
  for (const f of spec.features) {
    if (f.archived_at && f.status !== 'archived') {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message:
          `feature ${f.id} has archived_at but status='${f.status}' (expected 'archived')`,
      });
    }
    if (f.superseded_by && !f.archived_at) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message: `feature ${f.id} has superseded_by but no archived_at`,
      });
    }
    if (f.status === 'archived') {
      const surviving = (f.modules ?? []).filter((m) => existsSync(join(cwd, m)));
      if (surviving.length > 0) {
        findings.push({
          detector: NAME,
          severity: 'warn',
          message:
            `feature ${f.id} is archived but ${surviving.length} module(s) still exist:` +
            ` ${surviving.join(', ')}`,
        });
      }
    }
  }
  return findings;
}

export const staleSpecification: DriftDetector = {
  name: NAME,
  run: runStaleSpecification,
};
