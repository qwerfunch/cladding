// Cladding · verification attestation (F-a5228c; v2 encoding F-b0f898a6)
//
// "When was this tree last actually verified, and has shipped code changed
// since?" — the question the harness could not answer. The first design
// keyed it off the gitignored local events ledger: undefined on fresh
// clones/CI, broken by squash/rebase. This anchors on COMMITTED CONTENT
// instead: a Tier-C file written only by a GREEN strict verification run.
// Clone-portable, history-rewrite-immune.
//
// v2 (F-b0f898a6) splits the record into two sections so parallel work stops
// colliding: v1 keyed each done feature to ONE hash over ALL its module bytes,
// so a single shared-file edit rewrote every co-owner's line (the #1 merge
// surface in parallel work). v2 keys hashes to module FILES and marks features
// with a constant token — editing a file moves exactly its own line. The
// reader accepts both formats; adopters cross over on their next GREEN gate.

import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import yaml from 'yaml';

import {
  attestationProfileSha256,
  attestationV3RetentionState,
  isAuthoritativeAttestationV3,
  type AttestationV3,
  type AttestationV3RetentionContext,
  type AuthoritativeAttestationV3,
  type MigrationBaselineAttestationSummary,
} from '../assurance/attestation.js';
import {
  assuranceClosureInputFromWorkspace,
  effectiveFeatureScope,
  featureClosureSeals,
  hasApplicableSchema02TestCriteria,
  runnerConfigurationResolver,
  workspaceProfileSnapshot,
  type RunnerConfigurationResolver,
} from '../assurance/workspace.js';
import {canonicalClosureJson} from '../assurance/closures.js';
import {assuranceProfile} from '../assurance/kernel.js';
import {compareCodeUnits, OBLIGATION_DESCRIPTORS} from '../assurance/registry.js';
import {requiredOracleWorklist} from '../oracle/policy.js';
import {safeProofWorkspacePath} from '../proof/fs-safety.js';
import {
  parsePortableReceiptYaml,
  receiptDigest,
  receiptFeatureId,
  serializePortableReceipt,
  type ReceiptExpectedDigestContext,
} from '../proof/receipt.js';
import type {Feature, Spec} from './types.js';
import {
  commitGeneratedAttestation,
  SpecEditError,
  type GeneratedAttestationCompletion,
  type GeneratedAttestationCompletionTarget,
} from './edit.js';
import {loadSpec, loadSpecFromDiskUnlocked} from './load.js';
import {compileSpecWorkspaceWithLockHeld} from './compiler/compile.js';
import {prospectiveDoneCompilation, prospectiveDoneSpec} from './prospective.js';

const ATTESTATION_PATH = ['spec', 'attestation.yaml'] as const;

/**
 * Identity of the verification policy that earned an attestation.
 *
 * @see spec/features/attestation-policy-stamp-caff8598.yaml AC-a4d41de9
 * @since 0.9.4
 */
export interface AttestationPolicy {
  /** Running Cladding engine version, or `unknown` if its manifest was unavailable. */
  readonly cladding: string;
  /** Gate policy that promoted warnings and required the full verification ladder. */
  readonly blocking: 'strict';
  /** Full SHA-256 over the ordered detector catalog identity. */
  readonly detectorsSha256: string;
}

/**
 * Fingerprints the ordered detector catalog without serializing functions.
 *
 * The Cladding version identifies implementation bytes; this digest identifies
 * which stable names, order, and subprocess classes were registered.
 *
 * @param detectors - Ordered detector identities from the live registry.
 * @returns A deterministic lowercase, 64-character SHA-256 digest.
 * @throws Never for string names and boolean subprocess flags.
 * @example
 * ```ts
 * detectorCatalogSha256([{name: 'STATUS_DRIFT'}]);
 * ```
 * @see spec/features/attestation-policy-stamp-caff8598.yaml AC-1f6b157b
 * @since 0.9.4
 */
export function detectorCatalogSha256(
  detectors: readonly {readonly name: string; readonly subprocess?: true}[],
): string {
  const hash = createHash('sha256');
  detectors.forEach((detector, index) => {
    hash.update(`${index}\u0000${detector.name}\u0000${detector.subprocess === true ? 'subprocess' : 'pure'}\n`);
  });
  return hash.digest('hex');
}

/** sha256 over a done feature's modules: sorted path + file bytes per entry.
 * A missing module file hashes as absent (the MISSING_IMPLEMENTATION
 * detector owns that error; the hash just has to be deterministic). The v1
 * per-feature key; kept for reading v1 files and any external callers. */
export function moduleTreeHash(cwd: string, modules: readonly string[]): string {
  const h = createHash('sha256');
  for (const m of [...modules].sort()) {
    h.update(m);
    h.update('\u0000');
    try {
      h.update(readFileSync(join(cwd, m)));
    } catch {
      h.update('<absent>');
    }
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 16);
}

/** sha256 of ONE module file's bytes (v2). A missing file hashes the
 * '<absent>' sentinel exactly like {@link moduleTreeHash} — deterministic;
 * the MISSING_IMPLEMENTATION detector owns the error. */
