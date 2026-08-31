// Cladding · Spec 0.2 F3 · schema 0.2 catalog and architecture contract kernels.

import {createHash} from 'node:crypto';

import {isNewId, newIdFromDigest} from './id-policy.js';
import type {
  CompilerDiagnostic,
  Schema02ArchitectureContract,
  Schema02ArchitectureRuleContract,
  Schema02CapabilityContract,
  Schema02CriterionContract,
  Schema02FeatureContract,
  Schema02FeatureStatus,
  Schema02ProjectContract,
  Schema02ScenarioContract,
  Schema02StrictFeatureContract,
  Schema02StrictProjectContract,
} from './types.js';

type ContractPathPart = string | number;

/**
 * One validation result that the compiler maps to an authored source locator.
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 */
export interface Schema02ValidationIssue {
  /** Stable diagnostic class emitted by the compiler. */
  readonly code: CompilerDiagnostic['code'];
  /** Source-relative YAML path that owns the failure. */
  readonly path: readonly ContractPathPart[];
  /** Technical diagnostic text for developer tooling. */
  readonly message: string;
}

/**
 * Result of validating a schema 0.2 project region.
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 */
export interface Schema02ProjectValidation {
  /** Fully typed value only when every required policy is explicit and valid. */
  readonly value?: Schema02StrictProjectContract;
  /** Source-local validation failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/**
 * Result of validating the canonical capability catalog.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export interface Schema02CatalogValidation {
  /** Fully typed catalog only when all records have the canonical shape. */
  readonly value?: readonly Schema02CapabilityContract[];
  /** Source-local validation failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/**
 * Result of extracting a feature's F3-owned contract fields.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export interface Schema02FeatureValidation {
  /** Fully typed feature contribution only after its explicit links are valid. */
  readonly value?: Schema02StrictFeatureContract;
  /** Source-local validation failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/** Receipt identities already proven to match the exact current feature nodes.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface Schema02FeatureBaselineProjection {
  /** Exact receipt exemption that permits this feature's missing purpose. */
  readonly featureBaselineIdentity?: string;
  /** Exact receipt exemptions that permit individual legacy criterion classifications. */
  readonly criterionBaselineIdentities?: ReadonlyMap<string, string>;
}

/** A feature projection that can be strict or receipt-backed.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface Schema02ProjectedFeatureValidation {
  /** Fully typed feature contribution only after every non-exempt field is valid. */
  readonly value?: Schema02FeatureContract;
  /** Source-local validation failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/** A project projection that can be strict or receipt-backed.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface Schema02ProjectedProjectValidation {
  /** Fully typed project contribution only after every non-exempt field is valid. */
  readonly value?: Schema02ProjectContract;
  /** Source-local validation failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/** Classification of one parsed scenario target before coverage policy applies.
 * @see docs/design/spec-0.2/model-and-migration.md#d09--scenario-contract
 */
export type Schema02ScenarioCompleteness = 'complete' | 'hollow' | 'malformed';

/** Result of validating a single schema 0.2 scenario artifact.
 * @see docs/design/spec-0.2/model-and-migration.md#d09--scenario-contract
 */
export interface Schema02ScenarioValidation {
  /** Complete scenarios are the only scenarios admitted to the compiler contract. */
  readonly value?: Schema02ScenarioContract;
  /** Typed-but-empty journey fields are hollow rather than malformed. */
  readonly completeness: Schema02ScenarioCompleteness;
  /** Source-local schema and duplicate-reference failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/**
 * Result of validating the canonical architecture contract.
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export interface Schema02ArchitectureValidation {
  /** Fully typed architecture only when layers and every rule are valid. */
  readonly value?: Schema02ArchitectureContract;
  /** Source-local validation failures. */
  readonly issues: readonly Schema02ValidationIssue[];
}

