// Cladding · drive/halt.ts unit tests

import {describe, expect, test} from 'vitest';

import {
  DEFAULT_BUDGET,
  checkBudget,
  classifyTransportError,
} from '../../src/drive/halt.js';

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

describe('classifyTransportError (F-071, v0.2.22)', () => {
  describe('TRANSPORT_AUTH_FAILED', () => {
    test.each([
      ['401: invalid x-api-key'],
      ['403: forbidden'],
      ['authentication failed: invalid API key supplied'],
      ['Request unauthorized'],
      ['Forbidden — credentials rejected'],
      ['Invalid x-api-key header value'],
      // v0.2.23 (F-072) — pre-flight health-check phrases used by
      // adapter.healthCheck() when credentials are absent.
      ['ANTHROPIC_API_KEY env var is not set'],
      ['API key missing'],
      ['api_key is required'],
    ])('matches %s', (message) => {
      expect(classifyTransportError(new Error(message))).toBe('TRANSPORT_AUTH_FAILED');
    });
  });

  describe('TRANSPORT_RATE_LIMITED', () => {
    test.each([
      ['429: rate limit exceeded'],
      ['rate limit hit, retry in 30s'],
      ['rate_limit_exceeded'],
      ['Too many requests — slow down'],
      ['quota exceeded for org abc'],
    ])('matches %s', (message) => {
      expect(classifyTransportError(new Error(message))).toBe('TRANSPORT_RATE_LIMITED');
    });
  });

  describe('TRANSPORT_NETWORK', () => {
    test.each([
      ['connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED'],
      ['getaddrinfo ENOTFOUND api.anthropic.com', 'ENOTFOUND'],
      ['socket hang up: ECONNRESET', 'ECONNRESET'],
      ['ETIMEDOUT: dial tcp', 'ETIMEDOUT'],
    ])('matches errno %s on err.code', (message, code) => {
      const err = new Error(message) as NodeJS.ErrnoException;
      err.code = code;
      expect(classifyTransportError(err)).toBe('TRANSPORT_NETWORK');
    });

    test.each([
      ['network unreachable'],
      ['connection reset by peer'],
      ['request timeout after 30s'],
    ])('matches phrase %s in message', (message) => {
      expect(classifyTransportError(new Error(message))).toBe('TRANSPORT_NETWORK');
    });
  });

  describe('LLM_UNAVAILABLE catch-all', () => {
    test.each([
      ['unknown sdk failure'],
      ['JSON parse error in response'],
      ['something unusual happened'],
    ])('falls through on %s', (message) => {
      expect(classifyTransportError(new Error(message))).toBe('LLM_UNAVAILABLE');
    });

    test('handles non-Error throw values (string)', () => {
      expect(classifyTransportError('plain string error')).toBe('LLM_UNAVAILABLE');
    });

    test('handles non-Error throw values (object)', () => {
      expect(classifyTransportError({})).toBe('LLM_UNAVAILABLE');
    });
  });

  describe('classifier precedence', () => {
    test('auth check wins over rate-limit when both phrases appear', () => {
      // Auth check runs first in the if-chain; a 401 with "rate limit"
      // in the detail still classifies as auth, by design.
      expect(
        classifyTransportError(new Error('401: rate limit not the issue, key invalid')),
      ).toBe('TRANSPORT_AUTH_FAILED');
    });

    test('rate-limit wins over network when both phrases appear', () => {
      expect(
        classifyTransportError(new Error('429: connection rate limit')),
      ).toBe('TRANSPORT_RATE_LIMITED');
    });
  });
});
