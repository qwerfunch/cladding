// Cladding · drive/halt.ts unit tests

import {describe, expect, test} from 'vitest';

import {DEFAULT_BUDGET, checkBudget} from '../../src/drive/halt.js';

describe('checkBudget', () => {
  test('returns null inside every budget', () => {
    const result = checkBudget(1, Date.now(), new Map(), DEFAULT_BUDGET);
    expect(result).toBeNull();
  });

  test('MAX_ITERATIONS fires at the cap', () => {
    const result = checkBudget(DEFAULT_BUDGET.maxIterations, Date.now(), new Map());
    expect(result?.class).toBe('MAX_ITERATIONS');
  });

  test('WALL_CLOCK fires when elapsed exceeds budget', () => {
    const result = checkBudget(1, Date.now() - DEFAULT_BUDGET.maxWallClockMs - 1, new Map());
    expect(result?.class).toBe('WALL_CLOCK');
  });

  test('RETRY_THRESHOLD fires when a feature hits the retry cap', () => {
    const retries = new Map([['F-001', DEFAULT_BUDGET.maxRetriesPerFeature]]);
    const result = checkBudget(1, Date.now(), retries);
    expect(result?.class).toBe('RETRY_THRESHOLD');
    expect(result?.detail).toContain('F-001');
  });

  test('multiple violations — earliest checked wins (iteration first)', () => {
    const retries = new Map([['F-001', DEFAULT_BUDGET.maxRetriesPerFeature]]);
    const result = checkBudget(DEFAULT_BUDGET.maxIterations, Date.now(), retries);
    expect(result?.class).toBe('MAX_ITERATIONS');
  });
});