/**
 * Validates the explicit schema 0.2 project policies without changing retained
 * runtime, oracle, independence, deliverable, smoke, or AI-hint policy values.
 *
 * @param project - Decoded `spec.yaml#project` value.
 * @returns A typed policy record only when no required F3 policy is missing.
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 */
export function validateSchema02Project(project: unknown): Schema02ProjectValidation {
  const result = validateSchema02ProjectProjection(project);
  const value = result.value;
  return value && !('baselineIdentity' in value) ? {value, issues: result.issues} : {issues: result.issues};
}

/**
 * Validates a project after the compiler proved one exact baseline exemption
 * still matches. This never makes the strict standalone validator permissive.
 *
 * @param project - Decoded `spec.yaml#project` value.
 * @param baselineIdentity - Immutable exemption identity, if the compiler matched one.
 * @returns A strict or receipt-backed project projection.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function validateSchema02ProjectWithBaseline(
  project: unknown,
  baselineIdentity?: string,
): Schema02ProjectedProjectValidation {
  return validateSchema02ProjectProjection(project, baselineIdentity);
}

function validateSchema02ProjectProjection(
  project: unknown,
  baselineIdentity?: string,
): Schema02ProjectedProjectValidation {
  const record = recordOf(project);
  if (!record) {
    return {issues: [issue('INVALID_ROOT', [], 'spec.yaml project must be an object')]};
  }
  const issues: Schema02ValidationIssue[] = [];
  rejectUnknownKeys(record, new Set([
    'name', 'language', 'description', 'version', 'repository', 'onboarding_seeded',
    'purpose', 'assurance_level', 'scenario_policy',
    'require_oracles', 'oracle_policy', 'independence_policy', 'deliverable', 'smoke', 'ai_hints',
  ]), issues, 'project');
  const name = nonEmptyString(record.name);
  const language = nonEmptyString(record.language);
  const purpose = nonEmptyString(record.purpose);
  const baselinePurposeShape = record.purpose === undefined || typeof record.purpose === 'string';
  if (!name) issues.push(issue('INVALID_SCHEMA_02', ['name'], 'project.name must remain a non-empty string'));
  if (!language) issues.push(issue('INVALID_SCHEMA_02', ['language'], 'project.language must remain a non-empty string'));
  if (!purpose && (!baselineIdentity || !baselinePurposeShape)) issues.push(issue('INVALID_SCHEMA_02', ['purpose'], 'project.purpose must be a non-empty string in schema 0.2'));
  validateOptionalProjectField(record, 'description', 'string', issues);
  validateOptionalProjectField(record, 'version', 'string', issues);
  validateOptionalProjectField(record, 'repository', 'string', issues);
  validateOptionalProjectField(record, 'onboarding_seeded', 'boolean', issues);
  const assuranceLevel = record.assurance_level;
  if (assuranceLevel !== 'L1' && assuranceLevel !== 'L2' && assuranceLevel !== 'L3' && assuranceLevel !== 'L4') {
    issues.push(issue('INVALID_SCHEMA_02', ['assurance_level'], 'project.assurance_level must explicitly be L1, L2, L3, or L4'));
  }
  const scenarioPolicy = record.scenario_policy;
  if (scenarioPolicy !== 'off' && scenarioPolicy !== 'advisory' && scenarioPolicy !== 'required') {
    issues.push(issue('INVALID_SCHEMA_02', ['scenario_policy'], 'project.scenario_policy must explicitly be off, advisory, or required'));
  }
  if (issues.length > 0 || !name || !language || (!purpose && (!baselineIdentity || !baselinePurposeShape)) || !isAssuranceLevel(assuranceLevel) || !isScenarioPolicy(scenarioPolicy)) return {issues};
  const common = {
    name,
    language,
    ...(typeof record.description === 'string' ? {description: record.description} : {}),
    ...(typeof record.version === 'string' ? {version: record.version} : {}),
    ...(typeof record.repository === 'string' ? {repository: record.repository} : {}),
    ...(typeof record.onboarding_seeded === 'boolean' ? {onboardingSeeded: record.onboarding_seeded} : {}),
    assuranceLevel,
    scenarioPolicy,
    retainedPolicies: retainedProjectPolicies(record),
  } as const;
  if (purpose) return {value: {...common, purpose}, issues};
  if (!baselineIdentity) return {issues};
  return {value: {...common, baselineIdentity}, issues};
}

/**
 * Validates `spec/capabilities.yaml` as the sole schema 0.2 capability source.
 *
 * @param catalog - Decoded capability artifact.
 * @returns A sorted canonical catalog or source-local shape failures.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export function validateSchema02CapabilityCatalog(catalog: unknown): Schema02CatalogValidation {
  const record = recordOf(catalog);
  if (!record) return {issues: [issue('INVALID_SCHEMA_02', [], 'spec/capabilities.yaml must contain an object')]};
  const issues: Schema02ValidationIssue[] = [];
  rejectUnknownKeys(record, new Set(['capabilities', 'schema', 'source']), issues, 'capability catalog');
  if (!Array.isArray(record.capabilities)) {
    issues.push(issue('INVALID_SCHEMA_02', ['capabilities'], 'spec/capabilities.yaml requires a capabilities array'));
    return {issues};
  }
  const capabilities: Schema02CapabilityContract[] = [];
  const ids = new Set<string>();
  record.capabilities.forEach((raw, index) => {
    const capability = recordOf(raw);
    const prefix: readonly ContractPathPart[] = ['capabilities', index];
    if (!capability) {
      issues.push(issue('INVALID_SCHEMA_02', prefix, 'each schema 0.2 capability must be an object'));
      return;
    }
    rejectUnknownKeys(capability, new Set(['id', 'title', 'outcome']), issues, `capability at index ${index}`, prefix);
    const id = nonEmptyString(capability.id);
    const title = nonEmptyString(capability.title);
    const outcome = nonEmptyString(capability.outcome);
    if (!id) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'id'], 'capability.id must be a non-empty string'));
    if (!title) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'title'], 'capability.title must be a non-empty string'));
    if (!outcome) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'outcome'], 'capability.outcome must be a non-empty string'));
    if (id && ids.has(id)) issues.push(issue('DUPLICATE_IDENTIFIER', [...prefix, 'id'], `duplicate capability id ${id}`));
    if (id) ids.add(id);
    if (id && title && outcome) capabilities.push({id, title, outcome});
  });
  if (issues.length > 0) return {issues};
  return {value: capabilities.sort((left, right) => left.id.localeCompare(right.id)), issues};
}

/**
 * Extracts a feature's explicit capability contribution and criterion constraint
 * data; strict statement validation remains in the shared F2 parser path.
 *
 * @param feature - Decoded feature shard.
 * @returns A sorted contribution record or F3-owned shape failures.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export function validateSchema02FeatureContract(feature: unknown): Schema02FeatureValidation {
  const result = validateSchema02FeatureProjection(feature);
  const value = result.value;
  return value && !('baselineIdentity' in value) ? {value, issues: result.issues} : {issues: result.issues};
}

/**
 * Validates a feature after the compiler proved each supplied receipt identity
 * still matches its exact legacy node. Strict callers must use the strict
 * validator above, which never accepts missing purpose or criterion kind.
 *
 * @param feature - Decoded schema 0.2 feature shard.
 * @param baseline - Exact matching receipt identities, if any.
 * @returns A strict or receipt-backed feature projection.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function validateSchema02FeatureContractWithBaseline(
  feature: unknown,
  baseline: Schema02FeatureBaselineProjection = {},
): Schema02ProjectedFeatureValidation {
  return validateSchema02FeatureProjection(feature, baseline);
}

function validateSchema02FeatureProjection(
  feature: unknown,
  baseline: Schema02FeatureBaselineProjection = {},
): Schema02ProjectedFeatureValidation {
  const record = recordOf(feature);
  if (!record) return {issues: [issue('INVALID_FEATURE', [], 'feature shard must contain an object')]};
  const issues: Schema02ValidationIssue[] = [];
  rejectUnknownKeys(record, new Set([
    'id', 'title', 'status', 'purpose', 'modules', 'depends_on', 'capability_refs',
    'acceptance_criteria', 'design_impact', 'archived_at', 'archive_reason', 'superseded_by', 'blocked_reason',
    'notes', 'schema', 'source', 'slug',
  ]), issues, 'feature');
  const id = nonEmptyString(record.id);
  const title = nonEmptyString(record.title);
  const rawStatus = record.status;
  const status = featureStatus(rawStatus) ? rawStatus : undefined;
  const purpose = nonEmptyString(record.purpose);
  const featureBaselineIdentity = baseline.featureBaselineIdentity;
  const baselinePurposeShape = record.purpose === undefined || typeof record.purpose === 'string';
  if (!purpose && (!featureBaselineIdentity || !baselinePurposeShape)) {
    issues.push(issue('INVALID_SCHEMA_02', ['purpose'], 'feature.purpose must be a non-empty string in schema 0.2'));
  }
  const modules = optionalStringArray(record, 'modules', [], issues, 'feature.modules');
  const dependsOn = optionalStringArray(record, 'depends_on', [], issues, 'feature.depends_on');
  const designImpact = optionalRecord(record, 'design_impact', issues, 'feature.design_impact');
  const archivedAt = optionalString(record, 'archived_at', [], issues, 'feature.archived_at');
  const archiveReason = optionalString(record, 'archive_reason', [], issues, 'feature.archive_reason');
  const supersededBy = optionalString(record, 'superseded_by', [], issues, 'feature.superseded_by');
  const blockedReason = optionalString(record, 'blocked_reason', [], issues, 'feature.blocked_reason', true);
  if (!status) issues.push(issue('INVALID_SCHEMA_02', ['status'], 'feature.status must be planned, in_progress, done, blocked, or archived'));
  if (status === 'blocked' && !blockedReason) {
    issues.push(issue('INVALID_SCHEMA_02', ['blocked_reason'], 'feature.blocked_reason must be a non-empty string when status is blocked'));
  }
  if (status !== undefined && status !== 'blocked' && Object.hasOwn(record, 'blocked_reason')) {
    issues.push(issue('INVALID_SCHEMA_02', ['blocked_reason'], 'feature.blocked_reason is allowed only when status is blocked'));
  }
  const capabilityRefs = explicitStringArray(record, 'capability_refs', [], issues, 'feature.capability_refs');
  const criteria: Schema02CriterionContract[] = [];
  if (!Array.isArray(record.acceptance_criteria)) {
    issues.push(issue('INVALID_SCHEMA_02', ['acceptance_criteria'], 'feature.acceptance_criteria must be an array in schema 0.2'));
  } else {
    record.acceptance_criteria.forEach((raw, index) => {
      const criterion = recordOf(raw);
      const prefix: readonly ContractPathPart[] = ['acceptance_criteria', index];
      if (!criterion) {
        issues.push(issue('INVALID_SCHEMA_02', prefix, 'each acceptance criterion must be an object'));
        return;
      }
      rejectUnknownKeys(criterion, new Set([
        'id', 'kind', 'statement', 'rationale', 'constraint_refs', 'oracle_refs', 'evidence_refs', 'notes',
        'ears', 'condition', 'action', 'response', 'text', 'test_refs', 'adr_refs',
      ]), issues, `criterion at index ${index}`, prefix);
      const criterionId = nonEmptyString(criterion.id);
      const kind = criterion.kind;
      const statement = nonEmptyString(criterion.statement);
      const criterionBaselineIdentity = criterionId === undefined
        ? undefined
        : baseline.criterionBaselineIdentities?.get(criterionId);
      const rationale = criterion.rationale === undefined ? undefined : nonEmptyString(criterion.rationale);
      if (criterion.rationale !== undefined && !rationale) {
        issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'rationale'], 'criterion.rationale must be a non-empty string when supplied'));
      }
      const constraintRefs = explicitStringArray(criterion, 'constraint_refs', prefix, issues, 'criterion.constraint_refs', false) ?? [];
      const oracleRefs = optionalStringArray(criterion, 'oracle_refs', prefix, issues, 'criterion.oracle_refs');
      const evidenceRefs = optionalStringArray(criterion, 'evidence_refs', prefix, issues, 'criterion.evidence_refs');
      const notes = optionalString(criterion, 'notes', prefix, issues, 'criterion.notes');
      if (!criterionId) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'id'], 'criterion.id must be a non-empty string'));
      if (!isCriterionKind(kind) && !criterionBaselineIdentity) {
        issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'kind'], 'criterion.kind must be behavior, quality, or constraint'));
      }
      if (criterionBaselineIdentity && kind !== undefined && kind !== 'legacy_unclassified') {
        issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'kind'], 'a receipt-backed criterion may retain only an omitted or legacy_unclassified kind'));
      }
      if (!statement) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'statement'], 'criterion.statement must be a non-empty string'));
      if (kind === 'constraint' && !rationale && constraintRefs.length === 0) {
        issues.push(issue('INVALID_SCHEMA_02', prefix, 'a constraint criterion requires a non-empty local rationale or resolving constraint_refs'));
      }
      if (!criterionId || (!isCriterionKind(kind) && !criterionBaselineIdentity) || !statement) return;
      const common = {
        id: criterionId,
        statement,
        ...(rationale ? {rationale} : {}),
        constraintRefs: [...constraintRefs].sort(),
        ...(oracleRefs === undefined ? {} : {oracleRefs}),
        ...(evidenceRefs === undefined ? {} : {evidenceRefs}),
        ...(notes === undefined ? {} : {notes}),
      } as const;
      if (criterionBaselineIdentity) {
        criteria.push({...common, kind: 'legacy_unclassified', baselineIdentity: criterionBaselineIdentity});
      } else if (isCriterionKind(kind)) {
        criteria.push({...common, kind});
      }
    });
  }
  if (!id || !title || !status || (!purpose && (!featureBaselineIdentity || !baselinePurposeShape)) || !capabilityRefs || issues.length > 0 || criteria.length !== (record.acceptance_criteria as readonly unknown[] | undefined)?.length) {
    return {issues};
  }
  const common = {
    id,
    title,
    status,
    ...(modules === undefined ? {} : {modules}),
    ...(dependsOn === undefined ? {} : {dependsOn}),
    ...(designImpact === undefined ? {} : {designImpact}),
    ...(archivedAt === undefined ? {} : {archivedAt}),
    ...(archiveReason === undefined ? {} : {archiveReason}),
    ...(supersededBy === undefined ? {} : {supersededBy}),
    ...(blockedReason === undefined ? {} : {blockedReason}),
    capabilityRefs: [...capabilityRefs].sort(),
    acceptanceCriteria: criteria.sort((left, right) => left.id.localeCompare(right.id)),
  } as const;
  if (purpose) return {value: {...common, purpose}, issues};
  if (!featureBaselineIdentity) return {issues};
  return {value: {...common, baselineIdentity: featureBaselineIdentity}, issues};
}

/**
 * Validates one canonical schema 0.2 scenario target. Field shape and
 * reference spelling are always structural; the caller alone applies the
 * project coverage policy to a missing or correctly typed hollow journey.
 *
 * @param scenario - Decoded scenario artifact.
 * @returns A complete contract record, a hollow classification, or blocking shape issues.
 * @see docs/design/spec-0.2/model-and-migration.md#d09--scenario-contract
 */
