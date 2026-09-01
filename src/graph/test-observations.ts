// Cladding · Spec 0.2 F8 · current-gate testcase observations for GraphIR.

import {createHash} from 'node:crypto';

import {anchorAddress} from '../spec/compiler/graph-address.js';
import type {GraphIrV2Augmentation, GraphIrV2ObservationEdge} from '../spec/compiler/graph-ir-v2.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import type {CurrentSafeBindingCensus} from '../proof/current-bindings.js';
import {reduceTestBindings} from '../proof/bindings.js';
import type {TestBinding} from '../proof/types.js';
import {parseJUnitReport, parseVitestJsonReport, type JUnitReport} from '../stages/junit-report.js';
import {
  currentRunProofIdentity,
  isCurrentRunProofEvidence,
  type CurrentRunProofEvidence,
} from '../stages/test-run-cache.js';

const LAYER_ID = 'current-gate-junit-testcase-observations';
const OBSERVATION_ADAPTER = 'current-gate-junit-observation@1';
const EXPECTED_EVIDENCE_ADAPTER = 'legacy-stage:stage_2.1';
const EXPECTED_EVIDENCE_VERSION = '1';
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Explicit authority for one current-gate observation projection.
 *
 * The caller supplies evidence already captured at the gate seam instead of a
 * workspace report path, so a normal graph read cannot borrow persisted bytes.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-4f8c2542
 * @see docs/design/spec-0.2/proof-and-editing.md#d11--test-binding-and-observation
 * @since 0.10.0
 * @internal
 */
export interface CurrentGateTestObservationContext {
  /** Gate-seam evidence; omitted evidence is explicitly unknown, never empty proof. */
  readonly currentRun?: CurrentRunProofEvidence;
  /** Closure input seal that the captured evidence must match exactly. */
  readonly expectedInputSha256?: string;
}

/**
 * Converts one branded current-gate testcase ledger into observed GraphIR facts.
 *
 * The adapter never discovers a report path or exposes report content. It relies
 * on the static binding layer for physical endpoints, preserving authored and
 * observed `covers` facts as separate assertions.
 *
 * @param cwd - Workspace root used only to normalize an already-captured Vitest payload.
 * @param compilation - Immutable compiler snapshot that owns criterion addresses.
 * @param census - Exact caller-owned current-safe binding census for this snapshot.
 * @param context - Explicit gate evidence and its expected closure input seal.
 * @returns Frozen complete or unknown augmentation with deterministic observed edges.
 * @example
 * ```ts
 * const layer = currentGateTestObservationAugmentation(cwd, compilation, census, {
 *   currentRun: evidence,
 *   expectedInputSha256: inputSha256,
 * });
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-d452908b
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 * @since 0.10.0
 * @internal
 */
export function currentGateTestObservationAugmentation(
  cwd: string,
  compilation: SpecCompilation,
  census: CurrentSafeBindingCensus,
  context: CurrentGateTestObservationContext | undefined,
): GraphIrV2Augmentation {
  const censusReasons = unsafeCensusReasons(compilation, census);
  if (censusReasons.length > 0) return unknownLayer(censusReasons);

  const validated = validateContext(context);
  if ('reasons' in validated) return unknownLayer(validated.reasons);

  const report = parseCurrentReport(validated.evidence, cwd);
  if ('reason' in report) return unknownLayer([report.reason]);
  if (!Array.isArray(report.value.cases)) {
    return unknownLayer(['current-gate report does not expose case-level carriers']);
  }
  if (report.value.cases.length === 0) {
    return unknownLayer([emptyLedgerReason(validated.evidence)]);
  }

  const edges = census.bindings
    .map((binding) => observedBindingEdge(binding, report.value, validated.identity))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  return freezeLayer({layerId: LAYER_ID, nodes: [], edges, completeness: 'complete', unknownReasons: []});
}

function unsafeCensusReasons(compilation: SpecCompilation, census: CurrentSafeBindingCensus): readonly string[] {
  const criteria = new Set(compilation.nodes
    .filter((node) => node.nodeType === 'semantic' && node.kind === 'criterion')
    .map((node) => node.address));
  const reasons = [
    ...(census.safe ? [] : ['current-safe binding census is unsafe']),
    ...(census.diagnostics.length === 0 ? [] : ['current-safe binding census has diagnostics']),
    ...(census.bindings.every((binding) => isCurrentBinding(binding, criteria))
      ? []
      : ['current-safe binding census does not match the compiler snapshot']),
  ];
  return Object.freeze(reasons);
}

function isCurrentBinding(binding: TestBinding, criteria: ReadonlySet<string>): boolean {
  if (!binding
    || typeof binding.criterion !== 'string'
    || typeof binding.file !== 'string'
    || typeof binding.selector !== 'string'
    || (binding.framework !== 'vitest' && binding.framework !== 'jest')
    || (binding.carrier !== 'title' && binding.carrier !== 'metadata' && binding.carrier !== 'annotation')
    || !criteria.has(`criterion:${binding.criterion}`)) {
    return false;
  }
  try {
    anchorAddress(binding.file, binding.selector);
    return true;
  } catch {
    return false;
  }
}

