// Cladding · Spec 0.2 design-validation harness (F-0a29d024).

import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {parse as parseYaml} from 'yaml';

import {readEventsIncludingRolled} from '../src/events/log.js';
import {summarizeAdoption} from '../src/events/session-report.js';
import {clearAuditObserversForTesting} from '../src/hitl/audit.js';
import {resolveManagedWrite} from '../src/spec/compiler/artifact-registry.js';
import {compileSpecWorkspace, compilerCorpusView} from '../src/spec/compiler/compile.js';
import {scanIndependentCorpus} from '../src/spec/compiler/corpus-snapshot.js';
import {previewSchema02Migration} from '../src/spec/compiler/migration-preview.js';
import {parseStrictStatement} from '../src/spec/statement-parser.js';
import {
  buildServer,
  PERSONA_IDS,
  PERSONA_PROMPT_ALIASES,
  RESOURCE_URIS,
  TOOL_NAMES,
} from '../src/serve/server.js';

/** Outcomes are intentionally non-Boolean so absent evidence cannot look green. */
export type ValidationStatus =
  | 'pass'
  | 'fail'
  | 'inconclusive'
  | 'not_run'
  | 'implementation_pending';

interface DecisionRequirement {
  readonly id: string;
  readonly owner: string;
  readonly scenario: string;
  readonly implementation: 'pending' | 'validation-active';
}

interface CaseRequirement {
  readonly id: string;
  readonly decision: string;
  readonly implementation: 'pending' | 'validation-active';
  /** Exact executable test title for F4-promoted cases. */
  readonly test_ref?: string;
}

interface IntegrationJourney {
  readonly id: string;
  readonly decisions: readonly string[];
  readonly status: 'simulated' | 'validation-active' | 'implementation_pending' | 'not_run';
  readonly scenario: string;
  /** Exact executable test reference required of a validation-active journey. */
  readonly test_ref?: string;
}

interface HostAbTask {
  readonly id: string;
  readonly profile: string;
  readonly objective: string;
  readonly fault_control: string;
}

interface HostAbPolicy {
  readonly host: string;
  readonly max_calls: number;
  readonly blocking: boolean;
}

interface McpScenarioRequirement {
  readonly id: string;
  readonly implementation: 'pending' | 'validation-active';
  readonly slice?:
    | 'f5-receipt-operation'
    | 'f5-receipt-ingestion-and-asserted-fallback'
    | 'graph-v2-focused-projection-and-statistics';
}

export interface ValidationManifest {
  readonly schema: number;
  readonly decisions: readonly DecisionRequirement[];
  readonly preregistered_cases: readonly CaseRequirement[];
  readonly integration_journeys: readonly IntegrationJourney[];
  readonly mcp_scenarios: readonly McpScenarioRequirement[];
  readonly mcp_reference_hosts: readonly string[];
  readonly host_ab: HostAbPolicy;
  readonly host_ab_tasks: readonly HostAbTask[];
}

export interface UsageMeasurement {
  readonly label: string;
  readonly utf8_bytes: number;
  readonly token_estimator: 'characters_div_4_ceiling';
  readonly estimated_tokens: number;
  readonly cache: 'unknown' | 'cold' | 'warm';
  readonly avoidable_bytes: number | null;
  readonly comparator: string | null;
}

export interface ValidationCheck {
  readonly id: string;
  readonly status: ValidationStatus;
  readonly evidence: string;
}

interface CatalogSnapshot {
  readonly tools: readonly Record<string, unknown>[];
  readonly resources: readonly Record<string, unknown>[];
  readonly prompts: readonly Record<string, unknown>[];
  readonly capabilities: Record<string, unknown>;
}

export interface ValidationReport {
  readonly schema: 1;
  readonly target: 'spec-0.2';
  readonly checks: readonly ValidationCheck[];
  readonly measurements: readonly UsageMeasurement[];
  readonly mcp: {
    readonly tool_count: number;
    readonly resource_count: number;
    readonly prompt_count: number;
    readonly tools_list_changed: boolean;
    readonly classified_tools: number;
    readonly full_catalog_bytes: number;
    readonly largest_task_profile_bytes: number;
    readonly task_profile_reduction_ratio: number;
    readonly adoption_verdict: string;
    readonly reference_host_spec_02_e2e: 'not_run';
    readonly host_smoke: HostSmokeSummary | null;
  };
}

interface HostSmokeSummary {
  readonly file: string;
  readonly hosts_verified: readonly string[];
  readonly hosts_failed: readonly string[];
  readonly provider_reported_tokens: Readonly<Record<string, readonly number[]>>;
  readonly scope: 'legacy-read-surface';
}

/** A challenger projection only; it does not change the shipped MCP catalog. */
export const TASK_PROFILE_TOOLS = {
  bootstrap: [
    'clad_prepare_init',
    'clad_stage_init',
    'clad_init',
    'clad_prepare_clarify',
    'clad_clarify',
    'clad_resolve_onboarding_review',
  ],
  'spec-edit': [
    'clad_list_features',
    'clad_get_feature',
    'clad_prepare_spec_edit',
    'clad_edit_spec',
    'clad_begin',
    'clad_create_feature',
    'clad_resolve_design_impact',
    'clad_create_scenario',
    'clad_link_capability',
    'clad_get_impact',
  ],
  implement: [
    'clad_list_features',
    'clad_get_feature',
    'clad_get_context',
    'clad_get_working_set',
    'clad_get_impact',
    'clad_get_graph',
    'clad_run_check',
  ],
  verify: [
    'clad_get_feature',
    'clad_run_check',
    'clad_run_gate',
    'clad_verdict',
    'clad_author_oracle',
    'clad_ingest_receipt',
    'clad_signoff',
    'clad_get_events',
    'clad_get_graph',
  ],
  observe: [
    'clad_get_events',
    'clad_get_context',
    'clad_get_working_set',
    'clad_get_impact',
    'clad_get_graph',
    'clad_changelog',
  ],
} as const satisfies Readonly<Record<string, readonly (typeof TOOL_NAMES)[number][]>>;

