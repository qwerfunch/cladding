// Cladding · Spec 0.2 F1 · node-granular migration-baseline schema only.

/** Current serialized shape of the future immutable migration receipt. */
export const MIGRATION_BASELINE_SCHEMA = 1;

/** Legacy classification retained until an intent-bearing criterion edit. */
export const LEGACY_UNCLASSIFIED = 'legacy_unclassified';

/** Identity for a single grandfathered node, never a feature-wide waiver. */
export interface LegacyExemption {
  /** Stable exemption identifier for audit and immutable receipt lookup. */
  readonly id: string;
  /** Canonical semantic subject protected by this exemption. */
  readonly subject: string;
  /** Why the node remains legacy until a qualifying intent edit. */
  readonly reason: 'missing_project_intent' | 'missing_feature_purpose' | 'legacy_criterion_intent' | 'legacy_scenario' | 'legacy_architecture';
}

/** Exact project intent projection preserved from schema 0.1. */
export interface ProjectIntentBaseline {
  /** Project semantic subject. */
  readonly address: 'project';
  /** Exact `intent_summary` when schema 0.1 provided one. */
  readonly legacyIntent?: string;
  /** Exemption only when no legacy intent exists to project. */
  readonly exemption?: LegacyExemption;
}

/** Feature title and purpose migration state. */
export interface FeatureIntentBaseline {
  /** Feature semantic address. */
  readonly address: string;
  /** Exact legacy title remains a title projection, not inferred purpose prose. */
  readonly title: string;
  /** A future reviewed purpose proposal; F1 does not generate or apply one. */
  readonly purpose?: string;
  /** Node-local exemption for an unprojected purpose. */
  readonly exemption?: LegacyExemption;
  /** Exact legacy structural review that may be explicitly resolved after migration. */
  readonly legacyStructuralReview?: LegacyStructuralReview;
}

/** Immutable structural-review state carried from one schema 0.1 feature. */
export interface LegacyStructuralReview {
  /** Only the structural review class can use this migration exception. */
  readonly classification: 'structural';
  /** Exact reviewer-facing reason retained from the legacy feature. */
  readonly rationale: string;
  /** Only a pending review may be resolved through the exception. */
  readonly status: 'review_required';
  /** Ordered exact set of registered design-document paths. */
  readonly artifacts: readonly string[];
}

/** One legacy proof binding preserved without selector invention. */
export interface LegacyBindingBaseline {
  /** Original reference channel. */
  readonly channel: 'test' | 'oracle' | 'evidence';
  /** Byte-for-byte source spelling. */
  readonly raw: string;
  /** Selector only when it appeared in the legacy reference. */
  readonly selector?: string;
}

/** Criterion-level legacy intent and binding baseline. */
export interface CriterionIntentBaseline {
  /** Composite semantic address such as `criterion:F-a/AC-b`. */
  readonly address: string;
  /** Exact legacy text and any structural EARS fields retained for migration review. */
  readonly legacyIntent: Readonly<Record<string, string>>;
  /** Full immutable source record for lossless review of non-target legacy fields such as adr_refs. */
  readonly legacyRecord?: Readonly<Record<string, unknown>>;
  /** F1 deliberately does not assume behavior for an old criterion. */
  readonly classification: typeof LEGACY_UNCLASSIFIED;
  /** Immutable historic references; later live binding must not union with them. */
  readonly bindings: readonly LegacyBindingBaseline[];
  /** Criterion-local exemption until its intent changes. */
  readonly exemption: LegacyExemption;
  /** Explicit human disposition for legacy ADR links that have no schema 0.2 field. */
  readonly adrReview?: {readonly disposition: 'retain_external' | 'superseded' | 'not_applicable'; readonly rationale: string};
}

/** Exact strict intent selected during migration review, never an exemption. */
export interface ReviewedCriterionIntent {
  /** Reviewed strict statement, preserved byte-for-value after YAML decoding. */
  readonly statement: string;
  /** Explicit reviewed classification. */
  readonly kind: 'behavior' | 'quality' | 'constraint';
  /** Constraint rationale only when selected. */
  readonly rationale?: string;
  /** Ordered reviewed architecture-rule references only when selected. */
  readonly constraintRefs?: readonly string[];
}

/** One reviewed whole-file test input retained without claiming a receipt. */
export interface ReviewedTestBindingBaseline {
  /** Exact legacy source spelling selected by the reviewer. */
  readonly raw: string;
  /** Safe repository-relative file resolved from that spelling. */
  readonly file: string;
  /** Authored selector when the historic reference supplied one. */
  readonly selector?: string;
  /** SHA-256 of the complete file bytes reviewed during migration. */
  readonly sha256: string;
}

