// Cladding · unit tests for cli/scan/intent-onboarding (v0.3.43, F-56abaa)
//
// Pure function tests for the prompt builder + parser, plus a small
// set of integration tests for interpretOnboardingWithFallback that
// exercise the LLM-path / fallback matrix using a tmpdir-backed
// events.log so the sentinel_miss emit branch is verified end-to-end.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  buildOnboardingPrompt,
  deterministicOnboarding,
  extractClarifyingQuestions,
  extractProjectMetadata,
  interpretOnboardingWithFallback,
  normaliseMode,
  parseOnboardingResponse,
  type OnboardingObserved,
} from '../../src/cli/scan/intent-onboarding.js';
import {readEvents} from '../../src/events/log.js';

function fakeObserved(over: Partial<OnboardingObserved> = {}): OnboardingObserved {
  return {
    cwdBasename: 'demo',
    language: 'typescript',
    sourceFileCount: 0,
    readmePresent: false,
    readmeFirstParagraph: null,
    projectName: 'demo',
    ...over,
  };
}

describe('buildOnboardingPrompt', () => {
  test("[covers:F-00eb1a/AC-004] includes all seven sentinel sections, including PROJECT_METADATA", () => {
    const p = buildOnboardingPrompt('결제 SaaS for B2B', fakeObserved());
    expect(p).toContain('=== ONBOARDING_MODE ===');
    expect(p).toContain('=== PROJECT_CONTEXT_MD ===');
    expect(p).toContain('=== CAPABILITIES_YAML ===');
    expect(p).toContain('=== ARCHITECTURE_YAML ===');
    expect(p).toContain('=== SPEC_SEED_TITLE ===');
    expect(p).toContain('=== CLARIFYING_QUESTIONS ===');
    expect(p).toContain('=== PROJECT_METADATA ===');
  });

  test('embeds the verbatim user intent', () => {
    const p = buildOnboardingPrompt('AI 코드 리뷰 봇 만들기', fakeObserved());
    expect(p).toContain('User intent: "AI 코드 리뷰 봇 만들기"');
  });

  test('reports observed environment fields', () => {
    const p = buildOnboardingPrompt('demo', fakeObserved({
      language: 'python',
      sourceFileCount: 42,
      readmePresent: true,
      readmeFirstParagraph: 'A neat little tool.',
      projectName: 'my-tool',
    }));
    expect(p).toContain('Project name (cwd basename): my-tool');
    expect(p).toContain('Detected language: python');
    expect(p).toContain('Existing source files: 42');
    expect(p).toContain('README present: yes');
    expect(p).toContain('"A neat little tool."');
  });

  test("[covers:F-56abaa/AC-006] lists product-level question examples and bans expert jargon", () => {
    const p = buildOnboardingPrompt('결제 SaaS', fakeObserved());
    // Product-level GOOD examples are present
    expect(p).toContain('주 사용자가 개인? 사업자?');
    // BAD examples are present too so the LLM sees the contrast
    expect(p).toContain('PCI-DSS SAQ A vs SAQ D?');
    // Explicit anti-jargon rule
    expect(p).toContain('NEVER ask about technical jargon');
  });

  test('[covers:F-a04cd9/AC-003] architecture prompt declares only layer names and forbidden imports, and its response consumer preserves that exact shape', () => {
    const prompt = buildOnboardingPrompt('payment service', fakeObserved());
    const architectureSection = prompt.slice(
      prompt.indexOf('=== ARCHITECTURE_YAML ==='),
      prompt.indexOf('=== SPEC_SEED_TITLE ==='),
    );
    expect(architectureSection).toContain('layers: [{name, forbidden_imports:[<layer>]}, ...]');
    expect(architectureSection).not.toContain('modules');

    const parsed = parseOnboardingResponse([
      '=== ARCHITECTURE_YAML ===',
      'layers:',
      '  - name: domain',
      '    forbidden_imports: [infrastructure]',
      '=== SPEC_SEED_TITLE ===',
      'Charge payment',
    ].join('\n'));
    expect(parsed.architecture).toContain('name: domain');
    expect(parsed.architecture).toContain('forbidden_imports: [infrastructure]');
    expect(parsed.architecture).not.toContain('modules');

    const types = readFileSync(join(process.cwd(), 'src', 'spec', 'types.ts'), 'utf8');
    const objectStart = types.indexOf('export interface ArchitectureLayerObject');
    const architectureStart = types.indexOf('/** Architecture constitution.', objectStart);
    expect(objectStart).toBeGreaterThanOrEqual(0);
    expect(architectureStart).toBeGreaterThan(objectStart);
    const modulesDocs = types.slice(objectStart, architectureStart);
    expect(modulesDocs).toContain('readonly modules?: readonly string[];');
    expect(modulesDocs).toContain('`UNMAPPED_ARTIFACT` (F-87bb7ed3, AC-96ff696f) takes these globs as');
    expect(modulesDocs).toContain('`ARCHITECTURE_FROM_SPEC` still derives a layer\'s directory from');
    expect(modulesDocs).toContain('and does NOT read these globs');
  });
});

