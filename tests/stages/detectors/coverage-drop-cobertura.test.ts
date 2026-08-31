// Cladding · unit tests for stages/detectors/coverage-drop.ts (Cobertura / Python)
//
// COVERAGE_DROP resolves its language like ARCHITECTURE_FROM_SPEC: the spec's
// declared `project.language` wins, falling back to manifest detection when no
// spec loads. These fixtures carry no spec.yaml, so the `pyproject.toml`
// manifest is what marks them Python, after which the detector reads the
// Cobertura `coverage.xml` and takes the report-level `<coverage line-rate="…">`
// fraction (0–1) as the overall line pct. Pins (F-803386ab):
//   - AC-b6853f60: line-rate 0.65 → warn under the SAME 70% floor with the SAME
//     message shape as istanbul/jacoco; 0.85 → clean (identical drop policy).
//   - AC-c6dae481: no supported Python Cobertura report → no findings;
//     a present-but-malformed coverage.xml → no findings, no throw. Istanbul
//     and Kotlin retain their established missing-report info behavior.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {coverageDrop} from '../../../src/stages/detectors/coverage-drop.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-cov-cobertura-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/**
 * Marks the temp dir as a Python project via its manifest. With no spec.yaml
 * in the fixture, COVERAGE_DROP's spec-language resolution falls back to
 * detectToolchain, so the pyproject.toml is what selects the Cobertura path.
 */
function makePythonProject(): void {
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "0.0.0"\n');
}

/**
 * Writes a Cobertura report whose ROOT `<coverage line-rate="…">` carries the
 * report-level rate. A per-package `line-rate` with a *different* value is also
 * emitted, pinning "the root (first) occurrence is the report-level rate", not a
 * package aggregate.
 */
function writeCobertura(rootRate: string): void {
  writeFileSync(
    join(dir, 'coverage.xml'),
    '<?xml version="1.0" ?>\n' +
      `<coverage line-rate="${rootRate}" branch-rate="0.5" version="6.5" timestamp="1">\n` +
      '  <packages>\n' +
      '    <package name="x" line-rate="0.99">\n' +
      '    </package>\n' +
      '  </packages>\n' +
      '</coverage>\n',
  );
}

function writeIstanbul(project: string, linePct: number): void {
  writeFileSync(join(project, 'package.json'), '{"name":"fixture"}\n');
  mkdirSync(join(project, 'coverage'), {recursive: true});
  writeFileSync(
    join(project, 'coverage', 'coverage-summary.json'),
    JSON.stringify({total: {lines: {pct: linePct}}}),
  );
}

function writeJacoco(project: string): void {
  mkdirSync(join(project, 'src', 'main', 'kotlin'), {recursive: true});
  mkdirSync(join(project, 'build', 'reports', 'jacoco', 'test'), {recursive: true});
  writeFileSync(join(project, 'build.gradle.kts'), 'plugins {}\n');
  writeFileSync(join(project, 'src', 'main', 'kotlin', 'Main.kt'), 'fun main() = Unit\n');
  writeFileSync(
    join(project, 'build', 'reports', 'jacoco', 'test', 'jacocoTestReport.xml'),
    '<report><counter type="LINE" missed="35" covered="65"/></report>\n',
  );
}

function run(): readonly {detector: string; severity: string; message: string}[] {
  return coverageDrop.run({cwd: dir}).filter((f) => f.detector === 'COVERAGE_DROP');
}

describe('COVERAGE_DROP detector (Cobertura / Python)', () => {
  test('[covers:F-803386ab/AC-b6853f60] Cobertura reads the root line-rate and applies the Istanbul warning floor and message', () => {
    makePythonProject();
    writeCobertura('0.65');
    const cobertura = run();
    expect(cobertura).toHaveLength(1);
    expect(cobertura[0].severity).toBe('warn');
    // Byte-identical message shape + floor to the istanbul/jacoco paths
    // (jacoco pins `line coverage 55.0% < floor 70%`) — the identical drop
    // policy AC-b6853f60 requires. The `70%` here is the shared FLOOR_PERCENT.
    expect(cobertura[0].message).toBe('line coverage 65.0% < floor 70%');

    const jsProject = join(dir, 'istanbul');
    mkdirSync(jsProject, {recursive: true});
    writeIstanbul(jsProject, 65);
    const istanbul = coverageDrop.run({cwd: jsProject}).filter((f) => f.detector === 'COVERAGE_DROP');
    expect(istanbul).toEqual(cobertura);

    const kotlinProject = join(dir, 'jacoco');
    writeJacoco(kotlinProject);
    const jacoco = coverageDrop.run({cwd: kotlinProject}).filter((f) => f.detector === 'COVERAGE_DROP');
    expect(jacoco).toEqual(cobertura);
  });

  test('CLEAN when Cobertura line-rate 0.85 (85%) meets the floor (AC-b6853f60)', () => {
    makePythonProject();
    writeCobertura('0.85');
    expect(run()).toHaveLength(0);
  });

  test('[covers:F-803386ab/AC-c6dae481] Python workspace without a supported Cobertura report returns no findings', () => {
    makePythonProject();
    expect(run()).toEqual([]);
  });

  test('[covers:F-803386ab/AC-c6dae481] present-but-malformed Cobertura remains silent', () => {
    makePythonProject();
    // Well-formed-enough to read but carrying no report-level line-rate attribute:
    // readCoberturaLinePct returns null → the Cobertura branch degrades to [].
    writeFileSync(join(dir, 'coverage.xml'), '<coverage version="6.5"><packages/></coverage>\n');
    let findings: readonly {severity: string}[] = [];
    expect(() => {
      findings = run();
    }).not.toThrow();
    expect(findings).toEqual([]);
  });

  test('[covers:F-803386ab/AC-c6dae481] garbage Cobertura remains silent', () => {
    makePythonProject();
    writeFileSync(join(dir, 'coverage.xml'), 'not xml at all <<< >>>');
    let findings: readonly unknown[] = [];
    expect(() => {
      findings = run();
    }).not.toThrow();
    expect(findings).toEqual([]);
  });

  test('[covers:F-803386ab/AC-c6dae481] missing Istanbul and Kotlin reports retain their info findings', () => {
    const jsProject = join(dir, 'istanbul-absent');
    mkdirSync(jsProject, {recursive: true});
    writeFileSync(join(jsProject, 'package.json'), '{"name":"fixture"}\n');
    const istanbul = coverageDrop.run({cwd: jsProject}).filter((f) => f.detector === 'COVERAGE_DROP');
    expect(istanbul).toHaveLength(1);
    expect(istanbul[0].severity).toBe('info');
    expect(istanbul[0].message).toContain('coverage/coverage-summary.json not present');

    const kotlinProject = join(dir, 'kotlin-absent');
    mkdirSync(join(kotlinProject, 'src', 'main', 'kotlin'), {recursive: true});
    writeFileSync(join(kotlinProject, 'build.gradle.kts'), 'plugins {}\n');
    writeFileSync(join(kotlinProject, 'src', 'main', 'kotlin', 'Main.kt'), 'fun main() = Unit\n');
    const kotlin = coverageDrop.run({cwd: kotlinProject}).filter((f) => f.detector === 'COVERAGE_DROP');
    expect(kotlin).toHaveLength(1);
    expect(kotlin[0].severity).toBe('info');
    expect(kotlin[0].message).toContain('not present');
  });
});
