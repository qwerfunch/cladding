// Cladding · Spec 0.2 F6 · compiler/F5 inputs assembled for closure consumers.

import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync, type Dirent} from 'node:fs';
import {dirname, extname, isAbsolute, join, relative, resolve} from 'node:path';

import {parse} from '@babel/parser';
import {parse as parseYaml} from 'yaml';

import {mintWorkspaceAttestationV3, type AttestationReceiptContext, type AuthoritativeAttestationV3} from './attestation.js';
import {currentReceiptIdentities} from './receipt-adapter.js';
import {
  contractClosure,
  readSafeProofClosureBytes,
  readSafeRuntimeModuleClosureBytes,
  runtimeDependencyClosure,
  subjectClosure,
  verificationClosure,
  type AssuranceClosureInput,
  type AssuranceFeatureInput,
  type ClosureProofInput,
} from './closures.js';
import type {AssuranceProfile, AssuranceVerdict, MigrationBaselineCandidate} from './kernel.js';
import {canonicalClosureJson} from './closures.js';
import {criterionObservationRule, staticCriterionReportsFromWorkspace, staticCriterionScopeFromWorkspace, type CriterionObservationReport, type StaticCriterionScope} from './criterion-observations.js';
import {OBLIGATION_DESCRIPTORS, type AssuranceControl} from './registry.js';
import {artifactAddress, compilerCorpusView} from '../spec/compiler/compile.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import {
  LEGACY_L2_OBLIGATIONS,
  LEGACY_UNCLASSIFIED,
  criterionAuthorizationSha256,
  criterionFinalIntentFromRecord,
  criterionFinalIntentSha256,
  migrationBaselineReceiptSha256,
  validateMigrationBaseline,
  type CriterionIntentBaseline,
  type ReviewedCriterionCarryForward,
} from '../spec/compiler/migration-baseline.js';
import {scanLegacyStatement} from '../spec/legacy-statement-scanner.js';
import {loadSpec} from '../spec/load.js';
import type {Spec} from '../spec/types.js';
import {currentSafeBindingCensus, currentSafeBindings} from '../proof/current-bindings.js';
import {selectCriterionTestBindings, type CriterionBindingSelection} from '../proof/legacy-bindings.js';
import type {TestBinding} from '../proof/types.js';
import {buildProofView, type CriterionProofView} from '../proof/view.js';
import {criterionBaselineMatchShape} from '../spec/compiler/consumer-view.js';
import {parseJUnitReport, parseVitestJsonReport, type JUnitReport} from '../stages/junit-report.js';
import {isCurrentRunProofEvidence, type CurrentRunProofEvidence} from '../stages/test-run-cache.js';

/**
 * Host-injected trust/current contexts for persisted receipt re-verification.
 *
 * @see docs/design/spec-0.2/assurance.md#d23--attestation-reducer
 * @since 0.10.0
 */
export type WorkspaceReceiptContext = AttestationReceiptContext;

/** Builds closure input from one compiler snapshot and F5-safe reference bytes. */
export function assuranceClosureInputFromWorkspace(
  cwd: string,
  compilation: SpecCompilation,
  receiptContext?: WorkspaceReceiptContext,
  currentSpec?: Spec,
  controlResolver: RunnerConfigurationResolver = runnerConfigurationResolver(cwd),
): AssuranceClosureInput {
  // One closure assembly can contain many proof inputs. Runner controls are a
  // workspace fact for this snapshot, not a per-binding fact, so reuse a local
  // immutable discovery result without retaining it across edits or gate runs.
  const runnerConfig = controlResolver;
  // Schema 0.2 must consume the compiler projection exclusively. In
  // particular, do not even default-load raw scenarios, which would create a
  // second authority beside the contract compiled under the workspace lock.
  const legacy = compilation.schemaVersion === '0.1' ? (currentSpec ?? loadSpec(cwd)) : undefined;
  const schema02 = compilation.contract;
  const migrationBaselineReceipt = validatedMigrationBaselineReceiptSha256(compilation);
  const features: AssuranceFeatureInput[] = schema02
    ? schema02.features.map((feature) => ({
      id: feature.id, title: feature.title,
      ...('baselineIdentity' in feature ? {baselineIdentity: feature.baselineIdentity} : {purpose: feature.purpose}),
      modules: feature.modules,
      dependsOn: feature.dependsOn, capabilityRefs: feature.capabilityRefs, designImpact: feature.designImpact,
      criteria: feature.acceptanceCriteria.map((criterion) => ({
        id: criterion.id, kind: criterion.kind, statement: criterion.statement, rationale: criterion.rationale,
        constraintRefs: criterion.constraintRefs, oracleRefs: criterion.oracleRefs, evidenceRefs: criterion.evidenceRefs,
        ...('baselineIdentity' in criterion
          ? {legacyUnclassified: true, baselineIdentity: criterion.baselineIdentity}
          : {}),
      })),
    }))
    : (legacy?.features ?? []).map((feature) => ({
      id: feature.id, title: feature.title, modules: feature.modules, dependsOn: feature.depends_on,
      // A legacy feature has its own migration identity.  Do not substitute a
      // criterion exemption: feature-purpose review and criterion intent are
      // independent baseline subjects.
      baselineIdentity: compilation.migrationBaseline?.features.find((entry) => entry.address === `feature:${feature.id}`)?.exemption?.id,
      criteria: (feature.acceptance_criteria ?? []).map((criterion) => {
        const baseline = compilation.migrationBaseline?.criteria.find((entry) => entry.address === `criterion:${feature.id}/${criterion.id}`);
        const text = baseline?.legacyIntent.text ?? criterion.text;
        return {
          id: criterion.id, text, ears: legacyEars(criterion, baseline?.legacyIntent),
          scannerState: scanLegacyStatement(text, baseline?.legacyIntent.ears ?? criterion.ears).status,
          legacyUnclassified: baseline?.classification === LEGACY_UNCLASSIFIED,
          baselineIdentity: baseline?.exemption.id,
        oracleRefs: criterion.oracle_refs, evidenceRefs: criterion.evidence_refs,
        };
      }),
    }));
  const runtimeDependencies = features.flatMap((feature) => (feature.modules ?? []).map((module) => {
    // The authored module spelling remains the RuntimeDependencyInput identity.
    // Only its compiler-owned filesystem read admits a trailing directory
    // separator; F5 proof-binding path safety stays unchanged.
    const bytes = readSafeRuntimeModuleClosureBytes(cwd, module);
    return {feature: feature.id, module, ...(bytes === undefined ? {state: 'missing' as const} : {state: 'present' as const, bytes})};
  }));
  const legacyProofInputs: ClosureProofInput[] = compilation.edges
    .filter((edge) => edge.relation === 'supports' && edge.provenance === 'authored' && edge.channel !== undefined)
    .map((edge) => {
      const address = edge.from.replace(/^criterion:/, '');
      const path = proofPath(edge.normalizedTarget ?? edge.to);
      const bytes = path ? declaredProofClosureBytes(cwd, path) : undefined;
      const ref = {address, path: path ?? '<unresolved>', sourceBytes: bytes, runnerConfig: runnerConfig(edge.channel ?? 'unknown', edge.normalizedTarget ?? edge.to)};
      return edge.channel === 'oracle' ? {...ref, oracle: {declaration: edge.raw ?? edge.to, resolvedBytes: bytes}}
        : edge.channel === 'evidence' ? {...ref, evidence: {declaration: edge.raw ?? edge.to, resolvedBytes: bytes}}
          : ref;
    });
  // Schema 0.2 no longer accepts inline test_refs.  F5's verified title
  // carrier is therefore the live test binding authority; seal its exact test
  // source and runner configuration rather than treating a removed legacy
  // spelling as proof.  The whole file is an explicit conservative sentinel
  // until an adapter can expose a source span.
  const f5Bindings = currentSafeBindings(cwd, compilation);
  const doneFeatureIds = new Set(schema02?.features
    .filter((feature) => feature.status === 'done')
    .map((feature) => feature.id) ?? []);
  const f5ProofInputs: ClosureProofInput[] = f5Bindings.map((binding) => ({
    address: binding.criterion,
    path: binding.file,
    selector: binding.selector,
    sourceBytes: readSafeProofClosureBytes(cwd, binding.file),
    bindingProvenance: 'live',
    runnerConfig: {
      ...runnerConfig('test', `artifact:${binding.file}`),
      framework: binding.framework,
      carrier: binding.carrier,
    },
  }));
  const baselineSelections = schema02?.features.flatMap((feature) => feature.acceptanceCriteria.map((criterion) => {
    const address = `${feature.id}/${criterion.id}`;
    return selectCriterionTestBindings({
      cwd,
      baseline: compilation.migrationBaseline,
      criterion: address,
      currentCriterion: criterionBaselineMatchShape(criterion, compilation.migrationBaseline, address),
      live: f5Bindings,
    });
  })) ?? [];
  const baselineProofInputs: ClosureProofInput[] = baselineSelections.flatMap((selection) => {
    const selected = selection.source === 'reviewed' ? selection.reviewed : selection.source === 'legacy' ? selection.legacy : [];
    return selected.map((binding) => ({
      address: selection.criterion,
      path: binding.file,
      ...(binding.selector === undefined ? {} : {selector: binding.selector}),
      sourceBytes: readSafeProofClosureBytes(cwd, binding.file),
      bindingState: binding.state,
      ...(selection.source === 'reviewed' && binding.sha256 !== undefined ? {expectedBindingSha256: binding.sha256} : {}),
      bindingProvenance: selection.source === 'reviewed' ? 'reviewed_carry_forward' : 'legacy_exempt',
      runnerConfig: runnerConfig('test', `artifact:${binding.file}`),
    }));
  });
  const proofInputs = [...legacyProofInputs, ...baselineProofInputs, ...f5ProofInputs]
    .sort((left, right) => comparePath(`${left.address}\u0000${left.path}\u0000${left.selector ?? ''}`, `${right.address}\u0000${right.path}\u0000${right.selector ?? ''}`));
  return {
    schemaVersion: compilation.schemaVersion,
    features,
    capabilities: schema02?.capabilities,
    architectureRules: schema02?.architecture.rules,
    scenarios: schema02?.scenarios.map((scenario) => ({
      id: scenario.id,
      features: scenario.featureRefs,
      intent: {
        actor: scenario.actor,
        goal: scenario.goal,
        success: scenario.success,
        steps: scenario.steps,
      },
    })),
    scenarioPolicy: schema02?.project.scenarioPolicy,
    proofInputs,
    executableProofFeatureIds: Object.freeze([...new Set([
      ...f5Bindings
        .filter((binding) => schema02 === undefined || doneFeatureIds.has(binding.criterion.split('/')[0]!))
        .map((binding) => binding.criterion.split('/')[0]!),
      ...baselineSelections
        .filter((selection) => {
          const selected = selection.source === 'reviewed' ? selection.reviewed
            : selection.source === 'legacy' ? selection.legacy : [];
          return (schema02 === undefined || doneFeatureIds.has(selection.criterion.split('/')[0]!))
            && selected.some((binding) => binding.state === 'available');
        })
        .map((selection) => selection.criterion.split('/')[0]!),
    ])].sort(comparePath)),
    ...(receiptContext ? {receiptIdentities: currentReceiptIdentities(receiptContext.candidates, receiptContext.trustSnapshot)} : {}),
    migrationBaselineReceiptSha256: migrationBaselineReceipt,
    runtimeDependencies,
    dependencyComplete: compilation.edges.filter((edge) => edge.relation === 'depends_on' && edge.provenance === 'authored')
      .every((edge) => features.some((feature) => `feature:${feature.id}` === edge.to)),
  };
}

