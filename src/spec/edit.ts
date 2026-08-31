// Cladding · Spec 0.2 F4 · typed, journaled specification edits.

import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

import yaml from 'yaml';
import {z} from 'zod';

import {enrichEventPayload, newEvent, type EventType} from '../events/log.js';
import type {IndependenceLabel} from '../hitl/independence.js';
import {computeSpecDigest, readGitHead} from '../core/checkpoint.js';
import {normalizeArtifactPath, resolveArtifactDescriptors} from './compiler/artifact-registry.js';
import {assertNewShardFilename, isNewId, isReadableId, isReadableShardFilename, shardFilenameSlug} from './compiler/id-policy.js';
import {
  previewSchema02Migration,
  serializeMigrationPreview,
  type MigrationPreview,
  type PreviewReviewedTestCandidate,
} from './compiler/migration-preview.js';
import {
  validateSchema02Architecture,
  validateSchema02CapabilityCatalog,
  validateSchema02FeatureContract,
  validateSchema02Project,
} from './compiler/schema-02-contract.js';
import {
  compareCodeUnits,
  criterionFinalIntentFromRecord,
  criterionFinalIntentSha256,
  LEGACY_L2_OBLIGATIONS,
  legacyL2CandidateCensusSha256,
  legacyL2CandidateSha256,
  legacyL2ResolutionSha256,
  legacyExemptionMatches,
  legacyStructuralReviewMatches,
  validateMigrationBaseline,
  type LegacyL2Authorization,
  type LegacyL2BaselineDecision,
  type MigrationBaseline,
  type ReviewedCriterionCarryForward,
} from './compiler/migration-baseline.js';
import {upsertInventoryBlock} from './inventory.js';
import {computeInventory, inventoryTestFileSetDigest} from './inventory.js';
import {renderDocLinksYaml} from './doc-references.js';
import {parseStrictStatement} from './statement-parser.js';
import {inferDependsOn} from '../optimizer/infer-depends-on.js';
import {currentSafeBindingCensus} from '../proof/current-bindings.js';
import {
  commitSpecTransactionFiles,
  managedSpecWorkspaceDigest,
  readSpecTransactionBytes,
  readSpecTransactionRecoveryReceipt,
  recoverSpecTransaction,
  reclaimSpecTransactionLockForTesting,
  requiredRootSchema,
  SpecEditError,
  withStableSpecWorkspaceSnapshot,
  withSpecWorkspaceLock,
  type RootWriteRegion,
  type SpecEditCode,
  type SpecTransactionRecoveryReceipt,
  type TransactionFile,
} from './transaction.js';
import type {Spec} from './types.js';

const ABSENT = '<cladding:absent>';
const RULE_ID = /^AR-[a-f0-9]{8}$/;
const SLUG = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_EDIT_PACKET_BYTES = 16 * 1024;
const MAX_EDIT_OPERATIONS = 128;
const SHA256_HEX = /^[a-f0-9]{64}$/;

type JsonRecord = Record<string, unknown>;

/** Byte-bound live proof census required by a completed migration drop decision. */
interface MigrationLiveProofCensus {
  /** Exact current criterion addresses supplied to the F5 source adapter. */
  readonly criteria: readonly string[];
  /** Digest of the supported source bytes that justified the decision. */
  readonly digest: string;
}

/** Stable internal outcomes for typed edit callers. */
export {
  reclaimSpecTransactionLockForTesting,
  recoverSpecTransaction,
  readSpecTransactionRecoveryReceipt,
  SpecEditError,
  withSpecWorkspaceLock,
};
export type {RootWriteRegion, SpecEditCode, SpecTransactionRecoveryReceipt};

/** Typed operations accepted by the F4 transaction authority. */
export type SpecEditOperation =
  | {readonly kind: 'project.set_description'; readonly description?: string}
  | {readonly kind: 'project.set_purpose'; readonly purpose: string}
  | {readonly kind: 'project.set_policy'; readonly assuranceLevel?: 'L1' | 'L2' | 'L3' | 'L4'; readonly scenarioPolicy?: 'off' | 'advisory' | 'required'}
  | {readonly kind: 'feature.create'; readonly id: string; readonly slug: string; readonly title: string; readonly purpose: string; readonly modules?: readonly string[]; readonly dependsOn?: readonly string[]; readonly capabilityRefs?: readonly string[]; readonly criteria?: readonly CriterionInput[]}
  | {readonly kind: 'feature.begin'; readonly featureId: string}
  | {readonly kind: 'feature.block'; readonly featureId: string; readonly reason: string}
  | {readonly kind: 'feature.archive'; readonly featureId: string; readonly reason: string; readonly supersededBy?: string}
  | {readonly kind: 'feature.set_title'; readonly featureId: string; readonly title: string}
  | {readonly kind: 'feature.set_purpose'; readonly featureId: string; readonly purpose: string}
  | {readonly kind: 'feature.set_links'; readonly featureId: string; readonly modules?: readonly string[]; readonly dependsOn?: readonly string[]; readonly capabilityRefs?: readonly string[]}
  | {readonly kind: 'feature.set_design_impact'; readonly featureId: string; readonly designImpact?: Readonly<JsonRecord>}
  | {readonly kind: 'criterion.upsert'; readonly featureId: string; readonly criterion: CriterionInput}
  | {readonly kind: 'criterion.remove'; readonly featureId: string; readonly criterionId: string}
  | {readonly kind: 'criterion.set_proof_refs'; readonly featureId: string; readonly criterionId: string; readonly oracleRefs?: readonly string[]; readonly evidenceRefs?: readonly string[]}
  | {readonly kind: 'capability.upsert'; readonly capability: {readonly id: string; readonly title: string; readonly outcome: string}}
  | {readonly kind: 'capability.remove'; readonly capabilityId: string}
  | {readonly kind: 'architecture.set_layers'; readonly layers: readonly (readonly string[])[]}
  | {readonly kind: 'architecture_rule.upsert'; readonly rule: {readonly id: string; readonly kind: 'forbidden_import'; readonly from: string; readonly to: string; readonly rationale: string}}
  | {readonly kind: 'architecture_rule.remove'; readonly ruleId: string}
  | {readonly kind: 'scenario.upsert'; readonly scenario: ScenarioInput}
  | {readonly kind: 'scenario.remove'; readonly scenarioId: string}
  | {readonly kind: 'dependency.promote'; readonly featureId: string; readonly candidate: string}
  | {readonly kind: 'evidence.revoke'; readonly featureId: string; readonly digest: string}
  | {readonly kind: 'project.upgrade_schema'; readonly resolutions: MigrationResolutionPayload};

/** One strict criterion payload accepted by create and upsert. */
export interface CriterionInput {
  readonly id: string;
  readonly kind: 'behavior' | 'quality' | 'constraint';
  readonly statement: string;
  readonly rationale?: string;
  readonly constraintRefs?: readonly string[];
  readonly oracleRefs?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly notes?: string;
}

/** One strict scenario payload accepted by upsert. */
export interface ScenarioInput {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly actor: string;
  readonly goal: string;
  readonly success: string;
  readonly steps: readonly string[];
  readonly featureRefs: readonly string[];
}

/** Explicit human decisions for a migration preview; no resolution is inferred. */
export interface MigrationResolutionPayload {
  /** Digest of the read-only preview the operator reviewed; the corpus never rides the edit packet. */
  readonly previewDigest: string;
  readonly confirmed: readonly {readonly code: string; readonly subject: string; readonly value?: unknown}[];
}

const wireCriterion = z.object({id: z.string(), kind: z.enum(['behavior', 'quality', 'constraint']), statement: z.string(), rationale: z.string().optional(), constraintRefs: z.array(z.string()).optional(), oracleRefs: z.array(z.string()).optional(), evidenceRefs: z.array(z.string()).optional(), notes: z.string().optional()}).strict();
const wireScenario = z.object({id: z.string(), slug: z.string(), title: z.string(), actor: z.string(), goal: z.string(), success: z.string(), steps: z.array(z.string()), featureRefs: z.array(z.string())}).strict();
const wireConfirmed = z.object({code: z.string(), subject: z.string(), value: z.unknown().optional()}).strict();
const wireDesignImpact = z.discriminatedUnion('classification', [
  z.object({classification: z.literal('none'), rationale: z.string(), status: z.literal('resolved').optional()}).strict(),
  z.object({classification: z.literal('additive'), rationale: z.string(), status: z.literal('resolved').optional()}).strict(),
  z.object({classification: z.literal('structural'), rationale: z.string(), status: z.enum(['review_required', 'resolved']).optional(), artifacts: z.array(z.string())}).strict(),
]);

/** Closed MCP/CLI operation grammar. Runtime parsing below consumes this exact union. */
export const specEditOperationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('project.set_description'), description: z.string().optional()}).strict(),
  z.object({kind: z.literal('project.set_purpose'), purpose: z.string()}).strict(),
  z.object({kind: z.literal('project.set_policy'), assuranceLevel: z.enum(['L1', 'L2', 'L3', 'L4']).optional(), scenarioPolicy: z.enum(['off', 'advisory', 'required']).optional()}).strict(),
  z.object({kind: z.literal('feature.create'), id: z.string(), slug: z.string(), title: z.string(), purpose: z.string(), modules: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(), capabilityRefs: z.array(z.string()).optional(), criteria: z.array(wireCriterion).optional()}).strict(),
  z.object({kind: z.literal('feature.begin'), featureId: z.string()}).strict(),
  z.object({kind: z.literal('feature.block'), featureId: z.string(), reason: z.string()}).strict(),
  z.object({kind: z.literal('feature.archive'), featureId: z.string(), reason: z.string(), supersededBy: z.string().optional()}).strict(),
  z.object({kind: z.literal('feature.set_title'), featureId: z.string(), title: z.string()}).strict(),
  z.object({kind: z.literal('feature.set_purpose'), featureId: z.string(), purpose: z.string()}).strict(),
  z.object({kind: z.literal('feature.set_links'), featureId: z.string(), modules: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(), capabilityRefs: z.array(z.string()).optional()}).strict(),
  z.object({kind: z.literal('feature.set_design_impact'), featureId: z.string(), designImpact: wireDesignImpact.optional()}).strict(),
  z.object({kind: z.literal('criterion.upsert'), featureId: z.string(), criterion: wireCriterion}).strict(),
  z.object({kind: z.literal('criterion.remove'), featureId: z.string(), criterionId: z.string()}).strict(),
  z.object({kind: z.literal('criterion.set_proof_refs'), featureId: z.string(), criterionId: z.string(), oracleRefs: z.array(z.string()).optional(), evidenceRefs: z.array(z.string()).optional()}).strict(),
  z.object({kind: z.literal('capability.upsert'), capability: z.object({id: z.string(), title: z.string(), outcome: z.string()}).strict()}).strict(),
  z.object({kind: z.literal('capability.remove'), capabilityId: z.string()}).strict(),
  z.object({kind: z.literal('architecture.set_layers'), layers: z.array(z.array(z.string()))}).strict(),
  z.object({kind: z.literal('architecture_rule.upsert'), rule: z.object({id: z.string(), kind: z.literal('forbidden_import'), from: z.string(), to: z.string(), rationale: z.string()}).strict()}).strict(),
  z.object({kind: z.literal('architecture_rule.remove'), ruleId: z.string()}).strict(),
  z.object({kind: z.literal('scenario.upsert'), scenario: wireScenario}).strict(),
  z.object({kind: z.literal('scenario.remove'), scenarioId: z.string()}).strict(),
  z.object({kind: z.literal('dependency.promote'), featureId: z.string(), candidate: z.string()}).strict(),
  z.object({kind: z.literal('evidence.revoke'), featureId: z.string(), digest: z.string()}).strict(),
  z.object({kind: z.literal('project.upgrade_schema'), resolutions: z.object({previewDigest: z.string().regex(SHA256_HEX), confirmed: z.array(wireConfirmed)}).strict()}).strict(),
]);

/** Complete typed operation batch schema shared unchanged with MCP discovery. */
export const specEditOperationsSchema = z.array(specEditOperationSchema).min(1).max(MAX_EDIT_OPERATIONS);

/** Request sent to the sole typed write authority. */
export interface SpecEditRequest {
  readonly cwd?: string;
  readonly operations: readonly SpecEditOperation[];
  /** Byte hashes keyed by the canonical regions derived from the operations. */
  readonly inputRevisions: Readonly<Record<string, string>>;
  /** Projection-only value returned to support host delta reuse; never checked for authorization. */
  readonly contextRevision?: string;
  /** Test-only deterministic interruption point; production callers must omit it. */
  readonly testFaultAfterReplacements?: number;
  /** Test-only catchable I/O-failure point; unlike interruption it rolls back before returning. */
  readonly testErrorAfterReplacements?: number;
  /** Test-only hook executed after journal publication and before each replacement. */
  readonly testBeforeReplacement?: (path: string) => void;
}

/** Successful transaction result. */
export interface SpecEditResult {
  readonly changed: boolean;
  readonly inputRevisions: Readonly<Record<string, string>>;
  readonly contextRevision: string;
  readonly checkpointedFeatures: readonly string[];
}

/**
 * Parses untrusted transport input through the executable F4 operation registry.
 *
 * @param input - JSON-compatible operation values supplied by an MCP host.
 * @returns Closed, typed operations with no generic paths or lifecycle-done setter.
 * @throws SpecEditError before any lock, journal, or workspace write for malformed input.
 */
export function parseSpecEditOperations(input: unknown): readonly SpecEditOperation[] {
  if (!Array.isArray(input) || input.length === 0) throw invalid('A typed edit batch needs at least one operation.');
  if (input.length > MAX_EDIT_OPERATIONS || jsonBytes(input) > MAX_EDIT_PACKET_BYTES) throw invalid('A typed edit batch exceeds the 16 KiB / 128-operation transport limit.');
  const operations = input.map((value) => parseSpecEditOperation(value));
  if (operations.some((operation) => operation.kind === 'project.upgrade_schema') && operations.length !== 1) {
    throw invalid('Schema migration apply must be the sole operation in its transaction.');
  }
  return operations;
}

function parseSpecEditOperation(value: unknown): SpecEditOperation {
  const decoded = specEditOperationSchema.safeParse(value);
  if (!decoded.success) throw invalid(`Invalid typed specification operation: ${decoded.error.issues[0]?.message ?? 'invalid shape'}.`);
  const operation = record(decoded.data);
  const kind = text(operation.kind) as SpecEditOperation['kind'];
  if (['feature.begin', 'feature.block', 'feature.archive', 'feature.set_title', 'feature.set_purpose', 'feature.set_links', 'feature.set_design_impact', 'criterion.upsert', 'criterion.remove', 'criterion.set_proof_refs', 'dependency.promote', 'evidence.revoke'].includes(kind)
    && !isReadableId('feature', text(operation.featureId))) throw invalid(`${kind}.featureId is not a readable feature identifier.`);
  if (kind === 'feature.create' && !isNewId('feature', text(operation.id))) throw invalid(`${kind}.id must be a newly generated feature identifier.`);
  if (kind === 'scenario.remove' && !isReadableId('scenario', text(operation.scenarioId))) throw invalid(`${kind}.scenarioId is not a readable scenario identifier.`);
  const requiredString = (key: string): string => requireText(text(operation[key]), `${kind}.${key}`);
  const optionalString = (key: string): string | undefined => operation[key] === undefined ? undefined : requireText(text(operation[key]), `${kind}.${key}`);
  const optionalStrings = (key: string): readonly string[] | undefined => operation[key] === undefined ? undefined : strings(arrayStringsStrict(operation[key], `${kind}.${key}`), `${kind}.${key}`);
  switch (kind) {
    case 'project.set_description': return operation.description === undefined ? {kind} : {kind, description: requireText(text(operation.description), `${kind}.description`)};
    case 'project.set_purpose': return {kind, purpose: requiredString('purpose')};
    case 'project.set_policy': {
      const assuranceLevel = operation.assuranceLevel; const scenarioPolicy = operation.scenarioPolicy;
      if (assuranceLevel !== undefined && !['L1', 'L2', 'L3', 'L4'].includes(text(assuranceLevel))) throw invalid(`${kind}.assuranceLevel is invalid.`);
      if (scenarioPolicy !== undefined && !['off', 'advisory', 'required'].includes(text(scenarioPolicy))) throw invalid(`${kind}.scenarioPolicy is invalid.`);
      if (assuranceLevel === undefined && scenarioPolicy === undefined) throw invalid(`${kind} needs a policy value.`);
      return {kind, ...(assuranceLevel === undefined ? {} : {assuranceLevel: text(assuranceLevel) as 'L1' | 'L2' | 'L3' | 'L4'}), ...(scenarioPolicy === undefined ? {} : {scenarioPolicy: text(scenarioPolicy) as 'off' | 'advisory' | 'required'})};
    }
    case 'feature.create': return {kind, id: requiredString('id'), slug: requiredString('slug'), title: requiredString('title'), purpose: requiredString('purpose'), ...(optionalStrings('modules') === undefined ? {} : {modules: optionalStrings('modules')!}), ...(optionalStrings('dependsOn') === undefined ? {} : {dependsOn: optionalStrings('dependsOn')!}), ...(optionalStrings('capabilityRefs') === undefined ? {} : {capabilityRefs: optionalStrings('capabilityRefs')!}), ...(operation.criteria === undefined ? {} : {criteria: arrayRecordsStrict(operation.criteria, `${kind}.criteria`).map(parseCriterion)})};
    case 'feature.begin': return {kind, featureId: requiredString('featureId')};
    case 'feature.block': return {kind, featureId: requiredString('featureId'), reason: requiredString('reason')};
    case 'feature.archive': return {kind, featureId: requiredString('featureId'), reason: requiredString('reason'), ...(optionalString('supersededBy') === undefined ? {} : {supersededBy: optionalString('supersededBy')!})};
    case 'feature.set_title': return {kind, featureId: requiredString('featureId'), title: requiredString('title')};
    case 'feature.set_purpose': return {kind, featureId: requiredString('featureId'), purpose: requiredString('purpose')};
    case 'feature.set_links': {
      const modules = optionalStrings('modules'); const dependsOn = optionalStrings('dependsOn'); const capabilityRefs = optionalStrings('capabilityRefs');
      if (modules === undefined && dependsOn === undefined && capabilityRefs === undefined) throw invalid(`${kind} needs at least one replacement field.`);
      return {kind, featureId: requiredString('featureId'), ...(modules === undefined ? {} : {modules}), ...(dependsOn === undefined ? {} : {dependsOn}), ...(capabilityRefs === undefined ? {} : {capabilityRefs})};
    }
    case 'feature.set_design_impact': return {kind, featureId: requiredString('featureId'), ...(operation.designImpact === undefined ? {} : {designImpact: parseDesignImpact(recordStrict(operation.designImpact, `${kind}.designImpact`))})};
    case 'criterion.upsert': return {kind, featureId: requiredString('featureId'), criterion: parseCriterion(recordStrict(operation.criterion, `${kind}.criterion`))};
    case 'criterion.remove': return {kind, featureId: requiredString('featureId'), criterionId: requiredString('criterionId')};
    case 'criterion.set_proof_refs': {
      const oracleRefs = optionalStrings('oracleRefs'); const evidenceRefs = optionalStrings('evidenceRefs'); if (oracleRefs === undefined && evidenceRefs === undefined) throw invalid(`${kind} needs a proof reference field.`);
      return {kind, featureId: requiredString('featureId'), criterionId: requiredString('criterionId'), ...(oracleRefs === undefined ? {} : {oracleRefs}), ...(evidenceRefs === undefined ? {} : {evidenceRefs})};
    }
    case 'capability.upsert': { const capability = recordStrict(operation.capability, `${kind}.capability`); rejectKeys(capability, ['id', 'title', 'outcome'], `${kind}.capability`); return {kind, capability: {id: requireText(text(capability.id), 'capability id'), title: requireText(text(capability.title), 'capability title'), outcome: requireText(text(capability.outcome), 'capability outcome')}}; }
    case 'capability.remove': return {kind, capabilityId: requiredString('capabilityId')};
    case 'architecture.set_layers': return {kind, layers: arrayStrict(operation.layers, `${kind}.layers`).map((layer) => strings(arrayStringsStrict(layer, `${kind}.layer`), `${kind}.layer`))};
    case 'architecture_rule.upsert': { const rule = recordStrict(operation.rule, `${kind}.rule`); rejectKeys(rule, ['id', 'kind', 'from', 'to', 'rationale'], `${kind}.rule`); if (rule.kind !== 'forbidden_import') throw invalid(`${kind}.rule.kind is invalid.`); return {kind, rule: {id: requiredRecordString(rule, 'id'), kind: 'forbidden_import', from: requiredRecordString(rule, 'from'), to: requiredRecordString(rule, 'to'), rationale: requiredRecordString(rule, 'rationale')}}; }
    case 'architecture_rule.remove': return {kind, ruleId: requiredString('ruleId')};
    case 'scenario.upsert': return {kind, scenario: parseScenario(recordStrict(operation.scenario, `${kind}.scenario`))};
    case 'scenario.remove': return {kind, scenarioId: requiredString('scenarioId')};
    case 'dependency.promote': return {kind, featureId: requiredString('featureId'), candidate: requiredString('candidate')};
    case 'evidence.revoke': return {kind, featureId: requiredString('featureId'), digest: requiredString('digest')};
    case 'project.upgrade_schema': {
      const resolutions = recordStrict(operation.resolutions, `${kind}.resolutions`); rejectKeys(resolutions, ['previewDigest', 'confirmed'], `${kind}.resolutions`);
      const previewDigest = requireText(text(resolutions.previewDigest), `${kind}.resolutions.previewDigest`);
      if (!/^[a-f0-9]{64}$/.test(previewDigest)) throw invalid(`${kind}.resolutions.previewDigest must be a SHA-256 digest.`);
      const confirmed = arrayRecordsStrict(resolutions.confirmed, `${kind}.resolutions.confirmed`).map((entry) => { rejectKeys(entry, ['code', 'subject', 'value'], `${kind}.resolution`); return {code: requiredRecordString(entry, 'code'), subject: requiredRecordString(entry, 'subject'), ...(entry.value === undefined ? {} : {value: entry.value})}; });
      return {kind, resolutions: {previewDigest, confirmed}};
    }
  }
}

