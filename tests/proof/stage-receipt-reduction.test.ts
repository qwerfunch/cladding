// Cladding · mechanism proof for schema-0.2 Audit and UAT receipt reduction.
//
// These tests deliberately exercise the existing offline receipt verifier and
// D21 adapter boundary. They do not ingest external evidence; receipt ingress
// belongs to the later host-channel work.

import {generateKeyPairSync, sign} from 'node:crypto';

import {describe, expect, test} from 'vitest';

import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {
  createTrustSnapshot,
  emptyTrustSnapshot,
  issuerKeyIdForSpki,
  receiptSigningPayload,
  type AuditReceipt,
  type PortableReceipt,
  type ReceiptExpectedDigestContext,
  type TrustSnapshot,
  type UatReceipt,
} from '../../src/proof/receipt.js';
import {
  buildProofView,
  createVerifiedReceiptInput,
  type CriterionProofView,
} from '../../src/proof/view.js';

const AUDIT_CRITERION = 'F-059/AC-143';
const UAT_FEATURE = 'F-061';
const UAT_CRITERIA = [
  'F-061/AC-149',
  'F-061/AC-150',
  'F-061/AC-151',
  'F-061/AC-152',
] as const;
const DIGESTS = {
  subject: 'a'.repeat(64),
  reviewedInputs: 'b'.repeat(64),
  runtimeDependency: 'c'.repeat(64),
  implementationAuthors: 'd'.repeat(64),
};

interface SignedReceiptFixture {
  readonly receipt: PortableReceipt;
  readonly trustSnapshot: TrustSnapshot;
  readonly expected: ReceiptExpectedDigestContext;
}

function signReceipt(unsigned: PortableReceipt): SignedReceiptFixture {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const issuerKeyId = issuerKeyIdForSpki(spkiDer);
  const unsignedWithKey = {...unsigned, issuer_key_id: issuerKeyId} as PortableReceipt;
  const receipt = {
    ...unsignedWithKey,
    issuer_proof: sign(null, receiptSigningPayload(unsignedWithKey), pair.privateKey).toString('base64url'),
  } as PortableReceipt;
  return {
    receipt,
    trustSnapshot: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId, spkiDer}]),
    expected: humanExpected(receipt),
  };
}

function humanExpected(receipt: PortableReceipt): ReceiptExpectedDigestContext {
  if (receipt.method !== 'human_channel') throw new Error('Expected a human receipt fixture.');
  return {
    subjectSha256: receipt.subject_sha256,
    reviewedInputsSha256: receipt.reviewed_inputs_sha256,
    runtimeDependencySha256: receipt.runtime_dependency_sha256,
    implementationAuthorsSha256: receipt.implementation_authors_sha256,
  };
}

function currentVerified(fixture: SignedReceiptFixture) {
  const verified = createVerifiedReceiptInput(fixture);
  if (!verified) throw new Error('The signed trusted fixture must verify against its sealed current inputs.');
  return verified;
}

function auditReceipt(
  checks: AuditReceipt['checks'] = {
    evidence_sufficiency: 'pass',
    code_test_review: 'pass',
    independence: 'pass',
  },
): AuditReceipt {
  return {
    receipt_schema: '1',
    issuer: 'stage-receipt fixture',
    issuer_key_id: '0'.repeat(64),
    issuer_proof: 'AA',
    subject: `criterion:${AUDIT_CRITERION}` as AuditReceipt['subject'],
    subject_sha256: DIGESTS.subject,
    observed_at: '2026-08-31T00:00:00.000Z',
    method: 'human_channel',
    claim: 'audit',
    reviewed_inputs_sha256: DIGESTS.reviewedInputs,
    runtime_dependency_sha256: DIGESTS.runtimeDependency,
    implementation_authors_sha256: DIGESTS.implementationAuthors,
    checks,
  };
}