/**
 * Carries only a validated receipt content identity across the compiler/F5
 * boundary.  A generic assurance closure may seal this scalar but must not
 * import, parse, or otherwise interpret the compiler migration contract.
 */
function validatedMigrationBaselineReceiptSha256(compilation: SpecCompilation): string | null {
  const baseline = compilation.migrationBaseline;
  return baseline !== undefined && validateMigrationBaseline(baseline).length === 0
    ? migrationBaselineReceiptSha256(baseline)
    : null;
}

/** Seals the exact four closure families for a profile snapshot without a second hash model. */
export function workspaceClosureSeals(cwd: string, compilation: SpecCompilation): {
  readonly inputSha256: string;
  readonly closures: AssuranceClosureInput;
} {
  const closures = assuranceClosureInputFromWorkspace(cwd, compilation);
  const records = closures.features.flatMap((feature) => {
    const contract = contractClosure(closures, feature.id);
    const runtime = runtimeDependencyClosure(closures, feature.id);
    const subjects = feature.criteria.map((criterion) => subjectClosure(closures, `${feature.id}/${criterion.id}`).sha256);
    const verification = feature.criteria.map((criterion) => verificationClosure(closures, `${feature.id}/${criterion.id}`).sha256);
    return [{feature: feature.id, contract: contract.sha256, runtime: runtime.sha256, subject: aggregate(subjects), verification: aggregate(verification)}];
  });
  return {closures, inputSha256: createHash('sha256').update(canonicalClosureJson({records, controls: runnerConfiguration(cwd, 'workspace', 'all')}), 'utf8').digest('hex')};
}

/** Inputs that decide which D17 subclosures are required by one profile run. */
export interface WorkspaceProfileSnapshotRequest {
  readonly profile: AssuranceProfile;
  readonly scopeAddresses: readonly string[];
  /** False when compiler facts could not prove a bounded requested closure. */
  readonly scopeComplete?: boolean;
  /** Schema 0.1 applicability fact; schema 0.2 derives this from the compiler contract. */
  readonly hasExecutableTests: boolean;
  readonly oracleRequiredSubjects?: ReadonlySet<string>;
  readonly requiresHuman: boolean;
  /**
   * Lock-held callers reuse the exact closure input they just rebuilt.  This
   * prevents a writer-side profile digest from silently rereading a different
   * receipt/trust or prospective-completion view.
   */
  readonly closureInput?: AssuranceClosureInput;
  /**
   * A lock-held writer reuses one resolver for every sibling profile.  The
   * resolver caches the expensive control census by descriptor family while
   * still deriving profile-specific target records below.
   */
  readonly controlResolver?: RunnerConfigurationResolver;
}

/**
 * Compiler/F5 snapshot bound before a gate starts and rechecked afterwards.
 * It intentionally seals only the selected feature closure records: a sibling
 * receipt must not stale this subject, while the generic writer snapshot still
 * protects the complete compiled spec revision.
 */
export interface WorkspaceProfileSnapshot {
  readonly inputSha256: string;
  readonly complete: boolean;
  readonly closureInput: AssuranceClosureInput;
  /** Read-only static reports sealed alongside the profile closure, never GraphIR. */
  readonly criterionObservations: readonly CriterionObservationReport[];
  /** Exact compiler-minted static subjects, usable only by Unit/Coverage. */
  readonly staticCriterionScope: StaticCriterionScope;
  /** Accepted, current, mechanism-free L2 receipt candidates for this scope. */
  readonly migrationBaselineCandidates: readonly MigrationBaselineCandidate[];
  readonly incompleteAddresses: readonly string[];
  /** Unknown runner controls expand a claimed subset to the whole repository. */
  readonly effectiveScopeAddresses: readonly string[];
}

/** One compiler-proven feature scope that every F6 consumer must share. */
export interface EffectiveFeatureScope {
  readonly featureIds: readonly string[];
  readonly scopeAddresses: readonly string[];
  /** True means execution must remain repository-wide. */
  readonly repository: boolean;
  /** False means the attempted bounded closure had an unknown fact. */
  readonly complete: boolean;
  readonly incompleteReasons: readonly string[];
  /** Gradle module narrowing derived only from the exact non-repository scope. */
  readonly focusModules?: readonly string[];
}

/** Returns whether a schema 0.2 scope has compiler-owned Unit/Coverage subjects. */
export function hasApplicableSchema02TestCriteria(
  compilation: SpecCompilation,
  scopeAddresses: readonly string[],
): boolean {
  if (compilation.schemaVersion !== '0.2' || !compilation.contract) return false;
  const scopedFeatures = new Set(scopeAddresses.flatMap((address) => {
    if (address.startsWith('feature:')) return [address.slice('feature:'.length)];
    const criterion = /^criterion:(F-[^/]+)\//.exec(address);
    return criterion ? [criterion[1]!] : [];
  }));
  return compilation.contract.features.some((feature) => feature.status === 'done'
    && feature.acceptanceCriteria.length > 0
    && (scopedFeatures.size === 0 || scopedFeatures.has(feature.id)));
}

/**
 * Builds the narrow receipt candidates that the generic reducer may consider.
 * This is the sole assurance seam that imports the migration receipt contract:
 * kernel and run authority receive only generic subjects and content identities.
 */
export function migrationBaselineCandidatesFromWorkspace(
  cwd: string,
  compilation: SpecCompilation,
  scopeAddresses: readonly string[],
): readonly MigrationBaselineCandidate[] {
  if (compilation.schemaVersion !== '0.2' || !compilation.contract) return Object.freeze([]);
  const baseline = compilation.migrationBaseline;
  // Compilation normally has already validated this file. Recheck it once at
  // this policy boundary so an injected or prospective snapshot cannot turn a
  // malformed receipt into a per-criterion fallback.
  if (!baseline || validateMigrationBaseline(baseline).length > 0) return Object.freeze([]);
  const decision = baseline.legacyL2Baseline;
  if (decision?.decision !== 'accept') return Object.freeze([]);
  const knownCriteria = new Set(compilation.contract.features
    .flatMap((feature) => feature.acceptanceCriteria.map((criterion) => `${feature.id}/${criterion.id}`)));
  const live = currentSafeBindingCensus(cwd, knownCriteria);
  // Missing tests is a safe empty census. An unsafe, unreadable, or partially
  // parsed walk is not proof that live mechanisms are absent.
  if (!live.safe) return Object.freeze([]);
  const liveCriteria = new Set(live.bindings.map((binding) => binding.criterion));
  const authorizations = new Map(decision.authorizations.map((authorization) => [authorization.criterion, authorization]));
  const legacyCriteria = new Map(baseline.criteria.map((criterion) => [criterion.address, criterion]));
  const reviewed = new Map((baseline.reviewedCarryForwards ?? []).map((entry) => [entry.criterion, entry]));
  const scoped = migrationBaselineScope(scopeAddresses);
  const currentRecords = currentCriterionRecordsByAddress(cwd, compilation);
  const receiptSha256 = migrationBaselineReceiptSha256(baseline);
  const candidates: MigrationBaselineCandidate[] = [];
  for (const feature of compilation.contract.features) {
    if (feature.status !== 'done' || (scoped.featureIds.size > 0 && !scoped.featureIds.has(feature.id))) continue;
    for (const criterion of feature.acceptanceCriteria) {
      const address = `${feature.id}/${criterion.id}`;
      const subject = `criterion:${address}`;
      if (!scoped.includes(feature.id, subject)) continue;
      const authorization = authorizations.get(subject);
      const legacy = legacyCriteria.get(subject);
      if (!authorization || !legacy || !exactL2Obligations(authorization.obligations)) continue;
      // Preserve F5 selection precedence: an observed live binding is always
      // a mechanism before historic carry-forward or receipt fallback.
      if (liveCriteria.has(address)) continue;
      const current = currentRecords.get(subject);
      if (current === undefined) continue;
      const intent = criterionFinalIntentFromRecord(current);
      if (!intent || authorization.finalIntentSha256 !== criterionFinalIntentSha256(intent)) continue;
      const selectedReview = reviewed.get(subject);
      if (selectedReview !== undefined && reviewedIntentMatches(selectedReview, criterion)
        && selectedReview.bindings.some((binding) =>
          hasExactSelector(binding.selector)
            || hasExactSelector(binding.raw.includes('#')
              ? binding.raw.slice(binding.raw.indexOf('#') + 1)
              : undefined))) continue;
      if (legacyIntentMatches(legacy, criterion)
        && legacy.bindings.some((binding) => binding.channel === 'test' && (
          hasExactSelector(binding.selector)
            || hasExactSelector(binding.raw.includes('#')
              ? binding.raw.slice(binding.raw.indexOf('#') + 1)
              : undefined)))) continue;
      // A code-owned current rule is also a mechanism, even when its current
      // report has not yet run or is not applicable.
      if (criterionObservationRule(address) !== undefined) continue;
      candidates.push(Object.freeze({
        subject,
        obligations: Object.freeze([...LEGACY_L2_OBLIGATIONS]),
        basis: Object.freeze({
          baseline_receipt_sha256: receiptSha256,
          resolution_sha256: authorization.resolutionSha256,
          criterion_authorization_sha256: criterionAuthorizationSha256(authorization),
        }),
      }));
    }
  }
  return Object.freeze(candidates.sort((left, right) => comparePath(left.subject, right.subject)));
}

/**
 * Reads current authored criterion records once per feature source.
 *
 * The compiler projection correctly owns semantic meaning but normalizes an
 * empty `constraint_refs` list.  Migration authorization additionally binds
 * the authored final-intent shape, for which omission and an explicit empty
 * list differ.  A file which cannot be read or decoded simply supplies no
 * candidates from that source.
 *
 * @param cwd Workspace root.
 * @param compilation Current compiler result.
 * @returns Current authored criteria keyed by canonical criterion subject.
 */
function currentCriterionRecordsByAddress(
  cwd: string,
  compilation: SpecCompilation,
): ReadonlyMap<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  for (const node of compilation.nodes) {
    if (node.nodeType !== 'semantic' || node.kind !== 'feature') continue;
    try {
      const raw = parseYaml(readFileSync(join(cwd, node.source.path), 'utf8'));
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const source = raw as Record<string, unknown>;
      const expectedId = node.address.slice('feature:'.length);
      const feature = source.id === expectedId
        ? source
        : Array.isArray(source.features)
          ? source.features.find((entry): entry is Record<string, unknown> => entry !== null
            && typeof entry === 'object' && !Array.isArray(entry)
            && (entry as Record<string, unknown>).id === expectedId)
          : undefined;
      if (feature === undefined) continue;
      if (typeof feature.id !== 'string' || !Array.isArray(feature.acceptance_criteria)) continue;
      for (const entry of feature.acceptance_criteria) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const criterion = entry as Record<string, unknown>;
        if (typeof criterion.id === 'string') {
          records.set(`criterion:${feature.id}/${criterion.id}`, criterion);
        }
      }
    } catch {
      // Exact authored intent is mandatory: an unreadable source is ineligible.
    }
  }
  return records;
}

