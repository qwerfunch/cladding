// Cladding · drift detector · UNTESTED_AC
//
// Detector #13 from the catalog (axis: spec_vs_test, severity: error).
// v0.1 floor: resolves each AC's `test_refs[]` to evidence on disk.
//   - bare path (e.g. `tests/foo.test.ts`) → file must exist
//   - `self-dogfood:<name>` prefix → skipped (npm script aliases)
//   - `fixture:<name>` prefix → skipped (synthetic conformance fixtures)
//   - empty `test_refs` → handled by MISSING_TESTS, not here
//
// Status policy: only `status: done` features are checked. `planned`,
// `in_progress`, `blocked`, and `archived` features are skipped — their
// test_refs document intended evidence paths that need not exist yet.
//
// The richer "test_refs resolve to a real vitest test name" variant
// requires vitest AST introspection and lands behind the `specialists`
// agent later.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'UNTESTED_AC';
const SKIPPABLE_PREFIXES = ['self-dogfood:', 'fixture:'];

function isSkippable(ref: string): boolean {
  return SKIPPABLE_PREFIXES.some((p) => ref.startsWith(p));
}

function runUntestedAc(opts: CommandStageOptions): readonly DriftFinding[] {
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
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        if (isSkippable(ref)) continue;
        if (existsSync(join(cwd, ref))) continue;
        findings.push({
          detector: NAME,
          severity: 'error',
          path: ref,
          message: `${feature.id}.${ac.id} test_ref '${ref}' resolves to nothing on disk`,
        });
      }
    }
  }
  return findings;
}

export const untestedAc: DriftDetector = {
  name: NAME,
  run: runUntestedAc,
};
