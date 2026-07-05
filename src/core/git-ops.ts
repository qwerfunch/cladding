// Cladding · core · in-progress git-operation probe
//
// A gate or sync run mid-merge computes module hashes + inventory from a
// partially merged working tree; stamping attestation or rewriting derived
// files then folds that half-state into the merge commit. This probe lets every
// derived-file writer become a no-op while a git merge / rebase / cherry-pick is
// in flight, so a half-merged tree is never stamped as verified or edited out
// from under an in-progress operation.
//
// Deterministic + synchronous by contract (Iron Law): filesystem checks under
// the resolved git dir only, no LLM, and NEVER throws. Any probe error (git
// absent, non-git dir, unreadable git dir) resolves to "no operation" so the
// guard can never break normal operation.

import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';

/** The in-progress git operation a marker under the git dir denotes. */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick';

/**
 * Resolves the git dir for `cwd` via `git rev-parse --git-dir` — which yields
 * the real per-worktree git dir for linked worktrees, not the `.git` pointer
 * file — resolved against `cwd` when relative. Null on any error (non-git dir
 * included), so callers degrade to "no operation".
 */
function resolveGitDir(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-dir'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
    if (!out) return null;
    return resolve(cwd, out);
  } catch {
    return null;
  }
}

/**
 * Names the git operation in progress in `cwd`, or null when the tree is
 * settled or the probe cannot run. Merge is denoted by MERGE_HEAD, cherry-pick
 * by CHERRY_PICK_HEAD, and rebase by either the rebase-merge or rebase-apply
 * state directory (interactive/merge vs am-based rebases). Never throws.
 */
export function gitOperationInProgressName(cwd: string): GitOperation | null {
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) return null;
  try {
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) return 'merge';
    if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
    if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) return 'rebase';
  } catch {
    return null;
  }
  return null;
}

/**
 * True iff a git merge, rebase, or cherry-pick is in progress in `cwd`. The
 * write guard every derived-file writer consults: false in non-git directories
 * and on any probe error, so it can never block normal operation.
 */
export function gitOperationInProgress(cwd: string): boolean {
  return gitOperationInProgressName(cwd) !== null;
}

/**
 * Resolves `<ref>^{commit}` to its full commit sha via
 * `git rev-parse --verify --quiet`, or null when the ref does not resolve to a
 * commit (unknown ref, non-git dir, git absent). Never throws — the single
 * ref-resolution probe behind refExists() and the changelog's since-ref
 * resolution.
 */
export function resolveRefToCommit(cwd: string, ref: string): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * True iff `ref` resolves to a commit in the repository at `cwd`. Never throws —
 * any probe error (unknown ref, non-git dir, git absent) is false, like its
 * sibling git-op probes.
 */
export function refExists(cwd: string, ref: string): boolean {
  return resolveRefToCommit(cwd, ref) !== null;
}
