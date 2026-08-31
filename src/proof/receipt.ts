// Cladding · Spec 0.2 F5 · portable receipt parsing, framing, and offline verification.

import {createHash, createPublicKey, verify} from 'node:crypto';
import {TextDecoder} from 'node:util';

import {isAlias, isMap, isScalar, isSeq, parseDocument, type Node} from 'yaml';

/** The only portable receipt schema accepted by the F5 kernel. */
export const RECEIPT_SCHEMA = '1' as const;
export const RECEIPT_DOMAIN = 'cladding.receipt/1' as const;

export type ReceiptCheck = 'pass' | 'fail';
export type ReceiptSubject = `feature:${string}` | `criterion:${string}/${string}`;

/** Common signed receipt claims. Derived assurance and freshness are absent by design. */
export interface ReceiptBase {
  readonly receipt_schema: typeof RECEIPT_SCHEMA;
  readonly issuer: string;
  readonly issuer_key_id: string;
  readonly issuer_proof: string;
  readonly subject: ReceiptSubject;
  readonly subject_sha256: string;
  /** Exact 24-byte UTC timestamp metadata; it is never a freshness clock. */
  readonly observed_at: string;
}

/** Shared signed human-review inputs. */
export interface HumanReceiptBase extends ReceiptBase {
  readonly method: 'human_channel';
  readonly reviewed_inputs_sha256: string;
  readonly runtime_dependency_sha256: string;
  readonly implementation_authors_sha256: string;
}

/** Criterion-scoped human audit claim. */
export interface AuditReceipt extends HumanReceiptBase {
  readonly claim: 'audit';
  readonly subject: `criterion:${string}/${string}`;
  readonly checks: Readonly<{evidence_sufficiency: ReceiptCheck; code_test_review: ReceiptCheck; independence: ReceiptCheck}>;
}

/** Feature-scoped UAT claim. */
export interface UatReceipt extends HumanReceiptBase {
  readonly claim: 'uat';
  readonly subject: `feature:${string}`;
  readonly criterion_verdicts: Readonly<Record<`criterion:${string}/${string}`, ReceiptCheck>>;
  readonly checks: Readonly<{no_surprise: ReceiptCheck; tradeoff_acceptance: ReceiptCheck}>;
}

/** Signed blind capability claim. `verdict` is an issuer claim, not a derived field. */
export interface BlindReceipt extends ReceiptBase {
  readonly method: 'blind_capability';
  readonly claim: 'independent_oracle';
  readonly verdict: ReceiptCheck;
  readonly evidence: Readonly<{locator: string; sha256: string}>;
  readonly capability_manifest_sha256: string;
}

/** Every receipt shape F5 can parse and preserve. */
export type PortableReceipt = AuditReceipt | UatReceipt | BlindReceipt;

/** A registered public key supplied outside the writable workspace. */
export interface TrustedIssuerKey {
  readonly issuer: string;
  /** Lowercase SHA-256 of the exact DER SubjectPublicKeyInfo bytes. */
  readonly issuerKeyId: string;
  readonly spkiDer: Uint8Array;
}

/** Immutable normalized key form retained inside a trust snapshot. */
export interface TrustSnapshotKey {
  readonly issuer: string;
  readonly issuerKeyId: string;
  /** Canonical base64 of DER SPKI avoids mutable byte-array authority. */
  readonly spkiDerBase64: string;
}

/** Immutable installation/host supplied trust material. */
export interface TrustSnapshot {
  readonly keys: readonly TrustSnapshotKey[];
  readonly digest: string;
}

/** Typed expected closure inputs; absence is unresolved rather than inferred. */
export interface ReceiptExpectedDigestContext {
  readonly subjectSha256?: string;
  readonly reviewedInputsSha256?: string;
  readonly runtimeDependencySha256?: string;
  readonly implementationAuthorsSha256?: string;
  readonly evidenceSha256?: string;
  readonly capabilityManifestSha256?: string;
}

/** Offline verification outcome, deliberately not serializable into a receipt. */
export interface ReceiptVerification {
  readonly assurance: 'verified' | 'asserted' | 'invalid';
  readonly currentness: 'current' | 'stale' | 'unresolved';
  readonly reason:
    | 'verified'
    | 'unknown_issuer_key'
    | 'invalid_signature'
    | 'issuer_mismatch'
    | 'missing_expected_context'
    | 'expected_digest_mismatch';
  readonly trustSnapshotDigest: string;
}

