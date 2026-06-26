// Cladding · `clad init --scan` — source root inference
//
// v0.3.24 hardcoded `src/<layer>/...` as the only layout scan.ts
// recognised. That worked for cladding itself but failed everywhere
// else — monorepos (`packages/<x>/src/...`), Python projects keeping
// the package directory at root, Go projects splitting `cmd/` /
// `internal/` / `pkg/`, Rust workspaces with `crates/<x>/src/`. This
// module replaces the hardcoded assumption with a two-stage inference:
//
//   1. Read manifests (package.json workspaces, pyproject.toml,
//      Cargo.toml, go.mod) for the authoritative source layout when
//      the project declares one.
//   2. Fall back to a small set of widely-used directory conventions
//      (src/, lib/, app/, pkg/, cmd/, internal/, packages/*/src/,
//      apps/*/src/, crates/*/src/).
//
// When both produce nothing, the caller (scan.ts) keeps walking from
// cwd and the layer view degrades to `<top-level-dir>`, matching the
// fallback v0.3.24 already had for non-src layouts.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {basename, dirname, join, relative, sep} from 'node:path';

/**
 * One source root the scanner should treat as the layer boundary. A
 * monorepo workspace contributes one root per package; a flat project
 * contributes a single root whose `workspaceName` is undefined.
 */
export interface SourceRoot {
  /** Absolute filesystem path of the root. */
  readonly absPath: string;
  /** Path relative to the project cwd — usable in YAML / docs. */
  readonly relPath: string;
  /** Optional workspace label; surfaces as a prefix on layer names. */
  readonly workspaceName?: string;
  /** Which inference path produced this root — for telemetry / debug. */
  readonly source: 'manifest' | 'heuristic' | 'cli-override';
}

export interface InferenceOptions {
  /** Project cwd. */
  readonly cwd: string;
  /**
   * Explicit override from `--roots a/src,b/src`. When non-empty, the
   * manifest + heuristic phases are skipped and the override is used
   * verbatim (every path resolved against `cwd`).
   */
  readonly override?: readonly string[];
}

const HEURISTIC_FLAT: readonly string[] = ['src', 'lib', 'app', 'pkg', 'cmd', 'internal'];
const HEURISTIC_NESTED: readonly string[] = ['packages', 'apps', 'crates'];

/**
 * Infers one or more {@link SourceRoot}s for the project at `cwd`.
 *
 * Order of precedence: explicit override → manifest hints → directory
 * heuristics → empty (caller falls back to cwd walk).
 */
export function inferSourceRoots(opts: InferenceOptions): readonly SourceRoot[] {
  if (opts.override && opts.override.length > 0) {
    return opts.override
      .map((rel) => resolveRoot(opts.cwd, rel, undefined, 'cli-override'))
      .filter((r): r is SourceRoot => r !== null);
  }
  const manifest = readManifestRoots(opts.cwd);
  if (manifest.length > 0) return manifest;
  const heuristic = readHeuristicRoots(opts.cwd);
  if (heuristic.length > 0) return heuristic;
  return [];
}

function resolveRoot(
  cwd: string,
  rel: string,
  workspaceName: string | undefined,
  source: SourceRoot['source'],
): SourceRoot | null {
  const abs = join(cwd, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
  return {
    absPath: abs,
    relPath: relative(cwd, abs).split(sep).join('/'),
    workspaceName,
    source,
  };
}

// ---- manifest readers --------------------------------------------

function readManifestRoots(cwd: string): readonly SourceRoot[] {
  const roots: SourceRoot[] = [];
  roots.push(...readPackageJsonWorkspaces(cwd));
  roots.push(...readPyprojectPackages(cwd));
  roots.push(...readCargoWorkspace(cwd));
  roots.push(...readGoMod(cwd));
  roots.push(...readGradleMavenRoots(cwd));
  return dedupe(roots);
}

/**
 * Gradle/Maven (JVM) source-set roots. Without this, a Kotlin/Java project's
 * `src/` heuristic would surface `src/main` / `src/test` as layers — JVM keeps
 * its real source under `src/main/kotlin` and `src/main/java`. We surface
 * those (plus the test source sets) when a JVM manifest is present.
 */
function readGradleMavenRoots(cwd: string): readonly SourceRoot[] {
  const hasJvmManifest = ['build.gradle.kts', 'build.gradle', 'pom.xml'].some((m) =>
    existsSync(join(cwd, m)),
  );
  if (!hasJvmManifest) return [];
  const out: SourceRoot[] = [];
  for (const dir of ['src/main/kotlin', 'src/main/java', 'src/test/kotlin', 'src/test/java']) {
    const root = resolveRoot(cwd, dir, undefined, 'manifest');
    if (root) out.push(root);
  }
  return out;
}

function readPackageJsonWorkspaces(cwd: string): readonly SourceRoot[] {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let pkg: {workspaces?: readonly string[] | {packages?: readonly string[]}};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return [];
  }
  const patterns = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces && typeof pkg.workspaces === 'object' && 'packages' in pkg.workspaces
      ? pkg.workspaces.packages ?? []
      : []);
  if (patterns.length === 0) return [];
  const out: SourceRoot[] = [];
  for (const pattern of patterns) {
    // Workspaces patterns are globs (`packages/*`); expand them by
    // walking the parent directory and matching the wildcard segment.
    const expanded = expandGlobOnce(cwd, pattern);
    for (const e of expanded) {
      // Workspace candidate: prefer `<pkg>/src/` when present,
      // otherwise the workspace root itself.
      const withSrc = join(e.abs, 'src');
      const target = existsSync(withSrc) && statSync(withSrc).isDirectory() ? withSrc : e.abs;
      const root = resolveRoot(cwd, relative(cwd, target).split(sep).join('/'), e.name, 'manifest');
      if (root) out.push(root);
    }
  }
  return out;
}

