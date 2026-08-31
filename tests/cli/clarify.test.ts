// Cladding · unit tests for cli/clarify (v0.3.44, F-09d68b; verb renamed from `refine` in 0.6.0)
//
// Integration-style tests over a tmpdir. The dispatcher chain is
// mocked at module-load time so `--no-llm` deterministic and LLM
// success paths can both be exercised end-to-end.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
const dispatchMock = vi.fn<(p: string) => Promise<string>>();
vi.mock('../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {refineOnboarding, resolveOnboardingReview, runClarifyCommand} = await import('../../src/cli/clarify.js');
const {captureArtifactDigests, saveState, loadState} = await import('../../src/cli/scan/onboarding-state.js');
const {commitSchema01CompatibilityMutation} = await import('../../src/spec/edit.js');
const {extractScenarios} = await import('../../src/cli/scan/intent-onboarding.js');

function seedState(cwd: string, qa: Array<{question: string; answer: string | null}>): void {
  saveState(cwd, {
    intent: '결제 SaaS for B2B',
    language: 'typescript',
    projectName: 'demo',
    mode: 'greenfield',
    startedAt: '2026-05-21T00:00:00.000Z',
    status: 'active',
    qa,
  });
}

function seedArtifacts(cwd: string): void {
  mkdirSync(join(cwd, 'docs'), {recursive: true});
  mkdirSync(join(cwd, 'spec'), {recursive: true});
  writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\n');
  writeFileSync(join(cwd, 'docs', 'project-context.md'), '# old project context\n');
  writeFileSync(
    join(cwd, 'spec', 'capabilities.yaml'),
    'schema: "0.1"\nsource: README.md\ncapabilities: []\n',
  );
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'version: "0.1"\nlayers: []\n');
  saveState(cwd, {...loadState(cwd)!, artifactDigests: captureArtifactDigests(cwd)});
}