/** Preserves a criterion-narrowed profile request instead of widening it to its feature. */
function migrationBaselineScope(scopeAddresses: readonly string[]): {
  readonly featureIds: ReadonlySet<string>;
  readonly includes: (featureId: string, criterionSubject: string) => boolean;
} {
  const featureIds = new Set<string>();
  const criterionSubjects = new Set<string>();
  for (const address of scopeAddresses) {
    if (address.startsWith('feature:')) {
      featureIds.add(address.slice('feature:'.length));
    } else if (/^criterion:F-[^/]+\/AC-[^/]+$/.test(address)) {
      criterionSubjects.add(address);
      featureIds.add(address.slice('criterion:'.length).split('/')[0]!);
    }
  }
  const featureWide = new Set(scopeAddresses
    .filter((address) => address.startsWith('feature:'))
    .map((address) => address.slice('feature:'.length)));
  return Object.freeze({
    featureIds,
    includes: (featureId, criterionSubject): boolean => scopeAddresses.length === 0
      || featureWide.has(featureId) || criterionSubjects.has(criterionSubject),
  });
}

/** Keeps the receipt’s fixed pair from becoming a generic descriptor waiver. */
function exactL2Obligations(obligations: readonly string[]): boolean {
  return obligations.length === LEGACY_L2_OBLIGATIONS.length
    && obligations.every((obligation, index) => obligation === LEGACY_L2_OBLIGATIONS[index]);
}

/** Returns whether the current strict target still selects one reviewed carry-forward. */
function reviewedIntentMatches(
  review: ReviewedCriterionCarryForward,
  criterion: {readonly statement: string; readonly kind?: string; readonly rationale?: string; readonly constraintRefs: readonly string[]},
): boolean {
  if (criterion.statement !== review.intent.statement || criterion.kind !== review.intent.kind
    || criterion.rationale !== review.intent.rationale) return false;
  const refs = review.intent.constraintRefs;
  return refs === undefined
    ? criterion.constraintRefs.length === 0
    : refs.length === criterion.constraintRefs.length
      && refs.every((ref, index) => ref === criterion.constraintRefs[index]);
}

/** Returns whether the unchanged legacy selection, if any, still wins for this criterion. */
function legacyIntentMatches(
  legacy: CriterionIntentBaseline,
  criterion: {readonly statement: string; readonly kind?: string; readonly rationale?: string; readonly constraintRefs: readonly string[]},
): boolean {
  if (!legacy.exemption || criterion.statement !== legacy.legacyIntent.text
    || (criterion.kind !== undefined && criterion.kind !== LEGACY_UNCLASSIFIED)) return false;
  const rationale = legacy.legacyIntent.rationale;
  const refs = legacy.legacyIntent.constraint_refs;
  return (rationale === undefined ? criterion.rationale === undefined : criterion.rationale === rationale)
    && (refs === undefined ? criterion.constraintRefs.length === 0 : criterion.constraintRefs.join(',') === refs);
}

/**
 * Relations whose unresolved edge means the compiler could not place a node in
 * the structural graph, so any bounded scope derived from it could be silently
 * narrow.  Every other relation, the proof channels included, is deliberately
 * excluded: an unresolved `supports`/`covers` declaration is a sealed negative
 * fact belonging to its own criterion, not unknown repository topology, so it
 * must never escalate an unrelated feature's scope.
 */
const SCOPE_STRUCTURAL_RELATIONS: readonly string[] = Object.freeze([
  'contains', 'contributes_to', 'defined_in', 'depends_on', 'participates_in', 'touches',
]);

/**
 * Resolves the fixed-point impact closure from compiler facts only.  Each newly
 * discovered feature contributes its prerequisites, transitive dependents, and
 * shared artifact owners on the next pass.  A missing graph fact never leaves a
 * deceptively narrow scope behind: it returns every contract feature and no
 * module focus.
 */
export function effectiveFeatureScope(
  compilation: SpecCompilation,
  profile: AssuranceProfile,
  requestedAddresses: readonly string[] | undefined,
): EffectiveFeatureScope {
  const allFeatures = [...(compilation.contract?.features ?? [])].sort((left, right) => comparePath(left.id, right.id));
  const allIds = new Set(allFeatures.map((feature) => feature.id));
  const allScope = Object.freeze(allFeatures.map((feature) => `feature:${feature.id}`));
  const reasons = new Set<string>();
  if (compilation.schemaVersion !== '0.2' || !compilation.contract) {
    return {featureIds: Object.freeze([]), scopeAddresses: Object.freeze([]), repository: true, complete: false, incompleteReasons: Object.freeze(['schema'])};
  }
  if (compilation.diagnostics.some((diagnostic) => diagnostic.severity !== 'advisory')) reasons.add('compiler-diagnostic');
  if (compilation.edges.some((edge) => (edge.state === 'unresolved' || edge.state === 'unknown')
    && SCOPE_STRUCTURAL_RELATIONS.includes(edge.relation))) reasons.add('unresolved-graph');
  const requested = requestedAddresses ?? [];
  const selected = new Set<string>();
  for (const address of requested) {
    const feature = /^feature:(F-[^/]+)$/.exec(address)?.[1];
    const criterion = /^criterion:(F-[^/]+)\/(AC-[^/]+)$/.exec(address);
    if (feature && allIds.has(feature)) {
      selected.add(feature);
    } else if (criterion && allIds.has(criterion[1]!)) {
      const owner = allFeatures.find((candidate) => candidate.id === criterion[1]!);
      if (owner?.acceptanceCriteria.some((entry) => entry.id === criterion[2])) selected.add(criterion[1]!);
      else reasons.add(`unknown:${address}`);
    } else {
      reasons.add(`unknown:${address}`);
    }
  }
  // Push is an integration boundary. There is no compiler-owned change-set
  // input at this seam yet, so a transport feature/module hint can never act as
  // its authority; whole-repository execution is the safe default.
  if (profile.id === 'push' || profile.id === 'release' || requested.length === 0) {
    return {
      featureIds: Object.freeze([...allIds].sort(comparePath)), scopeAddresses: allScope,
      repository: true, complete: reasons.size === 0, incompleteReasons: Object.freeze([...reasons].sort(comparePath)),
    };
  }
  const view = compilerCorpusView(compilation);
  const prerequisites = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const fact of view.prerequisites) {
    const feature = fact.feature.replace(/^feature:/, '');
    const prerequisite = fact.prerequisite.replace(/^feature:/, '');
    if (!allIds.has(feature) || !allIds.has(prerequisite)) {
      reasons.add(`unresolved-dependency:${fact.feature}->${fact.prerequisite}`);
      continue;
    }
    prerequisites.set(feature, [...(prerequisites.get(feature) ?? []), prerequisite]);
  }
  for (const fact of view.dependents) {
    const feature = fact.feature.replace(/^feature:/, '');
    const dependent = fact.dependent.replace(/^feature:/, '');
    if (!allIds.has(feature) || !allIds.has(dependent)) {
      reasons.add(`unresolved-dependent:${fact.feature}->${fact.dependent}`);
      continue;
    }
    dependents.set(feature, [...(dependents.get(feature) ?? []), dependent]);
  }
  const ownersByArtifact = new Map(view.artifactOwners.map((record) => [record.artifact, record.owners.map((owner) => owner.replace(/^feature:/, ''))]));
  const byId = new Map(allFeatures.map((feature) => [feature.id, feature]));
  const pending = new Set(selected);
  while (pending.size > 0) {
    const featureId = [...pending].sort(comparePath)[0]!;
    pending.delete(featureId);
    const feature = byId.get(featureId);
    if (!feature) {
      reasons.add(`unknown-feature:${featureId}`);
      continue;
    }
    const expand = (candidate: string): void => {
      if (!allIds.has(candidate)) {
        reasons.add(`unowned-feature:${candidate}`);
      } else if (!selected.has(candidate)) {
        selected.add(candidate);
        pending.add(candidate);
      }
    };
    (prerequisites.get(featureId) ?? []).sort(comparePath).forEach(expand);
    (dependents.get(featureId) ?? []).sort(comparePath).forEach(expand);
    for (const module of feature.modules ?? []) {
      let artifact: string;
      try {
        artifact = artifactAddress(module);
      } catch {
        reasons.add(`invalid-module:${featureId}:${module}`);
        continue;
      }
      const owners = ownersByArtifact.get(artifact);
      if (!owners || !owners.includes(featureId)) {
        reasons.add(`unowned-artifact:${artifact}`);
        continue;
      }
      owners.sort(comparePath).forEach(expand);
    }
  }
  if (reasons.size > 0) {
    return {
      featureIds: Object.freeze([...allIds].sort(comparePath)), scopeAddresses: allScope,
      repository: true, complete: false, incompleteReasons: Object.freeze([...reasons].sort(comparePath)),
    };
  }
  const featureIds = [...selected].sort(comparePath);
  const focusModules = [...new Set(featureIds.flatMap((id) => byId.get(id)?.modules ?? []))].sort(comparePath);
  return {
    featureIds: Object.freeze(featureIds), scopeAddresses: Object.freeze(featureIds.map((id) => `feature:${id}`)),
    repository: false, complete: true, incompleteReasons: Object.freeze([]),
    ...(focusModules.length > 0 ? {focusModules: Object.freeze(focusModules)} : {}),
  };
}

