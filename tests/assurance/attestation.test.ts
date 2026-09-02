// Cladding · assurance attestation tests.

import {describe, expect, test} from 'vitest';
import {createHash} from 'node:crypto';

import {mintWorkspaceAttestationV3} from '../../src/assurance/attestation.js';
import {canonicalClosureJson} from '../../src/assurance/closures.js';
import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {hasRunCheckStagesAuthority, mintRunCheckStagesAuthority} from '../../src/assurance/run-authority.js';
import {assuranceProfile, compileAssuranceReductionPlan, invalidateAssuranceVerdict, reduceAssurancePlan, verdictAuthorizesFeature, type AssuranceVerdict, type ObligationResult} from '../../src/assurance/kernel.js';
import {authoritativeFixtureVerdict} from './authoritative-fixture.js';

const digest = 'a'.repeat(64);
const authorityScope = ['feature:F-a'];
const authorityScopeSha256 = createHash('sha256').update(canonicalClosureJson(authorityScope), 'utf8').digest('hex');

function authorityResult(
  state: ObligationResult['state'],
  obligation: string,
  observation: string,
  blocking: ObligationResult['blocking'] = 'hard',
): ObligationResult {
  return {
    obligation, subject: 'feature:F-a', state,
    source_strictness: blocking === 'report' ? 'report' : 'hard', blocking,
    observation_identities: [observation],
  };
}

// This is a test-only synthetic kernel output for D23's upstream report case:
// the current Cladding registry deliberately hardens those entries to RED.
function sealedVerdict(results: readonly ObligationResult[]): AssuranceVerdict {
  const verdict: AssuranceVerdict = Object.freeze({
    profile: 'completion', assurance_level: 'L2', configured_assurance_level: 'L2', achieved_assurance_level: 'L2',
    scope_sha256: authorityScopeSha256, input_sha256: digest, state: 'green', profile_complete: true,
    results: Object.freeze(results), independence: 'not-applicable', obligation_sha256: digest,
  });
  mintRunCheckStagesAuthority(verdict, {
    inputSha256: digest, scopeAddresses: authorityScope, profileAuthoritative: true,
    executedStageIds: results.filter((result) => result.state === 'pass').map((result) => result.obligation),
    featureSeals: [{feature: 'F-a', contractSha256: digest, subjectSha256: digest, verificationSha256: digest, runtimeDependencySha256: digest}],
    profileIdentity: {registrySha256: digest, detectorCatalogSha256: digest, toolIdentity: 'cladding', environmentClass: 'test', trustSnapshotSha256: digest},
  });
  return verdict;
}

function sealedInput(verdict: AssuranceVerdict) {
  return {verdict, feature: 'F-a', contractSha256: digest, subjectSha256: digest, verificationSha256: digest, runtimeDependencySha256: digest, registrySha256: digest, detectorCatalogSha256: digest, toolIdentity: 'cladding', environmentClass: 'test', trustSnapshotSha256: digest};
}

function hasSealedAuthority(verdict: AssuranceVerdict): boolean {
  return hasRunCheckStagesAuthority(verdict, 'F-a', digest, {
    contractSha256: digest, subjectSha256: digest, verificationSha256: digest, runtimeDependencySha256: digest,
  }, {
    registrySha256: digest, detectorCatalogSha256: digest, toolIdentity: 'cladding', environmentClass: 'test', trustSnapshotSha256: digest,
  });
}

