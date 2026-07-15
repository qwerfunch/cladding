// Cladding · drift detector · DELIVERABLE_INTEGRITY
//
// Companion to stage_2.4 (DELIVERABLE_SMOKE). Pure, deterministic, zero-side-effect
// — it NEVER executes anything (that is the stage's job). Two checks, done-only:
//   - project.deliverable.path declared but ABSENT on disk → error (blocking): a
//     project that has shipped a `done` feature must have its declared entry present.
//   - done features ship modules[] but NO project.deliverable is declared → info
//     before the shared eight-feature maturity boundary, warn after it:
//     the gate cannot smoke-test the shipped entry, so a broken entry could ship
//     green (the Mini-Lang S5 failure). The graduated signal keeps early
//     domain/library slices completable while ensuring a grown project's omitted
//     smoke decision remains auditable and strict-gate actionable.
//
// BOUNDARY: presence/absence only. Whether the entry RUNS is stage_2.4; whether it
// is CORRECT per spec is the impl-blind oracle (stage_2.3).

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'DELIVERABLE_INTEGRITY';

/** Shared maturity scale: early domain/library slices need not expose an entry yet. */
export const DEFAULT_MIN_FEATURES_FOR_DELIVERABLE = 8;

function runDeliverableIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const deliverable = spec.project.deliverable;
  const doneWithModules = spec.features.filter((f) => f.status === 'done' && (f.modules?.length ?? 0) > 0);
  if (!deliverable) {
    if (doneWithModules.length === 0) return [];
    return [
      {
        detector: NAME,
        severity: spec.features.length >= DEFAULT_MIN_FEATURES_FOR_DELIVERABLE ? 'warn' : 'info',
        message:
          `${doneWithModules.length} done feature(s) ship modules but project.deliverable is not declared — ` +
          'the gate cannot smoke-test the shipped entry, so a broken entry point could ship green. ' +
          'Declare project.deliverable {path, is_safe_to_smoke: true} to enable DELIVERABLE_SMOKE (stage_2.4).',
      },
    ];
  }
  if (!existsSync(join(cwd, deliverable.path))) {
    return [
      {
        detector: NAME,
        severity: 'error',
        path: deliverable.path,
        message: `project.deliverable.path '${deliverable.path}' is declared but does not exist on disk.`,
      },
    ];
  }
  return [];
}

export const deliverableIntegrity: DriftDetector = {
  name: NAME,
  run: runDeliverableIntegrity,
};