/** Builds the single profile-aware D17 snapshot used by adapters and the writer. */
export function workspaceProfileSnapshot(
  cwd: string,
  compilation: SpecCompilation,
  request: WorkspaceProfileSnapshotRequest,
): WorkspaceProfileSnapshot {
  // One resolver owns both the proof closure and the profile-level control
  // record. Creating either discovery independently could let a concurrent
  // control edit bind those two halves to different runner selections.
  const controlResolver = request.controlResolver ?? runnerConfigurationResolver(cwd);
  const closureInput = request.closureInput
    ?? assuranceClosureInputFromWorkspace(cwd, compilation, undefined, undefined, controlResolver);
  const scoped = request.scopeAddresses.flatMap((address) => {
    if (address.startsWith('feature:')) return [address.slice('feature:'.length)];
    const criterion = /^criterion:(F-[^/]+)\//.exec(address);
    return criterion ? [criterion[1]!] : [];
  });
  const descriptors = new Set(request.profile.obligations);
  const controls = controlResolver('profile', request.profile.id,
    OBLIGATION_DESCRIPTORS.filter((descriptor) => descriptors.has(descriptor.id)));
  const requestedFeatureIds = scoped.length > 0 ? scoped : closureInput.features.map((feature) => feature.id);
  const featureIds = [...new Set(controls.complete ? requestedFeatureIds : closureInput.features.map((feature) => feature.id))]
    .sort(comparePath);
  const effectiveScopeAddresses = [
    ...(controls.complete ? request.scopeAddresses : featureIds.map((feature) => `feature:${feature}`)),
  ].sort(comparePath);
  const hasApplicableTests = compilation.schemaVersion === '0.2'
    ? hasApplicableSchema02TestCriteria(compilation, effectiveScopeAddresses)
    : request.hasExecutableTests;
  const requiresTest = hasApplicableTests && (descriptors.has('stage_2.1') || descriptors.has('stage_2.2'));
  const requiresOracle = descriptors.has('stage_2.3');
  const requiresHuman = request.requiresHuman && (descriptors.has('stage_4.1') || descriptors.has('stage_4.2'));
  const records: unknown[] = [];
  const incompleteAddresses: string[] = [];
  for (const featureId of featureIds) {
    const contract = contractClosure(closureInput, featureId);
    const runtime = runtimeDependencyClosure(closureInput, featureId);
    records.push({feature: featureId, contract: contract.sha256, runtime: runtime.sha256});
    // Lifecycle is compiler-owned applicability: unfinished schema 0.2
    // criteria still contribute contract/runtime impact facts, but they are
    // not current Unit/Coverage/Human proof subjects. Schema 0.1 retains its
    // historic all-criteria profile behavior.
    const compilerFeature = compilation.schemaVersion === '0.2'
      ? compilation.contract?.features.find((candidate) => candidate.id === featureId)
      : undefined;
    // An unfinished schema 0.2 feature is inside the spec-first window, where
    // an authored module or criterion legitimately precedes the code that will
    // satisfy it. Its digests stay in the snapshot input so a later build still
    // changes the identity, but its absent inputs are an expected lifecycle
    // fact rather than an unknown that stales every profile obligation.
    const currentSubject = compilation.schemaVersion !== '0.2' || compilerFeature?.status === 'done';
    if (currentSubject && !contract.complete) incompleteAddresses.push(`contract:${featureId}`);
    if (currentSubject && !runtime.complete) incompleteAddresses.push(`runtime:${featureId}`);
    const feature = closureInput.features.find((candidate) => candidate.id === featureId);
    if (!feature || !currentSubject) continue;
    for (const criterion of feature.criteria) {
      const address = `criterion:${featureId}/${criterion.id}`;
      const verificationRequired = requiresTest || requiresHuman
        || (requiresOracle && request.oracleRequiredSubjects?.has(address) === true);
      if (!verificationRequired) continue;
      const subject = subjectClosure(closureInput, `${featureId}/${criterion.id}`);
      const verification = verificationClosure(closureInput, `${featureId}/${criterion.id}`);
      records.push({subject: address, subject_sha256: subject.sha256, verification_sha256: verification.sha256});
      if (!subject.complete) incompleteAddresses.push(`subject:${featureId}/${criterion.id}`);
      if (!verification.complete) incompleteAddresses.push(`verification:${featureId}/${criterion.id}`);
    }
  }
  const policy = {
    profile: request.profile.id,
    assurance_level: request.profile.assurance_level,
    obligations: [...request.profile.obligations].sort(comparePath),
    scope_addresses: effectiveScopeAddresses,
    has_executable_tests: hasApplicableTests,
    oracle_required_subjects: [...(request.oracleRequiredSubjects ?? [])].sort(comparePath),
    requires_human: request.requiresHuman,
  };
  // Compiler scope creates static obligations independently of reports. A
  // missing report must remain a required/unobserved criterion row instead of
  // removing the subject and manufacturing a project-wide NA.
  const staticCriterionScope = staticCriterionScopeFromWorkspace(compilation, effectiveScopeAddresses);
  const criterionObservations = staticCriterionReportsFromWorkspace(cwd, compilation, effectiveScopeAddresses);
  const migrationBaselineCandidates = migrationBaselineCandidatesFromWorkspace(cwd, compilation, effectiveScopeAddresses);
  records.push({criterion_observations: criterionObservations.map((report) => ({
    criterion: report.criterion, adapter: report.adapter, state: report.state,
    current: report.current, complete: report.complete, applicable: report.applicable,
    input_addresses: [...report.input_addresses].sort(comparePath), input_sha256: report.input_sha256,
    manifest_sha256: report.manifest_sha256,
  }))});
  records.push({migration_baseline_candidates: migrationBaselineCandidates.map((candidate) => ({
    subject: candidate.subject,
    obligations: [...candidate.obligations],
    basis: candidate.basis,
  }))});
  if (request.scopeComplete === false) incompleteAddresses.push('scope-closure');
  if (controls.complete !== true) incompleteAddresses.push('runner-controls');
  return Object.freeze({
    inputSha256: createHash('sha256').update(canonicalClosureJson({policy, records, controls}), 'utf8').digest('hex'),
    complete: incompleteAddresses.length === 0,
    closureInput,
    criterionObservations: Object.freeze(criterionObservations),
    staticCriterionScope,
    migrationBaselineCandidates,
    incompleteAddresses: Object.freeze(incompleteAddresses.sort(comparePath)),
    effectiveScopeAddresses: Object.freeze(effectiveScopeAddresses),
  });
}

/**
 * Out-collector for the criteria whose current selection named a binding
 * source at all — live, reviewed, or legacy, including a historic selection
 * whose bytes have since moved.  F6 reads it to tell "nothing renewed this
 * proof" from "this criterion never named a testcase"; the F5 view itself
 * cannot carry the distinction, since both reduce to the same unverified
 * observation.
 */
export interface BoundCriteriaCollector {
  /**
   * Present ONLY when a current run report actually joined.  Its absence is
   * how a caller learns this run observed no runner at all, so an empty set
   * can never be mistaken for proof that no criterion is bound.
   */
  criteria?: ReadonlySet<string>;
}

/**
 * Adapts current runner evidence into F5's exact binding reducer.  This owns
 * only safe input collection: F5 remains the sole proof evaluator.  No report,
 * invalid source, unsafe path, or unsupported test carrier yields unobserved
 * proof rows rather than a feature-wide pass.
 */
export function currentProofViewsFromWorkspace(
  cwd: string,
  compilation: SpecCompilation,
  scopeSubjects: readonly string[],
  currentRun?: CurrentRunProofEvidence,
  expectedInputSha256?: string,
  boundCriteria?: BoundCriteriaCollector,
): readonly CriterionProofView[] {
  if (compilation.schemaVersion !== '0.2') return [];
  const selected = new Set(scopeSubjects.flatMap((subject) => {
    if (subject.startsWith('feature:')) return [subject.slice('feature:'.length)];
    const criterion = /^criterion:(F-[^/]+)\//.exec(subject);
    return criterion ? [criterion[1]!] : [];
  }));
  const criteria = (compilation.contract?.features ?? [])
    .filter((feature) => feature.status === 'done' && (selected.size === 0 || selected.has(feature.id)))
    .flatMap((feature) => feature.acceptanceCriteria.map((criterion) => `${feature.id}/${criterion.id}`));
  if (criteria.length === 0) return [];
  // F6 never upgrades a pre-existing workspace JUnit file into a current
  // observation.  Only the opaque output of this gate's Unit invocation can
  // join an exact F5 binding to the sealed pre-run input digest.
  const report = currentRun && expectedInputSha256 !== undefined
    && currentRun.inputSha256 === expectedInputSha256
    && currentRun.adapter.id === 'legacy-stage:stage_2.1'
    && currentRun.adapter.version === '1'
    && /^[0-9a-f]{64}$/.test(currentRun.commandSha256)
    && /^[0-9a-f]{64}$/.test(currentRun.reportSha256)
    && isCurrentRunProofEvidence(currentRun)
    ? currentRun.format === 'vitest-json'
      ? parseVitestJsonReport(currentRun.reportBytes, cwd)
      : currentJUnitReport(currentRun.reportBytes)
    : undefined;
  const selections = report ? criterionBindingSelections(cwd, compilation) : [];
  // Only a joined report proves anything about bindings. Leaving `criteria`
  // absent otherwise is the whole point of the wrapper: a bare empty set
  // would read as "nothing is bound" on exactly the runs that learned least.
  if (boundCriteria && report) {
    boundCriteria.criteria = new Set(selections
      .filter((selection) => selection.source !== 'none')
      .map((selection) => selection.criterion));
  }
  const bindings = observableBindings(selections);
  return buildProofView({schemaVersion: '0.2', criteria, bindings, ...(report ? {report} : {})});
}

/**
 * Returns F5's exclusive observable binding selection for current done
 * criteria. Historic selections cross this seam only after a safe, unchanged
 * source and exact selector check; a missing runner is not compiler NA proof.
 *
 * @see docs/design/spec-0.2/proof-and-editing.md#f5--live-test-bindings
 */
export function currentProofBindingsFromWorkspace(
  cwd: string,
  compilation: SpecCompilation,
): readonly TestBinding[] {
  return observableBindings(criterionBindingSelections(cwd, compilation));
}

/**
 * Runs F5's selection once per current done criterion.  SELECTION and
 * OBSERVABLE BINDING answer different questions: a criterion can name a
 * reviewed source whose bytes have since moved, which selects a source but
 * yields nothing a runner can observe.  Both readers share this one scan of
 * the live surface rather than walking the test tree twice.
 */
function criterionBindingSelections(
  cwd: string,
  compilation: SpecCompilation,
): readonly CriterionBindingSelection[] {
  if (compilation.schemaVersion !== '0.2') return [];
  const live = currentSafeBindings(cwd, compilation);
  return (compilation.contract?.features ?? [])
    .filter((feature) => feature.status === 'done')
    .flatMap((feature) => feature.acceptanceCriteria.map((criterion) => {
      const address = `${feature.id}/${criterion.id}`;
      return selectCriterionTestBindings({
        cwd,
        baseline: compilation.migrationBaseline,
        criterion: address,
        currentCriterion: criterionBaselineMatchShape(criterion, compilation.migrationBaseline, address),
        live,
      });
    }));
}

/** Projects only the selections a runner can actually observe, in stable order. */
function observableBindings(selections: readonly CriterionBindingSelection[]): readonly TestBinding[] {
  return selections
    .flatMap((selection) => {
      if (selection.source === 'live') return selection.live;
      const historic = selection.source === 'reviewed' ? selection.reviewed
        : selection.source === 'legacy' ? selection.legacy : [];
      return historic.flatMap((binding) => binding.state === 'available' && hasExactSelector(binding.selector)
        ? [{criterion: selection.criterion, framework: 'vitest' as const, file: binding.file, selector: binding.selector, carrier: 'title' as const}]
        : []);
    })
    .sort((left, right) => comparePath(
      `${left.criterion}\u0000${left.file}\u0000${left.selector}`,
      `${right.criterion}\u0000${right.file}\u0000${right.selector}`,
    ));
}

/** Returns every feature with the selected executable test source for this snapshot. */
export function currentExecutableProofFeatureIdsFromWorkspace(
  cwd: string,
  compilation: SpecCompilation,
): readonly string[] {
  return assuranceClosureInputFromWorkspace(cwd, compilation).executableProofFeatureIds ?? [];
}

/** The four D17 seals for one feature, reusable by the v3 freshness reader. */
export interface FeatureClosureSeals {
  readonly contractSha256: string;
  readonly subjectSha256: string;
  readonly verificationSha256: string;
  readonly runtimeDependencySha256: string;
  readonly complete: boolean;
}

