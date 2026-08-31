// Cladding · Spec 0.2 F7 · consumer cutover discriminators.
//
// This suite deliberately begins with a real F4 0.1 → 0.2 migration. The
// assertions then use only the established loader, detector, proof, graph, and
// slice seams. It prevents a raw 0.2 cast from accidentally looking like a
// consumer migration while F8 remains responsible for the GraphIR v2 wire.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';

import yaml from 'yaml';
import {afterEach, describe, expect, test} from 'vitest';

import {buildGraph, resolveNodeId} from '../../src/graph/model.js';
import {buildContextSlice} from '../../src/optimizer/context-slice.js';
import {buildImpactSlice} from '../../src/optimizer/reverse-slice.js';
import {selectCriterionTestBindings} from '../../src/proof/legacy-bindings.js';
import {harvestVitestJestBindings, knownCriteriaFromCompilerView} from '../../src/proof/vitest-jest.js';
import {editSpec, migrationPreviewDigest, readSpecEditRevisions} from '../../src/spec/edit.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {previewSchema02Migration} from '../../src/spec/compiler/migration-preview.js';
import {loadSpec} from '../../src/spec/load.js';
import {strictSkipViolations} from '../../src/stages/skip-policy.js';
import {acDrift} from '../../src/stages/detectors/ac-drift.js';
import {architectureFromSpec} from '../../src/stages/detectors/architecture-from-spec.js';
import {capabilitiesFeatureMapping} from '../../src/stages/detectors/capabilities-feature-mapping.js';
import {metaIntegrity} from '../../src/stages/detectors/meta-integrity.js';
import {missingTests} from '../../src/stages/detectors/missing-tests.js';
import {referenceIntegrity} from '../../src/stages/detectors/reference-integrity.js';
import {scenarioCoverage} from '../../src/stages/detectors/scenario-coverage.js';
import {untestedAc} from '../../src/stages/detectors/untested-ac.js';
import {findVacuousDoneFeatures} from '../../src/stages/vacuous-tests.js';
import {inventoryDrift} from '../../src/stages/detectors/inventory-drift.js';

const temporary: string[] = [];

const FEATURE_ID = 'F-aaaaaaaa';
const DIRECT_FEATURE_ID = 'F-cccccccc';
const CRITERION_ID = 'AC-bbbbbbbb';
const SCENARIO_ID = 'S-dddddddd';
const CRITERION = `${FEATURE_ID}/${CRITERION_ID}`;
const LIVE_SELECTOR = `[covers:${CRITERION}] preserves the recovery path`;
const LIVE_TEST = 'tests/recovery.test.ts';
const LIVE_REF = `${LIVE_TEST}#${LIVE_SELECTOR}`;
const LEGACY_REF = 'tests/legacy-recovery.test.ts#the obsolete legacy selector';

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

/** Writes a YAML fixture artifact, keeping its test-only directory creation local. */
function writeYaml(root: string, path: string, value: unknown): void {
  const target = join(root, path);
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, yaml.stringify(value));
}

function readYaml(root: string, path: string): Record<string, unknown> {
  return yaml.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
}

function setScenarioPolicy(root: string, policy: 'off' | 'advisory' | 'required'): void {
  const spec = readYaml(root, 'spec.yaml');
  const project = spec.project as Record<string, unknown>;
  project.scenario_policy = policy;
  writeYaml(root, 'spec.yaml', spec);
}

function writeSchema02Scenario(root: string, featureRefs: readonly string[], steps: readonly string[]): void {
  writeYaml(root, 'spec/scenarios/account-recovery-dddddddd.yaml', {
    id: SCENARIO_ID,
    title: 'Recover account access',
    actor: 'Customer',
    goal: 'Recover access to the account.',
    success: 'The recovery screen is visible.',
    steps,
    feature_refs: featureRefs,
  });
}