/** Immutable reviewed carry-forward for one newly strict migrated criterion. */
export interface ReviewedCriterionCarryForward {
  /** Canonical criterion subject, distinct from a legacy exemption. */
  readonly criterion: string;
  /** Exact final strict intent that authorizes this narrow carry-forward. */
  readonly intent: ReviewedCriterionIntent;
  /** Non-empty exact historic test inputs explicitly retained by review. */
  readonly bindings: readonly ReviewedTestBindingBaseline[];
}

/** Scenario migration record carrying identity without an inferred journey contract. */
export interface ScenarioMigrationBaseline {
  /** Scenario semantic address. */
  readonly address: string;
  /** Exact schema 0.1 record retained for review. */
  readonly legacyRecord: Readonly<Record<string, unknown>>;
  /** Scenario-local exemption identity. */
  readonly exemption: LegacyExemption;
}

/** Architecture migration record carrying identity without inferred rules. */
export interface ArchitectureMigrationBaseline {
  /** Architecture semantic subject. */
  readonly address: 'architecture';
  /** Exact schema 0.1 record retained for review. */
  readonly legacyRecord: Readonly<Record<string, unknown>>;
  /** Architecture-local exemption identity. */
  readonly exemption: LegacyExemption;
}

/** Explicit disposition for a legacy capability field removed by schema 0.2. */
export interface CapabilitySurfaceMigrationDisposition {
  /** Stable legacy capability identity. */
  readonly id: string;
  /** Exact valid legacy surface spelling. */
  readonly legacySurface: 'feature' | 'platform' | 'tool' | 'infrastructure';
  /** D08 removes this field from the live 0.2 capability contract. */
  readonly disposition: 'removed_by_schema_0.2';
}

/** Immutable node-granular migration receipt shape; F1 does not write it. */
export interface MigrationBaseline {
  /** Receipt schema version. */
  readonly schema: typeof MIGRATION_BASELINE_SCHEMA;
  /** Source schema that supplied the baseline. */
  readonly sourceSchema: '0.1';
  /** Project intent state. */
  readonly project: ProjectIntentBaseline;
  /** Feature-level title/purpose state. */
  readonly features: readonly FeatureIntentBaseline[];
  /** Criterion-level exact intent and historic bindings. */
  readonly criteria: readonly CriterionIntentBaseline[];
  /** Explicit strict-review carry-forwards; absence never implies retention. */
  readonly reviewedCarryForwards?: readonly ReviewedCriterionCarryForward[];
  /** Scenario records. */
  readonly scenarios: readonly ScenarioMigrationBaseline[];
  /** Explicit non-live dispositions for legacy capability fields removed by D08. */
  readonly capabilitySurfaceDispositions?: readonly CapabilitySurfaceMigrationDisposition[];
  /** Optional architecture record. */
  readonly architecture?: ArchitectureMigrationBaseline;
}

/** Field groups that may revoke only their own node's legacy exemption. */
export type IntentChangeField =
  | 'feature.title'
  | 'feature.purpose'
  | 'criterion.add'
  | 'criterion.remove'
  | 'criterion.statement'
  | 'criterion.kind'
  | 'criterion.rationale'
  | 'criterion.constraint_refs';

/** A prospective node edit classified without performing any public write. */
export interface BaselineNodeChange {
  /** Address of the node under consideration. */
  readonly subject: string;
  /** One or more changed field categories. */
  readonly fields: readonly string[];
}

/** Returns whether a field set contains a qualifying intent-bearing change. */
export function isIntentBearingChange(fields: readonly string[]): boolean {
  const intentFields: ReadonlySet<IntentChangeField> = new Set([
    'feature.title', 'feature.purpose', 'criterion.add', 'criterion.remove', 'criterion.statement',
    'criterion.kind', 'criterion.rationale', 'criterion.constraint_refs',
  ]);
  return fields.some((field) => intentFields.has(field as IntentChangeField));
}

/**
 * Returns baseline exemptions remaining after a prospective in-memory change set.
 *
 * An intent edit can only remove an exemption with the same semantic address;
 * status, module, dependency, link, binding, notes, ordering, and promotion
 * changes are intentionally non-intent-bearing and preserve all exemptions.
 */
export function remainingLegacyExemptions(
  baseline: MigrationBaseline,
  changes: readonly BaselineNodeChange[],
): readonly LegacyExemption[] {
  const revoked = new Set(changes.filter((change) => isIntentBearingChange(change.fields)).map((change) => change.subject));
  return allExemptions(baseline).filter((exemption) => !revoked.has(exemption.subject));
}

