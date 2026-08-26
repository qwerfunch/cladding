// Cladding · F-c17e1edc — runner-less skips name their exit.
//
// Two halves, tested apart:
//   ① the TAG — a command stage that skips because cladding knows no runner for
//     this project carries `skipReason: 'no-runner'`; an absent/unfetchable tool
//     carries `'tool-missing'`; a by-design skip (no oracle, no deliverable)
//     carries nothing. Driven against REAL stage runners on a temp fixture whose
//     language cladding cannot drive (.zig), because the split this feature turns
//     on is a property of the real toolchain resolver, not of a stub.
//   ② the LINE — `runCheckStages` lists the tagged stages once, with the
//     `gate.commands` remedy inline, and stays silent for every other skip
//     class. Driven against stubbed stages so the matrix is exact and fast.
//
// The existing stderr strings are asserted byte-for-byte here: this feature is
// additive, so a reworded skip message is a regression, not a refactor.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

type StageResult = {
  pass: boolean;
  exitCode: number;
  stderr?: string;
  skipReason?: 'no-runner' | 'tool-missing';
};

const PASS: StageResult = {pass: true, exitCode: 0};
const noRunner = (stderr: string): StageResult => ({pass: false, exitCode: 2, stderr, skipReason: 'no-runner'});
const TOOL_MISSING: StageResult = {pass: false, exitCode: 2, stderr: "'zig' not installed", skipReason: 'tool-missing'};
const BY_DESIGN: StageResult = {pass: false, exitCode: 2, stderr: 'no project.deliverable declared — skipped'};

// One swappable vi.fn per stage (same shape as the gate golden matrix) so each
// case re-targets outcomes without re-mocking modules.
const stubs = {
  'stage_1.1': vi.fn((): StageResult => PASS),
  'stage_1.2': vi.fn((): StageResult => PASS),
  'stage_1.3': vi.fn((): StageResult => PASS),
  'stage_1.4': vi.fn((): StageResult => PASS),
  'stage_1.5': vi.fn((): StageResult => PASS),
  'stage_1.6': vi.fn((): StageResult => PASS),
  'stage_2.1': vi.fn((): StageResult => PASS),
  'stage_2.2': vi.fn((): StageResult => PASS),
  'stage_2.3': vi.fn((): StageResult => PASS),
  'stage_2.4': vi.fn((): StageResult => PASS),
} as const;

vi.mock('../../src/stages/type.js', () => ({runType: () => stubs['stage_1.1']()}));
vi.mock('../../src/stages/lint.js', () => ({runLint: () => stubs['stage_1.2']()}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: () => stubs['stage_1.3']()}));
vi.mock('../../src/stages/commit.js', () => ({runCommit: () => stubs['stage_1.4']()}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => stubs['stage_1.5']()}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => stubs['stage_1.6']()}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: () => stubs['stage_2.1']()}));
vi.mock('../../src/stages/cov.js', () => ({runCov: () => stubs['stage_2.2']()}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: () => stubs['stage_2.3']()}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: () => stubs['stage_2.4']()}));

// The gate ledger is the real repo's; a unit test must never append to it.
const recordEventMock = vi.fn();
vi.mock('../../src/events/log.js', () => ({recordEvent: (...a: unknown[]) => recordEventMock(...(a as []))}));

const clad = await import('../../src/cli/clad.js');

// The REAL runners, reached past the stubs above — half ① drives these.
const {runType} = await vi.importActual<typeof import('../../src/stages/type.js')>('../../src/stages/type.js');
const {runLint} = await vi.importActual<typeof import('../../src/stages/lint.js')>('../../src/stages/lint.js');
const {runUnit} = await vi.importActual<typeof import('../../src/stages/unit.js')>('../../src/stages/unit.js');
const {runCov} = await vi.importActual<typeof import('../../src/stages/cov.js')>('../../src/stages/cov.js');
const {runSpecConformance} =
  await vi.importActual<typeof import('../../src/stages/spec-conformance.js')>('../../src/stages/spec-conformance.js');
const {runDeliverableSmoke} =
  await vi.importActual<typeof import('../../src/stages/deliverable-smoke.js')>('../../src/stages/deliverable-smoke.js');
const {missingToolSkip} = await vi.importActual<typeof import('../../src/stages/util.js')>('../../src/stages/util.js');

const SPEC = `schema: "0.1"
project:
  name: zigdemo
  language: zig
features:
  - id: F-a1b2c3d4
    title: "Add two numbers"
    status: planned
    modules: ["src/main.zig"]
    acceptance_criteria:
      - id: AC-11112222
        text: "The system shall add two numbers."
`;

