// Cladding · unit tests for spec/ears.ts

import {describe, expect, test} from 'vitest';

import {checkAc} from '../../src/spec/ears.js';
import type {Feature} from '../../src/spec/types.js';

const feature: Feature = {id: 'F-001', title: 't', status: 'done'};

describe('checkAc — EARS syntactic', () => {
  test('ubiquitous with no condition passes', () => {
    expect(
      checkAc(feature, {id: 'AC-001', ears: 'ubiquitous', text: 'shall'}),
    ).toEqual([]);
  });

  test('ubiquitous with a condition flags an issue', () => {
    const result = checkAc(feature, {id: 'AC-001', ears: 'ubiquitous', condition: 'when foo'});
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('ubiquitous');
  });

  test('event requires condition starting with when', () => {
    expect(
      checkAc(feature, {id: 'AC-001', ears: 'event', condition: 'when x happens'}),
    ).toEqual([]);
    const wrong = checkAc(feature, {id: 'AC-001', ears: 'event', condition: 'if x happens'});
    expect(wrong).toHaveLength(1);
  });

  test('state requires while; optional requires where; unwanted requires if', () => {
    expect(checkAc(feature, {id: 'A', ears: 'state', condition: 'while x'})).toEqual([]);
    expect(checkAc(feature, {id: 'A', ears: 'optional', condition: 'where x'})).toEqual([]);
    expect(checkAc(feature, {id: 'A', ears: 'unwanted', condition: 'if x'})).toEqual([]);
  });

  test('missing condition for non-ubiquitous emits issue', () => {
    const result = checkAc(feature, {id: 'AC-001', ears: 'event'});
    expect(result).toHaveLength(1);
  });

  test('unspecified pattern with condition emits issue', () => {
    const result = checkAc(feature, {id: 'AC-001', condition: 'when x'});
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('unspecified');
  });
});
