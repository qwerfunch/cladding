// Cladding · unit tests for stages/smoke.ts (stage_3.1)
//
// Smoke / e2e stage delegating to `npm run smoke` (or a toolchain
// equivalent). Richer branch tree than the type/lint stages because
// it pre-checks `package.json` for the named npm script — distinguishes
// "you haven't written one" (exitCode 2, skipped) from "the script
// exists but failed" (exitCode 1, failed).
//
// Branches:
//   - no toolchain gate (unknown language)        → exitCode=2
//   - npm cmd + script missing in package.json   → exitCode=2
//   - npm cmd + script present + execa exits 0   → pass=true
//   - npm cmd + script present + execa non-zero  → pass=false, stderr
//   - execa ENOENT                                → exitCode=2 with 'not installed'
//   - execa throws non-ENOENT                     → re-thrown
//   - null exit defaults to 1

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runSmoke} = await import('../../src/stages/smoke.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runSmoke (stage_3.1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-smoke-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('unknown language + no override → skipped (exitCode=2)', () => {
    const r = runSmoke({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_3.1');
    expect(r.stderr).toContain('no smoke runner registered');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('npm script missing from package.json → skipped before spawning', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'x'}));
    const r = runSmoke({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('npm script not defined');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('npm script defined + exits 0 → pass=true', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {smoke: 'echo ok'}}),
    );
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runSmoke({cwd: dir}).pass).toBe(true);
  });

  test('npm script defined + non-zero exit → pass=false with stderr', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {smoke: 'false'}}),
    );
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'smoke command failed',
    });
    const r = runSmoke({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('smoke command failed');
  });

  test('execa ENOENT → exitCode=2 (binary not installed)', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {smoke: 'echo ok'}}),
    );
    // execaSync(reject:false) does NOT throw on a missing binary — it RETURNS
    // {exitCode: undefined, failed: true, code: 'ENOENT'} (verified empirically).
    execaSyncMock.mockReturnValueOnce({exitCode: undefined, failed: true, code: 'ENOENT', stdout: '', stderr: ''});
    const r = runSmoke({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not installed');
  });

  test('execa throws non-ENOENT → re-thrown', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {smoke: 'echo ok'}}),
    );
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => runSmoke({cwd: dir})).toThrow('EACCES');
  });

  test('null exit defaults to 1', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {smoke: 'echo ok'}}),
    );
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: 'killed'});
    expect(runSmoke({cwd: dir}).exitCode).toBe(1);
  });

  test('explicit cmd override (non-npm) bypasses script lookup', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runSmoke({cwd: dir, cmd: 'mysmoke', args: ['run']});
    expect(execaSyncMock).toHaveBeenCalledWith('mysmoke', ['run'], expect.any(Object));
  });
});
