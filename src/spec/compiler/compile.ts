// Cladding · Spec 0.2 F1 · additive schema 0.1 compiler and GraphIR skeleton.

import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

import {LineCounter, parseDocument} from 'yaml';

import {resolveArtifactDescriptors} from './artifact-registry.js';
import {withStableSpecWorkspaceSnapshot} from '../transaction.js';
import {prospectiveCompilationOverlay} from '../prospective.js';
import {legacyExemptionMatches, validateMigrationBaseline, type MigrationBaseline} from './migration-baseline.js';
import {
  validateSchema02Architecture,
  validateSchema02CapabilityCatalog,
  validateSchema02FeatureContractWithBaseline,
  validateSchema02ProjectWithBaseline,
  validateSchema02ScenarioContract,
  type Schema02ValidationIssue,
} from './schema-02-contract.js';
import {analyzeAtomicityRisk, parseStrictStatement} from '../statement-parser.js';
import type {
  AnchorGraphNode,
  ArtifactGraphNode,
  ArtifactRole,
  CompilerCorpusView,
  CompilerDiagnostic,
  CompilerMigrationSource,
  CompilerSchemaVersion,
  CorpusProofRecord,
  GraphEdge,
  GraphNode,
  GraphSelector,
  LegacyReferenceChannel,
  SemanticGraphNode,
  SemanticOwnerRecord,
  Schema02ArchitectureRuleContract,
  Schema02ContractProjection,
  Schema02CriterionContract,
  Schema02FeatureContract,
  Schema02InventoryContract,
  Schema02ScenarioContract,
  SourceLocator,
  SourceRange,
  SpecCompilation,
} from './types.js';

interface ParsedYaml {
  readonly path: string;
  readonly document: ReturnType<typeof parseDocument>;
  readonly lineCounter: LineCounter;
  readonly value: unknown;
}

interface RawFeature {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly modules?: unknown;
  readonly depends_on?: unknown;
  readonly capability_refs?: unknown;
  readonly acceptance_criteria?: unknown;
}

interface RawCriterion {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly statement?: unknown;
  readonly rationale?: unknown;
  readonly constraint_refs?: unknown;
  readonly test_refs?: unknown;
  readonly oracle_refs?: unknown;
  readonly evidence_refs?: unknown;
}

interface RawScenario {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly features?: unknown;
  readonly feature_refs?: unknown;
}

interface MutableArtifact {
  readonly address: string;
  readonly roles: Set<ArtifactRole>;
  readonly owners: Set<string>;
  readonly source?: SourceLocator;
}

interface GraphBuild {
  readonly semanticNodes: Map<string, SemanticGraphNode>;
  readonly artifactNodes: Map<string, MutableArtifact>;
  readonly anchorNodes: Map<string, AnchorGraphNode>;
  readonly edges: GraphEdge[];
  readonly diagnostics: CompilerDiagnostic[];
}

interface NormalizedReference {
  readonly target: string;
  readonly artifact: string;
  readonly selector: GraphSelector;
  readonly resolution: 'resolved' | 'unresolved';
  /** Anchor metadata exists for an authored fragment or an exact registry/script key. */
  readonly anchor?: {readonly selector: string; readonly selectorProvenance: 'authored' | 'derived'};
}

type AuthoredSupportsEdge = GraphEdge & {
  readonly channel: LegacyReferenceChannel;
  readonly raw: string;
  readonly normalizedTarget: string;
  readonly selector: GraphSelector;
  readonly state: 'resolved' | 'unresolved';
};

/** Returns the canonical address for a semantic node. */
export function semanticAddress(
  kind: 'project' | 'capability' | 'feature' | 'criterion' | 'scenario' | 'architecture_rule',
  identifier?: string,
): string {
  if (kind === 'project') return 'project';
  if (!identifier) throw new Error(`${kind} address requires an identifier`);
  return `${kind}:${identifier}`;
}

/** Returns the canonical physical address for a repository-relative artifact. */
export function artifactAddress(path: string): string {
  return `artifact:${normalizeRepoPath(path)}`;
}

/** Returns the canonical physical address for an authored artifact selector. */
export function anchorAddress(path: string, selector: string): string {
  if (!selector) throw new Error('anchors require an authored selector');
  return `anchor:${normalizeRepoPath(path)}#${selector}`;
}

/**
 * Dispatches only on `spec.yaml#schema`.
 *
 * @throws Error for missing or unknown workspace versions before any shard merge occurs.
 */
export function dispatchSchemaVersion(value: unknown): CompilerSchemaVersion {
  if (value === '0.1' || value === '0.2') return value;
  throw new Error(`Spec compiler does not recognize workspace schema ${JSON.stringify(value)}`);
}

/**
 * Compiles schema 0.1 compatibility input or the additive F2/F3 schema 0.2 surface.
 *
 * The result does not feed the shipped loader, reverse index, graph v1,
 * detectors, reports, CLI graph command, or MCP graph surface during F1.
 *
 * @param cwd - Workspace root containing `spec.yaml`.
 * @returns Sorted structural graph facts retaining authored source locations.
 * @throws Error when the root version is unknown before any child artifact is read.
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 */
export function compileSpecWorkspace(cwd: string = '.'): SpecCompilation {
  const prospective = prospectiveCompilationOverlay(cwd);
  if (prospective) return prospective;
  return withStableSpecWorkspaceSnapshot(cwd, () => compileSpecWorkspaceFromStableSnapshot(cwd));
}

/**
 * Compiles while a caller already owns the exclusive F4 workspace lock.
 *
 * @param cwd - Workspace root.
 * @returns A compiler snapshot protected by the caller's exclusive lock.
 * @internal
 */
export function compileSpecWorkspaceWithLockHeld(cwd: string): SpecCompilation {
  const prospective = prospectiveCompilationOverlay(cwd);
  if (prospective) return prospective;
  return compileSpecWorkspaceFromStableSnapshot(cwd);
}

/**
 * Compiles directly from bytes guarded by either the exclusive F4 lock or a
 * verified stable snapshot. It deliberately does not acquire a lock itself.
 *
 * @param cwd - Workspace root containing one caller-guarded spec snapshot.
 * @returns Sorted compiler facts for the caller's stable workspace bytes.
 * @throws Error when the guarded workspace cannot be parsed or compiled.
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 * @internal
 */
