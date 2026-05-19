// Cladding · unit tests for spec/validate.ts

import {describe, expect, test} from 'vitest';

import {validateSpec} from '../../src/spec/validate.js';

describe('validateSpec', () => {
  test('accepts a minimal valid spec', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [
        {id: 'F-001', title: 't', status: 'done'},
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects missing required root key', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      // features missing
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('rejects feature id not matching F-NNN pattern', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [{id: 'bad-id', title: 't', status: 'done'}],
    });
    expect(result.valid).toBe(false);
  });

  test('rejects unknown status enum value', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [{id: 'F-001', title: 't', status: 'unknown_status'}],
    });
    expect(result.valid).toBe(false);
  });
});
