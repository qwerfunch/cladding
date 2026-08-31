// Cladding · specification attestation-v3 tests.

import {describe, expect, test} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {featureAttestation, featureAttestationV3, featureAttestationV3Closure, moduleFileHash, readAttestation, type AttestationFile} from '../../src/spec/attestation.js';
import type {AttestationV3} from '../../src/assurance/attestation.js';
import type {Feature} from '../../src/spec/types.js';

const digest = (letter: string) => letter.repeat(64);
function seal(feature: string, overrides: Partial<AttestationV3> = {}): AttestationV3 {
  return {
    attestation_schema: '3', feature, profile: 'completion', configured_assurance_level: 'L2', achieved_assurance_level: 'L2',
    scope_sha256: digest('a'), input_sha256: digest('b'), contract_sha256: digest('c'), subject_sha256: digest('d'),
    verification_sha256: digest('e'), runtime_dependency_sha256: digest('f'), profile_sha256: digest('1'), obligation_sha256: digest('2'),
    registry_sha256: digest('3'), detector_catalog_sha256: digest('4'), tool_identity: 'cladding', environment_class: 'test',
    trust_snapshot_sha256: digest('5'), observation_identities: [digest('6')],
    observation_counts: {required: 1, pass: 1, na: 0, migration_baseline: 0}, ...overrides,
  };
}
function expected(entry: AttestationV3) {
  return {
    profile: entry.profile, configured_assurance_level: entry.configured_assurance_level, achieved_assurance_level: entry.achieved_assurance_level,
    scope_sha256: entry.scope_sha256, input_sha256: entry.input_sha256, contract_sha256: entry.contract_sha256,
    subject_sha256: entry.subject_sha256, verification_sha256: entry.verification_sha256, runtime_dependency_sha256: entry.runtime_dependency_sha256,
    profile_sha256: entry.profile_sha256, obligation_sha256: entry.obligation_sha256, registry_sha256: entry.registry_sha256,
    detector_catalog_sha256: entry.detector_catalog_sha256, tool_identity: entry.tool_identity,
    environment_class: entry.environment_class, trust_snapshot_sha256: entry.trust_snapshot_sha256,
    migration_baseline: entry.migration_baseline,
  };
}
function file(entries: readonly AttestationV3[]): AttestationFile {
  return {policy: null, v1: null, modules: null, features: null, v3: new Map(entries.map((entry) => [entry.feature, entry]))};
}

