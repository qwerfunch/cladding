// Cladding · unit tests for multi-probe deliverable smoke (F-4ef09f38)
//
// stage_2.4 must run EVERY declared probe (not just probes[0]) and take the
// WORST per-probe disposition — one green probe can never mask a red one. These
// tests drive the public runner `runDeliverableSmoke({cwd})` with spec.yaml
// fixtures (the internal runSmokeProbes/evalProbe/finalizeSmoke are not exported;
// the public entry is the honest black-box surface, matching the sibling
// deliverable-smoke.test.ts). Feature ids obey the schema pattern
// ^F-(\d{3,}|[a-f0-9]{6,})$, so all fixture ids are 6-hex.

import {chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runDeliverableSmoke} from '../../src/stages/deliverable-smoke.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-multi-smoke-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, {recursive: true, force: true});
});

// ── fixture builders ─────────────────────────────────────────────────────────

interface ProbeSpec {
  readonly kind: 'cli' | 'none';
  readonly run?: readonly string[];
  readonly token?: string;
  readonly exit?: number;
  readonly feature?: string;
}
interface FeatSpec {
  readonly id: string;
  readonly status: string;
}

function probeYaml(p: ProbeSpec): string {
  const lines = [`    - kind: ${p.kind}`];
  if (p.run) lines.push(`      run: [${p.run.map((s) => JSON.stringify(s)).join(', ')}]`);
  if (p.feature) lines.push(`      feature: ${p.feature}`);
  if (p.token !== undefined || p.exit !== undefined) {
    lines.push('      expect:');
    if (p.exit !== undefined) lines.push(`        exit: ${p.exit}`);
    if (p.token !== undefined) lines.push(`        token: ${JSON.stringify(p.token)}`);
  }
  return lines.join('\n');
}
function featYaml(f: FeatSpec): string {
  return [`  - id: ${f.id}`, `    title: ${f.id}`, `    status: ${f.status}`].join('\n');
}
/** Write a spec.yaml carrying `probes` under project.smoke and `features`. */
function writeSmoke(probes: readonly ProbeSpec[], features: readonly FeatSpec[]): void {
  const smoke = probes.length ? `  smoke:\n${probes.map(probeYaml).join('\n')}\n` : '';
  const feats = `features:\n${features.map(featYaml).join('\n')}\n`;
  writeFileSync(join(dir, 'spec.yaml'), `schema: "0.1"\nproject:\n  name: t\n  language: typescript\n${smoke}${feats}`);
}
/** Write an executable ./name whose /bin/sh body is `body`; returns './name'. */
function writeScript(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return `./${name}`;
}
/** Scripts that yield each cheaply-producible disposition. */
function writeDispositionScripts(): void {
  writeScript('pass', 'echo TOK'); // clean exit 0 + token → pass
  writeScript('failt', 'echo nope'); // clean exit 0, token absent → fail
  writeScript('live', 'echo hi'); // clean exit 0, no token declared → liveness
}
function probeFor(label: 'pass' | 'fail' | 'liveness' | 'na'): ProbeSpec {
  switch (label) {
    case 'pass':
      return {kind: 'cli', run: ['./pass'], token: 'TOK'};
    case 'fail':
      return {kind: 'cli', run: ['./failt'], token: 'TOK'};
    case 'liveness':
      return {kind: 'cli', run: ['./live']};
    case 'na':
      return {kind: 'none'};
  }
}
const DONE: FeatSpec = {id: 'F-aaaaaa', status: 'done'};

// ── AC-1 (AC-2a12fdf6) — worst-of truth table + declaration-order lines ───────

