// Cladding · unit tests for stages/test-run-cache.ts (F-49f6f2d2, issue #215)
//
// WHY. `clad check --tier=pre-push` ran the SAME vitest suite TWICE — stage_2.1
// (unit) and stage_2.2 (coverage) each spawned their own `vitest run`. This
// feature lets the unit stage spawn ONE shared coverage+dual-json vitest run
// that the coverage stage folds instead of re-spawning. THE constraint (the
// exact thing rejected PR #216 got wrong): the reuse path must never return a
// passing unit result before the vacuous-test guard (F-b81d203e) has run against
// the shared run's json — AC-6b2d81f7 below is the load-bearing case.
//
// Authored against spec/features/test-run-dedup-49f6f2d2.yaml only (I did not
// write src/stages/test-run-cache.ts / unit.ts / cov.ts / cli/clad.ts — Opus did;
// this file is anti-self-cert). execaSync is mocked (mirrors unit.test.ts /
// cov.test.ts / detector-result-cache.test.ts); a mocked call never actually
// spawns vitest, so where a test needs the shared run's per-test json to exist
// on disk (the guard-preservation cases) the mock implementation writes it
// itself, standing in for what the real dual-json reporter would have written.

import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import type {AcceptanceCriterion, Feature, Spec} from '../../src/spec/types.js';

vi.mock('execa', () => ({execaSync: vi.fn()}));

const {runUnit} = await import('../../src/stages/unit.js');
const {runCov} = await import('../../src/stages/cov.js');
const {
  primeTestRunCache,
  clearTestRunCache,
  isTestRunPrimed,
  getOrRunSharedCoverage,
  peekSharedRun,
  unitActionFromCoverage,
} = await import('../../src/stages/test-run-cache.js');
const {primeSpecCache} = await import('../../src/spec/load.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

// ─── fixtures ───

/** A temp dir that resolves to the vitest toolchain default (package.json
 *  present, no jest config) — the same idiom unit.test.ts / cov.test.ts use so
 *  `resolveStageCommand('test'|'coverage', …)` actually yields a vitest command
 *  (cmd: 'npx', args containing 'vitest') instead of "unknown language". */
function vitestProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
  return dir;
}

/** A temp dir that resolves to the Python pytest + coverage.py toolchain. */
function pytestProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "0.0.0"\n');
  return dir;
}

const CLEAN = {exitCode: 0, stdout: '', stderr: ''};

/** vitest `--reporter=json` document shape (mirrors vacuous-tests.test.ts). */
function vitestJson(files: ReadonlyArray<{name: string; statuses: string[]}>): string {
  return JSON.stringify({
    testResults: files.map((f) => ({
      name: f.name,
      assertionResults: f.statuses.map((status, i) => ({status, fullName: 'case ' + String(i)})),
    })),
  });
}

function feature(overrides: Partial<Feature>): Feature {
  return {
    id: 'F-test0001',
    slug: 'test-feature',
    title: 'Test feature',
    status: 'done',
    acceptance_criteria: [],
    ...overrides,
  } as Feature;
}

function specOf(features: ReadonlyArray<Feature>): Spec {
  return {schema: '0.1', project: {name: 'fixture'}, features} as unknown as Spec;
}

/** Pulls the `--outputFile=<path>` argument out of an execaSync args array —
 *  the shared/own run's dual-json reporter path. */
function outputFileArg(args: readonly string[]): string {
  const arg = args.find((a) => a.startsWith('--outputFile='));
  if (!arg) throw new Error('no --outputFile= arg found in ' + JSON.stringify(args));
  return arg.slice('--outputFile='.length);
}

/** Mocks execaSync so that whichever call carries `--outputFile=<path>` writes
 *  `jsonText` to that path before resolving with `result` — standing in for
 *  what the real dual-json reporter would have written. */
function mockRunWritingJson(jsonText: string, result: Record<string, unknown> = CLEAN) {
  execaSyncMock.mockImplementationOnce((_cmd: string, args: readonly string[]) => {
    writeFileSync(outputFileArg(args), jsonText);
    return result;
  });
}

beforeEach(() => execaSyncMock.mockReset());
afterEach(() => {
  clearTestRunCache();
  primeSpecCache('.', null);
});

// ─── test-run-cache primitives, in isolation (mirrors detector-result-cache.test.ts) ───

