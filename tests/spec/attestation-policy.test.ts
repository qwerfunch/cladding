// Cladding · specification attestation-policy tests.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  captureAttestationInputSnapshot,
  detectorCatalogSha256,
  featureAttestation,
  readAttestation,
  writeAttestation,
  type AttestationPolicy,
} from '../../src/spec/attestation.js';
import {loadSpec} from '../../src/spec/load.js';
import {createAttestationV3RetentionContext, serializeAttestationV3} from '../../src/assurance/attestation.js';
import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {createWorkspaceAttestations, currentProofViewsFromWorkspace, workspaceProfileSnapshot} from '../../src/assurance/workspace.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {
  LEGACY_L2_OBLIGATIONS,
  criterionFinalIntentFromRecord,
  criterionFinalIntentSha256,
  legacyL2CandidateCensusSha256,
  legacyL2CandidateSha256,
  legacyL2ResolutionSha256,
} from '../../src/spec/compiler/migration-baseline.js';
import {emptyTrustSnapshot, receiptDigest, serializePortableReceipt, type BlindReceipt} from '../../src/proof/receipt.js';
import type {Spec} from '../../src/spec/types.js';
import {authoritativeFixtureVerdict as authoritativeFixtureVerdictForTest, mintAuthoritativeFixtureV3} from '../assurance/authoritative-fixture.js';

function authoritativeFixtureVerdict(digest: string, feature: string) {
  return authoritativeFixtureVerdictForTest(reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses: [`feature:${feature}`], inputAddresses: [`feature:${feature}`], inputSha256: digest,
    hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
    environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6'].map((stage) => ({stage, status: 'pass' as const})),
  }));
}

const CURRENT_DETECTORS = 'd'.repeat(64);

