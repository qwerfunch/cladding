// Cladding · Spec 0.2 F7 · compiler-derived legacy consumer projection.

import {resolve} from 'node:path';

import {currentSafeBindings} from '../../proof/current-bindings.js';
import {selectCriterionTestBindings} from '../../proof/legacy-bindings.js';
import type {AcceptanceCriterion, Capability, Feature, Project, Spec} from '../types.js';
import {requireSchema02Contract} from './contract-assertion.js';
import {shardFilenameSlug} from './id-policy.js';
import type {MigrationBaseline} from './migration-baseline.js';
import type {
  ArtifactGraphNode,
  Schema02CriterionContract,
  Schema02FeatureContract,
  Schema02ProjectContract,
  SemanticGraphNode,
  SpecCompilation,
} from './types.js';

/**
 * Projects a complete schema 0.2 compiler contract onto the frozen schema 0.1
 * `Spec` consumer wire. This boundary intentionally does not expose GraphIR,
 * intent contracts, baseline identities, or policy-only schema 0.2 fields.
 *
 * @param cwd - Workspace root for safe live proof discovery.
 * @param compilation - One lock-held schema 0.2 compiler snapshot.
 * @returns The exact legacy `Spec` compatibility projection.
 * @throws Error when compilation cannot safely supply a complete contract.
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 */
export function schema02ConsumerView(cwd: string, compilation: SpecCompilation): Spec {
  const contract = requireSchema02Contract(compilation);
  const featureSources = featureSourcePaths(compilation);
  const live = currentSafeBindings(cwd, compilation);
  return {
    schema: '0.2',
    project: legacyProject(contract.project),
    features: contract.features.map((feature) => legacyFeature(
      cwd,
      feature,
      requiredFeatureSource(featureSources, feature.id),
      compilation,
      live,
    )),
    scenarios: contract.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      features: [...scenario.featureRefs],
    })),
    capabilities: contract.capabilities.map((capability) => ({
      id: capability.id,
      title: capability.title,
      summary: capability.outcome,
      features: contract.features
        .filter((feature) => feature.capabilityRefs.includes(capability.id))
        .map((feature) => feature.id),
    } satisfies Capability)),
    architecture: {
      layers: contract.architecture.layers.map((layer) => [...layer]),
      forbidden_imports: contract.architecture.rules.map((rule) => ({from: rule.from, to: rule.to})),
    },
    ...(contract.inventory === undefined ? {} : {
      inventory: {
        features: contract.inventory.features,
        scenarios: contract.inventory.scenarios,
        capabilities: contract.inventory.capabilities,
        test_files: contract.inventory.testFiles,
      },
    }),
  };
}

/**
 * Returns the successful compiler-owned YAML input census for the legacy
 * loader cache. Only `spec` artifacts are emitted, never discovered files.
 *
 * @param cwd - Workspace root used to resolve compiler-owned relative paths.
 * @param compilation - Successful compiler snapshot supplying source artifacts.
 * @returns Sorted absolute paths parsed by the compiler's source authority.
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 */
export function compilerParsedYamlPaths(cwd: string, compilation: SpecCompilation): readonly string[] {
  return [...new Set(compilation.nodes
    .filter((node): node is ArtifactGraphNode =>
      node.nodeType === 'artifact' && node.roles.includes('spec') && node.address.startsWith('artifact:'))
    .map((node) => node.address.slice('artifact:'.length))
    .filter((path) => /\.ya?ml$/i.test(path)))]
    .sort()
    .map((path) => resolve(cwd, path));
}

function legacyProject(project: Schema02ProjectContract): Project {
  const retained = project.retainedPolicies as Pick<
    Project,
    'require_oracles' | 'oracle_policy' | 'independence_policy' | 'deliverable' | 'smoke' | 'ai_hints'
  >;
  return {
    name: project.name,
    language: project.language,
    ...(project.description === undefined ? {} : {description: project.description}),
    ...(project.version === undefined ? {} : {version: project.version}),
    ...(project.repository === undefined ? {} : {repository: project.repository}),
    ...(project.onboardingSeeded === undefined ? {} : {onboarding_seeded: project.onboardingSeeded}),
    ...('purpose' in project ? {intent_summary: project.purpose} : {}),
    ...retained,
  };
}

