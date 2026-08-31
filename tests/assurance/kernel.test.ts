// Cladding · assurance kernel tests.

import {describe, expect, test} from 'vitest';

import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile, compileAssuranceReductionPlan, legacyStageProjection, reduceAssurancePlan, type AssuranceReductionPlanInput} from '../../src/assurance/kernel.js';

const reportProfile = {...assuranceProfile('push', 'L2'), obligations: ['stage_2.2']};
const reportObligation = {
  id: 'stage_2.2:project', subject: 'project', assurance_level: 'L2' as const, descriptor: 'stage_2.2',
  input_addresses: ['project'], input_sha256: 'a'.repeat(64), applicability: 'required' as const,
  source_strictness: 'report' as const, blocking: 'hard' as const,
};
const unitObligation = {...reportObligation, id: 'stage_2.1:project', descriptor: 'stage_2.1', assurance_level: 'L2' as const, source_strictness: 'hard' as const};
const cumulativeL1 = ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6'].map((descriptor) => ({
  id: `${descriptor}:project`, subject: 'project', assurance_level: 'L1' as const, descriptor,
  input_addresses: ['project'], input_sha256: 'a'.repeat(64), applicability: 'required' as const,
  source_strictness: 'hard' as const, blocking: 'hard' as const,
}));
const cumulativeProfile = {...assuranceProfile('push', 'L2'), obligations: [...cumulativeL1.map((entry) => entry.descriptor), 'stage_2.2']};
const cumulativeL1Observations = cumulativeL1.map((entry) => ({
  obligation: entry.descriptor, subject: entry.subject, state: 'pass' as const, input_sha256: entry.input_sha256,
  adapter: {id: `legacy-stage:${entry.descriptor}`, version: '1'}, provenance: 'observed' as const,
  assurance: 'verified' as const, observed_at: '1970-01-01T00:00:00.000Z', environment_class: 'test',
}));
function authorityReduce(input: Omit<AssuranceReductionPlanInput, 'applicabilityFacts'>) {
  return reduceAssurancePlan(compileAssuranceReductionPlan({
    ...input,
    applicabilityFacts: {complete: true, hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false},
  }));
}
function observation(state: 'pass' | 'fail' | 'unobserved') {
  return {
    obligation: 'stage_2.2', subject: 'project', state, input_sha256: 'a'.repeat(64),
    adapter: {id: 'legacy-stage:stage_2.2', version: '1'}, provenance: 'observed' as const,
    assurance: 'verified' as const, observed_at: '1970-01-01T00:00:00.000Z', environment_class: 'test', current: true,
  };
}