describe('parseOnboardingResponse', () => {
  test("[covers:F-56abaa/AC-001][covers:F-d12edf/AC-004] extracts each of the six sentinels independently", () => {
    const raw = [
      '=== ONBOARDING_MODE ===',
      'greenfield',
      '=== PROJECT_CONTEXT_MD ===',
      '# foo\n',
      '=== CAPABILITIES_YAML ===',
      'schema: "0.1"',
      'capabilities: []',
      '=== ARCHITECTURE_YAML ===',
      'version: "0.1"',
      'layers: []',
      '=== SPEC_SEED_TITLE ===',
      '결제 인증 흐름',
      '=== CLARIFYING_QUESTIONS ===',
      '- 주 사용자가 개인? 사업자?',
      '- 어떤 결제수단 우선?',
    ].join('\n');
    const out = parseOnboardingResponse(raw);
    expect(out.mode).toBe('greenfield');
    expect(out.projectContext).toContain('# foo');
    expect(out.capabilities).toContain('schema: "0.1"');
    expect(out.architecture).toContain('version: "0.1"');
    expect(out.specSeedTitle).toBe('결제 인증 흐름');
    expect(out.clarifyingQuestionsRaw).toContain('주 사용자가 개인? 사업자?');
  });

  test('missing section yields empty string for that part', () => {
    const out = parseOnboardingResponse('=== ONBOARDING_MODE ===\nmixed\n');
    expect(out.mode).toBe('mixed');
    expect(out.projectContext).toBe('');
    expect(out.capabilities).toBe('');
    expect(out.specSeedTitle).toBe('');
  });
});

describe('normaliseMode', () => {
  test.each([
    ['greenfield', 'greenfield'],
    ['Greenfield', 'greenfield'],
    ['existing-adoption', 'existing-adoption'],
    ['Existing adoption', 'existing-adoption'],
    ['mixed', 'mixed'],
    ['MIXED', 'mixed'],
    ['nonsense', 'greenfield'],
    ['', 'greenfield'],
  ])('"%s" → %s', (input, expected) => {
    expect(normaliseMode(input)).toBe(expected);
  });
});

describe('extractClarifyingQuestions', () => {
  test('parses a dash-bulleted list', () => {
    const out = extractClarifyingQuestions('- one?\n- two?\n- three?\n');
    expect(out).toEqual(['one?', 'two?', 'three?']);
  });

  test('parses a numbered list', () => {
    const out = extractClarifyingQuestions('1. one?\n2) two?\n3. three?\n');
    expect(out).toEqual(['one?', 'two?', 'three?']);
  });

  test('parses raw lines without bullets', () => {
    const out = extractClarifyingQuestions('one?\n\ntwo?\n  three?  \n');
    expect(out).toEqual(['one?', 'two?', 'three?']);
  });

  test('caps incomplete material questions at three', () => {
    const raw = ['- a', '- b', '- c', '- d', '- e', '- f', '- g'].join('\n');
    expect(extractClarifyingQuestions(raw)).toEqual(['a', 'b', 'c']);
  });

  test('empty input returns empty array', () => {
    expect(extractClarifyingQuestions('')).toEqual([]);
    expect(extractClarifyingQuestions('  \n  \n')).toEqual([]);
  });
});

