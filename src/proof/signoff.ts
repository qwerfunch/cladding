// Cladding · Spec 0.2 F5/F9d · asserted local signoff history and the verified issuer path.

import type {KeyObject} from 'node:crypto';

import {assuranceClosureInputFromWorkspace, workspaceExpectedDigestProducer} from '../assurance/workspace.js';
import {appendEvidenceWithLockHeld, notifyEvidenceAppended} from '../hitl/audit.js';
import {newEvidence, type Evidence} from '../hitl/identity.js';
import {compileSpecWorkspace, compileSpecWorkspaceWithLockHeld} from '../spec/compiler/compile.js';
import {withSpecWorkspaceLock} from '../spec/transaction.js';
import {ingestPortableReceipt} from './ingest.js';
import {loadIssuerPrivateKey, signPortableReceipt} from './issuer.js';
import {
  RECEIPT_SCHEMA,
  serializePortableReceipt,
  type AuditReceipt,
  type PortableReceipt,
  type ReceiptExpectedDigestContext,
  type ReceiptVerification,
  type TrustSnapshot,
  type UatReceipt,
} from './receipt.js';
import {TRUST_REGISTRY_PATH, loadTrustSnapshot} from './trust.js';

/** Input shared by CLI and MCP asserted-signoff adapters. */
export interface AssertedSignoffRequest {
  readonly cwd: string;
  readonly featureId: string;
  readonly claim: 'audit' | 'uat';
  readonly criterion?: string;
  readonly result?: 'pass' | 'fail';
  readonly note?: string;
}

/** Stable F5 response; a recorded assertion never masquerades as verification. */
export interface AssertedSignoffResult {
  readonly ok: boolean;
  readonly code: 'OK' | 'HUMAN_REQUIRED' | 'INVALID_OPERATION' | 'UNKNOWN_REFERENCE';
  readonly message: string;
  readonly evidence?: Evidence;
}

/** Records an asserted audit/UAT history entry without examining terminal or OS identity state. */
export function recordAssertedSignoff(request: AssertedSignoffRequest): AssertedSignoffResult {
  if (request.claim !== 'audit' && request.claim !== 'uat') {
    return {ok: false, code: 'INVALID_OPERATION', message: 'A signoff claim must be audit or uat.'};
  }
  if (request.result !== undefined && request.result !== 'pass' && request.result !== 'fail') {
    return {ok: false, code: 'INVALID_OPERATION', message: 'A signoff result must be pass or fail.'};
  }
  if (request.note !== undefined && request.note.length > 4096) {
    return {ok: false, code: 'INVALID_OPERATION', message: 'A signoff note may not exceed 4096 characters.'};
  }
  if (request.claim === 'audit' && (!request.criterion || !request.result)) {
    return {ok: false, code: 'INVALID_OPERATION', message: 'An audit signoff requires both a criterion and a pass or fail result.'};
  }
  if (request.claim === 'uat' && request.criterion !== undefined) {
    return {ok: false, code: 'INVALID_OPERATION', message: 'A UAT signoff is feature-scoped and cannot name one criterion.'};
  }
  try {
    const result = withSpecWorkspaceLock<AssertedSignoffResult>(request.cwd, () => {
      const compilation = compileSpecWorkspaceWithLockHeld(request.cwd);
      if (!compilation.nodes.some((node) => node.nodeType === 'semantic' && node.address === `feature:${request.featureId}`)) {
        return {ok: false, code: 'UNKNOWN_REFERENCE', message: 'The requested feature does not exist in the current specification.'};
      }
      if (request.criterion && !compilation.nodes.some((node) => node.nodeType === 'semantic' && node.address === `criterion:${request.featureId}/${request.criterion}`)) {
        return {ok: false, code: 'UNKNOWN_REFERENCE', message: 'The requested criterion does not belong to the selected feature.'};
      }
      const evidence = newEvidence({
        featureId: request.featureId,
        ...(request.criterion ? {acId: request.criterion} : {}),
        stage: request.claim === 'audit' ? 'stage_4.1' : 'stage_4.2',
        identity: {author: 'human', name: 'local-asserted-signoff'},
        kind: request.result ?? 'pass',
        assurance: 'asserted',
        content: request.note?.trim() || (request.claim === 'audit' ? `Local asserted audit: ${request.result}.` : 'Local asserted UAT signoff.'),
      });
      appendEvidenceWithLockHeld(request.cwd, evidence);
      if (compilation.schemaVersion === '0.2') {
        return {
          ok: false,
          code: 'HUMAN_REQUIRED',
          message: 'The asserted signoff was recorded, but a registered signed receipt and complete expected context are required for verified schema 0.2 evidence.',
          evidence,
        };
      }
      return {ok: true, code: 'OK', message: 'The local signoff was recorded as asserted audit history.', evidence};
    });
    if (result.evidence) notifyEvidenceAppended(request.cwd, result.evidence);
    return result;
  } catch (error) {
    return {ok: false, code: 'INVALID_OPERATION', message: (error as Error).message};
  }
}

