// Cladding · Spec 0.2 F6 · typed v3 payload, with no filesystem writer.

import {createHash} from 'node:crypto';

import {canonicalClosureJson} from './closures.js';
import {hasRunCheckStagesAuthority} from './run-authority.js';
import type {AssuranceVerdict} from './kernel.js';
import {compareCodeUnits, type AssuranceLevel} from './registry.js';
import type {PersistedReceiptCandidate} from './receipt-adapter.js';
import {
  createTrustSnapshot,
  parsePortableReceiptYaml,
  type ReceiptExpectedDigestContext,
  type TrustSnapshot,
} from '../proof/receipt.js';

// This mark never enters canonical JSON.  It prevents arbitrary parsed or
// hand-built data from reaching the only persisted writer; a reader still
// treats the stored document as untrusted and revalidates every field.
const AUTHORITATIVE_V3 = Symbol('authoritative-v3');
const RETENTION_CONTEXT = Symbol('retention-context');
// Symbols keep the runtime marker out of serialized data, while these private
// membership sets also prevent reflective copying of a Symbol property from
// turning a caller-created object into writer authority.
const AUTHORITATIVE_V3_ROWS = new WeakSet<object>();
const RETENTION_CONTEXTS = new WeakSet<object>();

/** Compact persisted v3 data.  Receipt bodies intentionally never cross this boundary. */
export interface AttestationV3 {
  readonly attestation_schema: '3';
  /** Feature whose closure this entry seals; no broad scope is implied. */
  readonly feature: string;
  readonly profile: 'completion' | 'push' | 'release';
  readonly configured_assurance_level: AssuranceLevel;
  readonly achieved_assurance_level: AssuranceLevel | 'none';
  readonly scope_sha256: string;
  readonly input_sha256: string;
  readonly contract_sha256: string;
  readonly subject_sha256: string;
  readonly verification_sha256: string;
  readonly runtime_dependency_sha256: string;
  readonly profile_sha256: string;
  readonly obligation_sha256: string;
  readonly registry_sha256: string;
  readonly detector_catalog_sha256: string;
  readonly tool_identity: string;
  readonly environment_class: string;
  readonly trust_snapshot_sha256: string;
  readonly observation_identities: readonly string[];
  readonly observation_counts: Readonly<{required: number; pass: number; na: number; migration_baseline: number}>;
  /** Present only when this attested profile scope compacted current L2 baseline rows. */
  readonly migration_baseline?: MigrationBaselineAttestationSummary;
}

/** Compact, scope-wide receipt evidence for non-observation L2 rows. */
export interface MigrationBaselineAttestationSummary {
  readonly baseline_receipt_sha256: string;
  readonly resolution_sha256: string;
  readonly criterion_authorization_sha256: readonly string[];
  readonly criterion_count: number;
  readonly obligation_count: number;
}

/** A v3 payload minted solely after the authoritative gate coordinator check. */
export type AuthoritativeAttestationV3 = AttestationV3 & {
  readonly [AUTHORITATIVE_V3]: true;
};

/**
 * Current receipt candidates and trust supplied by the assurance/issuer seam.
 * F6 supplies the empty trust snapshot until F9 registers product issuers; the
 * writer deliberately does not synthesize either input from persisted YAML.
 *
 * @see docs/design/spec-0.2/assurance.md#d23--attestation-reducer
 * @since 0.10.0
 */
export interface AttestationReceiptContext {
  /** Candidates consumed by the current gate's F5 proof reducer. */
  readonly candidates: readonly PersistedReceiptCandidate[];
  readonly trustSnapshot: TrustSnapshot;
  /**
   * Complete canonical receipt census F9 can provide for a writer-lock reread.
   * It has exactly one distinct path per candidate; the writer rereads every
   * path, requires each file's parsed subject/digest-derived `.yaml` address,
   * and requires the live `(bytes, expected)` multiset to equal the immutable
   * candidate snapshot. A non-empty precomputed candidate set without this
   * census cannot retain an old row: receipt bytes may have been revoked or
   * removed after the gate.
   */
  readonly currentLocations?: readonly {
    readonly path: string;
    readonly expected: ReceiptExpectedDigestContext;
  }[];
}