/** Validates feature-local UAT matrix membership after the compiler owns current criteria. */
export function validateReceiptAgainstCurrentCriteria(
  receipt: PortableReceipt,
  criteriaByFeature: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  if (receipt.method !== 'human_channel' || receipt.claim !== 'uat') return;
  const featureId = receiptFeatureId(receipt);
  const current = criteriaByFeature.get(featureId);
  if (!current) throw new ReceiptFormatError(`UAT receipt subject feature ${featureId} is not present in the current compiler view.`);
  for (const address of Object.keys(receipt.criterion_verdicts)) {
    if (!address.startsWith(`criterion:${featureId}/`) || !current.has(address)) {
      throw new ReceiptFormatError(`UAT criterion_verdicts address ${address} is outside the receipt subject feature or current compiler criteria.`);
    }
  }
}

/** A parser error that never permits an evidence write. */
export class ReceiptFormatError extends Error {}

const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const FEATURE_SUBJECT = /^feature:(F-[a-z0-9]+)$/;
const CRITERION_SUBJECT = /^criterion:(F-[a-z0-9]+)\/(AC-[a-z0-9]+)$/;
const CRITERION_ADDRESS = /^criterion:F-[a-z0-9]+\/AC-[a-z0-9]+$/;

/** Parses strict YAML into one typed portable receipt. */
export function parsePortableReceiptYaml(source: string | Uint8Array): PortableReceipt {
  const text = decodeUtf8(source);
  assertUnicodeScalars(text);
  const document = parseDocument(text, {schema: 'core', uniqueKeys: true, prettyErrors: false});
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new ReceiptFormatError(`Receipt YAML is invalid: ${[...document.errors, ...document.warnings].map((issue) => issue.message).join(' ')}`);
  }
  inspectYamlNode(document.contents);
  const value = document.toJS({mapAsMap: false});
  assertJsonValue(value);
  return validateReceipt(value);
}

/** RFC 8785-compatible canonical JSON for JSON-safe receipt data. */
export function canonicalizeJson(value: unknown): string {
  assertJsonValue(value);
  return canonicalize(value);
}

/** Returns the exact detached-signature payload after omitting issuer_proof. */
export function receiptSigningPayload(receipt: PortableReceipt): Uint8Array {
  const unsigned = omitIssuerProof(receipt);
  const payload = Buffer.from(canonicalizeJson(unsigned), 'utf8');
  const domain = Buffer.from(RECEIPT_DOMAIN, 'ascii');
  const frame = Buffer.allocUnsafe(4 + domain.length + 8 + payload.length);
  frame.writeUInt32BE(domain.length, 0);
  domain.copy(frame, 4);
  frame.writeBigUInt64BE(BigInt(payload.length), 4 + domain.length);
  payload.copy(frame, 12 + domain.length);
  return frame;
}

/** Digest used for the immutable evidence filename. */
export function receiptDigest(receipt: PortableReceipt): string {
  return createHash('sha256').update(canonicalizeJson(receipt), 'utf8').digest('hex');
}

/** JSON is valid YAML, so this is the deterministic portable on-disk form. */
export function serializePortableReceipt(receipt: PortableReceipt): string {
  return `${canonicalizeJson(receipt)}\n`;
}

/** Extracts the receipt feature directory without accepting a caller path. */
export function receiptFeatureId(receipt: PortableReceipt): string {
  const criterion = CRITERION_SUBJECT.exec(receipt.subject);
  if (criterion) return criterion[1];
  const feature = FEATURE_SUBJECT.exec(receipt.subject);
  if (feature) return feature[1];
  throw new ReceiptFormatError('Receipt subject has no valid feature address.');
}

/** Makes a deeply immutable trust snapshot after validating every SPKI identity. */
export function createTrustSnapshot(keys: readonly TrustedIssuerKey[] = []): TrustSnapshot {
  const normalized = keys.map((key) => {
    if (!key.issuer.trim()) throw new ReceiptFormatError('Trusted issuer names must be non-empty.');
    const spkiDer = new Uint8Array(key.spkiDer);
    const issuerKeyId = issuerKeyIdForSpki(spkiDer);
    if (key.issuerKeyId !== issuerKeyId) throw new ReceiptFormatError('Trusted issuer key id does not match its DER SPKI bytes.');
    // Parse now, before any receipt path can use malformed host material.
    const publicKey = createPublicKey({key: Buffer.from(spkiDer), format: 'der', type: 'spki'});
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new ReceiptFormatError('Trusted issuer SPKI keys must be Ed25519 public keys.');
    return Object.freeze({issuer: key.issuer, issuerKeyId, spkiDerBase64: Buffer.from(spkiDer).toString('base64')});
  }).sort((left, right) => compareUtf16(`${left.issuerKeyId}\u0000${left.issuer}`, `${right.issuerKeyId}\u0000${right.issuer}`));
  const unique = new Set<string>();
  for (const key of normalized) {
    if (unique.has(key.issuerKeyId)) throw new ReceiptFormatError(`Duplicate trusted issuer key id ${key.issuerKeyId}.`);
    unique.add(key.issuerKeyId);
  }
  const digest = createHash('sha256').update(canonicalizeJson(normalized.map((key) => ({
    issuer: key.issuer, issuer_key_id: key.issuerKeyId, spki_der: key.spkiDerBase64,
  }))), 'utf8').digest('hex');
  return Object.freeze({keys: Object.freeze(normalized), digest});
}