export function validateSchema02ScenarioContract(scenario: unknown): Schema02ScenarioValidation {
  const record = recordOf(scenario);
  if (!record) {
    return {
      completeness: 'malformed',
      issues: [issue('INVALID_SCHEMA_02', [], 'schema 0.2 scenario must contain an object')],
    };
  }
  const issues: Schema02ValidationIssue[] = [];
  rejectUnknownKeys(record, new Set(['id', 'title', 'actor', 'goal', 'success', 'steps', 'feature_refs']), issues, 'scenario');
  const id = nonEmptyString(record.id);
  const title = nonEmptyString(record.title);
  const actor = scenarioString(record, 'actor', issues, 'scenario.actor');
  const goal = scenarioString(record, 'goal', issues, 'scenario.goal');
  const success = scenarioString(record, 'success', issues, 'scenario.success');
  const steps = scenarioStringArray(record, 'steps', issues, 'scenario.steps');
  const featureRefs = scenarioStringArray(record, 'feature_refs', issues, 'scenario.feature_refs');
  if (!id) issues.push(issue('INVALID_SCHEMA_02', ['id'], 'scenario.id must be a non-empty string'));
  if (!title) issues.push(issue('INVALID_SCHEMA_02', ['title'], 'scenario.title must be a non-empty string'));
  if (issues.length > 0 || !id || !title) {
    return {completeness: 'malformed', issues};
  }
  if (!actor || !actor.trim() || !goal || !goal.trim() || !success || !success.trim()
    || !steps || steps.length === 0 || steps.some((step) => !step.trim())
    || !featureRefs || featureRefs.length === 0 || featureRefs.some((featureRef) => !featureRef.trim())) {
    return {completeness: 'hollow', issues};
  }
  return {
    completeness: 'complete',
    value: {
      id,
      title,
      actor,
      goal,
      success,
      steps,
      featureRefs,
    },
    issues,
  };
}

