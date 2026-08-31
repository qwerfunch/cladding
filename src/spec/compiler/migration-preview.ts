// Cladding · Spec 0.2 F2/F3 · canonical read-only schema migration preview.

import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

import {compileSpecWorkspace, compileSpecWorkspaceWithLockHeld, readSchema01MigrationSource} from './compile.js';
import {deterministicArchitectureRuleId} from './schema-02-contract.js';
import {
  LEGACY_UNCLASSIFIED,
  compareCodeUnits,
  legacyL2CandidateCensusSha256,
  MIGRATION_BASELINE_SCHEMA,
  type LegacyBindingBaseline,
  type LegacyExemption,
  type LegacyStructuralReview,
  type MigrationBaseline,
} from './migration-baseline.js';
import type {GraphEdge} from './types.js';
import {scanLegacyStatement, type LegacyStatementScan} from '../legacy-statement-scanner.js';
import {resolveLegacyTestBinding} from '../../proof/legacy-bindings.js';
import {readEvidence} from '../../hitl/audit.js';
import {inventoryTestFileCensus, type InventoryTestFileCensus} from '../inventory.js';
import {isReadableId, isReadableShardFilename} from './id-policy.js';

/** One required human decision that the preview deliberately does not make. */
export interface MigrationResolutionItem {
  /** Stable resolution category. */
  readonly code:
    | 'PROJECT_PURPOSE_CONFIRMATION'
    | 'PROJECT_ASSURANCE_LEVEL_CONFIRMATION'
    | 'PROJECT_SCENARIO_POLICY_CONFIRMATION'
    | 'PROJECT_LEGACY_L2_BASELINE'
    | 'CRITERION_STATEMENT_CONFLICT'
    | 'CRITERION_TEXT_UNKNOWN'
    | 'CAPABILITY_OUTCOME_CONFIRMATION'
    | 'CAPABILITY_RECORD_RESOLUTION'
    | 'CAPABILITY_EDGE_RESOLUTION'
    | 'SCENARIO_MEANING_REQUIRED'
    | 'ARCHITECTURE_LAYER_RESOLUTION'
    | 'ARCHITECTURE_RULE_RATIONALE'
    | 'ARCHITECTURE_RULE_RESOLUTION'
    | 'ADR_REFERENCE_REVIEW';
  /** Canonical source subject that needs review. */
  readonly subject: string;
  /** Plain explanation of what remains unselected. */
  readonly detail: string;
}

/** Completed-legacy criterion census requiring a separate project decision. */
export interface MigrationLegacyL2BaselinePreview {
  /** Count of criteria belonging to source features whose status is exactly `done`. */
  readonly candidateCount: number;
  /** SHA-256 of the code-unit-sorted candidate criterion-address census. */
  readonly candidateCensusSha256: string;
}

/** Criterion migration candidate preserving authored text separately from strict classification. */
export interface PreviewCriterion {
  /** Composite source address. */
  readonly address: string;
  /** Exact legacy `text`, when it is a string. */
  readonly statement?: string;
  /** Total legacy scan result. */
  readonly scan: LegacyStatementScan | {readonly status: 'unknown'};
  /** F2 keeps the kind legacy-exempt rather than assuming behavior. */
  readonly kind: 'legacy_exempt';
  /** Historic proof bindings with raw spelling and authored selectors only. */
  readonly legacyBindings: readonly LegacyBindingBaseline[];
  /** Whole-file states for the historic tests a strict review may explicitly retain. */
  readonly reviewedTestCandidates: readonly PreviewReviewedTestCandidate[];
}

/** A deterministic historic test candidate, never an observation or receipt. */
export interface PreviewReviewedTestCandidate {
  /** Exact historic source spelling selected by a reviewer. */
  readonly raw: string;
  /** Safe normalized repository path when the reference can be followed. */
  readonly file: string;
  /** Historic authored selector when one exists. */
  readonly selector?: string;
  /** Full current file digest for an available safe candidate. */
  readonly sha256?: string;
  /** Missing, unsafe, or byte-unavailable candidates cannot be retained. */
  readonly state: 'available' | 'stale' | 'unsafe';
}

/**
 * One feature proposal with a mechanically inverted explicit capability edge set.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export interface PreviewFeature {
  /** Feature source address. */
  readonly address: string;
  /** Source shard location. */
  readonly path: string;
  /** Deterministic schema 0.2 shard target; differs only for inline legacy nodes. */
  readonly targetPath: string;
  /** Exact existing title; no purpose is inferred from it. */
  readonly title: string;
  /** Legacy title never becomes a new purpose by implication. */
  readonly purpose: 'legacy_exempt';
  /** Explicit candidate links, including an intentional empty direct-to-project set. */
  readonly capabilityRefs: readonly string[];
}

/** Scenario source and deterministic schema 0.2 shard target. */
export interface PreviewScenario {
  readonly address: string;
  readonly status: 'legacy_exempt';
  readonly path: string;
  readonly targetPath: string;
}

/**
 * One source-owned capability-to-feature edge used in the L=N proof.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface CapabilityEdgePair {
  /** Legacy catalog capability id. */
  readonly capabilityId: string;
  /** Legacy feature id. */
  readonly featureId: string;
}

/**
 * Independently inspectable, sorted equality proof for the edge-authority handoff.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export interface CapabilityEdgeEqualityProof {
  /** Sorted distinct legacy capability-owned pairs L. */
  readonly legacyPairs: readonly CapabilityEdgePair[];
  /** Sorted distinct feature-owned candidate pairs N. */
  readonly candidatePairs: readonly CapabilityEdgePair[];
  /** Legacy pairs that a safe candidate could not retain. */
  readonly missing: readonly CapabilityEdgePair[];
  /** Candidate pairs without a legacy source; the planner must never create these. */
  readonly extra: readonly CapabilityEdgePair[];
  /** Conflicts that invalidate equality even if the unique pair sets happen to match. */
  readonly conflicts: readonly string[];
  /** Whether the migration can prove L = N before any future cutover. */
  readonly equal: boolean;
}