function validateContext(
  context: CurrentGateTestObservationContext | undefined,
): {readonly evidence: CurrentRunProofEvidence; readonly identity: string} | {readonly reasons: readonly string[]} {
  if (context === undefined) return {reasons: ['current-gate observation context is missing']};
  const evidence = context.currentRun;
  if (!isCurrentRunProofEvidence(evidence)) {
    return {reasons: ['current-gate proof evidence is missing or unbranded']};
  }
  const reasons = [
    ...(isSha256(context.expectedInputSha256) ? [] : ['current-gate expected input SHA-256 is malformed']),
    ...(isSha256(evidence.inputSha256) ? [] : ['current-gate proof input SHA-256 is malformed']),
    ...(isSha256(evidence.commandSha256) ? [] : ['current-gate proof command SHA-256 is malformed']),
    ...(isSha256(evidence.reportSha256) ? [] : ['current-gate proof report SHA-256 is malformed']),
    ...(evidence.adapter?.id === EXPECTED_EVIDENCE_ADAPTER && evidence.adapter.version === EXPECTED_EVIDENCE_VERSION
      ? []
      : ['current-gate proof adapter is unsupported']),
    ...(typeof evidence.reportBytes === 'string' ? [] : ['current-gate proof report bytes are unavailable']),
  ];
  if (reasons.length > 0) return {reasons: Object.freeze(reasons)};
  if (context.expectedInputSha256 !== evidence.inputSha256) {
    return {reasons: ['current-gate proof input SHA-256 does not match the requested snapshot']};
  }
  if (commandSha256(evidence.command) !== evidence.commandSha256) {
    return {reasons: ['current-gate proof command SHA-256 does not match its captured command']};
  }
  if (sha256(evidence.reportBytes) !== evidence.reportSha256) {
    return {reasons: ['current-gate proof report SHA-256 does not match its captured bytes']};
  }
  const identity = currentRunProofIdentity(evidence);
  if (!isSha256(identity)) return {reasons: ['current-gate proof identity is unavailable']};
  return {evidence, identity};
}

function parseCurrentReport(
  evidence: CurrentRunProofEvidence,
  cwd: string,
): {readonly value: JUnitReport} | {readonly reason: string} {
  switch (evidence.format) {
    case 'vitest-json': {
      const report = parseVitestJsonReport(evidence.reportBytes, cwd);
      return report === undefined
        ? {reason: 'current-gate Vitest report cannot be parsed'}
        : {value: report};
    }
    case 'junit-xml': {
      // The lightweight parser intentionally accepts a valid empty suite, but
      // plain arbitrary text must not be reclassified as a safe empty ledger.
      if (!/<(?:testsuites?|testcase)\b/.test(evidence.reportBytes)) {
        return {reason: 'current-gate JUnit report cannot be parsed'};
      }
      return {value: parseJUnitReport(evidence.reportBytes)};
    }
    default:
      return {reason: 'current-gate proof format is unsupported'};
  }
}

function observedBindingEdge(
  binding: TestBinding,
  report: JUnitReport,
  proofIdentity: string,
): GraphIrV2ObservationEdge {
  const reduction = reduceTestBindings([binding], report)[0];
  const state = reduction?.state === 'failed'
    ? 'failed' as const
    : reduction?.state === 'verified'
      ? 'passed' as const
      : reduction !== undefined && reduction.matched > 0
        ? 'skipped' as const
        : 'unobserved' as const;
  const from = anchorAddress(binding.file, binding.selector);
  const to = `criterion:${binding.criterion}`;
  return Object.freeze({
    identity: `${OBSERVATION_ADAPTER}:${binding.framework}:${from}->${to}:${proofIdentity}`,
    from,
    to,
    relation: 'covers' as const,
    provenance: 'observed' as const,
    owner: Object.freeze({kind: 'runtime_observation' as const, adapter: OBSERVATION_ADAPTER, reference: proofIdentity}),
    state,
    normalizedTarget: to,
    selector: Object.freeze({precision: 'fragment' as const, value: binding.selector}),
  });
}

function emptyLedgerReason(evidence: CurrentRunProofEvidence): string {
  // JUnit testcases without a file/classname carrier cannot be attached to a
  // source binding. Keep that diagnosis separate from a genuinely empty suite.
  if (evidence.format === 'junit-xml' && /<testcase\b/.test(evidence.reportBytes)) {
    return 'current-gate report has no case-level carriers';
  }
  return 'current-gate report has an empty case ledger';
}

function unknownLayer(reasons: readonly string[]): GraphIrV2Augmentation {
  return freezeLayer({
    layerId: LAYER_ID,
    nodes: [],
    edges: [],
    completeness: 'unknown',
    unknownReasons: [...new Set(reasons)].sort(),
  });
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function commandSha256(command: readonly string[]): string {
  return sha256(JSON.stringify([...command]));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function freezeLayer(layer: GraphIrV2Augmentation): GraphIrV2Augmentation {
  return Object.freeze({
    ...layer,
    nodes: Object.freeze([...layer.nodes]),
    edges: Object.freeze([...layer.edges]),
    unknownReasons: Object.freeze([...layer.unknownReasons]),
  });
}
