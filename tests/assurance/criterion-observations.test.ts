// Cladding · F7-B4 · criterion observation registry and static adapters.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {
  compactionSuiteInputs,
  criterionObservationRule,
  inspectCompactionProofClosure,
  inspectLocaleTailSources,
  inspectLocaleTailWorkspace,
  isTrustedCriterionObservationReport,
  liveCriterionReportsFromCurrentRun,
  staticCriterionReportsFromWorkspace,
  staticCriterionScopeFromWorkspace,
} from '../../src/assurance/criterion-observations.js';
import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile, compileAssuranceReductionPlan, reduceAssurancePlan, type AssuranceReductionPlanInput} from '../../src/assurance/kernel.js';
import {currentProofViewsFromWorkspace, hasApplicableSchema02TestCriteria, workspaceProfileSnapshot} from '../../src/assurance/workspace.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import type {SpecCompilation} from '../../src/spec/compiler/types.js';
import {captureCurrentVitestProof, clearTestRunCache, currentGateProofEvidence, currentRunProofIdentity, primeTestRunCache} from '../../src/stages/test-run-cache.js';

const LOCALE = 'F-dd8dc994/AC-25f77cec';
const FINDING_PARSER = 'F-b7873005/AC-0fa3265d';
const COMPACTION = 'F-c58263b8/AC-01797b10';
const localeRule = criterionObservationRule(LOCALE)!;
const findingParserRule = criterionObservationRule(FINDING_PARSER)!;
const compactionRule = criterionObservationRule(COMPACTION)!;
const roots: string[] = [];
const assemble = (...parts: readonly string[]): string => parts.join('');
const FINDING_PARSER_BINDING = Object.freeze({
  path: 'tests/stages/finding-parser.test.ts',
  selector: 'finding-parser (F-b7873005) > [covers:F-b7873005/AC-0fa3265d] derives every reported location from captured tool output despite contradictory, missing, or mutated source',
});
const COMPACTION_BINDING = Object.freeze({
  path: 'tests/assurance/criterion-observations.test.ts',
  selector: 'criterion observation rule authority > [covers:F-c58263b8/AC-01797b10] compaction accepts every named suite only when every current observation binds the exact manifest digest',
});
const B4_PROFILE = assuranceProfile('completion', 'L2');

function compilationWithCriteria(
  schemaVersion: '0.1' | '0.2',
  criteria: readonly string[],
): SpecCompilation {
  return {
    schemaVersion,
    nodes: criteria.map((criterion) => ({address: `criterion:${criterion}`, nodeType: 'semantic', kind: 'criterion'})),
  } as unknown as SpecCompilation;
}

function artifactPaths(rule: {readonly inputAddresses: readonly string[]}): readonly string[] {
  return rule.inputAddresses
    .filter((address) => address.startsWith('artifact:'))
    .map((address) => address.slice('artifact:'.length));
}

function behaviorFeatureModules(rule: {readonly inputAddresses: readonly string[]}): readonly string[] {
  return Object.freeze([...new Set([
    ...artifactPaths(rule).filter((path) => path.startsWith('src/')),
    'src/assurance/kernel.ts',
    'src/assurance/adapters.ts',
  ])].sort());
}

const FINDING_PARSER_MODULES = behaviorFeatureModules(findingParserRule);
const COMPACTION_MODULES = behaviorFeatureModules(compactionRule);
const B4_WORKSPACE_PATHS = Object.freeze([...new Set([
  ...artifactPaths(findingParserRule),
  ...artifactPaths(compactionRule),
  ...FINDING_PARSER_MODULES,
  ...COMPACTION_MODULES,
  COMPACTION_BINDING.path,
])].sort());

function localeWorkspace(mutate?: (path: string) => string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'criterion-observation-'));
  roots.push(root);
  for (const address of localeRule.inputAddresses) {
    const path = address.slice('artifact:'.length);
    const destination = join(root, path);
    mkdirSync(dirname(destination), {recursive: true});
    const bytes = mutate?.(path) ?? 'export const clean = true;\n';
    if (bytes !== undefined) writeFileSync(destination, bytes);
  }
  return root;
}

