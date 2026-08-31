// Cladding · unit tests for stages/detector-result-cache.ts (F-e53596dd)
//
// WHY. madge (ARCHITECTURE_VIOLATION) and secretlint (HARDCODED_SECRET) already
// run inside the drift stage. The pre-commit tier and every Stop-hook turn then
// re-invoke stage_1.5 + stage_1.6 standalone, spawning both tools a SECOND time
// — a measured ≈5.0s of pure duplication per gate run. This cache lets the drift
// stage publish its arch/secret findings into a session so the standalone stages
// fold the same result instead of re-spawning.
//
// The cache MUST be miss-transparent: the conformance fixtures (stage_1.5.pass/
// fail, stage_1.6.pass/fail) pin the standalone stages' independent behavior, so
// on any miss — no session, wrong cwd, name never stored, session cleared — the
// stage has to spawn EXACTLY as it does today. These tests pin both the hit
// (no spawn, folded finding) and every miss (spawn) branch, plus the cross-run
// no-leak guard (long-lived Stop-hook process) via afterEach clear discipline.
//
// Authored from the contract only (anti-self-cert): the impl body is not read —
// subprocess invocation is mocked with vi.mock('execa') and asserted by call
// count, mirroring architecture-violation.test.ts / hardcoded-secret.test.ts.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import type {DriftFinding} from '../../src/stages/types.js';

vi.mock('execa', () => ({execaSync: vi.fn(), execa: vi.fn()}));

const {
  primeDetectorResultCache,
  clearDetectorResultCache,
  storeDetectorResult,
  readDetectorResult,
} = await import('../../src/stages/detector-result-cache.js');
const {runArch} = await import('../../src/stages/arch.js');
const {runSecret} = await import('../../src/stages/secret.js');
const {runDrift} = await import('../../src/stages/drift.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

/** Clean subprocess result — arch/secret detectors read this as "no findings". */
const CLEAN = {exitCode: 0, stdout: '', stderr: ''};

const ARCH_ERR: DriftFinding = {
  detector: 'ARCHITECTURE_VIOLATION',
  severity: 'error',
  message: 'circular dependency a -> b -> a',
};
const SECRET_ERR: DriftFinding = {
  detector: 'HARDCODED_SECRET',
  severity: 'error',
  message: 'secretlint reported: api_key at config.ts:5',
};

/**
 * A temp dir that reads as a TypeScript project (package.json present) so the
 * madge + secretlint gates register — i.e. the detector WOULD spawn on a miss.
 * An empty dir yields "unknown" toolchain → no gate → never spawns, which would
 * make the "spawns on miss" assertions vacuous.
 */
function tsProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
  return dir;
}

// Global discipline: reset the spawn spy before each test, and — the load-bearing
// no-leak guard — close any open session after each test so nothing survives into
// the next (the harness runs these gates inside one long-lived Stop-hook process).
beforeEach(() => execaSyncMock.mockReset());
afterEach(() => clearDetectorResultCache());

// ─── the cache primitives, in isolation ───

describe('detector-result cache primitives (session-scoped, cwd-guarded)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-drc-prim-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('read returns null when no session has been primed', () => {
    expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toBeNull();
  });

  test('prime → store → read returns the stored findings (a hit)', () => {
    primeDetectorResultCache(dir);
    storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]);
    expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toEqual([ARCH_ERR]);
  });

  test('stored-empty is a real HIT, distinct from a miss (null vs [])', () => {
    // The whole miss-transparency contract hinges on this: a detector that ran
    // clean stores [] and must read back as [] (fold → pass, no re-spawn); a name
    // that was never stored reads as null (miss → re-spawn). They cannot collapse.
    primeDetectorResultCache(dir);
    storeDetectorResult('HARDCODED_SECRET', dir, []);
    expect(readDetectorResult('HARDCODED_SECRET', dir)).toEqual([]); // clean = hit
    expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toBeNull(); // absent = miss
  });

  test('a primed session with nothing stored for the name reads as a miss', () => {
    primeDetectorResultCache(dir);
    expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toBeNull();
  });

  test('read under a cwd other than the session cwd is a miss', () => {
    const other = mkdtempSync(join(tmpdir(), 'clad-drc-read-mm-'));
    try {
      primeDetectorResultCache(dir);
      storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]);
      expect(readDetectorResult('ARCHITECTURE_VIOLATION', other)).toBeNull();
    } finally {
      rmSync(other, {recursive: true, force: true});
    }
  });

  test('store is dropped when no session is active', () => {
    storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]); // no session → no-op
    primeDetectorResultCache(dir);
    expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toBeNull();
  });

  test('store is dropped when its cwd does not match the session cwd', () => {
    const other = mkdtempSync(join(tmpdir(), 'clad-drc-store-mm-'));
    try {
      primeDetectorResultCache(dir);
      storeDetectorResult('ARCHITECTURE_VIOLATION', other, [ARCH_ERR]); // cwd mismatch → no-op
      expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toBeNull();
    } finally {
      rmSync(other, {recursive: true, force: true});
    }
  });

  test('[covers:F-e53596dd/AC-f48f9b90] clear closes the session — later reads miss (no cross-run leakage)', () => {
    primeDetectorResultCache(dir);
    storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]);
    clearDetectorResultCache();
    expect(readDetectorResult('ARCHITECTURE_VIOLATION', dir)).toBeNull();
  });
});

// ─── runArch / runSecret consumption of a primed hit ───

