// Cladding · unit tests for cli/init.ts

import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runInit} from '../../src/cli/init.js';

describe('runInit', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-init-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('creates spec.yaml + .cladding/ on first call', async () => {
    const r = await runInit({cwd: dir});
    expect(r.created).toContain('spec.yaml');
    expect(r.created.some((c) => c.startsWith('.cladding/'))).toBe(true);
    expect(existsSync(join(dir, 'spec.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.cladding'))).toBe(true);
  });

  test('seed spec.yaml is valid YAML with schema 0.1, F-001 lives in sharded file', async () => {
    await runInit({cwd: dir});
    // v0.3.49 (F-99c6e5): spec.yaml carries `features: []`; F-001
    // lives at spec/features/F-001-first.yaml so the sharded loader
    // activates from day one.
    const yaml = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(yaml).toContain('schema: "0.1"');
    expect(yaml).toContain('features: []');
    const f001 = readFileSync(join(dir, 'spec/features/F-001-first.yaml'), 'utf8');
    expect(f001).toContain('id: F-001');
    expect(f001).toContain('AC-001');
    expect(f001).toContain('ubiquitous');
  });

  test('idempotent — second call creates nothing', async () => {
    await runInit({cwd: dir});
    const r2 = await runInit({cwd: dir});
    expect(r2.created).toEqual([]);
    expect(r2.skipped.length).toBeGreaterThanOrEqual(2);
  });

  test('detects typescript when package.json is present', async () => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const r = await runInit({cwd: dir});
    expect(r.language).toBe('typescript');
  });

  test('detects python when pyproject.toml is present', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '');
    const r = await runInit({cwd: dir});
    expect(r.language).toBe('python');
  });

  test('falls back to typescript when no manifest matches', async () => {
    const r = await runInit({cwd: dir});
    expect(r.language).toBe('typescript');
  });

  test('appends .cladding/ to existing .gitignore without losing prior lines', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\nbuild/\n');
    await runInit({cwd: dir});
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('build/');
    expect(gi).toContain('.cladding/');
  });

  test('does not re-append .cladding/ when already present', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.cladding/\n');
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    await runInit({cwd: dir});
    const after = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(after).toBe(before);
  });

  test('force=true overwrites an existing spec.yaml', async () => {
    writeFileSync(join(dir, 'spec.yaml'), 'existing: true\n');
    const r = await runInit({cwd: dir, force: true});
    expect(r.created).toContain('spec.yaml');
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('schema:');
  });

  test('force=false preserves existing spec.yaml', async () => {
    writeFileSync(join(dir, 'spec.yaml'), 'existing: true\n');
    const r = await runInit({cwd: dir});
    expect(r.created).not.toContain('spec.yaml');
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('existing: true');
  });

  test('explicit projectName overrides cwd basename in seed', async () => {
    const r = await runInit({cwd: dir, projectName: 'my-custom-name'});
    expect(r.language).toBeDefined();
    const yaml = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(yaml).toContain('name: my-custom-name');
    expect(yaml).toContain('my-custom-name — Cladding spec');
  });

  test('appends .cladding/ to a gitignore that lacks a trailing newline', async () => {
    // Branch: existing.length > 0 && !existing.endsWith('\n') → prepend \n
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    await runInit({cwd: dir});
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    // The original line stays intact and the new entry lands on its own line
    expect(gi.startsWith('node_modules/')).toBe(true);
    expect(gi).toContain('.cladding/');
    // No "node_modules/.cladding/" concatenation
    expect(gi).not.toContain('node_modules/.cladding/');
  });

  test('creates .gitignore from scratch when none exists', async () => {
    // Branch: existing.length === 0 → ensureNewline stays ''
    const r = await runInit({cwd: dir});
    expect(r.created.some((c) => c.includes('.gitignore'))).toBe(true);
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('.cladding/');
  });

  // v0.3.42 (F-bd07d7) — greenfield seeds. When the auto-scan threshold
  // (≥3 source files) is not met, init still writes the three
  // scan-derived artifacts as toolchain-default templates so the
  // spec/docs surface is always complete.
  test('greenfield: writes the three scan-artifact seeds with SEED headers (TypeScript default)', async () => {
    const r = await runInit({cwd: dir});
    expect(r.created).toContain('docs/conventions.md');
    expect(r.created).toContain('spec/architecture.yaml');
    expect(r.created).toContain('spec/capabilities.yaml');
    const conv = readFileSync(join(dir, 'docs/conventions.md'), 'utf8');
    const arch = readFileSync(join(dir, 'spec/architecture.yaml'), 'utf8');
    const caps = readFileSync(join(dir, 'spec/capabilities.yaml'), 'utf8');
    // TS default is reached when no manifest is present (falls back to TS)
    expect(conv).toContain('greenfield seed for TypeScript');
    expect(conv).toContain('| indent | two-space |');
    expect(arch).toContain('version: "0.1"');
    expect(arch).toContain('Greenfield seed');
    expect(arch).toContain('layers: []');
    expect(caps).toContain('schema: "0.1"');
    expect(caps).toContain('capabilities: []');
  });

  test('greenfield: detected python toolchain switches the conventions seed to PEP-8 defaults', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    await runInit({cwd: dir});
    const conv = readFileSync(join(dir, 'docs/conventions.md'), 'utf8');
    expect(conv).toContain('greenfield seed for Python');
    expect(conv).toContain('| indent | four-space |');
    expect(conv).toContain('| naming (exports) | snake_case |');
    expect(conv).toContain('https://peps.python.org/pep-0008/');
    const arch = readFileSync(join(dir, 'spec/architecture.yaml'), 'utf8');
    expect(arch).toContain('Typical Python baseline:');
  });
});
