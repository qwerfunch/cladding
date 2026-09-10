// Cladding · Spec 0.2 F1–F3 · typed additive GraphIR and contract surface.

/** Workspace schema versions recognized by the additive compiler boundary. */
export type CompilerSchemaVersion = '0.1' | '0.2';

/**
 * Persisted assurance levels accepted by the schema 0.2 project contract.
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 */
export type AssuranceLevel = 'L1' | 'L2' | 'L3' | 'L4';

/**
 * Persisted scenario coverage policies accepted by schema 0.2.
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 */
export type ScenarioPolicy = 'off' | 'advisory' | 'required';

/**
 * Retained schema 0.2 feature lifecycle states.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
export type Schema02FeatureStatus = 'planned' | 'in_progress' | 'done' | 'blocked' | 'archived';

/** Source range in UTF-16 offsets with one-based navigation coordinates. */
export interface SourceRange {
  /** Inclusive source offset. */
  readonly start: number;
  /** Exclusive source offset. */
  readonly end: number;
  /** One-based source line for navigation. */
  readonly line: number;
  /** One-based source column for navigation. */
  readonly column: number;
}

/** Stable source locator carried by authored facts. */
export interface SourceLocator {
  /** Repository-relative YAML artifact path. */
  readonly path: string;
  /** YAML path within that artifact. */
  readonly yamlPath: string;
  /** Exact source span when YAML preserves one. */
  readonly range: SourceRange;
}

/** Provenance separates authored declarations from compiler derivation and runtime observation. */
export type GraphProvenance = 'authored' | 'derived' | 'observed';

/** Roles an artifact can hold simultaneously. */
export type ArtifactRole = 'spec' | 'doc' | 'source' | 'test' | 'oracle' | 'evidence' | 'skill' | 'generated';

/** Graph relationship vocabulary accepted by the Spec 0.2 design. */
export type GraphRelation =
  | 'contains'
  | 'defined_in'
  | 'contributes_to'
  | 'depends_on'
  | 'participates_in'
  | 'touches'
  | 'constrained_by'
  | 'traces_to'
  | 'covers'
  | 'supports'
  | 'explains'
  | 'mentions'
  | 'links_to';

/** Truth state that never silently promotes absence to success. */
export type GraphState = 'resolved' | 'unresolved' | 'passed' | 'failed' | 'skipped' | 'stale' | 'unknown' | 'unobserved';

/** Semantic graph node categories. */
export type SemanticNodeKind = 'project' | 'capability' | 'feature' | 'criterion' | 'scenario' | 'architecture_rule';

/**
 * Source-derived display fields retained by the compiler without inventing intent.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-9ea1a6ed
 */
export interface GraphPresentationRecord {
  /** Root-selected source schema that authored the fields. */
  readonly schemaVersion: CompilerSchemaVersion;
  /** Canonical semantic address represented by these fields. */
  readonly address: string;
  /** Semantic class represented by the authored record. */
  readonly kind: SemanticNodeKind;
  /** Authored human-facing label when the source field exists. */
  readonly title?: string;
  /** Authored legacy feature slug when the source field exists. */
  readonly slug?: string;
  /** Authored feature lifecycle status when the source field exists. */
  readonly status?: string;
  /** Authored WHY statement when the schema supplies one. */
  readonly purpose?: string;
  /** Authored criterion statement; schema 0.1 `text` remains source-derived. */
  readonly statement?: string;
  /** Authored criterion or architecture rationale when the source supplies one. */
  readonly rationale?: string;
  /** Source location of the semantic record, never a synthetic display locator. */
  readonly source: SourceLocator;
}

/**
 * Exact source-derived alternate lookup spelling for a canonical GraphIR address.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-ff543b95
 */
export interface GraphAliasRecord {
  /** Lookup spelling that the compiler observed in a source document. */
  readonly alias: string;
  /** Canonical semantic address represented by the spelling. */
  readonly address: string;
  /** Kind of spelling; callers can distinguish stable ids from mutable slugs. */
  readonly kind: 'feature_id' | 'feature_slug';
  /** Source location of the alias field. */
  readonly source: SourceLocator;
}

