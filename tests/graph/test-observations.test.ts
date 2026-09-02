// Cladding · Spec 0.2 F8 · current-gate GraphIR testcase observation facts.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {
  currentGateTestObservationAugmentation,
} from '../../src/graph/test-observations.js';
import {workspaceFactAugmentation} from '../../src/graph/workspace-facts.js';
import {loadGraphIrV2Workspace} from '../../src/graph/query.js';
import {currentSafeBindingCensus} from '../../src/proof/current-bindings.js';
import * as currentBindings from '../../src/proof/current-bindings.js';
import type {CurrentGateTestcaseLedger} from '../../src/proof/testcase-ledger.js';
import {knownCriteriaFromCompilerView} from '../../src/proof/vitest-jest.js';
import {graphIrV2} from '../../src/spec/compiler/graph-ir-v2.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {
  captureCurrentJUnitProof,
  captureCurrentVitestProof,
  clearTestRunCache,
  currentGateTestcaseLedger,
  primeTestRunCache,
} from '../../src/stages/test-run-cache.js';

const roots: string[] = [];
const INPUT_SHA = 'a'.repeat(64);
const CRITERION = 'F-aaaaaaaa/AC-bbbbbbbb';
const SELECTOR = `[covers:${CRITERION}] current observation`;
const SECOND_SELECTOR = `[covers:${CRITERION}] independent observation`;

function workspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-graph-observations-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"',
    'project: {name: graph-observations, language: typescript}',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'alpha-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa',
    'slug: alpha',
    'title: Alpha',
    'status: planned',
    'modules: [tests/live.test.ts]',
    'acceptance_criteria:',
    '  - id: AC-bbbbbbbb',
    '    text: The system shall retain the current gate observation.',
    '',
  ].join('\n'));
  return root;
}

function writeBindings(root: string, selectors: readonly string[] = [SELECTOR]): void {
  writeFileSync(join(root, 'tests', 'live.test.ts'), `${selectors.map((selector) =>
    `it(${JSON.stringify(selector)}, () => {});`).join('\n')}\n`);
}

function compiledBindings(root: string) {
  const compilation = compileSpecWorkspace(root);
  return {
    compilation,
    census: currentSafeBindingCensus(root, knownCriteriaFromCompilerView(compilation.nodes)),
  };
}

function vitestBytes(root: string, assertionResults: readonly object[], extra: object = {}): string {
  return JSON.stringify({
    testResults: [{
      name: join(root, 'tests', 'live.test.ts'),
      assertionResults,
    }],
    ...extra,
  });
}

/** Mints gate evidence exactly as stage_2.1 does, then seals it at the stage seam. */
function mintVitestLedger(root: string, reportBytes: string): CurrentGateTestcaseLedger {
  const report = join(root, 'current-vitest.json');
  primeTestRunCache(root, INPUT_SHA);
  try {
    writeFileSync(report, reportBytes);
    captureCurrentVitestProof(root, report, ['vitest', 'run']);
    const result = currentGateTestcaseLedger(root, INPUT_SHA);
    if (!('ledger' in result)) throw new Error(`fixture failed to seal a Vitest ledger: ${result.reasons.join('; ')}`);
    return result.ledger;
  } finally {
    clearTestRunCache();
  }
}

function mintJUnitLedger(root: string, reportBytes: string): CurrentGateTestcaseLedger {
  mkdirSync(join(root, '.cladding'), {recursive: true});
  writeFileSync(join(root, '.cladding', 'config.yaml'), 'gate:\n  test_report: current.junit.xml\n');
  const report = join(root, 'current.junit.xml');
  primeTestRunCache(root, INPUT_SHA);
  try {
    writeFileSync(report, reportBytes);
    captureCurrentJUnitProof(root, ['vitest', 'run']);
    const result = currentGateTestcaseLedger(root, INPUT_SHA);
    if (!('ledger' in result)) throw new Error(`fixture failed to seal a JUnit ledger: ${result.reasons.join('; ')}`);
    return result.ledger;
  } finally {
    clearTestRunCache();
  }
}

