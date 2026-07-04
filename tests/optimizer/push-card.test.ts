// Cladding · F-35954d19 — pure push-card formatter + hook-lane includeCode flag.
//
// TEST-AUTHOR context: derived from the F-35954d19 acceptance criteria, NOT the
// implementation. Every assertion traces to an AC:
//   AC-816f10c3  Tier-2 render bounds (≤5 lines, ≤600 chars, ≤3 ids, ≤3 tests, risk count)
//   AC-f912fd40  Tier-1 one-liner shape incl. the deps-unledgered disclosure; empty
//                consequences degrade the Tier-2 card to exactly the one-liner
//   AC-1bfccb6b  buildWorkingSet(..., {includeCode:false}) emits NO code excerpt body;
//                default true is unchanged
//   determinism  same WorkingSet in → byte-identical text out (item 8)

import {describe, test, expect, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {formatWorkingSetCard, formatPushOneLiner} from '../../src/optimizer/push-card.js';
import {buildWorkingSet, type WorkingSet} from '../../src/optimizer/working-set.js';
import type {Spec} from '../../src/spec/types.js';

// ─── WorkingSet fixture factory (only the fields the formatter reads matter) ───

interface Impacted {
  id: string;
  title: string;
  status?: string;
}

function makeWs(over: {
  id?: string;
  coOwners?: string[];
  impacted?: Impacted[];
  regression?: string[];
  highRisk?: {id: string; ears: string}[];
  dependsOnEdges?: number;
}): WorkingSet {
  return {
    must_edit: {
      id: over.id ?? 'F-focus',
      title: 'Focus',
      status: 'in_progress',
      modules: ['src/focus.ts'],
      acceptance_criteria: [],
      code: [],
      ...(over.coOwners ? {co_owners: over.coOwners} : {}),
    },
    needs: [],
    breaks_if_changed: {
      impacted: over.impacted ?? [],
      regression_tests: over.regression ?? [],
      ...(over.dependsOnEdges !== undefined
        ? {ledger: {depends_on_edges: over.dependsOnEdges, test_ref_edges: 0}}
        : {}),
    },
    verify: {
      scenarios: [],
      test_refs: [],
      oracle_refs: [],
      high_risk_acs: over.highRisk ?? [],
    },
    guidance: {preferred_patterns: []},
    budget: {max_tokens: 350, used_tokens: 0, truncated: []},
  };
}

function impactedList(n: number, titleLen = 2): Impacted[] {
  return Array.from({length: n}, (_, i) => ({
    id: `F-imp${String(i).padStart(3, '0')}`,
    title: 'T'.repeat(titleLen),
  }));
}

function testList(n: number): string[] {
  return Array.from({length: n}, (_, i) => `tests/t${String(i).padStart(2, '0')}.test.ts`);
}

// ─── AC-816f10c3 — Tier-2 render bounds ───

describe('formatWorkingSetCard — Tier-2 bounds (AC-816f10c3)', () => {
  // Table over consequence shapes; each row asserts the invariant bounds plus the
  // names/counts the AC promises. Long-title truncation is exercised separately.
  const rows: {
    name: string;
    impacted: number;
    tests: number;
    risk: number;
  }[] = [
    {name: '1 impacted / 1 test / 1 risk', impacted: 1, tests: 1, risk: 1},
    {name: '10 impacted / 10 tests / 5 risk → +7 more on both', impacted: 10, tests: 10, risk: 5},
    {name: '0 impacted / 0 tests / 3 risk → risk-only detail line', impacted: 0, tests: 0, risk: 3},
    {name: '4 impacted / 4 tests → +1 more boundary', impacted: 4, tests: 4, risk: 0},
  ];

  test.each(rows)('$name', ({impacted, tests, risk}) => {
    const ws = makeWs({
      impacted: impactedList(impacted),
      regression: testList(tests),
      highRisk: Array.from({length: risk}, (_, i) => ({id: `AC-${i}`, ears: 'unwanted'})),
    });
    const card = formatWorkingSetCard(ws, 'src/focus.ts');
    const lines = card.split('\n');

    // hard bounds — the anti-annoyance contract
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(card.length).toBeLessThanOrEqual(600);

    // names AT MOST 3 impacted ids
    if (impacted > 0) {
      const shown = impactedList(impacted).filter((f) => card.includes(f.id));
      expect(shown.length).toBe(Math.min(3, impacted));
      if (impacted > 3) expect(card).toContain(`(+${impacted - 3} more)`);
    } else {
      expect(card).not.toContain('breaks:');
    }

    // names AT MOST 3 regression test paths
    if (tests > 0) {
      const shownT = testList(tests).filter((p) => card.includes(p));
      expect(shownT.length).toBe(Math.min(3, tests));
      if (tests > 3) expect(card).toContain(`(+${tests - 3} more)`);
    } else {
      expect(card).not.toContain('run:');
    }

    // the high-risk AC COUNT (not the list)
    if (risk > 0) {
      expect(card).toContain(`risk: ${risk} high-risk AC(s)`);
    } else {
      expect(card).not.toContain('risk:');
    }
  });

  test('600-char ceiling truncates long titles with an ellipsis, still ≤5 lines', () => {
    const ws = makeWs({
      impacted: [
        {id: 'F-imp000', title: 'X'.repeat(300)},
        {id: 'F-imp001', title: 'Y'.repeat(300)},
        {id: 'F-imp002', title: 'Z'.repeat(300)},
      ],
      regression: testList(4),
      highRisk: [{id: 'AC-0', ears: 'state'}],
    });
    const card = formatWorkingSetCard(ws, 'src/focus.ts');
    expect(card.length).toBeLessThanOrEqual(600);
    expect(card.length).toBeGreaterThan(500); // it really did fill toward the cap
    expect(card.endsWith('…')).toBe(true);
    expect(card.split('\n').length).toBeLessThanOrEqual(5);
  });

  test('no owner id → empty card (nothing to push)', () => {
    expect(formatWorkingSetCard(makeWs({id: ''}), 'src/focus.ts')).toBe('');
  });
});

// ─── AC-f912fd40 — Tier-1 one-liner shape + degrade ───

describe('formatPushOneLiner — Tier-1 shape (AC-f912fd40)', () => {
  test('zero-consequence, no depends_on edges → one-liner WITH deps-unledgered disclosure', () => {
    const ws = makeWs({dependsOnEdges: 0});
    expect(formatPushOneLiner(ws, 'src/focus.ts')).toBe(
      'cladding impact: src/focus.ts → F-focus · deps unledgered',
    );
  });

  test('breaks/run segments appear only when non-empty; ledger>0 → no disclosure', () => {
    const ws = makeWs({
      impacted: impactedList(2),
      regression: testList(3),
      dependsOnEdges: 4,
    });
    expect(formatPushOneLiner(ws, 'src/focus.ts')).toBe(
      'cladding impact: src/focus.ts → F-focus · breaks 2 feature(s) · run 3 test(s)',
    );
  });

  test('co-owners are disclosed on the one-liner', () => {
    const ws = makeWs({coOwners: ['F-a', 'F-focus', 'F-z']});
    // 3 co-owners → "(+2 co-owners)"
    expect(formatPushOneLiner(ws, 'src/focus.ts')).toContain('(+2 co-owners)');
  });

  test('a consequence-free working set degrades formatWorkingSetCard → exactly the one-liner', () => {
    const ws = makeWs({dependsOnEdges: 0});
    expect(formatWorkingSetCard(ws, 'src/focus.ts')).toBe(formatPushOneLiner(ws, 'src/focus.ts'));
  });

  test('no owner id → empty one-liner', () => {
    expect(formatPushOneLiner(makeWs({id: ''}), 'src/focus.ts')).toBe('');
  });
});

// ─── determinism (item 8) ───

describe('push-card determinism', () => {
  const ws = makeWs({
    impacted: impactedList(6),
    regression: testList(6),
    highRisk: [{id: 'AC-0', ears: 'unwanted'}],
    dependsOnEdges: 3,
  });

  test('identical WorkingSet → byte-identical Tier-2 card across calls', () => {
    expect(formatWorkingSetCard(ws, 'src/focus.ts')).toBe(formatWorkingSetCard(ws, 'src/focus.ts'));
  });

  test('identical WorkingSet → byte-identical one-liner across calls', () => {
    expect(formatPushOneLiner(ws, 'src/focus.ts')).toBe(formatPushOneLiner(ws, 'src/focus.ts'));
  });
});

// ─── AC-1bfccb6b — the includeCode hook-lane flag on buildWorkingSet ───

const tmpDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clad-pushcard-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, {recursive: true, force: true});
  }
});

