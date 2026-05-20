// Cladding · scan · BFS source-tree walker
//
// Three composable strategies (v0.3.28 introduction, audit I14):
//
//   1. BFS queue — directories visited level by level, so a shallow
//      `packages/` is sampled before a deep `compiler/` subtree
//      exhausts the budget.
//   2. Per-directory soft cap — once a single directory contributes
//      {@link PER_DIR_SOFT_CAP} files, the walker moves on to the
//      next queued directory instead of draining the rest.
//   3. Entrypoint priority — within each directory's file list,
//      conventional entry points sort to the head so layer identity
//      survives even when the soft cap cuts the tail short.
//
// The walker is intentionally simple: no AST, no language-specific
// hooks, no file content interpretation. Reading + classifying
// happens here, every downstream analyzer takes the SourceFile[].

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {basename, extname, join, relative} from 'node:path';

import {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILES,
  ENTRYPOINT_NAMES,
  PER_DIR_SOFT_CAP,
} from './thresholds.js';
import type {SourceFile} from './types.js';

export interface WalkOptions {
  readonly root: string;
  readonly extensions?: readonly string[];
  readonly ignore?: readonly string[];
  readonly maxFiles?: number;
  readonly perDirCap?: number;
  readonly entrypoints?: ReadonlySet<string>;
}

/**
 * Returns true when the filename's stem matches the entrypoint set.
 * Case-insensitive: both `Main.java` and `main.java` hit.
 */
export function isEntrypointFile(filename: string, entrypoints: ReadonlySet<string>): boolean {
  const ext = extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  return entrypoints.has(stem) || entrypoints.has(stem.toLowerCase());
}

/**
 * BFS walk that reads file contents lazily, respects the per-dir
 * soft cap, and lists entry-point files first within each directory.
 *
 * @example
 *   const files = walk({root: '/path/to/repo'});
 *   for (const f of files) console.log(f.relPath, f.loc);
 */
export function walk(opts: WalkOptions): readonly SourceFile[] {
  const root = opts.root;
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const ignore = new Set(opts.ignore ?? DEFAULT_IGNORE);
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const perDirCap = opts.perDirCap ?? PER_DIR_SOFT_CAP;
  const entrypoints = opts.entrypoints ?? ENTRYPOINT_NAMES;

  const out: SourceFile[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < maxFiles) {
    const dir = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const fileEntries: string[] = [];
    const dirEntries: string[] = [];
    for (const e of entries) {
      if (ignore.has(e) || ignore.has(e.toLowerCase()) || e.startsWith('.')) continue;
      const abs = join(dir, e);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        dirEntries.push(abs);
      } else if (s.isFile() && extensions.includes(extname(abs))) {
        fileEntries.push(abs);
      }
    }
    // Entrypoint-first ordering so layer identity is preserved
    // even when the soft cap truncates the tail.
    fileEntries.sort((a, b) => {
      const ea = isEntrypointFile(basename(a), entrypoints) ? 0 : 1;
      const eb = isEntrypointFile(basename(b), entrypoints) ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return a.localeCompare(b);
    });
    let perDirCount = 0;
    for (const abs of fileEntries) {
      if (out.length >= maxFiles) break;
      if (perDirCount >= perDirCap) break;
      const content = readFileSync(abs, 'utf8');
      out.push({
        path: abs,
        relPath: relative(root, abs),
        content,
        loc: content.split('\n').length,
      });
      perDirCount++;
    }
    // Same-level siblings drain (within cap) before descent. Sorted
    // by name for deterministic order across platforms.
    dirEntries.sort();
    for (const sub of dirEntries) queue.push(sub);
  }
  return out;
}
