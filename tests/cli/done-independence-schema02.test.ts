// Cladding · F-8e7f399b — the schema 0.2 completion reports the ATTESTED
// independence label, not the evidence-ledger one.
//
// WHY this suite exists: `computeIndependence` reads any human-authored
// evidence entry as `independent`, so the person who implements a feature and
// then signs it off flips their own label. The assurance kernel that attests
// the completion answers a different question — it compares the receipt's
// issuer against the implementation authors — and calls the same completion
// `self-certified`. The two disagree exactly on the case the policy exists to
// catch, so a schema 0.2 completion must report and enforce the kernel's label.
//
// The fixture helpers below are deliberately a local copy of the ones in
// done-schema02-crash-safe.test.ts (which exports none of them): a completion
// only writes through the real F4 writer, so nothing here is a stub of it.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {independenceNote} from '../../src/cli/clad.js';
import {runDone, type DoneIndependenceLabel} from '../../src/cli/done.js';
import {readEvents} from '../../src/events/log.js';
import {newEvidence} from '../../src/hitl/identity.js';
import {captureAttestationInputSnapshot, writeAttestation} from '../../src/spec/attestation.js';
import {loadSpec} from '../../src/spec/load.js';
import {prospectiveDoneSpec} from '../../src/spec/prospective.js';
import {doneSelfCertRefusalLead} from '../../src/ui/softShell.js';
import type {Evidence} from '../../src/hitl/identity.js';
import type {GeneratedAttestationCompletion} from '../../src/spec/edit.js';
import {authoritativeFixtureVerdict, mintAuthoritativeFixtureV3} from '../assurance/authoritative-fixture.js';

const FEATURE = 'F-8e7f3990';
const FEATURE_PATH = 'spec/features/completion-label-8e7f3990.yaml';
const EVENT_LOG_PATH = '.cladding/events.log.jsonl';
const DIGEST = 'a'.repeat(64);
const roots: string[] = [];

/** A schema 0.2 workspace whose single feature is ready to complete. */
function workspace(policy?: 'label' | 'require'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-done-indep-02-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: completion-label', '  language: typescript',
    '  purpose: Report the attested independence label.', '  assurance_level: L2',
    '  scenario_policy: advisory',
    ...(policy ? [`  independence_policy: ${policy}`] : []), '',
  ].join('\n'));
  writeFileSync(join(root, FEATURE_PATH), [
    `id: ${FEATURE}`, 'title: Completion reports the attested label', 'status: in_progress',
    'purpose: Report the label the receipt carries.', 'modules: []', 'depends_on: []',
    'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-8e7f3991', '    kind: behavior',
    '    statement: The system shall report the attested independence label.', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  writeFileSync(join(root, 'package.json'), '{"name":"completion-label"}\n');
  return root;
}

/** A schema 0.1 workspace — the legacy evidence-ledger route. */
function legacyWorkspace(): {root: string; shardPath: string} {
  const root = mkdtempSync(join(tmpdir(), 'clad-done-indep-01-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\n');
  const shardPath = join(root, 'spec', 'features', 'legacy-label-8e7f3992.yaml');
  writeFileSync(shardPath, [
    '# legacy independence fixture', 'id: F-8e7f3992', 'slug: legacy-label',
    'status: in_progress', 'title: A legacy feature that keeps the ledger label',
    'acceptance_criteria:', '  - id: AC-001', '    text: The system shall keep the ledger label.', '',
  ].join('\n'));
  return {root, shardPath};
}

function humanEvidence(featureId: string): Evidence {
  return newEvidence({
    featureId, stage: 'stage_4.1', kind: 'pass', identity: {author: 'human'}, content: 'human reviewed',
  });
}

function canonicalManifest(root: string): Record<string, string | null> {
  const paths = ['spec.yaml', FEATURE_PATH, 'spec/index.yaml', 'spec/attestation.yaml', EVENT_LOG_PATH];
  return Object.fromEntries(paths.map((path) => {
    const absolute = join(root, path);
    return [path, existsSync(absolute) ? readFileSync(absolute, 'utf8') : null];
  }));
}

function completionSnapshot(root: string): ReturnType<typeof captureAttestationInputSnapshot> {
  const captured = captureAttestationInputSnapshot(root, loadSpec(root));
  return {...captured, runtime: {inputSha256: DIGEST, complete: true, matchesCurrent: () => true}};
}

function greenV3() {
  const verdict = authoritativeFixtureVerdict(reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses: [`feature:${FEATURE}`], inputAddresses: [`feature:${FEATURE}`], inputSha256: DIGEST,
    hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false,
    requiresHuman: false, environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6']
      .map((stage) => ({stage, status: 'pass' as const})),
  }));
  return mintAuthoritativeFixtureV3({
    verdict, feature: FEATURE, contractSha256: DIGEST, subjectSha256: DIGEST,
    verificationSha256: DIGEST, runtimeDependencySha256: DIGEST, registrySha256: DIGEST,
    detectorCatalogSha256: DIGEST, toolIdentity: 'cladding-test', environmentClass: 'test',
    trustSnapshotSha256: DIGEST,
  })!;
}

