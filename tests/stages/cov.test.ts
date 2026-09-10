// Cladding · unit tests for stages/cov.ts (stage_2.2)
//
// Polyglot coverage stage. Mirrors stages/unit.ts: delegates to
// toolchain.gates.coverage. Threshold enforcement is project-owned;
// cladding only relays the runner's exit signal.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {clearTestRunCache, getOrRunSharedCoverage, primeTestRunCache} from '../../src/stages/test-run-cache.js';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runCov} = await import('../../src/stages/cov.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runCov (stage_2.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-cov-stage-'));
    clearTestRunCache();
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    clearTestRunCache();
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-060/AC-146] coverage runner preserves successful, failed, unavailable, and overridden execution outcomes', () => {
    const opts = {cwd: dir, cmd: 'coverage-runner', args: ['--focused']};
    execaSyncMock
      .mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''})
      .mockReturnValueOnce({exitCode: 9, stdout: '', stderr: 'coverage failure'})
      .mockReturnValueOnce({exitCode: null, stdout: '', stderr: ''})
      .mockReturnValueOnce({code: 'ENOENT', exitCode: undefined, stdout: '', stderr: ''});

    expect(runCov(opts)).toMatchObject({pass: true, exitCode: 0});
    expect(runCov(opts)).toMatchObject({pass: false, exitCode: 1, stderr: 'coverage failure'});
    expect(runCov(opts)).toMatchObject({pass: false, exitCode: 1});
    const unavailable = runCov(opts);
    expect(unavailable).toMatchObject({pass: false, exitCode: 2, skipReason: 'tool-missing'});
    expect(unavailable).not.toHaveProperty('disposition');
    expect(execaSyncMock).toHaveBeenCalledWith('coverage-runner', ['--focused'], expect.any(Object));
  });

  test('[covers:F-060/AC-146] coverage folds the current shared invocation instead of starting another runner', () => {
    primeTestRunCache(dir);
    const shared = getOrRunSharedCoverage(dir, () => ({exitCode: 0, stdout: '', stderr: ''}));

    const result = runCov({cwd: dir, cmd: 'coverage-runner', args: ['--focused']});

    expect(shared).not.toBeNull();
    expect(result).toMatchObject({pass: true, exitCode: 0});
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('unknown language + no override → skipped (exitCode=2)', () => {
    const r = runCov({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_2.2');
    expect(r.stderr).toContain('no coverage runner registered');
  });

  test('package.json present + runner exits 0 → pass=true', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runCov({cwd: dir}).pass).toBe(true);
  });

  test('runner non-zero + stderr → pass=false with stderr', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'coverage below threshold',
    });
    const r = runCov({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('coverage below threshold');
  });

  test('runner non-zero + no stderr → no stderr field', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: ''});
    expect(runCov({cwd: dir}).stderr).toBeUndefined();
  });

  test('explicit override bypasses toolchain', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runCov({cwd: dir, cmd: 'mycov', args: ['--report']});
    expect(execaSyncMock).toHaveBeenCalledWith('mycov', ['--report'], expect.any(Object));
  });

  test('null exit defaults to 1', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: ''});
    expect(runCov({cwd: dir}).exitCode).toBe(1);
  });
});
