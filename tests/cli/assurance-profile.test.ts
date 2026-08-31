// Cladding · CLI assurance-profile tests.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {exemptSolelyStaleAttestation, runCheckCommand, runCheckStages} from '../../src/cli/clad.js';
import {runDone, type DoneDeps} from '../../src/cli/done.js';
import {resolveRequestedAssuranceLevel} from '../../src/assurance/kernel.js';
import {normalizeProfile, type AssuranceLevel} from '../../src/assurance/registry.js';
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
