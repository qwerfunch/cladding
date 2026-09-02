// Cladding · assurance workspace tests.

import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {readSafeRuntimeModuleClosureBytes, runtimeDependencyClosure, verificationClosure} from '../../src/assurance/closures.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {
  assuranceClosureInputFromWorkspace,
  createWorkspaceAttestations,
  currentProofBindingsFromWorkspace,
  currentProofViewsFromWorkspace,
  featureClosureSeals,
  migrationBaselineCandidatesFromWorkspace,
  runnerConfigurationResolver,
  workspaceProfileSnapshot,
} from '../../src/assurance/workspace.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {
  LEGACY_L2_OBLIGATIONS,
  LEGACY_UNCLASSIFIED,
  criterionFinalIntentFromRecord,
  criterionFinalIntentSha256,
  legacyL2CandidateCensusSha256,
  legacyL2CandidateSha256,
  legacyL2ResolutionSha256,
  type MigrationBaseline,
} from '../../src/spec/compiler/migration-baseline.js';
import type {SpecCompilation} from '../../src/spec/compiler/types.js';
import {prospectiveDoneCompilation} from '../../src/spec/prospective.js';
import {captureCurrentJUnitProof, captureCurrentVitestProof, clearTestRunCache, currentGateProofEvidence, primeTestRunCache} from '../../src/stages/test-run-cache.js';
import {authoritativeFixtureVerdict} from './authoritative-fixture.js';

const roots: string[] = [];

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-assurance-workspace-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  mkdirSync(join(cwd, 'src'), {recursive: true});
  writeFileSync(join(cwd, 'src', 'a.ts'), 'export const value = 1;\n');
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: closure-fixture', '  language: typescript',
    '  purpose: Keep profile closure requirements explicit.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: Closure', 'status: done', 'purpose: Seal required inputs without inventing proof.',
    'modules: [src/a.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-aaaaaaaa', '    kind: behavior', '    statement: The system shall keep closure requirements explicit.', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  return cwd;
}

const baselineFeature = 'F-aaaaaaaa';
const baselineCriterion = 'AC-bbbbbbbb';
const baselineSubject = `criterion:${baselineFeature}/${baselineCriterion}`;

function baselineReceipt(
  record: Record<string, unknown>,
  bindings: readonly {readonly raw: string; readonly selector?: string}[] = [],
  decision: 'accept' | 'reject' = 'accept',
  featureId = baselineFeature,
  criterionId = baselineCriterion,
): MigrationBaseline {
  const subject = `criterion:${featureId}/${criterionId}`;
  const previewSha256 = 'a'.repeat(64);
  const candidateCensusSha256 = legacyL2CandidateCensusSha256([subject]);
  const resolutionSha256 = legacyL2ResolutionSha256({
    previewSha256, decision, candidateCount: 1, candidateCensusSha256,
  });
  const finalIntent = criterionFinalIntentFromRecord(record);
  if (finalIntent === undefined) throw new Error('baseline fixture requires final intent');
  const authorization = {
    criterion: subject,
    sourceStatus: 'done' as const,
    finalIntentSha256: criterionFinalIntentSha256(finalIntent),
    obligations: LEGACY_L2_OBLIGATIONS,
    candidateSha256: '',
    resolutionSha256,
  };
  return {
    schema: 1,
    sourceSchema: '0.1',
    project: {address: 'project', legacyIntent: 'Keep migration receipt candidates explicit.'},
    features: [],
    criteria: [{
      address: subject,
      legacyIntent: {text: typeof record.statement === 'string' ? record.statement : 'missing'},
      classification: LEGACY_UNCLASSIFIED,
      bindings: bindings.map((binding) => ({channel: 'test' as const, ...binding})),
      exemption: {id: `legacy:${subject}`, subject, reason: 'legacy_criterion_intent'},
    }],
    scenarios: [],
    legacyL2Baseline: {
      decision, previewSha256, candidateCount: 1, candidateCensusSha256, resolutionSha256,
      authorizations: decision === 'accept'
        ? [{...authorization, candidateSha256: legacyL2CandidateSha256(authorization)}]
        : [],
    },
  };
}

function baselineCompilation(
  cwd: string,
  record: Record<string, unknown>,
  baseline: MigrationBaseline,
  featureId = baselineFeature,
  criterionId = baselineCriterion,
): SpecCompilation {
  writeFileSync(join(cwd, 'feature.yaml'), JSON.stringify({id: featureId, acceptance_criteria: [record]}));
  return {
    schemaVersion: '0.2',
    contract: {
      features: [{
        id: featureId,
        status: 'done',
        acceptanceCriteria: [{
          id: criterionId,
          statement: record.statement as string,
          constraintRefs: [],
          ...(typeof record.kind === 'string' ? {kind: record.kind} : {}),
        }],
      }],
    },
    migrationBaseline: baseline,
    nodes: [{
      address: `feature:${featureId}`,
      nodeType: 'semantic',
      kind: 'feature',
      source: {path: 'feature.yaml'},
    }],
  } as unknown as SpecCompilation;
}

function addDoneSiblingFeature(cwd: string): void {
  writeFileSync(join(cwd, 'src', 'b.ts'), 'export const sibling = 2;\n');
  writeFileSync(join(cwd, 'spec', 'features', 'sibling-bbbbbbbb.yaml'), [
    'id: F-bbbbbbbb', 'title: Sibling', 'status: done', 'purpose: Keep sibling authority separate.',
    'modules: [src/b.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall retain feature-specific authority.', '',
  ].join('\n'));
  mkdirSync(join(cwd, 'tests'), {recursive: true});
  writeFileSync(join(cwd, 'tests', 'authority.test.ts'), [
    "it('[covers:F-aaaaaaaa/AC-aaaaaaaa] keeps authority scoped', () => {});",
    "it('[covers:F-bbbbbbbb/AC-bbbbbbbb] keeps sibling authority scoped', () => {});", '',
  ].join('\n'));
}

function greenVerdict(scopeAddresses: readonly string[], inputSha256: string) {
  const proofViews = scopeAddresses.flatMap((address) => {
    const feature = /^feature:(F-)(.+)$/.exec(address);
    if (!feature) return [];
    const criterion = `${feature[1]}${feature[2]}/AC-${feature[2]}`;
    return [{
      criterion,
      test: {criterion, state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0},
      audit: 'unverified' as const, uat: 'unverified' as const, blind: 'unverified' as const, assertedEvidence: 0,
    }];
  });
  return authoritativeFixtureVerdict(reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses, inputAddresses: scopeAddresses, inputSha256,
    hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
    proofViews, exactProofRequired: true,
    environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2']
      .map((stage) => ({stage, status: 'pass' as const})),
  }));
}

afterEach(() => {
  for (const cwd of roots.splice(0)) rmSync(cwd, {recursive: true, force: true});
});