afterEach(() => {
  clearTestRunCache();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('current-gate GraphIR testcase observations', () => {
  test('[covers:F-208eaa79/AC-4f8c2542] keeps authored bindings and observed passes as independent facts', () => {
    const root = workspaceRoot();
    writeBindings(root);
    const {compilation, census} = compiledBindings(root);
    const ledger = mintVitestLedger(root, vitestBytes(root, [{
      status: 'passed', title: SELECTOR, ancestorTitles: [], opaqueOutput: 'report-body-must-not-leak',
    }], {opaqueReport: 'report-body-must-not-leak'}));
    const authored = workspaceFactAugmentation(compilation, census);
    const observed = currentGateTestObservationAugmentation(compilation, census, ledger);
    const criterion = `criterion:${CRITERION}`;
    const kernel = graphIrV2(compilation, [authored, observed]);
    const covers = kernel.criterionProofs(criterion).records.filter((edge) => edge.relation === 'covers');

    expect(covers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provenance: 'authored',
        state: 'resolved',
        normalizedTarget: criterion,
        selector: {precision: 'fragment', value: SELECTOR},
      }),
      expect.objectContaining({provenance: 'observed', state: 'passed', owner: {
        kind: 'runtime_observation', adapter: 'current-gate-junit-observation@1', reference: expect.stringMatching(/^[a-f0-9]{64}$/),
      }, normalizedTarget: criterion, selector: {precision: 'fragment', value: SELECTOR}}),
    ]));
    expect(covers).toHaveLength(2);
    expect(kernel.criterionProofs(criterion)).toMatchObject({completeness: 'complete'});
    expect(JSON.stringify(observed)).not.toContain('report-body-must-not-leak');
    expect(JSON.stringify(observed)).not.toContain('vitest","run');
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed.edges)).toBe(true);
    expect(Object.isFrozen(observed.edges[0]!)).toBe(true);
  });

  test('[covers:F-208eaa79/AC-d452908b] maps exact pass, fail/error dominance, skipped-only, and unrelated passes independently', () => {
    const root = workspaceRoot();
    writeBindings(root);
    const {compilation, census} = compiledBindings(root);
    const state = (assertionResults: readonly object[]) => currentGateTestObservationAugmentation(
      compilation,
      census,
      mintVitestLedger(root, vitestBytes(root, assertionResults)),
    ).edges[0]?.state;

    expect(state([{status: 'passed', title: SELECTOR, ancestorTitles: []}])).toBe('passed');
    expect(state([
      {status: 'passed', title: SELECTOR, ancestorTitles: []},
      {status: 'error', title: SELECTOR, ancestorTitles: []},
    ])).toBe('failed');
    expect(state([{status: 'skipped', title: SELECTOR, ancestorTitles: []}])).toBe('skipped');
    expect(state([{status: 'passed', title: 'unrelated same-file pass', ancestorTitles: []}])).toBe('unobserved');
    expect(currentGateTestObservationAugmentation(
      compilation,
      census,
      mintJUnitLedger(root, `<testsuite><testcase file="tests/live.test.ts" name="${SELECTOR}"/></testsuite>`),
    ).edges[0]?.state).toBe('passed');

    for (const assertionResults of [
      [{status: 'error', title: SELECTOR, ancestorTitles: []}],
      [{status: 'skipped', title: SELECTOR, ancestorTitles: []}],
      [{status: 'passed', title: 'unrelated same-file pass', ancestorTitles: []}],
    ]) {
      const observed = currentGateTestObservationAugmentation(
        compilation, census, mintVitestLedger(root, vitestBytes(root, assertionResults)),
      );
      expect(graphIrV2(compilation, [workspaceFactAugmentation(compilation, census), observed])
        .criterionProofs(`criterion:${CRITERION}`).completeness).toBe('complete');
    }
  });

  test('[covers:F-208eaa79/AC-d452908b] preserves multiple bindings so a mixed current ledger stays visible', () => {
    const root = workspaceRoot();
    writeBindings(root, [SELECTOR, SECOND_SELECTOR]);
    const {compilation, census} = compiledBindings(root);
    const ledger = mintVitestLedger(root, vitestBytes(root, [
      {status: 'passed', title: SELECTOR, ancestorTitles: []},
      {status: 'failed', title: SECOND_SELECTOR, ancestorTitles: []},
    ]));
    const observed = currentGateTestObservationAugmentation(compilation, census, ledger);

    expect(observed.edges).toHaveLength(2);
    expect(observed.edges.map((edge) => edge.state)).toEqual(['passed', 'failed']);
    expect(observed.edges.map((edge) => edge.identity)).toEqual([...observed.edges.map((edge) => edge.identity)].sort());
    expect(JSON.stringify(observed))
      .toBe(JSON.stringify(currentGateTestObservationAugmentation(compilation, census, ledger)));
  });

  test('[covers:F-208eaa79/AC-d452908b] treats a missing or unsealed ledger as unknown rather than empty proof', () => {
    const root = workspaceRoot();
    writeBindings(root);
    const {compilation, census} = compiledBindings(root);
    const sealed = mintVitestLedger(root, vitestBytes(root, [{status: 'passed', title: SELECTOR, ancestorTitles: []}]));
    // A structurally identical copy is exactly the look-alike the seal exists
    // to refuse: same fields, no gate-seam provenance.
    const unsealed = JSON.parse(JSON.stringify(sealed)) as unknown;

    expect(currentGateTestObservationAugmentation(compilation, census, undefined))
      .toMatchObject({completeness: 'unknown', edges: [], unknownReasons: ['current-gate observation context is missing']});
    expect(currentGateTestObservationAugmentation(compilation, census, unsealed))
      .toMatchObject({completeness: 'unknown', edges: [], unknownReasons: ['current-gate testcase ledger is unsealed']});
    expect(currentGateTestObservationAugmentation(compilation, census, sealed).completeness).toBe('complete');
  });

  test('[covers:F-208eaa79/AC-d452908b] refuses unsafe and diagnostic caller-owned binding censuses', () => {
    const root = workspaceRoot();
    writeBindings(root);
    const {compilation, census} = compiledBindings(root);
    const ledger = mintVitestLedger(root, vitestBytes(root, [{status: 'passed', title: SELECTOR, ancestorTitles: []}]));
    const unsafe = {...census, safe: false};
    const malformed = {
      ...census,
      bindings: [{...census.bindings[0]!, file: '../outside.test.ts'}],
    };
    const diagnostic = {
      ...census,
      diagnostics: [{
        code: 'UNKNOWN_CRITERION' as const,
        criterion: 'F-deadbeef/AC-deadbeef',
        file: 'tests/live.test.ts',
        line: 1,
        column: 1,
      }],
    };

    expect(currentGateTestObservationAugmentation(compilation, unsafe, ledger))
      .toMatchObject({completeness: 'unknown', edges: [], unknownReasons: ['current-safe binding census is unsafe']});
    expect(currentGateTestObservationAugmentation(compilation, malformed, ledger))
      .toMatchObject({completeness: 'unknown', edges: [], unknownReasons: ['current-safe binding census does not match the compiler snapshot']});
    expect(currentGateTestObservationAugmentation(compilation, diagnostic, ledger))
      .toMatchObject({completeness: 'unknown', edges: [], unknownReasons: ['current-safe binding census has diagnostics']});
  });

  test('[covers:F-208eaa79/AC-616e6e74] adds observations only from explicit context and scans bindings once per workspace read', () => {
    const root = workspaceRoot();
    writeBindings(root);
    const ledger = mintVitestLedger(root, vitestBytes(root, [{status: 'passed', title: SELECTOR, ancestorTitles: []}]));
    writeFileSync(join(root, 'current.junit.xml'), `<testsuite><testcase file="tests/live.test.ts" name="${SELECTOR}"/></testsuite>`);
    const census = vi.spyOn(currentBindings, 'currentSafeBindingCensus');

    const defaultWorkspace = loadGraphIrV2Workspace(root);
    const defaultProofs = defaultWorkspace.kernel.criterionProofs(`criterion:${CRITERION}`);
    expect(defaultProofs.records.filter((edge) => edge.provenance === 'observed')).toEqual([]);
    expect(defaultProofs).toMatchObject({
      completeness: 'unknown',
      reasons: expect.arrayContaining([`criterion has authored proof declarations but no observed proof fact: criterion:${CRITERION}`]),
    });
    expect(defaultWorkspace.kernel.artifactOwners('artifact:tests/live.test.ts')).toMatchObject({completeness: 'complete'});

    const observedWorkspace = loadGraphIrV2Workspace(root, ledger);
    expect(observedWorkspace.kernel.criterionProofs(`criterion:${CRITERION}`).records)
      .toEqual(expect.arrayContaining([expect.objectContaining({provenance: 'observed', state: 'passed'})]));
    expect(census).toHaveBeenCalledTimes(2);
  });
});
