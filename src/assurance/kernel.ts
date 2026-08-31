// Cladding · Spec 0.2 F6 · deterministic obligation reducer.

import {createHash} from 'node:crypto';

import {canonicalClosureJson} from './closures.js';
import {
  compareCodeUnits,
  descriptorsForLevel,
  deriveApplicability,
  levelNumber,
  obligationDescriptor,
  type AssuranceLevel,
  type AssuranceProfileId,
  type ApplicabilityFacts,
  type BlockingPolicy,
  type ObligationApplicability,
  type StandardStrictness,
} from './registry.js';

// Reducer provenance distinguishes an in-process machine projection from a
// copied shape. It is deliberately insufficient for an attestation: D23 also
// requires runCheckStages to seal the compiler snapshot and current adapter
// execution at the writer boundary.
const REDUCER_VERDICTS = new WeakSet<object>();
const REDUCTION_PLANS = new WeakSet<object>();
// The feature set is deliberately not serialized with a verdict. It supports
// projection callers and test fixtures, but cannot bless a v3 writer without
// the additional private coordinator authority.
const VERDICT_PROVENANCE = new WeakMap<object, {
  readonly inputSha256: string;
  readonly featureIds: ReadonlySet<string>;
}>();

/** Exact assurance record shape defined by D21. */
export interface ProofObligation {
  readonly id: string;
  readonly subject: string;
  readonly assurance_level: AssuranceLevel;
  readonly descriptor: string;
  readonly input_addresses: readonly string[];
  readonly input_sha256: string;
  readonly applicability: ObligationApplicability;
  readonly source_strictness?: StandardStrictness;
  readonly blocking: BlockingPolicy;
}

/** Current observation from a registered adapter. */
export interface Observation {
  readonly obligation: string;
  readonly subject: string;
  readonly state: 'pass' | 'fail' | 'unobserved' | 'na';
  readonly input_sha256: string;
  readonly adapter: {readonly id: string; readonly version: string};
  readonly provenance: 'authored' | 'derived' | 'observed';
  readonly assurance: 'asserted' | 'verified';
  readonly reason?: 'skipped' | 'timeout' | 'pending_env' | 'unsupported' | 'stale' | 'cancelled';
  readonly locator?: string;
  readonly observed_at: string;
  readonly environment_class: string;
  /** F9 cache/scheduler work must set this false; it never gains authority. */
  readonly current?: boolean;
}

/** Profile data stays serializable and runner-independent. */
export interface AssuranceProfile {
  readonly id: AssuranceProfileId;
  readonly assurance_level: AssuranceLevel;
  readonly scope: 'changed' | 'feature' | 'integration' | 'repository';
  readonly obligations: readonly string[];
  readonly authoritative: boolean;
}

/**
 * Registry-compiled reducer input.  Its private provenance prevents a caller
 * from transplanting a narrowed profile or caller-authored applicability into
 * an authoritative v3 decision.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export interface AssuranceReductionPlan {
  readonly profile: AssuranceProfile;
  readonly configuredAssuranceLevel: AssuranceLevel;
  readonly scopeSha256: string;
  readonly inputSha256: string;
  /** Compiler-addressed closure that this plan may attest. */
  readonly scopeAddresses: readonly string[];
  readonly obligations: readonly ProofObligation[];
  readonly observations: readonly Observation[];
  readonly independence?: AssuranceVerdict['independence'];
}

/** Raw compiler facts accepted by the authority seam; descriptor metadata is ignored. */
export interface AssuranceReductionPlanInput {
  readonly profile: Pick<AssuranceProfile, 'id' | 'assurance_level'>;
  readonly configuredAssuranceLevel: AssuranceLevel;
  readonly scopeSha256: string;
  readonly inputSha256: string;
  /** Compiler-addressed closure; profile execution never invents a feature. */
  readonly scopeAddresses: readonly string[];
  readonly obligations: readonly ProofObligation[];
  readonly observations: readonly Observation[];
  readonly applicabilityFacts: ApplicabilityFacts;
  readonly independence?: AssuranceVerdict['independence'];
}