/**
 * Validates `spec/architecture.yaml` without treating YAML comments as rule
 * rationale or changing the required importer-to-dependency direction.
 *
 * @param architecture - Decoded architecture artifact.
 * @returns A typed boundary contract or source-local shape failures.
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export function validateSchema02Architecture(architecture: unknown): Schema02ArchitectureValidation {
  const record = recordOf(architecture);
  if (!record) return {issues: [issue('INVALID_SCHEMA_02', [], 'spec/architecture.yaml must contain an object')]};
  const issues: Schema02ValidationIssue[] = [];
  rejectUnknownKeys(record, new Set(['layers', 'rules', 'schema', 'source', 'forbidden_imports']), issues, 'architecture');
  const layers = validateLayers(record.layers, issues);
  const rules = validateArchitectureRules(record.rules, issues);
  if (!layers || !rules || issues.length > 0) return {issues};
  return {value: {layers, rules}, issues};
}

/**
 * Creates a stable AR id from a legacy import-pair structure only.
 *
 * The digest deliberately excludes comments and prose, so a migration never
 * turns explanatory YAML into manufactured architectural meaning.
 *
 * @param from - Importing layer from the legacy pair.
 * @param to - Imported dependency layer from the legacy pair.
 * @param occurrence - Stable zero-based duplicate position after pair sorting.
 * @returns An executable-policy conforming architecture rule identifier.
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export function deterministicArchitectureRuleId(from: string, to: string, occurrence: number = 0): string {
  const structuralKey = `forbidden_import\u0000${from}\u0000${to}\u0000${occurrence}`;
  return newIdFromDigest('architecture_rule', createHash('sha256').update(structuralKey).digest('hex'));
}

function validateLayers(value: unknown, issues: Schema02ValidationIssue[]): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('INVALID_SCHEMA_02', ['layers'], 'architecture.layers must be an ordered string[][] value'));
    return undefined;
  }
  const layers: string[][] = [];
  value.forEach((rawLayer, layerIndex) => {
    if (!Array.isArray(rawLayer) || rawLayer.length === 0) {
      issues.push(issue('INVALID_SCHEMA_02', ['layers', layerIndex], 'each architecture layer must be a non-empty string[]'));
      return;
    }
    const layer: string[] = [];
    rawLayer.forEach((rawName, nameIndex) => {
      const name = nonEmptyString(rawName);
      if (!name) {
        issues.push(issue('INVALID_SCHEMA_02', ['layers', layerIndex, nameIndex], 'architecture layer names must be non-empty strings'));
        return;
      }
      layer.push(name);
    });
    layers.push(layer);
  });
  return layers;
}

function validateArchitectureRules(value: unknown, issues: Schema02ValidationIssue[]): readonly Schema02ArchitectureRuleContract[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('INVALID_SCHEMA_02', ['rules'], 'architecture.rules must be an array'));
    return undefined;
  }
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const rules: Schema02ArchitectureRuleContract[] = [];
  value.forEach((raw, index) => {
    const record = recordOf(raw);
    const prefix: readonly ContractPathPart[] = ['rules', index];
    if (!record) {
      issues.push(issue('INVALID_SCHEMA_02', prefix, 'each architecture rule must be an object'));
      return;
    }
    rejectUnknownKeys(record, new Set(['id', 'kind', 'from', 'to', 'rationale']), issues, `architecture rule at index ${index}`, prefix);
    const id = nonEmptyString(record.id);
    const from = nonEmptyString(record.from);
    const to = nonEmptyString(record.to);
    const rationale = nonEmptyString(record.rationale);
    if (!id || !isNewId('architecture_rule', id)) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'id'], 'architecture rule ids must use the executable AR-<8 lowercase hex> policy'));
    if (record.kind !== 'forbidden_import') issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'kind'], 'architecture rule kind must be forbidden_import'));
    if (!from) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'from'], 'architecture rule from must name the importing layer'));
    if (!to) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'to'], 'architecture rule to must name the imported dependency layer'));
    if (!rationale) issues.push(issue('INVALID_SCHEMA_02', [...prefix, 'rationale'], 'architecture rule rationale must be a non-empty string'));
    if (id && ids.has(id)) issues.push(issue('DUPLICATE_IDENTIFIER', [...prefix, 'id'], `duplicate architecture rule id ${id}`));
    if (id) ids.add(id);
    const pair = from && to ? `forbidden_import\u0000${from}\u0000${to}` : undefined;
    if (pair && pairs.has(pair)) issues.push(issue('DUPLICATE_IDENTIFIER', prefix, `duplicate forbidden import from ${from} to ${to}`));
    if (pair) pairs.add(pair);
    if (id && from && to && rationale && record.kind === 'forbidden_import') rules.push({id, kind: 'forbidden_import', from, to, rationale});
  });
  return rules.sort((left, right) => left.id.localeCompare(right.id));
}

function explicitStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
  prefix: readonly ContractPathPart[],
  issues: Schema02ValidationIssue[],
  label: string,
  required: boolean = true,
): readonly string[] | undefined {
  if (!Object.hasOwn(record, field)) {
    if (required) issues.push(issue('INVALID_SCHEMA_02', [...prefix, field], `${label} must be explicitly persisted as an array`));
    return required ? undefined : [];
  }
  const value = record[field];
  if (!Array.isArray(value)) {
    issues.push(issue('INVALID_SCHEMA_02', [...prefix, field], `${label} must be an array of non-empty strings`));
    return undefined;
  }
  const values: string[] = [];
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const entry = nonEmptyString(raw);
    if (!entry) {
      issues.push(issue('INVALID_SCHEMA_02', [...prefix, field, index], `${label} entries must be non-empty strings`));
      return;
    }
    if (seen.has(entry)) issues.push(issue('DUPLICATE_IDENTIFIER', [...prefix, field, index], `${label} must not repeat ${entry}`));
    seen.add(entry);
    values.push(entry);
  });
  return values;
}

function optionalStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
  prefix: readonly ContractPathPart[],
  issues: Schema02ValidationIssue[],
  label: string,
): readonly string[] | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return explicitStringArray(record, field, prefix, issues, label, false);
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  prefix: readonly ContractPathPart[],
  issues: Schema02ValidationIssue[],
  label: string,
  nonEmpty: boolean = false,
): string | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== 'string' || (nonEmpty && value.trim().length === 0)) {
    issues.push(issue('INVALID_SCHEMA_02', [...prefix, field], `${label} must be ${nonEmpty ? 'a non-empty ' : 'a '}string when supplied`));
    return undefined;
  }
  return value;
}

function scenarioString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  issues: Schema02ValidationIssue[],
  label: string,
): string | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  if (typeof record[field] !== 'string') {
    issues.push(issue('INVALID_SCHEMA_02', [field], `${label} must be a string`));
    return undefined;
  }
  return record[field] as string;
}

/** Validates scenario arrays while retaining empty, correctly typed entries for D09 policy handling. */
function scenarioStringArray(
  record: Readonly<Record<string, unknown>>,
  field: 'steps' | 'feature_refs',
  issues: Schema02ValidationIssue[],
  label: string,
): readonly string[] | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  const value = record[field];
  if (!Array.isArray(value)) {
    issues.push(issue('INVALID_SCHEMA_02', [field], `${label} must be an array of strings`));
    return undefined;
  }
  const values: string[] = [];
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    if (typeof raw !== 'string') {
      issues.push(issue('INVALID_SCHEMA_02', [field, index], `${label} entries must be strings`));
      return;
    }
    if (raw.trim() && seen.has(raw)) {
      issues.push(issue('DUPLICATE_IDENTIFIER', [field, index], `${label} must not repeat ${raw}`));
    }
    if (raw.trim()) seen.add(raw);
    values.push(raw);
  });
  return values;
}

