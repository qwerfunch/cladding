// Cladding · CLI assurance-profile tests.
//
// The warn-class suite below drives the REAL drift stage against a temporary
// workspace. Every other runner is inert so a developer's local toolchain
// cannot decide whether a warn became a blocking finding, and the drift
// registry holds one detector so the fixture's single lifecycle fact is the
// only thing the row can be reporting.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/stages/type.js', () => ({runType: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/lint.js', () => ({runLint: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/cov.js', () => ({runCov: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: () => ({pass: true, exitCode: 0})}));

import {exemptSolelyStaleAttestation, runCheckCommand, runCheckStages} from '../../src/cli/clad.js';
import {runDone, type DoneDeps} from '../../src/cli/done.js';
import {resolveRequestedAssuranceLevel} from '../../src/assurance/kernel.js';
import {normalizeProfile, profileBlocksWarnClass, type AssuranceLevel} from '../../src/assurance/registry.js';
import {allDetectors} from '../../src/stages/detectors/index.js';
import {staleSpecification} from '../../src/stages/detectors/stale-specification.js';
import {clearDetectors, registerDetector} from '../../src/stages/drift.js';
import type {GateStatus} from '../../src/stages/disposition.js';

const FEATURE = 'F-6f0a2106';
const roots: string[] = [];

