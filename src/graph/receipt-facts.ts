// Cladding · Spec 0.2 F8 · receipt observation facts for GraphIR.

import {createHash} from 'node:crypto';

import {artifactAddress} from '../spec/compiler/graph-address.js';
import type {
  GraphIrV2Augmentation,
  GraphIrV2AugmentationNode,
  GraphIrV2ObservationEdge,
} from '../spec/compiler/graph-ir-v2.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import {receiptFileCensus, type CurrentReceiptFile} from '../spec/attestation.js';
import {
  parsePortableReceiptYaml,
  receiptDigest,
  receiptFeatureId,
  type PortableReceipt,
  type ReceiptExpectedDigestContext,
  type TrustSnapshot,
} from '../proof/receipt.js';
import {createVerifiedReceiptInput} from '../proof/view.js';

const LAYER_ID = 'receipt-observations';
const OBSERVATION_ADAPTER = 'receipt-facts@1';

/**
 * Host-owned verification material for one receipt fact read.
 *
 * The graph never loads issuer keys or closure digests itself: without both,
 * a receipt's truth state stays explicitly unknown instead of being assumed.
 *
 * @since 0.10.0
 * @internal
 */
export interface ReceiptFactTrust {
  /** Installation-supplied trusted issuer keys. */
  readonly trustSnapshot: TrustSnapshot;
  /** Current expected closure digests for one receipt, or undefined when unresolved. */
  readonly expectedDigests: (receipt: PortableReceipt) => ReceiptExpectedDigestContext | undefined;
}

/**
 * Converts the safe receipt-file census into observed GraphIR evidence facts.
 *
 * A canonical signed receipt is one immutable `evidence`-role artifact. This
 * layer exposes its address, provenance, state, and digest; it never copies a
 * receipt body, signature, or issuer key into the graph, so a graph read can
 * never become a second receipt authority.
 *
 * @param cwd - Workspace root containing `spec/evidence`.
 * @param compilation - Immutable compiler snapshot that owns every subject address.
 * @param trust - Host-owned verification material; omitted leaves every state unknown.
 * @returns Frozen complete or unknown augmentation with deterministic observed facts.
 * @example
 * ```ts
 * const layer = receiptFactAugmentation(process.cwd(), compilation);
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-4f8c2542
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-d452908b
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 * @since 0.10.0
 * @internal
 */
export function receiptFactAugmentation(
  cwd: string,
  compilation: SpecCompilation,
  trust?: ReceiptFactTrust,
): GraphIrV2Augmentation {
  const census = receiptFileCensus(cwd);
  if (census === undefined) {
    return freezeLayer({
      layerId: LAYER_ID,
      nodes: [],
      edges: [],
      completeness: 'unknown',
      unknownReasons: ['receipt census is unsafe'],
    });
  }

  const addresses = new Set(compilation.nodes
    .filter((node) => node.nodeType === 'semantic')
    .map((node) => node.address));
  const nodes: GraphIrV2AugmentationNode[] = [];
  const edges: GraphIrV2ObservationEdge[] = [];
  const reasons: string[] = [];
  for (const file of census) {
    const receipt = parseReceipt(file);
    const artifact = artifactAddress(file.path);
    if (!receipt) {
      // A file the census admitted but this reader cannot parse keeps its
      // address without any claim attached to it.
      reasons.push(`receipt ${file.path} is not a portable receipt`);
      nodes.push(evidenceNode(artifact, [], sha256(file.bytes)));
      continue;
    }
    const digest = receiptDigest(receipt);
    const feature = `feature:${receiptFeatureId(receipt)}`;
    nodes.push(evidenceNode(artifact, addresses.has(feature) ? [feature] : [], digest));
    if (!addresses.has(receipt.subject)) {
      reasons.push(`receipt ${file.path} names unknown subject ${receipt.subject}`);
      continue;
    }
    if (!receipt.subject.startsWith('criterion:')) {
      // `supports` is a criterion-scoped relation. A feature-scoped receipt
      // keeps its artifact owner rather than widening the GraphIR grammar.
      reasons.push(`receipt ${file.path} names feature subject ${receipt.subject} that carries no criterion-scoped supports fact`);
      continue;
    }
    edges.push(supportsEdge(receipt.subject, artifact, digest, receiptState(receipt, trust)));
  }
  // The kernel keeps reasons and completeness in lockstep: a reason is exactly
  // what makes an answer incomplete. A receipt this reader could not turn into
  // a fact still travels as an addressed artifact, but the layer says so.
  return freezeLayer({
    layerId: LAYER_ID,
    nodes: nodes.sort((left, right) => left.address.localeCompare(right.address)),
    edges: edges.sort((left, right) => left.identity.localeCompare(right.identity)),
    completeness: reasons.length === 0 ? 'complete' : 'unknown',
    unknownReasons: [...new Set(reasons)].sort(),
  });
}

