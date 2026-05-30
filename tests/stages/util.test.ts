// Cladding · unit tests for stages/util.ts — the shared exit-code contract.
//
// ranToolResult is the single choke point that keeps cladding's gate honest:
// it maps a RAN tool's result onto the stage pass/fail/skip contract where
// exitCode 2 is RESERVED for "skipped". A tool that exits non-zero (including
// tsc's exit 2 on type errors) must become a BLOCKING fail (exitCode 1), never
// a skip — otherwise `clad check` reports green on a real failure (Vacuous
// Green). missingToolSkip owns the only legitimate exit-2 (ENOENT) path.

import {describe, expect, test} from 'vitest';

import {missingToolSkip, ranToolResult} from '../../src/stages/util.js';

describe('ranToolResult — ran-tool exit code → stage contract', () => {
  test('exit 0 → pass, exitCode 0, no stderr', () => {
    const r = ranToolResult('stage_x', {exitCode: 0, stdout: 'ok', stderr: ''});
    expect(r).toEqual({stage: 'stage_x', pass: true, exitCode: 0});
  });

  test('exit 2 (tsc-style) → FAIL exitCode 1, NOT the skip code 2', () => {
    const r = ranToolResult('stage_1.1', {exitCode: 2, stdout: '', stderr: 'boom'});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1); // the whole point: 2 must never survive as a "skip"
    expect(r.stderr).toBe('boom');
  });

  test('exit 1 → FAIL exitCode 1', () => {
    const r = ranToolResult('stage_x', {exitCode: 1, stdout: '', stderr: 'nope'});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('nope');
  });

  test('any other non-zero (e.g. 137 OOM-kill) → FAIL exitCode 1', () => {
    const r = ranToolResult('stage_x', {exitCode: 137, stdout: '', stderr: ''});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
  });

  test('null exit code → FAIL exitCode 1 (defensive)', () => {
    const r = ranToolResult('stage_x', {exitCode: null, stdout: '', stderr: 'killed'});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('killed');
  });

  test('diagnostics on stdout (empty stderr) are surfaced as stderr', () => {
    const r = ranToolResult('stage_1.1', {exitCode: 2, stdout: 'x.ts: error TS2322', stderr: ''});
    expect(r.stderr).toContain('TS2322'); // tsc writes to stdout; gate must still show WHY
  });

  test('stderr wins over stdout when both present', () => {
    const r = ranToolResult('stage_x', {exitCode: 1, stdout: 'out', stderr: 'err'});
    expect(r.stderr).toBe('err');
  });

  test('fail with no output → no stderr field', () => {
    const r = ranToolResult('stage_x', {exitCode: 1, stdout: '', stderr: ''});
    expect(r).toEqual({stage: 'stage_x', pass: false, exitCode: 1});
    expect(r.stderr).toBeUndefined();
  });
});

describe('missingToolSkip — ENOENT is the ONLY exit-2 (skip) path', () => {
  test('ENOENT → skip exitCode 2 with "not installed"', () => {
    const r = missingToolSkip('stage_x', 'mytool', {code: 'ENOENT', exitCode: undefined});
    expect(r).not.toBeNull();
    expect(r?.exitCode).toBe(2);
    expect(r?.pass).toBe(false);
    expect(r?.stderr).toContain('not installed');
  });

  test('a tool that ran (no ENOENT) → null, so ranToolResult decides pass/fail', () => {
    expect(missingToolSkip('stage_x', 'mytool', {exitCode: 2})).toBeNull();
    expect(missingToolSkip('stage_x', 'mytool', {exitCode: 1})).toBeNull();
    expect(missingToolSkip('stage_x', 'mytool', {exitCode: 0})).toBeNull();
  });
});
