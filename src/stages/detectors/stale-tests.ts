// Cladding · drift detector · STALE_TESTS
//
// Detector #8 from the catalog (axis: code_vs_test, severity: warn).
// Flags test files whose last modification time is significantly
// older than the source modules under spec.yaml's features[].modules.
//
// v0.1 heuristic: if ANY tracked test file's mtime is older than the
// newest module mtime by more than 30 days, emit a warn. Lighter than
// a git-log diff but catches the common "we shipped a refactor and
// forgot the tests" pattern.

import {existsSync, statSync} from 'node:fs';
import {join} from 'node:path';

import {globSync} from 'tinyglobby';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'STALE_TESTS';
const STALE_DAYS = 30;
const TEST_PATTERN = ['tests/**/*.test.ts'];

function newestModuleMtime(cwd: string, modules: readonly string[]): number {
  let newest = 0;
  for (const m of modules) {
    const p = join(cwd, m);
    if (!existsSync(p)) continue;
    const t = statSync(p).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

function runStaleTests(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const allModules = spec.features.flatMap((f) => f.modules ?? []);
  const newest = newestModuleMtime(cwd, allModules);
  if (newest === 0) return [];

  const testFiles = globSync([...TEST_PATTERN], {cwd, dot: false});
  if (testFiles.length === 0) return [];

  const findings: DriftFinding[] = [];
  for (const testFile of testFiles) {
    const path = join(cwd, testFile);
    if (!existsSync(path)) continue;
    const testMtime = statSync(path).mtimeMs;
    const ageDays = (newest - testMtime) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_DAYS) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        path: testFile,
        message: `${testFile} is ${Math.round(ageDays)} days older than newest source module`,
      });
    }
  }
  return findings;
}

export const staleTests: DriftDetector = {
  name: NAME,
  run: runStaleTests,
};