function parseCriterion(value: JsonRecord): CriterionInput {
  rejectKeys(value, ['id', 'kind', 'statement', 'rationale', 'constraintRefs', 'oracleRefs', 'evidenceRefs', 'notes'], 'criterion');
  const kind = value.kind;
  if (kind !== 'behavior' && kind !== 'quality' && kind !== 'constraint') throw invalid('criterion.kind is invalid.');
  return {id: requiredRecordString(value, 'id'), kind, statement: requiredRecordString(value, 'statement'), ...(value.rationale === undefined ? {} : {rationale: requiredRecordString(value, 'rationale')}), ...(value.constraintRefs === undefined ? {} : {constraintRefs: strings(arrayStringsStrict(value.constraintRefs, 'criterion.constraintRefs'), 'criterion.constraintRefs')}), ...(value.oracleRefs === undefined ? {} : {oracleRefs: strings(arrayStringsStrict(value.oracleRefs, 'criterion.oracleRefs'), 'criterion.oracleRefs')}), ...(value.evidenceRefs === undefined ? {} : {evidenceRefs: strings(arrayStringsStrict(value.evidenceRefs, 'criterion.evidenceRefs'), 'criterion.evidenceRefs')}), ...(value.notes === undefined ? {} : {notes: requiredRecordString(value, 'notes')})};
}

function parseScenario(value: JsonRecord): ScenarioInput {
  rejectKeys(value, ['id', 'slug', 'title', 'actor', 'goal', 'success', 'steps', 'featureRefs'], 'scenario');
  const steps = strings(arrayStringsStrict(value.steps, 'scenario.steps'), 'scenario.steps');
  const featureRefs = strings(arrayStringsStrict(value.featureRefs, 'scenario.featureRefs'), 'scenario.featureRefs');
  if (steps.length === 0) throw invalid('scenario.steps must contain at least one journey step.');
  if (featureRefs.length === 0) throw invalid('scenario.featureRefs must resolve at least one feature.');
  return {id: requiredRecordString(value, 'id'), slug: requiredRecordString(value, 'slug'), title: requiredRecordString(value, 'title'), actor: requiredRecordString(value, 'actor'), goal: requiredRecordString(value, 'goal'), success: requiredRecordString(value, 'success'), steps, featureRefs};
}

function parseDesignImpact(value: JsonRecord): JsonRecord {
  rejectKeys(value, ['classification', 'rationale', 'status', 'artifacts'], 'design impact');
  const classification = text(value.classification);
  if (!['none', 'additive', 'structural'].includes(classification)) throw invalid('design impact classification is invalid.');
  const rationale = requireText(text(value.rationale), 'design impact rationale');
  const status = value.status === undefined ? undefined : text(value.status);
  if (status !== undefined && !['resolved', 'review_required'].includes(status)) throw invalid('design impact status is invalid.');
  const artifacts = value.artifacts === undefined ? undefined : strings(arrayStringsStrict(value.artifacts, 'design impact artifacts'), 'design impact artifacts');
  return {classification, rationale, ...(status === undefined ? {} : {status}), ...(artifacts === undefined ? {} : {artifacts})};
}

type PlannedFile = TransactionFile;
const readBytes = readSpecTransactionBytes;
function readYaml(cwd: string, path: string): JsonRecord {
  const bytes = readBytes(cwd, path);
  return bytes === null ? {} : record(yaml.parse(bytes));
}

interface FeatureDocument {
  readonly id: string;
  readonly path: string;
  readonly value: JsonRecord;
}

/**
 * Returns canonical region revisions required by a typed batch.
 *
 * @param cwd - Workspace root.
 * @param operations - Typed batch whose registry-owned write regions are inspected.
 * @returns Region hashes suitable only as optimistic write preconditions.
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 */
export function readSpecEditRevisions(cwd: string, operations: readonly SpecEditOperation[]): Readonly<Record<string, string>> {
  const parsed = parseSpecEditOperations(operations);
  return readParsedSpecEditRevisions(cwd, parsed);
}

/**
 * Applies a locally supplied schema-migration resolution payload through the
 * same exclusive F4 transaction used by the typed edit authority.
 *
 * The local CLI reads decisions from an operator-provided file rather than an
 * agent task packet. It therefore validates the closed migration operation
 * grammar without applying the `spec-edit` transport ceiling to the reviewed
 * corpus of decisions.
 *
 * @param cwd - Workspace root containing the reviewed schema 0.1 source.
 * @param resolutions - Exact operator decisions bound to the preview digest.
 * @returns The journaled migration result, including a no-change replay.
 * @throws SpecEditError when the payload, preview, revisions, or transaction cannot be accepted.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function applyLocalSchemaMigration(cwd: string, resolutions: unknown): SpecEditResult {
  // This is intentionally not an escape hatch for arbitrary typed edits. The
  // fixed singleton retains project.upgrade_schema's closed grammar and the
  // same optimistic revision check as every F4 transaction.
  jsonBytes(resolutions);
  const operation = parseSpecEditOperation({kind: 'project.upgrade_schema', resolutions}) as Extract<SpecEditOperation, {readonly kind: 'project.upgrade_schema'}>;
  const operations: readonly SpecEditOperation[] = [operation];
  const root = resolve(cwd);
  return applyParsedSpecEdit({
    cwd: root,
    operations,
    inputRevisions: readParsedSpecEditRevisions(root, operations),
  }, operations);
}

/** Returns canonical region revisions for already-validated in-process operations. */
function readParsedSpecEditRevisions(cwd: string, operations: readonly SpecEditOperation[]): Readonly<Record<string, string>> {
  return withSpecWorkspaceLock(cwd, () => {
    const regions = regionsForOperations(cwd, operations);
    return Object.fromEntries([...regions].sort().map((region) => [region, hashRegion(cwd, region)]));
  });
}

/** Returns the projection revision and canonical write revisions for a proposed typed batch. */
export function prepareSpecEdit(cwd: string, operations: unknown): {readonly contextRevision: string; readonly inputRevisions: Readonly<Record<string, string>>} {
  const parsed = parseSpecEditOperations(operations);
  // Prepare is intentionally lock-free: it validates a disposable candidate,
  // then returns optimistic region bytes. Commit repeats this work under lock.
  return withStableSpecWorkspaceSnapshot(cwd, () => {
    applyOperationsInMemory(cwd, parsed, false);
    const regions = regionsForOperations(cwd, parsed);
    return {
      contextRevision: workspaceHash(cwd),
      inputRevisions: Object.fromEntries([...regions].sort().map((region) => [region, hashRegion(cwd, region)])),
    };
  });
}

/**
 * Applies a complete typed batch under the workspace journal boundary.
 *
 * @param request - Batch and registry-derived region preconditions.
 * @returns Post-commit revisions and the projection revision.
 * @throws SpecEditError when validation, staleness, recovery, or lock acquisition rejects the batch.
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 */
export function editSpec(request: SpecEditRequest): SpecEditResult {
  if (jsonBytes({operations: request.operations, inputRevisions: request.inputRevisions, contextRevision: request.contextRevision}) > MAX_EDIT_PACKET_BYTES) {
    throw new SpecEditError('INVALID_OPERATION', 'Typed edit request exceeds the 16 KiB transport limit.');
  }
  return applyParsedSpecEdit(request, parseSpecEditOperations(request.operations));
}

/** Applies a validated operation batch without reclassifying a local migration as transport. */
function applyParsedSpecEdit(request: SpecEditRequest, operations: readonly SpecEditOperation[]): SpecEditResult {
  const cwd = resolve(request.cwd ?? '.');
  if (request.contextRevision !== undefined && !SHA256_HEX.test(request.contextRevision)) {
    throw new SpecEditError('INVALID_OPERATION', 'Context revision must be a SHA-256 projection digest.');
  }
  const expectedRegions = regionsForOperations(cwd, operations);
  const suppliedRegions = Object.keys(request.inputRevisions).sort();
  const derivedRegions = [...expectedRegions].sort();
  if (canonicalJson(suppliedRegions) !== canonicalJson(derivedRegions)) {
    throw new SpecEditError('INVALID_OPERATION', 'Input revisions must name exactly the canonical write regions for this typed batch.');
  }
  for (const region of expectedRegions) {
    const revision = request.inputRevisions[region];
    if (!revision) {
      throw new SpecEditError('INVALID_OPERATION', `Missing input revision for canonical region ${region}.`);
    }
    if (!SHA256_HEX.test(revision)) {
      throw new SpecEditError('INVALID_OPERATION', `Input revision for canonical region ${region} must be a SHA-256 digest.`);
    }
  }
  // Fail invalid batches before contending for the short commit lock. This is
  // advisory only; the authoritative application below reloads under lock.
  withStableSpecWorkspaceSnapshot(cwd, () => applyOperationsInMemory(cwd, operations, false));
  return withSpecWorkspaceLock(cwd, () => {
    const actual = readSpecEditRevisionsWithoutRecovery(cwd, operations);
    for (const region of expectedRegions) {
      if (actual[region] !== request.inputRevisions[region]) {
        throw new SpecEditError('STALE_INPUT', `The ${region} input changed since it was read.`);
      }
    }
    const plan = applyOperationsInMemory(cwd, operations, true);
    let files = addDerivedProjectionWrites(cwd, plan.files, plan.inventoryNeeded, plan.migrationTestFileCount);
    if (plan.migrationApplied) {
      if (plan.migrationTestFileSetDigest === undefined || inventoryTestFileSetDigest(cwd) !== plan.migrationTestFileSetDigest
        || plan.migrationPreviewDigest === undefined
        || migrationPreviewDigest(previewSchema02Migration(cwd, {lockHeld: true})) !== plan.migrationPreviewDigest) {
        throw new SpecEditError('STALE_INPUT', 'The migration preview inputs changed before its journal could be published.');
      }
      files = addMigrationOldPathProjectionWrites(cwd, files);
      assertMigrationPathsClean(cwd, files);
      if (plan.migrationLiveProofCensus !== undefined
        && !migrationLiveProofCensusMatches(cwd, plan.migrationLiveProofCensus)) {
        throw new SpecEditError('STALE_INPUT', 'The live migration proof source changed before its journal could be published.');
      }
    }
    if (files.length === 0) {
      return {changed: false, inputRevisions: actual, contextRevision: workspaceHash(cwd), checkpointedFeatures: []};
    }
    commitSpecTransactionFiles(cwd, files, request.testFaultAfterReplacements, request.testErrorAfterReplacements, request.testBeforeReplacement);
    const revisions = readSpecEditRevisionsWithoutRecovery(cwd, operations);
    return {
      changed: true,
      inputRevisions: revisions,
      contextRevision: workspaceHash(cwd),
      checkpointedFeatures: plan.checkpointedFeatures,
    };
  });
}

/**
 * Performs the private first half of the exclusive `clad done` transition.
 *
 * @param cwd - Workspace root.
 * @param featureId - Feature that has already entered the active cycle.
 * @returns The prior status and shard path for an exact red-gate restoration.
 * @throws SpecEditError when a schema 0.2 feature is not in progress.
 * @internal
 */
export interface DoneGateRollback {
  /** Exact pre-gate bytes and post-flip hashes retained for legacy callers. */
  readonly files: readonly {readonly path: string; readonly before: string | null; readonly postHash: string; readonly rootRegions?: readonly RootWriteRegion[]}[];
  /** The only authored artifact compensation may change after a red gate. */
  readonly feature: {
    readonly path: string;
    readonly before: string;
    readonly postHash: string;
    readonly previousStatus?: string;
  };
}

/** Private capability created only by the schema-0.2 prepare step. */
interface PreparedSchema02Completion {
  readonly root: string;
  readonly featureId: string;
  readonly rollback: DoneGateRollback;
  readonly featurePath: string;
  readonly sourceBytes: string;
  readonly targetBytes: string;
  readonly targetGeneration: string;
  readonly rootBefore: string;
  readonly attestationBefore: string | null;
  readonly rollbackFiles: string;
  readonly previousStatus: string | undefined;
}

// A completion packet is not a transport format. Its rollback must be the
// exact in-process object minted while markFeatureDoneForGate held F4; spreads,
// JSON, and caller-built lookalikes intentionally lose this capability.
const PREPARED_SCHEMA02_COMPLETIONS = new WeakMap<DoneGateRollback, PreparedSchema02Completion>();

/** The locked feature state a done gate is permitted to evaluate. */
export interface DoneGateScope {
  /** Modules from the feature snapshot actually marked done. */
  readonly modules: readonly string[];
  /** Latest design-impact lifecycle state from that same locked snapshot. */
  readonly designImpactStatus?: string;
}

/** Result of the provisional done transition consumed by the gate boundary. */
export interface DoneGateMark {
  /** Status observed under the lock immediately before the provisional flip. */
  readonly previousStatus: string;
  /** Absolute path to the locked feature artifact. */
  readonly path: string;
  /** Exact source state needed for a red or stale compensation. */
  readonly rollback: DoneGateRollback;
  /** The schema that supplied the locked feature state. */
  readonly schemaVersion: '0.1' | '0.2';
  /** Scope captured with the locked feature that the gate is evaluating. */
  readonly gateScope: DoneGateScope;
  /** Hash of the provisional target feature bytes, excluding derived artifacts. */
  readonly targetGeneration: string;
  /** Exact schema-0.2 feature bytes that the final transaction may publish. */
  readonly targetBytes: string;
  /** Root preimage held from preparation through the final writer lock. */
  readonly rootBefore: string;
  /** Attestation preimage held from preparation through the final writer lock. */
  readonly attestationBefore: string | null;
}

// The mark itself is also a capability. Retaining only its rollback would let
// a copied outer packet replay a prepared completion across calls.
const PREPARED_SCHEMA02_DONE_GATES = new WeakMap<DoneGateMark, PreparedSchema02Completion>();
const CONSUMED_SCHEMA02_DONE_GATES = new WeakSet<DoneGateMark>();

/** Outcome of checking that a GREEN gate still applies to its provisional target. */
export interface DoneGateFinalization {
  /** Whether the target remains exactly the generation the GREEN gate evaluated. */
  readonly kept: boolean;
  /** Whether a concurrent target change made the provisional result stale. */
  readonly stale: boolean;
}

/** A byte-bound legacy replacement submitted to the sole transaction authority. */
export interface Schema01CompatibilityReplacement {
  /** Managed repository-relative canonical artifact path. */
  readonly path: string;
  /** Bytes used to derive `after`; a mismatch is stale rather than a lost update. */
  readonly before: string | null;
  /** Exact replacement bytes. */
  readonly after: string;
  /** Required when this compatibility write replaces spec.yaml. */
  readonly rootRegions?: readonly RootWriteRegion[];
}