/**
 * One architecture rule candidate that deliberately lacks invented rationale.
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export interface PreviewArchitectureRule {
  /** Structural architecture-rule identity generated from the import pair only. */
  readonly id: string;
  /** The initial strict schema 0.2 rule kind. */
  readonly kind: 'forbidden_import';
  /** Importing legacy layer, preserved exactly. */
  readonly from: string;
  /** Imported dependency layer, preserved exactly. */
  readonly to: string;
  /** F3 never treats legacy comments as a rationale. */
  readonly status: 'rationale_required';
}

/**
 * In-memory architecture proposal or an explicit lossless-conversion blockage.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface PreviewArchitecture {
  /** Whether architecture is absent, losslessly proposed, or requires review. */
  readonly status: 'absent' | 'proposed' | 'resolution_required';
  /** Ordered layers only when a string[][] conversion is lossless. */
  readonly layers?: readonly (readonly string[])[];
  /** Structural forbidden-import candidates with no inferred rationale. */
  readonly rules: readonly PreviewArchitectureRule[];
}

/** Explicit disposition for a pre-F11 generated path during the root switch. */
export interface MigrationOldPathProjection {
  /** Canonical old path that remains canonical until relocation work. */
  readonly path: 'spec/index.yaml' | 'spec/_doc-links.yaml' | 'spec/attestation.yaml';
  /** Regenerate from the converted candidate, preserve exact bytes, or invalidate stale verification. */
  readonly disposition: 'regenerate' | 'carry_forward' | 'invalidate';
}

/** Legacy audit evidence is historical asserted context, never a 0.2 receipt. */
export interface MigrationIndependenceDisposition {
  readonly legacyEvidence: 'asserted';
  /** Done features whose legacy human/blind label cannot satisfy 0.2 `require`. */
  readonly requirePolicyDoneLosses: readonly string[];
}

/** Inspectable one-to-one identity/count proof from raw legacy nodes to the candidate. */
export interface MigrationIdentityProof {
  readonly features: {readonly source: readonly string[]; readonly candidate: readonly string[]};
  readonly criteria: {readonly source: readonly string[]; readonly candidate: readonly string[]};
  readonly scenarios: {readonly source: readonly string[]; readonly candidate: readonly string[]};
}

/**
 * Deterministic, read-only proposal for an eventual schema 0.1 to 0.2 migration.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface MigrationPreview {
  /** Serialization schema for this pure proposal. */
  readonly schema: 1;
  /** Source and proposed schema versions. */
  readonly sourceSchema: '0.1';
  readonly targetSchema: '0.2';
  /** An explicit guarantee that generating this value performs no writes. */
  readonly mode: 'preview';
  /** Digest of every legacy source byte consulted or later converted by apply. */
  readonly sourceDigest: string;
  /** Sorted raw input manifest retained in the reviewed preview for audit. */
  readonly sourceManifest: readonly {readonly path: string; readonly sha256: string}[];
  /** Digest of the sorted test filenames counted by the target inventory. */
  readonly testFileSetDigest: string;
  /** Reviewed count corresponding exactly to `testFileSetDigest`. */
  readonly testFileCount: number;
  /** Exact project intent projection, or explicit legacy exemption state. */
  readonly project: {
    readonly purpose?: string;
    readonly status: 'proposed' | 'legacy_exempt';
    readonly assuranceLevel: 'L2';
    readonly scenarioPolicy: 'advisory';
  };
  /** Narrow L2 migration candidate census; accepting it is a distinct decision. */
  readonly legacyL2Baseline: MigrationLegacyL2BaselinePreview;
  /** Feature structural projections. */
  readonly features: readonly PreviewFeature[];
  /** Criterion projections in composite-address order. */
  readonly criteria: readonly PreviewCriterion[];
  /** Exact capability summary-to-outcome proposals. */
  readonly capabilities: readonly {readonly id: string; readonly title?: string; readonly outcome?: string; readonly status: 'proposed' | 'unknown'}[];
  /** Exact legacy-to-candidate capability edge proof; it is not a runtime union. */
  readonly capabilityEdgeProof: CapabilityEdgeEqualityProof;
  /** D08 dispositions for valid legacy capability surface values removed from live 0.2 records. */
  readonly capabilitySurfaceDispositions: readonly {readonly id: string; readonly legacySurface: 'feature' | 'platform' | 'tool' | 'infrastructure'; readonly disposition: 'removed_by_schema_0.2'}[];
  /** Scenario meaning is carried forward under a node-local legacy exemption. */
  readonly scenarios: readonly PreviewScenario[];
  /** Architecture layers and rules proposed without making up rationale prose. */
  readonly architecture: PreviewArchitecture;
  /** Old canonical generated paths handled in this same migration journal. */
  readonly oldPathProjections: readonly MigrationOldPathProjection[];
  /** Explicit asserted-only treatment of pre-receipt audit evidence. */
  readonly independence: MigrationIndependenceDisposition;
  /** Exact source/candidate node identities; equality proves lossless node census. */
  readonly identityProof: MigrationIdentityProof;
  /** Node-granular baseline reserved for the later journaled write. */
  readonly baseline: MigrationBaseline;
  /** Decisions deliberately left to an operator or a later feature. */
  readonly requiredResolution: readonly MigrationResolutionItem[];
}

