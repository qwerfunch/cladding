// Cladding · Spec 0.2 F5 · asserted local signoff history.

import {appendEvidenceWithLockHeld, notifyEvidenceAppended} from '../hitl/audit.js';
import {newEvidence, type Evidence} from '../hitl/identity.js';
import {compileSpecWorkspaceWithLockHeld} from '../spec/compiler/compile.js';
import {withSpecWorkspaceLock} from '../spec/transaction.js';

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