export function moduleFileHash(cwd: string, path: string): string {
  const h = createHash('sha256');
  try {
    h.update(readFileSync(join(cwd, path)));
  } catch {
    h.update('<absent>');
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * The parsed attestation file. Each section is `null` when its header is
 * absent, so a caller can tell a v1 file (only `v1`), a v2 file (`modules` +
 * `features`), and a union-merge Frankenstein (all present) apart. A whole
 * absent FILE is signalled by {@link readAttestation} returning `null`.
 */
export interface AttestationFile {
  /** v2.1+ verification-policy identity; null for legacy attestations. */
  readonly policy: AttestationPolicy | null;
  /** v1 `attested:` section — feature id → module tree-hash. */
  readonly v1: Map<string, string> | null;
  /** v2 `attested_modules:` section — module path → file hash. */
  readonly modules: Map<string, string> | null;
  /** v2 `attested_features:` section — the set of marked done features. */
  readonly features: Set<string> | null;
  /** v3 feature closure seals.  Their presence takes precedence for F6 readers. */
  readonly v3: Map<string, AttestationV3> | null;
  /** Every v3 feature key observed on disk, including malformed rows. */
  readonly v3ObservedFeatures?: ReadonlySet<string> | null;
}

/**
 * Immutable source preimage captured before a gate starts.  The generated
 * index and this attestation are intentionally excluded: neither is a gate
 * input and both may be refreshed by the transaction boundary itself.
 */
export interface AttestationInputSnapshot {
  readonly spec: Spec;
  readonly sourceFiles: readonly {readonly path: string; readonly bytes: string}[];
  /**
   * In-memory D17/profile seal captured before a schema 0.2 gate.  The
   * callback re-reads the exact compiler/F5 closure inputs under the F4 writer
   * lock, so source, tests, modules, config, or receipts cannot be stamped if
   * they moved after observations were collected.  It is deliberately not
   * persisted in attestation.yaml.
   */
  readonly runtime?: {
    readonly inputSha256: string;
    readonly complete: boolean;
    readonly matchesCurrent: () => boolean;
  };
}

/** Writer selection supplied by the schema-aware gate boundary. */
export interface AttestationWriteOptions {
  /**
   * Emit `attested_features: F: ok` rows even when a v3 row replaces that
   * feature. Schema 0.1 leaves this at the historical default. Schema 0.2
   * always retains the v2 module map and replaces only its v3 feature marker.
   */
  readonly writeLegacy?: boolean;
  /** Schema-0.2 prospective target published with this receipt under the F4 lock. */
  readonly completion?: GeneratedAttestationCompletion;
  /**
   * Assurance-owned current receipt/trust authority used only to re-evaluate
   * parsed sibling rows inside the F4 lock.  Missing or forged context causes
   * retention to fail closed; it never affects newly earned branded rows.
   */
  readonly retention?: AttestationV3RetentionContext;
}

/** Captures every spec source file that can affect an attestation closure. */
export function captureAttestationInputSnapshot(cwd: string, spec: Spec = loadSpec(cwd)): AttestationInputSnapshot {
  const paths = ['spec.yaml', ...attestationSourcePaths(cwd)].sort();
  return Object.freeze({
    spec,
    sourceFiles: Object.freeze(paths.map((path) => ({path, bytes: readFileSync(join(cwd, path), 'utf8')}))),
  });
}

/** Reads the committed attestation, section-aware, accepting v1 and v2 (and a
 * Frankenstein carrying both — every section present is parsed, duplicate
 * lines last-win). Returns `null` only when the file is absent (verification
 * state unknown — never a blanket failure). */
export function readAttestation(cwd: string): AttestationFile | null {
  const path = join(cwd, ...ATTESTATION_PATH);
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let v1: Map<string, string> | null = null;
  let modules: Map<string, string> | null = null;
  let features: Set<string> | null = null;
  let v3: Map<string, AttestationV3> | null = null;
  let v3ObservedFeatures: Set<string> | null = null;
  const policyFields: {cladding?: string; blocking?: 'strict'; detectorsSha256?: string} = {};
  let section: 'policy' | 'v1' | 'modules' | 'features' | 'v3' | 'other' = 'other';
  for (const line of text.split('\n')) {
    if (line === 'policy:') {
      section = 'policy';
      continue;
    }
    if (line === 'attested:') {
      section = 'v1';
      v1 ??= new Map();
      continue;
    }
    if (line === 'attested_modules:') {
      section = 'modules';
      modules ??= new Map();
      continue;
    }
    if (line === 'attested_features:') {
      section = 'features';
      features ??= new Set();
      continue;
    }
    if (line === 'attested_v3:') {
      section = 'v3';
      v3 ??= new Map();
      v3ObservedFeatures ??= new Set();
      continue;
    }
    if (line.startsWith('#') || line.trim() === '') continue;
    if (section === 'policy') {
      const cladding = line.match(/^ {2}cladding: "([^"]+)"$/);
      const blocking = line.match(/^ {2}blocking: (strict)$/);
      const detectors = line.match(/^ {2}detectors_sha256: ([0-9a-f]{64})$/);
      if (cladding) policyFields.cladding = cladding[1];
      if (blocking) policyFields.blocking = blocking[1] as 'strict';
      if (detectors) policyFields.detectorsSha256 = detectors[1];
    } else if (section === 'v1') {
      const m = line.match(/^ {2}(F-[\w-]+): ([0-9a-f]{16})$/);
      if (m) v1!.set(m[1], m[2]);
    } else if (section === 'modules') {
      const m = line.match(/^ {2}(.+): ([0-9a-f]{16})$/);
      if (m) modules!.set(m[1], m[2]);
    } else if (section === 'features') {
      const m = line.match(/^ {2}(F-[\w-]+): ok$/);
      if (m) features!.add(m[1]);
    } else if (section === 'v3') {
      const observed = line.match(/^ {2}(F-[\w-]+):(?: .*)?$/);
      if (observed) {
        v3ObservedFeatures!.add(observed[1]);
        // YAML mapping semantics are last-key-wins.  Remove a preceding valid
        // row before parsing this occurrence so a later malformed duplicate
        // cannot retain either v3 authority or a legacy fallback.
        v3!.delete(observed[1]);
      }
      const m = line.match(/^ {2}(F-[\w-]+): (.+)$/);
      if (!m) continue;
      try {
        const candidate = normalizeAttestationV3(JSON.parse(m[2]), m[1]);
        if (candidate) v3!.set(m[1], candidate);
      } catch {
        // An invalid v3 entry cannot become a partial fresh attestation.
      }
    }
  }
  const policy =
    policyFields.cladding !== undefined &&
    policyFields.blocking === 'strict' &&
    policyFields.detectorsSha256 !== undefined
      ? {
          cladding: policyFields.cladding,
          blocking: policyFields.blocking,
          detectorsSha256: policyFields.detectorsSha256,
        }
      : null;
  return {policy, v1, modules, features, v3, v3ObservedFeatures};
}

/** How many features an attestation vouches for — v2 markers when present,
 * else v1 entries. The count `doctor`/`report` surface as "N feature(s)
 * stamped". */
export function attestedFeatureCount(att: AttestationFile): number {
  if (att.v3 !== null || att.features !== null) {
    return new Set([
      ...(att.v3 ? [...att.v3.keys()] : []),
      ...(att.features ? [...att.features] : []),
    ]).size;
  }
  return att.v1?.size ?? 0;
}

/** Freshness of one done feature against an attestation. The single verdict
 * both STALE_ATTESTATION and the Integrity Panel consume. Never throws.
 *
 *   fresh       — v2: marker present AND every module's current file-hash
 *                 matches; v1: the recorded tree-hash matches.
 *   stale       — a module drifted (v2 names the first mismatching `module`;
 *                 v1 has no per-module resolution so `module` is omitted).
 *   unattested  — the feature has no marker (v2) / no entry (v1): its code
 *                 was never verified by an attested gate.
 *
 * v2 wins whenever the file carries v2 sections; a pure v1 file keeps its
 * pre-change verdicts. */
export function featureAttestation(
  att: AttestationFile,
  cwd: string,
  feature: Feature,
): {state: 'fresh'} | {state: 'stale'; module?: string} | {state: 'unattested'} {
  const modules = feature.modules ?? [];
  if (att.modules !== null || att.features !== null) {
    // v2 path.
    if (!att.features?.has(feature.id)) return {state: 'unattested'};
    const stamped = att.modules ?? new Map<string, string>();
    for (const m of [...modules].sort()) {
      if (stamped.get(m) !== moduleFileHash(cwd, m)) return {state: 'stale', module: m};
    }
    return {state: 'fresh'};
  }
  // v1 path — previous behavior: tree-hash compare; missing entry = unattested.
  const recorded = att.v1?.get(feature.id);
  if (recorded === undefined) return {state: 'unattested'};
  return recorded === moduleTreeHash(cwd, modules) ? {state: 'fresh'} : {state: 'stale'};
}

/**
 * Compares a v3 feature seal against the exact fresh closure identities.
 * Callers that lack any expected seal must not use this as a freshness claim.
 */
export function featureAttestationV3(
  att: AttestationFile,
  featureId: string,
  expected: Pick<AttestationV3,
    | 'profile'
    | 'configured_assurance_level'
    | 'achieved_assurance_level'
    | 'scope_sha256'
    | 'input_sha256'
    | 'contract_sha256'
    | 'subject_sha256'
    | 'verification_sha256'
    | 'runtime_dependency_sha256'
    | 'profile_sha256'
    | 'obligation_sha256'
    | 'registry_sha256'
    | 'detector_catalog_sha256'
    | 'tool_identity'
    | 'environment_class'
    | 'trust_snapshot_sha256'
    | 'migration_baseline'
  >,
): {state: 'fresh'} | {state: 'stale'; field: string} | {state: 'unattested'} {
  const entry = att.v3?.get(featureId);
  if (!entry) return {state: 'unattested'};
  for (const field of [
    'profile', 'configured_assurance_level', 'achieved_assurance_level', 'scope_sha256', 'input_sha256',
    'contract_sha256', 'subject_sha256', 'verification_sha256', 'runtime_dependency_sha256', 'profile_sha256',
    'obligation_sha256', 'registry_sha256', 'detector_catalog_sha256', 'tool_identity', 'environment_class',
    'trust_snapshot_sha256', 'migration_baseline',
  ] as const) {
    if (field === 'migration_baseline'
      ? !sameMigrationBaselineSummary(entry.migration_baseline, expected.migration_baseline)
      : entry[field] !== expected[field]) return {state: 'stale', field};
  }
  return {state: 'fresh'};
}

/**
 * Rechecks the D17 closure portion of a v3 row for the pre-gate drift reader.
 * Full policy/registry/profile comparison stays with the authoritative F6
 * profile reducer, which is the only boundary that can calculate those seals.
 */
export function featureAttestationV3Closure(
  att: AttestationFile,
  featureId: string,
  expected: Pick<AttestationV3, 'contract_sha256' | 'subject_sha256' | 'verification_sha256' | 'runtime_dependency_sha256'>,
): {state: 'fresh'} | {state: 'stale'; field: string} | {state: 'unattested'} {
  const entry = att.v3?.get(featureId);
  if (!entry) return {state: 'unattested'};
  for (const field of ['contract_sha256', 'subject_sha256', 'verification_sha256', 'runtime_dependency_sha256'] as const) {
    if (entry[field] !== expected[field]) return {state: 'stale', field};
  }
  return {state: 'fresh'};
}

const HEADER =
  '# Cladding · Tier C — verification attestation. Legacy module rows retain byte compatibility;\n' +
  '# schema 0.1 feature rows need a GREEN strict pre-push gate; v3 replaces a schema 0.2 feature row only after an authoritative profile-complete GREEN result.\n' +
  '# Do not edit by hand.\n' +
  '#\n' +
  '#   policy:             verifier identity: Cladding version, strict blocking,\n' +
  '#                       and SHA-256 of the ordered detector catalog.\n' +
  '#   attested_modules:  one line per module file across all done features,\n' +
  '#                      value = sha256 of that file\'s bytes (16 hex). Editing a\n' +
  '#                      file moves exactly its own line — not every co-owning\n' +
  '#                      feature\'s — so parallel work rarely conflicts here.\n' +
  '#   attested_features: legacy constant `ok` markers for done features not\n' +
  '#                      replaced by a v3 row. STALE_ATTESTATION reads the v3\n' +
  '#                      closure seal first, otherwise this marker + modules.\n' +
  '#\n' +
  '# Merge conflict here? NEVER hand-resolve the hashes — keep either side and run\n' +
  '# `clad check --tier=pre-push --strict`; the GREEN gate rewrites the truth.\n' +
  '# Content-anchored: survives fresh clones and squash/rebase.\n';

/**
 * Writes the v2 attestation for every done feature with modules.
 *
 * Only a GREEN strict verification run supplies a policy and calls this in
 * production. Output is whole-file, sorted, LF, and deterministic.
 *
 * @param cwd - Project root containing the attested modules and `spec/`.
 * @param spec - Loaded project spec whose done features will be stamped.
 * @param policy - Optional verifier identity; omitted only for legacy-compatible callers.
 * @returns False without writing when no done feature has modules; otherwise true.
 * @throws When the canonical attestation file cannot be written.
 * @example
 * ```ts
 * writeAttestation('/workspace', spec, policy);
 * ```
 * @see spec/features/attestation-policy-stamp-caff8598.yaml AC-a4d41de9
 * @since 0.9.4
 */
export function writeAttestation(
  cwd: string,
  spec: Spec,
  policy?: AttestationPolicy,
  v3?: readonly AuthoritativeAttestationV3[],
  snapshot?: AttestationInputSnapshot,
  options: AttestationWriteOptions = {},
): boolean {
  const writeLegacy = options.writeLegacy !== false;
  if (v3?.some((entry) => !isAuthoritativeAttestationV3(entry))) {
    throw new SpecEditError('INVALID_OPERATION', 'Attestation v3 rows must come from a complete authoritative profile verdict.');
  }
  // Completion is never a best-effort receipt refresh: the final F4 writer
  // must recheck the source preimages and the compiled verification closure
  // that the gate observed.  Ordinary refreshes retain their legacy optional
  // snapshot API, but a prospective done target may not use that escape hatch.
  if (options.completion !== undefined && (snapshot === undefined || snapshot.runtime === undefined)) {
    throw new SpecEditError('STALE_INPUT', 'A completion receipt needs its captured verification-input snapshot.');
  }
  const done = (spec.features ?? []).filter((f) => f.status === 'done' && (f.modules ?? []).length > 0);
  // V3 seals can authoritatively bind a feature that owns no runtime module
  // (for example a contract-only migration).  Keep the established v1/v2
  // no-op when neither legacy rows nor an eligible F6 payload exists.
  if (done.length === 0 && (v3?.length ?? 0) === 0) return false;

  const rootPath = join(cwd, 'spec.yaml');
  const attestationPath = join(cwd, ...ATTESTATION_PATH);
  if (!existsSync(rootPath)) {
    throw new SpecEditError('INVALID_OPERATION', 'An initialized specification needs spec.yaml with an exact supported schema before writing an attestation.');
  }
  // `null` is an exact preimage meaning "the attestation was absent", not a
  // missing optional value.  Do not use `??` here: doing so would accept an
  // attestation another writer created after a completion gate began.
  const rootBefore = options.completion === undefined
    ? readFileSync(rootPath, 'utf8')
    : options.completion.rootBefore;
  const attestationBefore = options.completion === undefined
    ? (existsSync(attestationPath) ? readFileSync(attestationPath, 'utf8') : null)
    : options.completion.attestationBefore;
  commitGeneratedAttestation(cwd, rootBefore, attestationBefore, (completionTarget) => {
    // Completion intentionally holds an in-memory `done` view while disk
    // still contains the original in_progress shard. Its byte snapshots and
    // runtime closure must still match; only that status delta is allowed.
    if (snapshot && (!attestationInputSnapshotMatches(cwd, snapshot, options.completion !== undefined)
      || (options.completion === undefined && !sameSpecSnapshot(snapshot.spec, spec)))) {
      throw new SpecEditError('STALE_INPUT', 'A sealed verification input changed while the gate was running.');
    }
    const current = completionTarget === undefined
      ? loadCurrentSpecForAttestation(cwd)
      : prospectiveCompletionSpec(cwd, completionTarget);
    if (completionTarget === undefined && !sameSpecSnapshot(current, spec)) {
      throw new SpecEditError('STALE_INPUT', 'The specification changed after the verification gate snapshot.');
    }
    if (completionTarget !== undefined) {
      if (!sameSpecSnapshot(current, spec)) {
        throw new SpecEditError('INVALID_OPERATION', 'The completion receipt Spec does not match its locked replacement target.');
      }
      validateProspectiveCompletionCompiler(cwd, completionTarget);
      validateCompletionAttestationPayload(v3, snapshot!, completionTarget);
    }
    const prior = readAttestation(cwd);
    const merged = mergeCurrentV3(cwd, current, prior, v3, options.retention, options.completion);
    const rendered = renderAttestation(cwd, current, policy, merged.entries, writeLegacy, merged.suppressedLegacyFeatures);
    // A cooperative writer cannot interleave while this F4 lock is held, but
    // renderAttestation hashes live module bytes. Recheck after that work so a
    // hostile pathname replacement cannot commit a mixed rendered snapshot.
    if (snapshot && (!attestationInputSnapshotMatches(cwd, snapshot, options.completion !== undefined)
      || (options.completion === undefined && !sameSpecSnapshot(snapshot.spec, spec)))) {
      throw new SpecEditError('STALE_INPUT', 'A sealed verification input changed while the attestation was being rendered.');
    }
    return rendered;
  }, options.completion);
  return true;
}

/**
 * Replaces only rows this gate newly earned.  A parsed sibling is not authority:
 * every old v3 row is re-evaluated against the locked current compiler/trust
 * view before it can remain.  The persisted format cannot invert arbitrary
 * historical scope or stronger one-run profile levels, so those rows fail
 * closed instead of being guessed fresh.
 */
function mergeCurrentV3(
  cwd: string,
  spec: Spec,
  prior: AttestationFile | null,
  replacements: readonly AttestationV3[] | undefined,
  retention: AttestationV3RetentionContext | undefined,
  completion: GeneratedAttestationCompletion | undefined,
): {readonly entries: readonly AttestationV3[] | undefined; readonly suppressedLegacyFeatures: ReadonlySet<string>} {
  if (replacements === undefined) return {entries: undefined, suppressedLegacyFeatures: new Set()};
  const replacementFeatures = new Set(replacements.map((entry) => entry.feature));
  const currentDone = new Set((spec.features ?? []).filter((feature) => feature.status === 'done').map((feature) => feature.id));
  const rejected = new Set<string>();
  const state = attestationV3RetentionState(retention);
  const evaluator = state && retentionMatchesReplacements(state, replacements)
    ? currentSiblingV3Evaluator(cwd, spec, state, completion)
    : undefined;
  for (const feature of prior?.v3ObservedFeatures ?? []) {
    if (!replacementFeatures.has(feature) && !prior?.v3?.has(feature)) rejected.add(feature);
  }
  const retained = [...(prior?.v3?.values() ?? [])].flatMap((entry) => {
    if (replacementFeatures.has(entry.feature)) return [];
    let retain = false;
    try {
      retain = currentDone.has(entry.feature) && evaluator !== undefined && isCurrentSiblingV3(entry, evaluator);
    } catch {
      // A malformed old row or an unexpected feature-local filesystem failure
      // is an unknown eligibility fact, never an excuse to keep authority.
      retain = false;
    }
    if (!retain) {
      rejected.add(entry.feature);
      return [];
    }
    return [entry];
  });
  return {
    entries: [...retained, ...replacements].sort((left, right) => left.feature < right.feature ? -1 : left.feature > right.feature ? 1 : 0),
    // A v3 row that was considered and rejected must not silently regain a
    // legacy `ok` marker.  This set contains no legacy-only siblings.
    suppressedLegacyFeatures: rejected,
  };
}

/** Rejects a context from another gate, even when it has genuine private provenance. */
function retentionMatchesReplacements(
  state: NonNullable<ReturnType<typeof attestationV3RetentionState>>,
  replacements: readonly AttestationV3[],
): boolean {
  const keys = [
    'configured_assurance_level', 'registry_sha256', 'detector_catalog_sha256',
    'tool_identity', 'environment_class', 'trust_snapshot_sha256',
  ] as const;
  return state.current.trust_snapshot_sha256 === state.receiptContext.trustSnapshot.digest
    && replacements.every((entry) => keys.every((key) => entry[key] === state.current[key]));
}

/**
 * Re-evaluates one old v3 sibling from live files while the F4 lock is held.
 * Receipt candidates are re-parsed/re-verified by the F5 adapter in
 * `assuranceClosureInputFromWorkspace`; old JSON and a caller callback cannot
 * supply a yes/no eligibility result.
 */
interface CurrentSiblingV3Evaluator {
  readonly cwd: string;
  readonly spec: Spec;
  readonly state: NonNullable<ReturnType<typeof attestationV3RetentionState>>;
  readonly configured: 'L1' | 'L2' | 'L3' | 'L4';
  readonly compilation: ReturnType<typeof currentCompilationForV3Retention>;
  readonly closureInput: ReturnType<typeof assuranceClosureInputFromWorkspace>;
  readonly receiptContext: NonNullable<ReturnType<typeof attestationV3RetentionState>>['receiptContext'];
  readonly registrySha256: string;
  readonly controlResolver: RunnerConfigurationResolver;
  readonly profiles: Map<string, {
    readonly profile: ReturnType<typeof assuranceProfile>;
    readonly scope: ReturnType<typeof effectiveFeatureScope>;
    readonly snapshot: ReturnType<typeof workspaceProfileSnapshot>;
  } | undefined>;
}

/** Captures every filesystem-dependent retention input once under the F4 lock. */
function currentSiblingV3Evaluator(
  cwd: string,
  spec: Spec,
  state: NonNullable<ReturnType<typeof attestationV3RetentionState>>,
  completion: GeneratedAttestationCompletion | undefined,
): CurrentSiblingV3Evaluator | undefined {
  try {
    const compilation = currentCompilationForV3Retention(cwd, completion);
    if (compilation.schemaVersion !== '0.2' || !compilation.contract) return undefined;
    const configured = compilation.contract.project.assuranceLevel ?? 'L2';
    const receiptContext = lockHeldReceiptContext(cwd, state.receiptContext);
    if (!receiptContext) return undefined;
    const controlResolver = runnerConfigurationResolver(cwd);
    const closureInput = assuranceClosureInputFromWorkspace(cwd, compilation, receiptContext, spec, controlResolver);
    const registrySha256 = createHash('sha256').update(canonicalClosureJson(OBLIGATION_DESCRIPTORS), 'utf8').digest('hex');
    return {
      cwd,
      spec,
      state,
      configured,
      compilation,
      closureInput,
      receiptContext,
      registrySha256,
      controlResolver,
      profiles: new Map(),
    };
  } catch {
    return undefined;
  }
}

/** Applies one parsed row to the shared lock-held evaluator snapshot. */
function isCurrentSiblingV3(entry: AttestationV3, evaluator: CurrentSiblingV3Evaluator): boolean {
  const {state, configured} = evaluator;
  // v3 records its configured and achieved levels, but not the transient
  // requested stronger level. Reconstructing only the configured profile is
  // honest; stronger historical runs have no invertible current contract.
  if (entry.configured_assurance_level !== configured
    || entry.achieved_assurance_level !== configured
    || entry.configured_assurance_level !== state.current.configured_assurance_level
    || entry.registry_sha256 !== state.current.registry_sha256
    || entry.detector_catalog_sha256 !== state.current.detector_catalog_sha256
    || entry.tool_identity !== state.current.tool_identity
    || entry.environment_class !== state.current.environment_class
    || entry.trust_snapshot_sha256 !== state.current.trust_snapshot_sha256
    || evaluator.registrySha256 !== state.current.registry_sha256) return false;
  const profile = currentRetentionProfile(entry, evaluator);
  if (!profile || !profile.snapshot.complete
    || entry.scope_sha256 !== scopeSha256(profile.snapshot.effectiveScopeAddresses)
    || entry.input_sha256 !== profile.snapshot.inputSha256) return false;
  const seals = featureClosureSeals(evaluator.closureInput, entry.feature);
  if (entry.contract_sha256 !== seals.contractSha256
    || entry.subject_sha256 !== seals.subjectSha256
    || entry.verification_sha256 !== seals.verificationSha256
    || entry.runtime_dependency_sha256 !== seals.runtimeDependencySha256) return false;
  if (!sameMigrationBaselineSummary(
    entry.migration_baseline,
    currentMigrationBaselineSummary(profile.profile, profile.snapshot.migrationBaselineCandidates),
  )) return false;
  return entry.profile_sha256 === attestationProfileSha256({
    profile: entry.profile,
    assuranceLevel: configured,
    configuredAssuranceLevel: configured,
    registrySha256: evaluator.registrySha256,
    detectorCatalogSha256: state.current.detector_catalog_sha256,
    toolIdentity: state.current.tool_identity,
    environmentClass: state.current.environment_class,
    trustSnapshotSha256: evaluator.receiptContext.trustSnapshot.digest,
  });
}

/** Memoizes per-row completion scopes and the three allowed profile families. */
function currentRetentionProfile(entry: AttestationV3, evaluator: CurrentSiblingV3Evaluator) {
  const key = entry.profile === 'completion' ? `${entry.profile}:${entry.feature}` : entry.profile;
  if (evaluator.profiles.has(key)) return evaluator.profiles.get(key);
  const profile = assuranceProfile(entry.profile, evaluator.configured);
  const scope = effectiveFeatureScope(evaluator.compilation, profile,
    entry.profile === 'completion' ? [`feature:${entry.feature}`] : undefined);
  if (!scope.complete || !scope.featureIds.includes(entry.feature)) {
    evaluator.profiles.set(key, undefined);
    return undefined;
  }
  const scopedFeatures = new Set(scope.featureIds);
  const oracleRequiredSubjects = new Set(requiredOracleWorklist(evaluator.spec)
    .filter((row) => scopedFeatures.has(row.featureId))
    .map((row) => `criterion:${row.featureId}/${row.acId}`));
  const snapshot = workspaceProfileSnapshot(evaluator.cwd, evaluator.compilation, {
    profile,
    scopeAddresses: scope.scopeAddresses,
    scopeComplete: scope.complete,
    hasExecutableTests: hasApplicableSchema02TestCriteria(evaluator.compilation, scope.scopeAddresses),
    oracleRequiredSubjects,
    requiresHuman: evaluator.configured === 'L4',
    closureInput: evaluator.closureInput,
    controlResolver: evaluator.controlResolver,
  });
  const result = {profile, scope, snapshot};
  evaluator.profiles.set(key, result);
  return result;
}

/**
 * Re-reads every F9-provided receipt location under the writer lock.  F6 has
 * no issuer candidates, so its empty context is complete; a non-empty
 * precomputed byte list with no location census is intentionally unusable for
 * retention rather than becoming a stale receipt cache.
 */
function lockHeldReceiptContext(
  cwd: string,
  context: NonNullable<ReturnType<typeof attestationV3RetentionState>>['receiptContext'],
): NonNullable<ReturnType<typeof attestationV3RetentionState>>['receiptContext'] | undefined {
  const census = receiptFileCensus(cwd);
  if (!census) return undefined;
  if (context.currentLocations === undefined) {
    return context.candidates.length === 0 && census.length === 0 ? context : undefined;
  }
  const locationPaths = context.currentLocations.map((location) => location.path);
  if (context.candidates.length !== context.currentLocations.length
    || new Set(locationPaths).size !== locationPaths.length
    || !sameStrings(census.map((record) => record.path), locationPaths)) return undefined;
  const filesByPath = new Map(census.map((record) => [record.path, record]));
  const candidates: Array<{readonly bytes: string; readonly expected: ReceiptExpectedDigestContext}> = [];
  for (const location of context.currentLocations) {
    if (!/^spec\/evidence\/[^/]+\/[a-f0-9]{64}\.yaml$/.test(location.path)
      || location.path.split('/').includes('..')) return undefined;
    const file = filesByPath.get(location.path);
    if (!file) return undefined;
    candidates.push({bytes: file.bytes, expected: location.expected});
  }
  // A missing, unsafe, changed, or incomplete location census can never retain
  // a row. The multiset comparison preserves the F9 candidate ↔ live-location
  // bijection even when the issuer supplied candidates in a different order.
  return sameReceiptCandidates(context.candidates, candidates)
    ? {candidates, trustSnapshot: context.trustSnapshot, currentLocations: context.currentLocations}
    : undefined;
}

/** Lock-held receipt file proven portable and stored at its content-derived path. */
export interface CurrentReceiptFile {
  /** Repository-relative `spec/evidence/<feature>/<digest>.yaml` path. */
  readonly path: string;
  /** Exact canonical receipt bytes read from that path. */
  readonly bytes: string;
}

/**
 * Returns the complete safe receipt-file census, or undefined on uncertainty.
 *
 * Absence of the evidence root is a proved empty census, not an unknown one.
 * Anything the walk cannot prove safe and canonical — a symlink, a non-file, a
 * non-portable receipt, a non-content-derived path — makes the whole census
 * undefined so no caller can mistake a partial read for the full set.
 *
 * @param cwd - Workspace root containing `spec/evidence`.
 * @returns Every canonical receipt file, or undefined when the walk is not provably complete.
 * @example
 * ```ts
 * const census = receiptFileCensus(process.cwd());
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-4f8c2542
 * @since 0.10.0
 * @internal
 */
export function receiptFileCensus(cwd: string): readonly CurrentReceiptFile[] | undefined {
  const root = 'spec/evidence';
  if (!existsSync(join(cwd, root))) return [];
  try {
    const rootPath = safeProofWorkspacePath(cwd, root);
    const rootStat = lstatSync(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return undefined;
    const locations: CurrentReceiptFile[] = [];
    const visit = (directory: string, relativePath: string): boolean => {
      for (const name of readdirSync(directory).sort()) {
        const candidate = `${relativePath}/${name}`;
        const path = safeProofWorkspacePath(cwd, candidate);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) return false;
        if (stat.isDirectory()) {
          if (!visit(path, candidate)) return false;
        } else if (stat.isFile()) {
          // `.yml` is deliberately not an alternate portable-receipt address:
          // ingest derives only this exact canonical `.yaml` content address.
          if (!/^spec\/evidence\/[^/]+\/[a-f0-9]{64}\.yaml$/.test(candidate)) return false;
          const rawBytes = readFileSync(path);
          const receipt = parsePortableReceiptYaml(rawBytes);
          const bytes = new TextDecoder('utf-8', {fatal: true}).decode(rawBytes);
          if (bytes !== serializePortableReceipt(receipt)) return false;
          const canonicalPath = `spec/evidence/${receiptFeatureId(receipt)}/${receiptDigest(receipt)}.yaml`;
          if (candidate !== canonicalPath) return false;
          locations.push({path: candidate, bytes});
        } else {
          return false;
        }
      }
      return true;
    };
    return visit(rootPath, root) ? locations.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) : undefined;
  } catch {
    return undefined;
  }
}

