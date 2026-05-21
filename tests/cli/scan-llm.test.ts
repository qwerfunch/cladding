// Cladding · unit tests for cli/scan-llm.ts (v0.3.24, F-x)
//
// Contract: buildPrompt assembles the deterministic ScanResult into a
// labelled prompt; parseLlmResponse splits the labelled response;
// interpretWithLlm composes them; deterministicInterpret produces a
// byte-deterministic fallback that the --no-llm CLI path uses.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  buildPrompt,
  buildProjectContextPrompt,
  deterministicInterpret,
  interpretScanWithFallback,
  interpretWithLlm,
  parseLlmResponse,
  parseProjectContextResponse,
  renderCapabilitiesYaml,
  renderProjectContextMdWithLlm,
} from '../../src/cli/scan/llm.js';
import {readEvents} from '../../src/events/log.js';
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

function fakeScanWithReadme(): ScanResult {
  return {
    ...fakeScan(),
    projectContext: {
      readmeFirstParagraph: 'Cladding is a drift-detection harness.',
      readmeHeadings: ['Install', 'Status', 'Status & roadmap', 'CLI', 'License'],
      docLinks: [],
      interfaceSignatures: [],
    },
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
  test('includes the four sentinel sections', () => {
    const p = buildPrompt(fakeScan());
    expect(p).toContain('=== CONVENTIONS_MD ===');
    expect(p).toContain('=== ARCHITECTURE_YAML ===');
    expect(p).toContain('=== SCENARIO_FLOWS ===');
    expect(p).toContain('=== CAPABILITIES_YAML ===');
  });

  test('packs convention data + example modules into the prompt body', () => {
    const p = buildPrompt(fakeScan());
    expect(p).toContain('two-space');
    expect(p).toContain('camelCase');
    expect(p).toContain('core/main.ts');
    expect(p).toContain('cli → core');
  });

  test('packs README headings into the capabilities block when projectContext is populated', () => {
    const p = buildPrompt(fakeScanWithReadme());
    expect(p).toContain('--- README headings (capability candidates) ---');
    expect(p).toContain('- Install');
    expect(p).toContain('- Status & roadmap');
    expect(p).toContain('- CLI');
  });

  test('substitutes a placeholder when projectContext is null', () => {
    const p = buildPrompt(fakeScan());
    expect(p).toContain('--- README headings (capability candidates) ---');
    expect(p).toContain('(none observed)');
  });
});

describe('parseLlmResponse', () => {
  test('extracts the four labelled sections', () => {
    const raw =
      '=== CONVENTIONS_MD ===\n# Conventions\n2-space indent.\n' +
      '=== ARCHITECTURE_YAML ===\nlayers: []\n' +
      '=== SCENARIO_FLOWS ===\ncore-flow: handles bootstrap\ncli-flow: routes verbs\n' +
      '=== CAPABILITIES_YAML ===\nschema: "0.1"\ncapabilities:\n  - id: install\n    title: "Install"\n';
    const out = parseLlmResponse(raw);
    expect(out.conventions).toContain('2-space indent');
    expect(out.architecture).toContain('layers: []');
    expect(out.scenarios).toContain('core-flow: handles bootstrap');
    expect(out.capabilities).toContain('- id: install');
  });

  test('missing section returns empty string for that part', () => {
    const out = parseLlmResponse('=== CONVENTIONS_MD ===\nhello\n');
    expect(out.conventions).toContain('hello');
    expect(out.architecture).toBe('');
    expect(out.scenarios).toBe('');
    expect(out.capabilities).toBe('');
  });
});