function workspace(schema: '0.1' | '0.2'): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-assurance-profile-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  if (schema === '0.1') {
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\n');
    writeFileSync(join(cwd, 'spec', 'features', 'assurance-6f0a2106.yaml'), [
      `id: ${FEATURE}`, 'title: Assurance', 'status: in_progress', 'acceptance_criteria:',
      '  - id: AC-6f0a2101', '    text: The system shall retain the compatibility gate.', '',
    ].join('\n'));
  } else {
    writeFileSync(join(cwd, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: profile-fixture', '  language: typescript',
      '  purpose: Verify assurance profile routing.', '  assurance_level: L2', '  scenario_policy: advisory', '',
    ].join('\n'));
    writeFileSync(join(cwd, 'spec', 'features', 'assurance-6f0a2106.yaml'), [
      `id: ${FEATURE}`, 'title: Assurance', 'status: in_progress', 'purpose: Route completion through one assurance profile.',
      'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-6f0a2101', '    kind: behavior', '    statement: The system shall retain the completion route.', '',
    ].join('\n'));
    writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  }
  return cwd;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F6 assurance CLI routing', () => {
  test('rejects profile tier conflicts, downgrades, and unbounded stronger overrides', () => {
    expect(normalizeProfile('pre-commit')).toBe('checkpoint');
    expect(normalizeProfile('pre-push')).toBe('push');
    expect(normalizeProfile('all')).toBe('release');
    expect(resolveRequestedAssuranceLevel({configured: 'L2', requested: 'L1', boundedScope: true}).ok).toBe(false);
    expect(resolveRequestedAssuranceLevel({configured: 'L2', requested: 'L3', boundedScope: false}).ok).toBe(false);
    expect(resolveRequestedAssuranceLevel({configured: 'L2', requested: 'L3', boundedScope: true})).toEqual({ok: true, level: 'L3'});
  });

  test('rejects an invalid runtime assurance-level enum before invoking a gate', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    runCheckCommand({assuranceLevel: 'L9' as AssuranceLevel});
    expect(exit).toHaveBeenCalledWith(2);
    exit.mockRestore();
  });

  test('refuses release narrowing before stage execution for public aliases and internal callers', () => {
    const publicExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    runCheckCommand({profile: 'release', feature: FEATURE});
    runCheckCommand({tier: 'all', feature: FEATURE});
    expect(publicExit).toHaveBeenCalledTimes(2);
    expect(publicExit).toHaveBeenLastCalledWith(2);
    publicExit.mockRestore();

    const canonical = runCheckStages({profile: 'release', scopeSubjects: [`feature:${FEATURE}`], silent: true});
    const alias = runCheckStages({tier: 'all', focusModules: ['module-a'], silent: true});
    expect(canonical).toMatchObject({worst: 1, anyFailed: true, stages: [], error: expect.stringContaining('repository-wide')});
    expect(alias).toMatchObject({worst: 1, anyFailed: true, stages: [], error: expect.stringContaining('repository-wide')});
  });

  test('normalizes a solely stale gate before assurance reduction can decide a replacement seal', () => {
    const stages: Array<{stage: string; status: GateStatus; exitCode: number; findings: Array<{detector: string; severity: 'warn'; message: string}>}> = [{
      stage: 'stage_1.3', status: 'fail', exitCode: 1,
      findings: [{detector: 'STALE_ATTESTATION', severity: 'warn' as const, message: 'stale'}],
    }];
    expect(exemptSolelyStaleAttestation({strict: true, tier: 'pre-push', stages})).toBe(true);
    expect(stages[0]).toMatchObject({status: 'pass', exitCode: 0});
  });

  test('routes schema 0.2 done through completion while schema 0.1 retains pre-push compatibility', () => {
    const legacyRoot = workspace('0.1');
    const legacyShard = join(legacyRoot, 'spec', 'features', 'assurance-6f0a2106.yaml');
    let legacyStatusDuringGate: string | undefined;
    const legacyGate = vi.fn<DoneDeps['checkStages']>((_options) => {
      legacyStatusDuringGate = readFileSync(legacyShard, 'utf8');
      return {worst: 0};
    });
    expect(runDone(legacyRoot, FEATURE, {checkStages: legacyGate}).ok).toBe(true);
    expect(legacyGate).toHaveBeenCalledWith(expect.objectContaining({tier: 'pre-push', strict: true}));
    expect(legacyGate.mock.calls[0]?.[0]).not.toHaveProperty('profile');
    // The compatibility contract deliberately remains flip-before-gate.
    expect(legacyStatusDuringGate).toContain('status: done');
    expect(readFileSync(legacyShard, 'utf8')).toContain('status: done');

    const completionStamp = vi.fn();
    const completionGate = vi.fn<DoneDeps['checkStages']>((_options) => ({worst: 0, commitAttestation: completionStamp}));
    expect(runDone(workspace('0.2'), FEATURE, {checkStages: completionGate}).ok).toBe(true);
    expect(completionGate).toHaveBeenCalledWith(expect.objectContaining({tier: 'pre-push', profile: 'completion', scopeSubjects: [`feature:${FEATURE}`]}));
    expect(completionGate.mock.calls[0]?.[0]).not.toHaveProperty('strict');
    expect(completionStamp).toHaveBeenCalledTimes(1);
  });

  test('[covers:F-6f0a2106/AC-6f0a2113] the profile policy table, not the transport flag, decides warn-class blocking', () => {
    expect(profileBlocksWarnClass('feedback')).toBe(false);
    expect(profileBlocksWarnClass('checkpoint')).toBe(false);
    expect(profileBlocksWarnClass('completion')).toBe(true);
    expect(profileBlocksWarnClass('push')).toBe(true);
    expect(profileBlocksWarnClass('release')).toBe(true);
  });

  test('defers schema 0.2 completion stamping until independence accepts and restores on a writer failure', () => {
    const missingRoot = workspace('0.2');
    const missing = runDone(missingRoot, FEATURE, {checkStages: () => ({worst: 0})});
    expect(missing.ok).toBe(false);
    expect(readFileSync(join(missingRoot, 'spec', 'features', 'assurance-6f0a2106.yaml'), 'utf8')).toContain('status: in_progress');

    const refusedRoot = workspace('0.2');
    const refusedStamp = vi.fn();
    const refused = runDone(refusedRoot, FEATURE, {
      checkStages: () => ({worst: 0, commitAttestation: refusedStamp}),
      independence: {policy: 'require', evidence: []},
    });
    expect(refused.ok).toBe(false);
    expect(refusedStamp).not.toHaveBeenCalled();
    expect(readFileSync(join(refusedRoot, 'spec', 'features', 'assurance-6f0a2106.yaml'), 'utf8')).toContain('status: in_progress');

    const failedRoot = workspace('0.2');
    const failed = runDone(failedRoot, FEATURE, {
      checkStages: () => ({worst: 0, commitAttestation: () => { throw new Error('writer rejected preimage'); }}),
    });
    expect(failed.ok).toBe(false);
    expect(readFileSync(join(failedRoot, 'spec', 'features', 'assurance-6f0a2106.yaml'), 'utf8')).toContain('status: in_progress');

    const racedRoot = workspace('0.2');
    const racedPath = join(racedRoot, 'spec', 'features', 'assurance-6f0a2106.yaml');
    const raced = runDone(racedRoot, FEATURE, {
      checkStages: () => ({
        worst: 0,
        commitAttestation: () => {
          writeFileSync(racedPath, readFileSync(racedPath, 'utf8').replace('title: Assurance', 'title: Changed during receipt commit'));
          throw new Error('STALE_INPUT');
        },
      }),
    });
    expect(raced.ok).toBe(false);
    expect(readFileSync(racedPath, 'utf8')).toContain('status: in_progress');
    expect(() => readFileSync(join(racedRoot, 'spec', 'attestation.yaml'), 'utf8')).toThrow();

    const successRoot = workspace('0.2');
    const stamp = vi.fn((completion: {readonly targetGeneration: string}) => {
      expect(completion.targetGeneration).toMatch(/^[a-f0-9]{64}$/);
      // The injected seam is called before the real F4 writer. Schema 0.2
      // must not expose a durable done status merely to let a fake gate pass.
      expect(readFileSync(join(successRoot, 'spec', 'features', 'assurance-6f0a2106.yaml'), 'utf8')).toContain('status: in_progress');
    });
    const success = runDone(successRoot, FEATURE, {checkStages: () => ({worst: 0, commitAttestation: stamp})});
    expect(success.ok).toBe(true);
    expect(stamp).toHaveBeenCalledTimes(1);
  });
});

