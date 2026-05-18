// Cladding · drive · agent dispatch wrapper
//
// Single seam between the drive loop and the active
// {@link AgentAdapter}. The loop calls `runAgent` once per persona
// turn; this module:
//   1. selects the adapter via the runtime selector,
//   2. invokes it with the persona prompt + context payload,
//   3. records evidence in the audit log,
//   4. enforces the reviewer ≠ author invariant when the persona is
//      the reviewer (F-049 AC-086).
//
// The actual drive loop integration (specialist → gates → reviewer)
// lands in the next v0.2.0 PR; this module is the foundation that
// PR depends on.
//
// @see spec/features/F-049.yaml AC-085 / AC-086.
// @see adapters/types.ts — `AgentAdapter` contract.
// @see hitl/anti-self-cert.ts — the cleared-by-human invariant that
//      the runtime reviewer-vs-author check complements.

import {appendEvidence} from '../hitl/audit.js';
import {newEvidence, type Evidence} from '../hitl/identity.js';
import {selectAdapter} from '../adapters/index.js';
import type {AgentContext, AgentResult, PersonaSpec} from '../adapters/types.js';

/** Optional context-only attributes the loop layers on top. */
export interface RunAgentOptions {
  /**
   * Identity name of the agent that authored the implementation the
   * reviewer is about to inspect. Only required when `persona.id`
   * is `reviewer`; ignored otherwise.
   */
  readonly implementerIdentityName?: string;
  /** Working directory for the audit-log writer. Defaults to `.`. */
  readonly cwd?: string;
  /** AC id this dispatch attaches its evidence to. Optional. */
  readonly acId?: string;
}

/**
 * Result returned to the drive loop.
 *
 * Carries both the raw adapter output and the audit-log evidence
 * that was recorded for it — the loop uses the evidence id to
 * cross-reference subsequent stage runs.
 */
export interface RunAgentResult {
  readonly adapter: string;
  readonly result: AgentResult;
  readonly evidence: Evidence;
}

/**
 * Error thrown when the runtime reviewer-vs-author barrier is
 * crossed (F-049 AC-086). The loop catches this and emits a
 * `HUMAN_REQUIRED` halt instead of accepting the review.
 */
export class ReviewerIdentityCollisionError extends Error {
  constructor(public readonly identityName: string) {
    super(
      `reviewer identity '${identityName}' equals implementer identity — ` +
        'review evidence refused; structural anti-self-cert barrier engaged',
    );
    this.name = 'ReviewerIdentityCollisionError';
  }
}

/**
 * Dispatches one persona turn through the active adapter and writes
 * the result to the audit log.
 *
 * Throws {@link ReviewerIdentityCollisionError} when the active
 * persona is the reviewer and the adapter returned an identity that
 * matches the implementer's identity name — the drive loop maps
 * that to a `HUMAN_REQUIRED` halt with the offending feature id.
 *
 * @param persona - The persona definition the loop wants to run.
 * @param ctx - Per-invocation context (feature shard + guardrails).
 * @param opts - Loop-layer extras: implementer identity (for the
 *     reviewer barrier), cwd, AC id.
 * @returns The adapter result + the audit-log entry it produced.
 */
export async function runAgent(
  persona: PersonaSpec,
  ctx: AgentContext,
  opts: RunAgentOptions = {},
): Promise<RunAgentResult> {
  const adapter = selectAdapter(opts.cwd ?? ctx.cwd);
  const result = await adapter.invokeAgent(persona, ctx);

  if (persona.id === 'reviewer' && opts.implementerIdentityName) {
    if (result.identity.name === opts.implementerIdentityName) {
      throw new ReviewerIdentityCollisionError(opts.implementerIdentityName);
    }
  }

  const evidence = newEvidence({
    featureId: ctx.featureId,
    acId: opts.acId,
    stage: `agent:${persona.id}`,
    identity: result.identity,
    kind: 'note',
    content: result.summary,
  });
  appendEvidence(opts.cwd ?? ctx.cwd, evidence);

  return {adapter: adapter.name, result, evidence};
}
