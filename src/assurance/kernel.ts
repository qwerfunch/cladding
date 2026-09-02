// Cladding · Spec 0.2 F6 · deterministic obligation reducer.

import {createHash} from 'node:crypto';

import {canonicalClosureJson} from './closures.js';
import {criterionObservationRule, isTrustedCriterionObservationReport, type CriterionAdapterIdentity, type CriterionObservationReport, type CriterionObservationRule} from './criterion-observations.js';
import {
  compareCodeUnits,
  descriptorsForLevel,
  descriptorsForProfile,
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
  /** Criterion rules own a distinct adapter identity from legacy stage rows. */
  readonly adapter?: CriterionAdapterIdentity;
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
  /** Exact sealed input addresses; required for a static criterion match. */
  readonly input_addresses?: readonly string[];
  /** Static adapter manifest identity, never inferred from an artifact owner. */
  readonly manifest_sha256?: string;
  readonly adapter: {readonly id: string; readonly version: string};
  readonly provenance: 'authored' | 'derived' | 'observed';
  readonly assurance: 'asserted' | 'verified';
  /**
   * Why a row is not a current observation.  `stale` means the proof existed
   * but this run did not renew it; `unresolved` means the compiler could not
   * decide applicability at all; `unbound` means the criterion never named a
   * testcase, so there is nothing for a runner to renew.  Collapsing the last
   * two into `stale` would tell a reader to re-run when the real remedy is to
   * complete the closure or write the binding.
   */
  readonly reason?: 'skipped' | 'timeout' | 'pending_env' | 'unsupported' | 'stale' | 'cancelled'
  | 'unresolved' | 'unbound';
  readonly locator?: string;
  readonly observed_at: string;
  readonly environment_class: string;
  /** F9 cache/scheduler work must set this false; it never gains authority. */
  readonly current?: boolean;
}

/** Immutable migration receipt basis carried by a non-observation L2 result. */
export interface MigrationBaselineBasis {
  /** Content address of the validated immutable migration receipt. */
  readonly baseline_receipt_sha256: string;
  /** Shared accepted project decision identity. */
  readonly resolution_sha256: string;
  /** Content address of the exact criterion-local authorization. */
  readonly criterion_authorization_sha256: string;
}

/** Compiler-resolved candidate eligible only for the two legacy L2 rows. */
export interface MigrationBaselineCandidate {
  /** Exact reducer subject, always a composite `criterion:` address. */
  readonly subject: string;
  /** Exact descriptor rows authorized by the migration receipt. */
  readonly obligations: readonly string[];
  /** Receipt identities that must travel with every resolved baseline row. */
  readonly basis: MigrationBaselineBasis;
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
  /** Compiler-classified migration rows; never observations or caller stage facts. */
  readonly migrationBaselineCandidates: readonly MigrationBaselineCandidate[];
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
  /** Compiler-classified receipt candidates for unchanged L2 criterion rows. */
  readonly migrationBaselineCandidates?: readonly MigrationBaselineCandidate[];
  /** Current reports from the code-owned criterion adapter registry. */
  readonly criterionObservations?: readonly CriterionObservationReport[];
  /** Runtime class carried into registry-owned observations; direct callers use `neutral`. */
  readonly environmentClass?: string;
  readonly applicabilityFacts: ApplicabilityFacts;
  readonly independence?: AssuranceVerdict['independence'];
}

