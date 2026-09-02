// Cladding · runDrift interactive profile — in-process-only selection (F-6ed216f3)
//
// stage_1.3's interactive profile (PostToolUse) must run ONLY in-process
// detectors and record the excluded subprocess-flagged detectors on the report,
// so the caller can render what was deferred instead of silently losing
// coverage (AC-870a2ed8). It must NEVER execute a subprocess-flagged detector —
// no child process spawned (AC-7ecad295).
//
// Two proof surfaces are used:
//   - FIXTURE detectors (pure, with a run-spy) isolate the FILTER mechanic from
//     toolchain detection and prove non-execution deterministically.
//   - the REAL adapter detectors (architecture-violation via madge, hardcoded-
//     secret via secretlint) bind the assertions to the shipping partition and,
//     with execa mocked, prove the actual spawn primitive is never reached.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import type {DriftDetector, DriftFinding} from '../../src/stages/types.js';

vi.mock('execa', () => ({execaSync: vi.fn()}));

const {clearDetectors, registerDetector, runDrift} = await import('../../src/stages/drift.js');
const {allDetectors} = await import('../../src/stages/detectors/index.js');
const {architectureViolation} = await import('../../src/stages/detectors/architecture-violation.js');
const {hardcodedSecret} = await import('../../src/stages/detectors/hardcoded-secret.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

/** A pure in-process detector emitting one warn finding when it runs. */
function inproc(name: string): DriftDetector {
  return {name, run: () => [{detector: name, severity: 'warn' as const, message: `${name} ran`}]};
}

/** A subprocess-flagged detector whose run() is spied — so we can prove the
 *  interactive filter prevents it from being invoked (i.e. from spawning). */
function spawner(name: string): {detector: DriftDetector; spy: ReturnType<typeof vi.fn>} {
  const spy = vi.fn(
    (): readonly DriftFinding[] => [{detector: name, severity: 'error' as const, message: `${name} would spawn`}],
  );
  return {detector: {name, subprocess: true, run: spy}, spy};
}

const detectorsOf = (findings: readonly DriftFinding[]): Set<string> => new Set(findings.map((f) => f.detector));

describe('runDrift interactive profile — in-process only + skip list (AC-870a2ed8)', () => {
  beforeEach(() => {
    clearDetectors();
    execaSyncMock.mockReset();
  });
  afterEach(() => clearDetectors());

  test('[covers:F-6ed216f3/AC-870a2ed8] interactive: only in-process detectors run; subprocess detectors are listed as skipped, their findings dropped', () => {
    const a = spawner('SPAWN_A');
    const b = spawner('SPAWN_B');
    registerDetector(inproc('INPROC_1'));
    registerDetector(a.detector);
    registerDetector(inproc('INPROC_2'));
    registerDetector(b.detector);

    const report = runDrift({profile: 'interactive'});

    // (a) the skip list is EXACTLY the subprocess-flagged detectors.
    expect([...report.skippedDetectors].sort()).toEqual(['SPAWN_A', 'SPAWN_B']);
    // (b) no finding originates from a skipped detector; in-process ones DID contribute.
    const seen = detectorsOf(report.findings);
    expect(seen.has('SPAWN_A')).toBe(false);
    expect(seen.has('SPAWN_B')).toBe(false);
    expect(seen.has('INPROC_1')).toBe(true);
    expect(seen.has('INPROC_2')).toBe(true);
    // corollary: the subprocess detectors' run() was never even invoked.
    expect(a.spy).not.toHaveBeenCalled();
    expect(b.spy).not.toHaveBeenCalled();
  });

  test('[covers:F-6ed216f3/AC-870a2ed8] full (default) profile: nothing skipped; subprocess detectors run and contribute findings', () => {
    const a = spawner('SPAWN_A');
    registerDetector(inproc('INPROC_1'));
    registerDetector(a.detector);

    const full = runDrift({});
    expect(full.skippedDetectors).toEqual([]);
    expect(a.spy).toHaveBeenCalledTimes(1);
    expect(detectorsOf(full.findings).has('SPAWN_A')).toBe(true);

    // an explicit profile:'full' behaves identically to the default.
    a.spy.mockClear();
    const explicit = runDrift({profile: 'full'});
    expect(explicit.skippedDetectors).toEqual([]);
    expect(a.spy).toHaveBeenCalledTimes(1);
  });

  test('[covers:F-6ed216f3/AC-870a2ed8] the real registry subprocess partition = the two adapters, surfaced (not silently dropped) on skippedDetectors', () => {
    // Discovered from the shipping registry — never hardcoded, so this stays
    // correct as the subprocess partition changes.
    const discovered = allDetectors.filter((d) => d.subprocess).map((d) => d.name);
    clearDetectors();
    registerDetector(inproc('INPROC_ONLY'));
    registerDetector(architectureViolation);
    registerDetector(hardcodedSecret);

    const report = runDrift({profile: 'interactive'});

    expect([...report.skippedDetectors].sort()).toEqual([...discovered].sort());
    expect([...report.skippedDetectors].sort()).toEqual(['ARCHITECTURE_VIOLATION', 'HARDCODED_SECRET']);
    const seen = detectorsOf(report.findings);
    expect(seen.has('ARCHITECTURE_VIOLATION')).toBe(false);
    expect(seen.has('HARDCODED_SECRET')).toBe(false);
    // interactive never crossed the subprocess boundary for the real detectors.
    expect(execaSyncMock).not.toHaveBeenCalled();
  });
});

describe('runDrift never executes a subprocess-flagged detector under interactive (AC-7ecad295)', () => {
  beforeEach(() => {
    clearDetectors();
    execaSyncMock.mockReset();
  });
  afterEach(() => clearDetectors());

  test('[covers:F-6ed216f3/AC-7ecad295] a subprocess detector run() executes under full but NEVER under interactive (fixture spy proves non-execution)', () => {
    const s = spawner('WOULD_SPAWN');
    registerDetector(inproc('PURE'));
    registerDetector(s.detector);

    // full: the spawner runs (this is where a real child process would spawn).
    const full = runDrift({profile: 'full'});
    expect(s.spy).toHaveBeenCalledTimes(1);
    expect(detectorsOf(full.findings).has('WOULD_SPAWN')).toBe(true);

    // interactive: the SAME registry — the FILTER, not the fixture, suppresses execution.
    s.spy.mockClear();
    const inter = runDrift({profile: 'interactive'});
    expect(s.spy).not.toHaveBeenCalled();
    expect(detectorsOf(inter.findings).has('WOULD_SPAWN')).toBe(false);
    expect(inter.skippedDetectors).toContain('WOULD_SPAWN');
  });

  test('[covers:F-6ed216f3/AC-7ecad295] the real madge/secretlint detectors cross no execa boundary under interactive; they would under full (execa spy)', () => {
    // The strongest form: bind to the real detectors AND the actual spawn
    // primitive. A typescript fixture makes detectToolchain register the arch +
    // secret gates, so under FULL the detectors reach execaSync (mocked — no real
    // child process). Under INTERACTIVE the filter excludes them before run(), so
    // execaSync is never reached — non-execution, not merely absence of findings.
    execaSyncMock.mockReturnValue({exitCode: 0, stdout: '', stderr: ''});
    const dir = mkdtempSync(join(tmpdir(), 'clad-interactive-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
      clearDetectors();
      registerDetector(architectureViolation);
      registerDetector(hardcodedSecret);

      // full → both detectors run → the subprocess primitive is invoked.
      runDrift({profile: 'full', cwd: dir});
      expect(execaSyncMock).toHaveBeenCalled();

      // interactive → excluded before run → the subprocess primitive is never touched.
      execaSyncMock.mockClear();
      const report = runDrift({profile: 'interactive', cwd: dir});
      expect(execaSyncMock).not.toHaveBeenCalled();
      expect([...report.skippedDetectors].sort()).toEqual(['ARCHITECTURE_VIOLATION', 'HARDCODED_SECRET']);
    } finally {
      clearDetectors();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