function plan(input: Partial<AssuranceReductionPlanInput> = {}) {
  const obligation = {
    id: `stage_2.1:criterion:${LOCALE}`, subject: `criterion:${LOCALE}`, assurance_level: 'L2' as const,
    descriptor: 'stage_2.1', input_addresses: localeRule.inputAddresses, input_sha256: 'a'.repeat(64),
    applicability: 'na' as const, blocking: 'hard' as const,
  };
  return compileAssuranceReductionPlan({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', scopeSha256: 'scope', inputSha256: 'scope',
    scopeAddresses: [`criterion:${LOCALE}`], obligations: [obligation], observations: [],
    applicabilityFacts: {complete: true, hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false},
    ...input,
  });
}

function copyCurrentRepositoryBytes(root: string, paths: readonly string[]): void {
  for (const path of paths) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, readFileSync(join(process.cwd(), path)));
  }
}

function writeBehaviorFeature(
  root: string,
  feature: string,
  title: string,
  purpose: string,
  modules: readonly string[],
  criterion: string,
  statement: string,
): void {
  writeFileSync(join(root, 'spec', 'features', `${feature.slice('F-'.length)}.yaml`), [
    `id: ${feature}`, `title: ${title}`, 'status: done', `purpose: ${purpose}`, 'modules:',
    ...modules.map((module) => `  - ${module}`), 'depends_on: []', 'capability_refs: []',
    'acceptance_criteria:', `  - id: ${criterion}`, '    kind: behavior', `    statement: ${statement}`, '',
  ].join('\n'));
}

function behaviorWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'criterion-observation-live-'));
  roots.push(root);
  copyCurrentRepositoryBytes(root, B4_WORKSPACE_PATHS);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: criterion-observation-live', '  language: typescript',
    '  purpose: Preserve exact current behavior observations.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [assurance, stages, core, changelog, cli, optimizer, events]\nrules: []\n');
  writeBehaviorFeature(
    root, 'F-b7873005', 'Finding parser proof', 'Keep tool-output locations bounded to current evidence.',
    FINDING_PARSER_MODULES, 'AC-0fa3265d', 'When a tool finding has a location, the system shall preserve the declared current proof binding.',
  );
  writeBehaviorFeature(
    root, 'F-c58263b8', 'Compaction proof', 'Keep every declared compacted suite current and observable.',
    COMPACTION_MODULES, 'AC-01797b10', 'When compacted code changes, the system shall retain every current suite observation.',
  );
  return root;
}

function currentVitestReporter(
  cwd: string,
  options: {readonly omittedSuite?: string; readonly failedSuite?: string; readonly findingParser?: 'ambiguous' | 'unrelated'} = {},
): string {
  const testCase = (path: string, selector: string, status: 'passed' | 'failed' = 'passed') => ({
    name: join(cwd, path), assertionResults: [{status, fullName: selector}],
  });
  const [findingParserSuite, findingParserTitle] = FINDING_PARSER_BINDING.selector.split(' > ', 2);
  if (!findingParserSuite || !findingParserTitle) throw new Error('expected nested finding-parser selector');
  const findingParserAssertion = options.findingParser === 'ambiguous'
    ? {
      status: 'passed', title: findingParserTitle,
      fullName: `${findingParserSuite} ${findingParserTitle}`,
    }
    : options.findingParser === 'unrelated'
      ? {
        status: 'passed', title: 'unrelated same-file pass',
        fullName: 'global suite unrelated same-file pass',
      }
      : {
        status: 'passed', ancestorTitles: [findingParserSuite], title: findingParserTitle,
        fullName: `${findingParserSuite} ${findingParserTitle}`,
      };
  return JSON.stringify({testResults: [
    {name: join(cwd, FINDING_PARSER_BINDING.path), assertionResults: [findingParserAssertion]},
    testCase(COMPACTION_BINDING.path, COMPACTION_BINDING.selector),
    ...compactionSuiteInputs()
      .filter((path) => path !== options.omittedSuite)
      .map((path) => testCase(path, `current compaction suite: ${path}`, path === options.failedSuite ? 'failed' : 'passed')),
  ]});
}

function withCurrentVitestProof<T>(
  cwd: string,
  inputSha256: string,
  reporter: string,
  run: (evidence: NonNullable<ReturnType<typeof currentGateProofEvidence>>) => T,
): T {
  const report = join(cwd, 'current-vitest.json');
  writeFileSync(report, reporter);
  primeTestRunCache(cwd, inputSha256);
  try {
    captureCurrentVitestProof(cwd, report, ['vitest', 'run']);
    const evidence = currentGateProofEvidence(cwd, inputSha256);
    if (!evidence) throw new Error('expected opaque current Vitest evidence');
    return run(evidence);
  } finally {
    clearTestRunCache();
  }
}

