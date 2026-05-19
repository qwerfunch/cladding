// Cladding · unit tests for drive/loop.ts
//
// The autonomous-loop entry point. Branches under test:
//   - spec load failure → UNCAUGHT_ERROR halt
//   - empty spec / all features already done → ALL_FEATURES_DONE
//   - feature with unresolved depends_on → BLOCKED_FEATURE
//   - specialist throws → LLM_UNAVAILABLE
//   - L1 gate fails → loop retries the same feature
//   - reviewer identity collision → HUMAN_REQUIRED
//   - UAT pass=false + exitCode != 2 → HUMAN_REQUIRED
//   - happy path completes → ALL_FEATURES_DONE
//   - budget halt (MAX_ITERATIONS) → exits loop
//
// Heavy-mock approach: spec/load, agents/loader, drive/agent (runAgent),
// stage runners, hitl/audit, events/log all stubbed via vi.mock so the
// loop's control flow can be exercised deterministically.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/spec/load.js', () => ({loadSpec: vi.fn()}));
vi.mock('../../src/agents/loader.js', () => ({loadPersona: vi.fn()}));
vi.mock('../../src/drive/agent.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/drive/agent.js')>(
    '../../src/drive/agent.js',
  );
  return {
    runAgent: vi.fn(),
    ReviewerIdentityCollisionError: actual.ReviewerIdentityCollisionError,
  };
});
vi.mock('../../src/stages/type.js', () => ({runType: vi.fn()}));
vi.mock('../../src/stages/lint.js', () => ({runLint: vi.fn()}));
vi.mock('../../src/stages/arch.js', () => ({runArch: vi.fn()}));
vi.mock('../../src/stages/uat.js', () => ({runUat: vi.fn()}));
vi.mock('../../src/events/log.js', () => ({
  appendEvent: vi.fn(),
  newEvent: (type: string, payload: Record<string, unknown>) => ({
    id: 'ev-mock',
    timestamp: '2026-05-19T00:00:00Z',
    type,
    payload,
  }),
}));
vi.mock('../../src/hitl/audit.js', () => ({appendEvidence: vi.fn()}));

const {runDriveLoop} = await import('../../src/drive/loop.js');
const {loadSpec} = await import('../../src/spec/load.js');
const {loadPersona} = await import('../../src/agents/loader.js');
const driveAgent = await import('../../src/drive/agent.js');
const {runType} = await import('../../src/stages/type.js');
const {runLint} = await import('../../src/stages/lint.js');
const {runArch} = await import('../../src/stages/arch.js');
const {runUat} = await import('../../src/stages/uat.js');

const loadSpecMock = loadSpec as unknown as ReturnType<typeof vi.fn>;
const loadPersonaMock = loadPersona as unknown as ReturnType<typeof vi.fn>;
const runAgentMock = driveAgent.runAgent as unknown as ReturnType<typeof vi.fn>;
const runTypeMock = runType as unknown as ReturnType<typeof vi.fn>;
const runLintMock = runLint as unknown as ReturnType<typeof vi.fn>;
const runArchMock = runArch as unknown as ReturnType<typeof vi.fn>;
const runUatMock = runUat as unknown as ReturnType<typeof vi.fn>;

const PASS = {pass: true, exitCode: 0, stage: 'stage_x'};

function specOf(features: Array<{id: string; status: string; depends_on?: string[]; modules?: string[]}>): {
  schema: '0.1';
  project: {name: string; language: string};
  features: Array<{id: string; title: string; status: string; depends_on?: string[]; modules?: string[]}>;
} {
  return {
    schema: '0.1',
    project: {name: 'x', language: 'typescript'},
    features: features.map((f) => ({
      title: f.id,
      depends_on: f.depends_on,
      modules: f.modules ?? [],
      ...f,
    })),
  };
}

