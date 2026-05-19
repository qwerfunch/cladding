// Cladding · unit tests for stages/detectors/hardcoded-secret.ts
//
// Detector under test delegates to the toolchain's secret scanner
// (secretlint for TS, gitleaks for Rust, etc.) and converts its exit
// signal into findings:
//   - no scanner registered    → info  (configuration gap)
//   - scanner exit 0           → silent
//   - scanner non-zero exit    → error (with truncated tool output)
//   - scanner binary absent    → info  (ENOENT)
//   - scanner throws otherwise → re-thrown (defensive — surfaces real bugs)
//
// Subprocess invocation is mocked with vi.mock('execa') so the suite
// stays deterministic, fast, and CI-friendly. Real-binary coverage of
// the subprocess paths lives in the conformance fixtures
// (stage_1.6.pass / stage_1.6.fail) under conformance/runner.ts.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {hardcodedSecret} = await import('../../stages/detectors/hardcoded-secret.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('HARDCODED_SECRET detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-secret-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('no toolchain gate → info finding (unknown language path)', () => {
    // Empty dir has no package.json / pyproject.toml / Cargo.toml etc.
    // → toolchain detects 'unknown' → no secret gate spec → info.
    const findings = hardcodedSecret.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('no secret scanner registered');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('scanner exits 0 → silent (clean tree)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(hardcodedSecret.run({cwd: dir})).toEqual([]);
    expect(execaSyncMock).toHaveBeenCalledOnce();
  });

  test('scanner non-zero exit → error finding (with tool output)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'secretlint: api_key found at config.ts:5',
    });
    const findings = hardcodedSecret.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('reported secrets');
    expect(findings[0].message).toContain('config.ts:5');
  });

  test('scanner ENOENT → info finding (binary not installed)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    const findings = hardcodedSecret.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('not installed');
  });

  test('scanner throws non-ENOENT → re-thrown (defensive)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => hardcodedSecret.run({cwd: dir})).toThrow('EACCES');
  });

  test('non-zero exit with only stdout (no stderr) → error using stdout', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: 'finding via stdout',
      stderr: '',
    });
    const findings = hardcodedSecret.run({cwd: dir});
    expect(findings[0].message).toContain('finding via stdout');
  });

  test('non-zero exit with no output → falls back to exit-code message', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 2, stdout: '', stderr: ''});
    const findings = hardcodedSecret.run({cwd: dir});
    expect(findings[0].message).toContain('exit 2');
  });
});