export function compileSpecWorkspaceFromStableSnapshot(cwd: string): SpecCompilation {
  const root = resolve(cwd);
  const rootDocument = readYaml(root, 'spec.yaml');
  const rootValue = objectValue(rootDocument.value, 'spec.yaml must contain an object');
  const schemaVersion = dispatchSchemaVersion(rootValue.schema);
  if (schemaVersion === '0.1') return compileSchema01(root, rootDocument, rootValue);
  return compileSchema02(root, rootDocument, rootValue);
}

/**
 * Reads schema 0.1 migration inputs through the compiler's root-version boundary.
 *
 * This is intentionally narrower than the shipped loader: it preserves source
 * artifacts for a read-only proposal and never becomes a second runtime authority.
 *
 * @param cwd - Workspace root containing a schema 0.1 `spec.yaml`.
 * @returns Compiler-owned raw source necessary for migration preview.
 * @throws Error when the root schema is not schema 0.1.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function readSchema01MigrationSource(cwd: string = '.'): CompilerMigrationSource {
  const root = resolve(cwd);
  const master = readYaml(root, 'spec.yaml');
  const rootValue = objectValue(master.value, 'spec.yaml must contain an object');
  if (dispatchSchemaVersion(rootValue.schema) !== '0.1') {
    throw new Error('Schema migration preview currently accepts only schema 0.1 workspaces');
  }
  const optionalObject = (path: string): Readonly<Record<string, unknown>> | undefined => {
    if (!existsSync(join(root, path))) return undefined;
    return objectValueOrNull(readYaml(root, path).value) ?? undefined;
  };
  return {
    schemaVersion: '0.1',
    root: rootValue,
    features: childDocuments(root, master, rootValue.features, 'features').map((document) => ({path: document.path, value: document.value})),
    capabilities: Object.hasOwn(rootValue, 'capabilities') ? rootValue.capabilities : optionalObject('spec/capabilities.yaml'),
    architecture: Object.hasOwn(rootValue, 'architecture')
      ? objectValueOrNull(rootValue.architecture) ?? undefined
      : optionalObject('spec/architecture.yaml'),
    scenarios: childDocuments(root, master, rootValue.scenarios, 'scenarios').map((document) => ({path: document.path, value: document.value})),
  };
}

/** Projects a compilation into the sorted records compared with the independent scanner. */
export function compilerCorpusView(compilation: SpecCompilation): CompilerCorpusView {
  const semanticOwners: SemanticOwnerRecord[] = [];
  for (const node of compilation.nodes) {
    if (node.nodeType !== 'semantic') continue;
    semanticOwners.push({
      address: node.address,
      owner: node.kind === 'criterion' ? `feature:${node.address.slice('criterion:'.length).split('/')[0]}` : node.address,
      source: node.source,
    });
  }

  const prerequisites = compilation.edges
    .filter((edge) => edge.relation === 'depends_on' && edge.provenance === 'authored')
    .map((edge) => ({feature: edge.from, prerequisite: edge.to, source: edge.owner}));
  const dependents = prerequisites
    .map((record) => ({feature: record.prerequisite, dependent: record.feature, source: record.source}));
  const artifactOwners = compilation.nodes
    .filter((node): node is ArtifactGraphNode => node.nodeType === 'artifact' && node.owners.length > 0)
    .map((node) => ({artifact: node.address, owners: node.owners}));
  const proofs = compilation.edges
    .filter((edge): edge is AuthoredSupportsEdge =>
      edge.relation === 'supports'
      && edge.provenance === 'authored'
      && edge.channel !== undefined
      && edge.raw !== undefined
      && edge.normalizedTarget !== undefined
      && edge.selector !== undefined
      && (edge.state === 'resolved' || edge.state === 'unresolved'),
    )
    .map((edge): CorpusProofRecord => ({
      owner: edge.from,
      channel: edge.channel,
      raw: edge.raw,
      normalizedTarget: edge.normalizedTarget,
      selector: edge.selector,
      resolution: edge.state,
      source: edge.owner,
    }));
  const sortJson = <T>(records: readonly T[]): readonly T[] => [...records].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    semanticOwners: sortJson(semanticOwners),
    prerequisites: sortJson(prerequisites),
    dependents: sortJson(dependents),
    artifactOwners: sortJson(artifactOwners),
    proofs: sortJson(proofs),
    regressions: sortJson(proofs.filter((proof) => proof.channel === 'test')),
  };
}

function compileSchema01(root: string, master: ParsedYaml, rootValue: Record<string, unknown>): SpecCompilation {
  const graph: GraphBuild = {
    semanticNodes: new Map(), artifactNodes: new Map(), anchorNodes: new Map(), edges: [], diagnostics: [],
  };
  const project = rootValue.project;
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    graph.diagnostics.push({code: 'INVALID_ROOT', message: 'spec.yaml project must be an object', source: locator(master, ['project'])});
  } else {
    addSemantic(graph, {address: 'project', nodeType: 'semantic', kind: 'project', provenance: 'authored', source: locator(master, ['project'])});
  }
  ensureArtifact(graph, artifactAddress('spec.yaml'), ['spec'], [], locator(master, []));
  if (graph.semanticNodes.has('project')) {
    addEdge(graph, 'project', artifactAddress('spec.yaml'), 'defined_in', 'authored', locator(master, ['project']));
  }

  const featureDocuments = childDocuments(root, master, rootValue.features, 'features');
  for (const featureDocument of featureDocuments) compileFeature(graph, root, featureDocument);
  const scenarioDocuments = childDocuments(root, master, rootValue.scenarios, 'scenarios');
  for (const scenarioDocument of scenarioDocuments) compileScenario(graph, scenarioDocument);

  const nodes: GraphNode[] = [
    ...graph.semanticNodes.values(),
    ...[...graph.artifactNodes.values()].map((node): ArtifactGraphNode => ({
      address: node.address,
      nodeType: 'artifact',
      roles: [...node.roles].sort(),
      owners: [...node.owners].sort(),
      provenance: 'derived',
      ...(node.source ? {source: node.source} : {}),
    })),
    ...graph.anchorNodes.values(),
  ].sort((left, right) => left.address.localeCompare(right.address));
  return {
    schemaVersion: '0.1',
    nodes,
    edges: [...graph.edges].sort((left, right) => left.address.localeCompare(right.address)),
    diagnostics: [...graph.diagnostics].sort((left, right) => left.message.localeCompare(right.message)),
  };
}

