// Cladding · F6 schema-0.2 crash-safe completion boundary.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {doneCompletionGuidance} from '../../src/cli/clad.js';
import {runDone} from '../../src/cli/done.js';
import {readEvents} from '../../src/events/log.js';
import {captureAttestationInputSnapshot, writeAttestation} from '../../src/spec/attestation.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {loadSpec} from '../../src/spec/load.js';
import {prospectiveDoneSpec} from '../../src/spec/prospective.js';
import type {GeneratedAttestationCompletion} from '../../src/spec/edit.js';
import {authoritativeFixtureVerdict, mintAuthoritativeFixtureV3} from '../assurance/authoritative-fixture.js';

const FEATURE = 'F-6f6f6f6f';
const FEATURE_PATH = 'spec/features/completion-6f6f6f6f.yaml';
const EVENT_LOG_PATH = '.cladding/events.log.jsonl';
const DIGEST = 'a'.repeat(64);
const roots: string[] = [];

function workspace(seedEventLog = false): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f6-crash-safe-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: crash-safe', '  language: typescript',
    '  purpose: Keep completion crash safe.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(root, FEATURE_PATH), [
    `id: ${FEATURE}`, 'title: Crash safe completion', 'status: in_progress',
    'purpose: Publish completion only with proof.', 'modules: []', 'depends_on: []',
    'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-6f6f6f6e', '    kind: behavior', '    statement: The system shall publish a completion atomically.', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  writeFileSync(join(root, 'package.json'), '{"name":"crash-safe"}\n');
  if (seedEventLog) {
    mkdirSync(join(root, '.cladding'), {recursive: true});
    writeFileSync(join(root, EVENT_LOG_PATH), '{"id":"before","type":"feature_checkpoint","payload":{}}\n');
  }
  return root;
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
  return {
    ...captured,
    runtime: {
      inputSha256: DIGEST,
      complete: true,
      matchesCurrent: () => true,
    },
  };
}

function greenV3() {
  const verdict = authoritativeFixtureVerdict(reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses: [`feature:${FEATURE}`], inputAddresses: [`feature:${FEATURE}`], inputSha256: DIGEST,
    hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
    environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6'].map((stage) => ({stage, status: 'pass' as const})),
  }));
  return mintAuthoritativeFixtureV3({
    verdict, feature: FEATURE, contractSha256: DIGEST, subjectSha256: DIGEST,
    verificationSha256: DIGEST, runtimeDependencySha256: DIGEST, registrySha256: DIGEST,
    detectorCatalogSha256: DIGEST, toolIdentity: 'cladding-test', environmentClass: 'test', trustSnapshotSha256: DIGEST,
  })!;
}