function legacyFeature(
  cwd: string,
  feature: Schema02FeatureContract,
  sourcePath: string,
  compilation: SpecCompilation,
  live: ReturnType<typeof currentSafeBindings>,
): Feature {
  return {
    id: feature.id,
    slug: shardFilenameSlug(sourcePath, feature.id),
    title: feature.title,
    status: feature.status,
    ...(feature.modules === undefined ? {} : {modules: [...feature.modules]}),
    ...(feature.dependsOn === undefined ? {} : {depends_on: [...feature.dependsOn]}),
    ...(feature.designImpact === undefined ? {} : {design_impact: feature.designImpact as Feature['design_impact']}),
    ...(feature.archivedAt === undefined ? {} : {archived_at: feature.archivedAt}),
    ...(feature.archiveReason === undefined ? {} : {archive_reason: feature.archiveReason}),
    ...(feature.supersededBy === undefined ? {} : {superseded_by: feature.supersededBy}),
    ...(feature.blockedReason === undefined ? {} : {blocked_reason: feature.blockedReason}),
    acceptance_criteria: feature.acceptanceCriteria.map((criterion) => legacyCriterion(cwd, feature.id, criterion, compilation, live)),
  };
}

function legacyCriterion(
  cwd: string,
  featureId: string,
  criterion: Schema02CriterionContract,
  compilation: SpecCompilation,
  live: ReturnType<typeof currentSafeBindings>,
): AcceptanceCriterion {
  const address = `${featureId}/${criterion.id}`;
  const selection = selectCriterionTestBindings({
    cwd,
    baseline: compilation.migrationBaseline,
    criterion: address,
    currentCriterion: criterionBaselineMatchShape(criterion, compilation.migrationBaseline, address),
    live,
  });
  const testRefs = selection.source === 'live'
    ? selection.live.map((binding) => `${binding.file}#${binding.selector}`)
    : selection.source === 'reviewed'
      ? selection.reviewed.map((binding) => binding.raw)
      : selection.legacy.map((binding) => binding.raw);
  return {
    id: criterion.id,
    text: criterion.statement,
    ...(testRefs.length === 0 ? {} : {test_refs: testRefs}),
    ...(criterion.oracleRefs === undefined ? {} : {oracle_refs: [...criterion.oracleRefs]}),
    ...(criterion.evidenceRefs === undefined ? {} : {evidence_refs: [...criterion.evidenceRefs]}),
    ...(criterion.notes === undefined ? {} : {notes: criterion.notes}),
  };
}

/**
 * Builds only the persisted criterion fields that the immutable baseline
 * matcher owns. Contract identities intentionally never cross this boundary.
 *
 * @param criterion - Compiler-owned criterion contract.
 * @param baseline - Optional immutable schema 0.1 migration receipt.
 * @param address - Composite legacy criterion address.
 * @returns The persisted field subset consumed by `legacyExemptionMatches`.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function criterionBaselineMatchShape(
  criterion: Schema02CriterionContract,
  baseline?: MigrationBaseline,
  address?: string,
): object {
  // Schema contract ordering is deterministic, but the immutable receipt
  // records the original authored order. A contract baseline identity already
  // proves those source values match; replay that order only for the matcher.
  const retainedConstraintRefs = 'baselineIdentity' in criterion && address
    ? baseline?.criteria.find((entry) => entry.address === `criterion:${address}`)?.legacyIntent.constraint_refs
    : undefined;
  const constraintRefs = retainedConstraintRefs === undefined
    ? criterion.constraintRefs
    : retainedConstraintRefs.split(',');
  return {
    statement: criterion.statement,
    kind: criterion.kind,
    ...(criterion.rationale === undefined ? {} : {rationale: criterion.rationale}),
    ...(retainedConstraintRefs === undefined && constraintRefs.length === 0
      ? {}
      : {constraint_refs: [...constraintRefs]}),
  };
}

function featureSourcePaths(compilation: SpecCompilation): ReadonlyMap<string, string> {
  return new Map<string, string>(compilation.nodes
    .filter((node): node is SemanticGraphNode =>
      node.nodeType === 'semantic' && node.kind === 'feature' && node.address.startsWith('feature:'))
    .map((node) => [node.address.slice('feature:'.length), node.source.path]));
}

function requiredFeatureSource(sources: ReadonlyMap<string, string>, featureId: string): string {
  const source = sources.get(featureId);
  if (!source) throw new Error(`Schema 0.2 compiler compatibility view cannot locate feature shard for ${featureId}.`);
  return source;
}
