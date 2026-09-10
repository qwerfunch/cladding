// Cladding · Spec 0.2 F9d/F-a0bd9c5a · the one receipt census every closure consumer shares.
//
// The verification closure of a schema 0.2 feature includes the identity of
// every verified receipt on disk. Two independent consumers seal that closure
// — the gate that mints an attestation row and the drift detector that later
// asks whether the row is still fresh — and a third (the expected-digest
// producer) must deliberately stay OUTSIDE it. Assembling the census in each
// consumer is what let the writer and the run authority drift apart, so it is
// assembled here once and read from one place.

import {parsePortableReceiptYaml, type PortableReceipt, type ReceiptExpectedDigestContext, type TrustSnapshot} from '../proof/receipt.js';
import {loadTrustSnapshot} from '../proof/trust.js';
import {receiptFileCensus} from '../spec/attestation.js';
import type {AssuranceClosureInput} from './closures.js';
import {workspaceExpectedDigestProducer, type WorkspaceReceiptContext} from './workspace.js';

/**
 * The current receipt/trust view of one workspace.
 *
 * `receiptContext` is absent exactly when `receiptFileCensus` could not prove
 * the walk complete (a symlink, a non-file, a non-canonical receipt path). An
 * unprovable census is unresolved, never an empty receipt set: substituting
 * `[]` would let a consumer seal a closure that silently omits real receipts.
 *
 * @since 0.10.0
 * @internal
 */
export interface WorkspaceReceiptCensus {
  /** The committed public trust registry; empty when no registry exists. */
  readonly trustSnapshot: TrustSnapshot;
  /** Present only when the receipt census is provably complete. */
  readonly receiptContext?: WorkspaceReceiptContext;
}

/**
 * Assembles the receipt/trust context both closure consumers must agree on.
 *
 * @param cwd - Workspace root holding `spec/evidence` and `spec/trust`.
 * @param closures - The RECEIPT-FREE closure input for this compiler snapshot.
 *   Expected digests are derived from it, so passing a receipt-carrying
 *   closure would make each receipt's `reviewed_inputs_sha256` depend on
 *   itself and on its siblings.
 * @returns The trust snapshot, plus the receipt context when the census is complete.
 * @throws Never.
 * @example
 * ```ts
 * const {trustSnapshot, receiptContext} = workspaceReceiptCensus('.', baseClosures);
 * ```
 * @since 0.10.0
 * @internal
 */
export function workspaceReceiptCensus(cwd: string, closures: AssuranceClosureInput): WorkspaceReceiptCensus {
  const trustSnapshot = loadTrustSnapshot(cwd);
  const census = receiptFileCensus(cwd);
  if (census === undefined) return {trustSnapshot};
  const expectedFor = workspaceExpectedDigestProducer(cwd, closures);
  // One expected-digest resolution per census file feeds both the candidate
  // snapshot and the writer's location census, which must agree exactly.
  const resolved = census.map((file) => ({
    path: file.path, bytes: file.bytes, expected: expectedDigestsForReceiptFile(file, expectedFor),
  }));
  return {
    trustSnapshot,
    receiptContext: {
      candidates: resolved.map((file) => ({bytes: file.bytes, expected: file.expected})),
      trustSnapshot,
      // The writer rereads these exact paths under the F4 lock; without the
      // census a non-empty candidate set can never retain a sibling row.
      currentLocations: resolved.map((file) => ({path: file.path, expected: file.expected})),
    },
  };
}

/**
 * Resolves one census file's expected digests without trusting its stored bytes.
 *
 * A file the census already proved canonical still gets reparsed here: the
 * expected context belongs to the CURRENT closure, and an unresolvable subject
 * must leave the context empty rather than borrowing a neighbour's digests.
 */
function expectedDigestsForReceiptFile(
  file: {readonly bytes: string},
  expectedFor: (receipt: PortableReceipt) => ReceiptExpectedDigestContext | undefined,
): ReceiptExpectedDigestContext {
  try { return expectedFor(parsePortableReceiptYaml(file.bytes)) ?? {}; } catch { return {}; }
}