function stamp(root: string, completion: GeneratedAttestationCompletion, snapshot?: ReturnType<typeof captureAttestationInputSnapshot>): void {
  writeAttestation(root, prospectiveDoneSpec(loadSpec(root), FEATURE), undefined, [greenV3()], snapshot, {
    writeLegacy: false,
    completion,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F6 schema-0.2 completion transaction', () => {
  test('[covers:F-6f0a2106/AC-6f0a2110] does not install a prospective overlay before the prepared gate starts, then commits status, projections, v3, and success event once', () => {
    const root = workspace();
    const before = canonicalManifest(root);
    let snapshot: ReturnType<typeof captureAttestationInputSnapshot> | undefined;
    let observedSpecStatus: string | undefined;
    let observedCompilerStatus: string | undefined;

    const result = runDone(root, FEATURE, {
      checkStages: (options) => {
        expect(options).toMatchObject({profile: 'completion', prospectiveFeatureId: FEATURE, deferAttestation: true});
        observedSpecStatus = loadSpec(root).features.find((feature) => feature.id === FEATURE)?.status;
        observedCompilerStatus = compileSpecWorkspace(root).contract?.features.find((feature) => feature.id === FEATURE)?.status;
        // No canonical claim exists while the gate is running.
        expect(canonicalManifest(root)).toEqual(before);
        snapshot = completionSnapshot(root);
        return {
          worst: 0,
          commitAttestation: (completion) => {
            // The final F4 writer must inspect disk, not the completed gate's
            // scoped overlay.  Its own disk-plus-prospective reconstitution
            // happens inside writeAttestation/commitGeneratedAttestation.
            expect(loadSpec(root).features.find((feature) => feature.id === FEATURE)?.status).toBe('in_progress');
            expect(compileSpecWorkspace(root).contract?.features.find((feature) => feature.id === FEATURE)?.status).toBe('in_progress');
            stamp(root, completion, snapshot);
          },
        };
      },
    });

    expect(result).toMatchObject({ok: true, code: 0});
    expect(observedSpecStatus).toBe('in_progress');
    expect(observedCompilerStatus).toBe('in_progress');
    expect(readFileSync(join(root, FEATURE_PATH), 'utf8')).toContain('status: done');
    expect(readFileSync(join(root, 'spec', 'index.yaml'), 'utf8')).toContain(`${FEATURE}: {slug: completion, status: done`);
    const attestation = readFileSync(join(root, 'spec', 'attestation.yaml'), 'utf8');
    expect(attestation).toContain('attested_v3:');
    expect(attestation).toContain(`  ${FEATURE}:`);
    expect(attestation).toContain('"attestation_schema":"3"');
    const events = readEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({type: 'done_attempted', payload: {feature: FEATURE, kept: true, worst: 0}});
  });

  test('[covers:F-c4df5fb4/AC-8057bdd4] a completed schema 0.2 feature is told to re-attest with the push profile before committing', () => {
    const root = workspace();
    let snapshot: ReturnType<typeof captureAttestationInputSnapshot> | undefined;
    const result = runDone(root, FEATURE, {
      checkStages: () => {
        snapshot = completionSnapshot(root);
        return {worst: 0, commitAttestation: (completion) => stamp(root, completion, snapshot)};
      },
    });

    expect(result).toMatchObject({ok: true, code: 0, schemaVersion: '0.2'});
    const guidance = doneCompletionGuidance(result);
    expect(guidance).toBe(
      'next: run clad check --tier=pre-push to re-attest sibling features, then commit spec/attestation.yaml',
    );
    // A refused completion, and the schema 0.1 route, add nothing.
    expect(doneCompletionGuidance({...result, ok: false})).toBeUndefined();
    expect(doneCompletionGuidance({ok: true, schemaVersion: '0.1'})).toBeUndefined();
  });

  test('[covers:F-6f0a2106/AC-6f0a2110] RED, thrown, missing-receipt, self-cert refusal, and writer failure leave canonical artifacts and event ledger byte-exact', () => {
    const attempts: readonly [string, (root: string) => ReturnType<typeof runDone>][] = [
      ['red', (root) => runDone(root, FEATURE, {checkStages: () => ({worst: 1})})],
      ['throw', (root) => runDone(root, FEATURE, {checkStages: () => { throw new Error('gate failure'); }})],
      ['no receipt', (root) => runDone(root, FEATURE, {checkStages: () => ({worst: 0})})],
      ['self certified', (root) => runDone(root, FEATURE, {checkStages: () => ({worst: 0, commitAttestation: () => undefined}), independence: {policy: 'require', evidence: []}})],
      ['writer failure', (root) => runDone(root, FEATURE, {checkStages: () => ({worst: 0, commitAttestation: () => { throw new Error('writer failure'); }})})],
    ];
    for (const [, attempt] of attempts) {
      for (const seedEventLog of [false, true]) {
        const root = workspace(seedEventLog);
        const before = canonicalManifest(root);
        expect(attempt(root).ok).toBe(false);
        expect(canonicalManifest(root)).toEqual(before);
        if (!seedEventLog) expect(existsSync(join(root, EVENT_LOG_PATH))).toBe(false);
      }
    }
  });

  test('rejects every malformed completion packet before it can journal a partial claim', () => {
    const cases: readonly [string, (completion: GeneratedAttestationCompletion) => unknown, boolean][] = [
      ['missing event', (completion) => ({...completion, event: undefined}), false],
      ['wrong event type', (completion) => ({...completion, event: {...completion.event, type: 'feature_checkpoint'}}), false],
      ['wrong event feature', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, feature: 'F-deadbeef'}}}), false],
      ['wrong event worst', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, worst: 1}}}), false],
      ['wrong event kept', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, kept: false}}}), false],
      ['wrong event anyFailed', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, anyFailed: true}}}), false],
      ['nonempty event blockers', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, blockers: ['stage_2.1']}}}), false],
      ['forged independence', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, independence: 'forged'}}}), false],
      ['extra event payload key', (completion) => ({...completion, event: {...completion.event, payload: {...completion.event.payload, extra: true}}}), false],
      ['cloned rollback capability', (completion) => ({...completion, rollback: {...completion.rollback, feature: {...completion.rollback.feature}}}), false],
      ['already-done source', (completion) => {
        const mutable = completion as unknown as {rollback: {feature: {before: string}}};
        mutable.rollback.feature.before = mutable.rollback.feature.before.replace('status: in_progress', 'status: done');
        return completion;
      }, false],
      ['non-in-progress source', (completion) => {
        const mutable = completion as unknown as {rollback: {feature: {before: string}}};
        mutable.rollback.feature.before = mutable.rollback.feature.before.replace('status: in_progress', 'status: planned');
        return completion;
      }, false],
      ['rollback post-hash mismatch', (completion) => {
        const mutable = completion as unknown as {rollback: {feature: {postHash: string}}};
        mutable.rollback.feature.postHash = 'b'.repeat(64);
        return completion;
      }, false],
      ['target bytes mismatch', (completion) => {
        const mutable = completion as unknown as {targetBytes: string};
        mutable.targetBytes = mutable.targetBytes.replace('status: done', 'status: planned');
        return completion;
      }, false],
      ['caller Spec differs from locked target', (completion) => completion, true],
    ];
    for (const [, mutate, mismatchedCallerSpec] of cases) {
      for (const seedEventLog of [false, true]) {
        const root = workspace(seedEventLog);
        const before = canonicalManifest(root);
        const result = runDone(root, FEATURE, {
          checkStages: () => ({
            worst: 0,
            commitAttestation: (completion) => {
              const candidate = mutate(completion) as GeneratedAttestationCompletion;
              expect(() => {
                if (mismatchedCallerSpec) {
                  writeAttestation(root, loadSpec(root), undefined, [greenV3()], completionSnapshot(root), {
                    writeLegacy: false,
                    completion: candidate,
                  });
                } else {
                  stamp(root, candidate, completionSnapshot(root));
                }
              }).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
              throw new Error('The completion writer rejected this malformed packet.');
            },
          }),
        });
        expect(result).toMatchObject({ok: false, code: 1});
        expect(canonicalManifest(root)).toEqual(before);
        if (!seedEventLog) expect(existsSync(join(root, EVENT_LOG_PATH))).toBe(false);
      }
    }
  });

  test('an injected interruption immediately before final journal publication leaves no completion bytes', () => {
    const root = workspace();
    const before = canonicalManifest(root);
    let snapshot: ReturnType<typeof captureAttestationInputSnapshot> | undefined;
    const result = runDone(root, FEATURE, {
      checkStages: () => {
        snapshot = completionSnapshot(root);
        return {
          worst: 0,
          commitAttestation: (completion) => stamp(root, {
            ...completion,
            testBeforeCommit: () => { throw new Error('InjectedTerminationBeforeCommit'); },
          }, snapshot),
        };
      },
    });
    expect(result).toMatchObject({ok: false, code: 1});
    expect(canonicalManifest(root)).toEqual(before);
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(false);
  });

  test('stale root preimage rejects before any completion write', () => {
    expectStaleCompletionInput(
      (root) => writeFileSync(join(root, 'spec.yaml'), `${readFileSync(join(root, 'spec.yaml'), 'utf8')}# changed\n`),
      (root, before) => expect(readFileSync(join(root, 'spec.yaml'), 'utf8')).toBe(`${before['spec.yaml'] ?? ''}# changed\n`),
    );
  });

  test('stale feature preimage rejects before any completion write', () => {
    expectStaleCompletionInput(
      (root) => writeFileSync(join(root, FEATURE_PATH), readFileSync(join(root, FEATURE_PATH), 'utf8').replace('title: Crash safe completion', 'title: stale feature')),
      (root, before) => expect(readFileSync(join(root, FEATURE_PATH), 'utf8')).toBe(
        (before[FEATURE_PATH] ?? '').replace('title: Crash safe completion', 'title: stale feature'),
      ),
    );
  });

  test('stale attestation preimage rejects before any completion write', () => {
    expectStaleCompletionInput(
      (root) => writeFileSync(join(root, 'spec', 'attestation.yaml'), 'foreign: attestation\n'),
      (root) => expect(readFileSync(join(root, 'spec', 'attestation.yaml'), 'utf8')).toBe('foreign: attestation\n'),
    );
  });

  test('stale verification control input rejects before any completion write', () => {
    expectStaleCompletionInput(
      (root) => writeFileSync(join(root, 'package.json'), '{"name":"changed-control"}\n'),
      (root) => expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{"name":"changed-control"}\n'),
    );
  });
});

