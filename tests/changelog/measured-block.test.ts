// Cladding · F-ede6fa75 (self-measuring-release) — pure renderer contract for
// renderMeasuredBlock. Authored from the shard's ACs + the exported signatures
// (MeasuredRenderInput / renderMeasuredBlock, MeasureSnapshot, MEASUREMENT_DISCLAIMER)
// — NOT read off the impl. Delta strings are HAND-COMPUTED from synthetic inputs.
//
//   AC-713458d9  a snapshot matching HEAD → a Measured block carrying the honest
//                numbers, the short + full head, spec_digest, and the exact
//                reproduce command `git checkout <full-sha> && clad measure`
//   AC-38b63d18  the disclaimer verbatim in every numbers block — never a number
//                without its qualifier (invariant over many inputs)
//   AC-a7e810b1  a sinceSnapshot → exactly one release-over-release delta line with
//                hand-computed signed diffs; no sinceSnapshot → no delta line
//   (determinism) two renders of the same input are byte-identical

import {describe, expect, test} from 'vitest';

import {renderMeasuredBlock, type MeasuredRenderInput} from '../../src/changelog/render.js';
import type {MeasureSnapshot} from '../../src/optimizer/measure-ledger.js';
import {MEASUREMENT_DISCLAIMER} from '../../src/optimizer/measurement.js';

const DOT = '·'; // U+00B7 — the delta-line column separator.

/** A full MeasureSnapshot from the fields the block renders. Non-rendered fields
 *  hold DECOY constants so a wrong-field regression surfaces a wrong value. */
function mkSnap(m: {
  head?: string | null;
  spec_digest?: string;
  measured?: number;
  featureCount?: number;
  slice?: number;
  naive?: number;
  struct?: number;
  cov?: number;
  reg?: number;
} = {}): MeasureSnapshot {
  return {
    timestamp: '2026-07-01T00:00:00.000Z', // decoy — never rendered (determinism)
    head: m.head === undefined ? 'abcdef0123456789abcdef0123456789abcdef01' : m.head,
    spec_digest: m.spec_digest ?? 'digest-deadbeef',
    featureCount: m.featureCount ?? 42,
    measured: m.measured ?? 40,
    context: {
      medianContextRatio: 0.111, // decoy
      medianShrinkFactor: 7.77, // decoy
      fitsCount: 555, // decoy
      truncatedCount: 10, // decoy
      medianShrinkFit: 8.88, // decoy
      medianShrinkTruncated: 9.99, // decoy
      medianStructuralRatio: m.struct ?? 0.9, // RENDERED
      medianSliceTokens: m.slice ?? 1400, // RENDERED
      medianNaiveTokens: m.naive ?? 9000, // RENDERED
    },
    search: {medianDepth: 42, p95Depth: 3, medianEdges: 43, maxEdges: 44}, // all decoy
    stability: {
      byStopReason: {coverage: 1}, // decoy
      medianCoverage: m.cov ?? 0.75, // RENDERED
      medianRegressionTests: m.reg ?? 4, // RENDERED
    },
  };
}

describe('renderMeasuredBlock — matched snapshot renders the honest block (AC-713458d9)', () => {
  const out = renderMeasuredBlock({snapshot: mkSnap()});

  test('carries every headline number', () => {
    expect(out).toContain('## Measured (this release)');
    expect(out).toContain('- features measured: 40 of 42');
    expect(out).toContain('- median slice tokens: 1400 vs 9000 naive');
    expect(out).toContain('- median structural ratio: 0.90');
    expect(out).toContain('- median coverage: 0.75');
    expect(out).toContain('- regression tests surfaced: 4');
  });

  test('[covers:F-ede6fa75/AC-713458d9] carries the SHORT head + spec_digest and the FULL-sha reproduce command', () => {
    // short head (7 chars) on the anchor line
    expect(out).toContain('head abcdef0 · spec_digest digest-deadbeef');
    // the exact reproduce command uses the FULL 40-char sha, not the short one
    expect(out).toContain('reproduce: git checkout abcdef0123456789abcdef0123456789abcdef01 && clad measure');
  });

  test('carries the disclaimer verbatim', () => {
    expect(out).toContain(MEASUREMENT_DISCLAIMER);
  });
});

