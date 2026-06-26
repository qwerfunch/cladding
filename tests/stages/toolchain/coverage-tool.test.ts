// Cladding · unit tests for stages/toolchain/coverage-tool.ts
//
// Kotlin coverage tool selection: explicit gate.coverage > Kover auto-detect >
// jacoco default. Auto-detect must reach the Kover plugin even when it is
// declared outside the module build (version catalog, convention plugin).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  dirHasKover,
  kotlinCoverageReport,
  kotlinCoverageTask,
  resolveKotlinCoverageTool,
} from '../../../src/stages/toolchain/coverage-tool.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-covtool-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function write(rel: string, body = ''): void {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), {recursive: true});
  writeFileSync(p, body);
}

function writeGateConfig(coverage: string): void {
  write('.cladding/config.yaml', `gate:\n  coverage: ${coverage}\n`);
}

describe('resolveKotlinCoverageTool — explicit config wins', () => {
  test('gate.coverage: kover', () => {
    write('build.gradle.kts'); // no kover token anywhere
    writeGateConfig('kover');
    expect(resolveKotlinCoverageTool(dir)).toBe('kover');
  });

  test('gate.coverage: jacoco overrides Kover auto-detect', () => {
    write('build.gradle.kts', 'plugins { id("org.jetbrains.kotlinx.kover") }');
    writeGateConfig('jacoco');
    expect(resolveKotlinCoverageTool(dir)).toBe('jacoco');
  });
});

describe('resolveKotlinCoverageTool — auto-detect', () => {
  test('Kover in the root build script', () => {
    write('build.gradle.kts', 'plugins { id("org.jetbrains.kotlinx.kover") }');
    expect(resolveKotlinCoverageTool(dir)).toBe('kover');
  });

  test('Kover declared only in the version catalog (gradle/libs.versions.toml)', () => {
    write('build.gradle.kts', 'plugins { kotlin("jvm") }');
    write('gradle/libs.versions.toml', 'kover = { id = "org.jetbrains.kotlinx.kover", version = "0.9.3" }');
    expect(resolveKotlinCoverageTool(dir)).toBe('kover');
  });

  test('Kover declared only in a buildSrc convention plugin', () => {
    write('build.gradle.kts', 'plugins { kotlin("jvm") }');
    write('buildSrc/src/main/kotlin/kotlin-library.gradle.kts', 'plugins { id("org.jetbrains.kotlinx.kover") }');
    expect(resolveKotlinCoverageTool(dir)).toBe('kover');
  });

  test('no Kover anywhere → jacoco default', () => {
    write('build.gradle.kts', 'plugins { kotlin("jvm") }');
    expect(resolveKotlinCoverageTool(dir)).toBe('jacoco');
  });
});

describe('task + report path mapping', () => {
  test('kover → koverXmlReport + kover report path', () => {
    writeGateConfig('kover');
    expect(kotlinCoverageTask(dir)).toBe('koverXmlReport');
    expect(kotlinCoverageReport(dir)).toBe('build/reports/kover/report.xml');
  });

  test('jacoco → jacocoTestReport + jacoco report path', () => {
    writeGateConfig('jacoco');
    expect(kotlinCoverageTask(dir)).toBe('jacocoTestReport');
    expect(kotlinCoverageReport(dir)).toBe('build/reports/jacoco/test/jacocoTestReport.xml');
  });
});

describe('dirHasKover', () => {
  test('true when gradle.properties references kover', () => {
    write('gradle.properties', 'coverage.tool=kover\n');
    expect(dirHasKover(dir)).toBe(true);
  });
  test('false for a plain module', () => {
    write('build.gradle.kts', 'plugins { kotlin("jvm") }');
    expect(dirHasKover(dir)).toBe(false);
  });
});
