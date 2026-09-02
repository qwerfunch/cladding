// Cladding · Spec 0.2 F1 · node-granular migration baseline tests.

import {createHash} from 'node:crypto';

import yaml from 'yaml';
import {describe, expect, test} from 'vitest';

import {
  LEGACY_L2_OBLIGATIONS,
  LEGACY_UNCLASSIFIED,
  canonicalSortedJson,
  criterionAuthorizationSha256,
  criterionFinalIntentSha256,
  hasLegacyExemption,
  legacyL2AuthorizationMatches,
  legacyL2CandidateCensusSha256,
  legacyL2CandidateSha256,
  legacyL2ResolutionSha256,
  migrationBaselineReceiptSha256,
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

  test('rejects non-finite values parsed from YAML before they can collapse into one receipt hash', () => {
    for (const source of ['.nan', '+.inf', '-.inf']) {
      const parsed = yaml.parse([
        'schema: 1', 'sourceSchema: "0.1"', 'project:', '  address: project', '  legacyIntent: Keep specs honest.',
        'features: []', 'criteria:', '  - address: criterion:F-aaaaaaaa/AC-11111111',
        '    legacyIntent: {text: The system shall preserve raw references.}', '    legacyRecord:', `      nonFinite: ${source}`,
        '    classification: legacy_unclassified', '    bindings: []', '    exemption:', '      id: legacy:criterion:F-aaaaaaaa/AC-11111111',
        '      subject: criterion:F-aaaaaaaa/AC-11111111', '      reason: legacy_criterion_intent', 'scenarios: []', '',
      ].join('\n')) as MigrationBaseline;
      expect(validateMigrationBaseline(parsed)).toEqual(expect.arrayContaining([
        expect.stringContaining('JSON-safe values'),
      ]));
      expect(() => migrationBaselineReceiptSha256(parsed)).toThrow(/JSON-safe values/);
    }
  });

  test('[covers:F-182eaa53/AC-dacbffda] gives a new node no exemption and revokes only the edited node', () => {
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

  test('validates an accepted criterion-local L2 receipt and revokes only a changed final intent', () => {
    const current = {statement: 'The system shall preserve raw references.', kind: 'behavior' as const};
    const criterion = 'criterion:F-aaaaaaaa/AC-11111111';
    const finalIntentSha256 = criterionFinalIntentSha256({
      statement: current.statement, kind: current.kind, rationale: null, constraintRefs: null,
    });
    expect(finalIntentSha256).toBe(createHash('sha256').update(JSON.stringify({
      constraint_refs: null, domain: 'cladding.criterion-final-intent/1', kind: 'behavior', rationale: null, statement: current.statement,
    })).digest('hex'));
    const previewSha256 = 'a'.repeat(64);
    const candidateCensusSha256 = legacyL2CandidateCensusSha256([criterion]);
    const resolutionSha256 = legacyL2ResolutionSha256({
      previewSha256, decision: 'accept', candidateCount: 1, candidateCensusSha256,
    });
    expect(resolutionSha256).toBe(createHash('sha256').update(JSON.stringify({
      candidate_census_sha256: candidateCensusSha256, candidate_count: 1, decision: 'accept', domain: 'cladding.migration-l2-resolution/1', preview_sha256: previewSha256,
    })).digest('hex'));
    const authorization = {
      criterion, sourceStatus: 'done' as const, finalIntentSha256, obligations: LEGACY_L2_OBLIGATIONS,
      candidateSha256: '', resolutionSha256,
    };
    const receipt: MigrationBaseline = {
      ...baseline,
      legacyL2Baseline: {
        decision: 'accept', previewSha256, candidateCount: 1, candidateCensusSha256, resolutionSha256,
        authorizations: [{...authorization, candidateSha256: legacyL2CandidateSha256(authorization)}],
      },
    };
    expect(receipt.legacyL2Baseline!.authorizations[0]!.candidateSha256).toBe(createHash('sha256').update(JSON.stringify({
      criterion, domain: 'cladding.migration-l2-candidate/1', final_intent_sha256: finalIntentSha256,
      obligations: ['stage_2.1', 'stage_2.2'], source_status: 'done',
    })).digest('hex'));
    expect(validateMigrationBaseline(receipt)).toEqual([]);
    const acceptedAuthorization = receipt.legacyL2Baseline!.authorizations[0]!;
    expect(criterionAuthorizationSha256(acceptedAuthorization)).toBe(createHash('sha256').update(JSON.stringify({
      candidateSha256: acceptedAuthorization.candidateSha256, criterion: acceptedAuthorization.criterion,
      finalIntentSha256: acceptedAuthorization.finalIntentSha256, obligations: ['stage_2.1', 'stage_2.2'],
      resolutionSha256: acceptedAuthorization.resolutionSha256, sourceStatus: acceptedAuthorization.sourceStatus,
    })).digest('hex'));
    expect(migrationBaselineReceiptSha256(receipt)).toBe(createHash('sha256').update(canonicalSortedJson(receipt)).digest('hex'));
    expect(legacyL2AuthorizationMatches(receipt, 'F-aaaaaaaa/AC-11111111', current)).toBe(true);
    expect(legacyL2AuthorizationMatches(receipt, 'F-aaaaaaaa/AC-11111111', {...current, statement: 'The system shall change the final intent.'})).toBe(false);
    expect(legacyL2AuthorizationMatches(receipt, 'F-aaaaaaaa/AC-22222222', current)).toBe(false);

    const swapped = JSON.parse(JSON.stringify(receipt)) as MigrationBaseline;
    (swapped.legacyL2Baseline!.authorizations[0] as {criterion: string}).criterion = 'criterion:F-aaaaaaaa/AC-22222222';
    expect(validateMigrationBaseline(swapped)).not.toEqual([]);
    const duplicated = JSON.parse(JSON.stringify(receipt)) as MigrationBaseline;
    (duplicated.legacyL2Baseline!.authorizations as unknown as {push(value: unknown): number}).push(duplicated.legacyL2Baseline!.authorizations[0]!);
    expect(validateMigrationBaseline(duplicated)).not.toEqual([]);
    const malformed = JSON.parse(JSON.stringify(receipt)) as MigrationBaseline;
    (malformed.legacyL2Baseline!.authorizations[0] as {finalIntentSha256: string}).finalIntentSha256 = 'not-a-digest';
    expect(validateMigrationBaseline(malformed)).not.toEqual([]);
  });
});