describe('test-run-cache primitives (session-scoped, cwd-guarded)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-trc-prim-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('isTestRunPrimed() is false when no session has been primed', () => {
    expect(isTestRunPrimed()).toBe(false);
  });

  test('primeTestRunCache() flips isTestRunPrimed() to true', () => {
    primeTestRunCache(dir);
    expect(isTestRunPrimed()).toBe(true);
  });

  test('clearTestRunCache() flips isTestRunPrimed() back to false', () => {
    primeTestRunCache(dir);
    clearTestRunCache();
    expect(isTestRunPrimed()).toBe(false);
  });

  test('AC-2d4b9e63: getOrRunSharedCoverage returns null when unprimed — never invokes buildRun', () => {
    const buildRun = vi.fn(() => CLEAN);
    expect(getOrRunSharedCoverage(dir, buildRun)).toBeNull();
    expect(buildRun).not.toHaveBeenCalled();
  });

  test('AC-2d4b9e63: peekSharedRun returns null when unprimed', () => {
    expect(peekSharedRun(dir)).toBeNull();
  });

  test('getOrRunSharedCoverage under a cwd other than the primed session cwd is a miss (no buildRun call)', () => {
    const other = mkdtempSync(join(tmpdir(), 'clad-trc-mm-'));
    try {
      primeTestRunCache(dir);
      const buildRun = vi.fn(() => CLEAN);
      expect(getOrRunSharedCoverage(other, buildRun)).toBeNull();
      expect(buildRun).not.toHaveBeenCalled();
    } finally {
      rmSync(other, {recursive: true, force: true});
    }
  });

  test('AC-9a1c4e21: getOrRunSharedCoverage memoizes — a second call under the same cwd does not re-invoke buildRun', () => {
    primeTestRunCache(dir);
    const buildRun = vi.fn(() => CLEAN);
    const first = getOrRunSharedCoverage(dir, buildRun);
    const second = getOrRunSharedCoverage(dir, buildRun);
    expect(buildRun).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test('peekSharedRun returns null before any getOrRunSharedCoverage call, then the memoized run after', () => {
    primeTestRunCache(dir);
    expect(peekSharedRun(dir)).toBeNull(); // unit never triggered a shared run yet
    const run = getOrRunSharedCoverage(dir, () => CLEAN);
    expect(peekSharedRun(dir)).toBe(run);
  });

  test('clearTestRunCache unlinks the shared temp json (best-effort GATE-scoped lifetime)', () => {
    primeTestRunCache(dir);
    getOrRunSharedCoverage(dir, (jsonFile) => {
      writeFileSync(jsonFile, '{}'); // buildRun receives the path the cache chose
      return CLEAN;
    });
    const run = peekSharedRun(dir);
    expect(run).not.toBeNull();
    expect(existsSync(run!.jsonFile)).toBe(true);
    clearTestRunCache();
    expect(existsSync(run!.jsonFile)).toBe(false);
  });

  test('clearTestRunCache is idempotent / safe when nothing was primed', () => {
    expect(() => clearTestRunCache()).not.toThrow();
  });
});

// ─── unitActionFromCoverage — sound attribution (AC-8c5a2fb0) ───

describe('unitActionFromCoverage (AC-8c5a2fb0)', () => {
  test('green + exitCode 0 → reuse-pass', () => {
    expect(unitActionFromCoverage({pass: true, exitCode: 0})).toBe('reuse-pass');
  });

  test('pass=false (a real failure) → fallback', () => {
    expect(unitActionFromCoverage({pass: false, exitCode: 1})).toBe('fallback');
  });

  test('pass=true but non-zero exitCode (inconsistent/threshold-adjacent) → fallback', () => {
    expect(unitActionFromCoverage({pass: true, exitCode: 1})).toBe('fallback');
  });

  test('pass=false and exitCode 0 (defensive combo) → fallback (conservative)', () => {
    expect(unitActionFromCoverage({pass: false, exitCode: 0})).toBe('fallback');
  });
});

// ─── AC-2d4b9e63 — unprimed pass-through: byte-for-byte unchanged, own spawns ───

