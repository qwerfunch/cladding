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
const SAFE = '  deliverable:\n    path: ./run\n    is_safe_to_smoke: true\n';

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

  test('PASS when the declared entry runs and exits 0', () => {
    writeSpec({deliverable: SAFE});
    writeEntry(0);
    const r = runDeliverableSmoke({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('FAIL (exit 1) when the declared entry CRASHES — the S5 reproduction', () => {
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
  });
});