/** The default provider trusts nothing and therefore cannot manufacture verification. */
export function emptyTrustSnapshot(): TrustSnapshot {
  return createTrustSnapshot([]);
}

/** Computes the mandatory lowercase SPKI key identity. */
export function issuerKeyIdForSpki(spkiDer: Uint8Array): string {
  return createHash('sha256').update(spkiDer).digest('hex');
}

/** Verifies one portable receipt synchronously, offline, against a typed snapshot. */
export function verifyPortableReceipt(
  receipt: PortableReceipt,
  trustSnapshot: TrustSnapshot = emptyTrustSnapshot(),
  expected?: ReceiptExpectedDigestContext,
): ReceiptVerification {
  // Expected digest comparisons are deterministic receipt claims, not trust
  // policy. They therefore fail closed even when this host knows no issuer.
  const comparison = compareExpectedDigests(receipt, expected);
  if (comparison === 'mismatch') {
    return {assurance: 'invalid', currentness: 'stale', reason: 'expected_digest_mismatch', trustSnapshotDigest: trustSnapshot.digest};
  }
  const key = trustSnapshot.keys.find((candidate) => candidate.issuerKeyId === receipt.issuer_key_id);
  if (!key) return {assurance: 'asserted', currentness: 'unresolved', reason: 'unknown_issuer_key', trustSnapshotDigest: trustSnapshot.digest};
  if (key.issuer !== receipt.issuer) return {assurance: 'invalid', currentness: 'unresolved', reason: 'issuer_mismatch', trustSnapshotDigest: trustSnapshot.digest};
  const signature = decodeBase64Url(receipt.issuer_proof);
  const publicKey = createPublicKey({key: Buffer.from(key.spkiDerBase64, 'base64'), format: 'der', type: 'spki'});
  if (!verify(null, receiptSigningPayload(receipt), publicKey, signature)) {
    return {assurance: 'invalid', currentness: 'unresolved', reason: 'invalid_signature', trustSnapshotDigest: trustSnapshot.digest};
  }
  if (comparison === 'incomplete') {
    return {assurance: 'asserted', currentness: 'unresolved', reason: 'missing_expected_context', trustSnapshotDigest: trustSnapshot.digest};
  }
  return {assurance: 'verified', currentness: 'current', reason: 'verified', trustSnapshotDigest: trustSnapshot.digest};
}

function compareExpectedDigests(receipt: PortableReceipt, expected: ReceiptExpectedDigestContext | undefined): 'complete' | 'incomplete' | 'mismatch' {
  const entries: Array<readonly [string, string | undefined]> = [['subject_sha256', expected?.subjectSha256]];
  if (receipt.method === 'human_channel') {
    entries.push(['reviewed_inputs_sha256', expected?.reviewedInputsSha256]);
    entries.push(['runtime_dependency_sha256', expected?.runtimeDependencySha256]);
    entries.push(['implementation_authors_sha256', expected?.implementationAuthorsSha256]);
  } else {
    entries.push(['evidence.sha256', expected?.evidenceSha256]);
    entries.push(['capability_manifest_sha256', expected?.capabilityManifestSha256]);
  }
  let incomplete = false;
  for (const [field, expectedValue] of entries) {
    if (expectedValue === undefined) { incomplete = true; continue; }
    const actual = field === 'evidence.sha256'
      ? receipt.method === 'blind_capability' ? receipt.evidence.sha256 : undefined
      : receipt[field as keyof PortableReceipt] as string | undefined;
    if (actual !== expectedValue) return 'mismatch';
  }
  return incomplete ? 'incomplete' : 'complete';
}

