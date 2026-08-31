// Cladding · unit tests for core/git-ops.ts (the in-progress git-operation probe)
//
// Authored from the F-10cc42d1 shard contract ONLY (anti-self-cert: the test
// author did not read the probe's implementation body). The behavioral
// contract under test is AC-249b0837 + the marker table named in the ACs:
//
//   - the probe resolves the git dir via `git rev-parse` (worktree layouts
//     included) and returns false/null in a non-git directory or on any probe
//     error, so the write guard can never break normal operation;
//   - a settled tree (no state markers) reads as "no operation";
//   - MERGE_HEAD ⇒ merge, CHERRY_PICK_HEAD ⇒ cherry-pick, and either
//     rebase-merge/ or rebase-apply/ ⇒ rebase, all keyed off the RESOLVED git
//     dir (not a naive `<cwd>/.git`), which is what makes linked worktrees work.
//
// Markers are hand-seeded under the resolved git dir in a git-init'd tmpdir —
// deterministic + fast, no real merge/rebase needed.

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {gitOperationInProgress, gitOperationInProgressName} from '../../src/core/git-ops.js';

/** `git rev-parse --git-dir` resolved to an absolute path, mirroring the probe. */
function resolvedGitDir(cwd: string): string {
  const out = execFileSync('git', ['rev-parse', '--git-dir'], {cwd, encoding: 'utf8'}).trim();
  return resolve(cwd, out);
}

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], {cwd: dir});
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {cwd: dir});
  execFileSync('git', ['config', 'user.name', 'test'], {cwd: dir});
}

