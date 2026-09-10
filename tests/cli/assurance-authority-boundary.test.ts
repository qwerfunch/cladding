// Cladding · F6 P1-1 — runCheckStages is the sole v3 authority mint.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {assuranceProfile} from '../../src/assurance/kernel.js';

const pass = () => ({pass: true, exitCode: 0});
const runDriftStage = vi.fn(pass);
const runCommitStage = vi.fn(pass);

// These are registered stage adapters, not caller-supplied LegacyStage rows.
// The coordinator still constructs the compiler plan, captures its snapshot,
// reduces the current outputs, and enters the real writer path.
vi.mock('../../src/stages/type.js', () => ({runType: pass}));
vi.mock('../../src/stages/lint.js', () => ({runLint: pass}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: () => runDriftStage()}));
vi.mock('../../src/stages/commit.js', () => ({runCommit: () => runCommitStage()}));
vi.mock('../../src/stages/arch.js', () => ({runArch: pass}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: pass}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: pass}));
vi.mock('../../src/stages/cov.js', () => ({runCov: pass}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: pass}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: pass}));

const [{runCheckStages}, {runDone}, {createWorkspaceAttestations, runnerConfigurationResolver}, {compileSpecWorkspace}, {emptyTrustSnapshot}, {loadSpec}, {markFeatureDoneForGate, prepareSchema02DoneEvent}, {detectorCatalogSha256, writeAttestation}, {allDetectors}, {getCurrentCladdingVersion}, {prospectiveDoneCompilation}] = await Promise.all([
  import('../../src/cli/clad.js'),
  import('../../src/cli/done.js'),
  import('../../src/assurance/workspace.js'),
  import('../../src/spec/compiler/compile.js'),
  import('../../src/proof/receipt.js'),
  import('../../src/spec/load.js'),
  import('../../src/spec/edit.js'),
  import('../../src/spec/attestation.js'),
  import('../../src/stages/detectors/index.js'),
  import('../../src/init/host-setup.js'),
  import('../../src/spec/prospective.js'),
]);

const FEATURE_A = 'F-a0a0a0a0';
const FEATURE_B = 'F-b0b0b0b0';
const FEATURE_C = 'F-c0c0c0c0';
const roots: string[] = [];

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-f6-authority-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  mkdirSync(join(cwd, 'src'), {recursive: true});
  writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = true;\n');
  writeFileSync(join(cwd, 'src', 'b.ts'), 'export const b = true;\n');
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: authority-fixture', '  language: typescript',
    '  purpose: Seal v3 only from the coordinator.', '  assurance_level: L1', '  scenario_policy: advisory', '',
  ].join('\n'));
  const shard = (id: string, title: string, module: string): string => [
    `id: ${id}`, `title: ${title}`, 'status: done', 'purpose: Keep the attestation scope exact.',
    `modules: [${module}]`, 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    `  - id: AC-${id.slice(2)}`, '    kind: behavior', '    statement: The system shall preserve the exact gate authority scope.', '',
  ].join('\n');
  writeFileSync(join(cwd, 'spec', 'features', 'a-a0a0a0a0.yaml'), shard(FEATURE_A, 'A', 'src/a.ts'));
  writeFileSync(join(cwd, 'spec', 'features', 'b-b0b0b0b0.yaml'), shard(FEATURE_B, 'B', 'src/b.ts'));
  writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  return cwd;
}

afterEach(() => {
  vi.restoreAllMocks();
  runDriftStage.mockReset();
  runDriftStage.mockImplementation(pass);
  runCommitStage.mockReset();
  runCommitStage.mockImplementation(pass);
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

function addInProgressCompletion(cwd: string): void {
  writeFileSync(join(cwd, 'src', 'c.ts'), 'export const c = true;\n');
  writeFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), [
    `id: ${FEATURE_C}`, 'title: C', 'status: in_progress', 'purpose: Complete only after its prerequisite closure is verified.',
    'modules: [src/c.ts]', `depends_on: [${FEATURE_A}]`, 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-c0c0c0c0', '    kind: behavior', '    statement: The system shall retain its prerequisite receipt without reminting it.', '',
  ].join('\n'));
}

