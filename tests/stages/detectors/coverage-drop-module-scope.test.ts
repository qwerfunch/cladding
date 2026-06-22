// Cladding · unit tests for COVERAGE_DROP under module scope
//
// With focusModules present on a Gradle repo, the detector collects EACH
// module's per-module report (Kover first, JaCoCo fallback) and merges their
// LINE counters into one aggregate — not the root summary. Pins the merge,
// the Kover/JaCoCo path coexistence, a missing report, and a mapping error.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {coverageDrop} from '../../../src/stages/detectors/coverage-drop.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-covscope-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function makeKotlinRepo(): void {
  // No root gradle.properties on purpose: the root is NOT a Gradle module here,
  // so an unmappable module path has no ancestor project → loud throw.
  writeFileSync(join(dir, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
  mkdirSync(join(dir, 'src/main/kotlin'), {recursive: true});
  writeFileSync(join(dir, 'src/main/kotlin/Root.kt'), 'package root\n');
}

function makeModule(name: string): void {
  mkdirSync(join(dir, name), {recursive: true});
  writeFileSync(join(dir, name, 'build.gradle.kts'), '');
  writeFileSync(join(dir, name, 'gradle.properties'), '\n');
}

function lineXml(missed: number, covered: number): string {
  return `<report><counter type="LINE" missed="${missed}" covered="${covered}"/></report>`;
}

function writeKover(name: string, missed: number, covered: number): void {
  const p = join(dir, name, 'build/reports/kover');
  mkdirSync(p, {recursive: true});
  writeFileSync(join(p, 'report.xml'), lineXml(missed, covered));
}

function writeJacoco(name: string, missed: number, covered: number): void {
  const p = join(dir, name, 'build/reports/jacoco/test');
  mkdirSync(p, {recursive: true});
  writeFileSync(join(p, 'jacocoTestReport.xml'), lineXml(missed, covered));
}

function run(focusModules: string[]) {
  return coverageDrop.run({cwd: dir, focusModules}).filter((f) => f.detector === 'COVERAGE_DROP');
}

describe('COVERAGE_DROP — module scope', () => {
  test('merges Kover (a) + JaCoCo (b) counters; ≥ floor → clean', () => {
    makeKotlinRepo();
    makeModule('a');
    makeModule('b');
    writeKover('a', 10, 90); // 90%
    writeJacoco('b', 40, 60); // 60% → merged 150/200 = 75%
    expect(run(['a', 'b'])).toEqual([]);
  });

  test('merged coverage below floor → a single warn', () => {
    makeKotlinRepo();
    makeModule('a');
    makeModule('b');
    writeKover('a', 90, 10);
    writeJacoco('b', 90, 10); // merged 20/200 = 10%
    const findings = run(['a', 'b']);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toMatch(/merged module line coverage/);
  });

  test('no report yet for any project → info (run stage_2.2 first)', () => {
    makeKotlinRepo();
    makeModule('a');
    const findings = run(['a']);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });

  test('unmappable module → error finding (no silent fallback)', () => {
    makeKotlinRepo();
    const findings = run(['ghost/module']);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });
});

describe('COVERAGE_DROP — repo level (no focus), Kotlin tool probe', () => {
  test('reads the root Kover report when present (no jacoco needed)', () => {
    makeKotlinRepo();
    const p = join(dir, 'build/reports/kover');
    mkdirSync(p, {recursive: true});
    writeFileSync(join(p, 'report.xml'), lineXml(5, 95)); // 95% ≥ floor
    expect(coverageDrop.run({cwd: dir}).filter((f) => f.detector === 'COVERAGE_DROP')).toEqual([]);
  });

  test('reads the root JaCoCo report when that is the one present', () => {
    makeKotlinRepo();
    const p = join(dir, 'build/reports/jacoco/test');
    mkdirSync(p, {recursive: true});
    writeFileSync(join(p, 'jacocoTestReport.xml'), lineXml(80, 20)); // 20% < floor
    const findings = coverageDrop.run({cwd: dir}).filter((f) => f.detector === 'COVERAGE_DROP');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });
});
