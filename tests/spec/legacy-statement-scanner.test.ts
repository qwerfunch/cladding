// Cladding · Spec 0.2 F2 · total legacy-statement scanner acceptance cases.

import {describe, expect, test} from 'vitest';

import {scanLegacyStatement} from '../../src/spec/legacy-statement-scanner.js';

describe('Spec 0.2 legacy statement scanner', () => {
  test('L01 parsed', () => {
    expect(scanLegacyStatement('When a user saves, the system shall retain the draft.', 'event')).toMatchObject({status: 'parsed'});
    expect(scanLegacyStatement('When a user saves, while storage is available, the system shall retain the draft.', 'complex')).toMatchObject({status: 'parsed'});
  });

  test('L02 opaque', () => {
    expect(scanLegacyStatement('Draft retention is important to our customers.')).toEqual({status: 'opaque'});
    expect(scanLegacyStatement('A policy note preserves `shall` as quoted prose.')).toEqual({status: 'opaque'});
  });

  test('L03 conflict', () => {
    expect(scanLegacyStatement('When a user saves, the system shall retain the draft.', 'state')).toEqual({status: 'conflict', reason: 'DECLARED_PATTERN_MISMATCH'});
    expect(scanLegacyStatement('The system must retain the draft.')).toMatchObject({status: 'conflict', reason: 'MALFORMED_EARS'});
    expect(scanLegacyStatement('Draft retention is important to our customers.', 'event')).toMatchObject({status: 'conflict', reason: 'MALFORMED_EARS'});
    expect(scanLegacyStatement('System shall persist.')).toMatchObject({status: 'conflict', reason: 'MALFORMED_EARS'});
  });

  test('L04 deterministic seeded arbitrary-input no-throw', () => {
    let seed = 0x5eedc0de;
    const next = (): string => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const length = seed % 96;
      let value = '';
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        value += String.fromCharCode(32 + (seed % 95));
      }
      return value;
    };
    const inputs = Array.from({length: 128}, next);
    const first = inputs.map((input) => scanLegacyStatement(input));
    const second = inputs.map((input) => scanLegacyStatement(input));
    expect(first).toEqual(second);
    expect(first.every((result) => result.status === 'parsed' || result.status === 'opaque' || result.status === 'conflict')).toBe(true);
  });
});
