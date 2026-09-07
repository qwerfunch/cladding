// Cladding · F-a0bd9c5a — one verification closure for the writer and the detector.
//
// A verified receipt is an input to a feature's verification closure. Before
// this feature, the run authority sealed a RECEIPT-FREE closure while the
// attestation writer sealed a RECEIPT-CARRYING one, so any workspace holding a
// single verified receipt could never record a verification at all: the gate
// went green, wrote nothing, and said nothing, and `clad done` refused with a
// cause it could not name. These cases drive the real gate — the seam the
// defect lived in — rather than a mocked `checkStages`.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

const pass = () => ({pass: true, exitCode: 0});

// Registered stage adapters, not caller-supplied rows: the coordinator still
// builds the compiler plan, captures its snapshot, and enters the real writer.
vi.mock('../../src/stages/type.js', () => ({runType: pass}));
vi.mock('../../src/stages/lint.js', () => ({runLint: pass}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: pass}));
vi.mock('../../src/stages/commit.js', () => ({runCommit: pass}));
vi.mock('../../src/stages/arch.js', () => ({runArch: pass}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: pass}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: pass}));
vi.mock('../../src/stages/cov.js', () => ({runCov: pass}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: pass}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: pass}));

const [
  {runCheckStages}, {runDone}, {explainAttestationMintRefusal},
  {assuranceClosureInputFromWorkspace, featureClosureSeals, workspaceExpectedDigestProducer, workspaceIndependenceInputs},
  {workspaceReceiptCensus}, {compileSpecWorkspace}, {prospectiveDoneCompilation},
  {markFeatureDoneForGate, prepareSchema02DoneEvent}, {readAttestation}, {staleAttestation},
  {createIssuerKey, loadIssuerPrivateKey, signPortableReceipt},
  {serializePortableReceipt, receiptDigest}, {serializeTrustRegistry},
] = await Promise.all([
  import('../../src/cli/clad.js'),
  import('../../src/cli/done.js'),
  import('../../src/assurance/attestation.js'),
  import('../../src/assurance/workspace.js'),
  import('../../src/assurance/receipt-census.js'),
  import('../../src/spec/compiler/compile.js'),
  import('../../src/spec/prospective.js'),
  import('../../src/spec/edit.js'),
  import('../../src/spec/attestation.js'),
  import('../../src/stages/detectors/stale-attestation.js'),
  import('../../src/proof/issuer.js'),
  import('../../src/proof/receipt.js'),
  import('../../src/proof/trust.js'),
]);

type AuditReceipt = import('../../src/proof/receipt.js').AuditReceipt;

const FEATURE_A = 'F-a0a0a0a0';
const TARGET = 'F-c0c0c0c0';
const TARGET_AC = 'AC-c0c0c0c0';
const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** An L1 schema 0.2 workspace with one done prerequisite and one completion target. */
function workspace(): string {
  const cwd = temporaryRoot('clad-receipt-seal-');
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  mkdirSync(join(cwd, 'src'), {recursive: true});
  writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = true;\n');
  writeFileSync(join(cwd, 'src', 'c.ts'), 'export const c = true;\n');
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: receipt-seal-fixture', '  language: typescript',
    '  purpose: Seal one verification closure for every consumer.', '  assurance_level: L1',
    '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'features', 'a-a0a0a0a0.yaml'), [
    `id: ${FEATURE_A}`, 'title: A', 'status: done', 'purpose: Keep the attestation scope exact.',
    'modules: [src/a.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-a0a0a0a0', '    kind: behavior',
    '    statement: The system shall preserve the exact gate authority scope.', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), [
    `id: ${TARGET}`, 'title: C', 'status: in_progress',
    'purpose: Complete while a verified receipt is on disk.',
    'modules: [src/c.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    `  - id: ${TARGET_AC}`, '    kind: behavior',
    '    statement: The system shall record its verification while a receipt is on disk.', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  return cwd;
}

/** An unsigned audit draft: the producer reads only its method, claim, and subject. */
function unsignedDraft(): AuditReceipt {
  return {
    receipt_schema: '1', issuer: 'fixture-reviewer', issuer_key_id: 'k'.repeat(52),
    subject: `criterion:${TARGET}/${TARGET_AC}`, subject_sha256: 'a'.repeat(64),
    observed_at: '2026-09-07T00:00:00.000Z', method: 'human_channel', claim: 'audit',
    reviewed_inputs_sha256: 'b'.repeat(64), runtime_dependency_sha256: 'c'.repeat(64),
    implementation_authors_sha256: 'd'.repeat(64),
    checks: {evidence_sufficiency: 'pass', code_test_review: 'pass', independence: 'pass'},
    issuer_proof: 'unsigned',
  } as AuditReceipt;
}