function optionalRecord(
  record: Readonly<Record<string, unknown>>,
  field: string,
  issues: Schema02ValidationIssue[],
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  const value = recordOf(record[field]);
  if (!value) {
    issues.push(issue('INVALID_SCHEMA_02', [field], `${label} must be an object when supplied`));
    return undefined;
  }
  return value;
}

function rejectUnknownKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  issues: Schema02ValidationIssue[],
  label: string,
  prefix: readonly ContractPathPart[] = [],
): void {
  Object.keys(record).sort().forEach((key) => {
    if (allowed.has(key) && !isLegacySchema02Field(key)) return;
    const code = isLegacySchema02Field(key) ? 'LEGACY_FIELD' : 'INVALID_SCHEMA_02';
    issues.push(issue(code, [...prefix, key], `${label} must not contain ${key} in schema 0.2`));
  });
}

function retainedProjectPolicies(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const retained = [
    'require_oracles', 'oracle_policy', 'independence_policy', 'deliverable', 'smoke', 'ai_hints',
  ].filter((key) => Object.hasOwn(record, key)).sort();
  return Object.fromEntries(retained.map((key) => [key, record[key]]));
}

function isLegacySchema02Field(key: string): boolean {
  return new Set([
    'schema', 'source', 'summary', 'surface', 'features', 'forbidden_imports', 'intent_summary',
    'slug', 'flow', 'ears', 'condition', 'action', 'response', 'text', 'test_refs', 'adr_refs',
  ]).has(key);
}

