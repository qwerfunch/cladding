// Cladding · Spec 0.2 F7-B4 · criterion-owned observation adapters.

import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

import {derivePluginMirror, mirrorClosurePaths, mirrorManifest} from '../../scripts/plugin-mirror-policy.mjs';
import {canonicalClosureJson} from './closures.js';
import {compareCodeUnits} from './registry.js';
import {currentSafeBindings} from '../proof/current-bindings.js';
import {buildProofView} from '../proof/view.js';
import type {JUnitCaseObservation, JUnitReport} from '../stages/junit-report.js';
import {parseJUnitReport} from '../stages/junit-report.js';
import {isCurrentRunProofEvidence, type CurrentRunProofEvidence} from '../stages/test-run-cache.js';
import type {SpecCompilation} from '../spec/compiler/types.js';

/**
 * Identifies one composite criterion without the GraphIR presentation prefix.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export type CriterionAddress = `${string}/${string}`;

/**
 * Names the registry-owned evidence carrier for a criterion rule.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export type CriterionObservationCarrier = 'proof-view' | 'current-suite-closure' | 'static-census';

/**
 * Separates required behavior evidence from static applicability evidence.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export type CriterionObservationMode = 'behavior' | 'static';

/**
 * Carries a registry-owned adapter identity that callers cannot substitute.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export interface CriterionAdapterIdentity {
  readonly id: string;
  readonly version: string;
}

/**
 * Records one current result emitted by a registered criterion adapter.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export interface CriterionObservationReport {
  readonly criterion: CriterionAddress;
  readonly carrier: CriterionObservationCarrier;
  readonly adapter: CriterionAdapterIdentity;
  readonly state: 'pass' | 'fail' | 'unobserved';
  readonly current: boolean;
  readonly complete: boolean;
  readonly applicable: boolean;
  readonly input_addresses: readonly string[];
  readonly input_sha256: string;
  readonly manifest_sha256: string;
  readonly locator?: string;
  readonly reason?: 'stale' | 'missing' | 'invalid' | 'unsupported';
}

/**
 * Declares the evidence carrier, byte closure, and applicability fact for one criterion.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export interface CriterionObservationRule {
  readonly criterion: CriterionAddress;
  readonly mode: CriterionObservationMode;
  readonly carrier: CriterionObservationCarrier;
  readonly adapter: CriterionAdapterIdentity;
  readonly inputAddresses: readonly string[];
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly applicability: (report: CriterionObservationReport) => boolean;
}

/**
 * Carries compiler-minted static criterion subjects for executable obligations.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export interface StaticCriterionScope {
  readonly subjects: readonly `criterion:${CriterionAddress}`[];
}

const trustedReports = new WeakSet<object>();
const trustedStaticScopes = new WeakSet<object>();
const CODE_UNIT_SORT = <T extends string>(values: readonly T[]): readonly T[] => Object.freeze([...values].sort(compareCodeUnits));
const artifact = (path: string): string => `artifact:${path}`;
const hash = (value: unknown): string => createHash('sha256').update(canonicalClosureJson(value), 'utf8').digest('hex');

/** Recursively freezes registry values before they become hashable authority. */
function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) deepFreeze(child, visited);
  Object.freeze(value);
  return value;
}

const FINDING_PARSER_BINDING = Object.freeze({
  path: 'tests/stages/finding-parser.test.ts',
  selector: 'finding-parser (F-b7873005) > [covers:F-b7873005/AC-0fa3265d] derives every reported location from captured tool output despite contradictory, missing, or mutated source',
});

const COMPACTION_SUITES = CODE_UNIT_SORT([
  'tests/stages/planned-backlog.test.ts', 'tests/stages/hollow-governance.test.ts',
  'tests/stages/scenario-coverage.test.ts', 'tests/stages/project-context-drift.test.ts',
  'tests/core/git-ops.test.ts', 'tests/changelog/collect.test.ts', 'tests/report/report.test.ts',
  'tests/report/report-cli.test.ts', 'tests/cli/changelog-measure.test.ts',
  'tests/optimizer/measurement.test.ts', 'tests/optimizer/infer-depends-on.test.ts',
  'tests/optimizer/code-excerpt.test.ts', 'tests/events/log.test.ts',
]);

