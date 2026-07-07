// Cladding · unit tests for cli/clad.ts
//
// Each exported handler is tested in isolation with process.exit and
// every stage runner mocked. The createProgram() factory is verified
// to register all 7 verbs. The top-level `isCliEntry` parse-trigger
// is not exercised by these tests — importing the module is safe
// because the guard suppresses it in non-bundled mode.

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/events/log.js', () => ({recordEvent: vi.fn()}));


vi.mock('../../src/cli/init.js', () => ({runInit: vi.fn()}));
vi.mock('../../src/spec/load.js', () => ({loadSpec: vi.fn()}));
vi.mock('../../src/router/intent.js', () => ({classifyIntent: vi.fn()}));
vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
vi.mock('../../src/ui/panel.js', () => ({renderPanel: vi.fn(() => 'panel-output')}));
vi.mock('../../src/ui/softShell.js', () => ({
  featureLabel: (id: string) => `LABEL(${id})`,
  gateLabel: (s: string) => `GATE(${s})`,
  haltMessage: (h: {class: string}) => `HALT(${h.class})`,
  // F-dd8dc994 / F-9af291fa: printStageDetails renders one plain English lead per finding.
  plainLead: (detector: string, fallback = '') => fallback || `LEAD(${detector})`,
}));
vi.mock('../../src/stages/type.js', () => ({runType: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/lint.js', () => ({runLint: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/commit.js', () => ({runCommit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/cov.js', () => ({runCov: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: vi.fn(() => ({pass: false, exitCode: 2}))}));
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
const pulseMod = await import('../../src/ui/pulse.js');
const pulseMock = pulseMod.pulse as unknown as ReturnType<typeof vi.fn>;

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
    pulseMock.mockClear();
  });
  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  // B1 (No-Vacuous-Green efficiency) — `clad check --json` emits ONE structured
  // document instead of per-stage pulses, so an agent reads file/line/findings
  // in one pass rather than parsing truncated prose + re-running. Additive: the
  // default (non-json) pulse path is untouched.
  test('runCheckStages --json emits a single structured document (no pulses)', () => {
    const out = clad.runCheckStages({tier: 'pre-commit', json: true});
    expect(out).toEqual({worst: 0, anyFailed: false});
    // pulse() must NOT fire in json mode (would corrupt the machine-readable stream)
    expect(pulseMock).not.toHaveBeenCalled();
    const written = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    const doc = JSON.parse(written) as {tier: string; worst: number; anyFailed: boolean; stages: {stage: string; status: string; exitCode: number}[]};
    expect(doc.tier).toBe('pre-commit');
    expect(doc.worst).toBe(0);
    expect(doc.stages.map((s) => s.stage)).toEqual(['stage_1.3', 'stage_1.5', 'stage_1.6']);
    expect(doc.stages.every((s) => s.status === 'pass')).toBe(true);
  });

  test('runCheckStages --json on an unknown tier emits a structured error, not a pulse', () => {
    const out = clad.runCheckStages({tier: 'bogus', json: true});
    expect(out.worst).toBe(2);
    expect(pulseMock).not.toHaveBeenCalled();
    const doc = JSON.parse(stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')) as {error: string};
    expect(doc.error).toContain("unknown tier 'bogus'");
  });

  test('runInitCommand exits 0 after scaffolding', async () => {
    runInitMock.mockResolvedValueOnce({
      created: ['spec.yaml', '.cladding/'],
      skipped: [],
      language: 'typescript',
    });
    await clad.runInitCommand(undefined, {});
    expect(runInitMock).toHaveBeenCalledOnce();
    expect(exitCalls).toEqual([0]);
  });

  test('runInitCommand forwards name + force options', async () => {
    runInitMock.mockResolvedValueOnce({created: [], skipped: ['spec.yaml'], language: 'rust'});
    await clad.runInitCommand(undefined, {name: 'custom', force: true});
    expect(runInitMock).toHaveBeenCalledWith({
      projectName: 'custom',
      force: true,
      scan: undefined,
      noLlm: undefined,
      roots: undefined,
      intent: undefined,
    });
  });

  // v0.3.24 (F-x) — `--scan` and `--no-llm` flow through to runInit so
  // init.ts can branch on them without inspecting argv directly.
  test('runInitCommand forwards --scan + --no-llm options', async () => {
    runInitMock.mockResolvedValueOnce({
      created: ['docs/conventions.md'],
      skipped: [],
      language: 'typescript',
      proposals: ['spec/architecture.yaml → .cladding/scan/architecture.yaml.proposal'],
    });
    await clad.runInitCommand(undefined, {scan: true, noLlm: true});
    expect(runInitMock).toHaveBeenCalledWith({
      projectName: undefined,
      force: undefined,
      scan: true,
      noLlm: true,
      roots: undefined,
      intent: undefined,
    });
    expect(exitCalls).toEqual([0]);
  });

  // v0.3.43 (F-56abaa) — variadic positional captures the user's intent
  // and forwards it as the joined string to runInit; the clarifying
  // questions returned by intent-onboarding render as stdout hints.
  test('runInitCommand joins variadic positional tokens into intent', async () => {
    runInitMock.mockResolvedValueOnce({
      created: ['spec.yaml'],
      skipped: [],
      language: 'typescript',
      clarifyingQuestions: ['주 사용자가 개인? 사업자?', '어떤 결제수단 우선?'],
      onboardingMode: 'greenfield',
    });
    await clad.runInitCommand(['결제', 'SaaS', 'for', 'B2B'], {});
    expect(runInitMock).toHaveBeenCalledWith({
      projectName: undefined,
      force: undefined,
      scan: undefined,
      noLlm: undefined,
      roots: undefined,
      intent: '결제 SaaS for B2B',
    });
    const stdout = stdoutSpy.mock.calls.map((c: readonly unknown[]) => String(c[0])).join('');
    // cladding's own framing text is English single-source (F-5cac007a); the
    // LLM-generated clarifying questions still flow through in the user's
    // language (Korean here) — proving intent data is language-preserving
    // while the framing is not hardcoded.
    expect(stdout).toContain('💡 A few more details would sharpen the spec:');
    expect(stdout).toContain('주 사용자가 개인? 사업자?');
  });

  test('runCheckCommand with unknown --tier exits 2 without running stages', () => {
    clad.runCheckCommand({tier: 'no-such-tier'});
    expect(exitCalls).toEqual([2]);
  });

  test('runCheckCommand --tier=pre-commit passes (drift/arch/secret all pass in mocks)', () => {
    clad.runCheckCommand({tier: 'pre-commit'});
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

  test('runStatusCommand exits 0 and writes to stdout', () => {
    loadSpecMock.mockReturnValueOnce({features: []});
    clad.runStatusCommand({});
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

  test('runRunCommand happy path exits 0 with summary text', async () => {
    runDriveLoopMock.mockResolvedValueOnce({
      halt: {class: 'ALL_FEATURES_DONE', detail: 'done', iteration: 5},
      iterations: 5,
      featuresTouched: ['F-001'],
      stubsCreated: [],
      gateRuns: 15,
    });
    loadSpecMock.mockReturnValueOnce({features: [{id: 'F-001', title: 'alpha'}]});
    await clad.runRunCommand(undefined, {
      maxIterations: '50',
      maxWallClockMs: '600000',
      maxRetries: '3',
    });
    expect(runDriveLoopMock).toHaveBeenCalledOnce();
    expect(exitCalls).toEqual([0]);
  });

  test('runRunCommand UNCAUGHT_ERROR exits 1', async () => {
    runDriveLoopMock.mockResolvedValueOnce({
      halt: {class: 'UNCAUGHT_ERROR', detail: 'spec load failed', iteration: 0},
      iterations: 0,
      featuresTouched: [],
      stubsCreated: [],
      gateRuns: 0,
    });
    loadSpecMock.mockReturnValueOnce({features: []});
    await clad.runRunCommand(undefined, {
      maxIterations: '50',
      maxWallClockMs: '600000',
      maxRetries: '3',
    });
    expect(exitCalls).toEqual([1]);
  });

  // Lever 1 — `clad oracle --required` prints the policy worklist (which done
  // ACs need an oracle) instead of a single feature's brief.
  test('runOracleCommand --required lists policy-required ACs and exits 1 when one is missing', () => {
    loadSpecMock.mockReturnValueOnce({
      project: {name: 'p', language: 'typescript', oracle_policy: {always_ears: ['unwanted'], sample: 0}},
      features: [
        {
          id: 'F-001', status: 'done', acceptance_criteria: [
            {id: 'AC-001', ears: 'unwanted'},
            {id: 'AC-002', ears: 'ubiquitous'},
          ],
        },
      ],
    });
    clad.runOracleCommand(undefined, {required: true});
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(out).toContain('F-001.AC-001'); // unwanted ⇒ required
    expect(out).not.toContain('F-001.AC-002'); // ubiquitous + sample 0 ⇒ not required
    expect(out).toContain('1 missing');
    expect(exitCalls).toEqual([1]);
  });

  test('runOracleCommand --required with NO mandate prints the no-oracles note and exits 0', () => {
    loadSpecMock.mockReturnValueOnce({project: {name: 'p', language: 'typescript'}, features: []});
    clad.runOracleCommand(undefined, {required: true});
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(out).toContain('No oracles required');
    expect(exitCalls).toEqual([0]);
  });

  test('runOracleCommand --required with a stray featureId notes it is ignored (not silently dropped) and still lists the worklist', () => {
    loadSpecMock.mockReturnValueOnce({
      project: {name: 'p', language: 'typescript', oracle_policy: {always_ears: ['unwanted'], sample: 0}},
      features: [{id: 'F-001', status: 'done', acceptance_criteria: [{id: 'AC-001', ears: 'unwanted'}]}],
    });
    clad.runOracleCommand('F-001', {required: true});
    const out = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(out).toContain("ignoring 'F-001'");
    expect(out).toContain('F-001.AC-001');
    expect(exitCalls).toEqual([1]);
  });

  test('runRunCommand --json emits raw result to stdout', async () => {
    runDriveLoopMock.mockResolvedValueOnce({
      halt: {class: 'ALL_FEATURES_DONE', detail: 'done', iteration: 1},
      iterations: 1,
      featuresTouched: [],
      stubsCreated: [],
      gateRuns: 3,
    });
    await clad.runRunCommand('goal text', {
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
  test('returns a Command with all 24 verbs registered (work removed in 0.6.0; hook F-1d23a6, context F-d2c806, impact F-7794a6bc, infer-deps F-2be3e3bb, measure F-16138071, graph F-569f4b37, changelog F-904495a5, report F-f6cc5e5a, bundle F-e940fffe)', () => {
    const program = clad.createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual([
      'init',
      'run',
      'sync',
      'setup',
      'update',
      'check',
      'checkpoint',
      'done',
      'oracle',
      'rollback',
      'status',
      'context',
      'impact',
      'infer-deps',
      'measure',
      'graph',
      'changelog',
      'report',
      'bundle',
      'route',
      'hook',
      'serve',
      'doctor',
      'clarify',
    ]);
  });

  // 0.8.0 removed the 0.6.0 compat aliases (`drive`→`run`, `panel`→`status`,
  // `refine`→`clarify`), fulfilling the stderr notice shipped since 0.6.0.
  // `work` was removed outright back in 0.6.0. All four must stay gone: never
  // registered as a command name, never as an alias — the successor verb is
  // the only spelling.
  test('removed aliases stay removed; successors are the only spelling', () => {
    const program = clad.createProgram();
    const names = program.commands.map((c) => c.name());
    const aliases = program.commands.flatMap((c) => c.aliases());
    for (const gone of ['drive', 'panel', 'refine', 'work']) {
      expect(names).not.toContain(gone);
      expect(aliases).not.toContain(gone);
    }
    expect(names).toEqual(expect.arrayContaining(['run', 'status', 'clarify']));
  });

  // The removed spellings must fail closed: commander treats each as an unknown
  // command and exits non-zero (no silent no-op, no deprecation-and-continue).
  test('invoking a removed alias is a commander unknown-command error (non-zero exit)', () => {
    for (const gone of ['drive', 'panel', 'refine']) {
      const program = clad.createProgram();
      program.exitOverride();
      program.configureOutput({writeErr: () => {}, writeOut: () => {}});
      let caught: {exitCode?: number; code?: string; message?: string} | undefined;
      try {
        program.parse([gone], {from: 'user'});
      } catch (err) {
        caught = err as {exitCode?: number; code?: string; message?: string};
      }
      expect(caught, `\`clad ${gone}\` should error`).toBeDefined();
      expect(caught?.code).toBe('commander.unknownCommand');
      expect(caught?.exitCode).not.toBe(0);
      expect(caught?.message).toMatch(/unknown command/);
    }
  });

  test('program version matches current package version', () => {
    const program = clad.createProgram();
    expect(program.version()).toBe('0.8.2');
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

describe('cli/clad — check --tier stage selection (Phase 2 ambient hooks)', () => {
  test('pre-commit = drift/arch/secret only (cheap, spec-native)', () => {
    expect(clad.TIER_STAGES['pre-commit']).toEqual(['stage_1.3', 'stage_1.5', 'stage_1.6']);
    // Never the clean-tree commit stage (would always fail pre-commit), the
    // probabilistic 3.x, the HITL 4.x, or the slow whole-toolchain/test stages.
    for (const s of ['stage_1.1', 'stage_1.2', 'stage_1.4', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_2.4', 'stage_3.1', 'stage_3.2', 'stage_3.3', 'stage_4.1', 'stage_4.2']) {
      expect(clad.TIER_STAGES['pre-commit']).not.toContain(s);
    }
  });

  test('pre-push = pre-commit set + type/lint/unit/cov/spec-conformance/deliverable-smoke; never commit/probabilistic/HITL', () => {
    expect(clad.TIER_STAGES['pre-push']).toEqual([
      'stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_2.4',
    ]);
    for (const s of ['stage_1.4', 'stage_3.1', 'stage_3.2', 'stage_3.3', 'stage_4.1', 'stage_4.2']) {
      expect(clad.TIER_STAGES['pre-push']).not.toContain(s);
    }
  });

  test('all = every one of the 15 stages (default / CI gate)', () => {
    expect(clad.TIER_STAGES['all']).toHaveLength(15);
    // pre-commit + pre-push members are all a subset of `all`.
    for (const s of [...clad.TIER_STAGES['pre-commit'], ...clad.TIER_STAGES['pre-push']]) {
      expect(clad.TIER_STAGES['all']).toContain(s);
    }
  });
});

// ─── F-10cc42d1 · AC-28d60113 — `clad sync` defers ALL derived-file writers ───
//
// The six sync-path writers (inventory, feature index, doc-links, test_ref
// repair, deliverable maintenance) all live in ONE branch gated by the git-op
// probe. These tests drive the REAL runSyncCommand against a real git repo (the
// probe reads `.` = the chdir'd fixture): with a hand-seeded MERGE_HEAD the
// whole branch is skipped (proved by inventory + index + doc-links never
// materializing) with a single deferral note and a success exit; without it,
// the writers run (proving the guard is not vacuous).
describe('cli/clad — runSyncCommand git-operation write guard (F-10cc42d1 · AC-28d60113)', () => {
  let dir: string;
  let cwd0: string;
  let codes: number[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  const SPEC_YAML = 'schema: "0.1"\nproject:\n  name: probe\n  language: typescript\nfeatures: []\n';
  const SHARD =
    'id: F-abc123\nslug: thing\ntitle: A thing\nstatus: planned\nmodules: []\n' +
    'acceptance_criteria:\n  - id: AC-001\n    ears: ubiquitous\n    text: The system shall do a thing.\n';

  function fixture(): void {
    execFileSync('git', ['init', '-q'], {cwd: dir});
    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'thing-abc123.yaml'), SHARD);
  }

  beforeEach(() => {
    cwd0 = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'clad-sync-gitop-'));
    codes = [];
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      codes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    loadSpecMock.mockReset();
    loadSpecMock.mockReturnValue({features: [{id: 'F-abc123'}]});
    pulseMock.mockClear();
  });
  afterEach(() => {
    process.chdir(cwd0); // restore BEFORE removing the fixture dir
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    rmSync(dir, {recursive: true, force: true});
  });

  test('a git op in progress defers every derived-file writer, emits one deferral note, and exits 0', () => {
    fixture();
    const specBefore = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    process.chdir(dir);

    clad.runSyncCommand();

    // spec.yaml is byte-for-byte unchanged — the inventory writer was skipped.
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toBe(specBefore);
    // the entire guarded branch was skipped — neither derived index materialized.
    expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(false);
    expect(existsSync(join(dir, 'spec', '_doc-links.yaml'))).toBe(false);
    // exactly ONE informational deferral note, and the command still exits 0.
    const deferral = pulseMock.mock.calls.filter((c) => String(c[2] ?? '').includes('deferred'));
    expect(deferral).toHaveLength(1);
    expect(deferral[0][0]).toBe('note');
    expect(codes).toContain(0);
  });

  test('with no git op the same run writes the derived files (the guard is not vacuous)', () => {
    fixture();
    process.chdir(dir);

    clad.runSyncCommand();

    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('inventory:');
    expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(true);
    const deferral = pulseMock.mock.calls.filter((c) => String(c[2] ?? '').includes('deferred'));
    expect(deferral).toHaveLength(0);
    expect(codes).toContain(0);
  });
});

// ─── F-10cc42d1 · AC-578c6226 — a GREEN gate defers attestation mid-op ───
//
// A strict pre-push gate computes module tree-hashes; running it mid-merge and
// stamping spec/attestation.yaml would fold a half-merged tree into the merge
// commit as "verified". So even on a GREEN verdict the attestation write must
// be deferred while a git op is in progress. Drives the REAL runCheckStages
// (stages are the module-level GREEN mocks; deliverable-smoke is a real no-op
// skip with no deliverable declared) against a chdir'd git fixture.
describe('cli/clad — runCheckStages attestation write guard (F-10cc42d1 · AC-578c6226)', () => {
  let dir: string;
  let cwd0: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  // A done feature with modules is what makes writeAttestation actually emit a
  // file (its only honest author) — so the negative case can't pass vacuously.
  const DONE_SPEC = {
    project: {name: 'probe', language: 'typescript'},
    features: [{id: 'F-001', slug: 'x', status: 'done', modules: ['README.md'], acceptance_criteria: []}],
  };

  function fixture(): void {
    execFileSync('git', ['init', '-q'], {cwd: dir});
    mkdirSync(join(dir, 'spec'), {recursive: true}); // writeAttestation targets spec/attestation.yaml
    writeFileSync(join(dir, 'README.md'), 'x\n');
  }

  beforeEach(() => {
    cwd0 = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'clad-attest-gitop-'));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    loadSpecMock.mockReset();
    loadSpecMock.mockReturnValue(DONE_SPEC);
    pulseMock.mockClear();
  });
  afterEach(() => {
    process.chdir(cwd0);
    stdoutSpy.mockRestore();
    rmSync(dir, {recursive: true, force: true});
  });

  test('a GREEN strict pre-push gate DEFERS spec/attestation.yaml while a git op is in progress + notes it', () => {
    fixture();
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    process.chdir(dir);

    const out = clad.runCheckStages({tier: 'pre-push', strict: true});

    // The gate really is GREEN — the precondition of the attestation stamp ...
    expect(out.worst).toBe(0);
    expect(out.anyFailed).toBe(false);
    // ... yet the half-merged tree is NEVER stamped as verified.
    expect(existsSync(join(dir, 'spec', 'attestation.yaml'))).toBe(false);
    const deferral = pulseMock.mock.calls.filter(
      (c) => c[1] === 'attestation' && String(c[2] ?? '').includes('deferred'),
    );
    expect(deferral).toHaveLength(1);
  }, 60_000);

  test('the same GREEN gate on a settled tree DOES write the attestation (guard is not vacuous)', () => {
    fixture();
    process.chdir(dir);

    const out = clad.runCheckStages({tier: 'pre-push', strict: true});

    expect(out.worst).toBe(0);
    expect(existsSync(join(dir, 'spec', 'attestation.yaml'))).toBe(true);
    // it stamped the done feature — proving the write path the merge case suppresses.
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).toContain('F-001');
  }, 60_000);
});
