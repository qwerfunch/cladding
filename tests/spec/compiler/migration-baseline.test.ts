// Cladding · Spec 0.2 F1 · node-granular migration baseline tests.

import {describe, expect, test} from 'vitest';

import {
  LEGACY_UNCLASSIFIED,
  hasLegacyExemption,
  remainingLegacyExemptions,
  validateMigrationBaseline,
  type MigrationBaseline,
} from '../../../src/spec/compiler/migration-baseline.js';

const baseline: MigrationBaseline = {
  schema: 1,
  sourceSchema: '0.1',
  project: {address: 'project', legacyIntent: 'Keep specs honest.'},
  features: [{
    address: 'feature:F-aaaaaaaa',
    title: 'Compiler bootstrap',
    exemption: {id: 'legacy:feature:F-aaaaaaaa', subject: 'feature:F-aaaaaaaa', reason: 'missing_feature_purpose'},
  }],
  criteria: [{
    address: 'criterion:F-aaaaaaaa/AC-11111111',
    legacyIntent: {text: 'The system shall preserve raw references.'},
    classification: LEGACY_UNCLASSIFIED,
    bindings: [{channel: 'test', raw: 'tests/compiler.test.ts#raw selector', selector: 'raw selector'}],
    exemption: {id: 'legacy:criterion:F-aaaaaaaa/AC-11111111', subject: 'criterion:F-aaaaaaaa/AC-11111111', reason: 'legacy_criterion_intent'},
  }, {
    address: 'criterion:F-aaaaaaaa/AC-22222222',
    legacyIntent: {text: 'The system shall preserve sibling exemptions.'},
    classification: LEGACY_UNCLASSIFIED,
    bindings: [],
    exemption: {id: 'legacy:criterion:F-aaaaaaaa/AC-22222222', subject: 'criterion:F-aaaaaaaa/AC-22222222', reason: 'legacy_criterion_intent'},
  }],
  scenarios: [],
};

describe('Spec 0.2 migration baseline schema', () => {
  test('stores exact per-criterion intent, bindings, legacy classification, and unique exemption identities', () => {
    expect(validateMigrationBaseline(baseline)).toEqual([]);
    expect(baseline.criteria[0]).toMatchObject({
      classification: 'legacy_unclassified',
      legacyIntent: {text: 'The system shall preserve raw references.'},
      bindings: [{channel: 'test', raw: 'tests/compiler.test.ts#raw selector', selector: 'raw selector'}],
    });
  });

  test('gives a new node no exemption and revokes only the edited node', () => {
    expect(hasLegacyExemption(baseline, 'criterion:F-aaaaaaaa/AC-new00001')).toBe(false);
    const remaining = remainingLegacyExemptions(baseline, [{
      subject: 'criterion:F-aaaaaaaa/AC-11111111',
      fields: ['criterion.statement'],
    }]);
    expect(remaining.map((exemption) => exemption.subject)).not.toContain('criterion:F-aaaaaaaa/AC-11111111');
    expect(remaining.map((exemption) => exemption.subject)).toContain('criterion:F-aaaaaaaa/AC-22222222');
  });

  test('keeps sibling exemptions when only non-intent fields change', () => {
    const remaining = remainingLegacyExemptions(baseline, [{
      subject: 'criterion:F-aaaaaaaa/AC-11111111',
      fields: ['status', 'modules', 'depends_on', 'links', 'bindings', 'notes', 'ordering', 'promotion'],
    }]);
    expect(remaining.map((exemption) => exemption.subject)).toEqual(expect.arrayContaining([
      'criterion:F-aaaaaaaa/AC-11111111',
      'criterion:F-aaaaaaaa/AC-22222222',
    ]));
  });
});