const COMPACTION_IMPLEMENTATIONS = CODE_UNIT_SORT([
  'src/stages/detectors/planned-backlog.ts', 'src/stages/detectors/hollow-governance.ts',
  'src/stages/detectors/scenario-coverage.ts', 'src/stages/detectors/project-context-drift.ts',
  'src/core/git-ops.ts', 'src/changelog/collect.ts', 'src/cli/report.ts', 'src/cli/changelog.ts',
  'src/optimizer/infer-depends-on.ts', 'src/optimizer/measurement.ts', 'src/optimizer/code-excerpt.ts',
  'src/events/log.ts',
]);

const LOCALE_SOURCE_UNIVERSE = CODE_UNIT_SORT([
  'src/ui/softShell.ts', 'src/cli/hook.ts', 'src/cli/clad.ts', 'src/cli/done.ts',
  'src/spec/schema.json', 'src/assurance/criterion-observations.ts', 'src/assurance/kernel.ts',
  'src/assurance/adapters.ts', 'src/assurance/workspace.ts',
]);
// Keep policy tokens split in this source so the raw-byte product census can
// include its adapter without matching its own detector configuration.
const LOCALE_NEEDLES = Object.freeze([
  'resolve' + 'Locale', 'Plain' + 'Locale', 'readSidecar' + 'Locale',
  'user' + '-locale', 'project' + '.locale',
]);

const staticRule = (
  criterion: CriterionAddress,
  adapter: CriterionAdapterIdentity,
  inputAddresses: readonly string[],
  manifest: Readonly<Record<string, unknown>>,
): CriterionObservationRule => Object.freeze({
  criterion, mode: 'static', carrier: 'static-census', adapter: Object.freeze(adapter),
  inputAddresses: CODE_UNIT_SORT(inputAddresses), manifest: deepFreeze(manifest),
  applicability: (report: CriterionObservationReport): boolean => report.current && report.complete && report.applicable,
});

const behaviorRule = (
  criterion: CriterionAddress,
  carrier: Exclude<CriterionObservationCarrier, 'static-census'>,
  adapter: CriterionAdapterIdentity,
  inputAddresses: readonly string[],
  manifest: Readonly<Record<string, unknown>>,
): CriterionObservationRule => Object.freeze({
  criterion, mode: 'behavior', carrier, adapter: Object.freeze(adapter),
  inputAddresses: CODE_UNIT_SORT(inputAddresses), manifest: deepFreeze(manifest),
  applicability: (): boolean => false,
});

