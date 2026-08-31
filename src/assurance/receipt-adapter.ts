// Cladding · Spec 0.2 F6 · receipt re-verification adapter for closure inputs.

import {parsePortableReceiptYaml, receiptDigest, type ReceiptExpectedDigestContext, type TrustSnapshot} from '../proof/receipt.js';
import {createVerifiedReceiptInput} from '../proof/view.js';

/** Untrusted persisted receipt bytes plus the current, caller-injected closure context. */
export interface PersistedReceiptCandidate {
  readonly bytes: string | Uint8Array;
  readonly expected: ReceiptExpectedDigestContext;
}

/** Current receipt identity bound to its semantic subject, safe for verification closures. */
export interface CurrentReceiptIdentity {
  readonly address: string;
  readonly identity: string;
}

/**
 * Re-parses and re-verifies receipt bytes through the F5 factory each time.
 * Stored derived labels, timestamps, paths, and caller assertions never become
 * receipt authority at this seam.
 */
export function currentReceiptIdentities(
  candidates: readonly PersistedReceiptCandidate[],
  trustSnapshot: TrustSnapshot,
): readonly CurrentReceiptIdentity[] {
  const entries: CurrentReceiptIdentity[] = [];
  for (const candidate of candidates) {
    let receipt: unknown;
    try { receipt = parsePortableReceiptYaml(candidate.bytes); } catch { continue; }
    const verified = createVerifiedReceiptInput({receipt, trustSnapshot, expected: candidate.expected});
    if (!verified) continue;
    entries.push({address: verified.receipt.subject, identity: receiptDigest(verified.receipt)});
  }
  return entries.sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0);
}