/**
 * Private authority carried from the current GREEN reducer result to the F4
 * writer.  Its symbol is intentionally not serialized, so parsed data and
 * arbitrary callback objects cannot bless a prior v3 row.
 *
 * @see docs/design/spec-0.2/assurance.md#d23--attestation-reducer
 * @since 0.10.0
 */
export type AttestationV3RetentionContext = {
  readonly [RETENTION_CONTEXT]: {
    readonly receiptContext: AttestationReceiptContext;
    readonly current: Pick<AttestationV3,
      | 'configured_assurance_level'
      | 'registry_sha256'
      | 'detector_catalog_sha256'
      | 'tool_identity'
      | 'environment_class'
      | 'trust_snapshot_sha256'
    >;
  };
};

/** Inputs seal every identity D13/D23 require while keeping write ownership in spec/attestation.ts. */
export interface AttestationV3Input {
  readonly verdict: AssuranceVerdict;
  readonly feature: string;
  readonly contractSha256: string;
  readonly subjectSha256: string;
  readonly verificationSha256: string;
  readonly runtimeDependencySha256: string;
  readonly registrySha256: string;
  readonly detectorCatalogSha256: string;
  readonly toolIdentity: string;
  readonly environmentClass: string;
  readonly trustSnapshotSha256: string;
}

/** Returns a v3 payload only from an authoritative profile-complete GREEN verdict. */
export function mintWorkspaceAttestationV3(input: AttestationV3Input): AuthoritativeAttestationV3 | undefined {
  const verdict = input.verdict;
  if (verdict.results.length === 0
    || (verdict.profile !== 'completion' && verdict.profile !== 'push' && verdict.profile !== 'release')
    || !verdict.profile_complete || verdict.state !== 'green'
    // D13 persists compact result-state counts. A complete GREEN may
    // retain an upstream report failure, but no hard failure, missing result,
    // or ambiguous duplicate result can enter that compact projection.
    || hasDuplicateResultKeys(verdict)
    || verdict.results.some((result) => result.state === 'unobserved'
      || (result.state === 'fail' && result.blocking !== 'report'))
    // D23: public/serialized reducer output is intentionally useful machine
    // data, not writer authority. This predicate succeeds only for the exact
    // in-process object sealed by runCheckStages from its compiler plan and
    // current adapter observations.
    || !hasRunCheckStagesAuthority(verdict, input.feature, verdict.input_sha256, {
      contractSha256: input.contractSha256,
      subjectSha256: input.subjectSha256,
      verificationSha256: input.verificationSha256,
      runtimeDependencySha256: input.runtimeDependencySha256,
    }, {
      registrySha256: input.registrySha256,
      detectorCatalogSha256: input.detectorCatalogSha256,
      toolIdentity: input.toolIdentity,
      environmentClass: input.environmentClass,
      trustSnapshotSha256: input.trustSnapshotSha256,
    })) return undefined;
  const migrationBaseline = compactMigrationBaselineRows(verdict.results);
  if (migrationBaseline === undefined) return undefined;
  const observationIdentities = [...new Set(verdict.results.flatMap((result) => result.observation_identities))].sort(compareCodeUnits);
  const counts = {
    required: verdict.results.filter((result) => result.state !== 'na').length,
    pass: verdict.results.filter((result) => result.state === 'pass').length,
    na: verdict.results.filter((result) => result.state === 'na').length,
    migration_baseline: verdict.results.filter((result) => result.state === 'migration_baseline').length,
  };
  if (counts.required === 0 || observationIdentities.length < counts.required - counts.migration_baseline) return undefined;
  const profile_sha256 = attestationProfileSha256({
    profile: verdict.profile, assuranceLevel: verdict.assurance_level,
    configuredAssuranceLevel: verdict.configured_assurance_level, registrySha256: input.registrySha256,
    detectorCatalogSha256: input.detectorCatalogSha256, toolIdentity: input.toolIdentity,
    environmentClass: input.environmentClass, trustSnapshotSha256: input.trustSnapshotSha256,
  });
  const entry = Object.freeze({
    attestation_schema: '3', feature: input.feature, profile: verdict.profile, configured_assurance_level: verdict.configured_assurance_level,
    achieved_assurance_level: verdict.achieved_assurance_level, scope_sha256: verdict.scope_sha256,
    input_sha256: verdict.input_sha256, contract_sha256: input.contractSha256, subject_sha256: input.subjectSha256,
    verification_sha256: input.verificationSha256, runtime_dependency_sha256: input.runtimeDependencySha256,
    profile_sha256, obligation_sha256: verdict.obligation_sha256, registry_sha256: input.registrySha256,
    detector_catalog_sha256: input.detectorCatalogSha256, tool_identity: input.toolIdentity,
    environment_class: input.environmentClass, trust_snapshot_sha256: input.trustSnapshotSha256,
    observation_identities: Object.freeze(observationIdentities), observation_counts: Object.freeze(counts),
    ...(migrationBaseline === null ? {} : {migration_baseline: migrationBaseline}),
    [AUTHORITATIVE_V3]: true as const,
  });
  AUTHORITATIVE_V3_ROWS.add(entry);
  return entry;
}