function greenVerdict(
  profileId: 'completion' | 'push' | 'release' = 'completion',
  scopeAddresses: readonly string[] = ['feature:F-a'],
) {
  return reduceLegacyStageAdapter({
    profile: assuranceProfile(profileId, 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses, inputAddresses: scopeAddresses, inputSha256: digest,
    hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
    environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6'].map((stage) => ({stage, status: 'pass' as const})),
  });
}

function fixtureGreenVerdict(
  profileId: 'completion' | 'push' | 'release' = 'completion',
  scopeAddresses: readonly string[] = ['feature:F-a'],
) {
  return authoritativeFixtureVerdict(greenVerdict(profileId, scopeAddresses));
}

function compilerGreenVerdict() {
  const profile = assuranceProfile('completion', 'L1');
  const obligations = profile.obligations.map((descriptor) => ({
    id: `${descriptor}:feature:F-a`, subject: 'feature:F-a', assurance_level: 'L1' as const,
    descriptor, input_addresses: ['feature:F-a'], input_sha256: digest, applicability: 'required' as const,
    blocking: 'hard' as const,
  }));
  const observations = obligations.map((obligation) => ({
    obligation: obligation.descriptor, subject: obligation.subject, state: 'pass' as const,
    input_sha256: digest, adapter: {id: `legacy-stage:${obligation.descriptor}`, version: '1'},
    provenance: 'observed' as const, assurance: 'verified' as const,
    observed_at: '1970-01-01T00:00:00.000Z', environment_class: 'test',
  }));
  return reduceAssurancePlan(compileAssuranceReductionPlan({
    profile, configuredAssuranceLevel: 'L1', scopeSha256: digest, inputSha256: digest,
    scopeAddresses: ['feature:F-a'], obligations, observations,
    applicabilityFacts: {complete: true, hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false},
  }));
}

describe('F6 attestation v3 payload', () => {
  test('admits receipt-backed L2 rows only when this run observed matching current scope passes', () => {
    const basis = {
      baseline_receipt_sha256: 'b'.repeat(64),
      resolution_sha256: 'c'.repeat(64),
      criterion_authorization_sha256: 'd'.repeat(64),
    };
    const baselineRows: ObligationResult[] = ['stage_2.1', 'stage_2.2'].flatMap((obligation) => [{
      obligation,
      subject: `scope:${authorityScopeSha256}`,
      state: 'pass' as const,
      source_strictness: 'hard' as const,
      blocking: 'hard' as const,
      observation_identities: [`scope:${obligation}`],
    }, {
      obligation,
      subject: 'criterion:F-a/AC-b',
      state: 'migration_baseline' as const,
      source_strictness: 'hard' as const,
      blocking: 'hard' as const,
      migration_baseline: basis,
      observation_identities: [],
    }]);
    expect(hasSealedAuthority(sealedVerdict(baselineRows))).toBe(true);
    const minted = mintWorkspaceAttestationV3(sealedInput(sealedVerdict(baselineRows)));
    expect(minted?.observation_counts).toEqual({required: 4, pass: 2, na: 0, migration_baseline: 2});
    expect(minted?.observation_identities).toEqual(['scope:stage_2.1', 'scope:stage_2.2']);
    expect(minted?.migration_baseline).toEqual({
      baseline_receipt_sha256: basis.baseline_receipt_sha256,
      resolution_sha256: basis.resolution_sha256,
      criterion_authorization_sha256: [basis.criterion_authorization_sha256],
      criterion_count: 1,
      obligation_count: 2,
    });

    const missingScope = baselineRows.filter((row) => !row.subject.startsWith('scope:'));
    expect(hasSealedAuthority(sealedVerdict(missingScope))).toBe(false);
    const foreignScope = baselineRows.map((row) => row.subject.startsWith('scope:')
      ? {...row, subject: `scope:${'e'.repeat(64)}`}
      : row);
    expect(hasSealedAuthority(sealedVerdict(foreignScope))).toBe(false);
    const forged = baselineRows.map((row) => row.state === 'migration_baseline'
      ? {...row, migration_baseline: {...basis, resolution_sha256: 'not-a-sha'}}
      : row);
    expect(hasSealedAuthority(sealedVerdict(forged))).toBe(false);
    const mismatchedPair = baselineRows.map((row, index) => row.state === 'migration_baseline' && index === 3
      ? {...row, migration_baseline: {...basis, criterion_authorization_sha256: 'e'.repeat(64)}}
      : row);
    expect(mintWorkspaceAttestationV3(sealedInput(sealedVerdict(mismatchedPair)))).toBeUndefined();
  });

  test('aggregates every baseline subject in one scope summary and excludes baseline rows from pass and observation identity counts', () => {
    const basis = {
      baseline_receipt_sha256: 'b'.repeat(64),
      resolution_sha256: 'c'.repeat(64),
    };
    const rows: ObligationResult[] = ['stage_2.1', 'stage_2.2'].flatMap((obligation) => [{
      obligation,
      subject: `scope:${authorityScopeSha256}`,
      state: 'pass' as const,
      source_strictness: 'hard' as const,
      blocking: 'hard' as const,
      observation_identities: [`scope:${obligation}`],
    }, ...['criterion:F-a/AC-b', 'criterion:F-a/AC-c'].map((subject, index) => ({
      obligation,
      subject,
      state: 'migration_baseline' as const,
      source_strictness: 'hard' as const,
      blocking: 'hard' as const,
      migration_baseline: {...basis, criterion_authorization_sha256: index === 0 ? 'd'.repeat(64) : 'e'.repeat(64)},
      observation_identities: [],
    }))]);
    const entry = mintWorkspaceAttestationV3(sealedInput(sealedVerdict(rows)));
    expect(entry?.observation_counts).toEqual({required: 6, pass: 2, na: 0, migration_baseline: 4});
    expect(entry?.observation_identities).toEqual(['scope:stage_2.1', 'scope:stage_2.2']);
    expect(entry?.migration_baseline).toEqual({
      baseline_receipt_sha256: basis.baseline_receipt_sha256,
      resolution_sha256: basis.resolution_sha256,
      criterion_authorization_sha256: ['d'.repeat(64), 'e'.repeat(64)],
      criterion_count: 2,
      obligation_count: 4,
    });

    const na = {
      obligation: 'stage_2.3', subject: 'feature:F-a', state: 'na' as const,
      source_strictness: 'hard' as const, blocking: 'hard' as const, observation_identities: [],
    } satisfies ObligationResult;
    const oneSubject = rows.filter((row) => row.subject === `scope:${authorityScopeSha256}` || row.subject === 'criterion:F-a/AC-b');
    const withNa = mintWorkspaceAttestationV3(sealedInput(sealedVerdict([...oneSubject, na])));
    expect(withNa?.observation_counts).toEqual({required: 4, pass: 2, na: 1, migration_baseline: 2});
    expect(withNa?.observation_identities).toEqual(['scope:stage_2.1', 'scope:stage_2.2']);
  });

  test('[covers:F-065/AC-175][covers:F-6f0a2106/AC-6f0a2108] mints a current profile-complete authoritative attestation only from the authoritative verdict', () => {
    const input = {verdict: greenVerdict(), feature: 'F-a', contractSha256: digest, subjectSha256: digest, verificationSha256: digest, runtimeDependencySha256: digest, registrySha256: digest, detectorCatalogSha256: digest, toolIdentity: 'cladding', environmentClass: 'test', trustSnapshotSha256: digest};
    // A public adapter GREEN is a compatibility projection, not proof that the
    // compiler snapshot and current stage execution came from runCheckStages.
    expect(mintWorkspaceAttestationV3(input)).toBeUndefined();
    const compilerVerdict = compilerGreenVerdict();
    expect(compilerVerdict).toMatchObject({state: 'green', profile_complete: true});
    expect(mintWorkspaceAttestationV3({...input, verdict: compilerVerdict})).toBeUndefined();
    const fixtureInput = {...input, verdict: fixtureGreenVerdict()};
    expect(mintWorkspaceAttestationV3(fixtureInput)?.attestation_schema).toBe('3');
    // Scope substitution, a spread, and JSON all lose the exact in-process
    // authority object even when their public fields still claim GREEN.
    expect(mintWorkspaceAttestationV3({...fixtureInput, feature: 'F-b'})).toBeUndefined();
    expect(mintWorkspaceAttestationV3({...fixtureInput, verdict: {...fixtureInput.verdict, profile_complete: false}})).toBeUndefined();
    expect(mintWorkspaceAttestationV3({...fixtureInput, verdict: {...fixtureInput.verdict, profile: 'checkpoint'}})).toBeUndefined();
    expect(mintWorkspaceAttestationV3({...fixtureInput, verdict: {...fixtureInput.verdict, profile: 'feedback'}})).toBeUndefined();
    // Spreading a real verdict removes its reducer provenance, so an arbitrary
    // claimed profile cannot become a writer-capable attestation.
    expect(mintWorkspaceAttestationV3({...fixtureInput, verdict: JSON.parse(JSON.stringify(fixtureInput.verdict))})).toBeUndefined();
    expect(mintWorkspaceAttestationV3({...input, verdict: fixtureGreenVerdict('push')})?.profile).toBe('push');
    expect(mintWorkspaceAttestationV3({...input, verdict: fixtureGreenVerdict('release')})?.profile).toBe('release');
    expect(mintWorkspaceAttestationV3({...input, verdict: {
      profile: 'completion', assurance_level: 'L2', configured_assurance_level: 'L2', achieved_assurance_level: 'L2',
      scope_sha256: digest, input_sha256: digest, state: 'green', profile_complete: true, results: [],
      independence: 'not-applicable', obligation_sha256: digest,
    }})).toBeUndefined();
  });

  test('keeps scope provenance through invalidation without allowing a stale verdict to mint', () => {
    const verdict = greenVerdict();
    const invalidated = invalidateAssuranceVerdict(verdict);
    const input = {verdict: invalidated, feature: 'F-a', contractSha256: digest, subjectSha256: digest, verificationSha256: digest, runtimeDependencySha256: digest, registrySha256: digest, detectorCatalogSha256: digest, toolIdentity: 'cladding', environmentClass: 'test', trustSnapshotSha256: digest};

    expect(verdictAuthorizesFeature(invalidated, 'F-a', digest)).toBe(true);
    expect(mintWorkspaceAttestationV3(input)).toBeUndefined();
    expect(mintWorkspaceAttestationV3({...input, verdict: greenVerdict('completion', [])})).toBeUndefined();
  });

  test('[covers:F-6f0a2106/AC-6f0a2103] does not mint v3 from six caller-supplied L1 NA stage rows', () => {
    const verdict = reduceLegacyStageAdapter({
      profile: {...assuranceProfile('completion', 'L1'), obligations: ['stage_1.1']}, configuredAssuranceLevel: 'L1',
      completeScope: true, scopeAddresses: ['project'], inputAddresses: ['project'], inputSha256: digest,
      hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6'].map((stage) => ({stage, status: 'na' as const})),
    });
    const input = {verdict, feature: 'F-a', contractSha256: digest, subjectSha256: digest, verificationSha256: digest, runtimeDependencySha256: digest, registrySha256: digest, detectorCatalogSha256: digest, toolIdentity: 'cladding', environmentClass: 'test', trustSnapshotSha256: digest};
    expect(verdict).toMatchObject({state: 'unresolved', profile_complete: false});
    expect(mintWorkspaceAttestationV3(input)).toBeUndefined();
  });

  test('compacts an upstream report failure but rejects other incomplete GREEN result shapes', () => {
    const report = sealedVerdict([
      authorityResult('pass', 'stage_1.1', '1'.repeat(64)),
      authorityResult('fail', 'stage_2.2', '2'.repeat(64), 'report'),
    ]);
    expect(hasSealedAuthority(report)).toBe(true);
    expect(mintWorkspaceAttestationV3(sealedInput(report))?.observation_counts)
      .toEqual({required: 2, pass: 1, na: 0, migration_baseline: 0});

    const hardFailure = sealedVerdict([
      authorityResult('pass', 'stage_1.1', '3'.repeat(64)),
      authorityResult('fail', 'stage_1.2', '4'.repeat(64)),
    ]);
    expect(mintWorkspaceAttestationV3(sealedInput(hardFailure))).toBeUndefined();

    const unobserved = sealedVerdict([
      authorityResult('pass', 'stage_1.1', '5'.repeat(64)),
      authorityResult('unobserved', 'stage_1.2', '6'.repeat(64)),
    ]);
    expect(mintWorkspaceAttestationV3(sealedInput(unobserved))).toBeUndefined();

    const duplicate = sealedVerdict([
      authorityResult('pass', 'stage_1.1', '7'.repeat(64)),
      authorityResult('pass', 'stage_1.1', '8'.repeat(64)),
    ]);
    expect(hasSealedAuthority(duplicate)).toBe(false);
    expect(mintWorkspaceAttestationV3(sealedInput(duplicate))).toBeUndefined();
  });
});
