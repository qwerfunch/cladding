// Cladding · Spec 0.2 F9d · committed trust registry tests.

import {generateKeyPairSync} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {ReceiptFormatError, emptyTrustSnapshot, issuerKeyIdForSpki} from '../../src/proof/receipt.js';
import {
  TRUST_REGISTRY_PATH,
  loadTrustSnapshot,
  parseTrustRegistry,
  readTrustRegistry,
  serializeTrustRegistry,
  trustRegistryAddition,
} from '../../src/proof/trust.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-trust-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: trust\n  language: typescript\n  purpose: Keep the public registry reviewable.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  return root;
}

function registry(root: string, body: string): void {
  mkdirSync(join(root, 'spec', 'trust'), {recursive: true});
  writeFileSync(join(root, TRUST_REGISTRY_PATH), body);
}

function publicKey(): {spkiDer: Uint8Array; issuerKeyId: string; base64: string} {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = new Uint8Array(pair.publicKey.export({format: 'der', type: 'spki'}));
  return {spkiDer, issuerKeyId: issuerKeyIdForSpki(spkiDer), base64: Buffer.from(spkiDer).toString('base64')};
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec 0.2 committed trust registry', () => {
  test('[covers:F-f4cfd533/AC-706195b8] keeps the empty trust snapshot digest when no registry exists', () => {
    const root = workspace();
    const snapshot = loadTrustSnapshot(root);
    expect(snapshot.keys).toEqual([]);
    expect(snapshot.digest).toBe(emptyTrustSnapshot().digest);
    expect(readTrustRegistry(root)).toEqual([]);
  });

  test('[covers:F-f4cfd533/AC-18fdca35] builds a verifying snapshot from a registered Ed25519 public key', () => {
    const root = workspace();
    const key = publicKey();
    registry(root, serializeTrustRegistry([{issuer: 'reviewer', issuer_key_id: key.issuerKeyId, spki_der: key.base64}]));
    const snapshot = loadTrustSnapshot(root);
    expect(snapshot.keys).toEqual([{issuer: 'reviewer', issuerKeyId: key.issuerKeyId, spkiDerBase64: key.base64}]);
    expect(snapshot.digest).not.toBe(emptyTrustSnapshot().digest);
    expect(readTrustRegistry(root)).toEqual([{issuer: 'reviewer', issuer_key_id: key.issuerKeyId, spki_der: key.base64}]);
  });

  test('[covers:F-f4cfd533/AC-18fdca35] refuses a registry it cannot fully understand instead of trusting part of it', () => {
    const key = publicKey();
    const good = serializeTrustRegistry([{issuer: 'reviewer', issuer_key_id: key.issuerKeyId, spki_der: key.base64}]);
    expect(parseTrustRegistry(good)).toHaveLength(1);
    expect(() => parseTrustRegistry(good.replace('schema: "1"', 'schema: "2"'))).toThrow(ReceiptFormatError);
    expect(() => parseTrustRegistry(`${good}extra: true\n`)).toThrow(/Unknown trust registry field/);
    const mismatched = workspace();
    registry(mismatched, good.replace(key.issuerKeyId, 'a'.repeat(64)));
    expect(() => loadTrustSnapshot(mismatched)).toThrow(/does not match its DER SPKI bytes/);
    const rsa = generateKeyPairSync('rsa', {modulusLength: 2048});
    const rsaDer = new Uint8Array(rsa.publicKey.export({format: 'der', type: 'spki'}));
    const rsaRegistry = serializeTrustRegistry([{
      issuer: 'reviewer', issuer_key_id: issuerKeyIdForSpki(rsaDer), spki_der: Buffer.from(rsaDer).toString('base64'),
    }]);
    const root = workspace();
    registry(root, rsaRegistry);
    expect(() => loadTrustSnapshot(root)).toThrow(/Ed25519/);
  });

  test('[covers:F-f4cfd533/AC-74458baa] appends one public entry and refuses a duplicate issuer or key', () => {
    const root = workspace();
    const first = publicKey();
    const addition = trustRegistryAddition(root, {issuer: 'reviewer', spkiDer: first.spkiDer});
    expect(addition.before).toBeNull();
    expect(addition.issuerKeyId).toBe(first.issuerKeyId);
    registry(root, addition.after);
    const second = publicKey();
    expect(() => trustRegistryAddition(root, {issuer: 'reviewer', spkiDer: second.spkiDer})).toThrow(/already registered/);
    expect(() => trustRegistryAddition(root, {issuer: 'other', spkiDer: first.spkiDer})).toThrow(/already registered/);
    const grown = trustRegistryAddition(root, {issuer: 'other', spkiDer: second.spkiDer});
    expect(parseTrustRegistry(grown.after)).toHaveLength(2);
    expect(grown.before).toBe(addition.after);
  });
});
