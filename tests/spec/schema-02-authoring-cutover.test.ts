// Cladding · Spec 0.2 F7 P1 · authoring-consumer cutover discriminators.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import yaml from 'yaml';
import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {createFeature, linkCapability, linkScenario} from '../../src/spec/new.js';

const temporary: string[] = [];

const FEATURE_ID = 'F-aaaaaaaa';
const LINKED_FEATURE_ID = 'F-bbbbbbbb';
const SCENARIO_ID = 'S-aaaaaaaa';
const DIRECT_SCENARIO_ID = 'S-001';
const CAPABILITY_ID = 'account-access';

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

function writeYaml(root: string, path: string, value: unknown): void {
  writeFileSync(join(root, path), yaml.stringify(value));
}

function feature(id: string, title: string, capabilityRefs: readonly string[]): Record<string, unknown> {
  return {
    id,
    title,
    status: 'planned',
    purpose: `Keep ${title.toLowerCase()} understandable to project users.`,
    modules: [],
    depends_on: [],
    capability_refs: capabilityRefs,
    acceptance_criteria: [],
  };
}

/** Builds a valid, comment-dispatched schema 0.2 workspace without legacy body aliases. */
function schema02Workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f7-authoring-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2" # the dispatcher must accept a YAML comment',
    'project:',
    '  name: authoring-cutover',
    '  language: typescript',
    '  purpose: Keep specification authoring compiler-safe.',
    '  assurance_level: L1',
    '  scenario_policy: off',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  writeYaml(root, 'spec/capabilities.yaml', {
    capabilities: [{
      id: CAPABILITY_ID,
      title: 'Account access',
      outcome: 'Customers can recover access to an account.',
    }],
  });
  writeYaml(root, 'spec/architecture.yaml', {
    layers: [['spec'], ['stages']],
    rules: [{
      id: 'AR-aaaaaaaa',
      kind: 'forbidden_import',
      from: 'spec',
      to: 'stages',
      rationale: 'Specification code must not invoke stage runners.',
    }],
  });
  writeYaml(root, 'spec/features/account-recovery-aaaaaaaa.yaml', feature(FEATURE_ID, 'Account recovery', [CAPABILITY_ID]));
  writeYaml(root, 'spec/features/project-advice-bbbbbbbb.yaml', feature(LINKED_FEATURE_ID, 'Project advice', []));
  writeYaml(root, 'spec/scenarios/account-recovery-aaaaaaaa.yaml', {
    id: SCENARIO_ID,
    title: 'Recover account access',
    actor: 'Customer',
    goal: 'Recover access to the account.',
    success: 'The recovery screen is visible.',
    steps: ['Open account recovery.', 'Submit the recovery request.'],
    feature_refs: [FEATURE_ID],
  });
  writeYaml(root, 'spec/scenarios/S-001.yaml', {
    id: DIRECT_SCENARIO_ID,
    title: 'Direct compatibility scenario',
    actor: 'Customer',
    goal: 'Review account access.',
    success: 'The account access summary is visible.',
    steps: ['Open account access.'],
    feature_refs: [FEATURE_ID],
  });
  return root;
}

