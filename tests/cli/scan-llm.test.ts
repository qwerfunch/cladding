// Cladding · unit tests for cli/scan-llm.ts (v0.3.24, F-x)
//
// Contract: buildPrompt assembles the deterministic ScanResult into a
// labelled prompt; parseLlmResponse splits the labelled response;
// interpretWithLlm composes them; deterministicInterpret produces a
// byte-deterministic fallback that the --no-llm CLI path uses.

import {describe, expect, test, vi} from 'vitest';

import {
  buildPrompt,
  buildProjectContextPrompt,
  deterministicInterpret,
  interpretWithLlm,
  parseLlmResponse,
  parseProjectContextResponse,
  renderProjectContextMdWithLlm,
} from '../../src/cli/scan/llm.js';
import type {ProjectContext, ScanResult} from '../../src/cli/scan/index.js';

function fakeProjectContext(): ProjectContext {
  return {
    readmeFirstParagraph: 'A small library that does one focused thing.',
    readmeHeadings: ['Install', 'Usage', 'API'],
    docLinks: [{path: 'docs/ARCHITECTURE.md', firstLine: 'Architecture overview.'}],
    interfaceSignatures: [
      {layer: 'core', signatures: ['export class Engine {}', 'export interface Step {}']},
    ],
  };
}

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
      forbiddenImportCandidates: {core: ['cli']},
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
    stats: {
      filesScanned: 8,
      languagesSeen: ['.ts'],
      languageCounts: {typescript: 8},
      dominantLanguage: 'typescript',
      sourceRoot: '/tmp/proj/src',
    },
    projectContext: null,
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

// v0.3.33 — project-context refinement covers the WHY/WHAT/PURPOSE
// sections of docs/project-context.md. Greenfield (ctx === null) and
// dispatcher-error paths must both collapse to the deterministic
// renderer so the artifact is always usable.
describe('buildProjectContextPrompt', () => {
  test('includes the three sentinel sections and the observed README quote', () => {
    const p = buildProjectContextPrompt(fakeProjectContext(), 'demo');
    expect(p).toContain('=== WHY ===');
    expect(p).toContain('=== WHAT ===');
    expect(p).toContain('=== PURPOSE ===');
    expect(p).toContain('A small library that does one focused thing.');
    expect(p).toContain('- Install');
    expect(p).toContain('docs/ARCHITECTURE.md: Architecture overview.');
  });

  test('substitutes graceful placeholders when context fields are empty', () => {
    const empty: ProjectContext = {
      readmeFirstParagraph: null,
      readmeHeadings: [],
      docLinks: [],
      interfaceSignatures: [],
    };
    const p = buildProjectContextPrompt(empty, 'demo');
    expect(p).toContain('(none observed)');
    expect(p).toContain('(none found)');
    expect(p).toContain('(none extracted)');
  });
});

describe('parseProjectContextResponse', () => {
  test('splits the three labelled sections', () => {
    const raw =
      '=== WHY ===\nA team needed a faster path.\n' +
      '=== WHAT ===\nLong-running jobs without state loss.\n' +
      '=== PURPOSE ===\nMake durability the default.\n';
    const out = parseProjectContextResponse(raw);
    expect(out.why).toBe('A team needed a faster path.');
    expect(out.what).toContain('Long-running jobs');
    expect(out.purpose).toContain('durability');
  });

  test('missing section yields empty string for that part', () => {
    const out = parseProjectContextResponse('=== WHY ===\nonly why\n');
    expect(out.why).toBe('only why');
    expect(out.what).toBe('');
    expect(out.purpose).toBe('');
  });
});

describe('renderProjectContextMdWithLlm', () => {
  test('renders refined prose when dispatcher returns labelled response', async () => {
    const dispatch = vi.fn(async () =>
      '=== WHY ===\nCoordination cost was eating teams.\n' +
        '=== WHAT ===\nDeclarative specs replace meetings.\n' +
        '=== PURPOSE ===\nMake the spec the contract.\n',
    );
    const md = await renderProjectContextMdWithLlm(fakeProjectContext(), 'demo', dispatch);
    expect(md).toContain('with LLM refinement');
    expect(md).toContain('Coordination cost was eating teams.');
    expect(md).toContain('Declarative specs replace meetings.');
    expect(md).toContain('Make the spec the contract.');
    // The observed README quote stays under the refined prose so
    // reviewers can audit what the LLM inferred against ground truth.
    expect(md).toContain('A small library that does one focused thing.');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  test('greenfield (ctx=null) skips the dispatcher entirely', async () => {
    const dispatch = vi.fn(async () => 'should-not-run');
    const md = await renderProjectContextMdWithLlm(null, 'demo', dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(md).toContain('Fill');
  });

  test('dispatcher=null returns the deterministic body', async () => {
    const md = await renderProjectContextMdWithLlm(fakeProjectContext(), 'demo', null);
    expect(md).toContain('A small library that does one focused thing.');
    // Deterministic body never carries the "with LLM refinement" sigil.
    expect(md).not.toContain('with LLM refinement');
  });

  test('dispatcher error collapses to the deterministic body', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('network');
    });
    const md = await renderProjectContextMdWithLlm(fakeProjectContext(), 'demo', dispatch);
    expect(md).toContain('A small library that does one focused thing.');
    expect(md).not.toContain('with LLM refinement');
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
