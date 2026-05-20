// Cladding · unit tests for cli/clad.ts
//
// Each exported handler is tested in isolation with process.exit and
// every stage runner mocked. The createProgram() factory is verified
// to register all 7 verbs. The top-level `isCliEntry` parse-trigger
// is not exercised by these tests — importing the module is safe
// because the guard suppresses it in non-bundled mode.

import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/cli/init.js', () => ({runInit: vi.fn()}));
vi.mock('../../src/spec/load.js', () => ({loadSpec: vi.fn()}));
vi.mock('../../src/router/intent.js', () => ({classifyIntent: vi.fn()}));
vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
vi.mock('../../src/ui/panel.js', () => ({renderPanel: vi.fn(() => 'panel-output')}));
vi.mock('../../src/ui/softShell.js', () => ({
  featureLabel: (id: string) => `LABEL(${id})`,
  gateLabel: (s: string) => `GATE(${s})`,
  haltMessage: (h: {class: string}) => `HALT(${h.class})`,
}));
vi.mock('../../src/stages/type.js', () => ({runType: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/lint.js', () => ({runLint: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/commit.js', () => ({runCommit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/cov.js', () => ({runCov: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/smoke.js', () => ({runSmoke: vi.fn(() => ({pass: false, exitCode: 2}))}));
vi.mock('../../src/stages/perf.js', () => ({runPerf: vi.fn(() => ({pass: false, exitCode: 2}))}));
vi.mock('../../src/stages/visual.js', () => ({runVisual: vi.fn(() => ({pass: false, exitCode: 2}))}));
vi.mock('../../src/stages/audit.js', () => ({runAudit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/uat.js', () => ({runUat: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/detectors/stale-specification.js', () => ({
  staleSpecification: {name: 'STALE_SPECIFICATION', run: vi.fn(() => [])},
}));
vi.mock('../../src/core/checkpoint.js', () => ({
  recordCheckpoint: vi.fn(() => ({
    featureId: 'F-001',
    gitHead: '0123456789abcdef0123456789abcdef01234567',
    specDigest: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    timestamp: '2026-05-20T12:34:56Z',
  })),
  findLatestCheckpoint: vi.fn(() => null),
  recordRollback: vi.fn(() => ({
    id: 'ev-mock',
    timestamp: '2026-05-20T12:34:56Z',
    type: 'feature_rolled_back',
    payload: {},
  })),
}));
vi.mock('../../src/drive/loop.js', () => ({runDriveLoop: vi.fn()}));
// MCP server build is mocked — the runServeCommand test only verifies
// the CLI plumbing (server constructed, transport connected). The
// real server is exercised separately in tests/serve/server.test.ts.
vi.mock('../../src/serve/server.js', () => ({
  buildServer: vi.fn(() => ({
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  // Constructor-shape mock: runServeCommand calls `new StdioServerTransport()`.
  // A bare vi.fn arrow body is not a constructor, so we use a class spy.
  const StdioServerTransport = vi.fn(function () {
    return {};
  });
  return {StdioServerTransport};
});
vi.mock('../../src/adapters/host/sampling-context.js', () => ({
  setHostMcpServer: vi.fn(() => () => undefined),
  getHostMcpServer: vi.fn(() => null),
  clearHostMcpServerForTesting: vi.fn(),
}));

const clad = await import('../../src/cli/clad.js');
const initMod = await import('../../src/cli/init.js');
const specMod = await import('../../src/spec/load.js');
const intentMod = await import('../../src/router/intent.js');
const driveMod = await import('../../src/drive/loop.js');

const runInitMock = initMod.runInit as unknown as ReturnType<typeof vi.fn>;
const loadSpecMock = specMod.loadSpec as unknown as ReturnType<typeof vi.fn>;
const classifyMock = intentMod.classifyIntent as unknown as ReturnType<typeof vi.fn>;
const runDriveLoopMock = driveMod.runDriveLoop as unknown as ReturnType<typeof vi.fn>;

describe('cli/clad — handler exports', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitCalls: number[];
  beforeEach(() => {
    exitCalls = [];
    // Record-only exit mock: try/catch inside handlers would catch a
    // thrown exit, which would mask the original exit code. Record the
    // requested code instead and let the handler return normally.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    runInitMock.mockReset();
    loadSpecMock.mockReset();
    classifyMock.mockReset();
    runDriveLoopMock.mockReset();
  });
  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('runInitCommand exits 0 after scaffolding', () => {
    runInitMock.mockReturnValueOnce({
      created: ['spec.yaml', '.cladding/'],
      skipped: [],
      language: 'typescript',
    });
    clad.runInitCommand({});
    expect(runInitMock).toHaveBeenCalledOnce();
    expect(exitCalls).toEqual([0]);
  });

  test('runInitCommand forwards name + force options', () => {
    runInitMock.mockReturnValueOnce({created: [], skipped: ['spec.yaml'], language: 'rust'});
    clad.runInitCommand({name: 'custom', force: true});
    expect(runInitMock).toHaveBeenCalledWith({projectName: 'custom', force: true});
  });

  test('runWorkCommand without verb exits 2', () => {
    clad.runWorkCommand();
    expect(exitCalls).toEqual([2]);
  });

  test('runWorkCommand with verb exits 0', () => {
    clad.runWorkCommand('sync');
    expect(exitCalls).toEqual([0]);
  });

  test('runSyncCommand on valid spec exits 0', () => {
    loadSpecMock.mockReturnValueOnce({features: [{id: 'F-001'}, {id: 'F-002'}]});
    clad.runSyncCommand();
    expect(exitCalls).toEqual([0]);
  });

  test('runSyncCommand on spec load error exits 1', () => {
    loadSpecMock.mockImplementationOnce(() => {
      throw new Error('spec.yaml malformed');
    });
    clad.runSyncCommand();
    expect(exitCalls).toEqual([1]);
  });

  // Phased Decommissioning Tier 2 (v0.3.19, F-x) — --propose-archive
  // filters STALE_SPECIFICATION findings whose suggestion.action is
  // 'propose-archive' and exits 0 either way.
  test('runSyncCommand --propose-archive with zero candidates exits 0', async () => {
    const stale = await import('../../src/stages/detectors/stale-specification.js');
    (stale.staleSpecification.run as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);
    loadSpecMock.mockReturnValueOnce({features: [{id: 'F-001'}]});
    clad.runSyncCommand({proposeArchive: true});
    expect(exitCalls).toEqual([0]);
  });

  test('runSyncCommand --propose-archive surfaces propose-archive findings only', async () => {
    const stale = await import('../../src/stages/detectors/stale-specification.js');
    (stale.staleSpecification.run as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      {
        detector: 'STALE_SPECIFICATION',
        severity: 'warn',
        message: 'feature F-100 archived but modules survive',
        // No suggestion — must be filtered out.
      },
      {
        detector: 'STALE_SPECIFICATION',
        severity: 'warn',
        message: 'feature F-200 stale',
        suggestion: {action: 'propose-archive', args: {featureId: 'F-200', reason: 'gone'}},
      },
    ]);
    loadSpecMock.mockReturnValueOnce({features: [{id: 'F-200'}]});
    const {pulse} = await import('../../src/ui/pulse.js');
    (pulse as unknown as ReturnType<typeof vi.fn>).mockClear();
    clad.runSyncCommand({proposeArchive: true});
    expect(exitCalls).toEqual([0]);
    // One note per candidate plus the summary pass — exactly 2 calls,
    // and the note carries the F-200 args.
    const calls = (pulse as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const noteCall = calls.find((c) => c[0] === 'note');
    expect(noteCall?.[1]).toContain('F-200');
    expect(noteCall?.[2]).toContain('gone');
    // F-100 had no suggestion → must NOT appear in any pulse note.
    for (const c of calls) {
      expect(JSON.stringify(c)).not.toContain('F-100');
    }
  });

  test('runCheckCommand all-pass exits 0', () => {
    clad.runCheckCommand({});
    expect(exitCalls).toEqual([0]);
  });

  // Iron Law backbone Phase 1 (v0.3.20, F-x) — checkpoint + rollback
  // commands record events without mutating the working tree.
  describe('checkpoint / rollback (Phase 1 of Auto-rollback)', () => {
    test('runCheckpointCommand without featureId exits 2', () => {
      clad.runCheckpointCommand('');
      expect(exitCalls).toEqual([2]);
    });

    test('runCheckpointCommand records and exits 0', async () => {
      const checkpoint = await import('../../src/core/checkpoint.js');
      const recordSpy = checkpoint.recordCheckpoint as unknown as ReturnType<typeof vi.fn>;
      recordSpy.mockClear();
      clad.runCheckpointCommand('F-001');
      expect(recordSpy).toHaveBeenCalledOnce();
      expect(recordSpy.mock.calls[0][1]).toBe('F-001');
      expect(exitCalls).toEqual([0]);
    });

    test('runRollbackCommand without featureId exits 2', () => {
      clad.runRollbackCommand('');
      expect(exitCalls).toEqual([2]);
    });

    test('runRollbackCommand with no prior checkpoint exits 1', async () => {
      const checkpoint = await import('../../src/core/checkpoint.js');
      const findSpy = checkpoint.findLatestCheckpoint as unknown as ReturnType<typeof vi.fn>;
      findSpy.mockReturnValueOnce(null);
      clad.runRollbackCommand('F-001');
      expect(exitCalls).toEqual([1]);
    });

    test('runRollbackCommand with prior checkpoint records rollback + exits 0', async () => {
      const checkpoint = await import('../../src/core/checkpoint.js');
      const findSpy = checkpoint.findLatestCheckpoint as unknown as ReturnType<typeof vi.fn>;
      const rollbackSpy = checkpoint.recordRollback as unknown as ReturnType<typeof vi.fn>;
      findSpy.mockReturnValueOnce({
        featureId: 'F-001',
        gitHead: 'abc123def456abc123def456abc123def456abc1',
        specDigest: 'deadbeef'.repeat(8),
        timestamp: '2026-05-20T01:02:03Z',
      });
      rollbackSpy.mockClear();
      clad.runRollbackCommand('F-001', {reason: 'manual test'});
      expect(rollbackSpy).toHaveBeenCalledOnce();
      expect(rollbackSpy.mock.calls[0][1]).toBe('F-001');
      expect(rollbackSpy.mock.calls[0][3]).toBe('manual test');
      expect(exitCalls).toEqual([0]);
    });
  });

  test('runCheckCommand --internal uses internal stage codes', () => {
    clad.runCheckCommand({internal: true});
    expect(exitCalls).toEqual([0]);
  });

  test('runCheckCommand --strict forwards to drift', async () => {
    const {runDrift} = await import('../../src/stages/drift.js');
    clad.runCheckCommand({strict: true});
    expect(runDrift).toHaveBeenCalledWith({strict: true});
    expect(exitCalls).toEqual([0]);
  });

  test('runCheckCommand reports worst exit code on failures', async () => {
    const {runType} = await import('../../src/stages/type.js');
    (runType as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({pass: false, exitCode: 1});
    clad.runCheckCommand({});
    expect(exitCalls).toEqual([1]);
  });

  test('runPanelCommand exits 0 and writes to stdout', () => {
    loadSpecMock.mockReturnValueOnce({features: []});
    clad.runPanelCommand({});
    expect(stdoutSpy).toHaveBeenCalled();
    expect(exitCalls).toEqual([0]);
  });

  test('runRouteCommand known intent exits 0', () => {
    classifyMock.mockReturnValueOnce('sync');
    clad.runRouteCommand('validate the spec');
    expect(exitCalls).toEqual([0]);
  });

  test('runRouteCommand unknown intent exits 1', () => {
    classifyMock.mockReturnValueOnce('unknown');
    clad.runRouteCommand('???');
    expect(exitCalls).toEqual([1]);
  });

  test('runDriveCommand happy path exits 0 with summary text', async () => {
    runDriveLoopMock.mockResolvedValueOnce({
      halt: {class: 'ALL_FEATURES_DONE', detail: 'done', iteration: 5},
      iterations: 5,
      featuresTouched: ['F-001'],
      stubsCreated: [],
      gateRuns: 15,
    });
    loadSpecMock.mockReturnValueOnce({features: [{id: 'F-001', title: 'alpha'}]});
    await clad.runDriveCommand(undefined, {
      maxIterations: '50',
      maxWallClockMs: '600000',
      maxRetries: '3',
    });
    expect(runDriveLoopMock).toHaveBeenCalledOnce();
    expect(exitCalls).toEqual([0]);
  });

  test('runDriveCommand UNCAUGHT_ERROR exits 1', async () => {
    runDriveLoopMock.mockResolvedValueOnce({
      halt: {class: 'UNCAUGHT_ERROR', detail: 'spec load failed', iteration: 0},
      iterations: 0,
      featuresTouched: [],
      stubsCreated: [],
      gateRuns: 0,
    });
    loadSpecMock.mockReturnValueOnce({features: []});
    await clad.runDriveCommand(undefined, {
      maxIterations: '50',
      maxWallClockMs: '600000',
      maxRetries: '3',
    });
    expect(exitCalls).toEqual([1]);
  });

  test('runDriveCommand --json emits raw result to stdout', async () => {
    runDriveLoopMock.mockResolvedValueOnce({
      halt: {class: 'ALL_FEATURES_DONE', detail: 'done', iteration: 1},
      iterations: 1,
      featuresTouched: [],
      stubsCreated: [],
      gateRuns: 3,
    });
    await clad.runDriveCommand('goal text', {
      maxIterations: '10',
      maxWallClockMs: '60000',
      maxRetries: '2',
      json: true,
    });
    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(
      calls.some((c: unknown) => typeof c === 'string' && c.includes('ALL_FEATURES_DONE')),
    ).toBe(true);
    expect(exitCalls).toEqual([0]);
  });
});

describe('cli/clad — createProgram', () => {
  test('returns a Command with all 10 verbs registered', () => {
    const program = clad.createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual([
      'init',
      'work',
      'drive',
      'sync',
      'check',
      'checkpoint',
      'rollback',
      'panel',
      'route',
      'serve',
    ]);
  });

  test('program version matches current package version', () => {
    const program = clad.createProgram();
    expect(program.version()).toBe('0.3.23');
  });
});

describe('cli/clad — runServeCommand', () => {
  test('builds the MCP server, registers it for sampling, and connects stdio', async () => {
    const serveMod = await import('../../src/serve/server.js');
    const stdioMod = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const samplingMod = await import('../../src/adapters/host/sampling-context.js');
    const buildMock = serveMod.buildServer as unknown as ReturnType<typeof vi.fn>;
    const StdioMock = stdioMod.StdioServerTransport as unknown as ReturnType<typeof vi.fn>;
    const setMock = samplingMod.setHostMcpServer as unknown as ReturnType<typeof vi.fn>;
    buildMock.mockClear();
    StdioMock.mockClear();
    setMock.mockClear();
    await clad.runServeCommand({cwd: '/tmp/probe'});
    expect(buildMock).toHaveBeenCalledWith({cwd: '/tmp/probe'});
    expect(StdioMock).toHaveBeenCalledOnce();
    // v0.2.26 (F-075): clad serve registers its own server so host
    // adapters route through McpSamplingTransport.
    expect(setMock).toHaveBeenCalledOnce();
  });
});
