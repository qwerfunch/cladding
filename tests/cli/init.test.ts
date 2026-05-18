// Cladding · unit tests for cli/init.ts

import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runInit} from '../../cli/init.js';

describe('runInit', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-init-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('creates spec.yaml + .cladding/ on first call', () => {
    const r = runInit({cwd: dir});
    expect(r.created).toContain('spec.yaml');
    expect(r.created.some((c) => c.startsWith('.cladding/'))).toBe(true);
    expect(existsSync(join(dir, 'spec.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.cladding'))).toBe(true);
  });

  test('seed spec.yaml is valid YAML with schema 0.1', () => {
    runInit({cwd: dir});
    const yaml = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(yaml).toContain('schema: "0.1"');
    expect(yaml).toContain('F-001');
    expect(yaml).toContain('AC-001');
    expect(yaml).toContain('ubiquitous');
  });

  test('idempotent — second call creates nothing', () => {
    runInit({cwd: dir});
    const r2 = runInit({cwd: dir});
    expect(r2.created).toEqual([]);
    expect(r2.skipped.length).toBeGreaterThanOrEqual(2);
  });

  test('detects typescript when package.json is present', () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const r = runInit({cwd: dir});
    expect(r.language).toBe('typescript');
  });

  test('detects python when pyproject.toml is present', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '');
    const r = runInit({cwd: dir});
    expect(r.language).toBe('python');
  });

  test('falls back to typescript when no manifest matches', () => {
    const r = runInit({cwd: dir});
    expect(r.language).toBe('typescript');
  });

  test('appends .cladding/ to existing .gitignore without losing prior lines', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\nbuild/\n');
    runInit({cwd: dir});
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('build/');
    expect(gi).toContain('.cladding/');
  });

  test('does not re-append .cladding/ when already present', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.cladding/\n');
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    runInit({cwd: dir});
    const after = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(after).toBe(before);
  });

  test('force=true overwrites an existing spec.yaml', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'existing: true\n');
    const r = runInit({cwd: dir, force: true});
    expect(r.created).toContain('spec.yaml');
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('schema:');
  });

  test('force=false preserves existing spec.yaml', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'existing: true\n');
    const r = runInit({cwd: dir});
    expect(r.created).not.toContain('spec.yaml');
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('existing: true');
  });
});