function uatMatrix(overrides: Partial<UatReceipt['criterion_verdicts']> = {}): UatReceipt['criterion_verdicts'] {
  const matrix: Record<string, 'pass' | 'fail'> = {};
  for (const criterion of UAT_CRITERIA) matrix[`criterion:${criterion}`] = 'pass';
  return {...matrix, ...overrides} as UatReceipt['criterion_verdicts'];
}

function uatReceipt(
  criterionVerdicts: UatReceipt['criterion_verdicts'] = uatMatrix(),
  checks: UatReceipt['checks'] = {no_surprise: 'pass', tradeoff_acceptance: 'pass'},
): UatReceipt {
  return {
    receipt_schema: '1',
    issuer: 'stage-receipt fixture',
    issuer_key_id: '0'.repeat(64),
    issuer_proof: 'AA',
    subject: `feature:${UAT_FEATURE}` as UatReceipt['subject'],
    subject_sha256: DIGESTS.subject,
    observed_at: '2026-08-31T00:00:00.000Z',
    method: 'human_channel',
    claim: 'uat',
    reviewed_inputs_sha256: DIGESTS.reviewedInputs,
    runtime_dependency_sha256: DIGESTS.runtimeDependency,
    implementation_authors_sha256: DIGESTS.implementationAuthors,
    criterion_verdicts: criterionVerdicts,
    checks,
  };
}

function auditProofView(receipts: readonly unknown[]): readonly CriterionProofView[] {
  return buildProofView({schemaVersion: '0.2', criteria: [AUDIT_CRITERION], receipts});
}

function uatProofView(receipts: readonly unknown[]): readonly CriterionProofView[] {
  return buildProofView({
    schemaVersion: '0.2',
    criteria: UAT_CRITERIA,
    criteriaByFeature: new Map([[UAT_FEATURE, new Set(UAT_CRITERIA.map((criterion) => `criterion:${criterion}`))]]),
    receipts,
  });
}

function humanObligationState(
  views: readonly CriterionProofView[],
  stage: 'stage_4.1' | 'stage_4.2',
  criterion: string,
): 'pass' | 'fail' | 'unobserved' | 'na' | undefined {
  const verdict = reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L4'),
    configuredAssuranceLevel: 'L4',
    completeScope: true,
    scopeAddresses: [`feature:${criterion.split('/')[0]}`],
    inputAddresses: [`criterion:${criterion}`],
    inputSha256: 'e'.repeat(64),
    hasExecutableTests: false,
    hasOracleProof: false,
    hasDeliverable: false,
    requiresQuality: false,
    requiresHuman: true,
    proofViews: views,
    exactProofRequired: true,
    stages: [],
    environmentClass: 'test',
  });
  return verdict.results.find((result) => result.obligation === stage && result.subject === `criterion:${criterion}`)?.state;
}

