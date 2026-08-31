// Cladding · Spec 0.2 F5 · create-only portable receipt ingestion.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {compileSpecWorkspaceWithLockHeld} from '../spec/compiler/compile.js';
import {
  commitSpecTransactionFiles,
  readSpecTransactionBytes,
  requiredRootSchema,
  withSpecWorkspaceLock,
} from '../spec/transaction.js';
import {
  emptyTrustSnapshot,
  parsePortableReceiptYaml,
  receiptDigest,
  receiptFeatureId,
  serializePortableReceipt,
  validateReceiptAgainstCurrentCriteria,
  verifyPortableReceipt,
  type PortableReceipt,
  type ReceiptExpectedDigestContext,
  type ReceiptVerification,
  type TrustSnapshot,
} from './receipt.js';

/** The shared mutation ceiling also applies before a receipt enters the journal. */
export const PORTABLE_RECEIPT_MAX_BYTES = 16 * 1024;

/** Input for a receipt ingress path. Trust is injected by the composition root. */
export interface ReceiptIngestRequest {
  readonly cwd: string;
  readonly receiptYaml: string | Uint8Array;
  readonly trustSnapshot?: TrustSnapshot;
  readonly expected?: ReceiptExpectedDigestContext;
  /** Compatibility guard for a file-based caller; never used to select storage. */
  readonly declaredPath?: string;
  /** Test-only transaction fault seam proving journal recovery. */
  readonly faultAfterReplacementForTesting?: number;
}

/** One ingestion result. Invalid and malformed input never returns a storage path. */
export interface ReceiptIngestResult {
  readonly ok: boolean;
  readonly code: 'OK' | 'INVALID_RECEIPT' | 'INVALID_SIGNATURE' | 'EXPECTED_DIGEST_MISMATCH' | 'INVALID_WORKSPACE' | 'CREATE_ONLY_CONFLICT' | 'INVALID_PATH' | 'BUSY';
  readonly message: string;
  readonly changed: boolean;
  readonly idempotent?: boolean;
  readonly path?: string;
  readonly digest?: string;
  readonly verification?: ReceiptVerification;
}

/**
 * Parses, verifies, and stores one receipt through the F4 lock/journal path.
 * It intentionally has no key argument, network channel, or product signer.
 */
export function ingestPortableReceipt(request: ReceiptIngestRequest): ReceiptIngestResult {
  if (Buffer.byteLength(request.receiptYaml) > PORTABLE_RECEIPT_MAX_BYTES) {
    return failure('INVALID_RECEIPT', 'The receipt exceeds the 16 KiB portable mutation limit.');
  }
  let receipt: PortableReceipt;
  try { receipt = parsePortableReceiptYaml(request.receiptYaml); } catch (error) {
    return failure('INVALID_RECEIPT', (error as Error).message);
  }
  const digest = receiptDigest(receipt);
  const featureId = receiptFeatureId(receipt);
  const path = `spec/evidence/${featureId}/${digest}.yaml`;
  if (request.declaredPath !== undefined && request.declaredPath !== path) {
    return failure('INVALID_PATH', 'Receipt storage paths are derived from the signed subject and complete receipt digest.');
  }
  const serialized = serializePortableReceipt(receipt);
  try {
    return withSpecWorkspaceLock(request.cwd, () => {
      if (requiredRootSchema(request.cwd) !== '0.2') {
        return failure('INVALID_WORKSPACE', 'Portable receipts require a schema 0.2 workspace.');
      }
      const compilation = compileSpecWorkspaceWithLockHeld(request.cwd);
      const featureAddress = `feature:${featureId}`;
      if (!compilation.nodes.some((node) => node.address === featureAddress && node.nodeType === 'semantic')) {
        return failure('INVALID_WORKSPACE', 'Receipt subject references an unknown current feature.');
      }
      if (receipt.subject.startsWith('criterion:') && !compilation.nodes.some((node) => node.address === receipt.subject && node.nodeType === 'semantic')) {
        return failure('INVALID_WORKSPACE', 'Receipt subject references an unknown current criterion.');
      }
      const criteriaByFeature = new Map<string, Set<string>>();
      for (const node of compilation.nodes) {
        if (node.nodeType !== 'semantic' || node.kind !== 'criterion' || !node.address.startsWith('criterion:')) continue;
        const address = node.address.slice('criterion:'.length);
        const feature = address.split('/')[0]!;
        const entries = criteriaByFeature.get(feature) ?? new Set<string>();
        entries.add(`criterion:${address}`);
        criteriaByFeature.set(feature, entries);
      }
      try { validateReceiptAgainstCurrentCriteria(receipt, criteriaByFeature); } catch (error) {
        return failure('INVALID_RECEIPT', (error as Error).message);
      }
      const verification = verifyPortableReceipt(receipt, request.trustSnapshot ?? emptyTrustSnapshot(), request.expected);
      if (verification.assurance === 'invalid') {
        return failure(
          verification.reason === 'expected_digest_mismatch' ? 'EXPECTED_DIGEST_MISMATCH' : 'INVALID_SIGNATURE',
          verification.reason === 'expected_digest_mismatch' ? 'Receipt claims do not match the typed expected digest context.' : 'Receipt signature is not valid for its registered issuer.',
          verification,
        );
      }
      const existing = readSpecTransactionBytes(request.cwd, path);
      if (existing !== null) {
        if (existing === serialized) {
          return {ok: true, code: 'OK', message: 'The identical receipt is already stored.', changed: false, idempotent: true, path, digest, verification};
        }
        return failure('CREATE_ONLY_CONFLICT', 'A different receipt already occupies the derived content address.', verification);
      }
      // `readSpecTransactionBytes` and the journal both reject symlinks and
      // third-state preimages.  The second check below is intentionally under
      // the same lock, so a concurrent distinct digest cannot overwrite it.
      if (existsSync(join(request.cwd, path))) return failure('CREATE_ONLY_CONFLICT', 'Receipt target changed while ingestion was prepared.', verification);
      commitSpecTransactionFiles(request.cwd, [{path, before: null, after: serialized}], request.faultAfterReplacementForTesting);
      return {
        ok: true, code: 'OK', message: verification.assurance === 'verified'
          ? 'The signed receipt was stored and verified offline.'
          : 'The receipt was stored as asserted evidence pending offline resolution.',
        changed: true, path, digest, verification,
      };
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('BUSY')) return failure('BUSY', message);
    return failure('INVALID_WORKSPACE', message);
  }
}

function failure(
  code: Exclude<ReceiptIngestResult['code'], 'OK'>,
  message: string,
  verification?: ReceiptVerification,
): ReceiptIngestResult {
  return {ok: false, code, message, changed: false, ...(verification ? {verification} : {})};
}