/**
 * Validates the non-observation receipt rows before compacting them for one
 * profile scope. A malformed group must refuse the complete writer operation: it
 * must never be reinterpreted as an ordinary passing observation.
 */
function compactMigrationBaselineRows(
  results: readonly AssuranceVerdict['results'][number][],
): MigrationBaselineAttestationSummary | null | undefined {
  const rows = results.filter((result) => result.state === 'migration_baseline');
  if (rows.length === 0) return null;
  const bySubject = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!/^criterion:[^/]+\/[^/]+$/.test(row.subject)
      || (row.obligation !== 'stage_2.1' && row.obligation !== 'stage_2.2')
      || row.observation_identities.length !== 0
      || !isMigrationBaselineBasis(row.migration_baseline)) return undefined;
    const subjectRows = bySubject.get(row.subject) ?? [];
    subjectRows.push(row);
    bySubject.set(row.subject, subjectRows);
  }
  const summaries: Array<{readonly subject: string; readonly basis: NonNullable<AssuranceVerdict['results'][number]['migration_baseline']>}> = [];
  for (const [subject, subjectRows] of bySubject) {
    if (subjectRows.length !== 2
      || new Set(subjectRows.map((row) => row.obligation)).size !== 2
      || subjectRows.some((row) => row.obligation !== 'stage_2.1' && row.obligation !== 'stage_2.2')) return undefined;
    const basis = subjectRows[0]!.migration_baseline!;
    if (subjectRows.some((row) => row.migration_baseline?.baseline_receipt_sha256 !== basis.baseline_receipt_sha256
      || row.migration_baseline?.resolution_sha256 !== basis.resolution_sha256
      || row.migration_baseline?.criterion_authorization_sha256 !== basis.criterion_authorization_sha256)) return undefined;
    summaries.push({subject, basis});
  }
  const first = summaries[0]!.basis;
  if (summaries.some((summary) => summary.basis.baseline_receipt_sha256 !== first.baseline_receipt_sha256
    || summary.basis.resolution_sha256 !== first.resolution_sha256)) return undefined;
  const authorizations = summaries.map((summary) => summary.basis.criterion_authorization_sha256)
    .sort(compareCodeUnits);
  if (new Set(authorizations).size !== authorizations.length) return undefined;
  const obligationCount = summaries.length * 2;
  return Object.freeze({
    baseline_receipt_sha256: first.baseline_receipt_sha256,
    resolution_sha256: first.resolution_sha256,
    criterion_authorization_sha256: Object.freeze(authorizations),
    criterion_count: summaries.length,
    obligation_count: obligationCount,
  });
}

