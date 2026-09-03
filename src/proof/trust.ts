// Cladding · Spec 0.2 F9d · committed public trust registry and evidence wiring.
//
// D20 originally said the trust snapshot arrives from "the Cladding
// installation or a registered host adapter outside the writable workspace".
// F9d relaxes that to the shape a real project can actually operate: the
// PUBLIC half is `spec/trust/issuers.yaml`, committed and reviewed like any
// other contract, while the PRIVATE half stays outside the workspace (see
// issuer.ts). Two properties make the committed half safe:
//
//   • it holds no secret — an SPKI public key proves nothing on its own;
//   • adding a key moves `trust_snapshot_sha256`, which re-mints every
//     attestation row, so a key addition is loud in review rather than quiet.
//
// Absence is the default and must stay byte-identical to the pre-F9d ledger:
// no registry means `emptyTrustSnapshot()`, whose digest is what every current
// attestation row already records.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {parse as parseYaml} from 'yaml';

import {assuranceClosureInputFromWorkspace, workspaceExpectedDigestProducer} from '../assurance/workspace.js';
import {compileSpecWorkspace} from '../spec/compiler/compile.js';
import {readSpecTransactionBytes} from '../spec/transaction.js';
import {
  ReceiptFormatError,
  createTrustSnapshot,
  emptyTrustSnapshot,
  issuerKeyIdForSpki,
  type PortableReceipt,
  type ReceiptExpectedDigestContext,
  type TrustSnapshot,
  type TrustedIssuerKey,
} from './receipt.js';

/** Repository-relative path of the committed public issuer registry. */
export const TRUST_REGISTRY_PATH = 'spec/trust/issuers.yaml';

/** The only registry schema the loader accepts. */
export const TRUST_REGISTRY_SCHEMA = '1' as const;

/** One committed public issuer entry, exactly as the registry stores it. */
export interface TrustRegistryEntry {
  readonly issuer: string;
  readonly issuer_key_id: string;
  /** Base64 DER SubjectPublicKeyInfo bytes. */
  readonly spki_der: string;
}

/**
 * Parses the registry document into typed trusted keys.
 *
 * Every rejection is fail-closed: a registry this loader cannot fully
 * understand must never become a partially trusted snapshot.
 *
 * @param source - Registry YAML bytes.
 * @returns Trusted issuer keys ready for `createTrustSnapshot`.
 * @throws ReceiptFormatError for any malformed or unknown registry shape.
 */
export function parseTrustRegistry(source: string): readonly TrustedIssuerKey[] {
  let document: unknown;
  try { document = parseYaml(source, {uniqueKeys: true}); } catch (error) {
    throw new ReceiptFormatError(`The trust registry is not valid YAML: ${(error as Error).message}`);
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new ReceiptFormatError('The trust registry must be a mapping.');
  }
  const record = document as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'schema' && key !== 'issuers') throw new ReceiptFormatError(`Unknown trust registry field ${key}.`);
  }
  if (record.schema !== TRUST_REGISTRY_SCHEMA) throw new ReceiptFormatError('The trust registry schema must be the string "1".');
  const issuers = record.issuers;
  if (!Array.isArray(issuers)) throw new ReceiptFormatError('The trust registry requires an issuers sequence.');
  return Object.freeze(issuers.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new ReceiptFormatError('Each trust registry issuer must be a mapping.');
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (key !== 'issuer' && key !== 'issuer_key_id' && key !== 'spki_der') throw new ReceiptFormatError(`Unknown trust registry issuer field ${key}.`);
    }
    const issuer = item.issuer;
    const issuerKeyId = item.issuer_key_id;
    const spkiDerBase64 = item.spki_der;
    if (typeof issuer !== 'string' || issuer.trim().length === 0) throw new ReceiptFormatError('A trust registry issuer name must be a non-empty string.');
    if (typeof issuerKeyId !== 'string' || !/^[a-f0-9]{64}$/.test(issuerKeyId)) throw new ReceiptFormatError('A trust registry issuer_key_id must be a lowercase SHA-256 digest.');
    if (typeof spkiDerBase64 !== 'string' || spkiDerBase64.length === 0) throw new ReceiptFormatError('A trust registry spki_der must be base64 DER SubjectPublicKeyInfo bytes.');
    const spkiDer = new Uint8Array(Buffer.from(spkiDerBase64, 'base64'));
    // Round-trip so a mistyped or truncated base64 body cannot silently
    // resolve to a different key than the one that was reviewed.
    if (Buffer.from(spkiDer).toString('base64') !== spkiDerBase64) throw new ReceiptFormatError('A trust registry spki_der must be canonical base64.');
    return {issuer, issuerKeyId, spkiDer};
  }));
}