/** A semantic address owner in GraphIR. */
export interface SemanticGraphNode {
  /** Canonical semantic address such as `criterion:F-a/AC-b`. */
  readonly address: string;
  /** Discriminator for semantic nodes. */
  readonly nodeType: 'semantic';
  /** Semantic class represented by the node. */
  readonly kind: SemanticNodeKind;
  /** Authored source location. */
  readonly source: SourceLocator;
  /** F1 structural facts originate in schema source. */
  readonly provenance: GraphProvenance;
}

/** A physical artifact node with all of its applicable roles and owners. */
export interface ArtifactGraphNode {
  /** Canonical physical address such as `artifact:src/spec/load.ts`. */
  readonly address: string;
  /** Discriminator for artifact nodes. */
  readonly nodeType: 'artifact';
  /** A path can retain several roles without becoming duplicate nodes. */
  readonly roles: readonly ArtifactRole[];
  /** Every feature that authoritatively names this artifact. */
  readonly owners: readonly string[];
  /** Derived from authored locations or missing-target diagnosis. */
  readonly provenance: GraphProvenance;
  /** Source location for the first authored declaration when one exists. */
  readonly source?: SourceLocator;
}

/** A stable anchor located on one physical artifact. */
export interface AnchorGraphNode {
  /** Canonical physical anchor address such as `anchor:tests/x.test.ts#case-name`. */
  readonly address: string;
  /** Discriminator for anchor nodes. */
  readonly nodeType: 'anchor';
  /** Artifact address that contains the anchor. */
  readonly artifact: string;
  /** Canonical selector, from an authored fragment or an exact registry key. */
  readonly selector: string;
  /** Whether the canonical selector was authored or derived from an exact registry key. */
  readonly selectorProvenance: 'authored' | 'derived';
  /** Source location of the authored reference that materialized this anchor. */
  readonly source: SourceLocator;
  /** The anchor node originates from an authored legacy reference. */
  readonly provenance: GraphProvenance;
}

/** Any node materialized by the additive GraphIR compiler. */
export type GraphNode = SemanticGraphNode | ArtifactGraphNode | AnchorGraphNode;

/** Exact selector detail carried by an authored legacy reference. */
export interface GraphSelector {
  /** Whether the authored reference carried a selector. */
  readonly precision: 'none' | 'fragment';
  /** Raw selector after `#`, absent when no selector was authored. */
  readonly value?: string;
}

/** Channel that authored a legacy proof reference. */
export type LegacyReferenceChannel = 'test' | 'oracle' | 'evidence';

/** A relation with ownership, provenance, and optional legacy-reference detail. */
export interface GraphEdge {
  /** Deterministic edge address used only for sorting and diagnostics. */
  readonly address: string;
  /** Source node address. */
  readonly from: string;
  /** Target node address. */
  readonly to: string;
  /** Directed relation type. */
  readonly relation: GraphRelation;
  /** Whether source, compiler, or runtime established the relation. */
  readonly provenance: GraphProvenance;
  /** Authored source position responsible for this relation. */
  readonly owner: SourceLocator;
  /** State is present only when the relation has a resolvability or observation claim. */
  readonly state?: GraphState;
  /** Legacy channel retained without upgrading it to runtime observation. */
  readonly channel?: LegacyReferenceChannel;
  /** Raw source spelling retained for diagnosis and migration. */
  readonly raw?: string;
  /** Normalized target retained alongside the raw spelling. */
  readonly normalizedTarget?: string;
  /** Selector detail retained without manufacture. */
  readonly selector?: GraphSelector;
}

/** One compiler diagnostic whose source is safe to present in developer tooling. */
export interface CompilerDiagnostic {
  /** Stable diagnostic class. */
  readonly code:
    | 'UNKNOWN_SCHEMA'
    | 'INVALID_ROOT'
    | 'INVALID_FEATURE'
    | 'INVALID_SCENARIO'
    | 'INVALID_SCHEMA_02'
    | 'LEGACY_FIELD'
    | 'UNKNOWN_REFERENCE'
    | 'DUPLICATE_IDENTIFIER'
    | 'INVALID_STATEMENT'
    | 'ATOMICITY_RISK';
  /** Technical detail for an internal diagnostic or audit log. */
  readonly message: string;
  /** Location that caused the diagnostic when one exists. */
  readonly source?: SourceLocator;
  /** Advisory diagnostics never change structural compilation validity. */
  readonly severity?: 'blocking' | 'advisory';
  /** Stable observed detail codes for machine-readable diagnostics. */
  readonly details?: readonly string[];
}

