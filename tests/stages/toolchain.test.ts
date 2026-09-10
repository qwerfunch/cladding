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

  test('[covers:F-004/AC-006] reads the manifest priority chain and returns unknown when no manifest remains', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'pyproject.toml'), '');
    expect(detectToolchain(dir).language).toBe('typescript');

    rmSync(join(dir, 'package.json'));
    expect(detectToolchain(dir).language).toBe('python');

    rmSync(join(dir, 'pyproject.toml'));
    expect(detectToolchain(dir).language).toBe('unknown');
  });

  // ─── Kotlin first-class support (F-dd51b42c) ───

  test('[covers:F-dd51b42c/AC-2dc3e787] build.gradle.kts + a nested .kt source → kotlin, ./gradlew gates when wrapper present', () => {
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

  test('[covers:F-dd51b42c/AC-df69edf9] build.gradle.kts + a .kt source but NO gradlew → bare gradle command', () => {
    writeFileSync(join(dir, 'build.gradle.kts'), '');
    writeKotlinSource(dir);
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('kotlin');
    expect(tc.gates.type?.cmd).toBe('gradle');
  });

  test('[covers:F-dd51b42c/AC-2dc3e787] pom.xml + a .kt source → kotlin (Kotlin probed before Java)', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    writeKotlinSource(dir);
    expect(detectToolchain(dir).language).toBe('kotlin');
  });

  test('[covers:F-dd51b42c/AC-ae2d4113] pom.xml with NO .kt source → java fallback (no regression)', () => {
    writeFileSync(join(dir, 'pom.xml'), '<project/>');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('java');
    expect(tc.gates.type?.cmd).toBe('mvn');
  });

  test('[covers:F-dd51b42c/AC-ae2d4113] build.gradle with NO .kt source → java fallback (no regression)', () => {
    writeFileSync(join(dir, 'build.gradle'), '');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('java');
    expect(tc.gates.type?.cmd).toBe('mvn');
  });
  // ─── TS/JS linter config detection (F-b2094740) ───
  test('[covers:F-b2094740/AC-7bf859] typescript + biome.json → lint gate is biome', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('typescript');
    expect(tc.gates.lint).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'biome', 'lint', '.']});
  });

  test('[covers:F-b2094740/AC-7bf859] typescript + .oxlintrc.json → lint gate is oxlint', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.oxlintrc.json'), '{}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'oxlint']});
  });

  test('[covers:F-b2094740/AC-7bf859] typescript + .oxlintrc.jsonc → lint gate is oxlint', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.oxlintrc.jsonc'), '{}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'oxlint']});
  });

  test('[covers:F-b2094740/AC-7bf859] typescript + oxlint.config.ts → lint gate is oxlint', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'oxlint.config.ts'), 'export default {}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'oxlint']});
  });

  test('[covers:F-b2094740/AC-7bf859] selection follows declarations — add biome.json enables biome, remove it leaves lint unconfigured', () => {
    // State-transition: proves resolveTsLint actually reads the filesystem each call,
    // not a hard-coded return (defeats the one-way-test critique).
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(detectToolchain(dir).gates.lint).toBeUndefined();
    writeFileSync(join(dir, 'biome.json'), '{}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'biome', 'lint', '.']});
    rmSync(join(dir, 'biome.json'));
    expect(detectToolchain(dir).gates.lint).toBeUndefined();
  });

  test('[covers:F-b2094740/AC-7bf859] typescript with no lint script or config → lint gate is honestly unconfigured', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(detectToolchain(dir).gates.lint).toBeUndefined();
  });

  test('[covers:F-b2094740/AC-7bf859] typescript scripts.lint → lint gate runs the exact project-owned workflow', () => {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"lint":"eslint src --max-warnings=0"}}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npm', args: ['run', '--silent', 'lint']});
  });

  test('[covers:F-b2094740/AC-7bf859] typescript eslint config without lint script → lint gate is eslint', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'eslint.config.js'), 'export default []');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'eslint', '.']});
  });

  test('[covers:F-b2094740/AC-7bf859] biome takes precedence over oxlint when both configs present', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    writeFileSync(join(dir, '.oxlintrc.json'), '{}');
    expect(detectToolchain(dir).gates.lint?.args).toContain('biome');
  });

  test('[covers:F-b2094740/AC-86822d] linter detection only swaps lint — other TS gates keep their default', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.gates.type).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'tsc', '--noEmit']});
    expect(tc.gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'vitest', 'run']});
  });

  test('[covers:F-b2094740/AC-86822d] biome.json does not leak into a non-TS language', () => {
    // a python project carrying a stray biome.json still lints with ruff
    writeFileSync(join(dir, 'pyproject.toml'), '');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('python');
    expect(tc.gates.lint).toEqual({cmd: 'ruff', args: ['check', '.']});
  });

  // ─── TS/JS test runner + arch extensions (F-47b8bee5) ───

  test('[covers:F-47b8bee5/AC-0d51828d] typescript + jest.config.js → test gate is jest, coverage is jest --coverage', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'jest.config.js'), 'module.exports = {}');
    const tc = detectToolchain(dir);
    expect(tc.gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'jest']});
    expect(tc.gates.coverage).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'jest', '--coverage']});
  });

  for (const cfg of ['jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json']) {
    test(`typescript + ${cfg} → test gate is jest`, () => {
      writeFileSync(join(dir, 'package.json'), '{}');
      writeFileSync(join(dir, cfg), '{}');
      expect(detectToolchain(dir).gates.test?.args).toContain('jest');
    });
  }

  test('package.json with a top-level "jest" key and no jest.config.* → test gate is jest', () => {
    writeFileSync(join(dir, 'package.json'), '{"jest":{}}');
    expect(detectToolchain(dir).gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'jest']});
  });

  test('[covers:F-47b8bee5/AC-a3be7a76] typescript with no jest config → test/coverage stay vitest (default preserved)', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'vitest', 'run']});
    expect(tc.gates.coverage).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'vitest', 'run', '--coverage']});
  });

  test('[covers:F-47b8bee5/AC-4f0c9d] custom scripts.test → npm test and no assumed coverage runner', () => {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"npm run build && node --test dist/tests/app.test.js"}}');
    const tc = detectToolchain(dir);
    expect(tc.gates.test).toEqual({cmd: 'npm', args: ['test']});
    expect(tc.gates.coverage).toBeUndefined();
  });

  test('[covers:F-47b8bee5/AC-4f0c9d] custom test and coverage scripts → both exact project-owned workflows', () => {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"node --test","coverage":"c8 npm test"}}');
    const tc = detectToolchain(dir);
    expect(tc.gates.test).toEqual({cmd: 'npm', args: ['test']});
    expect(tc.gates.coverage).toEqual({cmd: 'npm', args: ['run', '--silent', 'coverage']});
  });

  test('simple vitest script without a coverage provider keeps unit native but omits coverage', () => {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^4.0.0"}}');
    const tc = detectToolchain(dir);
    expect(tc.gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'vitest', 'run']});
    expect(tc.gates.coverage).toBeUndefined();
  });

  test('simple vitest script with a coverage provider preserves the native coverage gate', () => {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^4.0.0","@vitest/coverage-v8":"^4.0.0"}}');
    expect(detectToolchain(dir).gates.coverage).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'vitest', 'run', '--coverage']});
  });

  test('simple jest script selects jest without requiring a config file', () => {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"jest"}}');
    expect(detectToolchain(dir).gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'jest']});
  });

  test('test runner selection follows config presence — add jest.config.js swaps to jest, remove it falls back to vitest', () => {
    // State-transition: proves the test-runner resolution reads the filesystem each call,
    // not a hard-coded return.
    writeFileSync(join(dir, 'package.json'), '{}');
    const vitestGate = {cmd: 'npx', args: ['--offline', '--no-install', 'vitest', 'run']};
    expect(detectToolchain(dir).gates.test).toEqual(vitestGate);
    writeFileSync(join(dir, 'jest.config.js'), 'module.exports = {}');
    expect(detectToolchain(dir).gates.test).toEqual({cmd: 'npx', args: ['--offline', '--no-install', 'jest']});
    rmSync(join(dir, 'jest.config.js'));
    expect(detectToolchain(dir).gates.test).toEqual(vitestGate);
  });

  test('jest.config.ts + biome.json compose — test gate is jest AND lint gate is biome (independent detections)', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'jest.config.ts'), 'export default {}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.gates.test?.args).toContain('jest');
    expect(tc.gates.lint?.args).toContain('biome');
  });

  test('[covers:F-47b8bee5/AC-3a899053] typescript arch gate scans ts,tsx,js,jsx extensions', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(detectToolchain(dir).gates.arch).toEqual({
      cmd: 'npx',
      args: [
        '--offline', '--no-install', 'madge', '--circular',
        '--extensions', 'ts,tsx,js,jsx',
        '--exclude', '(^|/)(dist|coverage|\\.next|\\.nuxt|\\.output|\\.svelte-kit|\\.vite)/|^(build|out|target)/',
        '.',
      ],
    });
  });

  // ─── Architecture gate scans source, not build output (F-2c02991f) ───

  /** The exclusion the arch gate carries, read back off the composed gate. */
  function archExclude(cwd: string): string | undefined {
    const args = detectToolchain(cwd).gates.arch?.args ?? [];
    const i = args.indexOf('--exclude');
    return i >= 0 ? args[i + 1] : undefined;
  }

  test('[covers:F-2c02991f/AC-caa9471d] AC-caa9471d · build output is excluded from the circular-dependency scan', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const pattern = archExclude(dir);
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!);
    // A bundler's output legitimately contains mutual imports; scanning it
    // reported cycles that exist in no hand-written file.
    for (const generated of [
      'dist/index.js', 'build/main.js', 'out/app.js', 'coverage/lcov-report/x.js',
      'target/classes/a.js', '.next/server/page.js', '.nuxt/dist/client.js',
      '.output/server/index.mjs', '.svelte-kit/output/x.js', '.vite/deps/chunk.js',
      // A monorepo or a front-end subdirectory puts its bundle one level down.
      // Anchoring only at depth 0 left those blocking the gate — the exact
      // shape the motivating adopter has (`frontend/dist`).
      'frontend/dist/index.js', 'packages/ui/dist/bundle.js', 'apps/web/.next/x.js',
      'packages/core/coverage/lcov-report/y.js', 'plugins/host/dist/bundle.js',
    ]) {
      expect(re.test(generated), `${generated} should be excluded`).toBe(true);
    }
  });

  test('AC-dd5c3abf · hand-written source paths remain eligible for the scanner', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const re = new RegExp(archExclude(dir)!);
    for (const source of [
      'src/index.ts', 'tests/unit.test.ts', 'lib/util.ts', 'app/page.tsx',
      'packages/core/src/a.ts', 'backend/api/main.ts',
      // `build`, `out` and `target` are ambiguous — they name real source
      // directories often enough that they stay anchored at the repository
      // root. (`dist`, `coverage` and the framework caches are not ambiguous:
      // no repository on hand commits hand-written source under any of them.)
      'src/build/compile.ts', 'packages/out/index.ts', 'app/target/gen.ts',
    ]) {
      expect(re.test(source), `${source} must NOT be excluded`).toBe(false);
    }
  });

  test('[covers:F-2c02991f/AC-554d9436] AC-554d9436 · a project that configures the scanner itself keeps its own rules', () => {
    // madge REPLACES its configured excludeRegExp with the command-line flag
    // rather than merging, so passing ours would silently delete theirs.
    const own = mkdtempSync(join(tmpdir(), 'clad-madge-'));
    try {
      writeFileSync(join(own, 'package.json'), '{}');
      writeFileSync(join(own, '.madgerc'), '{"excludeRegExp": ["^vendor/"]}');
      expect(detectToolchain(own).gates.arch?.args).not.toContain('--exclude');
    } finally {
      rmSync(own, {recursive: true, force: true});
    }
  });

  test('AC-554d9436 · an inline package.json madge block also wins', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({madge: {excludeRegExp: ['^vendor/']}}));
    expect(detectToolchain(dir).gates.arch?.args).not.toContain('--exclude');
  });

  test('AC-554d9436 · a .madgerc in a PARENT directory is honoured — madge walks up, so must we', () => {
    // The config loader recurses from cwd to the filesystem root. A guard that
    // looks only in cwd sends --exclude anyway, madge REPLACES the parent's
    // rules with ours, and cycles the user had suppressed come back RED.
    const parent = mkdtempSync(join(tmpdir(), 'clad-madge-parent-'));
    try {
      writeFileSync(join(parent, '.madgerc'), '{"excludeRegExp": ["^vendor/"]}');
      const child = join(parent, 'workspace', 'app');
      mkdirSync(child, {recursive: true});
      writeFileSync(join(child, 'package.json'), '{}');
      expect(detectToolchain(child).gates.arch?.args).not.toContain('--exclude');
    } finally {
      rmSync(parent, {recursive: true, force: true});
    }
  });

  test('AC-554d9436 · a .madgerc under $HOME is honoured too', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clad-madge-home-'));
    const realHome = process.env.HOME;
    const realProfile = process.env.USERPROFILE;
    try {
      writeFileSync(join(fakeHome, '.madgerc'), '{"excludeRegExp": ["^vendor/"]}');
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;
      const own = mkdtempSync(join(tmpdir(), 'clad-madge-'));
      try {
        writeFileSync(join(own, 'package.json'), '{}');
        expect(detectToolchain(own).gates.arch?.args).not.toContain('--exclude');
      } finally {
        rmSync(own, {recursive: true, force: true});
      }
    } finally {
      if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
      if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
      rmSync(fakeHome, {recursive: true, force: true});
    }
  });

  test('AC-caa9471d · a config file that puts NO exclusion in force does not switch the fix off', () => {
    // The question is not "does a file exist" but "would madge apply an
    // exclusion". Every row below exists and sets nothing, so cladding must
    // still supply its own — otherwise build-output cycles keep the gate RED
    // while cladding believes the project has it covered.
    for (const [label, body] of [
      ['empty file', ''],
      ['whitespace only', '  \n\t\n'],
      ['comment-bearing jsonc', '// no exclusions here\n{}\n'],
      ['unparseable garbage', 'not json and not ini {{{'],
      ['INI without excludeRegExp', 'detectiveOptions[ts][skipTypeImports] = true\n'],
      ['excludeRegExp: []', '{"excludeRegExp": []}'],
      ['excludeRegExp: null', '{"excludeRegExp": null}'],
      ['excludeRegExp empty string', '{"excludeRegExp": ""}'],
      ['excludeRegExp: false', '{"excludeRegExp": false}'],
    ] as [string, string][]) {
      const own = mkdtempSync(join(tmpdir(), 'clad-madge-vacuous-'));
      try {
        writeFileSync(join(own, 'package.json'), '{}');
        writeFileSync(join(own, '.madgerc'), body);
        expect(detectToolchain(own).gates.arch?.args, label).toContain('--exclude');
      } finally {
        rmSync(own, {recursive: true, force: true});
      }
    }
  });

  test('AC-554d9436 · a config that DOES set an exclusion still makes cladding stand down', () => {
    for (const [label, body] of [
      ['JSON array', '{"excludeRegExp": ["^vendor/"]}'],
      ['JSON string', '{"excludeRegExp": "^vendor/"}'],
      ['INI array form', 'excludeRegExp[] = ^vendor/\n'],
      ['INI scalar form', 'excludeRegExp = ^vendor/\n'],
    ] as [string, string][]) {
      const own = mkdtempSync(join(tmpdir(), 'clad-madge-inforce-'));
      try {
        writeFileSync(join(own, 'package.json'), '{}');
        writeFileSync(join(own, '.madgerc'), body);
        expect(detectToolchain(own).gates.arch?.args, label).not.toContain('--exclude');
      } finally {
        rmSync(own, {recursive: true, force: true});
      }
    }
  });

  test('AC-554d9436 · an environment-set exclusion is honoured — it has no file behind it', () => {
    // rc folds any madge_* variable into the config, so this is a live rule.
    // Missing it is the damaging direction: cladding would send --exclude,
    // which REPLACES rather than merges, and the rule would vanish.
    const own = mkdtempSync(join(tmpdir(), 'clad-madge-env-'));
    const saved = process.env.madge_excludeRegExp;
    try {
      writeFileSync(join(own, 'package.json'), '{}');
      process.env.madge_excludeRegExp = '^vendor/';
      expect(detectToolchain(own).gates.arch?.args).not.toContain('--exclude');
    } finally {
      if (saved === undefined) delete process.env.madge_excludeRegExp;
      else process.env.madge_excludeRegExp = saved;
      rmSync(own, {recursive: true, force: true});
    }
  });

  test('AC-554d9436 · a BOM in package.json does not hide its madge block', () => {
    // madge reads it with require(), which tolerates a BOM; JSON.parse does not.
    const own = mkdtempSync(join(tmpdir(), 'clad-madge-bom-'));
    try {
      writeFileSync(join(own, 'package.json'), '\uFEFF' + JSON.stringify({madge: {excludeRegExp: ['^vendor/']}}));
      expect(detectToolchain(own).gates.arch?.args).not.toContain('--exclude');
    } finally {
      rmSync(own, {recursive: true, force: true});
    }
  });

  test('AC-caa9471d · a .madgerc that is a DIRECTORY carries no config', () => {
    // rc's walk stops at it and reads nothing, so our default must still apply.
    const own = mkdtempSync(join(tmpdir(), 'clad-madge-dir-'));
    try {
      writeFileSync(join(own, 'package.json'), '{}');
      mkdirSync(join(own, '.madgerc'));
      expect(detectToolchain(own).gates.arch?.args).toContain('--exclude');
    } finally {
      rmSync(own, {recursive: true, force: true});
    }
  });

  test('AC-caa9471d · legacy: non-madge filenames and empty package blocks still do not switch it off', () => {
    // These all EXIST but put no excludeRegExp in force, so build output would
    // keep blocking the gate while cladding believed the project had it covered.
    for (const [label, write] of [
      ['empty .madgerc', (d: string) => writeFileSync(join(d, '.madgerc'), '{}')],
      ['detectiveOptions-only .madgerc', (d: string) => writeFileSync(join(d, '.madgerc'), '{"detectiveOptions": {"ts": {"skipTypeImports": true}}}')],
      // Not config files at all — the loader reads only the exact name `.madgerc`.
      ['.madgerc.json', (d: string) => writeFileSync(join(d, '.madgerc.json'), '{"excludeRegExp": ["^vendor/"]}')],
      ['.madgerc.yaml', (d: string) => writeFileSync(join(d, '.madgerc.yaml'), 'excludeRegExp: ["^vendor/"]')],
      ['package.json madge block without excludeRegExp', (d: string) => writeFileSync(join(d, 'package.json'), JSON.stringify({madge: {detectiveOptions: {}}}))],
    ] as [string, (d: string) => void][]) {
      const own = mkdtempSync(join(tmpdir(), 'clad-madge-inert-'));
      try {
        writeFileSync(join(own, 'package.json'), '{}');
        write(own);
        expect(detectToolchain(own).gates.arch?.args, label).toContain('--exclude');
      } finally {
        rmSync(own, {recursive: true, force: true});
      }
    }
  });


  test('[covers:F-2c02991f/AC-c04171bd] AC-c04171bd · the scan root stays the repository root, never a named directory', () => {
    // Narrowing the root is worse than the defect: a missing directory makes
    // madge exit ENOENT, which classifies as a scanner setup gap and skips the
    // whole stage — a green gate that checked nothing.
    writeFileSync(join(dir, 'package.json'), '{}');
    const args = detectToolchain(dir).gates.arch?.args ?? [];
    expect(args.at(-1)).toBe('.');
    expect(args).not.toContain('src');
    expect(args.filter((a) => a === '.')).toHaveLength(1);
  });

  // ─── Swift (SPM) + Flutter/Dart toolchain (F-e4159959) ───

  test('[covers:F-e4159959/AC-dca37b0a][covers:F-e4159959/AC-aa3d5503] Package.swift → swift, SPM build/test gates + swiftlint, no arch gate', () => {
    writeFileSync(join(dir, 'Package.swift'), '// swift-tools-version:5.9\n');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('swift');
    expect(tc.gates.type).toEqual({cmd: 'swift', args: ['build']});
    expect(tc.gates.lint).toEqual({cmd: 'swiftlint', args: ['lint']});
    expect(tc.gates.test).toEqual({cmd: 'swift', args: ['test']});
    expect(tc.gates.coverage).toEqual({cmd: 'swift', args: ['test', '--enable-code-coverage']});
    expect(tc.gates.secret).toEqual({cmd: 'gitleaks', args: ['detect', '--no-banner']});
    expect(tc.gates.arch).toBeUndefined();
  });

  test('[covers:F-e4159959/AC-61dd5a8e] pubspec.yaml declaring flutter sdk → dart with flutter gates', () => {
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('dart');
    expect(tc.gates.type).toEqual({cmd: 'flutter', args: ['analyze']});
    expect(tc.gates.test).toEqual({cmd: 'flutter', args: ['test']});
    expect(tc.gates.coverage).toEqual({cmd: 'flutter', args: ['test', '--coverage']});
  });

  test('[covers:F-e4159959/AC-dca37b0a][covers:F-e4159959/AC-4cb02211] pubspec.yaml without flutter → dart with plain dart gates', () => {
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: cli\ndependencies:\n  args: ^2.0.0\n');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('dart');
    expect(tc.gates.type).toEqual({cmd: 'dart', args: ['analyze']});
    expect(tc.gates.test).toEqual({cmd: 'dart', args: ['test']});
    expect(tc.gates.coverage).toEqual({cmd: 'dart', args: ['test', '--coverage=coverage']});
    expect(tc.gates.lint).toEqual({cmd: 'dart', args: ['format', '--output=none', '--set-exit-if-changed', '.']});
    expect(tc.gates.secret).toEqual({cmd: 'gitleaks', args: ['detect', '--no-banner']});
    expect(tc.gates.arch).toBeUndefined();
  });

  test('flutter top-level stanza without sdk: flutter → still flutter gates', () => {
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: app\nflutter:\n  uses-material-design: true\n');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('dart');
    expect(tc.gates.type).toEqual({cmd: 'flutter', args: ['analyze']});
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

  test('[covers:F-dd51b42c/AC-df69edf9] returns ./gradlew when a gradlew wrapper exists at the root', () => {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\n');
    expect(gradleCmd(dir)).toBe('./gradlew');
  });

  test('[covers:F-dd51b42c/AC-df69edf9] returns bare gradle when no wrapper is present', () => {
    expect(gradleCmd(dir)).toBe('gradle');
  });
});