/**
 * Provides the sealed static and live adapter registry for the B4 criteria.
 *
 * @see spec/features/gate-error-parser-b7873005.yaml AC-0fa3265d
 * @see spec/features/code-compact-c58263b8.yaml AC-01797b10
 * @see spec/features/plain-first-finding-render-dd8dc994.yaml AC-25f77cec
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export const CRITERION_OBSERVATION_RULES: readonly CriterionObservationRule[] = Object.freeze([
  behaviorRule('F-b7873005/AC-0fa3265d', 'proof-view', {id: 'tool-output-location-parser', version: '2'}, [
    artifact('src/stages/finding-parser.ts'), artifact(FINDING_PARSER_BINDING.path), artifact('src/assurance/criterion-observations.ts'),
  ], {
    carrier: 'proof-view', binding: FINDING_PARSER_BINDING, adapterInput: 'captured-tool-output-v1', locationSource: 'adapter-only',
  }),
  behaviorRule('F-c58263b8/AC-01797b10', 'current-suite-closure', {id: 'compaction-proof-closure', version: '2'}, [
    ...COMPACTION_SUITES.map(artifact), ...COMPACTION_IMPLEMENTATIONS.map(artifact), artifact('package.json'), artifact('vitest.config.ts'), artifact('src/assurance/criterion-observations.ts'),
  ], {
    carrier: 'current-suite-closure', suites: COMPACTION_SUITES, implementations: COMPACTION_IMPLEMENTATIONS,
    runnerConfig: ['package.json', 'vitest.config.ts'], adapterPolicy: 'criterion-observations-v2',
  }),
  staticRule('F-dd8dc994/AC-25f77cec', {id: 'locale-tail-static', version: '2'}, LOCALE_SOURCE_UNIVERSE.map(artifact), {
    carrier: 'static-census', sourceUniverse: LOCALE_SOURCE_UNIVERSE,
    forbidden: LOCALE_NEEDLES, allowed: ['String.localeCompare'],
  }),
  staticRule('F-40327b/AC-004', {id: 'plugin-mirror-census', version: '2'}, mirrorClosurePaths().map(artifact), {
    carrier: 'static-census', manifest: mirrorManifest(), transform: 'plugin-mirror-policy.mjs', outputs: 'expected-and-actual-sha256-v2',
  }),
]);

const rulesByCriterion = new Map(CRITERION_OBSERVATION_RULES.map((rule) => [rule.criterion, rule]));

/**
 * Returns the exact registry rule without relying on labels or historic test counts.
 *
 * @param criterion - Composite criterion address to resolve.
 * @returns The registered rule, or `undefined` when the criterion has no adapter.
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export function criterionObservationRule(criterion: string): CriterionObservationRule | undefined {
  return rulesByCriterion.get(criterion as CriterionAddress);
}

/**
 * Determines whether this module minted the report as trusted evidence.
 *
 * @param value - Candidate report from a caller or workspace adapter.
 * @returns `true` only for an unmodified report minted by this module.
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export function isTrustedCriterionObservationReport(value: unknown): value is CriterionObservationReport {
  return value !== null && typeof value === 'object' && trustedReports.has(value);
}

/**
 * Determines whether this module minted the scope from compiler facts.
 *
 * @param value - Candidate static scope from an adapter caller.
 * @returns `true` only for a compiler-derived static subject scope.
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export function isStaticCriterionScope(value: unknown): value is StaticCriterionScope {
  return value !== null && typeof value === 'object' && trustedStaticScopes.has(value);
}

/**
 * Returns the exact current compaction suite manifest.
 *
 * @returns Sorted suite paths required by the compaction behavior adapter.
 * @see spec/features/code-compact-c58263b8.yaml AC-01797b10
 */
export function compactionSuiteInputs(): readonly string[] { return COMPACTION_SUITES; }

/**
 * Returns the declared product closure for the locale-tail criterion.
 *
 * @returns Sorted source paths inspected by the locale static adapter.
 * @see spec/features/plain-first-finding-render-dd8dc994.yaml AC-25f77cec
 */
export function localeTailSourceUniverse(): readonly string[] { return LOCALE_SOURCE_UNIVERSE; }

/**
 * Inspects supplied locale-tail sources without minting reducer-trusted evidence.
 *
 * @param sources - Source bytes keyed by repository-relative path.
 * @returns An untrusted diagnostic report for the locale criterion.
 * @see spec/features/plain-first-finding-render-dd8dc994.yaml AC-25f77cec
 */
export function inspectLocaleTailSources(sources: Readonly<Record<string, string | Uint8Array | undefined>>): CriterionObservationReport {
  const rule = requiredRule('F-dd8dc994/AC-25f77cec');
  return sourceReport(rule, sources, false, inspectLocaleBytes);
}

/**
 * Reads the locale-tail workspace closure through its static adapter.
 *
 * @param cwd - Workspace root containing the declared source closure.
 * @returns A trusted locale static report for the current workspace.
 * @see spec/features/plain-first-finding-render-dd8dc994.yaml AC-25f77cec
 */
export function inspectLocaleTailWorkspace(cwd: string): CriterionObservationReport {
  const rule = requiredRule('F-dd8dc994/AC-25f77cec');
  return sourceReport(rule, readWorkspaceSources(cwd, pathsFor(rule)), true, inspectLocaleBytes);
}

