// Cladding · F-39609db4 (measure-ledger) — CLI path for `clad measure --trend`.
//
// Drives the real handler (runMeasureCommand) against a temp cwd whose
// .cladding/measure.jsonl is hand-seeded, capturing stdout + the exit code
// like tests/cli/measure-sessions.test.ts.
//   AC-220944e2  0 or 1 snapshot → state the count, exit 0, fabricate no delta
//   AC-cbd294d4  ≥2 snapshots → render the trend with the disclaimer (CLI end-to-end)

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runMeasureCommand} from '../../src/cli/clad.js';
import {MEASUREMENT_DISCLAIMER} from '../../src/optimizer/measurement.js';

let dir: string;
let origCwd: string;
let exitCalls: number[];
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function stdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
}

/** A well-formed snapshot line (has context/search/stability so the tolerant
 *  reader keeps it). Only the trended fields carry meaningful values. */
function snapLine(day: number, m: {slice: number; struct: number; cov: number; p95: number; trunc: number; feat: number}): string {
  return JSON.stringify({
    timestamp: `2026-02-0${day}T00:00:00.000Z`,
    head: `sha${day}0000000`,
    spec_digest: `d${day}`,
    featureCount: m.feat,
    measured: m.feat,
    context: {
      medianContextRatio: 0.1,
      medianShrinkFactor: 1,
      fitsCount: 0,
      truncatedCount: m.trunc,
      medianShrinkFit: 1,
      medianShrinkTruncated: 1,
      medianStructuralRatio: m.struct,
      medianSliceTokens: m.slice,
      medianNaiveTokens: 1000,
    },
    search: {medianDepth: 1, p95Depth: m.p95, medianEdges: 1, maxEdges: 1},
    stability: {byStopReason: {coverage: 1}, medianCoverage: m.cov, medianRegressionTests: 1},
  });
}

function seedLedger(lines: string[]): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(join(dir, '.cladding', 'measure.jsonl'), `${lines.join('\n')}\n`);
}

beforeEach(() => {
  origCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'clad-vt-mtrend-'));
  process.chdir(dir);
  exitCalls = [];
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0);
    return undefined as never;
  }) as never);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  process.chdir(origCwd);
  exitSpy.mockRestore();
  stdoutSpy.mockRestore();
  rmSync(dir, {recursive: true, force: true});
});

describe('clad measure --trend — absence renders as absence (AC-220944e2)', () => {
  test("[covers:F-39609db4/AC-220944e2] no ledger (0 snapshots) → \"no trend yet — 0 snapshot(s)\", exit 0, no fabricated delta", () => {
    runMeasureCommand({trend: true});
    const out = stdout();
    expect(out).toContain('no trend yet');
    expect(out).toContain('0 snapshot(s)');
    // absence must never fabricate a signed delta or a trend row
    expect(out).not.toContain('slice');
    expect(out).not.toMatch(/\([+-]/);
    expect(exitCalls).toEqual([0]);
  });

  test('[covers:F-39609db4/AC-220944e2] exactly 1 snapshot → "no trend yet — 1 snapshot(s)", exit 0, no delta', () => {
    seedLedger([snapLine(1, {slice: 1000, struct: 0.9, cov: 0.5, p95: 1, trunc: 0, feat: 10})]);
    runMeasureCommand({trend: true});
    const out = stdout();
    expect(out).toContain('no trend yet');
    expect(out).toContain('1 snapshot(s)');
    expect(out).not.toContain('slice');
    expect(exitCalls).toEqual([0]);
  });
});

describe('clad measure --trend — end-to-end render with ≥2 snapshots (AC-cbd294d4)', () => {
  test('--trend 1 renders the last snapshot with a delta vs its predecessor + disclaimer, exit 0', () => {
    seedLedger([
      snapLine(1, {slice: 1000, struct: 0.9, cov: 0.5, p95: 1, trunc: 0, feat: 10}),
      snapLine(2, {slice: 1200, struct: 0.85, cov: 0.6, p95: 2, trunc: 1, feat: 11}),
    ]);
    runMeasureCommand({trend: '1'});
    const out = stdout();
    expect(out).toContain('last 1 of 2 snapshot(s)');
    expect(out).toContain('slice 1200 (+200)'); // delta vs the seeded predecessor
    expect(out).toContain('11 feat');
    expect(out).toContain(MEASUREMENT_DISCLAIMER);
    expect(exitCalls).toEqual([0]);
  });

  test('bare --trend (default window) renders both seeded snapshots, exit 0', () => {
    seedLedger([
      snapLine(1, {slice: 1000, struct: 0.9, cov: 0.5, p95: 1, trunc: 0, feat: 10}),
      snapLine(2, {slice: 1200, struct: 0.85, cov: 0.6, p95: 2, trunc: 1, feat: 11}),
    ]);
    runMeasureCommand({trend: true});
    const out = stdout();
    expect(out).toContain('last 2 of 2 snapshot(s)');
    expect(out).toContain('slice 1000'); // first-ever snapshot, no delta
    expect(out).toContain('slice 1200 (+200)');
    expect(out).toContain(MEASUREMENT_DISCLAIMER);
    expect(exitCalls).toEqual([0]);
  });
});