describe('F-4ef09f38 AC-1 · worst-of aggregation over every probe', () => {
  // Every ordered pair over the cheaply-producible dispositions {pass, fail,
  // liveness, na}, proving the total order fail(5) > liveness(3) > pass(2) > na(1).
  // The pending_env rank (between fail and liveness) is exercised against na in the
  // AC-5 ceiling test; pending_env-vs-{fail,liveness,pass} lives in the source RANK
  // table (execa+clock interaction makes those pairs non-deterministic to co-drive).
  const cases: {p: ('pass' | 'fail' | 'liveness' | 'na')[]; d: string; e: number}[] = [
    {p: ['pass', 'fail'], d: 'fail', e: 1},
    {p: ['fail', 'pass'], d: 'fail', e: 1},
    {p: ['fail', 'liveness'], d: 'fail', e: 1},
    {p: ['liveness', 'fail'], d: 'fail', e: 1},
    {p: ['fail', 'na'], d: 'fail', e: 1},
    {p: ['na', 'fail'], d: 'fail', e: 1},
    {p: ['pass', 'liveness'], d: 'liveness', e: 0},
    {p: ['liveness', 'pass'], d: 'liveness', e: 0},
    {p: ['liveness', 'na'], d: 'liveness', e: 0},
    {p: ['na', 'liveness'], d: 'liveness', e: 0},
    {p: ['pass', 'na'], d: 'pass', e: 0},
    {p: ['na', 'pass'], d: 'pass', e: 0},
    {p: ['pass', 'pass'], d: 'pass', e: 0},
    {p: ['fail', 'fail'], d: 'fail', e: 1},
    {p: ['liveness', 'liveness'], d: 'liveness', e: 0},
    {p: ['na', 'na'], d: 'na', e: 0},
  ];

  test.each(cases)('[$p] → disposition $d (exit $e)', ({p, d, e}) => {
    writeDispositionScripts();
    writeSmoke(p.map(probeFor), [DONE]);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe(d);
    expect(r.exitCode).toBe(e);
    expect(r.pass).toBe(e === 0);
    // Every probe reported — one line each, in declaration order (no probe dropped).
    expect(r.probes).toHaveLength(p.length);
    expect((r.stderr ?? '').split('\n')).toHaveLength(p.length);
  });

  test('[covers:F-4ef09f38/AC-2a12fdf6] every per-probe line is present in declaration order (distinct argv)', () => {
    writeDispositionScripts();
    // pass, then fail, then liveness — distinct scripts so lines are distinguishable.
    writeSmoke([probeFor('pass'), probeFor('fail'), probeFor('liveness')], [DONE]);
    const r = runDeliverableSmoke({cwd: dir});
    const lines = (r.stderr ?? '').split('\n');
    expect(lines).toHaveLength(3);
    const iPass = lines.findIndex((l) => l.includes('./pass'));
    const iFail = lines.findIndex((l) => l.includes('./failt'));
    const iLive = lines.findIndex((l) => l.includes('./live'));
    expect(iPass).toBeGreaterThanOrEqual(0);
    expect(iFail).toBeGreaterThan(iPass);
    expect(iLive).toBeGreaterThan(iFail);
    expect(r.disposition).toBe('fail'); // worst of the three
  });
});

// ── AC-2 (AC-48ad9997) — one green probe never masks a red one ────────────────

describe('F-4ef09f38 AC-2 · red is never masked by a green', () => {
  test('[covers:F-4ef09f38/AC-48ad9997] one probe passes, one fails (token absent) → exit 1 naming the failing argv, both lines present', () => {
    writeScript('green', 'echo TOK'); // pass
    writeScript('red', 'echo wrong'); // clean exit, token absent → fail
    writeSmoke(
      [
        {kind: 'cli', run: ['./green'], token: 'TOK'},
        {kind: 'cli', run: ['./red'], token: 'TOK'},
      ],
      [DONE],
    );
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.disposition).toBe('fail');
    // The failing probe's argv is named in the report…
    expect(r.stderr).toContain('./red');
    // …and the passing probe's line is still present (not swallowed).
    expect(r.stderr).toContain('./green');
    expect(r.probes).toHaveLength(2);
    expect(r.probes?.[0].disposition).toBe('pass');
    expect(r.probes?.[1].disposition).toBe('fail');
  });

  test('the red probe blocks regardless of order (failing probe last)', () => {
    writeScript('green', 'echo TOK');
    writeScript('crash', 'exit 7'); // exit mismatch → fail
    writeSmoke(
      [
        {kind: 'cli', run: ['./green'], token: 'TOK'},
        {kind: 'cli', run: ['./crash'], token: 'TOK'},
      ],
      [DONE],
    );
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(1);
    expect(r.disposition).toBe('fail');
    expect(r.stderr).toContain('./crash');
  });
});

// ── AC-3 (AC-f747836a) — per-feature binding gates execution ──────────────────