describe('extractProjectMetadata (F-00eb1a)', () => {
  test('empty block → undefined', () => {
    expect(extractProjectMetadata('')).toBeUndefined();
    expect(extractProjectMetadata('   ')).toBeUndefined();
  });

  test("[covers:F-00eb1a/AC-005] full ai_hints block → all 5 fields", () => {
    const raw = [
      'preferred_persona: software-engineer',
      'token_budget_per_session: 4000',
      'test_framework: vitest',
      'primary_branch: develop',
      'forbidden_patterns: ["eval(", "innerHTML"]',
    ].join('\n');
    const out = extractProjectMetadata(raw);
    expect(out).toBeDefined();
    expect(out?.preferred_persona).toBe('software-engineer');
    expect(out?.token_budget_per_session).toBe(4000);
    expect(out?.test_framework).toBe('vitest');
    expect(out?.primary_branch).toBe('develop');
    expect(out?.forbidden_patterns).toEqual(['eval(', 'innerHTML']);
  });

  test('partial block → only present keys', () => {
    const out = extractProjectMetadata('preferred_persona: planner\n');
    expect(out).toEqual({preferred_persona: 'planner'});
  });

  test('malformed YAML → undefined', () => {
    const out = extractProjectMetadata('preferred_persona: [unclosed array');
    expect(out).toBeUndefined();
  });

  test('non-object root → undefined', () => {
    expect(extractProjectMetadata('- a\n- b')).toBeUndefined();
    expect(extractProjectMetadata('"just a string"')).toBeUndefined();
  });

  test('invalid token_budget (string) → field dropped', () => {
    const out = extractProjectMetadata('token_budget_per_session: "lots"\npreferred_persona: x');
    expect(out?.token_budget_per_session).toBeUndefined();
    expect(out?.preferred_persona).toBe('x');
  });

  test('forbidden_patterns non-array → field dropped', () => {
    const out = extractProjectMetadata('forbidden_patterns: "eval"');
    expect(out?.forbidden_patterns).toBeUndefined();
  });

  test('unknown keys ignored (additionalProperties: false at schema layer)', () => {
    const out = extractProjectMetadata('preferred_persona: x\nunknown_field: y');
    expect(out).toEqual({preferred_persona: 'x'});
  });

  test("[covers:F-32b1e0/AC-001][covers:F-32b1e0/AC-002][covers:F-32b1e0/AC-003] preferred_patterns parsed as triples with required keys (F-32b1e0)", () => {
    const raw = [
      'preferred_patterns:',
      '  - when: "React state"',
      '    prefer: "useState"',
      '    over: "this.state"',
      '  - when: "async"',
      '    prefer: "async/await"',
    ].join('\n');
    const out = extractProjectMetadata(raw);
    expect(out?.preferred_patterns).toEqual([
      {when: 'React state', prefer: 'useState', over: 'this.state'},
      {when: 'async', prefer: 'async/await'},
    ]);
  });

  test('preferred_patterns drops entries missing required when or prefer', () => {
    const raw = [
      'preferred_patterns:',
      '  - prefer: "missing when"',
      '  - when: "missing prefer"',
      '  - when: "complete"',
      '    prefer: "use this"',
    ].join('\n');
    const out = extractProjectMetadata(raw);
    expect(out?.preferred_patterns).toEqual([{when: 'complete', prefer: 'use this'}]);
  });

  test('preferred_patterns non-array → field dropped', () => {
    const out = extractProjectMetadata('preferred_patterns: "not a list"');
    expect(out?.preferred_patterns).toBeUndefined();
  });

  test('preferred_patterns with all entries malformed → field dropped', () => {
    const raw = 'preferred_patterns:\n  - foo: bar\n  - "string entry"';
    const out = extractProjectMetadata(raw);
    expect(out?.preferred_patterns).toBeUndefined();
  });
});

describe('deterministicOnboarding', () => {
  test('greenfield + 0 source files → mode greenfield', () => {
    const r = deterministicOnboarding('결제 SaaS', fakeObserved());
    expect(r.mode).toBe('greenfield');
    expect(r.source).toBe('deterministic');
  });

  test('observed source files ≥ 3 → mode existing-adoption', () => {
    const r = deterministicOnboarding('refactor', fakeObserved({sourceFileCount: 10}));
    expect(r.mode).toBe('existing-adoption');
  });

  test('quotes intent verbatim in project-context body', () => {
    const r = deterministicOnboarding('내가 만들 프로젝트', fakeObserved());
    expect(r.projectContextMd).toContain('내가 만들 프로젝트');
  });

  test('spec seed title falls back to the trimmed intent', () => {
    const r = deterministicOnboarding('결제 SaaS for B2B', fakeObserved());
    expect(r.specSeedTitle).toBe('결제 SaaS for B2B');
  });

  test('long intent gets truncated to fit the seed title', () => {
    const long = 'a'.repeat(100);
    const r = deterministicOnboarding(long, fakeObserved());
    expect(r.specSeedTitle.length).toBeLessThanOrEqual(60);
    expect(r.specSeedTitle.endsWith('…')).toBe(true);
  });

  test('[covers:F-0f4dd6/AC-011] complete deterministic inputs ask zero questions while incomplete material questions cap at three', () => {
    const r = deterministicOnboarding('demo', fakeObserved());
    expect(r.clarifyingQuestions).toEqual([]);
    expect(r.projectContextMd).not.toBe('');
    expect(r.capabilitiesYaml).toContain('capabilities: []');
    expect(r.architectureYaml).toContain('layers: []');
    expect(extractClarifyingQuestions('- audience?\n- scope?\n- goal?\n- market?')).toEqual([
      'audience?', 'scope?', 'goal?',
    ]);
  });
});

