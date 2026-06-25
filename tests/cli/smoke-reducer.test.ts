// F-e0f6c7 — smoke disposition spine (load-bearing #1).
// Proves the gate reducer's pure core: a stage's `disposition` overrides the
// exit-code mapping, blocking dispositions never collapse into the non-blocking
// exit-2 skip lane, and `na`/`liveness` are non-green yet non-blocking.

import {describe, expect, test} from 'vitest';

import {gateStatusOf, isBlocking, worstContribution, type GateStatus} from '../../src/stages/disposition.js';

describe('gateStatusOf — disposition-first', () => {
  test('a disposition OVERRIDES the exit-code mapping (pending_env does NOT collapse to skip)', () => {
    // The exact leak F-e0f6c7 closes: exitCode 2 would map to the non-blocking
    // skip lane, but a pending_env disposition must win.
    expect(gateStatusOf({pass: false, exitCode: 2, disposition: 'pending_env'})).toBe('pending_env');
    expect(gateStatusOf({pass: false, exitCode: 2, disposition: 'advisory'})).toBe('advisory');
    expect(gateStatusOf({pass: true, exitCode: 0, disposition: 'liveness'})).toBe('liveness');
    expect(gateStatusOf({pass: true, exitCode: 0, disposition: 'na'})).toBe('na');
    expect(gateStatusOf({pass: false, exitCode: 1, disposition: 'fail'})).toBe('fail');
    expect(gateStatusOf({pass: true, exitCode: 0, disposition: 'pass'})).toBe('pass');
  });

  test('legacy stages (no disposition) keep the exit-code spine', () => {
    expect(gateStatusOf({pass: true, exitCode: 0})).toBe('pass');
    expect(gateStatusOf({pass: false, exitCode: 2})).toBe('skip');
    expect(gateStatusOf({pass: false, exitCode: 1})).toBe('fail');
  });
});

describe('isBlocking — the honest blocking set', () => {
  test('fail / pending_env / advisory block; pass / skip / na / liveness do not', () => {
    const blocking: GateStatus[] = ['fail', 'pending_env', 'advisory'];
    const nonBlocking: GateStatus[] = ['pass', 'skip', 'na', 'liveness'];
    for (const s of blocking) expect(isBlocking(s), s).toBe(true);
    for (const s of nonBlocking) expect(isBlocking(s), s).toBe(false);
  });
});

describe('worstContribution — exit 1, never the exit-2 skip lane', () => {
  test('a blocking disposition contributes exactly 1 even when exitCode is 2', () => {
    // Defense-in-depth: a pending_env/advisory result must never let exit-2
    // semantics leak through as a non-blocking skip.
    expect(worstContribution({exitCode: 2, disposition: 'pending_env'}, 'pending_env')).toBe(1);
    expect(worstContribution({exitCode: 2, disposition: 'advisory'}, 'advisory')).toBe(1);
    expect(worstContribution({exitCode: 1, disposition: 'fail'}, 'fail')).toBe(1);
  });

  test('non-blocking statuses contribute 0 (na / liveness never fail the gate alone)', () => {
    expect(worstContribution({exitCode: 0, disposition: 'na'}, 'na')).toBe(0);
    expect(worstContribution({exitCode: 0, disposition: 'liveness'}, 'liveness')).toBe(0);
    expect(worstContribution({exitCode: 0, disposition: 'pass'}, 'pass')).toBe(0);
    expect(worstContribution({exitCode: 0}, 'skip')).toBe(0);
  });

  test('a legacy fail contributes its (already-collapsed) exit code', () => {
    expect(worstContribution({exitCode: 1}, 'fail')).toBe(1);
  });
});
