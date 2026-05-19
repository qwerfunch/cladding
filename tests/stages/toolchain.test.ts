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
});