describe('AC-2d4b9e63 — unprimed: unit and cov are a pass-through, each spawn their own run', () => {
  let dir: string;
  beforeEach(() => {
    dir = vitestProject('clad-trd-passthrough-');
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('unprimed: runUnit spawns its own command, unaffected by the cache module', () => {
    expect(isTestRunPrimed()).toBe(false);
    execaSyncMock.mockReturnValueOnce(CLEAN);
    const r = runUnit({cwd: dir});
    expect(r.pass).toBe(true);
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execaSyncMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('npx');
    expect(args).toContain('vitest');
    expect(args).not.toContain('--coverage'); // the TEST command, not coverage
  });

  test('unprimed: runCov spawns its own command too — two independent spawns total (today\'s behavior)', () => {
    execaSyncMock.mockReturnValueOnce(CLEAN); // unit's own run
    execaSyncMock.mockReturnValueOnce(CLEAN); // cov's own run
    const unitResult = runUnit({cwd: dir});
    const covResult = runCov({cwd: dir});
    expect(unitResult.pass).toBe(true);
    expect(covResult.pass).toBe(true);
    expect(execaSyncMock).toHaveBeenCalledTimes(2); // NOT deduped — cache never primed
    const covArgs = execaSyncMock.mock.calls[1]![1] as string[];
    expect(covArgs).toContain('--coverage');
  });
});

// ─── AC-9a1c4e21 + AC-3f7e0c94 — primed: run once, dual-json reporter present ───

describe('AC-9a1c4e21 / AC-3f7e0c94 — primed vitest gate: the suite runs ONCE and carries the dual reporter', () => {
  let dir: string;
  beforeEach(() => {
    dir = vitestProject('clad-trd-dedup-');
    primeTestRunCache(dir);
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('runUnit then runCov spawn exactly ONE vitest process total (the #215 fix)', () => {
    execaSyncMock.mockReturnValueOnce(CLEAN);
    const unitResult = runUnit({cwd: dir});
    const covResult = runCov({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalledTimes(1); // ONE shared run, not two
    expect(unitResult.pass).toBe(true);
    expect(unitResult.exitCode).toBe(0);
    expect(covResult.pass).toBe(true);
    expect(covResult.exitCode).toBe(0);
  });

  test('the one shared command is the COVERAGE command augmented with the dual json reporter', () => {
    execaSyncMock.mockReturnValueOnce(CLEAN);
    runUnit({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execaSyncMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('npx');
    expect(args).toContain('vitest');
    expect(args).toContain('--coverage'); // the shared run IS the coverage command
    expect(args).toContain('--reporter=default');
    expect(args).toContain('--reporter=json');
    expect(args.some((a) => a.startsWith('--outputFile='))).toBe(true);
  });

  test('cov folds the SAME shared proc unit triggered — no independent cov spawn', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: 'coverage: 92%', stderr: ''});
    runUnit({cwd: dir});
    const covResult = runCov({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
    expect(covResult.pass).toBe(true);
    expect(covResult.exitCode).toBe(0);
  });

  test('cov called BEFORE unit (defensive ordering) still spawns its own if unit never triggered a shared run', () => {
    // peekSharedRun-only consumer: if nothing triggered getOrRunSharedCoverage yet,
    // cov must fall back to spawning its own (byte-identical to unprimed).
    execaSyncMock.mockReturnValueOnce(CLEAN);
    const covResult = runCov({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
    expect(covResult.pass).toBe(true);
  });
});

describe('primed pytest gate: Unit and Coverage share one coverage-instrumented run', () => {
  let dir: string;
  beforeEach(() => {
    dir = pytestProject('clad-trd-pytest-');
    primeTestRunCache(dir);
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('runUnit then runCov spawn pytest exactly once through coverage.py', () => {
    execaSyncMock.mockReturnValueOnce(CLEAN);
    const unitResult = runUnit({cwd: dir, strict: true});
    const covResult = runCov({cwd: dir});

    expect(unitResult.pass).toBe(true);
    expect(covResult.pass).toBe(true);
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execaSyncMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('coverage');
    expect(args).toEqual(['run', '-m', 'pytest']);
  });

  test('AC-f8e85a99 — a green shared run that collected ZERO tests blocks under --strict (guard not bypassed)', () => {
    // coverage.py exits 0 but pytest collected nothing (e.g. an over-narrow selection).
    execaSyncMock.mockReturnValueOnce({
      exitCode: 0,
      stdout: 'collected 0 items\n\nno tests ran in 0.01s\n',
      stderr: '',
    });
    const unitResult = runUnit({cwd: dir, strict: true});

    expect(unitResult.pass).toBe(false);
    expect(unitResult.findings?.[0]?.detector).toBe('VACUOUS_TESTS');
    // still one spawn — the guard reads the shared run's own summary, no re-run.
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
  });
});

// ─── AC-8c5a2fb0 (stage level) — a non-green shared run falls back, sound attribution ───

describe('AC-8c5a2fb0 — non-green shared run: unit falls back to its own tests-only run', () => {
  let dir: string;
  beforeEach(() => {
    dir = vitestProject('clad-trd-fallback-');
    primeTestRunCache(dir);
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('shared (coverage) run fails on threshold, but unit\'s OWN tests-only run is green → unit PASSES (not mis-attributed)', () => {
    // 1st call: the shared coverage+json run — non-green (e.g. coverage threshold miss).
    execaSyncMock.mockImplementationOnce(() => ({exitCode: 1, stdout: '', stderr: 'coverage threshold not met'}));
    // 2nd call: unit's OWN tests-only fallback run — the actual tests are fine.
    execaSyncMock.mockImplementationOnce(() => CLEAN);

    const unitResult = runUnit({cwd: dir});
    expect(unitResult.pass).toBe(true); // NOT blamed for the coverage-only miss
    expect(execaSyncMock).toHaveBeenCalledTimes(2);

    // cov, called after, folds the already-memoized (failing) shared run —
    // no THIRD spawn, and it correctly reports the coverage failure.
    const covResult = runCov({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalledTimes(2);
    expect(covResult.pass).toBe(false);
    expect(covResult.stderr).toContain('coverage threshold not met');
  });
});

// ─── AC-6b2d81f7 — guard preservation on the reuse path (THE #216 defect) ───

describe('AC-6b2d81f7 — the vacuous-test guard MUST still fire on the reuse path (load-bearing)', () => {
  let dir: string;
  beforeEach(() => {
    dir = vitestProject('clad-trd-guard-');
    primeTestRunCache(dir);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('shared run is GREEN but the done feature\'s declared test file is ALL-SKIPPED → unit is RED with VACUOUS_TESTS, not a passing reuse', () => {
    const testFile = join(dir, 'tests', 'dedup-guard.test.ts');
    const spec = specOf([
      feature({
        id: 'F-guard0001',
        title: 'Dedup guard feature',
        status: 'done',
        acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/dedup-guard.test.ts']} as AcceptanceCriterion],
      }),
    ]);
    primeSpecCache(dir, spec);

    // The shared run exits 0 (green) — exactly the silently-vacuous scenario the
    // guard exists to catch: the runner ran, nothing failed, but nothing that
    // executed a passing assertion covers the done feature either.
    mockRunWritingJson(vitestJson([{name: testFile, statuses: ['skipped', 'skipped']}]), CLEAN);

    const result = runUnit({cwd: dir, strict: true});

    // The reuse path must never have returned pass:true before the guard ran.
    expect(result.pass).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.findings).toBeDefined();
    expect(result.findings!.some((f) => f.detector === 'VACUOUS_TESTS')).toBe(true);
    expect(result.findings!.some((f) => f.message.includes('Dedup guard feature'))).toBe(true);

    // The guard fired ON THE SHARED RUN — dedup is still in effect; the gate did
    // NOT fall back to spawning a second (own) vitest process to reach this RED.
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
  });

  test('inverse: shared run GREEN + the declared test file has a REAL passing assertion → reuse-pass, and cov folds the same run', () => {
    const testFile = join(dir, 'tests', 'dedup-real.test.ts');
    const spec = specOf([
      feature({
        id: 'F-real0001',
        title: 'Dedup real feature',
        status: 'done',
        acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/dedup-real.test.ts']} as AcceptanceCriterion],
      }),
    ]);
    primeSpecCache(dir, spec);

    mockRunWritingJson(vitestJson([{name: testFile, statuses: ['passed']}]), CLEAN);

    const unitResult = runUnit({cwd: dir, strict: true});
    expect(unitResult.pass).toBe(true);
    expect(unitResult.exitCode).toBe(0);
    expect(unitResult.findings ?? []).toEqual([]);

    const covResult = runCov({cwd: dir});
    expect(covResult.pass).toBe(true);

    // Still exactly ONE vitest spawn across both stages — the guard evaluation
    // is pure json-file analysis, not a second process.
    expect(execaSyncMock).toHaveBeenCalledTimes(1);
  });

  test('non-strict: the guard does not apply on the reuse path either (guardOn=false) — vacuous content still reuse-passes', () => {
    const testFile = join(dir, 'tests', 'dedup-nonstrict.test.ts');
    const spec = specOf([
      feature({
        id: 'F-ns0001',
        title: 'Non-strict feature',
        status: 'done',
        acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/dedup-nonstrict.test.ts']} as AcceptanceCriterion],
      }),
    ]);
    primeSpecCache(dir, spec);

    mockRunWritingJson(vitestJson([{name: testFile, statuses: ['skipped']}]), CLEAN);

    // strict defaults to false when omitted — same as today's plain contract.
    const result = runUnit({cwd: dir});
    expect(result.pass).toBe(true);
    expect(result.findings ?? []).toEqual([]);
  });
});
