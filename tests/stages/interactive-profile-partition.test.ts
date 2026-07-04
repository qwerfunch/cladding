// Cladding · interactive-profile partition — static honesty tripwires (F-6ed216f3)
//
// The interactive profile's safety rests on a two-sided partition that no test
// exercises at runtime cheaply, so these are STATIC source tripwires:
//
//   AC-add14522 — a detector module that imports a subprocess runner (execa /
//     child_process) MUST carry `subprocess: true`. Without the flag the
//     interactive profile would silently spawn it, defeating the feature. This
//     test fails the moment a future detector adds a spawner without the flag.
//
//   AC-b49435f8 — the interactive profile is requested by exactly ONE call site,
//     the PostToolUse hook lane. Every other consumer — the Stop hook, every
//     `clad check` tier (src/cli/clad.ts), `clad report`, and the MCP gateFooter +
//     drift tool (src/serve/server.ts) — keeps the full detector suite. (The
//     runtime half of AC-b49435f8 lives in tests/cli/hook-interactive-profile.test.ts.)

import {readFileSync, readdirSync} from 'node:fs';
import {join, relative, sep} from 'node:path';

import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const DETECTORS_DIR = join(ROOT, 'src', 'stages', 'detectors');

// An import of the subprocess spawn primitive — the honest signal that a
// detector shells out. Matches `from 'execa'` and `from 'node:child_process'`
// (execFileSync / spawnSync / execSync all enter a module via child_process).
const SPAWNER_IMPORT = /(^|\n)\s*import\b[^\n;]*\bfrom\s+['"](execa|(?:node:)?child_process)['"]/;

// The `subprocess: true` flag on an exported detector literal.
const SUBPROCESS_FLAG = /\bsubprocess\s*:\s*true\b/;

// A runDrift call requesting the interactive profile.
const REQUESTS_INTERACTIVE = /\bprofile\s*:\s*['"]interactive['"]/;

function detectorFiles(): string[] {
  return readdirSync(DETECTORS_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
}

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

describe('subprocess-flag honesty — a spawner import implies the subprocess flag (AC-add14522)', () => {
  test('every detector module that imports a subprocess runner carries subprocess: true', () => {
    let checked = 0;
    for (const file of detectorFiles()) {
      const src = readFileSync(join(DETECTORS_DIR, file), 'utf8');
      if (!SPAWNER_IMPORT.test(src)) continue;
      checked++;
      expect(
        SUBPROCESS_FLAG.test(src),
        `${file} imports a subprocess runner (execa / child_process) but does NOT carry ` +
          'subprocess: true — the interactive profile would silently spawn it. Add the flag.',
      ).toBe(true);
    }
    // Guard against a vacuous pass (a broken regex matching nothing): the two
    // shipping adapters (madge, secretlint) MUST have been exercised.
    expect(checked, 'expected the two shipping subprocess detectors to be found by the import grep').toBeGreaterThanOrEqual(2);
  });

  test('every detector flagged subprocess: true actually imports a subprocess runner (no phantom flag)', () => {
    // Converse honesty: the flag must not be sprinkled on a detector that does
    // not spawn, else the interactive profile would defer coverage it never
    // needed. Keeps the partition tight from both directions.
    let flagged = 0;
    for (const file of detectorFiles()) {
      const src = readFileSync(join(DETECTORS_DIR, file), 'utf8');
      if (!SUBPROCESS_FLAG.test(src)) continue;
      flagged++;
      expect(
        SPAWNER_IMPORT.test(src),
        `${file} carries subprocess: true but imports no subprocess runner (phantom flag).`,
      ).toBe(true);
    }
    expect(flagged).toBeGreaterThanOrEqual(2);
  });
});

describe('interactive profile is requested by exactly one call site — the PostToolUse hook lane (AC-b49435f8)', () => {
  test('only src/cli/hook.ts requests the interactive profile', () => {
    const offenders = srcFiles()
      .filter((f) => REQUESTS_INTERACTIVE.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    // Positive (hook.ts DOES request it → the feature exists) AND negative
    // (nobody else does → Stop, check tiers, report, and the MCP gateFooter all
    // keep the full suite).
    expect(offenders).toEqual(['src/cli/hook.ts']);
  });

  test('the full-suite consumers call runDrift without requesting the interactive profile', () => {
    // The named consumers of AC-b49435f8: check tiers (clad.ts), the MCP
    // gateFooter + drift tool (server.ts), and clad report (report.ts). runDrift's
    // default profile is full (proven in drift-interactive-profile.test.ts), so
    // "no interactive" ≡ "full suite" for each.
    for (const consumer of ['src/cli/clad.ts', 'src/serve/server.ts', 'src/cli/report.ts']) {
      const src = readFileSync(join(ROOT, consumer), 'utf8');
      expect(src.includes('runDrift('), `${consumer} should call runDrift`).toBe(true);
      expect(
        REQUESTS_INTERACTIVE.test(src),
        `${consumer} must keep the full detector suite — it must not request the interactive profile`,
      ).toBe(false);
    }
  });
});