/** A legacy lifecycle event that must become durable with its source mutation. */
export interface Schema01CompatibilityEvent {
  readonly type: EventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** The only lifecycle event a schema-0.2 completion transaction may publish. */
export interface GeneratedAttestationSuccessEvent {
  readonly type: 'done_attempted';
  readonly payload: {
    readonly feature: string;
    readonly worst: 0;
    readonly anyFailed: false;
    readonly kept: true;
    readonly blockers: readonly [];
    readonly independence?: IndependenceLabel;
  };
}

/** Parsed target passed to the receipt renderer after the F4 lock validates it. */
export interface GeneratedAttestationCompletionTarget {
  readonly featureId: string;
  readonly feature: Readonly<JsonRecord>;
}

/** Optional derived projections that must share a legacy adapter's one journal. */
export interface Schema01CompatibilityOptions {
  /** Rebuild inventory and the feature index from the proposed byte overlay before commit. */
  readonly refreshDerived?: boolean;
}

/** A provisional schema-0.2 done target that must survive the attestation lock. */
export interface GeneratedAttestationCompletion {
  readonly rollback: DoneGateRollback;
  readonly targetGeneration: string;
  readonly targetBytes: string;
  readonly rootBefore: string;
  readonly attestationBefore: string | null;
  /** The canonical successful lifecycle record shares this transaction with the claim. */
  readonly event: GeneratedAttestationSuccessEvent;
  /** Test-only interruption before journal publication; production callers omit it. */
  readonly testBeforeCommit?: () => void;
}

/** Non-serializable event binding created by the `clad done` coordinator. */
export interface PreparedSchema02DoneEvent {
  readonly __schema02DoneEvent?: never;
}

/** Non-serializable writer phase issued to exactly one successful gate run. */
export interface PreparedSchema02DoneWriter {
  readonly __schema02DoneWriter?: never;
}

interface PreparedSchema02WriterPhase {
  readonly root: string;
  /** Root-and-feature epoch key whose current token owns the only writer. */
  readonly targetKey: string;
  readonly completion: PreparedSchema02Completion;
  readonly event: GeneratedAttestationSuccessEvent;
}

const PREPARED_SCHEMA02_DONE_EVENTS = new WeakMap<PreparedSchema02DoneEvent, {
  readonly root: string;
  readonly mark: DoneGateMark;
  readonly event: GeneratedAttestationSuccessEvent;
}>();
const PREPARED_SCHEMA02_DONE_WRITERS = new WeakMap<PreparedSchema02DoneWriter, PreparedSchema02WriterPhase>();
const CONSUMED_SCHEMA02_DONE_WRITERS = new WeakSet<PreparedSchema02DoneWriter>();
// Starting a newer gate must retire an older GREEN callback even if the newer
// run later fails.  The opaque writer object is the unforgeable epoch token.
const CURRENT_SCHEMA02_DONE_WRITERS = new Map<string, PreparedSchema02DoneWriter>();

/** Validates the private schema-0.2 gate capability before its stages can run. */
export function preparedSchema02DoneGate(cwd: string, mark: DoneGateMark): {readonly featureId: string} {
  const root = resolve(cwd);
  const prepared = PREPARED_SCHEMA02_DONE_GATES.get(mark);
  if (!prepared
    || CONSUMED_SCHEMA02_DONE_GATES.has(mark)
    || prepared.root !== workspaceIdentity(root)
    || mark.schemaVersion !== '0.2'
    || mark.previousStatus !== 'in_progress'
    || !sameWorkspacePath(mark.path, join(root, prepared.featurePath))
    || mark.rollback !== prepared.rollback
    || mark.rollback.feature.path !== prepared.featurePath
    || mark.rollback.feature.before !== prepared.sourceBytes
    || mark.rollback.feature.postHash !== prepared.targetGeneration
    || mark.rollback.feature.previousStatus !== prepared.previousStatus
    || canonicalJson(mark.rollback.files) !== prepared.rollbackFiles
    || mark.targetBytes !== prepared.targetBytes
    || mark.targetGeneration !== prepared.targetGeneration
    || hash(mark.targetBytes) !== mark.targetGeneration
    || mark.rootBefore !== prepared.rootBefore
    || mark.attestationBefore !== prepared.attestationBefore) {
    throw invalid('The schema-0.2 completion gate was not prepared for this workspace.');
  }
  return Object.freeze({featureId: prepared.featureId});
}

/** Binds the coordinator's sole success event before a schema-0.2 gate starts. */
export function prepareSchema02DoneEvent(
  cwd: string,
  mark: DoneGateMark,
  independence?: IndependenceLabel,
): PreparedSchema02DoneEvent {
  const capability = preparedSchema02DoneGate(cwd, mark);
  const payload: GeneratedAttestationSuccessEvent['payload'] = {
    feature: capability.featureId,
    worst: 0,
    anyFailed: false,
    kept: true,
    blockers: [],
    ...(independence === undefined ? {} : {independence}),
  };
  const event = Object.freeze({
    type: 'done_attempted' as const,
    payload: Object.freeze(payload),
  });
  const binding = Object.freeze({}) as PreparedSchema02DoneEvent;
  PREPARED_SCHEMA02_DONE_EVENTS.set(binding, Object.freeze({
    root: workspaceIdentity(cwd),
    mark,
    event,
  }));
  return binding;
}

/** Consumes a prepared mark before planning and issues its private writer phase. */
export function beginPreparedSchema02DoneGate(
  cwd: string,
  mark: DoneGateMark,
  eventBinding: PreparedSchema02DoneEvent,
): {readonly featureId: string; readonly writer: PreparedSchema02DoneWriter} {
  const capability = preparedSchema02DoneGate(cwd, mark);
  const binding = PREPARED_SCHEMA02_DONE_EVENTS.get(eventBinding);
  if (!binding || binding.root !== workspaceIdentity(cwd) || binding.mark !== mark) {
    throw invalid('The schema-0.2 completion event was not prepared for this gate.');
  }
  CONSUMED_SCHEMA02_DONE_GATES.add(mark);
  const writer = Object.freeze({}) as PreparedSchema02DoneWriter;
  const completion = PREPARED_SCHEMA02_COMPLETIONS.get(mark.rollback);
  if (!completion) throw invalid('The schema-0.2 completion gate lost its prepared target.');
  const root = workspaceIdentity(cwd);
  const targetKey = schema02WriterTargetKey(root, completion.featureId);
  PREPARED_SCHEMA02_DONE_WRITERS.set(writer, Object.freeze({
    root,
    targetKey,
    completion,
    event: binding.event,
  }));
  // This replaces the prior epoch before any planner or stage can run.  A RED
  // or thrown newer run intentionally leaves its predecessor retired.
  CURRENT_SCHEMA02_DONE_WRITERS.set(targetKey, writer);
  return Object.freeze({featureId: capability.featureId, writer});
}

/** Consumes a successful run's writer phase on its first valid commit attempt. */
export function consumePreparedSchema02DoneWriter(
  cwd: string,
  writer: PreparedSchema02DoneWriter,
  completion: GeneratedAttestationCompletion,
): void {
  const phase = PREPARED_SCHEMA02_DONE_WRITERS.get(writer);
  if (!phase
    || CONSUMED_SCHEMA02_DONE_WRITERS.has(writer)
    || phase.root !== workspaceIdentity(cwd)
    || CURRENT_SCHEMA02_DONE_WRITERS.get(phase.targetKey) !== writer) {
    throw invalid('The completion receipt does not belong to the current gate epoch.');
  }
  const target = validateGeneratedAttestationCompletion(completion, resolve(cwd));
  if (completion.rollback !== phase.completion.rollback
    || target.featureId !== phase.completion.featureId
    || canonicalJson(completion.event) !== canonicalJson(phase.event)) {
    throw invalid('The completion receipt does not belong to its successful gate run.');
  }
  CONSUMED_SCHEMA02_DONE_WRITERS.add(writer);
  CURRENT_SCHEMA02_DONE_WRITERS.delete(phase.targetKey);
}

/** Returns the canonical key for a root-local schema-0.2 completion epoch. */
function schema02WriterTargetKey(root: string, featureId: string): string {
  return `${root}\u0000${featureId}`;
}

/** Rejects a forged completion packet before the F4 journal can be published. */
function validateGeneratedAttestationCompletion(
  completion: GeneratedAttestationCompletion,
  expectedRoot?: string,
): GeneratedAttestationCompletionTarget {
  const prepared = PREPARED_SCHEMA02_COMPLETIONS.get(completion.rollback);
  if (!prepared
    || (expectedRoot !== undefined && prepared.root !== workspaceIdentity(expectedRoot))
    || completion.rollback.feature.path !== prepared.featurePath
    || completion.rollback.feature.before !== prepared.sourceBytes
    || completion.rollback.feature.postHash !== prepared.targetGeneration
    || completion.rollback.feature.previousStatus !== prepared.previousStatus
    || canonicalJson(completion.rollback.files) !== prepared.rollbackFiles
    || completion.targetBytes !== prepared.targetBytes
    || completion.targetGeneration !== prepared.targetGeneration
    || completion.rootBefore !== prepared.rootBefore
    || completion.attestationBefore !== prepared.attestationBefore
    || completion.targetGeneration !== completion.rollback.feature.postHash
    || hash(completion.targetBytes) !== completion.targetGeneration) {
    throw invalid('The completion packet was not prepared by the current schema-0.2 done transition.');
  }
  const source = parseCompletionFeature(completion.rollback.feature.before, 'completion source');
  const target = parseCompletionFeature(completion.targetBytes, 'completion target');
  const featureId = text(target.id);
  if (text(source.status) !== 'in_progress'
    || text(target.status) !== 'done'
    || !isReadableId('feature', featureId)
    || featureId !== text(source.id)) {
    throw invalid('The completion target feature identity is malformed.');
  }
  const expected = clone(source);
  expected.status = 'done';
  delete expected.blocked_reason;
  if (canonicalJson(target) !== canonicalJson(expected)) {
    throw invalid('The completion target must be the exact allowed done transition.');
  }
  const event = completion.event;
  const payload = event && event.payload;
  if (event?.type !== 'done_attempted'
    || !hasExactOwnKeys(event, ['payload', 'type'])
    || !payload
    || !hasExactOwnKeys(payload, payload.independence === undefined
      ? ['anyFailed', 'blockers', 'feature', 'kept', 'worst']
      : ['anyFailed', 'blockers', 'feature', 'independence', 'kept', 'worst'])
    || text(payload.feature) !== featureId
    || payload.worst !== 0
    || payload.kept !== true
    || payload.anyFailed !== false
    || !Array.isArray(payload.blockers)
    || payload.blockers.length !== 0
    || (payload.independence !== undefined
      && payload.independence !== 'independent'
      && payload.independence !== 'self-certified')) {
    throw invalid('A completion receipt needs the exact successful done_attempted event.');
  }
  return Object.freeze({featureId, feature: Object.freeze(target)});
}

/** Parses one feature replacement without treating a malformed YAML scalar as a feature. */
function parseCompletionFeature(bytes: string, name: string): JsonRecord {
  try {
    return recordStrict(yaml.parse(bytes), name);
  } catch (error) {
    if (error instanceof SpecEditError) throw error;
    throw invalid(`${name} is not valid YAML.`);
  }
}

/**
 * Commits a schema-0.1 adapter result under the same journal as schema-0.2 edits.
 *
 * The adapter supplies the source bytes it inspected. Under the lock those
 * bytes must still be current, otherwise the operation reports stale rather
 * than overwriting a concurrent legacy author. This intentionally leaves
 * schema-0.1 semantics intact without retaining a raw second write authority.
 */
export function commitSchema01CompatibilityMutation(
  cwd: string,
  replacements: readonly Schema01CompatibilityReplacement[],
  events: readonly Schema01CompatibilityEvent[] = [],
  options: Schema01CompatibilityOptions = {},
): void {
  const root = resolve(cwd);
  withSpecWorkspaceLock(root, () => {
    const schema = requiredRootSchema(root);
    if (schema !== '0.1') {
      throw new SpecEditError('STALE_INPUT', 'The workspace migrated to schema 0.2; retry through the typed edit boundary.');
    }
    const files: PlannedFile[] = replacements.map((replacement) => {
      const current = readBytes(root, replacement.path);
      if (current !== replacement.before) {
        throw new SpecEditError('STALE_INPUT', `The legacy source ${replacement.path} changed while the mutation was being prepared.`);
      }
      if (replacement.path === 'spec.yaml' && (!replacement.rootRegions || replacement.rootRegions.length === 0)) {
        throw invalid('A compatibility root replacement must declare its exact owned regions.');
      }
      return {
        path: replacement.path,
        before: current,
        after: replacement.after,
        ...(replacement.rootRegions === undefined ? {} : {rootRegions: replacement.rootRegions}),
      };
    });
    if (events.length > 0) {
      const path = '.cladding/events.log.jsonl';
      const before = readBytes(root, path) ?? '';
      const suffix = events.map((event) => JSON.stringify(newEvent(event.type, enrichEventPayload(root, {...event.payload})))).join('\n');
      files.push({path, before: before === '' && readBytes(root, path) === null ? null : before, after: `${before}${suffix}\n`});
    }
    const planned = options.refreshDerived ? addDerivedProjectionWrites(root, files, true) : files;
    if (planned.length > 0) commitSpecTransactionFiles(root, planned);
  });
}

/**
 * Replaces the generated verification receipt through the F4 journal.
 *
 * Attestation format remains owned by F6; this narrow adapter only supplies
 * the shared lock, stale preimage check, and crash recovery boundary.
 */
export function commitGeneratedAttestation(
  cwd: string,
  expectedRoot: string | null,
  expectedAttestation: string | null,
  renderCurrentAttestation: (target?: GeneratedAttestationCompletionTarget) => string,
  completion?: GeneratedAttestationCompletion,
): void {
  const root = resolve(cwd);
  withSpecWorkspaceLock(root, () => {
    const schema = requiredRootSchema(root);
    const completionTarget = completion === undefined ? undefined : validateGeneratedAttestationCompletion(completion, root);
    if (completionTarget !== undefined && schema !== '0.2') {
      throw invalid('A generated completion receipt is only valid for schema 0.2.');
    }
    // A completion's null receipt preimage means the receipt was absent at
    // preparation time. It is authoritative and must not fall back to bytes a
    // concurrent writer created between the gate and this final F4 lock.
    const rootBefore = completion === undefined ? expectedRoot : completion.rootBefore;
    const attestationBefore = completion === undefined ? expectedAttestation : completion.attestationBefore;
    if (rootBefore === null || readBytes(root, 'spec.yaml') !== rootBefore || readBytes(root, 'spec/attestation.yaml') !== attestationBefore) {
      throw new SpecEditError('STALE_INPUT', 'The workspace changed while the verification receipt was being prepared.');
    }
    if (!completion) {
      const nextAttestation = renderCurrentAttestation();
      commitSpecTransactionFiles(root, [{path: 'spec/attestation.yaml', before: attestationBefore, after: nextAttestation}]);
      return;
    }
    if (!completionTarget) throw invalid('A generated completion receipt needs a validated target.');
    // Schema 0.2 has deliberately not written a pending status.  The exact
    // original shard must still be present: a replacement, even one that also
    // says in_progress, invalidates the observations and publishes nothing.
    const target = readBytes(root, completion.rollback.feature.path);
    if (target !== completion.rollback.feature.before) {
      throw new SpecEditError('STALE_INPUT', 'The feature changed while its completion receipt was being prepared.');
    }
    // Revalidate the exact replacement as a schema-0.2 candidate while the
    // F4 lock excludes another writer. The receipt renderer receives this
    // same parsed target, so its prospective Spec cannot diverge from the
    // shard and generated projections about to enter the journal.
    validateCandidate(root, new Map([[completion.rollback.feature.path, {...completionTarget.feature}]]), readYaml(root, 'spec.yaml'));
    const nextAttestation = renderCurrentAttestation(completionTarget);
    const files = addDerivedProjectionWrites(root, [{
      path: completion.rollback.feature.path,
      before: target,
      after: completion.targetBytes,
    }], true);
    const byPath = new Map(files.map((file) => [file.path, file]));
    byPath.set('spec/attestation.yaml', {path: 'spec/attestation.yaml', before: attestationBefore, after: nextAttestation});
    const path = '.cladding/events.log.jsonl';
    const before = readBytes(root, path);
    const event = JSON.stringify(newEvent(completion.event.type, enrichEventPayload(root, {...completion.event.payload})));
    byPath.set(path, {path, before, after: `${before ?? ''}${event}\n`});
    completion.testBeforeCommit?.();
    commitSpecTransactionFiles(root, [...byPath.values()]);
  });
}

/**
 * Recomputes the inventory and feature index from one locked latest snapshot.
 *
 * This is the sole product-facing derived refresh path. It deliberately has no
 * caller revisions: derived projections are excluded from typed author input
 * preconditions, but still travel through the same durable journal.
 */
export function refreshDerivedSpecProjections(cwd: string = '.'): boolean {
  const root = resolve(cwd);
  if (!existsSync(join(root, 'spec.yaml'))) return false;
  return withSpecWorkspaceLock(root, () => {
    if (!existsSync(join(root, 'spec.yaml'))) return false;
    const byPath = new Map(addDerivedProjectionWrites(root, [], true).map((file) => [file.path, file]));
    const docLinks = renderDocLinksYaml(root);
    if (docLinks !== null) {
      const before = readBytes(root, 'spec/_doc-links.yaml');
      if (before !== docLinks) byPath.set('spec/_doc-links.yaml', {path: 'spec/_doc-links.yaml', before, after: docLinks});
    }
    const files = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
    if (files.length === 0) return false;
    commitSpecTransactionFiles(root, files);
    return true;
  });
}

export function markFeatureDoneForGate(cwd: string, featureId: string): DoneGateMark {
  const root = resolve(cwd);
  return withSpecWorkspaceLock(root, () => {
    const rawSchemaVersion = requiredRootSchema(root);
    if (rawSchemaVersion !== '0.1' && rawSchemaVersion !== '0.2') throw invalid('The workspace schema is not supported by the done boundary.');
    const schemaVersion: '0.1' | '0.2' = rawSchemaVersion;
    const found = findFeature(root, featureId, false)!;
    const before = readBytes(root, found.path);
    const rootBefore = readBytes(root, 'spec.yaml');
    const attestationBefore = readBytes(root, 'spec/attestation.yaml');
    if (before === null) throw lifecycle(`Feature ${featureId} disappeared before it could be completed.`);
    if (rootBefore === null) throw invalid('An initialized specification needs spec.yaml before it can be completed.');
    const designImpactStatus = text(record(found.value.design_impact).status) || undefined;
    if (designImpactStatus === 'review_required') {
      throw lifecycle('Structural design impact still needs review before this feature can be completed.');
    }
    const gateScope: DoneGateScope = {
      modules: arrayStrings(found.value.modules),
      ...(designImpactStatus === undefined ? {} : {designImpactStatus}),
    };
    let after: string;
    if (schemaVersion === '0.2') {
      if (found.value.status !== 'in_progress') throw lifecycle(`Only an in-progress feature can be completed in schema 0.2.`);
      const next = clone(found.value); next.status = 'done'; delete next.blocked_reason;
      validateCandidate(root, new Map([[found.path, next]]), readYaml(root, 'spec.yaml'));
      after = yaml.stringify(next);
    } else {
      after = replaceTopLevelStatus(before, 'done');
    }
    // Compatibility keeps its shipped flip-then-gate behavior.  Schema 0.2
    // instead returns a prospective target: no shard, generated projection,
    // receipt, or event is durable until a GREEN profile has produced a v3
    // receipt and the final writer has rechecked every preimage.
    const files = schemaVersion === '0.1'
      ? addDerivedProjectionWrites(root, [{path: found.path, before, after}], true)
      : [];
    if (files.length > 0) commitSpecTransactionFiles(root, files);
    const targetGeneration = hash(after);
    const rollback: DoneGateRollback = {
      files: files.map((file) => ({path: file.path, before: file.before, postHash: hash(file.after ?? ABSENT), ...(file.rootRegions === undefined ? {} : {rootRegions: file.rootRegions})})),
      feature: {path: found.path, before, postHash: targetGeneration, ...(typeof found.value.status === 'string' ? {previousStatus: found.value.status} : {})},
    };
    const mark: DoneGateMark = Object.freeze({
      previousStatus: text(found.value.status) || 'unset',
      path: join(root, found.path),
      rollback,
      schemaVersion,
      gateScope,
      targetGeneration,
      targetBytes: after,
      rootBefore,
      attestationBefore,
    });
    if (schemaVersion === '0.2') {
      const prepared = Object.freeze({
        root: workspaceIdentity(root),
        featureId: text(found.value.id),
        rollback,
        featurePath: found.path,
        sourceBytes: before,
        targetBytes: after,
        targetGeneration,
        rootBefore,
        attestationBefore,
        rollbackFiles: canonicalJson(rollback.files),
        previousStatus: rollback.feature.previousStatus,
      });
      PREPARED_SCHEMA02_COMPLETIONS.set(rollback, prepared);
      PREPARED_SCHEMA02_DONE_GATES.set(mark, prepared);
    }
    return mark;
  });
}

/**
 * Keeps a provisional done transition only when a GREEN gate still describes
 * the exact target feature generation it inspected.
 *
 * A concurrent write to another feature does not matter. A concurrent target
 * update does: when it remains `done`, only its status is compensated from the
 * latest bytes and the projections are rebuilt; when another writer already
 * changed its status, that status is left untouched.
 */
export function finalizeFeatureDoneForGate(
  cwd: string,
  rollback: DoneGateRollback,
  targetGeneration: string,
): DoneGateFinalization {
  const root = resolve(cwd);
  return withSpecWorkspaceLock(root, () => {
    const current = readBytes(root, rollback.feature.path);
    if (current !== null && hash(current) === targetGeneration) return {kept: true, stale: false};

    const source: PlannedFile[] = [];
    if (current !== null && statusOfFeatureBytes(current) === 'done') {
      const after = restoreTopLevelStatus(current, rollback.feature.previousStatus);
      if (after !== current) source.push({path: rollback.feature.path, before: current, after});
    }
    const files = addDerivedProjectionWrites(root, source, true);
    if (files.length > 0) commitSpecTransactionFiles(root, files);
    return {kept: false, stale: true};
  });
}

/** Replaces only the status line for legacy gate compatibility. */
function replaceTopLevelStatus(body: string, status: string): string {
  if (/^status:[ \t]*.*$/m.test(body)) return body.replace(/^status:[ \t]*.*$/m, `status: ${status}`);
  if (/^id:[ \t]*.*$/m.test(body)) return body.replace(/^(id:[ \t]*.*)$/m, `$1\nstatus: ${status}`);
  return `status: ${status}\n${body}`;
}

/** Restores a legacy-compatible top-level status while preserving unrelated current bytes. */
function restoreTopLevelStatus(body: string, status: string | undefined): string {
  if (status !== undefined) return replaceTopLevelStatus(body, status);
  return body.replace(/^status:[^\n]*(?:\n|$)/m, '');
}

/** Reads a status from a feature body without making malformed bytes writable. */
function statusOfFeatureBytes(body: string): string | undefined {
  try {
    const status = record(yaml.parse(body)).status;
    return typeof status === 'string' ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compensates a failed provisional done transition from the latest workspace.
 *
 * Derived projections are rebuilt from their latest source snapshot. That
 * preserves a concurrent edit to another feature while ensuring the index does
 * not continue to claim the failed target is done.
 *
 * @internal
 */
export function restoreFailedDoneForGate(cwd: string, rollback: DoneGateRollback): void {
  const root = resolve(cwd);
  withSpecWorkspaceLock(root, () => restoreFailedDoneForGateLocked(root, rollback));
}

/** Performs red/stale compensation while the caller already owns the F4 lock. */
function restoreFailedDoneForGateLocked(root: string, rollback: DoneGateRollback): void {
  const current = readBytes(root, rollback.feature.path);
  const source: PlannedFile[] = [];
  if (current !== null && statusOfFeatureBytes(current) === 'done') {
    const after = hash(current) === rollback.feature.postHash
      ? rollback.feature.before
      : restoreTopLevelStatus(current, rollback.feature.previousStatus);
    if (after !== current) source.push({path: rollback.feature.path, before: current, after});
  }
  const files = addDerivedProjectionWrites(root, source, true);
  if (files.length > 0) commitSpecTransactionFiles(root, files);
}

function readSpecEditRevisionsWithoutRecovery(cwd: string, operations: readonly SpecEditOperation[]): Readonly<Record<string, string>> {
  const regions = regionsForOperations(cwd, operations);
  return Object.fromEntries([...regions].sort().map((region) => [region, hashRegion(cwd, region)]));
}

function regionsForOperations(cwd: string, operations: readonly SpecEditOperation[]): Set<string> {
  const regions = new Set<string>();
  for (const operation of operations) {
    switch (operation.kind) {
      case 'project.set_description':
      case 'project.set_purpose':
      case 'project.set_policy': regions.add('project'); break;
      case 'project.upgrade_schema': regions.add('workspace'); break;
      case 'capability.upsert':
      case 'capability.remove': regions.add('capabilities'); break;
      case 'architecture.set_layers':
      case 'architecture_rule.upsert':
      case 'architecture_rule.remove': regions.add('architecture'); break;
      case 'scenario.upsert': regions.add(`scenario:${operation.scenario.id}`); break;
      case 'scenario.remove': regions.add(`scenario:${operation.scenarioId}`); break;
      case 'evidence.revoke': regions.add(`evidence:${operation.featureId}/${operation.digest}`); break;
      case 'feature.create': regions.add(`feature:${operation.id}`); break;
      default: regions.add(`feature:${operation.featureId}`); break;
    }
  }
  // Resolve lookups early so a malformed operation cannot use caller-provided keys to hide a write.
  for (const region of regions) {
    if (region.startsWith('feature:')) findFeature(cwd, region.slice('feature:'.length), true);
    if (region.startsWith('scenario:')) findScenario(cwd, region.slice('scenario:'.length), true);
  }
  return regions;
}

function hashRegion(cwd: string, region: string): string {
  if (region === 'workspace') return workspaceHash(cwd);
  if (region === 'project') {
    return hash(yamlTopLevelRegion(readBytes(cwd, 'spec.yaml') ?? '', 'project') ?? ABSENT);
  }
  if (region === 'capabilities') return hashFile(cwd, 'spec/capabilities.yaml');
  if (region === 'architecture') return hashFile(cwd, 'spec/architecture.yaml');
  if (region.startsWith('feature:')) {
    const feature = findFeature(cwd, region.slice('feature:'.length), true);
    return feature ? hashFile(cwd, feature.path) : hash(ABSENT);
  }
  if (region.startsWith('scenario:')) {
    const scenario = findScenario(cwd, region.slice('scenario:'.length), true);
    return scenario ? hashFile(cwd, scenario.path) : hash(ABSENT);
  }
  if (region.startsWith('evidence:')) {
    const [feature, digest] = region.slice('evidence:'.length).split('/');
    return hashFile(cwd, `spec/evidence/${feature}/${digest}.yaml`);
  }
  throw new SpecEditError('INVALID_OPERATION', `Unknown canonical write region ${region}.`);
}

function workspaceHash(cwd: string): string {
  return managedSpecWorkspaceDigest(cwd);
}

function applyOperationsInMemory(cwd: string, operations: readonly SpecEditOperation[], lockHeld: boolean): {files: PlannedFile[]; inventoryNeeded: boolean; checkpointedFeatures: string[]; migrationApplied: boolean; migrationTestFileCount?: number; migrationTestFileSetDigest?: string; migrationPreviewDigest?: string; migrationLiveProofCensus?: MigrationLiveProofCensus} {
  // A candidate read cache is not a write plan. Only a region marked dirty below
  // can be serialized, which prevents a reference lookup from reformatting bytes.
  const values = new Map<string, JsonRecord>();
  const original = new Map<string, string | null>();
  const dirty = new Set<string>();
  const ensure = (path: string, mutable: boolean = false): JsonRecord => {
    const existing = values.get(path);
    if (mutable) dirty.add(path);
    if (existing) return existing;
    const bytes = readBytes(cwd, path);
    original.set(path, bytes);
    const value = bytes === null ? {} : record(yaml.parse(bytes));
    values.set(path, value);
    return value;
  };
  const root = ensure('spec.yaml');
  if (root.schema !== '0.2' && !operations.some((operation) => operation.kind === 'project.upgrade_schema')) {
    throw new SpecEditError('INVALID_OPERATION', 'Typed specification editing is available only after schema 0.2 migration.');
  }
  const checkpointed = new Set<string>();
  let inventoryNeeded = false;
  let migrationApplied = false;
  let migrationTestFileCount: number | undefined;
  let migrationTestFileSetDigest: string | undefined;
  let migrationPreviewDigestValue: string | undefined;
  let migrationLiveProofCensus: MigrationLiveProofCensus | undefined;
  for (const operation of operations) {
    switch (operation.kind) {
      case 'project.set_description': {
        dirty.add('spec.yaml');
        const project = ensureProject(root);
        if (operation.description === undefined) delete project.description;
        else project.description = requireText(operation.description, 'project description');
        break;
      }
      case 'project.set_purpose': dirty.add('spec.yaml'); ensureProject(root).purpose = requireText(operation.purpose, 'project purpose'); break;
      case 'project.set_policy': {
        dirty.add('spec.yaml');
        const project = ensureProject(root);
        if (operation.assuranceLevel !== undefined) project.assurance_level = operation.assuranceLevel;
        if (operation.scenarioPolicy !== undefined) project.scenario_policy = operation.scenarioPolicy;
        if (operation.assuranceLevel === undefined && operation.scenarioPolicy === undefined) throw invalid('project.set_policy needs a policy value');
        break;
      }
      case 'feature.create': {
        validateFeatureIdentity(operation.id, operation.slug);
        if (findFeature(cwd, operation.id, true) || [...values.values()].some((value) => value.id === operation.id)) throw invalid(`Feature ${operation.id} already exists.`);
        const path = `spec/features/${operation.slug}-${operation.id.slice(2)}.yaml`;
        const feature = ensure(path, true);
        Object.assign(feature, {
          id: operation.id, title: requireText(operation.title, 'feature title'), status: 'planned', purpose: requireText(operation.purpose, 'feature purpose'),
          modules: strings(operation.modules ?? [], 'modules'), depends_on: strings(operation.dependsOn ?? [], 'depends_on'), capability_refs: strings(operation.capabilityRefs ?? [], 'capability_refs'),
          acceptance_criteria: (operation.criteria ?? []).map((criterion) => toCriterion(criterion, true)),
        });
        inventoryNeeded = true;
        break;
      }
      case 'feature.begin': {
        const feature = editableFeature(cwd, ensure, operation.featureId, false, values);
        const status = text(feature.status);
        if (status === 'archived') throw lifecycle(`Archived features cannot be begun.`);
        if (!['planned', 'blocked', 'done', 'in_progress'].includes(status)) throw lifecycle(`Unknown feature lifecycle state for ${operation.featureId}.`);
        if (status !== 'in_progress') {
          dirty.add(featurePathInValuesOrDisk(cwd, values, operation.featureId));
          checkpointed.add(operation.featureId);
          feature.status = 'in_progress';
          delete feature.blocked_reason;
          inventoryNeeded = true;
        }
        break;
      }
      case 'feature.block': {
        const feature = editableFeature(cwd, ensure, operation.featureId, true, values);
        const reason = requireText(operation.reason, 'blocked reason');
        const status = text(feature.status);
        if (status === 'archived' || !['planned', 'in_progress', 'blocked', 'done'].includes(status)) throw lifecycle(`Feature ${operation.featureId} cannot be blocked from its current lifecycle state.`);
        if (status === 'done') throw lifecycle(`Begin ${operation.featureId} before blocking it.`);
        if (status !== 'blocked' || feature.blocked_reason !== reason) {
          feature.status = 'blocked'; feature.blocked_reason = reason; inventoryNeeded = true;
        }
        break;
      }
      case 'feature.archive': {
        const feature = editableFeature(cwd, ensure, operation.featureId, true, values);
        const reason = requireText(operation.reason, 'archive reason');
        if (operation.supersededBy !== undefined && !featureByIdInValuesOrDisk(cwd, values, operation.supersededBy)) throw reference(`Unknown superseding feature ${operation.supersededBy}.`);
        if (feature.status === 'archived') {
          if (feature.archive_reason !== reason || feature.superseded_by !== operation.supersededBy) throw lifecycle('Archive metadata is immutable once a feature is archived.');
        } else {
          feature.status = 'archived'; feature.archive_reason = reason; feature.archived_at = new Date().toISOString();
          if (operation.supersededBy === undefined) delete feature.superseded_by;
          else feature.superseded_by = operation.supersededBy;
          delete feature.blocked_reason;
          inventoryNeeded = true;
        }
        break;
      }
      case 'feature.set_title': editableNonArchivedFeature(cwd, ensure, operation.featureId, values).title = requireText(operation.title, 'feature title'); break;
      case 'feature.set_purpose': editableNonArchivedFeature(cwd, ensure, operation.featureId, values).purpose = requireText(operation.purpose, 'feature purpose'); break;
      case 'feature.set_links': {
        const feature = editableNonArchivedFeature(cwd, ensure, operation.featureId, values);
        if (operation.modules !== undefined) feature.modules = strings(operation.modules, 'modules');
        if (operation.dependsOn !== undefined) feature.depends_on = strings(operation.dependsOn, 'depends_on');
        if (operation.capabilityRefs !== undefined) feature.capability_refs = strings(operation.capabilityRefs, 'capability_refs');
        if (operation.modules !== undefined) inventoryNeeded = true;
        break;
      }
      case 'feature.set_design_impact': {
        const feature = editableNonArchivedFeature(cwd, ensure, operation.featureId, values);
        if (operation.designImpact === undefined) {
          if (record(feature.design_impact).classification === 'structural' && record(feature.design_impact).status === 'review_required') throw lifecycle('A pending structural design impact cannot be cleared.');
          delete feature.design_impact;
        } else feature.design_impact = materializeDesignImpact(cwd, operation.featureId, record(feature.design_impact), operation.designImpact);
        break;
      }
      case 'criterion.upsert': {
        const feature = editableNonArchivedFeature(cwd, ensure, operation.featureId, values);
        const criteria = criterionList(feature);
        const index = criteria.findIndex((criterion) => criterion.id === operation.criterion.id);
        const next = toCriterion(operation.criterion, index < 0);
        if (index < 0) criteria.push(next); else criteria[index] = next;
        feature.acceptance_criteria = criteria;
        break;
      }
      case 'criterion.remove': {
        const feature = editableNonArchivedFeature(cwd, ensure, operation.featureId, values);
        const criteria = criterionList(feature);
        const index = criteria.findIndex((criterion) => criterion.id === operation.criterionId);
        if (index < 0) throw reference(`Unknown criterion ${operation.criterionId}.`);
        criteria.splice(index, 1); feature.acceptance_criteria = criteria;
        break;
      }
      case 'criterion.set_proof_refs': {
        const feature = editableNonArchivedFeature(cwd, ensure, operation.featureId, values);
        const criteria = criterionList(feature);
        const criterion = criteria.find((entry) => entry.id === operation.criterionId);
        if (!criterion) throw reference(`Unknown criterion ${operation.criterionId}.`);
        if (operation.oracleRefs !== undefined) criterion.oracle_refs = strings(operation.oracleRefs, 'oracle_refs');
        if (operation.evidenceRefs !== undefined) criterion.evidence_refs = strings(operation.evidenceRefs, 'evidence_refs');
        feature.acceptance_criteria = criteria;
        break;
      }
      case 'capability.upsert': {
        const catalog = ensure('spec/capabilities.yaml', true);
        const entries = arrayRecords(catalog.capabilities);
        const capability = clone(operation.capability) as JsonRecord;
        if (!requireText(text(capability.id), 'capability id')) throw invalid('Capability id is required.');
        const index = entries.findIndex((entry) => entry.id === capability.id);
        if (index < 0) entries.push(capability); else entries[index] = capability;
        catalog.capabilities = entries;
        inventoryNeeded = true;
        break;
      }
      case 'capability.remove': {
        const catalog = ensure('spec/capabilities.yaml', true);
        const entries = arrayRecords(catalog.capabilities);
        const index = entries.findIndex((entry) => entry.id === operation.capabilityId);
        if (index < 0) throw reference(`Unknown capability ${operation.capabilityId}.`);
        entries.splice(index, 1); catalog.capabilities = entries;
        inventoryNeeded = true;
        break;
      }
      case 'architecture.set_layers': ensure('spec/architecture.yaml', true).layers = operation.layers.map((layer) => strings(layer, 'architecture layer')); break;
      case 'architecture_rule.upsert': {
        if (!RULE_ID.test(operation.rule.id)) throw invalid(`Invalid architecture rule id ${operation.rule.id}.`);
        const architecture = ensure('spec/architecture.yaml', true);
        const rules = arrayRecords(architecture.rules);
        const rule = clone(operation.rule) as JsonRecord;
        const index = rules.findIndex((entry) => entry.id === rule.id);
        if (index < 0) rules.push(rule); else rules[index] = rule;
        architecture.rules = rules;
        break;
      }
      case 'architecture_rule.remove': {
        const architecture = ensure('spec/architecture.yaml', true); const rules = arrayRecords(architecture.rules);
        const index = rules.findIndex((entry) => entry.id === operation.ruleId);
        if (index < 0) throw reference(`Unknown architecture rule ${operation.ruleId}.`);
        rules.splice(index, 1); architecture.rules = rules;
        break;
      }
      case 'scenario.upsert': {
        const value = operation.scenario;
        if (!isReadableId('scenario', value.id) || !SLUG.test(value.slug)) throw invalid('Scenario id and slug are invalid.');
        const found = findScenario(cwd, value.id, true);
        if (!found && !isNewId('scenario', value.id)) throw invalid('New scenarios must use generated identifiers.');
        const path = found?.path ?? `spec/scenarios/${value.slug}-${value.id.slice(2)}.yaml`;
        const scenario = ensure(path, true);
        if (value.steps.length === 0 || value.featureRefs.length === 0) throw invalid('Scenario journeys need both steps and at least one feature reference.');
        Object.assign(scenario, {id: value.id, title: requireText(value.title, 'scenario title'), actor: requireText(value.actor, 'scenario actor'), goal: requireText(value.goal, 'scenario goal'), success: requireText(value.success, 'scenario success'), steps: strings(value.steps, 'scenario steps'), feature_refs: strings(value.featureRefs, 'scenario feature_refs')});
        inventoryNeeded = true;
        break;
      }
      case 'scenario.remove': {
        const found = findScenario(cwd, operation.scenarioId, false);
        if (!found) throw reference(`Unknown scenario ${operation.scenarioId}.`);
        original.set(found.path, readBytes(cwd, found.path)); values.set(found.path, {}); dirty.add(found.path); // deletion is materialized below.
        inventoryNeeded = true;
        break;
      }
      case 'dependency.promote': {
        const feature = editableNonArchivedFeature(cwd, ensure, operation.featureId, values);
        const dependencies = strings(arrayStrings(feature.depends_on), 'depends_on');
        if (dependencies.includes(operation.candidate)) break;
        const inference = inferCurrentDependencies(cwd, values);
        const candidates = inference.suggestions[operation.featureId] ?? [];
        const dynamic = new Set(inference.dynamicImportFiles);
        if (candidates.length !== 1 || candidates[0] !== operation.candidate || arrayStrings(feature.modules).some((module) => dynamic.has(module))) {
          throw invalid('Dependency promotion requires exactly one current, statically inferable candidate.');
        }
        feature.depends_on = [...dependencies, operation.candidate];
        break;
      }
      case 'evidence.revoke': {
        if (!/^[a-f0-9]{64}$/.test(operation.digest)) throw invalid('Evidence revocation requires one full content digest.');
        if (!findFeature(cwd, operation.featureId, true)) throw reference(`Unknown evidence feature ${operation.featureId}.`);
        const path = `spec/evidence/${operation.featureId}/${operation.digest}.yaml`;
        if (!existsSync(join(cwd, path))) throw reference(`Unknown evidence receipt ${operation.digest}.`);
        original.set(path, readBytes(cwd, path)); values.set(path, {}); dirty.add(path);
        break;
      }
      case 'project.upgrade_schema': {
        const migration = applyMigration(cwd, operation.resolutions, values, original, lockHeld);
        migrationApplied = migration.applied;
        migrationTestFileCount = migration.testFileCount;
        migrationTestFileSetDigest = migration.testFileSetDigest;
        migrationPreviewDigestValue = migration.previewDigest;
        migrationLiveProofCensus = migration.liveProofCensus;
        if (migrationApplied) {
          for (const path of values.keys()) dirty.add(path);
          inventoryNeeded = true;
        }
        break;
      }
    }
  }
  // An already-active begin is normally a no-op, but it still brackets one
  // feature-local companion edit in this batch with exactly one pre-batch
  // checkpoint. The dirty set is the authoritative prospective write set.
  for (const operation of operations) {
    if (operation.kind !== 'feature.begin') continue;
    const found = findFeature(cwd, operation.featureId, true);
    const candidate = found ? values.get(found.path) : undefined;
    const before = found ? original.get(found.path) : undefined;
    const changed = before !== undefined && before !== null && candidate !== undefined && canonicalJson(yaml.parse(before)) !== canonicalJson(candidate);
    if (found && candidate?.status === 'in_progress' && changed) checkpointed.add(operation.featureId);
  }
  validateBaselineIntentEdits(cwd, values, root);
  validateCandidate(cwd, values, root);
  const files: PlannedFile[] = [];
  for (const path of dirty) {
    const value = values.get(path)!;
    const before = original.get(path) ?? readBytes(cwd, path);
    const isDelete = operations.some((operation) =>
      (operation.kind === 'scenario.remove' && findScenario(cwd, operation.scenarioId, true)?.path === path) ||
      (operation.kind === 'evidence.revoke' && path.endsWith(`/${operation.digest}.yaml`)));
    const after = isDelete ? null : renderPlannedYaml(path, before, value, operations);
    const semanticallyUnchanged = !isDelete && before !== null && canonicalJson(yaml.parse(before)) === canonicalJson(value);
    if (before !== after && !semanticallyUnchanged) {
      const rootRegions = path === 'spec.yaml' ? rootRegionsForOperations(operations) : undefined;
      files.push({path, before, after, ...(rootRegions === undefined ? {} : {rootRegions})});
    }
  }
  const changedPaths = new Set(files.map((file) => file.path));
  const events: string[] = [];
  // Checkpoints precede every companion event: their payload is the durable
  // pre-batch boundary the following edit is allowed to cross.
  for (const featureId of [...checkpointed].sort()) {
    events.push(JSON.stringify(newEvent('feature_checkpoint', {
      ...enrichEventPayload(cwd, {feature: featureId, git_head: readGitHead(cwd), spec_digest: computeSpecDigest(cwd)}),
    })));
  }
  for (const operation of operations) {
    if (operation.kind === 'feature.create') {
      const path = featurePathInValuesOrDisk(cwd, values, operation.id);
      if (changedPaths.has(path)) events.push(JSON.stringify(newEvent('feature_created', enrichEventPayload(cwd, {feature: operation.id, slug: operation.slug}))));
    }
    if (operation.kind === 'scenario.upsert') {
      const scenario = scenariosFrom(cwd, values).find((entry) => entry.id === operation.scenario.id);
      const file = scenario && files.find((candidate) => candidate.path === scenario.path);
      if (file?.before === null) events.push(JSON.stringify(newEvent('scenario_created', enrichEventPayload(cwd, {scenario: operation.scenario.id, slug: operation.scenario.slug}))));
    }
    if (operation.kind === 'feature.set_design_impact') {
      const path = featurePathInValuesOrDisk(cwd, values, operation.featureId);
      const candidate = values.get(path);
      const before = files.find((file) => file.path === path)?.before;
      const prior = before === null || before === undefined ? {} : record(yaml.parse(before));
      const priorImpact = record(prior.design_impact);
      if (changedPaths.has(path)
        && priorImpact.classification === 'structural'
        && priorImpact.status === 'review_required'
        && record(candidate?.design_impact).status === 'resolved') {
        events.push(JSON.stringify(newEvent('design_impact_resolved', enrichEventPayload(cwd, {feature: operation.featureId}))));
      }
    }
  }
  if (events.length > 0) {
    const eventPath = '.cladding/events.log.jsonl';
    const before = readBytes(cwd, eventPath) ?? '';
    files.push({path: eventPath, before: readBytes(cwd, eventPath), after: `${before}${events.join('\n')}\n`});
  }
  return {files, inventoryNeeded, checkpointedFeatures: [...checkpointed].sort(), migrationApplied, ...(migrationTestFileCount === undefined ? {} : {migrationTestFileCount}), ...(migrationTestFileSetDigest === undefined ? {} : {migrationTestFileSetDigest}), ...(migrationPreviewDigestValue === undefined ? {} : {migrationPreviewDigest: migrationPreviewDigestValue}), ...(migrationLiveProofCensus === undefined ? {} : {migrationLiveProofCensus})};
}

function addDerivedProjectionWrites(cwd: string, files: PlannedFile[], inventoryNeeded: boolean, reviewedTestFileCount?: number): PlannedFile[] {
  if (!inventoryNeeded) return files;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const root = byPath.get('spec.yaml');
  const rootBefore = root?.before ?? readBytes(cwd, 'spec.yaml');
  const rootAfter = root?.after ?? rootBefore;
  if (rootAfter !== null) {
    const rootValue = record(yaml.parse(rootAfter));
    const inventory = {
      features: countDomainOrInline(cwd, 'features', rootValue.features, files),
      scenarios: countDomainOrInline(cwd, 'scenarios', rootValue.scenarios, files),
      capabilities: countCapabilitiesOrInline(cwd, rootValue.capabilities, files),
      test_files: reviewedTestFileCount ?? computeInventory(cwd).test_files,
    };
    const revised = upsertInventoryBlock(rootAfter, inventory);
    const rootRegions = new Set<RootWriteRegion>(root?.rootRegions ?? []);
    rootRegions.add('inventory');
    byPath.set('spec.yaml', {path: 'spec.yaml', before: rootBefore, after: revised, rootRegions: [...rootRegions].sort() as RootWriteRegion[]});
  }
  const index = renderFeatureIndex(cwd, files);
  if (index !== null) byPath.set('spec/index.yaml', {path: 'spec/index.yaml', before: readBytes(cwd, 'spec/index.yaml'), after: index});
  return [...byPath.values()].filter((file) => file.before !== file.after).sort((left, right) => left.path.localeCompare(right.path));
}

/** Derives root ownership from operations; generated inventory is added separately. */
function rootRegionsForOperations(operations: readonly SpecEditOperation[]): readonly RootWriteRegion[] | undefined {
  const regions = new Set<RootWriteRegion>();
  for (const operation of operations) {
    if (operation.kind.startsWith('project.set_')) regions.add('project');
    if (operation.kind === 'project.upgrade_schema') {
      regions.add('schema');
      regions.add('project');
    }
  }
  return regions.size === 0 ? undefined : [...regions].sort() as RootWriteRegion[];
}

/** Keeps F4 migration's pre-relocation generated paths in its one journal. */
function addMigrationOldPathProjectionWrites(cwd: string, files: PlannedFile[]): PlannedFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const index = 'spec/index.yaml';
  if (!byPath.has(index)) {
    const before = readBytes(cwd, index);
    // `addDerivedProjectionWrites` has already regenerated a changed index.
    // If its bytes happen to be identical, retain an identity entry so the
    // reviewed migration's exact-path dirt gate and journal still cover it.
    if (before !== null) byPath.set(index, {path: index, before, after: before});
  }
  const docLinks = 'spec/_doc-links.yaml';
  if (!byPath.has(docLinks)) {
    const before = readBytes(cwd, docLinks);
    // The legacy document-link projection remains canonical before F11. Its
    // identifiers survive this schema conversion, so retain exact bytes rather
    // than inventing a regenerated projection.
    if (before !== null) byPath.set(docLinks, {path: docLinks, before, after: before});
  }
  const attestation = 'spec/attestation.yaml';
  if (!byPath.has(attestation)) {
    const before = readBytes(cwd, attestation);
    // A 0.1 green verification receipt does not automatically attest the new
    // 0.2 contract. Remove it atomically; the next qualifying gate reissues it
    // at the unchanged canonical path.
    if (before !== null) byPath.set(attestation, {path: attestation, before, after: null});
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** Renders only the project-owned YAML region when the root is otherwise untouched. */
function renderPlannedYaml(path: string, before: string | null, value: JsonRecord, operations: readonly SpecEditOperation[]): string {
  const projectOnly = path === 'spec.yaml'
    && before !== null
    && operations.some((operation) => operation.kind.startsWith('project.set_'))
    && !operations.some((operation) => operation.kind === 'project.upgrade_schema');
  if (!projectOnly) return yaml.stringify(value);
  const replacement = yaml.stringify({project: ensureProject(value)});
  return replaceYamlTopLevelRegion(before, 'project', replacement);
}

/** Extracts a top-level YAML mapping member without normalizing adjacent root bytes. */
function yamlTopLevelRegion(bytes: string, key: string): string | undefined {
  const startMatch = new RegExp(`^${escapeRegex(key)}:[^\\n]*(?:\\n|$)`, 'm').exec(bytes);
  if (!startMatch || startMatch.index === undefined) return undefined;
  let start = startMatch.index;
  // A contiguous comment block immediately attached to a top-level member is
  // part of that member's authored region, rather than disposable formatting.
  while (start > 0) {
    const previousEnd = start - 1;
    const previousStart = bytes.lastIndexOf('\n', previousEnd - 1) + 1;
    const previous = bytes.slice(previousStart, start).trim();
    if (previous === '' || previous.startsWith('#')) start = previousStart;
    else break;
  }
  const memberStart = startMatch.index;
  const rest = bytes.slice(memberStart + startMatch[0].length);
  const next = /^(?:[A-Za-z0-9_-]+):(?:[^\n]*(?:\n|$))/m.exec(rest);
  let end = next?.index === undefined ? projectMemberEndAtEof(bytes, memberStart, startMatch[0].length) : memberStart + startMatch[0].length + next.index;
  if (next?.index !== undefined) {
    while (end > memberStart) {
      const previousEnd = end - 1;
      const previousStart = bytes.lastIndexOf('\n', previousEnd - 1) + 1;
      const previous = bytes.slice(previousStart, end).trim();
      if (previous === '' || previous.startsWith('#')) end = previousStart;
      else break;
    }
  }
  return bytes.slice(start, end);
}

/** Finds the final indented project line without claiming trailing root comments or blanks. */
function projectMemberEndAtEof(bytes: string, memberStart: number, headerLength: number): number {
  let end = memberStart + headerLength;
  let offset = memberStart + headerLength;
  for (const line of bytes.slice(offset).matchAll(/[^\n]*(?:\n|$)/g)) {
    if (line[0] === '') break;
    if (/^[ \t]/.test(line[0])) end = offset + line[0].length;
    offset += line[0].length;
  }
  return end;
}

function replaceYamlTopLevelRegion(bytes: string, key: string, replacement: string): string {
  const current = yamlTopLevelRegion(bytes, key);
  if (current === undefined) return `${bytes}${bytes.endsWith('\n') || bytes.length === 0 ? '' : '\n'}${replacement}`;
  const start = bytes.indexOf(current);
  const member = new RegExp(`^${escapeRegex(key)}:`, 'm').exec(current);
  const leading = member?.index === undefined ? '' : current.slice(0, member.index);
  return `${bytes.slice(0, start)}${leading}${replacement}${bytes.slice(start + current.length)}`;
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function validateCandidate(cwd: string, values: ReadonlyMap<string, JsonRecord>, root: JsonRecord): void {
  if (root.schema !== '0.2') return;
  const baseline = candidateBaseline(cwd, values);
  const projectIssues = validateSchema02Project(root.project).issues.filter((issue) =>
    issue.path[0] !== 'purpose' || !legacyExemptionMatches(baseline, 'project', record(root.project)));
  assertContractIssues(projectIssues);
  assertContractIssues(validateSchema02CapabilityCatalog({capabilities: catalogFrom(cwd, values)}).issues);
  assertContractIssues(validateSchema02Architecture(architectureFrom(cwd, values)).issues);
  const features = allFeatures(cwd, values);
  validateUnique(features.map((feature) => feature.id), 'feature');
  const featureIds = new Set(features.map((feature) => feature.id));
  const capabilities = catalogFrom(cwd, values);
  const capabilityIds = new Set(capabilities.map((capability) => text(capability.id)));
  const rules = architectureFrom(cwd, values).rules;
  const ruleIds = new Set(arrayRecords(rules).map((rule) => text(rule.id)));
  for (const feature of features) {
    const featureIssues = validateSchema02FeatureContract(feature.value).issues.filter((issue) => {
      if (issue.path[0] === 'purpose') return !legacyExemptionMatches(baseline, `feature:${feature.id}`, feature.value);
      if (issue.path[0] !== 'acceptance_criteria' || typeof issue.path[1] !== 'number' || issue.path[2] !== 'kind') return true;
      const criterion = criterionList(feature.value)[issue.path[1]];
      return !legacyExemptionMatches(baseline, `criterion:${feature.id}/${text(criterion?.id)}`, criterion);
    });
    assertContractIssues(featureIssues);
    if (!isReadableId('feature', feature.id)) throw invalid(`Invalid feature id ${feature.id}.`);
    assertShardIdentity('feature', feature.path, feature.id);
    if (!['planned', 'in_progress', 'done', 'blocked', 'archived'].includes(text(feature.value.status))) throw invalid(`Invalid status for ${feature.id}.`);
    if (text(feature.value.status) === 'blocked' && !nonEmpty(text(feature.value.blocked_reason))) throw invalid(`Blocked feature ${feature.id} needs a non-empty blocked reason.`);
    if (text(feature.value.status) !== 'blocked' && feature.value.blocked_reason !== undefined) throw invalid(`Only blocked features may retain a blocked reason.`);
    validateNoDuplicates(arrayStrings(feature.value.modules), `${feature.id}.modules`);
    for (const module of arrayStrings(feature.value.modules)) validateRepoPath(module, `${feature.id}.modules`);
    validateNoDuplicates(arrayStrings(feature.value.depends_on), `${feature.id}.depends_on`);
    validateNoDuplicates(arrayStrings(feature.value.capability_refs), `${feature.id}.capability_refs`);
    for (const dependency of arrayStrings(feature.value.depends_on)) {
      if (dependency === feature.id) throw reference(`${feature.id} cannot depend on itself.`);
      if (!featureIds.has(dependency)) throw reference(`${feature.id} depends on unknown feature ${dependency}.`);
    }
    for (const capability of arrayStrings(feature.value.capability_refs)) if (!capabilityIds.has(capability)) throw reference(`${feature.id} links unknown capability ${capability}.`);
    const criteria = criterionList(feature.value);
    validateUnique(criteria.map((criterion) => text(criterion.id)), `criterion in ${feature.id}`);
    for (const criterion of criteria) {
      if (!isReadableId('criterion', text(criterion.id))) throw invalid(`Invalid criterion id ${text(criterion.id)}.`);
      const exempt = legacyExemptionMatches(baseline, `criterion:${feature.id}/${text(criterion.id)}`, criterion);
      if (!exempt && parseStrictStatement(text(criterion.statement)).status === 'invalid') throw invalid(`Criterion ${text(criterion.id)} has an invalid strict statement.`);
      for (const reference of [...arrayStrings(criterion.oracle_refs), ...arrayStrings(criterion.evidence_refs)]) validateReferencePath(reference, `Criterion ${text(criterion.id)} proof reference`);
      for (const rule of arrayStrings(criterion.constraint_refs)) if (!ruleIds.has(rule)) throw reference(`Criterion ${text(criterion.id)} references unknown architecture rule ${rule}.`);
    }
  }
  validateCycles(features);
  const scenarios = scenariosFrom(cwd, values);
  validateUnique(scenarios.map((scenario) => scenario.id), 'scenario');
  for (const scenario of scenarios) {
    const steps = arrayStringsStrict(scenario.value.steps, `${scenario.id}.steps`);
    const featureRefs = arrayStringsStrict(scenario.value.feature_refs, `${scenario.id}.feature_refs`);
    if (!isReadableId('scenario', scenario.id) || !nonEmpty(text(scenario.value.title)) || !nonEmpty(text(scenario.value.actor)) || !nonEmpty(text(scenario.value.goal)) || !nonEmpty(text(scenario.value.success)) || steps.length === 0 || featureRefs.length === 0) {
      throw invalid(`Scenario ${scenario.id} does not satisfy the schema 0.2 journey contract.`);
    }
    assertShardIdentity('scenario', scenario.path, scenario.id);
    validateNoDuplicates(featureRefs, `${scenario.id}.feature_refs`);
    for (const feature of featureRefs) if (!featureIds.has(feature)) throw reference(`Scenario ${scenario.id} references unknown feature ${feature}.`);
  }
}

function assertContractIssues(issues: readonly {readonly message: string}[]): void {
  if (issues.length > 0) throw invalid(issues.map((issue) => issue.message).join(' '));
}

function validateUnique(values: readonly string[], type: string): void {
  if (values.some((value) => !nonEmpty(value)) || new Set(values).size !== values.length) throw invalid(`Duplicate or empty ${type} identifier.`);
}

function validateRepoPath(path: string, name: string): void {
  try { normalizeArtifactPath(path); } catch { throw invalid(`${name} contains an unsafe repository path.`); }
}

function validateReferencePath(reference: string, name: string): void {
  const path = reference.split('#', 1)[0];
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.')) throw invalid(`${name} contains an unsafe path.`);
}

function assertShardIdentity(kind: 'feature' | 'scenario', path: string, id: string): void {
  if (!isReadableShardFilename(kind, path)) throw invalid(`Invalid ${kind} shard filename ${path}.`);
  const filename = path.split('/').pop()!;
  const stem = filename.replace(/\.ya?ml$/, '');
  // A direct readable filename is a preserved migration identity (including
  // F-aaaaaaaa.yaml/S-aaaaaaaa.yaml). New creates take the separate emitted
  // slug-hash path, so compatibility reading must not rewrite or reject it.
  if (stem === id) return;
  if (isNewId(kind, id)) {
    try { assertNewShardFilename(kind, filename, id); } catch (error) { throw invalid((error as Error).message); }
    return;
  }
  const hash = id.slice(id.indexOf('-') + 1);
  if (stem !== id && (!/^[a-f0-9]{6,}$/.test(hash) || !stem.endsWith(`-${hash}`))) {
    throw invalid(`${path} does not match its legacy ${kind} identifier ${id}.`);
  }
}

function candidateBaseline(cwd: string, values: ReadonlyMap<string, JsonRecord>): MigrationBaseline | undefined {
  const raw = values.get('spec/generated/migration-baseline-0.1-to-0.2.yaml') ?? (() => {
    const bytes = readBytes(cwd, 'spec/generated/migration-baseline-0.1-to-0.2.yaml');
    return bytes === null ? undefined : record(yaml.parse(bytes));
  })();
  if (!raw || Object.keys(raw).length === 0) return undefined;
  const baseline = raw as unknown as MigrationBaseline;
  const issues = validateMigrationBaseline(baseline);
  if (issues.length > 0) throw invalid(`Invalid migration baseline: ${issues.join('; ')}`);
  return baseline;
}

function materializeDesignImpact(cwd: string, featureId: string, current: JsonRecord, input: JsonRecord): JsonRecord {
  const classification = text(input.classification);
  const rationale = requireText(text(input.rationale), 'design impact rationale');
  if (requiredRootSchema(cwd) === '0.2'
    && current.classification === 'structural'
    && current.baseline_digests === undefined
    && (classification !== 'structural' || input.status !== 'resolved')) {
    throw invalid('A migrated structural design impact without baseline digests may only transition to resolved through its exact immutable migration baseline review.');
  }
  if (classification === 'structural') {
    const artifacts = strings(arrayStrings(input.artifacts), 'design impact artifacts');
    if (new Set(artifacts).size !== artifacts.length) {
      throw invalid('Structural design impact artifacts must be an exact unique set.');
    }
    if (current.classification === 'structural' && input.status === 'resolved') {
      const recorded = strings(arrayStrings(current.artifacts), 'recorded structural design artifacts');
      if (canonicalJson(artifacts) !== canonicalJson(recorded)) throw invalid('A structural resolution must retain its recorded artifact set.');
      const currentDigests = new Map(recorded.map((path) => [path, designArtifactDigest(cwd, path)]));
      const baselines = structuralDesignBaselines(cwd, featureId, current, recorded);
      if (baselines === undefined && rationale !== text(current.rationale)) {
        throw invalid('A migrated structural design resolution must retain the immutable baseline rationale.');
      }
      const unchanged = baselines === undefined
        ? []
        : recorded.filter((path) => baselines[path] === currentDigests.get(path));
      if (unchanged.length > 0) throw lifecycle(`Structural design impact is not resolved; unchanged artifact(s): ${unchanged.join(', ')}.`);
      return {...current, rationale, status: 'resolved'};
    }
    if (input.status === 'resolved') throw invalid('A new structural design impact must begin in review_required state.');
    const baselineDigests = Object.fromEntries(artifacts.map((path) => [path, designArtifactDigest(cwd, path)]));
    return {classification, rationale, status: 'review_required', artifacts, baseline_digests: baselineDigests};
  }
  if (input.status === 'review_required') throw invalid('Only structural design impact may require review.');
  return {classification, rationale, status: 'resolved', ...(input.artifacts === undefined ? {} : {artifacts: strings(arrayStrings(input.artifacts), 'design impact artifacts')})};
}

/** Returns the digest of one safe, registered Tier-B design document. */
export function designArtifactDigest(cwd: string, path: string): string {
  let normalized: string;
  try {
    normalized = normalizeArtifactPath(path);
  } catch {
    throw invalid(`Design impact artifact contains an unsafe repository path: ${path}.`);
  }
  if (!resolveArtifactDescriptors(normalized).some((descriptor) => descriptor.domain === 'design')) {
    throw invalid(`Design impact artifact is not a registered design document: ${path}.`);
  }
  const absolute = join(cwd, normalized);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
    throw invalid(`Design impact artifact must be a regular file: ${path}.`);
  }
  const bytes = readBytes(cwd, normalized);
  if (bytes === null) throw invalid(`Design impact artifact must be a regular file: ${path}.`);
  return hash(bytes);
}

function structuralDesignBaselines(
  cwd: string,
  featureId: string,
  current: JsonRecord,
  artifacts: readonly string[],
): JsonRecord | undefined {
  if (new Set(artifacts).size !== artifacts.length) {
    throw invalid('Structural design impact artifacts must be an exact unique set.');
  }
  const raw = current.baseline_digests;
  if (raw === undefined) {
    if (requiredRootSchema(cwd) === '0.2') {
      const baseline = candidateBaseline(cwd, new Map<string, JsonRecord>());
      if (!legacyStructuralReviewMatches(baseline, featureId, current)) {
        throw invalid('A schema 0.2 structural design impact requires complete baseline digests or an exact immutable migration baseline review.');
      }
    }
    return undefined;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid('Structural design impact baseline digests must be an object.');
  }
  const baselines = raw as JsonRecord;
  const keys = Object.keys(baselines);
  if (keys.length !== artifacts.length
    || artifacts.some((path) => !SHA256_HEX.test(text(baselines[path])))
    || keys.some((path) => !artifacts.includes(path))) {
    throw invalid('Structural design impact baseline digests must exactly match its recorded design artifacts.');
  }
  return baselines;
}

function validateBaselineIntentEdits(cwd: string, values: ReadonlyMap<string, JsonRecord>, root: JsonRecord): void {
  if (root.schema !== '0.2') return;
  const baseline = candidateBaseline(cwd, values);
  if (!baseline) return;
  for (const feature of allFeatures(cwd, values)) {
    const address = `feature:${feature.id}`;
    const baselineEntry = baseline.features.find((entry) => entry.address === address);
    if (baselineEntry?.exemption !== undefined && !legacyExemptionMatches(baseline, address, feature.value) && !nonEmpty(text(feature.value.purpose))) {
      throw invalid(`${feature.id} changed its title and now requires an explicit purpose.`);
    }
    for (const criterion of criterionList(feature.value)) {
      const subject = `criterion:${feature.id}/${text(criterion.id)}`;
      const criterionEntry = baseline.criteria.find((entry) => entry.address === subject);
      if (criterionEntry?.exemption !== undefined && !legacyExemptionMatches(baseline, subject, criterion) && !['behavior', 'quality', 'constraint'].includes(text(criterion.kind))) {
        throw invalid(`${feature.id}/${text(criterion.id)} changed its legacy intent and now requires an explicit kind.`);
      }
    }
  }
}

function applyMigration(cwd: string, payload: MigrationResolutionPayload, values: Map<string, JsonRecord>, original: Map<string, string | null>, lockHeld: boolean): {readonly applied: boolean; readonly testFileCount?: number; readonly testFileSetDigest?: string; readonly previewDigest?: string; readonly liveProofCensus?: MigrationLiveProofCensus} {
  const existingRoot = values.get('spec.yaml') ?? readYaml(cwd, 'spec.yaml');
  if (existingRoot.schema === '0.2') {
    if (existsSync(join(cwd, 'spec/generated/migration-baseline-0.1-to-0.2.yaml'))) return {applied: false};
    throw invalid('A schema 0.2 workspace without its migration baseline cannot replay an upgrade.');
  }
  const preview = previewSchema02Migration(cwd, {lockHeld});
  if (payload.previewDigest !== migrationPreviewDigest(preview)) {
    throw new SpecEditError('STALE_INPUT', 'The migration preview changed; review the current candidate before applying it.');
  }
  if (preview.sourceSchema !== '0.1' || preview.targetSchema !== '0.2') throw invalid('Migration preview is not safe to apply.');
  if (preview.independence.requirePolicyDoneLosses.length > 0) {
    throw new SpecEditError(
      'MIGRATION_UNRESOLVED',
      `Schema 0.2 cannot inherit asserted legacy independence for completed features: ${preview.independence.requirePolicyDoneLosses.join(', ')}. Obtain supported replacement receipts before migrating.`,
    );
  }
  validateMigrationConfirmations(preview, payload.confirmed);
  const confirmed = new Set(payload.confirmed.map((item) => `${item.code}|${item.subject}`));
  const unresolved = preview.requiredResolution.filter((item) => !confirmed.has(`${item.code}|${item.subject}`));
  if (unresolved.length > 0) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Migration still has unresolved human decisions.');
  const legacyL2Decision = confirmedLegacyL2BaselineDecision(payload);
  const sourceRoot = clone(existingRoot) as JsonRecord;
  const liveProofCensus = requireLiveProofForCompletedMigrationDrops(cwd, preview, payload, sourceRoot);
  const root = existingRoot;
  root.schema = '0.2';
  const project = ensureProject(root);
  if (preview.project.purpose !== undefined) project.purpose = confirmedText(payload, 'PROJECT_PURPOSE_CONFIRMATION', 'project', preview.project.purpose);
  else delete project.purpose;
  project.assurance_level = confirmedChoice(payload, 'PROJECT_ASSURANCE_LEVEL_CONFIRMATION', 'project', ['L1', 'L2', 'L3', 'L4'], preview.project.assuranceLevel);
  project.scenario_policy = confirmedChoice(payload, 'PROJECT_SCENARIO_POLICY_CONFIRMATION', 'project', ['off', 'advisory', 'required'], preview.project.scenarioPolicy);
  delete project.intent_summary;
  delete root.features;
  delete root.scenarios;
  delete root.capabilities;
  delete root.architecture;
  values.set('spec.yaml', root); original.set('spec.yaml', readBytes(cwd, 'spec.yaml'));
  const baselinePath = 'spec/generated/migration-baseline-0.1-to-0.2.yaml';
  if (existsSync(join(cwd, baselinePath))) throw invalid('A migration baseline already exists.');
  const baseline = clone(preview.baseline) as unknown as MigrationBaseline;
  const reviewedCarryForwards: ReviewedCriterionCarryForward[] = [];
  const finalCriteria = new Map<string, JsonRecord>();
  const legacyL2Candidates: string[] = [];
  for (const resolution of preview.requiredResolution.filter((item) => item.code === 'ADR_REFERENCE_REVIEW')) {
    const review = confirmedAdrReview(payload, resolution.subject);
    const criterion = baseline.criteria.find((entry) => entry.address === resolution.subject);
    if (!criterion) throw new SpecEditError('MIGRATION_UNRESOLVED', `ADR review subject ${resolution.subject} is absent from the baseline.`);
    (criterion as {adrReview?: unknown}).adrReview = review;
  }
  for (const feature of preview.features) {
    const source = migrationSourceRecord(cwd, sourceRoot, feature.path, 'features', feature.address.slice('feature:'.length));
    const featureId = text(source.id);
    const criteria = arrayRecords(source.acceptance_criteria).map((criterion) => {
      const criterionId = text(criterion.id);
      const candidate = preview.criteria.find((entry) => entry.address === `criterion:${featureId}/${criterionId}`);
      const subject = `criterion:${featureId}/${criterionId}`;
      const resolution = candidate?.scan.status === 'conflict' ? 'CRITERION_STATEMENT_CONFLICT'
        : candidate?.scan.status === 'unknown' ? 'CRITERION_TEXT_UNKNOWN' : undefined;
      const resolvedCriterion = resolution ? confirmedCriterionResolution(payload, resolution, subject, candidate) : undefined;
      const statement = resolvedCriterion?.statement ?? candidate?.statement;
      if (!statement) throw new SpecEditError('MIGRATION_UNRESOLVED', `Criterion ${featureId}/${criterionId} needs an explicit statement resolution.`);
      const convertedCriterion: JsonRecord = {id: criterionId, statement};
      if (resolvedCriterion) {
        convertedCriterion.kind = resolvedCriterion.kind;
        if (resolvedCriterion.rationale !== undefined) convertedCriterion.rationale = resolvedCriterion.rationale;
        if (resolvedCriterion.constraintRefs !== undefined) convertedCriterion.constraint_refs = resolvedCriterion.constraintRefs;
      }
      if (!resolvedCriterion) {
        copyField(criterion, convertedCriterion, 'rationale');
        copyField(criterion, convertedCriterion, 'constraint_refs');
      }
      if (resolvedCriterion?.bindingDisposition === 'retain') {
        reviewedCarryForwards.push({
          criterion: subject,
          intent: {
            statement: resolvedCriterion.statement,
            kind: resolvedCriterion.kind,
            ...(resolvedCriterion.rationale === undefined ? {} : {rationale: resolvedCriterion.rationale}),
            ...(resolvedCriterion.constraintRefs === undefined || resolvedCriterion.constraintRefs.length === 0
              ? {}
              : {constraintRefs: [...resolvedCriterion.constraintRefs].sort()}),
          },
          bindings: resolvedCriterion.retainedTestBindings,
        });
      }
      copyField(criterion, convertedCriterion, 'oracle_refs');
      copyField(criterion, convertedCriterion, 'evidence_refs');
      copyField(criterion, convertedCriterion, 'notes');
      finalCriteria.set(subject, convertedCriterion);
      if (source.status === 'done') legacyL2Candidates.push(subject);
      return convertedCriterion;
    });
    const converted: JsonRecord = {
      id: featureId, title: text(source.title), status: text(source.status) || 'planned',
      modules: arrayStrings(source.modules), depends_on: arrayStrings(source.depends_on),
      capability_refs: capabilityRefsForMigrationFeature(preview, payload, featureId), acceptance_criteria: criteria,
    };
    const baselineFeature = preview.baseline.features.find((entry) => entry.address === `feature:${featureId}`);
    if (baselineFeature?.purpose !== undefined) converted.purpose = baselineFeature.purpose;
    copyField(source, converted, 'design_impact');
    copyField(source, converted, 'archived_at');
    copyField(source, converted, 'archive_reason');
    copyField(source, converted, 'superseded_by');
    copyField(source, converted, 'blocked_reason');
    copyField(source, converted, 'notes');
    values.set(feature.targetPath, converted); original.set(feature.targetPath, readBytes(cwd, feature.targetPath));
  }
  if (reviewedCarryForwards.length > 0) {
    (baseline as {reviewedCarryForwards?: readonly ReviewedCriterionCarryForward[]}).reviewedCarryForwards = reviewedCarryForwards
      .sort((left, right) => left.criterion.localeCompare(right.criterion));
  }
  (baseline as {legacyL2Baseline?: LegacyL2BaselineDecision}).legacyL2Baseline = materializeLegacyL2Baseline(
    preview, legacyL2Decision, finalCriteria, legacyL2Candidates,
  );
  values.set(baselinePath, baseline as unknown as JsonRecord); original.set(baselinePath, null);
  const catalogPath = 'spec/capabilities.yaml';
  const catalog: JsonRecord = {capabilities: materializeMigrationCapabilities(preview, payload)};
  values.set(catalogPath, catalog); original.set(catalogPath, readBytes(cwd, catalogPath));
  const architecturePath = 'spec/architecture.yaml';
  const architecture = materializeMigrationArchitecture(preview, payload);
  values.set(architecturePath, architecture); original.set(architecturePath, readBytes(cwd, architecturePath));
  for (const scenario of preview.scenarios) {
    const source = migrationSourceRecord(cwd, sourceRoot, scenario.path, 'scenarios', scenario.address.slice('scenario:'.length));
    const resolved = confirmedRecord(payload, 'SCENARIO_MEANING_REQUIRED', scenario.address);
    rejectKeys(resolved, ['actor', 'goal', 'success', 'steps', 'feature_refs'], 'SCENARIO_MEANING_REQUIRED resolution');
    const converted: JsonRecord = {
      id: text(source.id),
      title: text(source.title),
      actor: requireText(text(resolved.actor), 'scenario actor'),
      goal: requireText(text(resolved.goal), 'scenario goal'),
      success: requireText(text(resolved.success), 'scenario success'),
      steps: strings(arrayStringsStrict(resolved.steps, 'scenario steps'), 'scenario steps'),
      feature_refs: strings(arrayStringsStrict(resolved.feature_refs, 'scenario feature_refs'), 'scenario feature_refs'),
    };
    if ((converted.steps as readonly unknown[]).length === 0 || (converted.feature_refs as readonly unknown[]).length === 0) {
      throw new SpecEditError('MIGRATION_UNRESOLVED', 'Scenario migration needs non-empty steps and feature_refs.');
    }
    values.set(scenario.targetPath, converted); original.set(scenario.targetPath, readBytes(cwd, scenario.targetPath));
  }
  assertAppliedMigrationIdentityProof(preview, values);
  return {
    applied: true,
    testFileCount: preview.testFileCount,
    testFileSetDigest: preview.testFileSetDigest,
    previewDigest: migrationPreviewDigest(preview),
    ...(liveProofCensus === undefined ? {} : {liveProofCensus}),
  };
}

/**
 * Refuses a completed criterion's destructive historic-test drop unless F5 can
 * harvest an exact current title carrier from safe workspace source bytes.
 */
function requireLiveProofForCompletedMigrationDrops(
  cwd: string,
  preview: MigrationPreview,
  payload: MigrationResolutionPayload,
  sourceRoot: JsonRecord,
): MigrationLiveProofCensus | undefined {
  const featureStatuses = new Map(preview.features.map((feature) => {
    const featureId = feature.address.slice('feature:'.length);
    const source = migrationSourceRecord(cwd, sourceRoot, feature.path, 'features', featureId);
    return [featureId, text(source.status)] as const;
  }));
  const requiredLiveCriteria: string[] = [];
  for (const candidate of preview.criteria) {
    const resolution = candidate.scan.status === 'conflict' ? 'CRITERION_STATEMENT_CONFLICT'
      : candidate.scan.status === 'unknown' ? 'CRITERION_TEXT_UNKNOWN' : undefined;
    if (!resolution || !candidate.legacyBindings.some((binding) => binding.channel === 'test')) continue;
    const resolved = confirmedCriterionResolution(payload, resolution, candidate.address, candidate);
    const address = candidate.address.slice('criterion:'.length);
    const featureId = address.slice(0, address.indexOf('/'));
    if (featureStatuses.get(featureId) === 'done' && resolved.bindingDisposition === 'drop') {
      requiredLiveCriteria.push(address);
    }
  }
  if (requiredLiveCriteria.length === 0) return undefined;

  const criteria = preview.criteria.map((candidate) => candidate.address.slice('criterion:'.length)).sort();
  const census = currentSafeBindingCensus(cwd, new Set(criteria));
  for (const criterion of requiredLiveCriteria.sort()) {
    const supported = census.bindings.some((binding) => binding.criterion === criterion
      && binding.carrier === 'title'
      && (binding.framework === 'vitest' || binding.framework === 'jest'));
    if (!supported) {
      throw new SpecEditError(
        'MIGRATION_UNRESOLVED',
        `Completed criterion ${criterion} cannot drop historic test inputs without an exact current safe [covers:] title carrier.`,
      );
    }
  }
  return {criteria, digest: census.digest};
}

/** Rechecks the exact F5 source census immediately before migration publication. */
function migrationLiveProofCensusMatches(cwd: string, expected: MigrationLiveProofCensus): boolean {
  return currentSafeBindingCensus(cwd, new Set(expected.criteria)).digest === expected.digest;
}

/** Re-extracts the planned shards so a conversion cannot commit a different node census than its preview. */
function assertAppliedMigrationIdentityProof(preview: MigrationPreview, values: ReadonlyMap<string, JsonRecord>): void {
  const features = preview.features.map((feature) => {
    const value = values.get(feature.targetPath);
    if (!value || typeof value.id !== 'string') throw new SpecEditError('MIGRATION_UNRESOLVED', 'Migration planned feature artifacts no longer match the reviewed identity proof.');
    return value;
  });
  const scenarios = preview.scenarios.map((scenario) => {
    const value = values.get(scenario.targetPath);
    if (!value || typeof value.id !== 'string') throw new SpecEditError('MIGRATION_UNRESOLVED', 'Migration planned scenario artifacts no longer match the reviewed identity proof.');
    return value;
  });
  const actual = {
    features: features.map((feature) => text(feature.id)).sort(),
    criteria: features.flatMap((feature) => arrayRecords(feature.acceptance_criteria)
      .map((criterion) => `${text(feature.id)}/${text(criterion.id)}`)).sort(),
    scenarios: scenarios.map((scenario) => text(scenario.id)).sort(),
  };
  if (canonicalJson(actual.features) !== canonicalJson(preview.identityProof.features.candidate)
    || canonicalJson(actual.criteria) !== canonicalJson(preview.identityProof.criteria.candidate)
    || canonicalJson(actual.scenarios) !== canonicalJson(preview.identityProof.scenarios.candidate)) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', 'Migration planned artifacts do not preserve the reviewed source identity/count proof.');
  }
}

/** Reads a source node from its original shard or its legacy inline root array. */
function migrationSourceRecord(cwd: string, root: JsonRecord, path: string, domain: 'features' | 'scenarios', id: string): JsonRecord {
  if (path !== 'spec.yaml') return readYaml(cwd, path);
  const entries = arrayRecords(root[domain]);
  const source = entries.find((entry) => entry.id === id);
  if (!source) throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration source ${domain}/${id} disappeared from spec.yaml.`);
  return clone(source) as JsonRecord;
}

/** Returns the compact request binding for a deterministic migration preview. */
export function migrationPreviewDigest(preview: MigrationPreview): string {
  return hash(serializeMigrationPreview(preview));
}

/** Requires the separate project decision that governs the narrow L2 baseline. */
function confirmedLegacyL2BaselineDecision(payload: MigrationResolutionPayload): 'accept' | 'reject' {
  const entries = payload.confirmed.filter((entry) => entry.code === 'PROJECT_LEGACY_L2_BASELINE' && entry.subject === 'project');
  const decision = entries[0]?.value;
  if (entries.length !== 1 || (decision !== 'accept' && decision !== 'reject')) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', 'The completed-legacy-criterion L2 baseline needs one explicit accept or reject decision.');
  }
  return decision;
}

/** Materializes the immutable L2 authorization receipt only from final converted criterion targets. */
function materializeLegacyL2Baseline(
  preview: MigrationPreview,
  decision: 'accept' | 'reject',
  finalCriteria: ReadonlyMap<string, JsonRecord>,
  candidates: readonly string[],
): LegacyL2BaselineDecision {
  const candidateCriteria = [...candidates].sort(compareCodeUnits);
  const candidateCensusSha256 = legacyL2CandidateCensusSha256(candidateCriteria);
  if (candidateCriteria.length !== preview.legacyL2Baseline.candidateCount
    || candidateCensusSha256 !== preview.legacyL2Baseline.candidateCensusSha256) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', 'The converted completed-legacy criterion census no longer matches the reviewed preview.');
  }
  const previewSha256 = migrationPreviewDigest(preview);
  const resolutionSha256 = legacyL2ResolutionSha256({
    previewSha256,
    decision,
    candidateCount: preview.legacyL2Baseline.candidateCount,
    candidateCensusSha256: preview.legacyL2Baseline.candidateCensusSha256,
  });
  const authorizations: LegacyL2Authorization[] = decision === 'accept'
    ? candidateCriteria.map((criterion) => {
      const intent = criterionFinalIntentFromRecord(finalCriteria.get(criterion));
      if (!intent) throw new SpecEditError('MIGRATION_UNRESOLVED', `Completed criterion ${criterion.slice('criterion:'.length)} has no final intent to authorize.`);
      const finalIntentSha256 = criterionFinalIntentSha256(intent);
      const authorization: LegacyL2Authorization = {
        criterion,
        sourceStatus: 'done',
        finalIntentSha256,
        // YAML serializers preserve shared references as anchors. Each receipt
        // authorization owns an equal but independent obligation tuple.
        obligations: [...LEGACY_L2_OBLIGATIONS] as const,
        candidateSha256: '',
        resolutionSha256,
      };
      return {...authorization, candidateSha256: legacyL2CandidateSha256(authorization)};
    })
    : [];
  return {
    decision,
    previewSha256,
    candidateCount: preview.legacyL2Baseline.candidateCount,
    candidateCensusSha256: preview.legacyL2Baseline.candidateCensusSha256,
    resolutionSha256,
    authorizations,
  };
}

function confirmedText(payload: MigrationResolutionPayload, code: string, subject: string, fallback?: string): string {
  const entries = payload.confirmed.filter((entry) => entry.code === code && entry.subject === subject);
  if (entries.length > 1) throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${code} for ${subject} is ambiguous.`);
  const entry = entries[0];
  if (!entry) {
    if (fallback !== undefined) return fallback;
    throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${code} for ${subject} is required.`);
  }
  if (entry.value === undefined && fallback !== undefined) return fallback;
  if (typeof entry.value !== 'string' || !nonEmpty(entry.value)) throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${code} for ${subject} needs a non-empty text candidate.`);
  return entry.value;
}

function confirmedRecord(payload: MigrationResolutionPayload, code: string, subject: string): JsonRecord {
  const entries = payload.confirmed.filter((entry) => entry.code === code && entry.subject === subject);
  if (entries.length !== 1 || !entries[0].value || typeof entries[0].value !== 'object' || Array.isArray(entries[0].value)) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${code} for ${subject} needs exactly one structured candidate.`);
  }
  return entries[0].value as JsonRecord;
}

function confirmedCriterionResolution(
  payload: MigrationResolutionPayload,
  code: string,
  subject: string,
  candidate: MigrationPreview['criteria'][number] | undefined,
): {
  readonly statement: string;
  readonly kind: CriterionInput['kind'];
  readonly rationale?: string;
  readonly constraintRefs?: readonly string[];
  readonly bindingDisposition?: 'retain' | 'drop';
  readonly retainedTestBindings: readonly ReviewedCriterionCarryForward['bindings'][number][];
} {
  const raw = confirmedRecord(payload, code, subject);
  rejectKeys(raw, ['statement', 'kind', 'rationale', 'constraintRefs', 'testBindingDisposition', 'retainedTestRefs'], `${code} resolution`);
  const statement = requireText(text(raw.statement), `${code} statement`);
  const kind = raw.kind;
  if (kind !== 'behavior' && kind !== 'quality' && kind !== 'constraint') throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} needs an explicit criterion kind.`);
  if (parseStrictStatement(statement).status === 'invalid') throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} statement is not a valid strict statement.`);
  const rationale = raw.rationale === undefined ? undefined : requireText(text(raw.rationale), `${code} rationale`);
  const constraintRefs = raw.constraintRefs === undefined ? undefined : strings(arrayStringsStrict(raw.constraintRefs, `${code} constraintRefs`), `${code} constraintRefs`);
  if (kind === 'constraint' && !rationale && (!constraintRefs || constraintRefs.length === 0)) throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} constraint kind needs rationale or constraint refs.`);
  const candidates = candidate?.reviewedTestCandidates ?? [];
  const hasHistoricTestRefs = candidates.length > 0;
  const disposition = raw.testBindingDisposition;
  const bindingDisposition = disposition === 'retain' || disposition === 'drop'
    ? disposition
    : undefined;
  if (hasHistoricTestRefs && bindingDisposition === undefined) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} must explicitly retain selected historic test inputs or drop them.`);
  }
  if (!hasHistoricTestRefs && disposition !== undefined) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} has no historic test inputs to retain or drop.`);
  }
  const retainedTestBindings = bindingDisposition === 'retain'
    ? confirmedRetainedMigrationTests(raw, candidates, code)
    : [];
  if (bindingDisposition === 'drop' && raw.retainedTestRefs !== undefined) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} cannot select test inputs after choosing drop.`);
  }
  return {
    statement,
    kind,
    ...(rationale === undefined ? {} : {rationale}),
    ...(constraintRefs === undefined ? {} : {constraintRefs}),
    ...(bindingDisposition === undefined ? {} : {bindingDisposition}),
    retainedTestBindings,
  };
}

/** Validates an exact non-empty subset of safe preview-bound test inputs. */
function confirmedRetainedMigrationTests(
  raw: JsonRecord,
  candidates: readonly PreviewReviewedTestCandidate[],
  code: string,
): readonly ReviewedCriterionCarryForward['bindings'][number][] {
  const selected = strings(arrayStringsStrict(raw.retainedTestRefs, `${code} retainedTestRefs`), `${code} retainedTestRefs`);
  if (selected.length === 0 || new Set(selected).size !== selected.length) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} retain needs one or more distinct exact historic test refs.`);
  }
  const byRaw = new Map(candidates.map((candidate) => [candidate.raw, candidate]));
  return selected.map((rawRef) => {
    const candidate = byRaw.get(rawRef);
    if (!candidate || candidate.state !== 'available' || candidate.sha256 === undefined) {
      throw new SpecEditError('MIGRATION_UNRESOLVED', `${code} can retain only safe preview-bound whole-file test inputs.`);
    }
    return {
      raw: candidate.raw,
      file: candidate.file,
      ...(candidate.selector === undefined ? {} : {selector: candidate.selector}),
      sha256: candidate.sha256,
    };
  });
}