/**
 * Files one genuinely verified audit receipt for the target criterion.
 *
 * The digests are read from the product's own expected-digest producer, so the
 * receipt is verified by the same rule a human-filed one would be — nothing
 * here asserts verification on the gate's behalf.
 */
function fileVerifiedReceipt(cwd: string): {readonly digest: string; readonly path: string} {
  const keyEnvironment = {CLADDING_KEYS_DIR: join(temporaryRoot('clad-receipt-seal-keys-'), 'store')};
  const created = createIssuerKey(keyEnvironment);
  const privateKey = loadIssuerPrivateKey(created.issuerKeyId, keyEnvironment);
  const issuer = 'fixture-reviewer';
  const subject = `criterion:${TARGET}/${TARGET_AC}` as const;
  const draft: Omit<AuditReceipt, 'issuer_proof'> = {
    ...unsignedDraft(), issuer, issuer_key_id: created.issuerKeyId, subject,
    observed_at: new Date().toISOString(),
  };
  const closures = assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd));
  const expected = workspaceExpectedDigestProducer(cwd, closures)(draft as AuditReceipt);
  if (!expected?.subjectSha256 || !expected.reviewedInputsSha256
    || !expected.runtimeDependencySha256 || !expected.implementationAuthorsSha256) {
    throw new Error('the fixture closure resolved no expected digest context');
  }
  const receipt = signPortableReceipt<AuditReceipt>({
    ...draft,
    subject_sha256: expected.subjectSha256,
    reviewed_inputs_sha256: expected.reviewedInputsSha256,
    runtime_dependency_sha256: expected.runtimeDependencySha256,
    implementation_authors_sha256: expected.implementationAuthorsSha256,
  }, privateKey);
  mkdirSync(join(cwd, 'spec', 'trust'), {recursive: true});
  writeFileSync(join(cwd, 'spec', 'trust', 'issuers.yaml'), serializeTrustRegistry([{
    issuer, issuer_key_id: created.issuerKeyId, spki_der: Buffer.from(created.spkiDer).toString('base64'),
  }]));
  const digest = receiptDigest(receipt);
  const path = join(cwd, 'spec', 'evidence', TARGET, `${digest}.yaml`);
  mkdirSync(join(cwd, 'spec', 'evidence', TARGET), {recursive: true});
  writeFileSync(path, serializePortableReceipt(receipt));
  return {digest, path};
}

/** The receipt-carrying seals the writer must record for the completed target. */
function expectedTargetSeals(cwd: string): {readonly withReceipt: string; readonly withoutReceipt: string} {
  const onDisk = compileSpecWorkspace(cwd);
  const completed = prospectiveDoneCompilation(onDisk, TARGET);
  const {receiptContext} = workspaceReceiptCensus(cwd, assuranceClosureInputFromWorkspace(cwd, onDisk));
  return {
    withReceipt: featureClosureSeals(
      assuranceClosureInputFromWorkspace(cwd, completed, receiptContext), TARGET,
    ).verificationSha256,
    withoutReceipt: featureClosureSeals(assuranceClosureInputFromWorkspace(cwd, completed), TARGET).verificationSha256,
  };
}

function completionOptions(cwd: string, gate: ReturnType<typeof markFeatureDoneForGate>): Parameters<typeof runCheckStages>[0] {
  return {
    profile: 'completion', scopeSubjects: [`feature:${TARGET}`], deferAttestation: true,
    prospectiveFeatureId: TARGET, completionGate: gate,
    completionEvent: prepareSchema02DoneEvent(cwd, gate), silent: false,
  };
}

function completeTarget(cwd: string): ReturnType<typeof runCheckStages> {
  const gate = markFeatureDoneForGate(cwd, TARGET);
  const outcome = runCheckStages(completionOptions(cwd, gate));
  outcome.commitAttestation?.({
    rollback: gate.rollback, targetGeneration: gate.targetGeneration, targetBytes: gate.targetBytes,
    rootBefore: gate.rootBefore, attestationBefore: gate.attestationBefore,
    event: {type: 'done_attempted', payload: {
      feature: TARGET, worst: 0, anyFailed: false, kept: true, blockers: [],
    }},
  });
  return outcome;
}

