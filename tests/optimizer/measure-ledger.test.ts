// Cladding · F-39609db4 (measure-ledger) — unit contract for the deduped
// measure ledger + signed-delta trend. Authored from the shard's 5 ACs +
// the exported module signatures (MeasureSnapshot / AppendResult factory +
// append + tolerant reader + pure renderer) and the MEASUREMENT_DISCLAIMER
// constant. Assertions on trend deltas are HAND-COMPUTED from synthetic
// inputs, not read off the implementation.
//
//   AC-259fba59  append one summary line (no features[] rows), ≤1KB
//   AC-cf43f71c  identical (head, spec_digest) → skip; changed digest → append
//   AC-2c4f07d8  unwritable dir / malformed ledger → best-effort, never throws
//   AC-cbd294d4  renderTrend last-N signed deltas + featureCount + disclaimer
//   AC-220944e2  (no-trend absence rendering lives in the CLI-path suite)

import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  type MeasureSnapshot,
  snapshotFromReport,
  appendMeasureSnapshot,
  readMeasureSnapshots,
  renderTrend,
} from '../../src/optimizer/measure-ledger.js';
import {MEASUREMENT_DISCLAIMER, type EfficiencyReport} from '../../src/optimizer/measurement.js';

const DOT = '·'; // U+00B7 — the column separator renderTrend emits.

// ── fixtures ────────────────────────────────────────────────────────────────

/** A full EfficiencyReport. `features[]` is deliberately non-empty so the
 *  "summary only, never per-feature rows" contract (AC-259fba59) is testable. */
function mkReport(over: {featureCount?: number} = {}): EfficiencyReport {
  return {
    featureCount: over.featureCount ?? 7,
    measured: 6,
    context: {
      medianContextRatio: 0.42,
      medianShrinkFactor: 3.1,
      fitsCount: 4,
      truncatedCount: 2,
      medianShrinkFit: 2.2,
      medianShrinkTruncated: 5.5,
      medianStructuralRatio: 0.9,
      medianSliceTokens: 1234,
      medianNaiveTokens: 4321,
    },
    search: {medianDepth: 1, p95Depth: 3, medianEdges: 2, maxEdges: 9},
    stability: {
      byStopReason: {coverage: 4, 'marginal-yield': 2},
      medianCoverage: 0.75,
      medianRegressionTests: 3,
    },
    features: [
      {
        id: 'F-decoy-feature',
        sliceTokens: 1,
        structuralTokens: 2,
        naiveTokens: 3,
        contextRatio: 0.33,
        budgetSaturated: false,
        searchDepth: 1,
        edgesResolved: 2,
        stoppedBy: 'coverage',
        coverage: 0.5,
        regressionTests: 1,
      },
    ],
  };
}

/** A full MeasureSnapshot from the 5 trended metrics. Non-trended fields hold
 *  DECOY values (constant across snapshots) so a wrong-field regression in
 *  renderTrend surfaces a wrong value or a spurious zero delta. */
