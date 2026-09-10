// Cladding · MCP proof-evidence tests.

import {generateKeyPairSync, sign} from 'node:crypto';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {afterEach, describe, expect, test} from 'vitest';

import {createIssuerKey} from '../../src/proof/issuer.js';
import {createTrustSnapshot, emptyTrustSnapshot, issuerKeyIdForSpki, receiptSigningPayload, serializePortableReceipt, type BlindReceipt} from '../../src/proof/receipt.js';
import {TRUST_REGISTRY_PATH, evidenceOperations, loadTrustSnapshot, trustRegistryAddition} from '../../src/proof/trust.js';
import {buildServer, type EvidenceOperations} from '../../src/serve/server.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f5-mcp-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: mcp\n  language: typescript\n  purpose: Keep evidence transport bounded.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'mcp-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: MCP\nstatus: in_progress\npurpose: Keep evidence transport bounded.\nmodules: []\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall keep receipt transport bounded.\n');
  return root;
}

function signedReceipt(): {receipt: BlindReceipt; trust: ReturnType<typeof createTrustSnapshot>} {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
  const base: BlindReceipt = {
    receipt_schema: '1', issuer: 'fixture issuer', issuer_key_id: issuerKeyIdForSpki(spkiDer), issuer_proof: 'AA', subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'a'.repeat(64), observed_at: '2026-08-29T12:34:56.789Z',
    method: 'blind_capability', claim: 'independent_oracle', verdict: 'pass', evidence: {locator: 'tests/serve/proof-evidence.test.ts', sha256: 'b'.repeat(64)}, capability_manifest_sha256: 'c'.repeat(64),
  };
  const receipt = {...base, issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url')};
  return {receipt, trust: createTrustSnapshot([{issuer: receipt.issuer, issuerKeyId: receipt.issuer_key_id, spkiDer}])};
}

async function connectedServer(cwd: string, evidence?: EvidenceOperations): Promise<{client: Client; close: () => Promise<void>}> {
  const server = buildServer({cwd, evidence});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'f5-test', version: '0.0.0'});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {client, close: async () => { await client.close(); await server.close(); }};
}

/** Connects a client that answers the elicitation form the way a host would. */
async function elicitingClient(
  cwd: string,
  answer: (() => {action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string>}) | undefined,
  evidence?: EvidenceOperations,
): Promise<{client: Client; close: () => Promise<void>}> {
  const server = buildServer({cwd, evidence});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    {name: 'f9d-test', version: '0.0.0'},
    answer === undefined ? undefined : {capabilities: {elicitation: {}}},
  );
  if (answer !== undefined) client.setRequestHandler(ElicitRequestSchema, async () => answer());
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {client, close: async () => { await client.close(); await server.close(); }};
}

/** A schema 0.2 workspace with one registered issuer and one real module root. */
function signableWorkspace(): {root: string; issuer: string; restoreKeys: () => void} {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-mcp-'));
  temporary.push(root);
  const store = mkdtempSync(join(tmpdir(), 'clad-f9d-mcp-keys-'));
  temporary.push(store);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: mcp\n  language: typescript\n  purpose: Keep evidence transport bounded.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'mcp-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: MCP\nstatus: in_progress\npurpose: Keep evidence transport bounded.\nmodules:\n  - src/alpha.ts\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall keep receipt transport bounded.\n');
  const previous = process.env.CLADDING_KEYS_DIR;
  process.env.CLADDING_KEYS_DIR = join(store, 'keys');
  const created = createIssuerKey();
  mkdirSync(join(root, 'spec', 'trust'), {recursive: true});
  writeFileSync(join(root, TRUST_REGISTRY_PATH), trustRegistryAddition(root, {issuer: 'independent reviewer', spkiDer: created.spkiDer}).after);
  return {
    root,
    issuer: 'independent reviewer',
    restoreKeys: () => {
      if (previous === undefined) delete process.env.CLADDING_KEYS_DIR;
      else process.env.CLADDING_KEYS_DIR = previous;
    },
  };
}