/**
 * Reads the plugin-mirror workspace closure through its static adapter.
 *
 * @param cwd - Workspace root containing canonical and managed mirror files.
 * @returns A trusted plugin-mirror static report for the current workspace.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function inspectPluginMirrorWorkspace(cwd: string): CriterionObservationReport {
  const rule = requiredRule('F-40327b/AC-004');
  const census = derivePluginMirror(cwd);
  const unsafe = census.issues.some((entry) => ['incomplete', 'invalid', 'malformed', 'collision', 'symlink'].includes(entry.kind));
  return trust({
    criterion: rule.criterion, carrier: rule.carrier, adapter: rule.adapter,
    state: unsafe ? 'unobserved' : census.clean ? 'pass' : 'fail', current: true,
    complete: census.complete && !unsafe, applicable: census.complete && !unsafe,
    input_addresses: rule.inputAddresses, input_sha256: census.inputSha256, manifest_sha256: hash(rule.manifest),
    ...(census.issues.length === 0 ? {} : {locator: census.issues.map((entry) => `${entry.kind}:${entry.path}`).join(',')}),
    ...(unsafe ? {reason: 'invalid' as const} : {}),
  });
}

/**
 * Produces only registered static reports selected by a schema-0.2 compiler scope.
 *
 * @param cwd - Workspace root used by selected static adapters.
 * @param compilation - Compiler snapshot that proves the exact criteria exist.
 * @param scopeAddresses - Effective feature or criterion scope for this profile.
 * @returns Trusted reports for matching static rules, or an empty array outside schema 0.2.
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export function staticCriterionReportsFromWorkspace(
  cwd: string,
  compilation: SpecCompilation,
  scopeAddresses: readonly string[],
): readonly CriterionObservationReport[] {
  if (compilation.schemaVersion !== '0.2') return Object.freeze([]);
  return Object.freeze(staticRulesForScope(compilation, scopeAddresses).map((rule) => staticWorkspaceReport(cwd, rule)));
}

/**
 * Mints exact static subjects from compiled registry rules and effective scope facts.
 *
 * @param compilation - Compiler snapshot that proves the exact criteria exist.
 * @param scopeAddresses - Effective feature or criterion scope for this profile.
 * @returns A trusted static scope, empty outside schema 0.2 or without matching rules.
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export function staticCriterionScopeFromWorkspace(
  compilation: SpecCompilation,
  scopeAddresses: readonly string[],
): StaticCriterionScope {
  const scope = Object.freeze({subjects: Object.freeze(staticRulesForScope(compilation, scopeAddresses)
    .map((rule) => `criterion:${rule.criterion}` as const)
    .sort(compareCodeUnits))});
  trustedStaticScopes.add(scope);
  return scope;
}

/**
 * Produces B4 behavior reports exclusively from the current opaque Unit
 * adapter. It does not accept caller-provided suite observations or proof views.
 *
 * @param input - Compiler scope and opaque current-run evidence.
 * @returns Trusted behavior reports selected by the current schema-0.2 scope.
 * @see spec/features/gate-error-parser-b7873005.yaml AC-0fa3265d
 * @see spec/features/code-compact-c58263b8.yaml AC-01797b10
 */
export function liveCriterionReportsFromCurrentRun(input: {
  readonly cwd: string;
  readonly compilation: SpecCompilation;
  readonly scopeAddresses: readonly string[];
  readonly currentRun?: CurrentRunProofEvidence;
  readonly expectedGateInputSha256?: string;
}): readonly CriterionObservationReport[] {
  if (input.compilation.schemaVersion !== '0.2' || !isCurrentRunUsable(input.currentRun, input.expectedGateInputSha256)) return Object.freeze([]);
  const reports: CriterionObservationReport[] = [];
  if (criterionInScope('F-b7873005/AC-0fa3265d', input.scopeAddresses)) reports.push(inspectFindingParserCurrentProof(input));
  if (criterionInScope('F-c58263b8/AC-01797b10', input.scopeAddresses)) reports.push(inspectCompactionCurrentProof(input));
  return Object.freeze(reports);
}

