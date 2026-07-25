// Cladding · HITL · independence label
//
// A companion to the anti-self-cert guard (anti-self-cert.ts). Where that guard
// HARD-BLOCKS an AC that only tool/LLM evidence backs, this module answers the
// softer, always-computable question: for a WHOLE feature, does ANY of its
// evidence come from an independent source?
//
//   `independent`    — at least one evidence entry is human-authored
//                      (identity.author === 'human') OR blind-authored
//                      (blind === true, structurally-guaranteed blindness).
//   `self-certified` — everything else, INCLUDING a feature with no evidence
//                      at all.
//
// `self-certified` is a LABEL, not an accusation: it makes silent self-cert
// visible in the ledger (docs/feature-cycle.md calls this principle
// "independence"). It is deliberately NOT named "attested" — that word is spoken
// for by spec/attestation.yaml (the gate-hash record), a different concept.
//
// Pure + IO-free by contract: the caller passes the evidence slice in. Only
// `human` and `blind` provenance count toward independence — `llm` and `tool`
// evidence populate the audit trail but cannot, on their own, make a feature
// independent (the same asymmetry anti-self-cert enforces at the AC level).

import type {Evidence} from './identity.js';

/** Whether a feature carries independent backing, or only its own say-so. */
export type IndependenceLabel = 'independent' | 'self-certified';

/** WHY a feature earned its label — the evidence counts behind the verdict. */
export interface IndependenceBasis {
  /** Evidence entries recorded for this feature (the denominator). */
  readonly total: number;
  /** How many are human-authored (identity.author === 'human'). */
  readonly human: number;
  /** How many are blind-authored (blind === true) — regardless of author. */
  readonly blind: number;
  /** Machine-readable one-liner explaining the label (mirrors GuardResult.reason). */
  readonly reason: string;
}

/** The independence verdict for a single feature. */
export interface IndependenceResult {
  readonly featureId: string;
  readonly label: IndependenceLabel;
  readonly basis: IndependenceBasis;
}

/**
 * Labels `featureId` `independent` when at least one of its evidence entries is
 * human-authored or blind-authored, and `self-certified` otherwise — including
 * when the feature has no evidence at all (AC-e216b03f). A human entry that is
 * ALSO blind counts in both tallies; the label only needs one of them positive.
 *
 * @param featureId - The feature whose evidence slice to weigh.
 * @param evidence  - The audit-log slice (any features); filtered by featureId here.
 * @see anti-self-cert.ts — the AC-level hard guard this feature-level label mirrors.
 */
export function computeIndependence(featureId: string, evidence: readonly Evidence[]): IndependenceResult {
  const mine = evidence.filter((e) => e.featureId === featureId);
  const human = mine.filter((e) => e.identity.author === 'human').length;
  const blind = mine.filter((e) => e.blind === true).length;
  const independent = human > 0 || blind > 0;
  const label: IndependenceLabel = independent ? 'independent' : 'self-certified';
  const reason = independent
    ? `${human} human + ${blind} blind evidence back this feature`
    : mine.length === 0
      ? 'no evidence at all'
      : `${mine.length} tool/LLM evidence but 0 human and 0 blind — self-certified`;
  return {featureId, label, basis: {total: mine.length, human, blind, reason}};
}

/** Per-feature labels plus the independent/self-certified split. */
export interface IndependenceSummary {
  /** One `{id, label}` per requested feature id, in the order supplied. */
  readonly labels: readonly {readonly id: string; readonly label: IndependenceLabel}[];
  /** How many of the requested features are `independent`. */
  readonly independent: number;
  /** How many of the requested features are `self-certified`. */
  readonly selfCertified: number;
}

/**
 * Labels each id in `featureIds` and rolls the counts up. Extracted from the
 * `clad verdict` handler so the per-feature labels AND the independent /
 * self-certified split are unit-testable without process.exit (AC-6f228987).
 *
 * @param featureIds - The done-feature ids to label (verdict computes over `done`).
 * @param evidence   - The evidence ledger to weigh each feature against.
 */
export function independenceSummary(featureIds: readonly string[], evidence: readonly Evidence[]): IndependenceSummary {
  const labels = featureIds.map((id) => ({id, label: computeIndependence(id, evidence).label}));
  const selfCertified = labels.filter((l) => l.label === 'self-certified').length;
  return {labels, independent: labels.length - selfCertified, selfCertified};
}
