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

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runCommit} = await import('../../stages/commit.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runCommit (stage_1.4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-commit-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('clean working tree → pass=true', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    const r = runCommit({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stage).toBe('stage_1.4');
  });

  test('dirty working tree → pass=false, exitCode=1, stderr enumerates changes', () => {
    execaSyncMock.mockReturnValueOnce({
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
    execaSyncMock.mockReturnValueOnce({
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
    execaSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: ''});
    const r = runCommit({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe('not a git repository');
  });

  test('git binary absent (ENOENT) → exitCode=2 (skipped)', () => {
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    execaSyncMock.mockImplementationOnce(() => {
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
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => runCommit({cwd: dir})).toThrow('EACCES');
  });
});
