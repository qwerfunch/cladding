// Cladding · unit tests for cli/init.ts

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
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

  test('[covers:F-046/AC-078] scaffolds the seed, runtime, ignore rule, result lists, and detected language together', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "probe"\n');
    const result = await runInit({cwd: dir});

    expect(result.language).toBe('python');
    expect(result.created).toContain('spec.yaml');
    expect(result.created).toContain('.cladding/');
    expect(result.created.some((entry) => entry.startsWith('.gitignore'))).toBe(true);
    expect(result.skipped).toEqual(expect.any(Array));
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('language: python');
    expect(existsSync(join(dir, '.cladding'))).toBe(true);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.cladding/*');
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

  test('[covers:F-046/AC-079] preserves and reports an existing spec without force, then replaces it only with force', async () => {
    const safe = join(dir, 'safe');
    const forced = join(dir, 'forced');
    mkdirSync(safe, {recursive: true});
    mkdirSync(forced, {recursive: true});
    writeFileSync(join(safe, 'spec.yaml'), 'user: content\n');
    writeFileSync(join(forced, 'spec.yaml'), 'user: content\n');

    const skipped = await runInit({cwd: safe});
    expect(skipped.created).not.toContain('spec.yaml');
    expect(skipped.skipped).toContain('spec.yaml (exists)');
    expect(readFileSync(join(safe, 'spec.yaml'), 'utf8')).toBe('user: content\n');

    const overwritten = await runInit({cwd: forced, force: true});
    expect(overwritten.created).toContain('spec.yaml');
    expect(readFileSync(join(forced, 'spec.yaml'), 'utf8')).toContain('schema: "0.1"');
    expect(readFileSync(join(forced, 'spec.yaml'), 'utf8')).not.toContain('user: content');
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

  test('[covers:F-046/AC-081] records manifest-chain detection and the no-manifest TypeScript fallback in each seed', async () => {
    const python = join(dir, 'python');
    const fallback = join(dir, 'fallback');
    mkdirSync(python, {recursive: true});
    mkdirSync(fallback, {recursive: true});
    writeFileSync(join(python, 'pyproject.toml'), '[project]\nname = "probe"\n');

    expect((await runInit({cwd: python})).language).toBe('python');
    expect(readFileSync(join(python, 'spec.yaml'), 'utf8')).toContain('language: python');
    expect((await runInit({cwd: fallback})).language).toBe('typescript');
    expect(readFileSync(join(fallback, 'spec.yaml'), 'utf8')).toContain('language: typescript');
  });

  test('[covers:F-b0c2e724/AC-2e9c61f8] appends the committable ignore entry to an existing .gitignore without losing prior lines', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\nbuild/\n');
    await runInit({cwd: dir});
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('build/');
    // The contents form, never the directory form: git cannot re-include a
    // file under an excluded directory, so `.cladding/` would make the gate
    // config uncommittable and CI would never see the tuned gate.
    expect(gi).toContain('.cladding/*');
    expect(gi).toContain('!.cladding/config.yaml');
    expect(gi.split(/\r?\n/)).not.toContain('.cladding/');
    // The re-include must come after the exclusion — a later pattern wins in git.
    expect(gi.indexOf('!.cladding/config.yaml')).toBeGreaterThan(gi.indexOf('.cladding/*'));
  });

  test('[covers:F-b0c2e724/AC-6a58f0d1] leaves a .gitignore carrying the legacy .cladding/ entry byte-identical', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.cladding/\n');
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    const r = await runInit({cwd: dir});
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(before);
    expect(r.skipped).toContain('.gitignore (cladding entry already present)');
    expect(r.created.some((c) => c.includes('.gitignore'))).toBe(false);
  });

  test('[covers:F-b0c2e724/AC-6a58f0d1] leaves a .gitignore already carrying the new entry byte-identical', async () => {
    const before = '# Cladding runtime state\n.cladding/*\n!.cladding/config.yaml\n';
    writeFileSync(join(dir, '.gitignore'), before);
    const r = await runInit({cwd: dir});
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(before);
    expect(r.skipped).toContain('.gitignore (cladding entry already present)');
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

  test('appends the ignore entry to a gitignore that lacks a trailing newline', async () => {
    // Branch: existing.length > 0 && !existing.endsWith('\n') → prepend \n
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    await runInit({cwd: dir});
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    // The original line stays intact and the new entry lands on its own line
    expect(gi.startsWith('node_modules/')).toBe(true);
    expect(gi.split(/\r?\n/)).toContain('.cladding/*');
    // No "node_modules/.cladding/*" concatenation
    expect(gi).not.toContain('node_modules/.cladding');
  });

  test('creates .gitignore from scratch with runtime state ignored and gate config committable', async () => {
    // Branch: existing.length === 0 → ensureNewline stays ''
    const r = await runInit({cwd: dir});
    expect(r.created.some((c) => c.includes('.gitignore'))).toBe(true);
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toBe('# Cladding runtime state\n.cladding/*\n!.cladding/config.yaml\n');
  });

  // v0.3.42 (F-bd07d7) — greenfield seeds. When the auto-scan threshold
  // (≥3 source files) is not met, init still writes the three
  // scan-derived artifacts as toolchain-default templates so the
  // spec/docs surface is always complete.
  test('[covers:F-bd07d7/AC-001][covers:F-bd07d7/AC-005] greenfield: writes the three scan-artifact seeds with SEED headers (TypeScript default)', async () => {
    const r = await runInit({cwd: dir});
    expect(r.created).toContain('docs/conventions.md');
    expect(r.created).toContain('spec/architecture.yaml');
    expect(r.created).toContain('spec/capabilities.yaml');
    expect(r.created).toContain('spec/scenarios/README.md');
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
    expect(readFileSync(join(dir, 'spec/scenarios/README.md'), 'utf8')).toContain('Scenario');
  });

  test('[covers:F-c8aef8/AC-001] creates project-context on initial init and diverts repeat without overwriting authored content', async () => {
    const initial = await runInit({cwd: dir});
    const path = join(dir, 'docs/project-context.md');
    expect(initial.created).toContain('docs/project-context.md');
    expect(existsSync(path)).toBe(true);
    const generated = readFileSync(path, 'utf8');
    expect(generated).toContain(`# ${basename(dir)} — Project Context`);

    const authored = `${generated}\n<!-- keep this authored context -->\n`;
    writeFileSync(path, authored);

    const repeated = await runInit({cwd: dir});
    expect(repeated.proposals).toContain('docs/project-context.md → .cladding/scan/project-context.md.proposal');
    expect(readFileSync(path, 'utf8')).toBe(authored);
    expect(readFileSync(join(dir, '.cladding/scan/project-context.md.proposal'), 'utf8'))
      .toContain(`# ${basename(dir)} — Project Context`);
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

  test('[covers:F-00eb1a/AC-006][covers:F-32b1e0/AC-004] writes onboarding AI hints and preferred-pattern triples into the project seed block', async () => {
    const response = [
      '=== ONBOARDING_MODE ===',
      'greenfield',
      '=== PROJECT_CONTEXT_MD ===',
      '# Payment context',
      '=== CAPABILITIES_YAML ===',
      'schema: "0.1"',
      'capabilities: []',
      '=== ARCHITECTURE_YAML ===',
      'layers: []',
      '=== SPEC_SEED_TITLE ===',
      'Payment flow',
      '=== PROJECT_METADATA ===',
      'preferred_persona: reviewer',
      'test_framework: vitest',
      'forbidden_patterns: ["eval("]',
      'preferred_patterns:',
      '  - when: "React state"',
      '    prefer: "useState"',
      '    over: "classes"',
      '=== CLARIFYING_QUESTIONS ===',
    ].join('\n');

    await runInit({cwd: dir, intent: 'Review payment changes.', hostDispatcher: async () => response});

    const spec = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(spec).toContain('  ai_hints:');
    expect(spec).toContain('    preferred_persona: reviewer');
    expect(spec).toContain('    test_framework: vitest');
    expect(spec).toContain('    forbidden_patterns: ["eval("]');
    expect(spec).toContain('    preferred_patterns:');
    expect(spec).toContain('      - when: "React state"');
    expect(spec).toContain('        prefer: "useState"');
    expect(spec).toContain('        over: "classes"');
  });

  test('[covers:F-3a5339/AC-002] intent-aware initialization writes the intent into both project metadata fields', async () => {
    const intent = 'Coordinate payment reconciliation for merchants.';
    await runInit({cwd: dir, intent, noLlm: true});

    const spec = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(spec).toContain(`  description: "${intent}"`);
    expect(spec).toContain(`  intent_summary: "${intent}"`);
    expect(spec).toContain('  version: "0.0.1"');
  });

  test('[covers:F-70ed1afd/AC-6421da1f] no-dispatch intent onboarding and no-intent adoption both record scanner-derived README capabilities', async () => {
    const adopt = (name: string): string => {
      const cwd = join(dir, name);
      mkdirSync(cwd, {recursive: true});
      writeFileSync(join(cwd, 'README.md'), '# Demo\n\n## Checkout\n\n## Refunds\n');
      writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n');
      writeFileSync(join(cwd, 'b.ts'), 'export const b = 1;\n');
      writeFileSync(join(cwd, 'c.ts'), 'export const c = 1;\n');
      return cwd;
    };
    const noDispatch = adopt('no-dispatch');
    const noIntent = adopt('no-intent');

    await runInit({cwd: noDispatch, scan: true, noLlm: true, intent: 'a checkout product'});
    await runInit({cwd: noIntent, scan: true, noLlm: true});

    for (const cwd of [noDispatch, noIntent]) {
      const capabilities = readFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'utf8');
      expect(capabilities).toContain('source: README.md');
      expect(capabilities).toContain('id: checkout');
      expect(capabilities).toContain('title: "Checkout"');
      expect(capabilities).toContain('id: refunds');
      expect(capabilities).toContain('title: "Refunds"');
    }
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

    test('[covers:F-3b3690/AC-001] intent with no available dispatcher warns loudly that the LLM did not fire', async () => {
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

    test('[covers:F-fe0f7a96/AC-4abc4282] deterministic, unavailable-dispatch, and hybrid notices recommend clad clarify without the removed refinement command', async () => {
      const collect = async (cwd: string, opts: NonNullable<Parameters<typeof runInit>[0]>): Promise<string> => {
        mkdirSync(cwd, {recursive: true});
        const cap = captureStderr();
        try {
          await runInit({cwd, intent: 'a payment product', ...opts});
        } finally {
          cap.restore();
        }
        return cap.text();
      };
      const deterministic = await collect(join(dir, 'deterministic'), {noLlm: true});
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('GEMINI_API_KEY', '');
      vi.stubEnv('GOOGLE_API_KEY', '');
      let unavailable = '';
      try {
        unavailable = await collect(join(dir, 'unavailable'), {});
      } finally {
        vi.unstubAllEnvs();
      }
      const hybrid = await collect(join(dir, 'hybrid'), {
        hostDispatcher: async () => '=== ONBOARDING_MODE ===\ngreenfield\n=== PROJECT_CONTEXT_MD ===\n# draft\n',
      });

      const removedVerb = ['clad', 'refine'].join(' ');
      for (const notice of [deterministic, unavailable, hybrid]) {
        expect(notice).toContain('clad clarify');
        expect(notice).not.toContain(removedVerb);
      }
    });
  });
});