/**
 * Builds a deterministic read-only migration preview from the compiler boundary.
 *
 * @param cwd - Workspace root containing schema 0.1 source.
 * @returns A byte-stable in-memory proposal that never writes the workspace.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function previewSchema02Migration(cwd: string = '.', options: {readonly lockHeld?: boolean} = {}): MigrationPreview {
  // A compiler snapshot holds the F4 lock only for compilation. Bind the
  // surrounding source projection with a raw-manifest seqlock as well, so a
  // preview never serializes fields read from two different commit states.
  for (let attempt = 0; attempt < 12; attempt++) {
    const before = migrationSourceManifest(cwd);
    const testCensus = inventoryTestFileCensus(cwd);
    try {
      const preview = buildMigrationPreview(cwd, options, testCensus);
      const after = migrationSourceManifest(cwd);
      const afterTestCensus = inventoryTestFileCensus(cwd);
      if (JSON.stringify(before) === JSON.stringify(after)
        && JSON.stringify(testCensus) === JSON.stringify(afterTestCensus)) return preview;
    } catch (error) {
      const after = migrationSourceManifest(cwd);
      const afterTestCensus = inventoryTestFileCensus(cwd);
      if (JSON.stringify(before) === JSON.stringify(after)
        && JSON.stringify(testCensus) === JSON.stringify(afterTestCensus)) throw error;
    }
  }
  throw new Error('Schema migration preview could not obtain a stable source snapshot.');
}

function buildMigrationPreview(cwd: string, options: {readonly lockHeld?: boolean}, testCensus: InventoryTestFileCensus): MigrationPreview {
  const compilation = options.lockHeld ? compileSpecWorkspaceWithLockHeld(cwd) : compileSpecWorkspace(cwd);
  if (compilation.schemaVersion !== '0.1') throw new Error('Schema migration preview currently accepts only schema 0.1 workspaces');
  const source = readSchema01MigrationSource(cwd);
  if (source.root.features !== undefined && !Array.isArray(source.root.features)) throw new Error('Schema migration preview cannot address a non-array inline features source.');
  if (source.root.scenarios !== undefined && !Array.isArray(source.root.scenarios)) throw new Error('Schema migration preview cannot address a non-array inline scenarios source.');
  if (Array.isArray(source.root.features) && source.root.features.length > 0 && hasShardedDomain(cwd, 'features')) {
    throw new Error('Schema migration preview rejects mixed inline and sharded feature sources; reconcile the ignored shard domain first.');
  }
  if (Array.isArray(source.root.scenarios) && source.root.scenarios.length > 0 && hasShardedDomain(cwd, 'scenarios')) {
    throw new Error('Schema migration preview rejects mixed inline and sharded scenario sources; reconcile the ignored shard domain first.');
  }
  if (Object.hasOwn(source.root, 'capabilities') && existsSync(join(resolve(cwd), 'spec', 'capabilities.yaml'))) {
    throw new Error('Schema migration preview rejects mixed inline and sharded capability sources; reconcile the ignored catalog first.');
  }
  if (Object.hasOwn(source.root, 'architecture') && existsSync(join(resolve(cwd), 'spec', 'architecture.yaml'))) {
    throw new Error('Schema migration preview rejects mixed inline and sharded architecture sources; reconcile the ignored architecture artifact first.');
  }
  const bindings = bindingsByCriterion(compilation.edges);
  const resolutions: MigrationResolutionItem[] = [];
  const project = objectOrNull(source.root.project);
  const intent = project?.intent_summary;
  const previewProject = typeof intent === 'string'
    ? {purpose: intent, status: 'proposed' as const, assuranceLevel: 'L2' as const, scenarioPolicy: 'advisory' as const}
    : {status: 'legacy_exempt' as const, assuranceLevel: 'L2' as const, scenarioPolicy: 'advisory' as const};
  if (typeof intent === 'string') {
    resolutions.push({code: 'PROJECT_PURPOSE_CONFIRMATION', subject: 'project', detail: 'Confirm the exact legacy intent_summary copied to purpose.'});
  }
  resolutions.push({
    code: 'PROJECT_ASSURANCE_LEVEL_CONFIRMATION', subject: 'project',
    detail: 'Confirm or change the proposed L2 assurance level; migration does not infer it from the legacy stage layout.',
  });
  resolutions.push({
    code: 'PROJECT_SCENARIO_POLICY_CONFIRMATION', subject: 'project',
    detail: 'Confirm or change the proposed advisory scenario policy; migration does not create an invisible default.',
  });

  const featureRecordsForPreview = featureRecords(source.features);
  assertAddressableMigrationSource(featureRecordsForPreview, source.scenarios);
  assertLosslessFeatureRetention(featureRecordsForPreview);
  const legacyL2Criteria = featureRecordsForPreview
    .filter((feature) => feature.value.status === 'done')
    .flatMap((feature) => criterionRecords(feature.value)
      .map((criterion) => `criterion:${stringValue(feature.value.id)!}/${stringValue(criterion.id)!}`))
    .sort(compareCodeUnits);
  const legacyL2Baseline: MigrationLegacyL2BaselinePreview = {
    candidateCount: legacyL2Criteria.length,
    candidateCensusSha256: legacyL2CandidateCensusSha256(legacyL2Criteria),
  };
  resolutions.push({
    code: 'PROJECT_LEGACY_L2_BASELINE', subject: 'project',
    detail: 'Accept or reject the separate completed-legacy-criterion L2 baseline; it is not implied by assurance policy confirmation.',
  });
  const featureIdCounts = new Map<string, number>();
  for (const record of featureRecordsForPreview) {
    const id = stringValue(record.value.id);
    if (id) featureIdCounts.set(id, (featureIdCounts.get(id) ?? 0) + 1);
  }
  const duplicateFeatureIds = new Set([...featureIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id));
  const doneFeatureIds = featureRecordsForPreview
    .filter((feature) => feature.value.status === 'done')
    .map((feature) => stringValue(feature.value.id)!)
    .sort();
  const independence = legacyIndependenceDisposition(cwd, project, doneFeatureIds);
  const featureRecordsById = new Map<string, {readonly path: string; readonly value: Record<string, unknown>}>();
  const featureSkeletons: Omit<PreviewFeature, 'capabilityRefs'>[] = [];
  const criteria: PreviewCriterion[] = [];
  const featureBaseline: MigrationBaseline['features'][number][] = [];
  const criterionBaseline: MigrationBaseline['criteria'][number][] = [];
  for (const record of featureRecordsForPreview) {
    const id = stringValue(record.value.id);
    const title = stringValue(record.value.title);
    if (!id || !title) continue;
    const featureAddress = `feature:${id}`;
    if (!duplicateFeatureIds.has(id)) featureRecordsById.set(id, record);
    featureSkeletons.push({address: featureAddress, path: record.path, targetPath: record.path === 'spec.yaml' ? migrationShardPath('features', id, title, record.value) : record.path, title, purpose: 'legacy_exempt'});
    const legacyStructuralReview = structuralReviewFromLegacyFeature(record.value);
    featureBaseline.push({
      address: featureAddress,
      title,
      exemption: stableExemption(featureAddress, 'missing_feature_purpose'),
      ...(legacyStructuralReview === undefined ? {} : {legacyStructuralReview}),
    });
    for (const criterion of criterionRecords(record.value)) {
      const criterionId = stringValue(criterion.id);
      if (!criterionId) continue;
      const address = `criterion:${id}/${criterionId}`;
      const text = stringValue(criterion.text);
      const scan = text === undefined ? {status: 'unknown' as const} : scanLegacyStatement(text, criterion.ears);
      const legacyBindings = bindings[address] ?? [];
      criteria.push({
        address,
        ...(text === undefined ? {} : {statement: text}),
        scan,
        kind: 'legacy_exempt',
        legacyBindings,
        reviewedTestCandidates: reviewedTestCandidates(cwd, address, legacyBindings),
      });
      criterionBaseline.push({
        address,
        legacyIntent: legacyCriterionIntent(criterion),
        legacyRecord: criterion,
        classification: LEGACY_UNCLASSIFIED,
        bindings: legacyBindings,
        exemption: stableExemption(address, 'legacy_criterion_intent'),
      });
      if (scan.status === 'conflict') {
        resolutions.push({
          code: 'CRITERION_STATEMENT_CONFLICT', subject: address,
          detail: legacyBindings.some((binding) => binding.channel === 'test')
            ? 'Resolve strict intent and explicitly retain selected historic test inputs or drop them.'
            : 'Resolve the legacy EARS structural conflict before strict schema 0.2 authoring.',
        });
      } else if (scan.status === 'unknown') {
        resolutions.push({
          code: 'CRITERION_TEXT_UNKNOWN', subject: address,
          detail: legacyBindings.some((binding) => binding.channel === 'test')
            ? 'Supply strict intent and explicitly retain selected historic test inputs or drop them.'
            : 'Provide an authored legacy text value; condition/action/response are not reconstructed.',
        });
      }
      if (Array.isArray(criterion.adr_refs) && criterion.adr_refs.length > 0) {
        resolutions.push({code: 'ADR_REFERENCE_REVIEW', subject: address, detail: 'Review legacy adr_refs manually; the preview does not assign a new target field.'});
      }
    }
  }

  const capabilitySource = capabilityRecords(source.capabilities);
  const capabilities = capabilitySource.records;
  const capabilitySurfaceDispositions = capabilities.flatMap((capability) => capability.surface === undefined || capability.id === undefined
    ? []
    : [{id: capability.id, legacySurface: capability.surface, disposition: 'removed_by_schema_0.2' as const}])
    .sort((left, right) => left.id.localeCompare(right.id));
  const catalogConflicts = collectCapabilityRecordConflicts(capabilitySource, resolutions);
  const featureIdentityConflicts = [...duplicateFeatureIds]
    .sort()
    .map((id) => `duplicate feature shard id ${id} prevents safe edge inversion`);
  for (const capability of capabilities) {
    if (!capability.id) continue;
    resolutions.push({
      code: 'CAPABILITY_OUTCOME_CONFIRMATION',
      subject: `capability:${capability.id}`,
      detail: capability.status === 'proposed'
        ? 'Confirm the exact legacy summary copied to outcome.'
        : 'Provide an outcome; no legacy summary was available to copy.',
    });
  }
  const capabilityEdgeProof = invertLegacyCapabilityEdges(
    capabilities, featureRecordsById, duplicateFeatureIds, [...catalogConflicts, ...featureIdentityConflicts], resolutions,
  );
  const features = featureSkeletons
    .map((feature) => ({
      ...feature,
      capabilityRefs: capabilityEdgeProof.candidatePairs
        .filter((pair) => pair.featureId === feature.address.slice('feature:'.length))
        .map((pair) => pair.capabilityId),
    }))
    .sort((left, right) => left.address.localeCompare(right.address));

  const scenarios: PreviewScenario[] = [];
  const scenarioBaseline: MigrationBaseline['scenarios'][number][] = [];
  const architecture = previewArchitecture(source.architecture, resolutions);
  for (const scenario of scenarioRecords(source.scenarios)) {
    const id = stringValue(scenario.value.id)!;
    const title = stringValue(scenario.value.title)!;
    const address = `scenario:${id}`;
    scenarios.push({address, status: 'legacy_exempt', path: scenario.path, targetPath: scenario.path === 'spec.yaml' ? migrationShardPath('scenarios', id, title, scenario.value) : scenario.path});
    scenarioBaseline.push({address, legacyRecord: scenario.value, exemption: stableExemption(address, 'legacy_scenario')});
    resolutions.push({code: 'SCENARIO_MEANING_REQUIRED', subject: address, detail: 'Resolve actor, goal, success, and steps without inferring a journey from legacy flow prose.'});
  }

  const sortedCriteria = criteria.sort((left, right) => left.address.localeCompare(right.address));
  const baseline: MigrationBaseline = {
    schema: MIGRATION_BASELINE_SCHEMA,
    sourceSchema: '0.1',
    project: typeof intent === 'string'
      ? {address: 'project', legacyIntent: intent}
      : {address: 'project', exemption: stableExemption('project', 'missing_project_intent')},
    features: featureBaseline.sort((left, right) => left.address.localeCompare(right.address)),
    criteria: criterionBaseline.sort((left, right) => left.address.localeCompare(right.address)),
    scenarios: scenarioBaseline.sort((left, right) => left.address.localeCompare(right.address)),
    ...(capabilitySurfaceDispositions.length === 0 ? {} : {capabilitySurfaceDispositions}),
    ...(source.architecture === undefined
      ? {}
      : {
        architecture: {
          address: 'architecture',
          legacyRecord: source.architecture,
          exemption: stableExemption('architecture', 'legacy_architecture'),
        },
      }),
  };
  const sourceManifest = migrationSourceManifest(cwd);
  const identityProof: MigrationIdentityProof = {
    features: {
      source: featureRecordsForPreview.map((record) => stringValue(record.value.id)!).sort(),
      candidate: features.map((feature) => feature.address.slice('feature:'.length)).sort(),
    },
    criteria: {
      source: featureRecordsForPreview.flatMap((record) => criterionRecords(record.value).map((criterion) => `${stringValue(record.value.id)!}/${stringValue(criterion.id)!}`)).sort(),
      candidate: sortedCriteria.map((criterion) => criterion.address.slice('criterion:'.length)).sort(),
    },
    scenarios: {
      source: scenarioRecords(source.scenarios).map((scenario) => stringValue(scenario.value.id)!).sort(),
      candidate: scenarios.map((scenario) => scenario.address.slice('scenario:'.length)).sort(),
    },
  };
  assertMigrationIdentityProof(identityProof);
  return {
    schema: 1,
    sourceSchema: '0.1',
    targetSchema: '0.2',
    mode: 'preview',
    sourceDigest: hashMigrationManifest(sourceManifest),
    sourceManifest,
    testFileSetDigest: testCensus.digest,
    testFileCount: testCensus.count,
    project: previewProject,
    legacyL2Baseline,
    features,
    criteria: sortedCriteria,
    capabilities: capabilities.flatMap((capability) => capability.id ? [{
      id: capability.id,
      ...(capability.title === undefined ? {} : {title: capability.title}),
      ...(capability.outcome === undefined ? {} : {outcome: capability.outcome}),
      status: capability.status,
    }] : []).sort((left, right) => left.id.localeCompare(right.id)),
    capabilityEdgeProof,
    capabilitySurfaceDispositions,
    scenarios: scenarios.sort((left, right) => left.address.localeCompare(right.address)),
    architecture,
    oldPathProjections: [
      {path: 'spec/index.yaml', disposition: 'regenerate'},
      {path: 'spec/_doc-links.yaml', disposition: 'carry_forward'},
      {path: 'spec/attestation.yaml', disposition: 'invalidate'},
    ],
    independence,
    identityProof,
    baseline,
    requiredResolution: resolutions.sort((left, right) => `${left.subject}|${left.code}`.localeCompare(`${right.subject}|${right.code}`)),
  };
}

/** Rejects any preview that would silently lose or duplicate a source node. */
function assertMigrationIdentityProof(proof: MigrationIdentityProof): void {
  for (const [domain, entry] of Object.entries(proof) as Array<[keyof MigrationIdentityProof, MigrationIdentityProof[keyof MigrationIdentityProof]]>) {
    if (JSON.stringify(entry.source) !== JSON.stringify(entry.candidate)) {
      throw new Error(`Schema migration preview cannot prove lossless ${domain} identity/count preservation.`);
    }
  }
}