function validateOptionalProjectField(
  record: Readonly<Record<string, unknown>>,
  field: 'description' | 'version' | 'repository' | 'onboarding_seeded',
  type: 'string' | 'boolean',
  issues: Schema02ValidationIssue[],
): void {
  if (Object.hasOwn(record, field) && typeof record[field] !== type) {
    issues.push(issue('INVALID_SCHEMA_02', [field], `project.${field} must be a ${type} when supplied`));
  }
}

function isAssuranceLevel(value: unknown): value is Schema02ProjectContract['assuranceLevel'] {
  return value === 'L1' || value === 'L2' || value === 'L3' || value === 'L4';
}

function isScenarioPolicy(value: unknown): value is Schema02ProjectContract['scenarioPolicy'] {
  return value === 'off' || value === 'advisory' || value === 'required';
}

function isCriterionKind(value: unknown): value is 'behavior' | 'quality' | 'constraint' {
  return value === 'behavior' || value === 'quality' || value === 'constraint';
}

function featureStatus(value: unknown): value is Schema02FeatureStatus {
  return value === 'planned' || value === 'in_progress' || value === 'done' || value === 'blocked' || value === 'archived';
}

function issue(code: CompilerDiagnostic['code'], path: readonly ContractPathPart[], message: string): Schema02ValidationIssue {
  return {code, path, message};
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