function readPyprojectPackages(cwd: string): readonly SourceRoot[] {
  const path = join(cwd, 'pyproject.toml');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  // Lightweight TOML probe — we read three well-known shapes without
  // pulling in a full parser:
  //   `packages = [{include = "<name>"}]`     (Poetry)
  //   `packages = ["<name>"]`                 (Setuptools simple list)
  //   `[tool.setuptools.packages.find]` ...   (Setuptools find)
  const out: SourceRoot[] = [];
  for (const m of text.matchAll(/include\s*=\s*['"]([\w./-]+)['"]/g)) {
    const root = resolveRoot(cwd, m[1], undefined, 'manifest');
    if (root) out.push(root);
  }
  for (const m of text.matchAll(/packages\s*=\s*\[([^\]]*)\]/g)) {
    for (const name of m[1].matchAll(/['"]([\w./-]+)['"]/g)) {
      const root = resolveRoot(cwd, name[1], undefined, 'manifest');
      if (root) out.push(root);
    }
  }
  return dedupe(out);
}

function readCargoWorkspace(cwd: string): readonly SourceRoot[] {
  const path = join(cwd, 'Cargo.toml');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const out: SourceRoot[] = [];
  // [workspace] members = ["crates/a", "crates/b"]
  const wsMatch = text.match(/\[workspace\][\s\S]*?members\s*=\s*\[([^\]]*)\]/);
  if (wsMatch) {
    for (const m of wsMatch[1].matchAll(/['"]([\w./-]+)['"]/g)) {
      const workspaceDir = m[1];
      const srcCandidate = join(cwd, workspaceDir, 'src');
      const targetRel = existsSync(srcCandidate) ? `${workspaceDir}/src` : workspaceDir;
      const root = resolveRoot(cwd, targetRel, basename(workspaceDir), 'manifest');
      if (root) out.push(root);
    }
    return out;
  }
  // Single-crate Cargo project: src/ is the convention.
  const root = resolveRoot(cwd, 'src', undefined, 'manifest');
  return root ? [root] : [];
}

function readGoMod(cwd: string): readonly SourceRoot[] {
  const path = join(cwd, 'go.mod');
  if (!existsSync(path)) return [];
  // Go projects typically split into cmd/, internal/, pkg/. We
  // surface all three when they exist; the heuristic phase would
  // catch the same paths but the manifest signal is stronger so we
  // mark them as 'manifest' source.
  const out: SourceRoot[] = [];
  for (const dir of ['cmd', 'internal', 'pkg']) {
    const root = resolveRoot(cwd, dir, undefined, 'manifest');
    if (root) out.push(root);
  }
  return out;
}

// ---- directory heuristics ----------------------------------------

function readHeuristicRoots(cwd: string): readonly SourceRoot[] {
  const out: SourceRoot[] = [];
  for (const flat of HEURISTIC_FLAT) {
    const root = resolveRoot(cwd, flat, undefined, 'heuristic');
    if (root) out.push(root);
  }
  for (const nested of HEURISTIC_NESTED) {
    const parent = join(cwd, nested);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) continue;
    for (const entry of readdirSync(parent)) {
      if (entry.startsWith('.')) continue;
      const ws = join(parent, entry);
      if (!statSync(ws).isDirectory()) continue;
      const withSrc = join(ws, 'src');
      const target = existsSync(withSrc) && statSync(withSrc).isDirectory() ? withSrc : ws;
      const rel = relative(cwd, target).split(sep).join('/');
      const root = resolveRoot(cwd, rel, entry, 'heuristic');
      if (root) out.push(root);
    }
  }
  return dedupe(out);
}

// ---- helpers -----------------------------------------------------

function dedupe(roots: readonly SourceRoot[]): SourceRoot[] {
  const seen = new Set<string>();
  const out: SourceRoot[] = [];
  for (const r of roots) {
    if (seen.has(r.absPath)) continue;
    seen.add(r.absPath);
    out.push(r);
  }
  return out;
}

/**
 * Expands a one-star workspace pattern (`packages/*`) against cwd.
 * Two-star patterns (`packages/**`) are reduced to one-star to keep
 * the discovery scope predictable; users with deeper nesting can pass
 * an explicit `--roots`.
 */
function expandGlobOnce(
  cwd: string,
  pattern: string,
): readonly {abs: string; name: string}[] {
  if (!pattern.includes('*')) {
    const abs = join(cwd, pattern);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
    return [{abs, name: basename(abs)}];
  }
  const parts = pattern.split('/');
  const starIdx = parts.findIndex((p) => p.includes('*'));
  if (starIdx === -1) return [];
  const parent = join(cwd, ...parts.slice(0, starIdx));
  if (!existsSync(parent) || !statSync(parent).isDirectory()) return [];
  const tail = parts.slice(starIdx + 1).join('/');
  const out: {abs: string; name: string}[] = [];
  for (const entry of readdirSync(parent)) {
    if (entry.startsWith('.')) continue;
    const candidate = tail ? join(parent, entry, tail) : join(parent, entry);
    if (!existsSync(candidate) || !statSync(candidate).isDirectory()) continue;
    out.push({abs: candidate, name: entry});
  }
  return out;
}

// Reduce unused import noise — `dirname` is reserved for future use
// when we surface "the manifest declaring this root" alongside each
// SourceRoot. Keeping the import here makes that v0.3.x patch a
// single-line change instead of an import shuffle.
const _reservedForLater = dirname;
void _reservedForLater;