function expectStaleCompletionInput(
  mutate: (root: string) => void,
  assertConcurrentWrite: (root: string, before: Record<string, string | null>) => void,
): void {
  const root = workspace();
  const before = canonicalManifest(root);
  const packageBefore = readFileSync(join(root, 'package.json'), 'utf8');
  let callbackExecuted = false;
  let snapshot: ReturnType<typeof captureAttestationInputSnapshot> | undefined;
  const result = runDone(root, FEATURE, {
    checkStages: () => {
      const captured = captureAttestationInputSnapshot(root, loadSpec(root));
      snapshot = {
        ...captured,
        runtime: {inputSha256: DIGEST, complete: true, matchesCurrent: () => readFileSync(join(root, 'package.json'), 'utf8') === packageBefore},
      };
      return {
        worst: 0,
        commitAttestation: (completion) => {
          callbackExecuted = true;
          expect(completion.rootBefore).toBe(before['spec.yaml']);
          expect(completion.rollback.feature.before).toBe(before[FEATURE_PATH]);
          expect(completion.attestationBefore).toBe(before['spec/attestation.yaml']);
          mutate(root);
          assertConcurrentWrite(root, before);
          stamp(root, completion, snapshot);
        },
      };
    },
  });

  expect(callbackExecuted).toBe(true);
  expect(result).toMatchObject({ok: false, code: 1});
  const after = canonicalManifest(root);
  // The direct competitor's bytes remain; no status, projection, or receipt
  // replacement may be layered over them by the rejected completion writer.
  assertConcurrentWrite(root, before);
  expect(after['spec/index.yaml']).toBe(before['spec/index.yaml']);
  expect(after[FEATURE_PATH]?.includes('status: done') ?? false).toBe(false);
  expect(after['spec/attestation.yaml']?.includes('"attestation_schema":"3"') ?? false).toBe(false);
}