describe('schema-0.2 stage receipt reduction', () => {
  test('[covers:F-059/AC-143] mechanism proof: trusted current Audit receipt with sealed dependency and author digests reduces to pass', () => {
    const fixture = signReceipt(auditReceipt());
    const view = auditProofView([currentVerified(fixture)]);

    expect(fixture.expected).toMatchObject({
      runtimeDependencySha256: DIGESTS.runtimeDependency,
      implementationAuthorsSha256: DIGESTS.implementationAuthors,
    });
    expect(view[0]?.audit).toBe('verified');
    expect(humanObligationState(view, 'stage_4.1', AUDIT_CRITERION)).toBe('pass');
  });

  test('[covers:F-059/AC-143] mechanism proof: missing, untrusted, or stale Audit receipt remains unobserved', () => {
    const fixture = signReceipt(auditReceipt());
    const missingContext = createVerifiedReceiptInput({receipt: fixture.receipt, trustSnapshot: fixture.trustSnapshot});
    const untrusted = createVerifiedReceiptInput({receipt: fixture.receipt, trustSnapshot: emptyTrustSnapshot(), expected: fixture.expected});
    const staleDependency = createVerifiedReceiptInput({
      receipt: fixture.receipt,
      trustSnapshot: fixture.trustSnapshot,
      expected: {...fixture.expected, runtimeDependencySha256: 'f'.repeat(64)},
    });
    const staleAuthors = createVerifiedReceiptInput({
      receipt: fixture.receipt,
      trustSnapshot: fixture.trustSnapshot,
      expected: {...fixture.expected, implementationAuthorsSha256: 'f'.repeat(64)},
    });

    expect([missingContext, untrusted, staleDependency, staleAuthors]).toEqual([undefined, undefined, undefined, undefined]);
    for (const receipts of [[], [missingContext], [untrusted], [staleDependency], [staleAuthors]]) {
      const view = auditProofView(receipts);
      expect(view[0]?.audit).toBe('unverified');
      expect(humanObligationState(view, 'stage_4.1', AUDIT_CRITERION)).toBe('unobserved');
    }
  });

  test('[covers:F-059/AC-143] mechanism proof: explicit negative Audit check reduces to fail', () => {
    const fixture = signReceipt(auditReceipt({
      evidence_sufficiency: 'pass',
      code_test_review: 'fail',
      independence: 'pass',
    }));
    const view = auditProofView([currentVerified(fixture)]);

    expect(view[0]?.audit).toBe('failed');
    expect(humanObligationState(view, 'stage_4.1', AUDIT_CRITERION)).toBe('fail');
  });

  test('[covers:F-061/AC-150] mechanism proof: trusted current UAT receipt with an exact criterion matrix reduces to pass', () => {
    const fixture = signReceipt(uatReceipt());
    const view = uatProofView([currentVerified(fixture)]);

    expect(fixture.expected).toMatchObject({
      runtimeDependencySha256: DIGESTS.runtimeDependency,
      implementationAuthorsSha256: DIGESTS.implementationAuthors,
    });
    expect(Object.keys((fixture.receipt as UatReceipt).criterion_verdicts).sort()).toEqual(
      UAT_CRITERIA.map((criterion) => `criterion:${criterion}`),
    );
    expect(view.every((row) => row.uat === 'verified')).toBe(true);
    expect(humanObligationState(view, 'stage_4.2', 'F-061/AC-150')).toBe('pass');
  });

  test('[covers:F-061/AC-150] mechanism proof: missing, untrusted, stale, or incomplete-matrix UAT receipt remains unobserved', () => {
    const fixture = signReceipt(uatReceipt());
    const untrusted = createVerifiedReceiptInput({receipt: fixture.receipt, trustSnapshot: emptyTrustSnapshot(), expected: fixture.expected});
    const stale = createVerifiedReceiptInput({
      receipt: fixture.receipt,
      trustSnapshot: fixture.trustSnapshot,
      expected: {...fixture.expected, implementationAuthorsSha256: 'f'.repeat(64)},
    });
    const incomplete = currentVerified(signReceipt(uatReceipt({
      'criterion:F-061/AC-149': 'pass',
    })));

    expect([untrusted, stale]).toEqual([undefined, undefined]);
    for (const receipts of [[], [untrusted], [stale], [incomplete]]) {
      const view = uatProofView(receipts);
      expect(view.every((row) => row.uat === 'unverified')).toBe(true);
      expect(humanObligationState(view, 'stage_4.2', 'F-061/AC-150')).toBe('unobserved');
    }
  });

  test('[covers:F-061/AC-150] mechanism proof: explicit negative UAT verdict reduces to fail', () => {
    const fixture = signReceipt(uatReceipt({
      'criterion:F-061/AC-150': 'fail',
    }));
    const view = uatProofView([currentVerified(fixture)]);

    expect(view.find((row) => row.criterion === 'F-061/AC-150')?.uat).toBe('failed');
    expect(humanObligationState(view, 'stage_4.2', 'F-061/AC-150')).toBe('fail');
  });
});
