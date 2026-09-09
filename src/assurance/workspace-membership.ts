// Cladding · Spec 0.2 F6 · portable sealed-file membership for closure walks.

import {AsyncLocalStorage} from 'node:async_hooks';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

/**
 * Desktop file-manager metadata never belongs to a sealed workspace.
 *
 * These files are written by a viewer, not by the project, and an adopter does
 * not reliably ignore them. They are excluded by basename even when git tracks
 * them, because a seal that depends on who opened a folder is not portable.
 */
export const WORKSPACE_METADATA_FILES: ReadonlySet<string> = Object.freeze(
  new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']),
);

/** Decides which workspace files a closure or runner-control walk may seal. */
export interface WorkspaceMembership {
  /** Where membership came from; `filesystem` is the no-git fallback. */
  readonly source: 'git' | 'filesystem';
  /**
   * Answers whether one workspace-relative path may be sealed.
   *
   * @param repoPath - Forward-slash path relative to the workspace root.
   * @returns True when the path is a sealable member of this workspace.
   */
  includes(repoPath: string): boolean;
}

const membershipScope = new AsyncLocalStorage<Map<string, WorkspaceMembership>>();

/** Desktop metadata is excluded before any other rule, git or not. */
function isMetadataPath(repoPath: string): boolean {
  return WORKSPACE_METADATA_FILES.has(repoPath.split('/').at(-1) ?? '');
}

/** Keeps a `precomposeunicode` git listing comparable with a `readdir` name. */
function normalizePath(repoPath: string): string {
  return repoPath.normalize('NFC');
}

const filesystemMembership: WorkspaceMembership = Object.freeze({
  source: 'filesystem' as const,
  includes: (repoPath: string): boolean => !isMetadataPath(repoPath),
});

/** Lists tracked and untracked-not-ignored paths, or undefined when git cannot answer. */
function gitListing(root: string): Set<string> | undefined {
  const env: NodeJS.ProcessEnv = {...process.env, GIT_OPTIONAL_LOCKS: '0'};
  // The gate also runs as a git hook, where these variables point at another
  // repository; `cwd` must stay the sole authority over membership.
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  let result;
  try {
    result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 512 * 1024 * 1024,
      env,
    });
  } catch {
    return undefined;
  }
  if (result.error || result.status !== 0 || !result.stdout) return undefined;
  const paths = result.stdout.toString('utf8').split('\0').filter((entry) => entry !== '');
  // An empty listing is never a real workspace answer: a fixture copied under
  // an ignored path of an enclosing repository would otherwise seal nothing.
  if (paths.length === 0) return undefined;
  return new Set(paths.map(normalizePath));
}

/**
 * Resolves which files of one workspace a seal may contain.
 *
 * A closure seal must equal the seal a clean checkout of the same commit
 * computes, so membership follows git rather than the working copy: tracked
 * files plus untracked files git does not ignore, minus desktop metadata.
 * Outside a git repository the walk keeps today's meaning, minus that metadata.
 *
 * @param cwd - Workspace root whose sealed files are enumerated.
 * @param options - `source: 'filesystem'` forces the no-git behaviour.
 * @returns One immutable membership predicate; never throws.
 * @see docs/design/spec-0.2/assurance.md
 * @since 0.10.0
 */
export function workspaceMembership(cwd: string, options?: {readonly source?: 'filesystem'}): WorkspaceMembership {
  if (options?.source === 'filesystem') return filesystemMembership;
  const root = resolve(cwd);
  const scope = membershipScope.getStore();
  const memoized = scope?.get(root);
  if (memoized) return memoized;
  const listing = gitListing(root);
  const membership: WorkspaceMembership = listing === undefined
    ? filesystemMembership
    : Object.freeze({
      source: 'git' as const,
      includes: (repoPath: string): boolean => !isMetadataPath(repoPath) && listing.has(normalizePath(repoPath)),
    });
  scope?.set(root, membership);
  return membership;
}

/**
 * Runs one gate evaluation with a single shared membership listing.
 *
 * Membership may be memoized inside one evaluation and never across two: a
 * long-lived server runs many gates in one process, and the second gate must
 * see a file the first one did not.
 *
 * @param fn - Evaluation body; nested scopes reuse the outer listing.
 * @returns Whatever the evaluation body returns.
 * @see docs/design/spec-0.2/assurance.md
 * @since 0.10.0
 */
export function withWorkspaceMembership<T>(fn: () => T): T {
  return membershipScope.getStore() ? fn() : membershipScope.run(new Map(), fn);
}