/** A project whose language cladding has no registered runner for. */
function makeRunnerlessProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clad-skipexit-'));
  mkdirSync(join(dir, 'src'), {recursive: true});
  writeFileSync(join(dir, 'spec.yaml'), SPEC);
  writeFileSync(join(dir, 'src', 'main.zig'), 'pub fn add(a: i32, b: i32) i32 {\n    return a + b;\n}\n');
  writeFileSync(join(dir, 'src', 'util.zig'), 'pub fn double(a: i32) i32 {\n    return a * 2;\n}\n');
  return dir;
}

/** The same project after the one declaration that turns the four stages on. */
function declareGateCommands(dir: string): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(
    join(dir, '.cladding', 'config.yaml'),
    `gate:
  commands:
    type: ["node", "--version"]
    lint: ["node", "--version"]
    test: ["node", "--version"]
    coverage: ["node", "--version"]
`,
  );
}

let dir: string;
beforeEach(() => {
  dir = makeRunnerlessProject();
  for (const fn of Object.values(stubs)) fn.mockImplementation(() => PASS);
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AC-4b7d20e5 — every skip carries a structured reason, or none by design', () => {
  test('the four command stages of a runner-less project tag no-runner, message byte-identical', () => {
    const results = [
      {r: runType({cwd: dir}), stderr: "no type checker registered for language 'unknown'"},
      {r: runLint({cwd: dir}), stderr: "no linter registered for language 'unknown'"},
      {r: runUnit({cwd: dir}), stderr: "no unit test runner registered for language 'unknown'"},
      {r: runCov({cwd: dir}), stderr: "no coverage runner registered for language 'unknown'"},
    ];
    for (const {r, stderr} of results) {
      expect(r.exitCode, r.stage).toBe(2);
      expect(r.pass, r.stage).toBe(false);
      expect(r.stderr, r.stage).toBe(stderr);
      expect(r.skipReason, r.stage).toBe('no-runner');
    }
  });

  test('by-design skips stay untagged — the gate.commands cure would be a false prescription', () => {
    const conformance = runSpecConformance({cwd: dir});
    const smoke = runDeliverableSmoke({cwd: dir});
    expect(conformance.exitCode).toBe(2);
    expect(conformance.stderr).toBe('no spec-conformance oracles under tests/oracle/ — skipped');
    expect(conformance.skipReason).toBeUndefined();
    expect(smoke.exitCode).toBe(2);
    expect(smoke.stderr).toBe('no project.deliverable declared — skipped');
    expect(smoke.skipReason).toBeUndefined();
  });

  test('an absent binary is tool-missing, never no-runner — the command IS known here', () => {
    const enoent = missingToolSkip('stage_1.1', 'zig', {code: 'ENOENT'});
    expect(enoent).toEqual({stage: 'stage_1.1', pass: false, exitCode: 2, stderr: "'zig' not installed", skipReason: 'tool-missing'});

    const npxUnresolvable = missingToolSkip(
      'stage_2.1',
      'npx',
      {exitCode: 1, stderr: 'npm error canceled due to missing packages'},
      ['vitest', 'run'],
    );
    expect(npxUnresolvable?.exitCode).toBe(2);
    expect(npxUnresolvable?.skipReason).toBe('tool-missing');
    expect(npxUnresolvable?.stderr).toBe(
      "setup gap: 'npx' could not resolve the configured tool without installing it; " +
        'the inferred tool is not installed or unavailable offline',
    );

    // …and through a real stage whose resolved command does not exist.
    const staged = runType({cwd: dir, cmd: 'clad-no-such-binary-xyz', args: []});
    expect(staged.exitCode).toBe(2);
    expect(staged.skipReason).toBe('tool-missing');
    expect(staged.skipReason).not.toBe('no-runner');
  });

  test('a tool that RAN is not tagged at all — skipReason lives only on the skip lane', () => {
    declareGateCommands(dir);
    for (const r of [runType({cwd: dir}), runLint({cwd: dir}), runUnit({cwd: dir}), runCov({cwd: dir})]) {
      expect(r.pass, r.stage).toBe(true);
      expect(r.exitCode, r.stage).toBe(0);
      expect(r.skipReason, r.stage).toBeUndefined();
    }
  });
});