/** Per-obligation reduced state used by legacy and new machine projections. */
export interface ObligationResult {
  readonly obligation: string;
  readonly subject: string;
  readonly state: 'pass' | 'fail' | 'unobserved' | 'na';
  readonly source_strictness?: StandardStrictness;
  readonly blocking: BlockingPolicy;
  readonly reason?: Observation['reason'];
  readonly observation_identities: readonly string[];
}

/** Full profile verdict: completeness is intentionally independent from GREEN. */
export interface AssuranceVerdict {
  readonly profile: AssuranceProfileId;
  readonly assurance_level: AssuranceLevel;
  readonly configured_assurance_level: AssuranceLevel;
  readonly achieved_assurance_level: AssuranceLevel | 'none';
  readonly scope_sha256: string;
  readonly input_sha256: string;
  readonly state: 'green' | 'red' | 'unresolved';
  readonly profile_complete: boolean;
  readonly results: readonly ObligationResult[];
  readonly independence: 'independent' | 'self-certified' | 'not-applicable';
  readonly obligation_sha256: string;
}

/** True only for an immutable reducer-owned machine projection, never v3 authority. */
export function isReducerVerdict(value: AssuranceVerdict): boolean {
  return REDUCER_VERDICTS.has(value);
}

/**
 * Returns whether a reducer projection retained a particular feature from its
 * input closure. This is useful to project scope, but it cannot authorize a
 * v3 row; only runCheckStages seals the required execution provenance.
 */
export function verdictAuthorizesFeature(
  verdict: AssuranceVerdict,
  feature: string,
  inputSha256: string,
): boolean {
  const provenance = VERDICT_PROVENANCE.get(verdict);
  return provenance !== undefined
    && provenance.inputSha256 === inputSha256
    && provenance.featureIds.has(feature);
}

/**
 * Carries a post-reduction writer rejection into the same canonical result
 * shape.  The F4 writer is part of an authoritative schema 0.2 decision: a
 * stale preimage may never leave an otherwise GREEN JSON projection behind.
 */
export function invalidateAssuranceVerdict(
  verdict: AssuranceVerdict,
  reason: Observation['reason'] = 'stale',
): AssuranceVerdict {
  if (!isReducerVerdict(verdict)) return verdict;
  const invalidation: ObligationResult = Object.freeze({
    obligation: 'attestation-write', subject: 'scope', state: 'unobserved' as const,
    blocking: 'hard' as const, reason, observation_identities: Object.freeze([]),
  });
  const results: readonly ObligationResult[] = Object.freeze([
    ...verdict.results,
    invalidation,
  ]);
  const invalidated = Object.freeze({
    ...verdict,
    state: 'unresolved' as const,
    profile_complete: false,
    results,
    obligation_sha256: createHash('sha256').update(canonicalClosureJson(results.map((result) => ({
      obligation: result.obligation, subject: result.subject, state: result.state,
      source_strictness: result.source_strictness ?? null, blocking: result.blocking,
    }))), 'utf8').digest('hex'),
  });
  REDUCER_VERDICTS.add(invalidated);
  const provenance = VERDICT_PROVENANCE.get(verdict);
  if (provenance) VERDICT_PROVENANCE.set(invalidated, provenance);
  return invalidated;
}

/** Canonical profiles; the registry supplies their obligation membership. */
export function assuranceProfile(
  id: AssuranceProfileId,
  level: AssuranceLevel,
): AssuranceProfile {
  const scope = id === 'feedback' ? 'changed' : id === 'checkpoint' ? 'changed' : id === 'completion' ? 'feature' : id === 'push' ? 'integration' : 'repository';
  const verdict = Object.freeze({
    id,
    assurance_level: level,
    scope,
    obligations: Object.freeze(descriptorsForLevel(id === 'checkpoint' || id === 'feedback' ? 'L1' : level).map((descriptor) => descriptor.id)),
    authoritative: id === 'completion' || id === 'push' || id === 'release',
  });
  return verdict;
}

