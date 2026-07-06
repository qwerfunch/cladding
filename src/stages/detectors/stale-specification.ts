// Cladding · drift detector · STALE_SPECIFICATION
//
// Detector #16 from the catalog (axis: spec_vs_test, severity: warn).
// Surfaces specs whose lifecycle metadata is inconsistent:
//   - feature has `archived_at` but `status !== 'archived'`
//   - feature has `superseded_by` but `archived_at` is missing
//   - feature.status='archived' but its modules still exist on disk
//     (archived code not yet removed → warn, not error, because the
//     removal cadence is project-owned)
//   - feature is planned / in_progress with declared modules that are ALL
//     still absent on disk — the spec-first window (F-c3747d7d): the
//     documented author-then-implement state, reported at `info` (normal,
//     not stale), matching MISSING_IMPLEMENTATION / STATUS_DRIFT. Before
//     F-c3747d7d this branch was a `warn` + propose-archive (Phased
//     Decommissioning Tier 2); U7 completed the window recognition, so the
//     fresh-window case no longer proposes archiving (you don't archive a
//     feature you're actively implementing). The three lifecycle-mismatch
//     branches above keep their `warn` + propose-archive.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {isSpecFirstWindow} from './spec-first-window.js';
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
    // Spec-first window (F-c3747d7d): a planned/in_progress feature whose
    // declared modules are ALL still absent is the documented author-then-
    // implement state — the NORMAL intermediate state, not stale. It reports
    // `info` (matching MISSING_IMPLEMENTATION / STATUS_DRIFT) with NO
    // propose-archive suggestion, so the Stop hook and --strict gate stop
    // fighting the cycle. `isSpecFirstWindow` is the shared SSoT window
    // predicate (identical set to the former `planned || in_progress`), so the
    // window can never drift between the three detectors. Features with no
    // modules declared at all stay excluded (design-only / doc-only entries).
    if (
      isSpecFirstWindow(f.status) &&
      (f.modules?.length ?? 0) > 0 &&
      !(f.modules ?? []).some((m) => existsSync(join(cwd, m)))
    ) {
      findings.push({
        detector: NAME,
        severity: 'info',
        message:
          `feature ${f.id} (status='${f.status}') declares ${f.modules?.length ?? 0} ` +
          "module(s) that aren't built yet — the normal state while implementing (not stale)",
      });
    }
  }
  return findings;
}

export const staleSpecification: DriftDetector = {
  name: NAME,
  run: runStaleSpecification,
};