describe('runArch / runSecret consume a cache hit without spawning', () => {
  let dir: string;
  beforeEach(() => {
    dir = tsProject('clad-drc-arch-');
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-e53596dd/AC-9bb78051] (1) no session → runArch spawns (unchanged default path)', () => {
    execaSyncMock.mockReturnValue(CLEAN);
    const r = runArch({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalled();
    expect(r.pass).toBe(true);
    expect(r.stage).toBe('stage_1.5');
  });

  test('(2a) primed + stored ARCHITECTURE_VIOLATION error → runArch folds it, no spawn', () => {
    primeDetectorResultCache(dir);
    storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]);
    const r = runArch({cwd: dir});
    expect(execaSyncMock).not.toHaveBeenCalled(); // served from cache, madge not run
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('circular dependency a -> b -> a');
    expect(r.stage).toBe('stage_1.5');
  });

  test('(2b) primed + stored HARDCODED_SECRET error → runSecret folds it, no spawn', () => {
    primeDetectorResultCache(dir);
    storeDetectorResult('HARDCODED_SECRET', dir, [SECRET_ERR]);
    const r = runSecret({cwd: dir});
    expect(execaSyncMock).not.toHaveBeenCalled(); // secretlint not run
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('api_key');
    expect(r.stage).toBe('stage_1.6');
  });

  test('(2c) primed + stored CLEAN findings ([]) → runSecret passes, no spawn', () => {
    primeDetectorResultCache(dir);
    storeDetectorResult('HARDCODED_SECRET', dir, []); // a clean hit, not a miss
    const r = runSecret({cwd: dir});
    expect(execaSyncMock).not.toHaveBeenCalled();
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('(3) primed but nothing stored (miss) → runArch spawns', () => {
    primeDetectorResultCache(dir);
    execaSyncMock.mockReturnValue(CLEAN);
    const r = runArch({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalled();
    expect(r.pass).toBe(true);
  });

  test('(4) primed under cwd A, runArch called under cwd B → spawns (cwd-mismatch miss, no bleed)', () => {
    const dirB = tsProject('clad-drc-archB-');
    try {
      primeDetectorResultCache(dir);
      storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]); // error stored for A only
      execaSyncMock.mockReturnValue(CLEAN);
      const r = runArch({cwd: dirB});
      expect(execaSyncMock).toHaveBeenCalled(); // A's cache must not answer a B run
      expect(r.pass).toBe(true); // reflects the clean spawn, NOT A's stored error
    } finally {
      rmSync(dirB, {recursive: true, force: true});
    }
  });

  test('(5) after clearDetectorResultCache() → runArch spawns again (long-lived-process guard)', () => {
    primeDetectorResultCache(dir);
    storeDetectorResult('ARCHITECTURE_VIOLATION', dir, [ARCH_ERR]);
    clearDetectorResultCache();
    execaSyncMock.mockReturnValue(CLEAN);
    const r = runArch({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalled(); // session gone → miss → spawn
    expect(r.pass).toBe(true); // the stored error must not survive the clear
  });
});

// ─── (6) the real seam: runDrift primes, the standalone stages consume ───

describe('real seam: runDrift stores arch+secret findings; stages fold them without re-spawning', () => {
  let dir: string;
  beforeEach(() => {
    // A TS project with a valid spec so the full default detector registry runs
    // cleanly (mirrors the drift-scale fixture idiom) AND the madge/secretlint
    // gates register (package.json) so the arch/secret detectors actually spawn.
    dir = tsProject('clad-drc-seam-');
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src', 'core'), {recursive: true});
    writeFileSync(join(dir, 'src', 'core', 'm.ts'), 'export const ok = 1;\n');
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: seam, language: typescript}\nfeatures: []\n',
    );
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-e53596dd/AC-f4163677] drift publishes arch+secret findings; runArch/runSecret consume them, no new spawn', () => {
    // Non-zero exit → both the arch and secret detectors emit a deterministic
    // error finding during the drift pass.
    execaSyncMock.mockReturnValue({
      exitCode: 1,
      stdout: 'circular a -> b -> a ; api_key found at config.ts:5',
      stderr: '',
    });

    primeDetectorResultCache(dir);
    const report = runDrift({cwd: dir});
    const spawnsAfterDrift = execaSyncMock.mock.calls.length;
    // Only the arch + secret detectors shell out, so drift spawned at least twice.
    expect(spawnsAfterDrift).toBeGreaterThanOrEqual(2);

    // Exactly what the drift stage surfaced for each detector, folded the way the
    // standalone stages fold (error messages joined by newline).
    const driftArchStderr = report.findings
      .filter((f) => f.detector === 'ARCHITECTURE_VIOLATION' && f.severity === 'error')
      .map((f) => f.message)
      .join('\n');
    const driftSecretStderr = report.findings
      .filter((f) => f.detector === 'HARDCODED_SECRET' && f.severity === 'error')
      .map((f) => f.message)
      .join('\n');
    expect(driftArchStderr).not.toBe(''); // drift genuinely surfaced the violation
    expect(driftSecretStderr).not.toBe(''); // and the secret

    const arch = runArch({cwd: dir});
    const secret = runSecret({cwd: dir});

    // Miss-transparent hit: served entirely from the session runDrift primed —
    // the spawn count did not grow.
    expect(execaSyncMock.mock.calls.length).toBe(spawnsAfterDrift);
    // …and the folded StageResults equal the drift findings.
    expect(arch.pass).toBe(false);
    expect(arch.stderr).toBe(driftArchStderr);
    expect(secret.pass).toBe(false);
    expect(secret.stderr).toBe(driftSecretStderr);
  });
});
