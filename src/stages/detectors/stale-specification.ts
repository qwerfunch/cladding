// Cladding · drift detector · STALE_SPECIFICATION
//
// Detector #16 from the catalog (axis: spec_vs_test, severity: warn).
// Surfaces specs whose lifecycle metadata is inconsistent:
//   - feature has `archived_at` but `status !== 'archived'`
//   - feature has `superseded_by` but `archived_at` is missing
//   - feature.status='archived' but its modules still exist on disk
//     (archived code not yet removed → warn, not error, because the
//     removal cadence is project-owned)
//   - feature is non-final (planned / in_progress) with **zero** module
//     references that still resolve — Phased Decommissioning Tier 2
//     (ironclad-design 07-ssot-init §5). Emits a `propose-archive`
//     suggestion that `clad sync --propose-archive` walks.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'STALE_SPECIFICATION';

function runStaleSpecification(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const f of spec.features) {
    if (f.archived_at && f.status !== 'archived') {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message:
          `feature ${f.id} has archived_at but status='${f.status}' (expected 'archived')`,
        suggestion: {
          action: 'propose-archive',
          args: {
            featureId: f.id,
            reason: `archived_at already set but status is '${f.status}'`,
          },
        },
      });
    }
    if (f.superseded_by && !f.archived_at) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message: `feature ${f.id} has superseded_by but no archived_at`,
        suggestion: {
          action: 'propose-archive',
          args: {
            featureId: f.id,
            reason: `superseded by ${f.superseded_by} but missing archived_at`,
          },
        },
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
    // Phased Decommissioning Tier 2 trigger — a non-final feature whose
    // every declared module has vanished from disk is the clearest
    // unambiguous signal that the spec entry has outlived its code.
    // Features with no modules declared at all are intentionally
    // excluded — they may be design-only or doc-only entries that
    // legitimately have nothing to garbage-collect.
    if (
      (f.status === 'planned' || f.status === 'in_progress') &&
      (f.modules?.length ?? 0) > 0 &&
      !(f.modules ?? []).some((m) => existsSync(join(cwd, m)))
    ) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message:
          `feature ${f.id} (status='${f.status}') declares ${f.modules?.length ?? 0} module(s) but none exist on disk — consider archiving`,
        suggestion: {
          action: 'propose-archive',
          args: {
            featureId: f.id,
            reason: 'all declared modules vanished from disk',
          },
        },
      });
    }
  }
  return findings;
}

export const staleSpecification: DriftDetector = {
  name: NAME,
  run: runStaleSpecification,
};
