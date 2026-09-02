// Cladding · Spec 0.2 F6 · adapters from the legacy stage pipeline to one kernel.

import {createHash} from 'node:crypto';

import {canonicalClosureJson} from './closures.js';
import {criterionObservationRule, isStaticCriterionScope, type CriterionObservationReport, type StaticCriterionScope} from './criterion-observations.js';
import {assuranceProfile, compileAssuranceReductionPlan, reduceAssurancePlan, type AssuranceProfile, type AssuranceVerdict, type MigrationBaselineCandidate, type Observation, type ProofObligation} from './kernel.js';
import {deriveApplicability, levelNumber, obligationDescriptor, type AssuranceLevel} from './registry.js';
import type {CriterionProofView} from '../proof/view.js';

/** Stage data deliberately mirrors the pre-F6 pipeline without importing the CLI. */
export interface LegacyStageObservation {
  readonly stage: string;
  readonly status: 'pass' | 'skip' | 'fail' | 'pending_env' | 'advisory' | 'na' | 'liveness';
  readonly adapterVersion?: string;
}

/** Compiler-owned facts needed to create a sealed, deterministic profile adapter. */
export interface AssuranceAdapterInput {
  readonly profile: AssuranceProfile;
  readonly configuredAssuranceLevel: AssuranceLevel;
  readonly completeScope: boolean;
  readonly scopeAddresses: readonly string[];
  readonly inputAddresses: readonly string[];
  /** Complete byte/policy closure seal supplied by compiler/F5, never node names alone. */
  readonly inputSha256: string;
  readonly hasExecutableTests: boolean;
  /** Compiler/policy-proven current composite subjects that require an oracle. */
  readonly oracleRequiredSubjects?: ReadonlySet<string>;
  readonly hasOracleProof: boolean;
  readonly hasDeliverable: boolean;
  readonly requiresQuality: boolean;
  readonly requiresHuman: boolean;
  /**
   * F5-owned current proof reduction.  Human obligations enumerate these
   * composite criterion addresses, never event or ledger identifiers.
   */
  readonly proofViews?: readonly CriterionProofView[];
  /** Registry-emitted static/behavior reports; caller applicability is ignored. */
  readonly criterionObservations?: readonly CriterionObservationReport[];
  /** Compiler-minted exact static subjects; no stage may infer these from labels. */
  readonly staticCriterionScope?: StaticCriterionScope;
  /** Schema 0.2 may never fan a repository stage outcome into sibling proof subjects. */
  readonly exactProofRequired?: boolean;
  /** Opaque current Unit invocation identity, retained only as a compact observation locator. */
  readonly currentProofObservationIdentity?: string;
  /**
   * Criteria whose F5 selection named a binding source at all.  Absent means
   * the caller could not decide, and every unobserved row keeps `stale`; it
   * is never read as proof that nothing is bound.
   */
  readonly boundProofCriteria?: ReadonlySet<string>;
  /** Compiler-classified accepted migration receipt candidates, never stage input. */
  readonly migrationBaselineCandidates?: readonly MigrationBaselineCandidate[];
  readonly stages: readonly LegacyStageObservation[];
  readonly environmentClass: string;
}