function stamp(
  root: string,
  completion: GeneratedAttestationCompletion,
  snapshot?: ReturnType<typeof captureAttestationInputSnapshot>,
): void {
  writeAttestation(root, prospectiveDoneSpec(loadSpec(root), FEATURE), undefined, [greenV3()], snapshot, {
    writeLegacy: false, completion,
  });
}

/**
 * Runs a completion whose gate publishes `kernelLabel` and, when the profile
 * clears, commits through the real writer. Returns the outcome plus the event
 * payload the writer was handed.
 */
function completeWith(
  root: string,
  kernelLabel: DoneIndependenceLabel | undefined,
  seam?: {policy: 'label' | 'require'; evidence: readonly Evidence[]},
): {result: ReturnType<typeof runDone>; committedPayload?: Record<string, unknown>} {
  let snapshot: ReturnType<typeof captureAttestationInputSnapshot> | undefined;
  let committedPayload: Record<string, unknown> | undefined;
  const result = runDone(root, FEATURE, {
    checkStages: () => {
      snapshot = completionSnapshot(root);
      return {
        worst: 0,
        ...(kernelLabel ? {assurance: {independence: kernelLabel}} : {}),
        commitAttestation: (completion) => {
          committedPayload = completion.event.payload as Record<string, unknown>;
          stamp(root, completion, snapshot);
        },
      };
    },
    ...(seam ? {independence: seam} : {}),
  });
  return {result, ...(committedPayload ? {committedPayload} : {})};
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F-8e7f399b — schema 0.2 completion reports the attested independence label', () => {
  test('[covers:F-8e7f399b/AC-73e0401d][covers:F-8e7f399b/AC-64feb2ea] a completion reports the kernel label and seals no ledger label into its event', () => {
    const root = workspace('label');
    // The ledger would call this feature `independent` — a human evidence entry
    // exists — while the kernel that attested the completion says otherwise.
    const {result, committedPayload} = completeWith(root, 'self-certified', {
      policy: 'label', evidence: [humanEvidence(FEATURE)],
    });

    expect(result).toMatchObject({
      ok: true, code: 0, schemaVersion: '0.2',
      independence: 'self-certified', independence_source: 'assurance-kernel',
    });
    expect(readFileSync(join(root, FEATURE_PATH), 'utf8')).toContain('status: done');

    expect(committedPayload).toBeDefined();
    expect(committedPayload).not.toHaveProperty('independence');
    const events = readEvents(root).filter((event) => event.type === 'done_attempted');
    expect(events).toHaveLength(1);
    expect(events[0].payload).not.toHaveProperty('independence');
  });

  test('[covers:F-8e7f399b/AC-73e0401d] every kernel label reaches the completion result unchanged', () => {
    for (const label of ['independent', 'self-certified', 'not-applicable', 'unobserved'] as const) {
      const root = workspace('label');
      const {result} = completeWith(root, label, {policy: 'label', evidence: [humanEvidence(FEATURE)]});
      expect(result).toMatchObject({ok: true, independence: label, independence_source: 'assurance-kernel'});
    }
  });

  test('[covers:F-8e7f399b/AC-73e0401d] a gate that attested no label reports the completion as unobserved', () => {
    const root = workspace('label');
    const {result} = completeWith(root, undefined, {policy: 'label', evidence: [humanEvidence(FEATURE)]});
    expect(result).toMatchObject({ok: true, independence: 'unobserved', independence_source: 'assurance-kernel'});
  });

  test('[covers:F-8e7f399b/AC-c426d070] require refuses a self-certified, an unobserved, and an unlabelled completion, leaving the shard byte-exact', () => {
    for (const label of ['self-certified', 'unobserved', undefined] as const) {
      const root = workspace('require');
      const before = canonicalManifest(root);
      // A human signoff is on the ledger, so only the attested label can refuse.
      const {result} = completeWith(root, label, {policy: 'require', evidence: [humanEvidence(FEATURE)]});

      expect(result.ok).toBe(false);
      expect(result.code).toBe(1);
      expect(result.reason).toContain(doneSelfCertRefusalLead());
      expect(result.independence).toBe(label ?? 'unobserved');
      expect(result.independence_source).toBe('assurance-kernel');
      expect(canonicalManifest(root)).toEqual(before);
      expect(readFileSync(join(root, FEATURE_PATH), 'utf8')).toContain('status: in_progress');
    }
  });

  test('[covers:F-8e7f399b/AC-c426d070] an unobserved refusal says the implementation authors are not fully mapped', () => {
    const root = workspace('require');
    const {result} = completeWith(root, 'unobserved', {policy: 'require', evidence: []});
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('implementation authors are not fully mapped');

    const selfCertified = completeWith(workspace('require'), 'self-certified', {policy: 'require', evidence: []});
    expect(selfCertified.result.reason).not.toContain('implementation authors are not fully mapped');
  });

  test('[covers:F-8e7f399b/AC-c426d070] a refusal asks for the review that would actually clear it', () => {
    // On schema 0.2 a sign-off by the implementation's own author moves nothing,
    // so the refusal must not suggest one.
    const {result} = completeWith(workspace('require'), 'self-certified', {policy: 'require', evidence: []});
    expect(result.reason).toContain(
      'Ask a registered issuer other than the implementation authors for a verified review',
    );
    expect(result.reason).not.toContain('Add a human sign-off');
  });

  test('[covers:F-8e7f399b/AC-dc3547cf] require keeps a completion the kernel called independent or not-applicable', () => {
    for (const label of ['independent', 'not-applicable'] as const) {
      const root = workspace('require');
      // Zero ledger evidence: only the attested label can clear the policy.
      const {result} = completeWith(root, label, {policy: 'require', evidence: []});

      expect(result).toMatchObject({ok: true, code: 0, independence: label, independence_source: 'assurance-kernel'});
      expect(readFileSync(join(root, FEATURE_PATH), 'utf8')).toContain('status: done');
      expect(readFileSync(join(root, 'spec', 'attestation.yaml'), 'utf8')).toContain('attested_v3:');
    }
  });

  test('[covers:F-8e7f399b/AC-c426d070] the label policy annotates without refusing an unobserved completion', () => {
    const root = workspace('label');
    const {result} = completeWith(root, 'unobserved', {policy: 'label', evidence: []});
    expect(result).toMatchObject({ok: true, code: 0, independence: 'unobserved'});
    expect(readFileSync(join(root, FEATURE_PATH), 'utf8')).toContain('status: done');
  });
});

