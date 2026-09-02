// Cladding · proof-view tests.

import {generateKeyPairSync, sign} from 'node:crypto';
import {describe, expect, test} from 'vitest';

import {parseJUnitReport} from '../../src/stages/junit-report.js';
import {buildProofView, createVerifiedReceiptInput} from '../../src/proof/view.js';
import {createTrustSnapshot, issuerKeyIdForSpki, receiptSigningPayload, type AuditReceipt, type PortableReceipt} from '../../src/proof/receipt.js';

function verifiedReceiptInput(unsigned: PortableReceipt) {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const receipt = {...unsigned, issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: sign(null, receiptSigningPayload({...unsigned, issuer_key_id: issuerKeyIdForSpki(spkiDer)}), pair.privateKey).toString('base64url')} as PortableReceipt;
  const expected = receipt.method === 'human_channel'
    ? {subjectSha256: receipt.subject_sha256, reviewedInputsSha256: receipt.reviewed_inputs_sha256, runtimeDependencySha256: receipt.runtime_dependency_sha256, implementationAuthorsSha256: receipt.implementation_authors_sha256}
    : {subjectSha256: receipt.subject_sha256, evidenceSha256: receipt.evidence.sha256, capabilityManifestSha256: receipt.capability_manifest_sha256};
  return {receipt, trustSnapshot: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId: receipt.issuer_key_id, spkiDer}]), expected};
}

function verifiedReceipt(unsigned: PortableReceipt) {
  return createVerifiedReceiptInput(verifiedReceiptInput(unsigned))!;
}

function auditReceipt(): AuditReceipt {
  return {
    receipt_schema: '1', issuer: 'fixture', issuer_key_id: 'a'.repeat(64), issuer_proof: 'AA',
    subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'b'.repeat(64), observed_at: '2026-08-29T00:00:00.000Z',
    method: 'human_channel', claim: 'audit', reviewed_inputs_sha256: 'd'.repeat(64), runtime_dependency_sha256: 'e'.repeat(64), implementation_authors_sha256: 'f'.repeat(64),
    checks: {evidence_sufficiency: 'pass', code_test_review: 'pass', independence: 'pass'},
  };
}

