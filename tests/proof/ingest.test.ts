// Cladding · proof ingest tests.

import {generateKeyPairSync, sign} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {ingestPortableReceipt} from '../../src/proof/ingest.js';
import {editSpec, readSpecEditRevisions} from '../../src/spec/edit.js';
import {createTrustSnapshot, issuerKeyIdForSpki, receiptDigest, receiptSigningPayload, serializePortableReceipt, type BlindReceipt, type UatReceipt} from '../../src/proof/receipt.js';

const temporary: string[] = [];

function workspace(): string {
  const root = join(tmpdir(), `clad-f5-ingest-${Math.random().toString(36).slice(2)}`);
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: receipt-fixture', '  language: typescript', '  purpose: Keep receipt evidence portable.', '  assurance_level: L2', '  scenario_policy: advisory', 'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'receipt-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: Receipt', 'status: in_progress', 'purpose: Keep receipt storage create-only.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall store portable evidence.',
    '  - id: AC-cccccccc', '    kind: behavior', '    statement: The system shall retain portable evidence.', '',
  ].join('\n'));
  return root;
}

function signedUatReceipt(matrix: UatReceipt['criterion_verdicts']): {receipt: UatReceipt; trust: ReturnType<typeof createTrustSnapshot>} {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const base: UatReceipt = {
    receipt_schema: '1', issuer: 'fixture issuer', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA',
    subject: 'feature:F-aaaaaaaa', subject_sha256: 'a'.repeat(64), observed_at: '2026-08-29T12:34:56.789Z',
    method: 'human_channel', claim: 'uat', reviewed_inputs_sha256: 'b'.repeat(64), runtime_dependency_sha256: 'c'.repeat(64), implementation_authors_sha256: 'd'.repeat(64),
    criterion_verdicts: matrix, checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'},
  };
  const receipt = {...base, issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url')};
  return {receipt, trust: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId: receipt.issuer_key_id, spkiDer}])};
}

