// Cladding · proof signoff tests.

import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {runVerifiedSignoffCommand} from '../../src/cli/signoff.js';
import {ingestPortableReceipt} from '../../src/proof/ingest.js';
import {createIssuerKey} from '../../src/proof/issuer.js';
import {recordAssertedSignoff, recordVerifiedSignoff} from '../../src/proof/signoff.js';
import {parsePortableReceiptYaml} from '../../src/proof/receipt.js';
import {TRUST_REGISTRY_PATH, trustRegistryAddition} from '../../src/proof/trust.js';

const temporary: string[] = [];

function writeWorkspace(schema: '0.1' | '0.2'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f5-signoff-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  if (schema === '0.1') {
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject: {name: signoff, language: typescript}\nfeatures: []\nscenarios: []\n');
    writeFileSync(join(root, 'spec', 'features', 'signoff-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\nslug: signoff\ntitle: Signoff\nstatus: in_progress\nmodules: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    text: The system shall retain local history.\n');
  } else {
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: signoff\n  language: typescript\n  purpose: Keep assertions distinct from receipts.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
    writeFileSync(join(root, 'spec', 'features', 'signoff-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Signoff\nstatus: in_progress\npurpose: Keep assertions distinct from receipts.\nmodules: []\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall retain local history.\n');
  }
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('asserted signoff boundary', () => {
  test('records asserted audit history without a terminal, OS, git, or caller verification bypass', () => {
    const root = writeWorkspace('0.1');
    const result = recordAssertedSignoff({cwd: root, featureId: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass'});
    expect(result).toMatchObject({ok: true, code: 'OK', evidence: {assurance: 'asserted', identity: {author: 'human'}}});
    expect(JSON.parse(readFileSync(join(root, '.cladding', 'audit.log.jsonl'), 'utf8'))).toMatchObject({assurance: 'asserted'});
  });

  test('[covers:F-2883ff4d/AC-2883ff09] surfaces HUMAN_REQUIRED after recording schema 0.2 assertion-only history', () => {
    const root = writeWorkspace('0.2');
    const result = recordAssertedSignoff({cwd: root, featureId: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass'});
    expect(result).toMatchObject({ok: false, code: 'HUMAN_REQUIRED', evidence: {assurance: 'asserted'}});
    expect(readFileSync(join(root, '.cladding', 'audit.log.jsonl'), 'utf8')).toContain('"assurance":"asserted"');
  });
});

/** One schema 0.2 workspace with a registered issuer and a real module root. */
function signableWorkspace(): {root: string; env: NodeJS.ProcessEnv; issuer: string} {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-verified-'));
  temporary.push(root);
  const store = mkdtempSync(join(tmpdir(), 'clad-f9d-verified-keys-'));
  temporary.push(store);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: verified\n  language: typescript\n  purpose: Sign one human receipt offline.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'verified-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Verified\nstatus: in_progress\npurpose: Sign one human receipt offline.\nmodules:\n  - src/alpha.ts\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall retain one signed audit claim.\n');
  // Registering directly keeps this a proof-layer test; `clad key` has its own.
  const env = {CLADDING_KEYS_DIR: join(store, 'keys')};
  const created = createIssuerKey(env);
  mkdirSync(join(root, 'spec', 'trust'), {recursive: true});
  writeFileSync(join(root, TRUST_REGISTRY_PATH), trustRegistryAddition(root, {issuer: 'independent reviewer', spkiDer: created.spkiDer}).after);
  return {root, env, issuer: 'independent reviewer'};
}

function auditRequest(fixture: ReturnType<typeof signableWorkspace>, confirm: () => Promise<string | undefined>) {
  return {
    cwd: fixture.root, featureId: 'F-aaaaaaaa', claim: 'audit' as const, criterion: 'AC-bbbbbbbb',
    result: 'pass' as const, issuer: fixture.issuer, env: fixture.env, confirm,
  };
}

describe('verified signoff boundary', () => {
  test('[covers:F-f4cfd533/AC-17ec9e88] returns HUMAN_REQUIRED and records only asserted history without a confirmation', async () => {
    const fixture = signableWorkspace();
    const absent = await recordVerifiedSignoff(auditRequest(fixture, async () => undefined));
    expect(absent).toMatchObject({ok: false, code: 'HUMAN_REQUIRED', evidence: {assurance: 'asserted'}});
    expect(absent.path).toBeUndefined();
    const mismatch = await recordVerifiedSignoff(auditRequest(fixture, async () => 'F-99999999'));
    expect(mismatch).toMatchObject({ok: false, code: 'HUMAN_REQUIRED'});
    expect(existsSync(join(fixture.root, 'spec', 'evidence'))).toBe(false);
    // Both attempts still left the human channel's asserted history behind.
    expect(readFileSync(join(fixture.root, '.cladding', 'audit.log.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('[covers:F-f4cfd533/AC-17ec9e88] returns HUMAN_REQUIRED when the issuer has no registered key or no local signing key', async () => {
    const fixture = signableWorkspace();
    const unregistered = await recordVerifiedSignoff({...auditRequest(fixture, async () => 'F-aaaaaaaa'), issuer: 'nobody'});
    expect(unregistered).toMatchObject({ok: false, code: 'HUMAN_REQUIRED'});
    expect(unregistered.message).toContain('clad key create');
    const elsewhere = await recordVerifiedSignoff({
      ...auditRequest(fixture, async () => 'F-aaaaaaaa'), env: {CLADDING_KEYS_DIR: join(fixture.root, 'absent-store')},
    });
    expect(elsewhere).toMatchObject({ok: false, code: 'HUMAN_REQUIRED'});
    expect(elsewhere.message).toContain('clad key create');
    expect(existsSync(join(fixture.root, 'spec', 'evidence'))).toBe(false);
  });

  test('[covers:F-f4cfd533/AC-1d5f62de] signs and ingests a receipt carrying the four expected digests once a human re-enters the feature id', async () => {
    const fixture = signableWorkspace();
    const signed = await recordVerifiedSignoff(auditRequest(fixture, async () => 'F-aaaaaaaa'));
    expect(signed).toMatchObject({
      ok: true, code: 'OK', verification: {assurance: 'verified', currentness: 'current', reason: 'verified'},
    });
    expect(signed.path).toMatch(/^spec\/evidence\/F-aaaaaaaa\/[a-f0-9]{64}\.yaml$/);
    const stored = parsePortableReceiptYaml(readFileSync(join(fixture.root, signed.path!), 'utf8'));
    expect(stored).toMatchObject({
      method: 'human_channel', claim: 'audit', issuer: fixture.issuer, subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb',
      subject_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      reviewed_inputs_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      runtime_dependency_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      implementation_authors_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(signed.message).toContain('not universal human identity');
    // Storage is content-addressed, so re-ingesting the identical bytes is
    // idempotent while a genuinely second signature (a later `observed_at`) is
    // a distinct receipt rather than an overwrite of the first.
    const replay = ingestPortableReceipt({
      cwd: fixture.root, receiptYaml: readFileSync(join(fixture.root, signed.path!), 'utf8'),
    });
    expect(replay).toMatchObject({ok: true, changed: false, idempotent: true, path: signed.path});
    expect(readdirSync(join(fixture.root, 'spec', 'evidence', 'F-aaaaaaaa'))).toHaveLength(1);
  });

  test('[covers:F-f4cfd533/AC-1d5f62de] signs a feature UAT receipt whose matrix addresses every current criterion', async () => {
    const fixture = signableWorkspace();
    const signed = await recordVerifiedSignoff({
      cwd: fixture.root, featureId: 'F-aaaaaaaa', claim: 'uat', issuer: fixture.issuer, env: fixture.env,
      confirm: async () => 'F-aaaaaaaa',
    });
    expect(signed).toMatchObject({ok: true, verification: {assurance: 'verified', currentness: 'current'}});
    const stored = parsePortableReceiptYaml(readFileSync(join(fixture.root, signed.path!), 'utf8'));
    expect(stored).toMatchObject({
      claim: 'uat', subject: 'feature:F-aaaaaaaa',
      criterion_verdicts: {'criterion:F-aaaaaaaa/AC-bbbbbbbb': 'pass'},
      checks: {no_surprise: 'pass', tradeoff_acceptance: 'pass'},
    });
  });
});

describe('verified signoff CLI adapter', () => {
  test('[covers:F-f4cfd533/AC-17ec9e88] returns HUMAN_REQUIRED without an interactive terminal and still records asserted history', async () => {
    const fixture = signableWorkspace();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const scripted = await runVerifiedSignoffCommand('F-aaaaaaaa', {
        cwd: fixture.root, claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass',
        issuer: fixture.issuer, json: true, verified: true, interactive: false,
      });
      expect(scripted).toMatchObject({ok: false, code: 'HUMAN_REQUIRED', evidence: {assurance: 'asserted'}});
      expect(existsSync(join(fixture.root, 'spec', 'evidence'))).toBe(false);
      expect(readFileSync(join(fixture.root, '.cladding', 'audit.log.jsonl'), 'utf8')).toContain('"assurance":"asserted"');
      // `--verified` without an issuer names no registered key, so it is a
      // caller error rather than a missing human.
      const unnamed = await runVerifiedSignoffCommand('F-aaaaaaaa', {
        cwd: fixture.root, claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass', json: true, verified: true,
      });
      expect(unnamed).toMatchObject({ok: false, code: 'INVALID_OPERATION'});
    } finally {
      vi.restoreAllMocks();
      process.exitCode = undefined;
    }
  });

  test('[covers:F-f4cfd533/AC-1d5f62de] signs through the CLI once the injected prompt returns the exact feature id', async () => {
    const fixture = signableWorkspace();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.env.CLADDING_KEYS_DIR = fixture.env.CLADDING_KEYS_DIR;
      const signed = await runVerifiedSignoffCommand('F-aaaaaaaa', {
        cwd: fixture.root, claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass',
        issuer: fixture.issuer, json: true, verified: true, interactive: true,
        confirm: async () => 'F-aaaaaaaa',
      });
      expect(signed).toMatchObject({ok: true, code: 'OK', verification: {assurance: 'verified', currentness: 'current'}});
      const mistyped = await runVerifiedSignoffCommand('F-aaaaaaaa', {
        cwd: fixture.root, claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'fail',
        issuer: fixture.issuer, json: true, verified: true, interactive: true,
        confirm: async () => 'f-aaaaaaaa',
      });
      expect(mistyped).toMatchObject({ok: false, code: 'HUMAN_REQUIRED'});
    } finally {
      delete process.env.CLADDING_KEYS_DIR;
      vi.restoreAllMocks();
      process.exitCode = undefined;
    }
  });
});