describe('F-8e7f399b — schema 0.1 keeps the evidence-ledger label', () => {
  test('[covers:F-8e7f399b/AC-fb17bfcd] a legacy completion reports the ledger label and still seals it into its event', () => {
    const {root, shardPath} = legacyWorkspace();
    const feature = 'F-8e7f3992';
    const result = runDone(root, feature, {
      // A schema 0.1 gate publishes no assurance projection; even if one leaked
      // in, the legacy route must not read it.
      checkStages: () => ({worst: 0, assurance: {independence: 'self-certified'}}),
      independence: {policy: 'require', evidence: [humanEvidence(feature)]},
    });

    expect(result).toMatchObject({
      ok: true, code: 0, schemaVersion: '0.1',
      independence: 'independent', independence_source: 'evidence-ledger',
    });
    expect(readFileSync(shardPath, 'utf8')).toContain('status: done');
    const events = readEvents(root).filter((event) => event.type === 'done_attempted');
    expect(events[0].payload).toMatchObject({feature, kept: true, independence: 'independent'});
  });
});

describe('the note the completion prints names its label and its authority', () => {
  test('an evidence-ledger label keeps its shipped wording and every attested label reads differently', () => {
    // Schema 0.1 wording is unchanged, byte for byte.
    expect(independenceNote('independent', 'evidence-ledger'))
      .toBe('independence: independent — backed by human or independent review');
    expect(independenceNote('self-certified', 'evidence-ledger'))
      .toBe('independence: self-certified — no independent or human review yet');

    const attested = (['independent', 'self-certified', 'not-applicable', 'unobserved'] as const)
      .map((label) => independenceNote(label, 'assurance-kernel'));
    expect(new Set(attested).size).toBe(4);
    expect(attested[0]).toContain('other than the implementation authors');
    expect(attested[1]).toContain('the implementation author signed');
    expect(attested[2]).toContain('asks for no human review');
    expect(attested[3]).toContain('not fully mapped');
    // The attested self-certified line must not be mistaken for the ledger one.
    expect(attested[1]).not.toBe(independenceNote('self-certified', 'evidence-ledger'));
  });
});