/**
 * Exact project policies retained without compiler-created defaults.
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 */
interface Schema02ProjectContractBase {
  /** Required project identity. */
  readonly name: string;
  /** Required primary project language. */
  readonly language: string;
  /** Optional project WHAT statement retained when authored. */
  readonly description?: string;
  /** Optional project release marker retained when authored. */
  readonly version?: string;
  /** Optional project repository locator retained when authored. */
  readonly repository?: string;
  /** Optional onboarding provenance retained when authored. */
  readonly onboardingSeeded?: boolean;
  /** Explicit assurance level selected by the author. */
  readonly assuranceLevel: AssuranceLevel;
  /** Explicit scenario coverage policy selected by the author. */
  readonly scenarioPolicy: ScenarioPolicy;
  /** Existing runtime and proof policies preserved byte-for-value for later consumers. */
  readonly retainedPolicies: Readonly<Record<string, unknown>>;
}

/** Strict project intent authored directly in a schema 0.2 workspace.
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 */
export interface Schema02StrictProjectContract extends Schema02ProjectContractBase {
  /** Required project WHY statement. */
  readonly purpose: string;
}

/** Receipt-backed project projection retained only while its baseline matches.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface Schema02BaselineProjectContract extends Schema02ProjectContractBase {
  /** Identity of the exact project exemption that permits the missing purpose. */
  readonly baselineIdentity: string;
}

/** Strict or receipt-backed project intent available to downstream consumers.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export type Schema02ProjectContract = Schema02StrictProjectContract | Schema02BaselineProjectContract;

/**
 * Canonical schema 0.2 capability outcome record.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export interface Schema02CapabilityContract {
  /** Stable catalog identity. */
  readonly id: string;
  /** Human-facing capability label. */
  readonly title: string;
  /** Required observable capability outcome. */
  readonly outcome: string;
}

/**
 * One strict schema 0.2 acceptance criterion retained for downstream closures.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
interface Schema02CriterionContractBase {
  /** Feature-scoped criterion identifier. */
  readonly id: string;
  /** Strict EARS statement. */
  readonly statement: string;
  /** Local WHY for a constraint when authored. */
  readonly rationale?: string;
  /** Referenced architecture rules when authored. */
  readonly constraintRefs: readonly string[];
  /** Existing oracle locations retained without turning them into F3 bindings. */
  readonly oracleRefs?: readonly string[];
  /** Existing evidence locations retained without turning them into F3 observations. */
  readonly evidenceRefs?: readonly string[];
  /** Free-form context retained outside future intent hashes and intent triggers. */
  readonly notes?: string;
}

/** A criterion with current schema 0.2 intent classification.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
export interface Schema02StrictCriterionContract extends Schema02CriterionContractBase {
  /** Persisted criterion classification. */
  readonly kind: 'behavior' | 'quality' | 'constraint';
}

/** A criterion whose exact legacy statement remains classified only by its receipt.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface Schema02BaselineCriterionContract extends Schema02CriterionContractBase {
  /** Internal classification that never invents behavior for legacy intent. */
  readonly kind: 'legacy_unclassified';
  /** Identity of the exact criterion exemption that permits this projection. */
  readonly baselineIdentity: string;
}