/** Creates then atomically applies a migration; no hand-authored 0.2 substitute is used. */
function migratedWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f7-consumer-cutover-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
  mkdirSync(join(root, 'src', 'spec'), {recursive: true});
  mkdirSync(join(root, 'src', 'stages'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});

  writeYaml(root, 'spec.yaml', {
    schema: '0.1',
    project: {
      name: 'consumer-cutover',
      language: 'typescript',
    },
    features: [],
    scenarios: [],
  });
  writeYaml(root, 'spec/capabilities.yaml', {
    schema: '0.1',
    source: 'spec.yaml',
    capabilities: [{
      id: 'account-access',
      title: 'Account access',
      summary: 'Customers can recover account access.',
      features: [FEATURE_ID],
    }],
  });
  writeYaml(root, 'spec/architecture.yaml', {
    layers: [['spec'], ['stages']],
    forbidden_imports: [{from: 'spec', to: 'stages'}],
  });
  writeYaml(root, 'spec/features/account-recovery-aaaaaaaa.yaml', {
    id: FEATURE_ID,
    slug: 'account-recovery',
    title: 'Account recovery',
    status: 'done',
    modules: ['src/spec/recovery.ts'],
    acceptance_criteria: [{
      id: CRITERION_ID,
      text: 'When a customer requests account recovery, the system shall preserve the recovery path.',
      test_refs: [LEGACY_REF],
    }],
  });
  writeYaml(root, 'spec/features/project-advice-cccccccc.yaml', {
    id: DIRECT_FEATURE_ID,
    slug: 'project-advice',
    title: 'Project advice',
    status: 'planned',
    modules: ['src/spec/advice.ts'],
    acceptance_criteria: [{
      id: 'AC-dddddddd',
      text: 'The system shall retain an explicit direct-to-project contribution.',
    }],
  });
  writeYaml(root, 'spec/scenarios/account-recovery-dddddddd.yaml', {
    id: SCENARIO_ID,
    slug: 'account-recovery',
    title: 'Recover account access',
    flow: 'The customer follows the account recovery flow.',
    features: [FEATURE_ID],
  });
  writeFileSync(join(root, 'src', 'spec', 'recovery.ts'), 'export const recoveryPath = true;\n');
  writeFileSync(join(root, 'src', 'spec', 'advice.ts'), 'export const directAdvice = true;\n');
  writeFileSync(join(root, 'src', 'stages', 'handler.ts'), 'export const stageHandler = true;\n');
  writeFileSync(join(root, LIVE_TEST), `it(${JSON.stringify(LIVE_SELECTOR)}, () => {});\n`);

  const preview = previewSchema02Migration(root);
  const operation = {
    kind: 'project.upgrade_schema' as const,
    resolutions: {
      previewDigest: migrationPreviewDigest(preview),
      confirmed: preview.requiredResolution.map((item) => {
        if (item.code === 'SCENARIO_MEANING_REQUIRED') {
          return {
            code: item.code,
            subject: item.subject,
            value: {
              actor: 'Customer',
              goal: 'Recover access to the account.',
              success: 'The recovery screen is visible.',
              steps: ['Open account recovery.', 'Submit the recovery request.'],
              feature_refs: [FEATURE_ID],
            },
          };
        }
        if (item.code === 'ARCHITECTURE_RULE_RATIONALE') {
          return {
            code: item.code,
            subject: item.subject,
            value: 'Specification code must not invoke stage runners.',
          };
        }
        return {code: item.code, subject: item.subject};
      }),
    },
  };
  const result = editSpec({
    cwd: root,
    operations: [operation],
    inputRevisions: readSpecEditRevisions(root, [operation]),
  });
  expect(result.changed).toBe(true);
  return root;
}