function snap(
  day: number,
  m: {slice: number; struct: number; cov: number; p95: number; trunc: number; feat: number},
): MeasureSnapshot {
  return {
    timestamp: `2026-01-0${day}T12:30:45.000Z`,
    head: `commit${day}abcdef0123456789`,
    spec_digest: `digest-${day}`,
    featureCount: m.feat,
    measured: m.feat,
    context: {
      medianContextRatio: 0.111, // decoy
      medianShrinkFactor: 7.77, // decoy
      fitsCount: 555, // decoy
      truncatedCount: m.trunc, // TRACKED
      medianShrinkFit: 8.88, // decoy
      medianShrinkTruncated: 9.99, // decoy
      medianStructuralRatio: m.struct, // TRACKED
      medianSliceTokens: m.slice, // TRACKED
      medianNaiveTokens: 99999, // decoy
    },
    search: {
      medianDepth: 42, // decoy
      p95Depth: m.p95, // TRACKED
      medianEdges: 43, // decoy
      maxEdges: 44, // decoy
    },
    stability: {
      byStopReason: {coverage: 1}, // decoy
      medianCoverage: m.cov, // TRACKED
      medianRegressionTests: 88, // decoy
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-vt-mledger-'));
  // Seed a git HEAD: the append refuses to persist a head:null snapshot (an
  // unreproducible line — no checkout target, degenerate dedupe key), so the
  // fixture needs one real commit for the append/dedupe/error paths to run.
  execFileSync('git', ['init', '-q'], {cwd: dir, stdio: 'ignore'});
  execFileSync(
    'git',
    ['-c', 'user.email=t@test', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'seed'],
    {cwd: dir, stdio: 'ignore'},
  );
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function ledgerLines(): string[] {
  const raw = readFileSync(join(dir, '.cladding', 'measure.jsonl'), 'utf8');
  return raw.split('\n').filter((l) => l.trim().length > 0);
}

// ── AC-259fba59 · append one summary line ────────────────────────────────────

describe('appendMeasureSnapshot — one summary line, no per-feature rows (AC-259fba59)', () => {
  test('writes exactly one JSON line with the summary shape and no features[]', () => {
    const report = mkReport();
    const res = appendMeasureSnapshot(dir, report);
    expect(res).toEqual({appended: true, reason: 'appended'});

    const lines = ledgerLines();
    expect(lines).toHaveLength(1);

    // line budget: a summary snapshot must stay small (≤1KB).
    expect(Buffer.byteLength(lines[0], 'utf8')).toBeLessThanOrEqual(1024);

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    // Exactly the summary keys — proves both "these fields present" AND
    // "features[] excluded" in one shot.
    expect(Object.keys(parsed).sort()).toEqual([
      'context',
      'featureCount',
      'head',
      'measured',
      'search',
      'spec_digest',
      'stability',
      'timestamp',
    ]);
    expect(parsed).not.toHaveProperty('features');
    // the per-feature id must not leak into the persisted line at all
    expect(lines[0]).not.toContain('F-decoy-feature');

    // aggregates mirror the report; timestamp is an ISO string; head is str|null
    expect(parsed.featureCount).toBe(report.featureCount);
    expect(parsed.context).toEqual(report.context);
    expect(parsed.search).toEqual(report.search);
    expect(parsed.stability).toEqual(report.stability);
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.head === null || typeof parsed.head === 'string').toBe(true);
  });

  test('snapshotFromReport is pure modulo its wall-clock timestamp', () => {
    const report = mkReport();
    const a = snapshotFromReport(dir, report);
    const b = snapshotFromReport(dir, report);
    // timestamp comes from new Date() → not stable; every OTHER field must be.
    const strip = ({timestamp: _timestamp, ...rest}: MeasureSnapshot): Omit<MeasureSnapshot, 'timestamp'> => rest;
    expect(strip(a)).toEqual(strip(b));
    // and the deterministic surface reflects the report faithfully
    expect(a.featureCount).toBe(report.featureCount);
    expect(a.context).toEqual(report.context);
  });
});

// ── AC-cf43f71c · dedupe on (head, spec_digest) ──────────────────────────────

describe('appendMeasureSnapshot — dedupe on unchanged (head, spec_digest) (AC-cf43f71c)', () => {
  test('identical commit+spec state → second append skipped, ledger stays 1 line', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'project:\n  name: t\n');
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'foo-aaaa1111.yaml'), 'id: F-aaaa1111\n');

    const report = mkReport();
    expect(appendMeasureSnapshot(dir, report)).toEqual({appended: true, reason: 'appended'});
    // nothing changed on disk → newest (head, spec_digest) matches → skip
    expect(appendMeasureSnapshot(dir, report)).toEqual({appended: false, reason: 'deduped'});
    expect(ledgerLines()).toHaveLength(1);
  });

  test('repeated append with the same report object is idempotent (dedupe)', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'project:\n  name: t\n');
    const report = mkReport();
    appendMeasureSnapshot(dir, report);
    appendMeasureSnapshot(dir, report);
    appendMeasureSnapshot(dir, report);
    expect(readMeasureSnapshots(dir)).toHaveLength(1);
  });

  test('a changed spec surface (new shard) → digest differs → append proceeds', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'project:\n  name: t\n');
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'foo-aaaa1111.yaml'), 'id: F-aaaa1111\n');

    const report = mkReport();
    expect(appendMeasureSnapshot(dir, report)).toEqual({appended: true, reason: 'appended'});

    // touch the spec surface: a new feature shard mutates computeSpecDigest
    writeFileSync(join(dir, 'spec', 'features', 'bar-bbbb2222.yaml'), 'id: F-bbbb2222\n');
    expect(appendMeasureSnapshot(dir, report)).toEqual({appended: true, reason: 'appended'});

    const snaps = readMeasureSnapshots(dir);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].spec_digest).not.toBe(snaps[1].spec_digest);
  });
});