/** Compiles the additive schema 0.2 project, catalog, feature, and architecture contracts. */
function compileSchema02(root: string, master: ParsedYaml, rootValue: Record<string, unknown>): SpecCompilation {
  const graph: GraphBuild = {
    semanticNodes: new Map(), artifactNodes: new Map(), anchorNodes: new Map(), edges: [], diagnostics: [],
  };
  const project = rootValue.project;
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    graph.diagnostics.push({code: 'INVALID_ROOT', severity: 'blocking', message: 'spec.yaml project must be an object', source: locator(master, ['project'])});
  } else {
    addSemantic(graph, {address: 'project', nodeType: 'semantic', kind: 'project', provenance: 'authored', source: locator(master, ['project'])});
  }
  ensureArtifact(graph, artifactAddress('spec.yaml'), ['spec'], [], locator(master, []));
  if (graph.semanticNodes.has('project')) {
    addEdge(graph, 'project', artifactAddress('spec.yaml'), 'defined_in', 'authored', locator(master, ['project']));
  }
  const baselineState = readMigrationBaseline(root);
  const baseline = baselineState.baseline;
  for (const message of baselineState.issues) {
    graph.diagnostics.push({code: 'INVALID_SCHEMA_02', severity: 'blocking', message: `Invalid migration baseline: ${message}`, source: locator(master, [])});
  }
  const projectRecord = objectValueOrNull(project);
  const projectBaselineIdentity = legacyExemptionMatches(baseline, 'project', projectRecord ?? undefined)
    && (projectRecord?.purpose === undefined || typeof projectRecord.purpose === 'string')
    ? baseline?.project.exemption?.id
    : undefined;
  const projectValidation = validateSchema02ProjectWithBaseline(project, projectBaselineIdentity);
  appendSchema02Issues(graph, master, projectValidation.issues);
  const inventory = Object.hasOwn(rootValue, 'inventory')
    ? validateSchema02Inventory(rootValue.inventory, graph, master)
    : undefined;
  for (const field of ['capabilities', 'architecture'] as const) {
    if (Object.hasOwn(rootValue, field)) {
      graph.diagnostics.push({
        code: 'LEGACY_FIELD', severity: 'blocking',
        message: `spec.yaml#${field} is not a schema 0.2 source; use spec/${field}.yaml`,
        source: locator(master, [field]),
      });
    }
  }

  const capabilityDocument = readSchema02Artifact(root, 'spec/capabilities.yaml');
  if (!capabilityDocument) {
    graph.diagnostics.push({
      code: 'INVALID_SCHEMA_02', severity: 'blocking',
      message: 'schema 0.2 requires the canonical capability catalog spec/capabilities.yaml', source: locator(master, []),
    });
  }
  const capabilityValidation = capabilityDocument ? validateSchema02CapabilityCatalog(capabilityDocument.value) : undefined;
  if (capabilityDocument && capabilityValidation) appendSchema02Issues(graph, capabilityDocument, capabilityValidation.issues);
  const capabilities = capabilityValidation?.value ?? [];
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  if (capabilityDocument) {
    const catalogAddress = artifactAddress(capabilityDocument.path);
    ensureArtifact(graph, catalogAddress, ['spec'], [], locator(capabilityDocument, []));
    for (const capability of capabilities) {
      const address = semanticAddress('capability', capability.id);
      const source = locator(capabilityDocument, ['capabilities', sourceRecordIndex(capabilityDocument.value, 'capabilities', capability.id), 'id']);
      addSemantic(graph, {address, nodeType: 'semantic', kind: 'capability', provenance: 'authored', source});
      addEdge(graph, address, catalogAddress, 'defined_in', 'authored', source);
    }
  }

  const architectureDocument = readSchema02Artifact(root, 'spec/architecture.yaml');
  if (!architectureDocument) {
    graph.diagnostics.push({
      code: 'INVALID_SCHEMA_02', severity: 'blocking',
      message: 'schema 0.2 requires the canonical architecture contract spec/architecture.yaml', source: locator(master, []),
    });
  }
  const architectureValidation = architectureDocument ? validateSchema02Architecture(architectureDocument.value) : undefined;
  if (architectureDocument && architectureValidation) appendSchema02Issues(graph, architectureDocument, architectureValidation.issues);
  const architecture = architectureValidation?.value;
  const architectureRules = new Map((architecture?.rules ?? []).map((rule) => [rule.id, rule]));
  if (architectureDocument) {
    const architectureAddress = artifactAddress(architectureDocument.path);
    ensureArtifact(graph, architectureAddress, ['spec'], [], locator(architectureDocument, []));
    for (const rule of architecture?.rules ?? []) {
      const address = semanticAddress('architecture_rule', rule.id);
      const source = locator(architectureDocument, ['rules', sourceRecordIndex(architectureDocument.value, 'rules', rule.id), 'id']);
      addSemantic(graph, {address, nodeType: 'semantic', kind: 'architecture_rule', provenance: 'authored', source});
      addEdge(graph, address, architectureAddress, 'defined_in', 'authored', source);
    }
  }

  const featureContracts: Schema02FeatureContract[] = [];
  let expectedFeatureContracts = 0;
  if (Array.isArray(rootValue.features) && rootValue.features.length > 0) {
    graph.diagnostics.push({
      code: 'INVALID_SCHEMA_02',
      severity: 'blocking',
      message: 'schema 0.2 requires feature shards under spec/features; inline root features are not accepted',
      source: locator(master, ['features']),
    });
  } else {
    const featureDocuments = childDocuments(root, master, undefined, 'features');
    expectedFeatureContracts = featureDocuments.length;
    for (const featureDocument of featureDocuments) {
      compileSchema02Feature(graph, featureDocument, capabilityIds, architectureRules, featureContracts, baseline);
    }
  }
  const scenarioContracts: Schema02ScenarioContract[] = [];
  const scenarioDocuments = childDocuments(root, master, undefined, 'scenarios');
  if (Array.isArray(rootValue.scenarios) && rootValue.scenarios.length > 0) {
    graph.diagnostics.push({
      code: 'INVALID_SCHEMA_02', severity: 'blocking',
      message: 'schema 0.2 requires scenario shards under spec/scenarios; inline root scenarios are not accepted',
      source: locator(master, ['scenarios']),
    });
  } else {
    compileSchema02Scenarios(
      graph,
      scenarioDocuments,
      new Set([...graph.semanticNodes.values()]
        .filter((node) => node.kind === 'feature')
        .map((node) => node.address.slice('feature:'.length))),
      scenarioContracts,
      projectValidation.value?.scenarioPolicy,
    );
  }
  const contract = projectValidation.value
    && capabilityValidation?.value
    && architecture
    && featureContracts.length === expectedFeatureContracts
    && !graph.diagnostics.some((diagnostic) => diagnostic.severity !== 'advisory')
    ? {
      project: projectValidation.value,
      capabilities,
      features: featureContracts.sort((left, right) => left.id.localeCompare(right.id)),
      scenarios: scenarioContracts.sort((left, right) => left.id.localeCompare(right.id)),
      architecture,
      ...(inventory === undefined ? {} : {inventory}),
    } satisfies Schema02ContractProjection
    : undefined;
  const migrationProofs = baseline && baselineState.document
    ? compilerMigrationProofView(root, baselineState.document, baseline)
    : undefined;
  return finishCompilation('0.2', graph, contract, baseline, migrationProofs);
}

