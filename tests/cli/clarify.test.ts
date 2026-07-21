// Cladding · unit tests for cli/clarify (v0.3.44, F-09d68b; verb renamed from `refine` in 0.6.0)
//
// Integration-style tests over a tmpdir. The dispatcher chain is
// mocked at module-load time so `--no-llm` deterministic and LLM
// success paths can both be exercised end-to-end.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
const dispatchMock = vi.fn<(p: string) => Promise<string>>();
vi.mock('../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {resolveOnboardingReview, runClarifyCommand} = await import('../../src/cli/clarify.js');
const {captureArtifactDigests, saveState, loadState} = await import('../../src/cli/scan/onboarding-state.js');

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

  test('deterministic (--no-llm) marks the answer + preserves current artifacts + appends footnote', async () => {
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

  test('LLM success refines artifacts, adds new questions, keeps status active', async () => {
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
    expect(existsSync(join(dir, '.cladding', 'scan', 'project-context.md.proposal'))).toBe(false);
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

  test('LLM returns no new questions AND every existing question is answered → marks done', async () => {
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
