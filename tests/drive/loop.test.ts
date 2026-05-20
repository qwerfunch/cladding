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
vi.mock('../../src/core/checkpoint.js', () => ({
  recordCheckpoint: vi.fn(() => ({
    featureId: 'F-mock',
    gitHead: 'mockhead0000000000000000000000000000000',
    specDigest: 'mockdigest'.padEnd(64, '0'),
    timestamp: '2026-05-20T00:00:00Z',
  })),
  findLatestCheckpoint: vi.fn(() => ({
    featureId: 'F-mock',
    gitHead: 'mockhead0000000000000000000000000000000',
    specDigest: 'mockdigest'.padEnd(64, '0'),
    timestamp: '2026-05-20T00:00:00Z',
  })),
  recordRollback: vi.fn(),
}));
vi.mock('../../src/core/postmortem.js', () => ({
  writePostMortem: vi.fn(() => '/mock/post-mortem-path.md'),
}));
vi.mock('../../src/hitl/identity.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/hitl/identity.js')>(
    '../../src/hitl/identity.js',
  );
  // Spy on `newEvidence` so the per-AC fan-out can be inspected.
  return {...actual, newEvidence: vi.fn(actual.newEvidence)};
});
// Pre-flight health check (v0.2.23) — stub a healthy adapter so the
// existing control-flow tests are unaffected. Tests that exercise the
// pre-flight failure path override `healthCheck` per test.
vi.mock('../../src/adapters/index.js', () => ({
  selectAdapter: vi.fn(() => ({
    mode: 'host',
    name: 'stub',
    capabilities: new Set(['read', 'write', 'edit', 'exec', 'dispatch']),
    invokeAgent: vi.fn(),
    healthCheck: vi.fn(async () => ({ready: true})),
  })),
}));

const {runDriveLoop} = await import('../../src/drive/loop.js');
const {loadSpec} = await import('../../src/spec/load.js');
const {loadPersona} = await import('../../src/agents/loader.js');
const driveAgent = await import('../../src/drive/agent.js');
const adaptersIndex = await import('../../src/adapters/index.js');
const {runType} = await import('../../src/stages/type.js');
const {runLint} = await import('../../src/stages/lint.js');
const {runArch} = await import('../../src/stages/arch.js');
const {runUat} = await import('../../src/stages/uat.js');
const identity = await import('../../src/hitl/identity.js');
const newEvidenceMock = identity.newEvidence as unknown as ReturnType<typeof vi.fn>;
const checkpointMod = await import('../../src/core/checkpoint.js');
const recordCheckpointMock = checkpointMod.recordCheckpoint as unknown as ReturnType<typeof vi.fn>;
const findLatestCheckpointMock = checkpointMod.findLatestCheckpoint as unknown as ReturnType<typeof vi.fn>;
const recordRollbackMock = checkpointMod.recordRollback as unknown as ReturnType<typeof vi.fn>;
const postmortemMod = await import('../../src/core/postmortem.js');
const writePostMortemMock = postmortemMod.writePostMortem as unknown as ReturnType<typeof vi.fn>;

const selectAdapterMock = adaptersIndex.selectAdapter as unknown as ReturnType<typeof vi.fn>;

const loadSpecMock = loadSpec as unknown as ReturnType<typeof vi.fn>;
const loadPersonaMock = loadPersona as unknown as ReturnType<typeof vi.fn>;
const runAgentMock = driveAgent.runAgent as unknown as ReturnType<typeof vi.fn>;
const runTypeMock = runType as unknown as ReturnType<typeof vi.fn>;
const runLintMock = runLint as unknown as ReturnType<typeof vi.fn>;
const runArchMock = runArch as unknown as ReturnType<typeof vi.fn>;
const runUatMock = runUat as unknown as ReturnType<typeof vi.fn>;

const PASS = {pass: true, exitCode: 0, stage: 'stage_x'};