describe('runDriveLoop', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-loop-'));
    loadSpecMock.mockReset();
    loadPersonaMock.mockReset();
    loadPersonaMock.mockReturnValue({id: 'mock', body: '', capabilities: new Set()});
    runAgentMock.mockReset();
    runAgentMock.mockResolvedValue({result: {identity: {name: 'specialist-mock'}, mutations: []}});
    runTypeMock.mockReset();
    runTypeMock.mockReturnValue(PASS);
    runLintMock.mockReset();
    runLintMock.mockReturnValue(PASS);
    runArchMock.mockReset();
    runArchMock.mockReturnValue(PASS);
    runUatMock.mockReset();
    runUatMock.mockReturnValue({pass: true, exitCode: 0, stage: 'stage_4.2'});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('spec load failure → UNCAUGHT_ERROR halt', async () => {
    loadSpecMock.mockImplementationOnce(() => {
      throw new Error('spec.yaml malformed');
    });
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('UNCAUGHT_ERROR');
    expect(r.halt.detail).toContain('spec.yaml malformed');
    expect(r.iterations).toBe(0);
  });

  test('empty spec → ALL_FEATURES_DONE on first iteration', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([]));
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('ALL_FEATURES_DONE');
  });

  test('all features already done → ALL_FEATURES_DONE without dispatching', async () => {
    loadSpecMock.mockReturnValueOnce(
      specOf([
        {id: 'F-001', status: 'done'},
        {id: 'F-002', status: 'archived'},
      ]),
    );
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  test('feature with unresolved depends_on → BLOCKED_FEATURE', async () => {
    loadSpecMock.mockReturnValueOnce(
      specOf([{id: 'F-002', status: 'planned', depends_on: ['F-999']}]),
    );
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('BLOCKED_FEATURE');
  });

  test('specialist throws → LLM_UNAVAILABLE halt', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
    runAgentMock.mockReset();
    runAgentMock.mockRejectedValueOnce(new Error('mock-transport offline'));
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('LLM_UNAVAILABLE');
    expect(r.halt.detail).toContain('specialist dispatch failed');
  });

  test('L1 gate fails → retry (loop continues until budget halt)', async () => {
    loadSpecMock.mockReturnValue(specOf([{id: 'F-001', status: 'planned'}]));
    runLintMock.mockReturnValue({pass: false, exitCode: 1, stage: 'stage_1.2', stderr: 'lint err'});
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 3, maxWallClockMs: 60000, maxRetriesPerFeature: 10},
    });
    expect(r.halt.class).toBe('MAX_ITERATIONS');
    // The budget check fires on iteration N+1 (before gates run), so
    // with maxIterations=3 the gates run on iterations 1 and 2 only:
    // 2 iterations × 3 gates = 6.
    expect(r.gateRuns).toBe(6);
  });

  test('reviewer identity collision → HUMAN_REQUIRED', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
    runAgentMock.mockReset();
    runAgentMock
      .mockResolvedValueOnce({result: {identity: {name: 'shared'}, mutations: []}})
      .mockRejectedValueOnce(new driveAgent.ReviewerIdentityCollisionError('shared'));
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('HUMAN_REQUIRED');
    expect(r.halt.detail).toContain('reviewer identity matched implementer');
  });

  test('reviewer non-collision error → LLM_UNAVAILABLE', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
    runAgentMock.mockReset();
    runAgentMock
      .mockResolvedValueOnce({result: {identity: {name: 'specialist'}, mutations: []}})
      .mockRejectedValueOnce(new Error('reviewer transport timeout'));
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('LLM_UNAVAILABLE');
    expect(r.halt.detail).toContain('reviewer dispatch failed');
  });

  test('UAT pass=false + exitCode=1 → HUMAN_REQUIRED', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
    runUatMock.mockReturnValue({pass: false, exitCode: 1, stage: 'stage_4.2', stderr: 'no human evidence'});
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('HUMAN_REQUIRED');
    expect(r.halt.detail).toContain('UAT lacks human-pass evidence');
  });

  test('UAT exitCode=2 (skip) is tolerated → feature completes', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
    runUatMock.mockReturnValue({pass: false, exitCode: 2, stage: 'stage_4.2', stderr: 'no audit log'});
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    expect(r.featuresTouched).toContain('F-001');
  });

  test('happy path: single feature → ALL_FEATURES_DONE', async () => {
    loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned', modules: ['stages/x.ts']}]));
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    expect(r.featuresTouched).toContain('F-001');
    expect(r.stubsCreated.length).toBeGreaterThan(0); // mock returns 0 mutations → stub fallback
  });

  test('two features in dependency order both complete', async () => {
    loadSpecMock.mockReturnValueOnce(
      specOf([
        {id: 'F-001', status: 'planned'},
        {id: 'F-002', status: 'planned', depends_on: ['F-001']},
      ]),
    );
    const r = await runDriveLoop({cwd: dir});
    expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    expect(r.featuresTouched).toEqual(['F-001', 'F-002']);
  });
});
