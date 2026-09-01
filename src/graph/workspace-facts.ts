// Cladding · Spec 0.2 F8 · static live-test declarations in the canonical GraphIR.

import {anchorAddress, artifactAddress} from '../spec/compiler/graph-address.js';
import type {
  GraphIrV2Augmentation,
  GraphIrV2AugmentationNode,
  GraphIrV2StructuralEdge,
} from '../spec/compiler/graph-ir-v2.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import type {CurrentSafeBindingCensus} from '../proof/current-bindings.js';
import type {TestBinding} from '../proof/types.js';

const LAYER_ID = 'current-safe-vitest-jest-bindings';

/**
 * Converts one safe F5 source census into static GraphIR facts without
 * asserting any runner result. A malformed carrier or incomplete scan makes
 * every workspace query explicitly unknown rather than safely empty.
 *
 * @param compilation - Current compiler snapshot supplying canonical criteria.
 * @param census - One caller-owned live test scan for that exact workspace read.
 * @returns One immutable fact layer for the canonical GraphIR kernel.
 */
export function workspaceFactAugmentation(
  compilation: SpecCompilation,
  census: CurrentSafeBindingCensus,
): GraphIrV2Augmentation {
  const blockers = censusBlockers(census);
  if (blockers.length > 0) {
    return freezeLayer({layerId: LAYER_ID, nodes: [], edges: [], completeness: 'unknown', unknownReasons: blockers});
  }

  const compilerNodes = new Map(compilation.nodes.map((node) => [node.address, node]));
  const nodes: GraphIrV2AugmentationNode[] = [];
  const edges: GraphIrV2StructuralEdge[] = [];
  for (const binding of census.bindings) {
    const criterion = `criterion:${binding.criterion}`;
    const feature = `feature:${binding.criterion.slice(0, binding.criterion.indexOf('/'))}`;
    if (!compilerNodes.has(criterion) || !compilerNodes.has(feature)) {
      return freezeLayer({
        layerId: LAYER_ID,
        nodes: [],
        edges: [],
        completeness: 'unknown',
        unknownReasons: [`binding does not resolve to a current compiler criterion: ${binding.criterion}`],
      });
    }
    const artifact = artifactAddress(binding.file);
    const anchor = anchorAddress(binding.file, binding.selector);
    const locator = Object.freeze({kind: 'text_source' as const, path: binding.file, selector: binding.selector});
    nodes.push(Object.freeze({
      address: artifact,
      nodeType: 'artifact' as const,
      roles: Object.freeze(['test'] as const),
      owners: Object.freeze([feature]),
      provenance: 'authored' as const,
      locator,
    }));
    const existingAnchor = compilerNodes.get(anchor);
    if (existingAnchor === undefined) {
      nodes.push(Object.freeze({
        address: anchor,
        nodeType: 'anchor' as const,
        artifact,
        selector: binding.selector,
        selectorProvenance: 'authored' as const,
        provenance: 'authored' as const,
        locator,
      }));
    } else if (existingAnchor.nodeType !== 'anchor'
      || existingAnchor.artifact !== artifact
      || existingAnchor.selector !== binding.selector) {
      return freezeLayer({
        layerId: LAYER_ID,
        nodes: [],
        edges: [],
        completeness: 'unknown',
        unknownReasons: [`binding anchor collides with a nonmatching compiler node: ${anchor}`],
      });
    }
    edges.push(Object.freeze({
      identity: bindingIdentity(binding, anchor, criterion),
      from: anchor,
      to: criterion,
      relation: 'covers' as const,
      provenance: 'authored' as const,
      owner: locator,
      state: 'resolved' as const,
      raw: `[covers:${binding.criterion}]`,
      normalizedTarget: criterion,
      selector: Object.freeze({precision: 'fragment' as const, value: binding.selector}),
    }));
  }
  return freezeLayer({layerId: LAYER_ID, nodes, edges, completeness: 'complete', unknownReasons: []});
}

function censusBlockers(census: CurrentSafeBindingCensus): readonly string[] {
  const blockers = [
    ...(census.safe ? [] : ['live Vitest/Jest declaration scan is incomplete']),
    ...census.diagnostics.map((diagnostic) =>
      `unknown [covers:] criterion ${diagnostic.criterion} at ${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`),
  ];
  return Object.freeze([...new Set(blockers)].sort());
}

function bindingIdentity(binding: TestBinding, anchor: string, criterion: string): string {
  return `${binding.framework}:${anchor}->${criterion}`;
}

function freezeLayer(layer: GraphIrV2Augmentation): GraphIrV2Augmentation {
  return Object.freeze({
    ...layer,
    nodes: Object.freeze([...layer.nodes]),
    edges: Object.freeze([...layer.edges]),
    unknownReasons: Object.freeze([...layer.unknownReasons]),
  });
}