/** Validates the optional root scale projection before it reaches legacy consumers. */
function validateSchema02Inventory(
  value: unknown,
  graph: GraphBuild,
  master: ParsedYaml,
): Schema02InventoryContract | undefined {
  const record = objectValueOrNull(value);
  const fields = ['features', 'scenarios', 'capabilities', 'test_files'] as const;
  if (!record || Object.keys(record).length !== fields.length || Object.keys(record).some((key) => !fields.includes(key as typeof fields[number]))) {
    graph.diagnostics.push({
      code: 'INVALID_SCHEMA_02', severity: 'blocking',
      message: 'spec.yaml inventory must contain exactly features, scenarios, capabilities, and test_files',
      source: locator(master, ['inventory']),
    });
    return undefined;
  }
  const counts = fields.map((field) => record[field]);
  if (counts.some((count) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) {
    graph.diagnostics.push({
      code: 'INVALID_SCHEMA_02', severity: 'blocking',
      message: 'spec.yaml inventory counts must be non-negative safe integers',
      source: locator(master, ['inventory']),
    });
    return undefined;
  }
  return {
    features: record.features as number,
    scenarios: record.scenarios as number,
    capabilities: record.capabilities as number,
    testFiles: record.test_files as number,
  };
}

/** Sorts a schema-specific graph build into the shared compiler result shape. */
function finishCompilation(
  schemaVersion: CompilerSchemaVersion,
  graph: GraphBuild,
  contract?: Schema02ContractProjection,
  migrationBaseline?: MigrationBaseline,
  migrationProofs?: readonly CorpusProofRecord[],
): SpecCompilation {
  const nodes: GraphNode[] = [
    ...graph.semanticNodes.values(),
    ...[...graph.artifactNodes.values()].map((node): ArtifactGraphNode => ({
      address: node.address,
      nodeType: 'artifact',
      roles: [...node.roles].sort(),
      owners: [...node.owners].sort(),
      provenance: 'derived',
      ...(node.source ? {source: node.source} : {}),
    })),
    ...graph.anchorNodes.values(),
  ].sort((left, right) => left.address.localeCompare(right.address));
  return {
    schemaVersion,
    nodes,
    edges: [...graph.edges].sort((left, right) => left.address.localeCompare(right.address)),
    diagnostics: [...graph.diagnostics].sort((left, right) => left.message.localeCompare(right.message)),
    ...(contract ? {contract} : {}),
    ...(migrationBaseline ? {migrationBaseline} : {}),
    ...(migrationProofs ? {migrationProofs} : {}),
  };
}

function childDocuments(root: string, master: ParsedYaml, inline: unknown, directory: 'features' | 'scenarios'): readonly ParsedYaml[] {
  if (Array.isArray(inline) && inline.length > 0) return [master];
  const path = join(root, 'spec', directory);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((name) => readYaml(root, join('spec', directory, name)));
}

/** Reads one mandatory schema 0.2 canonical artifact without accepting aliases. */
function readSchema02Artifact(root: string, path: 'spec/capabilities.yaml' | 'spec/architecture.yaml'): ParsedYaml | undefined {
  return existsSync(join(root, path)) ? readYaml(root, path) : undefined;
}

function readMigrationBaseline(root: string): {
  readonly baseline?: MigrationBaseline;
  readonly document?: ParsedYaml;
  readonly issues: readonly string[];
} {
  const path = join(root, 'spec/generated/migration-baseline-0.1-to-0.2.yaml');
  if (!existsSync(path)) return {issues: []};
  const document = readYaml(root, 'spec/generated/migration-baseline-0.1-to-0.2.yaml');
  const value = document.value;
  if (!objectValueOrNull(value)) return {issues: ['baseline must be an object']};
  try {
    const baseline = value as MigrationBaseline;
    const issues = validateMigrationBaseline(baseline);
    return issues.length === 0 ? {baseline, document, issues} : {issues};
  } catch {
    return {issues: ['baseline has an invalid structural shape']};
  }
}

/** Maps cohesive schema-0.2 validation results onto the compiler's source-bearing diagnostics. */
function appendSchema02Issues(
  graph: GraphBuild,
  parsed: ParsedYaml,
  issues: readonly Schema02ValidationIssue[],
): void {
  for (const schemaIssue of issues) {
    graph.diagnostics.push({
      code: schemaIssue.code,
      severity: 'blocking',
      message: schemaIssue.message,
      source: locator(parsed, schemaIssue.path),
    });
  }
}

/** Finds the authored array record rather than deriving a location from sorted IR order. */
function sourceRecordIndex(value: unknown, key: string, id: string): number {
  const records = arrayValue(objectValueOrNull(value)?.[key]);
  const index = records.findIndex((record) => objectValueOrNull(record)?.id === id);
  return index < 0 ? 0 : index;
}

function compileFeature(graph: GraphBuild, root: string, parsed: ParsedYaml): void {
  const value = objectValueOrNull(parsed.value);
  const sourcePrefix = parsed.path === 'spec.yaml' ? ['features'] : [];
  const records = parsed.path === 'spec.yaml' ? arrayValue(value?.features) : [value];
  records.forEach((record, index) => {
    const feature = objectValueOrNull(record) as RawFeature | null;
    const pathPrefix = parsed.path === 'spec.yaml' ? [...sourcePrefix, index] : [];
    if (!feature || typeof feature.id !== 'string' || typeof feature.title !== 'string' || typeof feature.status !== 'string') {
      graph.diagnostics.push({code: 'INVALID_FEATURE', message: `feature in ${parsed.path} lacks id, title, or status`, source: locator(parsed, pathPrefix)});
      return;
    }
    const featureAddress = semanticAddress('feature', feature.id);
    const featureSource = locator(parsed, [...pathPrefix, 'id']);
    addSemantic(graph, {address: featureAddress, nodeType: 'semantic', kind: 'feature', provenance: 'authored', source: featureSource});
    const shardAddress = artifactAddress(parsed.path);
    ensureArtifact(graph, shardAddress, ['spec'], [featureAddress], locator(parsed, pathPrefix));
    addEdge(graph, featureAddress, shardAddress, 'defined_in', 'authored', featureSource);
    for (const [dependencyIndex, dependency] of stringEntries(feature.depends_on).entries()) {
      addEdge(graph, featureAddress, semanticAddress('feature', dependency), 'depends_on', 'authored', locator(parsed, [...pathPrefix, 'depends_on', dependencyIndex]));
    }
    for (const [moduleIndex, modulePath] of stringEntries(feature.modules).entries()) {
      const moduleAddress = artifactAddress(modulePath);
      ensureArtifact(graph, moduleAddress, [roleForModule(modulePath)], [featureAddress], locator(parsed, [...pathPrefix, 'modules', moduleIndex]));
      addEdge(graph, featureAddress, moduleAddress, 'touches', 'authored', locator(parsed, [...pathPrefix, 'modules', moduleIndex]));
    }
    const criteria = arrayValue(feature.acceptance_criteria);
    criteria.forEach((criterionRecord, criterionIndex) => {
      const criterion = objectValueOrNull(criterionRecord) as RawCriterion | null;
      const criterionPrefix = [...pathPrefix, 'acceptance_criteria', criterionIndex];
      if (!criterion || typeof criterion.id !== 'string') {
        graph.diagnostics.push({code: 'INVALID_FEATURE', message: `${feature.id} has a criterion without an id`, source: locator(parsed, criterionPrefix)});
        return;
      }
      const criterionAddress = semanticAddress('criterion', `${feature.id}/${criterion.id}`);
      const criterionSource = locator(parsed, [...criterionPrefix, 'id']);
      addSemantic(graph, {address: criterionAddress, nodeType: 'semantic', kind: 'criterion', provenance: 'authored', source: criterionSource});
      addEdge(graph, featureAddress, criterionAddress, 'contains', 'authored', criterionSource);
      addEdge(graph, criterionAddress, shardAddress, 'defined_in', 'authored', criterionSource);
      compileLegacyReferences(graph, root, parsed, criterionPrefix, criterionAddress, 'test', criterion.test_refs);
      compileLegacyReferences(graph, root, parsed, criterionPrefix, criterionAddress, 'oracle', criterion.oracle_refs);
      compileLegacyReferences(graph, root, parsed, criterionPrefix, criterionAddress, 'evidence', criterion.evidence_refs);
    });
  });
}

/** Validates and materializes one schema 0.2 feature's F2 and F3 contract data. */
function compileSchema02Feature(
  graph: GraphBuild,
  parsed: ParsedYaml,
  capabilityIds: ReadonlySet<string>,
  architectureRules: ReadonlyMap<string, Schema02ArchitectureRuleContract>,
  featureContracts: Schema02FeatureContract[],
  baseline: MigrationBaseline | undefined,
): void {
  const feature = objectValueOrNull(parsed.value) as (RawFeature & {readonly purpose?: unknown; readonly slug?: unknown}) | null;
  if (!feature || typeof feature.id !== 'string' || typeof feature.title !== 'string' || typeof feature.status !== 'string') {
    graph.diagnostics.push({code: 'INVALID_FEATURE', severity: 'blocking', message: `feature in ${parsed.path} lacks id, title, or status`, source: locator(parsed, [])});
    return;
  }
  const featureBaselineIdentity = legacyExemptionMatches(baseline, `feature:${feature.id}`, feature)
    && (feature.purpose === undefined || typeof feature.purpose === 'string')
    ? baseline?.features.find((entry) => entry.address === `feature:${feature.id}`)?.exemption?.id
    : undefined;
  const criterionBaselineIdentities = new Map<string, string>();
  for (const rawCriterion of arrayValue(feature.acceptance_criteria)) {
    const criterion = objectValueOrNull(rawCriterion);
    const criterionId = criterion?.id;
    if (typeof criterionId !== 'string'
      || !legacyExemptionMatches(baseline, `criterion:${feature.id}/${criterionId}`, criterion ?? undefined)
      || !baseline) continue;
    const identity = baseline.criteria.find((entry) => entry.address === `criterion:${feature.id}/${criterionId}`)?.exemption.id;
    if (identity) criterionBaselineIdentities.set(criterionId, identity);
  }
  const featureValidation = validateSchema02FeatureContractWithBaseline(feature, {
    ...(featureBaselineIdentity ? {featureBaselineIdentity} : {}),
    ...(criterionBaselineIdentities.size > 0 ? {criterionBaselineIdentities} : {}),
  });
  appendSchema02Issues(graph, parsed, featureValidation.issues);
  if (featureValidation.value) featureContracts.push(featureValidation.value);
  const criterionContracts = new Map((featureValidation.value?.acceptanceCriteria ?? []).map((criterion) => [criterion.id, criterion]));
  const featureAddress = semanticAddress('feature', feature.id);
  const featureSource = locator(parsed, ['id']);
  addSemantic(graph, {address: featureAddress, nodeType: 'semantic', kind: 'feature', provenance: 'authored', source: featureSource});
  const shardAddress = artifactAddress(parsed.path);
  ensureArtifact(graph, shardAddress, ['spec'], [featureAddress], locator(parsed, []));
  addEdge(graph, featureAddress, shardAddress, 'defined_in', 'authored', featureSource);
  for (const [dependencyIndex, dependency] of stringEntries(feature.depends_on).entries()) {
    addEdge(graph, featureAddress, semanticAddress('feature', dependency), 'depends_on', 'authored', locator(parsed, ['depends_on', dependencyIndex]));
  }
  for (const [moduleIndex, modulePath] of stringEntries(feature.modules).entries()) {
    const moduleAddress = artifactAddress(modulePath);
    ensureArtifact(graph, moduleAddress, [roleForModule(modulePath)], [featureAddress], locator(parsed, ['modules', moduleIndex]));
    addEdge(graph, featureAddress, moduleAddress, 'touches', 'authored', locator(parsed, ['modules', moduleIndex]));
  }
  for (const [capabilityIndex, capabilityId] of stringEntries(feature.capability_refs).entries()) {
    const source = locator(parsed, ['capability_refs', capabilityIndex]);
    if (!capabilityIds.has(capabilityId)) {
      graph.diagnostics.push({
        code: 'UNKNOWN_REFERENCE', severity: 'blocking',
        message: `${feature.id} capability_refs contains unknown capability ${capabilityId}`,
        source,
      });
      continue;
    }
    addEdge(graph, featureAddress, semanticAddress('capability', capabilityId), 'contributes_to', 'authored', source);
  }
  for (const [criterionIndex, record] of arrayValue(feature.acceptance_criteria).entries()) {
    const criterion = objectValueOrNull(record) as RawCriterion | null;
    compileSchema02Criterion(
      graph, parsed, feature.id, featureAddress, shardAddress, criterionIndex,
      criterion,
      typeof criterion?.id === 'string' ? criterionContracts.get(criterion.id) : undefined,
      architectureRules,
      legacyExemptionMatches(baseline, `criterion:${feature.id}/${typeof criterion?.id === 'string' ? criterion.id : ''}`, criterion ?? undefined),
    );
  }
}

function compileSchema02Criterion(
  graph: GraphBuild,
  parsed: ParsedYaml,
  featureId: string,
  featureAddress: string,
  shardAddress: string,
  criterionIndex: number,
  criterion: RawCriterion | null,
  contractCriterion: Schema02CriterionContract | undefined,
  architectureRules: ReadonlyMap<string, Schema02ArchitectureRuleContract>,
  baselineExempt: boolean,
): void {
  const prefix: readonly (string | number)[] = ['acceptance_criteria', criterionIndex];
  if (!criterion || typeof criterion.id !== 'string') {
    graph.diagnostics.push({code: 'INVALID_FEATURE', severity: 'blocking', message: `${featureId} has a criterion without an id`, source: locator(parsed, prefix)});
    return;
  }
  if ((criterion.kind !== 'behavior' && criterion.kind !== 'quality' && criterion.kind !== 'constraint') && !baselineExempt) {
    graph.diagnostics.push({code: 'INVALID_SCHEMA_02', severity: 'blocking', message: `${featureId}/${criterion.id} requires kind behavior, quality, or constraint`, source: locator(parsed, [...prefix, 'kind'])});
  }
  const parsedStatement = parseStrictStatement(criterion.statement);
  if (parsedStatement.status === 'invalid' && !baselineExempt) {
    graph.diagnostics.push({
      code: 'INVALID_STATEMENT', severity: 'blocking',
      message: `${featureId}/${criterion.id} statement is invalid: ${parsedStatement.issues.map((issue) => issue.message).join(' ')}`,
      source: locator(parsed, [...prefix, 'statement']), details: parsedStatement.issues.map((issue) => issue.code),
    });
  } else if (parsedStatement.status !== 'invalid') {
    const analysis = analyzeAtomicityRisk(parsedStatement);
    if (analysis.signals.length > 0) {
      graph.diagnostics.push({
        code: 'ATOMICITY_RISK', severity: 'advisory',
        message: `${featureId}/${criterion.id} has advisory atomicity signals`,
        source: locator(parsed, [...prefix, 'statement']),
        details: analysis.signals.map((signal) => `${signal.code}:${signal.detail}`),
      });
    }
  }
  const address = semanticAddress('criterion', `${featureId}/${criterion.id}`);
  const source = locator(parsed, [...prefix, 'id']);
  addSemantic(graph, {address, nodeType: 'semantic', kind: 'criterion', provenance: 'authored', source});
  addEdge(graph, featureAddress, address, 'contains', 'authored', source);
  addEdge(graph, address, shardAddress, 'defined_in', 'authored', source);
  if (contractCriterion?.kind !== 'constraint') return;
  const refs = stringEntries(criterion.constraint_refs);
  for (const [referenceIndex, reference] of refs.entries()) {
    const referenceSource = locator(parsed, [...prefix, 'constraint_refs', referenceIndex]);
    const rule = architectureRules.get(reference);
    if (!rule) {
      graph.diagnostics.push({
        code: 'UNKNOWN_REFERENCE', severity: 'blocking',
        message: `${featureId}/${criterion.id} constraint_refs contains unknown architecture rule ${reference}`,
        source: referenceSource,
      });
      continue;
    }
    if (!rule.rationale.trim()) {
      graph.diagnostics.push({
        code: 'INVALID_SCHEMA_02', severity: 'blocking',
        message: `${featureId}/${criterion.id} constraint_refs must resolve to rules with non-empty rationales`,
        source: referenceSource,
      });
      continue;
    }
    addEdge(graph, address, semanticAddress('architecture_rule', reference), 'constrained_by', 'authored', referenceSource);
  }
}

/**
 * Compiles canonical schema 0.2 scenario shards without changing the schema
 * 0.1 scenario reader. Shape and reference integrity always block; coverage
 * policy affects only absent, missing-field, or correctly typed hollow journeys.
 */
function compileSchema02Scenarios(
  graph: GraphBuild,
  documents: readonly ParsedYaml[],
  featureIds: ReadonlySet<string>,
  scenarioContracts: Schema02ScenarioContract[],
  policy: 'off' | 'advisory' | 'required' | undefined,
): void {
  const scenarioIds = new Set<string>();
  let hollowCount = 0;
  for (const parsed of documents) {
    const rawScenario = objectValueOrNull(parsed.value) as RawScenario | null;
    const validation = validateSchema02ScenarioContract(parsed.value);
    appendSchema02Issues(graph, parsed, validation.issues);
    const id = typeof rawScenario?.id === 'string' && rawScenario.id.trim().length > 0 ? rawScenario.id : undefined;
    const title = typeof rawScenario?.title === 'string' && rawScenario.title.trim().length > 0 ? rawScenario.title : undefined;
    const duplicate = id !== undefined && scenarioIds.has(id);
    if (id !== undefined) {
      if (duplicate) {
        graph.diagnostics.push({
          code: 'DUPLICATE_IDENTIFIER', severity: 'blocking', message: `duplicate scenario id ${id}`,
          source: locator(parsed, ['id']),
        });
      }
      scenarioIds.add(id);
    }
    if (id !== undefined && title !== undefined) {
      const scenarioAddress = semanticAddress('scenario', id);
      const source = locator(parsed, ['id']);
      addSemantic(graph, {address: scenarioAddress, nodeType: 'semantic', kind: 'scenario', provenance: 'authored', source});
      const shardAddress = artifactAddress(parsed.path);
      ensureArtifact(graph, shardAddress, ['spec'], [scenarioAddress], locator(parsed, []));
      addEdge(graph, scenarioAddress, shardAddress, 'defined_in', 'authored', source);
      let referencesResolved = true;
      for (const [featureIndex, rawFeatureId] of arrayValue(rawScenario?.feature_refs).entries()) {
        if (typeof rawFeatureId !== 'string') continue;
        const featureId = rawFeatureId;
        if (!featureId.trim()) continue;
        const referenceSource = locator(parsed, ['feature_refs', featureIndex]);
        if (!featureIds.has(featureId)) {
          referencesResolved = false;
          graph.diagnostics.push({
            code: 'UNKNOWN_REFERENCE', severity: 'blocking',
            message: `${id} feature_refs contains unknown feature ${featureId}`,
            source: referenceSource,
          });
          continue;
        }
        addEdge(graph, scenarioAddress, semanticAddress('feature', featureId), 'participates_in', 'authored', referenceSource);
      }
      if (validation.completeness === 'complete' && validation.value && !duplicate && referencesResolved) {
        scenarioContracts.push(validation.value);
      }
    }
    if (validation.completeness === 'hollow') hollowCount++;
  }
  if (policy === 'off') return;
  if (documents.length === 0 || hollowCount > 0) {
    graph.diagnostics.push({
      code: 'INVALID_SCENARIO',
      severity: policy === 'required' ? 'blocking' : 'advisory',
      message: documents.length === 0
        ? 'scenario coverage is absent under the current scenario policy'
        : 'scenario coverage contains a hollow journey',
    });
  }
}

function compileScenario(graph: GraphBuild, parsed: ParsedYaml): void {
  const value = objectValueOrNull(parsed.value);
  const records = parsed.path === 'spec.yaml' ? arrayValue(value?.scenarios) : [value];
  records.forEach((record, index) => {
    const scenario = objectValueOrNull(record) as RawScenario | null;
    const prefix = parsed.path === 'spec.yaml' ? ['scenarios', index] : [];
    if (!scenario || typeof scenario.id !== 'string' || typeof scenario.title !== 'string') {
      graph.diagnostics.push({code: 'INVALID_SCENARIO', message: `scenario in ${parsed.path} lacks id or title`, source: locator(parsed, prefix)});
      return;
    }
    const scenarioAddress = semanticAddress('scenario', scenario.id);
    const source = locator(parsed, [...prefix, 'id']);
    addSemantic(graph, {address: scenarioAddress, nodeType: 'semantic', kind: 'scenario', provenance: 'authored', source});
    const shardAddress = artifactAddress(parsed.path);
    ensureArtifact(graph, shardAddress, ['spec'], [scenarioAddress], locator(parsed, prefix));
    addEdge(graph, scenarioAddress, shardAddress, 'defined_in', 'authored', source);
    for (const [featureIndex, featureId] of stringEntries(scenario.features).entries()) {
      addEdge(graph, scenarioAddress, semanticAddress('feature', featureId), 'participates_in', 'authored', locator(parsed, [...prefix, 'features', featureIndex]));
    }
  });
}

function compileLegacyReferences(
  graph: GraphBuild,
  root: string,
  parsed: ParsedYaml,
  criterionPrefix: readonly (string | number)[],
  owner: string,
  channel: LegacyReferenceChannel,
  refs: unknown,
): void {
  for (const [index, raw] of stringEntries(refs).entries()) {
    const source = locator(parsed, [...criterionPrefix, `${channel}_refs`, index]);
    const normalized = normalizeReference(root, raw);
    const roles: readonly ArtifactRole[] = channel === 'test' ? ['test'] : channel === 'oracle' ? ['oracle'] : ['evidence'];
    ensureArtifact(graph, normalized.artifact, roles, [], source);
    if (normalized.anchor) {
      graph.anchorNodes.set(normalized.target, {
        address: normalized.target,
        nodeType: 'anchor',
        artifact: normalized.artifact,
        selector: normalized.anchor.selector,
        selectorProvenance: normalized.anchor.selectorProvenance,
        source,
        provenance: 'authored',
      });
    }
    addEdge(graph, owner, normalized.target, 'supports', 'authored', source, {
      state: normalized.resolution,
      channel,
      raw,
      normalizedTarget: normalized.target,
      selector: normalized.selector,
    });
  }
}

/**
 * Projects receipt-held historic bindings with the same source-bearing shape as
 * a live compiler proof record without promoting them into GraphIR edges.
 */
function compilerMigrationProofView(
  root: string,
  parsed: ParsedYaml,
  baseline: MigrationBaseline,
): readonly CorpusProofRecord[] {
  const proofs: CorpusProofRecord[] = [];
  for (const [criterionIndex, criterion] of baseline.criteria.entries()) {
    for (const [bindingIndex, binding] of criterion.bindings.entries()) {
      if ((binding.channel !== 'test' && binding.channel !== 'oracle' && binding.channel !== 'evidence')
        || typeof binding.raw !== 'string') {
        continue;
      }
      const normalized = normalizeReference(root, binding.raw);
      proofs.push({
        owner: criterion.address,
        channel: binding.channel,
        raw: binding.raw,
        normalizedTarget: normalized.target,
        selector: normalized.selector,
        resolution: normalized.resolution,
        source: locator(parsed, ['criteria', criterionIndex, 'bindings', bindingIndex, 'raw']),
      });
    }
  }
  return proofs.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizeReference(root: string, raw: string): NormalizedReference {
  const separator = raw.indexOf('#');
  const rawPath = (separator < 0 ? raw : raw.slice(0, separator)).trim();
  const selectorValue = separator < 0 ? undefined : raw.slice(separator + 1);
  const selector: GraphSelector = selectorValue === undefined || selectorValue.length === 0
    ? {precision: 'none'}
    : {precision: 'fragment', value: selectorValue};
  if (rawPath.startsWith('fixture:')) {
    const name = rawPath.slice('fixture:'.length);
    if (registeredFixtureNames(root).has(name)) {
      const artifact = artifactAddress('conformance/fixtures.yaml');
      return {
        target: anchorAddress('conformance/fixtures.yaml', name), artifact, selector, resolution: 'resolved',
        anchor: {selector: name, selectorProvenance: 'derived'},
      };
    }
    const artifact = `artifact:${rawPath}`;
    return {target: artifact, artifact, selector, resolution: 'unresolved'};
  }
  if (rawPath.startsWith('script:') || rawPath.startsWith('self-dogfood:')) {
    const prefix = rawPath.startsWith('script:') ? 'script:' : 'self-dogfood:';
    const name = rawPath.slice(prefix.length);
    if (packageScriptNames(root).has(name)) {
      const artifact = artifactAddress('package.json');
      return {
        target: anchorAddress('package.json', `scripts.${name}`), artifact, selector, resolution: 'resolved',
        anchor: {selector: `scripts.${name}`, selectorProvenance: 'derived'},
      };
    }
    const artifact = `artifact:${rawPath}`;
    return {target: artifact, artifact, selector, resolution: 'unresolved'};
  }
  if (rawPath.startsWith('derived:')) {
    const artifact = `artifact:${rawPath}`;
    return {target: artifact, artifact, selector, resolution: 'unresolved'};
  }
  const normalizedPath = normalizeRepoPath(rawPath);
  const artifact = artifactAddress(normalizedPath);
  const target = selector.precision === 'fragment' ? anchorAddress(normalizedPath, selector.value ?? '') : artifact;
  return {
    target,
    artifact,
    selector,
    resolution: isPortableStructuralTarget(normalizedPath) && existsSync(join(root, normalizedPath)) ? 'resolved' : 'unresolved',
    ...(selector.precision === 'fragment'
      ? {anchor: {selector: selector.value ?? '', selectorProvenance: 'authored' as const}}
      : {}),
  };
}

/** Keeps local audit output from becoming a clean-clone proof dependency. */
function isPortableStructuralTarget(path: string): boolean {
  return !resolveArtifactDescriptors(path).some((descriptor) => descriptor.authority === 'transient');
}

function addSemantic(graph: GraphBuild, node: SemanticGraphNode): void {
  graph.semanticNodes.set(node.address, node);
}

function ensureArtifact(
  graph: GraphBuild,
  address: string,
  roles: readonly ArtifactRole[],
  owners: readonly string[],
  source?: SourceLocator,
): void {
  const existing = graph.artifactNodes.get(address);
  if (existing) {
    roles.forEach((role) => existing.roles.add(role));
    owners.forEach((owner) => existing.owners.add(owner));
    return;
  }
  graph.artifactNodes.set(address, {address, roles: new Set(roles), owners: new Set(owners), ...(source ? {source} : {})});
}

function addEdge(
  graph: GraphBuild,
  from: string,
  to: string,
  relation: GraphEdge['relation'],
  provenance: GraphEdge['provenance'],
  owner: SourceLocator,
  extra: Omit<Partial<GraphEdge>, 'address' | 'from' | 'to' | 'relation' | 'provenance' | 'owner'> = {},
): void {
  const address = `${from}|${relation}|${to}|${owner.path}:${owner.yamlPath}`;
  graph.edges.push({address, from, to, relation, provenance, owner, ...extra});
}

function readYaml(root: string, path: string): ParsedYaml {
  const absolute = join(root, path);
  const text = readFileSync(absolute, 'utf8');
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {lineCounter});
  return {path: normalizeRepoPath(relative(root, absolute)), document, lineCounter, value: document.toJS()};
}

/** Reads exact fixture names from their independent source-YAML registry. */
function registeredFixtureNames(root: string): ReadonlySet<string> {
  const path = 'conformance/fixtures.yaml';
  if (!existsSync(join(root, path))) return new Set<string>();
  const registry = objectValueOrNull(readYaml(root, path).value);
  return new Set(
    arrayValue(registry?.fixtures)
      .map((fixture) => objectValueOrNull(fixture)?.name)
      .filter((name): name is string => typeof name === 'string'),
  );
}

/** Reads exact package-script keys without guessing aliases or stage names. */
function packageScriptNames(root: string): ReadonlySet<string> {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return new Set<string>();
  const packageJson = objectValueOrNull(JSON.parse(readFileSync(path, 'utf8')));
  const scripts = objectValueOrNull(packageJson?.scripts);
  return new Set(Object.entries(scripts ?? {})
    .filter(([, value]) => typeof value === 'string')
    .map(([name]) => name));
}

function locator(parsed: ParsedYaml, path: readonly (string | number)[]): SourceLocator {
  const node = parsed.document.getIn(path, true) as unknown as {readonly range?: readonly number[]} | undefined;
  const range = node?.range;
  const start = range?.[0] ?? 0;
  const end = range?.[1] ?? start;
  const position = parsed.lineCounter.linePos(start);
  const sourceRange: SourceRange = {start, end, line: position.line, column: position.col};
  const yamlPath = path.length === 0 ? '$' : `$${path.map((part) => typeof part === 'number' ? `[${part}]` : `.${part}`).join('')}`;
  return {path: parsed.path, yamlPath, range: sourceRange};
}

function normalizeRepoPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`compiler path must be repository-relative: ${path}`);
  }
  return normalized;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  const object = objectValueOrNull(value);
  if (!object) throw new Error(message);
  return object;
}

function objectValueOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringEntries(value: unknown): readonly string[] {
  return arrayValue(value).filter((entry): entry is string => typeof entry === 'string');
}

function roleForModule(path: string): ArtifactRole {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes('/tests/')) return 'test';
  if (/\.(?:md|mdx)$/.test(path)) return 'doc';
  if (path.startsWith('spec/generated/')) return 'generated';
  return 'source';
}