describe('F-4ef09f38 AC-3 · per-feature binding', () => {
  test('[covers:F-4ef09f38/AC-f747836a] bound to a NOT-done feature → na, argv NOT executed (marker file stays absent)', () => {
    const marker = join(dir, 'MARKER');
    writeScript('mark', 'echo ran > MARKER; echo TOK'); // WOULD write MARKER if executed
    writeSmoke([{kind: 'cli', run: ['./mark'], token: 'TOK', feature: 'F-bbbbbb'}], [{id: 'F-bbbbbb', status: 'in_progress'}]);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('na');
    expect(r.exitCode).toBe(0); // na is non-blocking
    expect(existsSync(marker)).toBe(false); // proof of non-execution
    expect(r.probes?.[0].disposition).toBe('na');
    expect(r.probes?.[0].bindsFeature).toBe('F-bbbbbb');
  });

  test('bound to a DONE feature → executes (marker written), even with no other done feature (anyDone bypass)', () => {
    const marker = join(dir, 'MARKER');
    writeScript('mark', 'echo ran > MARKER; echo TOK');
    // The bound feature is done; there is no other done feature. Bound-to-done runs.
    writeSmoke([{kind: 'cli', run: ['./mark'], token: 'TOK', feature: 'F-aaaaaa'}], [DONE, {id: 'F-bbbbbb', status: 'planned'}]);
    const r = runDeliverableSmoke({cwd: dir});
    expect(existsSync(marker)).toBe(true); // proof of execution
    expect(r.disposition).toBe('pass'); // ran clean + token → pass
    expect(r.exitCode).toBe(0);
  });

  test('UNBOUND probe keeps project-global anyDone gating → not executed when nothing is done (exit 2 skip)', () => {
    const marker = join(dir, 'MARKER');
    writeScript('mark', 'echo ran > MARKER; echo TOK');
    writeSmoke([{kind: 'cli', run: ['./mark'], token: 'TOK'}], [{id: 'F-cccccc', status: 'planned'}]); // no done feature
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(2); // all-skip → legacy exit-2 lane
    expect(r.disposition).toBeUndefined();
    expect(existsSync(marker)).toBe(false); // gated: not executed
    expect(r.probes?.[0].disposition).toBe('na'); // skip folds to na in the structured outcome
  });
});

// ── AC-5 (AC-3770e5fa) — ceiling truncation → pending_env, never disappears ───
//
// The whole-stage ceiling (min of probe-count × per-probe timeout, 30 s) is a
// module constant and the truncation decision is inline (neither injectable nor
// an exported pure function), so the FULL wall-clock case is left to the
// implementer's spot-check (per the test brief — no 30 s test in the suite).
// A `Date.now` spy drives the truncation branch DETERMINISTICALLY without real
// wall-clock. The F4 reader lock consumes two zero-time reads before the smoke
// clock starts; the reached probe is kind:none (no execa, no Date.now).

describe('F-4ef09f38 AC-5 · time-ceiling truncation reports pending_env', () => {
  test('[covers:F-4ef09f38/AC-3770e5fa] a probe not started before the ceiling reports pending_env (blocking) and never disappears', () => {
    // Lock reads: 0,0. ceiling = min(2 × 5000, 30000) = 10000; started=0;
    // check#1=0 (probe1 runs); check#2=20000 ≥ 10000 (probe2 truncated).
    const clock = [0, 0, 0, 0, 20000];
    let i = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock[Math.min(i++, clock.length - 1)]);
    writeSmoke(
      [
        {kind: 'none'}, // reached → na
        {kind: 'cli', run: ['./never-runs']}, // truncated → pending_env (never executed)
      ],
      [DONE],
    );
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('pending_env');
    expect(r.exitCode).toBe(1); // pending_env blocks
    expect(r.pass).toBe(false);
    expect(r.probes).toHaveLength(2);
    expect(r.probes?.[0].disposition).toBe('na'); // guard: probe1 was reached, not truncated
    expect(r.probes?.[1].disposition).toBe('pending_env');
    expect(r.probes?.[1].detail).toContain('stage time ceiling');
    expect(r.stderr).toContain('./never-runs'); // the truncated probe never disappears from the report
    expect(r.stderr).toContain('stage time ceiling');
  });
});

// ── Degenerate N=1 — the single-probe contract is unchanged by the new runner ─

describe('F-4ef09f38 · degenerate N=1 (single-probe contract preserved)', () => {
  test('N=1 pass lane: single clean+token probe → disposition pass, exit 0', () => {
    writeScript('pass', 'echo TOK');
    writeSmoke([{kind: 'cli', run: ['./pass'], token: 'TOK'}], [DONE]);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('pass');
    expect(r.exitCode).toBe(0);
    expect(r.probes).toHaveLength(1);
    expect(r.probes?.[0].disposition).toBe('pass');
  });

  test('N=1 skip lane: single unbound probe with nothing done → exit 2, no disposition', () => {
    writeScript('pass', 'echo TOK');
    writeSmoke([{kind: 'cli', run: ['./pass'], token: 'TOK'}], [{id: 'F-cccccc', status: 'planned'}]);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.disposition).toBeUndefined();
    expect(r.probes).toHaveLength(1);
    expect(r.probes?.[0].disposition).toBe('na');
  });
});