describe('schema 0.2 authoring cutover', () => {
  test('a commented schema root dispatches createFeature to the typed writer without legacy fields', () => {
    const root = schema02Workspace();
    const created = createFeature({
      cwd: root,
      slug: 'password-recovery',
      title: 'Password recovery',
      purpose: 'Let customers safely restore access after a forgotten password.',
      capability_refs: [CAPABILITY_ID],
      acceptance_criteria: [{
        kind: 'behavior',
        statement: 'When a customer requests password recovery, the system shall provide a recovery path.',
      }],
    });

    const body = readFileSync(created.path, 'utf8');
    const parsed = yaml.parse(body) as Record<string, unknown>;
    const criterion = (parsed.acceptance_criteria as readonly Record<string, unknown>[])[0]!;
    expect(compileSpecWorkspace(root).contract?.features).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: created.id,
        purpose: 'Let customers safely restore access after a forgotten password.',
        capabilityRefs: [CAPABILITY_ID],
      }),
    ]));
    expect(parsed).toMatchObject({purpose: 'Let customers safely restore access after a forgotten password.', capability_refs: [CAPABILITY_ID]});
    expect(parsed).not.toHaveProperty('slug');
    expect(criterion).not.toHaveProperty('text');
    expect(criterion).not.toHaveProperty('test_refs');
  });

  test('linkScenario selects a complete slugged schema 0.2 shard without a body slug and preserves its filename', () => {
    const root = schema02Workspace();
    const path = join(root, 'spec', 'scenarios', 'account-recovery-aaaaaaaa.yaml');
    const before = readFileSync(path, 'utf8');

    expect(linkScenario({cwd: root, scenario: 'account-recovery', feature: LINKED_FEATURE_ID})).toBe(path);

    const after = readFileSync(path, 'utf8');
    const scenario = compileSpecWorkspace(root).contract?.scenarios.find((entry) => entry.id === SCENARIO_ID);
    expect(after).not.toContain('\nslug:');
    expect(after).not.toBe(before);
    expect(scenario).toMatchObject({id: SCENARIO_ID, featureRefs: [FEATURE_ID, LINKED_FEATURE_ID]});
    expect(readFileSync(path, 'utf8')).toBe(after);
  });

  test('the authoring snapshot retains compiler facts, canonical bytes, and operation-safe filename slugs', async () => {
    const root = schema02Workspace();
    const {readSchema02AuthoringSnapshot} = await import('../../src/spec/compiler/authoring-view.js');

    const snapshot = readSchema02AuthoringSnapshot(root);
    const featureSnapshot = snapshot.features.find((entry) => entry.id === FEATURE_ID);
    const catalogSnapshot = snapshot.capabilities.find((entry) => entry.id === CAPABILITY_ID);
    const scenarioSnapshot = snapshot.scenarios.find((entry) => entry.id === SCENARIO_ID);
    const directScenarioSnapshot = snapshot.scenarios.find((entry) => entry.id === DIRECT_SCENARIO_ID);

    expect(snapshot.compilation.contract).toBeDefined();
    expect(featureSnapshot).toMatchObject({
      id: FEATURE_ID,
      slug: 'account-recovery',
      capabilityRefs: [CAPABILITY_ID],
      path: 'spec/features/account-recovery-aaaaaaaa.yaml',
      sourceBytes: readFileSync(join(root, 'spec', 'features', 'account-recovery-aaaaaaaa.yaml'), 'utf8'),
    });
    expect(catalogSnapshot).toMatchObject({
      id: CAPABILITY_ID,
      outcome: 'Customers can recover access to an account.',
      path: 'spec/capabilities.yaml',
      sourceBytes: readFileSync(join(root, 'spec', 'capabilities.yaml'), 'utf8'),
    });
    expect(snapshot.capabilityCatalog).toEqual({
      path: 'spec/capabilities.yaml',
      sourceBytes: readFileSync(join(root, 'spec', 'capabilities.yaml'), 'utf8'),
    });
    expect(scenarioSnapshot).toMatchObject({
      id: SCENARIO_ID,
      slug: 'account-recovery',
      featureRefs: [FEATURE_ID],
      path: 'spec/scenarios/account-recovery-aaaaaaaa.yaml',
      sourceBytes: readFileSync(join(root, 'spec', 'scenarios', 'account-recovery-aaaaaaaa.yaml'), 'utf8'),
    });
    expect(directScenarioSnapshot).toMatchObject({
      id: DIRECT_SCENARIO_ID,
      slug: 's-001',
      path: 'spec/scenarios/S-001.yaml',
    });

    const malformed = schema02Workspace();
    const rootPath = join(malformed, 'spec.yaml');
    const featurePath = join(malformed, 'spec', 'features', 'account-recovery-aaaaaaaa.yaml');
    const before = readFileSync(rootPath, 'utf8');
    const featureBefore = readFileSync(featurePath, 'utf8');
    writeFileSync(rootPath, before.replace('  purpose: Keep specification authoring compiler-safe.\n', ''));
    const malformedRootBytes = readFileSync(rootPath, 'utf8');
    expect(() => readSchema02AuthoringSnapshot(malformed)).toThrow(/compiler|schema 0\.2|purpose/i);
    expect(readFileSync(rootPath, 'utf8')).toBe(malformedRootBytes);
    expect(readFileSync(featurePath, 'utf8')).toBe(featureBefore);
  });

  test('linkCapability uses the compiler snapshot so feature links and existing outcomes remain canonical', async () => {
    const root = schema02Workspace();
    const {readSchema02AuthoringSnapshot} = await import('../../src/spec/compiler/authoring-view.js');
    const before = readSchema02AuthoringSnapshot(root);
    expect(before.capabilities.find((entry) => entry.id === CAPABILITY_ID)?.outcome)
      .toBe('Customers can recover access to an account.');

    linkCapability({cwd: root, capability: CAPABILITY_ID, feature: LINKED_FEATURE_ID});

    const after = readSchema02AuthoringSnapshot(root);
    expect(after.features.find((entry) => entry.id === LINKED_FEATURE_ID)?.capabilityRefs).toEqual([CAPABILITY_ID]);
    expect(after.capabilities.find((entry) => entry.id === CAPABILITY_ID)?.outcome)
      .toBe('Customers can recover access to an account.');
  });
});
