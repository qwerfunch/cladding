// Cladding · Spec 0.2 F6 · single deterministic assurance closure authority.

import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {relative, resolve} from 'node:path';

import {safeProofWorkspacePath} from '../proof/fs-safety.js';
import {compareCodeUnits} from './registry.js';

/** A hashable record retained with its address so missing inputs stay visible. */
export interface ClosureRecord {
  readonly address: string;
  readonly value: unknown;
}

/** A deterministic closure plus the digest that binds it. */
export interface AssuranceClosure {
  readonly records: readonly ClosureRecord[];
  readonly sha256: string;
  readonly complete: boolean;
}

/** Source byte declaration supplied by the compiler/F5 adapter boundary. */
export interface ClosureProofInput {
  readonly address: string;
  readonly path: string;
  readonly selector?: string;
  /** Historic carry-forward state; byte drift is never a complete strict proof. */
  readonly bindingState?: 'available' | 'stale' | 'unsafe';
  /** Immutable reviewed whole-file digest expected by the carry-forward record. */
  readonly expectedBindingSha256?: string;
  /** Provenance stays distinct from live binding discovery and issued receipts. */
  readonly bindingProvenance?: 'legacy_exempt' | 'reviewed_carry_forward' | 'live';
  readonly sourceBytes?: Uint8Array | string;
  readonly runnerConfig?: unknown;
  readonly oracle?: {readonly declaration: unknown; readonly resolvedBytes?: Uint8Array | string};
  readonly evidence?: {readonly declaration: unknown; readonly resolvedBytes?: Uint8Array | string};
}

/** Criterion input deliberately has no sibling data. */
export interface AssuranceCriterionInput {
  readonly id: string;
  readonly text?: string;
  readonly ears?: Readonly<Record<string, string>>;
  readonly scannerState?: 'parsed' | 'opaque' | 'conflict';
  readonly legacyUnclassified?: boolean;
  readonly baselineIdentity?: string;
  readonly kind?: string;
  readonly statement?: string;
  readonly rationale?: string;
  readonly constraintRefs?: readonly string[];
  readonly oracleRefs?: readonly string[];
  readonly evidenceRefs?: readonly string[];
}

/** Feature inputs needed by all closure families. */
export interface AssuranceFeatureInput {
  readonly id: string;
  readonly title: string;
  readonly purpose?: string;
  readonly modules?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly capabilityRefs?: readonly string[];
  readonly designImpact?: unknown;
  readonly baselineIdentity?: string;
  readonly criteria: readonly AssuranceCriterionInput[];
}

/** Dependency byte input.  `missing` and `unknown` remain explicit sentinels. */
export interface RuntimeDependencyInput {
  readonly feature: string;
  readonly module: string;
  readonly bytes?: Uint8Array | string;
  readonly state?: 'present' | 'missing' | 'unknown';
}

/** Normalized inputs passed from compiler and F5; no caller may omit uncertainty. */
export interface AssuranceClosureInput {
  readonly schemaVersion: '0.1' | '0.2';
  readonly features: readonly AssuranceFeatureInput[];
  readonly capabilities?: readonly {readonly id: string; readonly outcome: string}[];
  readonly architectureRules?: readonly unknown[];
  /** Compiler-normalized scenario applicability and intent; title is never a closure field. */
  readonly scenarios?: readonly {readonly id: string; readonly features?: readonly string[]; readonly intent?: unknown}[];
  readonly scenarioPolicy?: 'off' | 'advisory' | 'required';
  readonly proofInputs?: readonly ClosureProofInput[];
  /** Feature ids with an available selected executable test binding in this snapshot. */
  readonly executableProofFeatureIds?: readonly string[];
  /** Receipt identity is subject-bound so a sibling receipt cannot stale this proof closure. */
  readonly receiptIdentities?: readonly {readonly address: string; readonly identity: string}[];
  /**
   * Validated migration receipt content identity supplied by the compiler
   * adapter. `null` is the canonical absence value; generic closures never
   * read or interpret the migration artifact themselves.
   */
  readonly migrationBaselineReceiptSha256?: string | null;
  readonly runtimeDependencies?: readonly RuntimeDependencyInput[];
  /** Compiler evidence that a dependency graph is complete. */
  readonly dependencyComplete?: boolean;
}

/** Canonical JSON uses UTF-16 code-unit ordering, matching ECMAScript signed-data order. */
export function canonicalClosureJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalClosureJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalClosureJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hashes a canonical closure; a closure is never represented by a path or timestamp. */
export function closureSha256(records: readonly ClosureRecord[]): string {
  return createHash('sha256').update(canonicalClosureJson(records), 'utf8').digest('hex');
}

