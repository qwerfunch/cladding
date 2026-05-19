// Cladding · unit tests for cli/clad.ts
//
// Each exported handler is tested in isolation with process.exit and
// every stage runner mocked. The createProgram() factory is verified
// to register all 7 verbs. The top-level `isCliEntry` parse-trigger
// is not exercised by these tests — importing the module is safe
// because the guard suppresses it in non-bundled mode.

import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../cli/init.js', () => ({runInit: vi.fn()}));
vi.mock('../../spec/load.js', () => ({loadSpec: vi.fn()}));
vi.mock('../../router/intent.js', () => ({classifyIntent: vi.fn()}));
vi.mock('../../ui/pulse.js', () => ({pulse: vi.fn()}));
vi.mock('../../ui/panel.js', () => ({renderPanel: vi.fn(() => 'panel-output')}));
vi.mock('../../ui/softShell.js', () => ({
  featureLabel: (id: string) => `LABEL(${id})`,
  gateLabel: (s: string) => `GATE(${s})`,
  haltMessage: (h: {class: string}) => `HALT(${h.class})`,
}));
vi.mock('../../stages/type.js', () => ({runType: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/lint.js', () => ({runLint: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/drift.js', () => ({runDrift: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/commit.js', () => ({runCommit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/arch.js', () => ({runArch: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/secret.js', () => ({runSecret: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/unit.js', () => ({runUnit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/cov.js', () => ({runCov: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/smoke.js', () => ({runSmoke: vi.fn(() => ({pass: false, exitCode: 2}))}));
vi.mock('../../stages/perf.js', () => ({runPerf: vi.fn(() => ({pass: false, exitCode: 2}))}));
vi.mock('../../stages/visual.js', () => ({runVisual: vi.fn(() => ({pass: false, exitCode: 2}))}));
vi.mock('../../stages/audit.js', () => ({runAudit: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../stages/uat.js', () => ({runUat: vi.fn(() => ({pass: true, exitCode: 0}))}));
vi.mock('../../drive/loop.js', () => ({runDriveLoop: vi.fn()}));

const clad = await import('../../cli/clad.js');
const initMod = await import('../../cli/init.js');
const specMod = await import('../../spec/load.js');
const intentMod = await import('../../router/intent.js');
const driveMod = await import('../../drive/loop.js');

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

  test('runCheckCommand all-pass exits 0', () => {
    clad.runCheckCommand({});
    expect(exitCalls).toEqual([0]);
  });

  test('runCheckCommand --internal uses internal stage codes', () => {
    clad.runCheckCommand({internal: true});
    expect(exitCalls).toEqual([0]);
  });

  test('runCheckCommand --strict forwards to drift', async () => {
    const {runDrift} = await import('../../stages/drift.js');
    clad.runCheckCommand({strict: true});
    expect(runDrift).toHaveBeenCalledWith({strict: true});
    expect(exitCalls).toEqual([0]);
  });

  test('runCheckCommand reports worst exit code on failures', async () => {
    const {runType} = await import('../../stages/type.js');
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
  test('returns a Command with all 7 verbs registered', () => {
    const program = clad.createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(['init', 'work', 'drive', 'sync', 'check', 'panel', 'route']);
  });

  test('program version matches current package version', () => {
    const program = clad.createProgram();
    expect(program.version()).toBe('0.2.15');
  });
});