/** Recursively sorts object keys so equivalent results serialize byte-identically. */
export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

/** Canonical JSON used only for validation measurements and reproducible reports. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

/** Measures controlled bytes without pretending to know a provider tokenizer or cache. */
export function measureUsage(
  label: string,
  value: string,
  options: {
    cache?: UsageMeasurement['cache'];
    comparator?: {label: string; value: string; equivalentOutput: boolean};
  } = {},
): UsageMeasurement {
  const utf8Bytes = Buffer.byteLength(value, 'utf8');
  const comparatorBytes = options.comparator?.equivalentOutput !== true
    ? null
    : Buffer.byteLength(options.comparator.value, 'utf8');
  return {
    label,
    utf8_bytes: utf8Bytes,
    token_estimator: 'characters_div_4_ceiling',
    estimated_tokens: Math.ceil(value.length / 4),
    cache: options.cache ?? 'unknown',
    avoidable_bytes: comparatorBytes === null ? null : Math.max(0, utf8Bytes - comparatorBytes),
    comparator: options.comparator?.label ?? null,
  };
}

/** Loads the committed validation projection. The design owners remain authoritative. */
export function loadValidationManifest(cwd: string): ValidationManifest {
  const path = join(cwd, 'tests', 'design', 'spec-0.2', 'requirements.yaml');
  return parseYaml(readFileSync(path, 'utf8')) as ValidationManifest;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function withoutFencedMarkdown(body: string): string {
  let fence: '`' | '~' | null = null;
  return body.split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      const kind = marker[0] as '`' | '~';
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      return '';
    }
    return fence === null ? line : '';
  }).join('\n');
}

