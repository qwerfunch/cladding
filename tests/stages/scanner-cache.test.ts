import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {primeScannerCache, memoizeScan} from '../../src/stages/scanner-cache.js';
import type {DriftFinding} from '../../src/stages/types.js';

describe('scanner-cache (F-5a49899e)', () => {
  let calls = 0;
  const compute = (): readonly DriftFinding[] => {
    calls++;
    return [{detector: 'X', severity: 'info', message: `m${calls}`}] as const;
  };

  beforeEach(() => {
    calls = 0;
    primeScannerCache(false); // start unprimed/clean
  });

  afterEach(() => {
    primeScannerCache(false); // leave clean — no cross-test leakage
  });

  it('no cache primed → pass-through (compute runs every call)', () => {
    memoizeScan('k', compute);
    memoizeScan('k', compute);
    expect(calls).toBe(2);
  });

  it('primed → second call is a hit (compute once, same reference)', () => {
    primeScannerCache(true);
    const a = memoizeScan('k', compute);
    const b = memoizeScan('k', compute);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it('primed, different keys compute independently', () => {
    primeScannerCache(true);
    memoizeScan('k1', compute);
    memoizeScan('k2', compute);
    expect(calls).toBe(2);
  });

  it('clearing restores pass-through', () => {
    primeScannerCache(true);
    memoizeScan('k', compute);
    expect(calls).toBe(1);

    primeScannerCache(false);
    const before = calls;
    memoizeScan('k', compute);
    memoizeScan('k', compute);
    // every post-clear call must run compute
    expect(calls - before).toBe(2);
  });

  it('re-priming installs a FRESH cache (does not remember prior key)', () => {
    primeScannerCache(true);
    memoizeScan('k', compute);
    expect(calls).toBe(1);

    primeScannerCache(true); // brand-new empty cache
    memoizeScan('k', compute);
    expect(calls).toBe(2);
  });

  it('returned findings are the compute output', () => {
    primeScannerCache(true);
    const result = memoizeScan('k', compute);
    expect(result).toEqual([{detector: 'X', severity: 'info', message: 'm1'}]);
  });
});
