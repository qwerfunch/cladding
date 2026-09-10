// Cladding · Spec 0.2 F-18a5883a · the ingest verb verifies against the committed registry.
//
// Every key here is generated at test time into a throwaway store, so the
// developer's own `~/.cladding/keys` is never read, written, or trusted.

import {generateKeyPairSync} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runIngestReceiptCommand} from '../../src/cli/ingest-receipt.js';
import {runKeyCreateCommand} from '../../src/cli/key.js';
import {loadIssuerPrivateKey, signPortableReceipt} from '../../src/proof/issuer.js';
import {issuerKeyIdForSpki, serializePortableReceipt, type UatReceipt} from '../../src/proof/receipt.js';
import {evidenceOperations} from '../../src/proof/trust.js';

const FEATURE = 'F-18a5e001';
const CRITERION = 'AC-18a5e002';
const temporary: string[] = [];
let previousKeysDir: string | undefined;

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-ingest-trust-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: ingest-trust', '  language: typescript',
    '  purpose: Verify ingested receipts against the committed registry.', '  assurance_level: L2', '  scenario_policy: advisory',
    'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'ingest-18a5e001.yaml'), [
    `id: ${FEATURE}`, 'title: Ingest', 'status: in_progress', 'purpose: Keep ingested evidence verifiable.',
    'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    `  - id: ${CRITERION}`, '    kind: behavior', '    statement: The system shall verify ingested evidence.', '',
  ].join('\n'));
  return root;
}

/**
 * Builds a UAT receipt whose digests are the workspace's own expected context.
 *
 * The digests cannot be invented: an expected-context mismatch is refused
 * before the signature is even looked at, so the only receipt that can reach
 * the trust decision is one the workspace itself would expect.
 */
function receiptFor(root: string, issuer: string, issuerKeyId: string): Omit<UatReceipt, 'issuer_proof'> {
  const draft: UatReceipt = {
    receipt_schema: '1', issuer, issuer_key_id: issuerKeyId, issuer_proof: 'AA',
    subject: `feature:${FEATURE}`, subject_sha256: 'a'.repeat(64), observed_at: '2026-09-09T00:00:00.000Z',
    method: 'human_channel', claim: 'uat',
    reviewed_inputs_sha256: 'b'.repeat(64), runtime_dependency_sha256: 'c'.repeat(64), implementation_authors_sha256: 'd'.repeat(64),
    criterion_verdicts: {[`criterion:${FEATURE}/${CRITERION}`]: 'pass'},
    checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'},
  };
  const expected = evidenceOperations(root).expectedDigestContext(draft);
  expect(expected?.subjectSha256).toEqual(expect.any(String));
  const signed: UatReceipt = {
    ...draft,
    subject_sha256: expected!.subjectSha256!,
    reviewed_inputs_sha256: expected!.reviewedInputsSha256!,
    runtime_dependency_sha256: expected!.runtimeDependencySha256!,
    implementation_authors_sha256: expected!.implementationAuthorsSha256!,
  };
  const unsigned: Record<string, unknown> = {...signed};
  delete unsigned.issuer_proof;
  return unsigned as Omit<UatReceipt, 'issuer_proof'>;
}

function write(root: string, receipt: UatReceipt, name = 'receipt.yaml'): string {
  const path = join(root, name);
  writeFileSync(path, serializePortableReceipt(receipt));
  return path;
}

beforeEach(() => {
  previousKeysDir = process.env.CLADDING_KEYS_DIR;
  const store = mkdtempSync(join(tmpdir(), 'clad-ingest-trust-keys-'));
  temporary.push(store);
  process.env.CLADDING_KEYS_DIR = join(store, 'keys');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  if (previousKeysDir === undefined) delete process.env.CLADDING_KEYS_DIR;
  else process.env.CLADDING_KEYS_DIR = previousKeysDir;
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('command-line receipt ingress', () => {
  test('[covers:F-18a5883a/AC-aa4eb80f] verifies a registered issuer offline and stays idempotent on a replay', () => {
    const root = workspace();
    const registered = runKeyCreateCommand('reviewer', {cwd: root});
    const receipt = signPortableReceipt<UatReceipt>(
      receiptFor(root, 'reviewer', registered.issuerKeyId!),
      loadIssuerPrivateKey(registered.issuerKeyId!),
    );
    const path = write(root, receipt);
    const first = runIngestReceiptCommand(path, {cwd: root});
    expect(first).toMatchObject({ok: true, changed: true, verification: {assurance: 'verified', currentness: 'current', reason: 'verified'}});
    const stored = readFileSync(join(root, first.path!), 'utf8');
    const replay = runIngestReceiptCommand(path, {cwd: root});
    expect(replay).toMatchObject({ok: true, changed: false, idempotent: true});
    expect(readFileSync(join(root, first.path!), 'utf8')).toBe(stored);
    expect(process.exitCode).toBeUndefined();
  });

  test('[covers:F-18a5883a/AC-aa4eb80f] refuses a tampered receipt from a registered issuer and writes nothing', () => {
    const root = workspace();
    const registered = runKeyCreateCommand('reviewer', {cwd: root});
    const receipt = signPortableReceipt<UatReceipt>(
      receiptFor(root, 'reviewer', registered.issuerKeyId!),
      loadIssuerPrivateKey(registered.issuerKeyId!),
    );
    // The observed moment is signed but never digest-compared, so altering it
    // can only be caught by the signature check the registry makes possible.
    const tampered = {...receipt, observed_at: '2026-09-09T01:00:00.000Z'};
    const result = runIngestReceiptCommand(write(root, tampered, 'tampered.yaml'), {cwd: root});
    expect(result).toMatchObject({ok: false, code: 'INVALID_SIGNATURE', changed: false});
    expect(result.path).toBeUndefined();
    expect(existsSync(join(root, 'spec', 'evidence'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test('[covers:F-18a5883a/AC-aa4eb80f] stores an unregistered signer as asserted evidence, never as verified', () => {
    const root = workspace();
    const pair = generateKeyPairSync('ed25519');
    const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
    const receipt = signPortableReceipt<UatReceipt>(
      receiptFor(root, 'stranger', issuerKeyIdForSpki(spkiDer)),
      pair.privateKey,
    );
    const result = runIngestReceiptCommand(write(root, receipt, 'stranger.yaml'), {cwd: root});
    expect(result).toMatchObject({ok: true, changed: true, verification: {assurance: 'asserted', reason: 'unknown_issuer_key'}});
  });
});