/** Reports the exact legacy labels that cannot be inherited as verified receipts. */
function legacyIndependenceDisposition(
  cwd: string,
  project: Readonly<Record<string, unknown>> | undefined,
  doneFeatureIds: readonly string[],
): MigrationIndependenceDisposition {
  if (project?.independence_policy !== 'require' || doneFeatureIds.length === 0) {
    return {legacyEvidence: 'asserted', requirePolicyDoneLosses: []};
  }
  let evidence: ReturnType<typeof readEvidence>;
  try {
    evidence = readEvidence(cwd);
  } catch (error) {
    throw new Error(`Schema migration preview cannot classify the require-policy audit evidence: ${(error as Error).message}`);
  }
  const losses = doneFeatureIds.filter((featureId) => evidence.some((entry) => entry.featureId === featureId
    && (entry.identity?.author === 'human' || entry.blind === true)));
  return {legacyEvidence: 'asserted', requirePolicyDoneLosses: losses};
}

/** Binds a reviewed preview to all legacy source bytes, not merely projected fields. */
function migrationSourceManifest(cwd: string): readonly {readonly path: string; readonly sha256: string}[] {
  const root = resolve(cwd);
  const paths: string[] = [];
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Schema migration preview rejects symbolic-link source ${relative(root, absolute)}.`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(join(absolute, entry));
      return;
    }
    if (stat.isFile()) paths.push(relative(root, absolute).replace(/\\/g, '/'));
  };
  visit(join(root, 'spec.yaml'));
  visit(join(root, 'spec'));
  // The migration never mutates audit history, but independence policy and
  // review posture must not be evaluated from a different unreviewed ledger.
  visit(join(root, '.cladding', 'audit.log.jsonl'));
  return paths.sort().map((path) => ({path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}));
}

function hashMigrationManifest(manifest: readonly {readonly path: string; readonly sha256: string}[]): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

function hasShardedDomain(cwd: string, domain: 'features' | 'scenarios'): boolean {
  const directory = join(resolve(cwd), 'spec', domain);
  return existsSync(directory) && readdirSync(directory).some((name) => /\.ya?ml$/i.test(name));
}

function migrationShardPath(domain: 'features' | 'scenarios', id: string, title: string, source: Readonly<Record<string, unknown>>): string {
  const directLegacy = /^(?:F|S)-\d+$/.test(id);
  if (directLegacy) return `spec/${domain}/${id}.yaml`;
  const suppliedSlug = stringValue(source.slug);
  const slug = suppliedSlug && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(suppliedSlug)
    ? suppliedSlug
    : slugifyMigrationTitle(title);
  const suffix = id.replace(/^[FS]-/, '');
  if (!/^[a-f0-9]{6,}$/.test(suffix)) throw new Error(`Schema migration preview cannot derive a safe shard filename for ${id}.`);
  return `spec/${domain}/${slug}-${suffix}.yaml`;
}

function slugifyMigrationTitle(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'legacy';
}

/** Rejects malformed source identity instead of silently dropping a node from migration. */
function assertAddressableMigrationSource(
  features: readonly {readonly path: string; readonly value: Record<string, unknown>}[],
  scenarios: readonly {readonly path: string; readonly value: unknown}[],
): void {
  const featureIds = new Set<string>();
  for (const feature of features) {
    const id = stringValue(feature.value.id);
    const title = stringValue(feature.value.title);
    if (!id || !title) throw new Error(`Schema migration preview cannot address legacy feature ${feature.path}: id and title are required.`);
    if (featureIds.has(id)) throw new Error(`Schema migration preview cannot address duplicate legacy feature id ${id}.`);
    featureIds.add(id);
    assertLegacyShardIdentity('feature', feature.path, id);
    const criterionIds = new Set<string>();
    const rawCriteria = feature.value.acceptance_criteria;
    if (rawCriteria !== undefined && !Array.isArray(rawCriteria)) throw new Error(`Schema migration preview cannot address criteria in ${id}: acceptance_criteria must be an array.`);
    for (const [index, raw] of (rawCriteria ?? []).entries()) {
      const criterion = objectOrNull(raw);
      const criterionId = stringValue(criterion?.id);
      if (!criterion || !criterionId) throw new Error(`Schema migration preview cannot address criterion ${index + 1} in ${id}: criterion id is required.`);
      if (criterionIds.has(criterionId)) throw new Error(`Schema migration preview cannot address duplicate criterion id ${criterionId} in ${id}.`);
      criterionIds.add(criterionId);
      for (const field of ['test_refs', 'oracle_refs', 'evidence_refs'] as const) {
        const references = criterion[field];
        if (references !== undefined && (!Array.isArray(references) || references.some((reference) => typeof reference !== 'string'))) {
          throw new Error(`Schema migration preview cannot losslessly retain ${field} for ${id}/${criterionId}: it must be an array of strings.`);
        }
      }
      const adrRefs = criterion.adr_refs;
      if (adrRefs !== undefined && (!Array.isArray(adrRefs)
        || adrRefs.some((reference) => typeof reference !== 'string' || reference.trim().length === 0))) {
        throw new Error(`Schema migration preview cannot losslessly retain adr_refs for ${id}/${criterionId}: it must be an array of non-empty strings.`);
      }
    }
  }
  const scenarioIds = new Set<string>();
  for (const document of scenarios) {
    const scenario = objectOrNull(document.value);
    const id = stringValue(scenario?.id);
    const title = stringValue(scenario?.title);
    if (!scenario || !id || !title) throw new Error(`Schema migration preview cannot address legacy scenario ${document.path}: scenario id and title are required.`);
    if (scenarioIds.has(id)) throw new Error(`Schema migration preview cannot address duplicate legacy scenario id ${id}.`);
    scenarioIds.add(id);
    assertLegacyShardIdentity('scenario', document.path, id);
  }
}

/** Rejects a legacy shard filename that cannot be proved to belong to its body identifier. */
function assertLegacyShardIdentity(kind: 'feature' | 'scenario', path: string, id: string): void {
  if (path === 'spec.yaml') return;
  if (!isReadableId(kind, id) || !isReadableShardFilename(kind, path)) {
    throw new Error(`Schema migration preview cannot prove ${kind} shard identity for ${path}.`);
  }
  const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.ya?ml$/i, '');
  const direct = new RegExp(`^${kind === 'feature' ? 'F' : 'S'}-(?:\\d{3,}|[a-f0-9]{6,})$`).test(filename);
  const expected = direct ? id : `${kind === 'feature' ? 'F' : 'S'}-${filename.slice(filename.lastIndexOf('-') + 1)}`;
  if (expected !== id) throw new Error(`Schema migration preview cannot prove ${kind} shard filename/body identity for ${path}.`);
}

/** Rejects source shapes that conversion would otherwise silently coerce. */
function assertLosslessFeatureRetention(features: readonly {readonly path: string; readonly value: Record<string, unknown>}[]): void {
  const statuses = new Set(['planned', 'in_progress', 'done', 'blocked', 'archived']);
  for (const feature of features) {
    const id = stringValue(feature.value.id) ?? feature.path;
    if (typeof feature.value.status !== 'string' || !statuses.has(feature.value.status)) {
      throw new Error(`Schema migration preview cannot losslessly retain feature ${id}: status must be a supported string.`);
    }
    for (const field of ['modules', 'depends_on'] as const) {
      const value = feature.value[field];
      if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) {
        throw new Error(`Schema migration preview cannot losslessly retain feature ${id}: ${field} must be an array of strings.`);
      }
    }
  }
}

/**
 * Returns canonical JSON bytes for byte-stable CLI and future MCP transport.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function serializeMigrationPreview(preview: MigrationPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

function bindingsByCriterion(edges: readonly GraphEdge[]): Readonly<Record<string, readonly LegacyBindingBaseline[]>> {
  const records = new Map<string, LegacyBindingBaseline[]>();
  for (const edge of edges) {
    if (edge.relation !== 'supports' || edge.provenance !== 'authored' || !edge.channel || edge.raw === undefined) continue;
    const binding: LegacyBindingBaseline = {channel: edge.channel, raw: edge.raw, ...(edge.selector?.precision === 'fragment' ? {selector: edge.selector.value} : {})};
    const current = records.get(edge.from) ?? [];
    current.push(binding);
    records.set(edge.from, current);
  }
  return Object.fromEntries([...records.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, entries]) => [address, entries.sort((left, right) => `${left.channel}|${left.raw}`.localeCompare(`${right.channel}|${right.raw}`))]));
}

/** Resolves every historic test reference once for the reviewed preview. */
function reviewedTestCandidates(
  cwd: string,
  criterion: string,
  bindings: readonly LegacyBindingBaseline[],
): readonly PreviewReviewedTestCandidate[] {
  return bindings
    .filter((binding) => binding.channel === 'test')
    .map((binding) => {
      const resolved = resolveLegacyTestBinding(cwd, criterion.replace(/^criterion:/, ''), binding.raw, binding.selector);
      return {
        raw: binding.raw,
        file: resolved.file,
        ...(resolved.selector === undefined ? {} : {selector: resolved.selector}),
        ...(resolved.sha256 === undefined ? {} : {sha256: resolved.sha256}),
        state: resolved.state,
      };
    })
    .sort((left, right) => `${left.raw}\u0000${left.selector ?? ''}`.localeCompare(`${right.raw}\u0000${right.selector ?? ''}`));
}

function legacyCriterionIntent(criterion: Record<string, unknown>): Readonly<Record<string, string>> {
  const fields = ['ears', 'condition', 'action', 'response', 'text', 'rationale'] as const;
  const entries: [string, string][] = [];
  for (const field of fields) {
    const value = criterion[field];
    if (typeof value === 'string') entries.push([field, value]);
  }
  if (Array.isArray(criterion.constraint_refs) && criterion.constraint_refs.every((value) => typeof value === 'string')) {
    entries.push(['constraint_refs', criterion.constraint_refs.join(',')]);
  }
  return Object.fromEntries(entries);
}

/** Retains only an exact pending legacy structural review; it never invents one. */
function structuralReviewFromLegacyFeature(feature: Record<string, unknown>): LegacyStructuralReview | undefined {
  const review = objectOrNull(feature.design_impact);
  if (!review
    || review.classification !== 'structural'
    || review.status !== 'review_required'
    || typeof review.rationale !== 'string'
    || review.rationale.length === 0
    || !Array.isArray(review.artifacts)
    || review.artifacts.some((artifact) => typeof artifact !== 'string' || artifact.length === 0)
    || new Set(review.artifacts).size !== review.artifacts.length) {
    return undefined;
  }
  return {
    classification: 'structural',
    rationale: review.rationale,
    status: 'review_required',
    artifacts: [...review.artifacts],
  };
}

function stableExemption(subject: string, reason: LegacyExemption['reason']): LegacyExemption {
  const digest = createHash('sha256').update(`${reason}:${subject}`).digest('hex').slice(0, 16);
  return {id: `legacy-${digest}`, subject, reason};
}

function featureRecords(values: readonly {readonly path: string; readonly value: unknown}[]): readonly {readonly path: string; readonly value: Record<string, unknown>}[] {
  return values.flatMap((document) => {
    const record = objectOrNull(document.value);
    if (document.path === 'spec.yaml') return Array.isArray(record?.features)
      ? record.features.map((feature) => ({path: document.path, value: objectOrNull(feature) ?? {}}))
      : [];
    return record ? [{path: document.path, value: record}] : [];
  });
}

function criterionRecords(feature: Record<string, unknown>): readonly Record<string, unknown>[] {
  return Array.isArray(feature.acceptance_criteria)
    ? feature.acceptance_criteria.map((criterion) => objectOrNull(criterion) ?? {})
    : [];
}

interface LegacyCapabilityRecord {
  readonly index: number;
  readonly isObject: boolean;
  readonly id?: string;
  readonly title?: string;
  readonly outcome?: string;
  readonly status: 'proposed' | 'unknown';
  readonly legacyFeatures: unknown;
  readonly surface?: 'feature' | 'platform' | 'tool' | 'infrastructure';
}

interface LegacyCapabilitySource {
  readonly records: readonly LegacyCapabilityRecord[];
  readonly malformed: boolean;
}

interface ArchitecturePair {
  readonly from: string;
  readonly to: string;
}

function capabilityRecords(value: unknown): LegacyCapabilitySource {
  if (value === undefined) return {records: [], malformed: false};
  const record = objectOrNull(value);
  const entries = Array.isArray(value) ? value : Array.isArray(record?.capabilities) ? record.capabilities : undefined;
  if (!entries) return {records: [], malformed: true};
  return {records: entries.map((entry, index) => {
    const capability = objectOrNull(entry);
    const id = stringValue(capability?.id);
    const title = stringValue(capability?.title);
    const summary = stringValue(capability?.summary);
    const rawSurface = capability?.surface;
    if (rawSurface !== undefined && (typeof rawSurface !== 'string' || !['feature', 'platform', 'tool', 'infrastructure'].includes(rawSurface))) {
      throw new Error(`Schema migration preview cannot losslessly disposition legacy capability surface at index ${index}.`);
    }
    return {
      index,
      isObject: capability !== undefined,
      ...(id === undefined ? {} : {id}),
      ...(title === undefined ? {} : {title}),
      ...(summary === undefined ? {} : {outcome: summary}),
      status: summary === undefined ? 'unknown' as const : 'proposed' as const,
      legacyFeatures: capability?.features,
      ...(rawSurface === undefined ? {} : {surface: rawSurface as 'feature' | 'platform' | 'tool' | 'infrastructure'}),
    };
  }), malformed: false};
}

function invertLegacyCapabilityEdges(
  capabilities: readonly LegacyCapabilityRecord[],
  featuresById: ReadonlyMap<string, {readonly path: string; readonly value: Record<string, unknown>}>,
  duplicateFeatureIds: ReadonlySet<string>,
  catalogConflicts: readonly string[],
  resolutions: MigrationResolutionItem[],
): CapabilityEdgeEqualityProof {
  const legacy = new Map<string, CapabilityEdgePair>();
  const candidate = new Map<string, CapabilityEdgePair>();
  const conflicts: string[] = [...catalogConflicts];
  const capabilityIds = new Set<string>();
  for (const capability of capabilities) {
    const capabilityId = capability.id;
    if (!capabilityId) continue;
    if (capabilityIds.has(capabilityId)) conflicts.push(`duplicate capability id ${capabilityId}`);
    capabilityIds.add(capabilityId);
    if (capability.legacyFeatures === undefined) continue;
    if (!Array.isArray(capability.legacyFeatures)) {
      conflicts.push(`capability ${capabilityId} has a non-array legacy features value`);
      continue;
    }
    capability.legacyFeatures.forEach((rawFeatureId, index) => {
      if (typeof rawFeatureId !== 'string' || rawFeatureId.trim().length === 0) {
        conflicts.push(`capability ${capabilityId} has an invalid legacy features entry at index ${index}`);
        return;
      }
      const featureId: string = rawFeatureId;
      const pair: CapabilityEdgePair = {capabilityId, featureId};
      const key = capabilityEdgeKey(pair);
      if (legacy.has(key)) conflicts.push(`duplicate legacy capability edge ${capabilityId} -> ${featureId}`);
      legacy.set(key, pair);
      if (duplicateFeatureIds.has(featureId)) {
        conflicts.push(`duplicate feature shard id ${featureId} prevents safe edge inversion`);
        return;
      }
      if (!featuresById.has(featureId)) {
        conflicts.push(`dangling legacy capability edge ${capabilityId} -> ${featureId}`);
        return;
      }
      candidate.set(key, pair);
    });
  }
  const legacyPairs = sortCapabilityPairs([...legacy.values()]);
  const candidatePairs = sortCapabilityPairs([...candidate.values()]);
  const missing = legacyPairs.filter((pair) => !candidate.has(capabilityEdgeKey(pair)));
  const extra = candidatePairs.filter((pair) => !legacy.has(capabilityEdgeKey(pair)));
  const sortedConflicts = [...new Set(conflicts)].sort();
  const equal = missing.length === 0 && extra.length === 0 && sortedConflicts.length === 0;
  if (!equal) {
    resolutions.push({
      code: 'CAPABILITY_EDGE_RESOLUTION',
      subject: 'capabilities',
      detail: `Resolve legacy capability edges before apply: missing=${missing.length}, extra=${extra.length}, conflicts=${sortedConflicts.length}.`,
    });
  }
  return {legacyPairs, candidatePairs, missing, extra, conflicts: sortedConflicts, equal};
}

function collectCapabilityRecordConflicts(
  source: LegacyCapabilitySource,
  resolutions: MigrationResolutionItem[],
): readonly string[] {
  const conflicts: string[] = [];
  if (source.malformed) {
    throw new Error('Schema migration preview cannot address a legacy capability catalog that is not an array.');
  }
  const ids = new Set<string>();
  for (const capability of source.records) {
    if (!capability.isObject) {
      throw new Error(`Schema migration preview cannot address capability record ${capability.index}: it is not an object.`);
    }
    if (!capability.id) {
      throw new Error(`Schema migration preview cannot address capability record ${capability.index}: capability id is required.`);
    } else if (ids.has(capability.id)) {
      throw new Error(`Schema migration preview cannot address duplicate capability id ${capability.id}.`);
    } else {
      ids.add(capability.id);
    }
    if (!capability.title) {
      const detail = `capability:${capability.id} has no title.`;
      conflicts.push(detail);
      resolutions.push({code: 'CAPABILITY_RECORD_RESOLUTION', subject: `capability:${capability.id}`, detail: 'Provide the required schema 0.2 capability title before apply.'});
    }
  }
  return [...new Set(conflicts)].sort();
}

function previewArchitecture(
  source: Readonly<Record<string, unknown>> | undefined,
  resolutions: MigrationResolutionItem[],
): PreviewArchitecture {
  if (!source) {
    resolutions.push({
      code: 'ARCHITECTURE_LAYER_RESOLUTION', subject: 'architecture',
      detail: 'Provide the initial schema 0.2 architecture layers; the legacy workspace has no architecture record to project.',
    });
    return {status: 'resolution_required', rules: []};
  }
  const layers = losslessLayers(source.layers);
  let needsResolution = false;
  if (!layers) {
    needsResolution = true;
    resolutions.push({
      code: 'ARCHITECTURE_LAYER_RESOLUTION', subject: 'architecture',
      detail: 'Resolve the legacy object-form or lossy layers value; the preview does not manufacture layer meaning.',
    });
  }
  const pairs: ArchitecturePair[] = [];
  if (source.forbidden_imports !== undefined && !Array.isArray(source.forbidden_imports)) {
    needsResolution = true;
    resolutions.push({
      code: 'ARCHITECTURE_RULE_RESOLUTION', subject: 'architecture',
      detail: 'Resolve the non-array legacy forbidden_imports value without inventing an architecture rule.',
    });
  }
  if (Array.isArray(source.forbidden_imports)) {
    source.forbidden_imports.forEach((rawRule, index) => {
      const rule = objectOrNull(rawRule);
      const from = stringValue(rule?.from);
      const to = stringValue(rule?.to);
      if (!from || !to) {
        needsResolution = true;
        resolutions.push({
          code: 'ARCHITECTURE_RULE_RESOLUTION', subject: `architecture.rules[${index}]`,
          detail: 'Resolve a legacy forbidden-import pair with missing or invalid from/to; the preview does not guess direction.',
        });
        return;
      }
      pairs.push({from, to});
    });
  }
  const occurrences = new Map<string, number>();
  const rules = sortArchitecturePairs(pairs).map((pair) => {
    const pairKey = architecturePairKey(pair);
    const occurrence = occurrences.get(pairKey) ?? 0;
    occurrences.set(pairKey, occurrence + 1);
    const id = deterministicArchitectureRuleId(pair.from, pair.to, occurrence);
    needsResolution = true;
    resolutions.push({
      code: 'ARCHITECTURE_RULE_RATIONALE', subject: `architecture_rule:${id}`,
      detail: 'Provide a non-empty rule rationale; legacy YAML comments are not treated as structured rationale.',
    });
    if (occurrence > 0) {
      resolutions.push({
        code: 'ARCHITECTURE_RULE_RESOLUTION', subject: `architecture_rule:${id}`,
        detail: 'Resolve a duplicate legacy forbidden-import pair before strict schema 0.2 validation.',
      });
    }
    return {
      id,
      kind: 'forbidden_import' as const,
      from: pair.from,
      to: pair.to,
      status: 'rationale_required' as const,
    };
  });
  return {
    status: needsResolution ? 'resolution_required' : 'proposed',
    ...(layers ? {layers} : {}),
    rules,
  };
}

function losslessLayers(value: unknown): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const layers: string[][] = [];
  for (const rawLayer of value) {
    if (!Array.isArray(rawLayer) || rawLayer.length === 0 || rawLayer.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) return undefined;
    layers.push([...rawLayer]);
  }
  return layers;
}

function capabilityEdgeKey(pair: CapabilityEdgePair): string {
  return `${pair.capabilityId}\u0000${pair.featureId}`;
}

function sortCapabilityPairs(pairs: readonly CapabilityEdgePair[]): CapabilityEdgePair[] {
  return [...pairs].sort((left, right) => capabilityEdgeKey(left).localeCompare(capabilityEdgeKey(right)));
}

function architecturePairKey(pair: ArchitecturePair): string {
  return `${pair.from}\u0000${pair.to}`;
}

function sortArchitecturePairs(pairs: readonly ArchitecturePair[]): ArchitecturePair[] {
  return [...pairs].sort((left, right) => architecturePairKey(left).localeCompare(architecturePairKey(right)));
}

function scenarioRecords(values: readonly {readonly path: string; readonly value: unknown}[]): readonly {readonly path: string; readonly value: Record<string, unknown>}[] {
  return values.flatMap((document) => {
    const record = objectOrNull(document.value);
    if (document.path === 'spec.yaml') return Array.isArray(record?.scenarios)
      ? record.scenarios.map((scenario) => ({path: document.path, value: objectOrNull(scenario) ?? {}}))
      : [];
    return record ? [{path: document.path, value: record}] : [];
  });
}

function objectOrNull(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
