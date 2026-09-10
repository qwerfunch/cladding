// Cladding · Spec 0.2 F5 · one schema-selected proof compatibility view.

import {evidenceAssurance, type Evidence} from '../hitl/identity.js';
import type {JUnitReport} from '../stages/junit-report.js';
import {reduceTestBindings} from './bindings.js';
import {canonicalizeJson, parsePortableReceiptYaml, verifyPortableReceipt, type AuditReceipt, type BlindReceipt, type PortableReceipt, type ReceiptExpectedDigestContext, type ReceiptVerification, type TrustSnapshot, type UatReceipt} from './receipt.js';
import type {BindingObservation, TestBinding} from './types.js';

/** F5-local claim reduction; F6 owns shared closure, obligations, and profiles. */
export interface CriterionProofView {
  readonly criterion: string;
  readonly test: BindingObservation;
  readonly audit: 'verified' | 'failed' | 'unverified';
  readonly uat: 'verified' | 'failed' | 'unverified';
  readonly blind: 'verified' | 'failed' | 'unverified';
  /** Generic audit history is useful but cannot clear a new 0.2 requirement. */
  readonly assertedEvidence: number;
}

/**
 * Proof input authority is identity-based.  A symbol brand is observable and
 * transplantable, while a private WeakSet is neither; only factory-created
 * wrappers can participate in a verified reduction.
 */
const verifiedReceiptInputs = new WeakSet<object>();

/** An opaque, verifier-owned receipt snapshot that only the factory can construct. */
export interface VerifiedReceiptInput {
  readonly receipt: PortableReceipt;
  readonly verification: ReceiptVerification;
}

/**
 * Produces F5 proof input from receipt bytes and host-owned verification data.
 * F6 can call this same seam when it later re-verifies its wider context; F5
 * does not infer or persist that future closure.
 */
export function createVerifiedReceiptInput(input: {
  /** Runtime input is intentionally untrusted, even if static callers type it as a receipt. */
  readonly receipt: unknown;
  readonly trustSnapshot: TrustSnapshot;
  readonly expected?: ReceiptExpectedDigestContext;
}): VerifiedReceiptInput | undefined {
  try {
    // String round-trip both detaches caller identity and forces the strict
    // portable schema validator over any dynamically supplied object.
    const receipt = parsePortableReceiptYaml(canonicalizeJson(input.receipt));
    const verification = verifyPortableReceipt(receipt, input.trustSnapshot, input.expected);
    if (verification.assurance !== 'verified' || verification.currentness !== 'current') return undefined;
    const owned = Object.freeze({receipt: deepFreeze(receipt), verification: deepFreeze(verification)});
    verifiedReceiptInputs.add(owned);
    return owned;
  } catch {
    // Untrusted runtime objects must never become a verified capability.
    return undefined;
  }
}

/**
 * Produces the only F5 evidence view consumers should use.  Schema 0.1 keeps
 * its historical file-level detector path; schema 0.2 requires exact bindings
 * and current offline receipt verification before a human/blind claim is live.
 */
export function buildProofView(input: {
  readonly schemaVersion: '0.1' | '0.2';
  readonly criteria: readonly string[];
  readonly bindings?: readonly TestBinding[];
  readonly report?: JUnitReport;
  readonly evidence?: readonly Evidence[];
  /** Per-feature current criterion address sets from the compiler, not receipt data. */
  readonly criteriaByFeature?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Unknown/plain objects are intentionally ignored; use createVerifiedReceiptInput. */
  readonly receipts?: readonly unknown[];
}): readonly CriterionProofView[] {
  const reductions = input.bindings && input.report ? reduceTestBindings(input.bindings, input.report) : [];
  const byCriterion = new Map(reductions.map((reduction) => [reduction.criterion, reduction]));
  return [...input.criteria].sort().map((criterion) => {
    const test = byCriterion.get(criterion) ?? {criterion, state: 'unverified', matched: 0, pass: 0, fail: 0, skip: 0, error: 0} as const;
    if (input.schemaVersion === '0.1') {
      // Do not reinterpret historical logs: legacy detector behavior remains
      // file-level and its assurance field never existed.
      return {criterion, test, audit: 'unverified', uat: 'unverified', blind: 'unverified', assertedEvidence: 0};
    }
    const receiptClaims = (input.receipts ?? []).filter(isVerifiedReceiptInput).filter(({receipt}) => receiptApplies(receipt, criterion));
    const audit = reduceAudit(receiptClaims, criterion);
    const uat = reduceUat(receiptClaims, criterion, input.criteriaByFeature);
    const blind = reduceBlind(receiptClaims, criterion, input.bindings ?? [], input.report);
    const assertedEvidence = (input.evidence ?? []).filter((entry) => matchesEvidence(entry, criterion) && evidenceAssurance(entry) === 'asserted').length;
    return {criterion, test, audit, uat, blind, assertedEvidence};
  });
}

