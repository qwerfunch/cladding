import { describe, it, expect } from 'vitest';
import { fingerprintFindings, nextProgress } from '../../src/verdict/gate-progress.js';
import { computeVerdict } from '../../src/verdict/verdict.js';

// Blind conformance test for GATE_NO_PROGRESS (F-b0c8ba2c).
// Written against the AC text + declared signatures only — impl bodies unseen.
// Repo rule: no raw NUL bytes, no backtick template-literals. Single quotes only.

type FpArg = Parameters<typeof fingerprintFindings>[0];
type CvArg = Parameters<typeof computeVerdict>[0];

// A stage that BLOCKS (status:'fail') carrying the given findings.
function blockingStage(
  findings: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  return { stage: 'ts', label: 'TypeScript', status: 'fail', exitCode: 1, findings };
}

// A stage that does NOT block (status:'pass').
function passStage(): Record<string, unknown> {
  return { stage: 'ts', label: 'TypeScript', status: 'pass', exitCode: 0 };
}

function fp(stages: ReadonlyArray<Record<string, unknown>>): string {
  return fingerprintFindings(stages as unknown as FpArg);
}

function verdictOf(
  outcome: Record<string, unknown>,
  spec: Record<string, unknown>,
  stuck: boolean,
) {
  return computeVerdict({ outcome, spec, stuck } as unknown as CvArg);
}

const NON_DONE_SPEC: Record<string, unknown> = {
  features: [
    {
      id: 'F-b0c8ba2c',
      slug: 'gate-no-progress',
      status: 'in_progress',
      title: 'Gate no progress',
      acceptance_criteria: [],
    },
  ],
};

describe('fingerprintFindings — message-free fingerprint of blocking findings (AC1/AC3/AC4)', () => {
  it('AC1/AC3: an empty stages array produces the empty fingerprint', () => {
    expect(fp([])).toBe('');
  });

  it('AC1/AC3: all-pass stages carry no blocking findings, so fingerprint is empty', () => {
    expect(fp([passStage(), passStage()])).toBe('');
  });

  it('AC1: a single blocking finding yields a stable, non-empty fingerprint', () => {
    const stages = [
      blockingStage([
        { detector: 'TS2322', path: 'src/a.ts', line: 3, message: 'x', severity: 'error' },
      ]),
    ];
    const first = fp(stages);
    const second = fp(stages);
    expect(typeof first).toBe('string');
    expect(first).not.toBe('');
    // deterministic across repeated calls so consecutive polls are comparable
    expect(first).toBe(second);
  });

  it('AC4 soundness: message + line churn does NOT change the fingerprint (cosmetic churn cannot mask a repeat)', () => {
    const runOne = [
      blockingStage([
        { detector: 'TS2322', path: 'src/a.ts', line: 3, message: 'first wording', severity: 'error' },
      ]),
    ];
    const runTwo = [
      blockingStage([
        {
          detector: 'TS2322',
          path: 'src/a.ts',
          line: 99,
          message: 'completely different wording, temp path /var/tmp/xyz noise',
          severity: 'error',
        },
      ]),
    ];
    expect(fp(runOne)).not.toBe('');
    // same {detector, path} => same fingerprint even though message/line differ
    expect(fp(runOne)).toBe(fp(runTwo));
  });

  it('AC4 soundness: a genuinely different finding (detector or path) yields a DIFFERENT fingerprint (a real repeat is not missed)', () => {
    const base = fp([
      blockingStage([
        { detector: 'TS2322', path: 'src/a.ts', line: 3, message: 'x', severity: 'error' },
      ]),
    ]);
    const diffDetector = fp([
      blockingStage([
        { detector: 'TS9999', path: 'src/a.ts', line: 3, message: 'x', severity: 'error' },
      ]),
    ]);
    const diffPath = fp([
      blockingStage([
        { detector: 'TS2322', path: 'src/b.ts', line: 3, message: 'x', severity: 'error' },
      ]),
    ]);
    expect(diffDetector).not.toBe(base);
    expect(diffPath).not.toBe(base);
  });
});

describe('nextProgress — consecutive-run bookkeeping (AC2/AC3/AC5)', () => {
  it('AC5: with no prior run to compare, repeat is 1 and it is NOT stuck', () => {
    const r = nextProgress('abc', undefined);
    expect(r.fingerprint).toBe('abc');
    expect(r.repeat).toBe(1);
    expect(r.stuck).toBe(false);
  });

  it('AC2: an identical fingerprint on the second consecutive run advances repeat to 2 and is stuck', () => {
    const r = nextProgress('abc', { fingerprint: 'abc', repeat: 1 });
    expect(r.fingerprint).toBe('abc');
    expect(r.repeat).toBe(2);
    expect(r.stuck).toBe(true);
  });

  it('AC3: a different fingerprint resets repeat to 1 and is NOT stuck (progress was made)', () => {
    const r = nextProgress('def', { fingerprint: 'abc', repeat: 2 });
    expect(r.repeat).toBe(1);
    expect(r.stuck).toBe(false);
  });

  it('AC3: an empty fingerprint (green gate) resets and is NEVER stuck', () => {
    const afterRed = nextProgress('', { fingerprint: 'abc', repeat: 2 });
    expect(afterRed.repeat).toBe(1);
    expect(afterRed.stuck).toBe(false);
    // even when the prior fingerprint also matches (both empty), empty is never stuck
    const bothEmpty = nextProgress('', { fingerprint: '', repeat: 1 });
    expect(bothEmpty.stuck).toBe(false);
  });
});

describe('computeVerdict — stuck escalation vs iteration (AC2/AC3)', () => {
  it('AC2: a red gate that is stuck ESCALATEs with halt_class GATE_NO_PROGRESS; the same gate not-stuck ITERATEs', () => {
    const outcome: Record<string, unknown> = {
      worst: 1,
      anyFailed: true,
      stages: [
        blockingStage([
          { detector: 'TS2322', path: 'src/a.ts', line: 3, message: 'x', severity: 'error' },
        ]),
      ],
    };

    const stuck = verdictOf(outcome, NON_DONE_SPEC, true);
    expect(stuck.verdict).toBe('ESCALATE');
    expect(stuck.halt_class).toBe('GATE_NO_PROGRESS');

    const notStuck = verdictOf(outcome, NON_DONE_SPEC, false);
    expect(notStuck.verdict).toBe('ITERATE');
    expect(notStuck.halt_class).not.toBe('GATE_NO_PROGRESS');
  });

  it('AC2 precedence: a genuine HUMAN_REQUIRED escalate (pending_env) wins over stuck', () => {
    const outcome: Record<string, unknown> = {
      worst: 1,
      anyFailed: true,
      stages: [{ stage: 'env', label: 'Env', status: 'pending_env', exitCode: 0 }],
    };

    const v = verdictOf(outcome, NON_DONE_SPEC, true);
    expect(v.verdict).toBe('ESCALATE');
    expect(v.halt_class).toBe('HUMAN_REQUIRED');
  });
});
