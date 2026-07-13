import {describe, it, expect} from 'vitest';
import {
  computeVerdict,
  type Verdict,
  type VerdictOutcome,
  type VerdictStage,
} from '../../src/verdict/verdict.js';
import type {Spec} from '../../src/spec/types.js';
import type {GateStatus} from '../../src/stages/disposition.js';

// --- fixtures ---------------------------------------------------------------
// Blind author: minimal literals cast to the declared types. We never read the
// source; we build the smallest inputs the interface contract allows.

function mkStage(
  stage: string,
  status: GateStatus,
  extra: Record<string, unknown> = {},
): VerdictStage {
  return {
    stage,
    label: stage,
    status,
    exitCode: status === 'pass' ? 0 : 1,
    ...extra,
  } as VerdictStage;
}

function feat(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {id, slug: id.toLowerCase(), status, ...extra};
}

function specWith(features: ReturnType<typeof feat>[]): Spec {
  return {features} as unknown as Spec;
}

describe('F-2e28cc72 clad verdict — reducer conformance', () => {
  it('AC2/AC3 DONE-path: green + a non-liveness behavioral proof (stage_2.1 pass) + all features done => DONE', () => {
    const outcome: VerdictOutcome = {
      worst: 0,
      anyFailed: false,
      stages: [mkStage('stage_2.1', 'pass'), mkStage('stage_1.1', 'pass')],
    };
    const spec = specWith([feat('F-a', 'done'), feat('F-b', 'done')]);
    const v: Verdict = computeVerdict({outcome, spec});
    expect(v.verdict).toBe('DONE');
  });

  it('AC2 guard (money test): green but NO non-liveness behavioral proof (2.1 liveness, 2.3 na, 2.4 skip) => ITERATE not DONE', () => {
    const outcome: VerdictOutcome = {
      worst: 0,
      anyFailed: false,
      stages: [
        mkStage('stage_2.1', 'liveness'),
        mkStage('stage_2.3', 'na'),
        mkStage('stage_2.4', 'skip'),
      ],
    };
    const spec = specWith([feat('F-a', 'done'), feat('F-b', 'done')]);
    const v: Verdict = computeVerdict({outcome, spec});
    expect(v.verdict).toBe('ITERATE');
    expect(v.verdict).not.toBe('DONE');
  });

  it('AC3 state: green outcome but one feature planned (others done) => not DONE and remaining lists it', () => {
    const outcome: VerdictOutcome = {
      worst: 0,
      anyFailed: false,
      stages: [mkStage('stage_2.1', 'pass')],
    };
    const spec = specWith([feat('F-a', 'done'), feat('F-planned', 'planned')]);
    const v: Verdict = computeVerdict({outcome, spec});
    expect(v.verdict).not.toBe('DONE');
    expect(['ITERATE', 'BLOCKED']).toContain(v.verdict);
    expect(v.remaining.map((r) => r.id)).toContain('F-planned');
  });

  it('AC1 BOOTSTRAP: spec with no features => BOOTSTRAP', () => {
    const outcome: VerdictOutcome = {worst: 0, anyFailed: false, stages: []};
    const spec = specWith([]);
    const v: Verdict = computeVerdict({outcome, spec});
    expect(v.verdict).toBe('BOOTSTRAP');
  });

  it('AC1 ITERATE-red: red gate with a fixable finding => ITERATE with a non-empty next_action naming the file/message', () => {
    const finding = {
      path: 'x.ts',
      line: 3,
      detector: 'TS',
      message: 'boom',
      severity: 'error',
    };
    const outcome: VerdictOutcome = {
      worst: 1,
      anyFailed: true,
      stages: [mkStage('stage_1.1', 'fail', {exitCode: 1, findings: [finding]})],
    };
    const spec = specWith([feat('F-a', 'planned')]);
    const v: Verdict = computeVerdict({outcome, spec});
    expect(v.verdict).toBe('ITERATE');
    expect(v.next_action).not.toBeNull();
    expect(typeof v.next_action).toBe('string');
    expect(String(v.next_action).length).toBeGreaterThan(0);
    expect(String(v.next_action)).toMatch(/x\.ts|boom/);
  });

  it('AC1 ESCALATE: red gate with a human-required halt (pending_env) => ESCALATE, halt_class HUMAN_REQUIRED', () => {
    const outcome: VerdictOutcome = {
      worst: 1,
      anyFailed: true,
      stages: [mkStage('stage_1.5', 'pending_env', {exitCode: 1})],
    };
    const spec = specWith([feat('F-a', 'planned')]);
    const v: Verdict = computeVerdict({outcome, spec});
    expect(v.verdict).toBe('ESCALATE');
    expect(v.halt_class).toBe('HUMAN_REQUIRED');
  });

  it('AC1/AC3 remaining: lists exactly the non-done, non-archived features', () => {
    const outcome: VerdictOutcome = {
      worst: 0,
      anyFailed: false,
      stages: [mkStage('stage_2.1', 'pass')],
    };
    const spec = specWith([
      feat('F-done', 'done'),
      feat('F-planned', 'planned'),
      feat('F-progress', 'in_progress'),
      feat('F-arch', 'archived', {archived: true}),
    ]);
    const v: Verdict = computeVerdict({outcome, spec});
    const ids = v.remaining.map((r) => r.id).sort();
    expect(ids).toEqual(['F-planned', 'F-progress']);
  });

  it('AC5 purity: same input yields deep-equal output (pure reducer, no IO)', () => {
    const outcome: VerdictOutcome = {
      worst: 0,
      anyFailed: false,
      stages: [mkStage('stage_2.1', 'pass')],
    };
    const spec = specWith([feat('F-a', 'done')]);
    const a = computeVerdict({outcome, spec});
    const b = computeVerdict({outcome, spec});
    expect(a).toEqual(b);
  });
});