describe('core/git-ops — gitOperationInProgress(Name)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-gitops-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  // ── AC-249b0837 — non-git dir + probe-error degrade to "no operation" ──

  test('a non-git directory returns false / null (probe never breaks normal operation)', () => {
    // No `git init` here → `git rev-parse --git-dir` fails → the probe swallows
    // the error and reports a settled tree, so the guard can never block work.
    expect(gitOperationInProgress(dir)).toBe(false);
    expect(gitOperationInProgressName(dir)).toBeNull();
  });

  test('a fresh git repo with no operation in flight returns false / null', () => {
    initRepo(dir);
    expect(gitOperationInProgress(dir)).toBe(false);
    expect(gitOperationInProgressName(dir)).toBeNull();
  });

  // ── the marker table named in the AC conditions ──

  test('MERGE_HEAD under the git dir ⇒ merge', () => {
    initRepo(dir);
    writeFileSync(join(resolvedGitDir(dir), 'MERGE_HEAD'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    expect(gitOperationInProgressName(dir)).toBe('merge');
    expect(gitOperationInProgress(dir)).toBe(true);
  });

  test('CHERRY_PICK_HEAD under the git dir ⇒ cherry-pick', () => {
    initRepo(dir);
    writeFileSync(join(resolvedGitDir(dir), 'CHERRY_PICK_HEAD'), 'cafebabecafebabecafebabecafebabecafebabe\n');
    expect(gitOperationInProgressName(dir)).toBe('cherry-pick');
    expect(gitOperationInProgress(dir)).toBe(true);
  });

  test('a rebase-apply/ state dir under the git dir ⇒ rebase (am-based rebase)', () => {
    initRepo(dir);
    mkdirSync(join(resolvedGitDir(dir), 'rebase-apply'), {recursive: true});
    expect(gitOperationInProgressName(dir)).toBe('rebase');
    expect(gitOperationInProgress(dir)).toBe(true);
  });

  test('a rebase-merge/ state dir under the git dir ⇒ rebase (interactive/merge rebase)', () => {
    initRepo(dir);
    mkdirSync(join(resolvedGitDir(dir), 'rebase-merge'), {recursive: true});
    expect(gitOperationInProgressName(dir)).toBe('rebase');
    expect(gitOperationInProgress(dir)).toBe(true);
  });

  test('clearing the marker returns the tree to "no operation"', () => {
    initRepo(dir);
    const gitDir = resolvedGitDir(dir);
    writeFileSync(join(gitDir, 'MERGE_HEAD'), 'x\n');
    expect(gitOperationInProgressName(dir)).toBe('merge');
    rmSync(join(gitDir, 'MERGE_HEAD'));
    expect(gitOperationInProgressName(dir)).toBeNull();
    expect(gitOperationInProgress(dir)).toBe(false);
  });

  // ── AC-249b0837 — worktree layouts: the per-worktree git dir, resolved via
  // rev-parse, is a `.git/worktrees/<name>` sub-path, NOT `<cwd>/.git` (which is
  // a gitlink FILE in a linked worktree). Seeding the merge marker in the
  // resolved dir must still register. Guarded so a git build without worktree
  // support cannot fail the suite (AC allows skipping this proof if flaky).
  test('a linked worktree resolves its own git dir (worktree layout)', () => {
    initRepo(dir);
    writeFileSync(join(dir, 'seed.txt'), 'x\n');
    execFileSync('git', ['add', '.'], {cwd: dir});
    execFileSync('git', ['commit', '-q', '-m', 'seed'], {cwd: dir});
    const wt = join(dir, '..', `${dir.split('/').pop()}-wt`);
    let worktreeReady = false;
    try {
      execFileSync('git', ['worktree', 'add', '-q', wt, '-b', 'feat'], {cwd: dir, stdio: ['ignore', 'ignore', 'ignore']});
      worktreeReady = true;
    } catch {
      // git too old / worktree unsupported — the non-worktree cases already
      // cover the rev-parse resolution contract; skip this proof.
    }
    if (!worktreeReady) return;
    try {
      // A fresh worktree is settled.
      expect(gitOperationInProgressName(wt)).toBeNull();
      // The per-worktree git dir is NOT wt/.git (a gitlink file) — the probe
      // must resolve it via rev-parse for the marker to be seen.
      const wtGitDir = resolvedGitDir(wt);
      expect(wtGitDir).not.toBe(join(wt, '.git'));
      writeFileSync(join(wtGitDir, 'MERGE_HEAD'), 'abc\n');
      expect(gitOperationInProgressName(wt)).toBe('merge');
      expect(gitOperationInProgress(wt)).toBe(true);
    } finally {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', wt], {cwd: dir, stdio: ['ignore', 'ignore', 'ignore']});
      } catch {
        rmSync(wt, {recursive: true, force: true});
      }
    }
  });

  test('[covers:F-10cc42d1/AC-249b0837] rev-parse protects non-git probes and resolves a linked worktree marker', () => {
    // A failed rev-parse must degrade to a settled tree rather than make the
    // guard throw or block normal work.
    expect(gitOperationInProgress(dir)).toBe(false);
    expect(gitOperationInProgressName(dir)).toBeNull();

    initRepo(dir);
    writeFileSync(join(dir, 'seed.txt'), 'x\n');
    execFileSync('git', ['add', '.'], {cwd: dir});
    execFileSync('git', ['commit', '-q', '-m', 'seed'], {cwd: dir});
    const worktree = join(dir, '..', `${dir.split('/').pop()}-proof-worktree`);
    try {
      execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'proof-worktree'], {cwd: dir});
      const worktreeGitDir = resolvedGitDir(worktree);
      // A linked checkout exposes .git as a gitlink file, so only rev-parse
      // identifies the directory where operation markers actually live.
      expect(worktreeGitDir).not.toBe(join(worktree, '.git'));
      writeFileSync(join(worktreeGitDir, 'MERGE_HEAD'), 'abc\n');
      expect(gitOperationInProgressName(worktree)).toBe('merge');
      expect(gitOperationInProgress(worktree)).toBe(true);
    } finally {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktree], {cwd: dir});
      } catch {
        rmSync(worktree, {recursive: true, force: true});
      }
    }
  });
});
