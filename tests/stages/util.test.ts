// Cladding · unit tests for stages/util.ts — the shared exit-code contract.
//
// ranToolResult is the single choke point that keeps cladding's gate honest:
// it maps a RAN tool's result onto the stage pass/fail/skip contract where
// exitCode 2 is RESERVED for "skipped". A tool that exits non-zero (including
// tsc's exit 2 on type errors) must become a BLOCKING fail (exitCode 1), never
// a skip — otherwise `clad check` reports green on a real failure (Vacuous
// Green). missingToolSkip owns the only legitimate exit-2 (ENOENT) path.

import {describe, expect, test} from 'vitest';

import {classifyScannerExit, missingToolSkip, ranToolResult} from '../../src/stages/util.js';

const found = (d: string) => `reported: ${d}`;
const skipped = (d: string) => `could not run: ${d}`;

describe('ranToolResult — ran-tool exit code → stage contract', () => {
  test('exit 0 → pass, exitCode 0, no stderr', () => {
    const r = ranToolResult('stage_x', {exitCode: 0, stdout: 'ok', stderr: ''});
    expect(r).toEqual({stage: 'stage_x', pass: true, exitCode: 0});
  });

  test("[covers:F-af96b1/AC-001] exit 2 (tsc-style) → FAIL exitCode 1, NOT the skip code 2", () => {
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

  test('BOTH streams survive, report first — neither displaces the other', () => {
    // Previously stderr won outright, which discarded madge's cycle list
    // (stdout) in favour of its progress line (stderr) and left the developer
    // unable to see WHICH files formed the loop.
    const r = ranToolResult('stage_x', {exitCode: 1, stdout: 'out', stderr: 'err'});
    expect(r.stderr).toBe('out\nerr');
  });

  test("a scanner's report is not lost behind its progress line", () => {
    const r = ranToolResult('stage_1.5', {
      exitCode: 1,
      stderr: '- Finding files\n✖ Found 2 circular dependencies!',
      stdout: 'Processed 9 files (203ms)\n\n1) src/a.ts > src/b.ts\n2) src/c.ts > src/d.ts',
    });
    expect(r.stderr).toContain('src/a.ts > src/b.ts');
    expect(r.stderr).toContain('src/c.ts > src/d.ts');
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

  test('npx refusal under --no-install → skip because the configured tool never ran', () => {
    const r = missingToolSkip('stage_x', 'npx', {
      exitCode: 1,
      stderr: 'npm error npx canceled due to missing packages and no YES option: ["eslint@9"]',
    });
    expect(r?.exitCode).toBe(2);
    expect(r?.stderr).toContain('could not resolve');
  });

  test('offline npx cache miss → skip immediately instead of becoming a tool failure', () => {
    const r = missingToolSkip('stage_x', 'npx', {
      exitCode: 1,
      stderr: "npm error code ENOTCACHED\nnpm error cache mode is 'only-if-cached'",
    });
    expect(r?.exitCode).toBe(2);
  });

  test("[covers:F-af96b1/AC-005] offline npx shell-level command miss → visible setup gap", () => {
    const r = missingToolSkip('stage_x', 'npx', {
      exitCode: 127,
      stderr: '/bin/sh: vitest: command not found',
    }, ['--offline', '--no-install', 'vitest', 'run']);
    expect(r?.exitCode).toBe(2);
    expect(r?.stderr).toContain('setup gap');
    expect(r?.stderr).toContain('not installed');
  });

  test('missing helper inside a resolved npx tool remains a failure', () => {
    expect(missingToolSkip('stage_x', 'npx', {
      exitCode: 127,
      stderr: '/bin/sh: project-helper: command not found',
    }, ['--offline', '--no-install', 'vitest', 'run'])).toBeNull();
  });

  test('shell-level command miss from a project-owned npm script remains a failure', () => {
    expect(missingToolSkip('stage_x', 'npm', {
      exitCode: 127,
      stderr: '/bin/sh: project-helper: command not found',
    })).toBeNull();
  });

  test('the same text from a project-owned npm script is still a real failure', () => {
    expect(missingToolSkip('stage_x', 'npm', {
      exitCode: 1,
      stderr: 'could not determine executable to run',
    })).toBeNull();
  });
});

// Fix ② — a scanner (secretlint / arch validator) that RAN but exited non-zero:
// a real finding BLOCKS (error); a config/setup gap SKIPS (info). secretlint
// exits non-zero with "config is not found" when there is no .secretlintrc — that
// must NOT be reported as a hardcoded secret (the cold-user false-RED).
describe('classifyScannerExit — finding vs config/setup gap', () => {
  test('exit 0 → no findings', () => {
    expect(classifyScannerExit({exitCode: 0}, 'D', found, skipped)).toEqual([]);
  });

  test('config-not-found (secretlint) → INFO (non-blocking), not a finding', () => {
    const out = classifyScannerExit(
      {exitCode: 2, stderr: 'Error: secretlint config is not found\nSecretlint require .secretlintrc config file.'},
      'HARDCODED_SECRET', found, skipped,
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('info');
    expect(out[0].message).toContain('could not run');
  });

  test('ENOENT/cannot-find-module in output → INFO (setup gap)', () => {
    const out = classifyScannerExit({exitCode: 1, stderr: "Cannot find module '@secretlint/preset'"}, 'D', found, skipped);
    expect(out[0].severity).toBe('info');
  });

  test('the scanner REPORT survives — a progress line on stderr must not displace it', () => {
    // madge writes its progress to stderr and its cycle list to stdout. Taking
    // stderr first left the developer with "- Finding files" and no idea WHICH
    // files form the loop — the whole reason a real adopter spent sixteen days
    // on it and recorded the wrong cause.
    const out = classifyScannerExit(
      {
        exitCode: 1,
        stderr: '- Finding files\nProcessed 209 files (970ms)',
        stdout: '✖ Found 2 circular dependencies!\n1) src/a.ts > src/b.ts\n2) src/c.ts > src/d.ts',
      },
      'ARCHITECTURE_VIOLATION', found, skipped,
    );
    expect(out[0].severity).toBe('error');
    expect(out[0].message).toContain('src/a.ts > src/b.ts');
    expect(out[0].message).toContain('src/c.ts > src/d.ts');
  });

  test('a long report is not cut off after the first cycle or two', () => {
    const cycles = Array.from({length: 12}, (_, i) => `${i + 1}) src/very/deeply/nested/module-${i}.ts > src/other/deeply/nested/partner-${i}.ts`);
    const out = classifyScannerExit(
      {exitCode: 1, stdout: `✖ Found 12 circular dependencies!\n${cycles.join('\n')}`},
      'ARCHITECTURE_VIOLATION', found, skipped,
    );
    expect(out[0].message).toContain('module-11.ts');
  });

  test('stderr still carries the detail when the scanner says nothing on stdout', () => {
    const out = classifyScannerExit(
      {exitCode: 1, stderr: 'eslint: Unexpected token in src/x.ts'},
      'LINT', found, skipped,
    );
    expect(out[0].message).toContain('Unexpected token in src/x.ts');
  });

  test('a REAL finding (no setup-error pattern) → ERROR (blocks the gate)', () => {
    const out = classifyScannerExit(
      {exitCode: 1, stdout: 'src/leak.ts:1:1 found AWS secret AKIAIOSFODNN7EXAMPLE'},
      'HARDCODED_SECRET', found, skipped,
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
    expect(out[0].message).toContain('reported');
  });

  // npm exec refuses to run an unresolvable tool under `npx --no-install` — the
  // scanner never executed, so this is a setup gap, not a violation. Verbatim
  // message from the CI runners that broke develop (2026-06-11): local ~/.npm/_npx
  // caches masked it; fresh runners surfaced the false ARCHITECTURE_VIOLATION.
  test('npx canceled-due-to-missing-packages → INFO (tool never ran)', () => {
    const out = classifyScannerExit(
      {exitCode: 1, stderr: 'npm error npx canceled due to missing packages and no YES option: ["madge@8.0.0"]'},
      'ARCHITECTURE_VIOLATION', found, skipped,
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('info');
  });

  test("npx could-not-determine-executable → INFO (npm exec's other refusal)", () => {
    const out = classifyScannerExit(
      {exitCode: 1, stderr: 'npm error could not determine executable to run'},
      'ARCHITECTURE_VIOLATION', found, skipped,
    );
    expect(out[0].severity).toBe('info');
  });

  test('offline npx cache miss → INFO setup gap, never a scanner finding', () => {
    const out = classifyScannerExit(
      {exitCode: 1, stderr: 'npm error code ENOTCACHED'},
      'ARCHITECTURE_VIOLATION', found, skipped,
    );
    expect(out[0].severity).toBe('info');
  });
});