describe('schema-selected proof view', () => {
  test('keeps asserted signoffs and generic blind flags out of schema 0.2 verified reductions', () => {
    const report = parseJUnitReport('<testsuite><testcase file="tests/proof/a.test.ts" name="[covers:F-aaaaaaaa/AC-bbbbbbbb] works"/></testsuite>');
    const view = buildProofView({
      schemaVersion: '0.2', criteria: ['F-aaaaaaaa/AC-bbbbbbbb'], report,
      bindings: [{criterion: 'F-aaaaaaaa/AC-bbbbbbbb', framework: 'vitest', file: 'tests/proof/a.test.ts', selector: '[covers:F-aaaaaaaa/AC-bbbbbbbb] works', carrier: 'title'}],
      evidence: [{id: 'ev-1', featureId: 'F-aaaaaaaa', acId: 'AC-bbbbbbbb', stage: 'stage_4.1', identity: {author: 'human', timestamp: '2026-08-29T00:00:00.000Z'}, kind: 'pass', content: 'legacy local', blind: true}],
    });
    expect(view).toEqual([expect.objectContaining({test: expect.objectContaining({state: 'verified'}), audit: 'unverified', uat: 'unverified', blind: 'unverified', assertedEvidence: 1})]);
  });

  test('[covers:F-2883ff4d/AC-2883ff08] reduces only current verified receipt-local Audit, UAT, and blind claims', () => {
    const report = parseJUnitReport('<testsuite><testcase file="tests/proof/a.test.ts" name="[covers:F-aaaaaaaa/AC-bbbbbbbb] works"/></testsuite>');
    const common = {receipt_schema: '1' as const, issuer: 'fixture', issuer_key_id: 'a'.repeat(64), issuer_proof: 'AA', subject_sha256: 'b'.repeat(64), observed_at: '2026-08-29T00:00:00.000Z'};
    const view = buildProofView({
      schemaVersion: '0.2', criteria: ['F-aaaaaaaa/AC-bbbbbbbb'], report,
      bindings: [{criterion: 'F-aaaaaaaa/AC-bbbbbbbb', framework: 'vitest', file: 'tests/proof/a.test.ts', selector: '[covers:F-aaaaaaaa/AC-bbbbbbbb] works', carrier: 'title'}],
      criteriaByFeature: new Map([['F-aaaaaaaa', new Set(['criterion:F-aaaaaaaa/AC-bbbbbbbb'])]]),
      receipts: [
        verifiedReceipt({...common, method: 'human_channel' as const, claim: 'audit' as const, subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb' as const, reviewed_inputs_sha256: 'd'.repeat(64), runtime_dependency_sha256: 'e'.repeat(64), implementation_authors_sha256: 'f'.repeat(64), checks: {evidence_sufficiency: 'pass' as const, code_test_review: 'pass' as const, independence: 'pass' as const}}),
        verifiedReceipt({...common, method: 'human_channel' as const, claim: 'uat' as const, subject: 'feature:F-aaaaaaaa' as const, reviewed_inputs_sha256: 'd'.repeat(64), runtime_dependency_sha256: 'e'.repeat(64), implementation_authors_sha256: 'f'.repeat(64), criterion_verdicts: {'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'pass' as const}, checks: {no_surprise: 'pass' as const, tradeoff_acceptance: 'pass' as const}}),
        verifiedReceipt({...common, method: 'blind_capability' as const, claim: 'independent_oracle' as const, subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb' as const, verdict: 'pass' as const, evidence: {locator: 'tests/proof/a.test.ts', sha256: 'd'.repeat(64)}, capability_manifest_sha256: 'e'.repeat(64)}),
      ],
    });
    expect(view).toEqual([expect.objectContaining({audit: 'verified', uat: 'verified', blind: 'verified'})]);
  });

  test('[covers:F-2883ff4d/AC-2883ff10] keeps the schema 0.1 compatibility view free of new receipt reductions', () => {
    expect(buildProofView({schemaVersion: '0.1', criteria: ['F-aaaaaaaa/AC-bbbbbbbb']})).toEqual([
      expect.objectContaining({audit: 'unverified', uat: 'unverified', blind: 'unverified', assertedEvidence: 0}),
    ]);
  });

  test('requires an exact current UAT matrix and gives explicit rows or checks failure precedence', () => {
    const common = {receipt_schema: '1' as const, issuer: 'fixture', issuer_key_id: 'a'.repeat(64), issuer_proof: 'AA', subject_sha256: 'b'.repeat(64), observed_at: '2026-08-29T00:00:00.000Z', method: 'human_channel' as const, claim: 'uat' as const, subject: 'feature:F-aaaaaaaa' as const, reviewed_inputs_sha256: 'd'.repeat(64), runtime_dependency_sha256: 'e'.repeat(64), implementation_authors_sha256: 'f'.repeat(64)};
    const criteria = ['F-aaaaaaaa/AC-bbbbbbbb', 'F-aaaaaaaa/AC-cccccccc'];
    const criteriaByFeature = new Map([['F-aaaaaaaa', new Set(['criterion:F-aaaaaaaa/AC-bbbbbbbb', 'criterion:F-aaaaaaaa/AC-cccccccc'])]]);
    const view = (receipt: PortableReceipt) => buildProofView({schemaVersion: '0.2', criteria, criteriaByFeature, receipts: [verifiedReceipt(receipt)]});
    expect(view({...common, criterion_verdicts: {'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'pass'}, checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'}}).every((row) => row.uat === 'unverified')).toBe(true);
    expect(view({...common, criterion_verdicts: {'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'pass', 'criterion:F-aaaaaaaa/AC-cccccccc': 'pass'}, checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'}}).every((row) => row.uat === 'verified')).toBe(true);
    const rowFailure = view({...common, criterion_verdicts: {'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'fail', 'criterion:F-aaaaaaaa/AC-cccccccc': 'pass'}, checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'}});
    expect(rowFailure.find((row) => row.criterion.endsWith('AC-bbbbbbbb'))?.uat).toBe('failed');
    expect(rowFailure.find((row) => row.criterion.endsWith('AC-cccccccc'))?.uat).toBe('unverified');
    expect(view({...common, criterion_verdicts: {'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'pass', 'criterion:F-aaaaaaaa/AC-cccccccc': 'pass'}, checks: {no_surprise: 'fail', tradeoff_acceptance: 'pass'}}).every((row) => row.uat === 'failed')).toBe(true);
  });

  test('ignores manually labeled verification objects that did not pass the verifier factory', () => {
    const forged = {receipt: {claim: 'audit'}, verification: {assurance: 'verified', currentness: 'current'}};
    expect(buildProofView({schemaVersion: '0.2', criteria: ['F-aaaaaaaa/AC-bbbbbbbb'], receipts: [forged]})).toEqual([
      expect.objectContaining({audit: 'unverified'}),
    ]);
  });

  test('owns a canonical receipt snapshot so post-verification caller mutation cannot change proof', () => {
    const input = verifiedReceiptInput(auditReceipt());
    const verified = createVerifiedReceiptInput(input)!;
    const mutableChecks = (input.receipt as AuditReceipt).checks as {evidence_sufficiency: 'pass' | 'fail'};
    mutableChecks.evidence_sufficiency = 'fail';

    const view = buildProofView({schemaVersion: '0.2', criteria: ['F-aaaaaaaa/AC-bbbbbbbb'], receipts: [verified]});
    expect(view[0]?.audit).toBe('verified');
    expect((verified.receipt as AuditReceipt).checks.evidence_sufficiency).toBe('pass');
  });

  test('deep-freezes the verifier-owned nested receipt snapshot', () => {
    const verified = verifiedReceipt(auditReceipt());
    const snapshotChecks = (verified.receipt as AuditReceipt).checks as {evidence_sufficiency: 'pass' | 'fail'};
    expect(() => { snapshotChecks.evidence_sufficiency = 'fail'; }).toThrow(TypeError);

    const view = buildProofView({schemaVersion: '0.2', criteria: ['F-aaaaaaaa/AC-bbbbbbbb'], receipts: [verified]});
    expect(view[0]?.audit).toBe('verified');
  });

  test('ignores structural clones and every discoverable-symbol transplant while retaining the factory identity', () => {
    const verified = verifiedReceipt(auditReceipt());
    const clone: Record<PropertyKey, unknown> = {...verified};
    for (const symbol of Object.getOwnPropertySymbols(verified)) {
      const descriptor = Object.getOwnPropertyDescriptor(verified, symbol);
      if (descriptor) Object.defineProperty(clone, symbol, descriptor);
    }

    const input = {schemaVersion: '0.2' as const, criteria: ['F-aaaaaaaa/AC-bbbbbbbb']};
    expect(buildProofView({...input, receipts: [clone]})[0]?.audit).toBe('unverified');
    expect(buildProofView({...input, receipts: [verified]})[0]?.audit).toBe('verified');
    expect(createVerifiedReceiptInput({receipt: {claim: 'audit'}, trustSnapshot: createTrustSnapshot()})).toBeUndefined();
  });
});