/**
 * Inspects synthetic compaction fixtures without minting reducer-trusted evidence.
 *
 * @param input - Sealed source bytes and fixture observations to inspect.
 * @returns An untrusted compaction diagnostic report.
 * @see spec/features/code-compact-c58263b8.yaml AC-01797b10
 */
export function inspectCompactionProofClosure(input: {
  readonly sources: Readonly<Record<string, string | Uint8Array | undefined>>;
  readonly observations: readonly {readonly path: string; readonly input_sha256: string; readonly state: 'pass' | 'fail' | 'unobserved'; readonly current: boolean}[];
}): CriterionObservationReport {
  const rule = requiredRule('F-c58263b8/AC-01797b10');
  const report = sourceReport(rule, input.sources, false, () => []);
  const paths = new Set(input.observations.map((entry) => entry.path));
  const exact = report.complete && COMPACTION_SUITES.every((path) => paths.has(path));
  const failed = exact && input.observations.some((entry) => entry.state === 'fail');
  return Object.freeze({...report, state: failed ? 'fail' : exact ? 'pass' : 'unobserved', current: exact && input.observations.every((entry) => entry.current), complete: report.complete && exact, applicable: false});
}

function inspectFindingParserCurrentProof(input: {
  readonly cwd: string;
  readonly compilation: SpecCompilation;
  readonly currentRun?: CurrentRunProofEvidence;
  readonly expectedGateInputSha256?: string;
}): CriterionObservationReport {
  const rule = requiredRule('F-b7873005/AC-0fa3265d');
  const sealed = sealedRecords(rule, readWorkspaceSources(input.cwd, pathsFor(rule)));
  const bindings = currentSafeBindings(input.cwd, input.compilation).filter((binding) => binding.criterion === rule.criterion
    && binding.file === FINDING_PARSER_BINDING.path && binding.selector === FINDING_PARSER_BINDING.selector);
  const report = currentRunReport(input.currentRun!, input.cwd);
  const proof = report === undefined || bindings.length !== 1 ? undefined
    : buildProofView({schemaVersion: '0.2', criteria: [rule.criterion], bindings, report})[0];
  const state = !sealed.complete || proof === undefined ? 'unobserved'
    : proof.test.state === 'failed' ? 'fail' : proof.test.state === 'verified' ? 'pass' : 'unobserved';
  return trust({
    criterion: rule.criterion, carrier: rule.carrier, adapter: rule.adapter, state, current: true,
    complete: sealed.complete && proof !== undefined, applicable: false, input_addresses: rule.inputAddresses,
    input_sha256: hash({criterion: rule.criterion, manifest: rule.manifest, records: sealed.records, gate: gateIdentity(input.currentRun!)}), manifest_sha256: hash(rule.manifest),
    ...(state === 'unobserved' ? {reason: sealed.complete ? 'stale' as const : 'missing' as const} : {}),
  });
}

function inspectCompactionCurrentProof(input: {
  readonly cwd: string;
  readonly currentRun?: CurrentRunProofEvidence;
}): CriterionObservationReport {
  const rule = requiredRule('F-c58263b8/AC-01797b10');
  const sealed = sealedRecords(rule, readWorkspaceSources(input.cwd, pathsFor(rule)));
  const cases = currentRunReport(input.currentRun!, input.cwd)?.cases;
  const suiteStates = COMPACTION_SUITES.map((path) => ({path, cases: (cases ?? []).filter((entry) => entry.files.includes(path))}));
  const completeCases = sealed.complete && suiteStates.every((entry) => entry.cases.length > 0);
  const failed = completeCases && suiteStates.some((entry) => entry.cases.some((testCase) => testCase.status === 'fail' || testCase.status === 'error'));
  const passed = completeCases && suiteStates.every((entry) => entry.cases.every((testCase) => testCase.status === 'pass'));
  return trust({
    criterion: rule.criterion, carrier: rule.carrier, adapter: rule.adapter,
    state: failed ? 'fail' : passed ? 'pass' : 'unobserved', current: true,
    complete: completeCases, applicable: false, input_addresses: rule.inputAddresses,
    input_sha256: hash({criterion: rule.criterion, manifest: rule.manifest, records: sealed.records, gate: gateIdentity(input.currentRun!)}), manifest_sha256: hash(rule.manifest),
    ...(passed || failed ? {} : {reason: sealed.complete ? 'stale' as const : 'missing' as const}),
  });
}

