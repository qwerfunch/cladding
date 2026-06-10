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
// requires vitest AST introspection and lands behind the `developer`
// agent later.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'UNTESTED_AC';
const SKIPPABLE_PREFIXES = ['self-dogfood:', 'fixture:'];

function isSkippable(ref: string): boolean {
  return SKIPPABLE_PREFIXES.some((p) => ref.startsWith(p));
}

function runUntestedAc(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        if (isSkippable(ref)) continue;
        // A `path#anchor` test_ref points at a specific test WITHIN a file (a human
        // pointer, e.g. `tests/x.test.ts#parses a tag`) — resolve only the path part.
        // Earlier the whole string was checked literally, so a natural `#anchor` ref
        // "resolved to nothing" with no hint of the accepted forms; an autonomous run
        // burned dozens of turns reverse-engineering the detector.
        const pathPart = ref.split('#', 1)[0];
        if (existsSync(join(cwd, ref)) || (pathPart && existsSync(join(cwd, pathPart)))) continue;
        findings.push({
          detector: NAME,
          severity: 'error',
          path: ref,
          message:
            `${feature.id}.${ac.id} test_ref '${ref}' resolves to nothing on disk — a test_ref must be a real ` +
            `file path (e.g. 'tests/x.test.ts', optionally with a '#<test name>' anchor) or a ` +
            `'self-dogfood:<script>' / 'fixture:<name>' prefix.`,
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