describe('F6 workspace profile closure', () => {
  test('classifies only accepted unchanged, mechanism-free migration baseline candidates', () => {
    const cwd = fixture();
    const record = {id: baselineCriterion, statement: 'The system shall preserve the migrated baseline.'};
    const baseline = baselineReceipt(record, [{raw: 'tests/historic.test.ts'}]);
    const compilation = baselineCompilation(cwd, record, baseline);
    expect(migrationBaselineCandidatesFromWorkspace(cwd, compilation, [`feature:${baselineFeature}`]))
      .toEqual([expect.objectContaining({subject: baselineSubject, obligations: ['stage_2.1', 'stage_2.2']})]);

    writeFileSync(join(cwd, 'feature.yaml'), JSON.stringify({
      id: baselineFeature,
      acceptance_criteria: [{...record, statement: 'The system shall revoke the old final intent.'}],
    }));
    expect(migrationBaselineCandidatesFromWorkspace(cwd, compilation, [`feature:${baselineFeature}`])).toEqual([]);

    writeFileSync(join(cwd, 'feature.yaml'), JSON.stringify({id: baselineFeature, acceptance_criteria: [record]}));
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    writeFileSync(join(cwd, 'tests', 'live.test.ts'), `it('[covers:${baselineFeature}/${baselineCriterion}] current', () => {});\n`);
    expect(migrationBaselineCandidatesFromWorkspace(cwd, compilation, [`feature:${baselineFeature}`])).toEqual([]);
  });

  test('seals a validated migration receipt into closure input and refuses an invalid managed receipt', () => {
    const cwd = fixture();
    const generated = join(cwd, 'spec', 'generated');
    mkdirSync(generated, {recursive: true});
    const record = {id: 'AC-aaaaaaaa', statement: 'The system shall keep closure requirements explicit.'};
    const baseline = baselineReceipt(record, [], 'accept', 'F-aaaaaaaa', 'AC-aaaaaaaa');
    const path = join(generated, 'migration-baseline-0.1-to-0.2.yaml');
    writeFileSync(path, JSON.stringify(baseline));
    const valid = compileSpecWorkspace(cwd);
    const validInput = assuranceClosureInputFromWorkspace(cwd, valid);
    expect(validInput.migrationBaselineReceiptSha256).toMatch(/^[a-f0-9]{64}$/);
    const validSnapshot = workspaceProfileSnapshot(cwd, valid, {
      profile: assuranceProfile('completion', 'L1'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    });

    writeFileSync(path, '[]\n');
    const invalid = compileSpecWorkspace(cwd);
    const invalidInput = assuranceClosureInputFromWorkspace(cwd, invalid);
    const invalidSnapshot = workspaceProfileSnapshot(cwd, invalid, {
      profile: assuranceProfile('completion', 'L1'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    });
    expect(invalid.nodes.map((node) => node.address)).toContain('artifact:spec/generated/migration-baseline-0.1-to-0.2.yaml');
    expect(invalidInput.migrationBaselineReceiptSha256).toBeNull();
    expect(invalidSnapshot.inputSha256).not.toBe(validSnapshot.inputSha256);
    expect(createWorkspaceAttestations({
      cwd, compilation: invalid, verdict: greenVerdict(['feature:F-aaaaaaaa'], invalidSnapshot.inputSha256), featureIds: ['F-aaaaaaaa'],
      detectorCatalogSha256: 'a'.repeat(64), toolIdentity: 'cladding-test', environmentClass: 'test', trustSnapshotSha256: 'b'.repeat(64),
    })).toEqual([]);
  });

  test('revokes authorization when authored constraint refs change between omission and an explicit empty list', () => {
    const omitted = {
      id: baselineCriterion,
      kind: 'behavior',
      statement: 'The system shall preserve authored final-intent shape.',
    };
    const explicitEmpty = {...omitted, constraint_refs: []};

    const omissionToEmpty = fixture();
    expect(migrationBaselineCandidatesFromWorkspace(
      omissionToEmpty,
      baselineCompilation(omissionToEmpty, explicitEmpty, baselineReceipt(omitted)),
      [`feature:${baselineFeature}`],
    )).toEqual([]);

    const emptyToOmission = fixture();
    expect(migrationBaselineCandidatesFromWorkspace(
      emptyToOmission,
      baselineCompilation(emptyToOmission, omitted, baselineReceipt(explicitEmpty)),
      [`feature:${baselineFeature}`],
    )).toEqual([]);
  });

  test('fails closed for rejected, malformed, exact historic, and registered-static receipt selections', () => {
    const record = {id: baselineCriterion, statement: 'The system shall preserve the migrated baseline.'};
    const rejectedCwd = fixture();
    expect(migrationBaselineCandidatesFromWorkspace(rejectedCwd, baselineCompilation(rejectedCwd, record, baselineReceipt(record, [], 'reject')), [`feature:${baselineFeature}`])).toEqual([]);

    const oldCwd = fixture();
    const oldReceipt = {...baselineReceipt(record)};
    delete (oldReceipt as {legacyL2Baseline?: unknown}).legacyL2Baseline;
    expect(migrationBaselineCandidatesFromWorkspace(oldCwd, baselineCompilation(oldCwd, record, oldReceipt), [`feature:${baselineFeature}`])).toEqual([]);

    const malformedCwd = fixture();
    const malformed = baselineReceipt(record);
    const broken = JSON.parse(JSON.stringify(malformed)) as MigrationBaseline;
    (broken.legacyL2Baseline!.authorizations[0] as {finalIntentSha256: string}).finalIntentSha256 = 'invalid';
    expect(migrationBaselineCandidatesFromWorkspace(malformedCwd, baselineCompilation(malformedCwd, record, broken), [`feature:${baselineFeature}`])).toEqual([]);

    const exactCwd = fixture();
    expect(migrationBaselineCandidatesFromWorkspace(exactCwd, baselineCompilation(exactCwd, record,
      baselineReceipt(record, [{raw: 'tests/historic.test.ts#named case', selector: 'named case'}])), [`feature:${baselineFeature}`])).toEqual([]);

    const reviewedCwd = fixture();
    const reviewedRecord = {...record, kind: 'behavior'};
    const reviewedBaseline = baselineReceipt(reviewedRecord, [{raw: 'tests/reviewed.test.ts#named case', selector: 'named case'}]);
    const reviewed: MigrationBaseline = {
      ...reviewedBaseline,
      reviewedCarryForwards: [{
        criterion: baselineSubject,
        intent: {statement: reviewedRecord.statement, kind: 'behavior'},
        bindings: [{
          raw: 'tests/reviewed.test.ts#named case', file: 'tests/reviewed.test.ts', selector: 'named case', sha256: 'b'.repeat(64),
        }],
      }],
    };
    expect(migrationBaselineCandidatesFromWorkspace(reviewedCwd, baselineCompilation(reviewedCwd, reviewedRecord, reviewed), [`feature:${baselineFeature}`])).toEqual([]);

    const staticCwd = fixture();
    const staticRecord = {id: 'AC-25f77cec', statement: 'The system shall use registered static evidence.'};
    const staticBaseline = baselineReceipt(staticRecord, [], 'accept', 'F-dd8dc994', 'AC-25f77cec');
    const staticCompilation = baselineCompilation(staticCwd, staticRecord, staticBaseline, 'F-dd8dc994', 'AC-25f77cec');
    expect(migrationBaselineCandidatesFromWorkspace(staticCwd, staticCompilation, ['feature:F-dd8dc994'])).toEqual([]);
  });

  test('keeps a required missing binding sealed but locally unobserved', () => {
    const cwd = fixture();
    const compilation = compileSpecWorkspace(cwd);
    const request = {scopeAddresses: ['feature:F-aaaaaaaa'], oracleRequiredSubjects: new Set<string>(), requiresHuman: false};
    const l1 = workspaceProfileSnapshot(cwd, compilation, {
      ...request, profile: assuranceProfile('completion', 'L1'), hasExecutableTests: false,
    });
    const l2 = workspaceProfileSnapshot(cwd, compilation, {
      ...request, profile: assuranceProfile('completion', 'L2'), hasExecutableTests: true,
    });
    expect(l1.complete).toBe(true);
    expect(l2.complete).toBe(true);
    expect(l2.incompleteAddresses).not.toContain('verification:F-aaaaaaaa/AC-aaaaaaaa');
    const proofViews = currentProofViewsFromWorkspace(cwd, compilation, l2.effectiveScopeAddresses);
    expect(proofViews[0]?.test.state).toBe('unverified');
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: l2.complete,
      scopeAddresses: l2.effectiveScopeAddresses, inputAddresses: l2.effectiveScopeAddresses, inputSha256: l2.inputSha256,
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      proofViews, exactProofRequired: true, environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    expect(verdict).toMatchObject({state: 'unresolved', profile_complete: false});
    for (const obligation of ['stage_2.1', 'stage_2.2']) {
      expect(verdict.results.find((result) => result.obligation === obligation))
        .toMatchObject({subject: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', state: 'unobserved'});
    }
  });

  test('uses compiler lifecycle facts despite an injected closure lifecycle claim', () => {
    const cwd = fixture();
    const request = {
      profile: assuranceProfile('completion', 'L2'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: true, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    const unsafeProof = {
      address: 'F-aaaaaaaa/AC-aaaaaaaa', path: 'tests/unsafe.test.ts',
      bindingState: 'unsafe' as const, runnerConfig: {complete: true},
    };
    const done = compileSpecWorkspace(cwd);
    const doneClosures = assuranceClosureInputFromWorkspace(cwd, done);
    const compilerOwnedRequest = {...request, hasExecutableTests: false};
    const noBindingCensus = workspaceProfileSnapshot(cwd, done, {
      ...compilerOwnedRequest, closureInput: {...doneClosures, executableProofFeatureIds: []},
    });
    const forgedBindingCensus = workspaceProfileSnapshot(cwd, done, {
      ...compilerOwnedRequest, closureInput: {...doneClosures, executableProofFeatureIds: ['F-aaaaaaaa']},
    });
    const callerClaimedApplicable = workspaceProfileSnapshot(cwd, done, {
      ...request, closureInput: {...doneClosures, executableProofFeatureIds: []},
    });
    expect(forgedBindingCensus.inputSha256).toBe(noBindingCensus.inputSha256);
    expect(callerClaimedApplicable.inputSha256).toBe(noBindingCensus.inputSha256);
    const omittedStatus = {...doneClosures, proofInputs: [unsafeProof]};
    const omittedStatusSnapshot = workspaceProfileSnapshot(cwd, done, {...request, closureInput: omittedStatus});
    expect(omittedStatusSnapshot.complete).toBe(false);
    expect(omittedStatusSnapshot.incompleteAddresses).toContain('verification:F-aaaaaaaa/AC-aaaaaaaa');
    // `status` is deliberately not part of this input contract. The extra
    // field models an untrusted caller attempting to suppress a done subject.
    const forgedPlanned = {
      ...doneClosures,
      features: doneClosures.features.map((feature) => ({...feature, status: 'planned' as const})),
      proofInputs: [unsafeProof],
    };
    const doneSnapshot = workspaceProfileSnapshot(cwd, done, {...request, closureInput: forgedPlanned});
    expect(doneSnapshot.complete).toBe(false);
    expect(doneSnapshot.incompleteAddresses).toContain('verification:F-aaaaaaaa/AC-aaaaaaaa');
    const doneVerdict = reduceLegacyStageAdapter({
      profile: request.profile, configuredAssuranceLevel: 'L2', completeScope: doneSnapshot.complete,
      scopeAddresses: doneSnapshot.effectiveScopeAddresses, inputAddresses: doneSnapshot.effectiveScopeAddresses,
      inputSha256: doneSnapshot.inputSha256, hasExecutableTests: true,
      hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      proofViews: currentProofViewsFromWorkspace(cwd, done, doneSnapshot.effectiveScopeAddresses),
      exactProofRequired: true, environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    expect(doneVerdict).toMatchObject({state: 'unresolved', profile_complete: false});

    const feature = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    writeFileSync(feature, readFileSync(feature, 'utf8').replace('status: done', 'status: planned'));
    const planned = compileSpecWorkspace(cwd);
    const plannedClosures = assuranceClosureInputFromWorkspace(cwd, planned);
    const forgedDone = {
      ...plannedClosures,
      features: plannedClosures.features.map((entry) => ({...entry, status: 'done' as const})),
      proofInputs: [unsafeProof],
    };
    const plannedSnapshot = workspaceProfileSnapshot(cwd, planned, {...request, closureInput: forgedDone});
    expect(plannedSnapshot.complete).toBe(true);
    expect(plannedSnapshot.incompleteAddresses).not.toContain('verification:F-aaaaaaaa/AC-aaaaaaaa');
    expect(currentProofViewsFromWorkspace(cwd, planned, plannedSnapshot.effectiveScopeAddresses)).toEqual([]);
  });

  test('includes reviewed carry-forward baseline tests in verification and executable feature detection', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'spec', 'generated'), {recursive: true});
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const bytes = 'it("historic reviewed case", () => {});\n';
    writeFileSync(join(cwd, 'tests', 'reviewed.test.ts'), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(cwd, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify({
      schema: 1, sourceSchema: '0.1', project: {address: 'project'}, features: [], scenarios: [],
      criteria: [{
        address: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', legacyIntent: {text: 'The system shall keep closure requirements explicit.'},
        classification: 'legacy_unclassified', bindings: [{channel: 'test', raw: 'tests/reviewed.test.ts#historic reviewed case', selector: 'historic reviewed case'}],
        exemption: {id: 'legacy-closure', subject: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', reason: 'legacy_criterion_intent'},
      }],
      reviewedCarryForwards: [{
        criterion: 'criterion:F-aaaaaaaa/AC-aaaaaaaa',
        intent: {statement: 'The system shall keep closure requirements explicit.', kind: 'behavior'},
        bindings: [{raw: 'tests/reviewed.test.ts#historic reviewed case', file: 'tests/reviewed.test.ts', selector: 'historic reviewed case', sha256}],
      }],
    }));
    const compilation = compileSpecWorkspace(cwd);
    const closures = assuranceClosureInputFromWorkspace(cwd, compilation);
    expect(closures.executableProofFeatureIds).toContain('F-aaaaaaaa');
    expect(closures.proofInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({bindingProvenance: 'reviewed_carry_forward', bindingState: 'available', expectedBindingSha256: sha256, path: 'tests/reviewed.test.ts'}),
    ]));
    const request = {
      profile: assuranceProfile('completion', 'L2'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: true, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    expect(workspaceProfileSnapshot(cwd, compilation, request).complete).toBe(true);
    writeFileSync(join(cwd, 'tests', 'reviewed.test.ts'), `${bytes}// byte drift\n`);
    const stale = assuranceClosureInputFromWorkspace(cwd, compilation);
    expect(stale.proofInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({bindingProvenance: 'reviewed_carry_forward', bindingState: 'stale'}),
    ]));
    expect(stale.executableProofFeatureIds).not.toContain('F-aaaaaaaa');
    expect(workspaceProfileSnapshot(cwd, compilation, {...request, closureInput: stale}).complete).toBe(true);
  });

  test('seals declared runner controls and fails closed for an unknown control', () => {
    const cwd = fixture();
    const compilation = compileSpecWorkspace(cwd);
    const request = {
      profile: assuranceProfile('completion', 'L1'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    const baseline = workspaceProfileSnapshot(cwd, compilation, request).inputSha256;
    for (const [path, bytes] of [
      ['vitest.config.ts', 'export default {};\n'],
      ['tsconfig.app.json', '{"compilerOptions":{}}\n'],
      ['eslint.config.js', 'export default [];\n'],
      ['package-lock.json', '{"lockfileVersion":3}\n'],
    ]) {
      writeFileSync(join(cwd, path), bytes);
      expect(workspaceProfileSnapshot(cwd, compilation, request).inputSha256).not.toBe(baseline);
      writeFileSync(join(cwd, path), `${bytes}// changed\n`);
      expect(workspaceProfileSnapshot(cwd, compilation, request).inputSha256).not.toBe(baseline);
    }
    writeFileSync(join(cwd, 'unknown-runner.config.ts'), 'export default {};\n');
    const unknown = workspaceProfileSnapshot(cwd, compilation, request);
    expect(unknown.complete).toBe(false);
    expect(unknown.incompleteAddresses).toContain('runner-controls');
  });

  test('reads trailing runtime directories without changing their authored identity', () => {
    const cwd = fixture();
    const feature = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    const authored = readFileSync(feature, 'utf8');
    mkdirSync(join(cwd, 'src', 'runtime', 'nested'), {recursive: true});
    writeFileSync(join(cwd, 'src', 'runtime', 'entry.ts'), 'export const entry = 1;\n');
    writeFileSync(join(cwd, 'src', 'runtime', 'nested', 'child.ts'), 'export const child = 1;\n');
    const closureFor = (module: string) => {
      writeFileSync(feature, authored.replace('modules: [src/a.ts]', `modules: [${JSON.stringify(module)}]`));
      const input = assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd));
      return {input, closure: runtimeDependencyClosure(input, 'F-aaaaaaaa')};
    };

    const bare = closureFor('src/runtime');
    const trailing = closureFor('src/runtime/');
    const backslash = closureFor('src/runtime\\');
    expect(bare.closure.complete).toBe(true);
    expect(trailing.closure.complete).toBe(true);
    expect(backslash.closure.complete).toBe(true);
    expect(bare.input.runtimeDependencies?.[0]?.bytes).toEqual(trailing.input.runtimeDependencies?.[0]?.bytes);
    expect(trailing.closure.records.map((record) => record.address)).toContain('runtime:F-aaaaaaaa:src/runtime/');
    expect(backslash.closure.records.map((record) => record.address)).toContain('runtime:F-aaaaaaaa:src/runtime\\');
    expect(trailing.closure.sha256).not.toBe(bare.closure.sha256);

    const before = trailing.closure.sha256;
    writeFileSync(join(cwd, 'src', 'runtime', 'nested', 'child.ts'), 'export const child = 2;\n');
    expect(closureFor('src/runtime/').closure.sha256).not.toBe(before);
  });

  test('[covers:F-6f0a2106/AC-6f0a2112] an unbuilt module inside the spec-first window keeps the profile snapshot complete', () => {
    const cwd = fixture();
    const shard = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    const authored = readFileSync(shard, 'utf8').replace('modules: [src/a.ts]', 'modules: [src/not-built-yet.ts]');
    const request = {
      profile: assuranceProfile('completion', 'L2'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    const snapshotFor = (source: string) => {
      writeFileSync(shard, source);
      return workspaceProfileSnapshot(cwd, compileSpecWorkspace(cwd), request);
    };

    const planned = snapshotFor(authored.replace('status: done', 'status: in_progress'));
    const completed = snapshotFor(authored);
    expect(planned.incompleteAddresses).not.toContain('runtime:F-aaaaaaaa');
    expect(planned.complete).toBe(true);
    expect(completed.incompleteAddresses).toContain('runtime:F-aaaaaaaa');
    expect(completed.complete).toBe(false);

    // The unbuilt feature still contributes its contract and runtime digests,
    // so building the declared module changes the snapshot identity even while
    // the feature stays inside the spec-first window.
    writeFileSync(join(cwd, 'src', 'not-built-yet.ts'), 'export const built = 1;\n');
    expect(snapshotFor(authored.replace('status: done', 'status: in_progress')).inputSha256)
      .not.toBe(planned.inputSha256);
  });

  test('[covers:F-6f0a2106/AC-6f0a2112] reads a trailing-separator evidence declaration while a symlinked member stays unresolved', () => {
    const cwd = fixture();
    const shard = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    mkdirSync(join(cwd, 'docs', 'evidence'), {recursive: true});
    writeFileSync(join(cwd, 'docs', 'evidence', 'record.md'), 'observed evidence\n');
    writeFileSync(shard, readFileSync(shard, 'utf8').replace(
      '    statement: The system shall keep closure requirements explicit.',
      '    statement: The system shall keep closure requirements explicit.\n    evidence_refs: [docs/evidence/]',
    ));
    const declaredProof = () => assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd))
      .proofInputs?.find((proof) => proof.path === 'docs/evidence/');

    const resolved = declaredProof();
    // The authored spelling stays the binding identity; only the read is
    // normalized.
    expect(resolved?.path).toBe('docs/evidence/');
    expect(resolved?.evidence?.resolvedBytes).toBeDefined();
    expect(resolved?.sourceBytes).toBeDefined();
    expect(verificationClosure(assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd)), 'F-aaaaaaaa/AC-aaaaaaaa').complete).toBe(true);

    symlinkSync(join(cwd, 'src', 'a.ts'), join(cwd, 'docs', 'evidence', 'link.ts'));
    const symlinked = declaredProof();
    expect(symlinked?.path).toBe('docs/evidence/');
    expect(symlinked?.evidence?.resolvedBytes).toBeUndefined();
    expect(symlinked?.sourceBytes).toBeUndefined();
  });

  test('rejects unsafe runtime-directory spellings after trailing-separator normalization', () => {
    for (const module of ['src/runtime/../runtime/', 'src//runtime/', '/', 'src/link/']) {
      const cwd = fixture();
      mkdirSync(join(cwd, 'src', 'runtime'), {recursive: true});
      writeFileSync(join(cwd, 'src', 'runtime', 'entry.ts'), 'export const entry = 1;\n');
      if (module === 'src/link/') symlinkSync(join(cwd, 'src', 'runtime'), join(cwd, 'src', 'link'));
      expect(readSafeRuntimeModuleClosureBytes(cwd, module)).toBeUndefined();
    }
  });

  test('admits only the explicit eslint repository-root scan adapter', () => {
    const cwd = fixture();
    const resolve = () => runnerConfigurationResolver(cwd)('profile', 'release');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {lint: 'eslint .'}}));
    const exact = resolve();
    expect(exact).toMatchObject({complete: true, unknown_controls: []});
    expect(exact.controls).toHaveProperty('package.json');

    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {lint: 'eslint    .'}}));
    const spacingChanged = resolve();
    expect(spacingChanged.complete).toBe(true);
    expect(spacingChanged.controls['package.json']).not.toBe(exact.controls['package.json']);

    for (const script of ['node .', 'custom-runner .', 'eslint ..', 'eslint --config eslint.config.js']) {
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {lint: script}}));
      const rejected = resolve();
      expect(rejected.complete).toBe(false);
      expect(rejected.controls['package.json']).not.toBe(exact.controls['package.json']);
    }
  });

  test('ignores ordinary config-like content while retaining known nested package controls', () => {
    const cwd = fixture();
    for (const [path, bytes] of [
      ['src/stages/gate-config.ts', 'export const gate = true;\n'],
      ['src/assurance/workspace.ts', 'export const workspace = true;\n'],
      ['tests/helpers/example-config.test.ts', 'export const test = true;\n'],
      ['spec/features/lint-config.yaml', 'id: F-lint-config\n'],
      ['docs/reference/configuration-config.md', '# configuration\n'],
      ['.codex/config.toml', '[agent]\n'],
      ['.cladding/graph/.obsidian/workspace.json', '{}\n'],
      ['docs/fixtures/sample-package/package.json', '{"name":"sample-package"}\n'],
      ['docs/fixtures/sample-package/vite.config.ts', 'export default {};\n'],
      ['docs/fixtures/sample-package/tailwind.config.ts', 'export default {};\n'],
    ] as const) {
      mkdirSync(join(cwd, path.split('/').slice(0, -1).join('/')), {recursive: true});
      writeFileSync(join(cwd, path), bytes);
    }

    const before = runnerConfigurationResolver(cwd)('profile', 'release');
    expect(before).toMatchObject({complete: true, unknown_controls: []});
    expect(before.controls).toHaveProperty('docs/fixtures/sample-package/package.json');
    expect(before.controls).toHaveProperty('docs/fixtures/sample-package/vite.config.ts');
    expect(before.controls).not.toHaveProperty('docs/fixtures/sample-package/tailwind.config.ts');

    writeFileSync(join(cwd, 'docs', 'fixtures', 'sample-package', 'tailwind.config.ts'), 'export default {theme: {}};\n');
    const after = runnerConfigurationResolver(cwd)('profile', 'release');
    expect(after).toMatchObject({complete: true, unknown_controls: []});
    expect(after.controls).toEqual(before.controls);
  });

  test('seals nested legacy/config-module controls and their transitive bytes', () => {
    const cwd = fixture();
    const compilation = compileSpecWorkspace(cwd);
    const request = {
      profile: assuranceProfile('completion', 'L1'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    const digest = (): string => workspaceProfileSnapshot(cwd, compilation, request).inputSha256;
    const baseline = digest();

    mkdirSync(join(cwd, 'packages', 'worker', 'config'), {recursive: true});
    writeFileSync(join(cwd, 'packages', 'worker', 'package.json'), '{"name":"worker"}\n');
    writeFileSync(join(cwd, 'packages', 'worker', '.eslintrc.js'), 'module.exports = require("./config/base.js");\n');
    writeFileSync(join(cwd, 'packages', 'worker', 'config', 'base.js'), 'module.exports = {rules: {semi: "error"}};\n');
    const nested = digest();
    expect(nested).not.toBe(baseline);
    writeFileSync(join(cwd, 'packages', 'worker', 'config', 'base.js'), 'module.exports = {rules: {semi: "off"}};\n');
    expect(digest()).not.toBe(nested);

    mkdirSync(join(cwd, 'configs'), {recursive: true});
    writeFileSync(join(cwd, 'tsconfig.json'), [
      '{', '  // JSONC comments, trailing commas, and identifier keys are legal.',
      '  extends: "./configs/base",', '  references: [{path: "./configs/referenced",},],',
      '  compilerOptions: {strict: true, target: "ES2022",},', '}', '',
    ].join('\n'));
    writeFileSync(join(cwd, 'configs', 'base.json'), '{"compilerOptions":{"strict":true}}\n');
    writeFileSync(join(cwd, 'configs', 'referenced.json'), '{"compilerOptions":{"composite":true}}\n');
    const extended = digest();
    writeFileSync(join(cwd, 'configs', 'base.json'), '{"compilerOptions":{"strict":false}}\n');
    expect(digest()).not.toBe(extended);
    const referenced = digest();
    writeFileSync(join(cwd, 'configs', 'referenced.json'), '{"compilerOptions":{"composite":false}}\n');
    expect(digest()).not.toBe(referenced);

    writeFileSync(join(cwd, 'vitest.config.ts'), 'import {shared} from "./runner-base"; export default shared;\n');
    writeFileSync(join(cwd, 'runner-base.ts'), 'export const shared = {test: {pool: "forks"}};\n');
    const imported = digest();
    writeFileSync(join(cwd, 'runner-base.ts'), 'export const shared = {test: {pool: "threads"}};\n');
    expect(digest()).not.toBe(imported);
  });

  test('seals static gate commands and package-script chains through their local runner modules', () => {
    const cwd = fixture();
    const compilation = compileSpecWorkspace(cwd);
    const request = {
      profile: assuranceProfile('completion', 'L1'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    const digest = (): string => workspaceProfileSnapshot(cwd, compilation, request).inputSha256;

    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    mkdirSync(join(cwd, 'tools'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  commands:\n    test: [node, tools/custom-runner.js]\n');
    writeFileSync(join(cwd, 'tools', 'custom-runner.js'), 'import "./gate-runner-options.js";\n');
    writeFileSync(join(cwd, 'tools', 'gate-runner-options.js'), 'export const pool = "forks";\n');
    const gateDigest = digest();
    writeFileSync(join(cwd, 'tools', 'gate-runner-options.js'), 'export const pool = "threads";\n');
    expect(digest()).not.toBe(gateDigest);

    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {
      pretest: 'node hooks/pre-test.js',
      test: 'npm run verify && node tools/package-runner.js',
      posttest: 'node hooks/post-test.js',
      preverify: 'node hooks/pre-verify.js',
      verify: 'node tools/verify-runner.js',
      postverify: 'npm run test && node hooks/post-verify.js',
    }}));
    mkdirSync(join(cwd, 'hooks'), {recursive: true});
    writeFileSync(join(cwd, 'tools', 'package-runner.js'), 'export const command = "package";\n');
    writeFileSync(join(cwd, 'tools', 'verify-runner.js'), 'export const command = "verify";\n');
    writeFileSync(join(cwd, 'hooks', 'pre-test.js'), 'export const phase = "pre-test";\n');
    writeFileSync(join(cwd, 'hooks', 'post-test.js'), 'export const phase = "post-test";\n');
    writeFileSync(join(cwd, 'hooks', 'pre-verify.js'), 'export const phase = "pre-verify";\n');
    writeFileSync(join(cwd, 'hooks', 'post-verify.js'), 'export const phase = "post-verify";\n');
    const packageDigest = digest();
    writeFileSync(join(cwd, 'hooks', 'post-verify.js'), 'export const phase = "post-verify changed";\n');
    expect(digest()).not.toBe(packageDigest);

    // A bare positional script is still cwd-relative for known interpreters.
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'node runner.js'}}));
    writeFileSync(join(cwd, 'runner.js'), 'export const command = "bare";\n');
    const bareNodeDigest = digest();
    writeFileSync(join(cwd, 'runner.js'), 'export const command = "bare changed";\n');
    expect(digest()).not.toBe(bareNodeDigest);

    // A package-manager-selected `start` script is not a test/lint alias:
    // its own pre/start/post lifecycle must still join the closure.
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {
      test: 'npm start', prestart: 'node hooks/pre-start.js', start: 'node start-runner.js', poststart: 'node hooks/post-start.js',
    }}));
    writeFileSync(join(cwd, 'hooks', 'pre-start.js'), 'export const phase = "pre-start";\n');
    writeFileSync(join(cwd, 'start-runner.js'), 'export const command = "start";\n');
    writeFileSync(join(cwd, 'hooks', 'post-start.js'), 'export const phase = "post-start";\n');
    const startDigest = digest();
    writeFileSync(join(cwd, 'hooks', 'post-start.js'), 'export const phase = "post-start changed";\n');
    expect(digest()).not.toBe(startDigest);

    // Only a direct package-manager lifecycle is traversed. Its selected
    // script's bare runner is therefore part of the immutable control census.
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'npm run exec', exec: 'node runner.js'}}));
    writeFileSync(join(cwd, 'runner.js'), 'export const command = "lifecycle before";\n');
    const lifecycleDigest = digest();
    writeFileSync(join(cwd, 'runner.js'), 'export const command = "lifecycle after";\n');
    expect(digest()).not.toBe(lifecycleDigest);

    // The Vitest adapter seals its explicitly selected local config instead
    // of silently discarding a bare argument after `--config`.
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'vitest --config cfg.js'}}));
    writeFileSync(join(cwd, 'cfg.js'), 'export default {test: {pool: "forks"}};\n');
    const vitestConfigDigest = digest();
    writeFileSync(join(cwd, 'cfg.js'), 'export default {test: {pool: "threads"}};\n');
    expect(digest()).not.toBe(vitestConfigDigest);

    // A command without an adapter still seals an existing bare local file.
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'custom-runner cfg.js'}}));
    const genericConfigDigest = digest();
    writeFileSync(join(cwd, 'cfg.js'), 'export default {test: {pool: "isolated"}};\n');
    expect(digest()).not.toBe(genericConfigDigest);
  });

  test('freezes one full runner-control census per resolver', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    mkdirSync(join(cwd, 'tools'), {recursive: true});
    writeFileSync(join(cwd, 'tools', 'runner-a.js'), 'export default {};\n');
    writeFileSync(join(cwd, 'tools', 'runner-b.js'), 'export default {};\n');
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  commands:\n    test: [node, tools/runner-a.js]\n');
    const resolver = runnerConfigurationResolver(cwd);
    const first = resolver('profile', 'completion', [{controls: ['type']}]);
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  commands:\n    test: [node, tools/runner-b.js]\n');
    const sameResolver = resolver('test', 'runner', [{controls: ['test']}]);
    expect(sameResolver.controls).toEqual(first.controls);
    expect(sameResolver.complete).toBe(first.complete);

    const freshResolver = runnerConfigurationResolver(cwd)('profile', 'completion', [{controls: ['type']}]);
    expect(freshResolver.controls).not.toEqual(first.controls);
  });

  test('fails closed for dynamic, unresolved, out-of-root, symlinked, and nested unknown controls', () => {
    const cases: ReadonlyArray<(cwd: string) => void> = [
      (cwd) => writeFileSync(join(cwd, 'eslint.config.js'), 'const target = process.env.ESLINT_CONFIG; module.exports = require(target);\n'),
      (cwd) => writeFileSync(join(cwd, 'eslint.config.js'), 'const environment = process.env; export default environment.CI ? [] : [];\n'),
      (cwd) => writeFileSync(join(cwd, 'eslint.config.js'), 'const runtime = globalThis; export default runtime;\n'),
      (cwd) => writeFileSync(join(cwd, 'vitest.config.ts'), 'export const location = import.meta.url; export default {};\n'),
      (cwd) => writeFileSync(join(cwd, 'eslint.config.js'), 'export default Bun.version;\n'),
      (cwd) => writeFileSync(join(cwd, 'eslint.config.js'), 'export default Deno.cwd();\n'),
      (cwd) => writeFileSync(join(cwd, 'vitest.config.ts'), 'import "./does-not-exist.js"; export default {};\n'),
      (cwd) => {
        mkdirSync(join(cwd, '.cladding'), {recursive: true});
        writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  commands:\n    test: [node, tools/$RUNNER.js]\n');
      },
      (cwd) => writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node missing-runner.js"}}\n'),
      (cwd) => writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"sh -c \\\"node tools/runner.js\\\""}}\n'),
      (cwd) => writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'bash -lc "node runner.js"'}})),
      (cwd) => writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'bash -cl "node runner.js"'}})),
      (cwd) => writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'cmd /c node runner.js'}})),
      (cwd) => writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'powershell -Command node runner.js'}})),
      (cwd) => {
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'node -r hook.js runner.js'}}));
        writeFileSync(join(cwd, 'hook.js'), 'export const hook = true;\n');
        writeFileSync(join(cwd, 'runner.js'), 'export const runner = true;\n');
      },
      (cwd) => {
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'npm start', start: 'node runner.js', poststart: 'node missing-hook.js'}}));
        writeFileSync(join(cwd, 'runner.js'), 'export const runner = true;\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'const selected = "./selected.js"; require(selected);\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'const environment = process.env; export default environment.CI;\n');
      },
      (cwd) => {
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"python runner.py"}}\n');
        writeFileSync(join(cwd, 'runner.py'), 'from pathlib import Path\nprint(Path("runner.ini").read_text())\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'import {readFile as reader} from "node:fs/promises"; export default reader("runner.ini");\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'const {readFileSync: reader} = require("fs"); module.exports = reader("runner.ini");\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'import {env as runtimeEnv} from "node:process"; export default runtimeEnv.CI;\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'const load = module.require("fs").readFileSync; module.exports = load("runner.ini");\n');
      },
      (cwd) => {
        mkdirSync(join(cwd, 'tools'), {recursive: true});
        writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"node tools/runner.js"}}\n');
        writeFileSync(join(cwd, 'tools', 'runner.js'), 'import {createRequire} from "node:module"; const load = createRequire("."); export default load;\n');
      },
      (cwd) => {
        const outside = mkdtempSync(join(tmpdir(), 'clad-outside-control-'));
        roots.push(outside);
        writeFileSync(join(outside, 'external.js'), 'export default {};\n');
        writeFileSync(join(cwd, 'vite.config.ts'), `import "${join(outside, 'external.js')}"; export default {};\n`);
      },
      (cwd) => {
        const outside = join(cwd, 'outside-config.ts');
        writeFileSync(outside, 'export default {};\n');
        symlinkSync(outside, join(cwd, 'vitest.config.ts'));
      },
      (cwd) => {
        mkdirSync(join(cwd, 'packages', 'child'), {recursive: true});
        writeFileSync(join(cwd, 'packages', 'child', 'unregistered-runner.config.ts'), 'export default {};\n');
      },
      (cwd) => {
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: 'custom-runner --config cfg.js'}}));
        writeFileSync(join(cwd, 'cfg.js'), 'export default {};\n');
      },
      (cwd) => {
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {
          test: 'command npm run exec', exec: 'node runner.js',
        }}));
        writeFileSync(join(cwd, 'runner.js'), 'export const runner = true;\n');
      },
      (cwd) => writeFileSync(join(cwd, 'tsconfig.json'), '{extends: `./configs/base`}\n'),
      (cwd) => writeFileSync(join(cwd, 'tsconfig.json'), '{...shared}\n'),
      (cwd) => writeFileSync(join(cwd, 'tsconfig.json'), '{[key]: "./configs/base"}\n'),
      ...[
        'npm exec -- tsx runner.ts',
        'npm x tsx runner.ts',
        'pnpm exec tsx runner.ts',
        'pnpm dlx tsx runner.ts',
        'yarn dlx tsx runner.ts',
        'npx tsx runner.ts',
        'bunx tsx runner.ts',
        'pnpx tsx runner.ts',
        'command npx tsx@latest runner.ts',
        'corepack npm exec -- tsx runner.ts',
        'npm --silent config exec -- tsx runner.ts',
      ].map((script) => (cwd: string) => {
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({scripts: {test: script}}));
        writeFileSync(join(cwd, 'runner.ts'), 'export const runner = true;\n');
      }),
    ];
    for (const arrange of cases) {
      const cwd = fixture();
      addDoneSiblingFeature(cwd);
      arrange(cwd);
      const compilation = compileSpecWorkspace(cwd);
      const snapshot = workspaceProfileSnapshot(cwd, compilation, {
        profile: assuranceProfile('completion', 'L1'), scopeAddresses: ['feature:F-aaaaaaaa'],
        hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
      });
      expect(snapshot.complete).toBe(false);
      expect(snapshot.incompleteAddresses).toContain('runner-controls');
      // Hand-authored repository expectation: a bad runner control cannot
      // leave only feature A in the executable scope.
      expect(snapshot.effectiveScopeAddresses).toEqual(['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb']);
    }
  });

  test('uses only the current Unit reporter, never a pre-existing JUnit result', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = '[covers:F-aaaaaaaa/AC-aaaaaaaa] verifies current output';
    writeFileSync(join(cwd, 'tests', 'a.test.ts'), `it('${selector}', () => {});\n`);
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  test_report: old.junit.xml\n');
    writeFileSync(join(cwd, 'old.junit.xml'), `<testsuite><testcase file="tests/a.test.ts" name="${selector}"/></testsuite>`);
    const compilation = compileSpecWorkspace(cwd);
    expect(currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'])[0]?.test.state).toBe('unverified');

    const reporter = join(cwd, 'current-vitest.json');
    writeFileSync(reporter, JSON.stringify({testResults: [{name: join(cwd, 'tests', 'a.test.ts'), assertionResults: [{status: 'passed', fullName: selector}]}]}));
    primeTestRunCache(cwd, 'sealed-input');
    captureCurrentVitestProof(cwd, reporter, ['vitest', 'run']);
    const current = currentGateProofEvidence(cwd, 'sealed-input');
    expect(currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'], current, 'sealed-input')[0]?.test.state).toBe('verified');
    expect(currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'], current, 'other-input')[0]?.test.state).toBe('unverified');
    clearTestRunCache();
  });

  test('keeps a missing done sibling unobserved while an exact current sibling stays pass', () => {
    const cwd = fixture();
    const feature = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    writeFileSync(feature, readFileSync(feature, 'utf8').replace(
      '    statement: The system shall keep closure requirements explicit.\n',
      [
        '    statement: The system shall keep closure requirements explicit.',
        '  - id: AC-bbbbbbbb', '    kind: behavior',
        '    statement: The system shall localize a missing sibling proof.', '',
      ].join('\n'),
    ));
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = '[covers:F-aaaaaaaa/AC-aaaaaaaa] keeps the exact sibling current';
    writeFileSync(join(cwd, 'tests', 'a.test.ts'), `it('${selector}', () => {});\n`);
    const compilation = compileSpecWorkspace(cwd);
    const snapshot = workspaceProfileSnapshot(cwd, compilation, {
      profile: assuranceProfile('completion', 'L2'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: true, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    });
    expect(snapshot.complete).toBe(true);

    const reporter = join(cwd, 'current-vitest.json');
    writeFileSync(reporter, JSON.stringify({testResults: [{
      name: join(cwd, 'tests', 'a.test.ts'), assertionResults: [{status: 'passed', fullName: selector}],
    }]}));
    primeTestRunCache(cwd, snapshot.inputSha256);
    captureCurrentVitestProof(cwd, reporter, ['vitest', 'run']);
    const current = currentGateProofEvidence(cwd, snapshot.inputSha256);
    const proofViews = currentProofViewsFromWorkspace(cwd, compilation, snapshot.effectiveScopeAddresses, current, snapshot.inputSha256);
    clearTestRunCache();
    expect(Object.fromEntries(proofViews.map((view) => [view.criterion, view.test.state]))).toEqual({
      'F-aaaaaaaa/AC-aaaaaaaa': 'verified',
      'F-aaaaaaaa/AC-bbbbbbbb': 'unverified',
    });

    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: snapshot.complete,
      scopeAddresses: snapshot.effectiveScopeAddresses, inputAddresses: snapshot.effectiveScopeAddresses, inputSha256: snapshot.inputSha256,
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      proofViews, exactProofRequired: true, environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2']
        .map((stage) => ({stage, status: 'pass' as const})),
    });
    expect(verdict).toMatchObject({state: 'unresolved', profile_complete: false});
    for (const obligation of ['stage_2.1', 'stage_2.2']) {
      expect(verdict.results.find((result) => result.obligation === obligation
        && result.subject === 'criterion:F-aaaaaaaa/AC-aaaaaaaa')?.state).toBe('pass');
      expect(verdict.results.find((result) => result.obligation === obligation
        && result.subject === 'criterion:F-aaaaaaaa/AC-bbbbbbbb')?.state).toBe('unobserved');
      expect(verdict.results.filter((result) => result.obligation === obligation && result.subject.startsWith('scope:')))
        .toEqual([expect.objectContaining({state: 'pass'})]);
    }
  });

  test('applies schema 0.2 proof subjects only to done features, including a prospective completion', () => {
    const cwd = fixture();
    const feature = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    const source = readFileSync(feature, 'utf8');
    const request = {
      profile: assuranceProfile('completion', 'L2'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = '[covers:F-aaaaaaaa/AC-aaaaaaaa] activates on prospective completion';
    writeFileSync(join(cwd, 'tests', 'a.test.ts'), `it('${selector}', () => {});\n`);
    for (const status of ['planned', 'in_progress', 'blocked', 'archived'] as const) {
      const lifecycleFixture = status === 'blocked'
        ? source.replace('status: done', 'status: blocked\nblocked_reason: Waiting for dependency resolution')
        : source.replace('status: done', `status: ${status}`);
      writeFileSync(feature, lifecycleFixture);
      const compilation = compileSpecWorkspace(cwd);
      expect(compilation.schemaVersion).toBe('0.2');
      expect(compilation.contract).toBeDefined();
      expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
      expect(assuranceClosureInputFromWorkspace(cwd, compilation).executableProofFeatureIds)
        .not.toContain('F-aaaaaaaa');
      const snapshot = workspaceProfileSnapshot(cwd, compilation, request);
      expect(snapshot.complete).toBe(true);
      expect(currentProofViewsFromWorkspace(cwd, compilation, snapshot.effectiveScopeAddresses)).toEqual([]);
      const verdict = reduceLegacyStageAdapter({
        profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: snapshot.complete,
        scopeAddresses: snapshot.effectiveScopeAddresses, inputAddresses: snapshot.effectiveScopeAddresses, inputSha256: snapshot.inputSha256,
        hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
        proofViews: [], exactProofRequired: true, environmentClass: 'test',
        stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6']
          .map((stage) => ({stage, status: 'pass' as const})),
      });
      for (const obligation of ['stage_2.1', 'stage_2.2']) {
        expect(verdict.results.find((result) => result.obligation === obligation))
          .toMatchObject({subject: expect.stringMatching(/^scope:/), state: 'na'});
      }
    }

    writeFileSync(feature, source.replace('status: done', 'status: in_progress'));
    const planned = compileSpecWorkspace(cwd);
    const prospective = prospectiveDoneCompilation(planned, 'F-aaaaaaaa');
    const closures = assuranceClosureInputFromWorkspace(cwd, prospective);
    const snapshot = workspaceProfileSnapshot(cwd, prospective, {
      ...request, closureInput: closures,
    });
    expect(closures.executableProofFeatureIds).toContain('F-aaaaaaaa');
    expect(snapshot.complete).toBe(true);
    expect(currentProofViewsFromWorkspace(cwd, prospective, snapshot.effectiveScopeAddresses))
      .toEqual([expect.objectContaining({criterion: 'F-aaaaaaaa/AC-aaaaaaaa'})]);
  });

  test('does not rebind an old passing JUnit result when this Unit run skips its exact case', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = '[covers:F-aaaaaaaa/AC-aaaaaaaa] verifies current output';
    writeFileSync(join(cwd, 'tests', 'a.test.ts'), `it('${selector}', () => {});\n`);
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  test_report: current.junit.xml\n');
    const report = join(cwd, 'current.junit.xml');
    writeFileSync(report, `<testsuite><testcase file="tests/a.test.ts" name="${selector}"/></testsuite>`);
    const compilation = compileSpecWorkspace(cwd);

    primeTestRunCache(cwd, 'sealed-input');
    // The retained report is not evidence from this invocation, even though an
    // unrelated current testcase will keep the runner process itself GREEN.
    captureCurrentJUnitProof(cwd, ['pytest', '-q']);
    expect(currentGateProofEvidence(cwd, 'sealed-input')).toBeUndefined();
    writeFileSync(report, `<testsuite><testcase file="tests/a.test.ts" name="${selector}"><skipped/></testcase><testcase file="tests/other.test.ts" name="unrelated"/></testsuite>`);
    captureCurrentJUnitProof(cwd, ['pytest', '-q']);
    const current = currentGateProofEvidence(cwd, 'sealed-input');
    expect(currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'], current, 'sealed-input')[0]?.test.state).toBe('unverified');
    clearTestRunCache();
  });

  test('keeps top-level Vitest titles, full-name fallbacks, and duplicate leaves compatible', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = '[covers:F-aaaaaaaa/AC-aaaaaaaa] verifies nested output';
    writeFileSync(join(cwd, 'tests', 'a.test.ts'), `it('${selector}', () => {});\n`);
    const compilation = compileSpecWorkspace(cwd);
    const reporter = join(cwd, 'current-vitest.json');
    const view = (assertionResults: readonly object[]) => {
      writeFileSync(reporter, JSON.stringify({testResults: [{
        name: join(cwd, 'tests', 'a.test.ts'), assertionResults,
      }]}));
      primeTestRunCache(cwd, 'sealed-input');
      captureCurrentVitestProof(cwd, reporter, ['vitest', 'run']);
      const current = currentGateProofEvidence(cwd, 'sealed-input');
      const result = currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'], current, 'sealed-input');
      clearTestRunCache();
      return result[0]?.test.state;
    };

    expect(view([{status: 'passed', fullName: `outer suite ${selector}`, title: selector}])).toBe('verified');
    expect(view([{status: 'passed', title: selector}])).toBe('verified');
    expect(view([{status: 'passed', fullName: selector}])).toBe('verified');
    expect(view([
      {status: 'passed', fullName: `first suite ${selector}`, title: selector},
      {status: 'passed', fullName: `second suite ${selector}`, title: selector},
    ])).toBe('unverified');
    expect(view([
      {status: 'passed', fullName: selector, title: selector},
      {status: 'passed', fullName: `duplicate suite ${selector}`, title: selector},
    ])).toBe('verified');
  });

  test('round-trips native Vitest suite paths without guessing from space-joined full names', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = '[covers:F-aaaaaaaa/AC-aaaaaaaa] preserves nested suite identity';
    writeFileSync(join(cwd, 'tests', 'a.test.ts'), [
      "describe('outer suite', () => {",
      `  it(${JSON.stringify(selector)}, () => {});`,
      '});',
      "describe('outer', () => {",
      "  describe('suite', () => {",
      `    it(${JSON.stringify(selector)}, () => {});`,
      '  });',
      '});', '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(cwd);
    const reporter = join(cwd, 'current-vitest.json');
    const view = (assertionResults: readonly object[]) => {
      writeFileSync(reporter, JSON.stringify({testResults: [{
        name: join(cwd, 'tests', 'a.test.ts'), assertionResults,
      }]}));
      primeTestRunCache(cwd, 'sealed-input');
      try {
        captureCurrentVitestProof(cwd, reporter, ['vitest', 'run']);
        const current = currentGateProofEvidence(cwd, 'sealed-input');
        return currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'], current, 'sealed-input');
      } finally {
        clearTestRunCache();
      }
    };
    const spaceJoinedFullName = `outer suite ${selector}`;

    expect(view([{
      status: 'passed', ancestorTitles: ['outer suite'], title: selector, fullName: spaceJoinedFullName,
    }])[0]?.test).toEqual(expect.objectContaining({state: 'verified', matched: 1, pass: 1}));
    // Both native paths have the same reporter full name, but remain distinct
    // exact observations because the source and adapter use ` > ` separators.
    expect(view([
      {status: 'passed', ancestorTitles: ['outer suite'], title: selector, fullName: spaceJoinedFullName},
      {status: 'failed', ancestorTitles: ['outer', 'suite'], title: selector, fullName: spaceJoinedFullName},
    ])[0]?.test).toEqual(expect.objectContaining({state: 'failed', matched: 2, pass: 1, fail: 1}));
    expect(view([{
      status: 'passed', ancestorTitles: ['outer', 7], title: selector, fullName: spaceJoinedFullName,
    }])[0]?.test).toEqual(expect.objectContaining({state: 'unverified', matched: 0, pass: 0}));
    expect(view([{
      status: 'passed', ancestorTitles: ['unrelated suite'], title: 'unrelated same-file pass', fullName: 'unrelated suite unrelated same-file pass',
    }])[0]?.test).toEqual(expect.objectContaining({state: 'unverified', matched: 0, pass: 0}));
  });

  test('adapts only available exact reviewed or legacy selectors for done compiler contracts', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = 'historic current selector';
    const bytes = `it('${selector}', () => {});\n`;
    writeFileSync(join(cwd, 'tests', 'historic.test.ts'), bytes);
    mkdirSync(join(cwd, 'spec', 'generated'), {recursive: true});
    const baseline = {
      schema: 1, sourceSchema: '0.1', project: {address: 'project'}, features: [], scenarios: [],
      criteria: [{
        address: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', legacyIntent: {text: 'The system shall keep closure requirements explicit.'},
        classification: 'legacy_unclassified',
        bindings: [{channel: 'test', raw: `tests/historic.test.ts#${selector}`, selector}],
        exemption: {id: 'historic-binding', subject: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', reason: 'legacy_criterion_intent'},
      }],
    };
    writeFileSync(join(cwd, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify({
      ...baseline,
      reviewedCarryForwards: [{
        criterion: 'criterion:F-aaaaaaaa/AC-aaaaaaaa',
        intent: {statement: 'The system shall keep closure requirements explicit.', kind: 'behavior'},
        bindings: [{raw: `tests/historic.test.ts#${selector}`, file: 'tests/historic.test.ts', selector, sha256: createHash('sha256').update(bytes).digest('hex')}],
      }],
    }));
    expect(currentProofBindingsFromWorkspace(cwd, compileSpecWorkspace(cwd))).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-aaaaaaaa', file: 'tests/historic.test.ts', selector}),
    ]);

    writeFileSync(join(cwd, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify(baseline));
    const feature = join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml');
    writeFileSync(feature, readFileSync(feature, 'utf8').replace('    kind: behavior\n', ''));
    expect(currentProofBindingsFromWorkspace(cwd, compileSpecWorkspace(cwd))).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-aaaaaaaa', file: 'tests/historic.test.ts', selector}),
    ]);

    writeFileSync(feature, readFileSync(feature, 'utf8').replace('status: done', 'status: planned'));
    expect(currentProofBindingsFromWorkspace(cwd, compileSpecWorkspace(cwd))).toEqual([]);
  });

  test('keeps stale exact legacy selectors and unrelated same-file passes unobserved while unsafe paths remain incomplete', () => {
    const cwd = fixture();
    mkdirSync(join(cwd, 'tests'), {recursive: true});
    const selector = 'historic current selector';
    const bytes = `it('${selector}', () => {});\n`;
    writeFileSync(join(cwd, 'tests', 'historic.test.ts'), `${bytes}// stale\n`);
    mkdirSync(join(cwd, 'spec', 'generated'), {recursive: true});
    const criteriaFor = (raw: string, exactSelector?: string) => [{
      address: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', legacyIntent: {text: 'The system shall keep closure requirements explicit.'},
      classification: 'legacy_unclassified',
      bindings: [{channel: 'test', raw, ...(exactSelector === undefined ? {} : {selector: exactSelector})}],
      exemption: {id: 'historic-binding', subject: 'criterion:F-aaaaaaaa/AC-aaaaaaaa', reason: 'legacy_criterion_intent'},
    }];
    const baseline = (criteria: object, binding?: object) => ({
      schema: 1, sourceSchema: '0.1', project: {address: 'project'}, features: [], scenarios: [], criteria: [criteria],
      ...(binding ? {reviewedCarryForwards: [{
        criterion: 'criterion:F-aaaaaaaa/AC-aaaaaaaa',
        intent: {statement: 'The system shall keep closure requirements explicit.', kind: 'behavior'}, bindings: [binding],
      }]} : {}),
    });
    const baselinePath = join(cwd, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml');
    const snapshotRequest = {
      profile: assuranceProfile('completion', 'L2'), scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: true, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    };
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  test_report: current.junit.xml\n');
    const currentState = (compilation: ReturnType<typeof compileSpecWorkspace>, serial: string) => {
      primeTestRunCache(cwd, 'sealed-input');
      writeFileSync(join(cwd, 'current.junit.xml'), [
        `<testsuite name="${serial}">`,
        `<testcase file="tests/historic.test.ts" name="${selector}"/>`,
        '<testcase file="tests/historic.test.ts" name="global suite unrelated pass"/>',
        '</testsuite>',
      ].join(''));
      captureCurrentJUnitProof(cwd, ['vitest', 'run']);
      const current = currentGateProofEvidence(cwd, 'sealed-input');
      const state = currentProofViewsFromWorkspace(cwd, compilation, ['feature:F-aaaaaaaa'], current, 'sealed-input')[0]?.test.state;
      clearTestRunCache();
      return state;
    };
    writeFileSync(baselinePath, JSON.stringify(baseline(
      criteriaFor(`tests/historic.test.ts#${selector}`, selector)[0]!,
      {raw: `tests/historic.test.ts#${selector}`, file: 'tests/historic.test.ts', selector, sha256: createHash('sha256').update(bytes).digest('hex')},
    )));
    const stale = compileSpecWorkspace(cwd);
    expect(currentProofBindingsFromWorkspace(cwd, stale)).toEqual([]);
    expect(currentState(stale, 'stale')).toBe('unverified');
    expect(workspaceProfileSnapshot(cwd, stale, snapshotRequest).complete).toBe(true);

    const outside = mkdtempSync(join(tmpdir(), 'clad-proof-unsafe-'));
    roots.push(outside);
    writeFileSync(join(outside, 'unsafe.test.ts'), 'it("unsafe", () => {});\n');
    symlinkSync(join(outside, 'unsafe.test.ts'), join(cwd, 'tests', 'unsafe.test.ts'));
    writeFileSync(baselinePath, JSON.stringify(baseline(
      criteriaFor('tests/unsafe.test.ts#unsafe', 'unsafe')[0]!,
      {raw: 'tests/unsafe.test.ts#unsafe', file: 'tests/unsafe.test.ts', selector: 'unsafe', sha256: 'a'.repeat(64)},
    )));
    const unsafe = compileSpecWorkspace(cwd);
    expect(currentProofBindingsFromWorkspace(cwd, unsafe)).toEqual([]);
    expect(currentState(unsafe, 'unsafe')).toBe('unverified');
    expect(workspaceProfileSnapshot(cwd, unsafe, snapshotRequest).complete).toBe(false);
    expect(workspaceProfileSnapshot(cwd, unsafe, snapshotRequest).incompleteAddresses)
      .toContain('verification:F-aaaaaaaa/AC-aaaaaaaa');
    rmSync(join(cwd, 'tests', 'unsafe.test.ts'));

    writeFileSync(baselinePath, JSON.stringify(baseline(criteriaFor('tests/historic.test.ts')[0]!)));
    writeFileSync(join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml'), readFileSync(join(cwd, 'spec', 'features', 'closure-aaaaaaaa.yaml'), 'utf8').replace('    kind: behavior\n', ''));
    const pathOnly = compileSpecWorkspace(cwd);
    expect(currentProofBindingsFromWorkspace(cwd, pathOnly)).toEqual([]);
    expect(currentState(pathOnly, 'path-only')).toBe('unverified');
    const pathOnlySnapshot = workspaceProfileSnapshot(cwd, pathOnly, snapshotRequest);
    expect(pathOnlySnapshot.complete).toBe(true);
    expect(pathOnlySnapshot.incompleteAddresses).not.toContain('verification:F-aaaaaaaa/AC-aaaaaaaa');
    expect(pathOnlySnapshot.incompleteAddresses).not.toContain('runner-controls');
  });

  test('projects v3 rows only for the compiler-effective scope that earned the verdict', () => {
    const cwd = fixture();
    addDoneSiblingFeature(cwd);
    const compilation = compileSpecWorkspace(cwd);
    const common = {
      cwd,
      compilation,
      detectorCatalogSha256: 'a'.repeat(64),
      toolIdentity: 'cladding-test',
      environmentClass: 'test',
      trustSnapshotSha256: 'a'.repeat(64),
    };
    const snapshot = workspaceProfileSnapshot(cwd, compilation, {
      profile: assuranceProfile('completion', 'L2'),
      scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: false,
      oracleRequiredSubjects: new Set<string>(),
      requiresHuman: false,
    });
    const verdict = greenVerdict(snapshot.effectiveScopeAddresses, snapshot.inputSha256);

    const closureInput = assuranceClosureInputFromWorkspace(cwd, compilation);
    expect(featureClosureSeals(closureInput, 'F-aaaaaaaa').complete).toBe(true);
    expect(featureClosureSeals(closureInput, 'F-bbbbbbbb').complete).toBe(true);
    expect(createWorkspaceAttestations({...common, verdict, featureIds: ['F-bbbbbbbb']})).toEqual([]);
    expect(createWorkspaceAttestations({...common, verdict, featureIds: ['F-aaaaaaaa']}).map((entry) => entry.feature))
      .toEqual(['F-aaaaaaaa']);
    expect(createWorkspaceAttestations({
      ...common,
      verdict: JSON.parse(JSON.stringify(verdict)),
      featureIds: ['F-aaaaaaaa'],
    })).toEqual([]);

    const multiSnapshot = workspaceProfileSnapshot(cwd, compilation, {
      profile: assuranceProfile('completion', 'L2'),
      scopeAddresses: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb'],
      hasExecutableTests: false,
      oracleRequiredSubjects: new Set<string>(),
      requiresHuman: false,
    });
    const multiVerdict = greenVerdict(multiSnapshot.effectiveScopeAddresses, multiSnapshot.inputSha256);
    expect(multiSnapshot.effectiveScopeAddresses).toEqual(['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb']);
    expect(createWorkspaceAttestations({...common, verdict: multiVerdict, featureIds: ['F-bbbbbbbb', 'F-aaaaaaaa']})
      .map((entry) => entry.feature)).toEqual(['F-aaaaaaaa', 'F-bbbbbbbb']);
  });
});