/** Reads proof bytes under F5's fail-closed symlink and workspace policy. */
export function readSafeProofClosureBytes(cwd: string, path: string): Uint8Array | undefined {
  try {
    const absolute = safeProofWorkspacePath(cwd, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) return undefined;
    if (stat.isFile()) return readFileSync(absolute);
    if (!stat.isDirectory()) return undefined;
    const records: Buffer[] = [];
    const visit = (directory: string): boolean => {
      for (const entry of readdirSync(directory, {withFileTypes: true}).sort((left, right) => compareCodeUnits(left.name, right.name))) {
        const child = `${directory}/${entry.name}`;
        const repoPath = relative(resolve(cwd), child).replaceAll('\\', '/');
        // Re-apply F5's workspace + symlink policy to every descendant.  A
        // directory root must never hide one unsafe implementation member.
        safeProofWorkspacePath(cwd, repoPath);
        const childStat = lstatSync(child);
        if (entry.isSymbolicLink() || childStat.isSymbolicLink()) return false;
        if (childStat.isDirectory()) {
          if (!visit(child)) return false;
        } else if (childStat.isFile()) {
          records.push(Buffer.from(`${repoPath}\u0000`, 'utf8'), readFileSync(child), Buffer.from('\u0000', 'utf8'));
        } else {
          return false;
        }
      }
      return true;
    };
    return visit(absolute) ? Buffer.concat(records) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads an authored runtime module through the compiler-owned F5-safe boundary.
 *
 * Feature-module syntax permits a trailing directory separator, while proof
 * bindings deliberately do not. Normalize that presentation detail only for
 * this read; callers retain the original spelling as identity and address.
 *
 * @param cwd Workspace root.
 * @param module Authored runtime module path.
 * @returns Deterministic bytes, or undefined for an unsafe or unresolved module.
 */
export function readSafeRuntimeModuleClosureBytes(cwd: string, module: string): Uint8Array | undefined {
  const readPath = module.replace(/[\\/]+$/, '');
  return readPath === '' ? undefined : readSafeProofClosureBytes(cwd, readPath);
}

/** Builds the schema-specific feature contract closure without invented schema 0.2 fields. */
export function contractClosure(input: AssuranceClosureInput, featureId: string): AssuranceClosure {
  const feature = findFeature(input, featureId);
  if (!feature) return closed([{address: `missing:feature:${featureId}`, value: '<missing>'}], false);
  const criteria = feature.criteria.map((criterion) => ({
    address: `criterion:${feature.id}/${criterion.id}`,
    value: input.schemaVersion === '0.1'
      ? legacyCriterionContract(criterion)
      : schema02CriterionContract(criterion),
  }));
  const capabilityIds = new Set(feature.capabilityRefs ?? []);
  const capabilities = (input.capabilities ?? []).filter((item) => capabilityIds.has(item.id)).map((item) => ({
    address: `capability:${item.id}`,
    value: {id: item.id, outcome: item.outcome},
  }));
  const scenarioRecords = requiredScenarioClosureRecords(input, feature.id);
  const records: ClosureRecord[] = [
    {
      address: `feature:${feature.id}`,
      value: input.schemaVersion === '0.1'
        ? {id: feature.id, title: feature.title, modules: sorted(feature.modules), depends_on: sorted(feature.dependsOn), baseline_identity: feature.baselineIdentity ?? null}
        : {
          id: feature.id, title: feature.title, purpose: feature.purpose ?? null,
          modules: sorted(feature.modules), depends_on: sorted(feature.dependsOn), capability_refs: sorted(feature.capabilityRefs),
          design_impact: feature.designImpact ?? null, baseline_identity: feature.baselineIdentity ?? null,
        },
    },
    ...criteria,
    ...capabilities,
    ...(input.schemaVersion === '0.2' ? (input.architectureRules ?? []).map((rule, index) => ({address: `architecture_rule:${index}`, value: rule})) : []),
    ...(input.schemaVersion === '0.2'
      ? [{address: 'migration_baseline:receipt', value: input.migrationBaselineReceiptSha256 ?? null}]
      : []),
    ...scenarioRecords,
  ];
  return closed(records, true);
}

/**
 * Builds a criterion subject closure.  It includes the parent feature identity
 * and required scenarios, but intentionally never walks sibling criteria.
 */
export function subjectClosure(input: AssuranceClosureInput, criterionAddress: string): AssuranceClosure {
  const [featureId, criterionId] = splitCriterion(criterionAddress);
  const feature = featureId ? findFeature(input, featureId) : undefined;
  const criterion = feature?.criteria.find((item) => item.id === criterionId);
  if (!feature || !criterion) return closed([{address: `missing:criterion:${criterionAddress}`, value: '<missing>'}], false);
  const scenarios = requiredScenarioClosureRecords(input, feature.id);
  return closed([
    {
      address: `feature:${feature.id}`,
      value: input.schemaVersion === '0.1'
        ? {id: feature.id, title: feature.title, baseline_identity: feature.baselineIdentity ?? null}
        : {id: feature.id, title: feature.title, purpose: feature.purpose ?? null, baseline_identity: feature.baselineIdentity ?? null},
    },
    {address: `criterion:${feature.id}/${criterion.id}`, value: input.schemaVersion === '0.1' ? legacyCriterionContract(criterion) : schema02CriterionContract(criterion)},
    ...scenarios,
  ], true);
}

/** Builds the binding, source-byte, runner, oracle, evidence, and receipt identity closure. */
export function verificationClosure(input: AssuranceClosureInput, criterionAddress: string): AssuranceClosure {
  const proofInputs = (input.proofInputs ?? []).filter((proof) => proof.address === criterionAddress);
  const records: ClosureRecord[] = proofInputs.map((proof) => ({
    address: `proof:${proof.address}:${proof.path}${proof.selector ? `#${proof.selector}` : ''}`,
    value: {
      binding: {address: proof.address, path: proof.path, selector: proof.selector ?? null},
      binding_state: proof.bindingState ?? 'available',
      expected_binding_sha256: proof.expectedBindingSha256 ?? null,
      binding_provenance: proof.bindingProvenance ?? 'live',
      source: digestableBytes(proof.sourceBytes, '<missing-source>'),
      runner_config: proof.runnerConfig ?? null,
      oracle: proof.oracle ? {declaration: proof.oracle.declaration, bytes: digestableBytes(proof.oracle.resolvedBytes, '<missing-oracle>')} : null,
      evidence: proof.evidence ? {declaration: proof.evidence.declaration, bytes: digestableBytes(proof.evidence.resolvedBytes, '<missing-evidence>')} : null,
    },
  }));
  // Retain absence even when a receipt happens to mention this criterion: a
  // receipt is not an executable binding and must not erase the negative fact.
  if (proofInputs.length === 0) records.push({address: `missing:proof:${criterionAddress}`, value: '<missing>'});
  for (const receipt of (input.receiptIdentities ?? [])
    // F5 receipt subjects are canonical `criterion:`/`feature:` addresses,
    // while closure callers use a compact feature/criterion address.  Compare
    // identity, never a caller-specific spelling, so a target receipt cannot
    // disappear merely because the closure dropped its canonical prefix.
    .filter((entry) => entry.address === criterionAddress || entry.address === `criterion:${criterionAddress}`
      || entry.address === `feature:${criterionAddress.split('/')[0]}`)
    .sort((left, right) => compareCodeUnits(left.identity, right.identity))) {
    records.push({address: `receipt:${receipt.identity}`, value: receipt.identity});
  }
  // `complete` seals whether every verification input is safely enumerable;
  // it never claims that a proof passed. A missing, stale, or path-only
  // binding is an explicit, deterministic negative fact for F5 to reduce at
  // its own criterion. Treating any of those facts as an unknown topology
  // would incorrectly turn every profile obligation into global stale.
  const complete = proofInputs.every((proof) => {
    if (proof.bindingState === 'unsafe') return false;
    if (proof.oracle?.resolvedBytes === undefined && proof.oracle !== undefined) return false;
    if (proof.evidence?.resolvedBytes === undefined && proof.evidence !== undefined) return false;
    if (!runnerConfigurationIsKnown(proof.runnerConfig)) return false;
    // A carry-forward already classified stale remains a sealed negative even
    // when its current source is gone. Its expected digest, state, and source
    // (or explicit missing-source sentinel) remain in the closure record.
    if (proof.bindingState === 'stale') return true;
    return proof.sourceBytes !== undefined;
  });
  return closed(records, complete);
}

/** Traverses prerequisites and module roots, retaining every absent or unknown member. */
export function runtimeDependencyClosure(input: AssuranceClosureInput, featureId: string): AssuranceClosure {
  const roots = new Set<string>();
  const visited = new Set<string>();
  let complete = input.dependencyComplete === true;
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const feature = findFeature(input, id);
    if (!feature) {
      complete = false;
      roots.add(`missing:feature:${id}`);
      return;
    }
    for (const dependency of feature.dependsOn ?? []) visit(dependency);
    for (const module of feature.modules ?? []) roots.add(`${id}:${module}`);
  };
  visit(featureId);
  const byKey = new Map((input.runtimeDependencies ?? []).map((entry) => [`${entry.feature}:${entry.module}`, entry]));
  const records: ClosureRecord[] = [];
  for (const root of sorted([...roots])) {
    if (root.startsWith('missing:')) {
      records.push({address: root, value: '<missing-prerequisite>'});
      continue;
    }
    const entry = byKey.get(root);
    if (!entry || entry.state === 'unknown') {
      complete = false;
      records.push({address: `runtime:${root}`, value: '<unknown-runtime-input>'});
    } else if (entry.state === 'missing' || entry.bytes === undefined) {
      complete = false;
      records.push({address: `runtime:${root}`, value: '<missing-runtime-input>'});
    } else {
      records.push({address: `runtime:${root}`, value: digestableBytes(entry.bytes, '<missing-runtime-input>')});
    }
  }
  return closed(records, complete);
}

function legacyCriterionContract(criterion: AssuranceCriterionInput): unknown {
  return {
    text: criterion.text ?? null,
    ears: criterion.ears ?? {},
    scanner_state: criterion.scannerState ?? 'opaque',
    legacy_unclassified: criterion.legacyUnclassified === true,
    baseline_identity: criterion.baselineIdentity ?? null,
  };
}

function schema02CriterionContract(criterion: AssuranceCriterionInput): unknown {
  return {
    id: criterion.id, kind: criterion.kind ?? null, statement: criterion.statement ?? null,
    rationale: criterion.rationale ?? null, constraint_refs: sorted(criterion.constraintRefs),
    oracle_refs: sorted(criterion.oracleRefs), evidence_refs: sorted(criterion.evidenceRefs),
    baseline_identity: criterion.baselineIdentity ?? null,
  };
}

/** Selects and canonicalizes only required-policy scenarios for one feature. */
function requiredScenarioClosureRecords(input: AssuranceClosureInput, featureId: string): readonly ClosureRecord[] {
  if (input.schemaVersion !== '0.2' || input.scenarioPolicy !== 'required') return [];
  return (input.scenarios ?? [])
    .filter((scenario) => scenario.features?.includes(featureId))
    .map((scenario) => ({
      address: `scenario:${scenario.id}`,
      // A caller can carry title as convenience metadata, but the D13 record
      // is exactly identity plus actor, goal, success, and ordered steps.
      value: {id: scenario.id, intent: canonicalScenarioIntent(scenario.intent)},
    }));
}

function canonicalScenarioIntent(intent: unknown): unknown {
  const record = intent !== null && typeof intent === 'object' && !Array.isArray(intent)
    ? intent as Readonly<Record<string, unknown>>
    : undefined;
  return {
    actor: typeof record?.actor === 'string' ? record.actor : null,
    goal: typeof record?.goal === 'string' ? record.goal : null,
    success: typeof record?.success === 'string' ? record.success : null,
    steps: Array.isArray(record?.steps) ? record.steps.filter((step): step is string => typeof step === 'string') : [],
  };
}

function closed(records: readonly ClosureRecord[], complete: boolean): AssuranceClosure {
  const sortedRecords = [...records].sort((left, right) => compareCodeUnits(left.address, right.address));
  return Object.freeze({records: Object.freeze(sortedRecords), sha256: closureSha256(sortedRecords), complete});
}

function digestableBytes(bytes: Uint8Array | string | undefined, missing: string): unknown {
  if (bytes === undefined) return missing;
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return {sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length};
}

/** Rejects a runner configuration that its own resolver marked unresolved. */
function runnerConfigurationIsKnown(value: unknown): boolean {
  if (value === undefined) return false;
  if (value !== null && typeof value === 'object' && 'complete' in value) {
    return (value as {readonly complete?: unknown}).complete !== false;
  }
  return true;
}

function findFeature(input: AssuranceClosureInput, id: string): AssuranceFeatureInput | undefined {
  return input.features.find((feature) => feature.id === id);
}

function splitCriterion(address: string): readonly [string | undefined, string | undefined] {
  const match = /^(?:criterion:)?([^/]+)\/([^/]+)$/.exec(address);
  return [match?.[1], match?.[2]];
}

function sorted(values: readonly string[] | undefined): readonly string[] {
  return [...(values ?? [])].sort(compareCodeUnits);
}
