// Cladding · unit tests for stages/detectors/coverage-drop.ts (JaCoCo / Kotlin)
//
// COVERAGE_DROP resolves its coverage artifact + format via the detected
// toolchain. For a Kotlin project (build.gradle.kts + a .kt source) it reads
// build/reports/jacoco/test/jacocoTestReport.xml and computes the LAST
// report-level LINE counter as covered/(covered+missed). Pins: a 55% JaCoCo
// report warns under the 70% floor; a 90% report is clean; a TS project still
// reads the istanbul coverage-summary.json unchanged (no regression).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {coverageDrop} from '../../../src/stages/detectors/coverage-drop.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-cov-jacoco-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Marks the temp dir as a Kotlin project (gradle manifest + a .kt source). */
function makeKotlinProject(): void {
  writeFileSync(join(dir, 'build.gradle.kts'), '');
  const kt = join(dir, 'src', 'main', 'kotlin');
  mkdirSync(kt, {recursive: true});
  writeFileSync(join(kt, 'App.kt'), 'package x\nfun main() {}\n');
}

/**
 * Writes a JaCoCo XML report whose final report-level LINE counter has the
 * given covered/missed split. An earlier per-class counter is included so the
 * test also pins "LAST counter wins".
 */
function writeJacoco(covered: number, missed: number): void {
  const out = join(dir, 'build', 'reports', 'jacoco', 'test');
  mkdirSync(out, {recursive: true});
  writeFileSync(
    join(out, 'jacocoTestReport.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<report name="test">\n' +
      '  <package name="x">\n' +
      '    <counter type="LINE" missed="1" covered="1"/>\n' +
      '  </package>\n' +
      '  <counter type="BRANCH" missed="3" covered="7"/>\n' +
      `  <counter type="LINE" missed="${missed}" covered="${covered}"/>\n` +
      '</report>\n',
  );
}

function run(): readonly {detector: string; severity: string; message: string}[] {
  return coverageDrop.run({cwd: dir}).filter((f) => f.detector === 'COVERAGE_DROP');
}

describe('COVERAGE_DROP detector (JaCoCo / Kotlin)', () => {
  test("[covers:F-dd51b42c/AC-2d888ee2] WARN when JaCoCo line coverage (55%) is below the 70% floor", () => {
    makeKotlinProject();
    writeJacoco(55, 45); // 55 / (55 + 45) = 55.0%
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toBe('line coverage 55.0% < floor 70%');
  });

  test('CLEAN when JaCoCo line coverage (90%) meets the floor', () => {
    makeKotlinProject();
    writeJacoco(90, 10); // 90.0%
    expect(run()).toHaveLength(0);
  });

  test('a TS project still reads istanbul coverage-summary.json unchanged', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const cov = join(dir, 'coverage');
    mkdirSync(cov, {recursive: true});
    writeFileSync(
      join(cov, 'coverage-summary.json'),
      JSON.stringify({total: {lines: {pct: 42}}}),
    );
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toBe('line coverage 42.0% < floor 70%');
  });
});
