// Cladding · F6 P1-1 — private authority retained by the gate coordinator.

import {createHash} from 'node:crypto';

import {canonicalClosureJson} from './closures.js';
import type {AssuranceVerdict} from './kernel.js';

// This module is deliberately internal to the CLI bundle. `mint...` accepts a
// completed reducer object plus the coordinator's already-owned snapshot/scope
// and execution identities; it never accepts raw observations or stages.
const RUN_CHECK_STAGES_AUTHORITIES = new WeakMap<AssuranceVerdict, {
  readonly inputSha256: string;
  readonly scopeSha256: string;
  readonly featureIds: ReadonlySet<string>;
  readonly featureSeals: ReadonlyMap<string, AttestationFeatureSeal>;
  readonly profileIdentity: AttestationProfileIdentity;
  /** Hashes each result's subject/state together with its observation IDs. */
  readonly observationSeal: string;
}>();

/** Compiler plan and adapter execution identities that only runCheckStages supplies. */
export interface RunCheckStagesAuthorityInput {
  readonly inputSha256: string;
  readonly scopeAddresses: readonly string[];
  readonly profileAuthoritative: boolean;
  readonly executedStageIds: readonly string[];
  /** Compiler-owned closure fields for every feature this run may attest. */
  readonly featureSeals: readonly AttestationFeatureSeal[];
  /** Current registry, tool, environment, and trust identities for the row. */
  readonly profileIdentity: AttestationProfileIdentity;
}

/** The feature-local compiler closure identities a v3 row must retain. */
export interface AttestationFeatureSeal {
  readonly feature: string;
  readonly contractSha256: string;
  readonly subjectSha256: string;
  readonly verificationSha256: string;
  readonly runtimeDependencySha256: string;
}

/** Current non-feature identities a v3 row must retain. */
export interface AttestationProfileIdentity {
  readonly registrySha256: string;
  readonly detectorCatalogSha256: string;
  readonly toolIdentity: string;
  readonly environmentClass: string;
  readonly trustSnapshotSha256: string;
}

/**
 * Mints private in-process authority after the actual coordinator has reduced
 * its compiler plan and current stage execution.
 *
 * @internal Product-call census: src/cli/clad.ts is the only permitted caller.
 */
export function mintRunCheckStagesAuthority(
  verdict: AssuranceVerdict,
  input: RunCheckStagesAuthorityInput,
): void {
  const featureIds = new Set(input.scopeAddresses.flatMap((address) =>
    address.startsWith('feature:') ? [address.slice('feature:'.length)] : [],
  ));
  const observationIdentities = verdictObservationIdentities(verdict);
  const observationSeal = verdictObservationSeal(verdict);
  const observedStages = new Set(input.executedStageIds);
  const featureSeals = new Map(input.featureSeals.map((seal) => [seal.feature, Object.freeze({...seal})]));
  const scopeSha256 = createHash('sha256').update(
    canonicalClosureJson([...input.scopeAddresses].sort()),
    'utf8',
  ).digest('hex');
  // v3 has no authority for a fallback profile, an incomplete compiler
  // closure, a stage the coordinator did not execute, or a synthetic GREEN.
  if (!input.profileAuthoritative || featureIds.size === 0
    || featureSeals.size !== input.featureSeals.length
    || [...featureIds].some((feature) => !featureSeals.has(feature))
    || verdict.input_sha256 !== input.inputSha256
    || verdict.scope_sha256 !== scopeSha256
    || verdict.state !== 'green' || !verdict.profile_complete
    || hasDuplicateResultKeys(verdict)
    || observationIdentities.length === 0
    || verdict.results.some((result) => result.state === 'pass' && !observedStages.has(result.obligation))
    || !validMigrationBaselineRows(verdict, observedStages)) return;
  RUN_CHECK_STAGES_AUTHORITIES.set(verdict, Object.freeze({
    inputSha256: input.inputSha256,
    scopeSha256,
    featureIds,
    featureSeals,
    profileIdentity: Object.freeze({...input.profileIdentity}),
    observationSeal,
  }));
}

/** Read-only v3 authority check used by the attestation boundary. */
export function hasRunCheckStagesAuthority(
  verdict: AssuranceVerdict,
  feature: string,
  inputSha256: string,
  seal: Omit<AttestationFeatureSeal, 'feature'>,
  profileIdentity: AttestationProfileIdentity,
): boolean {
  const authority = RUN_CHECK_STAGES_AUTHORITIES.get(verdict);
  const expectedSeal = authority?.featureSeals.get(feature);
  return authority !== undefined
    && authority.inputSha256 === inputSha256
    && authority.inputSha256 === verdict.input_sha256
    && authority.scopeSha256 === verdict.scope_sha256
    && authority.featureIds.has(feature)
    && expectedSeal !== undefined
    && expectedSeal.contractSha256 === seal.contractSha256
    && expectedSeal.subjectSha256 === seal.subjectSha256
    && expectedSeal.verificationSha256 === seal.verificationSha256
    && expectedSeal.runtimeDependencySha256 === seal.runtimeDependencySha256
    && authority.profileIdentity.registrySha256 === profileIdentity.registrySha256
    && authority.profileIdentity.detectorCatalogSha256 === profileIdentity.detectorCatalogSha256
    && authority.profileIdentity.toolIdentity === profileIdentity.toolIdentity
    && authority.profileIdentity.environmentClass === profileIdentity.environmentClass
    && authority.profileIdentity.trustSnapshotSha256 === profileIdentity.trustSnapshotSha256
    && verdict.state === 'green'
    && verdict.profile_complete
    && authority.observationSeal === verdictObservationSeal(verdict);
}

function verdictObservationIdentities(verdict: AssuranceVerdict): string[] {
  return [...new Set(verdict.results.flatMap((result) => result.observation_identities))].sort();
}

/** D13 rows have one resolved outcome for every `(obligation, subject)` key. */
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

function verdictObservationSeal(verdict: AssuranceVerdict): string {
  return createHash('sha256').update(canonicalClosureJson(verdict.results.map((result) => ({
    obligation: result.obligation,
    subject: result.subject,
    state: result.state,
    source_strictness: result.source_strictness ?? null,
    blocking: result.blocking,
    reason: result.reason ?? null,
    migration_baseline: result.migration_baseline ?? null,
    observation_identities: [...result.observation_identities].sort(),
  }))), 'utf8').digest('hex');
}

/** Validates that every receipt-backed row is anchored by this run's current scope pass. */
function validMigrationBaselineRows(verdict: AssuranceVerdict, observedStages: ReadonlySet<string>): boolean {
  return verdict.results
    .filter((result) => result.state === 'migration_baseline')
    .every((result) => {
      if ((result.obligation !== 'stage_2.1' && result.obligation !== 'stage_2.2')
        || !result.subject.startsWith('criterion:')
        || result.observation_identities.length !== 0
        || !validBasis(result.migration_baseline)
        || !observedStages.has(result.obligation)) return false;
      return verdict.results.some((scope) => scope.obligation === result.obligation
        && scope.subject === `scope:${verdict.scope_sha256}`
        && scope.state === 'pass'
        && scope.observation_identities.length > 0
        && observedStages.has(scope.obligation));
    });
}

/** Keeps private authority from sealing a copied or structurally incomplete receipt basis. */
function validBasis(value: AssuranceVerdict['results'][number]['migration_baseline']): boolean {
  return value !== undefined
    && isSha256(value.baseline_receipt_sha256)
    && isSha256(value.resolution_sha256)
    && isSha256(value.criterion_authorization_sha256);
}

/** The migration receipt protocol uses lower-case full SHA-256 identities. */
function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