// ── AC-2c4f07d8 · best-effort persistence ────────────────────────────────────

describe('appendMeasureSnapshot — best-effort, never throws (AC-2c4f07d8)', () => {
  test('unwritable ledger dir (.cladding is a FILE) → {appended:false, reason:error}, no throw', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'project:\n  name: t\n');
    // occupy the ledger dir path with a plain file so mkdir/append can't succeed
    writeFileSync(join(dir, '.cladding'), 'not a directory');

    const report = mkReport();
    let res: ReturnType<typeof appendMeasureSnapshot>;
    expect(() => {
      res = appendMeasureSnapshot(dir, report);
    }).not.toThrow();
    expect(res!).toEqual({appended: false, reason: 'error'});
    // the blocking file is left intact — the command's world is unchanged
    expect(readFileSync(join(dir, '.cladding'), 'utf8')).toBe('not a directory');
  });

  test('malformed ledger lines are skipped tolerantly and append still works', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const validSeed = JSON.stringify(snap(9, {slice: 500, struct: 0.5, cov: 0.4, p95: 1, trunc: 0, feat: 3}));
    // 2 torn/garbage lines, a JSON object missing the snapshot shape, then a valid one
    const contents = ['not json at all', '{"broken": ', '{"unrelated": 1}', validSeed, ''].join('\n');
    writeFileSync(join(dir, '.cladding', 'measure.jsonl'), contents);

    const snaps = readMeasureSnapshots(dir);
    expect(snaps).toHaveLength(1); // only the well-formed snapshot survives
    expect(snaps[0].spec_digest).toBe('digest-9');

    // and a subsequent append is unblocked by the earlier corruption
    const report = mkReport();
    expect(appendMeasureSnapshot(dir, report)).toEqual({appended: true, reason: 'appended'});
    expect(readMeasureSnapshots(dir)).toHaveLength(2);
  });
});

// ── AC-cbd294d4 · renderTrend signed deltas ──────────────────────────────────

/** 6 snapshots with metrics chosen so every last-5 delta is hand-verifiable. */
function sixSnapshots(): MeasureSnapshot[] {
  return [
    snap(1, {slice: 1000, struct: 0.9, cov: 0.5, p95: 1, trunc: 0, feat: 10}),
    snap(2, {slice: 1200, struct: 0.85, cov: 0.6, p95: 2, trunc: 1, feat: 11}),
    snap(3, {slice: 900, struct: 0.8, cov: 0.55, p95: 2, trunc: 1, feat: 12}),
    snap(4, {slice: 900, struct: 0.8, cov: 0.55, p95: 3, trunc: 2, feat: 12}),
    snap(5, {slice: 1500, struct: 0.95, cov: 0.7, p95: 2, trunc: 0, feat: 13}),
    snap(6, {slice: 1400, struct: 0.88, cov: 0.65, p95: 4, trunc: 3, feat: 14}),
  ];
}

