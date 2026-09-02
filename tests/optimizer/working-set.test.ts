import {describe, test, expect, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {estTokens} from '../../src/optimizer/code-excerpt.js';
import {buildWorkingSet} from '../../src/optimizer/working-set.js';
import type {Spec} from '../../src/spec/types.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clad-ws-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, {recursive: true, force: true});
  }
});

interface ACSeed {
  id: string;
  ears?: string;
  text?: string;
  test_refs?: string[];
  oracle_refs?: string[];
}

interface FeatureSeed {
  id: string;
  slug: string;
  title: string;
  status?: string;
  modules?: string[];
  depends_on?: string[];
  acceptance_criteria?: ACSeed[];
}

function ac(seed: ACSeed): ACSeed {
  return {
    id: seed.id,
    ears: seed.ears ?? 'ubiquitous',
    text: seed.text ?? 't',
    test_refs: seed.test_refs ?? [],
    oracle_refs: seed.oracle_refs ?? [],
  };
}

function feature(seed: FeatureSeed): FeatureSeed {
  return {
    id: seed.id,
    slug: seed.slug,
    title: seed.title,
    status: seed.status ?? 'done',
    modules: seed.modules ?? [],
    depends_on: seed.depends_on ?? [],
    acceptance_criteria: seed.acceptance_criteria ?? [
      ac({id: 'AC-001', ears: 'unwanted', text: 't', test_refs: ['tests/x.test.ts#a'], oracle_refs: ['o1']}),
    ],
  };
}

function makeSpec(features: FeatureSeed[], scenarios?: {id: string; title: string; features: string[]}[]): Spec {
  return {
    project: {
      name: 't',
      language: 'typescript',
      ai_hints: {
        preferred_patterns: [{when: 'w', prefer: 'p', over: 'o'}],
      },
    },
    features,
    scenarios: scenarios ?? [{id: 'S-1', title: 's', features: [features[0]?.id ?? 'F-aaa111']}],
  } as unknown as Spec;
}

interface MinimalRef {
  id: string;
  title: string;
  status?: string;
}

interface WorkingSetShape {
  must_edit: {
    id: string;
    title: string;
    status: string;
    modules: string[];
    acceptance_criteria: ACSeed[];
    code: {path: string; text?: string; truncated?: boolean; omitted?: string; bytes?: number}[];
    co_owners?: string[];
  };
  needs: MinimalRef[];
  breaks_if_changed: {impacted: MinimalRef[]; regression_tests: string[]};
  verify: {
    scenarios: {id: string; title: string}[];
    test_refs: string[];
    oracle_refs: string[];
    high_risk_acs: {id: string; ears: string}[];
  };
  guidance: {preferred_patterns: {when: string; prefer: string; over?: string}[]};
  budget: {max_tokens: number; used_tokens: number; truncated: string[]};
}

interface MissShape {
  not_found: string;
  accepted_forms: string[];
  discovery: string;
}

function isMiss(r: WorkingSetShape | MissShape): r is MissShape {
  return Object.prototype.hasOwnProperty.call(r, 'not_found');
}

