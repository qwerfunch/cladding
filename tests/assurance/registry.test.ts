// Cladding · assurance registry tests.

import {describe, expect, test} from 'vitest';

import {
  deriveApplicability,
  descriptorsForLevel,
  descriptorsForProfile,
  OBLIGATION_DESCRIPTORS,
} from '../../src/assurance/registry.js';

describe('F6 assurance registry', () => {
  test('[covers:F-6f0a2106/AC-6f0a2101] projects the official 13, the legacy 15, and cumulative assurance levels from one registry', () => {
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

  test('keeps Commit in L1 while profile membership reserves it for release', () => {
    const ids = (profile: 'feedback' | 'checkpoint' | 'completion' | 'push' | 'release', level: 'L1' | 'L2' | 'L3' | 'L4') =>
      descriptorsForProfile(profile, level).map((entry) => entry.id);
    const l1 = descriptorsForLevel('L1').map((entry) => entry.id);
    const withoutCommit = (level: 'L1' | 'L2' | 'L3' | 'L4') =>
      descriptorsForLevel(level).filter((entry) => entry.id !== 'stage_1.4').map((entry) => entry.id);

    expect(l1).toEqual(['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6']);
    expect(OBLIGATION_DESCRIPTORS.find((entry) => entry.id === 'stage_1.4')?.profiles).toEqual(['release']);
    expect(ids('feedback', 'L4')).toEqual(['stage_1.3', 'stage_1.5', 'stage_1.6']);
    expect(ids('checkpoint', 'L4')).toEqual(withoutCommit('L1'));
    for (const profile of ['completion', 'push'] as const) {
      for (const level of ['L1', 'L2', 'L3', 'L4'] as const) expect(ids(profile, level)).toEqual(withoutCommit(level));
    }
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) expect(ids('release', level)).toEqual(descriptorsForLevel(level).map((entry) => entry.id));
  });

  test('[covers:F-055/AC-128][covers:F-056/AC-132][covers:F-057/AC-136][covers:F-058/AC-140][covers:F-059/AC-144][covers:F-060/AC-148][covers:F-061/AC-152][covers:F-062/AC-157][covers:F-063/AC-163][covers:F-064/AC-167][covers:F-6f0a2106/AC-6f0a2103] derives current coverage assurance only from the coverage obligation', () => {
    const coverage = OBLIGATION_DESCRIPTORS.find((entry) => entry.id === 'stage_2.2')!;
    expect(coverage).toMatchObject({id: 'stage_2.2', sourceStrictness: 'report'});
    expect(deriveApplicability(coverage, {complete: false, hasExecutableTests: false})).toBe('unresolved');
    expect(deriveApplicability(coverage, {complete: true, hasExecutableTests: false})).toBe('na');
    expect(deriveApplicability(coverage, {complete: true, hasExecutableTests: true})).toBe('required');
  });
});
