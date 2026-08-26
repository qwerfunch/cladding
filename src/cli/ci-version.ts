// Cladding · generated-CI version pinning and read-only diagnostics.

import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, sep} from 'node:path';

const NUMERIC_SELECTOR = /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/;
const CLADDING_PACKAGE = /(?:^|\s)cladding(?:@([^\s"'`]+))?(?=\s|$)/g;

/** Read-only diagnosis of Cladding package selectors in GitHub Actions. */
export interface CiVersionHealth {
  /** Workflow paths containing at least one unversioned or floating invocation. */
  readonly unpinnedWorkflows: readonly string[];
}

/**
 * Reduces a runtime SemVer string to the npm major.minor selector used in generated CI.
 *
 * @param version - The running Cladding version, or null when its manifest is unavailable.
 * @returns A numeric major.minor selector, or null for an absent or malformed version.
 * @throws Never; invalid input is represented by null.
 * @example
 * ```ts
 * claddingMajorMinor('0.9.3'); // '0.9'
 * ```
 * @see spec/features/ci-version-pinning-abd10f3c.yaml AC-84011597
 * @since 0.9.4
 */
export function claddingMajorMinor(version: string | null): string | null {
  const match = /^(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version ?? '');
  return match ? `${match[1]}.${match[2]}` : null;
}

function workflowFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...workflowFiles(path));
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths;
}

function hasUnpinnedInvocation(body: string): boolean {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !/\bnpx(?:\s|$)/.test(line)) continue;
    const command = line.slice(line.search(/\bnpx(?:\s|$)/));
    CLADDING_PACKAGE.lastIndex = 0;
    for (const match of command.matchAll(CLADDING_PACKAGE)) {
      const selector = match[1];
      if (selector === undefined || !NUMERIC_SELECTOR.test(selector)) return true;
    }
  }
  return false;
}

/**
 * Finds GitHub Actions workflows whose npx Cladding package selector can float.
 *
 * @param cwd - Project root containing `.github/workflows`.
 * @returns Deterministically sorted project-relative workflow paths.
 * @throws Only when an existing workflow cannot be read; unreadable CI is not a healthy result.
 * @example
 * ```ts
 * const health = readCiVersionHealth('/workspace');
 * ```
 * @see spec/features/ci-version-pinning-abd10f3c.yaml AC-b0ade1e9
 * @since 0.9.4
 */
export function readCiVersionHealth(cwd: string): CiVersionHealth {
  const root = join(cwd, '.github', 'workflows');
  const unpinnedWorkflows = workflowFiles(root)
    .filter((path) => hasUnpinnedInvocation(readFileSync(path, 'utf8')))
    .map((path) => relative(cwd, path).split(sep).join('/'))
    .sort((a, b) => a.localeCompare(b));
  return {unpinnedWorkflows};
}