function confirmedAdrReview(payload: MigrationResolutionPayload, subject: string): {readonly disposition: 'retain_external' | 'superseded' | 'not_applicable'; readonly rationale: string} {
  const raw = confirmedRecord(payload, 'ADR_REFERENCE_REVIEW', subject);
  rejectKeys(raw, ['disposition', 'rationale'], 'ADR_REFERENCE_REVIEW resolution');
  const disposition = text(raw.disposition);
  if (!['retain_external', 'superseded', 'not_applicable'].includes(disposition)) throw new SpecEditError('MIGRATION_UNRESOLVED', 'ADR review needs an explicit supported disposition.');
  return {disposition: disposition as 'retain_external' | 'superseded' | 'not_applicable', rationale: requireText(text(raw.rationale), 'ADR review rationale')};
}

function confirmedChoice<T extends string>(
  payload: MigrationResolutionPayload,
  code: string,
  subject: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const entry = payload.confirmed.find((item) => item.code === code && item.subject === subject);
  if (!entry || entry.value === undefined) return fallback;
  if (typeof entry.value !== 'string' || !allowed.includes(entry.value as T)) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${code} for ${subject} has an invalid selected value.`);
  }
  return entry.value as T;
}

function validateMigrationConfirmations(preview: MigrationPreview, confirmed: readonly {readonly code: string; readonly subject: string; readonly value?: unknown}[]): void {
  const required = new Set(preview.requiredResolution.map((item) => `${item.code}|${item.subject}`));
  const seen = new Set<string>();
  for (const item of confirmed) {
    const key = `${item.code}|${item.subject}`;
    if (!required.has(key)) throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${key} is not part of the current preview.`);
    if (seen.has(key)) throw new SpecEditError('MIGRATION_UNRESOLVED', `Migration resolution ${key} is ambiguous.`);
    validateMigrationResolutionValue(item);
    seen.add(key);
  }
}

