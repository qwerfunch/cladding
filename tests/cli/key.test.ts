// Cladding · Spec 0.2 F9d · issuer registration CLI tests.

import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runKeyCreateCommand, runKeyListCommand} from '../../src/cli/key.js';
import {issuerKeyStoreDirectory} from '../../src/proof/issuer.js';
import {TRUST_REGISTRY_PATH, loadTrustSnapshot, parseTrustRegistry} from '../../src/proof/trust.js';
import {emptyTrustSnapshot} from '../../src/proof/receipt.js';

const temporary: string[] = [];
let previousKeysDir: string | undefined;

function workspace(schema: '0.1' | '0.2' = '0.2'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-key-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  if (schema === '0.1') {
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject: {name: keys, language: typescript}\nfeatures: []\nscenarios: []\n');
    return root;
  }
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: keys\n  language: typescript\n  purpose: Register one signing issuer.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  return root;
}

beforeEach(() => {
  previousKeysDir = process.env.CLADDING_KEYS_DIR;
  const store = mkdtempSync(join(tmpdir(), 'clad-f9d-keystore-'));
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

describe('clad key', () => {
  test('[covers:F-f4cfd533/AC-74458baa] writes an owner-only private key outside the workspace and registers the public half', () => {
    const root = workspace();
    const result = runKeyCreateCommand('reviewer', {cwd: root, json: true});
    expect(result).toMatchObject({ok: true, code: 'OK', issuer: 'reviewer', registryPath: TRUST_REGISTRY_PATH});
    expect(result.privateKeyPath!.startsWith(root)).toBe(false);
    expect(result.privateKeyPath).toBe(join(issuerKeyStoreDirectory(), `${result.issuerKeyId}.ed25519`));
    expect(lstatSync(result.privateKeyPath!).mode & 0o777).toBe(0o600);
    const registry = readFileSync(join(root, TRUST_REGISTRY_PATH), 'utf8');
    expect(parseTrustRegistry(registry)).toEqual([expect.objectContaining({issuer: 'reviewer', issuerKeyId: result.issuerKeyId})]);
    // The registry never carries private material.
    expect(registry).not.toContain('PRIVATE');
    expect(registry).not.toContain(readFileSync(result.privateKeyPath!).toString('base64'));
    const snapshot = loadTrustSnapshot(root);
    expect(snapshot.keys.map((key) => key.issuer)).toEqual(['reviewer']);
    expect(snapshot.digest).not.toBe(emptyTrustSnapshot().digest);
    // The write went through the spec transaction, which leaves no journal behind.
    expect(existsSync(join(root, '.cladding', 'transaction.json'))).toBe(false);
  });

  test('[covers:F-f4cfd533/AC-74458baa] refuses a second registration for the same issuer and needs a schema 0.2 workspace', () => {
    const root = workspace();
    expect(runKeyCreateCommand('reviewer', {cwd: root, json: true}).ok).toBe(true);
    const repeat = runKeyCreateCommand('reviewer', {cwd: root, json: true});
    expect(repeat).toMatchObject({ok: false, code: 'INVALID_OPERATION'});
    expect(repeat.message).toContain('no rotation path');
    expect(parseTrustRegistry(readFileSync(join(root, TRUST_REGISTRY_PATH), 'utf8'))).toHaveLength(1);
    expect(runKeyCreateCommand('', {cwd: root, json: true})).toMatchObject({ok: false, code: 'INVALID_OPERATION'});
    expect(runKeyCreateCommand('legacy', {cwd: workspace('0.1'), json: true})).toMatchObject({ok: false, code: 'INVALID_WORKSPACE'});
  });

  test('[covers:F-f4cfd533/AC-74458baa] lists registered issuers with local signing-key availability', () => {
    const root = workspace();
    expect(runKeyListCommand({cwd: root, json: true})).toMatchObject({ok: true, issuers: []});
    const created = runKeyCreateCommand('reviewer', {cwd: root, json: true});
    const listed = runKeyListCommand({cwd: root, json: true});
    expect(listed.issuers).toEqual([{issuer: 'reviewer', issuer_key_id: created.issuerKeyId, spki_der: expect.any(String), signingKeyPresent: true}]);
    // A registry cloned onto a machine without the key still lists the issuer,
    // but says plainly that nothing here can sign for it.
    rmSync(created.privateKeyPath!, {force: true});
    expect(runKeyListCommand({cwd: root, json: true}).issuers).toEqual([expect.objectContaining({signingKeyPresent: false})]);
  });
});
