// Cladding · unit tests for spec/validate.ts

import {describe, expect, test} from 'vitest';

import {validateSpec} from '../../src/spec/validate.js';

describe('validateSpec', () => {
  test('[covers:F-052/AC-106] accepts evidence_refs beside executable test_refs', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [{
        id: 'F-001', title: 't', status: 'done',
        acceptance_criteria: [{
          id: 'AC-001',
          test_refs: ['tests/example.test.ts'],
          evidence_refs: ['docs/verification.md'],
        }],
      }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

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

  // F-4ef09f38 — the schema accepts `feature` (per-feature binding) on a smoke probe.
  test('accepts a smoke probe carrying a feature binding', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {
        name: 'x',
        language: 'typescript',
        smoke: [{kind: 'cli', run: ['./run'], feature: 'F-abcdef', expect: {token: 'X'}}],
      },
      features: [{id: 'F-abcdef', title: 't', status: 'done'}],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects an unknown key on a smoke probe (additionalProperties:false)', () => {
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'x', language: 'typescript', smoke: [{kind: 'cli', bogus: true}]},
      features: [{id: 'F-001', title: 't', status: 'done'}],
    });
    expect(result.valid).toBe(false);
  });
});
