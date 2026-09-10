// Cladding · assurance adapter tests — the reason labels an unobserved proof
// row carries. `stale`, `unresolved`, and `unbound` all read as "no current
// proof", but they prescribe different work: re-run the gate, complete the
// closure, or write the missing testcase binding. The adapter is the only
// place that can tell the third apart, because it alone sees which criteria
// named a binding source at all.

import {describe, expect, test} from 'vitest';

import {reduceLegacyStageAdapter, type AssuranceAdapterInput} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import type {CriterionProofView} from '../../src/proof/view.js';

const BOUND = 'F-aaaaaaaa/AC-bbbbbbbb';
const UNBOUND = 'F-aaaaaaaa/AC-cccccccc';

function view(criterion: string): CriterionProofView {
  return {
    criterion,
    test: {criterion, state: 'unverified', matched: 0, pass: 0, fail: 0, skip: 0, error: 0},
    audit: 'unverified', uat: 'unverified', blind: 'unverified', assertedEvidence: 0,
  };
}

function verdict(boundProofCriteria?: ReadonlySet<string>) {
  const input: AssuranceAdapterInput = {
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses: ['feature:F-aaaaaaaa'], inputAddresses: ['feature:F-aaaaaaaa'], inputSha256: 'a'.repeat(64),
    hasExecutableTests: true, hasOracleProof: true, hasDeliverable: false, requiresQuality: false,
    requiresHuman: false, exactProofRequired: true, environmentClass: 'test',
    proofViews: [view(BOUND), view(UNBOUND)],
    ...(boundProofCriteria === undefined ? {} : {boundProofCriteria}),
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3']
      .map((stage) => ({stage, status: 'pass' as const})),
  };
  return reduceLegacyStageAdapter(input);
}

function reasonFor(result: ReturnType<typeof verdict>, obligation: string, criterion: string) {
  return result.results.find((row) => row.obligation === obligation && row.subject === `criterion:${criterion}`)?.reason;
}

describe('F6 legacy stage adapter — unobserved reasons', () => {
  test('[covers:F-6f0a2106/AC-6f0a2115] a criterion with no test binding reads unbound while a bound one stays stale', () => {
    const bounded = verdict(new Set([BOUND]));
    expect(reasonFor(bounded, 'stage_2.1', BOUND)).toBe('stale');
    expect(reasonFor(bounded, 'stage_2.2', BOUND)).toBe('stale');
    expect(reasonFor(bounded, 'stage_2.1', UNBOUND)).toBe('unbound');
    expect(reasonFor(bounded, 'stage_2.2', UNBOUND)).toBe('unbound');
  });

  test('[covers:F-6f0a2106/AC-6f0a2115] an absent bound set is unknown, never proof that nothing is bound', () => {
    const unknown = verdict();
    expect(reasonFor(unknown, 'stage_2.1', BOUND)).toBe('stale');
    expect(reasonFor(unknown, 'stage_2.1', UNBOUND)).toBe('stale');
  });

  test('[covers:F-6f0a2106/AC-6f0a2115] a receipt-driven obligation keeps stale, because a binding is not what it lacks', () => {
    // Spec Conformance reduces the blind receipt, not the criterion's own
    // testcase, so calling its gap "unbound" would prescribe the wrong fix.
    const bounded = verdict(new Set([BOUND]));
    expect(reasonFor(bounded, 'stage_2.3', BOUND)).toBe('stale');
    expect(reasonFor(bounded, 'stage_2.3', UNBOUND)).toBe('stale');
  });
});
