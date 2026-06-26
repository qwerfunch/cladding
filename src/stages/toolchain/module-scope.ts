// Cladding · toolchain · module-scope mapping
//
// Maps a focus feature's repo-relative `modules[]` to the Gradle project
// paths a scoped gate must target. A feature that touches
// `worker/statistics-aggregator/application` should make the gate run
// `:worker:statistics-aggregator:application:test` — not the root aggregate
// `test` that drags every unrelated subproject in.
//
// The mapping is purely structural (filesystem + path arithmetic), so it is
// deterministic and unit-testable with no Gradle invocation. It is the
// language-NEUTRAL hook point the feature asks for: nothing here is Kotlin-
// specific; `scoped-command.ts` layers the Kotlin task names on top.

import {existsSync, statSync} from 'node:fs';
import {dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';

/** A resolved Gradle subproject: its `:a:b` task prefix and its on-disk dir. */
export interface GradleProject {
  /** Gradle project path, e.g. `:worker:statistics-aggregator`. Root is `:`. */
  readonly path: string;
  /** Absolute directory of the project (the module root that owns it). */
  readonly dir: string;
}

/** True when a gate command is a Gradle invocation (`./gradlew` or `gradle`). */
export function isGradleCmd(cmd: string | undefined): boolean {
  return cmd === './gradlew' || cmd === 'gradle';
}

/**
 * A directory is a Gradle module root when it carries BOTH a build script
 * (`build.gradle` / `build.gradle.kts`) AND a `gradle.properties` — the
 * convention this monorepo uses (per-module `type=kotlin-*` recipe lives in
 * `gradle.properties`). Requiring both avoids matching a bare source folder.
 */
function isModuleRoot(dir: string): boolean {
  const hasBuild =
    existsSync(join(dir, 'build.gradle.kts')) || existsSync(join(dir, 'build.gradle'));
  return hasBuild && existsSync(join(dir, 'gradle.properties'));
}

/**
 * Turns a module-root directory (absolute) into its Gradle project path,
 * relative to the repo root. `worker/app` → `:worker:app`; the repo root
 * itself → `:`.
 */
function toProjectPath(repoRoot: string, moduleDir: string): string {
  const rel = relative(repoRoot, moduleDir);
  const segments = rel.split(sep).filter(Boolean);
  return segments.length === 0 ? ':' : `:${segments.join(':')}`;
}

/**
 * Builds a fully-qualified Gradle task path for a project. Root project
 * (`:`) yields `:<task>`; a nested project (`:a:b`) yields `:a:b:<task>`.
 */
export function gradleTask(projectPath: string, task: string): string {
  return projectPath === ':' ? `:${task}` : `${projectPath}:${task}`;
}

/**
 * Walks up from a repo-relative module path to the nearest ancestor that is a
 * Gradle module root, returning that root's absolute dir. A path that points
 * at a file (has an extension, or exists as a file) is normalized to its
 * containing directory first. Returns null when no module root is found at or
 * above the path without escaping the repo root.
 */
function findModuleDir(repoRoot: string, relPath: string): string | null {
  const abs = resolve(repoRoot, relPath);
  // Start at the directory: a file path resolves to its parent.
  let start = abs;
  if (existsSync(abs)) {
    if (statSync(abs).isFile()) start = dirname(abs);
  } else if (extname(abs) !== '') {
    start = dirname(abs);
  }
  // Reject anything that resolves outside the repo root (e.g. `../x`).
  const startRel = relative(repoRoot, start);
  if (startRel.startsWith('..') || isAbsolute(startRel)) return null;

  let cur = start;
  for (;;) {
    if (isModuleRoot(cur)) return cur;
    if (resolve(cur) === resolve(repoRoot)) return null;
    const parent = dirname(cur);
    if (parent === cur) return null; // filesystem root
    const parentRel = relative(repoRoot, parent);
    if (parentRel.startsWith('..') || isAbsolute(parentRel)) return null;
    cur = parent;
  }
}

/**
 * Maps a feature's `modules[]` to the deduplicated, sorted Gradle projects a
 * scoped gate should target.
 *
 * Determinism: the result is sorted by project path and de-duplicated, so two
 * runs over the same modules emit byte-identical task lists.
 *
 * Failure is LOUD by design (the feature forbids a silent whole-repo fallback):
 * any module that cannot be resolved to a Gradle project throws. The ONE
 * sanctioned fallback — an empty `modules[]` — is handled by callers, which
 * never reach this function.
 *
 * @throws Error naming every unmappable module path.
 */
export function mapModulesToProjects(
  cwd: string,
  modules: readonly string[],
): GradleProject[] {
  const repoRoot = resolve(cwd);
  const byPath = new Map<string, GradleProject>();
  const unmapped: string[] = [];
  for (const m of modules) {
    const dir = findModuleDir(repoRoot, m);
    if (!dir) {
      unmapped.push(m);
      continue;
    }
    const path = toProjectPath(repoRoot, dir);
    if (!byPath.has(path)) byPath.set(path, {path, dir});
  }
  if (unmapped.length > 0) {
    throw new Error(
      `cannot map module(s) to a Gradle project (no build.gradle[.kts] + gradle.properties ` +
        `ancestor under ${repoRoot}): ${unmapped.join(', ')}`,
    );
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