function validateMigrationResolutionValue(item: {readonly code: string; readonly subject: string; readonly value?: unknown}): void {
  if (item.code === 'PROJECT_LEGACY_L2_BASELINE') {
    if (item.subject !== 'project' || (item.value !== undefined && item.value !== 'accept' && item.value !== 'reject')) {
      throw new SpecEditError('MIGRATION_UNRESOLVED', 'Completed-legacy-criterion L2 baseline needs an explicit accept or reject decision.');
    }
    return;
  }
  if (item.value === undefined) return;
  const textCodes = new Set(['PROJECT_PURPOSE_CONFIRMATION', 'PROJECT_ASSURANCE_LEVEL_CONFIRMATION', 'PROJECT_SCENARIO_POLICY_CONFIRMATION', 'CAPABILITY_OUTCOME_CONFIRMATION', 'ARCHITECTURE_RULE_RATIONALE']);
  const recordCodes = new Set(['CRITERION_STATEMENT_CONFLICT', 'CRITERION_TEXT_UNKNOWN', 'CAPABILITY_RECORD_RESOLUTION', 'CAPABILITY_EDGE_RESOLUTION', 'SCENARIO_MEANING_REQUIRED', 'ARCHITECTURE_LAYER_RESOLUTION', 'ARCHITECTURE_RULE_RESOLUTION', 'ADR_REFERENCE_REVIEW']);
  if (textCodes.has(item.code) && (typeof item.value !== 'string' || !nonEmpty(item.value))) throw new SpecEditError('MIGRATION_UNRESOLVED', `${item.code} needs a non-empty text decision when a value is supplied.`);
  if (recordCodes.has(item.code) && (!item.value || typeof item.value !== 'object' || Array.isArray(item.value))) throw new SpecEditError('MIGRATION_UNRESOLVED', `${item.code} needs a structured resolved candidate.`);
}

