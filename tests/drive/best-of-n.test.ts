import {describe, it, expect, vi} from 'vitest';
import {isGreen, selectBest, runBestOfN, type DriveCandidate} from '../../src/drive/select.js';

const cand = (
  attempt: number,
  gates: {stage: string; pass: boolean; exitCode: number}[],
  stubCount = 0,
): DriveCandidate => ({
  attempt,
  identityName: `dev-${attempt}`,
  mutations: [],
  gates,
  stubCount,
});

const ok = (stage = 'stage_1.1') => ({stage, pass: true, exitCode: 0});
const failHard = (stage = 'stage_1.1') => ({stage, pass: false, exitCode: 1}); // real failure
const skip = (stage = 'stage_1.1') => ({stage, pass: false, exitCode: 2}); // genuine skip, NOT a failure

describe('best-of-N selector (F-ac92c812)', () => {
  describe('isGreen', () => {
    it('all gates pass → true', () => {
      expect(isGreen(cand(0, [ok('a'), ok('b')]))).toBe(true);
    });

    it('any hard-fail gate → false', () => {
      expect(isGreen(cand(0, [ok('a'), failHard('b')]))).toBe(false);
    });

    it('skip (exitCode 2) alongside passes → true', () => {
      expect(isGreen(cand(0, [ok('a'), skip('b')]))).toBe(true);
    });
  });

  describe('selectBest', () => {
    it('no green → winner null and reason mentions 0/', () => {
      const candidates = [
        cand(0, [failHard()]),
        cand(1, [ok('a'), failHard('b')]),
      ];
      const sel = selectBest(candidates);
      expect(sel.winner).toBeNull();
      expect(sel.reason).toContain('0/');
    });

    it('single green → that candidate wins', () => {
      const candidates = [
        cand(0, [failHard()]),
        cand(1, [ok('a'), skip('b')]),
        cand(2, [failHard()]),
      ];
      const sel = selectBest(candidates);
      expect(sel.winner).not.toBeNull();
      expect(sel.winner!.attempt).toBe(1);
    });

    it('multiple green, differing stubCount → fewest stubs wins (not just first)', () => {
      const candidates = [
        cand(0, [ok()], 3), // green but most stubs
        cand(1, [ok()], 2),
        cand(2, [ok()], 0), // green, fewest stubs, NOT attempt 0
      ];
      const sel = selectBest(candidates);
      expect(sel.winner).not.toBeNull();
      expect(sel.winner!.attempt).toBe(2);
      expect(sel.winner!.stubCount).toBe(0);
    });

    it('green tie on stubCount → earliest attempt wins', () => {
      const candidates = [
        cand(2, [ok()], 1),
        cand(0, [ok()], 1), // earliest attempt with the tied stubCount
        cand(1, [ok()], 1),
      ];
      const sel = selectBest(candidates);
      expect(sel.winner).not.toBeNull();
      expect(sel.winner!.attempt).toBe(0);
    });

    it('never picks a non-green even if red has stubCount 0', () => {
      const candidates = [
        cand(0, [failHard()], 0), // red, fewest stubs
        cand(1, [ok()], 2), // green, more stubs
      ];
      const sel = selectBest(candidates);
      expect(sel.winner).not.toBeNull();
      expect(sel.winner!.attempt).toBe(1);
      expect(sel.winner!.stubCount).toBe(2);
    });
  });

  describe('ranked', () => {
    it('reports green flag and failingGates (skips excluded)', () => {
      const candidates = [
        cand(0, [ok('a'), skip('b')]), // green; skip should NOT appear in failingGates
        cand(1, [ok('a'), failHard('lint')], 1), // red; failingGates names 'lint'
        cand(2, [ok('a')]),
      ];
      const sel = selectBest(candidates);
      expect(sel.ranked).toHaveLength(3);

      // input order preserved
      expect(sel.ranked.map((r) => r.attempt)).toEqual([0, 1, 2]);

      const r0 = sel.ranked.find((r) => r.attempt === 0)!;
      expect(r0.green).toBe(true);
      expect(r0.failingGates).not.toContain('b'); // skip excluded
      expect(r0.failingGates).toEqual([]);

      const r1 = sel.ranked.find((r) => r.attempt === 1)!;
      expect(r1.green).toBe(false);
      expect(r1.failingGates).toContain('lint');
      expect(r1.stubCount).toBe(1);
    });
  });

  describe('runBestOfN', () => {
    it('invokes gen with attempts 0,1,2 and returns 3 candidates', async () => {
      const calls: number[] = [];
      const gen = vi.fn(async (i: number) => {
        calls.push(i);
        return cand(i, [ok()]);
      });
      const result = await runBestOfN(3, gen);
      expect(calls).toEqual([0, 1, 2]);
      expect(result.candidates).toHaveLength(3);
      expect(result.selection).toBeDefined();
      expect(result.selection.winner).not.toBeNull();
    });

    it('clamps n to at least 1 → runBestOfN(0, gen) calls gen exactly once with attempt 0', async () => {
      const calls: number[] = [];
      const gen = vi.fn(async (i: number) => {
        calls.push(i);
        return cand(i, [ok()]);
      });
      const result = await runBestOfN(0, gen);
      expect(calls).toEqual([0]);
      expect(result.candidates).toHaveLength(1);
    });

    it('clamps negative n too → runBestOfN(-3, gen) calls gen once with attempt 0', async () => {
      const calls: number[] = [];
      const gen = vi.fn(async (i: number) => {
        calls.push(i);
        return cand(i, [ok()]);
      });
      const result = await runBestOfN(-3, gen);
      expect(calls).toEqual([0]);
      expect(result.candidates).toHaveLength(1);
    });
  });
});
