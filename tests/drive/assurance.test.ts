// Cladding · drive · F6 observer projection tests.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, expect, test} from 'vitest';

import {workspaceClosureSeals} from '../../src/assurance/workspace.js';
import {reduceDriveGateObservation} from '../../src/drive/assurance.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import type {Feature} from '../../src/spec/types.js';

const roots: string[] = [];

function workspace(): {readonly cwd: string; readonly feature: Feature} {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-drive-assurance-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  mkdirSync(join(cwd, 'src'), {recursive: true});
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.1"',
    'project: {name: drive-assurance, language: typescript}',
    'features: []',
    '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'features', 'drive.yaml'), [
    'id: F-001',
    'title: Drive observer',
    'status: planned',
    'modules: [src/drive.ts]',
    'acceptance_criteria:',
    '  - id: AC-001',
    '    text: The system shall preserve the current observer state.',
    '',
  ].join('\n'));
  writeFileSync(join(cwd, 'src', 'drive.ts'), 'export const observed = true;\n');
  return {
    cwd,
    feature: {
      id: 'F-001', title: 'Drive observer', status: 'planned', modules: ['src/drive.ts'],
      acceptance_criteria: [{id: 'AC-001', text: 'The system shall preserve the current observer state.'}],
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

test('[covers:F-048/AC-f7e0aea5] records compact gate observations with the current closure digest and registered adapter identities', () => {
  const {cwd, feature} = workspace();
  const observation = reduceDriveGateObservation(cwd, feature, [
    ['stage_1.1', {stage: 'stage_1.1', pass: true, exitCode: 0}],
    ['stage_1.2', {stage: 'stage_1.2', pass: false, exitCode: 2}],
    ['stage_1.5', {stage: 'stage_1.5', pass: false, exitCode: 1}],
  ] as const);

  expect(observation.inputSha256).toBe(
    workspaceClosureSeals(cwd, compileSpecWorkspace(cwd)).inputSha256,
  );
  expect(observation.gates).toEqual([
    {stage: 'stage_1.1', status: 'pass', adapter: {id: 'legacy-stage:stage_1.1', version: '1'}},
    {stage: 'stage_1.2', status: 'skip', adapter: {id: 'legacy-stage:stage_1.2', version: '1'}},
    {stage: 'stage_1.5', status: 'fail', adapter: {id: 'legacy-stage:stage_1.5', version: '1'}},
  ]);
  expect(observation.assurance).toMatchObject({
    profile: 'feedback',
    assurance_level: 'L1',
    state: expect.any(String),
    profile_complete: expect.any(Boolean),
  });
  expect(observation.assurance.obligation_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(observation.assurance).not.toHaveProperty('results');

  const persisted = {
    feature: feature.id,
    observer: 'drive-f6',
    inputSha256: observation.inputSha256,
    gates: observation.gates,
    assurance: observation.assurance,
  };
  const serialized = JSON.stringify(persisted);
  expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(4096);
  expect(serialized).not.toContain('"results"');
  expect(serialized).not.toContain('"input_addresses"');
  for (const criterion of feature.acceptance_criteria ?? []) {
    expect(serialized).not.toContain(criterion.text);
  }
});

test('[covers:F-048/AC-f7e0aea5] active drive loop records the F6 observer instead of retired evidence fanout', () => {
  const loopSource = readFileSync(join(process.cwd(), 'src', 'drive', 'loop.ts'), 'utf8');

  expect(loopSource).toContain("import {reduceDriveGateObservation} from './assurance.js';");
  expect(loopSource).toContain('const observerGates = reduceDriveGateObservation(cwd, ready, gates);');
  expect(loopSource).toContain("observer: 'drive-f6'");
  expect(loopSource).not.toMatch(/from ['"]\.\.\/hitl\/audit\.js['"]/);
  expect(loopSource).not.toMatch(/from ['"]\.\.\/hitl\/identity\.js['"]/);
  expect(loopSource).not.toMatch(/\bappendEvidence\s*\(/);
  expect(loopSource).not.toMatch(/\bnewEvidence\s*\(/);
});
