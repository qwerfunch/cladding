// Cladding · tests for drift detector HOST_CLAIM_DRIFT (#41, F-5283985e)
//
// Impl-blind test authoring: written from AC-922cd29d + the detector's
// documented rank semantics, never its body. The detector compares TWO
// machine-readable fences — README `clad:host-claims` (INTENT) vs
// docs/dogfood/matrix.md `clad:matrix-grades` (EVIDENCE) — and fires a warn
// ONLY when a claim EXCEEDS the evidence. It is a no-op unless BOTH fences
// exist, and `not-run` evidence is NEUTRAL (absence contradicts nothing).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {hostClaimDrift} from '../../../src/stages/detectors/host-claim-drift.js';
import type {DriftFinding} from '../../../src/stages/types.js';

describe('HOST_CLAIM_DRIFT — README claims may not exceed matrix evidence (AC-922cd29d)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hostclaim-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  /** Write README.md with a host-claims fence (object → JSON) or a raw string body. */
  const writeReadme = (claims: Record<string, string> | string | null): void => {
    if (claims === null) return; // omit the file entirely
    const fence =
      typeof claims === 'string' ? claims : `<!-- clad:host-claims ${JSON.stringify(claims)} -->`;
    writeFileSync(join(dir, 'README.md'), `# Project\n\n${fence}\n`);
  };

  /** Write docs/dogfood/matrix.md with a matrix-grades fence, or a raw string body. */
  const writeMatrix = (grades: Record<string, string> | string | null): void => {
    if (grades === null) return; // omit the file entirely
    mkdirSync(join(dir, 'docs', 'dogfood'), {recursive: true});
    const fence =
      typeof grades === 'string' ? grades : `<!-- clad:matrix-grades ${JSON.stringify(grades)} -->`;
    writeFileSync(join(dir, 'docs', 'dogfood', 'matrix.md'), `# Host matrix\n\n${fence}\n`);
  };

  const run = (): DriftFinding[] => [...hostClaimDrift.run({cwd: dir})];

  test('verified claim vs fail evidence → one warn naming the host + divergence', () => {
    writeReadme({claude: 'verified'});
    writeMatrix({claude: 'fail'});
    const fs = run();
    expect(fs).toHaveLength(1);
    expect(fs[0].detector).toBe('HOST_CLAIM_DRIFT');
    expect(fs[0].severity).toBe('warn');
    expect(fs[0].message).toContain('claude');
    expect(fs[0].message).toContain('verified');
    expect(fs[0].message).toContain('fail');
  });

  test('verified claim vs not-run evidence → NO findings (absence is neutral)', () => {
    writeReadme({claude: 'verified'});
    writeMatrix({claude: 'not-run'});
    expect(run()).toEqual([]);
  });

  test('wiring-only claim vs wiring-fail evidence → warn (Cursor over-claim case)', () => {
    writeReadme({cursor: 'wiring-only'});
    writeMatrix({cursor: 'wiring-fail'});
    const fs = run();
    expect(fs).toHaveLength(1);
    expect(fs[0].severity).toBe('warn');
    expect(fs[0].message).toContain('cursor');
  });

  test('wiring-only claim vs wiring-ok evidence → NO findings (claim matches evidence)', () => {
    writeReadme({cursor: 'wiring-only'});
    writeMatrix({cursor: 'wiring-ok'});
    expect(run()).toEqual([]);
  });

  test('verified claim vs verified evidence → NO findings (positive control)', () => {
    writeReadme({claude: 'verified'});
    writeMatrix({claude: 'verified'});
    expect(run()).toEqual([]);
  });

  test('README fence absent (matrix fence present) → NO findings', () => {
    writeReadme('This README makes no machine-readable host claims.');
    writeMatrix({claude: 'fail'});
    expect(run()).toEqual([]);
  });

  test('matrix.md file absent (README fence present) → NO findings (no-op by design)', () => {
    writeReadme({claude: 'verified'});
    writeMatrix(null);
    expect(run()).toEqual([]);
  });

  test('README file absent → NO findings', () => {
    writeReadme(null);
    writeMatrix({claude: 'fail'});
    expect(run()).toEqual([]);
  });

  test('malformed fence JSON → tolerant: no throw, no findings', () => {
    writeReadme('<!-- clad:host-claims {claude: verified, not-valid-json} -->');
    writeMatrix({claude: 'fail'});
    let fs: DriftFinding[] = [];
    expect(() => {
      fs = run();
    }).not.toThrow();
    expect(fs).toEqual([]);
  });

  test('a not-run README claim makes no positive assertion → skipped even against fail evidence', () => {
    writeReadme({codex: 'not-run'});
    writeMatrix({codex: 'fail'});
    expect(run()).toEqual([]);
  });

  test('multi-host: only the exceeding host warns; neutral + matching hosts are silent', () => {
    writeReadme({claude: 'verified', gemini: 'verified', cursor: 'wiring-only'});
    writeMatrix({claude: 'fail', gemini: 'not-run', cursor: 'wiring-ok'});
    const fs = run();
    expect(fs).toHaveLength(1);
    expect(fs[0].message).toContain('claude');
    expect(fs[0].message).not.toContain('gemini'); // not-run evidence → neutral
    expect(fs[0].message).not.toContain('cursor'); // wiring-only vs wiring-ok → matches
  });
});
