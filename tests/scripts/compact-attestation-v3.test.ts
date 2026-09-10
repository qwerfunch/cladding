// Cladding · attestation v3 compaction script (F-6f0a2106 / AC-6f0a2116).

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {compactAttestationV3, observationSetSha256 as scriptDigest} from '../../scripts/compact-attestation-v3.mjs';
import {mintWorkspaceAttestationV3, observationSetSha256, type AttestationV3} from '../../src/assurance/attestation.js';
import {readAttestation} from '../../src/spec/attestation.js';
import {authoritativeFixtureVerdict} from '../assurance/authoritative-fixture.js';
import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';

const SCRIPT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'scripts', 'compact-attestation-v3.mjs');
const digest = (letter: string) => letter.repeat(64);

/** The pre-compaction row shape, as the file carried it before the digest. */
function legacyRow(feature: string, identities: readonly string[], overrides: Record<string, unknown> = {}) {
  return {
    attestation_schema: '3', feature, profile: 'push', configured_assurance_level: 'L2',
    achieved_assurance_level: 'L2', scope_sha256: digest('a'), input_sha256: digest('b'),
    contract_sha256: digest('c'), subject_sha256: digest('d'), verification_sha256: digest('e'),
    runtime_dependency_sha256: digest('f'), profile_sha256: digest('1'), obligation_sha256: digest('2'),
    registry_sha256: digest('3'), detector_catalog_sha256: digest('4'), tool_identity: 'cladding',
    environment_class: 'test', trust_snapshot_sha256: digest('5'),
    observation_identities: identities,
    observation_counts: {required: identities.length, pass: identities.length, na: 0, migration_baseline: 0},
    ...overrides,
  };
}

function document(rows: readonly Record<string, unknown>[]): string {
  return '# Cladding · Tier C — verification attestation.\n'
    + 'attested_modules:\n  src/a.ts: 0123456789abcdef\n'
    + 'attested_features:\n  F-legacy: ok\n'
    + 'attested_v3:\n'
    + rows.map((row) => `  ${row.feature}: ${JSON.stringify(row)}\n`).join('');
}

/** Mints one real row so the script's digest is checked against the writer's. */
function mintedRow(): AttestationV3 {
  const verdict = authoritativeFixtureVerdict(reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: digest('a'),
    hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
    environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6']
      .map((stage) => ({stage, status: 'pass' as const})),
  }));
  const minted = mintWorkspaceAttestationV3({
    verdict, feature: 'F-a', contractSha256: digest('a'), subjectSha256: digest('a'),
    verificationSha256: digest('a'), runtimeDependencySha256: digest('a'), registrySha256: digest('a'),
    detectorCatalogSha256: digest('a'), toolIdentity: 'cladding', environmentClass: 'test',
    trustSnapshotSha256: digest('a'),
  });
  if (!minted) throw new Error('fixture did not mint an authoritative row');
  return minted;
}