function parseReceipt(file: CurrentReceiptFile): PortableReceipt | undefined {
  try {
    return parsePortableReceiptYaml(file.bytes);
  } catch {
    return undefined;
  }
}

/** The receipt file itself, addressed and role-tagged without copying its body. */
function evidenceNode(artifact: string, owners: readonly string[], reference: string): GraphIrV2AugmentationNode {
  return Object.freeze({
    address: artifact,
    nodeType: 'artifact' as const,
    roles: Object.freeze(['evidence' as const]),
    owners: Object.freeze([...owners]),
    provenance: 'observed' as const,
    locator: Object.freeze({kind: 'runtime_observation' as const, adapter: OBSERVATION_ADAPTER, reference}),
  });
}

function supportsEdge(
  subject: string,
  artifact: string,
  digest: string,
  state: 'passed' | 'failed' | 'unknown',
): GraphIrV2ObservationEdge {
  return Object.freeze({
    identity: `${OBSERVATION_ADAPTER}:${subject}->${artifact}:${digest}`,
    from: subject,
    to: artifact,
    relation: 'supports' as const,
    provenance: 'observed' as const,
    owner: Object.freeze({kind: 'runtime_observation' as const, adapter: OBSERVATION_ADAPTER, reference: digest}),
    state,
    channel: 'evidence' as const,
    normalizedTarget: artifact,
  });
}

/**
 * Reduces one receipt to a truth state only through the F5 verification seam.
 *
 * Absent trust material is not a failure and not a pass: an unverifiable
 * receipt is explicitly unknown, so a graph read can never launder an
 * unsigned claim into evidence.
 */
function receiptState(receipt: PortableReceipt, trust: ReceiptFactTrust | undefined): 'passed' | 'failed' | 'unknown' {
  if (!trust) return 'unknown';
  const expected = trust.expectedDigests(receipt);
  if (!expected) return 'unknown';
  const verified = createVerifiedReceiptInput({receipt, trustSnapshot: trust.trustSnapshot, expected});
  if (!verified) return 'unknown';
  return receiptClaimsPass(verified.receipt) ? 'passed' : 'failed';
}

function receiptClaimsPass(receipt: PortableReceipt): boolean {
  if (receipt.method === 'blind_capability') return receipt.verdict === 'pass';
  if (receipt.claim === 'uat') {
    return Object.values(receipt.criterion_verdicts).every((verdict) => verdict === 'pass')
      && Object.values(receipt.checks).every((check) => check === 'pass');
  }
  return Object.values(receipt.checks).every((check) => check === 'pass');
}

function sha256(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function freezeLayer(layer: GraphIrV2Augmentation): GraphIrV2Augmentation {
  return Object.freeze({
    ...layer,
    nodes: Object.freeze([...layer.nodes]),
    edges: Object.freeze([...layer.edges]),
    unknownReasons: Object.freeze([...layer.unknownReasons]),
  });
}
