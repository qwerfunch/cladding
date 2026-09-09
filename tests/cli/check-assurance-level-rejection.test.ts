// Cladding · Spec 0.2 F-18a5883a · the check command relays a refused one-run level.
//
// Every stage runner is inert here: this suite is about what the command SAYS
// when the assurance kernel refuses a requested level, so no local toolchain
// may decide whether a stage row appeared.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/stages/type.js', () => ({runType: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/lint.js', () => ({runLint: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/cov.js', () => ({runCov: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: () => ({pass: true, exitCode: 0, findings: []})}));

import {runCheckStages} from '../../src/cli/clad.js';
import type {AssuranceLevel} from '../../src/assurance/registry.js';

const FEATURE = 'F-18a5f001';
const roots: string[] = [];

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-level-rejection-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: level-fixture', '  language: typescript',
    '  purpose: Relay a refused one-run assurance level.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'features', 'level-18a5f001.yaml'), [
    `id: ${FEATURE}`, 'title: Level', 'status: in_progress', 'purpose: Keep the refused level visible.',
    'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-18a5f002', '    kind: behavior', '    statement: The system shall relay the refusal.', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  return cwd;
}

/** Runs one machine-mode check in a fresh workspace and returns what it printed. */
function checkJson(options: {profile?: 'push' | 'completion'; assuranceLevel?: AssuranceLevel; scopeSubjects?: readonly string[]}): {
  readonly document: Record<string, unknown>;
  readonly exitCode: number | string | null | undefined;
} {
  const cwd = workspace();
  let stdout = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as never);
  const origin = process.cwd();
  process.chdir(cwd);
  try {
    runCheckStages({
      profile: options.profile ?? 'push',
      json: true,
      ...(options.assuranceLevel ? {assuranceLevel: options.assuranceLevel} : {}),
      ...(options.scopeSubjects ? {scopeSubjects: options.scopeSubjects} : {}),
    });
  } finally {
    process.chdir(origin);
    write.mockRestore();
  }
  return {document: JSON.parse(stdout) as Record<string, unknown>, exitCode: process.exitCode};
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('a refused one-run assurance level', () => {
  test('[covers:F-18a5883a/AC-968bda1e] names the downgrade refusal and runs no stage', () => {
    const {document, exitCode} = checkJson({assuranceLevel: 'L1'});
    expect(Object.keys(document).sort()).toEqual([
      'assurance_level_rejected', 'configured_assurance_level', 'profile', 'requested_assurance_level', 'tier',
    ]);
    expect(document).toMatchObject({
      tier: 'pre-push', profile: 'push', configured_assurance_level: 'L2', requested_assurance_level: 'L1',
      assurance_level_rejected: 'Requested assurance level cannot downgrade the persisted project level.',
    });
    expect(document).not.toHaveProperty('stages');
    expect(exitCode).toBe(1);
  });

  test('[covers:F-18a5883a/AC-968bda1e] explains an unbounded upgrade instead of reporting green stages', () => {
    const {document, exitCode} = checkJson({assuranceLevel: 'L3'});
    expect(document.assurance_level_rejected).toBe(
      'A stronger one-run assurance level requires a compiler-proven bounded scope.'
      + ' Only the completion profile on a bounded feature scope can raise the level for one run.',
    );
    expect(document).toMatchObject({requested_assurance_level: 'L3', configured_assurance_level: 'L2'});
    expect(document).not.toHaveProperty('stages');
    expect(exitCode).toBe(1);
  });

  test('[covers:F-18a5883a/AC-968bda1e] refuses a feature-scoped push upgrade out loud instead of planning silently', () => {
    // A named feature bounds the run for the profile router, but only a
    // completion run is bounded enough to earn a stronger level — the deeper
    // planner refuses it, and that refusal has to reach the caller too.
    const {document, exitCode} = checkJson({assuranceLevel: 'L3', scopeSubjects: [`feature:${FEATURE}`]});
    expect(Object.keys(document).sort()).toEqual([
      'assurance_level_rejected', 'configured_assurance_level', 'profile', 'requested_assurance_level', 'tier',
    ]);
    expect(document.assurance_level_rejected).toBe(
      'A stronger one-run assurance level requires a compiler-proven bounded scope.'
      + ' Only the completion profile on a bounded feature scope can raise the level for one run.',
    );
    expect(document).not.toHaveProperty('stages');
    expect(exitCode).toBe(1);
  });

  test('[covers:F-18a5883a/AC-968bda1e] leaves an accepted level on the full report', () => {
    const {document} = checkJson({assuranceLevel: 'L2'});
    expect(document).toHaveProperty('stages');
    expect(document).not.toHaveProperty('assurance_level_rejected');
  });

  test('[covers:F-18a5883a/AC-d4111f31] leaves a run without the flag exactly as it was', () => {
    const configured = checkJson({assuranceLevel: 'L2'});
    const bare = checkJson({});
    expect(bare.document).not.toHaveProperty('assurance_level_rejected');
    expect(Object.keys(bare.document).sort()).toEqual(Object.keys(configured.document).sort());
    expect(bare.document.worst).toEqual(configured.document.worst);
    expect(bare.document.anyFailed).toEqual(configured.document.anyFailed);
    expect((bare.document.stages as {stage: string; status: string}[]).map((row) => `${row.stage}:${row.status}`))
      .toEqual((configured.document.stages as {stage: string; status: string}[]).map((row) => `${row.stage}:${row.status}`));
  });
});
