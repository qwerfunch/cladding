// Cladding · Spec 0.2 F9d · out-of-workspace issuer key store tests.

import {lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {
  IssuerKeyError,
  createIssuerKey,
  hasIssuerPrivateKey,
  issuerKeyStoreDirectory,
  loadIssuerPrivateKey,
  signPortableReceipt,
  storedIssuerKeyIds,
} from '../../src/proof/issuer.js';
import {
  createTrustSnapshot,
  emptyTrustSnapshot,
  verifyPortableReceipt,
  type AuditReceipt,
} from '../../src/proof/receipt.js';

const temporary: string[] = [];

function keyStore(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-keys-'));
  temporary.push(root);
  return {CLADDING_KEYS_DIR: join(root, 'store')};
}

function auditBody(issuerKeyId: string): Omit<AuditReceipt, 'issuer_proof'> {
  return {
    receipt_schema: '1', issuer: 'reviewer', issuer_key_id: issuerKeyId,
    subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'a'.repeat(64),
    observed_at: '2026-09-03T00:00:00.000Z', method: 'human_channel', claim: 'audit',
    reviewed_inputs_sha256: 'b'.repeat(64), runtime_dependency_sha256: 'c'.repeat(64),
    implementation_authors_sha256: 'd'.repeat(64),
    checks: {evidence_sufficiency: 'pass', code_test_review: 'pass', independence: 'pass'},
  };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec 0.2 file-key issuer', () => {
  test('[covers:F-f4cfd533/AC-74458baa] stores the private key outside the workspace with owner-only permissions', () => {
    const env = keyStore();
    const created = createIssuerKey(env);
    expect(created.privateKeyPath).toBe(join(issuerKeyStoreDirectory(env), `${created.issuerKeyId}.ed25519`));
    expect(lstatSync(created.privateKeyPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(issuerKeyStoreDirectory(env)).mode & 0o777).toBe(0o700);
    expect(hasIssuerPrivateKey(created.issuerKeyId, env)).toBe(true);
    expect(storedIssuerKeyIds(env)).toEqual([created.issuerKeyId]);
    expect(loadIssuerPrivateKey(created.issuerKeyId, env).asymmetricKeyType).toBe('ed25519');
  });

  test('[covers:F-f4cfd533/AC-1d5f62de] signs a receipt that verifies offline against the registry snapshot', () => {
    const env = keyStore();
    const created = createIssuerKey(env);
    const privateKey = loadIssuerPrivateKey(created.issuerKeyId, env);
    const receipt = signPortableReceipt<AuditReceipt>(auditBody(created.issuerKeyId), privateKey);
    const trust = createTrustSnapshot([{issuer: 'reviewer', issuerKeyId: created.issuerKeyId, spkiDer: created.spkiDer}]);
    const expected = {
      subjectSha256: 'a'.repeat(64), reviewedInputsSha256: 'b'.repeat(64),
      runtimeDependencySha256: 'c'.repeat(64), implementationAuthorsSha256: 'd'.repeat(64),
    };
    expect(verifyPortableReceipt(receipt, trust, expected)).toMatchObject({assurance: 'verified', currentness: 'current', reason: 'verified'});
    // The same signature proves nothing to a host that never registered the key.
    expect(verifyPortableReceipt(receipt, emptyTrustSnapshot(), expected)).toMatchObject({assurance: 'asserted', reason: 'unknown_issuer_key'});
    const tampered = {...receipt, subject_sha256: 'e'.repeat(64)};
    expect(verifyPortableReceipt(tampered, trust, {...expected, subjectSha256: 'e'.repeat(64)})).toMatchObject({assurance: 'invalid', reason: 'invalid_signature'});
  });

  test('[covers:F-f4cfd533/AC-74458baa] refuses an absent, symlinked, or non-Ed25519 signing key', () => {
    const env = keyStore();
    const created = createIssuerKey(env);
    expect(hasIssuerPrivateKey('f'.repeat(64), env)).toBe(false);
    expect(() => loadIssuerPrivateKey('f'.repeat(64), env)).toThrow(IssuerKeyError);
    expect(() => loadIssuerPrivateKey('not-a-digest', env)).toThrow(/lowercase SHA-256 digest/);
    const store = issuerKeyStoreDirectory(env);
    const linked = 'a'.repeat(64);
    symlinkSync(created.privateKeyPath, join(store, `${linked}.ed25519`));
    expect(() => loadIssuerPrivateKey(linked, env)).toThrow(/symbolic link/);
    const garbage = 'b'.repeat(64);
    writeFileSync(join(store, `${garbage}.ed25519`), readFileSync(created.privateKeyPath).subarray(0, 4));
    expect(() => loadIssuerPrivateKey(garbage, env)).toThrow(/PKCS8 DER key/);
  });
});