/** Calculates exactly the feature-scoped closure fields persisted in attestation v3. */
export function featureClosureSeals(
  closures: AssuranceClosureInput,
  feature: string,
): FeatureClosureSeals {
  const contract = contractClosure(closures, feature);
  const runtime = runtimeDependencyClosure(closures, feature);
  const criteria = closures.features.find((candidate) => candidate.id === feature)?.criteria ?? [];
  const subjects = criteria.map((criterion) => subjectClosure(closures, `${feature}/${criterion.id}`));
  const verification = criteria.map((criterion) => verificationClosure(closures, `${feature}/${criterion.id}`));
  return Object.freeze({
    contractSha256: contract.sha256,
    subjectSha256: aggregate(subjects.map((closure) => closure.sha256)),
    verificationSha256: aggregate(verification.map((closure) => closure.sha256)),
    runtimeDependencySha256: runtime.sha256,
    complete: contract.complete && runtime.complete && subjects.every((closure) => closure.complete)
      && verification.every((closure) => closure.complete),
  });
}

/** Produces one v3 entry per scoped feature after the profile snapshot proved its required closure set complete. */
export function createWorkspaceAttestations(input: {
  readonly cwd: string;
  readonly compilation: SpecCompilation;
  readonly verdict: AssuranceVerdict;
  readonly featureIds: readonly string[];
  readonly detectorCatalogSha256: string;
  readonly toolIdentity: string;
  readonly environmentClass: string;
  readonly trustSnapshotSha256: string;
  /** Current F5-verified receipt/trust inputs; F6 supplies an empty snapshot. */
  readonly receiptContext?: WorkspaceReceiptContext;
}): readonly AuthoritativeAttestationV3[] {
  // The compiler records an existing managed baseline artifact even when its
  // contents are invalid. Such a receipt is a closure input, never an absent
  // optional value that an authoritative writer may silently ignore.
  if (input.compilation.schemaVersion === '0.2'
    && input.compilation.nodes.some((node) => node.nodeType === 'artifact'
      && node.address === artifactAddress('spec/generated/migration-baseline-0.1-to-0.2.yaml'))
    && validatedMigrationBaselineReceiptSha256(input.compilation) === null) return Object.freeze([]);
  const closures = assuranceClosureInputFromWorkspace(input.cwd, input.compilation, input.receiptContext);
  const registrySha256 = createHash('sha256').update(canonicalClosureJson(OBLIGATION_DESCRIPTORS), 'utf8').digest('hex');
  const entries: AuthoritativeAttestationV3[] = [];
  for (const feature of [...new Set(input.featureIds)].sort()) {
    // Completion claims only the feature that is currently done.  A broad
    // push/release profile can observe all contract features, but it must not
    // stamp an in-progress sibling merely because its closures happen to load.
    const compiledFeature = input.compilation.contract?.features.find((candidate) => candidate.id === feature);
    if (input.compilation.schemaVersion === '0.2' && compiledFeature?.status !== 'done') continue;
    const seals = featureClosureSeals(closures, feature);
    // `featureClosureSeals.complete` describes every possible L2/L4 proof
    // input.  A profile-aware snapshot has already rejected a missing closure
    // that this profile actually requires; an L1 completion must not pretend
    // the absent optional proof is a reason to suppress its authoritative row.
    const entry = mintWorkspaceAttestationV3({
      verdict: input.verdict,
      feature,
      contractSha256: seals.contractSha256,
      subjectSha256: seals.subjectSha256,
      verificationSha256: seals.verificationSha256,
      runtimeDependencySha256: seals.runtimeDependencySha256,
      registrySha256,
      detectorCatalogSha256: input.detectorCatalogSha256,
      toolIdentity: input.toolIdentity,
      environmentClass: input.environmentClass,
      trustSnapshotSha256: input.trustSnapshotSha256,
    });
    if (entry) entries.push(entry);
  }
  return entries;
}

function aggregate(values: readonly string[]): string {
  return createHash('sha256').update(canonicalClosureJson([...values].sort()), 'utf8').digest('hex');
}

