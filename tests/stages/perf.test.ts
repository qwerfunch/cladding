// Cladding · unit tests for stages/perf.ts (stage_3.2)
//
// Performance-budget stage. Identical branch tree to stages/smoke.ts:
// npm-script pre-check + execa subprocess + ENOENT skip + non-ENOENT
// throw. Project-owned: defaults to `npm run perf`.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runPerf} = await import('../../src/stages/perf.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runPerf (stage_3.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-perf-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-061/AC-149] performance descriptor fallback reports an unavailable runner', () => {
    const r = runPerf({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_3.2');
    expect(r.stderr).toContain('no perf runner registered');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('npm script missing from package.json → skipped (exitCode=2)', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'x'}));
    const r = runPerf({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('perf npm script not defined');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('[covers:F-061/AC-149] performance descriptor reports a successful runner outcome', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {perf: 'echo ok'}}),
    );
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runPerf({cwd: dir}).pass).toBe(true);
  });

  test('npm script defined + non-zero → pass=false with stderr', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {perf: 'false'}}),
    );
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'regression: p95 +20%',
    });
    const r = runPerf({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('regression');
  });

  test('execa ENOENT → exitCode=2 (binary not installed)', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {perf: 'echo'}}),
    );
    // execaSync(reject:false) does NOT throw on a missing binary — it RETURNS
    // {exitCode: undefined, failed: true, code: 'ENOENT'} (verified empirically).
    execaSyncMock.mockReturnValueOnce({exitCode: undefined, failed: true, code: 'ENOENT', stdout: '', stderr: ''});
    const r = runPerf({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not installed');
  });

  test('execa throws non-ENOENT → re-thrown', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {perf: 'echo'}}),
    );
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => runPerf({cwd: dir})).toThrow('EACCES');
  });

  test('null exit defaults to 1', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {perf: 'echo'}}),
    );
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: ''});
    expect(runPerf({cwd: dir}).exitCode).toBe(1);
  });

  test('[covers:F-061/AC-149] performance descriptor override bypasses fallback selection', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runPerf({cwd: dir, cmd: 'myperf', args: ['run']});
    expect(execaSyncMock).toHaveBeenCalledWith('myperf', ['run'], expect.any(Object));
  });
});