/** Strict or receipt-backed criterion intent available to downstream consumers.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export type Schema02CriterionContract = Schema02StrictCriterionContract | Schema02BaselineCriterionContract;

/**
 * One schema 0.2 feature contract with its sole capability-edge owner.
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
interface Schema02FeatureContractBase {
  /** Stable feature identifier. */
  readonly id: string;
  /** Human-facing feature label. */
  readonly title: string;
  /** Persisted lifecycle state. */
  readonly status: Schema02FeatureStatus;
  /** Authored module paths, retained in source order when supplied. */
  readonly modules?: readonly string[];
  /** Explicit feature dependencies, retained in source order when supplied. */
  readonly dependsOn?: readonly string[];
  /** Governance state preserved as authored, not treated as requirement prose. */
  readonly designImpact?: Readonly<Record<string, unknown>>;
  /** Archive timestamp retained when authored. */
  readonly archivedAt?: string;
  /** Archive rationale retained when authored. */
  readonly archiveReason?: string;
  /** Superseding feature identity retained when authored. */
  readonly supersededBy?: string;
  /** Required non-empty block explanation only while status is blocked. */
  readonly blockedReason?: string;
  /** Explicit capability edge set, including a deliberate empty list. */
  readonly capabilityRefs: readonly string[];
  /** Criteria in deterministic composite-address order. */
  readonly acceptanceCriteria: readonly Schema02CriterionContract[];
}

/** A feature with current schema 0.2 purpose.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
export interface Schema02StrictFeatureContract extends Schema02FeatureContractBase {
  /** Required feature WHY statement. */
  readonly purpose: string;
}

/** A feature whose absent purpose is permitted by one matching receipt exemption.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export interface Schema02BaselineFeatureContract extends Schema02FeatureContractBase {
  /** Identity of the exact feature exemption that permits the missing purpose. */
  readonly baselineIdentity: string;
}

/** Strict or receipt-backed feature intent available to downstream consumers.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export type Schema02FeatureContract = Schema02StrictFeatureContract | Schema02BaselineFeatureContract;

/** Complete schema 0.2 journey retained by the compiler contract.
 * @see docs/design/spec-0.2/model-and-migration.md#d09--scenario-contract
 */
export interface Schema02ScenarioContract {
  /** Stable scenario identity. */
  readonly id: string;
  /** Human-facing scenario label; assurance hashes deliberately exclude it. */
  readonly title: string;
  /** Journey actor. */
  readonly actor: string;
  /** Journey goal. */
  readonly goal: string;
  /** Observable success condition. */
  readonly success: string;
  /** Ordered authored journey steps. */
  readonly steps: readonly string[];
  /** Every feature covered by this journey. */
  readonly featureRefs: readonly string[];
}

/**
 * One directed architecture prohibition; `from` imports `to`.
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export interface Schema02ArchitectureRuleContract {
  /** Stable architecture-rule address suffix. */
  readonly id: string;
  /** Initial architecture rule kind. */
  readonly kind: 'forbidden_import';
  /** Importing layer. */
  readonly from: string;
  /** Imported dependency layer. */
  readonly to: string;
  /** Required local reason for the boundary. */
  readonly rationale: string;
}

/**
 * Canonical schema 0.2 architecture contract.
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export interface Schema02ArchitectureContract {
  /** Foundation-to-entry ordered layer groups. */
  readonly layers: readonly (readonly string[])[];
  /** Rules sorted by stable identifier. */
  readonly rules: readonly Schema02ArchitectureRuleContract[];
}

/** Compiler-validated root inventory projection for legacy consumers. */
export interface Schema02InventoryContract {
  /** Declared feature-shard count. */
  readonly features: number;
  /** Declared scenario-shard count. */
  readonly scenarios: number;
  /** Declared capability count. */
  readonly capabilities: number;
  /** Declared executable-test file count. */
  readonly testFiles: number;
}

/**
 * Typed schema 0.2 contract retained by the compiler after successful validation.
 *
 * This is the single downstream authority for F6/F8 consumers; it is absent
 * when a blocking diagnostic means that a partial contract would be unsafe.
 *
 * @see docs/design/spec-0.2/model-and-migration.md#d05--project-contract
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 * @see docs/design/spec-0.2/model-and-migration.md#d08--architecture-contract
 */
export interface Schema02ContractProjection {
  /** Validated project policies. */
  readonly project: Schema02ProjectContract;
  /** Canonical capability catalog sorted by identity. */
  readonly capabilities: readonly Schema02CapabilityContract[];
  /** Feature contracts sorted by identifier. */
  readonly features: readonly Schema02FeatureContract[];
  /** Complete scenario journeys sorted by identity, independent of coverage policy. */
  readonly scenarios: readonly Schema02ScenarioContract[];
  /** Validated architecture boundary contract. */
  readonly architecture: Schema02ArchitectureContract;
  /** Optional closed root inventory, never a raw loader merge. */
  readonly inventory?: Schema02InventoryContract;
}