/** Human confirmation channel: returns the exact text a person re-entered. */
export type SignoffConfirmation = (prompt: string) => Promise<string | undefined>;

/** Input for the F9d verified signoff path. */
export interface VerifiedSignoffRequest extends AssertedSignoffRequest {
  /** Registered issuer name from `spec/trust/issuers.yaml`. */
  readonly issuer: string;
  /** Terminal prompt or host elicitation form; there is no non-human default. */
  readonly confirm: SignoffConfirmation;
  /** Environment record used to resolve the private key store. */
  readonly env?: NodeJS.ProcessEnv;
  /** Audit claim checks; every unnamed check defaults to `pass`. */
  readonly checks?: Readonly<Record<string, 'pass' | 'fail'>>;
}

/** Verified signoff outcome; the asserted history entry is recorded either way. */
export interface VerifiedSignoffResult {
  readonly ok: boolean;
  readonly code: 'OK' | 'HUMAN_REQUIRED' | 'INVALID_OPERATION' | 'UNKNOWN_REFERENCE' | 'INVALID_WORKSPACE'
    | 'INVALID_RECEIPT' | 'INVALID_SIGNATURE' | 'EXPECTED_DIGEST_MISMATCH' | 'CREATE_ONLY_CONFLICT' | 'INVALID_PATH' | 'BUSY';
  readonly message: string;
  readonly evidence?: Evidence;
  readonly path?: string;
  readonly digest?: string;
  readonly issuerKeyId?: string;
  readonly verification?: ReceiptVerification;
}

/** Message every unconfirmed verified request returns, naming the missing step. */
const CONFIRMATION_REQUIRED =
  'A verified signoff needs a human to re-enter the feature id in a terminal prompt or a host elicitation form. Only asserted history was recorded.';

/**
 * Signs and ingests one human receipt after an explicit human confirmation.
 *
 * The confirmation is CONSENT FRICTION, not proof of humanity: any process
 * running as this user can answer it and can read the private key. D20 states
 * that threat model; this function must never describe the result as anything
 * stronger than "the registered issuer asserted it".
 *
 * The asserted history entry is written first and unconditionally, so a
 * refused, declined, or unconfirmable request still leaves the human channel's
 * record behind exactly as `clad signoff` always has.
 *
 * @param request - Feature, claim, issuer, and the human confirmation channel.
 * @returns The stored receipt path and offline verification, or HUMAN_REQUIRED.
 * @example
 * ```ts
 * await recordVerifiedSignoff({cwd, featureId, claim: 'uat', issuer, confirm});
 * ```
 * @since 0.10.0
 * @internal
 */
export async function recordVerifiedSignoff(request: VerifiedSignoffRequest): Promise<VerifiedSignoffResult> {
  const asserted = recordAssertedSignoff(request);
  if (asserted.code === 'INVALID_OPERATION' || asserted.code === 'UNKNOWN_REFERENCE') return asserted;
  const confirmed = await request.confirm(`Type the feature id to sign a verified ${request.claim} receipt: `);
  if (confirmed?.trim() !== request.featureId) {
    return {...asserted, ok: false, code: 'HUMAN_REQUIRED', message: CONFIRMATION_REQUIRED};
  }
  let trustSnapshot: TrustSnapshot;
  try { trustSnapshot = loadTrustSnapshot(request.cwd); } catch (error) {
    return {...asserted, ok: false, code: 'INVALID_WORKSPACE', message: (error as Error).message};
  }
  const key = trustSnapshot.keys.find((candidate) => candidate.issuer === request.issuer);
  if (!key) {
    return {
      ...asserted, ok: false, code: 'HUMAN_REQUIRED',
      message: `Issuer ${request.issuer} is not registered in ${TRUST_REGISTRY_PATH}. Run \`clad key create --issuer ${request.issuer}\` first. Only asserted history was recorded.`,
    };
  }
  let privateKey: KeyObject;
  try { privateKey = loadIssuerPrivateKey(key.issuerKeyId, request.env); } catch (error) {
    return {
      ...asserted, ok: false, code: 'HUMAN_REQUIRED',
      message: `${(error as Error).message} Run \`clad key create --issuer ${request.issuer}\` on this machine. Only asserted history was recorded.`,
    };
  }
  let unsigned: UnsignedHumanReceipt;
  let expected: ReceiptExpectedDigestContext;
  try {
    const built = buildHumanReceipt(request, key.issuerKeyId);
    unsigned = built.unsigned;
    expected = built.expected;
  } catch (error) {
    return {...asserted, ok: false, code: 'INVALID_WORKSPACE', message: (error as Error).message, issuerKeyId: key.issuerKeyId};
  }
  const receipt = signPortableReceipt<PortableReceipt>(unsigned, privateKey);
  const ingested = ingestPortableReceipt({
    cwd: request.cwd, receiptYaml: serializePortableReceipt(receipt), trustSnapshot, expected,
  });
  return {
    ok: ingested.ok,
    code: ingested.code,
    message: ingested.ok
      ? `${ingested.message} Signed by registered issuer ${request.issuer}; a signature proves that issuer's assertion, not universal human identity.`
      : ingested.message,
    ...(asserted.evidence ? {evidence: asserted.evidence} : {}),
    ...(ingested.path ? {path: ingested.path} : {}),
    ...(ingested.digest ? {digest: ingested.digest} : {}),
    issuerKeyId: key.issuerKeyId,
    ...(ingested.verification ? {verification: ingested.verification} : {}),
  };
}

