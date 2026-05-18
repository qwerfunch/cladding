// Cladding · unit tests for hitl/anti-self-cert.ts

import {describe, expect, test} from 'vitest';

import {checkAc, failingAcs} from '../../hitl/anti-self-cert.js';
import type {Evidence} from '../../hitl/identity.js';

function ev(acId: string | undefined, author: 'human' | 'llm' | 'tool'): Evidence {
  return {
    id: `${author}-${acId ?? 'none'}`,
    featureId: 'F-001',
    acId,
    stage: 'stage_4.1',
    identity: {author, name: author, timestamp: '2026-05-18T00:00:00Z'},
    kind: 'pass',
    content: `${author} authored`,
  };
}

describe('anti-self-cert', () => {
  test('passes when at least one human evidence exists', () => {
    const r = checkAc('AC-001', [ev('AC-001', 'tool'), ev('AC-001', 'human')]);
    expect(r.pass).toBe(true);
    expect(r.humanEvidence).toBe(1);
  });

  test('blocks when only tool/LLM evidence exists', () => {
    const r = checkAc('AC-001', [ev('AC-001', 'tool'), ev('AC-001', 'llm')]);
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('anti-self-cert guard blocks');
  });

  test('blocks when zero evidence exists', () => {
    const r = checkAc('AC-001', []);
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('no evidence at all');
  });

  test('failingAcs returns only the AC ids that fail the guard', () => {
    const evidence = [
      ev('AC-001', 'human'),
      ev('AC-002', 'tool'),
      ev('AC-002', 'llm'),
      ev('AC-003', 'human'),
      ev('AC-003', 'tool'),
    ];
    const fails = failingAcs(evidence);
    expect(fails.map((r) => r.acId)).toEqual(['AC-002']);
  });

  test('evidence with no acId is ignored by failingAcs', () => {
    const fails = failingAcs([ev(undefined, 'tool'), ev('AC-001', 'human')]);
    expect(fails).toEqual([]);
  });
});