function completionArtifacts(cwd: string): Record<string, string | null> {
  return Object.fromEntries([
    'spec.yaml', 'spec/features/c-c0c0c0c0.yaml', 'spec/index.yaml', 'spec/attestation.yaml', '.cladding/events.log.jsonl',
  ].map((path) => [path, existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), 'utf8') : null]));
}

describe('F6 P1-1 authoritative verdict boundary', () => {
  test('executes the exact schema 0.2 profile membership and reserves Commit for release', () => {
    const cwdBefore = process.cwd();
    try {
      for (const profile of ['feedback', 'checkpoint', 'completion', 'push'] as const) {
        const cwd = workspace();
        process.chdir(cwd);
        runCommitStage.mockImplementation(() => { throw new Error(`Commit must not run for ${profile}`); });
        const outcome = runCheckStages({profile, silent: true});
        expect(outcome.stages?.map((stage) => stage.stage)).toEqual(assuranceProfile(profile, 'L1').obligations);
        expect([...new Set(outcome.assurance?.results.map((result) => result.obligation))]).toEqual(assuranceProfile(profile, 'L1').obligations);
        expect(outcome.assurance?.results.some((result) => result.obligation === 'stage_1.4')).toBe(false);
        expect(runCommitStage).not.toHaveBeenCalled();
        runCommitStage.mockClear();
        process.chdir(cwdBefore);
      }

      const cwd = workspace();
      process.chdir(cwd);
      runCommitStage.mockImplementation(() => ({pass: false, exitCode: 1}));
      const release = runCheckStages({profile: 'release', silent: true});
      expect(release.stages?.map((stage) => stage.stage)).toEqual(assuranceProfile('release', 'L1').obligations);
      expect([...new Set(release.assurance?.results.map((result) => result.obligation))]).toEqual(assuranceProfile('release', 'L1').obligations);
      expect(release).toMatchObject({worst: 1, anyFailed: true});
      expect(release.assurance).toMatchObject({state: 'red', profile_complete: true});
      expect(release.assurance?.results.find((result) => result.obligation === 'stage_1.4')).toMatchObject({state: 'fail'});
      expect(runCommitStage).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  test('keeps L2 Unit and Coverage applicable for done compiler criteria without bindings', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    try {
      writeFileSync(join(cwd, 'spec.yaml'), readFileSync(join(cwd, 'spec.yaml'), 'utf8').replace('assurance_level: L1', 'assurance_level: L2'));
      writeFileSync(join(cwd, 'spec', 'features', 'b-b0b0b0b0.yaml'), readFileSync(join(cwd, 'spec', 'features', 'b-b0b0b0b0.yaml'), 'utf8').replace('status: done', 'status: planned'));
      process.chdir(cwd);
      const outcome = runCheckStages({profile: 'push', silent: true});
      expect(outcome).toMatchObject({worst: 1, anyFailed: true});
      expect(outcome.assurance).toMatchObject({state: 'unresolved', profile_complete: false});
      for (const obligation of ['stage_2.1', 'stage_2.2']) {
        expect(outcome.assurance?.results.find((result) => result.obligation === obligation
          && result.subject === `criterion:${FEATURE_A}/AC-a0a0a0a0`)?.state).toBe('unobserved');
        expect(outcome.assurance?.results.filter((result) => result.obligation === obligation
          && result.subject.startsWith('scope:')))
          .toEqual([expect.objectContaining({state: 'pass'})]);
      }
      expect(existsSync(join(cwd, 'spec', 'attestation.yaml'))).toBe(false);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  test('treats a prospective completion as an L2 proof subject before it writes done', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    try {
      writeFileSync(join(cwd, 'spec.yaml'), readFileSync(join(cwd, 'spec.yaml'), 'utf8').replace('assurance_level: L1', 'assurance_level: L2'));
      addInProgressCompletion(cwd);
      process.chdir(cwd);
      const gate = markFeatureDoneForGate(cwd, FEATURE_C);
      const outcome = runCheckStages({
        profile: 'completion', scopeSubjects: [`feature:${FEATURE_C}`], deferAttestation: true,
        prospectiveFeatureId: FEATURE_C, completionGate: gate, completionEvent: prepareSchema02DoneEvent(cwd, gate), silent: true,
      });
      expect(outcome).toMatchObject({worst: 1, anyFailed: true});
      expect(outcome.assurance).toMatchObject({state: 'unresolved', profile_complete: false});
      for (const obligation of ['stage_2.1', 'stage_2.2']) {
        expect(outcome.assurance?.results.find((result) => result.obligation === obligation && result.subject === `criterion:${FEATURE_C}/AC-c0c0c0c0`))
          .toMatchObject({state: 'unobserved'});
      }
      expect(outcome.commitAttestation).toBeUndefined();
      expect(existsSync(join(cwd, 'spec', 'attestation.yaml'))).toBe(false);
      expect(loadSpec(cwd).features.find((feature) => feature.id === FEATURE_C)?.status).toBe('in_progress');
    } finally {
      process.chdir(cwdBefore);
    }
  });

  test('the actual coordinator mints and writes only its compiler-effective feature scope', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.chdir(cwd);
      const outcome = runCheckStages({
        profile: 'completion', scopeSubjects: [`feature:${FEATURE_A}`], silent: true,
      });
      expect(outcome).toMatchObject({worst: 0, anyFailed: false});
      const verdict = outcome.assurance!;
      const attestationInput = {
        cwd,
        compilation: compileSpecWorkspace(cwd),
        verdict,
        featureIds: [FEATURE_A, FEATURE_B],
        detectorCatalogSha256: detectorCatalogSha256(allDetectors),
        toolIdentity: getCurrentCladdingVersion() ?? 'unknown',
        environmentClass: 'foreground',
        trustSnapshotSha256: emptyTrustSnapshot().digest,
      };
      const source = join(cwd, 'src', 'a.ts');
      const original = readFileSync(source, 'utf8');
      writeFileSync(source, 'export const a = false;\n');
      // A real gate verdict alone cannot be paired with caller-selected
      // closure fields: the workspace mint rechecks gate-time feature seals.
      expect(createWorkspaceAttestations(attestationInput)).toEqual([]);
      writeFileSync(source, original);
      expect(createWorkspaceAttestations({
        ...attestationInput,
        detectorCatalogSha256: 'f'.repeat(64),
      })).toEqual([]);
      const entries = createWorkspaceAttestations(attestationInput);
      expect(entries.map((entry) => entry.feature)).toEqual([FEATURE_A]);
      expect(writeAttestation(cwd, loadSpec(cwd), undefined, entries, undefined, {writeLegacy: false})).toBe(true);
      const attestation = readFileSync(join(cwd, 'spec', 'attestation.yaml'), 'utf8');
      expect(attestation).toContain(`  ${FEATURE_A}:`);
      expect(attestation).not.toContain(`"feature":"${FEATURE_B}"`);
      expect(attestation).toContain('"attestation_schema":"3"');
      // The writer boundary rechecks the result-to-observation association,
      // not just the outer GREEN object and its input/scope strings.
      (verdict.results[0]!.observation_identities as string[]).push('tampered-observation');
      expect(createWorkspaceAttestations({
        ...attestationInput,
        compilation: compileSpecWorkspace(cwd),
        verdict,
        featureIds: [FEATURE_A],
      })).toEqual([]);
    } finally {
      process.chdir(cwdBefore);
      stdout.mockRestore();
    }
  });

  test('completes a dirty schema 0.2 migration workspace without invoking Commit', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      addInProgressCompletion(cwd);
      writeFileSync(join(cwd, 'migration-scratch.yaml'), 'migration: pending\n');
      mkdirSync(join(cwd, 'host-managed-dependencies'));
      symlinkSync(join(cwd, 'host-managed-dependencies'), join(cwd, 'node_modules'));
      process.chdir(cwd);
      runCommitStage.mockImplementation(() => { throw new Error('Commit must not run for completion'); });

      const result = runDone(cwd, FEATURE_C, {checkStages: runCheckStages});

      expect(result).toMatchObject({ok: true, code: 0});
      expect(runCommitStage).not.toHaveBeenCalled();
      expect(readFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), 'utf8')).toContain('status: done');
      expect(readFileSync(join(cwd, 'spec', 'attestation.yaml'), 'utf8')).toContain('"attestation_schema":"3"');
      expect(readFileSync(join(cwd, '.cladding', 'events.log.jsonl'), 'utf8')).toContain('"type":"done_attempted"');
    } finally {
      process.chdir(cwdBefore);
      stdout.mockRestore();
    }
  });

  test('ignores an excluded dependency symlink but still rejects a non-control symlink', () => {
    const cwd = workspace();
    mkdirSync(join(cwd, 'host-managed-dependencies'));
    mkdirSync(join(cwd, 'node_modules'));
    const physical = runnerConfigurationResolver(cwd)('profile', 'completion');
    rmSync(join(cwd, 'node_modules'), {recursive: true});
    symlinkSync(join(cwd, 'host-managed-dependencies'), join(cwd, 'node_modules'));
    expect(runnerConfigurationResolver(cwd)('profile', 'completion')).toEqual(physical);

    symlinkSync(join(cwd, 'host-managed-dependencies'), join(cwd, 'runner.config.ts'));
    expect(runnerConfigurationResolver(cwd)('profile', 'completion'))
      .toMatchObject({complete: false, unknown_controls: ['symlink:runner.config.ts']});
  });

  test('completion flags require one prepared root-bound gate and scope every stage to its prospective target', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.chdir(cwd);
      addInProgressCompletion(cwd);
      const rawOptions = {
        profile: 'completion', scopeSubjects: [`feature:${FEATURE_C}`], deferAttestation: true,
        prospectiveFeatureId: FEATURE_C, silent: true,
      } as const;
      const before = completionArtifacts(cwd);
      expect(runCheckStages(rawOptions)).toMatchObject({worst: 1, anyFailed: true, stages: [], error: expect.any(String)});
      expect(completionArtifacts(cwd)).toEqual(before);
      expect(runDriftStage).not.toHaveBeenCalled();

      const clonedSource = markFeatureDoneForGate(cwd, FEATURE_C);
      const cloned = {...clonedSource};
      expect(runCheckStages({
        ...rawOptions,
        completionGate: cloned,
        completionEvent: prepareSchema02DoneEvent(cwd, clonedSource),
      })).toMatchObject({worst: 1, stages: []});
      const mutated = markFeatureDoneForGate(cwd, FEATURE_C);
      const mutatedEvent = prepareSchema02DoneEvent(cwd, mutated);
      (mutated.rollback.feature as {before: string}).before = mutated.rollback.feature.before.replace('in_progress', 'planned');
      expect(runCheckStages({...rawOptions, completionGate: mutated, completionEvent: mutatedEvent})).toMatchObject({worst: 1, stages: []});

      const other = workspace();
      addInProgressCompletion(other);
      const crossWorkspace = markFeatureDoneForGate(cwd, FEATURE_C);
      const crossWorkspaceEvent = prepareSchema02DoneEvent(cwd, crossWorkspace);
      const otherBefore = completionArtifacts(other);
      process.chdir(other);
      expect(runCheckStages({
        ...rawOptions,
        completionGate: crossWorkspace,
        completionEvent: crossWorkspaceEvent,
      })).toMatchObject({worst: 1, stages: []});
      expect(completionArtifacts(other)).toEqual(otherBefore);
      process.chdir(cwd);

      const interrupted = markFeatureDoneForGate(cwd, FEATURE_C);
      const interruptedOptions = {
        ...rawOptions,
        completionGate: interrupted,
        completionEvent: prepareSchema02DoneEvent(cwd, interrupted),
      };
      runDriftStage.mockImplementationOnce(() => { throw new Error('stage interruption'); });
      expect(() => runCheckStages(interruptedOptions)).toThrow('stage interruption');
      runDriftStage.mockClear();
      expect(runCheckStages(interruptedOptions)).toMatchObject({worst: 1, stages: []});
      expect(runDriftStage).not.toHaveBeenCalled();
      expect(loadSpec(cwd).features.find((feature) => feature.id === FEATURE_C)?.status).toBe('in_progress');
      expect(compileSpecWorkspace(cwd).contract?.features.find((feature) => feature.id === FEATURE_C)?.status).toBe('in_progress');

      const red = markFeatureDoneForGate(cwd, FEATURE_C);
      const redOptions = {
        ...rawOptions,
        completionGate: red,
        completionEvent: prepareSchema02DoneEvent(cwd, red),
      };
      runDriftStage.mockImplementationOnce(() => ({pass: false, exitCode: 1}));
      expect(runCheckStages(redOptions)).toMatchObject({worst: 1, anyFailed: true});
      runDriftStage.mockClear();
      expect(runCheckStages(redOptions)).toMatchObject({worst: 1, stages: []});
      expect(runDriftStage).not.toHaveBeenCalled();

      let observedStatus: string | undefined;
      runDriftStage.mockImplementation(() => {
        observedStatus = loadSpec('.').features.find((feature) => feature.id === FEATURE_C)?.status;
        return pass();
      });
      const gate = markFeatureDoneForGate(cwd, FEATURE_C);
      const completionOptions = {
        ...rawOptions,
        silent: false as const,
        completionGate: gate,
        completionEvent: prepareSchema02DoneEvent(cwd, gate, 'self-certified'),
      };
      const outcome = runCheckStages(completionOptions);
      expect(observedStatus).toBe('done');
      expect(outcome).toMatchObject({worst: 0, anyFailed: false, commitAttestation: expect.any(Function)});
      expect(loadSpec(cwd).features.find((feature) => feature.id === FEATURE_C)?.status).toBe('in_progress');
      expect(compileSpecWorkspace(cwd).contract?.features.find((feature) => feature.id === FEATURE_C)?.status).toBe('in_progress');

      const completion = {
        rollback: gate.rollback,
        targetGeneration: gate.targetGeneration,
        targetBytes: gate.targetBytes,
        rootBefore: gate.rootBefore,
        attestationBefore: gate.attestationBefore,
        event: {type: 'done_attempted' as const, payload: {
          feature: FEATURE_C, worst: 0 as const, anyFailed: false as const, kept: true as const, blockers: [] as const,
          independence: 'self-certified' as const,
        }},
      };
      // The mark was consumed at the first start, so a later attempt cannot
      // replace the stored GREEN writer phase before it commits.
      runDriftStage.mockClear();
      expect(runCheckStages(completionOptions)).toMatchObject({worst: 1, stages: []});
      expect(runDriftStage).not.toHaveBeenCalled();
      const writerCrossRootBefore = completionArtifacts(other);
      process.chdir(other);
      expect(() => outcome.commitAttestation!(completion)).toThrow();
      expect(completionArtifacts(other)).toEqual(writerCrossRootBefore);
      process.chdir(cwd);
      expect(() => outcome.commitAttestation!({
        ...completion,
        event: {...completion.event, payload: {...completion.event.payload, independence: 'independent'}},
      })).toThrow();
      expect(() => outcome.commitAttestation!({
        ...completion,
        event: {...completion.event, payload: {...completion.event.payload, extra: true}},
      } as unknown as typeof completion)).toThrow();
      outcome.commitAttestation!(completion);
      const committed = completionArtifacts(cwd);
      expect(readFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), 'utf8')).toContain('status: done');
      expect(readFileSync(join(cwd, '.cladding', 'events.log.jsonl'), 'utf8')).toContain('"type":"done_attempted"');
      expect(() => outcome.commitAttestation!(completion)).toThrow();
      expect(completionArtifacts(cwd)).toEqual(committed);
    } finally {
      process.chdir(cwdBefore);
      stdout.mockRestore();
    }
  });

  test('a newer same-target gate epoch retires every older deferred writer before its stages finish', () => {
    const cwd = workspace();
    const cwdBefore = process.cwd();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.chdir(cwd);
      addInProgressCompletion(cwd);
      const optionsFor = (mark: ReturnType<typeof markFeatureDoneForGate>) => ({
        profile: 'completion' as const,
        scopeSubjects: [`feature:${FEATURE_C}`],
        deferAttestation: true,
        prospectiveFeatureId: FEATURE_C,
        completionGate: mark,
        completionEvent: prepareSchema02DoneEvent(cwd, mark),
        silent: false,
      });
      const packetFor = (mark: ReturnType<typeof markFeatureDoneForGate>) => ({
        rollback: mark.rollback,
        targetGeneration: mark.targetGeneration,
        targetBytes: mark.targetBytes,
        rootBefore: mark.rootBefore,
        attestationBefore: mark.attestationBefore,
        event: {type: 'done_attempted' as const, payload: {
          feature: FEATURE_C,
          worst: 0 as const,
          anyFailed: false as const,
          kept: true as const,
          blockers: [] as const,
        }},
      });

      const first = markFeatureDoneForGate(cwd, FEATURE_C);
      const firstOutcome = runCheckStages(optionsFor(first));
      expect(firstOutcome.commitAttestation).toEqual(expect.any(Function));
      const red = markFeatureDoneForGate(cwd, FEATURE_C);
      runDriftStage.mockImplementationOnce(() => ({pass: false, exitCode: 1}));
      expect(runCheckStages(optionsFor(red))).toMatchObject({worst: 1, anyFailed: true});
      const beforeRed = completionArtifacts(cwd);
      expect(() => firstOutcome.commitAttestation!(packetFor(first))).toThrow();
      expect(completionArtifacts(cwd)).toEqual(beforeRed);

      const beforeThrow = markFeatureDoneForGate(cwd, FEATURE_C);
      const beforeThrowOutcome = runCheckStages(optionsFor(beforeThrow));
      expect(beforeThrowOutcome.commitAttestation).toEqual(expect.any(Function));
      const thrown = markFeatureDoneForGate(cwd, FEATURE_C);
      runDriftStage.mockImplementationOnce(() => { throw new Error('new epoch interrupted'); });
      expect(() => runCheckStages(optionsFor(thrown))).toThrow('new epoch interrupted');
      const artifactsBeforeStaleThrow = completionArtifacts(cwd);
      expect(() => beforeThrowOutcome.commitAttestation!(packetFor(beforeThrow))).toThrow();
      expect(completionArtifacts(cwd)).toEqual(artifactsBeforeStaleThrow);

      const earlier = markFeatureDoneForGate(cwd, FEATURE_C);
      const earlierOutcome = runCheckStages(optionsFor(earlier));
      const latest = markFeatureDoneForGate(cwd, FEATURE_C);
      const latestOutcome = runCheckStages(optionsFor(latest));
      const artifactsBeforeEarlierWriter = completionArtifacts(cwd);
      expect(() => earlierOutcome.commitAttestation!(packetFor(earlier))).toThrow();
      expect(completionArtifacts(cwd)).toEqual(artifactsBeforeEarlierWriter);
      latestOutcome.commitAttestation!(packetFor(latest));
      expect(readFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), 'utf8')).toContain('status: done');
      expect(() => latestOutcome.commitAttestation!(packetFor(latest))).toThrow();
    } finally {
      process.chdir(cwdBefore);
      stdout.mockRestore();
    }
  });

  test('a deferred completion keeps its impact-scope prerequisite as a retained sibling, not a replacement', () => {
    const cwd = workspace();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cwdBefore = process.cwd();
    try {
      process.chdir(cwd);
      writeFileSync(join(cwd, 'src', 'c.ts'), 'export const c = true;\n');
      writeFileSync(join(cwd, 'spec', 'features', 'c-c0c0c0c0.yaml'), [
        `id: ${FEATURE_C}`, 'title: C', 'status: in_progress', 'purpose: Complete only after its prerequisite closure is verified.',
        'modules: [src/c.ts]', `depends_on: [${FEATURE_A}]`, 'capability_refs: []', 'acceptance_criteria:',
        '  - id: AC-c0c0c0c0', '    kind: behavior', '    statement: The system shall retain its prerequisite receipt without reminting it.', '',
      ].join('\n'));
      const initial = runCheckStages({profile: 'completion', scopeSubjects: [`feature:${FEATURE_A}`], silent: true});
      expect(initial).toMatchObject({worst: 0, anyFailed: false});
      const initialEntries = createWorkspaceAttestations({
        cwd,
        compilation: compileSpecWorkspace(cwd),
        verdict: initial.assurance!,
        featureIds: [FEATURE_A],
        detectorCatalogSha256: detectorCatalogSha256(allDetectors),
        toolIdentity: getCurrentCladdingVersion() ?? 'unknown',
        environmentClass: 'foreground',
        trustSnapshotSha256: emptyTrustSnapshot().digest,
      });
      expect(initialEntries.map((entry) => entry.feature)).toEqual([FEATURE_A]);
      expect(writeAttestation(cwd, loadSpec(cwd), undefined, initialEntries, undefined, {writeLegacy: false})).toBe(true);
      const attestationPath = join(cwd, 'spec', 'attestation.yaml');
      const prerequisiteRow = readFileSync(attestationPath, 'utf8').split('\n')
        .find((line) => line.startsWith(`  ${FEATURE_A}: `));
      expect(prerequisiteRow).toBeDefined();

      let plannerStatus: string | undefined;
      let plannerCompilerStatus: string | undefined;
      let detectorStatus: string | undefined;
      runDriftStage.mockImplementation(() => {
        detectorStatus = loadSpec('.').features.find((feature) => feature.id === FEATURE_C)?.status;
        return pass();
      });
      const completion = runDone(cwd, FEATURE_C, {
        checkStages: (options) => {
          // `runDone` has not begun the gate yet, so the disk-facing planner
          // cannot observe an authority overlay before capability consumption.
          plannerStatus = loadSpec(cwd).features.find((feature) => feature.id === FEATURE_C)?.status;
          plannerCompilerStatus = compileSpecWorkspace(cwd).contract?.features
            .find((feature) => feature.id === FEATURE_C)?.status;
          const outcome = runCheckStages(options);
          const replacements = createWorkspaceAttestations({
            cwd,
            compilation: prospectiveDoneCompilation(compileSpecWorkspace(cwd), FEATURE_C),
            verdict: outcome.assurance!,
            featureIds: [FEATURE_C],
            detectorCatalogSha256: detectorCatalogSha256(allDetectors),
            toolIdentity: getCurrentCladdingVersion() ?? 'unknown',
            environmentClass: 'foreground',
            trustSnapshotSha256: emptyTrustSnapshot().digest,
            receiptContext: {candidates: [], trustSnapshot: emptyTrustSnapshot()},
          });
          if (replacements.length === 0) throw new Error('target authority did not mint a replacement');
          if (!outcome.commitAttestation) {
            throw new Error('coordinator did not expose the deferred completion writer');
          }
          return outcome;
        },
      });
      expect(completion).toMatchObject({ok: true, code: 0});
      expect(plannerStatus).toBe('in_progress');
      expect(plannerCompilerStatus).toBe('in_progress');
      expect(detectorStatus).toBe('done');
      const rows = readFileSync(attestationPath, 'utf8').split('\n');
      expect(rows.find((line) => line.startsWith(`  ${FEATURE_A}: `))).toBe(prerequisiteRow);
      expect(rows.filter((line) => line.startsWith(`  ${FEATURE_C}: `))).toHaveLength(1);
      expect(rows.some((line) => line.startsWith(`  ${FEATURE_B}: {`))).toBe(false);
    } finally {
      process.chdir(cwdBefore);
      stdout.mockRestore();
    }
  });
});
