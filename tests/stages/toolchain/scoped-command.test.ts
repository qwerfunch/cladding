// Cladding · unit tests for stages/toolchain/scoped-command.ts
//
// The precedence brain: opts.cmd > gate.commands > module-scope > repo gate.
// Pins the Kover-vs-JaCoCo coverage branch, the repo/non-Gradle fallbacks, the
// `scope: repo` escape hatch, and the loud throw on an unmappable module.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {resolveStageCommand} from '../../../src/stages/toolchain/scoped-command.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-scopedcmd-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** A Gradle/Kotlin monorepo: root + modules a (kover) and b (no kover). */
function makeKotlinRepo(): void {
  writeFileSync(join(dir, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
  writeFileSync(join(dir, 'gradle.properties'), 'org.gradle.caching=true\n');
  // a .kt source so detectToolchain discriminates Kotlin from Java.
  mkdirSync(join(dir, 'src/main/kotlin'), {recursive: true});
  writeFileSync(join(dir, 'src/main/kotlin/Root.kt'), 'package root\n');
  // module a — applies the Kover plugin
  mkdirSync(join(dir, 'a'), {recursive: true});
  writeFileSync(join(dir, 'a/build.gradle.kts'), 'plugins { id("org.jetbrains.kotlinx.kover") }\n');
  writeFileSync(join(dir, 'a/gradle.properties'), 'type=kotlin-library\n');
  // module b — no Kover → JaCoCo fallback
  mkdirSync(join(dir, 'b'), {recursive: true});
  writeFileSync(join(dir, 'b/build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
  writeFileSync(join(dir, 'b/gradle.properties'), 'type=kotlin-library\n');
}

function writeGateConfig(body: string): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(join(dir, '.cladding', 'config.yaml'), body);
}

describe('resolveStageCommand — repo fallback', () => {
  test('no focus modules → the root aggregate gate (unchanged)', () => {
    makeKotlinRepo();
    const r = resolveStageCommand('test', {cwd: dir});
    expect(r.cmd).toBe('gradle');
    expect(r.args).toEqual(['test']);
  });

  test('non-Gradle repo ignores focusModules entirely', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    const r = resolveStageCommand('test', {cwd: dir, focusModules: ['a']});
    expect(r.cmd).toBe('npx');
    expect(r.args).toEqual(['--no-install', 'vitest', 'run']);
  });
});

describe('resolveStageCommand — module scope', () => {
  test('type stage batches compileKotlin + compileTestKotlin per project', () => {
    makeKotlinRepo();
    const r = resolveStageCommand('type', {cwd: dir, focusModules: ['a', 'b']});
    expect(r.cmd).toBe('gradle');
    expect(r.args).toEqual([
      ':a:compileKotlin',
      ':a:compileTestKotlin',
      ':b:compileKotlin',
      ':b:compileTestKotlin',
    ]);
  });

  test('test stage scopes to :project:test in one invocation', () => {
    makeKotlinRepo();
    const r = resolveStageCommand('test', {cwd: dir, focusModules: ['a', 'b']});
    expect(r.args).toEqual([':a:test', ':b:test']);
  });

  test('coverage is Kover-first: a→koverXmlReport (has kover), b→jacocoTestReport', () => {
    makeKotlinRepo();
    const r = resolveStageCommand('coverage', {cwd: dir, focusModules: ['a', 'b']});
    expect(r.args).toEqual([':a:koverXmlReport', ':b:jacocoTestReport']);
  });

  test('lint scopes to :project:ktlintCheck', () => {
    makeKotlinRepo();
    const r = resolveStageCommand('lint', {cwd: dir, focusModules: ['a']});
    expect(r.args).toEqual([':a:ktlintCheck']);
  });

  test('THROWS on a module path that escapes the repo (no silent whole-repo fallback)', () => {
    makeKotlinRepo();
    expect(() => resolveStageCommand('test', {cwd: dir, focusModules: ['../escape']})).toThrow();
  });
});

describe('resolveStageCommand — overrides', () => {
  test('opts.cmd wins over everything', () => {
    makeKotlinRepo();
    const r = resolveStageCommand('test', {cwd: dir, focusModules: ['a'], cmd: 'echo', args: ['hi']});
    expect(r).toMatchObject({cmd: 'echo', args: ['hi']});
  });

  test('gate.commands template token-expands against the focus projects', () => {
    makeKotlinRepo();
    writeGateConfig('gate:\n  commands:\n    test: ["./gradlew", "{modules:test}", "--info"]\n');
    const r = resolveStageCommand('test', {cwd: dir, focusModules: ['a', 'b']});
    expect(r.cmd).toBe('./gradlew');
    expect(r.args).toEqual([':a:test', ':b:test', '--info']);
  });

  test('scope: repo forces the root aggregate even with focus modules', () => {
    makeKotlinRepo();
    writeGateConfig('gate:\n  scope: repo\n');
    const r = resolveStageCommand('test', {cwd: dir, focusModules: ['a']});
    expect(r.args).toEqual(['test']);
  });

  test('a {modules:…} template with no focus modules falls back to the repo gate', () => {
    makeKotlinRepo();
    writeGateConfig('gate:\n  commands:\n    test: ["./gradlew", "{modules:test}"]\n');
    const r = resolveStageCommand('test', {cwd: dir});
    expect(r.args).toEqual(['test']);
  });
});