function capabilityRefsForMigrationFeature(preview: MigrationPreview, payload: MigrationResolutionPayload, featureId: string): readonly string[] {
  return migrationCapabilityPairs(preview, payload)
    .filter((pair) => pair.featureId === featureId)
    .map((pair) => pair.capabilityId)
    .sort();
}

function migrationCapabilityPairs(preview: MigrationPreview, payload: MigrationResolutionPayload): readonly {readonly capabilityId: string; readonly featureId: string}[] {
  const edgeResolution = payload.confirmed.filter((entry) => entry.code === 'CAPABILITY_EDGE_RESOLUTION');
  if (edgeResolution.length > 1) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Capability edge migration has more than one resolved candidate.');
  if (edgeResolution.length === 0) {
    if (!preview.capabilityEdgeProof.equal) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Capability edge migration needs an explicit resolved candidate.');
    return preview.capabilityEdgeProof.candidatePairs;
  }
  const value = recordStrict(edgeResolution[0].value, 'CAPABILITY_EDGE_RESOLUTION value');
  rejectKeys(value, ['pairs'], 'CAPABILITY_EDGE_RESOLUTION value');
  const pairs = arrayRecordsStrict(value.pairs, 'CAPABILITY_EDGE_RESOLUTION pairs').map((pair) => {
    rejectKeys(pair, ['capabilityId', 'featureId'], 'CAPABILITY_EDGE_RESOLUTION pair');
    return {capabilityId: requireText(text(pair.capabilityId), 'capability edge id'), featureId: requireText(text(pair.featureId), 'capability edge feature')};
  }).sort((left, right) => `${left.capabilityId}|${left.featureId}`.localeCompare(`${right.capabilityId}|${right.featureId}`));
  if (new Set(pairs.map((pair) => `${pair.capabilityId}|${pair.featureId}`)).size !== pairs.length || canonicalJson(pairs) !== canonicalJson(preview.capabilityEdgeProof.legacyPairs)) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', 'The resolved capability edges do not re-prove the legacy L = N pair set.');
  }
  const features = new Set(preview.features.map((feature) => feature.address.slice('feature:'.length)));
  const capabilities = new Set(preview.capabilities.map((capability) => capability.id));
  if (pairs.some((pair) => !features.has(pair.featureId) || !capabilities.has(pair.capabilityId))) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', 'A resolved capability edge names a feature or capability absent from the current candidate.');
  }
  return pairs;
}