/** Returns normative-owner violations for a supplied canonical document set. */
export function decisionOwnershipIssues(
  manifest: ValidationManifest,
  documents: ReadonlyMap<string, string>,
): string[] {
  const routerPath = 'docs/design/spec-0.2.md';
  const router = withoutFencedMarkdown(documents.get(routerPath) ?? '');
  const issues: string[] = [];
  for (const decision of manifest.decisions) {
    const heading = new RegExp(`^## ${decision.id}\\b`, 'gm');
    for (const [path, raw] of documents) {
      const count = withoutFencedMarkdown(raw).match(heading)?.length ?? 0;
      const expected = path === decision.owner || path === routerPath ? 1 : 0;
      if (count !== expected) issues.push(`${decision.id}:${path} has ${count}, expected ${expected}`);
    }
    const ownerLink = decision.owner.replace(/^docs\/design\//, '');
    if (!router.includes(`Owner: [${decision.id}](${ownerLink}#`)) {
      issues.push(`${decision.id} router owner link does not target ${decision.owner}`);
    }
  }
  return issues;
}

function checkDecisionOwnership(cwd: string, manifest: ValidationManifest): ValidationCheck {
  const ids = manifest.decisions.map((decision) => decision.id);
  const expected = Array.from({length: 24}, (_, index) => `D${String(index + 1).padStart(2, '0')}`);
  const issues: string[] = [];
  if (!unique(ids) || stableJson([...ids].sort()) !== stableJson(expected)) {
    issues.push('ledger must contain D01-D24 exactly once');
  }
  const routerPath = 'docs/design/spec-0.2.md';
  const designDirectory = join(cwd, 'docs', 'design', 'spec-0.2');
  const paths = [routerPath, ...readdirSync(designDirectory)
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/design/spec-0.2/${name}`)];
  const documents = new Map<string, string>();
  for (const path of paths) documents.set(path, readFileSync(join(cwd, path), 'utf8'));
  for (const decision of manifest.decisions) {
    if (!documents.has(decision.owner)) issues.push(`${decision.id} owner is missing: ${decision.owner}`);
  }
  issues.push(...decisionOwnershipIssues(manifest, documents));
  return {
    id: 'design-ownership',
    status: issues.length === 0 ? 'pass' : 'fail',
    evidence: issues.length === 0
      ? 'D01-D24 each have one owner heading and one matching router navigation heading.'
      : issues.join('; '),
  };
}

function checkDocumentationRatchets(cwd: string): ValidationCheck {
  const router = readFileSync(join(cwd, 'docs', 'design', 'spec-0.2.md'), 'utf8');
  const delivery = readFileSync(join(cwd, 'docs', 'design', 'spec-0.2', 'delivery.md'), 'utf8');
  const routerBytes = Buffer.byteLength(router, 'utf8');
  const issues: string[] = [];
  if (routerBytes > 7.5 * 1024) issues.push(`router=${routerBytes} bytes exceeds the 7.5 KiB operational ratchet`);
  if (!delivery.includes('D01–D24 each have exactly one normative owner')) {
    issues.push('D16 does not cover D01-D24 ownership');
  }
  return {
    id: 'documentation-ratchets',
    status: issues.length === 0 ? 'pass' : 'fail',
    evidence: issues.length === 0
      ? `Router is ${routerBytes} bytes and D16 covers D01-D24 ownership.`
      : issues.join('; '),
  };
}

function checkPreregisteredCases(cwd: string, manifest: ValidationManifest): ValidationCheck {
  const ids = manifest.preregistered_cases.map((entry) => entry.id);
  const owners = new Set(manifest.decisions.map((decision) => decision.id));
  const delivery = readFileSync(join(cwd, 'docs', 'design', 'spec-0.2', 'delivery.md'), 'utf8');
  const groups = [
    ['P', 10], ['L', 4], ['B', 6], ['C', 6], ['T', 4], ['U', 4], ['A', 3],
  ] as const;
  const expected = groups.flatMap(([prefix, count]) =>
    Array.from({length: count}, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`),
  );
  const undocumentedGroups = groups
    .map(([prefix, count]) => `${prefix}01–${prefix}${String(count).padStart(2, '0')}`)
    .filter((range) => !delivery.includes(range));
  const unmapped = manifest.preregistered_cases.filter((entry) => !owners.has(entry.decision));
  const active = manifest.preregistered_cases
    .filter((entry) => entry.implementation === 'validation-active')
    .map((entry) => entry.id)
    .sort();
  const expectedActive = [
    ...Array.from({length: 10}, (_, index) => `P${String(index + 1).padStart(2, '0')}`),
    ...Array.from({length: 4}, (_, index) => `L${String(index + 1).padStart(2, '0')}`),
    ...Array.from({length: 6}, (_, index) => `B${String(index + 1).padStart(2, '0')}`),
    ...Array.from({length: 6}, (_, index) => `C${String(index + 1).padStart(2, '0')}`),
    ...Array.from({length: 4}, (_, index) => `T${String(index + 1).padStart(2, '0')}`),
    ...Array.from({length: 4}, (_, index) => `U${String(index + 1).padStart(2, '0')}`),
    ...Array.from({length: 3}, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
  ].sort();
  const promotedCases = manifest.preregistered_cases.filter((entry) => /^(?:B|C|T|U|A)\d\d$/.test(entry.id));
  const missingTestRefs = promotedCases.filter((entry) => entry.implementation === 'validation-active' && !entry.test_ref).map((entry) => entry.id);
  const testRefs = promotedCases.map((entry) => entry.test_ref).filter((entry): entry is string => entry !== undefined);
  const duplicateTestRefs = testRefs.length - new Set(testRefs).size;
  const valid = stableJson([...ids].sort()) === stableJson([...expected].sort())
    && unique(ids)
    && undocumentedGroups.length === 0
    && unmapped.length === 0
    && stableJson(active) === stableJson(expectedActive)
    && missingTestRefs.length === 0
    && duplicateTestRefs === 0
    && manifest.preregistered_cases.filter((entry) => !expectedActive.includes(entry.id)).every((entry) => entry.implementation === 'pending');
  return {
    id: 'preregistered-case-ledger',
    status: valid ? 'pass' : 'fail',
    evidence: valid
      ? 'Validation-active fixture IDs: P01-P10, L01-L04, B01-B06, C01-C06, T01-T04, U01-U04, A01-A03. The 37 declared ledger rows are not complete runtime evidence: runtime pass count is not asserted here; F7 scenario contract fixtures and the F9d registered file-key issuer path are validation-active, while F8 graph cutover and host cycles remain pending and the F9 scheduler/cache runtime is deferred to 0.10.x.'
      : `count=${ids.length}; duplicates=${ids.length - new Set(ids).size}; active=${active.join(',')}; undocumented_groups=${undocumentedGroups.join(',') || 'none'}; unmapped=${unmapped.map((entry) => entry.id).join(',') || 'none'}; missing_test_refs=${missingTestRefs.join(',') || 'none'}; duplicate_test_refs=${duplicateTestRefs}`,
  };
}

function implementationCheck(manifest: ValidationManifest): ValidationCheck {
  const pending = manifest.decisions.filter((decision) => decision.implementation === 'pending').map((decision) => decision.id);
  return {
    id: 'target-runtime-implementation',
    status: pending.length === 0 ? 'pass' : 'implementation_pending',
    evidence: pending.length === 0 ? 'Every target decision has implementation evidence.' : `${pending.length} decisions remain target design only: ${pending.join(', ')}.`,
  };
}

/**
 * Compares every source-bearing historic-proof field while preserving the
 * scanner as an independent YAML reader rather than a compiler consumer.
 */
function migrationBindingParity(
  compilation: ReturnType<typeof compileSpecWorkspace>,
  migrationProofs: ReturnType<typeof scanIndependentCorpus>['migrationProofs'],
): boolean {
  const compilerBindings = [...(compilation.migrationProofs ?? [])];
  const scannerBindings = [...(migrationProofs ?? [])];
  return stableJson(compilerBindings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
    === stableJson(scannerBindings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

/** Validates the F7 scenario boundary without promoting F8-F9 mechanisms. */
function checkCompilerRegistry(root: string, manifest: ValidationManifest): ValidationCheck {
  const active = manifest.decisions.filter((decision) => decision.implementation === 'validation-active').map((decision) => decision.id).sort();
  const expectedActive = ['D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13', 'D14', 'D17', 'D20', 'D21', 'D22', 'D23', 'D24'];
  if (stableJson(active) !== stableJson(expectedActive)) {
    return {id: 'compiler-registry-boundary', status: 'fail', evidence: `F7 requires validation-active decisions ${expectedActive.join(', ')}; found ${active.join(', ')}.`};
  }
  const otherTransitions = manifest.decisions
    .filter((decision) => !expectedActive.includes(decision.id) && decision.implementation !== 'pending')
    .map((decision) => decision.id);
  if (otherTransitions.length > 0) {
    return {id: 'compiler-registry-boundary', status: 'fail', evidence: `Only ${expectedActive.join(', ')} may be validation-active at the F7 boundary; found ${otherTransitions.join(', ')}.`};
  }
  try {
    const compilation = compileSpecWorkspace(root);
    const snapshot = scanIndependentCorpus(root);
    const parity = stableJson(compilerCorpusView(compilation)) === stableJson(snapshot.records);
    const project = resolveManagedWrite({path: 'spec.yaml', region: 'project', operation: 'update'}).id === 'spec-project-region';
    const inventory = resolveManagedWrite({path: 'spec.yaml', region: 'inventory', operation: 'update'}).id === 'spec-inventory-region';
    const receipt = resolveManagedWrite({
      path: 'spec/evidence/F-182eaa53/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.yaml',
      operation: 'create',
    }).id === 'evidence-receipt';
    const migrationProofs = snapshot.migrationProofs ?? [];
    const unresolved = compilation.schemaVersion === '0.1'
      ? compilation.edges.some((edge) => edge.raw === 'self-dogfood:stage:commit-postcommit' && edge.state === 'unresolved')
      : migrationProofs.some((proof) => proof.raw === 'self-dogfood:stage:commit-postcommit' && proof.resolution === 'unresolved');
    const parser = parseStrictStatement('The system shall preserve a strict statement.').status === 'valid';
    const schemaBoundaryValid = compilation.schemaVersion === '0.1'
      ? (() => {
        const preview = previewSchema02Migration(root);
        return preview.mode === 'preview'
          && preview.project.assuranceLevel === 'L2'
          && preview.project.scenarioPolicy === 'advisory'
          && preview.capabilityEdgeProof.equal;
      })()
      : compilation.schemaVersion === '0.2'
        && compilation.migrationBaseline !== undefined
        && migrationProofs.length > 0
        && migrationBindingParity(compilation, snapshot.migrationProofs)
        && migrationProofs.every((proof) => proof.source.path === 'spec/generated/migration-baseline-0.1-to-0.2.yaml'
          && proof.source.yamlPath.endsWith('.raw'));
    const valid = parity && project && inventory && receipt && unresolved && parser && schemaBoundaryValid
      && compilation.edges.every((edge) => edge.provenance !== 'observed');
    return {
      id: 'compiler-registry-boundary',
      status: valid ? 'pass' : 'fail',
      evidence: valid
        ? `D05-D14 compiler/proof/attestation inputs, the D09 scenario policy and closure slice, the D17 GraphIR v2 cutover, D20 portable receipt mechanics, and the D21-D23 assurance kernel/profile/verdict slice cover ${snapshot.records.semanticOwners.length} semantic owners, ${snapshot.derived.proofOccurrences} live authored proof records, and ${migrationProofs.length} source-located migration bindings. F8 public GraphIR cutover and the F9d registered file-key issuer path are validation-active; host cycles remain pending or not run and the F9 scheduler/cache runtime is deferred to 0.10.x.`
        : 'D05-D14 compiler/proof/attestation inputs, the D09 scenario policy, the D17 closure slice, D20 portable receipt mechanics, D21-D23 profiles, region ownership, or authored-only provenance failed.',
    };
  } catch (error) {
    return {id: 'compiler-registry-boundary', status: 'fail', evidence: error instanceof Error ? error.message : String(error)};
  }
}

function checkJourneyLedger(root: string, manifest: ValidationManifest): ValidationCheck {
  const expected = Array.from({length: 13}, (_, index) => `J${String(index + 1).padStart(2, '0')}`);
  const ids = manifest.integration_journeys.map((journey) => journey.id);
  const decisions = new Set(manifest.decisions.map((decision) => decision.id));
  const invalid = manifest.integration_journeys.filter((journey) =>
    journey.decisions.length === 0 || journey.decisions.some((decision) => !decisions.has(decision)),
  );
  // A validation-active journey claims a RUNNING test, so the reference must resolve: the
  // named file has to exist and has to carry the named title. An unresolvable reference is a
  // promoted status with nothing behind it, which is exactly the state this ledger forbids.
  const active = manifest.integration_journeys.filter((journey) => journey.status === 'validation-active');
  const unresolved = active.filter((journey) => {
    const reference = journey.test_ref;
    if (reference === undefined) return true;
    const separator = reference.indexOf('#');
    if (separator <= 0 || separator === reference.length - 1) return true;
    const path = join(root, reference.slice(0, separator));
    return !existsSync(path) || !readFileSync(path, 'utf8').includes(reference.slice(separator + 1));
  });
  const valid = stableJson(ids) === stableJson(expected) && unique(ids) && invalid.length === 0 && unresolved.length === 0;
  return {
    id: 'integration-journey-ledger',
    status: valid ? 'pass' : 'fail',
    evidence: valid
      ? `J01-J13 map model simulations, ${active.length} validation-active journey(s) with resolvable test references (${active.map((journey) => journey.id).join(', ') || 'none'}), pending implementation journeys, and the unrun reference-host cycle without collapsing their states.`
      : `journey_ids=${ids.join(',')}; invalid=${invalid.map((journey) => journey.id).join(',') || 'none'}; unresolved_test_ref=${unresolved.map((journey) => journey.id).join(',') || 'none'}`,
  };
}

function checkMcpScenarioLedger(root: string, manifest: ValidationManifest): ValidationCheck {
  const scenarioIds = manifest.mcp_scenarios.map((scenario) => scenario.id.split('-', 1)[0]);
  const expectedScenarios = Array.from({length: 12}, (_, index) => `MCP${String(index + 1).padStart(2, '0')}`);
  const taskIds = manifest.host_ab_tasks.map((task) => task.id);
  const expectedTasks = Array.from({length: 12}, (_, index) => `AB${String(index + 1).padStart(2, '0')}`);
  const taskProfiles = new Set(Object.keys(TASK_PROFILE_TOOLS));
  const invalidProfiles = manifest.host_ab_tasks.filter((task) => !taskProfiles.has(task.profile));
  const referenceHosts = stableJson(manifest.mcp_reference_hosts) === stableJson(['codex', 'claude-code']);
  const codexOnlyAb = manifest.host_ab.host === 'codex'
    && manifest.host_ab.max_calls === 24
    && manifest.host_ab.blocking === false;
  const mcp04Artifacts = [
    'src/proof/ingest.ts', 'src/cli/ingest-receipt.ts', 'src/serve/server.ts',
    'tests/cli/ingest-receipt.test.ts', 'tests/serve/proof-evidence.test.ts',
  ];
  const mcp04Evidence = mcp04Artifacts.every((path) => existsSync(join(root, path)))
    && readFileSync(join(root, 'tests/serve/proof-evidence.test.ts'), 'utf8').includes('MCP04/MCP09')
    && readFileSync(join(root, 'tests/cli/ingest-receipt.test.ts'), 'utf8').includes('same kernel');
  const valid = stableJson(scenarioIds) === stableJson(expectedScenarios)
    && unique(manifest.mcp_scenarios.map((scenario) => scenario.id))
    && stableJson(taskIds) === stableJson(expectedTasks)
    && unique(taskIds)
    && invalidProfiles.length === 0
    && referenceHosts
    && codexOnlyAb
    && stableJson(manifest.mcp_scenarios.filter((scenario) => scenario.implementation === 'validation-active').map((scenario) => scenario.id))
      === stableJson([
        'MCP04-cli-and-kernel-semantic-parity',
        'MCP08-graph-context-and-catalog-budgets',
        'MCP09-receipt-and-blindness-boundary',
      ])
    && manifest.mcp_scenarios.find((scenario) => scenario.id.startsWith('MCP04-'))?.slice === 'f5-receipt-operation'
    && manifest.mcp_scenarios.find((scenario) => scenario.id.startsWith('MCP08-'))?.slice === 'graph-v2-focused-projection-and-statistics'
    && manifest.mcp_scenarios.find((scenario) => scenario.id.startsWith('MCP09-'))?.slice === 'f5-receipt-ingestion-and-asserted-fallback'
    && mcp04Evidence;
  return {
    id: 'mcp-scenario-ledger',
    status: valid ? 'pass' : 'fail',
    evidence: valid
      ? 'MCP04 receipt-operation parity and MCP09 receipt ingestion/asserted fallback are F5 validation-active, and MCP08 is validation-active for the F8 graph-v2 focused-projection and statistics slice; the F9d registered file-key issuer path is validation-active, while MCP11 stays pending, the F9 scheduler/cache runtime is deferred to 0.10.x, and the non-blocking Codex A/B caps at 24 calls.'
      : `mcp=${scenarioIds.join(',')}; mcp04_artifacts=${mcp04Evidence}; ab=${taskIds.join(',')}; hosts=${manifest.mcp_reference_hosts.join(',')}; ab_policy=${JSON.stringify(manifest.host_ab)}; invalid_profiles=${invalidProfiles.map((task) => task.id).join(',') || 'none'}`,
  };
}

function simulateWhyAndIdentity(): ValidationCheck {
  const featureA = {id: 'F-a', purpose: 'Protect account access.', criteria: [{id: 'AC-001', statement: 'The system shall reject an expired token.'}]};
  const featureB = {id: 'F-b', purpose: 'Explain account access.', criteria: [{id: 'AC-001', statement: 'The system shall record a rejection reason.'}]};
  const addresses = [featureA, featureB].flatMap((feature) =>
    feature.criteria.map((criterion) => `${feature.id}/${criterion.id}`),
  );
  const bareIds = [featureA, featureB].flatMap((feature) => feature.criteria.map((criterion) => criterion.id));
  const whyLadder = [
    'Keep customer accounts safe.',
    'A customer signs in with an expiring token.',
    featureA.purpose,
    featureA.criteria[0].statement,
  ];
  const valid = whyLadder.every((value) => value.length > 0)
    && new Set(addresses).size === 2
    && new Set(bareIds).size === 1;
  return {
    id: 'model-why-identity',
    status: valid ? 'pass' : 'fail',
    evidence: 'J01/J02 model: the WHY ladder is explicit and composite F-id/AC-id remains unique where bare AC-001 collides.',
  };
}

function simulateMergeAndTransaction(): ValidationCheck {
  const legacyWrites = [new Set(['spec/capabilities.yaml']), new Set(['spec/capabilities.yaml'])];
  const featureWrites = [new Set(['spec/features/F-a.yaml']), new Set(['spec/features/F-b.yaml'])];
  const overlaps = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
    [...left].some((path) => right.has(path));
  const valid = overlaps(legacyWrites[0], legacyWrites[1])
    && !overlaps(featureWrites[0], featureWrites[1])
    && overlaps(featureWrites[0], new Set(['spec/features/F-a.yaml']));
  return {
    id: 'model-merge-transaction',
    status: valid ? 'pass' : 'fail',
    evidence: 'J03 model: feature-owned edges permit disjoint-shard writes while the same write set still conflicts; T01-T04 and J07 cover journal recovery at the F4 boundary.',
  };
}

function simulateProofAndTopology(): ValidationCheck {
  type Observation = 'pass' | 'fail' | 'skipped' | 'absent';
  const reduce = (observations: readonly Observation[]): 'verified' | 'failed' | 'unverified' => {
    if (observations.includes('fail')) return 'failed';
    if (observations.includes('pass')) return 'verified';
    return 'unverified';
  };
  const receipts = [
    {subject: 'F-a/AC-001', provenance: 'test', observations: ['pass'] as const},
    {subject: 'F-a', provenance: 'human-signed', observations: ['pass'] as const},
  ];
  const topologyVerdicts = ['persona-chain', 'single-generalist', 'host-parallel'].map(() =>
    receipts.map((receipt) => reduce(receipt.observations)).join(','),
  );
  const valid = reduce(['pass']) === 'verified'
    && reduce(['pass', 'fail']) === 'failed'
    && reduce(['skipped']) === 'unverified'
    && new Set(topologyVerdicts).size === 1;
  return {
    id: 'model-proof-topology',
    status: valid ? 'pass' : 'fail',
    evidence: 'J08/J11 model: current observation and provenance determine proof; persona topology does not change the reducer.',
  };
}

function simulateGraphProjection(): {check: ValidationCheck; measurements: readonly UsageMeasurement[]} {
  const nodes = {
    project: {id: 'project', purpose: 'Protect accounts.'},
    featureA: {id: 'F-a', purpose: 'Reject expired tokens.'},
    criterionA: {id: 'F-a/AC-001', statement: 'The system shall reject an expired token.'},
    shared: {id: 'src/token.ts', roles: ['source']},
    testA: {id: 'tests/token.test.ts', roles: ['test']},
    featureB: {id: 'F-b', purpose: 'Record token metrics.'},
    criterionB: {id: 'F-b/AC-001', statement: 'The system shall record expiry metrics.'},
    testB: {id: 'tests/metrics.test.ts', roles: ['test']},
  } as const;
  const directed = stableJson([
    nodes.project, nodes.featureA, nodes.criterionA, nodes.shared, nodes.testA,
  ]);
  const undirected = stableJson(Object.values(nodes));
  const required = ['project', 'F-a', 'F-a/AC-001', 'src/token.ts', 'tests/token.test.ts'];
  const valid = required.every((id) => directed.includes(`\"id\": \"${id}\"`))
    && !directed.includes('F-b/AC-001')
    && Buffer.byteLength(directed, 'utf8') < Buffer.byteLength(undirected, 'utf8');
  return {
    check: {
      id: 'model-graph-projection',
      status: valid ? 'pass' : 'fail',
      evidence: 'J10 model: direction-aware task projection retains every required contract/proof node and excludes a sibling reached only through a shared artifact.',
    },
    measurements: [
      measureUsage('model-graph-directed-task', directed),
      measureUsage('model-graph-undirected-depth', undirected, {
        comparator: {label: 'model-graph-directed-task', value: directed, equivalentOutput: true},
      }),
    ],
  };
}

function simulateScenarioFreshness(): ValidationCheck {
  const feature = {
    id: 'F-a',
    purpose: 'Complete checkout safely.',
    criteria: [
      {id: 'AC-a', statement: 'The system shall charge once.'},
      {id: 'AC-b', statement: 'The system shall issue a receipt.'},
    ],
  };
  const scenario = {
    id: 'S-checkout',
    feature_refs: ['F-a'],
    actor: 'buyer',
    goal: 'place an order',
    success: 'the order is confirmed',
    steps: ['pay', 'confirm'],
  };
  const subject = (
    criterion: (typeof feature.criteria)[number],
    policy: 'off' | 'advisory' | 'required',
    scenarios: readonly (typeof scenario)[],
  ): string => stableJson({
    purpose: feature.purpose,
    criterion,
    scenarios: policy === 'required' ? scenarios
      .filter((entry) => entry.feature_refs.includes(feature.id))
      .map(({id, actor, goal, success, steps}) => ({id, actor, goal, success, steps}))
      .sort((left, right) => left.id.localeCompare(right.id)) : [],
  });
  const before = feature.criteria.map((criterion) => subject(criterion, 'required', [scenario]));
  const changedScenario = {...scenario, steps: [...scenario.steps, 'email']};
  const afterRequired = feature.criteria.map((criterion) => subject(criterion, 'required', [changedScenario]));
  const advisoryBefore = feature.criteria.map((criterion) => subject(criterion, 'advisory', [scenario]));
  const advisoryAfter = feature.criteria.map((criterion) => subject(criterion, 'advisory', [changedScenario]));
  const unrelated = {...changedScenario, id: 'S-other', feature_refs: ['F-b']};
  const targetBefore = subject(feature.criteria[0], 'required', [scenario]);
  const targetAfterUnrelated = subject(feature.criteria[0], 'required', [scenario, unrelated]);
  const valid = before.every((value, index) => value !== afterRequired[index])
    && stableJson(advisoryBefore) === stableJson(advisoryAfter)
    && targetBefore === targetAfterUnrelated;
  return {
    id: 'model-scenario-freshness',
    status: valid ? 'pass' : 'fail',
    evidence: 'J05 model: required scenario intent stales every criterion in its referenced feature; advisory and unrelated scenarios do not.',
  };
}

function simulateAssuranceCadence(): ValidationCheck {
  const obligations = [
    {id: 'type', cost: 1, state: 'pass'},
    {id: 'integration', cost: 4, state: 'pass'},
    {id: 'uat', cost: 7, state: 'pass'},
  ] as const;
  type State = 'pass' | 'fail' | 'unobserved' | 'na';
  type PolicyRecord = {source: 'hard' | 'report'; blocking: 'hard' | 'report'; state: State};
  const standard = (records: readonly PolicyRecord[]): 'complete' | 'failed' | 'incomplete' => {
    if (records.some((record) => record.state === 'unobserved')) return 'incomplete';
    if (records.some((record) => record.source === 'hard' && record.state === 'fail')) return 'failed';
    return 'complete';
  };
  const cladding = (records: readonly PolicyRecord[]): 'GREEN' | 'RED' | 'unresolved' => {
    if (records.some((record) => record.state === 'unobserved')) return 'unresolved';
    if (records.some((record) => record.blocking === 'hard' && record.state === 'fail')) return 'RED';
    return 'GREEN';
  };
  const verdict = (records: readonly {state: string}[]): string =>
    records.some((record) => record.state !== 'pass') ? 'RED' : 'GREEN';
  const edits = 3;
  const fullCost = edits * obligations.reduce((sum, obligation) => sum + obligation.cost, 0);
  const tieredCost = edits * obligations[0].cost
    + obligations.reduce((sum, obligation) => sum + obligation.cost, 0);
  const variants = [verdict(obligations), verdict(obligations), verdict(obligations)];
  const reportFailure: PolicyRecord[] = [
    {source: 'hard', blocking: 'hard', state: 'pass'},
    {source: 'report', blocking: 'hard', state: 'fail'},
  ];
  const reportMissing: PolicyRecord[] = [
    {source: 'hard', blocking: 'hard', state: 'pass'},
    {source: 'report', blocking: 'hard', state: 'unobserved'},
  ];
  const hardFailure: PolicyRecord[] = [
    {source: 'hard', blocking: 'hard', state: 'fail'},
    {source: 'report', blocking: 'hard', state: 'pass'},
  ];
  const valid = new Set(variants).size === 1
    && variants[0] === 'GREEN'
    && tieredCost < fullCost
    && standard(reportFailure) === 'complete'
    && cladding(reportFailure) === 'RED'
    && standard(reportMissing) === 'incomplete'
    && cladding(reportMissing) === 'unresolved'
    && standard(hardFailure) === 'failed'
    && cladding(hardFailure) === 'RED';
  return {
    id: 'model-assurance-cadence',
    status: valid ? 'pass' : 'fail',
    evidence: `J12 model: cadence variants stay GREEN and active-cost units fall ${fullCost}→${tieredCost}; report fail is standard-complete/Cladding-RED, report absence unresolved, and hard fail RED.`,
  };
}

async function inspectMcp(cwd: string): Promise<CatalogSnapshot> {
  const server = buildServer({cwd, name: 'cladding-spec-02-validator', version: '0.0.0-validation'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'cladding-spec-02-validator', version: '0.0.0-validation'});
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const [toolResult, resourceResult, promptResult] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listPrompts(),
    ]);
    return {
      tools: toolResult.tools as unknown as readonly Record<string, unknown>[],
      resources: resourceResult.resources as unknown as readonly Record<string, unknown>[],
      prompts: promptResult.prompts as unknown as readonly Record<string, unknown>[],
      capabilities: (client.getServerCapabilities() ?? {}) as Record<string, unknown>,
    };
  } finally {
    await client.close();
    await server.close();
    clearAuditObserversForTesting();
  }
}

/**
 * Summarizes optional local host evidence without manufacturing a missing run.
 *
 * @param cwd Workspace whose local audit directory may contain host smoke data.
 * @returns The latest local host summary, or null when no run was recorded.
 */
export function summarizeHostSmoke(cwd: string): HostSmokeSummary | null {
  const auditDir = join(cwd, '.cladding', 'audit');
  let names: string[];
  try {
    names = readdirSync(auditDir)
      .filter((name) => /^host-smoke-.*\.json$/.test(name))
      .sort();
  } catch {
    return null;
  }
  const latest = names.at(-1);
  if (latest === undefined) return null;
  const parsed = JSON.parse(readFileSync(join(auditDir, latest), 'utf8')) as {
    hosts?: Record<string, {grade?: string; surfaces?: readonly {evidence?: string}[]}>;
  };
  const hosts = parsed.hosts ?? {};
  const tokens: Record<string, number[]> = {};
  for (const [host, record] of Object.entries(hosts)) {
    const found = (record.surfaces ?? []).flatMap((surface) =>
      [...(surface.evidence ?? '').matchAll(/tokens used ([\d,]+)/g)]
        .map((match) => Number.parseInt(match[1].replaceAll(',', ''), 10)),
    );
    if (found.length > 0) tokens[host] = found;
  }
  return {
    file: join('.cladding', 'audit', latest),
    hosts_verified: Object.entries(hosts).filter(([, record]) => record.grade === 'verified').map(([host]) => host).sort(),
    hosts_failed: Object.entries(hosts).filter(([, record]) => record.grade === 'fail').map(([host]) => host).sort(),
    provider_reported_tokens: tokens,
    scope: 'legacy-read-surface',
  };
}

function catalogCheck(snapshot: CatalogSnapshot): ValidationCheck {
  const toolNames = snapshot.tools.map((tool) => String(tool.name)).sort();
  const resourceUris = snapshot.resources.map((resource) => String(resource.uri)).sort();
  const promptNames = snapshot.prompts.map((prompt) => String(prompt.name)).sort();
  const expectedPrompts = [...PERSONA_IDS, ...Object.keys(PERSONA_PROMPT_ALIASES)].sort();
  const valid = stableJson(toolNames) === stableJson([...TOOL_NAMES].sort())
    && stableJson(resourceUris) === stableJson(Object.values(RESOURCE_URIS).sort())
    && stableJson(promptNames) === stableJson(expectedPrompts);
  return {
    id: 'mcp-wire-catalog',
    status: valid ? 'pass' : 'fail',
    evidence: valid
      ? `${toolNames.length} tools, ${resourceUris.length} resources, and ${promptNames.length} prompts match the declared wire surface.`
      : 'The live in-memory MCP catalog differs from exported identifiers.',
  };
}

function taskProfileCatalogs(snapshot: CatalogSnapshot): Readonly<Record<string, readonly Record<string, unknown>[]>> {
  return Object.fromEntries(Object.entries(TASK_PROFILE_TOOLS).map(([profile, names]) => {
    const allowed = new Set<string>(names);
    return [profile, snapshot.tools.filter((tool) => allowed.has(String(tool.name)))];
  }));
}

/** Builds the V0 report. Passing validation infrastructure never proves pending product behavior. */
export async function validateSpec02(cwd = process.cwd()): Promise<ValidationReport> {
  const root = resolve(cwd);
  const manifest = loadValidationManifest(root);
  const snapshot = await inspectMcp(root);
  const fullCatalog = stableJson({tools: snapshot.tools, resources: snapshot.resources, prompts: snapshot.prompts});
  const profiles = taskProfileCatalogs(snapshot);
  const profileMeasurements = Object.entries(profiles).map(([profile, tools]) =>
    measureUsage(`mcp-task-profile:${profile}`, stableJson({tools})),
  );
  const largestProfileBytes = Math.max(...profileMeasurements.map((measurement) => measurement.utf8_bytes));
  const fullCatalogBytes = Buffer.byteLength(fullCatalog, 'utf8');
  const reductionRatio = fullCatalogBytes === 0 ? 0 : Number((1 - largestProfileBytes / fullCatalogBytes).toFixed(3));
  const classified = new Set(Object.values(TASK_PROFILE_TOOLS).flat());
  const adoption = summarizeAdoption(readEventsIncludingRolled(root));
  const graphSimulation = simulateGraphProjection();
  const ownerPaths = [...new Set(manifest.decisions.map((decision) => decision.owner))].sort();
  const router = readFileSync(join(root, 'docs', 'design', 'spec-0.2.md'), 'utf8');
  const ownerBody = ownerPaths.map((path) => readFileSync(join(root, path), 'utf8')).join('');
  const measurements: UsageMeasurement[] = [
    measureUsage('design-router', router),
    measureUsage('design-owner-set', ownerBody),
    measureUsage('mcp-full-catalog', fullCatalog),
    ...profileMeasurements,
    ...graphSimulation.measurements,
  ];
  const checks: ValidationCheck[] = [
    checkDecisionOwnership(root, manifest),
    checkDocumentationRatchets(root),
    checkPreregisteredCases(root, manifest),
    checkJourneyLedger(root, manifest),
    checkMcpScenarioLedger(root, manifest),
    checkCompilerRegistry(root, manifest),
    simulateWhyAndIdentity(),
    simulateMergeAndTransaction(),
    simulateProofAndTopology(),
    graphSimulation.check,
    simulateScenarioFreshness(),
    simulateAssuranceCadence(),
    {
      id: 'integration-journey-runtime',
      status: 'implementation_pending',
      evidence: `Runtime-dependent journeys remain pending: ${manifest.integration_journeys.filter((journey) => journey.status === 'implementation_pending').map((journey) => journey.id).join(', ')}.`,
    },
    {
      id: 'integration-journey-reference-host',
      status: 'not_run',
      evidence: 'J13 requires the implemented Spec 0.2 runtime plus real Codex and Claude Code reference-host cycles; legacy read-surface smoke is not substituted.',
    },
    implementationCheck(manifest),
    catalogCheck(snapshot),
    {
      id: 'mcp-tools-list-changed-capability',
      status: snapshot.capabilities.tools !== undefined
        && (snapshot.capabilities.tools as {listChanged?: boolean}).listChanged === true ? 'pass' : 'fail',
      evidence: 'The negotiated MCP capability must advertise dynamic tool-list changes for bootstrap-to-project registration.',
    },
    {
      id: 'mcp-task-profile-challenger',
      status: classified.size === TOOL_NAMES.length && reductionRatio >= 0.2 ? 'inconclusive' : 'fail',
      evidence: classified.size !== TOOL_NAMES.length
        ? `${TOOL_NAMES.length - classified.size} tools are unclassified.`
        : `Largest proposed task-scoped catalog is ${(reductionRatio * 100).toFixed(1)}% smaller by controlled bytes; discoverability and host behavior are not yet proven.`,
    },
    {
      id: 'mcp-reference-host-spec-02-e2e',
      status: 'not_run',
      evidence: 'Existing host smoke covers the legacy read surface, not the required Codex and Claude Code full Spec 0.2 edit→verify→L4 cycles.',
    },
    {
      id: 'mcp-adoption',
      status: adoption.verdict === 'confirmed' ? 'pass' : 'inconclusive',
      evidence: `Existing pull telemetry verdict is ${adoption.verdict}; delivery or successful smoke calls cannot substitute for voluntary adoption.`,
    },
    {
      id: 'live-host-token-ab',
      status: 'not_run',
      evidence: 'No Codex-controlled 12-task × 2-arm run was supplied; deterministic catalog bytes remain a cost input, not an LLM-efficiency result.',
    },
  ];
  return stableValue({
    schema: 1,
    target: 'spec-0.2',
    checks,
    measurements,
    mcp: {
      tool_count: snapshot.tools.length,
      resource_count: snapshot.resources.length,
      prompt_count: snapshot.prompts.length,
      tools_list_changed: snapshot.capabilities.tools !== undefined
        && (snapshot.capabilities.tools as {listChanged?: boolean}).listChanged === true,
      classified_tools: classified.size,
      full_catalog_bytes: fullCatalogBytes,
      largest_task_profile_bytes: largestProfileBytes,
      task_profile_reduction_ratio: reductionRatio,
      adoption_verdict: adoption.verdict,
      reference_host_spec_02_e2e: 'not_run',
      host_smoke: summarizeHostSmoke(root),
    },
  }) as ValidationReport;
}

/** Human report keeps proof states visible instead of collapsing them into one score. */
export function renderValidationReport(report: ValidationReport): string {
  const lines = ['Spec 0.2 design validation', ''];
  for (const check of report.checks) {
    lines.push(`${check.status.padEnd(22)} ${check.id}: ${check.evidence}`);
  }
  lines.push('', 'Controlled context measurements');
  for (const measurement of report.measurements) {
    lines.push(`${measurement.label}: ${measurement.utf8_bytes} bytes, ~${measurement.estimated_tokens} tokens (${measurement.token_estimator}, cache=${measurement.cache})`);
  }
  lines.push('', `MCP: ${report.mcp.tool_count} tools; catalog ${report.mcp.full_catalog_bytes} bytes; largest task projection ${report.mcp.largest_task_profile_bytes} bytes.`);
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const report = await validateSpec02();
  process.stdout.write(process.argv.includes('--json') ? stableJson(report) : renderValidationReport(report));
  if (report.checks.some((check) => check.status === 'fail')) process.exitCode = 1;
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