/**
 * Compiles one reducer plan from registry-owned identities and compiler facts.
 * A supplied descriptor can name a subject, but it cannot alter membership,
 * level, strictness, blocking, adapter, or applicability.
 */
export function compileAssuranceReductionPlan(input: AssuranceReductionPlanInput): AssuranceReductionPlan {
  const selectedLevel = (input.profile.id === 'completion' || input.profile.id === 'push' || input.profile.id === 'release')
    && levelNumber(input.profile.assurance_level) < levelNumber(input.configuredAssuranceLevel)
    ? input.configuredAssuranceLevel
    : input.profile.assurance_level;
  const profile = assuranceProfile(input.profile.id, selectedLevel);
  const members = new Set(profile.obligations);
  const obligations = input.obligations.flatMap((candidate) => {
    const descriptor = obligationDescriptor(candidate.descriptor);
    if (!descriptor || !members.has(descriptor.id)) return [];
    return [Object.freeze({
      id: candidate.id,
      subject: candidate.subject,
      assurance_level: descriptor.assuranceLevel,
      descriptor: descriptor.id,
      input_addresses: Object.freeze([...candidate.input_addresses].sort(compareCodeUnits)),
      input_sha256: candidate.input_sha256,
      applicability: deriveApplicability(descriptor, input.applicabilityFacts),
      source_strictness: descriptor.sourceStrictness,
      blocking: descriptor.blocking,
    })];
  });
  const present = new Set(obligations.map((obligation) => obligation.descriptor));
  for (const descriptorId of profile.obligations) {
    if (present.has(descriptorId)) continue;
    const descriptor = obligationDescriptor(descriptorId)!;
    if (deriveApplicability(descriptor, input.applicabilityFacts) !== 'na') continue;
    obligations.push(Object.freeze({
      id: `${descriptor.id}:scope:${input.scopeSha256}`,
      subject: `scope:${input.scopeSha256}`,
      assurance_level: descriptor.assuranceLevel,
      descriptor: descriptor.id,
      input_addresses: Object.freeze([]),
      input_sha256: input.inputSha256,
      applicability: 'na' as const,
      source_strictness: descriptor.sourceStrictness,
      blocking: descriptor.blocking,
    }));
  }
  const plan = Object.freeze({
    profile,
    configuredAssuranceLevel: input.configuredAssuranceLevel,
    scopeSha256: input.scopeSha256,
    inputSha256: input.inputSha256,
    scopeAddresses: Object.freeze([...new Set(input.scopeAddresses)].sort(compareCodeUnits)),
    obligations: Object.freeze(obligations),
    observations: Object.freeze([...input.observations]),
    ...(input.independence === undefined ? {} : {independence: input.independence}),
  });
  REDUCTION_PLANS.add(plan);
  return plan;
}

/** Rejects a downgrade and admits a stronger one-run override only on bounded compiler scope. */
export function resolveRequestedAssuranceLevel(input: {
  readonly configured: AssuranceLevel;
  readonly requested?: AssuranceLevel;
  readonly boundedScope: boolean;
}): {readonly ok: true; readonly level: AssuranceLevel} | {readonly ok: false; readonly reason: string} {
  const requested = input.requested ?? input.configured;
  if (levelNumber(requested) < levelNumber(input.configured)) return {ok: false, reason: 'Requested assurance level cannot downgrade the persisted project level.'};
  if (levelNumber(requested) > levelNumber(input.configured) && !input.boundedScope) {
    return {ok: false, reason: 'A stronger one-run assurance level requires a compiler-proven bounded scope.'};
  }
  return {ok: true, level: requested};
}

/** Reduces all channels once; failure dominates before effective blocking is applied. */
export function reduceAssurancePlan(plan: AssuranceReductionPlan): AssuranceVerdict {
  if (!REDUCTION_PLANS.has(plan)) return untrustedVerdict(plan);
  return reduceCanonicalAssuranceProfile(plan);
}

