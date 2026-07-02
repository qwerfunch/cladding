import {describe, test, expect} from 'vitest';
import {buildImpactSlice, collectDependents} from '../../src/optimizer/reverse-slice.js';
import type {Spec} from '../../src/spec/types.js';

type Feature = {
  id: string;
  title: string;
  status: 'done';
  depends_on?: string[];
  modules?: string[];
  acceptance_criteria?: {id: string; test_refs?: string[]}[];
};

type Scenario = {
  id: string;
  title: string;
  features?: string[];
};

function mkSpec(features: Feature[], scenarios: Scenario[] = []): Spec {
  return {
    schema: '0.1',
    project: {name: 'x', language: 'typescript'},
    features,
    scenarios,
  } as unknown as Spec;
}

describe('reverse-slice / impact (F-7794a6bc)', () => {
  test('feature query returns focus, transitive dependents, scenarios, test_refs union, impacted modules', () => {
    const spec = mkSpec(
      [
        {
          id: 'A',
          title: 'A',
          status: 'done',
          modules: ['src/a.ts'],
          acceptance_criteria: [{id: 'A-1', test_refs: ['tests/a.test.ts#x']}],
        },
        {
          id: 'B',
          title: 'B',
          status: 'done',
          depends_on: ['A'],
          modules: ['src/b.ts'],
          acceptance_criteria: [{id: 'B-1', test_refs: ['tests/b.test.ts#y']}],
        },
        {
          id: 'C',
          title: 'C',
          status: 'done',
          depends_on: ['B'],
          modules: ['src/c.ts'],
          acceptance_criteria: [{id: 'C-1', test_refs: ['tests/c.test.ts#z']}],
        },
        {
          id: 'D',
          title: 'D',
          status: 'done',
          modules: ['src/d.ts'],
        },
      ],
      [
        {id: 'S1', title: 'S1', features: ['B']},
        {id: 'S2', title: 'S2', features: ['D']},
      ],
    );

    const r = buildImpactSlice(spec, 'A');
    expect('not_found' in r).toBe(false);
    if ('not_found' in r) throw new Error('unexpected miss');

    expect(r.focus.id).toBe('A');
    expect(r.impacted.map((i) => i.id)).toEqual(['B', 'C']);
    expect(r.impacted_modules).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(r.scenarios.map((s) => s.id)).toEqual(['S1']);
    expect(r.test_refs).toEqual([
      'tests/a.test.ts#x',
      'tests/b.test.ts#y',
      'tests/c.test.ts#z',
    ]);
  });

  test('module path query resolves all owners (many-to-many) and computes blast radius', () => {
    const spec = mkSpec([
      {id: 'F1', title: 'F1', status: 'done', modules: ['src/shared.ts']},
      {id: 'F2', title: 'F2', status: 'done', modules: ['src/shared.ts']},
      {id: 'G', title: 'G', status: 'done', depends_on: ['F1']},
    ]);

    const r = buildImpactSlice(spec, 'src/shared.ts');
    expect('not_found' in r).toBe(false);
    if ('not_found' in r) throw new Error('unexpected miss');

    expect(r.focus.module).toBe('src/shared.ts');
    expect(r.focus.owners).toEqual(['F1', 'F2']);
    expect(r.impacted.map((i) => i.id)).toEqual(['G']);
  });

  test('a miss returns not_found naming the accepted forms', () => {
    const r = buildImpactSlice(mkSpec([{id: 'A', title: 'A', status: 'done'}]), 'nope');
    expect('not_found' in r).toBe(true);
    const miss = r as {not_found: string; accepted_forms: readonly string[]};
    expect(miss.not_found).toBe('nope');
    const forms = miss.accepted_forms;
    expect(Array.isArray(forms)).toBe(true);
    expect(forms.length).toBeGreaterThan(0);
    const joined = forms.join(' ');
    expect(joined).toContain('slug');
    expect(joined).toContain('module');
  });

  test('depth bounds the dependent walk and output is deterministic', () => {
    const deps = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['D'])],
    ]);

    expect([...collectDependents(['A'], deps, 1)].sort()).toEqual(['B']);
    expect([...collectDependents(['A'], deps, 2)].sort()).toEqual(['B', 'C']);
    expect([...collectDependents(['A'], deps)].sort()).toEqual(['B', 'C', 'D']);
    expect(collectDependents(['A'], deps).has('A')).toBe(false);

    const spec = mkSpec(
      [
        {
          id: 'A',
          title: 'A',
          status: 'done',
          modules: ['src/a.ts'],
          acceptance_criteria: [{id: 'A-1', test_refs: ['tests/a.test.ts#x']}],
        },
        {
          id: 'B',
          title: 'B',
          status: 'done',
          depends_on: ['A'],
          modules: ['src/b.ts'],
          acceptance_criteria: [{id: 'B-1', test_refs: ['tests/b.test.ts#y']}],
        },
        {
          id: 'C',
          title: 'C',
          status: 'done',
          depends_on: ['B'],
          modules: ['src/c.ts'],
          acceptance_criteria: [{id: 'C-1', test_refs: ['tests/c.test.ts#z']}],
        },
        {
          id: 'D',
          title: 'D',
          status: 'done',
          modules: ['src/d.ts'],
        },
      ],
      [
        {id: 'S1', title: 'S1', features: ['B']},
        {id: 'S2', title: 'S2', features: ['D']},
      ],
    );

    expect(JSON.stringify(buildImpactSlice(spec, 'A'))).toBe(
      JSON.stringify(buildImpactSlice(spec, 'A')),
    );

    const bounded = buildImpactSlice(spec, 'A', {depth: 1});
    expect('not_found' in bounded).toBe(false);
    if ('not_found' in bounded) throw new Error('unexpected miss');
    expect(bounded.impacted.map((i) => i.id)).toEqual(['B']);
  });

  test('BLANK ledger: impacted:[] carries zero-counts + fallback hints — unknown, not safe (F-c6a32fff)', () => {
    // The state of every freshly adopted project: features exist, no edges declared.
    const spec = mkSpec([
      {id: 'F-aaa111', title: 'A', status: 'done', modules: ['src/a.ts']},
      {id: 'F-bbb222', title: 'B', status: 'done', modules: ['src/b.ts']},
    ]);
    const slice = buildImpactSlice(spec, 'F-aaa111');
    if ('not_found' in slice) throw new Error('unexpected miss');
    expect(slice.impacted).toEqual([]);
    expect(slice.ledger?.depends_on_edges).toBe(0);
    expect(slice.ledger?.test_ref_edges).toBe(0);
    expect(slice.ledger?.fallback_hint).toContain('unknown, not safe');
    expect(slice.ledger?.regression_hint).toContain('run the full suite');
  });

  test('DENSE ledger: a verified leaf shows real edge counts and NO hints — distinguishable from blank', () => {
    const spec = mkSpec([
      {
        id: 'F-aaa111',
        title: 'A',
        status: 'done',
        modules: ['src/a.ts'],
        acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/a.test.ts#x']}],
      },
      {id: 'F-bbb222', title: 'B', status: 'done', depends_on: ['F-aaa111']},
      {id: 'F-leaf00', title: 'Leaf', status: 'done', modules: ['src/leaf.ts']}, // nothing depends on it
    ]);
    const slice = buildImpactSlice(spec, 'F-leaf00');
    if ('not_found' in slice) throw new Error('unexpected miss');
    expect(slice.impacted).toEqual([]); // same emptiness as blank map…
    expect(slice.ledger?.depends_on_edges).toBe(1); // …but the ledger says edges exist
    expect(slice.ledger?.test_ref_edges).toBe(1);
    expect(slice.ledger?.fallback_hint).toBeUndefined();
    expect(slice.ledger?.regression_hint).toBeUndefined();
  });
});
