// Cladding · unit tests for stages/detectors/performance-drift.ts
//
// Detector under test diffs `perf/baseline.json` against
// `perf/current.json`. A metric that regresses by more than 10%
// emits a warn finding. Missing baseline OR missing current → single
// info finding (opt-in on a prior `stage_3.2 --record` run).
//
// The detector is permissive about the file shape:
//   { "metrics": { "<name>": { "value": <number>, "unit": "<string>" } } }
// Metrics absent from one side or with non-numeric values are skipped.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {performanceDrift} from '../../src/stages/detectors/performance-drift.js';

function writePerf(dir: string, file: 'baseline' | 'current', content: unknown): void {
  mkdirSync(join(dir, 'perf'), {recursive: true});
  writeFileSync(join(dir, 'perf', `${file}.json`), JSON.stringify(content));
}

describe('PERFORMANCE_DRIFT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-perf-drift-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('both files absent → single info finding', () => {
    const findings = performanceDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('missing');
  });

  test('only baseline present (no current) → info finding', () => {
    writePerf(dir, 'baseline', {metrics: {p95: {value: 100, unit: 'ms'}}});
    const findings = performanceDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });

  test('metric regresses >10% → warn finding with delta and values', () => {
    writePerf(dir, 'baseline', {metrics: {p95: {value: 100, unit: 'ms'}}});
    writePerf(dir, 'current', {metrics: {p95: {value: 130, unit: 'ms'}}});
    const findings = performanceDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('p95');
    expect(findings[0].message).toContain('30.0%');
    expect(findings[0].message).toContain('100ms');
    expect(findings[0].message).toContain('130ms');
  });

  test('metric within 10% tolerance → silent', () => {
    writePerf(dir, 'baseline', {metrics: {p95: {value: 100, unit: 'ms'}}});
    writePerf(dir, 'current', {metrics: {p95: {value: 105, unit: 'ms'}}});
    expect(performanceDrift.run({cwd: dir})).toEqual([]);
  });

  test('multiple metrics → one finding per regressed metric', () => {
    writePerf(dir, 'baseline', {
      metrics: {p95: {value: 100, unit: 'ms'}, rps: {value: 1000, unit: 'req/s'}},
    });
    writePerf(dir, 'current', {
      metrics: {p95: {value: 130, unit: 'ms'}, rps: {value: 1500, unit: 'req/s'}},
    });
    // Both metrics regress (p95: +30%, rps: +50% — note that for
    // throughput "regress" by the detector means "current > baseline",
    // which is a known v0.1 simplification: the detector treats every
    // metric as latency-shaped. Higher numbers = worse.)
    const findings = performanceDrift.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const names = findings.map((f) => f.message.split(' ')[0]).sort();
    expect(names).toEqual(['p95', 'rps']);
  });

  test('baseline value of 0 → metric skipped (division-by-zero guard)', () => {
    writePerf(dir, 'baseline', {metrics: {p95: {value: 0, unit: 'ms'}}});
    writePerf(dir, 'current', {metrics: {p95: {value: 100, unit: 'ms'}}});
    expect(performanceDrift.run({cwd: dir})).toEqual([]);
  });

  test('malformed JSON in one file → treated as missing (info finding)', () => {
    mkdirSync(join(dir, 'perf'), {recursive: true});
    writeFileSync(join(dir, 'perf', 'baseline.json'), '{not valid json');
    writePerf(dir, 'current', {metrics: {p95: {value: 100, unit: 'ms'}}});
    const findings = performanceDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });
});