/** The raw reducer is deliberately private; only a registry-compiled plan may mint a verdict. */
function reduceCanonicalAssuranceProfile(input: AssuranceReductionPlan): AssuranceVerdict {
  const wanted = new Set(input.profile.obligations);
  const results = input.obligations
    .filter((obligation) => wanted.has(obligation.descriptor) && levelNumber(obligation.assurance_level) <= levelNumber(input.profile.assurance_level))
    .map((obligation) => reduceObligation(obligation, input.observations))
    .sort((left, right) => compareCodeUnits(`${left.obligation}\u0000${left.subject}`, `${right.obligation}\u0000${right.subject}`));
  const presentDescriptors = new Set(results.map((result) => result.obligation));
  for (const descriptor of input.profile.obligations) {
    if (presentDescriptors.has(descriptor)) continue;
    const registered = obligationDescriptor(descriptor);
    results.push({
      obligation: descriptor,
      subject: 'project',
      state: 'unobserved',
      ...(registered ? {source_strictness: registered.sourceStrictness, blocking: registered.blocking} : {blocking: 'hard' as const}),
      reason: 'stale',
      observation_identities: [],
    });
  }
  results.sort((left, right) => compareCodeUnits(`${left.obligation}\u0000${left.subject}`, `${right.obligation}\u0000${right.subject}`));
  const profileComplete = results.length > 0 && results.every((result) => result.state !== 'unobserved');
  const hardFailure = results.some((result) => result.state === 'fail' && result.blocking === 'hard');
  // A reducer with no current records has observed nothing.  Treat it as
  // unresolved even for a malformed/custom empty profile: an empty ledger is
  // never a GREEN authority result.
  const unresolved = results.length === 0 || results.some((result) => result.state === 'unobserved');
  // A known hard failure is more informative than a concurrent missing
  // observation.  Both block authority, but preserving RED prevents an
  // un-attributable runner skip from laundering a real stage failure into an
  // ambiguous verdict.
  const state: AssuranceVerdict['state'] = hardFailure ? 'red' : unresolved ? 'unresolved' : 'green';
  const standardLevel = achievedLevel(results);
  const obligation_sha256 = createHash('sha256').update(canonicalClosureJson(results.map((result) => ({
    obligation: result.obligation, subject: result.subject, state: result.state,
    source_strictness: result.source_strictness ?? null, blocking: result.blocking,
  }))), 'utf8').digest('hex');
  const verdict = Object.freeze({
    profile: input.profile.id,
    assurance_level: input.profile.assurance_level,
    configured_assurance_level: input.configuredAssuranceLevel,
    achieved_assurance_level: standardLevel,
    scope_sha256: input.scopeSha256,
    input_sha256: input.inputSha256,
    state,
    profile_complete: profileComplete,
    results: Object.freeze(results),
    independence: input.independence ?? 'not-applicable',
    obligation_sha256,
  });
  REDUCER_VERDICTS.add(verdict);
  VERDICT_PROVENANCE.set(verdict, Object.freeze({
    inputSha256: input.inputSha256,
    featureIds: new Set(input.scopeAddresses.flatMap((address) => {
      if (address.startsWith('feature:')) return [address.slice('feature:'.length)];
      const criterion = /^criterion:(F-[^/]+)\//.exec(address);
      return criterion ? [criterion[1]!] : [];
    })),
  }));
  return verdict;
}

/** A forged plan remains machine-readable but can never carry reducer provenance. */
function untrustedVerdict(plan: AssuranceReductionPlan): AssuranceVerdict {
  return Object.freeze({
    profile: plan.profile.id,
    assurance_level: plan.profile.assurance_level,
    configured_assurance_level: plan.configuredAssuranceLevel,
    achieved_assurance_level: 'none' as const,
    scope_sha256: plan.scopeSha256,
    input_sha256: plan.inputSha256,
    state: 'unresolved' as const,
    profile_complete: false,
    results: Object.freeze([]),
    independence: plan.independence ?? 'not-applicable',
    obligation_sha256: createHash('sha256').update(canonicalClosureJson([]), 'utf8').digest('hex'),
  });
}

