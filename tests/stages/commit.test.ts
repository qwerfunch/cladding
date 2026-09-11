// Cladding · unit tests for stages/commit.ts (stage_1.4)
//
// Stage runner under test verifies the working tree + index are both
// clean via `git status --porcelain`. Language-agnostic — only git is
// needed. Branches:
//   - non-git dir (git exit != 0)              → pass=false, exitCode=2
//   - git binary absent (ENOENT)               → pass=false, exitCode=2
//   - git binary throws non-ENOENT             → re-thrown
//   - clean tree                                → pass=true
//   - dirty tree (porcelain output present)    → pass=false, exitCode=1, stderr lists changes
//
// execaSync is mocked with vi.mock('execa').

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/core/run-sync.js', () => ({
  runSync: vi.fn(),
}));

const {runCommit} = await import('../../src/stages/commit.js');
const runSyncMod = await import('../../src/core/run-sync.js');
const runSyncMock = runSyncMod.runSync as unknown as ReturnType<typeof vi.fn>;

describe('runCommit (stage_1.4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-commit-stage-'));
    runSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-059/AC-142] clean working tree is a pass observation', () => {
    runSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    const r = runCommit({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stage).toBe('stage_1.4');
  });

  test('[covers:F-059/AC-142] dirty working tree is a fail observation', () => {
    runSyncMock.mockReturnValueOnce({
      exitCode: 0,
      stdout: ' M src/foo.ts\n?? new-file.ts\n',
      stderr: '',
    });
    const r = runCommit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('working tree dirty');
    expect(r.stderr).toContain('src/foo.ts');
    expect(r.stderr).toContain('new-file.ts');
  });

  test('non-git directory (git exits non-zero) → exitCode=2 (skipped)', () => {
    runSyncMock.mockReturnValueOnce({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories)',
    });
    const r = runCommit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('not a git repository');
  });

  test('git non-zero exit with empty stderr → fallback message', () => {
    runSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: ''});
    const r = runCommit({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe('not a git repository');
  });

  test('[covers:F-059/AC-142] git ENOENT is an unobserved observation', () => {
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    runSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    const r = runCommit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('git binary not found');
  });

  test('git throws non-ENOENT → re-thrown', () => {
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    runSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => runCommit({cwd: dir})).toThrow('EACCES');
  });
});
