// Cladding · Spec 0.2 F9d · independence label, receipt census, and staleness tests.

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {scopeIndependenceLabel, reduceLegacyStageAdapter, type FeatureIndependenceInput} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {
  assuranceClosureInputFromWorkspace,
  createWorkspaceAttestations,
  currentProofViewsFromWorkspace,
  workspaceExpectedDigestProducer,
  workspaceIndependenceInputs,
  workspaceProfileSnapshot,
} from '../../src/assurance/workspace.js';
import {verificationClosure} from '../../src/assurance/closures.js';
import {readEvidence} from '../../src/hitl/audit.js';
import {evidenceAssurance} from '../../src/hitl/identity.js';
import {recordOracle} from '../../src/oracle/record.js';
import {createIssuerKey} from '../../src/proof/issuer.js';
import {recordVerifiedSignoff} from '../../src/proof/signoff.js';
import {emptyTrustSnapshot, parsePortableReceiptYaml, verifyPortableReceipt, type PortableReceipt} from '../../src/proof/receipt.js';
import {TRUST_REGISTRY_PATH, loadTrustSnapshot, trustRegistryAddition} from '../../src/proof/trust.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {receiptFileCensus} from '../../src/spec/attestation.js';
import {authoritativeFixtureVerdict} from './authoritative-fixture.js';

const temporary: string[] = [];

interface Fixture {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly issuer: string;
}

function fixture(issuer = 'independent reviewer'): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-independence-'));
  temporary.push(root);
  const store = mkdtempSync(join(tmpdir(), 'clad-f9d-independence-keys-'));
  temporary.push(store);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: independence\n  language: typescript\n  purpose: Label independence from evidence.\n  assurance_level: L4\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'independence-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Independence\nstatus: done\npurpose: Label independence from evidence.\nmodules:\n  - src/alpha.ts\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall label independence from recorded evidence.\n');
  const env = {CLADDING_KEYS_DIR: join(store, 'keys')};
  const created = createIssuerKey(env);
  mkdirSync(join(root, 'spec', 'trust'), {recursive: true});
  writeFileSync(join(root, TRUST_REGISTRY_PATH), trustRegistryAddition(root, {issuer, spkiDer: created.spkiDer}).after);
  return {root, env, issuer};
}

/** The same fixture inside a git repository so its one root has a git author. */
function gitFixture(author: string, issuer?: string): Fixture {
  const target = fixture(issuer);
  const git = (...args: string[]): void => { execFileSync('git', args, {cwd: target.root, stdio: 'ignore'}); };
  git('init', '-q');
  git('config', 'user.email', 'author@example.test');
  git('config', 'user.name', author);
  git('add', 'src/alpha.ts');
  git('commit', '-q', '-m', 'add alpha');
  return target;
}

async function signAudit(target: Fixture): Promise<string> {
  const signed = await recordVerifiedSignoff({
    cwd: target.root, featureId: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass',
    issuer: target.issuer, env: target.env, confirm: async () => 'F-aaaaaaaa',
  });
  if (!signed.ok || !signed.path) throw new Error(signed.message);
  return signed.path;
}

/** Rebuilds the exact receipt context a gate assembles from the safe census. */
function gateReceiptContext(root: string): {candidates: Array<{bytes: string; expected: Record<string, string>}>; trustSnapshot: ReturnType<typeof loadTrustSnapshot>} | undefined {
  const census = receiptFileCensus(root);
  if (census === undefined) return undefined;
  const compilation = compileSpecWorkspace(root);
  const expectedFor = workspaceExpectedDigestProducer(root, assuranceClosureInputFromWorkspace(root, compilation));
  return {
    candidates: census.map((file) => ({
      bytes: file.bytes,
      expected: (expectedFor(parsePortableReceiptYaml(file.bytes)) ?? {}) as Record<string, string>,
    })),
    trustSnapshot: loadTrustSnapshot(root),
  };
}