function signedReceipt(observedAt = '2026-08-29T12:34:56.789Z'): {receipt: BlindReceipt; trust: ReturnType<typeof createTrustSnapshot>} {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const base: BlindReceipt = {
    receipt_schema: '1', issuer: 'fixture issuer', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA',
    subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'a'.repeat(64), observed_at: observedAt,
    method: 'blind_capability', claim: 'independent_oracle', verdict: 'pass', evidence: {locator: 'tests/proof/example.test.ts', sha256: 'b'.repeat(64)}, capability_manifest_sha256: 'c'.repeat(64),
  };
  const receipt = {...base, issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url')};
  return {receipt, trust: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId: receipt.issuer_key_id, spkiDer}])};
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('portable receipt ingestion', () => {
  test('stores unknown trust as asserted, then keeps the exact content address idempotent', () => {
    const root = workspace();
    const {receipt} = signedReceipt();
    const first = ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(receipt)});
    expect(first).toMatchObject({ok: true, changed: true, verification: {assurance: 'asserted', currentness: 'unresolved', reason: 'unknown_issuer_key'}});
    expect(first.path).toMatch(/^spec\/evidence\/F-aaaaaaaa\/[a-f0-9]{64}\.yaml$/);
    const before = readFileSync(join(root, first.path!), 'utf8');
    const replay = ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(receipt)});
    expect(replay).toMatchObject({ok: true, changed: false, idempotent: true});
    expect(readFileSync(join(root, first.path!), 'utf8')).toBe(before);
  });

  test('does not write malformed, known-bad, mismatched, or caller-selected receipt paths', () => {
    const root = workspace();
    const {receipt, trust} = signedReceipt();
    const evidenceRoot = join(root, 'spec', 'evidence');
    const expected = {subjectSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64), capabilityManifestSha256: 'c'.repeat(64)};
    expect(ingestPortableReceipt({cwd: root, receiptYaml: 'not: a receipt'}).ok).toBe(false);
    const alteredSignature = Buffer.from(receipt.issuer_proof, 'base64url');
    alteredSignature[0] ^= 1;
    expect(ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt({...receipt, issuer_proof: alteredSignature.toString('base64url')}), trustSnapshot: trust, expected}).code).toBe('INVALID_SIGNATURE');
    expect(ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(receipt), trustSnapshot: trust, expected: {...expected, subjectSha256: 'd'.repeat(64)}}).code).toBe('EXPECTED_DIGEST_MISMATCH');
    expect(ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(receipt), declaredPath: 'spec/evidence/F-other/dead.yaml'}).code).toBe('INVALID_PATH');
    expect(existsSync(evidenceRoot)).toBe(false);
  });

  test('accepts a fixture-trusted receipt only with complete injected expected context', () => {
    const root = workspace();
    const {receipt, trust} = signedReceipt();
    const result = ingestPortableReceipt({
      cwd: root, receiptYaml: serializePortableReceipt(receipt), trustSnapshot: trust,
      expected: {subjectSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64), capabilityManifestSha256: 'c'.repeat(64)},
    });
    expect(result).toMatchObject({ok: true, verification: {assurance: 'verified', currentness: 'current'}});
  });

  test('rejects foreign or unknown UAT matrix rows but stores a missing current row as unobserved', () => {
    const expected = {subjectSha256: 'a'.repeat(64), reviewedInputsSha256: 'b'.repeat(64), runtimeDependencySha256: 'c'.repeat(64), implementationAuthorsSha256: 'd'.repeat(64)};
    const foreign = signedUatReceipt({'criterion:F-other/AC-bbbbbbbb': 'pass'});
    expect(ingestPortableReceipt({cwd: workspace(), receiptYaml: serializePortableReceipt(foreign.receipt), trustSnapshot: foreign.trust, expected})).toMatchObject({ok: false, code: 'INVALID_RECEIPT'});
    const unknown = signedUatReceipt({'criterion:F-aaaaaaaa/AC-deadbeef': 'pass'});
    expect(ingestPortableReceipt({cwd: workspace(), receiptYaml: serializePortableReceipt(unknown.receipt), trustSnapshot: unknown.trust, expected})).toMatchObject({ok: false, code: 'INVALID_RECEIPT'});
    const missing = signedUatReceipt({'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'pass'});
    expect(ingestPortableReceipt({cwd: workspace(), receiptYaml: serializePortableReceipt(missing.receipt), trustSnapshot: missing.trust, expected})).toMatchObject({ok: true, verification: {assurance: 'verified'}});
  });

  test('preserves distinct receipt addresses, rejects occupied create-only bytes, and recovers an interrupted journal', () => {
    const root = workspace();
    const first = signedReceipt('2026-08-29T12:34:56.789Z').receipt;
    const second = signedReceipt('2026-08-29T12:34:56.790Z').receipt;
    const results = [first, second].map((receipt) => ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(receipt)}));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(readdirSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa'))).toHaveLength(2);

    const occupied = signedReceipt('2026-08-29T12:34:56.791Z').receipt;
    const occupiedPath = join(root, 'spec', 'evidence', 'F-aaaaaaaa', `${receiptDigest(occupied)}.yaml`);
    writeFileSync(occupiedPath, 'not the signed receipt\n');
    expect(ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(occupied)})).toMatchObject({ok: false, code: 'CREATE_ONLY_CONFLICT'});

    const interrupted = signedReceipt('2026-08-29T12:34:56.792Z').receipt;
    expect(ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(interrupted), faultAfterReplacementForTesting: 1}).ok).toBe(false);
    const recovered = ingestPortableReceipt({cwd: root, receiptYaml: serializePortableReceipt(interrupted)});
    expect(recovered).toMatchObject({ok: true, changed: true});
    expect(readFileSync(join(root, recovered.path!), 'utf8')).toBe(serializePortableReceipt(interrupted));

    const revoke = [{kind: 'evidence.revoke' as const, featureId: 'F-aaaaaaaa', digest: recovered.digest!}];
    expect(editSpec({cwd: root, operations: revoke, inputRevisions: readSpecEditRevisions(root, revoke)}).changed).toBe(true);
    expect(existsSync(join(root, recovered.path!))).toBe(false);
    expect(existsSync(join(root, results[0].path!))).toBe(true);
  });
});
