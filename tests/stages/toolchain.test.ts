// Cladding · unit tests for stages/toolchain/detect.ts

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {detectToolchain, gradleCmd} from '../../src/stages/toolchain/detect.js';

/** Writes a nested Kotlin source file (`src/main/kotlin/com/x/App.kt`). */
function writeKotlinSource(dir: string): void {
  const kt = join(dir, 'src', 'main', 'kotlin', 'com', 'x');
  mkdirSync(kt, {recursive: true});
  writeFileSync(join(kt, 'App.kt'), 'package com.x\nfun main() {}\n');
}

describe('detectToolchain', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-tc-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('package.json → typescript', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('typescript');
    expect(tc.gates.type?.cmd).toBe('npx');
  });

  test('pyproject.toml → python', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '');
    expect(detectToolchain(dir).language).toBe('python');
  });

  test('Cargo.toml → rust', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '');
    expect(detectToolchain(dir).language).toBe('rust');
  });

  test('go.mod → go', () => {
    writeFileSync(join(dir, 'go.mod'), '');
    expect(detectToolchain(dir).language).toBe('go');
  });

  test('empty dir → unknown', () => {
    expect(detectToolchain(dir).language).toBe('unknown');
  });

  test('priority: package.json beats pyproject.toml', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'pyproject.toml'), '');
    expect(detectToolchain(dir).language).toBe('typescript');
  });

  // ─── Kotlin first-class support (F-dd51b42c) ───

  test('build.gradle.kts + a nested .kt source → kotlin, ./gradlew gates when wrapper present', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), '');
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\n');
    writeKotlinSource(dir);
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('kotlin');
    expect(tc.gates.type?.cmd).toBe('./gradlew');
    expect(tc.gates.type?.args).toEqual(['compileKotlin', 'compileTestKotlin']);
    expect(tc.gates.lint?.cmd).toBe('./gradlew');
    expect(tc.gates.lint?.args).toEqual(['ktlintCheck']);
    expect(tc.gates.test?.args).toEqual(['test']);
    expect(tc.gates.coverage?.args).toEqual(['jacocoTestReport']);
    expect(tc.gates.secret?.cmd).toBe('gitleaks');
    // Kotlin deliberately ships no `arch` gate (spec-side ARCHITECTURE_FROM_SPEC).
    expect(tc.gates.arch).toBeUndefined();
  });

  test('coverage gate selects koverXmlReport when the build declares Kover', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), 'plugins { id("org.jetbrains.kotlinx.kover") }');
    writeKotlinSource(dir);
    expect(detectToolchain(dir).gates.coverage?.args).toEqual(['koverXmlReport']);
  });

  test('gate.coverage: jacoco config forces jacocoTestReport even with Kover present', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), 'plugins { id("org.jetbrains.kotlinx.kover") }');
    writeKotlinSource(dir);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), 'gate:\n  coverage: jacoco\n');
    expect(detectToolchain(dir).gates.coverage?.args).toEqual(['jacocoTestReport']);
  });

  test('build.gradle.kts + a .kt source but NO gradlew → bare gradle command', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), '');
    writeKotlinSource(dir);
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('kotlin');
    expect(tc.gates.type?.cmd).toBe('gradle');
  });

  test('pom.xml + a .kt source → kotlin (Kotlin probed before Java)', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    writeKotlinSource(dir);
    expect(detectToolchain(dir).language).toBe('kotlin');
  });

  test('pom.xml with NO .kt source → java fallback (no regression)', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('java');
    expect(tc.gates.type?.cmd).toBe('mvn');
  });

  test('build.gradle with NO .kt source → java fallback (no regression)', () => {
    writeFileSync(join(dir, 'build.gradle'), '');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('java');
    expect(tc.gates.type?.cmd).toBe('mvn');
  });
});

describe('gradleCmd', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-gradle-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('returns ./gradlew when a gradlew wrapper exists at the root', () => {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\n');
    expect(gradleCmd(dir)).toBe('./gradlew');
  });

  test('returns bare gradle when no wrapper is present', () => {
    expect(gradleCmd(dir)).toBe('gradle');
  });
});