function payload(result: unknown): Record<string, unknown> {
  return JSON.parse(((result as {content: Array<{text: string}>}).content[0]!).text) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('MCP F5 evidence operations', () => {
  test('MCP04/MCP09 inject trust outside the tool, preserve text parity, and replay an exact receipt', async () => {
    const root = workspace();
    const {receipt, trust} = signedReceipt();
    const expected = {subjectSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64), capabilityManifestSha256: 'c'.repeat(64)};
    const {client, close} = await connectedServer(root, {trustSnapshot: trust, expectedDigestContext: () => expected});
    try {
      const {tools} = await client.listTools();
      for (const name of ['clad_ingest_receipt', 'clad_signoff']) {
        const tool = tools.find((entry) => entry.name === name);
        expect(tool?.annotations).toMatchObject({readOnlyHint: false, destructiveHint: false});
        expect((tool?.inputSchema as {additionalProperties?: boolean} | undefined)?.additionalProperties).toBe(false);
      }
      const first = await client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: serializePortableReceipt(receipt)}});
      expect(payload(first)).toMatchObject({ok: true, verification: {assurance: 'verified', currentness: 'current'}});
      expect((first as {structuredContent: unknown}).structuredContent).toEqual(payload(first));
      const replay = await client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: serializePortableReceipt(receipt)}});
      expect(payload(replay)).toMatchObject({ok: true, changed: false, idempotent: true});
      const signoff = await client.callTool({name: 'clad_signoff', arguments: {feature: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass'}});
      expect(payload(signoff)).toMatchObject({ok: false, code: 'HUMAN_REQUIRED', evidence: {assurance: 'asserted'}});
    } finally {
      await close();
    }
  });

  test('rejects malformed and oversized receipt ingress before writing evidence', async () => {
    const root = workspace();
    const {client, close} = await connectedServer(root);
    try {
      const malformed = await client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: 'invalid: receipt'}});
      expect(payload(malformed)).toMatchObject({ok: false, code: 'INVALID_RECEIPT'});
      const oversized = await client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: 'x'.repeat(16 * 1024)}});
      expect(payload(oversized)).toMatchObject({ok: false, code: 'INVALID_OPERATION'});
      expect(existsSync(join(root, 'spec', 'evidence'))).toBe(false);
    } finally {
      await close();
    }
  });

  test('stores unknown trust as asserted but never writes a known bad signature', async () => {
    const unknownTrustRoot = workspace();
    const {receipt, trust} = signedReceipt();
    const expected = {subjectSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64), capabilityManifestSha256: 'c'.repeat(64)};
    const unknown = await connectedServer(unknownTrustRoot);
    try {
      const result = await unknown.client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: serializePortableReceipt(receipt)}});
      expect(payload(result)).toMatchObject({ok: true, verification: {assurance: 'asserted', currentness: 'unresolved', reason: 'unknown_issuer_key'}});
      expect(existsSync(join(unknownTrustRoot, 'spec', 'evidence', 'F-aaaaaaaa'))).toBe(true);
    } finally {
      await unknown.close();
    }

    const knownTrustRoot = workspace();
    const known = await connectedServer(knownTrustRoot, {trustSnapshot: trust, expectedDigestContext: () => expected});
    const firstCharacter = receipt.issuer_proof.startsWith('A') ? 'B' : 'A';
    const badSignature = {...receipt, issuer_proof: `${firstCharacter}${receipt.issuer_proof.slice(1)}`};
    try {
      const result = await known.client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: serializePortableReceipt(badSignature)}});
      expect(payload(result)).toMatchObject({ok: false, code: 'INVALID_SIGNATURE'});
      expect(existsSync(join(knownTrustRoot, 'spec', 'evidence'))).toBe(false);
    } finally {
      await known.close();
    }
  });
});