describe('renderTrend — last-N signed deltas, featureCount, disclaimer (AC-cbd294d4)', () => {
  test('default window renders the last 5 with hand-computed signed deltas', () => {
    const out = renderTrend(sixSnapshots());

    expect(out).toContain(`measure trend ${DOT} last 5 of 6 snapshot(s)`);

    // per-row metric segments — VALUE plus HAND-COMPUTED delta vs predecessor.
    // row snap2 vs snap1
    expect(out).toContain(
      ` ${DOT} slice 1200 (+200) ${DOT} struct 0.85 (-0.05) ${DOT} cov 0.60 (+0.10) ${DOT} p95depth 2 (+1) ${DOT} trunc 1 (+1)`,
    );
    // row snap3 vs snap2 — includes zero deltas rendered as "(0)" / "(0.00)"
    expect(out).toContain(
      ` ${DOT} slice 900 (-300) ${DOT} struct 0.80 (-0.05) ${DOT} cov 0.55 (-0.05) ${DOT} p95depth 2 (0) ${DOT} trunc 1 (0)`,
    );
    // row snap4 vs snap3 — all-zero context deltas
    expect(out).toContain(
      ` ${DOT} slice 900 (0) ${DOT} struct 0.80 (0.00) ${DOT} cov 0.55 (0.00) ${DOT} p95depth 3 (+1) ${DOT} trunc 2 (+1)`,
    );
    // row snap5 vs snap4 — negative depth/trunc deltas
    expect(out).toContain(
      ` ${DOT} slice 1500 (+600) ${DOT} struct 0.95 (+0.15) ${DOT} cov 0.70 (+0.15) ${DOT} p95depth 2 (-1) ${DOT} trunc 0 (-2)`,
    );
    // row snap6 vs snap5
    expect(out).toContain(
      ` ${DOT} slice 1400 (-100) ${DOT} struct 0.88 (-0.07) ${DOT} cov 0.65 (-0.05) ${DOT} p95depth 4 (+2) ${DOT} trunc 3 (+3)`,
    );

    // featureCount per shown row
    for (const f of ['11 feat', '12 feat', '13 feat', '14 feat']) expect(out).toContain(f);

    // disclaimer carried verbatim (imported constant, not paraphrased)
    expect(out).toContain(MEASUREMENT_DISCLAIMER);
  });

  test('render is deterministic — two renders are byte-identical', () => {
    const s = sixSnapshots();
    expect(renderTrend(s)).toBe(renderTrend(s));
  });

  test('--trend 1 (window 1) still shows the delta vs the real predecessor', () => {
    const out = renderTrend(sixSnapshots(), 1);
    expect(out).toContain(`measure trend ${DOT} last 1 of 6 snapshot(s)`);
    // only snap6 shown, but its delta is computed against snap5 (its predecessor)
    expect(out).toContain(
      ` ${DOT} slice 1400 (-100) ${DOT} struct 0.88 (-0.07) ${DOT} cov 0.65 (-0.05) ${DOT} p95depth 4 (+2) ${DOT} trunc 3 (+3)`,
    );
    expect(out).toContain('14 feat');
    expect(out).toContain(MEASUREMENT_DISCLAIMER);
  });

  test('the very first snapshot ever renders values with NO delta', () => {
    const s = sixSnapshots();
    const out = renderTrend([s[0], s[1]]); // window default 5, both shown

    // snap1 is the first ever — its row carries values but no "(...)" delta
    expect(out).toContain(
      ` ${DOT} slice 1000 ${DOT} struct 0.90 ${DOT} cov 0.50 ${DOT} p95depth 1 ${DOT} trunc 0`,
    );
    // and structurally: the first row (the one with "10 feat") has no delta paren
    const firstRow = out.split('\n').find((l) => l.includes('10 feat'));
    expect(firstRow).toBeDefined();
    expect(firstRow).not.toContain('(');

    // the second snapshot, by contrast, DOES carry a delta
    expect(out).toContain(
      ` ${DOT} slice 1200 (+200) ${DOT} struct 0.85 (-0.05) ${DOT} cov 0.60 (+0.10) ${DOT} p95depth 2 (+1) ${DOT} trunc 1 (+1)`,
    );
  });
});