function writeSchema02Siblings(root: string): void {
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: retention-fixture', '  language: typescript',
    '  purpose: Preserve only current attestation siblings.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = true;\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'export const b = true;\n');
  const shard = (id: string, title: string, module: string): string => [
    `id: ${id}`, `title: ${title}`, 'status: done', `purpose: ${title} has a current closure.`, `modules: [${module}]`,
    'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    `  - id: AC-${id.slice(2)}`, '    kind: behavior', '    statement: The system shall retain only current attestation evidence.', '',
  ].join('\n');
  writeFileSync(join(root, 'spec', 'features', 'a.yaml'), shard('F-a11ce001', 'A', 'src/a.ts'));
  writeFileSync(join(root, 'spec', 'features', 'b.yaml'), shard('F-b11ce002', 'B', 'src/b.ts'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
}

/** Writes one accepted baseline authorization that is current for B's strict raw intent. */
function writeEligibleBaselineForSibling(root: string): void {
  const feature = 'F-b11ce002';
  const criterion = 'AC-b11ce002';
  const subject = `criterion:${feature}/${criterion}`;
  const statement = 'The system shall retain only current attestation evidence.';
  const finalIntent = criterionFinalIntentFromRecord({statement, kind: 'behavior'});
  if (!finalIntent) throw new Error('fixture did not construct a strict final intent');
  const previewSha256 = 'a'.repeat(64);
  const candidateCensusSha256 = legacyL2CandidateCensusSha256([subject]);
  const resolutionSha256 = legacyL2ResolutionSha256({
    previewSha256, decision: 'accept', candidateCount: 1, candidateCensusSha256,
  });
  const authorization = {
    criterion: subject, sourceStatus: 'done' as const,
    finalIntentSha256: criterionFinalIntentSha256(finalIntent),
    obligations: LEGACY_L2_OBLIGATIONS,
    candidateSha256: '',
    resolutionSha256,
  };
  const baseline = {
    schema: 1, sourceSchema: '0.1' as const,
    project: {address: 'project', legacyIntent: 'Preserve the migrated review context.'},
    features: [],
    criteria: [{
      address: subject,
      legacyIntent: {text: statement},
      classification: 'legacy_unclassified' as const,
      bindings: [],
      exemption: {id: 'legacy-sibling-criterion', subject, reason: 'legacy_criterion_intent' as const},
    }],
    scenarios: [],
    legacyL2Baseline: {
      decision: 'accept' as const, previewSha256, candidateCount: 1, candidateCensusSha256, resolutionSha256,
      authorizations: [{...authorization, candidateSha256: legacyL2CandidateSha256(authorization)}],
    },
  };
  mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
  writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify(baseline));
}

function currentEntries(root: string, profile: 'completion' | 'push' | 'release', featureIds: readonly string[], identity: {
  readonly detectors?: string;
  readonly tool?: string;
  readonly environment?: string;
  readonly trust?: string;
} = {}) {
  const compilation = compileSpecWorkspace(root);
  const configured = compilation.contract?.project.assuranceLevel ?? 'L2';
  const profileValue = assuranceProfile(profile, configured);
  const scopeAddresses = profile === 'completion'
    ? featureIds.map((feature) => `feature:${feature}`)
    : (compilation.contract?.features ?? []).map((feature) => `feature:${feature.id}`);
  const snapshot = workspaceProfileSnapshot(root, compilation, {
    profile: profileValue,
    scopeAddresses,
    hasExecutableTests: false,
    oracleRequiredSubjects: new Set<string>(),
    requiresHuman: false,
  });
  const verdict = authoritativeFixtureVerdictForTest(reduceLegacyStageAdapter({
    profile: profileValue, configuredAssuranceLevel: configured, completeScope: snapshot.complete,
    scopeAddresses: snapshot.effectiveScopeAddresses, inputAddresses: compilation.nodes.map((node) => node.address),
    inputSha256: snapshot.inputSha256, hasExecutableTests: false, hasOracleProof: false,
    hasDeliverable: false, requiresQuality: false, requiresHuman: false, environmentClass: identity.environment ?? 'test',
    stages: profileValue.obligations.map((stage) => ({stage, status: 'pass' as const})),
  }));
  return createWorkspaceAttestations({
    cwd: root, compilation, verdict, featureIds,
    detectorCatalogSha256: identity.detectors ?? CURRENT_DETECTORS,
    toolIdentity: identity.tool ?? 'cladding-test', environmentClass: identity.environment ?? 'test',
    trustSnapshotSha256: identity.trust ?? emptyTrustSnapshot().digest,
  });
}

/** Mints B from the real compiler candidate and exact current Unit/Coverage scope passes. */
function currentBaselineSiblingEntry(root: string) {
  const compilation = compileSpecWorkspace(root);
  const configured = compilation.contract?.project.assuranceLevel ?? 'L2';
  const profile = assuranceProfile('completion', configured);
  const scopeAddresses = ['feature:F-b11ce002'];
  const snapshot = workspaceProfileSnapshot(root, compilation, {
    profile,
    scopeAddresses,
    hasExecutableTests: true,
    oracleRequiredSubjects: new Set<string>(),
    requiresHuman: false,
  });
  const proofViews = currentProofViewsFromWorkspace(root, compilation, snapshot.effectiveScopeAddresses);
  const verdict = authoritativeFixtureVerdictForTest(reduceLegacyStageAdapter({
    profile, configuredAssuranceLevel: configured, completeScope: snapshot.complete,
    scopeAddresses: snapshot.effectiveScopeAddresses, inputAddresses: compilation.nodes.map((node) => node.address),
    inputSha256: snapshot.inputSha256, hasExecutableTests: true, hasOracleProof: false,
    hasDeliverable: false, requiresQuality: false, requiresHuman: false, environmentClass: 'test',
    staticCriterionScope: snapshot.staticCriterionScope,
    criterionObservations: snapshot.criterionObservations,
    migrationBaselineCandidates: snapshot.migrationBaselineCandidates,
    proofViews,
    exactProofRequired: true,
    stages: profile.obligations.map((stage) => ({stage, status: 'pass' as const})),
  }));
  const [entry] = createWorkspaceAttestations({
    cwd: root, compilation, verdict, featureIds: ['F-b11ce002'],
    detectorCatalogSha256: CURRENT_DETECTORS, toolIdentity: 'cladding-test', environmentClass: 'test',
    trustSnapshotSha256: emptyTrustSnapshot().digest,
  });
  return {entry, snapshot};
}

function retention(entries: Parameters<typeof createAttestationV3RetentionContext>[0]) {
  return createAttestationV3RetentionContext(entries, {candidates: [], trustSnapshot: emptyTrustSnapshot()});
}

/** A portable but unknown-trust receipt: asserted, never a verified F5 proof. */
function assertedReceipt(feature = 'F-b11ce002', observedAt = '2026-08-29T12:34:56.789Z'): {
  readonly bytes: string;
  readonly path: string;
} {
  const receipt: BlindReceipt = {
    receipt_schema: '1', issuer: 'unregistered fixture', issuer_key_id: 'a'.repeat(64),
    issuer_proof: Buffer.alloc(64).toString('base64url'), subject: `feature:${feature}` as `feature:${string}`,
    subject_sha256: 'b'.repeat(64), observed_at: observedAt,
    method: 'blind_capability', claim: 'independent_oracle', verdict: 'pass',
    evidence: {locator: 'tests/b.test.ts', sha256: 'c'.repeat(64)},
    capability_manifest_sha256: 'd'.repeat(64),
  };
  return {
    bytes: serializePortableReceipt(receipt),
    path: `spec/evidence/${feature}/${receiptDigest(receipt)}.yaml`,
  };
}

describe('attestation policy stamp', () => {
  let dir: string;
  let spec: Spec;
  const policy: AttestationPolicy = {
    cladding: '0.9.4',
    blocking: 'strict',
    detectorsSha256: 'a'.repeat(64),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-att-policy-'));
    mkdirSync(join(dir, 'spec'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});
    writeFileSync(join(dir, 'src', 'main.ts'), 'export const main = true;\n', 'utf8');
    spec = {
      schema: '0.1',
      project: {name: 'policy-fixture', language: 'typescript'},
      features: [{id: 'F-a11ce001', title: 'Policy', status: 'done', modules: ['src/main.ts']}],
    };
    writeFileSync(join(dir, 'spec.yaml'), JSON.stringify(spec, null, 2));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-caff8598/AC-a4d41de9] writes and reads the policy stamp deterministically', () => {
    expect(writeAttestation(dir, spec, policy)).toBe(true);
    const path = join(dir, 'spec', 'attestation.yaml');
    const first = readFileSync(path, 'utf8');
    expect(first.indexOf('policy:')).toBeLessThan(first.indexOf('attested_modules:'));
    expect(first).toContain('  cladding: "0.9.4"');
    expect(first).toContain('  blocking: strict');
    expect(first).toContain(`  detectors_sha256: ${'a'.repeat(64)}`);
    expect(readAttestation(dir)?.policy).toEqual(policy);

    writeAttestation(dir, spec, policy);
    expect(readFileSync(path, 'utf8')).toBe(first);
  });

  test('preserves schema 0.1 writer and reader behavior without a v3 retention payload', () => {
    expect(writeAttestation(dir, spec)).toBe(true);
    const attestation = readAttestation(dir);
    expect(attestation?.policy).toBeNull();
    expect(featureAttestation(attestation!, dir, spec.features[0])).toEqual({state: 'fresh'});
  });

  test('[covers:F-caff8598/AC-734d8d3b] reads legacy v1 and v2 attestations without policy as unknown', () => {
    const path = join(dir, 'spec', 'attestation.yaml');
    writeFileSync(path, 'attested:\n  F-a11ce001: aaaaaaaaaaaaaaaa\n');
    const v1 = readAttestation(dir);
    expect(v1).toMatchObject({policy: null, modules: null, features: null});
    expect([...v1!.v1 ?? []]).toEqual([['F-a11ce001', 'aaaaaaaaaaaaaaaa']]);

    writeFileSync(path, [
      'attested_modules:',
      '  src/main.ts: bbbbbbbbbbbbbbbb',
      'attested_features:',
      '  F-a11ce001: ok',
      '',
    ].join('\n'));
    const v2 = readAttestation(dir);
    expect(v2).toMatchObject({policy: null, v1: null});
    expect([...v2!.modules ?? []]).toEqual([['src/main.ts', 'bbbbbbbbbbbbbbbb']]);
    expect([...v2!.features ?? []]).toEqual(['F-a11ce001']);
  });

  test('writes a schema 0.2 v3 seal while retaining its legacy module map', () => {
    const digest = 'b'.repeat(64);
    const v3 = mintAuthoritativeFixtureV3({
      verdict: authoritativeFixtureVerdict(digest, 'F-a11ce001'),
      feature: 'F-a11ce001', contractSha256: digest, subjectSha256: digest, verificationSha256: digest,
      runtimeDependencySha256: digest, registrySha256: digest, detectorCatalogSha256: digest,
      toolIdentity: 'cladding-test', environmentClass: 'test', trustSnapshotSha256: digest,
    });
    if (!v3) throw new Error('authoritative fixture seal was not created');
    expect(writeAttestation(dir, spec, policy, [v3], undefined, {writeLegacy: false})).toBe(true);
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(text).toContain('attested_v3:');
    expect(text).toContain('attested_modules:');
    expect(text).toContain('  src/main.ts:');
    expect(text).toContain('attested_features:');
    expect(text).not.toContain('  F-a11ce001: ok');
    const parsedForged = JSON.parse(JSON.stringify(v3)) as typeof v3;
    expect(() => writeAttestation(dir, spec, policy, [parsedForged], undefined, {writeLegacy: false}))
      .toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
  });

  test('retains a current schema-0.2 sibling byte-identically when A is replaced', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint both current v3 entries');
    expect(writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false})).toBe(true);
    const siblingRow = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8').split('\n')
      .find((line) => line.startsWith('  F-b11ce002: '));
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    expect(writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention})).toBe(true);
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8').split('\n')
      .find((line) => line.startsWith('  F-b11ce002: '))).toBe(siblingRow);
    const parsed = readAttestation(dir)!;
    // The writer authority brand is in-memory only.  Compare the canonical
    // persisted payload so this regression also proves that no Symbol marker
    // can be serialized or copied from an old row.
    const persistedA = parsed.v3?.get('F-a11ce001');
    const persistedB = parsed.v3?.get('F-b11ce002');
    if (!persistedA || !persistedB) throw new Error('persisted sibling v3 rows were missing');
    expect(serializeAttestationV3(persistedA)).toBe(serializeAttestationV3(a));
    expect(serializeAttestationV3(persistedB)).toBe(serializeAttestationV3(b));
  });

  test('retains a current push sibling while a completion receipt replaces A', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'push', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint cross-profile entries');
    expect(writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false})).toBe(true);
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.get('F-b11ce002')?.profile).toBe('push');
  });

  test('drops a contract-stale sibling and suppresses its legacy ok fallback', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const shard = join(dir, 'spec', 'features', 'b.yaml');
    writeFileSync(shard, readFileSync(shard, 'utf8').replace('title: B', 'title: B changed contract'));
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(text).not.toContain('  F-b11ce002: ok');
  });

  test('drops a runtime-stale sibling without a legacy fallback', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = false;\n');
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(text).not.toContain('  F-b11ce002: ok');
  });

  test('drops a proof-stale sibling without a legacy fallback', () => {
    writeSchema02Siblings(dir);
    mkdirSync(join(dir, 'tests'), {recursive: true});
    const proof = join(dir, 'tests', 'b.test.ts');
    writeFileSync(proof, 'test("[covers:F-b11ce002/AC-b11ce002] B", () => {});\n');
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    writeFileSync(proof, 'test("[covers:F-b11ce002/AC-b11ce002] B changed", () => {});\n');
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(text).not.toContain('  F-b11ce002: ok');
  });

  test('drops a runner-control-stale sibling without a legacy fallback', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(text).not.toContain('  F-b11ce002: ok');
  });

  test.each([
    ['bare runner', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = "before";\n');
    }, (root: string) => writeFileSync(join(root, 'runner.js'), 'export const runner = "after";\n')],
    ['post-test hook', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js', posttest: 'node post-test.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
      writeFileSync(join(root, 'post-test.js'), 'export const hook = "before";\n');
    }, (root: string) => writeFileSync(join(root, 'post-test.js'), 'export const hook = "after";\n')],
    ['ambient runtime', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
    }, (root: string) => writeFileSync(join(root, 'runner.js'), 'export default process.env.CI;\n')],
    ['filesystem runtime', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
    }, (root: string) => writeFileSync(join(root, 'runner.js'), 'import {readFileSync as read} from "node:fs"; export default read("runner.ini");\n')],
    ['shell interpreter', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
    }, (root: string) => writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'bash -lc "node runner.js"'}}))],
    ['interpreter preload', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
      writeFileSync(join(root, 'hook.js'), 'export const hook = true;\n');
    }, (root: string) => writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node -r hook.js runner.js'}}))],
    ['start lifecycle', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'npm start', prestart: 'node pre-start.js', start: 'node runner.js', poststart: 'node post-start.js'}}));
      writeFileSync(join(root, 'pre-start.js'), 'export const pre = true;\n');
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
      writeFileSync(join(root, 'post-start.js'), 'export const post = "before";\n');
    }, (root: string) => writeFileSync(join(root, 'post-start.js'), 'export const post = "after";\n')],
    ['Vitest config', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'vitest --config cfg.js'}}));
      writeFileSync(join(root, 'cfg.js'), 'export default {test: {pool: "forks"}};\n');
    }, (root: string) => writeFileSync(join(root, 'cfg.js'), 'export default {test: {pool: "threads"}};\n')],
    ['package exec runner', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.ts'}}));
      writeFileSync(join(root, 'runner.ts'), 'export const runner = "before";\n');
    }, (root: string) => {
      writeFileSync(join(root, 'runner.ts'), 'export const runner = "after";\n');
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'npm exec -- tsx runner.ts'}}));
    }],
    ['wrapped package exec runner', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.ts'}}));
      writeFileSync(join(root, 'runner.ts'), 'export const runner = "before";\n');
    }, (root: string) => {
      writeFileSync(join(root, 'runner.ts'), 'export const runner = "after";\n');
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'command npx tsx@latest runner.ts'}}));
    }],
    ['package run lifecycle runner', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'npm run exec', exec: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = "before";\n');
    }, (root: string) => writeFileSync(join(root, 'runner.js'), 'export const runner = "after";\n')],
    ['process module', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
    }, (root: string) => writeFileSync(join(root, 'runner.js'), 'import {env as runtimeEnv} from "node:process"; export default runtimeEnv.CI;\n')],
    ['module loader', (root: string) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
      writeFileSync(join(root, 'runner.js'), 'export const runner = true;\n');
    }, (root: string) => writeFileSync(join(root, 'runner.js'), 'const load = module.require("fs").readFileSync; module.exports = load("runner.ini");\n')],
  ] as const)('drops a sibling after a %s control change and never restores legacy authority', (_label, prepare, mutate) => {
    writeSchema02Siblings(dir);
    prepare(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    mutate(dir);
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(text).not.toContain('  F-b11ce002: ok');
  });

  test.each([
    ['registry', 'registry_sha256', 'f'.repeat(64)],
    ['detector', 'detector_catalog_sha256', 'e'.repeat(64)],
    ['tool', 'tool_identity', 'old-tool'],
    ['environment', 'environment_class', 'old-environment'],
    ['trust', 'trust_snapshot_sha256', 'd'.repeat(64)],
    ['configured-level', 'configured_assurance_level', 'L1'],
  ] as const)('drops B when only its %s identity mismatches', (_label, field, value) => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint current sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const path = join(dir, 'spec', 'attestation.yaml');
    const textBefore = readFileSync(path, 'utf8');
    const altered = {...JSON.parse(JSON.stringify(b)), [field]: value};
    writeFileSync(path, textBefore.replace(
      `  F-b11ce002: ${JSON.stringify(b)}`,
      `  F-b11ce002: ${JSON.stringify(altered)}`,
    ));
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint current trust authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    const text = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(text).not.toContain('  F-b11ce002: ok');
  });

  test('keeps a legacy-only mixed-transition sibling marker', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    if (!a) throw new Error('fixture did not mint replacement row');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false});
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).toContain('  F-b11ce002: ok');
  });

  test('rechecks B inside the writer after a precomputed snapshot is overtaken', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const snapshot = {
      ...captureAttestationInputSnapshot(dir, loadSpec(dir)),
      runtime: {
        inputSha256: a.input_sha256,
        complete: true,
        matchesCurrent: () => {
          writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = false;\n');
          return true;
        },
      },
    };
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, snapshot.spec, policy, [a], snapshot, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).not.toContain('  F-b11ce002: ok');
  });

  test('rejects a forged caller retention object without laundering B to ok', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const forged = JSON.parse(JSON.stringify(retention([a]))) as never;
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {
      writeLegacy: false,
      retention: forged,
    });
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).not.toContain('  F-b11ce002: ok');
  });

  test('does not let a genuine but stale gate context bless B', () => {
    writeSchema02Siblings(dir);
    const [aOld] = currentEntries(dir, 'completion', ['F-a11ce001'], {tool: 'old-tool'});
    const [bOld] = currentEntries(dir, 'completion', ['F-b11ce002'], {tool: 'old-tool'});
    if (!aOld || !bOld) throw new Error('fixture did not mint old sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [aOld, bOld], undefined, {writeLegacy: false});
    const [aCurrent] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const staleRetention = retention([aOld]);
    if (!aCurrent || !staleRetention) throw new Error('fixture did not mint current and stale gate authority');
    writeAttestation(dir, loadSpec(dir), policy, [aCurrent], undefined, {
      writeLegacy: false,
      retention: staleRetention,
    });
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).not.toContain('  F-b11ce002: ok');
  });

  test('drops a sibling whose compact migration-baseline summary differs from the current zero-baseline scope', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const summary = {
      baseline_receipt_sha256: 'a'.repeat(64), resolution_sha256: 'b'.repeat(64),
      criterion_authorization_sha256: ['c'.repeat(64)], criterion_count: 1, obligation_count: 2,
    };
    const forged = {
      ...b,
      observation_counts: {
        ...b.observation_counts,
        required: b.observation_counts.required + 2,
        migration_baseline: 2,
      },
      migration_baseline: summary,
    };
    const path = join(dir, 'spec', 'attestation.yaml');
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replace(
      `  ${b.feature}: ${JSON.stringify(b)}`,
      `  ${b.feature}: ${JSON.stringify(forged)}`,
    ));
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
  });

  test('retains a current sibling with a nonzero migration-baseline summary', () => {
    writeSchema02Siblings(dir);
    writeEligibleBaselineForSibling(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const {entry: b, snapshot} = currentBaselineSiblingEntry(dir);
    if (!a || !b) throw new Error('fixture did not mint current replacement and baseline sibling rows');
    expect(snapshot.migrationBaselineCandidates).toHaveLength(1);
    expect(b.observation_counts.migration_baseline).toBe(2);
    expect(b.migration_baseline).toMatchObject({criterion_count: 1, obligation_count: 2});
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const prior = readAttestation(dir)?.v3?.get('F-b11ce002');
    if (!prior) throw new Error('fixture did not persist the baseline sibling row');
    expect(prior.observation_counts.migration_baseline).toBe(2);
    expect(prior.migration_baseline).toMatchObject({criterion_count: 1, obligation_count: 2});
    const priorSerialized = serializeAttestationV3(prior);

    const [replacement] = currentEntries(dir, 'completion', ['F-a11ce001']);
    if (!replacement) throw new Error('fixture did not mint the current replacement row');
    const currentRetention = retention([replacement]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [replacement], undefined, {
      writeLegacy: false,
      retention: currentRetention,
    });
    const retained = readAttestation(dir)?.v3?.get('F-b11ce002');
    expect(retained).toBeDefined();
    expect(retained && serializeAttestationV3(retained)).toBe(priorSerialized);
  });

  test('treats malformed and contradictory last-wins v3 duplicates as rejected', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const path = join(dir, 'spec', 'attestation.yaml');
    const initial = readFileSync(path, 'utf8');
    const currentRetention = retention([a]);
    if (!currentRetention) throw new Error('fixture did not mint retention authority');
    writeFileSync(path, `${initial}  F-b11ce002: {}\n`);
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain('  F-b11ce002: ok');
    const contradictory = {
      ...JSON.parse(JSON.stringify(b)),
      observation_counts: {...b.observation_counts, pass: b.observation_counts.required + 1},
    };
    writeFileSync(path, `${initial}  F-b11ce002: ${JSON.stringify(contradictory)}\n`);
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(readFileSync(path, 'utf8')).not.toContain('  F-b11ce002: ok');
  });

  test('rejects a receipt location with a symlink ancestor instead of following outside bytes', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    mkdirSync(join(dir, 'outside-evidence'));
    mkdirSync(join(dir, 'spec', 'evidence'));
    const receipt = assertedReceipt();
    const receiptName = receipt.path.split('/').at(-1)!;
    writeFileSync(join(dir, 'outside-evidence', receiptName), receipt.bytes);
    symlinkSync(join(dir, 'outside-evidence'), join(dir, 'spec', 'evidence', 'F-b11ce002'));
    const unsafeContext = createAttestationV3RetentionContext([a], {
      candidates: [{bytes: receipt.bytes, expected: {}}],
      trustSnapshot: emptyTrustSnapshot(),
      currentLocations: [{
        path: receipt.path,
        expected: {},
      }],
    });
    if (!unsafeContext) throw new Error('fixture did not mint retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: unsafeContext});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).not.toContain('  F-b11ce002: ok');
  });

  test('rejects a nonempty receipt candidate set with an empty location census', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    if (!a) throw new Error('fixture did not mint replacement row');
    const receipt = assertedReceipt();
    expect(createAttestationV3RetentionContext([a], {
      candidates: [{bytes: receipt.bytes, expected: {}}],
      trustSnapshot: emptyTrustSnapshot(),
      currentLocations: [],
    })).toBeUndefined();
    expect(createAttestationV3RetentionContext([a], {
      candidates: [{bytes: new Uint8Array([0xff]), expected: {}}],
      trustSnapshot: emptyTrustSnapshot(),
      currentLocations: [{path: `spec/evidence/F-b11ce002/${'a'.repeat(64)}.yaml`, expected: {}}],
    })).toBeUndefined();
  });

  test('drops B when lock-held receipt bytes no longer equal the candidate snapshot', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const receipt = assertedReceipt();
    const changed = assertedReceipt('F-b11ce002', '2026-08-29T12:34:56.790Z');
    const absoluteReceiptPath = join(dir, receipt.path);
    mkdirSync(join(dir, 'spec', 'evidence', 'F-b11ce002'), {recursive: true});
    writeFileSync(absoluteReceiptPath, receipt.bytes);
    const currentRetention = createAttestationV3RetentionContext([a], {
      candidates: [{bytes: receipt.bytes, expected: {}}],
      trustSnapshot: emptyTrustSnapshot(),
      currentLocations: [{path: receipt.path, expected: {}}],
    });
    if (!currentRetention) throw new Error('fixture did not mint receipt retention authority');
    // The post-gate file remains portable, but its new content address no
    // longer matches this old canonical path or the pre-gate byte snapshot.
    writeFileSync(absoluteReceiptPath, changed.bytes);
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).not.toContain('  F-b11ce002: ok');
  });

  test('retains B through an unchanged valid asserted receipt census', () => {
    writeSchema02Siblings(dir);
    const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
    const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
    if (!a || !b) throw new Error('fixture did not mint sibling rows');
    writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
    const receipt = assertedReceipt();
    mkdirSync(join(dir, 'spec', 'evidence', 'F-b11ce002'), {recursive: true});
    writeFileSync(join(dir, receipt.path), receipt.bytes);
    const currentRetention = createAttestationV3RetentionContext([a], {
      candidates: [{bytes: receipt.bytes, expected: {}}], trustSnapshot: emptyTrustSnapshot(),
      currentLocations: [{path: receipt.path, expected: {}}],
    });
    if (!currentRetention) throw new Error('fixture did not mint receipt retention authority');
    writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
    expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(true);
  });

  test.each(['malformed', 'wrong-feature', 'wrong-digest', 'legacy-yml', 'reformatted'] as const)(
    'drops B when the receipt census is %s',
    (kind) => {
      writeSchema02Siblings(dir);
      const [a] = currentEntries(dir, 'completion', ['F-a11ce001']);
      const [b] = currentEntries(dir, 'completion', ['F-b11ce002']);
      if (!a || !b) throw new Error('fixture did not mint sibling rows');
      writeAttestation(dir, loadSpec(dir), policy, [a, b], undefined, {writeLegacy: false});
      const receipt = assertedReceipt();
      const digest = receipt.path.split('/').at(-1)!;
      const location = kind === 'wrong-feature'
        ? `spec/evidence/F-a11ce001/${digest}`
        : kind === 'wrong-digest'
          ? `spec/evidence/F-b11ce002/${'e'.repeat(64)}.yaml`
          : kind === 'legacy-yml'
            ? receipt.path.replace(/\.yaml$/, '.yml')
            : receipt.path;
      mkdirSync(join(dir, location.split('/').slice(0, -1).join('/')), {recursive: true});
      writeFileSync(join(dir, location), kind === 'malformed'
        ? 'not a portable receipt\n'
        : kind === 'reformatted' ? `${receipt.bytes}\n` : receipt.bytes);
      const currentRetention = createAttestationV3RetentionContext([a], {
        candidates: [{bytes: receipt.bytes, expected: {}}], trustSnapshot: emptyTrustSnapshot(),
        currentLocations: [{path: location, expected: {}}],
      });
      if (!currentRetention) throw new Error('fixture did not mint receipt retention authority');
      writeAttestation(dir, loadSpec(dir), policy, [a], undefined, {writeLegacy: false, retention: currentRetention});
      expect(readAttestation(dir)?.v3?.has('F-b11ce002')).toBe(false);
      expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).not.toContain('  F-b11ce002: ok');
    },
  );

  test('refuses an attestation when a gated source revision interleaves before the writer lock', () => {
    const gateSnapshot = captureAttestationInputSnapshot(dir, spec);
    const before = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    writeFileSync(join(dir, 'spec.yaml'), before.replace('policy-fixture', 'changed-during-gate'));

    expect(() => writeAttestation(dir, gateSnapshot.spec, policy, undefined, gateSnapshot))
      .toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(() => readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).toThrow();
  });

  test('[covers:F-6f0a2106/AC-6f0a2111] refuses source, test, and runner-config interleaves from a sealed runtime snapshot', () => {
    mkdirSync(join(dir, 'tests'), {recursive: true});
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const inputs = new Map<string, string>([
      ['src/main.ts', readFileSync(join(dir, 'src', 'main.ts'), 'utf8')],
      ['tests/main.test.ts', 'test("bound", () => {});\n'],
      ['.cladding/config.yaml', 'gate: {}\n'],
    ]);
    for (const [path, bytes] of inputs) writeFileSync(join(dir, path), bytes);
    for (const [path, original] of inputs) {
      const snapshot = {
        ...captureAttestationInputSnapshot(dir, spec),
        runtime: {
          inputSha256: 'a'.repeat(64),
          complete: true,
          matchesCurrent: () => [...inputs].every(([candidate, expected]) => readFileSync(join(dir, candidate), 'utf8') === expected),
        },
      };
      writeFileSync(join(dir, path), `${original}changed during gate\n`);
      expect(() => writeAttestation(dir, snapshot.spec, policy, undefined, snapshot))
        .toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
      writeFileSync(join(dir, path), original);
    }
  });

  test('treats migration baseline receipt create, edit, and delete as attestation snapshot drift', () => {
    const baseline = join(dir, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml');
    mkdirSync(join(dir, 'spec', 'generated'), {recursive: true});
    const assertStale = (change: () => void): void => {
      const snapshot = captureAttestationInputSnapshot(dir, spec);
      change();
      expect(() => writeAttestation(dir, snapshot.spec, policy, undefined, snapshot))
        .toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    };
    assertStale(() => writeFileSync(baseline, '[]\n'));
    writeFileSync(baseline, '[]\n');
    assertStale(() => writeFileSync(baseline, '{schema: 1}\n'));
    writeFileSync(baseline, '[]\n');
    assertStale(() => rmSync(baseline));
  });

  test('[covers:F-caff8598/AC-1f6b157b] detector catalog fingerprint is deterministic and configuration-sensitive', () => {
    const catalog = [
      {name: 'FIRST'},
      {name: 'SECOND', subprocess: true as const},
    ];
    const baseline = detectorCatalogSha256(catalog);
    expect(baseline).toMatch(/^[0-9a-f]{64}$/);
    expect(detectorCatalogSha256(catalog)).toBe(baseline);
    expect(detectorCatalogSha256([...catalog].reverse())).not.toBe(baseline);
    expect(detectorCatalogSha256([{name: 'RENAMED'}, catalog[1]])).not.toBe(baseline);
    expect(detectorCatalogSha256([{name: 'FIRST', subprocess: true}, catalog[1]])).not.toBe(baseline);
  });

  test('schema 0.2 loads sharded gate snapshots in filename order and rejects a semantic interleave', () => {
    writeFileSync(join(dir, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: policy-fixture', '  language: typescript', '  purpose: Keep verification receipts current.',
      '  assurance_level: L2', '  scenario_policy: advisory', '',
    ].join('\n'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    // Creation order is deliberately reverse lexical order; the disk loader
    // must not turn that incidental enumeration order into a stale snapshot.
    const shard = (id: string, title: string, module: string): string => [
      `id: ${id}`, `title: ${title}`, 'status: done', `purpose: ${title} has a stable purpose.`, `modules: [${module}]`, 'depends_on: []', 'capability_refs: [governance]',
      'acceptance_criteria:', `  - id: AC-${id.slice(2)}`, '    kind: behavior', '    statement: The system shall preserve the verified receipt.', '',
    ].join('\n');
    writeFileSync(join(dir, 'spec', 'features', 'z-bbbbbbbb.yaml'), shard('F-bbbbbbbb', 'Second', 'src/main.ts'));
    writeFileSync(join(dir, 'spec', 'features', 'a-aaaaaaaa.yaml'), shard('F-aaaaaaaa', 'First', 'src/main.ts'));
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'capabilities:\n  - id: governance\n    title: Governance\n    outcome: Keep verification safe.\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');

    const snapshot = loadSpec(dir);
    expect(snapshot.features.map((feature) => feature.id)).toEqual(['F-aaaaaaaa', 'F-bbbbbbbb']);
    expect(writeAttestation(dir, snapshot, policy)).toBe(true);
    const receipt = readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8');

    writeFileSync(join(dir, 'spec', 'features', 'z-bbbbbbbb.yaml'), shard('F-bbbbbbbb', 'Second changed', 'src/main.ts'));
    expect(() => writeAttestation(dir, snapshot, policy)).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(readFileSync(join(dir, 'spec', 'attestation.yaml'), 'utf8')).toBe(receipt);
  });
});