describe('F6 assurance reducer', () => {
  test('rejects a serialized registry-compiled plan as authority', () => {
    const plan = compileAssuranceReductionPlan({
      profile: assuranceProfile('completion', 'L1'),
      configuredAssuranceLevel: 'L1',
      scopeSha256: 'scope',
      inputSha256: 'a'.repeat(64),
      scopeAddresses: ['feature:F-a'],
      obligations: cumulativeL1,
      observations: cumulativeL1Observations,
      applicabilityFacts: {complete: true, hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false},
    });

    expect(reduceAssurancePlan(plan).state).toBe('green');
    expect(reduceAssurancePlan(JSON.parse(JSON.stringify(plan)))).toMatchObject({state: 'unresolved', profile_complete: false});
  });

  test('reduces hard, report, unobserved, NA, and failure-dominant obligations without a vacuous green', () => {
    const failed = authorityReduce({
      profile: cumulativeProfile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i',
      scopeAddresses: ['project'],
      obligations: [...cumulativeL1, unitObligation, reportObligation],
      observations: [...cumulativeL1Observations, {...observation('pass'), obligation: 'stage_2.1', adapter: {id: 'legacy-stage:stage_2.1', version: '1'}}, observation('pass'), observation('fail')],
    });
    expect(failed.profile_complete).toBe(true);
    expect(failed.state).toBe('red');
    // A report-source failure is standard-complete once all lower cumulative
    // L1 evidence is present, even though Cladding's effective policy stays RED.
    expect(failed.achieved_assurance_level).toBe('L2');
    const missing = authorityReduce({profile: cumulativeProfile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i', scopeAddresses: ['project'], obligations: [], observations: []});
    expect(missing.profile_complete).toBe(false);
    expect(missing.state).toBe('unresolved');
    const na = authorityReduce({profile: reportProfile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i', scopeAddresses: ['project'], obligations: [{...reportObligation, applicability: 'na'}], observations: []});
    expect(na.results.find((result) => result.obligation === 'stage_2.2')?.state).toBe('unobserved');
  });

  test('[covers:F-061/AC-151] current runner proof is derived per obligation from current observations', () => {
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('push', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['project'], inputAddresses: ['project'], inputSha256: 'a'.repeat(64), hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false,
      requiresQuality: false, requiresHuman: false, environmentClass: 'test',
      stages: [
        ...['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3'].map((stage) => ({stage, status: 'pass' as const})),
      ],
    });
    expect(verdict.results.find((result) => result.obligation === 'stage_2.1')?.state).toBe('pass');
    expect(verdict.results.find((result) => result.obligation === 'stage_2.2')?.state).toBe('pass');
  });

  test('derives distinct observation identities when two obligations share one locator', () => {
    const profile = assuranceProfile('completion', 'L1');
    const obligations = profile.obligations.map((descriptor) => ({
      id: `${descriptor}:feature:F-a`, subject: 'feature:F-a', assurance_level: 'L1' as const,
      descriptor, input_addresses: ['feature:F-a'], input_sha256: 'a'.repeat(64),
      applicability: 'required' as const, blocking: 'hard' as const,
    }));
    const verdict = reduceAssurancePlan(compileAssuranceReductionPlan({
      profile, configuredAssuranceLevel: 'L1', scopeSha256: 'scope', inputSha256: 'a'.repeat(64),
      scopeAddresses: ['feature:F-a'], obligations,
      observations: obligations.map((obligation) => ({
        obligation: obligation.descriptor, subject: obligation.subject, state: 'pass' as const,
        input_sha256: obligation.input_sha256, adapter: {id: `legacy-stage:${obligation.descriptor}`, version: '1'},
        provenance: 'observed' as const, assurance: 'verified' as const, locator: 'run:shared',
        observed_at: '1970-01-01T00:00:00.000Z', environment_class: 'test',
      })),
      applicabilityFacts: {complete: true, hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false},
    }));

    const typeIdentity = verdict.results.find((result) => result.obligation === 'stage_1.1')?.observation_identities[0];
    const lintIdentity = verdict.results.find((result) => result.obligation === 'stage_1.2')?.observation_identities[0];
    expect(typeIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(lintIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(typeIdentity).not.toBe(lintIdentity);
  });

  test('preserves schema 0.1 stage projection parity and escalates an incomplete schema 0.2 scope', () => {
    const single = {...assuranceProfile('push', 'L2'), obligations: ['stage_1.1']};
    const legacy = reduceLegacyStageAdapter({
      profile: single, configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['project'], inputAddresses: ['project'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      stages: [{stage: 'stage_1.1', status: 'pass'}], environmentClass: 'test',
    });
    // The profile authority restores every canonical L2 member; the legacy
    // projection still exposes the observed Stage 1 result without inventing
    // a pass for omitted members.
    expect(legacyStageProjection(legacy)).toContainEqual({stage: 'stage_1.1', status: 'pass'});
    expect(legacyStageProjection(legacy)).toContainEqual({stage: 'stage_1.2', status: 'unobserved'});
    const unknown = reduceLegacyStageAdapter({
      profile: single, configuredAssuranceLevel: 'L2', completeScope: false,
      scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      stages: [{stage: 'stage_1.1', status: 'pass'}], environmentClass: 'test',
    });
    expect(unknown).toMatchObject({state: 'unresolved', profile_complete: false});
  });

  test('rejects a caller-narrowed completion profile even when its supplied stage passes', () => {
    const narrowed = {...assuranceProfile('completion', 'L2'), obligations: ['stage_1.1']};
    const verdict = reduceLegacyStageAdapter({
      profile: narrowed, configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      environmentClass: 'test', stages: [{stage: 'stage_1.1', status: 'pass'}],
    });
    expect(verdict).toMatchObject({state: 'unresolved', profile_complete: false});
    expect(verdict.results.map((result) => result.obligation)).toContain('stage_2.2');
  });

  test('retains an adapter pending environment reason as unobserved instead of accepting an asserted result', () => {
    const verdict = authorityReduce({
      profile: reportProfile,
      configuredAssuranceLevel: 'L2',
      scopeSha256: 's',
      inputSha256: 'i',
      scopeAddresses: ['project'],
      obligations: [reportObligation],
      observations: [{...observation('unobserved'), assurance: 'asserted' as const, reason: 'pending_env' as const}],
    });
    expect(verdict).toMatchObject({state: 'unresolved', profile_complete: false});
    expect(verdict.results.find((result) => result.obligation === 'stage_2.2')).toMatchObject({state: 'unobserved', reason: 'pending_env'});
  });

  test('keeps a report-source failure RED and rejects empty, stale-digest, and stale-adapter observations', () => {
    const profile = {...reportProfile, obligations: ['stage_1.1', 'stage_2.2']};
    const hard = {
      id: 'stage_1.1:project', subject: 'project', assurance_level: 'L1' as const, descriptor: 'stage_1.1',
      input_addresses: ['project'], input_sha256: 'a'.repeat(64), applicability: 'required' as const,
      source_strictness: 'hard' as const, blocking: 'hard' as const,
    };
    // The unrelated missing L1 observation must not hide the known report
    // failure: Cladding's effective Coverage policy remains hard.
    const failed = authorityReduce({
      profile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i',
      scopeAddresses: ['project'],
      obligations: [hard, reportObligation], observations: [observation('fail')],
    });
    expect(failed).toMatchObject({state: 'red', profile_complete: false, achieved_assurance_level: 'none'});
    const staleDigest = authorityReduce({
      profile: reportProfile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i', obligations: [reportObligation],
      scopeAddresses: ['project'],
      observations: [{...observation('pass'), input_sha256: 'b'.repeat(64)}],
    });
    const staleAdapter = authorityReduce({
      profile: reportProfile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i', obligations: [reportObligation],
      scopeAddresses: ['project'],
      observations: [{...observation('pass'), adapter: {id: 'legacy-stage:stage_2.2', version: 'obsolete'}}],
    });
    expect(staleDigest.results.find((result) => result.obligation === 'stage_2.2')).toMatchObject({state: 'unobserved', reason: 'stale'});
    expect(staleAdapter.results.find((result) => result.obligation === 'stage_2.2')).toMatchObject({state: 'unobserved', reason: 'stale'});
    expect(authorityReduce({profile: reportProfile, configuredAssuranceLevel: 'L2', scopeSha256: 's', inputSha256: 'i', scopeAddresses: ['project'], obligations: [], observations: []}).state).toBe('unresolved');
  });

  test('[covers:F-033/AC-051][covers:F-033/AC-052] enumerates exact F5 composite criteria for Audit and UAT while blind proof only labels independence', () => {
    const views = [
      {criterion: 'F-a/AC-one', test: {criterion: 'F-a/AC-one', state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0}, audit: 'verified' as const, uat: 'verified' as const, blind: 'verified' as const, assertedEvidence: 0},
      {criterion: 'F-a/AC-two', test: {criterion: 'F-a/AC-two', state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0}, audit: 'verified' as const, uat: 'unverified' as const, blind: 'verified' as const, assertedEvidence: 0},
    ];
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('release', 'L4'), configuredAssuranceLevel: 'L4', completeScope: true,
      scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: true, hasDeliverable: true, requiresQuality: true, requiresHuman: true,
      proofViews: views, environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_2.4', 'stage_3.1', 'stage_3.2', 'stage_3.3']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    expect(verdict.results.filter((result) => result.obligation === 'stage_4.1').map((result) => result.subject)).toEqual(['criterion:F-a/AC-one', 'criterion:F-a/AC-two']);
    expect(verdict.results.filter((result) => result.obligation === 'stage_4.2').map((result) => result.state)).toEqual(['pass', 'unobserved']);
    expect(verdict.independence).toBe('independent');
  });

  test('[covers:F-027/AC-040][covers:F-028/AC-041][covers:F-029/AC-042] applicable missing quality runners remain unobserved, not skipped, NA, or green', () => {
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('completion', 'L3'), configuredAssuranceLevel: 'L3', completeScope: true,
      scopeAddresses: ['feature:F-quality'], inputAddresses: ['feature:F-quality'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: true, requiresHuman: false,
      environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_2.4']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    const qualityStates = Object.fromEntries(
      verdict.results
        .filter((result) => ['stage_3.1', 'stage_3.2', 'stage_3.3'].includes(result.obligation))
        .map((result) => [result.obligation, result.state]),
    );
    expect(qualityStates).toEqual({
      'stage_3.1': 'unobserved',
      'stage_3.2': 'unobserved',
      'stage_3.3': 'unobserved',
    });
    expect(verdict.state).toBe('unresolved');
  });

  test('does not fan one global Unit or Coverage pass into a sibling without a current F5 testcase observation', () => {
    const row = (criterion: string, state: 'verified' | 'unverified') => ({
      criterion,
      test: {criterion, state, matched: state === 'verified' ? 1 : 0, pass: state === 'verified' ? 1 : 0, fail: 0, skip: 0, error: 0},
      audit: 'unverified' as const, uat: 'unverified' as const, blind: 'unverified' as const, assertedEvidence: 0,
    });
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('push', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['feature:F-target', 'feature:F-sibling'], inputAddresses: ['project'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      exactProofRequired: true, proofViews: [row('F-target/AC-a', 'verified'), row('F-sibling/AC-b', 'unverified')], environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    expect(Object.fromEntries(verdict.results.filter((result) => result.obligation === 'stage_2.1').map((result) => [result.subject, result.state])))
      .toEqual({'criterion:F-target/AC-a': 'pass', 'criterion:F-sibling/AC-b': 'unobserved'});
    expect(Object.fromEntries(verdict.results.filter((result) => result.obligation === 'stage_2.2').map((result) => [result.subject, result.state])))
      .toEqual({'criterion:F-target/AC-a': 'pass', 'criterion:F-sibling/AC-b': 'unobserved'});
  });

  test('keeps an un-attributable Coverage failure as a scope summary while exact rows remain current-test bound', () => {
    const criterion = 'F-a/AC-a';
    const view = {criterion, test: {criterion, state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0}, audit: 'unverified' as const, uat: 'unverified' as const, blind: 'unverified' as const, assertedEvidence: 0};
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('push', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      exactProofRequired: true, proofViews: [view], environmentClass: 'test',
      stages: [
        ...['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1']
          .map((stage) => ({stage, status: 'pass' as const})),
        {stage: 'stage_2.2', status: 'fail' as const},
      ],
    });
    expect(verdict.state).toBe('red');
    expect(verdict.results.find((result) => result.obligation === 'stage_2.2' && result.subject.startsWith('scope:'))?.state).toBe('fail');
    expect(verdict.results.find((result) => result.obligation === 'stage_2.2' && result.subject === `criterion:${criterion}`)?.state).toBe('unobserved');
  });

  test('uses only F5 verified blind proof for a policy-required Spec Conformance criterion', () => {
    const criterion = 'F-a/AC-a';
    const view = {criterion, test: {criterion, state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0}, audit: 'unverified' as const, uat: 'unverified' as const, blind: 'verified' as const, assertedEvidence: 0};
    const sibling = {...view, criterion: 'F-a/AC-sibling', test: {...view.test, criterion: 'F-a/AC-sibling'}, blind: 'unverified' as const};
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('push', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: true, oracleRequiredSubjects: new Set([`criterion:${criterion}`]),
      hasDeliverable: false, requiresQuality: false, requiresHuman: false, exactProofRequired: true, proofViews: [view, sibling], environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    expect(verdict.results.find((result) => result.obligation === 'stage_2.3')).toMatchObject({subject: `criterion:${criterion}`, state: 'pass'});
    expect(verdict.results.filter((result) => result.obligation === 'stage_2.3')).toHaveLength(1);
    expect(verdict.results.find((result) => result.obligation === 'stage_4.1')).toBeUndefined();
  });

  test('attributes one F5 execution to Unit, Coverage, and only its exact policy-required blind proof', () => {
    const criterion = 'F-a/AC-a';
    const view = {criterion, test: {criterion, state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0}, audit: 'unverified' as const, uat: 'unverified' as const, blind: 'verified' as const, assertedEvidence: 0};
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('push', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['feature:F-a'], inputAddresses: ['feature:F-a'], inputSha256: 'a'.repeat(64),
      hasExecutableTests: true, hasOracleProof: true, oracleRequiredSubjects: new Set([`criterion:${criterion}`]),
      hasDeliverable: false, requiresQuality: false, requiresHuman: false, exactProofRequired: true, proofViews: [view], environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    for (const descriptor of ['stage_2.1', 'stage_2.2', 'stage_2.3']) {
      expect(verdict.results.find((result) => result.obligation === descriptor)).toMatchObject({subject: `criterion:${criterion}`, state: 'pass'});
    }
  });
});
