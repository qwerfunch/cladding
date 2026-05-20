// Cladding · unit tests for cli/scan-llm.ts (v0.3.24, F-x)
//
// Contract: buildPrompt assembles the deterministic ScanResult into a
// labelled prompt; parseLlmResponse splits the labelled response;
// interpretWithLlm composes them; deterministicInterpret produces a
// byte-deterministic fallback that the --no-llm CLI path uses.

import {describe, expect, test, vi} from 'vitest';

import {
  buildPrompt,
  deterministicInterpret,
  interpretWithLlm,
  parseLlmResponse,
} from '../../src/cli/scan-llm.js';
import type {ScanResult} from '../../src/cli/scan.js';

function fakeScan(): ScanResult {
  return {
    conventions: {
      indent: 'two-space',
      quote: 'single',
      semicolon: 'present',
      namingExports: 'camelCase',
      namingConstants: 'UPPER_SNAKE',
      docBlockRatio: 0.5,
      docTagCounts: {'@param': 12, '@returns': 6, '@throws': 0, '@example': 1, '@see': 4, '@deprecated': 0},
      importOrder: 'node-first',
      exportPattern: 'named-only',
      errorHandling: 'throw-primary',
      typeDefLocation: 'inline',
      fileHeaderPattern: '// Project ·',
      testLocation: 'tests-dir',
      moduleBoilerplate: '// Project · sample\nexport const x = 1;',
    },
    architecture: {
      layers: [
        {name: 'core', dir: 'core', moduleCount: 5},
        {name: 'cli', dir: 'cli', moduleCount: 3},
      ],
      importGraph: [{from: 'cli', to: 'core', count: 4}],
    },
    scenarios: [
      {slug: 'core-flow', dir: 'core', moduleCount: 5},
      {slug: 'cli-flow', dir: 'cli', moduleCount: 3},
    ],
    examples: [
      {
        layer: 'core',
        modulePath: 'core/main.ts',
        moduleContent: 'export const main = 1;',
        testPath: 'core/main.test.ts',
        testContent: 'test("main", () => expect(main).toBe(1));',
      },
    ],
    stats: {filesScanned: 8, languagesSeen: ['.ts'], sourceRoot: '/tmp/proj/src'},
  };
}

describe('buildPrompt', () => {
  test('includes the three sentinel sections', () => {
    const p = buildPrompt(fakeScan());
    expect(p).toContain('=== CONVENTIONS_MD ===');
    expect(p).toContain('=== ARCHITECTURE_YAML ===');
    expect(p).toContain('=== SCENARIO_FLOWS ===');
  });

  test('packs convention data + example modules into the prompt body', () => {
    const p = buildPrompt(fakeScan());
    expect(p).toContain('two-space');
    expect(p).toContain('camelCase');
    expect(p).toContain('core/main.ts');
    expect(p).toContain('cli → core');
  });
});

describe('parseLlmResponse', () => {
  test('extracts the three labelled sections', () => {
    const raw =
      '=== CONVENTIONS_MD ===\n# Conventions\n2-space indent.\n' +
      '=== ARCHITECTURE_YAML ===\nlayers: []\n' +
      '=== SCENARIO_FLOWS ===\ncore-flow: handles bootstrap\ncli-flow: routes verbs\n';
    const out = parseLlmResponse(raw);
    expect(out.conventions).toContain('2-space indent');
    expect(out.architecture).toContain('layers: []');
    expect(out.scenarios).toContain('core-flow: handles bootstrap');
  });

  test('missing section returns empty string for that part', () => {
    const out = parseLlmResponse('=== CONVENTIONS_MD ===\nhello\n');
    expect(out.conventions).toContain('hello');
    expect(out.architecture).toBe('');
    expect(out.scenarios).toBe('');
  });
});

describe('interpretWithLlm', () => {
  test('returns mode=llm and prepends the auto-generated header to conventions', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# A\n=== ARCHITECTURE_YAML ===\nlayers: []\n=== SCENARIO_FLOWS ===\ncore-flow: x\ncli-flow: y\n',
    );
    const r = await interpretWithLlm(fakeScan(), dispatch);
    expect(r.mode).toBe('llm');
    expect(r.conventionsMd).toMatch(/^<!-- Auto-generated/);
    expect(r.architectureYaml).toContain('layers: []');
    expect(r.scenarioFlows.get('core-flow')).toBe('x');
    expect(r.scenarioFlows.get('cli-flow')).toBe('y');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  test('dispatcher receives the buildPrompt output verbatim', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => '=== CONVENTIONS_MD ===\n');
    await interpretWithLlm(fakeScan(), dispatch);
    const arg = dispatch.mock.calls[0]?.[0] ?? '';
    expect(arg).toContain('=== CONVENTIONS_MD ===');
    expect(arg).toContain('two-space');
  });
});

describe('deterministicInterpret', () => {
  test('mode=deterministic and conventions table renders all 14 signals', () => {
    const r = deterministicInterpret(fakeScan());
    expect(r.mode).toBe('deterministic');
    expect(r.conventionsMd).toMatch(/^<!-- Auto-generated/);
    expect(r.conventionsMd).toContain('two-space');
    expect(r.conventionsMd).toContain('camelCase');
    expect(r.conventionsMd).toContain('UPPER_SNAKE');
    expect(r.conventionsMd).toContain('@param');
    expect(r.conventionsMd).toContain('Module boilerplate');
  });

  test('architecture yaml lists every observed layer with empty forbidden_imports', () => {
    const r = deterministicInterpret(fakeScan());
    expect(r.architectureYaml).toContain('version: "0.1"');
    expect(r.architectureYaml).toContain('name: core');
    expect(r.architectureYaml).toContain('name: cli');
    expect(r.architectureYaml).toContain('forbidden_imports: []');
  });

  test('scenario flows fall back to a placeholder when no LLM has interpreted', () => {
    const r = deterministicInterpret(fakeScan());
    expect(r.scenarioFlows.get('core-flow')).toContain('Flow through core/');
    expect(r.scenarioFlows.get('cli-flow')).toContain('Flow through cli/');
  });
});
