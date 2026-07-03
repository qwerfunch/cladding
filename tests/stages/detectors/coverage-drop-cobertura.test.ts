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
//   - AC-c6dae481: no coverage.xml → info (degrade, no new failure mode);
//     a present-but-malformed coverage.xml → no findings, no throw.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
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

function run(): readonly {detector: string; severity: string; message: string}[] {
  return coverageDrop.run({cwd: dir}).filter((f) => f.detector === 'COVERAGE_DROP');
}

describe('COVERAGE_DROP detector (Cobertura / Python)', () => {
  test('WARN when Cobertura line-rate 0.65 (65%) is below the 70% floor (AC-b6853f60)', () => {
    makePythonProject();
    writeCobertura('0.65');
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    // Byte-identical message shape + floor to the istanbul/jacoco paths
    // (jacoco pins `line coverage 55.0% < floor 70%`) — the identical drop
    // policy AC-b6853f60 requires. The `70%` here is the shared FLOOR_PERCENT.
    expect(findings[0].message).toBe('line coverage 65.0% < floor 70%');
  });

  test('CLEAN when Cobertura line-rate 0.85 (85%) meets the floor (AC-b6853f60)', () => {
    makePythonProject();
    writeCobertura('0.85');
    expect(run()).toHaveLength(0);
  });

  test('no coverage.xml in a python repo → single info finding, no failure (AC-c6dae481)', () => {
    makePythonProject();
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('coverage.xml');
    expect(findings[0].message).toContain('not present');
  });

  test('present-but-malformed coverage.xml → no findings, no throw (AC-c6dae481)', () => {
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

  test('garbage (non-XML) coverage.xml → no findings, no throw (AC-c6dae481)', () => {
    makePythonProject();
    writeFileSync(join(dir, 'coverage.xml'), 'not xml at all <<< >>>');
    let findings: readonly unknown[] = [];
    expect(() => {
      findings = run();
    }).not.toThrow();
    expect(findings).toEqual([]);
  });
});
