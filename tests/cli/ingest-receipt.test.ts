// Cladding · CLI receipt-ingest tests.

import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {runIngestReceiptCommand} from '../../src/cli/ingest-receipt.js';
import {issuerKeyIdForSpki, receiptSigningPayload, serializePortableReceipt, type BlindReceipt} from '../../src/proof/receipt.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f5-cli-receipt-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: cli\n  language: typescript\n  purpose: Keep CLI receipt ingress equivalent.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'cli-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: CLI\nstatus: in_progress\npurpose: Keep CLI receipt ingress equivalent.\nmodules: []\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall share receipt ingress semantics.\n');
  return root;
}

function receiptFile(root: string): string {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const unsigned: BlindReceipt = {receipt_schema: '1', issuer: 'fixture', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA', subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'a'.repeat(64), observed_at: '2026-08-29T12:34:56.789Z', method: 'blind_capability', claim: 'independent_oracle', verdict: 'pass', evidence: {locator: 'tests/cli/ingest-receipt.test.ts', sha256: 'b'.repeat(64)}, capability_manifest_sha256: 'c'.repeat(64)};
  const path = join(root, 'portable-receipt.yaml');
  writeFileSync(path, serializePortableReceipt({...unsigned, issuer_proof: sign(null, receiptSigningPayload(unsigned), pair.privateKey).toString('base64url')}));
  return path;
}

afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true}); });

describe('CLI receipt ingress parity', () => {
  test('uses the same kernel with an empty local trust snapshot', () => {
    const root = workspace();
    expect(runIngestReceiptCommand(receiptFile(root), {cwd: root})).toMatchObject({ok: true, verification: {assurance: 'asserted', currentness: 'unresolved', reason: 'unknown_issuer_key'}});
  });
});