function specOf(
  features: Array<{
    id: string;
    status: string;
    depends_on?: string[];
    modules?: string[];
    acceptance_criteria?: Array<{id: string}>;
  }>,
): {
  schema: '0.1';
  project: {name: string; language: string};
  features: Array<{
    id: string;
    title: string;
    status: string;
    depends_on?: string[];
    modules?: string[];
    acceptance_criteria?: Array<{id: string}>;
  }>;
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
    // Pre-flight health check (v0.2.23, F-072) — re-establish the
    // healthy-stub default so `mockReturnValueOnce` queues from prior
    // tests don't leak into the next one.
    selectAdapterMock.mockReset();
    selectAdapterMock.mockImplementation(() => ({
      mode: 'host' as const,
      name: 'stub',
      capabilities: new Set(['read', 'write', 'edit', 'exec', 'dispatch']),
      invokeAgent: vi.fn(),
      healthCheck: vi.fn(async () => ({ready: true})),
    }));
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
      .mockRejectedValueOnce(new Error('reviewer transport failure'));
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

  // Iron Law backbone Phase 3.2 (v0.3.21, F-x) — drive loop pins a
  // checkpoint before each specialist dispatch and auto-records a
  // rollback when a feature exhausts its retry budget.
  describe('checkpoint + auto-rollback (Phase 3.2)', () => {
    test('every feature dispatch is preceded by a recordCheckpoint call', async () => {
      loadSpecMock.mockReturnValueOnce(
        specOf([
          {id: 'F-001', status: 'planned'},
          {id: 'F-002', status: 'planned', depends_on: ['F-001']},
        ]),
      );
      recordCheckpointMock.mockClear();
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
      // Each ready feature triggers exactly one checkpoint.
      const checkpointedFeatures = recordCheckpointMock.mock.calls.map((c) => c[1]);
      expect(checkpointedFeatures).toEqual(['F-001', 'F-002']);
    });

    test('RETRY_THRESHOLD halt triggers a recordRollback for the exhausted feature', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-999', status: 'planned'}]));
      // Force every L1 gate run to fail so the loop retries until the
      // budget is exhausted.
      runTypeMock.mockReturnValue({pass: false, exitCode: 1, stage: 'stage_1.1'});
      recordRollbackMock.mockClear();
      findLatestCheckpointMock.mockClear();
      const r = await runDriveLoop({
        cwd: dir,
        budget: {maxIterations: 50, maxWallClockMs: 600_000, maxRetriesPerFeature: 3},
      });
      expect(r.halt.class).toBe('RETRY_THRESHOLD');
      expect(recordRollbackMock).toHaveBeenCalledOnce();
      expect(recordRollbackMock.mock.calls[0][1]).toBe('F-999');
      expect(String(recordRollbackMock.mock.calls[0][3])).toContain('retry budget exhausted');
    });

    test('RETRY_THRESHOLD with no prior checkpoint records no rollback (defensive)', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-888', status: 'planned'}]));
      runTypeMock.mockReturnValue({pass: false, exitCode: 1, stage: 'stage_1.1'});
      findLatestCheckpointMock.mockReturnValueOnce(null);
      recordRollbackMock.mockClear();
      const r = await runDriveLoop({
        cwd: dir,
        budget: {maxIterations: 50, maxWallClockMs: 600_000, maxRetriesPerFeature: 3},
      });
      expect(r.halt.class).toBe('RETRY_THRESHOLD');
      // No checkpoint exists for F-888 → rollback is not recorded.
      expect(recordRollbackMock).not.toHaveBeenCalled();
    });

    test('non-RETRY_THRESHOLD halt does not invoke rollback', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-200', status: 'planned'}]));
      recordRollbackMock.mockClear();
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
      expect(recordRollbackMock).not.toHaveBeenCalled();
    });

    // Phase 3.3 (v0.3.22, F-x) — when the rollback fires, the
    // Librarian writes a post-mortem markdown summarising the
    // failure context. The drive loop hands featureId, retry
    // count, last failed gate, checkpoint, and rolledBackAt.
    test('rollback triggers writePostMortem with failure context', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-777', status: 'planned'}]));
      runTypeMock.mockReturnValue({pass: false, exitCode: 1, stage: 'stage_1.1'});
      writePostMortemMock.mockClear();
      const r = await runDriveLoop({
        cwd: dir,
        budget: {maxIterations: 50, maxWallClockMs: 600_000, maxRetriesPerFeature: 3},
      });
      expect(r.halt.class).toBe('RETRY_THRESHOLD');
      expect(writePostMortemMock).toHaveBeenCalledOnce();
      const callCtx = writePostMortemMock.mock.calls[0][1];
      expect(callCtx.featureId).toBe('F-777');
      expect(callCtx.retryCount).toBe(3);
      expect(callCtx.lastFailedGate).toBe('stage_1.1');
      expect(callCtx.checkpoint.gitHead).toContain('mockhead');
      expect(typeof callCtx.rolledBackAt).toBe('string');
    });

    test('rollback with no prior checkpoint also skips writePostMortem', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-666', status: 'planned'}]));
      runTypeMock.mockReturnValue({pass: false, exitCode: 1, stage: 'stage_1.1'});
      findLatestCheckpointMock.mockReturnValueOnce(null);
      writePostMortemMock.mockClear();
      const r = await runDriveLoop({
        cwd: dir,
        budget: {maxIterations: 50, maxWallClockMs: 600_000, maxRetriesPerFeature: 3},
      });
      expect(r.halt.class).toBe('RETRY_THRESHOLD');
      expect(writePostMortemMock).not.toHaveBeenCalled();
    });
  });

  // Atomic AC ↔ Evidence (v0.3.18, F-12d740) — when a feature
  // declares acceptance_criteria, the drive loop fans evidence out
  // one entry per AC so anti-self-cert.checkAc() can attribute
  // gates at AC granularity. Without an `acId` the guard cannot
  // tell which AC is missing its human-author sign-off.
  describe('atomic AC ↔ evidence fan-out (F-12d740)', () => {
    test('feature with acceptance_criteria → evidence recorded per AC', async () => {
      loadSpecMock.mockReturnValueOnce(
        specOf([
          {
            id: 'F-001',
            status: 'planned',
            acceptance_criteria: [{id: 'AC-001'}, {id: 'AC-002'}, {id: 'AC-003'}],
          },
        ]),
      );
      newEvidenceMock.mockClear();
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
      const evidenceCalls = newEvidenceMock.mock.calls.map((c) => c[0]);
      const featureEvidence = evidenceCalls.filter((e) => e.featureId === 'F-001');
      // One evidence per AC — three entries, each carrying its acId.
      expect(featureEvidence).toHaveLength(3);
      expect(featureEvidence.map((e) => e.acId)).toEqual(['AC-001', 'AC-002', 'AC-003']);
      // Every entry stays a tool-author L1 pass — anti-self-cert
      // still requires a human evidence on top of these.
      for (const e of featureEvidence) {
        expect(e.stage).toBe('stage_1.3');
        expect(e.kind).toBe('pass');
        expect(e.identity.author).toBe('tool');
        expect(e.identity.name).toBe('clad-drive');
      }
    });

    test('feature without acceptance_criteria → single feature-scoped evidence (fallback)', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-002', status: 'planned'}]));
      newEvidenceMock.mockClear();
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
      const evidenceCalls = newEvidenceMock.mock.calls.map((c) => c[0]);
      const featureEvidence = evidenceCalls.filter((e) => e.featureId === 'F-002');
      expect(featureEvidence).toHaveLength(1);
      expect(featureEvidence[0].acId).toBeUndefined();
    });

    test('feature with empty acceptance_criteria array → fallback to feature-scoped evidence', async () => {
      loadSpecMock.mockReturnValueOnce(
        specOf([{id: 'F-003', status: 'planned', acceptance_criteria: []}]),
      );
      newEvidenceMock.mockClear();
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
      const evidenceCalls = newEvidenceMock.mock.calls.map((c) => c[0]);
      const featureEvidence = evidenceCalls.filter((e) => e.featureId === 'F-003');
      expect(featureEvidence).toHaveLength(1);
      expect(featureEvidence[0].acId).toBeUndefined();
    });
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

  // Pre-flight transport health check (v0.2.23, F-072) — see
  // src/drive/loop.ts. Each test in this block makes selectAdapter
  // return a stub adapter whose healthCheck reports `ready: false`
  // with a specific reason, then asserts the loop halts at iteration
  // 0 with the matching transport-specific class.
  describe('pre-flight health check (F-072)', () => {
    function adapterWithHealth(reason: string) {
      return {
        mode: 'host' as const,
        name: 'stub',
        capabilities: new Set(['read', 'write', 'edit', 'exec', 'dispatch']),
        invokeAgent: vi.fn(),
        healthCheck: vi.fn(async () => ({ready: false, reason})),
      };
    }

    test('missing API key reason → TRANSPORT_AUTH_FAILED', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
      selectAdapterMock.mockReturnValueOnce(adapterWithHealth('ANTHROPIC_API_KEY env var is not set'));
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('TRANSPORT_AUTH_FAILED');
      expect(r.halt.detail).toContain('pre-flight health check failed');
      expect(r.iterations).toBe(0);
      // No agent dispatch should have happened
      expect(runAgentMock).not.toHaveBeenCalled();
    });

    test('rate-limit reason → TRANSPORT_RATE_LIMITED', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
      selectAdapterMock.mockReturnValueOnce(adapterWithHealth('rate limit exceeded — cooldown 30s'));
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('TRANSPORT_RATE_LIMITED');
      expect(r.halt.detail).toContain('pre-flight health check failed');
    });

    test('network-unreachable reason → TRANSPORT_NETWORK', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
      selectAdapterMock.mockReturnValueOnce(adapterWithHealth('no MCP runtime detected'));
      const r = await runDriveLoop({cwd: dir});
      // "no MCP runtime detected" has none of the AUTH/RATE/NETWORK
      // markers, so the catch-all LLM_UNAVAILABLE fires. Pre-flight
      // is correctly routing through classifyTransportError.
      expect(r.halt.class).toBe('LLM_UNAVAILABLE');
      expect(r.halt.detail).toContain('pre-flight health check failed');
    });

    test('skipHealthCheck=true bypasses pre-flight even when adapter is unhealthy', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
      selectAdapterMock.mockReturnValueOnce(adapterWithHealth('would-be-fatal'));
      const r = await runDriveLoop({cwd: dir, skipHealthCheck: true});
      // No halt at iteration 0 — the loop proceeds through normal
      // control flow and reaches ALL_FEATURES_DONE via the mocked
      // runAgent + mocked stage runners (all set up in beforeEach).
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    });

    test('pre-flight passes (ready=true) → loop proceeds normally', async () => {
      loadSpecMock.mockReturnValueOnce(specOf([{id: 'F-001', status: 'planned'}]));
      // Default mock returns ready:true, so no override needed.
      const r = await runDriveLoop({cwd: dir});
      expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    });
  });
});