describe('renderMeasuredBlock — a numbers block NEVER renders without the disclaimer (AC-38b63d18)', () => {
  test('[covers:F-ede6fa75/AC-38b63d18] invariant across many inputs: headline numbers ⟹ disclaimer verbatim', () => {
    const inputs: MeasuredRenderInput[] = [
      {snapshot: mkSnap()},
      {snapshot: mkSnap({slice: 0, naive: 0, struct: 0, cov: 0, reg: 0, measured: 0, featureCount: 0})},
      {snapshot: mkSnap({slice: 999999, cov: 1, reg: 250})},
      {snapshot: mkSnap({head: 'f'.repeat(40)}), sinceSnapshot: mkSnap({slice: 100}), sinceRef: 'v9'},
    ];
    let sawNumbers = false;
    for (const input of inputs) {
      const out = renderMeasuredBlock(input);
      if (out.includes('features measured:')) {
        sawNumbers = true;
        // the load-bearing invariant: a headline number never ships bare.
        expect(out).toContain(MEASUREMENT_DISCLAIMER);
      }
    }
    expect(sawNumbers).toBe(true); // guard against a vacuously-true invariant
  });

  test('the no-match notice carries NEITHER numbers NOR a dangling disclaimer', () => {
    for (const snapshot of [null, mkSnap({head: null}), mkSnap({head: ''})]) {
      const out = renderMeasuredBlock({snapshot});
      expect(out).toContain('not measured at this commit');
      expect(out).not.toContain('features measured:');
      expect(out).not.toContain(MEASUREMENT_DISCLAIMER);
    }
  });
});

describe('renderMeasuredBlock — release-over-release delta line (AC-a7e810b1)', () => {
  // current: slice 1400, struct 0.88, cov 0.65
  // since  : slice 1000, struct 0.90, cov 0.50
  // hand-computed signed diffs: slice +400 · struct -0.02 · cov +0.15
  const current = mkSnap({slice: 1400, struct: 0.88, cov: 0.65});
  const since = mkSnap({slice: 1000, struct: 0.9, cov: 0.5, head: '1234567abcdef0123456789abcdef0123456789a'});

  test('[covers:F-ede6fa75/AC-a7e810b1] a since endpoint appends exactly one delta line with the hand-computed signs', () => {
    const out = renderMeasuredBlock({snapshot: current, sinceSnapshot: since, sinceRef: 'v0.7.1'});
    const deltaLines = out.split('\n').filter((l) => l.startsWith('- since '));
    expect(deltaLines).toHaveLength(1);
    expect(deltaLines[0]).toBe(`- since v0.7.1: slice +400 ${DOT} struct -0.02 ${DOT} cov +0.15`);
  });

  test('without an explicit sinceRef the since head is short-labeled', () => {
    const out = renderMeasuredBlock({snapshot: current, sinceSnapshot: since});
    expect(out).toContain(`- since 1234567: slice +400 ${DOT} struct -0.02 ${DOT} cov +0.15`);
  });

  test('no sinceSnapshot → no delta line at all', () => {
    const out = renderMeasuredBlock({snapshot: current});
    expect(out.split('\n').some((l) => l.startsWith('- since '))).toBe(false);
  });
});

describe('renderMeasuredBlock — deterministic', () => {
  test('two renders of the same input are byte-identical', () => {
    const input: MeasuredRenderInput = {
      snapshot: mkSnap({slice: 1400, struct: 0.88, cov: 0.65}),
      sinceSnapshot: mkSnap({slice: 1000, struct: 0.9, cov: 0.5}),
      sinceRef: 'v0.7.1',
    };
    expect(renderMeasuredBlock(input)).toBe(renderMeasuredBlock(input));
  });
});