/** Compiles legacy stage results into one machine reducer invocation without executing anything. */
export function reduceLegacyStageAdapter(input: AssuranceAdapterInput): AssuranceVerdict {
  // A transport caller may name a profile but never narrows its membership:
  // the registry recreates the complete cumulative profile before any stage
  // observation is joined.
  const selectedLevel = (input.profile.id === 'completion' || input.profile.id === 'push' || input.profile.id === 'release')
    && levelNumber(input.profile.assurance_level) < levelNumber(input.configuredAssuranceLevel)
    ? input.configuredAssuranceLevel
    : input.profile.assurance_level;
  const profile = assuranceProfile(input.profile.id, selectedLevel);
  const scopeSha256 = digest(input.scopeAddresses);
  const inputSha256 = input.inputSha256;
  const stageById = new Map(input.stages.map((stage) => [stage.stage, stage]));
  const obligations: ProofObligation[] = [];
  const observations: Observation[] = [];
  for (const descriptorId of profile.obligations) {
    const descriptor = obligationDescriptor(descriptorId);
    if (!descriptor) continue;
    const applicability = deriveApplicability(descriptor, {
      complete: input.completeScope,
      hasExecutableTests: input.hasExecutableTests,
      hasOracleProof: input.hasOracleProof,
      hasDeliverable: input.hasDeliverable,
      requiresQuality: input.requiresQuality,
      requiresHuman: input.requiresHuman,
    });
    const proofViews = (descriptor.id === 'stage_2.1' || descriptor.id === 'stage_2.2'
      || descriptor.id === 'stage_2.3' || descriptor.id === 'stage_4.1' || descriptor.id === 'stage_4.2')
      ? input.proofViews
      : undefined;
    const stage = stageById.get(descriptor.id);
    // A current F5 view is the sole address source for Audit/UAT.  Falling back
    // to a feature scope is retained only for schema 0.1's legacy stage path.
    const proofSubjects = proofViews
      ? proofViews
        .filter((view) => descriptor.id !== 'stage_2.3' || input.oracleRequiredSubjects === undefined || input.oracleRequiredSubjects.has(`criterion:${view.criterion}`))
        .map((view) => `criterion:${view.criterion}`)
      : input.exactProofRequired && isExactProofDescriptor(descriptor.id)
        ? []
        : input.scopeAddresses;
    // Static rules name their exact criterion subject themselves. This creates
    // a reducer-visible failure/NA row without treating artifact ownership or
    // a missing test binding as an applicability fact.
    const staticSubjects = (descriptor.id === 'stage_2.1' || descriptor.id === 'stage_2.2')
      && isStaticCriterionScope(input.staticCriterionScope)
      ? input.staticCriterionScope.subjects
      : [];
    const subjects = [...new Set([...proofSubjects, ...staticSubjects])];
    // A compiler-proven NA still needs one reducer-visible record.  Omitting
    // it would look identical to a missing descriptor and manufacture an
    // unresolved synthetic result.
    if (subjects.length === 0 && applicability !== 'required') {
      obligations.push({
        id: `${descriptor.id}:scope:${scopeSha256}`,
        subject: `scope:${scopeSha256}`,
        assurance_level: descriptor.assuranceLevel,
        descriptor: descriptor.id,
        input_addresses: [...input.inputAddresses].sort(),
        input_sha256: inputSha256,
        applicability,
        source_strictness: descriptor.sourceStrictness,
        blocking: descriptor.blocking,
      });
    }
    for (const subject of subjects) {
      const obligation: ProofObligation = {
        id: `${descriptor.id}:${subject}`,
        subject,
        assurance_level: descriptor.assuranceLevel,
        descriptor: descriptor.id,
        input_addresses: [...input.inputAddresses].sort(),
        input_sha256: inputSha256,
        applicability,
        source_strictness: descriptor.sourceStrictness,
        blocking: descriptor.blocking,
      };
      obligations.push(obligation);
      if (applicability !== 'required') continue;
      const proofView = proofViews?.find((view) => `criterion:${view.criterion}` === subject);
      const rule = proofView === undefined ? undefined : criterionObservationRule(proofView.criterion);
      // B4 behavior rules own their carrier and sealed inputs. A generic F5
      // proof-view projection cannot stand in for either the parser adapter or
      // the 13-suite current-run closure; the kernel joins only their trusted
      // criterion report below. Unregistered criteria retain legacy F5 flow.
      if (proofView && rule === undefined) {
        observations.push(proofViewObservation(obligation, descriptor.id, proofView, stage,
          descriptor.adapter, input.environmentClass, input.currentProofObservationIdentity,
          input.boundProofCriteria));
      } else if (!proofView) {
        observations.push(stageObservation(obligation, stage, descriptor.adapter, input.environmentClass));
      }
    }
    // A runner-wide failure has no safe criterion attribution.  Preserve it as
    // one scope summary instead of copying a global result into every sibling;
    // a failure still dominates the profile, while skip/pending stays honestly
    // unobserved.
    const requiresCurrentL2Scope = input.exactProofRequired
      && (descriptor.id === 'stage_2.1' || descriptor.id === 'stage_2.2');
    const requiresLegacyScope = applicability === 'required'
      && requiresLegacyStageOutcome(descriptor.id) && stage !== undefined && stage.status !== 'pass';
    const requiresScopeRow = requiresCurrentL2Scope || requiresLegacyScope;
    if (requiresScopeRow) {
      const summary: ProofObligation = {
        id: `${descriptor.id}:scope:${scopeSha256}`,
        subject: `scope:${scopeSha256}`,
        assurance_level: descriptor.assuranceLevel,
        descriptor: descriptor.id,
        input_addresses: [...input.inputAddresses].sort(),
        input_sha256: inputSha256,
        applicability,
        source_strictness: descriptor.sourceStrictness,
        blocking: descriptor.blocking,
      };
      obligations.push(summary);
      observations.push(stageObservation(summary, stage, descriptor.adapter, input.environmentClass));
    }
  }
  return reduceAssurancePlan(compileAssuranceReductionPlan({
    profile,
    configuredAssuranceLevel: input.configuredAssuranceLevel,
    scopeSha256,
    inputSha256,
    scopeAddresses: input.scopeAddresses,
    obligations,
    observations,
    ...(input.migrationBaselineCandidates === undefined ? {} : {migrationBaselineCandidates: input.migrationBaselineCandidates}),
    ...(input.criterionObservations === undefined ? {} : {criterionObservations: input.criterionObservations}),
    environmentClass: input.environmentClass,
    applicabilityFacts: {
      complete: input.completeScope,
      hasExecutableTests: input.hasExecutableTests,
      hasOracleProof: input.hasOracleProof,
      hasDeliverable: input.hasDeliverable,
      requiresQuality: input.requiresQuality,
      requiresHuman: input.requiresHuman,
    },
    independence: input.requiresHuman
      ? (input.proofViews?.length && input.proofViews.every((view) => view.blind === 'verified')
        ? 'independent'
        : 'self-certified')
      : 'not-applicable',
  }));
}