describe('compact-attestation-v3.mjs (F-6f0a2106)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-compact-v3-'));
    path = join(dir, 'attestation.yaml');
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-6f0a2106/AC-6f0a2116] rewrites an inline identity list into its address and count', () => {
    const identities = [digest('9'), digest('7'), digest('8')];
    const {text, compacted} = compactAttestationV3(document([legacyRow('F-one', identities)]));
    expect(compacted).toBe(1);
    const row = JSON.parse(text.split('\n').find((line) => line.startsWith('  F-one: '))!.slice('  F-one: '.length));
    expect(row.observation_identities).toBeUndefined();
    expect(row.observation_set_sha256).toBe(observationSetSha256(identities));
    expect(row.observation_count).toBe(3);
    // The address replaces the list where the list stood, so a rewritten row
    // and a freshly minted one serialize with the same key order.
    expect(Object.keys(row).slice(-3)).toEqual(['observation_set_sha256', 'observation_count', 'observation_counts']);
  });

  test('[covers:F-6f0a2106/AC-6f0a2116] rewrites the migration-baseline authorization list in the same pass', () => {
    const authorizations = [digest('d'), digest('c')];
    const rewritten = compactAttestationV3(document([legacyRow('F-two', [digest('6')], {
      observation_counts: {required: 3, pass: 1, na: 0, migration_baseline: 2},
      migration_baseline: {
        baseline_receipt_sha256: digest('a'), resolution_sha256: digest('b'),
        criterion_authorization_sha256: authorizations, criterion_count: 2, obligation_count: 4,
      },
    })]));
    const row = JSON.parse(rewritten.text.split('\n').find((line) => line.startsWith('  F-two: '))!.slice('  F-two: '.length));
    expect(row.migration_baseline.criterion_authorization_sha256).toBeUndefined();
    expect(row.migration_baseline.criterion_authorization_set_sha256).toBe(observationSetSha256(authorizations));
    expect(Object.keys(row.migration_baseline)).toEqual([
      'baseline_receipt_sha256', 'resolution_sha256', 'criterion_authorization_set_sha256',
      'criterion_count', 'obligation_count',
    ]);
  });

  test('[covers:F-6f0a2106/AC-6f0a2116] addresses a set exactly as the writer does', () => {
    const identities = [digest('3'), digest('1'), digest('1'), digest('2')];
    expect(scriptDigest(identities)).toBe(observationSetSha256(identities));
    // De-duplication and ordering are part of the address, not of the caller.
    expect(scriptDigest(identities)).toBe(scriptDigest([digest('2'), digest('1'), digest('3')]));
  });

  test('[covers:F-6f0a2106/AC-6f0a2116] leaves an already-compact document byte-identical and reports no rows', () => {
    const minted = mintedRow();
    const compact = document([minted as unknown as Record<string, unknown>]);
    const first = compactAttestationV3(compact);
    expect(first.compacted).toBe(0);
    expect(first.text).toBe(compact);
    // Idempotence through the CLI, which is how the history rewrite drives it.
    // The fixture carries a summary, because every row of the real file does.
    writeFileSync(path, document([legacyRow('F-three', [digest('6')], {
      observation_counts: {required: 3, pass: 1, na: 0, migration_baseline: 2},
      migration_baseline: {
        baseline_receipt_sha256: digest('a'), resolution_sha256: digest('b'),
        criterion_authorization_sha256: [digest('c')], criterion_count: 1, obligation_count: 2,
      },
    })]), 'utf8');
    expect(execFileSync('node', [SCRIPT, path], {encoding: 'utf8'}).trim()).toBe('compacted 1 rows');
    const once = readFileSync(path, 'utf8');
    expect(once).toContain('"criterion_authorization_set_sha256"');
    expect(execFileSync('node', [SCRIPT, path], {encoding: 'utf8'}).trim()).toBe('compacted 0 rows');
    expect(readFileSync(path, 'utf8')).toBe(once);
    expect(compactAttestationV3(once)).toEqual({text: once, compacted: 0});
  });

  test('[covers:F-6f0a2106/AC-6f0a2116] leaves every non-v3 line and every unreadable row untouched', () => {
    const source = document([legacyRow('F-four', [digest('6')])])
      + 'attested:\n  F-old: 0123456789abcdef\n';
    const withGarbage = source.replace('attested_v3:\n', 'attested_v3:\n  F-broken: {not json\n');
    const {text, compacted} = compactAttestationV3(withGarbage);
    expect(compacted).toBe(1);
    expect(text).toContain('  F-broken: {not json\n');
    expect(text).toContain('attested_modules:\n  src/a.ts: 0123456789abcdef\n');
    expect(text).toContain('attested_features:\n  F-legacy: ok\n');
    expect(text).toContain('attested:\n  F-old: 0123456789abcdef\n');
    // A `F-`-shaped module or legacy line outside the v3 section is not a row.
    expect(compactAttestationV3('attested_features:\n  F-legacy: ok\n').compacted).toBe(0);
  });

  test('[covers:F-6f0a2106/AC-6f0a2116] produces rows the current reader accepts', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'clad-compact-v3-read-'));
    const specDir = join(workspace, 'spec');
    mkdirSync(specDir);
    const rows = ['F-r1', 'F-r2'].map((feature) => legacyRow(feature, [digest('6'), digest('7')], {
      observation_counts: {required: 4, pass: 2, na: 0, migration_baseline: 2},
      migration_baseline: {
        baseline_receipt_sha256: digest('a'), resolution_sha256: digest('b'),
        criterion_authorization_sha256: [digest('c')], criterion_count: 1, obligation_count: 2,
      },
    }));
    try {
      writeFileSync(join(specDir, 'attestation.yaml'), document(rows), 'utf8');
      // The reader refuses the pre-compaction shape outright.
      expect(readAttestation(workspace)?.v3?.size ?? 0).toBe(0);
      expect(execFileSync('node', [SCRIPT, join(specDir, 'attestation.yaml')], {encoding: 'utf8'}).trim())
        .toBe('compacted 2 rows');
      const parsed = readAttestation(workspace);
      expect(parsed?.v3?.size).toBe(2);
      expect(parsed?.v3?.get('F-r1')?.observation_count).toBe(2);
      expect(parsed?.v3?.get('F-r1')?.migration_baseline?.criterion_authorization_set_sha256)
        .toBe(observationSetSha256([digest('c')]));
    } finally {
      rmSync(workspace, {recursive: true, force: true});
    }
  });
});