describe('interpretWithLlm', () => {
  test('returns mode=llm and prepends the auto-generated header to conventions', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# A\n=== ARCHITECTURE_YAML ===\nlayers: []\n=== SCENARIO_FLOWS ===\ncore-flow: x\ncli-flow: y\n=== CAPABILITIES_YAML ===\nschema: "0.1"\nsource: README.md\ncapabilities:\n  - id: install\n    title: "Install"\n    summary: "How to install."\n    surface: tool\n',
    );
    const r = await interpretWithLlm(fakeScanWithReadme(), dispatch);
    expect(r.mode).toBe('llm');
    expect(r.conventionsMd).toMatch(/^<!-- Cladding · Tier C/);
    expect(r.architectureYaml).toContain('layers: []');
    expect(r.scenarioFlows.get('core-flow')).toBe('x');
    expect(r.scenarioFlows.get('cli-flow')).toBe('y');
    expect(r.capabilitiesYaml).toContain('- id: install');
    expect(r.capabilitiesYaml).toContain('surface: tool');
    expect(r.capabilitiesYaml.endsWith('\n')).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  test('dispatcher receives the buildPrompt output verbatim', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => '=== CONVENTIONS_MD ===\n');
    await interpretWithLlm(fakeScan(), dispatch);
    const arg = dispatch.mock.calls[0]?.[0] ?? '';
    expect(arg).toContain('=== CONVENTIONS_MD ===');
    expect(arg).toContain('two-space');
  });

  test('per-artifact fallback: missing capabilities section falls back to deterministic capabilities yaml', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# A\n' +
        '=== ARCHITECTURE_YAML ===\nversion: "0.1"\nlayers:\n  - name: core\n    modules: ["core/**"]\n    forbidden_imports: []\n' +
        '=== SCENARIO_FLOWS ===\ncore-flow: x\n',
    );
    const r = await interpretWithLlm(fakeScanWithReadme(), dispatch);
    expect(r.mode).toBe('llm');
    // Conventions + architecture stay LLM-refined; capabilities falls
    // back per-artifact to the deterministic renderer.
    expect(r.capabilitiesYaml).toContain('source: README.md');
    expect(r.capabilitiesYaml).toContain('- id: install');
    expect(r.capabilitiesYaml).toContain('- id: status-and-roadmap');
  });
});