describe('interpretOnboardingWithFallback', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-onboarding-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('dispatcher === null → deterministic, no event emitted', async () => {
    const r = await interpretOnboardingWithFallback('demo', fakeObserved(), null, dir);
    expect(r.source).toBe('deterministic');
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(0);
  });

  test("[covers:F-56abaa/AC-003] dispatcher throws → deterministic + onboarding sentinel_miss event", async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('transport down');
    });
    const r = await interpretOnboardingWithFallback('demo', fakeObserved(), dispatch, dir);
    expect(r.source).toBe('deterministic');
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'onboarding',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: 'transport down',
    });
  });

  test('LLM success → full onboarding result', async () => {
    const dispatch = vi.fn(async () =>
      [
        '=== ONBOARDING_MODE ===',
        'greenfield',
        '=== PROJECT_CONTEXT_MD ===',
        '# A',
        '## 1. Why\nfoo',
        '=== CAPABILITIES_YAML ===',
        'schema: "0.1"',
        'capabilities:',
        '  - id: auth',
        '    title: "Auth"',
        '=== ARCHITECTURE_YAML ===',
        'version: "0.1"',
        'layers: []',
        '=== SPEC_SEED_TITLE ===',
        '결제 인증 흐름',
        '=== CLARIFYING_QUESTIONS ===',
        '- 주 사용자가 개인? 사업자?',
        '- 한국 시장? 글로벌?',
      ].join('\n'),
    );
    const r = await interpretOnboardingWithFallback('결제 SaaS', fakeObserved(), dispatch, dir);
    expect(r.source).toBe('llm');
    expect(r.mode).toBe('greenfield');
    expect(r.specSeedTitle).toBe('결제 인증 흐름');
    expect(r.clarifyingQuestions).toEqual(['주 사용자가 개인? 사업자?', '한국 시장? 글로벌?']);
    expect(r.projectContextMd).toContain('Why');
    expect(r.capabilitiesYaml).toContain('- id: auth');
    expect(r.architectureYaml).toContain('layers: []');
  });

  test("[covers:F-56abaa/AC-004] per-artifact fallback: empty CAPABILITIES_YAML alone keeps mode llm-hybrid", async () => {
    const dispatch = vi.fn(async () =>
      [
        '=== ONBOARDING_MODE ===',
        'greenfield',
        '=== PROJECT_CONTEXT_MD ===',
        '# A',
        '=== ARCHITECTURE_YAML ===',
        'version: "0.1"\nlayers: []',
        '=== SPEC_SEED_TITLE ===',
        'foo',
      ].join('\n'),
    );
    const r = await interpretOnboardingWithFallback('demo', fakeObserved(), dispatch, dir);
    expect(r.source).toBe('hybrid');
    // Capabilities falls back to greenfield seed
    expect(r.capabilitiesYaml).toContain('capabilities: []');
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'onboarding',
      cause: 'blank_section',
      fallback: 'per_artifact',
    });
    expect(events[0].payload.missed_sections).toContain('CAPABILITIES_YAML');
  });

  test('total fallback: PROJECT_CONTEXT + CAPABILITIES + ARCHITECTURE all blank → deterministic', async () => {
    const dispatch = vi.fn(async () => '=== ONBOARDING_MODE ===\nmixed\n=== SPEC_SEED_TITLE ===\nfoo\n');
    const r = await interpretOnboardingWithFallback('demo', fakeObserved(), dispatch, dir);
    expect(r.source).toBe('deterministic');
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      phase: 'onboarding',
      cause: 'blank_section',
      fallback: 'total',
    });
  });

  test('cwd omitted → telemetry stays silent', async () => {
    const dispatch = vi.fn<(p: string) => Promise<string>>(async () => {
      throw new Error('whatever');
    });
    const r = await interpretOnboardingWithFallback('demo', fakeObserved(), dispatch);
    expect(r.source).toBe('deterministic');
    // No event because no cwd was passed
    const events = readEvents(dir).filter((e) => e.type === 'sentinel_miss');
    expect(events).toHaveLength(0);
  });
});