describe('F6 v3 attestation freshness', () => {
  test('A01 selectively stales a changed contract seal', () => {
    const entry = seal('F-target');
    expect(featureAttestationV3(file([entry]), 'F-target', {...expected(entry), contract_sha256: digest('9')})).toEqual({state: 'stale', field: 'contract_sha256'});
  });

  test('A02 selectively stales a changed proof input seal', () => {
    const entry = seal('F-target');
    expect(featureAttestationV3(file([entry]), 'F-target', {...expected(entry), verification_sha256: digest('8')})).toEqual({state: 'stale', field: 'verification_sha256'});
  });

  test('A03 keeps a target receipt fresh when only a sibling receipt is stale', () => {
    const target = seal('F-target');
    const sibling = seal('F-sibling', {verification_sha256: digest('7')});
    expect(featureAttestationV3(file([target, sibling]), 'F-target', expected(target))).toEqual({state: 'fresh'});
  });

  test('gives v3 closure freshness precedence over legacy module rows', () => {
    const target = seal('F-target');
    const mixed: AttestationFile = {...file([target]), modules: new Map([['src/changed.ts', '0'.repeat(16)]]), features: new Set(['F-target'])};
    expect(featureAttestationV3Closure(mixed, 'F-target', {
      contract_sha256: target.contract_sha256,
      subject_sha256: target.subject_sha256,
      verification_sha256: target.verification_sha256,
      runtime_dependency_sha256: target.runtime_dependency_sha256,
    })).toEqual({state: 'fresh'});
  });

  test('reads v1 and v2 compatibility sections and gives v3 seals precedence', () => {
    const target = seal('F-target');
    const cwd = mkdtempSync(join(tmpdir(), 'clad-attestation-v3-'));
    mkdirSync(join(cwd, 'spec'));
    writeFileSync(join(cwd, 'spec', 'attestation.yaml'), 'attested:\n  F-legacy: 0123456789abcdef\n');
    expect(readAttestation(cwd)?.v1?.get('F-legacy')).toBe('0123456789abcdef');
    writeFileSync(join(cwd, 'spec', 'attestation.yaml'), `attested_modules:\n  src/a.ts: 0123456789abcdef\nattested_features:\n  F-legacy: ok\nattested_v3:\n  F-target: ${JSON.stringify(target)}\n`);
    const parsed = readAttestation(cwd)!;
    expect(parsed.modules?.get('src/a.ts')).toBe('0123456789abcdef');
    expect(featureAttestationV3(parsed, 'F-target', expected(target))).toEqual({state: 'fresh'});
  });

  test('uses a legacy v2 marker for a sibling that has no valid v3 row', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'clad-attestation-v3-mixed-'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'sibling.ts'), 'export const sibling = true;\n');
    const sibling = {id: 'F-sibling', title: 'Sibling', status: 'done', modules: ['src/sibling.ts']} as Feature;
    const mixed: AttestationFile = {
      ...file([seal('F-target')]),
      modules: new Map([['src/sibling.ts', moduleFileHash(cwd, 'src/sibling.ts')]]),
      features: new Set(['F-sibling']),
    };
    expect(featureAttestation(mixed, cwd, sibling)).toEqual({state: 'fresh'});
  });

  test('normalizes an old compact report-fail count and writes the fourth count for new rows', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'clad-attestation-v3-report-'));
    mkdirSync(join(cwd, 'spec'));
    const report = {
      ...seal('F-report', {
      observation_identities: [digest('6'), digest('7')],
      observation_counts: {required: 2, pass: 1, na: 0, migration_baseline: 0},
      }),
      // Pre-F7c schema-3 rows have no baseline count or summary.
      observation_counts: {required: 2, pass: 1, na: 0},
    } as unknown as AttestationV3;
    writeFileSync(join(cwd, 'spec', 'attestation.yaml'), `attested_v3:\n  F-report: ${JSON.stringify(report)}\n`);

    // `required - pass` is the implicit upstream report-fail count. D13 keeps
    // the persisted proof summary compact, so no report_fail field is allowed.
    expect(readAttestation(cwd)?.v3?.get('F-report')?.observation_counts)
      .toEqual({required: 2, pass: 1, na: 0, migration_baseline: 0});
  });

  test('round-trips a receipt-only migration baseline summary and rejects malformed summary equations', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'clad-attestation-v3-baseline-'));
    mkdirSync(join(cwd, 'spec'));
    const summary = {
      baseline_receipt_sha256: digest('a'), resolution_sha256: digest('b'),
      criterion_authorization_sha256: [digest('c'), digest('d')], criterion_count: 2, obligation_count: 4,
    } as const;
    const valid = seal('F-valid', {
      observation_identities: [digest('6')],
      observation_counts: {required: 5, pass: 1, na: 0, migration_baseline: 4},
      migration_baseline: summary,
    });
    const malformed = seal('F-malformed', {
      observation_identities: [digest('6')],
      observation_counts: {required: 5, pass: 1, na: 0, migration_baseline: 4},
      migration_baseline: {...summary, criterion_authorization_sha256: [digest('d'), digest('c')]},
    });
    const absent = seal('F-absent', {
      observation_identities: [digest('6')],
      observation_counts: {required: 5, pass: 1, na: 0, migration_baseline: 4},
    });
    const zeroWithSummary = seal('F-zero', {migration_baseline: summary});
    writeFileSync(join(cwd, 'spec', 'attestation.yaml'), `attested_v3:\n  F-valid: ${JSON.stringify(valid)}\n  F-malformed: ${JSON.stringify(malformed)}\n  F-absent: ${JSON.stringify(absent)}\n  F-zero: ${JSON.stringify(zeroWithSummary)}\n`);
    const parsed = readAttestation(cwd)?.v3;
    const parsedValid = parsed?.get('F-valid');
    expect(parsedValid?.migration_baseline).toEqual(summary);
    expect(featureAttestationV3({
      policy: null, v1: null, modules: null, features: null, v3: parsed ?? null,
    }, 'F-valid', {
      ...expected(valid),
      migration_baseline: {...summary, resolution_sha256: digest('e')},
    })).toEqual({state: 'stale', field: 'migration_baseline'});
    expect(parsed?.has('F-malformed')).toBe(false);
    expect(parsed?.has('F-absent')).toBe(false);
    expect(parsed?.has('F-zero')).toBe(false);
  });

  test('reports a changed migration summary as its own stale freshness field', () => {
    const summary = {
      baseline_receipt_sha256: digest('a'), resolution_sha256: digest('b'),
      criterion_authorization_sha256: [digest('c')], criterion_count: 1, obligation_count: 2,
    } as const;
    const entry = seal('F-target', {
      observation_identities: [digest('6')],
      observation_counts: {required: 3, pass: 1, na: 0, migration_baseline: 2},
      migration_baseline: summary,
    });
    expect(featureAttestationV3(file([entry]), 'F-target', {
      ...expected(entry),
      migration_baseline: {...summary, resolution_sha256: digest('d')},
    })).toEqual({state: 'stale', field: 'migration_baseline'});
  });

  test('rejects compact counts that overlap literal passes with migration-baseline rows', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'clad-attestation-v3-overlap-'));
    mkdirSync(join(cwd, 'spec'));
    const summary = {
      baseline_receipt_sha256: digest('a'), resolution_sha256: digest('b'),
      criterion_authorization_sha256: [digest('c')], criterion_count: 1, obligation_count: 2,
    } as const;
    const overlap = seal('F-overlap', {
      observation_counts: {required: 2, pass: 1, na: 0, migration_baseline: 2},
      migration_baseline: summary,
    });
    writeFileSync(join(cwd, 'spec', 'attestation.yaml'), `attested_v3:\n  F-overlap: ${JSON.stringify(overlap)}\n`);
    expect(readAttestation(cwd)?.v3?.has('F-overlap')).toBe(false);
  });

  test('rejects malformed, overflow, contradictory, and all-NA compact counts', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'clad-attestation-v3-invalid-'));
    mkdirSync(join(cwd, 'spec'));
    const invalidCounts = seal('F-target', {observation_counts: {required: 2, pass: 3, na: 1, migration_baseline: 0}});
    const invalidIdentity = seal('F-other', {registry_sha256: 'not-a-digest'});
    const emptyGreen = seal('F-empty', {observation_identities: [], observation_counts: {required: 0, pass: 0, na: 6, migration_baseline: 0}});
    const overflow = seal('F-overflow', {observation_counts: {required: Number.MAX_SAFE_INTEGER + 1, pass: 1, na: 0, migration_baseline: 0}});
    const fractional = seal('F-fractional', {observation_counts: {required: 1.5, pass: 1, na: 0, migration_baseline: 0}});
    const negativePass = seal('F-negative-pass', {observation_counts: {required: 1, pass: -1, na: 0, migration_baseline: 0}});
    const negativeNa = seal('F-negative-na', {observation_counts: {required: 1, pass: 1, na: -1, migration_baseline: 0}});
    const malformed = {...seal('F-malformed'), observation_counts: null} as unknown as AttestationV3;
    const insufficient = seal('F-insufficient', {observation_counts: {required: 2, pass: 1, na: 0, migration_baseline: 0}});
    const duplicateIdentity = seal('F-duplicate', {observation_identities: [digest('6'), digest('6')], observation_counts: {required: 2, pass: 1, na: 0, migration_baseline: 0}});
    writeFileSync(join(cwd, 'spec', 'attestation.yaml'), `attested_v3:\n  F-target: ${JSON.stringify(invalidCounts)}\n  F-other: ${JSON.stringify(invalidIdentity)}\n  F-empty: ${JSON.stringify(emptyGreen)}\n  F-overflow: ${JSON.stringify(overflow)}\n  F-fractional: ${JSON.stringify(fractional)}\n  F-negative-pass: ${JSON.stringify(negativePass)}\n  F-negative-na: ${JSON.stringify(negativeNa)}\n  F-malformed: ${JSON.stringify(malformed)}\n  F-insufficient: ${JSON.stringify(insufficient)}\n  F-duplicate: ${JSON.stringify(duplicateIdentity)}\n`);
    const parsed = readAttestation(cwd);
    expect(parsed?.v3?.size ?? 0).toBe(0);
  });
});