/** Project legacy stage rows from already-reduced obligations; no runner is invoked. */
export function legacyStageProjection(verdict: AssuranceVerdict): readonly {readonly stage: string; readonly status: ObligationResult['state']}[] {
  const byStage = new Map<string, ObligationResult['state']>();
  for (const result of verdict.results) {
    const prior = byStage.get(result.obligation);
    byStage.set(result.obligation, dominate(prior, result.state));
  }
  return [...byStage.entries()].sort(([left], [right]) => compareCodeUnits(left, right)).map(([stage, status]) => ({stage, status}));
}

function reduceObligation(obligation: ProofObligation, observations: readonly Observation[]): ObligationResult {
  if (obligation.applicability === 'na') {
    return {obligation: obligation.descriptor, subject: obligation.subject, state: 'na', source_strictness: obligation.source_strictness, blocking: obligation.blocking, observation_identities: []};
  }
  if (obligation.applicability === 'unresolved') {
    return {obligation: obligation.descriptor, subject: obligation.subject, state: 'unobserved', source_strictness: obligation.source_strictness, blocking: obligation.blocking, reason: 'stale', observation_identities: []};
  }
  const descriptor = obligationDescriptor(obligation.descriptor);
  const matches = observations.filter((entry) => entry.obligation === obligation.descriptor
    && entry.subject === obligation.subject
    && entry.input_sha256 === obligation.input_sha256
    && entry.current !== false
    && entry.provenance === 'observed'
    && (entry.state === 'unobserved' || entry.assurance === 'verified')
    && entry.adapter.id === descriptor?.adapter.id
    && entry.adapter.version === descriptor?.adapter.version);
  const identities = matches.map(observationIdentity).sort(compareCodeUnits);
  const failed = matches.find((entry) => entry.state === 'fail');
  if (failed) return result('fail', failed.reason, identities);
  const passed = matches.some((entry) => entry.state === 'pass');
  if (passed) return result('pass', undefined, identities);
  const explicit = matches.find((entry) => entry.state === 'unobserved');
  return result('unobserved', explicit?.reason ?? (matches.length === 0 ? 'stale' : 'unsupported'), identities);

  function result(state: ObligationResult['state'], reason: Observation['reason'] | undefined, observation_identities: readonly string[]): ObligationResult {
    return {obligation: obligation.descriptor, subject: obligation.subject, state, source_strictness: obligation.source_strictness, blocking: obligation.blocking, ...(reason ? {reason} : {}), observation_identities};
  }
}

function observationIdentity(observation: Observation): string {
  return createHash('sha256').update(canonicalClosureJson({
    obligation: observation.obligation, subject: observation.subject, state: observation.state,
    input_sha256: observation.input_sha256, adapter: observation.adapter, locator: observation.locator ?? null,
    observed_at: observation.observed_at, environment_class: observation.environment_class,
  }), 'utf8').digest('hex');
}

function dominate(left: ObligationResult['state'] | undefined, right: ObligationResult['state']): ObligationResult['state'] {
  const rank: Readonly<Record<ObligationResult['state'], number>> = {fail: 4, unobserved: 3, pass: 2, na: 1};
  return left === undefined || rank[right] > rank[left] ? right : left;
}

function achievedLevel(results: readonly ObligationResult[]): AssuranceLevel | 'none' {
  let achieved: AssuranceLevel | 'none' = 'none';
  for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
    const levelResults = results.filter((result) => descriptorsForLevel(level).some((descriptor) => descriptor.id === result.obligation && descriptor.assuranceLevel === level));
    if (levelResults.length === 0 || levelResults.some((result) => result.state === 'unobserved' || (result.state === 'fail' && result.source_strictness !== 'report'))) break;
    achieved = level;
  }
  return achieved;
}