function reduceCurrentBehaviorEvidence(
  cwd: string,
  compilation: ReturnType<typeof compileSpecWorkspace>,
  snapshot: ReturnType<typeof workspaceProfileSnapshot>,
  reporter: string,
) {
  return withCurrentVitestProof(cwd, snapshot.inputSha256, reporter, (currentRun) => {
    const proofViews = currentProofViewsFromWorkspace(
      cwd, compilation, snapshot.effectiveScopeAddresses, currentRun, snapshot.inputSha256,
    );
    const reports = liveCriterionReportsFromCurrentRun({
      cwd, compilation, scopeAddresses: snapshot.effectiveScopeAddresses,
      currentRun, expectedGateInputSha256: snapshot.inputSha256,
    });
    const verdict = reduceLegacyStageAdapter({
      profile: B4_PROFILE, configuredAssuranceLevel: 'L2', completeScope: snapshot.complete,
      scopeAddresses: snapshot.effectiveScopeAddresses,
      inputAddresses: compilation.nodes.map((node) => node.address).sort(), inputSha256: snapshot.inputSha256,
      hasExecutableTests: hasApplicableSchema02TestCriteria(compilation, snapshot.effectiveScopeAddresses),
      hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      proofViews, criterionObservations: [...snapshot.criterionObservations, ...reports],
      staticCriterionScope: snapshot.staticCriterionScope, exactProofRequired: true,
      currentProofObservationIdentity: currentRunProofIdentity(currentRun),
      stages: B4_PROFILE.obligations.map((stage) => ({stage, status: 'pass' as const})), environmentClass: 'test',
    });
    return {proofViews, reports, verdict};
  });
}

function reportFor<T extends {readonly criterion: string}>(reports: readonly T[], criterion: string): T {
  const report = reports.find((entry) => entry.criterion === criterion);
  if (!report) throw new Error(`missing live report for ${criterion}`);
  return report;
}

function expectCriterionStageState(
  verdict: ReturnType<typeof reduceLegacyStageAdapter>,
  criterion: string,
  state: 'pass' | 'fail' | 'unobserved',
): void {
  for (const stage of ['stage_2.1', 'stage_2.2']) {
    expect(verdict.results.find((result) => result.obligation === stage && result.subject === `criterion:${criterion}`))
      .toMatchObject({state});
  }
}