function materializeMigrationCapabilities(preview: MigrationPreview, payload: MigrationResolutionPayload): JsonRecord[] {
  const resolved = new Map<string, JsonRecord>();
  for (const entry of payload.confirmed.filter((entry) => entry.code === 'CAPABILITY_RECORD_RESOLUTION')) {
    const value = recordStrict(entry.value, 'CAPABILITY_RECORD_RESOLUTION value');
    rejectKeys(value, ['id', 'title', 'outcome'], 'CAPABILITY_RECORD_RESOLUTION value');
    const id = requireText(text(value.id), 'capability id');
    if (entry.subject !== `capability:${id}`) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Capability record resolution must bind its id to its capability subject.');
    if (resolved.has(id)) throw new SpecEditError('MIGRATION_UNRESOLVED', `Capability record resolution for ${id} is duplicated.`);
    resolved.set(id, {id, title: requireText(text(value.title), 'capability title'), outcome: requireText(text(value.outcome), 'capability outcome')});
  }
  const capabilities: JsonRecord[] = preview.capabilities.map((capability): JsonRecord => {
    const explicit = resolved.get(capability.id);
    if (explicit) return {
      ...explicit,
      outcome: confirmedText(payload, 'CAPABILITY_OUTCOME_CONFIRMATION', `capability:${capability.id}`, requireText(text(explicit.outcome), 'capability outcome')),
    };
    if (!capability.title) {
      throw new SpecEditError('MIGRATION_UNRESOLVED', `Capability ${capability.id} needs its CAPABILITY_RECORD_RESOLUTION.`);
    }
    return {
      id: capability.id,
      title: capability.title,
      outcome: confirmedText(payload, 'CAPABILITY_OUTCOME_CONFIRMATION', `capability:${capability.id}`, capability.outcome),
    };
  });
  for (const id of resolved.keys()) if (!capabilities.some((entry) => entry.id === id)) throw new SpecEditError('MIGRATION_UNRESOLVED', `Capability record resolution ${id} does not belong to the current preview.`);
  const pairs = migrationCapabilityPairs(preview, payload);
  const ids = new Set(capabilities.map((capability) => text(capability.id)));
  if (new Set(capabilities.map((capability) => text(capability.id))).size !== capabilities.length || pairs.some((pair) => !ids.has(pair.capabilityId))) {
    throw new SpecEditError('MIGRATION_UNRESOLVED', 'Resolved capabilities do not provide a unique record for every resolved edge.');
  }
  return capabilities.sort((left, right) => text(left.id).localeCompare(text(right.id)));
}

