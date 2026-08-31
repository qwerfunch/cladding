// Cladding · proof receipt tests.

import {generateKeyPairSync, sign} from 'node:crypto';

import {describe, expect, test} from 'vitest';

import {
  canonicalizeJson,
  createTrustSnapshot,
  issuerKeyIdForSpki,
  parsePortableReceiptYaml,
  receiptDigest,
  receiptSigningPayload,
  serializePortableReceipt,
  verifyPortableReceipt,
  type BlindReceipt,
} from '../../src/proof/receipt.js';

function signedBlindReceipt(): {receipt: BlindReceipt; trust: ReturnType<typeof createTrustSnapshot>} {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const base: BlindReceipt = {
    receipt_schema: '1', issuer: 'fixture issuer', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA',
    subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'a'.repeat(64), observed_at: '2026-08-29T12:34:56.789Z',
    method: 'blind_capability', claim: 'independent_oracle', verdict: 'pass', evidence: {locator: 'tests/proof/example.test.ts', sha256: 'b'.repeat(64)}, capability_manifest_sha256: 'c'.repeat(64),
  };
  const receipt = {...base, issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url')};
  return {receipt, trust: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId: receipt.issuer_key_id, spkiDer}])};
}

describe('portable receipt protocol', () => {
  test('uses deterministic JCS bytes, a framed detached signature, and explicit offline currentness', () => {
    const {receipt, trust} = signedBlindReceipt();
    const serialized = serializePortableReceipt(receipt);
    expect(serialized).toBe(`${canonicalizeJson(receipt)}\n`);
    expect(parsePortableReceiptYaml(serialized)).toEqual(receipt);
    expect(receiptDigest(receipt)).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyPortableReceipt(receipt, trust, {
      subjectSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64), capabilityManifestSha256: 'c'.repeat(64),
    })).toMatchObject({assurance: 'verified', currentness: 'current', reason: 'verified'});
    expect(verifyPortableReceipt(receipt, trust)).toMatchObject({assurance: 'asserted', currentness: 'unresolved', reason: 'missing_expected_context'});
    expect(verifyPortableReceipt(receipt, trust, {
      subjectSha256: 'd'.repeat(64), evidenceSha256: 'b'.repeat(64), capabilityManifestSha256: 'c'.repeat(64),
    })).toMatchObject({assurance: 'invalid', currentness: 'stale', reason: 'expected_digest_mismatch'});
  });

  test('rejects YAML aliases, unknown claims, invalid timestamps, and persisted derived fields', () => {
    expect(() => parsePortableReceiptYaml('a: &anchor {x: 1}\nb: *anchor\n')).toThrow(/aliases|anchors/i);
    const {receipt} = signedBlindReceipt();
    expect(() => parsePortableReceiptYaml(serializePortableReceipt({...receipt, assurance: 'verified'} as unknown as BlindReceipt))).toThrow(/Unknown receipt field/);
    expect(() => parsePortableReceiptYaml(serializePortableReceipt({...receipt, observed_at: '2026-08-29T12:34:56Z'}))).toThrow(/observed_at/);
  });

  test('implements JCS IEEE-754 and Unicode edge behavior without locale ordering', () => {
    expect(canonicalizeJson({numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0]})).toBe('{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0]}');
    expect(canonicalizeJson({'\u0000': '\b\t\n', '\u{1f600}': 'emoji', '\u20ac': 'euro'})).toBe('{"\\u0000":"\\b\\t\\n","€":"euro","😀":"emoji"}');
    expect(() => canonicalizeJson('\ud800')).toThrow(/Unicode scalar/);
  });

  test('checks supplied expected digests before unknown trust and requires Ed25519 SPKI trust keys', () => {
    const {receipt} = signedBlindReceipt();
    expect(verifyPortableReceipt(receipt, createTrustSnapshot([]), {subjectSha256: 'd'.repeat(64)})).toMatchObject({assurance: 'invalid', reason: 'expected_digest_mismatch'});
    const rsa = generateKeyPairSync('rsa', {modulusLength: 2048});
    const spkiDer = rsa.publicKey.export({format: 'der', type: 'spki'});
    expect(() => createTrustSnapshot([{issuer: 'rsa', issuerKeyId: issuerKeyIdForSpki(spkiDer), spkiDer}])).toThrow(/Ed25519/);
  });
});
