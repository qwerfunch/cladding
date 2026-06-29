import {describe, it, expect} from 'vitest';
import {
  classify, aggregate, findRegressions, runAudit, OUT_OF_SCOPE,
  type Verdict, type Counts, type Baseline,
} from '../../audit/detector-audit.js';
import {corpus} from '../../audit/corpus.js';

describe('detector regression audit (F-b91fce34)', () => {
  describe('classify', () => {
    it('maps drift+fire to TP', () => {
      expect(classify('drift', true)).toBe('TP');
    });
    it('maps drift+silence to FN', () => {
      expect(classify('drift', false)).toBe('FN');
    });
    it('maps clean+fire to FP', () => {
      expect(classify('clean', true)).toBe('FP');
    });
    it('maps clean+silence to TN', () => {
      expect(classify('clean', false)).toBe('TN');
    });
  });

  describe('aggregate', () => {
    it('tallies verdicts per detector', () => {
      const result = aggregate([
        {detector: 'D', verdict: 'TP' as Verdict},
        {detector: 'D', verdict: 'FP' as Verdict},
      ]);
      expect(result.get('D')).toEqual({tp: 1, fp: 1, fn: 0, tn: 0});
    });
    it('returns an empty Map for empty input', () => {
      const result = aggregate([]);
      expect(result.size).toBe(0);
    });
  });

  describe('findRegressions', () => {
    it('flags fp above zero-baseline as false-positives', () => {
      const counts = new Map<string, Counts>([
        ['D', {tp: 0, fp: 1, fn: 0, tn: 0}],
      ]);
      const msgs = findRegressions(counts, {} as Baseline);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain('D');
      expect(msgs[0]).toContain('false-positives');
    });

    it('flags fn above zero-baseline as false-negatives', () => {
      const counts = new Map<string, Counts>([
        ['D', {tp: 0, fp: 0, fn: 1, tn: 0}],
      ]);
      const msgs = findRegressions(counts, {} as Baseline);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain('D');
      expect(msgs[0]).toContain('false-negatives');
    });

    it('returns [] when within baseline', () => {
      const counts = new Map<string, Counts>([
        ['D', {tp: 0, fp: 1, fn: 0, tn: 0}],
      ]);
      const msgs = findRegressions(counts, {D: {fp: 1, fn: 0}} as Baseline);
      expect(msgs).toEqual([]);
    });
  });

  describe('runAudit is GREEN (the live regression guard)', () => {
    it('passes with zero regressions and clean covered detectors', () => {
      const {regressions, report} = runAudit();
      expect(report.result).toBe('pass');
      expect(regressions).toHaveLength(0);
      for (const name of ['UNTESTED_AC', 'STATUS_DRIFT', 'AC_DRIFT', 'UNVERIFIED_AC']) {
        expect(report.per_detector).toHaveProperty(name);
        expect(report.per_detector[name].fp).toBe(0);
        expect(report.per_detector[name].fn).toBe(0);
      }
    });
  });

  describe('honest framing (AC)', () => {
    it('framing disclaims population precision/recall', () => {
      const {report} = runAudit();
      expect(report.framing.toLowerCase()).toContain('not population');
    });
    it('v1_scope names each OUT_OF_SCOPE detector', () => {
      const {report} = runAudit();
      for (const name of OUT_OF_SCOPE) {
        expect(report.v1_scope).toContain(name);
      }
    });
  });

  describe('corpus exercises BOTH directions per covered detector', () => {
    it('each covered detector has a drift case and a clean case', () => {
      for (const name of ['UNTESTED_AC', 'STATUS_DRIFT', 'AC_DRIFT', 'UNVERIFIED_AC']) {
        const cases = corpus.filter((c) => c.detector === name);
        expect(cases.some((c) => c.expect === 'drift')).toBe(true);
        expect(cases.some((c) => c.expect === 'clean')).toBe(true);
      }
    });
    it('every case expect is drift or clean', () => {
      for (const c of corpus) {
        expect(['drift', 'clean']).toContain(c.expect);
      }
    });
  });
});
