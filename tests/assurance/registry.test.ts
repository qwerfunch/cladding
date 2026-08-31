// Cladding · assurance registry tests.

import {describe, expect, test} from 'vitest';

import {deriveApplicability, descriptorsForLevel, OBLIGATION_DESCRIPTORS} from '../../src/assurance/registry.js';

describe('F6 assurance registry', () => {
  test('projects the official 13, the legacy 15, and cumulative assurance levels from one registry', () => {
    expect(OBLIGATION_DESCRIPTORS).toHaveLength(15);
    expect(OBLIGATION_DESCRIPTORS.filter((entry) => entry.ironclad)).toHaveLength(13);
    expect(descriptorsForLevel('L1')).toHaveLength(6);
    expect(descriptorsForLevel('L2')).toHaveLength(10);
    expect(descriptorsForLevel('L3')).toHaveLength(13);
    expect(descriptorsForLevel('L4').map((entry) => entry.id)).toEqual(OBLIGATION_DESCRIPTORS.map((entry) => entry.id));
    expect(descriptorsForLevel('L1').every((entry) => descriptorsForLevel('L2').includes(entry))).toBe(true);
    expect(descriptorsForLevel('L2').every((entry) => descriptorsForLevel('L3').includes(entry))).toBe(true);
    expect(descriptorsForLevel('L3').every((entry) => descriptorsForLevel('L4').includes(entry))).toBe(true);
    expect(OBLIGATION_DESCRIPTORS.find((entry) => entry.id === 'stage_2.2')?.blocking).toBe('hard');
    expect(OBLIGATION_DESCRIPTORS.find((entry) => entry.id === 'stage_2.2')?.sourceStrictness).toBe('report');
  });

  test('allows NA only from complete compiler applicability facts', () => {
    const coverage = OBLIGATION_DESCRIPTORS.find((entry) => entry.id === 'stage_2.2')!;
    expect(deriveApplicability(coverage, {complete: false, hasExecutableTests: false})).toBe('unresolved');
    expect(deriveApplicability(coverage, {complete: true, hasExecutableTests: false})).toBe('na');
    expect(deriveApplicability(coverage, {complete: true, hasExecutableTests: true})).toBe('required');
  });
});
