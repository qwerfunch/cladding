// Cladding · unit tests for stages/toolchain/detect.ts

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {detectToolchain} from '../../src/stages/toolchain/detect.js';

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

  // ─── TS/JS linter config detection (F-b2094740) ───
  test('typescript + biome.json → lint gate is biome', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('typescript');
    expect(tc.gates.lint).toEqual({cmd: 'npx', args: ['--no-install', 'biome', 'lint', '.']});
  });

  test('typescript + .oxlintrc.json → lint gate is oxlint', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.oxlintrc.json'), '{}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--no-install', 'oxlint']});
  });

  test('typescript with no linter config → lint gate stays eslint (default preserved)', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(detectToolchain(dir).gates.lint).toEqual({cmd: 'npx', args: ['--no-install', 'eslint', '.']});
  });

  test('biome takes precedence over oxlint when both configs present', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    writeFileSync(join(dir, '.oxlintrc.json'), '{}');
    expect(detectToolchain(dir).gates.lint?.args).toContain('biome');
  });

  test('linter detection only swaps lint — other TS gates keep their default', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.gates.type).toEqual({cmd: 'npx', args: ['--no-install', 'tsc', '--noEmit']});
    expect(tc.gates.test).toEqual({cmd: 'npx', args: ['--no-install', 'vitest', 'run']});
  });

  test('biome.json does not leak into a non-TS language', () => {
    // a python project carrying a stray biome.json still lints with ruff
    writeFileSync(join(dir, 'pyproject.toml'), '');
    writeFileSync(join(dir, 'biome.json'), '{}');
    const tc = detectToolchain(dir);
    expect(tc.language).toBe('python');
    expect(tc.gates.lint).toEqual({cmd: 'ruff', args: ['check', '.']});
  });
});