describe('F6 profile-owned warn-class blocking', () => {
  beforeEach(() => {
    clearDetectors();
    registerDetector(staleSpecification);
  });
  afterEach(() => {
    clearDetectors();
    for (const detector of allDetectors) registerDetector(detector);
  });

  /** Adds one archived feature whose module survives and whose archive names no successor. */
  function withSurvivingArchivedModule(cwd: string, schema: '0.1' | '0.2'): string {
    mkdirSync(join(cwd, 'src'), {recursive: true});
    // The shared 0.1 fixture is deliberately minimal — too minimal for the
    // spec loader, which would leave the drift row reporting an unreadable
    // spec instead of the lifecycle fact under test.
    if (schema === '0.1') {
      writeFileSync(join(cwd, 'spec.yaml'), [
        'schema: "0.1"', 'project: {name: profile-fixture, language: typescript}', 'features: []', '',
      ].join('\n'));
    }
    writeFileSync(join(cwd, 'src', 'survivor.ts'), 'export const survivor = 1;\n');
    writeFileSync(join(cwd, 'spec', 'features', 'retired-6f0a2107.yaml'), schema === '0.1'
      ? [
        'id: F-6f0a2107', 'title: Retired', 'status: archived', 'archived_at: "2024-01-01T00:00:00Z"',
        'modules: [src/survivor.ts]', 'acceptance_criteria:', '  - id: AC-6f0a2107',
        '    text: The system shall retain its retired surface.', '',
      ].join('\n')
      : [
        'id: F-6f0a2107', 'title: Retired', 'status: archived', 'archived_at: "2024-01-01T00:00:00Z"',
        'purpose: Keep a retired surface visible until it is removed.',
        'modules: [src/survivor.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
        '  - id: AC-6f0a2107', '    kind: behavior',
        '    statement: The system shall retain its retired surface.', '',
      ].join('\n'));
    return cwd;
  }

  function driftRow(cwd: string, options: Parameters<typeof runCheckStages>[0]) {
    const origin = process.cwd();
    process.chdir(cwd);
    try {
      return runCheckStages({...options, silent: true}).stages?.find((stage) => stage.stage === 'stage_1.3');
    } finally {
      process.chdir(origin);
    }
  }

  test('[covers:F-6f0a2106/AC-6f0a2113] a schema 0.2 push blocks on a warn-class finding with no strict flag, while checkpoint stays advisory', () => {
    const cwd = withSurvivingArchivedModule(workspace('0.2'), '0.2');

    const authoritative = driftRow(cwd, {profile: 'push'});
    // The fixture's only lifecycle fact is warn-class: if an error-severity
    // finding crept in, the row would fail for a reason this test is not about.
    expect(authoritative?.findings?.map((finding) => finding.severity)).toContain('warn');
    expect(authoritative?.findings?.some((finding) => finding.severity === 'error')).toBe(false);
    expect(authoritative).toMatchObject({status: 'fail', exitCode: 1});

    expect(driftRow(cwd, {profile: 'checkpoint'})).toMatchObject({status: 'pass', exitCode: 0});
    expect(driftRow(cwd, {profile: 'checkpoint', strict: true})).toMatchObject({status: 'fail', exitCode: 1});
  });

  test('[covers:F-6f0a2106/AC-6f0a2113] a schema 0.1 pre-push tier keeps its warn-tolerant non-strict contract', () => {
    const cwd = withSurvivingArchivedModule(workspace('0.1'), '0.1');
    const legacy = driftRow(cwd, {tier: 'pre-push'});
    expect(legacy?.findings?.map((finding) => finding.severity)).toContain('warn');
    expect(legacy).toMatchObject({status: 'pass', exitCode: 0});
    expect(driftRow(cwd, {tier: 'pre-push', strict: true})).toMatchObject({status: 'fail', exitCode: 1});
  });

  interface AssuranceJson {
    readonly incomplete_addresses?: readonly string[];
    readonly obligations?: readonly {readonly obligation: string; readonly subject: string; readonly reason?: string}[];
  }

  function pushJson(cwd: string): AssuranceJson {
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }) as never);
    const origin = process.cwd();
    process.chdir(cwd);
    try {
      runCheckStages({profile: 'push', json: true});
    } finally {
      process.chdir(origin);
      write.mockRestore();
    }
    return JSON.parse(stdout) as AssuranceJson;
  }

  test('[covers:F-6f0a2106/AC-6f0a2115] the machine verdict names the incomplete closure addresses behind an unresolved result', () => {
    const doc = pushJson(withSurvivingArchivedModule(workspace('0.2'), '0.2'));
    expect(Array.isArray(doc.incomplete_addresses)).toBe(true);
  });

  test('[covers:F-6f0a2106/AC-6f0a2115] a run that observed no runner reports stale, never unbound', () => {
    // The gate never captured a current run here, so it learned nothing about
    // bindings. Calling the criterion "unbound" would blame the spec for a
    // missing testcase when the truth is that no runner was observed at all.
    const cwd = withSurvivingArchivedModule(workspace('0.2'), '0.2');
    writeFileSync(join(cwd, 'src', 'proved.ts'), 'export const proved = 1;\n');
    writeFileSync(join(cwd, 'spec', 'features', 'proved-6f0a2108.yaml'), [
      'id: F-6f0a2108', 'title: Proved', 'status: done',
      'purpose: Carry one done criterion whose proof this gate never renewed.',
      'modules: [src/proved.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-6f0a2108', '    kind: behavior',
      '    statement: The system shall carry one criterion with no renewed proof.', '',
    ].join('\n'));
    const row = pushJson(cwd).obligations
      ?.find((entry) => entry.obligation === 'stage_2.1' && entry.subject === 'criterion:F-6f0a2108/AC-6f0a2108');
    expect(row).toMatchObject({reason: 'stale'});
  });
});