/** Returns whether one generic kernel basis is safe to persist. */
function isMigrationBaselineBasis(
  value: AssuranceVerdict['results'][number]['migration_baseline'],
): value is NonNullable<AssuranceVerdict['results'][number]['migration_baseline']> {
  return value !== undefined
    && /^[a-f0-9]{64}$/.test(value.baseline_receipt_sha256)
    && /^[a-f0-9]{64}$/.test(value.resolution_sha256)
    && /^[a-f0-9]{64}$/.test(value.criterion_authorization_sha256);
}

/** One compact result may exist for each obligation/subject identity. */
function hasDuplicateResultKeys(verdict: AssuranceVerdict): boolean {
  const subjectsByObligation = new Map<string, Set<string>>();
  return verdict.results.some((result) => {
    const subjects = subjectsByObligation.get(result.obligation) ?? new Set<string>();
    if (subjects.has(result.subject)) return true;
    subjects.add(result.subject);
    subjectsByObligation.set(result.obligation, subjects);
    return false;
  });
}

/**
 * Creates the writer-only current receipt/trust authority for retention.
 *
 * Replacements must already have reducer provenance and agree on the global
 * policy/tool/trust identity. Each retained row reconstructs its own allowed
 * completion/push/release profile and scope; a parsed prior row cannot create
 * this context or alter the current identity.
 *
 * @param replacements - Current in-memory branded replacement rows.
 * @param receiptContext - Immutable current receipt/trust candidates.
 * @returns Private writer authority, or undefined when its inputs disagree.
 * @throws Never; malformed trust material fails closed as undefined.
 * @see docs/design/spec-0.2/assurance.md#d23--attestation-reducer
 * @since 0.10.0
 */
export function createAttestationV3RetentionContext(
  replacements: readonly AuthoritativeAttestationV3[],
  receiptContext: AttestationReceiptContext,
): AttestationV3RetentionContext | undefined {
  const first = replacements[0];
  if (!first || replacements.some((entry) => !isAuthoritativeAttestationV3(entry))) return undefined;
  const current = {
    configured_assurance_level: first.configured_assurance_level,
    registry_sha256: first.registry_sha256,
    detector_catalog_sha256: first.detector_catalog_sha256,
    tool_identity: first.tool_identity,
    environment_class: first.environment_class,
    trust_snapshot_sha256: first.trust_snapshot_sha256,
  } as const;
  const trustSnapshot = normalizedTrustSnapshot(receiptContext.trustSnapshot);
  if (!trustSnapshot || current.trust_snapshot_sha256 !== trustSnapshot.digest) return undefined;
  const keys = Object.keys(current) as (keyof typeof current)[];
  if (replacements.some((entry) => keys.some((key) => entry[key] !== current[key]))) return undefined;
  const currentLocations = receiptContext.currentLocations;
  if (currentLocations !== undefined) {
    if (currentLocations.length !== receiptContext.candidates.length
      || new Set(currentLocations.map((location) => location.path)).size !== currentLocations.length) return undefined;
  } else if (receiptContext.candidates.length !== 0) {
    return undefined;
  }
  const candidates: PersistedReceiptCandidate[] = [];
  for (const candidate of receiptContext.candidates) {
    const snapshot = immutableReceiptCandidate(candidate);
    if (!snapshot) return undefined;
    candidates.push(snapshot);
  }
  const context = Object.freeze({
    [RETENTION_CONTEXT]: Object.freeze({
      receiptContext: Object.freeze({
        // Portable parsing uses fatal UTF-8 decoding before this copy.  Thus a
        // mutable Uint8Array can neither change after mint nor collapse to a
        // replacement-character string that identifies another receipt.
        candidates: Object.freeze(candidates),
        trustSnapshot: Object.freeze({
          keys: Object.freeze(trustSnapshot.keys.map((key) => Object.freeze({...key}))),
          digest: trustSnapshot.digest,
        }),
        ...(currentLocations === undefined ? {} : {
          currentLocations: Object.freeze(currentLocations.map((location) => Object.freeze({
            path: location.path,
            expected: Object.freeze({...location.expected}),
          }))),
        }),
      }),
      current: Object.freeze(current),
    }),
  });
  RETENTION_CONTEXTS.add(context);
  return context;
}