/** Per-obligation reduced state used by legacy and new machine projections. */
export interface ObligationResult {
  readonly obligation: string;
  readonly subject: string;
  readonly state: 'pass' | 'fail' | 'unobserved' | 'na' | 'migration_baseline';
  /** Present only for an exact migration-baseline reduction. */
  readonly migration_baseline?: MigrationBaselineBasis;
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
      migration_baseline: result.migration_baseline ?? null,
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
    obligations: Object.freeze(descriptorsForProfile(id, level).map((descriptor) => descriptor.id)),
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
    const criterion = criterionAddress(candidate.subject);
    const rule = criterion === undefined ? undefined : criterionObservationRule(criterion);
    const ruleReport = rule !== undefined && executableDescriptor(descriptor.id)
      ? currentCriterionReport(rule, input.criterionObservations ?? [])
      : undefined;
    // Static proof inputs are their own complete artifact closure. A missing,
    // stale, malformed, or false-condition report deliberately falls back to
    // required/unobserved rather than using the caller's applicability field.
    const candidateDeclaresRuleInputs = rule !== undefined && sameAddresses(candidate.input_addresses, rule.inputAddresses);
    const reportSuppliesInputs = ruleReport !== undefined && !candidateDeclaresRuleInputs;
    const resolvedAddresses = reportSuppliesInputs && ruleReport !== undefined
      ? ruleReport.input_addresses
      : candidate.input_addresses;
    const resolvedDigest = reportSuppliesInputs && ruleReport !== undefined
      ? ruleReport.input_sha256
      : candidate.input_sha256;
    const staticEligible = rule?.mode === 'static' && ruleReport !== undefined
      && ruleReport.input_sha256 === resolvedDigest
      && ruleReport.state === 'pass' && rule.applicability(ruleReport);
    return [Object.freeze({
      id: candidate.id,
      subject: candidate.subject,
      assurance_level: descriptor.assuranceLevel,
      descriptor: descriptor.id,
      input_addresses: Object.freeze([...resolvedAddresses].sort(compareCodeUnits)),
      input_sha256: resolvedDigest,
      ...(rule !== undefined && executableDescriptor(descriptor.id) ? {adapter: rule.adapter} : {}),
      // A criterion subject is decided here, before the legacy project-wide
      // stage fact. Only this exact static rule can produce NA; an unknown or
      // unresolved rule is required so missing proof cannot disappear when a
      // caller says there are no executable tests.
      applicability: staticEligible ? 'na' as const
        : criterion !== undefined && executableDescriptor(descriptor.id) ? 'required' as const
          : deriveApplicability(descriptor, input.applicabilityFacts),
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
  const criterionObservations = obligations.flatMap((obligation) => {
    const criterion = criterionAddress(obligation.subject);
    const rule = criterion === undefined ? undefined : criterionObservationRule(criterion);
    if (!rule || !executableDescriptor(obligation.descriptor)) return [];
    const report = (input.criterionObservations ?? []).find((entry) => entry.criterion === criterion
      && isTrustedCriterionObservationReport(entry)
      && entry.carrier === rule.carrier
      && entry.adapter.id === rule.adapter.id && entry.adapter.version === rule.adapter.version);
    if (!report || !sameAddresses(report.input_addresses, obligation.input_addresses)
      || report.input_sha256 !== obligation.input_sha256 || report.manifest_sha256 !== manifestSha256(rule)) return [];
    // A qualifying static pass has already become NA. A false static predicate
    // remains required and unobserved; accepting its pass here would launder
    // an inapplicable report into behavior preservation.
    if (rule.mode === 'static' && report.state === 'pass' && !rule.applicability(report)) return [];
    return [criterionReportObservation(obligation, report, input.environmentClass ?? 'neutral')];
  });
  const plan = Object.freeze({
    profile,
    configuredAssuranceLevel: input.configuredAssuranceLevel,
    scopeSha256: input.scopeSha256,
    inputSha256: input.inputSha256,
    scopeAddresses: Object.freeze([...new Set(input.scopeAddresses)].sort(compareCodeUnits)),
    obligations: Object.freeze(obligations),
    observations: Object.freeze([...input.observations, ...criterionObservations]),
    migrationBaselineCandidates: Object.freeze((input.migrationBaselineCandidates ?? [])
      .filter(isMigrationBaselineCandidate)
      .sort((left, right) => compareCodeUnits(left.subject, right.subject))),
    ...(input.independence === undefined ? {} : {independence: input.independence}),
  });
  REDUCTION_PLANS.add(plan);
  return plan;
}

/** Criterion rules alter only executable Unit/Coverage rows. */
function executableDescriptor(descriptor: string): boolean {
  return descriptor === 'stage_2.1' || descriptor === 'stage_2.2';
}

/** Converts a reducer subject to the registry's composite criterion address. */
function criterionAddress(subject: string): string | undefined {
  return subject.startsWith('criterion:') ? subject.slice('criterion:'.length) : undefined;
}

function criterionManifestFor(subject: string): string | undefined {
  const criterion = criterionAddress(subject);
  const rule = criterion === undefined ? undefined : criterionObservationRule(criterion);
  return rule === undefined ? undefined : manifestSha256(rule);
}

/** Avoid locale-sensitive ordering and path-only matching for signed inputs. */
function sameAddresses(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(compareCodeUnits);
  const b = [...right].sort(compareCodeUnits);
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/** Admits only the generic shape the reducer can safely consider after normal reduction. */
function isMigrationBaselineCandidate(value: MigrationBaselineCandidate): boolean {
  return /^criterion:F-[^/]+\/AC-[^/]+$/.test(value.subject)
    && value.obligations.length === 2
    && value.obligations[0] === 'stage_2.1'
    && value.obligations[1] === 'stage_2.2'
    && isSha256(value.basis.baseline_receipt_sha256)
    && isSha256(value.basis.resolution_sha256)
    && isSha256(value.basis.criterion_authorization_sha256);
}

/** The receipt protocol uses lower-case full SHA-256 content identities. */
function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function manifestSha256(rule: CriterionObservationRule): string {
  return createHash('sha256').update(canonicalClosureJson(rule.manifest), 'utf8').digest('hex');
}

/**
 * Accepts only a report with the rule's exact adapter, manifest, sorted input
 * addresses, current bit, and complete byte closure. Missing or stale reports
 * are intentionally not reinterpreted as NA by a coarse project stage.
 */
function currentCriterionReport(
  rule: CriterionObservationRule,
  reports: readonly CriterionObservationReport[],
): CriterionObservationReport | undefined {
  return reports.find((report) => report.criterion === rule.criterion
    && isTrustedCriterionObservationReport(report)
    && report.carrier === rule.carrier
    && report.adapter.id === rule.adapter.id
    && report.adapter.version === rule.adapter.version
    && report.manifest_sha256 === manifestSha256(rule)
    && sameAddresses(report.input_addresses, rule.inputAddresses)
    && report.current === true && report.complete === true);
}

/** Projects one sealed criterion adapter report into the existing reducer wire. */
function criterionReportObservation(
  obligation: ProofObligation,
  report: CriterionObservationReport,
  environmentClass: string,
): Observation {
  return Object.freeze({
    obligation: obligation.descriptor,
    subject: obligation.subject,
    state: report.state,
    input_sha256: report.input_sha256,
    input_addresses: Object.freeze([...report.input_addresses].sort(compareCodeUnits)),
    manifest_sha256: report.manifest_sha256,
    adapter: report.adapter,
    provenance: 'observed' as const,
    assurance: report.state === 'unobserved' ? 'asserted' as const : 'verified' as const,
    ...(report.reason === undefined ? {} : {reason: report.reason === 'missing' || report.reason === 'invalid' ? 'stale' as const : report.reason}),
    ...(report.locator === undefined ? {} : {locator: report.locator}),
    observed_at: '1970-01-01T00:00:00.000Z',
    environment_class: environmentClass,
    current: report.current,
  });
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
  const reduced = input.obligations
    .filter((obligation) => wanted.has(obligation.descriptor) && levelNumber(obligation.assurance_level) <= levelNumber(input.profile.assurance_level))
    .map((obligation) => ({obligation, result: reduceObligation(obligation, input.observations)}));
  const scopePasses = new Set(reduced
    .filter(({result}) => result.subject === `scope:${input.scopeSha256}`
      && result.state === 'pass' && result.observation_identities.length > 0)
    .map(({result}) => result.obligation));
  const candidates = new Map(input.migrationBaselineCandidates.map((candidate) => [candidate.subject, candidate]));
  const results = reduced
    .map(({obligation, result}) => migrationBaselineResult(obligation, result, candidates.get(result.subject), scopePasses))
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
    migration_baseline: result.migration_baseline ?? null,
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

/** Replaces only an otherwise-required unresolved L2 criterion with its sealed receipt basis. */
function migrationBaselineResult(
  obligation: ProofObligation,
  result: ObligationResult,
  candidate: MigrationBaselineCandidate | undefined,
  scopePasses: ReadonlySet<string>,
): ObligationResult {
  if (result.state !== 'unobserved'
    || obligation.applicability !== 'required'
    || (obligation.descriptor !== 'stage_2.1' && obligation.descriptor !== 'stage_2.2')
    || obligation.assurance_level !== 'L2'
    || candidate === undefined
    || !candidate.obligations.includes(obligation.descriptor)
    || !scopePasses.has(obligation.descriptor)) return result;
  return Object.freeze({
    obligation: result.obligation,
    subject: result.subject,
    state: 'migration_baseline' as const,
    source_strictness: result.source_strictness,
    blocking: result.blocking,
    migration_baseline: Object.freeze({...candidate.basis}),
    observation_identities: Object.freeze([]),
  });
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
export function legacyStageProjection(verdict: AssuranceVerdict): readonly {readonly stage: string; readonly status: Observation['state']}[] {
  const byStage = new Map<string, Observation['state']>();
  for (const result of verdict.results) {
    // F7b scope passes anchor a receipt-backed criterion but are not a legacy
    // proof claim. Retain fail/unobserved summaries while preventing this
    // synthetic anchor from projecting migration_baseline as a stage pass.
    if (result.subject.startsWith('scope:') && result.state === 'pass') continue;
    const prior = byStage.get(result.obligation);
    // Migration baseline is resolved only in the canonical profile. The legacy
    // fifteen-stage projection must never present it as current proof or NA.
    byStage.set(result.obligation, dominate(prior, result.state === 'migration_baseline' ? 'unobserved' : result.state));
  }
  return [...byStage.entries()].sort(([left], [right]) => compareCodeUnits(left, right)).map(([stage, status]) => ({stage, status}));
}

function reduceObligation(obligation: ProofObligation, observations: readonly Observation[]): ObligationResult {
  if (obligation.applicability === 'na') {
    return {obligation: obligation.descriptor, subject: obligation.subject, state: 'na', source_strictness: obligation.source_strictness, blocking: obligation.blocking, observation_identities: []};
  }
  // An unresolved applicability is not a stale observation: no runner can
  // clear it, because the compiler never decided whether the obligation
  // applies. Labeling it `stale` sent readers to re-run the gate instead of
  // completing the closure inputs the verdict names.
  if (obligation.applicability === 'unresolved') {
    return {obligation: obligation.descriptor, subject: obligation.subject, state: 'unobserved', source_strictness: obligation.source_strictness, blocking: obligation.blocking, reason: 'unresolved', observation_identities: []};
  }
  const descriptor = obligationDescriptor(obligation.descriptor);
  const expectedAdapter = obligation.adapter ?? descriptor?.adapter;
  const matches = observations.filter((entry) => entry.obligation === obligation.descriptor
    && entry.subject === obligation.subject
    && entry.input_sha256 === obligation.input_sha256
    && entry.current !== false
    && entry.provenance === 'observed'
    && (entry.state === 'unobserved' || entry.assurance === 'verified')
    && entry.adapter.id === expectedAdapter?.id
    && entry.adapter.version === expectedAdapter?.version
    && (obligation.adapter === undefined || (entry.input_addresses !== undefined
      && sameAddresses(entry.input_addresses, obligation.input_addresses)
      && entry.manifest_sha256 === criterionManifestFor(obligation.subject))));
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

function dominate(left: Observation['state'] | undefined, right: Observation['state']): Observation['state'] {
  const rank: Readonly<Record<Observation['state'], number>> = {fail: 4, unobserved: 3, pass: 2, na: 1};
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