/** Serializes registry entries back to the canonical committed document. */
export function serializeTrustRegistry(entries: readonly TrustRegistryEntry[]): string {
  const sorted = [...entries].sort((left, right) =>
    `${left.issuer_key_id}\u0000${left.issuer}` < `${right.issuer_key_id}\u0000${right.issuer}` ? -1 : 1);
  const lines = [`schema: "${TRUST_REGISTRY_SCHEMA}"`, 'issuers:'];
  if (sorted.length === 0) return `${['schema: "1"', 'issuers: []'].join('\n')}\n`;
  for (const entry of sorted) {
    lines.push(`  - issuer: ${JSON.stringify(entry.issuer)}`);
    lines.push(`    issuer_key_id: ${entry.issuer_key_id}`);
    lines.push(`    spki_der: ${entry.spki_der}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Reads the committed registry entries, or an empty list when it is absent. */
export function readTrustRegistry(cwd: string): readonly TrustRegistryEntry[] {
  const bytes = registryBytes(cwd);
  if (bytes === null) return [];
  return parseTrustRegistry(bytes).map((key) => ({
    issuer: key.issuer,
    issuer_key_id: key.issuerKeyId,
    spki_der: Buffer.from(key.spkiDer).toString('base64'),
  }));
}

/**
 * Builds the workspace trust snapshot from the committed public registry.
 *
 * @param cwd - Workspace root.
 * @returns The registry snapshot, or the empty snapshot when no registry exists.
 * @throws ReceiptFormatError when a present registry is malformed.
 * @example
 * ```ts
 * const trust = loadTrustSnapshot(process.cwd());
 * ```
 * @since 0.10.0
 * @internal
 */
export function loadTrustSnapshot(cwd: string): TrustSnapshot {
  const bytes = registryBytes(cwd);
  // An absent registry is a proved empty trust set, not an unknown one: its
  // digest is exactly today's, so no attestation row moves.
  if (bytes === null) return emptyTrustSnapshot();
  return createTrustSnapshot(parseTrustRegistry(bytes));
}

/**
 * Adds one public key to the registry document.
 *
 * @param cwd - Workspace root.
 * @param entry - Issuer name and the DER SPKI bytes to register.
 * @returns Previous registry bytes (null when absent) and the replacement bytes.
 * @throws ReceiptFormatError when the issuer or its key id is already registered.
 */
export function trustRegistryAddition(
  cwd: string,
  entry: {readonly issuer: string; readonly spkiDer: Uint8Array},
): {readonly before: string | null; readonly after: string; readonly issuerKeyId: string} {
  const before = registryBytes(cwd);
  const existing = before === null ? [] : readTrustRegistryFrom(before);
  const issuerKeyId = issuerKeyIdForSpki(entry.spkiDer);
  if (existing.some((candidate) => candidate.issuer === entry.issuer)) {
    throw new ReceiptFormatError(`Issuer ${entry.issuer} is already registered in ${TRUST_REGISTRY_PATH}.`);
  }
  if (existing.some((candidate) => candidate.issuer_key_id === issuerKeyId)) {
    throw new ReceiptFormatError(`Issuer key ${issuerKeyId} is already registered in ${TRUST_REGISTRY_PATH}.`);
  }
  const after = serializeTrustRegistry([...existing, {
    issuer: entry.issuer, issuer_key_id: issuerKeyId, spki_der: Buffer.from(entry.spkiDer).toString('base64'),
  }]);
  return {before, after, issuerKeyId};
}

/** Registered public entries paired with local private-key availability. */
export interface TrustRegistryListing extends TrustRegistryEntry {
  readonly signingKeyPresent: boolean;
}

/** Injected F5 verification material for the MCP and CLI evidence paths. */
export interface EvidenceOperationsProvider {
  readonly trustSnapshot: TrustSnapshot;
  readonly expectedDigestContext: (receipt: PortableReceipt) => ReceiptExpectedDigestContext | undefined;
}

/**
 * Builds the workspace's registered evidence operations for a long-lived host.
 *
 * `trustSnapshot` is a getter on purpose: `clad key create` may register an
 * issuer while `clad serve` is already running, and a value captured at boot
 * would keep verifying against a registry the workspace no longer has. Both
 * members fail closed — an unreadable registry yields the empty snapshot
 * (unknown issuer, asserted evidence) and an unresolvable closure yields no
 * expected context (missing context, asserted evidence). Neither can
 * manufacture a verification.
 *
 * @param cwd - Workspace root.
 * @returns Trust and expected-digest operations for the serve/CLI boundary.
 * @example
 * ```ts
 * const server = buildServer({cwd, evidence: evidenceOperations(cwd)});
 * ```
 * @since 0.10.0
 * @internal
 */
export function evidenceOperations(cwd: string): EvidenceOperationsProvider {
  return {
    get trustSnapshot(): TrustSnapshot {
      try { return loadTrustSnapshot(cwd); } catch { return emptyTrustSnapshot(); }
    },
    expectedDigestContext: (receipt) => {
      try {
        // The producer is built per call so a receipt ingested after a source
        // edit is compared against the current closure, never a boot snapshot.
        return workspaceExpectedDigestProducer(cwd, assuranceClosureInputFromWorkspace(cwd, compileSpecWorkspace(cwd)))(receipt);
      } catch {
        return undefined;
      }
    },
  };
}

/** Reads registry bytes through the managed-path boundary, or null when absent. */
function registryBytes(cwd: string): string | null {
  try {
    if (!existsSync(join(cwd, TRUST_REGISTRY_PATH))) return null;
    return readSpecTransactionBytes(cwd, TRUST_REGISTRY_PATH);
  } catch (error) {
    throw new ReceiptFormatError(`The trust registry could not be read safely: ${(error as Error).message}`);
  }
}

function readTrustRegistryFrom(bytes: string): readonly TrustRegistryEntry[] {
  return parseTrustRegistry(bytes).map((key) => ({
    issuer: key.issuer,
    issuer_key_id: key.issuerKeyId,
    spki_der: Buffer.from(key.spkiDer).toString('base64'),
  }));
}