/** Collects the gate's own pulse lines instead of printing them. */
function captureStdout(): {readonly lines: string[]; restore: () => void} {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return {lines, restore: () => spy.mockRestore()};
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('completion and staleness seal one verification closure', () => {
  test('[covers:F-a0bd9c5a/AC-3e76a5ce] a workspace holding a verified receipt records its completion from the receipt-carrying closure', () => {
    const cwd = workspace();
    fileVerifiedReceipt(cwd);
    const cwdBefore = process.cwd();
    const stdout = captureStdout();
    try {
      process.chdir(cwd);
      const seals = expectedTargetSeals(cwd);
      // Unless the receipt genuinely entered the closure this case proves
      // nothing: the two seals would be equal and the split invisible.
      expect(seals.withReceipt).not.toBe(seals.withoutReceipt);

      const outcome = completeTarget(cwd);
      expect(outcome.commitAttestation).toEqual(expect.any(Function));
      expect(outcome.attestationRefusal).toBeUndefined();
      expect(readFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), 'utf8')).toContain('status: done');
      const row = readAttestation(cwd)?.v3?.get(TARGET);
      expect(row).toBeDefined();
      expect(row?.verification_sha256).toBe(seals.withReceipt);
    } finally {
      process.chdir(cwdBefore);
      stdout.restore();
    }
  });

  test('[covers:F-a0bd9c5a/AC-615ccc2a] the staleness detector reads the same receipt-carrying closure the writer sealed', () => {
    const cwd = workspace();
    fileVerifiedReceipt(cwd);
    const cwdBefore = process.cwd();
    const stdout = captureStdout();
    try {
      process.chdir(cwd);
      completeTarget(cwd);
      expect(readAttestation(cwd)?.v3?.has(TARGET)).toBe(true);
      const findings = staleAttestation.run({cwd});
      expect(findings.filter((finding) => finding.message.includes(TARGET))).toEqual([]);
    } finally {
      process.chdir(cwdBefore);
      stdout.restore();
    }
  });

  test('[covers:F-a0bd9c5a/AC-4a2db746] an unreadable receipt census reports the row as uncheckable rather than comparing without it', () => {
    const cwd = workspace();
    fileVerifiedReceipt(cwd);
    const cwdBefore = process.cwd();
    const stdout = captureStdout();
    try {
      process.chdir(cwd);
      completeTarget(cwd);
      expect(staleAttestation.run({cwd})).toEqual([]);

      // A link under the evidence root makes the walk unprovable, so the
      // detector knows neither freshness nor staleness for the attested row.
      symlinkSync(join(cwd, 'src', 'c.ts'), join(cwd, 'spec', 'evidence', TARGET, 'linked.yaml'));
      const findings = staleAttestation.run({cwd});
      const uncheckable = findings.filter((finding) => finding.message.includes(TARGET));
      expect(uncheckable).toHaveLength(1);
      expect(uncheckable[0]?.message).toContain('could not be checked');
      expect(uncheckable[0]?.message).toContain('spec/evidence');
      expect(uncheckable[0]?.message).not.toContain('changed since the last attested verification');
    } finally {
      process.chdir(cwdBefore);
      stdout.restore();
    }
  });

  test('[covers:F-a0bd9c5a/AC-aced61ad] a refused attestation names the guard that refused it', () => {
    const cwd = workspace();
    fileVerifiedReceipt(cwd);
    const cwdBefore = process.cwd();
    const stdout = captureStdout();
    try {
      process.chdir(cwd);
      const gate = markFeatureDoneForGate(cwd, TARGET);
      const outcome = runCheckStages(completionOptions(cwd, gate));
      const verdict = outcome.assurance;
      expect(verdict).toBeDefined();
      const completed = prospectiveDoneCompilation(compileSpecWorkspace(cwd), TARGET);
      const {receiptContext} = workspaceReceiptCensus(cwd, assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd)));
      const seals = featureClosureSeals(assuranceClosureInputFromWorkspace(cwd, completed, receiptContext), TARGET);
      const identity = {
        registrySha256: 'x'.repeat(64), detectorCatalogSha256: 'x'.repeat(64),
        toolIdentity: 'unknown', environmentClass: 'foreground', trustSnapshotSha256: 'x'.repeat(64),
      };
      // The exact shape the pre-fix gate produced: every other seal current,
      // the verification closure computed without the receipts on disk.
      const refusal = explainAttestationMintRefusal({
        verdict: verdict!, feature: TARGET,
        contractSha256: seals.contractSha256, subjectSha256: seals.subjectSha256,
        verificationSha256: featureClosureSeals(assuranceClosureInputFromWorkspace(cwd, completed), TARGET).verificationSha256,
        runtimeDependencySha256: seals.runtimeDependencySha256, ...identity,
      });
      expect(refusal?.guard).toBe('verification seal');
      expect(refusal?.detail).toContain('verification closure');

      const refused = runDone(cwd, TARGET, {
        checkStages: () => ({worst: 0, anyFailed: false, attestationRefusal: refusal}),
      });
      expect(refused.ok).toBe(false);
      expect(refused.reason).toContain('verification seal');
      expect(refused.reason).toContain('verification closure');
    } finally {
      process.chdir(cwdBefore);
      stdout.restore();
    }
  });

  test('[covers:F-a0bd9c5a/AC-aced61ad] a green gate that records nothing says which guard refused', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    const stdout = captureStdout();
    try {
      process.chdir(cwd);
      // Nothing is done here, so a green push gate has no row to record: the
      // path that used to finish green and silent.
      writeFileSync(
        join(cwd, 'spec', 'features', 'a-a0a0a0a0.yaml'),
        readFileSync(join(cwd, 'spec', 'features', 'a-a0a0a0a0.yaml'), 'utf8').replace('status: done', 'status: in_progress'),
      );
      const outcome = runCheckStages({profile: 'push', silent: false});
      expect(outcome).toMatchObject({worst: 0, anyFailed: false});
      expect(outcome.attestationRefusal?.guard).toBe('feature status');
      const attestationNotes = stdout.lines.filter((note) => note.includes('attestation'));
      expect(attestationNotes.join('')).toContain('not refreshed');
      expect(attestationNotes.join('')).toContain('feature status');

      // `--strict` is the command every gate message names, and it enters the
      // legacy stamp branch first: the note has to survive that path too.
      stdout.lines.length = 0;
      const strict = runCheckStages({profile: 'push', tier: 'pre-push', strict: true, silent: false});
      expect(strict).toMatchObject({worst: 0, anyFailed: false});
      expect(strict.attestationRefusal?.guard).toBe('feature status');
      expect(stdout.lines.filter((note) => note.includes('attestation')).join('')).toContain('not refreshed');
    } finally {
      process.chdir(cwdBefore);
      stdout.restore();
    }
  });

  test('[covers:F-a0bd9c5a/AC-3df52e18] a filed receipt never changes the digests it and its siblings are verified against', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    try {
      process.chdir(cwd);
      const receiptFreeInputs = (): {
        readonly expected: ReturnType<ReturnType<typeof workspaceExpectedDigestProducer>>;
        readonly independence: ReturnType<typeof workspaceIndependenceInputs>;
      } => {
        const closures = assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd));
        const {receiptContext} = workspaceReceiptCensus(cwd, closures);
        return {
          expected: workspaceExpectedDigestProducer(cwd, closures)(unsignedDraft()),
          independence: workspaceIndependenceInputs({
            cwd, closures, featureIds: [FEATURE_A, TARGET], receiptContext: receiptContext!,
          }),
        };
      };
      const before = receiptFreeInputs();
      expect(before.expected?.reviewedInputsSha256).toBeDefined();
      expect(before.independence.find((entry) => entry.feature === TARGET)?.verifiedAudits).toEqual([]);

      // Filing a receipt must not move the digests that receipt is verified
      // against. Derived from the receipt-carrying closure they would depend on
      // the receipt itself, and the receipt would stop verifying the instant it
      // was filed — leaving the independence view with nothing to read.
      fileVerifiedReceipt(cwd);
      const afterOwn = receiptFreeInputs();
      expect(afterOwn.expected).toEqual(before.expected);
      expect(afterOwn.independence.find((entry) => entry.feature === TARGET)?.verifiedAudits).toHaveLength(1);

      const seals = expectedTargetSeals(cwd);
      expect(seals.withReceipt).not.toBe(seals.withoutReceipt);
    } finally {
      process.chdir(cwdBefore);
    }
  });
});