/** Returns whether an address is exempt in the immutable baseline. */
export function hasLegacyExemption(baseline: MigrationBaseline, subject: string): boolean {
  return allExemptions(baseline).some((exemption) => exemption.subject === subject);
}

/**
 * Returns whether a node still has the exact legacy-intent projection that its
 * immutable receipt permits. An exemption is not blanket membership: changing
 * title, purpose, criterion identity, statement, kind, rationale, or resolving
 * constraints immediately makes that one node strict.
 */
export function legacyExemptionMatches(
  baseline: MigrationBaseline | undefined,
  subject: string,
  current: object | undefined,
): boolean {
  if (!baseline || !current) return false;
  const record = current as Readonly<Record<string, unknown>>;
  if (subject === 'project') {
    return baseline.project.exemption !== undefined
      && (typeof record.purpose !== 'string' || record.purpose.trim().length === 0);
  }
  if (subject.startsWith('feature:')) {
    const entry = baseline.features.find((feature) => feature.address === subject);
    return entry?.exemption !== undefined
      && record.title === entry.title
      && (typeof record.purpose !== 'string' || record.purpose.trim().length === 0);
  }
  if (subject.startsWith('criterion:')) {
    const entry = baseline.criteria.find((criterion) => criterion.address === subject);
    if (!entry?.exemption || record.statement !== entry.legacyIntent.text || (record.kind !== undefined && record.kind !== LEGACY_UNCLASSIFIED)) return false;
    return optionalLegacyIntentFieldMatches(record, 'rationale', entry.legacyIntent.rationale)
      && optionalLegacyIntentFieldMatches(record, 'constraint_refs', entry.legacyIntent.constraint_refs);
  }
  return false;
}

/**
 * Returns whether one pending schema 0.2 impact is byte-semantic-equivalent to
 * the exact structural review captured in its immutable migration baseline.
 */
export function legacyStructuralReviewMatches(
  baseline: MigrationBaseline | undefined,
  featureId: string,
  current: object | undefined,
): boolean {
  const review = baseline?.features.find((feature) => feature.address === `feature:${featureId}`)?.legacyStructuralReview;
  if (!review || !current) return false;
  const record = current as Readonly<Record<string, unknown>>;
  const expectedKeys = ['artifacts', 'classification', 'rationale', 'status'];
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')) return false;
  return record.classification === review.classification
    && record.rationale === review.rationale
    && record.status === review.status
    && Array.isArray(record.artifacts)
    && record.artifacts.length === review.artifacts.length
    && record.artifacts.every((artifact, index) => artifact === review.artifacts[index]);
}

/**
 * Returns whether an explicit reviewed carry-forward still binds this exact
 * strict criterion intent. It is deliberately separate from the legacy
 * exemption matcher: review never broadens grandfathering.
 */
export function reviewedCarryForwardMatches(
  baseline: MigrationBaseline | undefined,
  criterion: string,
  current: object | undefined,
): boolean {
  if (!baseline || !current) return false;
  const review = baseline.reviewedCarryForwards?.find((entry) => entry.criterion === `criterion:${criterion}`);
  if (!review) return false;
  const record = current as Readonly<Record<string, unknown>>;
  if (record.statement !== review.intent.statement || record.kind !== review.intent.kind) return false;
  if (record.rationale !== review.intent.rationale) return false;
  const currentRefs = record.constraint_refs;
  const reviewedRefs = review.intent.constraintRefs;
  if (reviewedRefs === undefined) return currentRefs === undefined;
  return Array.isArray(currentRefs)
    && currentRefs.every((ref) => typeof ref === 'string')
    && currentRefs.length === reviewedRefs.length
    && currentRefs.every((ref, index) => ref === reviewedRefs[index]);
}

function optionalLegacyIntentFieldMatches(current: Readonly<Record<string, unknown>>, field: string, baseline: string | undefined): boolean {
  const value = current[field];
  if (baseline === undefined) return value === undefined || (Array.isArray(value) && value.length === 0);
  if (Array.isArray(value)) return value.join(',') === baseline;
  return value === baseline;
}

/**
 * Validates only the F1 data-shape invariants of a migration baseline.
 *
 * @returns Human-readable issues; an empty list proves unique exemption identity and node ownership.
 */