function materializeMigrationArchitecture(preview: MigrationPreview, payload: MigrationResolutionPayload): JsonRecord {
  let layers = preview.architecture.layers;
  let resolvedLayers: readonly (readonly string[])[] | undefined;
  let resolvedRules: JsonRecord[] | undefined;
  for (const entry of payload.confirmed.filter((entry) => entry.code === 'ARCHITECTURE_LAYER_RESOLUTION')) {
    const value = recordStrict(entry.value, 'ARCHITECTURE_LAYER_RESOLUTION value');
    rejectKeys(value, ['layers'], 'ARCHITECTURE_LAYER_RESOLUTION value');
    const candidate = arrayStrict(value.layers, 'architecture layers').map((layer) => strings(arrayStringsStrict(layer, 'architecture layer'), 'architecture layer'));
    if (resolvedLayers !== undefined && canonicalJson(resolvedLayers) !== canonicalJson(candidate)) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Architecture layer resolutions disagree on the final candidate.');
    resolvedLayers = candidate;
  }
  if (resolvedLayers !== undefined) layers = resolvedLayers;
  for (const entry of payload.confirmed.filter((entry) => entry.code === 'ARCHITECTURE_RULE_RESOLUTION')) {
    const value = recordStrict(entry.value, 'ARCHITECTURE_RULE_RESOLUTION value');
    rejectKeys(value, ['rules'], 'ARCHITECTURE_RULE_RESOLUTION value');
    const candidate = arrayRecordsStrict(value.rules, 'architecture rules').map((rule) => {
      rejectKeys(rule, ['id', 'kind', 'from', 'to', 'rationale'], 'architecture rule');
      if (rule.kind !== 'forbidden_import') throw new SpecEditError('MIGRATION_UNRESOLVED', 'Architecture rule kind must be forbidden_import.');
      return {id: requireText(text(rule.id), 'architecture rule id'), kind: 'forbidden_import', from: requireText(text(rule.from), 'architecture rule from'), to: requireText(text(rule.to), 'architecture rule to'), rationale: requireText(text(rule.rationale), 'architecture rule rationale')};
    });
    if (resolvedRules !== undefined && canonicalJson(resolvedRules) !== canonicalJson(candidate)) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Architecture rule resolutions disagree on the final candidate.');
    resolvedRules = candidate;
  }
  if (!layers) throw new SpecEditError('MIGRATION_UNRESOLVED', 'Architecture conversion needs explicit layers.');
  const rules = resolvedRules ?? preview.architecture.rules.map((rule) => ({id: rule.id, kind: rule.kind, from: rule.from, to: rule.to, rationale: confirmedText(payload, 'ARCHITECTURE_RULE_RATIONALE', `architecture_rule:${rule.id}`)}));
  return {layers, rules};
}

function copyField(from: JsonRecord, to: JsonRecord, field: string): void {
  if (from[field] !== undefined) to[field] = clone(from[field]);
}

function assertMigrationPathsClean(cwd: string, files: readonly PlannedFile[]): void {
  const paths = files.map((file) => file.path).filter((path) => !path.startsWith('.cladding/')).sort();
  if (paths.length === 0) return;
  try {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    } catch (error) {
      // Only an unmistakably non-git workspace may bypass the dirt gate. An
      // ancestor .git marker or Git environment means a failed probe is an
      // outage, not permission to overwrite a planned dirty path.
      const errno = error as NodeJS.ErrnoException & {status?: number};
      if (!hasGitContext(cwd) && (errno.status === 128 || errno.code === 'ENOENT')) return;
      throw error;
    }
    const output = execFileSync('git', ['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '--', ...paths], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    if (output.trim()) throw new SpecEditError('DIRTY_PLANNED_PATH', 'Migration planned paths have uncommitted changes; unrelated paths may remain dirty.');
  } catch (error) {
    if (error instanceof SpecEditError) throw error;
    throw new SpecEditError('INVALID_OPERATION', `Unable to verify migration planned-path dirt: ${(error as Error).message}`);
  }
}

/** Detects a repository context even when a Git subprocess currently cannot inspect it. */
function hasGitContext(cwd: string): boolean {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return true;
  let cursor = resolve(cwd);
  while (true) {
    try {
      // lstat observes a .git file, directory, or dangling symbolic link;
      // `existsSync` would otherwise misclassify a broken repository marker
      // as a clean-room workspace and let an unavailable dirt check bypass.
      lstatSync(join(cursor, '.git'));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function hashFile(cwd: string, path: string): string { return hash(readBytes(cwd, path) ?? ABSENT); }
function canonicalJson(value: unknown): string { return JSON.stringify(sortJson(value)); }
function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)])); return value; }
function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function recordStrict(value: unknown, name: string): JsonRecord { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${name} must be an object.`); return value as JsonRecord; }
function arrayStrict(value: unknown, name: string): readonly unknown[] { if (!Array.isArray(value)) throw invalid(`${name} must be an array.`); return value; }
function arrayRecordsStrict(value: unknown, name: string): JsonRecord[] { return arrayStrict(value, name).map((item, index) => recordStrict(item, `${name}[${index}]`)); }
function arrayStringsStrict(value: unknown, name: string): string[] { return arrayStrict(value, name).map((item, index) => { if (typeof item !== 'string') throw invalid(`${name}[${index}] must be a string.`); return item; }); }
function requiredRecordString(value: JsonRecord, key: string): string { return requireText(text(value[key]), key); }
function rejectKeys(value: JsonRecord, allowed: readonly string[], name: string): void { const accepted = new Set(allowed); for (const key of Object.keys(value)) if (!accepted.has(key)) throw invalid(`${name} does not accept the field ${key}.`); }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function arrayRecords(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter((item): item is JsonRecord => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => clone(item) as JsonRecord) : []; }
function arrayStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function strings(value: readonly string[], name: string): string[] { const result = [...value]; if (result.some((item) => !nonEmpty(item))) throw invalid(`${name} must contain only non-empty strings.`); validateNoDuplicates(result, name); return result; }
function nonEmpty(value: string): boolean { return value.trim().length > 0; }
function requireText(value: string, name: string): string { if (!nonEmpty(value)) throw invalid(`${name} must be non-empty.`); return value; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function hasExactOwnKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function workspaceIdentity(cwd: string): string {
  const root = resolve(cwd);
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}
function sameWorkspacePath(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}
function jsonBytes(value: unknown): number { try { return Buffer.byteLength(JSON.stringify(value)); } catch { throw invalid('Typed edit transport must be JSON serializable.'); } }
function invalid(message: string): SpecEditError { return new SpecEditError('INVALID_OPERATION', message); }
function reference(message: string): SpecEditError { return new SpecEditError('UNKNOWN_REFERENCE', message); }
function lifecycle(message: string): SpecEditError { return new SpecEditError('LIFECYCLE', message); }
function ensureProject(root: JsonRecord): JsonRecord { const project = record(root.project); root.project = project; return project; }
function validateNoDuplicates(entries: readonly string[], name: string): void { if (new Set(entries).size !== entries.length) throw invalid(`${name} may not contain duplicate references.`); }
function validateFeatureIdentity(id: string, slug: string): void { if (!isNewId('feature', id) || !SLUG.test(slug)) throw invalid('Feature id and slug are invalid.'); }
function toCriterion(input: CriterionInput, isNew: boolean = true): JsonRecord { if (!isReadableId('criterion', input.id) || (isNew && !isNewId('criterion', input.id))) throw invalid(`Invalid criterion id ${input.id}.`); const criterion: JsonRecord = {id: input.id, kind: input.kind, statement: requireText(input.statement, 'criterion statement')}; if (input.rationale !== undefined) criterion.rationale = requireText(input.rationale, 'criterion rationale'); if (input.constraintRefs !== undefined) criterion.constraint_refs = strings(input.constraintRefs, 'constraint_refs'); if (input.oracleRefs !== undefined) criterion.oracle_refs = strings(input.oracleRefs, 'oracle_refs'); if (input.evidenceRefs !== undefined) criterion.evidence_refs = strings(input.evidenceRefs, 'evidence_refs'); if (input.notes !== undefined) criterion.notes = input.notes; return criterion; }
function criterionList(feature: JsonRecord): JsonRecord[] { return arrayRecords(feature.acceptance_criteria); }
function findFeature(cwd: string, id: string, optional: boolean): FeatureDocument | null {
  const dir = join(cwd, 'spec', 'features'); if (!existsSync(dir)) return optional ? null : (() => { throw reference(`Unknown feature ${id}.`); })();
  for (const name of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(name)) continue; const path = `spec/features/${name}`; const value = readYaml(cwd, path);
    if (value.id === id) return {id, path, value};
  }
  return optional ? null : (() => { throw reference(`Unknown feature ${id}.`); })();
}
function findScenario(cwd: string, id: string, optional: boolean): FeatureDocument | null {
  const dir = join(cwd, 'spec', 'scenarios'); if (!existsSync(dir)) return optional ? null : (() => { throw reference(`Unknown scenario ${id}.`); })();
  for (const name of readdirSync(dir).sort()) { if (!/\.ya?ml$/.test(name)) continue; const path = `spec/scenarios/${name}`; const value = readYaml(cwd, path); if (value.id === id) return {id, path, value}; }
  return optional ? null : (() => { throw reference(`Unknown scenario ${id}.`); })();
}
function featurePathInValuesOrDisk(cwd: string, values: ReadonlyMap<string, JsonRecord>, id: string): string {
  const overlay = [...values.entries()].find(([path, value]) => path.startsWith('spec/features/') && value.id === id);
  if (overlay) return overlay[0];
  return findFeature(cwd, id, false)!.path;
}
function editableFeature(cwd: string, ensure: (path: string, mutable?: boolean) => JsonRecord, id: string, mutable: boolean = false, values?: ReadonlyMap<string, JsonRecord>): JsonRecord {
  return ensure(values ? featurePathInValuesOrDisk(cwd, values, id) : findFeature(cwd, id, false)!.path, mutable);
}
function editableNonArchivedFeature(cwd: string, ensure: (path: string, mutable?: boolean) => JsonRecord, id: string, values?: ReadonlyMap<string, JsonRecord>): JsonRecord {
  const feature = editableFeature(cwd, ensure, id, true, values);
  if (feature.status === 'archived') throw lifecycle(`Archived feature ${id} is terminal and cannot be edited.`);
  return feature;
}
function featureByIdInValuesOrDisk(cwd: string, values: ReadonlyMap<string, JsonRecord>, id: string): boolean { return [...values.values()].some((value) => value.id === id) || findFeature(cwd, id, true) !== null; }
function allFeatures(cwd: string, values: ReadonlyMap<string, JsonRecord>): FeatureDocument[] {
  const results: FeatureDocument[] = []; const dir = join(cwd, 'spec', 'features');
  if (existsSync(dir)) for (const name of readdirSync(dir).sort()) if (/\.ya?ml$/.test(name)) { const path = `spec/features/${name}`; const value = values.get(path) ?? readYaml(cwd, path); if (typeof value.id === 'string') results.push({id: value.id, path, value}); }
  for (const [path, value] of values) if (path.startsWith('spec/features/') && !results.some((entry) => entry.path === path) && typeof value.id === 'string') results.push({id: value.id, path, value});
  return results;
}
function scenariosFrom(cwd: string, values: ReadonlyMap<string, JsonRecord>): FeatureDocument[] {
  const results: FeatureDocument[] = []; const dir = join(cwd, 'spec', 'scenarios');
  if (existsSync(dir)) for (const name of readdirSync(dir).sort()) if (/\.ya?ml$/.test(name)) { const path = `spec/scenarios/${name}`; const value = values.get(path) ?? readYaml(cwd, path); if (typeof value.id === 'string') results.push({id: value.id, path, value}); }
  for (const [path, value] of values) if (path.startsWith('spec/scenarios/') && !results.some((entry) => entry.path === path) && typeof value.id === 'string') results.push({id: value.id, path, value});
  return results;
}
function catalogFrom(cwd: string, values: ReadonlyMap<string, JsonRecord>): JsonRecord[] { return arrayRecords((values.get('spec/capabilities.yaml') ?? readYaml(cwd, 'spec/capabilities.yaml')).capabilities); }
function architectureFrom(cwd: string, values: ReadonlyMap<string, JsonRecord>): JsonRecord { return values.get('spec/architecture.yaml') ?? readYaml(cwd, 'spec/architecture.yaml'); }
function validateCycles(features: readonly FeatureDocument[]): void { const graph = new Map(features.map((feature) => [feature.id, arrayStrings(feature.value.depends_on)])); const visiting = new Set<string>(); const done = new Set<string>(); const visit = (id: string): void => { if (visiting.has(id)) throw reference(`Dependency cycle includes ${id}.`); if (done.has(id)) return; visiting.add(id); for (const edge of graph.get(id) ?? []) visit(edge); visiting.delete(id); done.add(id); }; for (const id of graph.keys()) visit(id); }
function inferCurrentDependencies(cwd: string, values: ReadonlyMap<string, JsonRecord>): ReturnType<typeof inferDependsOn> {
  const spec = {features: allFeatures(cwd, values).map((feature) => feature.value)} as unknown as Spec;
  return inferDependsOn(spec, (module) => {
    if (!module || module.startsWith('/') || module.split('/').some((part) => part === '.' || part === '..')) return null;
    try { return readFileSync(join(cwd, module), 'utf8'); } catch { return null; }
  });
}
function countDomainOrInline(cwd: string, domain: 'features' | 'scenarios', inline: unknown, files: readonly PlannedFile[]): number {
  // The legacy loader treats a non-empty inline array as authoritative. Match
  // that same layout rule so a sync cannot replace a real inline census with
  // an empty shard count.
  if (Array.isArray(inline) && inline.length > 0) return inline.length;
  const paths = new Set<string>();
  const dir = join(cwd, 'spec', domain);
  if (existsSync(dir)) for (const name of readdirSync(dir)) if (/\.ya?ml$/.test(name)) paths.add(`spec/${domain}/${name}`);
  for (const file of files) if (file.path.startsWith(`spec/${domain}/`)) { if (file.after === null) paths.delete(file.path); else paths.add(file.path); }
  return paths.size;
}

function countCapabilitiesOrInline(cwd: string, inline: unknown, files: readonly PlannedFile[]): number {
  if (Array.isArray(inline) && inline.length > 0) return inline.length;
  const candidate = files.find((file) => file.path === 'spec/capabilities.yaml')?.after ?? readBytes(cwd, 'spec/capabilities.yaml');
  return candidate ? arrayRecords(record(yaml.parse(candidate)).capabilities).length : 0;
}
function renderFeatureIndex(cwd: string, files: readonly PlannedFile[]): string | null { const records = allFeatures(cwd, new Map(files.filter((file) => file.path.startsWith('spec/features/') && file.after !== null).map((file) => [file.path, record(yaml.parse(file.after!))]))); if (records.length === 0 && !existsSync(join(cwd, 'spec', 'features'))) return null; const rows = records.sort((a, b) => a.id.localeCompare(b.id)).map((feature) => `  ${feature.id}: {slug: ${shardFilenameSlug(feature.path, feature.id)}, status: ${text(feature.value.status) || 'planned'}, modules: ${arrayStrings(feature.value.modules).length}}`); return '# Cladding · Tier C — generated feature index (`clad sync`). Do not edit by hand.\n# One line per feature → 1-file lookup + line-independent merges\n# (suggested .gitattributes: `spec/index.yaml merge=union`).\nfeatures:\n' + rows.join('\n') + '\n'; }
