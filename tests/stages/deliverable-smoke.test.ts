// Cladding · unit tests for stages/deliverable-smoke.ts (stage_2.4)
//
// The benchmark proof in miniature: the gate runs the spec-declared deliverable
// itself, so a CRASHING entry fails (exitCode 1) while a WORKING one passes —
// the exact discrimination the agent's internal unit tests structurally missed.
// Also pins the declaration-gating + skip discipline (exitCode 2 = skip, never a
// false fail).

import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runDeliverableSmoke} from '../../src/stages/deliverable-smoke.js';
import {loadSpec} from '../../src/spec/load.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-deliv-smoke-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Write a schema-valid spec.yaml with an optional deliverable block + done feature. */
function writeSpec(opts: {deliverable?: string; done?: boolean} = {}): void {
  const done = opts.done ?? true;
  const deliverable = opts.deliverable ?? '';
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject:\n  name: t\n  language: typescript\n${deliverable}` +
      `features:\n  - id: F-001\n    title: f\n    status: ${done ? 'done' : 'planned'}\n` +
      '    modules: [src/x.ts]\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
  );
}
/** Write an executable ./run that exits with `code`. */
function writeEntry(code: number): void {
  const p = join(dir, 'run');
  writeFileSync(p, `#!/bin/sh\nexit ${code}\n`);
  chmodSync(p, 0o755);
}
/** Write an executable ./run that prints `msg` to stderr, then exits with `code`. */
function writeEntryStderr(code: number, msg: string): void {
  const p = join(dir, 'run');
  writeFileSync(p, `#!/bin/sh\necho "${msg}" >&2\nexit ${code}\n`);
  chmodSync(p, 0o755);
}
const SAFE = '  deliverable:\n    path: ./run\n    is_safe_to_smoke: true\n';

