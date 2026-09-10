// Cladding · Spec 0.2 F8 · receipt observation fact tests.

import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {loadGraphIrV2Workspace} from '../../src/graph/query.js';
import {receiptFactAugmentation, type ReceiptFactTrust} from '../../src/graph/receipt-facts.js';
import {graphIrV2} from '../../src/spec/compiler/graph-ir-v2.js';
import {
  createTrustSnapshot,
  emptyTrustSnapshot,
  issuerKeyIdForSpki,
  receiptDigest,
  receiptFeatureId,
  receiptSigningPayload,
  serializePortableReceipt,
  type AuditReceipt,
  type PortableReceipt,
  type ReceiptCheck,
  type UatReceipt,
} from '../../src/proof/receipt.js';

const roots: string[] = [];

const FEATURE = 'F-aaaaaaaa';
const CRITERION = 'criterion:F-aaaaaaaa/AC-11111111';

/** One workspace whose sole feature owns the criterion every fixture receipt names. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-receipt-facts-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"',
    'project: {name: receipt-facts, language: typescript}',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', `alpha-${FEATURE.slice(2)}.yaml`), [
    `id: ${FEATURE}`,
    'slug: alpha',
    'title: Alpha',
    'status: planned',
    'acceptance_criteria:',
    '  - id: AC-11111111',
    '    text: The system shall retain AC-11111111 on the public graph wire.',
    '',
  ].join('\n'));
  return root;
}

interface SignedReceipt {
  readonly receipt: PortableReceipt;
  readonly trust: ReceiptFactTrust;
}

/** Mints one signed receipt plus the exact trust material that verifies it. */
function signedAuditReceipt(options: {
  readonly subject?: string;
  readonly independence?: ReceiptCheck;
} = {}): SignedReceipt {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const base = {
    receipt_schema: '1', issuer: 'fixture issuer', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA',
    subject: (options.subject ?? CRITERION) as AuditReceipt['subject'],
    subject_sha256: 'a'.repeat(64), observed_at: '2026-08-29T12:34:56.789Z',
    method: 'human_channel', claim: 'audit',
    reviewed_inputs_sha256: 'b'.repeat(64),
    runtime_dependency_sha256: 'c'.repeat(64),
    implementation_authors_sha256: 'd'.repeat(64),
    checks: {evidence_sufficiency: 'pass', code_test_review: 'pass', independence: options.independence ?? 'pass'},
  } as const satisfies AuditReceipt;
  const receipt: AuditReceipt = {
    ...base,
    issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url'),
  };
  return {
    receipt,
    trust: {
      trustSnapshot: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId: receipt.issuer_key_id, spkiDer}]),
      expectedDigests: () => ({
        subjectSha256: 'a'.repeat(64),
        reviewedInputsSha256: 'b'.repeat(64),
        runtimeDependencySha256: 'c'.repeat(64),
        implementationAuthorsSha256: 'd'.repeat(64),
      }),
    },
  };
}

/** Mints one feature-scoped UAT receipt, whose subject carries no `supports` grammar. */
function signedUatReceipt(): SignedReceipt {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const base = {
    receipt_schema: '1', issuer: 'fixture issuer', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA',
    subject: `feature:${FEATURE}`, subject_sha256: 'a'.repeat(64), observed_at: '2026-08-29T12:34:56.789Z',
    method: 'human_channel', claim: 'uat',
    reviewed_inputs_sha256: 'b'.repeat(64),
    runtime_dependency_sha256: 'c'.repeat(64),
    implementation_authors_sha256: 'd'.repeat(64),
    criterion_verdicts: {[CRITERION]: 'pass'},
    checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'},
  } as const satisfies UatReceipt;
  const receipt: UatReceipt = {
    ...base,
    issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url'),
  };
  return {receipt, trust: {trustSnapshot: emptyTrustSnapshot(), expectedDigests: () => undefined}};
}

