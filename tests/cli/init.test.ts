// Cladding · unit tests for cli/init.ts

import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

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
    expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toContain('spec/index.yaml merge=union');
  });

  test('seed spec.yaml has empty features[] — no legacy F-001 placeholder shard written (v0.4.0)', async () => {
    await runInit({cwd: dir});
    // v0.3.49 (F-99c6e5): spec.yaml carries `features: []`.
    // v0.4.0: no `spec/features/F-001-first.yaml` placeholder is written.
    // External users register real features on demand via `clad_create_feature`
    // (hash-based filename + id); the legacy `F-NNN` format is reserved for
    // cladding's own historical features.
    const yaml = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(yaml).toContain('schema: "0.1"');
    expect(yaml).toContain('features: []');
    expect(existsSync(join(dir, 'spec/features/F-001-first.yaml'))).toBe(false);
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

  test('creates the index merge attribute while leaving attestation unassigned', async () => {
    const r = await runInit({cwd: dir});
    const attributes = readFileSync(join(dir, '.gitattributes'), 'utf8');
    expect(r.created).toContain('.gitattributes (spec/index.yaml merge=union appended)');
    expect(attributes.split('\n').filter((line) => line === 'spec/index.yaml merge=union')).toHaveLength(1);
    expect(attributes).not.toMatch(/spec\/attestation\.yaml\b[^\n]*\bmerge/);
  });

  test('preserves existing gitattributes and appends the managed index line', async () => {
    writeFileSync(join(dir, '.gitattributes'), '*.md linguist-detectable\n');
    await runInit({cwd: dir});
    const attributes = readFileSync(join(dir, '.gitattributes'), 'utf8');
    expect(attributes).toContain('*.md linguist-detectable');
    expect(attributes).toContain('spec/index.yaml merge=union');
  });

  test('does not duplicate an existing index merge attribute', async () => {
    const original = '# user attributes\nspec/index.yaml merge=union\n';
    writeFileSync(join(dir, '.gitattributes'), original);
    const r = await runInit({cwd: dir});
    expect(readFileSync(join(dir, '.gitattributes'), 'utf8')).toBe(original);
    expect(r.skipped).toContain('.gitattributes (spec/index.yaml merge=union already present)');
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
    // v0.4.0 — architecture seed no longer emits a `version:` key; the
    // architecture schema declares `additionalProperties: false`, so any
    // `version:` would be rejected by `clad sync`.
    expect(arch).not.toContain('version:');
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

  // v0.4.1 (no-vacuous-green) — a non-firing LLM dispatch must announce itself.
  // A silent deterministic fallback produces stub spec/scenarios that look real.
  describe('non-firing dispatch notice', () => {
    function captureStderr(): {restore: () => void; text: () => string} {
      const chunks: string[] = [];
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array): boolean => {
          chunks.push(String(chunk));
          return true;
        });
      return {restore: () => spy.mockRestore(), text: () => chunks.join('')};
    }

    test('intent with no available dispatcher warns loudly that the LLM did not fire', async () => {
      // Force the no-dispatcher case independent of the host env: clear every
      // provider key so selectDispatcher() returns null (no MCP host in tests).
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('GEMINI_API_KEY', '');
      vi.stubEnv('GOOGLE_API_KEY', '');
      const cap = captureStderr();
      try {
        await runInit({cwd: dir, intent: 'a B2B payment SaaS with Stripe and Toss'});
      } finally {
        cap.restore();
        vi.unstubAllEnvs();
      }
      const out = cap.text();
      expect(out).toContain('LLM dispatcher did not fire');
      expect(out).toContain('clad doctor');
    });

    test('--no-llm prints the deterministic-mode notice, not the dispatcher-failure warning', async () => {
      const cap = captureStderr();
      try {
        await runInit({cwd: dir, intent: 'a B2B payment SaaS', noLlm: true});
      } finally {
        cap.restore();
      }
      const out = cap.text();
      expect(out).toContain('deterministic mode (--no-llm)');
      expect(out).not.toContain('did not fire');
    });

    test('no intent → no dispatch notice at all (onboarding block skipped)', async () => {
      const cap = captureStderr();
      try {
        await runInit({cwd: dir});
      } finally {
        cap.restore();
      }
      const out = cap.text();
      expect(out).not.toContain('LLM dispatcher');
      expect(out).not.toContain('deterministic mode (--no-llm)');
    });
  });
});