describe('schema 0.2 consumer cutover', () => {
  test('an actual migrated workspace loads compiler-derived legacy projections and rejects malformed raw fields', () => {
    const root = migratedWorkspace();
    const spec = loadSpec(root);
    const compilation = compileSpecWorkspace(root);

    expect(spec).toMatchObject({
      schema: '0.2',
      features: expect.arrayContaining([
        expect.objectContaining({
          id: FEATURE_ID,
          slug: 'account-recovery',
          modules: ['src/spec/recovery.ts'],
          acceptance_criteria: [expect.objectContaining({
            id: CRITERION_ID,
            text: 'When a customer requests account recovery, the system shall preserve the recovery path.',
            test_refs: [LIVE_REF],
          })],
        }),
      ]),
      scenarios: [expect.objectContaining({id: SCENARIO_ID, features: [FEATURE_ID]})],
      capabilities: [expect.objectContaining({id: 'account-access', features: [FEATURE_ID]})],
      architecture: expect.objectContaining({
        forbidden_imports: [expect.objectContaining({from: 'spec', to: 'stages'})],
      }),
    });
    expect(spec.project).not.toHaveProperty('purpose');
    expect(spec.features.find((feature) => feature.id === FEATURE_ID)).not.toHaveProperty('purpose');
    expect(spec.features.find((feature) => feature.id === FEATURE_ID)?.acceptance_criteria?.[0]).not.toHaveProperty('kind');
    expect(compilation.nodes.map((node) => node.address)).toEqual(expect.arrayContaining([
      `feature:${FEATURE_ID}`,
      `criterion:${CRITERION}`,
      `scenario:${SCENARIO_ID}`,
    ]));
    expect(compilation.contract?.features).toEqual(expect.arrayContaining([
      expect.objectContaining({id: FEATURE_ID, capabilityRefs: ['account-access']}),
      expect.objectContaining({id: DIRECT_FEATURE_ID, capabilityRefs: []}),
    ]));
    expect(compilation.migrationBaseline).toMatchObject({
      project: {address: 'project', exemption: expect.objectContaining({subject: 'project'})},
      features: expect.arrayContaining([expect.objectContaining({
        address: `feature:${FEATURE_ID}`,
        exemption: expect.objectContaining({subject: `feature:${FEATURE_ID}`}),
      })]),
      criteria: expect.arrayContaining([expect.objectContaining({
        address: `criterion:${CRITERION}`,
        classification: 'legacy_unclassified',
        exemption: expect.objectContaining({subject: `criterion:${CRITERION}`}),
      })]),
    });

    const malformedRoot = migratedWorkspace();
    const malformedFeature = readYaml(malformedRoot, 'spec/features/account-recovery-aaaaaaaa.yaml');
    malformedFeature.capability_refs = 'account-access';
    const malformedCriteria = malformedFeature.acceptance_criteria as Record<string, unknown>[];
    malformedCriteria[0]!.statement = 'This is not a strict statement.';
    writeYaml(malformedRoot, 'spec/features/account-recovery-aaaaaaaa.yaml', malformedFeature);
    const malformed = compileSpecWorkspace(malformedRoot);
    expect(malformed.contract).toBeUndefined();
    expect(malformed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'INVALID_STATEMENT'}),
    ]));
    expect(() => loadSpec(malformedRoot)).toThrow(/compiler|capability_refs|schema 0\.2/i);
  });

  test('projects only compiler-validated schema 0.2 inventory and still reports inventory drift', () => {
    const root = migratedWorkspace();
    const source = readYaml(root, 'spec.yaml');
    source.inventory = {features: 2, scenarios: 1, capabilities: 1, test_files: 1};
    writeYaml(root, 'spec.yaml', source);
    expect(loadSpec(root).inventory).toEqual({features: 2, scenarios: 1, capabilities: 1, test_files: 1});
    expect(inventoryDrift.run({cwd: root})).toEqual([]);

    source.inventory = {features: 0, scenarios: 1, capabilities: 1, test_files: 1};
    writeYaml(root, 'spec.yaml', source);
    expect(inventoryDrift.run({cwd: root})).toEqual(expect.arrayContaining([
      expect.objectContaining({detector: 'INVENTORY_DRIFT', severity: 'error', message: expect.stringContaining('inventory.features declares 0')}),
    ]));

    source.inventory = {features: 'two', scenarios: 1, capabilities: 1, test_files: 1};
    writeYaml(root, 'spec.yaml', source);
    expect(() => loadSpec(root)).toThrow(/inventory|compiler/i);
  });

  test('representative drift consumers accept migrated fields, enforce a real architecture rule, and honor scenario policy', () => {
    const root = migratedWorkspace();
    const cleanFindings = [
      ...metaIntegrity.run({cwd: root}),
      ...acDrift.run({cwd: root}),
      ...referenceIntegrity.run({cwd: root}),
      ...scenarioCoverage.run({cwd: root}),
      ...capabilitiesFeatureMapping.run({cwd: root}),
      ...architectureFromSpec.run({cwd: root}),
      ...missingTests.run({cwd: root}),
      ...untestedAc.run({cwd: root}),
    ];
    expect(cleanFindings.filter((finding) => finding.severity === 'error')).toEqual([]);

    writeFileSync(join(root, 'src', 'spec', 'recovery.ts'), "import {stageHandler} from '../stages/handler.js';\nexport {stageHandler};\n");
    expect(architectureFromSpec.run({cwd: root})).toEqual(expect.arrayContaining([
      expect.objectContaining({detector: 'ARCHITECTURE_FROM_SPEC', severity: 'error'}),
    ]));

    setScenarioPolicy(root, 'off');
    writeSchema02Scenario(root, ['F-ffffffff'], ['Open account recovery.']);
    expect(referenceIntegrity.run({cwd: root})).toEqual(expect.arrayContaining([
      expect.objectContaining({detector: 'REFERENCE_INTEGRITY', severity: 'error', message: expect.stringContaining('F-ffffffff')}),
    ]));
    expect(scenarioCoverage.run({cwd: root})).toEqual([]);

    setScenarioPolicy(root, 'advisory');
    writeSchema02Scenario(root, [], []);
    const advisory = scenarioCoverage.run({cwd: root});
    expect(advisory).toEqual(expect.arrayContaining([
      expect.objectContaining({detector: 'SCENARIO_COVERAGE', severity: 'info'}),
    ]));
    expect(advisory.some((finding) => finding.severity === 'error')).toBe(false);

    setScenarioPolicy(root, 'required');
    expect(scenarioCoverage.run({cwd: root})).toEqual(expect.arrayContaining([
      expect.objectContaining({detector: 'SCENARIO_COVERAGE', severity: 'error'}),
    ]));
  });

  test('live covers bindings replace an immutable baseline for missing, untested, vacuous, and skipped-test consumers', () => {
    const root = migratedWorkspace();
    const compilation = compileSpecWorkspace(root);
    const harvested = harvestVitestJestBindings({
      file: LIVE_TEST,
      source: readFileSync(join(root, LIVE_TEST), 'utf8'),
      knownCriteria: knownCriteriaFromCompilerView(compilation.nodes),
    });
    const currentCriterion = readYaml(root, 'spec/features/account-recovery-aaaaaaaa.yaml')
      .acceptance_criteria as Record<string, unknown>[];
    const selection = selectCriterionTestBindings({
      cwd: root,
      baseline: compilation.migrationBaseline,
      criterion: CRITERION,
      currentCriterion: currentCriterion[0],
      live: harvested.bindings,
    });
    expect(selection).toMatchObject({
      source: 'live',
      live: [expect.objectContaining({file: LIVE_TEST, selector: LIVE_SELECTOR})],
      legacy: [],
    });

    const spec = loadSpec(root);
    expect(missingTests.run({cwd: root})).toEqual([]);
    expect(untestedAc.run({cwd: root})).toEqual([]);
    const skipped = strictSkipViolations(spec, [{stage: 'stage_2.1', status: 'skip'}]);
    expect(skipped).toEqual([expect.objectContaining({stage: 'stage_2.1'})]);
    expect(JSON.stringify(skipped)).not.toContain(LEGACY_REF);
    const vacuous = findVacuousDoneFeatures(spec, new Map([
      [resolve(root, LIVE_TEST), 0],
      [resolve(root, 'tests/legacy-recovery.test.ts'), 1],
    ]), root);
    expect(vacuous).toEqual([
      expect.objectContaining({detector: 'VACUOUS_TESTS', path: LIVE_TEST}),
    ]);
  });

  test('graph v1 and context/impact preserve their wire shape over migrated compiler-derived identities', () => {
    const root = migratedWorkspace();
    const spec = loadSpec(root);
    const graph = buildGraph(spec, root);

    expect(Object.keys(graph).sort()).toEqual(['edges', 'nodes']);
    expect(resolveNodeId(spec, graph, 'account-recovery')).toBe(`feature:${FEATURE_ID}`);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({from: `scenario:${SCENARIO_ID}`, to: `feature:${FEATURE_ID}`, kind: 'binds'}),
      expect.objectContaining({from: 'capability:account-access', to: `feature:${FEATURE_ID}`, kind: 'implements'}),
      expect.objectContaining({from: `feature:${FEATURE_ID}`, to: 'module:src/spec/recovery.ts', kind: 'touches'}),
      expect.objectContaining({from: `feature:${FEATURE_ID}`, to: `test:${LIVE_TEST}`, kind: 'covers'}),
    ]));

    const context = buildContextSlice(spec, 'account-recovery');
    if (!('focus' in context)) throw new Error('expected migrated feature slug to resolve in the context surface');
    expect(context).toMatchObject({
      focus: expect.objectContaining({id: FEATURE_ID}),
      scenarios: [{id: SCENARIO_ID, title: 'Recover account access'}],
      test_refs: [LIVE_REF],
    });
    const impact = buildImpactSlice(spec, 'account-recovery');
    if ('not_found' in impact) throw new Error('expected migrated feature slug to resolve in the impact surface');
    expect(impact).toMatchObject({
      focus: expect.objectContaining({id: FEATURE_ID}),
      impacted_modules: ['src/spec/recovery.ts'],
      scenarios: [{id: SCENARIO_ID, title: 'Recover account access'}],
      test_refs: [LIVE_REF],
    });
    expect(graph.nodes.some((node) => node.id === 'test:tests/legacy-recovery.test.ts')).toBe(false);
    expect(JSON.stringify({graph, context, impact})).not.toContain(LEGACY_REF);

    const direct = compilationFeature(root, DIRECT_FEATURE_ID);
    expect(direct.capabilityRefs).toEqual([]);
    const directAdvisory = capabilitiesFeatureMapping.run({cwd: root});
    expect(directAdvisory.some((finding) => finding.severity === 'error')).toBe(false);
    expect(directAdvisory).toEqual(expect.arrayContaining([
      expect.objectContaining({detector: 'CAPABILITIES_FEATURE_MAPPING', severity: 'info', message: expect.stringContaining(DIRECT_FEATURE_ID)}),
    ]));
  });
});

/** Reads the compiler contract rather than re-parsing feature YAML in an assertion. */
function compilationFeature(root: string, id: string): {readonly capabilityRefs: readonly string[]} {
  const feature = compileSpecWorkspace(root).contract?.features.find((entry) => entry.id === id);
  if (!feature) throw new Error(`missing compiler contract feature ${id}`);
  return feature;
}