function receiptApplies(receipt: PortableReceipt, criterion: string): boolean {
  return receipt.subject === `criterion:${criterion}` || receipt.subject === `feature:${criterion.split('/')[0]}`;
}

function reduceAudit(receipts: readonly VerifiedReceiptInput[], criterion: string): 'verified' | 'failed' | 'unverified' {
  const checks = receipts
    .map(({receipt}) => receipt)
    .filter((receipt): receipt is AuditReceipt => isAuditReceipt(receipt) && receipt.subject === `criterion:${criterion}`)
    .map((receipt) => receipt.checks);
  if (checks.some((claim) => Object.values(claim).includes('fail'))) return 'failed';
  return checks.some((claim) => Object.values(claim).every((value) => value === 'pass')) ? 'verified' : 'unverified';
}

function reduceUat(
  receipts: readonly VerifiedReceiptInput[],
  criterion: string,
  criteriaByFeature: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): 'verified' | 'failed' | 'unverified' {
  const claims = receipts
    .map(({receipt}) => receipt)
    .filter((receipt): receipt is UatReceipt => isUatReceipt(receipt) && receipt.subject === `feature:${criterion.split('/')[0]}`);
  const address = `criterion:${criterion}` as `criterion:${string}/${string}`;
  if (claims.some((claim) => claim.criterion_verdicts[address] === 'fail' || Object.values(claim.checks).includes('fail'))) return 'failed';
  const feature = criterion.split('/')[0]!;
  const current = criteriaByFeature?.get(feature);
  if (!current) return 'unverified';
  return claims.some((claim) => matrixMatchesCurrentCriteria(claim, current)
    && Object.values(claim.criterion_verdicts).every((value) => value === 'pass')
    && Object.values(claim.checks).every((value) => value === 'pass')) ? 'verified' : 'unverified';
}

function reduceBlind(
  receipts: readonly VerifiedReceiptInput[],
  criterion: string,
  bindings: readonly TestBinding[],
  report: JUnitReport | undefined,
): 'verified' | 'failed' | 'unverified' {
  const claims = receipts
    .map(({receipt}) => receipt)
    .filter((receipt): receipt is BlindReceipt => receipt.method === 'blind_capability' && receipt.subject === `criterion:${criterion}`);
  if (claims.some((claim) => claim.verdict === 'fail')) return 'failed';
  return report && claims.some((claim) => claim.verdict === 'pass' && bindings
    .filter((binding) => binding.criterion === criterion && locatorMatchesBinding(claim.evidence.locator, binding))
    .some((binding) => reduceTestBindings([binding], report)[0]?.state === 'verified')) ? 'verified' : 'unverified';
}

function matrixMatchesCurrentCriteria(receipt: UatReceipt, current: ReadonlySet<string>): boolean {
  const keys = Object.keys(receipt.criterion_verdicts);
  return keys.length === current.size && keys.every((key) => current.has(key));
}

/** Canonical F5 locator is `path` or precise `path#exact title`. */
function locatorMatchesBinding(locator: string, binding: TestBinding): boolean {
  const normalized = normalizePath(locator);
  const precise = `${normalizePath(binding.file)}#${binding.selector}`;
  return normalized === normalizePath(binding.file) || normalized === precise;
}

function normalizePath(path: string): string { return path.replaceAll('\\', '/').replace(/^\.\//, ''); }

function isVerifiedReceiptInput(value: unknown): value is VerifiedReceiptInput {
  return value !== null && typeof value === 'object' && verifiedReceiptInputs.has(value);
}

/** Freezes every owned plain object after the canonical JSON detachment. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value) as T;
}

function matchesEvidence(entry: Evidence, criterion: string): boolean {
  const [featureId, acId] = criterion.split('/');
  return entry.featureId === featureId && entry.acId === acId;
}

function isAuditReceipt(receipt: PortableReceipt): receipt is AuditReceipt {
  return receipt.method === 'human_channel' && receipt.claim === 'audit';
}

function isUatReceipt(receipt: PortableReceipt): receipt is UatReceipt {
  return receipt.method === 'human_channel' && receipt.claim === 'uat';
}
