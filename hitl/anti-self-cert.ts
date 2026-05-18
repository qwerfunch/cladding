// Cladding · HITL · anti-self-cert guard
//
// The Iron Law of Level 4 (HITL): an AC may only clear stage_4 when
// at least one `human`-authored evidence backs it. Tool and LLM
// evidence count toward the audit trail but cannot, on their own,
// certify an AC.
//
// This is the structural barrier ironclad-design/01-philosophy.md
// names "breaking the AI self-cert cycle". Without it, an LLM agent
// could write tests for its own code, run them, declare 'pass', and
// satisfy stage_4 with no human in the loop — defeating the whole
// purpose of L4.

import type {Evidence} from './identity.js';

/** Result of the anti-self-cert check for a single AC. */
export interface GuardResult {
  readonly acId: string;
  readonly pass: boolean;
  readonly totalEvidence: number;
  readonly humanEvidence: number;
  readonly reason?: string;
}

/**
 * Verifies that `acId` has at least one human-authored evidence entry
 * in the supplied audit-log slice. Returns `pass: false` with a
 * machine-readable reason when the guard is violated.
 *
 * @see iron-law.md stage_4.1 / stage_4.2
 * @see ironclad-design/01-philosophy.md — "AI as engineer, not assistant"
 */
export function checkAc(acId: string, evidence: readonly Evidence[]): GuardResult {
  const forAc = evidence.filter((e) => e.acId === acId);
  const human = forAc.filter((e) => e.identity.author === 'human');
  if (human.length === 0) {
    return {
      acId,
      pass: false,
      totalEvidence: forAc.length,
      humanEvidence: 0,
      reason:
        forAc.length === 0
          ? 'no evidence at all'
          : `${forAc.length} tool/LLM evidence but 0 human — anti-self-cert guard blocks`,
    };
  }
  return {
    acId,
    pass: true,
    totalEvidence: forAc.length,
    humanEvidence: human.length,
  };
}

/** Sweep over every AC mentioned in the evidence; return only the failed ones. */
export function failingAcs(evidence: readonly Evidence[]): readonly GuardResult[] {
  const acIds = new Set<string>();
  for (const e of evidence) if (e.acId) acIds.add(e.acId);
  const results: GuardResult[] = [];
  for (const acId of acIds) {
    const r = checkAc(acId, evidence);
    if (!r.pass) results.push(r);
  }
  return results;
}