function sourceReport(
  rule: CriterionObservationRule,
  sources: Readonly<Record<string, string | Uint8Array | undefined>>,
  trusted: boolean,
  inspect: (path: string, source: string) => readonly string[],
): CriterionObservationReport {
  const sealed = sealedRecords(rule, sources);
  const findings = sealed.records.flatMap((record) => record.bytes === '<missing>' ? []
    : inspect(record.path, Buffer.from(record.bytes, 'base64').toString('utf8')).map((needle) => `${record.path}:${needle}`)).sort(compareCodeUnits);
  const report: CriterionObservationReport = Object.freeze({
    criterion: rule.criterion, carrier: rule.carrier, adapter: rule.adapter,
    state: !sealed.complete ? 'unobserved' : findings.length > 0 ? 'fail' : 'pass', current: true, complete: sealed.complete,
    applicable: sealed.complete, input_addresses: rule.inputAddresses,
    input_sha256: hash({criterion: rule.criterion, adapter: rule.adapter, manifest: rule.manifest, records: sealed.records}), manifest_sha256: hash(rule.manifest),
    ...(!sealed.complete ? {reason: 'missing' as const} : {}),
    ...(findings.length > 0 ? {locator: findings.join(',')} : {}),
  });
  return trusted ? trust(report) : report;
}

function sealedRecords(rule: CriterionObservationRule, sources: Readonly<Record<string, string | Uint8Array | undefined>>): {
  readonly complete: boolean;
  readonly records: readonly {readonly path: string; readonly bytes: string}[];
} {
  const records = pathsFor(rule).map((path) => {
    const source = sources[path];
    return Object.freeze({path, bytes: source === undefined ? '<missing>' : Buffer.from(source).toString('base64')});
  });
  return Object.freeze({complete: records.every((record) => record.bytes !== '<missing>'), records: Object.freeze(records)});
}

function readWorkspaceSources(cwd: string, paths: readonly string[]): Readonly<Record<string, string | undefined>> {
  return Object.freeze(Object.fromEntries(paths.map((path) => [path, readSafeFile(cwd, path)])));
}

function readSafeFile(cwd: string, path: string): string | undefined {
  const root = resolve(cwd);
  try {
    if (lstatSync(root).isSymbolicLink()) return undefined;
    let current = root;
    const segments = path.split('/');
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) return undefined;
      if (index === segments.length - 1 && !stat.isFile()) return undefined;
    }
    return readFileSync(current, 'utf8');
  } catch {
    return undefined;
  }
}

function currentRunReport(currentRun: CurrentRunProofEvidence, cwd: string): JUnitReport | undefined {
  if (!isCurrentRunProofEvidence(currentRun)) return undefined;
  if (currentRun.format === 'junit-xml') {
    try { return parseJUnitReport(currentRun.reportBytes); } catch { return undefined; }
  }
  try {
    const parsed = JSON.parse(currentRun.reportBytes) as {testResults?: readonly {name?: string; assertionResults?: readonly {status?: string; fullName?: string; title?: string}[]}[]};
    if (!Array.isArray(parsed.testResults)) return undefined;
    const report = new Map() as JUnitReport;
    const cases: JUnitCaseObservation[] = [];
    for (const file of parsed.testResults) {
      if (typeof file.name !== 'string') continue;
      const path = relative(resolve(cwd), resolve(cwd, file.name)).replaceAll('\\', '/');
      if (!path || path.startsWith('../')) continue;
      for (const assertion of file.assertionResults ?? []) {
        const name = assertion.fullName ?? assertion.title;
        if (!name) continue;
        const status = assertion.status === 'passed' ? 'pass' as const : assertion.status === 'failed' ? 'fail' as const
          : assertion.status === 'skipped' || assertion.status === 'pending' || assertion.status === 'todo' ? 'skip' as const : 'error' as const;
        const aggregate = report.get(path) ?? {pass: 0, fail: 0, skip: 0};
        if (status === 'pass') aggregate.pass += 1;
        else if (status === 'skip') aggregate.skip += 1;
        else aggregate.fail += 1;
        report.set(path, aggregate);
        cases.push(Object.freeze({file: path, files: Object.freeze([path]), className: path, name, ...(typeof assertion.title === 'string' ? {sourceTitle: assertion.title} : {}), status}));
      }
    }
    Object.defineProperty(report, 'cases', {value: Object.freeze(cases), enumerable: false});
    return report;
  } catch {
    return undefined;
  }
}