export function validateMigrationBaseline(baseline: MigrationBaseline): readonly string[] {
  const exemptions = allExemptions(baseline);
  const issues: string[] = [];
  if (baseline.schema !== MIGRATION_BASELINE_SCHEMA || baseline.sourceSchema !== '0.1') {
    issues.push('baseline must identify schema 1 sourced from schema 0.1');
  }
  const identities = new Set<string>();
  const subjects = new Set<string>();
  for (const exemption of exemptions) {
    if (!exemption.id || identities.has(exemption.id)) issues.push(`duplicate exemption identity: ${exemption.id}`);
    if (!exemption.subject || subjects.has(exemption.subject)) issues.push(`duplicate exemption subject: ${exemption.subject}`);
    identities.add(exemption.id);
    subjects.add(exemption.subject);
  }
  for (const criterion of baseline.criteria) {
    if (criterion.classification !== LEGACY_UNCLASSIFIED) issues.push(`${criterion.address} must remain legacy_unclassified`);
    if (criterion.exemption.subject !== criterion.address) issues.push(`${criterion.address} exemption must be node-local`);
    if (criterion.adrReview && (!criterion.adrReview.rationale || !['retain_external', 'superseded', 'not_applicable'].includes(criterion.adrReview.disposition))) {
      issues.push(`${criterion.address} has an invalid ADR review disposition`);
    }
  }
  for (const feature of baseline.features) {
    const review = feature.legacyStructuralReview;
    if (review === undefined) continue;
    if (review === null || typeof review !== 'object' || Array.isArray(review)) {
      issues.push(`${feature.address} has an invalid legacy structural review`);
      continue;
    }
    const keys = Object.keys(review as object).sort();
    if (keys.join(',') !== 'artifacts,classification,rationale,status'
      || review.classification !== 'structural'
      || review.status !== 'review_required'
      || typeof review.rationale !== 'string'
      || review.rationale.length === 0
      || !Array.isArray(review.artifacts)
      || review.artifacts.some((artifact) => typeof artifact !== 'string' || artifact.length === 0)
      || new Set(review.artifacts).size !== review.artifacts.length) {
      issues.push(`${feature.address} has an invalid legacy structural review`);
    }
  }
  const reviewedSubjects = new Set<string>();
  for (const review of baseline.reviewedCarryForwards ?? []) {
    const criterion = baseline.criteria.find((entry) => entry.address === review?.criterion);
    if (!review || !/^criterion:[^/]+\/[^/]+$/.test(review.criterion) || reviewedSubjects.has(review.criterion)
      || !criterion
      || !review.intent || !review.intent.statement || !['behavior', 'quality', 'constraint'].includes(review.intent.kind)
      || (review.intent.rationale !== undefined && (typeof review.intent.rationale !== 'string' || !review.intent.rationale.trim()))
      || (review.intent.constraintRefs !== undefined && (!Array.isArray(review.intent.constraintRefs)
        || review.intent.constraintRefs.some((ref) => typeof ref !== 'string' || !ref)))
      || !Array.isArray(review.bindings) || review.bindings.length === 0) {
      issues.push('reviewed carry-forwards must bind one known criterion to a non-empty strict selection');
      break;
    }
    reviewedSubjects.add(review.criterion);
    const refs = new Set<string>();
    for (const binding of review.bindings) {
      if (!binding || typeof binding.raw !== 'string' || !binding.raw || typeof binding.file !== 'string' || !binding.file
        || (binding.selector !== undefined && typeof binding.selector !== 'string')
        || typeof binding.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.sha256)
        || refs.has(binding.raw)
        || !criterion.bindings.some((historic) => historic.channel === 'test' && historic.raw === binding.raw && historic.selector === binding.selector)) {
        issues.push(`${review.criterion} has an invalid reviewed test binding`);
        break;
      }
      refs.add(binding.raw);
    }
  }
  const surfaces = baseline.capabilitySurfaceDispositions ?? [];
  const surfaceIds = new Set<string>();
  for (const entry of surfaces) {
    if (!entry || typeof entry.id !== 'string' || !['feature', 'platform', 'tool', 'infrastructure'].includes(entry.legacySurface)
      || entry.disposition !== 'removed_by_schema_0.2' || surfaceIds.has(entry.id)) {
      issues.push('baseline capability surface dispositions must be unique valid D08 removals');
      break;
    }
    surfaceIds.add(entry.id);
  }
  return issues;
}

function allExemptions(baseline: MigrationBaseline): readonly LegacyExemption[] {
  return [
    ...(baseline.project.exemption ? [baseline.project.exemption] : []),
    ...baseline.features.flatMap((feature) => feature.exemption ? [feature.exemption] : []),
    ...baseline.criteria.map((criterion) => criterion.exemption),
    ...baseline.scenarios.map((scenario) => scenario.exemption),
    ...(baseline.architecture ? [baseline.architecture.exemption] : []),
  ];
}