function makeSpec(id: string, modules: string[]): Spec {
  return {
    project: {name: 't', language: 'typescript', ai_hints: {preferred_patterns: []}},
    features: [
      {
        id,
        slug: 'x',
        title: 'X',
        status: 'done',
        modules,
        depends_on: [],
        acceptance_criteria: [{id: 'AC-001', ears: 'ubiquitous', text: 't', test_refs: [], oracle_refs: []}],
      },
    ],
    scenarios: [{id: 'S-1', title: 's', features: [id]}],
  } as unknown as Spec;
}

function asWs(r: WorkingSet | {not_found: string}): WorkingSet {
  if ('not_found' in r) throw new Error('expected a working set, got a miss');
  return r;
}

describe('buildWorkingSet includeCode flag (AC-1bfccb6b)', () => {
  const SENTINEL = 'SENTINEL_CODE_MUST_NOT_LEAK';

  test('default (includeCode omitted) → code excerpts ARE filled (existing behavior pinned)', () => {
    const dir = makeTmp();
    writeFileSync(join(dir, 'mod.ts'), `export const x = "${SENTINEL}";\n`.repeat(20), 'utf8');
    const spec = makeSpec('F-x', ['mod.ts']);
    const ws = asWs(buildWorkingSet(spec, 'F-x', {cwd: dir}));
    expect(ws.must_edit.code.length).toBeGreaterThan(0);
    expect(ws.must_edit.code.some((c) => (c.text ?? '').includes(SENTINEL))).toBe(true);
  });

  test('includeCode:false → zero code excerpts, no text body (the hook push lane)', () => {
    const dir = makeTmp();
    writeFileSync(join(dir, 'mod.ts'), `export const x = "${SENTINEL}";\n`.repeat(20), 'utf8');
    const spec = makeSpec('F-x', ['mod.ts']);
    const ws = asWs(buildWorkingSet(spec, 'F-x', {cwd: dir, includeCode: false, maxTokens: 350}));
    expect(ws.must_edit.code).toEqual([]);
    expect(ws.must_edit.code.every((c) => c.text === undefined)).toBe(true);
  });

  test('includeCode:false skips code even when the module is large (no clip marker either)', () => {
    const dir = makeTmp();
    writeFileSync(join(dir, 'mod.ts'), `// ${SENTINEL}\n`.repeat(5000), 'utf8'); // large
    const spec = makeSpec('F-x', ['mod.ts']);
    const ws = asWs(buildWorkingSet(spec, 'F-x', {cwd: dir, includeCode: false, maxTokens: 350}));
    expect(ws.must_edit.code).toEqual([]);
    const serialized = JSON.stringify(ws);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain('clipped');
  });
});
