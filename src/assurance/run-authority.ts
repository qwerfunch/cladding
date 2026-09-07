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
  return explainRunCheckStagesAuthority(verdict, feature, inputSha256, seal, profileIdentity) === undefined;
}

/**
 * Names the first authority condition a candidate row fails, in plain words.
 *
 * The predicate above is the decision; this is its diagnosis, and both read the
 * same list so a refusal can never be explained by a condition the gate does
 * not actually apply. A silent refusal is what made the receipt/attestation
 * seal split invisible for a whole release.
 *
 * @param verdict - The in-process reducer verdict the authority was minted for.
 * @param feature - Feature whose row is being minted.
 * @param inputSha256 - Compiler snapshot identity the caller sealed.
 * @param seal - Candidate closure seals for this feature.
 * @param profileIdentity - Candidate registry/tool/environment/trust identities.
 * @returns The failing condition and its detail, or undefined when authority holds.
 * @throws Never.
 * @since 0.10.0
 * @internal
 */
export function explainRunCheckStagesAuthority(
  verdict: AssuranceVerdict,
  feature: string,
  inputSha256: string,
  seal: Omit<AttestationFeatureSeal, 'feature'>,
  profileIdentity: AttestationProfileIdentity,
): {readonly guard: string; readonly detail: string} | undefined {
  const authority = RUN_CHECK_STAGES_AUTHORITIES.get(verdict);
  if (authority === undefined) return {guard: 'run authority', detail: 'this verdict was not sealed by the gate that ran the stages'};
  if (authority.inputSha256 !== inputSha256 || authority.inputSha256 !== verdict.input_sha256) {
    return {guard: 'compiler snapshot', detail: 'the spec compiled to a different snapshot than the one the gate sealed'};
  }
  if (authority.scopeSha256 !== verdict.scope_sha256) return {guard: 'scope', detail: 'the verdict covers a different scope than the gate sealed'};
  if (!authority.featureIds.has(feature)) return {guard: 'scope', detail: `${feature} is outside the scope this run sealed`};
  const expectedSeal = authority.featureSeals.get(feature);
  if (expectedSeal === undefined) return {guard: 'verification seal', detail: `the gate sealed no closure for ${feature}`};
  const sealField = expectedSeal.contractSha256 !== seal.contractSha256 ? 'contract'
    : expectedSeal.subjectSha256 !== seal.subjectSha256 ? 'subject'
      : expectedSeal.verificationSha256 !== seal.verificationSha256 ? 'verification'
        : expectedSeal.runtimeDependencySha256 !== seal.runtimeDependencySha256 ? 'runtime dependency' : undefined;
  if (sealField !== undefined) {
    return {guard: 'verification seal', detail: `the ${sealField} closure being recorded differs from the one the gate sealed`};
  }
  const identityField = authority.profileIdentity.registrySha256 !== profileIdentity.registrySha256 ? 'obligation registry'
    : authority.profileIdentity.detectorCatalogSha256 !== profileIdentity.detectorCatalogSha256 ? 'detector catalog'
      : authority.profileIdentity.toolIdentity !== profileIdentity.toolIdentity ? 'tool version'
        : authority.profileIdentity.environmentClass !== profileIdentity.environmentClass ? 'environment'
          : authority.profileIdentity.trustSnapshotSha256 !== profileIdentity.trustSnapshotSha256 ? 'trust registry' : undefined;
  if (identityField !== undefined) return {guard: 'run identity', detail: `the ${identityField} changed during this run`};
  if (verdict.state !== 'green') return {guard: 'gate result', detail: 'the gate did not finish green'};
  if (!verdict.profile_complete) return {guard: 'gate result', detail: 'the gate could not prove every required check applied'};
  if (authority.observationSeal !== verdictObservationSeal(verdict)) {
    return {guard: 'observations', detail: 'the recorded stage results changed after the gate sealed them'};
  }
  return undefined;
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