afterEach(() => {
  clearTestRunCache();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('criterion observation rule authority', () => {
  test('[covers:F-dd8dc994/AC-25f77cec] a registered read-only static pass with complete declared bytes is the only route to Unit/Coverage NA', () => {
    const report = inspectLocaleTailWorkspace(localeWorkspace());
    const compiled = plan({obligations: [{
      id: `stage_2.1:criterion:${LOCALE}`, subject: `criterion:${LOCALE}`, assurance_level: 'L2' as const,
      descriptor: 'stage_2.1', input_addresses: localeRule.inputAddresses, input_sha256: report.input_sha256,
      applicability: 'required' as const, blocking: 'hard' as const,
    }], criterionObservations: [report]});
    expect(isTrustedCriterionObservationReport(report)).toBe(true);
    expect(reduceAssurancePlan(compiled).results.find((result) => result.subject === `criterion:${LOCALE}`)).toMatchObject({state: 'na'});
  });

  test('a fully matching copied/static diagnostic report is rejected at the reducer seam', () => {
    const trusted = inspectLocaleTailWorkspace(localeWorkspace());
    const sources = Object.fromEntries(localeRule.inputAddresses.map((address) => [address.slice('artifact:'.length), 'export const clean = true;'])) as Record<string, string>;
    const forged = {...trusted};
    const diagnostic = inspectLocaleTailSources(sources);
    for (const report of [forged, diagnostic]) {
      const result = reduceAssurancePlan(plan({obligations: [{
        id: `stage_2.1:criterion:${LOCALE}`, subject: `criterion:${LOCALE}`, assurance_level: 'L2' as const,
        descriptor: 'stage_2.1', input_addresses: localeRule.inputAddresses, input_sha256: report.input_sha256,
        applicability: 'required' as const, blocking: 'hard' as const,
      }], criterionObservations: [report]})).results.find((entry) => entry.subject === `criterion:${LOCALE}`);
      expect(result).toMatchObject({state: 'unobserved'});
    }
    expect(isTrustedCriterionObservationReport(diagnostic)).toBe(false);
  });

  test('all five raw locale needles fail, comments remain in scope, and String.localeCompare is permitted', () => {
    for (const needle of [
      assemble('resolve', 'Locale'),
      assemble('Plain', 'Locale'),
      assemble('read', 'Sidecar', 'Locale'),
      assemble('user', '-locale'),
      assemble('project', '.locale'),
    ]) {
      expect(inspectLocaleTailWorkspace(localeWorkspace((path) => path === 'src/ui/softShell.ts' ? `// ${needle}\n` : 'export const clean = true;\n'))).toMatchObject({state: 'fail'});
    }
    expect(inspectLocaleTailWorkspace(localeWorkspace((path) => path === 'src/ui/softShell.ts' ? 'String.localeCompare("a", "b");\n' : 'export const clean = true;\n'))).toMatchObject({state: 'pass'});
  });

  test('missing source and false applicability remain required/unobserved, while an explicit static failure stays RED', () => {
    const missing = inspectLocaleTailWorkspace(localeWorkspace((path) => path === 'src/ui/softShell.ts' ? undefined : 'export const clean = true;\n'));
    const failed = inspectLocaleTailWorkspace(localeWorkspace((path) => path === 'src/ui/softShell.ts' ? `${assemble('project', '.locale')}\n` : 'export const clean = true;\n'));
    const missingResult = reduceAssurancePlan(plan({criterionObservations: [missing]})).results.find((entry) => entry.subject === `criterion:${LOCALE}`);
    expect(missingResult).toMatchObject({state: 'unobserved'});
    const red = reduceAssurancePlan(plan({obligations: [{
      id: `stage_2.1:criterion:${LOCALE}`, subject: `criterion:${LOCALE}`, assurance_level: 'L2' as const,
      descriptor: 'stage_2.1', input_addresses: localeRule.inputAddresses, input_sha256: failed.input_sha256,
      applicability: 'na' as const, blocking: 'hard' as const,
    }], criterionObservations: [failed]}));
    expect(red).toMatchObject({state: 'red'});
  });

  test('schema 0.1 matching IDs and a schema 0.2 behavior-only scope perform zero static scans', () => {
    const root = localeWorkspace();
    const legacy = compilationWithCriteria('0.1', [LOCALE, 'F-40327b/AC-004']);
    expect(staticCriterionReportsFromWorkspace(root, legacy, ['feature:F-dd8dc994', 'feature:F-40327b'])).toEqual([]);
    expect(staticCriterionScopeFromWorkspace(legacy, ['feature:F-dd8dc994']).subjects).toEqual([]);

    const behaviorOnly = compilationWithCriteria('0.2', [FINDING_PARSER]);
    expect(staticCriterionReportsFromWorkspace(root, behaviorOnly, ['feature:F-b7873005'])).toEqual([]);
    expect(staticCriterionScopeFromWorkspace(behaviorOnly, ['feature:F-b7873005']).subjects).toEqual([]);
  });

  test('a compiled static criterion remains required and unobserved when its selected report is omitted', () => {
    const compilation = compilationWithCriteria('0.2', [LOCALE]);
    const staticCriterionScope = staticCriterionScopeFromWorkspace(compilation, ['feature:F-dd8dc994']);
    expect(staticCriterionScope.subjects).toEqual([`criterion:${LOCALE}`]);
    const verdict = reduceLegacyStageAdapter({
      profile: B4_PROFILE, configuredAssuranceLevel: 'L2', completeScope: true,
      scopeAddresses: ['feature:F-dd8dc994'], inputAddresses: ['feature:F-dd8dc994'], inputSha256: 'scope',
      hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      criterionObservations: [], staticCriterionScope, exactProofRequired: true,
      stages: B4_PROFILE.obligations.map((stage) => ({stage, status: 'pass' as const})), environmentClass: 'test',
    });
    expectCriterionStageState(verdict, LOCALE, 'unobserved');
    expect(verdict).toMatchObject({state: 'unresolved', profile_complete: false});
  });

  test('deep-freezes nested rule manifests without changing their policy hashes', () => {
    const localeManifest = localeRule.manifest as {
      readonly sourceUniverse: readonly string[];
      readonly forbidden: readonly string[];
    };
    const compactionManifest = compactionRule.manifest as {readonly runnerConfig: readonly string[]};
    const localeSources = Object.fromEntries(localeRule.inputAddresses
      .map((address) => [address.slice('artifact:'.length), 'export const clean = true;']));
    const before = inspectLocaleTailSources(localeSources).manifest_sha256;
    expect(Object.isFrozen(localeManifest.sourceUniverse)).toBe(true);
    expect(Object.isFrozen(localeManifest.forbidden)).toBe(true);
    expect(Object.isFrozen(compactionManifest.runnerConfig)).toBe(true);
    expect(() => (localeManifest.forbidden as unknown as string[]).push('mutate')).toThrow(TypeError);
    expect(() => (compactionManifest.runnerConfig as unknown as string[]).push('mutate')).toThrow(TypeError);
    expect(inspectLocaleTailSources(localeSources).manifest_sha256).toBe(before);
  });

  test('[covers:F-c58263b8/AC-01797b10] synthetic suite observations are diagnostic only and cannot discharge behavior', () => {
    const rule = criterionObservationRule('F-c58263b8/AC-01797b10')!;
    const sources = Object.fromEntries(rule.inputAddresses.map((address) => [address.slice('artifact:'.length), 'suite source'])) as Record<string, string>;
    const diagnostic = inspectCompactionProofClosure({sources, observations: rule.inputAddresses.map((address) => ({
      path: address.slice('artifact:'.length), input_sha256: 'sealed', state: 'pass' as const, current: true,
    }))});
    expect(diagnostic.state).toBe('pass');
    expect(isTrustedCriterionObservationReport(diagnostic)).toBe(false);
  });

  test('[covers:F-c58263b8/AC-01797b10] compaction accepts every named suite only when every current observation binds the exact manifest digest', () => {
    const cwd = behaviorWorkspace();
    for (const path of B4_WORKSPACE_PATHS) {
      expect(readFileSync(join(cwd, path))).toEqual(readFileSync(join(process.cwd(), path)));
    }
    expect(compactionRule.inputAddresses).not.toContain(`artifact:${COMPACTION_BINDING.path}`);
    const compilation = compileSpecWorkspace(cwd);
    expect(compilation).toMatchObject({schemaVersion: '0.2'});
    expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
    const snapshot = workspaceProfileSnapshot(cwd, compilation, {
      profile: B4_PROFILE, scopeAddresses: ['feature:F-b7873005', 'feature:F-c58263b8'],
      hasExecutableTests: true, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.effectiveScopeAddresses).toEqual(['feature:F-b7873005', 'feature:F-c58263b8']);
    expect(hasApplicableSchema02TestCriteria(compilation, snapshot.effectiveScopeAddresses)).toBe(true);
    expect(compactionSuiteInputs()).toHaveLength(13);

    const positive = reduceCurrentBehaviorEvidence(cwd, compilation, snapshot, currentVitestReporter(cwd));
    expect(Object.fromEntries(positive.proofViews.map((view) => [view.criterion, view.test.state]))).toMatchObject({
      [FINDING_PARSER]: 'verified', [COMPACTION]: 'verified',
    });
    for (const criterion of [FINDING_PARSER, COMPACTION]) {
      const report = reportFor(positive.reports, criterion);
      expect(isTrustedCriterionObservationReport(report)).toBe(true);
      expect(report).toMatchObject({state: 'pass', current: true, complete: true});
      expect(report.input_addresses).toEqual(criterionObservationRule(criterion)!.inputAddresses);
      expectCriterionStageState(positive.verdict, criterion, 'pass');
    }
    expect(positive.verdict).toMatchObject({state: 'green', profile_complete: true});

    const findingParserReport = reportFor(positive.reports, FINDING_PARSER);
    const behaviorPlan = compileAssuranceReductionPlan({
      profile: B4_PROFILE, configuredAssuranceLevel: 'L2', scopeSha256: 'scope', inputSha256: 'scope',
      scopeAddresses: [`criterion:${FINDING_PARSER}`], observations: [], criterionObservations: [findingParserReport],
      obligations: [{
        id: `stage_2.1:criterion:${FINDING_PARSER}`, subject: `criterion:${FINDING_PARSER}`, assurance_level: 'L2',
        descriptor: 'stage_2.1', input_addresses: findingParserReport.input_addresses,
        input_sha256: findingParserReport.input_sha256, applicability: 'required', blocking: 'hard',
      }],
      applicabilityFacts: {complete: true, hasExecutableTests: true, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false},
      environmentClass: 'test',
    });
    expect(behaviorPlan.observations).toContainEqual(expect.objectContaining({
      subject: `criterion:${FINDING_PARSER}`, environment_class: 'test',
    }));

    const omittedSuite = compactionSuiteInputs().at(-1);
    if (!omittedSuite) throw new Error('expected a compaction suite manifest');
    const missing = reduceCurrentBehaviorEvidence(
      cwd, compilation, snapshot, currentVitestReporter(cwd, {omittedSuite}),
    );
    expect(reportFor(missing.reports, COMPACTION)).toMatchObject({state: 'unobserved', current: true, complete: false});
    expectCriterionStageState(missing.verdict, COMPACTION, 'unobserved');
    expect(missing.verdict).toMatchObject({state: 'unresolved', profile_complete: false});

    const failedSuite = compactionSuiteInputs()[0];
    if (!failedSuite) throw new Error('expected a compaction suite manifest');
    const failed = reduceCurrentBehaviorEvidence(
      cwd, compilation, snapshot, currentVitestReporter(cwd, {failedSuite}),
    );
    expect(reportFor(failed.reports, COMPACTION)).toMatchObject({state: 'fail', current: true, complete: true});
    expectCriterionStageState(failed.verdict, COMPACTION, 'fail');
    expect(failed.verdict).toMatchObject({state: 'red', profile_complete: true});

    const wrongSeal = snapshot.inputSha256 === '0'.repeat(64) ? 'f'.repeat(64) : '0'.repeat(64);
    withCurrentVitestProof(cwd, snapshot.inputSha256, currentVitestReporter(cwd), (currentRun) => {
      expect(liveCriterionReportsFromCurrentRun({
        cwd, compilation, scopeAddresses: snapshot.effectiveScopeAddresses,
        currentRun, expectedGateInputSha256: wrongSeal,
      })).toEqual([]);
    });
  });

  test('shares native Vitest suite reconstruction with F5 and leaves ambiguous or unrelated fallback output unobserved', () => {
    const cwd = behaviorWorkspace();
    const compilation = compileSpecWorkspace(cwd);
    const snapshot = workspaceProfileSnapshot(cwd, compilation, {
      profile: B4_PROFILE, scopeAddresses: ['feature:F-b7873005', 'feature:F-c58263b8'],
      hasExecutableTests: true, oracleRequiredSubjects: new Set<string>(), requiresHuman: false,
    });

    const native = reduceCurrentBehaviorEvidence(cwd, compilation, snapshot, currentVitestReporter(cwd));
    expect(native.proofViews.find((view) => view.criterion === FINDING_PARSER)?.test)
      .toMatchObject({state: 'verified', matched: 1, pass: 1});
    expect(reportFor(native.reports, FINDING_PARSER)).toMatchObject({state: 'pass', complete: true});

    for (const findingParser of ['ambiguous', 'unrelated'] as const) {
      const unobserved = reduceCurrentBehaviorEvidence(
        cwd, compilation, snapshot, currentVitestReporter(cwd, {findingParser}),
      );
      expect(unobserved.proofViews.find((view) => view.criterion === FINDING_PARSER)?.test)
        .toMatchObject({state: 'unverified', matched: 0, pass: 0});
      expect(reportFor(unobserved.reports, FINDING_PARSER)).toMatchObject({state: 'unobserved', complete: true, reason: 'stale'});
      expectCriterionStageState(unobserved.verdict, FINDING_PARSER, 'unobserved');
    }
  });

  test('schema 0.1-style stage scopes do not gain B4 subjects without the compiler-minted static channel', () => {
    const report = inspectLocaleTailWorkspace(localeWorkspace());
    const verdict = reduceLegacyStageAdapter({
      profile: assuranceProfile('feedback', 'L1'), configuredAssuranceLevel: 'L1', completeScope: true,
      scopeAddresses: ['project'], inputAddresses: ['project'], inputSha256: 'scope',
      hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
      criterionObservations: [report], stages: [{stage: 'stage_1.1', status: 'pass'}], environmentClass: 'test',
    });
    expect(verdict.results.some((result) => result.subject === `criterion:${LOCALE}`)).toBe(false);
  });
});
