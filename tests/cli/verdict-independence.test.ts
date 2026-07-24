// Cladding · unit tests for cli/verdict.ts × the independence label (F-c566f590 · AC-6f228987)
//
// Authored from the AC contract + the Verdict / VerdictDeps interfaces + the
// implementer's handoff report ONLY — the test author did not read
// runVerdictCommand's or computeVerdict's bodies.
//
// Two things AC-6f228987 asserts:
//   1. `clad verdict --json` includes per-done-feature `independence[]`,
//      computed in the CLI wrapper from the evidence ledger (readEvidence).
//   2. The pure reducer `computeVerdict` NEVER sets `independence` itself —
//      it stays IO-free. That is proven directly against the reducer,
//      independent of the CLI wrapper.
//
// process.exit and every stdout-writing primitive are mocked so a real poll
// can be driven in-process without exiting the test runner or printing.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/spec/load.js', () => ({loadSpec: vi.fn()}));

import {appendEvidence} from '../../src/hitl/audit.js';
import {newEvidence} from '../../src/hitl/identity.js';
import {computeVerdict, type VerdictOutcome, type VerdictStage} from '../../src/verdict/verdict.js';

const specMod = await import('../../src/spec/load.js');
const loadSpecMock = specMod.loadSpec as unknown as ReturnType<typeof vi.fn>;
const clad = await import('../../src/cli/verdict.js');

function mkStage(stage: string, status: VerdictStage['status'], extra: Record<string, unknown> = {}): VerdictStage {
  return {stage, label: stage, status, exitCode: status === 'pass' ? 0 : 1, ...extra} as VerdictStage;
}

// ─── AC-6f228987 (part 2): computeVerdict itself never sets `independence` ───

describe('computeVerdict reducer purity — independence (AC-6f228987)', () => {
  test('a GREEN, all-done outcome yields independence === undefined (reducer stays IO-free)', () => {
    const outcome: VerdictOutcome = {worst: 0, anyFailed: false, stages: [mkStage('stage_2.1', 'pass')]};
    const spec = {features: [{id: 'F-a', slug: 'a', status: 'done'}]} as unknown as Parameters<typeof computeVerdict>[0]['spec'];
    const v = computeVerdict({outcome, spec});
    expect(v.independence).toBeUndefined();
  });

  test('a RED outcome also yields independence === undefined', () => {
    const outcome: VerdictOutcome = {worst: 1, anyFailed: true, stages: [mkStage('stage_1.1', 'fail')]};
    const spec = {features: [{id: 'F-a', slug: 'a', status: 'planned'}]} as unknown as Parameters<typeof computeVerdict>[0]['spec'];
    const v = computeVerdict({outcome, spec});
    expect(v.independence).toBeUndefined();
  });

  test('a BOOTSTRAP (no features) outcome also yields independence === undefined', () => {
    const outcome: VerdictOutcome = {worst: 0, anyFailed: false, stages: []};
    const spec = {features: []} as unknown as Parameters<typeof computeVerdict>[0]['spec'];
    const v = computeVerdict({outcome, spec});
    expect(v.independence).toBeUndefined();
  });
});

// ─── AC-6f228987 (part 1): the CLI wrapper adds independence[] for done features ───

describe('runVerdictCommand --json includes independence[] for done features (AC-6f228987)', () => {
  let dir: string;
  let cwd0: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let chunks: string[];

  const SPEC = {
    features: [
      {id: 'F-done1', slug: 'done-one', status: 'done'},
      {id: 'F-planned', slug: 'planned-one', status: 'planned'},
    ],
  };

  beforeEach(() => {
    cwd0 = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'clad-verdict-indep-'));
    chunks = [];
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      return undefined as never;
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      chunks.push(args.map(String).join(' '));
    });
    loadSpecMock.mockReset();
    loadSpecMock.mockReturnValue(SPEC);
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd0);
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    logSpy.mockRestore();
    rmSync(dir, {recursive: true, force: true});
  });

  function parseEmitted(): Record<string, unknown> {
    const joined = chunks.join('');
    const first = joined.indexOf('{');
    const last = joined.lastIndexOf('}');
    expect(first, `no JSON object found in emitted output:\n${joined}`).toBeGreaterThanOrEqual(0);
    return JSON.parse(joined.slice(first, last + 1)) as Record<string, unknown>;
  }

  test('a done feature with human-authored evidence is labeled independent in the emitted independence[]', () => {
    appendEvidence(
      dir,
      newEvidence({featureId: 'F-done1', stage: 'stage_4.1', kind: 'pass', identity: {author: 'human'}, content: 'reviewed'}),
    );
    clad.runVerdictCommand(
      {json: true},
      {checkStages: () => ({worst: 0, anyFailed: false, stages: [mkStage('stage_2.1', 'pass')]})},
    );
    const emitted = parseEmitted();
    expect(Array.isArray(emitted.independence)).toBe(true);
    const independence = emitted.independence as Array<{id: string; label: string}>;
    expect(independence).toContainEqual({id: 'F-done1', label: 'independent'});
  });

  test('a done feature with ZERO evidence is honestly labeled self-certified (this repo\'s expected default)', () => {
    // No appendEvidence call — the audit log is empty.
    clad.runVerdictCommand(
      {json: true},
      {checkStages: () => ({worst: 0, anyFailed: false, stages: [mkStage('stage_2.1', 'pass')]})},
    );
    const emitted = parseEmitted();
    const independence = emitted.independence as Array<{id: string; label: string}>;
    expect(independence).toContainEqual({id: 'F-done1', label: 'self-certified'});
  });

  test('a done feature with only tool/llm evidence is still self-certified', () => {
    appendEvidence(
      dir,
      newEvidence({featureId: 'F-done1', stage: 'stage_2.1', kind: 'pass', identity: {author: 'tool'}, content: 'vitest green'}),
    );
    clad.runVerdictCommand(
      {json: true},
      {checkStages: () => ({worst: 0, anyFailed: false, stages: [mkStage('stage_2.1', 'pass')]})},
    );
    const emitted = parseEmitted();
    const independence = emitted.independence as Array<{id: string; label: string}>;
    expect(independence).toContainEqual({id: 'F-done1', label: 'self-certified'});
  });

  test('a NON-done feature does not appear in independence[] at all', () => {
    clad.runVerdictCommand(
      {json: true},
      {checkStages: () => ({worst: 0, anyFailed: false, stages: [mkStage('stage_2.1', 'pass')]})},
    );
    const emitted = parseEmitted();
    const independence = emitted.independence as Array<{id: string; label: string}>;
    expect(independence.find((e) => e.id === 'F-planned')).toBeUndefined();
  });
});