/**
 * Converts F5's already-verified composite-criterion proof state into an F6
 * observation.  UAT intentionally reads only `view.uat`: a blind receipt can
 * label independence but can never satisfy a UAT obligation.
 */
function proofViewObservation(
  obligation: ProofObligation,
  descriptor: string,
  view: CriterionProofView,
  stage: LegacyStageObservation | undefined,
  adapter: {readonly id: string; readonly version: string},
  environmentClass: string,
  currentProofObservationIdentity?: string,
  boundProofCriteria?: ReadonlySet<string>,
): Observation {
  if (requiresLegacyStageOutcome(descriptor) && stage?.status !== 'pass') {
    const reason = stage === undefined ? 'stale' : stage.status === 'pending_env' ? 'pending_env'
      : stage.status === 'skip' || stage.status === 'na' || stage.status === 'liveness' ? 'skipped'
        : 'unsupported';
    return {
      obligation: obligation.descriptor, subject: obligation.subject, state: 'unobserved',
      input_sha256: obligation.input_sha256, adapter, provenance: 'observed', assurance: 'asserted', reason,
      observed_at: '1970-01-01T00:00:00.000Z', environment_class: environmentClass,
    };
  }
  const proof = descriptor === 'stage_2.1' || descriptor === 'stage_2.2'
    ? view.test.state === 'verified' ? 'verified' : view.test.state === 'failed' ? 'failed' : 'unverified'
    : descriptor === 'stage_4.1' ? view.audit
      : descriptor === 'stage_4.2' ? view.uat
        // F5's blind reduction is the only oracle path: it proves both the
        // current bound testcase and the receipt capability digest.
        : view.blind;
  const state = proof === 'verified' ? 'pass' : proof === 'failed' ? 'fail' : 'unobserved';
  return {
    obligation: obligation.descriptor,
    subject: obligation.subject,
    state,
    input_sha256: obligation.input_sha256,
    adapter,
    provenance: 'observed',
    assurance: state === 'unobserved' ? 'asserted' : 'verified',
    ...(state === 'unobserved' ? {reason: unobservedProofReason(descriptor, view.criterion, boundProofCriteria)} : {}),
    ...(currentProofObservationIdentity === undefined ? {} : {locator: currentProofObservationIdentity}),
    observed_at: '1970-01-01T00:00:00.000Z',
    environment_class: environmentClass,
  };
}

/**
 * Names why a criterion's proof row is not current.  Only the two test-driven
 * obligations can be `unbound`: their proof comes from the criterion's own
 * testcase binding, so an absent binding is the whole reason and a re-run
 * would change nothing.  Blind, Audit, and UAT are unobserved for receipt
 * reasons instead, and keep `stale`.
 */
function unobservedProofReason(
  descriptor: string,
  criterion: string,
  boundProofCriteria: ReadonlySet<string> | undefined,
): 'stale' | 'unbound' {
  return (descriptor === 'stage_2.1' || descriptor === 'stage_2.2')
    && boundProofCriteria !== undefined && !boundProofCriteria.has(criterion)
    ? 'unbound'
    : 'stale';
}

function isExactProofDescriptor(descriptor: string): boolean {
  return descriptor === 'stage_2.1' || descriptor === 'stage_2.2' || descriptor === 'stage_2.3'
    || descriptor === 'stage_4.1' || descriptor === 'stage_4.2';
}

/** Unit/Coverage/Spec Conformance are runner observations; Audit/UAT are F5 receipt observations. */
function requiresLegacyStageOutcome(descriptor: string): boolean {
  return descriptor === 'stage_2.1' || descriptor === 'stage_2.2' || descriptor === 'stage_2.3';
}

function stageObservation(
  obligation: ProofObligation,
  stage: LegacyStageObservation | undefined,
  adapter: {readonly id: string; readonly version: string},
  environmentClass: string,
): Observation {
  const state = stage?.status === 'pass' ? 'pass' : stage?.status === 'fail' || stage?.status === 'advisory' ? 'fail' : 'unobserved';
  const reason = stage === undefined ? 'stale'
    : stage.status === 'pending_env' ? 'pending_env'
      : stage.status === 'skip' || stage.status === 'na' || stage.status === 'liveness' ? 'skipped'
        : 'unsupported';
  return {
    obligation: obligation.descriptor,
    subject: obligation.subject,
    state,
    input_sha256: obligation.input_sha256,
    adapter: {id: adapter.id, version: stage?.adapterVersion ?? adapter.version},
    provenance: 'observed',
    assurance: state === 'pass' || state === 'fail' ? 'verified' : 'asserted',
    ...(state === 'unobserved' ? {reason} : {}),
    observed_at: '1970-01-01T00:00:00.000Z',
    environment_class: environmentClass,
  };
}

function digest(addresses: readonly string[]): string {
  return createHash('sha256').update(canonicalClosureJson([...addresses].sort()), 'utf8').digest('hex');
}
