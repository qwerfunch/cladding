// Cladding · git pre-commit hook installer (Phase 2 — ambient enforcement)
//
// Writes `.git/hooks/pre-commit` that runs the fast, spec-native gate
// (`clad check --tier=pre-commit` → drift / arch / secret) before every
// commit, so spec↔code drift is blocked at commit time without the user
// invoking anything.
//
// Surface policy: this is NOT exposed as a standalone `clad hook` verb. It is
// wired only through the opt-in `clad init --with-hook` flag — the user adds
// one flag to a command they already run; thereafter the hook is ambient
// (fires automatically). cladding never installs a git hook without that
// explicit opt-in (silently touching .git is invasive — same reason v0.4.0
// dropped the npm postinstall side effect).
//
// `--tier=pre-commit` is intentionally the cheap subset (drift/arch/secret):
// deterministic, spec-native, no whole-toolchain spawn. type/lint/unit/cov and
// the probabilistic/HITL stages run in pre-push / CI, not on every commit —
// keeping commits fast so developers don't reflexively `--no-verify`.

import {chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Marker line that identifies a hook as cladding-authored (for idempotency). */
const HOOK_MARKER = 'cladding pre-commit hook';

export type HookInstallResult =
  | 'created'
  | 'unchanged'
  | 'updated'
  | 'skipped-foreign'
  | 'skipped-no-git';

export interface HookInstallOptions {
  /** Overwrite a pre-existing NON-cladding hook. Default false (skip + warn). */
  readonly force?: boolean;
  /** cladding version, stamped into the hook for idempotency/upgrade detection. */
  readonly version?: string;
}

/**
 * Renders the pre-commit hook script.
 *
 * Resolution order for the `clad` binary: global `clad` first, then
 * `npx cladding`. If neither is found the hook WARNS and exits 0 (does NOT
 * block the commit) — bricking every commit because a tool is missing is worse
 * than degrading enforcement, and the CI gate remains the hard enforcement
 * layer. When `clad` IS found, the hook `exec`s it so `clad check`'s exit code
 * becomes the hook's exit code (non-zero → git aborts the commit).
 */
export function renderPreCommitHook(version: string): string {
  return [
    '#!/bin/sh',
    `# ${HOOK_MARKER} — installed by \`clad init --with-hook\` (cladding v${version})`,
    '# Runs the fast spec-native gate (drift / arch / secret) before each commit.',
    '# Bypass once: git commit --no-verify   |   Remove: delete this file.',
    'if command -v clad >/dev/null 2>&1; then',
    '  exec clad check --tier=pre-commit',
    'fi',
    'if command -v npx >/dev/null 2>&1; then',
    '  exec npx --no-install cladding check --tier=pre-commit',
    'fi',
    'echo "cladding pre-commit: \'clad\' not found on PATH — enforcement skipped' +
      ' (install: npm i -g cladding). The CI gate still enforces." >&2',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * Installs (or refreshes) the cladding pre-commit hook at `<cwd>/.git/hooks/pre-commit`.
 *
 * Idempotent + non-destructive:
 *   - no `.git` directory            → `skipped-no-git` (not an error).
 *   - hook absent                    → `created`.
 *   - cladding hook, identical       → `unchanged`.
 *   - cladding hook, older version   → `updated` (safe — we own it).
 *   - foreign (non-cladding) hook    → `skipped-foreign` unless `force`.
 *
 * @returns the outcome + the absolute hook path (for reporting).
 */
export function installPreCommitHook(
  cwd: string,
  opts: HookInstallOptions = {},
): {readonly result: HookInstallResult; readonly path: string} {
  const version = opts.version ?? '0.0.0';
  const gitPath = join(cwd, '.git');
  const hookPath = join(cwd, '.git', 'hooks', 'pre-commit');
  // Only the common worktree layout (a real `.git/` directory) is handled.
  // A `.git` file (submodule / linked worktree) points elsewhere — skip
  // rather than write to the wrong place.
  if (!existsSync(gitPath) || !statSync(gitPath).isDirectory()) {
    return {result: 'skipped-no-git', path: hookPath};
  }

  const body = renderPreCommitHook(version);
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    const ours = existing.includes(HOOK_MARKER);
    if (ours) {
      if (existing === body) return {result: 'unchanged', path: hookPath};
      writeHook(hookPath, body);
      return {result: 'updated', path: hookPath};
    }
    if (!opts.force) return {result: 'skipped-foreign', path: hookPath};
    // force → fall through and overwrite the foreign hook
  }
  writeHook(hookPath, body);
  return {result: 'created', path: hookPath};
}

function writeHook(hookPath: string, body: string): void {
  mkdirSync(join(hookPath, '..'), {recursive: true});
  writeFileSync(hookPath, body);
  chmodSync(hookPath, 0o755);
}