/** Copies only a parseable portable receipt into private writer authority. */
function immutableReceiptCandidate(candidate: PersistedReceiptCandidate): PersistedReceiptCandidate | undefined {
  try {
    const bytes = typeof candidate.bytes === 'string'
      ? candidate.bytes
      : new TextDecoder('utf-8', {fatal: true}).decode(candidate.bytes);
    parsePortableReceiptYaml(bytes);
    return Object.freeze({bytes, expected: Object.freeze({...candidate.expected})});
  } catch {
    return undefined;
  }
}

/** Rebuilds host trust material so a forged digest/key pairing cannot mint retention authority. */
function normalizedTrustSnapshot(snapshot: TrustSnapshot): TrustSnapshot | undefined {
  try {
    const normalized = createTrustSnapshot(snapshot.keys.map((key) => ({
      issuer: key.issuer,
      issuerKeyId: key.issuerKeyId,
      spkiDer: Buffer.from(key.spkiDerBase64, 'base64'),
    })));
    return normalized.digest === snapshot.digest ? normalized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns writer state only when it bears this module's private authority mark.
 *
 * @param context - Candidate authority supplied at the F4 writer seam.
 * @returns Its immutable state, or undefined for parsed, forged, or stale-shape objects.
 * @throws Never.
 * @see docs/design/spec-0.2/assurance.md#d23--attestation-reducer
 * @since 0.10.0
 */
export function attestationV3RetentionState(
  context: AttestationV3RetentionContext | undefined,
): AttestationV3RetentionContext[typeof RETENTION_CONTEXT] | undefined {
  return context !== undefined && RETENTION_CONTEXTS.has(context)
    ? context[RETENTION_CONTEXT]
    : undefined;
}

/**
 * Recomputes the persisted profile identity from current assurance inputs.
 *
 * @param input - Current profile, policy, tool, environment, and trust identities.
 * @returns SHA-256 identity used by a persisted v3 row.
 * @throws Never for JSON-safe strings.
 * @see docs/design/spec-0.2/assurance.md#d23--attestation-reducer
 * @since 0.10.0
 */
export function attestationProfileSha256(input: {
  readonly profile: AttestationV3['profile'];
  readonly assuranceLevel: AssuranceLevel;
  readonly configuredAssuranceLevel: AssuranceLevel;
  readonly registrySha256: string;
  readonly detectorCatalogSha256: string;
  readonly toolIdentity: string;
  readonly environmentClass: string;
  readonly trustSnapshotSha256: string;
}): string {
  return createHash('sha256').update(canonicalClosureJson({
    profile: input.profile, assurance_level: input.assuranceLevel,
    configured_assurance_level: input.configuredAssuranceLevel, registry_sha256: input.registrySha256,
    detector_catalog_sha256: input.detectorCatalogSha256, tool_identity: input.toolIdentity,
    environment_class: input.environmentClass, trust_snapshot_sha256: input.trustSnapshotSha256,
  }), 'utf8').digest('hex');
}

/** Returns true only for the in-process payload minted by {@link mintWorkspaceAttestationV3}. */
export function isAuthoritativeAttestationV3(value: AttestationV3): value is AuthoritativeAttestationV3 {
  return AUTHORITATIVE_V3_ROWS.has(value)
    && (value as Partial<AuthoritativeAttestationV3>)[AUTHORITATIVE_V3] === true;
}

/** Deterministically serializes a parsed v3 payload for the sole attestation writer. */
export function serializeAttestationV3(value: AttestationV3): string {
  return canonicalClosureJson(value);
}
