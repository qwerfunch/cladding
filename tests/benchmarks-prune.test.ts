// Cladding · benchmarks-prune AC tests (F-27e56a00)
//
// C2 verifier lane (Sonnet) — authored independently of the implementation
// per C2-brief.md / C2-impl.md: two superseded benchmark run-logs
// (v0.4.0-consistency-bench, v0.6.0-real-user-verification) compressed IN
// PLACE to dated abstracts, the append-only policy amended FIRST (the
// docs/README.md benchmarks authority cell + the refinement-backlog
// rejection bullet), the four protected benchmarks left whole, and F-066's
// AC-178 evidence claim corrected to cite GOVERNANCE.md instead of the
// READMEs.
//
// Dogfood self-check (sibling home: tests/docs-prune.test.ts pattern, tests
// root). The retracted F-066 claim ("add an Evidence section to
// README.md …") is assembled at runtime from fragments, never written
// contiguously below, so this file cannot accidentally re-plant the exact
// stale phrasing it exists to prove absent.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {parseSpec} from '../src/spec/parse.js';
import type {AcceptanceCriterion, Feature} from '../src/spec/types.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const loadFeature = (rel: string): Feature => parseSpec(join(ROOT, rel)) as Feature;

/** Counts lines the way `wc -l` does (a trailing newline isn't a phantom extra line). */
const lineCount = (body: string): number => body.trimEnd().split('\n').length;

const V040 = 'docs/benchmarks/v0.4.0-consistency-bench.md';
const V060 = 'docs/benchmarks/v0.6.0-real-user-verification.md';
const BACKLOG = 'docs/refinement-backlog.md';
const README = 'docs/README.md';
const F066 = 'spec/features/F-066.yaml';

describe('AC-37cd2624 · superseded run-logs compress to dated abstracts at their original path, policy amended first', () => {
  test('both abstracts exist at their original paths and stay within the 25-line compression budget', () => {
    for (const f of [V040, V060]) {
      const lines = lineCount(read(f));
      expect(lines, `${f}: non-trivial content`).toBeGreaterThan(0);
      expect(lines, `${f}: compressed abstract (<= 25 lines)`).toBeLessThanOrEqual(25);
    }
  });

  test('both abstracts carry a git-history pointer line', () => {
    for (const f of [V040, V060]) {
      expect(read(f), `${f}: git-history pointer`).toContain('git history of this path');
    }
  });

  test('the v0.4.0 abstract names the six-phase design and carries its own headline caveat', () => {
    const body = read(V040);
    expect(body, 'names the six-phase design').toContain('Six-phase benchmark');
    expect(body, 'the caveat section is present').toContain('Headline caveat');
    expect(body, "the caveat's own confound wording (prompt-specificity)").toContain(
      'more-specific prompt produces more-specific output',
    );
    expect(body, 'the caveat states only #1 is uniquely cladding').toContain('only #1 is uniquely cladding');
  });

  test('the v0.6.0 abstract carries the conformance NULLs, the 3 shipped-bug catches, and the oracle-policy defect', () => {
    const body = read(V060);
    expect(body, 'the conformance-NULLs section').toContain('Conformance NULLs');
    expect(body, 'the NULL verdict itself (governance, not correctness)').toContain('not correctness');
    expect(body, 'the 3-shipped-bug-catches heading').toContain('3 shipped-bug catches');
    expect(body, 'catch #1 — sync ship blocker').toContain('SHIP BLOCKER');
    expect(body, 'catch #2 — supply-chain typosquat').toContain('supply chain');
    expect(body, 'catch #3 — MCP protocol corruption').toContain('protocol corruption');
    expect(body, 'the oracle-policy defect heading').toContain('Oracle-policy design-defect finding');
    expect(body, 'the defect classification itself').toContain('design defect');
  });

  test('docs/README.md benchmarks row carries the compression carve-out wording', () => {
    const row = read(README).split('\n').find((l) => l.includes('benchmarks/'));
    expect(row, 'docs/README.md has a benchmarks/ authority row').toBeTruthy();
    expect(row as string, 'carve-out: compression is permitted').toContain('may be compressed to a dated abstract');
    expect(row as string, 'carve-out: gated on no live citation').toContain('once no live claim cites its numbers');
  });

  test("docs/refinement-backlog.md's bullet records the reopening evidence and a narrowed (not deleted) outcome", () => {
    const backlog = read(BACKLOG);
    expect(backlog, 'reopened with dated, cross-checked evidence').toContain('Narrowed 2026-07-05');
    expect(backlog, 'ties the reopening to this feature').toContain('F-27e56a00');
    expect(backlog, 'names compression, not deletion, as the newly permitted policy').toContain(
      'permits *compression* of a superseded run-log',
    );
    expect(backlog, 'names the first compressed file').toContain('v0.4.0-consistency-bench.md');
    expect(backlog, 'names the second compressed file').toContain('v0.6.0-real-user-verification.md');
    expect(backlog, 'deletion of any benchmark is still refused').toContain('Do not delete any benchmark');
  });
});