/** A complete human receipt body still missing only its detached signature. */
type UnsignedHumanReceipt = Omit<AuditReceipt, 'issuer_proof'> | Omit<UatReceipt, 'issuer_proof'>;

/** Builds the unsigned receipt body plus the expected context it must match. */
function buildHumanReceipt(
  request: VerifiedSignoffRequest,
  issuerKeyId: string,
): {readonly unsigned: UnsignedHumanReceipt; readonly expected: ReceiptExpectedDigestContext} {
  const compilation = compileSpecWorkspace(request.cwd);
  if (compilation.schemaVersion !== '0.2') throw new Error('A verified signoff requires a schema 0.2 workspace.');
  const closures = assuranceClosureInputFromWorkspace(request.cwd, compilation);
  const expectedFor = workspaceExpectedDigestProducer(request.cwd, closures);
  const subject = request.claim === 'audit'
    ? `criterion:${request.featureId}/${request.criterion}` as const
    : `feature:${request.featureId}` as const;
  // The producer reads only method/claim/subject, so a zero-digest draft is
  // enough to resolve the closure this receipt is about to bind.
  const expected = expectedFor({...draftReceipt(request.claim, subject), issuer_proof: ''} as PortableReceipt);
  if (!expected || expected.subjectSha256 === undefined || expected.reviewedInputsSha256 === undefined
    || expected.runtimeDependencySha256 === undefined || expected.implementationAuthorsSha256 === undefined) {
    throw new Error('The subject closure is not complete, so no receipt may claim a current expected context.');
  }
  const base = {
    receipt_schema: RECEIPT_SCHEMA,
    issuer: request.issuer,
    issuer_key_id: issuerKeyId,
    subject,
    subject_sha256: expected.subjectSha256,
    observed_at: new Date().toISOString(),
    method: 'human_channel' as const,
    reviewed_inputs_sha256: expected.reviewedInputsSha256,
    runtime_dependency_sha256: expected.runtimeDependencySha256,
    implementation_authors_sha256: expected.implementationAuthorsSha256,
  };
  const verdict = request.result ?? 'pass';
  if (request.claim === 'audit') {
    return {
      unsigned: {
        ...base, subject: subject as `criterion:${string}/${string}`, claim: 'audit',
        checks: {
          evidence_sufficiency: check(request.checks, 'evidence_sufficiency', verdict),
          code_test_review: check(request.checks, 'code_test_review', verdict),
          independence: check(request.checks, 'independence', verdict),
        },
      },
      expected,
    };
  }
  // A UAT receipt is signed once per feature but must address every CURRENT
  // criterion: a partial matrix is unobserved, never a pass.
  const criterionVerdicts: Record<string, 'pass' | 'fail'> = {};
  for (const node of compilation.nodes) {
    if (node.nodeType !== 'semantic' || node.kind !== 'criterion') continue;
    if (!node.address.startsWith(`criterion:${request.featureId}/`)) continue;
    criterionVerdicts[node.address] = verdict;
  }
  if (Object.keys(criterionVerdicts).length === 0) throw new Error('A UAT receipt requires at least one current criterion in the feature.');
  return {
    unsigned: {
      ...base, subject: subject as `feature:${string}`, claim: 'uat',
      criterion_verdicts: criterionVerdicts as UatReceipt['criterion_verdicts'],
      checks: {
        no_surprise: check(request.checks, 'no_surprise', verdict),
        tradeoff_acceptance: check(request.checks, 'tradeoff_acceptance', verdict),
      },
    },
    expected,
  };
}

function draftReceipt(claim: 'audit' | 'uat', subject: string): Record<string, unknown> {
  return {method: 'human_channel', claim, subject};
}

function check(
  checks: Readonly<Record<string, 'pass' | 'fail'>> | undefined,
  name: string,
  fallback: 'pass' | 'fail',
): 'pass' | 'fail' {
  return checks?.[name] ?? fallback;
}
