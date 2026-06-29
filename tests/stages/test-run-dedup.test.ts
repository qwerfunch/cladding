import {afterEach, describe, expect, it} from 'vitest';
import {
  primeTestRunCache,
  isTestRunPrimed,
  memoizeTestRun,
  unitActionFromCoverage,
} from '../../src/stages/test-run-cache.js';

// Blind oracle for F-97abf5db: the gate-scoped memo that makes the unit +
// coverage stages run the test suite once. Authored from the spec brief only.

afterEach(() => primeTestRunCache(false));

describe('isTestRunPrimed / primeTestRunCache', () => {
  it('installs and clears a cache', () => {
    primeTestRunCache(true);
    expect(isTestRunPrimed()).toBe(true);
    primeTestRunCache(false);
    expect(isTestRunPrimed()).toBe(false);
  });
});

describe('memoizeTestRun', () => {
  it('1. unprimed → pass-through: run invoked on every call', () => {
    let n = 0;
    const run = () => {
      n++;
      return n;
    };
    // no prime installed
    expect(isTestRunPrimed()).toBe(false);
    const a = memoizeTestRun('/tmp/x', run);
    const b = memoizeTestRun('/tmp/x', run);
    expect(n).toBe(2);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('2. primed, same cwd → cached: run invoked once, same value returned', () => {
    let n = 0;
    const run = () => {
      n++;
      return n;
    };
    primeTestRunCache(true);
    const a = memoizeTestRun('/tmp/x', run);
    const b = memoizeTestRun('/tmp/x', run);
    expect(n).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('3. primed, different cwd → independent: run invoked twice', () => {
    let n = 0;
    const run = () => {
      n++;
      return n;
    };
    primeTestRunCache(true);
    const a = memoizeTestRun('/tmp/a', run);
    const b = memoizeTestRun('/tmp/b', run);
    expect(n).toBe(2);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('4. key is resolved path: /tmp/x and /tmp/x/../x share one entry', () => {
    let n = 0;
    const run = () => {
      n++;
      return n;
    };
    primeTestRunCache(true);
    const a = memoizeTestRun('/tmp/x', run);
    const b = memoizeTestRun('/tmp/x/../x', run);
    expect(n).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('5. re-priming installs a fresh cache (forgets prior entry)', () => {
    let n = 0;
    const run = () => {
      n++;
      return n;
    };
    primeTestRunCache(true);
    const a = memoizeTestRun('/tmp/x', run);
    expect(n).toBe(1);
    expect(a).toBe(1);
    primeTestRunCache(true); // fresh empty cache
    const b = memoizeTestRun('/tmp/x', run);
    expect(n).toBe(2);
    expect(b).toBe(2);
  });

  it('6. clearing restores pass-through', () => {
    let n = 0;
    const run = () => {
      n++;
      return n;
    };
    primeTestRunCache(true);
    memoizeTestRun('/tmp/x', run);
    expect(n).toBe(1);
    primeTestRunCache(false); // clear
    expect(isTestRunPrimed()).toBe(false);
    const a = memoizeTestRun('/tmp/x', run);
    const b = memoizeTestRun('/tmp/x', run);
    expect(n).toBe(3); // 1 (primed) + 2 (pass-through)
    expect(a).toBe(2);
    expect(b).toBe(3);
  });
});

describe('unitActionFromCoverage (soundness contract)', () => {
  // SOUNDNESS: `reuse-pass` is returned ONLY for an explicitly green (exitCode 0)
  // coverage run. Any non-zero / undefined exitCode ⇒ `fallback`, so a failing
  // test suite (non-zero) can NEVER be reported as a unit pass via reuse — the
  // unit stage re-runs tests-only instead. exitCode !== 0 ⇒ fallback is the guard.
  it('null → fallback (no coverage runner)', () => {
    expect(unitActionFromCoverage(null)).toBe('fallback');
  });

  it('missingTool: true (any exitCode) → fallback', () => {
    expect(unitActionFromCoverage({missingTool: true})).toBe('fallback');
    expect(unitActionFromCoverage({exitCode: 0, missingTool: true})).toBe('fallback');
    expect(unitActionFromCoverage({exitCode: 1, missingTool: true})).toBe('fallback');
  });

  it('exitCode 0, missingTool false → reuse-pass', () => {
    expect(unitActionFromCoverage({exitCode: 0, missingTool: false})).toBe('reuse-pass');
  });

  it('exitCode 1, missingTool false → fallback', () => {
    expect(unitActionFromCoverage({exitCode: 1, missingTool: false})).toBe('fallback');
  });

  it('exitCode 2, missingTool false → fallback', () => {
    expect(unitActionFromCoverage({exitCode: 2, missingTool: false})).toBe('fallback');
  });

  it('exitCode undefined, missingTool false → fallback (only explicit 0 reuses)', () => {
    expect(unitActionFromCoverage({exitCode: undefined, missingTool: false})).toBe('fallback');
  });
});
