// Cladding · F-d2c806 — the context slice (Least Context, mechanized)

import {describe, expect, test} from 'vitest';

import {buildContextSlice} from '../../src/optimizer/context-slice.js';

const SPEC = {
  project: {
    name: 'x',
    language: 'typescript',
    ai_hints: {preferred_patterns: [{when: 'new detector', prefer: 'sync + deterministic'}]},
  },
  features: [
    {id: 'F-aaaa1111', slug: 'auth-core', title: 'auth core', status: 'done', modules: ['src/auth/core.ts'],
     acceptance_criteria: [{id: 'AC-001', text: 't', test_refs: ['tests/auth/core.test.ts']}]},
    {id: 'F-bbbb2222', slug: 'login-flow', title: 'login flow', status: 'in_progress', modules: ['src/auth/login.ts'],
     depends_on: ['F-aaaa1111'],
     acceptance_criteria: [
       {id: 'AC-001', text: 't', test_refs: ['tests/auth/login.test.ts', 'tests/auth/shared.test.ts']},
       {id: 'AC-002', text: 't', test_refs: ['tests/auth/login.test.ts']},
     ]},
  ],
  scenarios: [
    {id: 'S-0001', title: 'user logs in', features: ['F-bbbb2222']},
    {id: 'S-0002', title: 'unrelated', features: []},
  ],
} as never;

describe('buildContextSlice (F-d2c806)', () => {
  test('resolves by id, slug, and module path identically', () => {
    for (const q of ['F-bbbb2222', 'login-flow', 'src/auth/login.ts']) {
      const slice = buildContextSlice(SPEC, q);
      expect('focus' in slice && slice.focus.id).toBe('F-bbbb2222');
    }
  });

  test('the slice carries ancestor summaries, bound scenarios, ai_hints patterns, and a deduped sorted test_refs union', () => {
    const slice = buildContextSlice(SPEC, 'login-flow');
    if (!('focus' in slice)) throw new Error('miss');
    expect(slice.ancestors).toEqual([{id: 'F-aaaa1111', title: 'auth core', status: 'done'}]);
    expect(slice.scenarios).toEqual([{id: 'S-0001', title: 'user logs in'}]);
    expect(slice.preferred_patterns[0].prefer).toBe('sync + deterministic');
    expect(slice.test_refs).toEqual(['tests/auth/login.test.ts', 'tests/auth/shared.test.ts']);
  });

  test('determinism: identical spec state yields byte-identical slices', () => {
    const a = JSON.stringify(buildContextSlice(SPEC, 'login-flow'));
    const b = JSON.stringify(buildContextSlice(SPEC, 'login-flow'));
    expect(a).toBe(b);
  });

  test('a miss names the accepted forms and points at spec/index.yaml', () => {
    const miss = buildContextSlice(SPEC, 'nope');
    if ('focus' in miss) throw new Error('should miss');
    expect(miss.not_found).toBe('nope');
    expect(miss.accepted_forms.length).toBe(3);
    expect(miss.discovery).toContain('spec/index.yaml');
  });
});
