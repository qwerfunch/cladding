import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {checkEarsShape, checkAc, type EarsIssue} from '../../src/spec/ears.js';
import type {Feature, AcceptanceCriterion} from '../../src/spec/types.js';

describe('EARS complex pattern (F-9d168287)', () => {
  describe('complex pattern: while precondition + when trigger', () => {
    it('returns null for a valid complex condition (while ..., when ...)', () => {
      expect(
        checkEarsShape(
          'complex',
          'While the aircraft is on the ground, when reverse thrust is commanded',
        ),
      ).toBeNull();
    });

    it('flags a missing while precondition with a message mentioning "while"', () => {
      const msg = checkEarsShape('complex', 'When reverse thrust is commanded');
      expect(msg).not.toBeNull();
      expect(typeof msg).toBe('string');
      expect((msg as string).toLowerCase()).toContain('while');
    });

    it('flags a missing when trigger with a message mentioning "when"', () => {
      const msg = checkEarsShape('complex', 'While the aircraft is on the ground');
      expect(msg).not.toBeNull();
      expect(typeof msg).toBe('string');
      expect((msg as string).toLowerCase()).toContain('when');
    });

    it('[covers:F-9d168287/AC-39ede515][covers:F-9d168287/AC-7c4353a2] complex requires both while and when clauses with named shape issues', () => {
      expect(checkEarsShape('complex', 'While precondition holds, when trigger arrives')).toBeNull();
      expect(checkEarsShape('complex', 'When trigger arrives')?.toLowerCase()).toContain('while');
      expect(checkEarsShape('complex', 'While precondition holds')?.toLowerCase()).toContain('when');
    });

    it('flags an empty-string condition as invalid', () => {
      const msg = checkEarsShape('complex', '');
      expect(msg).not.toBeNull();
      expect(typeof msg).toBe('string');
    });

    it('flags an undefined condition as invalid', () => {
      const msg = checkEarsShape('complex', undefined);
      expect(msg).not.toBeNull();
      expect(typeof msg).toBe('string');
    });

    it('matches the when trigger case-insensitively', () => {
      expect(checkEarsShape('complex', 'While A, WHEN b')).toBeNull();
    });
  });

  describe('backward-compatibility: original 5 patterns unchanged', () => {
    it('ubiquitous: empty condition is valid, a condition is invalid', () => {
      expect(checkEarsShape('ubiquitous', '')).toBeNull();
      expect(checkEarsShape('ubiquitous', 'when x')).not.toBeNull();
    });

    it('event: requires when, rejects while and empty', () => {
      expect(checkEarsShape('event', 'when x')).toBeNull();
      expect(checkEarsShape('event', 'while x')).not.toBeNull();
      expect(checkEarsShape('event', '')).not.toBeNull();
    });

    it('state: while condition is valid', () => {
      expect(checkEarsShape('state', 'while x')).toBeNull();
    });

    it('optional: where condition is valid', () => {
      expect(checkEarsShape('optional', 'where x')).toBeNull();
    });

    it('unwanted: if condition is valid', () => {
      expect(checkEarsShape('unwanted', 'if x')).toBeNull();
    });

    it('[covers:F-9d168287/AC-d50b6082] the original five EARS patterns retain their accepted condition forms', () => {
      expect(checkEarsShape('ubiquitous', '')).toBeNull();
      expect(checkEarsShape('event', 'when x')).toBeNull();
      expect(checkEarsShape('state', 'while x')).toBeNull();
      expect(checkEarsShape('optional', 'where x')).toBeNull();
      expect(checkEarsShape('unwanted', 'if x')).toBeNull();
    });

    it('undefined pattern: empty valid, non-empty condition invalid', () => {
      expect(checkEarsShape(undefined, '')).toBeNull();
      expect(checkEarsShape(undefined, 'some condition')).not.toBeNull();
    });
  });

  describe('checkAc integration', () => {
    const feat = {id: 'F-x', acceptance_criteria: []} as never as Feature;
    const ac = (cond: string) =>
      ({id: 'AC-1', ears: 'complex', condition: cond} as never as AcceptanceCriterion);

    it('returns [] for a valid complex AC and a length-1 issue for an invalid one', () => {
      const ok = checkAc(
        feat,
        ac('While the aircraft is on the ground, when reverse thrust is commanded'),
      );
      expect(ok).toEqual([]);

      const bad: readonly EarsIssue[] = checkAc(feat, ac('When reverse thrust is commanded'));
      expect(bad).toHaveLength(1);
      expect(bad[0].message.toLowerCase()).toContain('while');
    });
  });

  describe('schema-mirror smoke test', () => {
    it('[covers:F-9d168287/AC-76572b2d] complex reached the JSON schema enums (at least 2 occurrences)', () => {
      const raw = readFileSync(new URL('../../src/spec/schema.json', import.meta.url), 'utf8');
      const occurrences = raw.split('"complex"').length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });
  });
});