describe('AC-90c3f1a8 / AC-2f6e88d0 — the guidance text', () => {
  test('names every skipped stage and carries the remedy inline, on one line', () => {
    const line = clad.renderNoRunnerGuidance(['Type', 'Lint', 'Unit tests', 'Coverage']);
    for (const label of ['Type', 'Lint', 'Unit tests', 'Coverage']) expect(line).toContain(label);
    expect(line).toContain('.cladding/config.yaml');
    expect(line).toContain('gate:');
    expect(line).toContain('commands:');
    expect(line).toContain('committable');
    expect(line).not.toContain('\n');
    // The language name is deliberately absent — it reads 'unknown' exactly when
    // this fires, which names nothing an adopter can act on.
    expect(line).not.toContain('unknown');
  });

  test('nothing to say when nothing skipped for lack of a runner', () => {
    expect(clad.renderNoRunnerGuidance([])).toBe('');
  });
});

describe('AC-90c3f1a8 / AC-2f6e88d0 / AC-b59a37c4 — what a check run renders and reports', () => {
  let stdout: string;
  beforeEach(() => {
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((s: unknown) => {
      stdout += String(s);
      return true;
    }) as never);
  });

  const runnerlessGate = (): void => {
    stubs['stage_1.1'].mockImplementation(() => noRunner("no type checker registered for language 'unknown'"));
    stubs['stage_1.2'].mockImplementation(() => noRunner("no linter registered for language 'unknown'"));
    stubs['stage_2.1'].mockImplementation(() => noRunner("no unit test runner registered for language 'unknown'"));
    stubs['stage_2.2'].mockImplementation(() => noRunner("no coverage runner registered for language 'unknown'"));
    stubs['stage_2.3'].mockImplementation(() => BY_DESIGN);
    stubs['stage_2.4'].mockImplementation(() => BY_DESIGN);
  };

  test('one line, listing the four stages in run order, and the skips stay non-blocking', () => {
    runnerlessGate();
    const out = clad.runCheckStages({tier: 'pre-push'});
    const hits = stdout.split('no runner is known for this project').length - 1;
    expect(hits).toBe(1);
    expect(stdout).toContain('Type, Lint, Unit tests, Coverage skipped — no runner is known for this project.');
    expect(stdout).toContain('.cladding/config.yaml');
    expect(out.worst).toBe(0);
    expect(out.anyFailed).toBe(false);
  });

  test('an all-green run says nothing new', () => {
    const out = clad.runCheckStages({tier: 'pre-push'});
    expect(stdout).not.toContain('no runner is known');
    expect(out.worst).toBe(0);
  });

  test('by-design and tool-missing skips alone print nothing', () => {
    stubs['stage_1.1'].mockImplementation(() => TOOL_MISSING);
    stubs['stage_2.3'].mockImplementation(() => BY_DESIGN);
    stubs['stage_2.4'].mockImplementation(() => BY_DESIGN);
    clad.runCheckStages({tier: 'pre-push'});
    expect(stdout).not.toContain('no runner is known');
  });

  test('a tool-missing stage is not listed even when the line does fire', () => {
    runnerlessGate();
    stubs['stage_1.2'].mockImplementation(() => TOOL_MISSING); // Lint has its command; it is just absent
    clad.runCheckStages({tier: 'pre-push'});
    expect(stdout).toContain('Type, Unit tests, Coverage skipped — no runner is known for this project.');
    expect(stdout).not.toContain('Lint,');
  });

  test('JSON carries the same discrimination and no prose', () => {
    runnerlessGate();
    clad.runCheckStages({tier: 'pre-push', json: true});
    const doc = JSON.parse(stdout) as {stages: {stage: string; status: string; exitCode: number; skipReason?: string}[]};
    const bs = new Map(doc.stages.map((s) => [s.stage, s]));
    for (const id of ['stage_1.1', 'stage_1.2', 'stage_2.1', 'stage_2.2']) {
      expect(bs.get(id)?.skipReason, id).toBe('no-runner');
      expect(bs.get(id)?.status, id).toBe('skip');
      expect(bs.get(id)?.exitCode, id).toBe(2);
    }
    for (const id of ['stage_2.3', 'stage_2.4']) {
      expect(bs.get(id), id).toBeDefined();
      expect(bs.get(id)).not.toHaveProperty('skipReason');
    }
    expect(bs.get('stage_1.3')).not.toHaveProperty('skipReason');
    expect(stdout).not.toContain('no runner is known');
  });

  test('the verdict poll observes without speaking', () => {
    runnerlessGate();
    const out = clad.runCheckStages({tier: 'pre-push', silent: true});
    expect(stdout).toBe('');
    expect(out.stages?.find((s) => s.stage === 'stage_1.1')?.skipReason).toBe('no-runner');
  });
});