describe('deterministicInterpret', () => {
  test('mode=deterministic and conventions table renders all 14 signals', () => {
    const r = deterministicInterpret(fakeScan());
    expect(r.mode).toBe('deterministic');
    expect(r.conventionsMd).toMatch(/^<!-- Cladding · Tier C/);
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

  test('capabilities yaml stays empty when no README context is observed', () => {
    const r = deterministicInterpret(fakeScan());
    expect(r.capabilitiesYaml).toContain('schema: "0.1"');
    expect(r.capabilitiesYaml).toContain('source: README.md');
    expect(r.capabilitiesYaml).toContain('capabilities: []');
  });

  test('capabilities yaml lists every README heading when projectContext is populated', () => {
    const r = deterministicInterpret(fakeScanWithReadme());
    expect(r.capabilitiesYaml).toContain('capabilities:');
    expect(r.capabilitiesYaml).toContain('- id: install');
    expect(r.capabilitiesYaml).toContain('title: "Install"');
    // `&` and spaces collapse into kebab segments — README heading
    // "Status & roadmap" → id `status-and-roadmap`.
    expect(r.capabilitiesYaml).toContain('- id: status-and-roadmap');
    expect(r.capabilitiesYaml).toContain('title: "Status & roadmap"');
    expect(r.capabilitiesYaml).toContain('- id: cli');
  });
});

// v0.3.38 — `spec/capabilities.yaml` is the README-derived capability
// inventory. The deterministic renderer turns each README ## heading
// into an id+title entry; LLM-refined runs add summary + surface.
describe('renderCapabilitiesYaml', () => {
  test('emits `capabilities: []` when no headings are given', () => {
    const out = renderCapabilitiesYaml([]);
    expect(out).toContain('schema: "0.1"');
    expect(out).toContain('source: README.md');
    expect(out).toContain('capabilities: []');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('slugifies headings into kebab-case ids and preserves titles verbatim', () => {
    const out = renderCapabilitiesYaml(['Install', 'Status & Roadmap', 'CLI']);
    expect(out).toContain('- id: install');
    expect(out).toContain('title: "Install"');
    expect(out).toContain('- id: status-and-roadmap');
    expect(out).toContain('title: "Status & Roadmap"');
    expect(out).toContain('- id: cli');
  });

  test('quotes embedded double-quotes inside titles', () => {
    const out = renderCapabilitiesYaml(['The "best" feature']);
    expect(out).toContain('title: "The \\"best\\" feature"');
  });

  test('falls back to "capability" when a heading slugifies to empty', () => {
    const out = renderCapabilitiesYaml(['!!!']);
    expect(out).toContain('- id: capability');
    expect(out).toContain('title: "!!!"');
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
    expect(md).toContain('LLM-refined');
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

// v0.3.35 — interpretScanWithFallback wraps interpretWithLlm with the
// deterministic-fallback policy so init.ts can route both scan
// artifacts and project-context through one dispatcher selection.
describe('interpretScanWithFallback', () => {
  test('returns mode=deterministic when dispatcher is null', async () => {
    const r = await interpretScanWithFallback(fakeScan(), null);
    expect(r.mode).toBe('deterministic');
    expect(r.architectureYaml).toContain('name: core');
  });

  test('returns mode=llm and refined body when dispatcher succeeds', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# Refined conventions\nProse here.\n' +
        '=== ARCHITECTURE_YAML ===\nversion: "0.1"\nlayers:\n  - name: core\n    modules: ["core/**"]\n    forbidden_imports: []\n' +
        '=== SCENARIO_FLOWS ===\ncore-flow: refined flow\ncli-flow: refined cli\n' +
        '=== CAPABILITIES_YAML ===\nschema: "0.1"\nsource: README.md\ncapabilities:\n  - id: install\n    title: "Install"\n    summary: "How to install."\n    surface: tool\n',
    );
    const r = await interpretScanWithFallback(fakeScanWithReadme(), dispatch);
    expect(r.mode).toBe('llm');
    expect(r.conventionsMd).toContain('Refined conventions');
    expect(r.architectureYaml).toContain('name: core');
    expect(r.scenarioFlows.get('core-flow')).toBe('refined flow');
    expect(r.capabilitiesYaml).toContain('- id: install');
    expect(r.capabilitiesYaml).toContain('summary: "How to install."');
  });

  test('per-artifact capabilities fallback: missing CAPABILITIES_YAML still keeps mode=llm and ships deterministic capabilities', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# Refined conventions\nProse here.\n' +
        '=== ARCHITECTURE_YAML ===\nversion: "0.1"\nlayers:\n  - name: core\n    modules: ["core/**"]\n    forbidden_imports: []\n' +
        '=== SCENARIO_FLOWS ===\ncore-flow: refined flow\n',
    );
    const r = await interpretScanWithFallback(fakeScanWithReadme(), dispatch);
    expect(r.mode).toBe('llm');
    // Conventions + architecture sentinel-pass keeps total mode=llm,
    // but the capabilities slot falls back to the deterministic
    // renderer rather than shipping an empty string.
    expect(r.capabilitiesYaml).toContain('source: README.md');
    expect(r.capabilitiesYaml).toContain('- id: install');
  });

  test('collapses to deterministic when dispatcher throws', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('transport down');
    });
    const r = await interpretScanWithFallback(fakeScan(), dispatch);
    expect(r.mode).toBe('deterministic');
    expect(dispatch).toHaveBeenCalledOnce();
  });

  test('collapses to deterministic when dispatcher returns empty architecture section', async () => {
    const dispatch = vi.fn(async () => '=== CONVENTIONS_MD ===\n# only conv\n');
    const r = await interpretScanWithFallback(fakeScan(), dispatch);
    expect(r.mode).toBe('deterministic');
    // Layer name from deterministic, not from the empty LLM reply.
    expect(r.architectureYaml).toContain('name: core');
  });

  test('collapses to deterministic when dispatcher returns header-only conventions', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n\n=== ARCHITECTURE_YAML ===\nversion: "0.1"\nlayers: []\n',
    );
    const r = await interpretScanWithFallback(fakeScan(), dispatch);
    expect(r.mode).toBe('deterministic');
  });
});