function proofPath(address: string): string | undefined {
  const artifact = address.match(/^(?:artifact|anchor):([^#]+)(?:#.*)?$/)?.[1];
  return artifact?.includes(':') || artifact?.split('/').includes('..') ? undefined : artifact;
}

/**
 * Reads an authored oracle or evidence declaration through the F5-safe
 * boundary.
 *
 * A declaration may name a directory with a trailing separator, exactly as a
 * feature module may, while a proof binding deliberately may not.  Normalize
 * that presentation detail for this compiler-owned read only: the authored
 * spelling remains the closure identity and address, every descendant keeps
 * the workspace and symlink checks, and F5 test-binding path safety is
 * unchanged.
 *
 * @param cwd Workspace root.
 * @param path Authored declaration path.
 * @returns Deterministic bytes, or undefined for an unsafe or absent target.
 */
function declaredProofClosureBytes(cwd: string, path: string): Uint8Array | undefined {
  const readPath = path.replace(/[\\/]+$/, '');
  return readPath === '' ? undefined : readSafeProofClosureBytes(cwd, readPath);
}

function legacyEars(
  criterion: {readonly ears?: string; readonly condition?: string; readonly action?: string; readonly response?: string},
  baseline?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ['ears', baseline?.ears ?? criterion.ears],
    ['condition', baseline?.condition ?? criterion.condition],
    ['action', baseline?.action ?? criterion.action],
    ['response', baseline?.response ?? criterion.response],
  ];
  return fields.reduce<Record<string, string>>((result, field) => {
    const value = field[1];
    if (typeof value === 'string') result[field[0]] = value;
    return result;
  }, {});
}

const CONTROL_PATHS: Readonly<Record<AssuranceControl, readonly string[]>> = Object.freeze({
  workspace: Object.freeze(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lockb', '.npmrc', '.yarnrc.yml', '.secretlintrc', '.secretlintrc.json', '.secretlintrc.yaml', '.secretlintrc.yml', 'lerna.json', 'turbo.json', 'nx.json', '.cladding/config.yaml']),
  type: Object.freeze(['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.build.json', 'tsconfig.test.json']),
  lint: Object.freeze(['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.mjs', '.eslintrc.ts', '.eslintrc.cts', '.eslintrc.mts', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml']),
  test: Object.freeze(['vitest.config.ts', 'vitest.config.mts', 'vitest.config.cts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs', 'vitest.workspace.ts', 'vitest.workspace.mts', 'vitest.workspace.cts', 'vitest.workspace.js', 'vitest.workspace.mjs', 'vitest.workspace.cjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'jest.config.ts', 'jest.config.mts', 'jest.config.cts', 'jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json']),
  python: Object.freeze(['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini', '.coveragerc', 'requirements.txt', 'requirements-dev.txt', 'poetry.lock', 'Pipfile.lock']),
  rust: Object.freeze(['Cargo.toml', 'Cargo.lock']),
  go: Object.freeze(['go.mod', 'go.sum']),
  jvm: Object.freeze(['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'gradle/wrapper/gradle-wrapper.properties']),
});

const CONTROL_SCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']);
const LOCAL_CONTROL_EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.json'];
const AUTHORITATIVE_PACKAGE_SCRIPTS = new Set(['lint', 'test', 'coverage', 'smoke', 'perf', 'visual']);
const KNOWN_INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node', 'python', 'python2', 'python3', 'pypy', 'pypy3', 'ruby', 'perl', 'php', 'lua']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PACKAGE_EXECUTION_MODES = new Set(['exec', 'x', 'dlx']);
const PACKAGE_EXECUTION_ALIASES = new Set(['npx', 'pnpx', 'bunx']);
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh']);
const BUILTIN_FILESYSTEM_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const BUILTIN_PROCESS_MODULES = new Set(['process', 'node:process']);
const BUILTIN_MODULE_LOADER_MODULES = new Set(['module', 'node:module']);
const RUNTIME_FILE_READS = new Set([
  'readFile', 'readFileSync', 'createReadStream', 'readdir', 'readdirSync',
  'stat', 'statSync', 'lstat', 'lstatSync', 'realpath', 'realpathSync', 'open', 'openSync',
]);
const EXCLUDED_CONTROL_DIRECTORIES = new Set([
  'node_modules', '.git', 'coverage', 'dist', 'build', 'target', '.cache', '.next', 'out',
  '.gradle', '.idea', '.turbo', '.nx', '__pycache__', '.pytest_cache', '.mypy_cache',
]);
const CLADDING_EXCLUDED_DIRECTORIES = new Set(['cache', 'generated', 'graph', 'reports', 'tmp']);

interface RunnerControlSeal {
  readonly controls: Readonly<Record<string, string>>;
  readonly unknown: readonly string[];
  readonly complete: boolean;
}

interface JsoncAstNode {
  readonly type?: string;
  readonly properties?: readonly JsoncAstNode[];
  readonly elements?: readonly (JsoncAstNode | null)[];
  readonly key?: JsoncAstNode;
  readonly value?: unknown;
  readonly name?: string;
  readonly computed?: boolean;
  readonly shorthand?: boolean;
  readonly operator?: string;
  readonly argument?: JsoncAstNode;
}

function jsoncProperty(object: JsoncAstNode, name: string): JsoncAstNode | undefined {
  let value: JsoncAstNode | undefined;
  for (const property of object.properties ?? []) {
    if (jsoncPropertyName(property.key) === name && isJsoncAstNode(property.value)) value = property.value;
  }
  return value;
}

function jsoncPropertyName(node: JsoncAstNode | undefined): string | undefined {
  if (node?.type === 'Identifier' && typeof node.name === 'string') return node.name;
  return node?.type === 'StringLiteral' && typeof node.value === 'string' ? node.value : undefined;
}

function isJsoncObject(node: unknown): node is JsoncAstNode {
  return isJsoncAstNode(node)
    && node.type === 'ObjectExpression'
    && Array.isArray(node.properties)
    && node.properties.every(isJsoncProperty);
}

function isJsoncProperty(node: JsoncAstNode): boolean {
  return node.type === 'ObjectProperty'
    && node.computed !== true
    && node.shorthand !== true
    && jsoncPropertyName(node.key) !== undefined
    && isJsoncValue(node.value);
}

function isJsoncValue(node: unknown): node is JsoncAstNode {
  if (!isJsoncAstNode(node)) return false;
  if (node.type === 'StringLiteral') return typeof node.value === 'string';
  if (node.type === 'BooleanLiteral') return typeof node.value === 'boolean';
  if (node.type === 'NullLiteral') return true;
  if (node.type === 'NumericLiteral') return typeof node.value === 'number' && Number.isFinite(node.value);
  if (node.type === 'UnaryExpression') {
    return node.operator === '-'
      && isJsoncAstNode(node.argument)
      && node.argument.type === 'NumericLiteral'
      && typeof node.argument.value === 'number'
      && Number.isFinite(node.argument.value);
  }
  if (node.type === 'ArrayExpression') return Array.isArray(node.elements) && node.elements.every((element) => element !== null && isJsoncValue(element));
  return node.type === 'ObjectExpression' && isJsoncObject(node);
}

function isJsoncAstNode(value: unknown): value is JsoncAstNode {
  return value !== null && typeof value === 'object';
}

/**
 * Immutable runner-control inputs for one verification channel and target.
 *
 * @see docs/design/spec-0.2/assurance.md D17
 * @since 0.10.0
 */
export interface RunnerConfiguration {
  readonly channel: string;
  readonly target: string;
  readonly controls: Readonly<Record<string, string>>;
  readonly unknown_controls: readonly string[];
  readonly complete: boolean;
}

/**
 * Snapshot-local resolver that derives runner controls without re-walking the
 * workspace for every sibling profile.
 *
 * @see docs/design/spec-0.2/assurance.md D23
 * @since 0.10.0
 */
export type RunnerConfigurationResolver = (
  channel: string,
  target: string,
  descriptorEntries?: readonly {readonly controls: readonly AssuranceControl[]}[],
) => RunnerConfiguration;

/**
 * Seals the complete local runner-control closure.  The discovery walk is
 * deliberately narrower than a source walk: it traverses workspace manifests
 * and recognized controls everywhere, then follows only explicit local config
 * edges. Any ambiguity makes the profile unresolved instead of silently
 * accepting a scoped run whose runner inputs were not sealed.
 */
function runnerConfiguration(
  cwd: string,
  channel: string,
  target: string,
  descriptorEntries: readonly {readonly controls: readonly AssuranceControl[]}[] = OBLIGATION_DESCRIPTORS,
): RunnerConfiguration {
  return runnerConfigurationResolver(cwd)(channel, target, descriptorEntries);
}

/**
 * Creates a snapshot-local runner-control resolver; it never survives an edit.
 *
 * @param cwd - Workspace root whose runner controls are sealed.
 * @returns Resolver sharing one immutable full control census.
 * @throws Never; incomplete or unsafe control discovery is represented by its result.
 * @see docs/design/spec-0.2/assurance.md D17
 * @since 0.10.0
 */
export function runnerConfigurationResolver(cwd: string): RunnerConfigurationResolver {
  // A gate snapshot can query several descriptor families while building its
  // closure and profile records. Capture all known runner controls once so an
  // edit between family queries cannot compose two different workspaces.
  const seal = discoverRunnerControls(cwd, new Set(Object.keys(CONTROL_PATHS) as AssuranceControl[]));
  return (channel, target, descriptorEntries): RunnerConfiguration => {
    // A family-specific caller still receives this immutable full census; a
    // narrower projection may be added from these bytes without new I/O.
    void descriptorEntries;
    return Object.freeze({
      channel,
      target,
      controls: seal.controls,
      unknown_controls: seal.unknown,
      complete: seal.complete,
    });
  };
}

/** Finds and hashes one deterministic runner-control closure without following links. */
function discoverRunnerControls(cwd: string, families: ReadonlySet<AssuranceControl>): RunnerControlSeal {
  const root = resolve(cwd);
  const selectedPaths = new Set([...families].flatMap((family) => CONTROL_PATHS[family]));
  // Named runner controls may occur in a nested workspace package. A matching
  // basename outside a control location is ordinary project content unless a
  // sealed control explicitly reaches it; source, test, spec, documentation,
  // and generated graph names must not become ambient runner inputs.
  const allKnownNames = new Set(Object.values(CONTROL_PATHS).flat()
    .filter((path) => !path.includes('/'))
    .map((path) => path.split('/').at(-1)!));
  const controls = new Map<string, string>();
  const issues = new Set<string>();
  const queued = new Set<string>();
  const visited = new Set<string>();
  const commandTargets = new Set<string>();
  const staticGradleWrappers = new Set<string>();
  const gatePackageScripts = new Set<string>();

  // Absence remains a sealable sentinel. It distinguishes a known default
  // control that was absent when the runner was selected from an untracked file
  // which appears later in the workspace.
  for (const path of [...selectedPaths].sort(comparePath)) controls.set(path, '<missing>');

  const repoPath = (absolute: string): string | undefined => {
    const path = relative(root, absolute).replaceAll('\\', '/');
    return path === '' || path === '..' || path.startsWith('../') ? undefined : path;
  };
  const isSafeFile = (absolute: string, path: string): boolean => {
    if (repoPath(absolute) === undefined) {
      issues.add(`out-of-root:${path}`);
      return false;
    }
    const segments = relative(root, absolute).split(/[\\/]/).filter(Boolean);
    let current = root;
    for (const segment of segments) {
      current = join(current, segment);
      try {
        if (lstatSync(current).isSymbolicLink()) {
          issues.add(`symlink:${path}`);
          return false;
        }
      } catch {
        issues.add(`unresolved:${path}`);
        return false;
      }
    }
    return true;
  };
  const seal = (path: string): string | undefined => {
    const absolute = resolve(root, path);
    if (!isSafeFile(absolute, path)) return undefined;
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile()) {
        issues.add(`unresolved:${path}`);
        return undefined;
      }
      const bytes = readFileSync(absolute, 'utf8');
      controls.set(path, createHash('sha256').update(bytes, 'utf8').digest('hex'));
      return bytes;
    } catch {
      issues.add(`unresolved:${path}`);
      return undefined;
    }
  };
  const enqueue = (path: string): void => {
    const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized || normalized === '..' || normalized.startsWith('../')) {
      issues.add(`out-of-root:${path}`);
      return;
    }
    queued.add(normalized);
  };
  const isPackageRoot = (directory: string): boolean => {
    if (directory === '.' || directory === '') return true;
    const manifest = join(root, directory, 'package.json');
    try {
      return lstatSync(manifest).isFile() && isSafeFile(manifest, `${directory}/package.json`);
    } catch {
      return false;
    }
  };
  const controlLocation = (path: string): boolean => isPackageRoot(dirname(path).replaceAll('\\', '/'));
  const isCladdingConfig = (path: string): boolean => {
    const suffix = '/.cladding/config.yaml';
    if (path === '.cladding/config.yaml') return true;
    return path.endsWith(suffix) && isPackageRoot(path.slice(0, -suffix.length));
  };
  const isGradleWrapperConfig = (path: string): boolean => {
    const suffix = 'gradle/wrapper/gradle-wrapper.properties';
    if (!path.endsWith(suffix)) return false;
    const directory = path.slice(0, -suffix.length).replace(/\/$/, '');
    return isPackageRoot(directory);
  };
  const knownControl = (path: string): boolean => {
    const name = path.split('/').at(-1)!;
    // A manifest establishes its own nested package boundary. Other basename
    // controls are ambient only at the workspace root or that boundary.
    return name === 'package.json'
      || (allKnownNames.has(name) && controlLocation(path))
      || isCladdingConfig(path)
      || isGradleWrapperConfig(path);
  };
  const configLike = (name: string): boolean =>
    /(?:^|[.-])config(?:[.-]|$)|(?:^|[.-])rc(?:[.-]|$)|^\.[a-z0-9-]+rc(?:\.(?:[cm]?[jt]s|json|ya?ml))?$/i.test(name)
      || /^tsconfig[^/]*\.json$/i.test(name)
      || /(?:^|[._-])workspace(?:[._-]|$)/i.test(name);
  const unknownAmbientControl = (path: string, name: string): boolean => {
    // An unknown top-level config can influence the selected repository
    // runner. Below that boundary, fail closed only for an explicitly
    // runner-named config; ordinary `*-config` source and fixture names have
    // no ambient runner authority without an explicit sealed reference.
    return (!path.includes('/') && configLike(name))
      || (/(?:^|[._-])runner(?:[._-]|$)/i.test(name) && configLike(name));
  };
  const skipDirectory = (path: string, name: string): boolean =>
    EXCLUDED_CONTROL_DIRECTORIES.has(name) || (path.split('/').includes('.cladding') && CLADDING_EXCLUDED_DIRECTORIES.has(name));
  const visitDirectory = (absolute: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absolute, {withFileTypes: true});
    } catch {
      const path = repoPath(absolute) ?? absolute;
      issues.add(`unresolved:${path}`);
      return;
    }
    for (const entry of entries.sort((left, right) => comparePath(left.name, right.name))) {
      const child = join(absolute, entry.name);
      const path = repoPath(child);
      if (path === undefined) {
        issues.add(`out-of-root:${entry.name}`);
        continue;
      }
      let stat;
      try {
        stat = lstatSync(child);
      } catch {
        issues.add(`unresolved:${path}`);
        continue;
      }
      // Installed dependency/build bytes are already excluded; bare packages
      // are manifest/lock-bound. A different symlink rule would split physical
      // and linked installs without sealing either, so ignore them here.
      if (skipDirectory(path, entry.name)) continue;
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        issues.add(`symlink:${path}`);
        continue;
      }
      if (stat.isDirectory()) {
        visitDirectory(child);
        continue;
      }
      if (!stat.isFile()) continue;
      if (knownControl(path)) enqueue(path);
      else if (unknownAmbientControl(path, entry.name)) issues.add(`unknown:${path}`);
    }
  };
  const resolveLocalReference = (from: string, raw: string, kind: 'module' | 'tsconfig'): string | undefined => {
    if (!raw.startsWith('.') && !isAbsolute(raw)) return undefined; // static package imports are manifest/lock-bound.
    const base = resolve(root, dirname(from), raw);
    if (repoPath(base) === undefined) {
      issues.add(`out-of-root:${from}->${raw}`);
      return undefined;
    }
    const candidates = kind === 'tsconfig'
      ? [base, `${base}.json`, join(base, 'tsconfig.json')]
      : [base, ...LOCAL_CONTROL_EXTENSIONS.slice(1).map((extension) => `${base}${extension}`), ...LOCAL_CONTROL_EXTENSIONS.slice(1).map((extension) => join(base, `index${extension}`))];
    for (const candidate of candidates) {
      const path = repoPath(candidate);
      if (path === undefined) continue;
      try {
        // Extensionless local imports and tsconfig extends have several legal
        // candidates. A missing early candidate is normal, not an unresolved
        // control; only an existing unsafe candidate or total miss is fatal.
        const candidateStat = lstatSync(candidate);
        if (!isSafeFile(candidate, path)) return undefined;
        if (candidateStat.isFile()) return path;
      } catch {
        // Keep looking through legal extension candidates.
      }
    }
    issues.add(`unresolved:${from}->${raw}`);
    return undefined;
  };
  const commandName = (value: string | undefined): string | undefined =>
    value?.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.(?:exe|cmd)$/, '');
  const packageExecutionMode = (argv: readonly string[]): boolean => {
    // `command npx`, `corepack npm exec`, and similar wrappers can otherwise
    // turn a prohibited package execution into an apparently generic command.
    // The shell-free argv is already statically tokenized, so inspect every
    // possible nested command marker instead of trusting only argv[0].
    return argv.some((raw, index) => {
      const command = commandName(raw);
      if (command && PACKAGE_EXECUTION_ALIASES.has(command)) return true;
      if (!command || !PACKAGE_MANAGERS.has(command)) return false;
      const nested = argv.slice(index + 1);
      const subcommand = nested.find((value) => value !== '--' && !value.startsWith('-'));
      // A declared `npm run exec` lifecycle is a script named exec, not the
      // package manager's execution mode. Every other occurrence remains
      // conservative: option parsing can carry arbitrary values before exec.
      if (subcommand === 'run' || subcommand === 'run-script') return false;
      return nested.some((value) => PACKAGE_EXECUTION_MODES.has(value));
    });
  };
  const wrappedPackageManagerInvocation = (argv: readonly string[]): boolean =>
    argv.some((raw, index) => {
      if (index === 0 || !PACKAGE_MANAGERS.has(commandName(raw) ?? '')) return false;
      return argv.slice(index + 1).some((value) => value !== '--' && !value.startsWith('-'));
    });
  const staticCommandArgv = (path: string, argv: readonly string[]): boolean => {
    const command = commandName(argv[0]);
    if (!command) {
      issues.add(`malformed-command:${path}`);
      return false;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command)) {
      issues.add(`environment-command:${path}`);
      return false;
    }
    if (command === 'env' || command === 'cross-env') {
      issues.add(`environment-command:${path}`);
      return false;
    }
    // `eslint .` is the one registered root-scan adapter. Its repository-wide
    // scope is sealed by this package script and the complete config census;
    // no other command may make `.` disappear as a harmless argument.
    if (command === 'eslint') {
      if (argv.length === 2 && argv[1] === '.') return true;
      if (argv.length === 2 && argv[1] === '..') issues.add(`out-of-root:${path}->..`);
      else issues.add(`dynamic-command:${path}`);
      return false;
    }
    // Package-manager execution adapters select an arbitrary downloaded or
    // package-local binary. Until an exact adapter can seal that binary and
    // its arguments, no executable closure is available.
    if (packageExecutionMode(argv) || wrappedPackageManagerInvocation(argv)) {
      issues.add(`dynamic-command:${path}`);
      return false;
    }
    // Shell options and script parsing have platform-specific ambient state.
    // A shell entrypoint is never a statically complete runner closure, even
    // when its option is written in a compact spelling such as `bash -lc`.
    if (SHELL_INTERPRETERS.has(command)
      || ['cd', 'source', '.', 'eval', 'exec'].includes(command)
      || (['node', 'nodejs', 'bun', 'deno'].includes(command)
        && argv.some((value) => value === '-e' || value === '--eval' || value === '-p' || value === '--print'))
      // A known interpreter with any option can select preloaders, import
      // hooks, or module mode before its later positional program. Reject it
      // rather than sealing only the first apparent entrypoint.
      || (KNOWN_INTERPRETERS.has(command)
        && argv.slice(1).some((value) => value !== '--' && value.startsWith('-')))
      || (PACKAGE_MANAGERS.has(command)
        && argv.some((value) => value === '--prefix' || value === '--workspace' || value === '--workspaces' || value === '-w'))
      // An unregistered command has no proof that an option is not a path,
      // preload, or alternate config selector. Its ordinary existing file
      // arguments are sealed below; options require a dedicated adapter.
      || (!KNOWN_INTERPRETERS.has(command) && !PACKAGE_MANAGERS.has(command) && command !== 'vitest'
        && argv.slice(1).some((value) => value === '--' || value.startsWith('-')))) {
      issues.add(`dynamic-command:${path}`);
      return false;
    }
    return true;
  };
  const staticCommandChains = (path: string, command: string): readonly (readonly string[])[] | undefined => {
    const chains: string[][] = [];
    let argv: string[] = [];
    let token = '';
    let tokenStarted = false;
    let quote: '\'' | '"' | undefined;
    const fail = (reason: string): undefined => {
      issues.add(`${reason}:${path}`);
      return undefined;
    };
    const pushToken = (): void => {
      if (tokenStarted) argv.push(token);
      token = '';
      tokenStarted = false;
    };
    const pushChain = (): boolean => {
      pushToken();
      if (argv.length === 0) return false;
      chains.push(argv);
      argv = [];
      return true;
    };
    for (let index = 0; index < command.length; index++) {
      const character = command[index]!;
      if (quote) {
        if (character === quote) quote = undefined;
        else {
          if (character === '$' || character === '`') return fail('dynamic-command');
          token += character;
          tokenStarted = true;
        }
        continue;
      }
      if (character === '\'' || character === '"') {
        quote = character;
        tokenStarted = true;
      } else if (character === '{') {
        const moduleToken = /^\{modules:[A-Za-z0-9_.:-]+\}/.exec(command.slice(index));
        if (!moduleToken) return fail('dynamic-command');
        token += moduleToken[0];
        tokenStarted = true;
        index += moduleToken[0].length - 1;
      } else if (/\s/.test(character)) {
        pushToken();
      } else if (character === '&' && command[index + 1] === '&') {
        if (!pushChain()) return fail('malformed-command');
        index++;
      } else if ('|;`$\\<>*?[]!(){}'.includes(character)) {
        return fail('dynamic-command');
      } else {
        token += character;
        tokenStarted = true;
      }
    }
    if (quote || !pushChain()) return fail('malformed-command');
    if (chains.some((chain) => !staticCommandArgv(path, chain))) return undefined;
    return chains;
  };
  const resolveLocalCommandReference = (
    from: string,
    baseDirectory: string,
    raw: string,
    allowBare: boolean = false,
  ): string | undefined => {
    const value = raw.startsWith('--') && raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw;
    if (value === '' || /^\{modules:[A-Za-z0-9_.:-]+\}$/.test(value)) return undefined;
    if (!value.startsWith('.') && !isAbsolute(value) && (!allowBare || value.startsWith('@'))) return undefined;
    const absolute = resolve(root, baseDirectory, value);
    const path = repoPath(absolute);
    if (path === undefined) {
      issues.add(`out-of-root:${from}->${raw}`);
      return undefined;
    }
    if (!isSafeFile(absolute, path)) return undefined;
    try {
      if (!lstatSync(absolute).isFile()) {
        issues.add(`unresolved:${from}->${raw}`);
        return undefined;
      }
    } catch {
      issues.add(`unresolved:${from}->${raw}`);
      return undefined;
    }
    return path;
  };
  const resolveExistingCommandArgument = (
    from: string,
    baseDirectory: string,
    raw: string,
  ): string | undefined => {
    if (raw === '' || raw === '--' || raw.startsWith('-') || raw.startsWith('@') || /^\{modules:[A-Za-z0-9_.:-]+\}$/.test(raw)) {
      return undefined;
    }
    const absolute = resolve(root, baseDirectory, raw);
    const path = repoPath(absolute);
    if (path === undefined) {
      // An existing out-of-root positional argument would otherwise allow an
      // unsealed executable input to affect the runner.
      try {
        lstatSync(absolute);
        issues.add(`out-of-root:${from}->${raw}`);
      } catch {
        // A non-file word such as a test selector is not an input reference.
      }
      return undefined;
    }
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile()) return undefined;
    } catch {
      return undefined;
    }
    return isSafeFile(absolute, path) ? path : undefined;
  };
  const interpreterEntrypoint = (argv: readonly string[]): string | undefined => {
    const command = commandName(argv[0]);
    if (!command || !KNOWN_INTERPRETERS.has(command)) return undefined;
    if (command === 'deno' && argv[1] === 'run') {
      const value = argv.slice(2).find((entry) => entry !== '--' && !entry.startsWith('-'));
      return value;
    }
    return argv.slice(1).find((entry) => entry !== '--' && !entry.startsWith('-'));
  };
  const commandReferences = (from: string, baseDirectory: string, argv: readonly string[]): readonly string[] => {
    const refs = new Set<string>();
    const addReference = (path: string | undefined): void => {
      if (!path) return;
      refs.add(path);
      commandTargets.add(path);
    };
    const command = commandName(argv[0]);
    for (const raw of argv) {
      if (command === 'eslint' && raw === '.') continue;
      addReference(resolveLocalCommandReference(from, baseDirectory, raw));
    }
    // The repository-root Gradle wrapper is a known command adapter, not an
    // arbitrary shell runner. Its exact bytes and the complete Gradle control
    // census are sealed here; module tasks stay bound to D22's compiler scope.
    if (command === 'gradlew') {
      const wrapper = resolveLocalCommandReference(from, baseDirectory, argv[0] ?? '');
      if (wrapper === 'gradlew') staticGradleWrappers.add(wrapper);
    }
    if (command === 'vitest') {
      // This intentionally small adapter covers the local config selector
      // without treating the rest of Vitest's option surface as sealed.
      for (let index = 1; index < argv.length; index++) {
        const raw = argv[index]!;
        if (raw === '--config') {
          const config = argv[++index];
          if (!config || config === '--' || config.startsWith('-')) {
            issues.add(`malformed-command:${from}`);
            continue;
          }
          addReference(resolveLocalCommandReference(from, baseDirectory, config, true));
        } else if (raw.startsWith('--config=')) {
          const config = raw.slice('--config='.length);
          if (config === '') {
            issues.add(`malformed-command:${from}`);
            continue;
          }
          addReference(resolveLocalCommandReference(from, baseDirectory, config, true));
        } else if (raw.startsWith('-') || raw === '--') {
          issues.add(`dynamic-command:${from}`);
        } else {
          addReference(resolveExistingCommandArgument(from, baseDirectory, raw));
        }
      }
    } else if (command && command !== 'eslint' && !KNOWN_INTERPRETERS.has(command) && !PACKAGE_MANAGERS.has(command)) {
      // For an unregistered command, a bare existing local file is still an
      // executable/configuration input. Seal it rather than dropping it just
      // because the command name is not in the adapter registry.
      argv.slice(1).forEach((raw) => addReference(resolveExistingCommandArgument(from, baseDirectory, raw)));
    }
    // `node runner.js` and `python runner.py` address a cwd-relative program
    // even when it contains no slash. Once found, the normal command-target
    // analyzer either follows JS/TS dependencies or fails closed for an
    // interpreter whose program is not statically analyzable.
    const entrypoint = interpreterEntrypoint(argv);
    if (entrypoint) {
      addReference(resolveLocalCommandReference(from, baseDirectory, entrypoint, true));
    }
    return [...refs].sort(comparePath);
  };
  const packageScriptReference = (argv: readonly string[]): string | undefined => {
    const command = commandName(argv[0]);
    if (!command || !PACKAGE_MANAGERS.has(command) || packageExecutionMode(argv)) return undefined;
    const run = argv.findIndex((value) => value === 'run' || value === 'run-script');
    if (run >= 0) {
      const target = argv.slice(run + 1).find((value) => value !== '--' && !value.startsWith('-'));
      if (!target) issues.add(`malformed-package-lifecycle:${command}`);
      return target;
    }
    // `npm start` and every other declared selected script carry the same
    // lifecycle hooks as `npm run <name>`.
    return argv.slice(1).find((value) => value !== '--' && !value.startsWith('-'));
  };
  const packageScriptReferences = (path: string, bytes: string): readonly string[] | undefined => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes);
    } catch {
      issues.add(`malformed:${path}`);
      return undefined;
    }
    const scripts = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as {scripts?: unknown}).scripts
      : undefined;
    if (scripts === undefined) return [];
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
      issues.add(`malformed:${path}`);
      return undefined;
    }
    const declared = new Map(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const selected = new Set<string>();
    const visitedScripts = new Set<string>();
    const visitScript = (name: string): void => {
      if (visitedScripts.has(name)) return;
      visitedScripts.add(name);
      const command = declared.get(name);
      if (command === undefined) {
        issues.add(`unresolved:${path}#scripts.${name}`);
        return;
      }
      const chains = staticCommandChains(`${path}#scripts.${name}`, command);
      if (!chains) return;
      for (const argv of chains) {
        commandReferences(`${path}#scripts.${name}`, dirname(path), argv).forEach((reference) => selected.add(reference));
        const nested = packageScriptReference(argv);
        if (nested) visitScriptLifecycle(nested);
      }
    };
    const visitScriptLifecycle = (name: string): void => {
      // npm-family lifecycle hooks run around every selected script. Missing
      // hooks are normal; the visited set makes nested `run` chains cyclically
      // safe without weakening the closure.
      const hooks = [`pre${name}`, name, `post${name}`];
      if (!hooks.some((hook) => declared.has(hook))) {
        issues.add(`unresolved:${path}#scripts.${name}`);
        return;
      }
      for (const hook of hooks) {
        if (declared.has(hook)) visitScript(hook);
      }
    };
    [...new Set([
      ...[...AUTHORITATIVE_PACKAGE_SCRIPTS].filter((name) => declared.has(name)),
      ...(path === 'package.json' ? gatePackageScripts : []),
    ])].sort(comparePath).forEach(visitScriptLifecycle);
    return [...selected].sort(comparePath);
  };
  const gateCommandReferences = (path: string, bytes: string): readonly string[] | undefined => {
    let parsed: unknown;
    try {
      parsed = parseYaml(bytes);
    } catch {
      issues.add(`malformed:${path}`);
      return undefined;
    }
    const gate = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as {gate?: unknown}).gate
      : undefined;
    if (gate === undefined) return [];
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
      issues.add(`malformed:${path}`);
      return undefined;
    }
    const commands = (gate as {commands?: unknown}).commands;
    if (commands === undefined) return [];
    if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
      issues.add(`malformed:${path}`);
      return undefined;
    }
    const references = new Set<string>();
    for (const key of ['type', 'lint', 'test', 'coverage'] as const) {
      const command = (commands as Partial<Record<typeof key, unknown>>)[key];
      if (command === undefined) continue;
      if (!Array.isArray(command) || !command.every((value) => typeof value === 'string')) {
        issues.add(`malformed:${path}#gate.commands.${key}`);
        continue;
      }
      if (!staticCommandArgv(`${path}#gate.commands.${key}`, command)) continue;
      commandReferences(`${path}#gate.commands.${key}`, '', command).forEach((reference) => references.add(reference));
      const nested = packageScriptReference(command);
      if (nested) gatePackageScripts.add(nested);
    }
    return [...references].sort(comparePath);
  };
  const tsconfigReferences = (path: string, bytes: string): readonly string[] | undefined => {
    try {
      // Parse JSONC as a parenthesized expression so Babel accepts comments,
      // trailing commas, and TypeScript's ordinary unquoted keys. The AST is
      // then restricted back to JSON values; no config expression executes or
      // changes the closure through spreads, computed keys, or calls.
      const program = parse(`(${bytes})`, {sourceType: 'script', plugins: ['typescript']}).program;
      const root = program.body.length === 1 && program.body[0]?.type === 'ExpressionStatement'
        ? program.body[0].expression
        : undefined;
      if (!isJsoncObject(root)) {
        issues.add(`malformed:${path}`);
        return undefined;
      }
      const refs: string[] = [];
      const extended = jsoncProperty(root, 'extends');
      if (extended !== undefined) {
        if (extended.type !== 'StringLiteral' || typeof extended.value !== 'string') {
          issues.add(`malformed:${path}`);
          return undefined;
        }
        refs.push(extended.value);
      }
      const references = jsoncProperty(root, 'references');
      if (references !== undefined) {
        if (references.type !== 'ArrayExpression' || !Array.isArray(references.elements)) {
          issues.add(`malformed:${path}`);
          return undefined;
        }
        for (const reference of references.elements) {
          if (!isJsoncObject(reference)) {
            issues.add(`malformed:${path}`);
            return undefined;
          }
          const referencePath = jsoncProperty(reference, 'path');
          if (referencePath?.type !== 'StringLiteral' || typeof referencePath.value !== 'string') {
            issues.add(`malformed:${path}`);
            return undefined;
          }
          refs.push(referencePath.value);
        }
      }
      return refs;
    } catch {
      issues.add(`malformed:${path}`);
      return undefined;
    }
  };
  const staticModuleReferences = (path: string, bytes: string): readonly string[] | undefined => {
    try {
      const file = parse(bytes, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
      const refs: string[] = [];
      let dynamic = false;
      let ambientRuntime = false;
      let runtimeRead = false;
      let unsupportedModuleLoader = false;
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const value = node as {
          readonly type?: string;
          readonly name?: string;
          readonly source?: {readonly type?: string; readonly value?: unknown};
          readonly callee?: {readonly type?: string; readonly name?: string; readonly object?: {readonly type?: string; readonly name?: string}; readonly property?: {readonly type?: string; readonly name?: string}};
          readonly object?: {readonly type?: string; readonly name?: string; readonly object?: {readonly type?: string; readonly name?: string}; readonly property?: {readonly type?: string; readonly name?: string; readonly value?: unknown}};
          readonly property?: {readonly type?: string; readonly name?: string; readonly value?: unknown};
          readonly meta?: {readonly type?: string; readonly name?: string};
          readonly arguments?: readonly {readonly type?: string; readonly value?: unknown}[];
        };
        if (value.type === 'Identifier'
          && (value.name === 'process' || value.name === 'Bun' || value.name === 'Deno' || value.name === 'globalThis')) ambientRuntime = true;
        if (value.type === 'MetaProperty' && value.meta?.name === 'import'
          && value.property?.name === 'meta') ambientRuntime = true;
        if ((value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression')
          && value.object?.type === 'Identifier' && value.object.name === 'module'
          && value.property?.type === 'Identifier' && value.property.name === 'require') unsupportedModuleLoader = true;
        if ((value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression')
          && value.object?.type === 'Identifier'
          && (value.object.name === 'process' || value.object.name === 'Bun' || value.object.name === 'Deno')
          && ((value.property?.type === 'Identifier' && value.property.name === 'env') || value.property?.value === 'env')) ambientRuntime = true;
        if ((value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression')
          && value.object?.type === 'MemberExpression'
          && value.object.object?.type === 'Identifier'
          && (value.object.object.name === 'process' || value.object.object.name === 'Bun')
          && ((value.object.property?.type === 'Identifier' && value.object.property.name === 'env') || value.object.property?.value === 'env')) ambientRuntime = true;
        if ((value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression')
          && value.object?.type === 'MetaProperty'
          && value.property?.type === 'Identifier'
          && value.property.name === 'env') ambientRuntime = true;
        if (value.type === 'CallExpression'
          && ((value.callee?.type === 'Identifier' && RUNTIME_FILE_READS.has(value.callee.name ?? ''))
            || ((value.callee?.type === 'MemberExpression' || value.callee?.type === 'OptionalMemberExpression')
              && RUNTIME_FILE_READS.has(value.callee.property?.name ?? '')))) runtimeRead = true;
        if (value.type === 'ImportDeclaration' || value.type === 'ExportNamedDeclaration' || value.type === 'ExportAllDeclaration') {
          if (typeof value.source?.value === 'string') {
            refs.push(value.source.value);
            if (BUILTIN_FILESYSTEM_MODULES.has(value.source.value)) runtimeRead = true;
            if (BUILTIN_PROCESS_MODULES.has(value.source.value)) ambientRuntime = true;
            if (BUILTIN_MODULE_LOADER_MODULES.has(value.source.value)) unsupportedModuleLoader = true;
          }
        } else if (value.type === 'ImportExpression' || (value.type === 'CallExpression' && value.callee?.type === 'Import')) {
          dynamic = true;
        } else if (value.type === 'CallExpression' && isRequireCall(value.callee)) {
          const argument = value.arguments?.[0];
          if (argument?.type === 'StringLiteral' && typeof argument.value === 'string') {
            refs.push(argument.value);
            if (BUILTIN_FILESYSTEM_MODULES.has(argument.value)) runtimeRead = true;
            if (BUILTIN_PROCESS_MODULES.has(argument.value)) ambientRuntime = true;
            if (BUILTIN_MODULE_LOADER_MODULES.has(argument.value)) unsupportedModuleLoader = true;
          }
          else dynamic = true;
        }
        for (const child of Object.values(node as Record<string, unknown>)) {
          if (child && typeof child === 'object') {
            if (Array.isArray(child)) child.forEach(visit);
            else visit(child);
          }
        }
      };
      visit(file);
      if (ambientRuntime) {
        issues.add(`ambient-runtime:${path}`);
        return undefined;
      }
      if (dynamic) {
        issues.add(`dynamic:${path}`);
        return undefined;
      }
      if (runtimeRead) {
        issues.add(`runtime-read:${path}`);
        return undefined;
      }
      if (unsupportedModuleLoader) {
        issues.add(`module-loader:${path}`);
        return undefined;
      }
      return refs;
    } catch {
      issues.add(`malformed:${path}`);
      return undefined;
    }
  };

  try {
    if (lstatSync(root).isSymbolicLink()) issues.add('symlink:.');
    else visitDirectory(root);
  } catch {
    issues.add('unresolved:.');
  }
  while (queued.size > 0) {
    const path = [...queued].sort(comparePath)[0]!;
    queued.delete(path);
    if (visited.has(path)) continue;
    visited.add(path);
    const bytes = seal(path);
    if (bytes === undefined) continue;
    if (commandTargets.has(path)
      && !staticGradleWrappers.has(path)
      && !CONTROL_SCRIPT_EXTENSIONS.has(extname(path).toLowerCase())) {
      // A direct command target outside the statically analyzable JS/TS set
      // can select arbitrary local dependencies. Its own bytes are sealed,
      // but that is not a complete runner closure.
      issues.add(`unresolved-runner:${path}`);
      continue;
    }
    if (path === '.cladding/config.yaml') {
      for (const reference of gateCommandReferences(path, bytes) ?? []) enqueue(reference);
    } else if (path.split('/').at(-1) === 'package.json') {
      for (const reference of packageScriptReferences(path, bytes) ?? []) enqueue(reference);
    }
    if (/^tsconfig[^/]*\.json$/i.test(path.split('/').at(-1)!)) {
      for (const raw of tsconfigReferences(path, bytes) ?? []) {
        const resolved = resolveLocalReference(path, raw, 'tsconfig');
        if (resolved) enqueue(resolved);
      }
    } else if (CONTROL_SCRIPT_EXTENSIONS.has(extname(path).toLowerCase())) {
      for (const raw of staticModuleReferences(path, bytes) ?? []) {
        const resolved = resolveLocalReference(path, raw, 'module');
        if (resolved) enqueue(resolved);
      }
    }
  }
  const sortedControls = Object.fromEntries([...controls.entries()].sort(([left], [right]) => comparePath(left, right)));
  const unknown = [...issues].sort(comparePath);
  return {controls: Object.freeze(sortedControls), unknown: Object.freeze(unknown), complete: unknown.length === 0};
}

function isRequireCall(callee: {readonly type?: string; readonly name?: string; readonly object?: {readonly type?: string; readonly name?: string}; readonly property?: {readonly type?: string; readonly name?: string}} | undefined): boolean {
  if (callee?.type === 'Identifier') return callee.name === 'require';
  return callee?.type === 'MemberExpression'
    && callee.property?.type === 'Identifier'
    && ((callee.object?.type === 'Identifier' && callee.object.name === 'require' && callee.property.name === 'resolve')
      || (callee.object?.type === 'Identifier' && callee.object.name === 'module' && callee.property.name === 'require'));
}

/** Parses only an opaque current-run JUnit payload, never a workspace path. */
function currentJUnitReport(bytes: string): JUnitReport | undefined {
  try {
    return parseJUnitReport(bytes);
  } catch {
    return undefined;
  }
}

function hasExactSelector(selector: string | undefined): selector is string {
  return typeof selector === 'string' && selector.length > 0;
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
