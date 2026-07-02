// Cladding · F-ede6fa75 (self-measuring-release) — CLI path for
// `clad changelog --measure`. Drives the real handler (runChangelogCommand)
// against a REAL temp git repo whose .cladding/measure.jsonl is hand-seeded,
// capturing stdout + the exit code (the HEAD/ledger match is impure, so a real
// repo is the honest fixture — mocking git would test the mock).
//
//   AC-36b1df91  a ledger snapshot whose head ≠ HEAD → the not-measured notice,
//                and NONE of the stale snapshot's numbers substituted; exit 0
//   AC-8969e2af  --json --measure → measured is the snapshot object (reason null)
//                on a match, or null with an explicit reason on no-match /
//                unreadable ledger; an unreadable ledger still renders the full
//                prose changelog + notice; exit 0 throughout

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runChangelogCommand} from '../../src/cli/changelog.js';
import type {MeasureSnapshot} from '../../src/optimizer/measure-ledger.js';

let dir: string;
let exitCalls: number[];
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function stdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], {cwd: dir, encoding: 'utf8'});
}

/** A full, well-formed snapshot (context/search/stability present so the
 *  tolerant reader keeps it). `slice` is a DISTINCTIVE number: a no-match must
 *  never leak it into the rendered block. */
function mkSnap(head: string | null, slice: number): MeasureSnapshot {
  return {
    timestamp: '2026-07-01T00:00:00.000Z',
    head,
    spec_digest: `digest-for-${slice}`,
    featureCount: 5,
    measured: 5,
    context: {
      medianContextRatio: 0.1,
      medianShrinkFactor: 3,
      fitsCount: 3,
      truncatedCount: 2,
      medianShrinkFit: 2,
      medianShrinkTruncated: 5,
      medianStructuralRatio: 0.9,
      medianSliceTokens: slice,
      medianNaiveTokens: 9000,
    },
    search: {medianDepth: 1, p95Depth: 2, medianEdges: 2, maxEdges: 4},
    stability: {byStopReason: {coverage: 5}, medianCoverage: 0.8, medianRegressionTests: 3},
  };
}

function seedLedger(snaps: readonly MeasureSnapshot[]): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(join(dir, '.cladding', 'measure.jsonl'), `${snaps.map((s) => JSON.stringify(s)).join('\n')}\n`);
}

/** git init → spec + a shard that flips to done after the tag → HEAD sha. */
function setupRepo(): string {
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  writeFileSync(
    join(dir, 'spec.yaml'),
    ['schema: "0.1"', 'project:', '  name: probe', '  language: typescript', ''].join('\n'),
  );
  writeFileSync(
    join(dir, 'spec', 'capabilities.yaml'),
    ['schema: "0.1"', 'capabilities:', '  - id: cap-a', '    title: "Alpha"', '    features: [F-aaa001]', ''].join('\n'),
  );
  const shard = (status: string): void =>
    writeFileSync(
      join(dir, 'spec', 'features', 'alpha-aaa001.yaml'),
      [
        'id: F-aaa001',
        'slug: alpha',
        'title: "Alpha flow"',
        `status: ${status}`,
        'acceptance_criteria:',
        '  - id: AC-000001',
        '    ears: ubiquitous',
        '    text: "The system shall run alpha."',
        '',
      ].join('\n'),
    );
  shard('in_progress');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  git(['tag', 'v0']);
  shard('done'); // flip to done → real changelog material since v0
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'spec: ship alpha']);
  return git(['rev-parse', 'HEAD']).trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-vt-clmeasure-'));
  exitCalls = [];
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0);
    return undefined as never;
  }) as never);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  exitSpy.mockRestore();
  stdoutSpy.mockRestore();
  rmSync(dir, {recursive: true, force: true});
});

describe('clad changelog --measure — no snapshot at HEAD never substitutes older numbers (AC-36b1df91)', () => {
  test('a stale snapshot (head ≠ HEAD) → not-measured notice, stale numbers absent, exit 0', () => {
    setupRepo();
    // ledger holds a snapshot for a DIFFERENT commit, with a distinctive slice.
    seedLedger([mkSnap('0'.repeat(40), 424242)]);

    runChangelogCommand({since: 'v0', measure: true, cwd: dir});
    const out = stdout();

    expect(out).toContain('not measured at this commit');
    // the older snapshot's figures are NEVER substituted.
    expect(out).not.toContain('424242');
    expect(out).not.toContain('features measured:');
    expect(exitCalls).toEqual([0]);
  });
});

describe('clad changelog --json --measure — explicit presence/absence (AC-8969e2af)', () => {
  test('matching HEAD snapshot → manifest.measured deep-equals it, measured_reason null, exit 0', () => {
    const head = setupRepo();
    const snap = mkSnap(head, 1400);
    seedLedger([mkSnap('0'.repeat(40), 424242), snap]); // stale first, matching last

    runChangelogCommand({since: 'v0', json: true, measure: true, cwd: dir});
    const doc = JSON.parse(stdout()) as {measured: MeasureSnapshot | null; measured_reason: string | null};
    expect(doc.measured).toEqual(snap);
    expect(doc.measured_reason).toBeNull();
    expect(exitCalls).toEqual([0]);
  });

  test('no snapshot at HEAD → measured null with reason "no snapshot at HEAD", exit 0', () => {
    setupRepo();
    seedLedger([mkSnap('0'.repeat(40), 424242)]); // only a stale snapshot

    runChangelogCommand({since: 'v0', json: true, measure: true, cwd: dir});
    const doc = JSON.parse(stdout()) as {measured: MeasureSnapshot | null; measured_reason: string | null};
    expect(doc.measured).toBeNull();
    expect(doc.measured_reason).toBe('no snapshot at HEAD');
    expect(exitCalls).toEqual([0]);
  });

  test('an unreadable ledger → json measured null with reason "ledger unreadable", exit 0', () => {
    setupRepo();
    // present, non-blank, but no line parses into a snapshot.
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'measure.jsonl'), 'not json at all\n{"broken":\n');

    runChangelogCommand({since: 'v0', json: true, measure: true, cwd: dir});
    const doc = JSON.parse(stdout()) as {measured: MeasureSnapshot | null; measured_reason: string | null};
    expect(doc.measured).toBeNull();
    expect(doc.measured_reason).toBe('ledger unreadable');
    expect(exitCalls).toEqual([0]);
  });

  test('an unreadable ledger STILL renders the full prose changelog + notice, exit 0', () => {
    setupRepo();
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'measure.jsonl'), 'garbage line\n');

    runChangelogCommand({since: 'v0', measure: true, cwd: dir});
    const out = stdout();
    // measurement embellishes, never breaks: the changelog body is fully rendered.
    expect(out).toContain('# Changes since v0');
    expect(out).toContain('Alpha flow'); // the flipped-to-done feature title
    // and the not-measured notice is appended instead of any numbers.
    expect(out).toContain('not measured at this commit');
    expect(exitCalls).toEqual([0]);
  });
});