/** Compares sorted-equivalent path sets without trusting an issuer order. */
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

/** Reconciles the immutable pre-gate candidate snapshot with lock-held bytes. */
function sameReceiptCandidates(
  expected: readonly {readonly bytes: string | Uint8Array; readonly expected: ReceiptExpectedDigestContext}[],
  current: readonly {readonly bytes: string | Uint8Array; readonly expected: ReceiptExpectedDigestContext}[],
): boolean {
  const counts = new Map<string, number>();
  for (const candidate of expected) {
    const key = receiptCandidateKey(candidate);
    if (!key) return false;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const candidate of current) {
    const key = receiptCandidateKey({bytes: candidate.bytes, expected: candidate.expected});
    if (!key) return false;
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
}

/** Stable identity for exact candidate bytes plus their expected-digest contract. */
function receiptCandidateKey(candidate: {
  readonly bytes: string | Uint8Array;
  readonly expected: ReceiptExpectedDigestContext;
}): string | undefined {
  try {
    const bytes = typeof candidate.bytes === 'string'
      ? candidate.bytes
      : new TextDecoder('utf-8', {fatal: true}).decode(candidate.bytes);
    parsePortableReceiptYaml(bytes);
    return createHash('sha256').update(bytes, 'utf8').update('\u0000', 'utf8')
      .update(canonicalClosureJson(candidate.expected), 'utf8').digest('hex');
  } catch {
    return undefined;
  }
}

/** Reads the newest compiler inputs without reacquiring the non-reentrant F4 lock. */
function currentCompilationForV3Retention(cwd: string, completion: GeneratedAttestationCompletion | undefined) {
  const diskCompilation = compileSpecWorkspaceWithLockHeld(cwd);
  if (!completion) return diskCompilation;
  const target = yaml.parse(completion.targetBytes) as {id?: unknown};
  return typeof target.id === 'string'
    ? prospectiveDoneCompilation(diskCompilation, target.id)
    : diskCompilation;
}

/** Matches the reducer's scope digest without constructing a second reducer. */
function scopeSha256(addresses: readonly string[]): string {
  return createHash('sha256').update(canonicalClosureJson([...addresses].sort()), 'utf8').digest('hex');
}

function attestationInputSnapshotMatches(
  cwd: string,
  snapshot: AttestationInputSnapshot,
  prospectiveCompletion: boolean = false,
): boolean {
  try {
    const current = captureAttestationInputSnapshot(cwd, loadCurrentSpecForAttestation(cwd));
    // A completion snapshot is intentionally the projected done Spec, while
    // disk remains the byte-identical in_progress source until this writer
    // publishes its journal. The full source preimage census plus the
    // disk-recomputed runtime matcher below are the stronger comparison in
    // that one case; ordinary attestation writes retain semantic equality.
    return (prospectiveCompletion || sameSpecSnapshot(current.spec, snapshot.spec))
      && current.sourceFiles.length === snapshot.sourceFiles.length
      && current.sourceFiles.every((entry, index) => entry.path === snapshot.sourceFiles[index]?.path && entry.bytes === snapshot.sourceFiles[index]?.bytes)
      && (snapshot.runtime === undefined || (snapshot.runtime.complete && snapshot.runtime.matchesCurrent()));
  } catch {
    return false;
  }
}

/** Rebuilds the one prospective Spec from locked disk bytes and the F4 target. */
function prospectiveCompletionSpec(cwd: string, target: GeneratedAttestationCompletionTarget): Spec {
  const disk = loadCurrentSpecForAttestation(cwd);
  const matches = (disk.features ?? []).filter((feature) => feature.id === target.featureId);
  if (matches.length !== 1) {
    throw new SpecEditError('INVALID_OPERATION', 'The locked completion target does not identify exactly one current feature.');
  }
  return prospectiveDoneSpec(disk, target.featureId);
}

/** Confirms that the compiler projects the same target status before a v3 receipt is rendered. */
function validateProspectiveCompletionCompiler(cwd: string, target: GeneratedAttestationCompletionTarget): void {
  const compilation = prospectiveDoneCompilation(compileSpecWorkspaceWithLockHeld(cwd), target.featureId);
  const feature = compilation.contract?.features.find((candidate) => candidate.id === target.featureId);
  if (compilation.schemaVersion !== '0.2' || feature?.status !== 'done') {
    throw new SpecEditError('INVALID_OPERATION', 'The locked completion target does not produce a schema-0.2 done compiler view.');
  }
}

/** Binds the new v3 seal to this completion target and its captured complete input. */
function validateCompletionAttestationPayload(
  v3: readonly AttestationV3[] | undefined,
  snapshot: AttestationInputSnapshot,
  target: GeneratedAttestationCompletionTarget,
): void {
  if (!snapshot.runtime?.complete || !v3 || v3.length !== 1
    || v3[0]?.feature !== target.featureId
    || v3[0].profile !== 'completion'
    || v3[0].input_sha256 !== snapshot.runtime.inputSha256) {
    throw new SpecEditError('INVALID_OPERATION', 'The completion receipt does not seal its exact feature and verification input.');
  }
}

function attestationSourcePaths(cwd: string): readonly string[] {
  const direct = [
    'spec/capabilities.yaml',
    'spec/architecture.yaml',
    'spec/generated/migration-baseline-0.1-to-0.2.yaml',
  ];
  const shardPaths = ['spec/features', 'spec/scenarios'].flatMap((directory) => {
    const absolute = join(cwd, directory);
    return existsSync(absolute)
      ? readdirSync(absolute).filter((entry) => /\.ya?ml$/.test(entry)).map((entry) => `${directory}/${entry}`)
      : [];
  });
  return [...direct.filter((path) => existsSync(join(cwd, path))), ...shardPaths];
}

/** Reads the loader's lock-held compatibility view without nesting the F4 workspace lock. */
function loadCurrentSpecForAttestation(cwd: string): Spec {
  return loadSpecFromDiskUnlocked(cwd);
}

/** Renders legacy module compatibility and/or F6 closure seals from one coherent snapshot. */
function renderAttestation(
  cwd: string,
  spec: Spec,
  policy: AttestationPolicy | undefined,
  v3: readonly AttestationV3[] | undefined,
  writeLegacy: boolean,
  suppressedLegacyFeatures: ReadonlySet<string>,
): string {
  const done = (spec.features ?? []).filter((f) => f.status === 'done' && (f.modules ?? []).length > 0);
  const moduleSet = new Set<string>();
  for (const f of done) for (const m of f.modules ?? []) moduleSet.add(m);
  const moduleRows = [...moduleSet]
    .sort()
    .map((m) => `  ${m}: ${moduleFileHash(cwd, m)}`);
  const v3Rows = [...(v3 ?? [])]
    .sort((left, right) => left.feature < right.feature ? -1 : left.feature > right.feature ? 1 : 0)
    .map((entry) => `  ${entry.feature}: ${JSON.stringify(entry)}`);
  const v3Features = new Set((v3 ?? []).map((entry) => entry.feature));
  const featureRows = done
    .filter((feature) => !suppressedLegacyFeatures.has(feature.id))
    .filter((feature) => writeLegacy || !v3Features.has(feature.id))
    .map((feature) => `  ${feature.id}: ok`)
    .sort();
  // A v3 row replaces only that feature's old marker. The module map remains
  // for readers that still understand v1/v2 and for unscoped done features.
  const legacyRows = 'attested_modules:\n' +
    moduleRows.join('\n') +
    '\n' +
    'attested_features:\n' +
    featureRows.join('\n') +
    '\n';
  return HEADER +
    (policy
      ? 'policy:\n' +
        `  cladding: ${JSON.stringify(policy.cladding)}\n` +
        `  blocking: ${policy.blocking}\n` +
        `  detectors_sha256: ${policy.detectorsSha256}\n`
      : '') +
    legacyRows +
    (v3Rows.length > 0 ? `attested_v3:\n${v3Rows.join('\n')}\n` : '');
}

function normalizeAttestationV3(value: unknown, feature: string): AttestationV3 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Partial<AttestationV3>;
  const digestFields = [
    entry.scope_sha256, entry.input_sha256, entry.contract_sha256, entry.subject_sha256,
    entry.verification_sha256, entry.runtime_dependency_sha256, entry.profile_sha256,
    entry.obligation_sha256, entry.registry_sha256, entry.detector_catalog_sha256,
    entry.trust_snapshot_sha256,
  ];
  const levels = new Set(['L1', 'L2', 'L3', 'L4']);
  const counts = normalizeCompactObservationCounts(entry.observation_counts);
  const valid = entry.attestation_schema === '3'
    && entry.feature === feature
    && (entry.profile === 'completion' || entry.profile === 'push' || entry.profile === 'release')
    && levels.has(entry.configured_assurance_level ?? '')
    && (entry.achieved_assurance_level === 'none' || levels.has(entry.achieved_assurance_level ?? ''))
    && digestFields.every((digest) => /^[a-f0-9]{64}$/.test(digest ?? ''))
    && typeof entry.tool_identity === 'string' && entry.tool_identity.length > 0
    && typeof entry.environment_class === 'string' && entry.environment_class.length > 0
    && Array.isArray(entry.observation_identities)
    && entry.observation_identities.every((identity) => /^[a-f0-9]{64}$/.test(identity))
    && entry.observation_identities.every((identity, index, values) => index === 0 || values[index - 1]! <= identity)
    && entry.observation_identities.every((identity, index, values) => index === 0 || values[index - 1]! !== identity)
    && counts !== undefined
    // D13 preserves literal PASS independently from an upstream report
    // failure. Every resolved required non-baseline result still needs a
    // distinct current observation identity after sorted/unique validation.
    && entry.observation_identities.length >= counts.required - counts.migration_baseline;
  if (!valid || counts === undefined) return undefined;
  const migrationBaseline = normalizeMigrationBaselineSummary(entry.migration_baseline, counts.migration_baseline);
  if (migrationBaseline === undefined && counts.migration_baseline !== 0) return undefined;
  if (migrationBaseline === undefined && entry.migration_baseline !== undefined) return undefined;
  return {
    ...entry,
    observation_counts: counts,
    ...(migrationBaseline === undefined ? {} : {migration_baseline: migrationBaseline}),
  } as AttestationV3;
}