/** Write an executable ./run that prints `out` to stdout, then exits with `code`. */
function writeEntryEcho(out: string, code: number): void {
  const p = join(dir, 'run');
  writeFileSync(p, `#!/bin/sh\necho "${out}"\nexit ${code}\n`);
  chmodSync(p, 0o755);
}
/** Write a spec.yaml whose project carries a `smoke:` block (F-g'). */
function writeSmokeSpec(smokeBlock: string, done = true): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject:\n  name: t\n  language: typescript\n${smokeBlock}` +
      `features:\n  - id: F-001\n    title: f\n    status: ${done ? 'done' : 'planned'}\n` +
      '    modules: [src/x.ts]\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
  );
}
const CLI_PROBE = (token?: string): string =>
  '  smoke:\n    - kind: cli\n      run: ["./run"]\n' + (token ? `      expect:\n        token: "${token}"\n` : '');

describe('stage_2.4 DELIVERABLE_SMOKE', () => {
  test('SKIP (exit 2) when no deliverable is declared', () => {
    writeSpec();
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
  });

  test('SKIP (exit 2) when deliverable is not marked is_safe_to_smoke', () => {
    writeSpec({deliverable: '  deliverable:\n    path: ./run\n'});
    writeEntry(0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(2);
  });

  test('SKIP (exit 2) when no feature is done yet', () => {
    writeSpec({deliverable: SAFE, done: false});
    writeEntry(0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(2);
  });

  test('SKIP (exit 2) when the declared entry is missing on disk', () => {
    writeSpec({deliverable: SAFE}); // no ./run written
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(2);
  });

  test('[covers:F-9064ff/AC-7ec24b] executes only a safe deliverable with a done feature and otherwise skips', () => {
    writeSpec({deliverable: SAFE});
    writeEntry(0);
    expect(runDeliverableSmoke({cwd: dir}).exitCode).toBe(0);

    writeSpec({deliverable: '  deliverable:\n    path: ./run\n'});
    expect(runDeliverableSmoke({cwd: dir}).exitCode).toBe(2);

    writeSpec({deliverable: SAFE, done: false});
    expect(runDeliverableSmoke({cwd: dir}).exitCode).toBe(2);
  });

  test('LIVENESS when the declared entry runs and exits 0 (exit-only ⇒ not a green PASS)', () => {
    writeSpec({deliverable: SAFE});
    writeEntry(0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.disposition).toBe('liveness'); // F-8f419e — non-green, non-blocking
  });

  test('[covers:F-9064ff/AC-bab4d0] FAIL (exit 1) when the declared entry CRASHES — the S5 reproduction', () => {
    writeSpec({deliverable: SAFE});
    writeEntry(1); // broken/crashing entry
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1); // BLOCKS — never a skip
    expect(r.stderr).toMatch(/exited 1, expected 0/);
  });

  test('respects expect_exit (a non-zero success code passes)', () => {
    writeSpec({deliverable: '  deliverable:\n    path: ./run\n    is_safe_to_smoke: true\n    expect_exit: 2\n'});
    writeEntry(2);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.disposition).toBe('liveness');
  });

  test('PASS even when a working entry writes a benign warning to stderr (no stderr over-block)', () => {
    // Deliberate boundary: the smoke is exit-code-only. A healthy CLI legitimately
    // writes to stderr (a Node --experimental-strip-types ExperimentalWarning), so a
    // clean exit must still pass — failing on stderr would false-fail common TS-node
    // entries. "Runs but prints wrong OUTPUT" stays the impl-blind oracle's job.
    writeSpec({deliverable: SAFE});
    writeEntryStderr(0, 'ExperimentalWarning: Type Stripping is experimental');
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.disposition).toBe('liveness');
  });
});

describe("stage_2.4 functional smoke probes (F-g')", () => {
  test('[covers:F-43d8e3/AC-0e2aa7] schema accepts cli and none probes with run, expectation, binds, and why fields', () => {
    writeSmokeSpec(
      '  smoke:\n' +
        '    - kind: cli\n' +
        '      run: ["./run"]\n' +
        '      expect: {ac: AC-001, exit: 0, token: HELLO}\n' +
        '      binds: {feature: F-001, modules: [src/x.ts]}\n' +
        '      why: proves the deliverable responds\n' +
        '    - kind: none\n' +
        '      binds: {feature: F-001}\n' +
        '      why: static companion proof\n',
    );
    writeEntryEcho('HELLO', 0);

    const probes = loadSpec(dir).project.smoke;
    expect(probes).toEqual([
      {
        kind: 'cli',
        run: ['./run'],
        expect: {ac: 'AC-001', exit: 0, token: 'HELLO'},
        binds: {feature: 'F-001', modules: ['src/x.ts']},
        why: 'proves the deliverable responds',
      },
      {
        kind: 'none',
        binds: {feature: 'F-001'},
        why: 'static companion proof',
      },
    ]);
    expect(runDeliverableSmoke({cwd: dir}).disposition).toBe('pass');
  });

  test('[covers:F-43d8e3/AC-46afdd] PASS (green) when a cli probe runs clean AND stdout contains the AC token', () => {
    writeSmokeSpec(CLI_PROBE('HELLO'));
    writeEntryEcho('say HELLO world', 0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('pass'); // §17.2 — the liveness→pass upgrade
    expect(r.exitCode).toBe(0);
  });

  test('[covers:F-8f419e/AC-332ace] LIVENESS when a cli probe runs clean but declares NO token (exit-only)', () => {
    writeSmokeSpec(CLI_PROBE());
    writeEntryEcho('whatever', 0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('liveness');
  });

  test('FAIL (blocking) when the probe exits clean but the AC token is ABSENT from stdout', () => {
    writeSmokeSpec(CLI_PROBE('HELLO'));
    writeEntryEcho('nothing here', 0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('fail');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/did not contain the AC token/);
  });

  test('FAIL when the probe exits non-zero (entry crashed)', () => {
    writeSmokeSpec(CLI_PROBE('HELLO'));
    writeEntryEcho('HELLO', 1);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.exitCode).toBe(1);
  });

  test('N/A for a kind:none probe (nothing to run)', () => {
    writeSmokeSpec('  smoke:\n    - kind: none\n');
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('na');
  });

  test('a smoke probe takes precedence over the legacy deliverable', () => {
    writeSmokeSpec('  deliverable:\n    path: ./run\n    is_safe_to_smoke: true\n' + CLI_PROBE('HELLO'));
    writeEntryEcho('HELLO', 0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.disposition).toBe('pass');
  });

  test('[covers:F-43d8e3/AC-dc287f] probe dispositions distinguish exit-only liveness, missing-token failure, and kind:none', () => {
    writeSmokeSpec(CLI_PROBE());
    writeEntryEcho('ordinary output', 0);
    expect(runDeliverableSmoke({cwd: dir}).disposition).toBe('liveness');

    writeSmokeSpec(CLI_PROBE('HELLO'));
    writeEntryEcho('ordinary output', 0);
    const missingToken = runDeliverableSmoke({cwd: dir});
    expect(missingToken.disposition).toBe('fail');
    expect(missingToken.exitCode).toBe(1);

    writeSmokeSpec('  smoke:\n    - kind: none\n');
    expect(runDeliverableSmoke({cwd: dir}).disposition).toBe('na');
  });
});