describe('AC-19da3bd1 · the four protected benchmark files stay whole, and the backlog names all four as protected', () => {
  const PROTECTED: ReadonlyArray<{readonly path: string; readonly marker: string}> = [
    {path: 'docs/benchmarks/event-store-spec-with-traps.md', marker: '## Run rules'},
    {path: 'docs/benchmarks/event-store-trap-catch.md', marker: '## Cumulative progression across the A/B/C cells'},
    {path: 'docs/benchmarks/cross-vendor-spec-convergence.md', marker: '## R6 — Does a *weak* reviewer detect it? → No'},
    {path: 'docs/benchmarks/prereg-context-hypothesis.md', marker: '## Decision rule (the kill criterion — binding)'},
  ];

  test('non-vacuous guard: all four protected paths are distinct and real', () => {
    const paths = PROTECTED.map((p) => p.path);
    expect(new Set(paths).size, 'four distinct protected files').toBe(4);
    for (const p of paths) {
      expect(read(p).length, `${p}: readable, non-trivial size`).toBeGreaterThan(2000);
    }
  });

  test('each protected file exceeds the 60-line stub threshold (was NOT compressed)', () => {
    for (const {path} of PROTECTED) {
      expect(lineCount(read(path)), `${path}: line count`).toBeGreaterThan(60);
    }
  });

  test('each protected file carries a distinctive marker sitting well past the top, not front-loaded like a stub', () => {
    for (const {path, marker} of PROTECTED) {
      const body = read(path);
      const idx = body.indexOf(marker);
      expect(idx, `${path}: marker "${marker}" present`).toBeGreaterThan(-1);
      expect(idx / body.length, `${path}: marker sits in the back half of the file`).toBeGreaterThan(0.5);
    }
  });

  test('the backlog bullet identifies all four protected files as remaining byte-identical', () => {
    const backlog = read(BACKLOG);
    expect(backlog, 'declares the four REMAIN byte-identical and protected').toContain(
      'REMAIN byte-identical and protected',
    );
    expect(backlog, 'names the event-store pair via its F-066 tie').toContain('the event-store pair (F-066');
    expect(backlog, 'names cross-vendor-spec-convergence.md').toContain('cross-vendor-spec-convergence.md');
    expect(backlog, 'names prereg-context-hypothesis.md').toContain('prereg-context-hypothesis.md');
  });
});

describe("AC-1e657d14 · F-066's AC-178 matches reality: GOVERNANCE.md is the living citation, not the READMEs", () => {
  // The retracted claim's verb phrase, assembled at runtime so the stale
  // wording is never written contiguously in this test's source (a future
  // repo-wide honesty sweep must not trip on the very file proving it gone).
  const RETRACTED_VERB = ['add ', 'an Evidence section to'].join('');
  const RETRACTED_CLAIM = [RETRACTED_VERB, ' README.md'].join('');

  const ac178 = (): AcceptanceCriterion => {
    const feature = loadFeature(F066);
    const ac = (feature.acceptance_criteria ?? []).find((a) => a.id === 'AC-178');
    expect(ac, 'AC-178 present in F-066.yaml').toBeTruthy();
    return ac as AcceptanceCriterion;
  };
  const prose = (ac: AcceptanceCriterion): string => [ac.action, ac.response, ac.text].join('\n');

  test('AC-178 no longer claims the READMEs carry a benchmarks Evidence section', () => {
    expect(prose(ac178()), 'the retracted claim must be gone').not.toContain(RETRACTED_CLAIM);
  });

  test('planted-needle control — the retracted-claim needle has teeth', () => {
    const clean = 'the living citation is GOVERNANCE.md, not the READMEs';
    const poisoned = ['prose ... ', RETRACTED_CLAIM, ' ... prose'].join('');
    expect(clean.includes(RETRACTED_CLAIM), 'clean prose: no hit').toBe(false);
    expect(poisoned.includes(RETRACTED_CLAIM), 'poisoned prose: caught').toBe(true);
  });

  test('AC-178 cites GOVERNANCE.md as the living reference; evidence_refs re-pointed away from the READMEs', () => {
    const ac = ac178();
    expect(prose(ac), 'names GOVERNANCE.md').toContain('GOVERNANCE.md');
    expect(prose(ac), 'names the living GOVERNANCE.md:120 citation').toContain('GOVERNANCE.md:120');
    expect(ac.evidence_refs, 'evidence_refs re-pointed to GOVERNANCE.md only').toEqual(['GOVERNANCE.md']);
  });

  test('AC-178 still names both READMEs, but only to say a benchmarks Evidence section is not required', () => {
    const p = prose(ac178());
    expect(p, 'README.md named').toContain('README.md');
    expect(p, 'README.ko.md named').toContain('README.ko.md');
    expect(p, 'the "not required" framing survives').toContain('not required to carry a benchmarks');
  });
});