/** Normalizes pre-F7c v3 counts while rejecting every other compact-count shape. */
function normalizeCompactObservationCounts(value: unknown): Readonly<{required: number; pass: number; na: number; migration_baseline: number}> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const counts = value as {required?: unknown; pass?: unknown; na?: unknown; migration_baseline?: unknown};
  const keys = Object.keys(counts).sort();
  const oldShape = keys.join(',') === 'na,pass,required';
  const currentShape = keys.join(',') === 'migration_baseline,na,pass,required';
  if (!oldShape && !currentShape) return undefined;
  const {required, pass, na} = counts;
  const migrationBaseline = oldShape ? 0 : counts.migration_baseline;
  if (!(typeof required === 'number' && Number.isSafeInteger(required) && required > 0
    && typeof pass === 'number' && Number.isSafeInteger(pass) && pass >= 0 && pass <= required
    && typeof na === 'number' && Number.isSafeInteger(na) && na >= 0
    && typeof migrationBaseline === 'number' && Number.isSafeInteger(migrationBaseline)
    && migrationBaseline >= 0 && migrationBaseline <= required
    && pass <= required - migrationBaseline)) return undefined;
  return Object.freeze({required, pass, na, migration_baseline: migrationBaseline});
}

/** Validates the receipt-only compact summary required by a nonzero baseline count. */
function normalizeMigrationBaselineSummary(
  value: unknown,
  baselineCount: number,
): MigrationBaselineAttestationSummary | undefined {
  if (baselineCount === 0 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const summary = value as Record<string, unknown>;
  const keys = Object.keys(summary).sort(compareCodeUnits);
  const baselineReceiptSha256 = summary.baseline_receipt_sha256;
  const resolutionSha256 = summary.resolution_sha256;
  const authorizations = summary.criterion_authorization_sha256;
  const criterionCount = summary.criterion_count;
  const obligationCount = summary.obligation_count;
  if (keys.join(',') !== 'baseline_receipt_sha256,criterion_authorization_sha256,criterion_count,obligation_count,resolution_sha256'
    || !isSha256(baselineReceiptSha256)
    || !isSha256(resolutionSha256)
    || !Array.isArray(authorizations)
    || !authorizations.every(isSha256)
    || !authorizations.every((authorization, index, values) => index === 0
      || compareCodeUnits(values[index - 1]!, authorization) < 0)
    || !isPositiveSafeInteger(criterionCount)
    || !isPositiveSafeInteger(obligationCount)
    || authorizations.length !== criterionCount
    || obligationCount !== baselineCount
    || obligationCount !== 2 * criterionCount) return undefined;
  return Object.freeze({
    baseline_receipt_sha256: baselineReceiptSha256,
    resolution_sha256: resolutionSha256,
    criterion_authorization_sha256: Object.freeze([...authorizations]),
    criterion_count: criterionCount,
    obligation_count: obligationCount,
  });
}

/** Rebuilds the expected compact migration summary from one current profile scope. */
function currentMigrationBaselineSummary(
  profile: ReturnType<typeof assuranceProfile>,
  candidates: readonly {
    readonly subject: string;
    readonly obligations: readonly string[];
    readonly basis: {
      readonly baseline_receipt_sha256: string;
      readonly resolution_sha256: string;
      readonly criterion_authorization_sha256: string;
    };
  }[],
): MigrationBaselineAttestationSummary | undefined {
  if (!profile.obligations.includes('stage_2.1') || !profile.obligations.includes('stage_2.2')) return undefined;
  if (candidates.length === 0
    || candidates.some((candidate) => candidate.obligations.length !== 2
      || candidate.obligations[0] !== 'stage_2.1' || candidate.obligations[1] !== 'stage_2.2')) return undefined;
  const first = candidates[0]!.basis;
  if (candidates.some((candidate) => candidate.basis.baseline_receipt_sha256 !== first.baseline_receipt_sha256
    || candidate.basis.resolution_sha256 !== first.resolution_sha256)) return undefined;
  const authorizations = candidates.map((candidate) => candidate.basis.criterion_authorization_sha256).sort(compareCodeUnits);
  if (new Set(authorizations).size !== authorizations.length) return undefined;
  return Object.freeze({
    baseline_receipt_sha256: first.baseline_receipt_sha256,
    resolution_sha256: first.resolution_sha256,
    criterion_authorization_sha256: Object.freeze(authorizations),
    criterion_count: authorizations.length,
    obligation_count: authorizations.length * 2,
  });
}

/** Compares serialized receipt summaries by content rather than object identity. */
function sameMigrationBaselineSummary(
  left: MigrationBaselineAttestationSummary | undefined,
  right: MigrationBaselineAttestationSummary | undefined,
): boolean {
  return canonicalClosureJson(left ?? null) === canonicalClosureJson(right ?? null);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** Compares the semantic verification input without depending on YAML byte formatting. */
function sameSpecSnapshot(left: Spec, right: Spec): boolean {
  return JSON.stringify(sortSnapshot(left)) === JSON.stringify(sortSnapshot(right));
}

function sortSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSnapshot);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, sortSnapshot(item)]));
}