describe('runClarifyCommand', () => {
  let dir: string;
  let exitCalls: number[];
  let stdoutChunks: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-clarify-'));
    exitCalls = [];
    stdoutChunks = [];
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    dispatchMock.mockReset();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    rmSync(dir, {recursive: true, force: true});
  });

  test('exit 2 when no state file exists', async () => {
    await runClarifyCommand(['answer'], {cwd: dir});
    expect(exitCalls).toEqual([2]);
  });

  test('review resolution rejects a state-injected path outside onboarding artifacts', () => {
    seedState(dir, []);
    saveState(dir, {
      ...loadState(dir)!,
      status: 'needs_review',
      pendingReview: ['../escape.yaml'],
    });
    const result = resolveOnboardingReview(['../escape.yaml'], {cwd: dir});
    expect(result).toMatchObject({ok: false, changed: false});
    expect(result.error).toMatch(/onboarding design artifacts/);
  });

  test('review resolution accepts a current hash8 scenario shard', () => {
    seedState(dir, []);
    const target = 'spec/scenarios/checkout-abcdef12.yaml';
    mkdirSync(join(dir, '.cladding', 'scan'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'scan', 'checkout-abcdef12.yaml.proposal'), 'id: S-abcdef12\n');
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
    saveState(dir, {...loadState(dir)!, status: 'needs_review', pendingReview: [target], pendingReviewBases: {[target]: {absent: true}}});
    expect(resolveOnboardingReview([target], {cwd: dir})).toMatchObject({ok: true, changed: true, status: 'done'});
    expect(readFileSync(join(dir, target), 'utf8')).toContain('S-abcdef12');
  });

  test('review resolution leaves a proposal untouched when a concurrent schema 0.2 migration wins', () => {
    seedState(dir, []);
    const target = 'spec/scenarios/checkout-abcdef12.yaml';
    mkdirSync(join(dir, '.cladding', 'scan'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'scan', 'checkout-abcdef12.yaml.proposal'), 'id: S-abcdef12\n');
    saveState(dir, {...loadState(dir)!, status: 'needs_review', pendingReview: [target], pendingReviewBases: {[target]: {absent: true}}});
    // This is the version observed by the compatibility transaction under its
    // lock, not a preflight-only branch in the onboarding adapter.
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.2"\n');
    const result = resolveOnboardingReview([target], {cwd: dir});
    expect(result).toMatchObject({ok: false, changed: false});
    expect(existsSync(join(dir, target))).toBe(false);
    expect(existsSync(join(dir, '.cladding', 'scan', 'checkout-abcdef12.yaml.proposal'))).toBe(true);
  });

  test('review reports its committed canonical change and retains the proposal when state persistence fails', () => {
    seedState(dir, []);
    const target = 'spec/scenarios/checkout-abcdef12.yaml';
    mkdirSync(join(dir, '.cladding', 'scan'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
    writeFileSync(join(dir, '.cladding', 'scan', 'checkout-abcdef12.yaml.proposal'), 'id: S-abcdef12\n');
    saveState(dir, {...loadState(dir)!, status: 'needs_review', pendingReview: [target], pendingReviewBases: {[target]: {absent: true}}});
    const result = resolveOnboardingReview([target], {cwd: dir, testFailStateSave: true});
    expect(result).toMatchObject({ok: false, changed: true});
    expect(readFileSync(join(dir, target), 'utf8')).toContain('S-abcdef12');
    expect(existsSync(join(dir, '.cladding', 'scan', 'checkout-abcdef12.yaml.proposal'))).toBe(true);
    expect(loadState(dir)!.status).toBe('needs_review');
  });

  test('[covers:F-0f4dd6/AC-013] active refinement rejects a cooperative target update after its LLM preimage was captured', async () => {
    seedState(dir, [{question: 'Q1?', answer: null}]);
    seedArtifacts(dir);
    const target = 'docs/project-context.md';
    const base = readFileSync(join(dir, target), 'utf8');
    const successor = '# successor authored context\n';
    dispatchMock.mockResolvedValue([
      '=== ONBOARDING_MODE ===', 'greenfield', '=== PROJECT_CONTEXT_MD ===', '# generated',
      '=== CAPABILITIES_YAML ===', 'schema: "0.1"\ncapabilities: []',
      '=== ARCHITECTURE_YAML ===', 'version: "0.1"\nlayers: []',
      '=== SPEC_SEED_TITLE ===', 't', '=== CLARIFYING_QUESTIONS ===', '',
    ].join('\n'));

    const result = await refineOnboarding('answer', {
      cwd: dir,
      testBeforeCanonicalCommit: () => commitSchema01CompatibilityMutation(dir, [{path: target, before: base, after: successor}]),
    });

    expect(result).toMatchObject({ok: false, code: 1});
    expect(result.error).toContain('changed while the mutation was being prepared');
    expect(readFileSync(join(dir, target), 'utf8')).toBe(successor);
    expect(loadState(dir)!.qa[0].answer).toBeNull();
  });

  test('[covers:F-09d68b/AC-005] active refinement commits artifacts through the compatibility transaction', async () => {
    seedState(dir, [{question: 'Q1?', answer: null}]);
    seedArtifacts(dir);
    const scenariosRaw = '- slug: checkout\n  title: Checkout\n  flow: complete payment\n';
    const scenario = extractScenarios(scenariosRaw)[0]!;
    const target = `spec/scenarios/${scenario.slug}-${scenario.id.replace(/^S-/, '')}.yaml`;
    const base = 'id: existing\nflow: base\n';
    const successor = 'id: existing\nflow: successor\n';
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(join(dir, target), base);
    dispatchMock.mockResolvedValue([
      '=== ONBOARDING_MODE ===', 'greenfield', '=== PROJECT_CONTEXT_MD ===', '# generated',
      '=== CAPABILITIES_YAML ===', 'schema: "0.1"\ncapabilities: []',
      '=== ARCHITECTURE_YAML ===', 'version: "0.1"\nlayers: []',
      '=== SPEC_SEED_TITLE ===', 't', '=== SCENARIOS_YAML ===', scenariosRaw,
      '=== CLARIFYING_QUESTIONS ===', '',
    ].join('\n'));

    const result = await refineOnboarding('answer', {
      cwd: dir,
      testBeforeCanonicalCommit: () => commitSchema01CompatibilityMutation(dir, [{path: target, before: base, after: successor}]),
    });

    expect(result).toMatchObject({ok: false, code: 1});
    expect(readFileSync(join(dir, target), 'utf8')).toBe(successor);
  });

  test('review rejects a cooperative target update after checking its persisted generation base', () => {
    seedState(dir, []);
    const target = 'spec/scenarios/checkout-abcdef12.yaml';
    const base = 'id: S-abcdef12\nflow: base\n';
    const successor = 'id: S-abcdef12\nflow: successor\n';
    mkdirSync(join(dir, '.cladding', 'scan'), {recursive: true});
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
    writeFileSync(join(dir, target), base);
    const proposal = join(dir, '.cladding', 'scan', 'checkout-abcdef12.yaml.proposal');
    writeFileSync(proposal, 'id: S-abcdef12\nflow: proposal\n');
    saveState(dir, {...loadState(dir)!, status: 'needs_review', pendingReview: [target], pendingReviewBases: {
      [target]: {sha256: createHash('sha256').update(base).digest('hex')},
    }});

    const result = resolveOnboardingReview([target], {
      cwd: dir,
      testBeforeCanonicalCommit: () => commitSchema01CompatibilityMutation(dir, [{path: target, before: base, after: successor}]),
    });

    expect(result).toMatchObject({ok: false, changed: false});
    expect(result.error).toContain('changed while the mutation was being prepared');
    expect(readFileSync(join(dir, target), 'utf8')).toBe(successor);
    expect(existsSync(proposal)).toBe(true);
    expect(loadState(dir)).toMatchObject({status: 'needs_review', pendingReview: [target]});
  });

  test('partial review retains the generation base for each unreviewed target', () => {
    seedState(dir, []);
    const first = 'spec/scenarios/first-abcdef12.yaml';
    const second = 'spec/scenarios/second-fedcba98.yaml';
    mkdirSync(join(dir, '.cladding', 'scan'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
    writeFileSync(join(dir, '.cladding', 'scan', 'first-abcdef12.yaml.proposal'), 'id: S-abcdef12\n');
    writeFileSync(join(dir, '.cladding', 'scan', 'second-fedcba98.yaml.proposal'), 'id: S-fedcba98\n');
    saveState(dir, {...loadState(dir)!, status: 'needs_review', pendingReview: [first, second], pendingReviewBases: {
      [first]: {absent: true}, [second]: {absent: true},
    }});

    expect(resolveOnboardingReview([first], {cwd: dir})).toMatchObject({ok: true, changed: true, remaining: [second]});
    expect(loadState(dir)).toMatchObject({
      status: 'needs_review',
      pendingReview: [second],
      pendingReviewBases: {[second]: {absent: true}},
    });
  });

  test('active refinement reports a recoverable partial outcome when state persistence follows a committed design', async () => {
    seedState(dir, [{question: 'Who uses this?', answer: null}]);
    seedArtifacts(dir);
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
    const outcome = await refineOnboarding('Operators', {cwd: dir, noLlm: true, testFailStateSave: true});
    expect(outcome).toMatchObject({ok: false, partial: true, code: 1});
    expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toContain('Operators');
    expect(loadState(dir)!.qa[0].answer).toBeNull();
  });

  test('exit 2 when no answer is provided but pending questions exist', async () => {
    seedState(dir, [{question: 'Q1?', answer: null}]);
    seedArtifacts(dir);
    await runClarifyCommand([], {cwd: dir});
    expect(exitCalls).toEqual([2]);
  });

  test('exit 0 with no-op when state status is already done', async () => {
    seedState(dir, [{question: 'Q1?', answer: 'A1'}]);
    saveState(dir, {...loadState(dir)!, status: 'done'});
    await runClarifyCommand(['stuff'], {cwd: dir});
    expect(exitCalls).toEqual([0]);
  });

  test('[covers:F-09d68b/AC-004][covers:F-09d68b/AC-003] joins answer tokens and commits the proposal-safe onboarding transition', async () => {
    seedState(dir, [
      {question: '주 사용자가 개인? 사업자?', answer: null},
      {question: '어떤 결제수단 우선?', answer: null},
    ]);
    seedArtifacts(dir);
    await runClarifyCommand(['법인', '사업자만'], {cwd: dir, noLlm: true});
    expect(exitCalls).toEqual([0]);
    const after = loadState(dir)!;
    expect(after.qa[0].answer).toBe('법인 사업자만');
    expect(after.qa[1].answer).toBeNull();
    // Untouched Cladding-generated design is refined in place so the active
    // context—not a detached proposal—contains the accepted answer.
    expect(existsSync(join(dir, '.cladding', 'scan', 'capabilities.yaml.proposal'))).toBe(false);
    const context = readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8');
    expect(context).toContain('Q&A log (refinement, LLM unavailable)');
    expect(context).toContain('법인 사업자만');
  });

  test('[covers:F-0f4dd6/AC-013] LLM success refines artifacts, adds new questions, keeps status active', async () => {
    seedState(dir, [
      {question: 'Q1?', answer: null},
      {question: 'Q2?', answer: null},
    ]);
    seedArtifacts(dir);
    dispatchMock.mockResolvedValueOnce(
      [
        '=== ONBOARDING_MODE ===',
        'greenfield',
        '=== PROJECT_CONTEXT_MD ===',
        '# refined context',
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
        '- Q3?',
        '- Q4?',
      ].join('\n'),
    );
    await runClarifyCommand(['A1'], {cwd: dir});
    expect(exitCalls).toEqual([0]);
    const after = loadState(dir)!;
    expect(after.qa[0].answer).toBe('A1');
    // New questions appended (de-duped against existing)
    expect(after.qa.map((q) => q.question)).toEqual(['Q1?', 'Q2?', 'Q3?', 'Q4?']);
    expect(after.status).toBe('active');
    expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toContain('refined context');
    expect(readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8')).toContain('id: auth');
    expect(readFileSync(join(dir, 'spec', 'architecture.yaml'), 'utf8')).toContain('layers: []');
    expect(existsSync(join(dir, '.cladding', 'scan', 'project-context.md.proposal'))).toBe(false);
  });

  test('[covers:F-09d68b/AC-002] sends complete answered history and current artifact bodies to the refinement dispatcher', async () => {
    seedState(dir, [
      {question: 'Who operates it?', answer: 'Treasury team'},
      {question: 'Which market?', answer: null},
    ]);
    seedArtifacts(dir);
    dispatchMock.mockResolvedValueOnce([
      '=== ONBOARDING_MODE ===',
      'greenfield',
      '=== PROJECT_CONTEXT_MD ===',
      '# refined context',
      '=== CAPABILITIES_YAML ===',
      'schema: "0.1"\ncapabilities: []',
      '=== ARCHITECTURE_YAML ===',
      'layers: []',
      '=== SPEC_SEED_TITLE ===',
      'Payment workflow',
      '=== CLARIFYING_QUESTIONS ===',
    ].join('\n'));

    await runClarifyCommand(['Korea'], {cwd: dir});

    const prompt = dispatchMock.mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('Who operates it?');
    expect(prompt).toContain('Treasury team');
    expect(prompt).toContain('Which market?');
    expect(prompt).toContain('Korea');
    expect(prompt).toContain('# old project context');
    expect(prompt).toContain('capabilities: []');
    expect(prompt).toContain('layers: []');
    expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toContain('refined context');
  });

  test('a user-edited design is preserved and onboarding remains in review', async () => {
    seedState(dir, [{question: 'Q1?', answer: null}]);
    seedArtifacts(dir);
    writeFileSync(join(dir, 'docs', 'project-context.md'), '# user-authored context\n');

    await runClarifyCommand(['A1'], {cwd: dir, noLlm: true});

    expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toBe('# user-authored context\n');
    expect(existsSync(join(dir, '.cladding', 'scan', 'project-context.md.proposal'))).toBe(true);
    expect(loadState(dir)!.status).toBe('needs_review');
  });

  test('[covers:F-0f4dd6/AC-36fea3e9][covers:F-195cb59e/AC-3b2026e1] LLM completion distinguishes on-demand checks from opt-in enforcement', async () => {
    seedState(dir, [{question: 'Q1?', answer: null}]);
    seedArtifacts(dir);
    dispatchMock.mockResolvedValueOnce(
      [
        '=== ONBOARDING_MODE ===',
        'greenfield',
        '=== PROJECT_CONTEXT_MD ===',
        '# done',
        '=== CAPABILITIES_YAML ===',
        'schema: "0.1"\ncapabilities: []',
        '=== ARCHITECTURE_YAML ===',
        'version: "0.1"\nlayers: []',
        '=== SPEC_SEED_TITLE ===',
        'final feature',
        '=== CLARIFYING_QUESTIONS ===',
      ].join('\n'),
    );
    await runClarifyCommand(['final answer'], {cwd: dir});
    expect(exitCalls).toEqual([0]);
    const after = loadState(dir)!;
    expect(after.status).toBe('done');
    // F-195cb59e AC-3b2026e1 — the completion message steers to authoring the
    // first feature's spec (with its acceptance criteria + files) before code.
    const out = stdoutChunks.join('');
    expect(out).toContain('first feature');
    expect(out).toContain('acceptance criteria');
    expect(out).toContain('before writing code');
    expect(out).toContain('clad check');
    expect(out).toContain('opt-in');
    expect(out).toContain('not enabled automatically');
  });

  test('--json emits a RefineReport', async () => {
    seedState(dir, [{question: 'Q1?', answer: null}]);
    seedArtifacts(dir);
    dispatchMock.mockResolvedValueOnce(
      [
        '=== ONBOARDING_MODE ===',
        'greenfield',
        '=== PROJECT_CONTEXT_MD ===',
        '# x',
        '=== CAPABILITIES_YAML ===',
        'schema: "0.1"\ncapabilities: []',
        '=== ARCHITECTURE_YAML ===',
        'version: "0.1"\nlayers: []',
        '=== SPEC_SEED_TITLE ===',
        't',
        '=== CLARIFYING_QUESTIONS ===',
        '- newQ?',
      ].join('\n'),
    );
    await runClarifyCommand(['answer text'], {cwd: dir, json: true});
    expect(exitCalls).toEqual([0]);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.cwd).toBe(dir);
    expect(parsed.answered).toEqual({question: 'Q1?', answer: 'answer text'});
    expect(parsed.newQuestions).toEqual(['newQ?']);
    expect(parsed.mode).toBe('greenfield');
    expect(parsed.status).toBe('active');
  });
});
