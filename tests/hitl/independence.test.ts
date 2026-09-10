// Cladding · unit tests for hitl/independence.ts
//
// Authored from the AC contract (AC-e216b03f) + exported types ONLY — the test
// author did not read computeIndependence's / independenceSummary's bodies.
// The invariant: a feature is `independent` iff at least one of ITS evidence
// entries is human-authored OR blind-authored; otherwise `self-certified`,
// including when it has no evidence at all. Evidence recorded against a
// DIFFERENT featureId must never count.

import {describe, expect, test} from 'vitest';

import {computeIndependence, independenceSummary} from '../../src/hitl/independence.js';
import type {Evidence} from '../../src/hitl/identity.js';

function ev(
  featureId: string,
  author: 'human' | 'llm' | 'tool',
  opts: {blind?: boolean} = {},
): Evidence {
  return {
    id: `${author}-${featureId}-${Math.random().toString(36).slice(2, 8)}`,
    featureId,
    stage: 'stage_4.1',
    identity: {author, name: author, timestamp: '2026-05-18T00:00:00Z'},
    kind: 'pass',
    content: `${author} authored`,
    ...opts,
  };
}

describe('computeIndependence (AC-e216b03f)', () => {
  test('[covers:F-c566f590/AC-e216b03f] human or blind evidence makes a feature independent while none or self-only evidence remains self-certified', () => {
    const cases = [
      {evidence: [] as Evidence[], label: 'self-certified'},
      {evidence: [ev('F-001', 'tool')], label: 'self-certified'},
      {evidence: [ev('F-001', 'human')], label: 'independent'},
      {evidence: [ev('F-001', 'llm', {blind: true})], label: 'independent'},
    ] as const;
    for (const item of cases) {
      expect(computeIndependence('F-001', item.evidence).label).toBe(item.label);
    }
  });

  test('self-certified when the feature has ZERO evidence at all', () => {
    const r = computeIndependence('F-001', []);
    expect(r.featureId).toBe('F-001');
    expect(r.label).toBe('self-certified');
    expect(r.basis.total).toBe(0);
    expect(r.basis.human).toBe(0);
    expect(r.basis.blind).toBe(0);
    expect(r.basis.reason).toBe('no evidence at all');
  });

  test('self-certified when only tool evidence backs the feature', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'tool'), ev('F-001', 'tool')]);
    expect(r.label).toBe('self-certified');
    expect(r.basis.total).toBe(2);
    expect(r.basis.human).toBe(0);
    expect(r.basis.blind).toBe(0);
  });

  test('self-certified when only LLM evidence backs the feature', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'llm')]);
    expect(r.label).toBe('self-certified');
    expect(r.basis.total).toBe(1);
    expect(r.basis.human).toBe(0);
  });

  test('self-certified when a MIX of tool + llm evidence backs the feature (no human, no blind)', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'tool'), ev('F-001', 'llm'), ev('F-001', 'llm')]);
    expect(r.label).toBe('self-certified');
    expect(r.basis.total).toBe(3);
    expect(r.basis.human).toBe(0);
    expect(r.basis.blind).toBe(0);
  });

  test('independent when at least ONE human-authored evidence entry exists (amid tool/llm noise)', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'tool'), ev('F-001', 'llm'), ev('F-001', 'human')]);
    expect(r.label).toBe('independent');
    expect(r.basis.total).toBe(3);
    expect(r.basis.human).toBe(1);
  });

  test('independent when at least ONE blind:true evidence entry exists, even LLM-authored', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'llm', {blind: true})]);
    expect(r.label).toBe('independent');
    expect(r.basis.blind).toBe(1);
    expect(r.basis.human).toBe(0);
  });

  test('independent when at least ONE blind:true evidence entry exists, even tool-authored', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'tool', {blind: true})]);
    expect(r.label).toBe('independent');
    expect(r.basis.blind).toBe(1);
  });

  test('an entry that is BOTH human-authored and blind counts in both tallies, but yields one independent label', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'human', {blind: true})]);
    expect(r.label).toBe('independent');
    expect(r.basis.human).toBe(1);
    expect(r.basis.blind).toBe(1);
  });

  test('evidence for OTHER features must not count toward this feature\'s independence', () => {
    const r = computeIndependence('F-001', [
      ev('F-002', 'human'),
      ev('F-003', 'human', {blind: true}),
    ]);
    expect(r.label).toBe('self-certified');
    expect(r.basis.total).toBe(0);
  });

  test('evidence for OTHER features is excluded even when THIS feature also has qualifying evidence', () => {
    const r = computeIndependence('F-001', [ev('F-001', 'human'), ev('F-002', 'tool'), ev('F-002', 'llm')]);
    expect(r.label).toBe('independent');
    expect(r.basis.total).toBe(1); // only F-001's own entry counts
  });
});

describe('independenceSummary (AC-e216b03f / AC-6f228987 support)', () => {
  test('returns one {id,label} per requested feature id, IN THE ORDER SUPPLIED', () => {
    const evidence = [ev('F-b', 'human'), ev('F-a', 'tool')];
    const s = independenceSummary(['F-a', 'F-b', 'F-c'], evidence);
    expect(s.labels).toEqual([
      {id: 'F-a', label: 'self-certified'},
      {id: 'F-b', label: 'independent'},
      {id: 'F-c', label: 'self-certified'},
    ]);
  });

  test('rolls up the independent / self-certified counts correctly', () => {
    const evidence = [ev('F-a', 'human'), ev('F-b', 'tool'), ev('F-c', 'llm', {blind: true})];
    const s = independenceSummary(['F-a', 'F-b', 'F-c', 'F-d'], evidence);
    expect(s.independent).toBe(2); // F-a (human), F-c (blind)
    expect(s.selfCertified).toBe(2); // F-b (tool only), F-d (no evidence)
  });

  test('a feature id with NO evidence anywhere still gets a self-certified entry (not omitted)', () => {
    const s = independenceSummary(['F-lonely'], []);
    expect(s.labels).toEqual([{id: 'F-lonely', label: 'self-certified'}]);
    expect(s.selfCertified).toBe(1);
    expect(s.independent).toBe(0);
  });

  test('an empty feature id list yields empty labels and zero counts', () => {
    const s = independenceSummary([], [ev('F-a', 'human')]);
    expect(s.labels).toEqual([]);
    expect(s.independent).toBe(0);
    expect(s.selfCertified).toBe(0);
  });
});