/** Successful additive compilation result. */
export interface SpecCompilation {
  /** Root-selected schema version. */
  readonly schemaVersion: CompilerSchemaVersion;
  /** Deterministically ordered graph nodes. */
  readonly nodes: readonly GraphNode[];
  /** Deterministically ordered graph relations. */
  readonly edges: readonly GraphEdge[];
  /** Structural diagnostics accumulated without changing legacy gates. */
  readonly diagnostics: readonly CompilerDiagnostic[];
  /** Sorted source-derived display records for both supported source schemas. */
  readonly presentations: readonly GraphPresentationRecord[];
  /** Sorted feature id and slug aliases; collision handling belongs to the query index. */
  readonly aliases: readonly GraphAliasRecord[];
  /** Fully validated schema 0.2 values for downstream compiler consumers. */
  readonly contract?: Schema02ContractProjection;
  /** Validated compiler-owned migration receipt, retained for D11 compatibility reads. */
  readonly migrationBaseline?: import('./migration-baseline.js').MigrationBaseline;
  /**
   * Source-bearing historic bindings projected from the validated migration receipt.
   *
   * These records remain outside the live graph because historic bindings are not
   * authored proof edges. They let independent scanner parity retain every
   * migration-proof field without promoting history to executable proof.
   */
  readonly migrationProofs?: readonly CorpusProofRecord[];
}

/** Raw schema 0.1 artifacts exposed only through the compiler migration boundary. */
export interface CompilerMigrationSource {
  /** Root-selected source schema; callers cannot choose a child schema. */
  readonly schemaVersion: '0.1';
  /** Root document after YAML decoding. */
  readonly root: Readonly<Record<string, unknown>>;
  /** Sorted feature shards with their source paths. */
  readonly features: readonly {readonly path: string; readonly value: unknown}[];
  /** Optional legacy capability source, including an inline root collection. */
  readonly capabilities?: unknown;
  /** Optional architecture source requiring later semantic migration. */
  readonly architecture?: Readonly<Record<string, unknown>>;
  /** Sorted scenario source records requiring later semantic migration. */
  readonly scenarios: readonly {readonly path: string; readonly value: unknown}[];
}

/** Semantic owner record used for independent scanner/compiler parity. */
export interface SemanticOwnerRecord {
  /** Canonical semantic address. */
  readonly address: string;
  /** Owning semantic address; a feature owns its criteria. */
  readonly owner: string;
  /** Direct source locator for the semantic record. */
  readonly source: SourceLocator;
}

/** One sorted proof record used for independent parity checks. */
export interface CorpusProofRecord {
  /** Composite criterion address that owns the reference. */
  readonly owner: string;
  /** Authored reference channel. */
  readonly channel: LegacyReferenceChannel;
  /** Unchanged source spelling. */
  readonly raw: string;
  /** Canonical structural target address. */
  readonly normalizedTarget: string;
  /** Selector precision and optional exact selector. */
  readonly selector: GraphSelector;
  /** Structural resolution state only; F1 does not observe execution. */
  readonly resolution: 'resolved' | 'unresolved';
  /** Source location of the reference scalar. */
  readonly source: SourceLocator;
}

/** Sorted graph projection compared with the independent source scanner. */
export interface CompilerCorpusView {
  /** Semantic nodes with explicit owner and location. */
  readonly semanticOwners: readonly SemanticOwnerRecord[];
  /** Authored feature prerequisite facts. */
  readonly prerequisites: readonly {readonly feature: string; readonly prerequisite: string; readonly source: SourceLocator}[];
  /** Derived reverse dependency facts. */
  readonly dependents: readonly {readonly feature: string; readonly dependent: string; readonly source: SourceLocator}[];
  /** Multi-owner artifact records. */
  readonly artifactOwners: readonly {readonly artifact: string; readonly owners: readonly string[]}[];
  /** Authored legacy proof references. */
  readonly proofs: readonly CorpusProofRecord[];
  /** F1 regression records are authored test-reference records only. */
  readonly regressions: readonly CorpusProofRecord[];
}
