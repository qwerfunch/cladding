// Cladding · Spec 0.2 F8 · current-gate testcase observations for GraphIR.

import {anchorAddress} from '../spec/compiler/graph-address.js';
import type {GraphIrV2Augmentation, GraphIrV2ObservationEdge} from '../spec/compiler/graph-ir-v2.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import type {CurrentSafeBindingCensus} from '../proof/current-bindings.js';
import {reduceTestBindings} from '../proof/bindings.js';
import {isCurrentGateTestcaseLedger, type CurrentGateTestcaseLedger} from '../proof/testcase-ledger.js';
import type {TestBinding} from '../proof/types.js';

const LAYER_ID = 'current-gate-junit-testcase-observations';
const OBSERVATION_ADAPTER = 'current-gate-junit-observation@1';

/**
 * Converts one sealed current-gate testcase ledger into observed GraphIR facts.
 *
 * The adapter never discovers a report path, parses runner output, or exposes
 * report content: the stage seam already sealed those concerns away, so a
 * normal graph read cannot borrow persisted bytes. It relies on the static
 * binding layer for physical endpoints, preserving authored and observed
 * `covers` facts as separate assertions.
 *
 * @param compilation - Immutable compiler snapshot that owns criterion addresses.
 * @param census - Exact caller-owned current-safe binding census for this snapshot.
 * @param ledger - Sealed gate-seam testcase ledger; anything else stays unknown.
 * @returns Frozen complete or unknown augmentation with deterministic observed edges.
 * @example
 * ```ts
 * const result = currentGateTestcaseLedger(cwd, inputSha256);
 * const layer = currentGateTestObservationAugmentation(
 *   compilation, census, 'ledger' in result ? result.ledger : undefined);
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-4f8c2542
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-d452908b
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 * @since 0.10.0
 * @internal
 */
export function currentGateTestObservationAugmentation(
  compilation: SpecCompilation,
  census: CurrentSafeBindingCensus,
  ledger: unknown,
): GraphIrV2Augmentation {
  const censusReasons = unsafeCensusReasons(compilation, census);
  if (censusReasons.length > 0) return unknownLayer(censusReasons);

  if (ledger === undefined) return unknownLayer(['current-gate observation context is missing']);
  if (!isCurrentGateTestcaseLedger(ledger)) return unknownLayer(['current-gate testcase ledger is unsealed']);

  const edges = census.bindings
    .map((binding) => observedBindingEdge(binding, ledger, ledger.identity))
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

function observedBindingEdge(
  binding: TestBinding,
  ledger: CurrentGateTestcaseLedger,
  proofIdentity: string,
): GraphIrV2ObservationEdge {
  const reduction = reduceTestBindings([binding], ledger)[0];
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

function unknownLayer(reasons: readonly string[]): GraphIrV2Augmentation {
  return freezeLayer({
    layerId: LAYER_ID,
    nodes: [],
    edges: [],
    completeness: 'unknown',
    unknownReasons: [...new Set(reasons)].sort(),
  });
}

function freezeLayer(layer: GraphIrV2Augmentation): GraphIrV2Augmentation {
  return Object.freeze({
    ...layer,
    nodes: Object.freeze([...layer.nodes]),
    edges: Object.freeze([...layer.edges]),
    unknownReasons: Object.freeze([...layer.unknownReasons]),
  });
}