/** Stores a receipt at the only content-derived address the census accepts. */
function storeReceipt(root: string, receipt: PortableReceipt): string {
  const path = `spec/evidence/${receiptFeatureId(receipt)}/${receiptDigest(receipt)}.yaml`;
  mkdirSync(join(root, 'spec', 'evidence', receiptFeatureId(receipt)), {recursive: true});
  writeFileSync(join(root, path), serializePortableReceipt(receipt));
  return path;
}

function compilationOf(root: string) {
  return loadGraphIrV2Workspace(root).compilation;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('GraphIR receipt observation facts', () => {
  test('[covers:F-208eaa79/AC-4f8c2542] reports a workspace with no evidence root as a proved-empty layer', () => {
    const root = fixture();
    const workspace = loadGraphIrV2Workspace(root);

    const layer = receiptFactAugmentation(root, workspace.compilation);

    expect(layer.layerId).toBe('receipt-observations');
    expect(layer.completeness).toBe('complete');
    expect(layer.nodes).toEqual([]);
    expect(layer.edges).toEqual([]);
    expect(layer.unknownReasons).toEqual([]);
    // The known negative stays visible to a reader, but an empty layer never
    // costs the workspace its memoized bare kernel.
    expect(workspace.layers).toContainEqual({id: 'receipt-observations', completeness: 'complete', reasons: []});
    expect(graphIrV2(workspace.compilation)).toBe(workspace.kernel);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] addresses a stored receipt as one evidence artifact supporting its criterion', () => {
    const root = fixture();
    const {receipt} = signedAuditReceipt();
    const path = storeReceipt(root, receipt);

    const layer = receiptFactAugmentation(root, compilationOf(root));

    expect(layer.completeness).toBe('complete');
    expect(layer.unknownReasons).toEqual([]);
    expect(layer.nodes).toEqual([{
      address: `artifact:${path}`,
      nodeType: 'artifact',
      roles: ['evidence'],
      owners: [`feature:${FEATURE}`],
      provenance: 'observed',
      locator: {kind: 'runtime_observation', adapter: 'receipt-facts@1', reference: receiptDigest(receipt)},
    }]);
    expect(layer.edges).toEqual([{
      identity: `receipt-facts@1:${CRITERION}->artifact:${path}:${receiptDigest(receipt)}`,
      from: CRITERION,
      to: `artifact:${path}`,
      relation: 'supports',
      provenance: 'observed',
      owner: {kind: 'runtime_observation', adapter: 'receipt-facts@1', reference: receiptDigest(receipt)},
      state: 'unknown',
      channel: 'evidence',
      normalizedTarget: `artifact:${path}`,
    }]);
    expect(Object.isFrozen(layer)).toBe(true);
    expect(Object.isFrozen(layer.nodes)).toBe(true);
    expect(Object.isFrozen(layer.edges)).toBe(true);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] carries the receipt address and digest without any receipt body', () => {
    const root = fixture();
    const {receipt} = signedAuditReceipt();
    storeReceipt(root, receipt);

    const serialized = JSON.stringify(receiptFactAugmentation(root, compilationOf(root)));

    expect(serialized).toContain(receiptDigest(receipt));
    for (const secret of [receipt.issuer, receipt.issuer_proof, receipt.subject_sha256, 'evidence_sufficiency']) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('[covers:F-208eaa79/AC-4f8c2542] reduces a verified receipt to passed and a verified failing receipt to failed', () => {
    const passing = fixture();
    const passingReceipt = signedAuditReceipt();
    storeReceipt(passing, passingReceipt.receipt);
    const failing = fixture();
    const failingReceipt = signedAuditReceipt({independence: 'fail'});
    storeReceipt(failing, failingReceipt.receipt);

    const passed = receiptFactAugmentation(passing, compilationOf(passing), passingReceipt.trust);
    const failed = receiptFactAugmentation(failing, compilationOf(failing), failingReceipt.trust);

    expect(passed.edges.map((edge) => edge.state)).toEqual(['passed']);
    expect(failed.edges.map((edge) => edge.state)).toEqual(['failed']);
    expect(passed.completeness).toBe('complete');
    expect(failed.completeness).toBe('complete');
  });

  test('[covers:F-208eaa79/AC-d452908b] leaves an unverifiable receipt unknown rather than asserting a pass', () => {
    const root = fixture();
    const {receipt, trust} = signedAuditReceipt();
    storeReceipt(root, receipt);
    const untrusted: ReceiptFactTrust = {trustSnapshot: emptyTrustSnapshot(), expectedDigests: trust.expectedDigests};
    const uncontexted: ReceiptFactTrust = {trustSnapshot: trust.trustSnapshot, expectedDigests: () => undefined};

    const compilation = compilationOf(root);

    expect(receiptFactAugmentation(root, compilation).edges.map((edge) => edge.state)).toEqual(['unknown']);
    expect(receiptFactAugmentation(root, compilation, untrusted).edges.map((edge) => edge.state)).toEqual(['unknown']);
    expect(receiptFactAugmentation(root, compilation, uncontexted).edges.map((edge) => edge.state)).toEqual(['unknown']);
  });

  test('[covers:F-208eaa79/AC-d452908b] names an absent subject as a known negative and emits no edge', () => {
    const root = fixture();
    const {receipt} = signedAuditReceipt({subject: 'criterion:F-zzzzzzzz/AC-99999999'});
    const path = storeReceipt(root, receipt);

    const layer = receiptFactAugmentation(root, compilationOf(root));

    expect(layer.completeness).toBe('unknown');
    expect(layer.edges).toEqual([]);
    expect(layer.nodes.map((node) => node.address)).toEqual([`artifact:${path}`]);
    expect(layer.nodes.every((node) => node.nodeType === 'artifact' && node.owners.length === 0)).toBe(true);
    expect(layer.unknownReasons).toEqual([`receipt ${path} names unknown subject criterion:F-zzzzzzzz/AC-99999999`]);
  });

  test('[covers:F-208eaa79/AC-d452908b] keeps a feature-scoped receipt addressed without widening the supports grammar', () => {
    const root = fixture();
    const {receipt} = signedUatReceipt();
    const path = storeReceipt(root, receipt);

    const layer = receiptFactAugmentation(root, compilationOf(root));

    expect(layer.completeness).toBe('unknown');
    expect(layer.edges).toEqual([]);
    expect(layer.nodes.map((node) => node.address)).toEqual([`artifact:${path}`]);
    expect(layer.unknownReasons).toEqual([
      `receipt ${path} names feature subject feature:${FEATURE} that carries no criterion-scoped supports fact`,
    ]);
  });

  test('[covers:F-208eaa79/AC-d452908b] refuses to describe an unparseable or symlinked evidence root', () => {
    const unparseable = fixture();
    mkdirSync(join(unparseable, 'spec', 'evidence', FEATURE), {recursive: true});
    writeFileSync(join(unparseable, 'spec', 'evidence', FEATURE, `${'e'.repeat(64)}.yaml`), 'not: [a portable receipt\n');
    const symlinked = fixture();
    mkdirSync(join(symlinked, 'elsewhere'), {recursive: true});
    symlinkSync(join(symlinked, 'elsewhere'), join(symlinked, 'spec', 'evidence'));

    for (const root of [unparseable, symlinked]) {
      const layer = receiptFactAugmentation(root, compilationOf(root));
      expect(layer.completeness).toBe('unknown');
      expect(layer.nodes).toEqual([]);
      expect(layer.edges).toEqual([]);
      expect(layer.unknownReasons).toEqual(['receipt census is unsafe']);
    }
  });

  test('[covers:F-208eaa79/AC-4f8c2542] builds byte-identical facts on repeated reads of one workspace', () => {
    const root = fixture();
    storeReceipt(root, signedAuditReceipt().receipt);
    storeReceipt(root, signedAuditReceipt({independence: 'fail'}).receipt);
    storeReceipt(root, signedUatReceipt().receipt);
    const compilation = compilationOf(root);

    const first = receiptFactAugmentation(root, compilation);
    const second = receiptFactAugmentation(root, compilation);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.nodes.map((node) => node.address))
      .toEqual([...first.nodes.map((node) => node.address)].sort());
    expect(first.nodes).toHaveLength(3);
    expect(first.edges).toHaveLength(2);
  });
});