// v0.3.39 — sentinel-miss telemetry. Each fallback site records a
// JSONL event in <cwd>/.cladding/events.log.jsonl so adopters can tune
// their host's sampling policy. Configured-no-LLM paths (dispatcher
// null or ctx null) do NOT emit — they are deliberate offline runs.
describe('sentinel_miss telemetry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-sentinel-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('emits one total miss when dispatcher throws (scan_artifacts phase)', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('transport down');
    });
    await interpretScanWithFallback(fakeScan(), dispatch, dir);
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'scan_artifacts',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: 'transport down',
    });
  });

  test('emits one total miss with missed_sections when conventions/architecture sentinel is blank', async () => {
    const dispatch = vi.fn(async () => '=== CONVENTIONS_MD ===\n# only conv\n');
    await interpretScanWithFallback(fakeScanWithReadme(), dispatch, dir);
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'scan_artifacts',
      cause: 'blank_section',
      fallback: 'total',
    });
    expect(events[0].payload.missed_sections).toContain('ARCHITECTURE_YAML');
  });

  test('emits one per_artifact miss when only capabilities is blank but conventions+architecture pass', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# Refined\n' +
        '=== ARCHITECTURE_YAML ===\nversion: "0.1"\nlayers:\n  - name: core\n    modules: ["core/**"]\n    forbidden_imports: []\n' +
        '=== SCENARIO_FLOWS ===\ncore-flow: x\n',
    );
    const r = await interpretScanWithFallback(fakeScanWithReadme(), dispatch, dir);
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(r.mode).toBe('llm');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'scan_artifacts',
      cause: 'blank_section',
      fallback: 'per_artifact',
    });
    expect(events[0].payload.missed_sections).toEqual(['CAPABILITIES_YAML']);
  });

  test('does NOT emit when dispatcher is null (configured offline run)', async () => {
    await interpretScanWithFallback(fakeScan(), null, dir);
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(0);
  });

  test('does NOT emit when cwd is omitted (telemetry stays silent)', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('transport down');
    });
    await interpretScanWithFallback(fakeScan(), dispatch);
    // No events.log can exist because no cwd was provided; the function
    // simply skips the emit and lets the deterministic fallback run.
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(0);
  });

  test('project_context phase: emits dispatcher_error on throw', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('mcp closed');
    });
    await renderProjectContextMdWithLlm(fakeProjectContext(), 'demo', dispatch, dir);
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'project_context',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: 'mcp closed',
    });
  });

  test('project_context phase: emits blank_section per_artifact when WHY/WHAT/PURPOSE are blank', async () => {
    // Reply parses but leaves all three sentinels empty.
    const dispatch = vi.fn(async () => '=== WHY ===\n=== WHAT ===\n=== PURPOSE ===\n');
    await renderProjectContextMdWithLlm(fakeProjectContext(), 'demo', dispatch, dir);
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'project_context',
      cause: 'blank_section',
      fallback: 'per_artifact',
    });
    expect(events[0].payload.missed_sections).toEqual(['WHY', 'WHAT', 'PURPOSE']);
  });

  test('project_context phase: greenfield (ctx=null) skips the dispatcher and does NOT emit', async () => {
    const dispatch = vi.fn(async () => 'should-not-run');
    await renderProjectContextMdWithLlm(null, 'demo', dispatch, dir);
    expect(dispatch).not.toHaveBeenCalled();
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(0);
  });
});

describe('interpretWithLlm — missedSections tracking', () => {
  test('populates missedSections with every blank sentinel name', async () => {
    const dispatch = vi.fn(async () => '=== CONVENTIONS_MD ===\n# A\n=== ARCHITECTURE_YAML ===\nlayers: []\n');
    const r = await interpretWithLlm(fakeScanWithReadme(), dispatch);
    expect(r.missedSections).toEqual(expect.arrayContaining(['SCENARIO_FLOWS', 'CAPABILITIES_YAML']));
    expect(r.missedSections).not.toContain('CONVENTIONS_MD');
    expect(r.missedSections).not.toContain('ARCHITECTURE_YAML');
  });

  test('missedSections is empty when every sentinel parses to non-blank content', async () => {
    const dispatch = vi.fn(async () =>
      '=== CONVENTIONS_MD ===\n# A\n' +
        '=== ARCHITECTURE_YAML ===\nlayers: []\n' +
        '=== SCENARIO_FLOWS ===\ncore-flow: x\ncli-flow: y\n' +
        '=== CAPABILITIES_YAML ===\nschema: "0.1"\ncapabilities: []\n',
    );
    const r = await interpretWithLlm(fakeScanWithReadme(), dispatch);
    expect(r.missedSections).toEqual([]);
  });

  test('deterministicInterpret returns an empty missedSections array (no LLM reply was inspected)', () => {
    const r = deterministicInterpret(fakeScan());
    expect(r.missedSections).toEqual([]);
  });
});