function isCurrentRunUsable(currentRun: CurrentRunProofEvidence | undefined, expected: string | undefined): currentRun is CurrentRunProofEvidence {
  return currentRun !== undefined && expected !== undefined && currentRun.inputSha256 === expected
    && currentRun.adapter.id === 'legacy-stage:stage_2.1' && currentRun.adapter.version === '1'
    && /^[0-9a-f]{64}$/.test(currentRun.commandSha256) && /^[0-9a-f]{64}$/.test(currentRun.reportSha256)
    && isCurrentRunProofEvidence(currentRun);
}

function gateIdentity(currentRun: CurrentRunProofEvidence): Readonly<Record<string, string>> {
  return Object.freeze({input: currentRun.inputSha256, command: currentRun.commandSha256, report: currentRun.reportSha256});
}

function inspectLocaleBytes(_path: string, source: string): readonly string[] {
  return Object.freeze(LOCALE_NEEDLES.filter((needle) => source.includes(needle)));
}

function pathsFor(rule: CriterionObservationRule): readonly string[] {
  return rule.inputAddresses.filter((address) => address.startsWith('artifact:')).map((address) => address.slice('artifact:'.length));
}

/** Selects static registry rules whose exact compiler subjects are in scope. */
function staticRulesForScope(compilation: SpecCompilation, scopeAddresses: readonly string[]): readonly CriterionObservationRule[] {
  if (compilation.schemaVersion !== '0.2') return Object.freeze([]);
  const compiled = new Set(compilation.nodes
    .filter((node) => node.nodeType === 'semantic' && node.kind === 'criterion')
    .map((node) => node.address));
  return Object.freeze(CRITERION_OBSERVATION_RULES
    .filter((rule) => rule.mode === 'static'
      && compiled.has(`criterion:${rule.criterion}`)
      && criterionInScope(rule.criterion, scopeAddresses)));
}

/** Runs the one registered workspace adapter for a selected static rule. */
function staticWorkspaceReport(cwd: string, rule: CriterionObservationRule): CriterionObservationReport {
  if (rule.criterion === 'F-dd8dc994/AC-25f77cec') return inspectLocaleTailWorkspace(cwd);
  if (rule.criterion === 'F-40327b/AC-004') return inspectPluginMirrorWorkspace(cwd);
  throw new Error(`static criterion rule has no workspace adapter: ${rule.criterion}`);
}

function criterionInScope(criterion: string, scopeAddresses: readonly string[]): boolean {
  const feature = criterion.split('/')[0];
  return scopeAddresses.includes(`criterion:${criterion}`) || scopeAddresses.includes(`feature:${feature}`);
}

function requiredRule(criterion: CriterionAddress): CriterionObservationRule {
  const rule = criterionObservationRule(criterion);
  if (!rule) throw new Error(`missing criterion observation rule: ${criterion}`);
  return rule;
}

function trust(report: CriterionObservationReport): CriterionObservationReport {
  const trusted = Object.freeze({...report, input_addresses: Object.freeze([...report.input_addresses].sort(compareCodeUnits))});
  trustedReports.add(trusted);
  return trusted;
}