describe('working-set', () => {
  test('[covers:F-06dfdad6/AC-62d89e] resolves id, slug, and module path (multi-owner picks first + lists co-owners)', () => {
    const spec = makeSpec([
      feature({id: 'F-bbb222', slug: 'beta', title: 'Beta', modules: ['src/shared.ts']}),
      feature({id: 'F-aaa111', slug: 'alpha', title: 'Alpha', modules: ['src/shared.ts']}),
    ]);

    const byModule = buildWorkingSet(spec, 'src/shared.ts') as WorkingSetShape | MissShape;
    expect(isMiss(byModule)).toBe(false);
    if (isMiss(byModule)) throw new Error('expected a working set');
    expect(byModule.must_edit.id).toBe('F-aaa111');
    expect(byModule.must_edit.co_owners).toBeDefined();
    expect(byModule.must_edit.co_owners).toContain('F-aaa111');
    expect(byModule.must_edit.co_owners).toContain('F-bbb222');
    // sorted
    const co = byModule.must_edit.co_owners ?? [];
    expect([...co].sort()).toEqual(co);

    const byId = buildWorkingSet(spec, 'F-aaa111') as WorkingSetShape | MissShape;
    expect(isMiss(byId)).toBe(false);
    if (isMiss(byId)) throw new Error('expected a working set');
    expect(byId.must_edit.id).toBe('F-aaa111');

    const bySlug = buildWorkingSet(spec, 'alpha') as WorkingSetShape | MissShape;
    expect(isMiss(bySlug)).toBe(false);
    if (isMiss(bySlug)) throw new Error('expected a working set');
    expect(bySlug.must_edit.id).toBe('F-aaa111');
  });

  test('[covers:F-06dfdad6/AC-62d89e] unknown query returns a not_found miss', () => {
    const spec = makeSpec([feature({id: 'F-aaa111', slug: 'alpha', title: 'Alpha'})]);
    const r = buildWorkingSet(spec, 'F-nope') as WorkingSetShape | MissShape;
    expect(isMiss(r)).toBe(true);
    if (!isMiss(r)) throw new Error('expected a miss');
    expect(r.not_found).toBe('F-nope');
    expect(Array.isArray(r.accepted_forms)).toBe(true);
    expect(r.accepted_forms.length).toBeGreaterThan(0);
    expect(typeof r.discovery).toBe('string');
  });

  test('[covers:F-06dfdad6/AC-d2b3c8] fuses forward needs + backward breaks + verify + guidance into one payload', () => {
    const spec = makeSpec([
      feature({id: 'F-base', slug: 'base', title: 'Base', depends_on: []}),
      feature({
        id: 'F-mid',
        slug: 'mid',
        title: 'Mid',
        depends_on: ['F-base'],
        acceptance_criteria: [
          ac({id: 'AC-001', ears: 'unwanted', test_refs: ['tests/b.test.ts#z', 'tests/a.test.ts#x']}),
          ac({id: 'AC-002', ears: 'event', test_refs: ['tests/a.test.ts#x', 'tests/c.test.ts#y']}),
        ],
      }),
      feature({id: 'F-top', slug: 'top', title: 'Top', depends_on: ['F-mid']}),
    ]);

    const r = buildWorkingSet(spec, 'F-mid') as WorkingSetShape | MissShape;
    expect(isMiss(r)).toBe(false);
    if (isMiss(r)) throw new Error('expected a working set');

    // forward ancestor
    expect(r.needs.map((n) => n.id)).toContain('F-base');

    // backward direct dependent
    expect(r.breaks_if_changed.impacted.map((i) => i.id)).toContain('F-top');

    // guidance seeded pattern
    expect(r.guidance.preferred_patterns).toEqual([{when: 'w', prefer: 'p', over: 'o'}]);

    // verify.test_refs = union deduped + sorted
    const expectedRefs = ['tests/a.test.ts#x', 'tests/b.test.ts#z', 'tests/c.test.ts#y'];
    expect(r.verify.test_refs).toEqual(expectedRefs);

    // all sections present
    expect(r.must_edit).toBeDefined();
    expect(r.needs).toBeDefined();
    expect(r.breaks_if_changed).toBeDefined();
    expect(r.verify).toBeDefined();
    expect(r.guidance).toBeDefined();
    expect(r.budget).toBeDefined();
    expect(Array.isArray(r.verify.scenarios)).toBe(true);
    expect(Array.isArray(r.verify.oracle_refs)).toBe(true);
    expect(Array.isArray(r.verify.high_risk_acs)).toBe(true);
    expect(Array.isArray(r.breaks_if_changed.regression_tests)).toBe(true);
  });

  test('[covers:F-06dfdad6/AC-d2b3c8] flags EARS unwanted/state acceptance criteria as high-risk', () => {
    const spec = makeSpec([
      feature({
        id: 'F-aaa111',
        slug: 'alpha',
        title: 'Alpha',
        acceptance_criteria: [
          ac({id: 'AC-001', ears: 'unwanted'}),
          ac({id: 'AC-002', ears: 'state'}),
          ac({id: 'AC-003', ears: 'ubiquitous'}),
        ],
      }),
    ]);

    const r = buildWorkingSet(spec, 'F-aaa111') as WorkingSetShape | MissShape;
    expect(isMiss(r)).toBe(false);
    if (isMiss(r)) throw new Error('expected a working set');

    const ids = r.verify.high_risk_acs.map((a) => a.id).sort();
    expect(ids).toEqual(['AC-001', 'AC-002']);
    for (const entry of r.verify.high_risk_acs) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.ears).toBe('string');
    }
    // ubiquitous not flagged
    expect(r.verify.high_risk_acs.map((a) => a.id)).not.toContain('AC-003');
  });

  test('enforces the token budget and records what was truncated', () => {
    // Large structural payload: 20 ancestor deps on the focus feature.
    const ancestors: FeatureSeed[] = [];
    const depIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `F-d${String(i).padStart(2, '0')}`;
      depIds.push(id);
      ancestors.push(
        feature({
          id,
          slug: `dep${i}`,
          title: `Dependency number ${i} with a reasonably long descriptive title to add weight`,
          depends_on: [],
        }),
      );
    }
    const focus = feature({id: 'F-focus', slug: 'focus', title: 'Focus', depends_on: depIds});
    const bigSpec = makeSpec([focus, ...ancestors]);

    const tight = buildWorkingSet(bigSpec, 'F-focus', {maxTokens: 600}) as WorkingSetShape | MissShape;
    expect(isMiss(tight)).toBe(false);
    if (isMiss(tight)) throw new Error('expected a working set');
    expect(tight.budget.max_tokens).toBe(600);
    expect(Array.isArray(tight.budget.truncated)).toBe(true);
    expect(tight.budget.truncated.length).toBeGreaterThan(0);
    expect(tight.needs.length).toBeLessThan(depIds.length);
    // focus is always retained
    expect(tight.must_edit.id).toBe('F-focus');

    // Generous budget on a small feature -> nothing truncated, all ancestors present.
    const smallSpec = makeSpec([
      feature({id: 'F-base', slug: 'base', title: 'Base', depends_on: []}),
      feature({id: 'F-leaf', slug: 'leaf', title: 'Leaf', depends_on: ['F-base']}),
    ]);
    const loose = buildWorkingSet(smallSpec, 'F-leaf', {maxTokens: 100000}) as WorkingSetShape | MissShape;
    expect(isMiss(loose)).toBe(false);
    if (isMiss(loose)) throw new Error('expected a working set');
    expect(loose.budget.max_tokens).toBe(100000);
    expect(loose.budget.truncated).toEqual([]);
    expect(loose.needs.map((n) => n.id)).toContain('F-base');
  });

  test('[covers:F-06dfdad6/AC-833f1c] is deterministic for identical spec + files', () => {
    const dir = makeTmp();
    writeFileSync(join(dir, 'mod.ts'), 'export const v = 1;\n', 'utf8');
    const spec = makeSpec([
      feature({id: 'F-base', slug: 'base', title: 'Base', depends_on: []}),
      feature({
        id: 'F-aaa111',
        slug: 'alpha',
        title: 'Alpha',
        modules: ['mod.ts'],
        depends_on: ['F-base'],
      }),
    ]);

    const a = buildWorkingSet(spec, 'F-aaa111', {cwd: dir, maxTokens: 100000});
    const b = buildWorkingSet(spec, 'F-aaa111', {cwd: dir, maxTokens: 100000});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('[covers:F-c6a32fff/AC-67150016] blank-ledger radius: no-known-dependents, coverage null (not 0), denominator + ledger surfaced (F-c6a32fff)', () => {
    // Zero depends_on and zero test_refs anywhere — the freshly-adopted state.
    const spec = makeSpec([
      feature({id: 'F-aaa111', slug: 'alpha', title: 'Alpha', acceptance_criteria: [ac({id: 'AC-001', test_refs: []})]}),
      feature({id: 'F-bbb222', slug: 'beta', title: 'Beta', acceptance_criteria: [ac({id: 'AC-001', test_refs: []})]}),
    ]);
    const r = buildWorkingSet(spec, 'F-aaa111') as WorkingSetShape | MissShape;
    expect(isMiss(r)).toBe(false);
    if (isMiss(r)) throw new Error('expected a working set');
    const breaks = r.breaks_if_changed as typeof r.breaks_if_changed & {
      radius?: {depth: number; stopped_by: string; coverage: number | null; total_known_dependents: number};
      ledger?: {depends_on_edges: number; test_ref_edges: number; fallback_hint?: string};
    };
    expect(breaks.radius?.stopped_by).toBe('no-known-dependents');
    // JS null*100===0 — an unguarded round would render a FALSE "0% coverage".
    expect(breaks.radius?.coverage).toBeNull();
    expect(breaks.radius?.total_known_dependents).toBe(0);
    expect(breaks.ledger?.depends_on_edges).toBe(0);
    expect(breaks.ledger?.fallback_hint).toContain('unknown, not safe');
  });

  test('[covers:F-06dfdad6/AC-d2b3c8] a module query seeds ALL co-owners — their dependents and tests reach breaks_if_changed', () => {
    // v0.7.0 regression: only the alphabetically-first owner was seeded, so a
    // shared file's other owners contributed nothing to the blast radius
    // (src/cli/clad.ts on cladding-self: impacted 0 vs 83). Simulation
    // fixture, now locked as a test.
    const spec = makeSpec([
      feature({
        id: 'F-aaa111',
        slug: 'alpha',
        title: 'Alpha',
        modules: ['src/shared.ts'],
        acceptance_criteria: [ac({id: 'AC-001', test_refs: []})],
      }),
      feature({
        id: 'F-bbb222',
        slug: 'beta',
        title: 'Beta',
        modules: ['src/shared.ts'],
        acceptance_criteria: [ac({id: 'AC-001', test_refs: ['tests/beta.test.ts']})],
      }),
      feature({
        id: 'F-ccc333',
        slug: 'gamma',
        title: 'Gamma',
        depends_on: ['F-bbb222'],
        acceptance_criteria: [ac({id: 'AC-001', test_refs: ['tests/gamma.test.ts']})],
      }),
    ]);

    const r = buildWorkingSet(spec, 'src/shared.ts') as WorkingSetShape | MissShape;
    expect(isMiss(r)).toBe(false);
    if (isMiss(r)) throw new Error('expected a working set');
    expect(r.must_edit.id).toBe('F-aaa111'); // focus stays the first owner
    // F-ccc333 is reachable only through co-owner F-bbb222 — the fan-out.
    expect(r.breaks_if_changed.impacted.map((f) => f.id)).toContain('F-ccc333');
    expect(r.breaks_if_changed.regression_tests).toContain('tests/gamma.test.ts');
    expect(r.breaks_if_changed.regression_tests).toContain('tests/beta.test.ts');
    // co-owners are seeds, not impacted — they already sit in co_owners.
    expect(r.breaks_if_changed.impacted.map((f) => f.id)).not.toContain('F-bbb222');
  });

  test('budget pressure clips deeper dependents (and reports it) but never the depth-1 direct set', () => {
    const deepTitle = 'E'.repeat(300);
    const directs = ['F-d00001', 'F-d00002', 'F-d00003'].map((id, i) =>
      feature({id, slug: `d${i}`, title: `D${i}`, depends_on: ['F-hub111']}),
    );
    const deepers = Array.from({length: 10}, (_, i) =>
      feature({
        id: `F-e${String(i).padStart(5, '0')}`,
        slug: `e${i}`,
        title: deepTitle,
        depends_on: ['F-d00001'],
        acceptance_criteria: [ac({id: 'AC-001', test_refs: [`tests/e${i}.test.ts`]})],
      }),
    );
    const spec = makeSpec([feature({id: 'F-hub111', slug: 'hub', title: 'Hub'}), ...directs, ...deepers]);

    const clipped = buildWorkingSet(spec, 'F-hub111', {maxTokens: 600}) as WorkingSetShape | MissShape;
    expect(isMiss(clipped)).toBe(false);
    if (isMiss(clipped)) throw new Error('expected a working set');
    expect(clipped.budget.used_tokens).toBeLessThanOrEqual(600);
    const keptIds = clipped.breaks_if_changed.impacted.map((f) => f.id);
    for (const d of ['F-d00001', 'F-d00002', 'F-d00003']) expect(keptIds).toContain(d); // direct floor retained
    expect(keptIds.length).toBeLessThan(13); // some deeper dependents dropped
    expect(clipped.budget.truncated.some((t) => t.startsWith('breaks: omitted'))).toBe(true);
    // the depth-1 floor's tests survive
    expect(clipped.breaks_if_changed.regression_tests).toContain('tests/x.test.ts#a');

    // Generous budget → pure no-op: full radius, no breaks marker.
    const roomy = buildWorkingSet(spec, 'F-hub111', {maxTokens: 100000}) as WorkingSetShape | MissShape;
    if (isMiss(roomy)) throw new Error('expected a working set');
    expect(roomy.breaks_if_changed.impacted).toHaveLength(13);
    expect(roomy.budget.truncated.some((t) => t.startsWith('breaks:'))).toBe(false);
  });

  test('[covers:F-06dfdad6/AC-05ea70] clips needs, code, then breaks while retaining the full focus and depth-1 floor within its marked budget', () => {
    const ancestorIds = Array.from({length: 10}, (_, index) => `F-need${String(index).padStart(2, '0')}`);
    const focusAcs = [
      ac({id: 'AC-focus-1', ears: 'unwanted', text: 'Keep the entire focus contract.', test_refs: ['tests/focus.test.ts#focus']}),
      ac({id: 'AC-focus-2', ears: 'state', text: 'Keep all focus acceptance criteria.', test_refs: ['tests/focus.test.ts#state']}),
    ];
    const focus = feature({
      id: 'F-focus', slug: 'focus', title: 'Focus', depends_on: ancestorIds,
      modules: ['src/focus-a.ts', 'src/focus-b.ts'], acceptance_criteria: focusAcs,
    });
    const ancestors = ancestorIds.map((id, index) => feature({
      id, slug: `need-${index}`, title: `Need ${index}: ${'N'.repeat(240)}`,
    }));
    const directIds = ['F-direct-a', 'F-direct-b'];
    const directs = directIds.map((id, index) => feature({
      id, slug: `direct-${index}`, title: `Direct ${index}`, depends_on: ['F-focus'],
    }));
    const deepers = Array.from({length: 12}, (_, index) => feature({
      id: `F-deep${String(index).padStart(2, '0')}`,
      slug: `deep-${index}`,
      title: `Deep ${index}: ${'D'.repeat(260)}`,
      depends_on: ['F-direct-a'],
      acceptance_criteria: [ac({id: `AC-deep-${index}`, test_refs: [`tests/deep-${index}.test.ts#regression`]})],
    }));
    const spec = makeSpec([focus, ...ancestors, ...directs, ...deepers]);
    const read = (path: string): string | null => path.startsWith('src/focus-') ? `export const source = '${'S'.repeat(12_000)}';\n` : null;
    const maxTokens = 1400;
    const clipped = buildWorkingSet(spec, 'F-focus', {maxTokens, read}) as WorkingSetShape | MissShape;
    const roomy = buildWorkingSet(spec, 'F-focus', {maxTokens: 100_000, read}) as WorkingSetShape | MissShape;
    expect(isMiss(clipped)).toBe(false);
    expect(isMiss(roomy)).toBe(false);
    if (isMiss(clipped) || isMiss(roomy)) throw new Error('expected working sets');

    const needsMarker = clipped.budget.truncated.findIndex(marker => marker.startsWith('needs: dropped'));
    const codeMarker = clipped.budget.truncated.findIndex(marker => marker.startsWith('code:'));
    const breaksMarker = clipped.budget.truncated.findIndex(marker => marker.startsWith('breaks: omitted'));
    expect(needsMarker).toBeGreaterThanOrEqual(0);
    expect(codeMarker).toBeGreaterThan(needsMarker);
    expect(breaksMarker).toBeGreaterThan(codeMarker);

    expect(clipped.must_edit.id).toBe(focus.id);
    expect(clipped.must_edit.acceptance_criteria).toEqual(focusAcs);
    for (const directId of directIds) expect(clipped.breaks_if_changed.impacted.map(feature => feature.id)).toContain(directId);
    expect(clipped.needs.length).toBeGreaterThanOrEqual(3);
    expect(clipped.needs.length).toBeLessThan(ancestorIds.length);

    for (const module of focus.modules ?? []) {
      const excerpt = clipped.must_edit.code.find(entry => entry.path === module);
      if (excerpt === undefined) {
        expect(clipped.budget.truncated).toContain(`code: omitted ${module} (budget)`);
      } else {
        expect(excerpt.truncated).toBe(true);
        expect(clipped.budget.truncated).toContain(`code: clipped ${module}`);
      }
    }
    const breakCounts = /breaks: omitted (\d+) feature\(s\) \/ (\d+) test\(s\)/.exec(clipped.budget.truncated[breaksMarker] ?? '');
    expect(breakCounts).not.toBeNull();
    expect(Number(breakCounts?.[1])).toBe(roomy.breaks_if_changed.impacted.length - clipped.breaks_if_changed.impacted.length);
    expect(Number(breakCounts?.[2])).toBe(roomy.breaks_if_changed.regression_tests.length - clipped.breaks_if_changed.regression_tests.length);

    expect(clipped.budget.used_tokens).toBeLessThanOrEqual(maxTokens);
    expect(clipped.budget.used_tokens).toBe(estTokens(JSON.stringify({
      ...clipped,
      budget: {...clipped.budget, used_tokens: 0},
    })));

    const overflowAcs = [ac({
      id: 'AC-overflow',
      text: `Immutable focus contract: ${'I'.repeat(8_000)}`,
      test_refs: ['tests/overflow.test.ts#focus'],
    })];
    const overflowFocus = feature({
      id: 'F-overflow',
      slug: 'overflow',
      title: `Immutable focus title: ${'T'.repeat(2_000)}`,
      acceptance_criteria: overflowAcs,
    });
    const overflow = buildWorkingSet(makeSpec([overflowFocus]), 'F-overflow', {maxTokens: 100}) as WorkingSetShape | MissShape;
    expect(isMiss(overflow)).toBe(false);
    if (isMiss(overflow)) throw new Error('expected an overflowing working set');
    expect(overflow.must_edit.id).toBe(overflowFocus.id);
    expect(overflow.must_edit.title).toBe(overflowFocus.title);
    expect(overflow.must_edit.acceptance_criteria).toEqual(overflowAcs);
    expect(JSON.stringify(overflow.must_edit.acceptance_criteria)).toBe(JSON.stringify(overflowAcs));
    expect(overflow.budget.truncated).toContain('must-edit exceeds budget — retained in full (focus is never dropped)');
    expect(overflow.budget.used_tokens).toBeGreaterThan(overflow.budget.max_tokens);
  });
});
