// Cladding · Spec 0.2 F8 · static live-test declarations in the canonical GraphIR.

import {anchorAddress, artifactAddress} from '../spec/compiler/graph-address.js';
import type {DocumentFactScan} from '../spec/doc-references.js';
import type {
  GraphIrV2Augmentation,
  GraphIrV2AugmentationNode,
  GraphIrV2StructuralEdge,
} from '../spec/compiler/graph-ir-v2.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import type {CurrentSafeBindingCensus} from '../proof/current-bindings.js';
import type {TestBinding} from '../proof/types.js';

const LAYER_ID = 'current-safe-vitest-jest-bindings';
const DOCUMENT_LAYER_ID = 'document-facts';

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

/**
 * Converts one caller-owned document scan into provenance-distinct GraphIR
 * facts. Explicit declarations own `explains`; prose remains non-authoritative
 * `mentions`; tracked Markdown targets retain their authored `links_to` facts.
 *
 * @param compilation - Current compiler snapshot supplying canonical features.
 * @param scan - One caller-owned document scan, omitted only for sealed prospective overlays.
 * @returns One immutable document fact layer for the canonical GraphIR kernel.
 */
export function documentFactAugmentation(
  compilation: SpecCompilation,
  scan: DocumentFactScan | undefined,
): GraphIrV2Augmentation {
  if (!scan) {
    return freezeLayer({
      layerId: DOCUMENT_LAYER_ID,
      nodes: [],
      edges: [],
      completeness: 'unknown',
      unknownReasons: ['document scan is unavailable for a prospective workspace overlay'],
    });
  }
  const features = new Set(compilation.nodes
    .filter((node) => node.nodeType === 'semantic' && node.kind === 'feature')
    .map((node) => node.address));
  const artifacts = new Map<string, {
    readonly path: string;
    readonly owners: Set<string>;
    provenance: 'authored' | 'derived';
    selector?: string;
  }>();
  const edges: GraphIrV2StructuralEdge[] = [];
  const unknownReasons = [...scan.unknownReasons];
  const addArtifact = (path: string, owners: readonly string[] = [], provenance: 'authored' | 'derived' = 'derived', selector?: string): string => {
    const address = artifactAddress(path);
    const existing = artifacts.get(address);
    if (existing) {
      for (const owner of owners) existing.owners.add(owner);
      if (provenance === 'authored') existing.provenance = 'authored';
      if (existing.selector === undefined || (selector !== undefined && selector < existing.selector)) existing.selector = selector;
      return address;
    }
    artifacts.set(address, {path, owners: new Set(owners), provenance, selector});
    return address;
  };

  for (const document of scan.docs) {
    const explicitOwners = document.explicit
      .map((fact) => `feature:${fact.featureId}`)
      .filter((target) => features.has(target));
    const explicitSelector = document.explicit.map((fact) => fact.selector).sort()[0];
    const source = addArtifact(document.doc, explicitOwners, explicitOwners.length > 0 ? 'authored' : 'derived', explicitSelector);
    for (const fact of document.explicit) {
      const target = `feature:${fact.featureId}`;
      const state = features.has(target) ? 'resolved' as const : 'unresolved' as const;
      if (state === 'unresolved') unknownReasons.push(`explicit document feature target is absent: ${fact.featureId} at ${document.doc}#${fact.selector}`);
      edges.push(documentEdge('explains', source, target, state, document.doc, fact.selector, fact.raw));
    }
    for (const fact of document.organic) {
      const target = `feature:${fact.featureId}`;
      const state = features.has(target) ? 'resolved' as const : 'unresolved' as const;
      edges.push(documentEdge('mentions', source, target, state, document.doc, fact.selector, fact.raw));
    }
    for (const link of document.links) {
      const target = artifactAddress(link.target);
      if (link.state === 'resolved') addArtifact(link.target);
      else unknownReasons.push(`repository-local Markdown link target is absent: ${link.target} at ${document.doc}#${link.selector}`);
      edges.push(documentEdge('links_to', source, target, link.state, document.doc, link.selector, link.raw));
    }
    for (const issue of document.issues) {
      // An unsafe spelling is diagnostic evidence, never an artifact address or
      // structural edge that could normalize an escape into the workspace graph.
      unknownReasons.push(
        `unsafe local Markdown path (${issue.reason}) at ${document.doc}#${issue.selector}: ${JSON.stringify(issue.raw)}`,
      );
    }
  }
  const nodes: GraphIrV2AugmentationNode[] = [...artifacts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, artifact]) => Object.freeze({
      address,
      nodeType: 'artifact' as const,
      roles: Object.freeze(['doc'] as const),
      owners: Object.freeze([...artifact.owners].sort()),
      provenance: artifact.provenance,
      locator: Object.freeze({
        kind: 'text_source' as const,
        path: artifact.path,
        ...(artifact.selector === undefined ? {} : {selector: artifact.selector}),
      }),
    }));
  return freezeLayer({
    layerId: DOCUMENT_LAYER_ID,
    nodes,
    edges: edges.sort((left, right) => left.identity.localeCompare(right.identity)),
    completeness: unknownReasons.length === 0 && scan.completeness === 'complete' ? 'complete' : 'unknown',
    unknownReasons: [...new Set(unknownReasons)].sort(),
  });
}

function documentEdge(
  relation: 'explains' | 'mentions' | 'links_to',
  from: string,
  to: string,
  state: 'resolved' | 'unresolved',
  path: string,
  selector: string,
  raw: string,
): GraphIrV2StructuralEdge {
  return Object.freeze({
    identity: `${relation}:${from}#${selector}->${to}`,
    from,
    to,
    relation,
    provenance: relation === 'mentions' ? 'derived' as const : 'authored' as const,
    owner: Object.freeze({kind: 'text_source' as const, path, selector}),
    state,
    raw,
    normalizedTarget: to,
    selector: Object.freeze({precision: 'fragment' as const, value: selector}),
  });
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