function facts(overrides: Partial<FeatureIndependenceInput> = {}): FeatureIndependenceInput {
  return {
    feature: 'F-aaaaaaaa',
    authorMappingComplete: true,
    verifiedAudits: [{issuer: 'independent reviewer', independence: 'pass', independentIssuer: true}],
    ...overrides,
  };
}

function verdictFor(independenceInputs?: readonly FeatureIndependenceInput[]) {
  return reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L4'),
    configuredAssuranceLevel: 'L4',
    completeScope: true,
    scopeAddresses: ['feature:F-aaaaaaaa'],
    inputAddresses: ['feature:F-aaaaaaaa'],
    inputSha256: 'a'.repeat(64),
    hasExecutableTests: true,
    hasOracleProof: false,
    hasDeliverable: true,
    requiresQuality: true,
    requiresHuman: true,
    ...(independenceInputs === undefined ? {} : {independenceInputs}),
    stages: [],
    environmentClass: 'foreground',
  });
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec 0.2 evidence-based independence', () => {
  test('[covers:F-f4cfd533/AC-e5be2b73] labels a feature independent when a verified issuer outside its author set passes the check', () => {
    expect(scopeIndependenceLabel([facts()])).toBe('independent');
    expect(verdictFor([facts()]).independence).toBe('independent');
    // A signature from inside the author set proves review, not independence.
    expect(verdictFor([facts({verifiedAudits: [{issuer: 'the author', independence: 'pass', independentIssuer: false}]})]).independence).toBe('self-certified');
    // An outside issuer who did NOT pass the independence check is not enough.
    expect(verdictFor([facts({verifiedAudits: [{issuer: 'independent reviewer', independence: 'fail', independentIssuer: true}]})]).independence).toBe('self-certified');
    expect(verdictFor([facts(), facts({feature: 'F-cccccccc', verifiedAudits: []})]).independence).toBe('self-certified');
  });

  test('[covers:F-f4cfd533/AC-de5fe055] leaves independence unobserved when any implementation root lacks an author mapping', () => {
    expect(scopeIndependenceLabel([facts({authorMappingComplete: false})])).toBe('unobserved');
    expect(verdictFor([facts({authorMappingComplete: false})]).independence).toBe('unobserved');
    // One unattributable feature is enough to make the whole scope claim unsafe.
    expect(verdictFor([facts(), facts({feature: 'F-cccccccc', authorMappingComplete: false})]).independence).toBe('unobserved');
    // Absent facts keep the shipped blind-only rule instead of manufacturing one.
    expect(verdictFor(undefined).independence).toBe('self-certified');
    expect(scopeIndependenceLabel([])).toBeUndefined();
  });

  test('[covers:F-f4cfd533/AC-e5be2b73] derives the label from a real signed receipt and its author mapping', async () => {
    const target = fixture();
    await signAudit(target);
    const context = gateReceiptContext(target.root)!;
    const compilation = compileSpecWorkspace(target.root);
    const inputs = workspaceIndependenceInputs({
      cwd: target.root,
      closures: assuranceClosureInputFromWorkspace(target.root, compilation),
      featureIds: ['F-aaaaaaaa'],
      receiptContext: context,
    });
    // The temp workspace is not a git repository, so its only root is
    // unattributable and the honest label is `unobserved`, not `independent`.
    expect(inputs).toEqual([{
      feature: 'F-aaaaaaaa',
      authorMappingComplete: false,
      verifiedAudits: [{issuer: target.issuer, independence: 'pass', independentIssuer: true}],
    }]);
    expect(verdictFor(inputs).independence).toBe('unobserved');
  });

  test('[covers:F-f4cfd533/AC-e5be2b73] labels an attributed feature independent from a real receipt signed outside its git author set', async () => {
    const target = gitFixture('Alice');
    await signAudit(target);
    const inputs = workspaceIndependenceInputs({
      cwd: target.root,
      closures: assuranceClosureInputFromWorkspace(target.root, compileSpecWorkspace(target.root)),
      featureIds: ['F-aaaaaaaa'],
      receiptContext: gateReceiptContext(target.root)!,
    });
    expect(inputs).toEqual([{
      feature: 'F-aaaaaaaa',
      authorMappingComplete: true,
      verifiedAudits: [{issuer: 'independent reviewer', independence: 'pass', independentIssuer: true}],
    }]);
    expect(verdictFor(inputs).independence).toBe('independent');
  });

  test('[covers:F-f4cfd533/AC-e5be2b73] keeps a feature self-certified when the signing issuer is its own git author', async () => {
    const target = gitFixture('Alice', 'Alice');
    await signAudit(target);
    const inputs = workspaceIndependenceInputs({
      cwd: target.root,
      closures: assuranceClosureInputFromWorkspace(target.root, compileSpecWorkspace(target.root)),
      featureIds: ['F-aaaaaaaa'],
      receiptContext: gateReceiptContext(target.root)!,
    });
    expect(inputs[0]).toMatchObject({
      authorMappingComplete: true,
      verifiedAudits: [{issuer: 'Alice', independence: 'pass', independentIssuer: false}],
    });
    expect(verdictFor(inputs).independence).toBe('self-certified');
  });

  test('[covers:F-f4cfd533/AC-9966cedf] supplies every persisted receipt with its trust verification so a verified current receipt clears its audit obligation', async () => {
    const target = fixture();
    await signAudit(target);
    const compilation = compileSpecWorkspace(target.root);
    const context = gateReceiptContext(target.root)!;
    expect(context.candidates).toHaveLength(1);
    const views = currentProofViewsFromWorkspace(target.root, compilation, ['feature:F-aaaaaaaa'], undefined, undefined, undefined, context);
    expect(views.map((view) => ({criterion: view.criterion, audit: view.audit, uat: view.uat}))).toEqual([
      {criterion: 'F-aaaaaaaa/AC-bbbbbbbb', audit: 'verified', uat: 'unverified'},
    ]);
    // Without the census the same workspace observes no receipt at all.
    expect(currentProofViewsFromWorkspace(target.root, compilation, ['feature:F-aaaaaaaa'])[0]?.audit).toBe('unverified');
  });

  test('[covers:F-f4cfd533/AC-9966cedf] clears the UAT obligation from a verified feature receipt addressing every current criterion', async () => {
    const target = fixture();
    const signed = await recordVerifiedSignoff({
      cwd: target.root, featureId: 'F-aaaaaaaa', claim: 'uat', issuer: target.issuer, env: target.env,
      confirm: async () => 'F-aaaaaaaa',
    });
    expect(signed.ok).toBe(true);
    const compilation = compileSpecWorkspace(target.root);
    const views = currentProofViewsFromWorkspace(
      target.root, compilation, ['feature:F-aaaaaaaa'], undefined, undefined, undefined, gateReceiptContext(target.root)!,
    );
    expect(views[0]).toMatchObject({criterion: 'F-aaaaaaaa/AC-bbbbbbbb', uat: 'verified', audit: 'unverified'});
  });

  test('[covers:F-f4cfd533/AC-853c287e] reports the receipt closure unresolved when spec/evidence cannot be enumerated safely', async () => {
    const target = fixture();
    await signAudit(target);
    expect(receiptFileCensus(target.root)).toHaveLength(1);
    const [featureDirectory] = readdirSync(join(target.root, 'spec', 'evidence'));
    symlinkSync(join(target.root, 'src'), join(target.root, 'spec', 'evidence', featureDirectory!, 'linked'));
    // An unsafe walk is an UNKNOWN receipt set: the census refuses to answer
    // rather than returning the subset it happened to read.
    expect(receiptFileCensus(target.root)).toBeUndefined();
    const compilation = compileSpecWorkspace(target.root);
    const snapshot = workspaceProfileSnapshot(target.root, compilation, {
      profile: assuranceProfile('completion', 'L4'),
      scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: true,
      requiresHuman: true,
      receiptCensusComplete: false,
    });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.incompleteAddresses).toContain('receipt-census:spec/evidence');
    // An incomplete closure makes every obligation's applicability unresolved,
    // so the verdict itself is unresolved rather than a GREEN over an empty
    // receipt set.
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('completion', 'L4'),
      configuredAssuranceLevel: 'L4',
      completeScope: false,
      scopeAddresses: ['feature:F-aaaaaaaa'],
      inputAddresses: ['feature:F-aaaaaaaa'],
      inputSha256: snapshot.inputSha256,
      hasExecutableTests: true,
      hasOracleProof: false,
      hasDeliverable: true,
      requiresQuality: true,
      requiresHuman: true,
      stages: [],
      environmentClass: 'foreground',
    });
    expect(verdict.state).toBe('unresolved');
    expect(verdict.profile_complete).toBe(false);
    expect(verdict.results.every((row) => row.state === 'unobserved' && row.reason === 'unresolved')).toBe(true);
  });

  test('[covers:F-f4cfd533/AC-6506c157] reports a receipt stale when a module inside its runtime dependency closure changes', async () => {
    const target = fixture();
    const path = await signAudit(target);
    const receipt = parsePortableReceiptYaml(readFileSync(join(target.root, path), 'utf8')) as PortableReceipt;
    const before = gateReceiptContext(target.root)!;
    expect(verifyPortableReceipt(receipt, before.trustSnapshot, before.candidates[0]!.expected))
      .toMatchObject({assurance: 'verified', currentness: 'current'});
    writeFileSync(join(target.root, 'src', 'alpha.ts'), 'export const alpha = 2;\n');
    const after = gateReceiptContext(target.root)!;
    expect(after.candidates[0]!.expected.runtimeDependencySha256).not.toBe(before.candidates[0]!.expected.runtimeDependencySha256);
    expect(verifyPortableReceipt(receipt, after.trustSnapshot, after.candidates[0]!.expected))
      .toMatchObject({assurance: 'invalid', currentness: 'stale', reason: 'expected_digest_mismatch'});
    // The stale receipt can no longer clear its obligation.
    const views = currentProofViewsFromWorkspace(
      target.root, compileSpecWorkspace(target.root), ['feature:F-aaaaaaaa'], undefined, undefined, undefined, after,
    );
    expect(views[0]?.audit).toBe('unverified');
  });

  test('[covers:F-f4cfd533/AC-58f972a6] records the clad_author_oracle blind flag as asserted provenance only', () => {
    const target = fixture();
    const recorded = recordOracle({
      cwd: target.root, featureId: 'F-aaaaaaaa', acId: 'AC-bbbbbbbb',
      body: 'export const oracle = true;\n', readManifest: ['spec/features/independence-aaaaaaaa.yaml'],
      blind: true,
    });
    expect(recorded.oraclePath).toContain('F-aaaaaaaa');
    const entries = readEvidence(target.root);
    const oracle = entries.find((entry) => entry.kind === 'oracle')!;
    // `blind: true` is a caller claim with no portable proof behind it, so the
    // entry stays asserted and its author stays the model that wrote it.
    expect(oracle.blind).toBe(true);
    expect(evidenceAssurance(oracle)).toBe('asserted');
    expect(oracle.identity.author).toBe('llm');
    expect(oracle.assurance).toBeUndefined();
    expect(entries.every((entry) => evidenceAssurance(entry) === 'asserted')).toBe(true);
    // It therefore cannot make the blind proof channel verified either.
    const views = currentProofViewsFromWorkspace(target.root, compileSpecWorkspace(target.root), ['feature:F-aaaaaaaa']);
    expect(views[0]?.blind).toBe('unverified');
  });

  test('[covers:F-f4cfd533/AC-c860be50] binds reviewed inputs to the verification closure aggregate of the receipt subject', async () => {
    const target = fixture();
    const path = await signAudit(target);
    const receipt = parsePortableReceiptYaml(readFileSync(join(target.root, path), 'utf8'));
    const closures = assuranceClosureInputFromWorkspace(target.root, compileSpecWorkspace(target.root));
    expect((receipt as {reviewed_inputs_sha256: string}).reviewed_inputs_sha256)
      .toBe(verificationClosure(closures, 'F-aaaaaaaa/AC-bbbbbbbb').sha256);
    // The aggregate is receipt-free, so filing the receipt does not stale it.
    const withReceipts = assuranceClosureInputFromWorkspace(target.root, compileSpecWorkspace(target.root), gateReceiptContext(target.root)!);
    expect(verificationClosure(withReceipts, 'F-aaaaaaaa/AC-bbbbbbbb').sha256)
      .not.toBe(verificationClosure(closures, 'F-aaaaaaaa/AC-bbbbbbbb').sha256);
    expect(workspaceExpectedDigestProducer(target.root, closures)(receipt as PortableReceipt)?.reviewedInputsSha256)
      .toBe(verificationClosure(closures, 'F-aaaaaaaa/AC-bbbbbbbb').sha256);
  });

  test('[covers:F-f4cfd533/AC-18fdca35] records the registry trust snapshot digest in every attestation row the gate mints', async () => {
    const target = fixture();
    await signAudit(target);
    const compilation = compileSpecWorkspace(target.root);
    const receiptContext = gateReceiptContext(target.root)!;
    expect(receiptContext.candidates).toHaveLength(1);
    // A registered key is a different trust set from "this workspace trusts
    // nothing", so the digest the writer records is falsifiable rather than
    // the constant every registry-less workspace already stamps.
    const registryDigest = loadTrustSnapshot(target.root).digest;
    expect(registryDigest).not.toBe(emptyTrustSnapshot().digest);
    expect(receiptContext.trustSnapshot.digest).toBe(registryDigest);

    const snapshot = workspaceProfileSnapshot(target.root, compilation, {
      profile: assuranceProfile('completion', 'L2'),
      scopeAddresses: ['feature:F-aaaaaaaa'],
      hasExecutableTests: true,
      oracleRequiredSubjects: new Set<string>(),
      requiresHuman: false,
      receiptCensusComplete: true,
    });
    const criterion = 'F-aaaaaaaa/AC-bbbbbbbb';
    const verdict = authoritativeFixtureVerdict(reduceLegacyStageAdapter({
      profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: snapshot.effectiveScopeAddresses, inputAddresses: snapshot.effectiveScopeAddresses,
      inputSha256: snapshot.inputSha256,
      hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      proofViews: [{
        criterion,
        test: {criterion, state: 'verified' as const, matched: 1, pass: 1, fail: 0, skip: 0, error: 0},
        audit: 'unverified' as const, uat: 'unverified' as const, blind: 'unverified' as const, assertedEvidence: 0,
      }],
      exactProofRequired: true,
      environmentClass: 'test',
      stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2']
        .map((stage) => ({stage, status: 'pass' as const})),
    }));
    expect(verdict.state).toBe('green');

    const rows = createWorkspaceAttestations({
      cwd: target.root,
      compilation,
      verdict,
      featureIds: ['F-aaaaaaaa'],
      detectorCatalogSha256: 'a'.repeat(64),
      toolIdentity: 'cladding-test',
      environmentClass: 'test',
      // The production wiring: the recorded digest is the workspace's own
      // registry snapshot, exactly as `clad check` supplies it.
      trustSnapshotSha256: receiptContext.trustSnapshot.digest,
      receiptContext,
    });
    // A writer that quietly declined to mint would satisfy every assertion
    // below on an empty list, so the row count is pinned first.
    expect(rows).toHaveLength(1);
    for (const row of rows) {
      expect(row.trust_snapshot_sha256).toBe(registryDigest);
      expect(row.trust_snapshot_sha256).not.toBe(emptyTrustSnapshot().digest);
    }
  });
});