function validateReceipt(value: unknown): PortableReceipt {
  const record = recordOf(value, 'Receipt must be a mapping.');
  const method = record.method;
  if (method === 'human_channel') return validateHumanReceipt(record);
  if (method === 'blind_capability') return validateBlindReceipt(record);
  throw new ReceiptFormatError('Receipt method must be human_channel or blind_capability.');
}

function validateHumanReceipt(record: Record<string, unknown>): HumanReceiptBase & (AuditReceipt | UatReceipt) {
  validateBase(record, new Set(['receipt_schema', 'issuer', 'issuer_key_id', 'issuer_proof', 'subject', 'subject_sha256', 'observed_at', 'method', 'claim', 'reviewed_inputs_sha256', 'runtime_dependency_sha256', 'implementation_authors_sha256', 'checks', 'criterion_verdicts']));
  const base = humanBase(record);
  if (record.claim === 'audit') {
    if (!CRITERION_SUBJECT.test(base.subject)) throw new ReceiptFormatError('An audit receipt must have a criterion subject.');
    if (Object.hasOwn(record, 'criterion_verdicts')) throw new ReceiptFormatError('An audit receipt cannot include criterion_verdicts.');
    return {...base, subject: base.subject as AuditReceipt['subject'], claim: 'audit', checks: checks(record.checks, ['evidence_sufficiency', 'code_test_review', 'independence']) as AuditReceipt['checks']};
  }
  if (record.claim === 'uat') {
    if (!FEATURE_SUBJECT.test(base.subject)) throw new ReceiptFormatError('A UAT receipt must have a feature subject.');
    const matrix = recordOf(record.criterion_verdicts, 'A UAT receipt requires criterion_verdicts.');
    const verdicts: Record<`criterion:${string}/${string}`, ReceiptCheck> = {};
    for (const [address, verdict] of Object.entries(matrix)) {
      if (!CRITERION_ADDRESS.test(address) || !isCheck(verdict)) throw new ReceiptFormatError('UAT criterion_verdicts must be canonical criterion addresses with pass or fail values.');
      verdicts[address as `criterion:${string}/${string}`] = verdict;
    }
    return {...base, subject: base.subject as UatReceipt['subject'], claim: 'uat', criterion_verdicts: verdicts, checks: checks(record.checks, ['no_surprise', 'tradeoff_acceptance']) as UatReceipt['checks']};
  }
  throw new ReceiptFormatError('A human receipt claim must be audit or uat.');
}

function validateBlindReceipt(record: Record<string, unknown>): BlindReceipt {
  validateBase(record, new Set(['receipt_schema', 'issuer', 'issuer_key_id', 'issuer_proof', 'subject', 'subject_sha256', 'observed_at', 'method', 'claim', 'verdict', 'evidence', 'capability_manifest_sha256']));
  if (record.claim !== 'independent_oracle') throw new ReceiptFormatError('A blind receipt claim must be independent_oracle.');
  if (!isCheck(record.verdict)) throw new ReceiptFormatError('A blind receipt verdict must be pass or fail.');
  const evidence = recordOf(record.evidence, 'A blind receipt requires evidence.');
  assertKeys(evidence, ['locator', 'sha256'], 'blind evidence');
  const locator = string(evidence.locator, 'Blind evidence locator must be non-empty.');
  const sha256 = digest(evidence.sha256, 'Blind evidence sha256');
  return {...base(record), method: 'blind_capability', claim: 'independent_oracle', verdict: record.verdict, evidence: {locator, sha256}, capability_manifest_sha256: digest(record.capability_manifest_sha256, 'capability_manifest_sha256')};
}

function humanBase(record: Record<string, unknown>): HumanReceiptBase {
  return {...base(record), method: 'human_channel', reviewed_inputs_sha256: digest(record.reviewed_inputs_sha256, 'reviewed_inputs_sha256'), runtime_dependency_sha256: digest(record.runtime_dependency_sha256, 'runtime_dependency_sha256'), implementation_authors_sha256: digest(record.implementation_authors_sha256, 'implementation_authors_sha256')};
}

function base(record: Record<string, unknown>): ReceiptBase {
  return {
    receipt_schema: RECEIPT_SCHEMA,
    issuer: string(record.issuer, 'Receipt issuer must be non-empty.'),
    issuer_key_id: digest(record.issuer_key_id, 'issuer_key_id'),
    issuer_proof: signature(record.issuer_proof),
    subject: subject(record.subject),
    subject_sha256: digest(record.subject_sha256, 'subject_sha256'),
    observed_at: observedAt(record.observed_at),
  };
}

