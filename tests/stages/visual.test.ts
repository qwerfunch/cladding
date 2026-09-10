// Cladding · unit tests for stages/visual.ts (stage_3.3)
//
// Visual-regression stage. Identical branch tree to stages/perf.ts and
// stages/smoke.ts: npm-script pre-check + execa subprocess + ENOENT
// skip + non-ENOENT throw. Project-owned: defaults to `npm run visual`.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runVisual} = await import('../../src/stages/visual.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runVisual (stage_3.3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-visual-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-061/AC-149] visual descriptor fallback reports an unavailable runner', () => {
    const r = runVisual({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_3.3');
    expect(r.stderr).toContain('no visual runner registered');
  });

  test('npm script missing → skipped before spawning', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name: 'x'}));
    const r = runVisual({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('visual npm script not defined');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('[covers:F-061/AC-149] visual descriptor reports a successful runner outcome', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {visual: 'echo ok'}}),
    );
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runVisual({cwd: dir}).pass).toBe(true);
  });

  test('npm script defined + non-zero → pass=false with stderr', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {visual: 'false'}}),
    );
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '3 snapshots diverged',
    });
    const r = runVisual({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('snapshots diverged');
  });

  test('execa ENOENT → exitCode=2', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {visual: 'echo'}}),
    );
    // execaSync(reject:false) does NOT throw on a missing binary — it RETURNS
    // {exitCode: undefined, failed: true, code: 'ENOENT'} (verified empirically).
    execaSyncMock.mockReturnValueOnce({exitCode: undefined, failed: true, code: 'ENOENT', stdout: '', stderr: ''});
    const r = runVisual({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not installed');
  });

  test('execa non-ENOENT throw → re-thrown', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {visual: 'echo'}}),
    );
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => runVisual({cwd: dir})).toThrow('EACCES');
  });

  test('null exit defaults to 1', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({name: 'x', scripts: {visual: 'echo'}}),
    );
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: ''});
    expect(runVisual({cwd: dir}).exitCode).toBe(1);
  });

  test('[covers:F-061/AC-149] visual descriptor override bypasses fallback selection', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runVisual({cwd: dir, cmd: 'myvisual', args: ['compare']});
    expect(execaSyncMock).toHaveBeenCalledWith('myvisual', ['compare'], expect.any(Object));
  });
});
