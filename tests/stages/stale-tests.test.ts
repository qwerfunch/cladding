// Cladding · unit tests for stages/detectors/stale-tests.ts
//
// Detector under test flags test files whose mtime is more than 30 days
// older than the newest source module's mtime. Time-based logic needs
// explicit coverage because mtime arithmetic is easy to flip.
//
// Test isolation strategy: we control mtime explicitly via utimesSync,
// stamping fresh sources with `now` and stale tests with `now - 60 days`.
// Bypasses the "real wall-clock time" trap that makes time-based tests
// flaky.

import {mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {staleTests} from '../../stages/detectors/stale-tests.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

const NOW_SEC = Math.floor(Date.now() / 1000);
const SIXTY_DAYS_AGO = NOW_SEC - 60 * 24 * 60 * 60;
const TEN_DAYS_AGO = NOW_SEC - 10 * 24 * 60 * 60;

function stamp(path: string, sec: number): void {
  utimesSync(path, sec, sec);
}

describe('STALE_TESTS detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-stale-tests-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'stages'), {recursive: true});
    mkdirSync(join(dir, 'tests'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('test mtime fresher than source → no finding', () => {
    const src = join(dir, 'stages', 'alpha.ts');
    const t = join(dir, 'tests', 'alpha.test.ts');
    writeFileSync(src, 'export const a = 1;\n');
    writeFileSync(t, 'import {a} from "../stages/alpha.js";\n');
    stamp(src, SIXTY_DAYS_AGO);
    stamp(t, NOW_SEC);
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    expect(staleTests.run({cwd: dir})).toEqual([]);
  });

  test('test mtime >30 days older than newest source → warn finding', () => {
    const src = join(dir, 'stages', 'alpha.ts');
    const t = join(dir, 'tests', 'alpha.test.ts');
    writeFileSync(src, 'export const a = 1;\n');
    writeFileSync(t, 'stale\n');
    stamp(src, NOW_SEC);
    stamp(t, SIXTY_DAYS_AGO);
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    const findings = staleTests.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('tests/alpha.test.ts');
    expect(findings[0].message).toMatch(/\d+ days older/);
  });

  test('test mtime <30 days older than source → no finding (within tolerance)', () => {
    const src = join(dir, 'stages', 'alpha.ts');
    const t = join(dir, 'tests', 'alpha.test.ts');
    writeFileSync(src, 'export const a = 1;\n');
    writeFileSync(t, 'export {};\n');
    stamp(src, NOW_SEC);
    stamp(t, TEN_DAYS_AGO);
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    expect(staleTests.run({cwd: dir})).toEqual([]);
  });

  test('no test files at all → no findings', () => {
    writeFileSync(join(dir, 'stages', 'alpha.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    expect(staleTests.run({cwd: dir})).toEqual([]);
  });

  test('multiple stale tests → one finding per offender', () => {
    const src = join(dir, 'stages', 'alpha.ts');
    const t1 = join(dir, 'tests', 'a.test.ts');
    const t2 = join(dir, 'tests', 'b.test.ts');
    writeFileSync(src, 'export const a = 1;\n');
    writeFileSync(t1, 'stale\n');
    writeFileSync(t2, 'stale\n');
    stamp(src, NOW_SEC);
    stamp(t1, SIXTY_DAYS_AGO);
    stamp(t2, SIXTY_DAYS_AGO);
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    const findings = staleTests.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  test('no source modules tracked → silent (cannot compute baseline)', () => {
    writeFileSync(join(dir, 'tests', 'orphan.test.ts'), 'stale\n');
    stamp(join(dir, 'tests', 'orphan.test.ts'), SIXTY_DAYS_AGO);
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    expect(staleTests.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = staleTests.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});