describe('MCP F9d verified signoff', () => {
  test('[covers:F-f4cfd533/AC-1d5f62de] signs and ingests a receipt when a host elicitation form returns the exact feature id', async () => {
    const fixture = signableWorkspace();
    const {client, close} = await elicitingClient(
      fixture.root,
      () => ({action: 'accept', content: {feature_id: 'F-aaaaaaaa'}}),
      evidenceOperations(fixture.root),
    );
    try {
      const result = payload(await client.callTool({
        name: 'clad_signoff',
        arguments: {feature: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass', verified: true, issuer: fixture.issuer},
      }));
      expect(result).toMatchObject({ok: true, code: 'OK', verification: {assurance: 'verified', currentness: 'current'}});
      expect(result.path).toMatch(/^spec\/evidence\/F-aaaaaaaa\/[a-f0-9]{64}\.yaml$/);
      expect(readdirSync(join(fixture.root, 'spec', 'evidence', 'F-aaaaaaaa'))).toHaveLength(1);
    } finally {
      await close();
      fixture.restoreKeys();
    }
  });

  test('[covers:F-f4cfd533/AC-17ec9e88] returns HUMAN_REQUIRED when the form is declined, answered wrongly, or unsupported', async () => {
    for (const answer of [
      () => ({action: 'decline' as const}),
      () => ({action: 'cancel' as const}),
      () => ({action: 'accept' as const, content: {feature_id: 'F-99999999'}}),
      undefined,
    ]) {
      const fixture = signableWorkspace();
      const {client, close} = await elicitingClient(fixture.root, answer, evidenceOperations(fixture.root));
      try {
        const result = payload(await client.callTool({
          name: 'clad_signoff',
          arguments: {feature: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass', verified: true, issuer: fixture.issuer},
        }));
        expect(result).toMatchObject({ok: false, code: 'HUMAN_REQUIRED', evidence: {assurance: 'asserted'}});
        expect(existsSync(join(fixture.root, 'spec', 'evidence'))).toBe(false);
      } finally {
        await close();
        fixture.restoreKeys();
      }
    }
  });

  test('[covers:F-f4cfd533/AC-18fdca35] verifies ingested receipts against the workspace trust registry snapshot', async () => {
    const fixture = signableWorkspace();
    const signer = await elicitingClient(
      fixture.root,
      () => ({action: 'accept', content: {feature_id: 'F-aaaaaaaa'}}),
      evidenceOperations(fixture.root),
    );
    let receiptYaml: string;
    try {
      const signed = payload(await signer.client.callTool({
        name: 'clad_signoff',
        arguments: {feature: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass', verified: true, issuer: fixture.issuer},
      }));
      receiptYaml = readFileSync(join(fixture.root, signed.path as string), 'utf8');
      const digest = (signed.verification as {trustSnapshotDigest: string}).trustSnapshotDigest;
      expect(digest).toBe(loadTrustSnapshot(fixture.root).digest);
      expect(digest).not.toBe(emptyTrustSnapshot().digest);
    } finally {
      await signer.close();
      fixture.restoreKeys();
    }

    // The identical bytes ingested into an identical workspace WITHOUT the
    // registry stay asserted: the signature and every closure digest are the
    // same, and only the trust snapshot changed.
    const twin = signableWorkspace();
    twin.restoreKeys();
    rmSync(join(twin.root, TRUST_REGISTRY_PATH), {force: true});
    const untrusted = twin.root;
    const plain = await connectedServer(untrusted, evidenceOperations(untrusted));
    try {
      const result = payload(await plain.client.callTool({name: 'clad_ingest_receipt', arguments: {receipt_yaml: receiptYaml}}));
      expect(result).toMatchObject({
        ok: true,
        verification: {assurance: 'asserted', reason: 'unknown_issuer_key', trustSnapshotDigest: emptyTrustSnapshot().digest},
      });
    } finally {
      await plain.close();
    }
  });
});