function validateBase(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  assertKeys(record, allowed, 'receipt');
  if (record.receipt_schema !== RECEIPT_SCHEMA) throw new ReceiptFormatError('Receipt receipt_schema must be the string "1".');
  base(record);
}

function checks(value: unknown, names: readonly string[]): Readonly<Record<string, ReceiptCheck>> {
  const record = recordOf(value, 'Receipt checks must be a mapping.');
  assertKeys(record, names, 'receipt checks');
  const out: Record<string, ReceiptCheck> = {};
  for (const name of names) {
    if (!isCheck(record[name])) throw new ReceiptFormatError(`Receipt check ${name} must be pass or fail.`);
    out[name] = record[name];
  }
  return out;
}

function assertKeys(record: Record<string, unknown>, allowed: ReadonlySet<string> | readonly string[], label: string): void {
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  for (const key of Object.keys(record)) if (!set.has(key)) throw new ReceiptFormatError(`Unknown ${label} field ${key}.`);
  for (const key of set) if (!Object.hasOwn(record, key) && key !== 'criterion_verdicts') throw new ReceiptFormatError(`Missing ${label} field ${key}.`);
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ReceiptFormatError(message);
  return value as Record<string, unknown>;
}

function string(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ReceiptFormatError(message);
  assertUnicodeScalars(value);
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new ReceiptFormatError(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function signature(value: unknown): string {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.includes('=')) throw new ReceiptFormatError('issuer_proof must be unpadded base64url.');
  try {
    const decoded = decodeBase64Url(value);
    if (decoded.length !== 64 || decoded.toString('base64url') !== value) throw new ReceiptFormatError('issuer_proof is not a canonical Ed25519 base64url signature.');
  } catch (error) {
    if (error instanceof ReceiptFormatError) throw error;
    throw new ReceiptFormatError('issuer_proof is not base64url.');
  }
  return value;
}

function subject(value: unknown): ReceiptSubject {
  if (typeof value !== 'string' || (!FEATURE_SUBJECT.test(value) && !CRITERION_SUBJECT.test(value))) throw new ReceiptFormatError('Receipt subject must be a canonical feature or criterion address.');
  return value as ReceiptSubject;
}

function observedAt(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new ReceiptFormatError('observed_at must be an exact canonical 24-byte UTC timestamp.');
  }
  return value;
}

function isCheck(value: unknown): value is ReceiptCheck { return value === 'pass' || value === 'fail'; }

function omitIssuerProof(receipt: PortableReceipt): Record<string, unknown> {
  return Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'issuer_proof'));
}

function decodeBase64Url(value: string): Buffer {
  if (!BASE64URL.test(value) || value.includes('=')) throw new ReceiptFormatError('Invalid base64url signature.');
  return Buffer.from(value, 'base64url');
}

function decodeUtf8(source: string | Uint8Array): string {
  if (typeof source === 'string') return source;
  try { return new TextDecoder('utf-8', {fatal: true}).decode(source); } catch { throw new ReceiptFormatError('Receipt YAML is not valid UTF-8.'); }
}

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { index++; continue; }
    }
    throw new ReceiptFormatError('Receipt contains an invalid Unicode scalar value.');
  }
}

function inspectYamlNode(node: Node | null): void {
  if (node === null) throw new ReceiptFormatError('Receipt YAML may not be empty.');
  if (isAlias(node)) throw new ReceiptFormatError('Receipt YAML aliases are not permitted.');
  if (node.anchor !== undefined || node.tag !== undefined) throw new ReceiptFormatError('Receipt YAML anchors and tags are not permitted.');
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!pair.key || !isScalar(pair.key) || typeof pair.key.value !== 'string') throw new ReceiptFormatError('Receipt YAML map keys must be strings.');
      if (pair.key.value === '<<') throw new ReceiptFormatError('Receipt YAML merge keys are not permitted.');
      inspectYamlNode(pair.key);
      inspectYamlNode(pair.value as Node | null);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) inspectYamlNode(item as Node | null);
  } else if (!isScalar(node)) {
    throw new ReceiptFormatError('Receipt YAML contains an unsupported node.');
  }
}

function assertJsonValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string') assertUnicodeScalars(value);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ReceiptFormatError('Receipt numbers must be finite IEEE-754 values.');
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertJsonValue(item); return; }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) { assertUnicodeScalars(key); assertJsonValue(child); }
    return;
  }
  throw new ReceiptFormatError('Receipt YAML must decode to JSON-compatible data.');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compareUtf16).map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

/** RFC 8785 orders member names by UTF-16 code units, never locale collation. */
function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
