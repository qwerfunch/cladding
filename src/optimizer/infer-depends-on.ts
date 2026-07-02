// Cladding · optimizer · infer feature depends_on from the code import graph — F-2be3e3bb
//
// THE GAP this closes: `depends_on` (feature→feature edges) is the load-bearing input for the
// whole graph layer — prune / context-slice / working-set / reverse-slice / iterative-slice /
// drive ordering ALL walk it. But cladding PRODUCES it nowhere (clad_create_feature, scan,
// onboarding never emit it) and FLAGS its absence nowhere. So a real project authored with
// cladding (doverunner-vapt: 174 features) ships with ZERO edges — every graph tool returns
// an empty result. That is a precondition gap (the graph can't exist without edges), not a
// correctness claim.
//
// This module reconstructs the edges DETERMINISTICALLY from what IS present: each feature's
// `modules` (file paths) + the actual import statements in those files. If feature A's module
// imports a path owned by feature B (B ≠ A), then A depends_on B. Pure given the file
// contents (the impure read is injected, like code-excerpt.ts) — so it is headless-testable.
//
// Conservative by design (low false-positive, per the analysis): an edge is emitted ONLY when
// an import resolves to a file declared in ANOTHER feature's `modules`. Imports of stdlib /
// third-party / unowned files produce nothing. Resolution matches on MULTI-SEGMENT path/dotted
// keys only — a bare basename (e.g. `schemas`, `utils`) is too ambiguous (the same filename
// recurs across features) and was measured to triple the edge count with spurious links, so
// single-segment keys are excluded.

import {reverseIndexOf} from '../spec/reverse-index.js';
import type {Spec} from '../spec/types.js';

export interface InferredEdge {
  readonly from: string; // feature id that imports
  readonly to: string; // feature id that owns the imported module
  readonly via: string; // the owned module path that was imported (evidence)
}

export interface InferResult {
  /** Deterministically-ordered inferred feature→feature edges (deduped). */
  readonly edges: readonly InferredEdge[];
  /** Edges already present in spec (from existing depends_on) — so callers can show only the NEW ones. */
  readonly alreadyDeclared: readonly InferredEdge[];
  /** Per-feature: the inferred `to` ids NOT yet in its depends_on (the suggested additions). */
  readonly suggestions: Readonly<Record<string, readonly string[]>>;
  /**
   * Module files that use dynamic/runtime imports (importlib, __import__, getattr-based) — these
   * carry dependencies that static regex CANNOT extract, so edges from them may be UNDER-reported.
   * Surfaced (not silently dropped) so a maintainer knows which files to review by hand. Sorted.
   */
  readonly dynamicImportFiles: readonly string[];
}

/** A reader that returns a module file's text, or null if unreadable. Injected (keeps this pure). */
export type ModuleReader = (path: string) => string | null;

export interface InferOptions {
  /**
   * Skip an import whose resolved key is owned by MORE than this many features (default 1).
   * A module co-declared by many features is an ambiguous edge target — importing it does not
   * mean depending on ALL of them. Measured on doverunner-vapt: capping at 1 owner yields ~420
   * clean edges; uncapped yields ~2200 with heavy fan-out noise from shared modules.
   */
  readonly maxOwnerAmbiguity?: number;
}

// Dynamic/runtime import patterns — dependencies static extraction cannot see (so a file with
// these may have UNDER-reported edges; we surface it for manual review rather than pretend it's complete).
const DYNAMIC_IMPORT = /\b(?:importlib\.import_module|importlib\.__import__|__import__\s*\(|import_module\s*\(|require\s*\(\s*[^'"\s)])/;

// Import extractors per language family. Each returns the raw imported "specifier" strings.
const PY_IMPORT = /^\s*(?:from\s+([.\w]+)\s+import\b|import\s+([.\w]+))/gm;
const JS_IMPORT = /(?:^|\n)\s*(?:import\b[^'"]*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:const|let|var)\s+[^=]+=\s*require\(\s*['"]([^'"]+)['"]\s*\))/g;

/** Lowercase ext check. */
function ext(p: string): string {
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i).toLowerCase() : '';
}

/**
 * For every owned module path, register lookup keys that an import specifier could resolve to.
 * Python: `backend/disciplines/sast/x.py` → dotted `disciplines.sast.x` AND `backend.disciplines.sast.x`
 *         (pythonpath roots make the leading dir optional) + the bare basename `x`.
 * JS/TS:  `src/a/b.ts` → `src/a/b`, `a/b`, and the basename `b` (relative imports resolve by basename/segment).
 * Returns Map<lookupKey, Set<featureId>>.
 */
function buildResolveIndex(ownerByPath: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const add = (key: string, owners: ReadonlySet<string>): void => {
    if (!key) return;
    const set = idx.get(key) ?? new Set<string>();
    for (const o of owners) set.add(o);
    idx.set(key, set);
  };
  for (const [path, owners] of ownerByPath) {
    const e = ext(path);
    const noExt = e ? path.slice(0, -e.length) : path;
    const segs = noExt.split('/').filter(Boolean);
    // Only MULTI-SEGMENT keys (≥2 path components): a bare basename is ambiguous across features.
    const sep = e === '.py' ? '.' : '/';
    for (let start = 0; start <= segs.length - 2; start++) {
      add(segs.slice(start).join(sep), owners);
    }
  }
  return idx;
}

/** Extracts import specifiers from a source file by language family. */
function extractImports(source: string, fileExt: string): string[] {
  const out: string[] = [];
  if (fileExt === '.py') {
    for (let m = PY_IMPORT.exec(source); m; m = PY_IMPORT.exec(source)) out.push(m[1] ?? m[2]);
    PY_IMPORT.lastIndex = 0;
  } else if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(fileExt)) {
    for (let m = JS_IMPORT.exec(source); m; m = JS_IMPORT.exec(source)) out.push(m[1] ?? m[2] ?? m[3]);
    JS_IMPORT.lastIndex = 0;
  }
  return out.filter(Boolean);
}

/** Normalises an import specifier to candidate lookup keys (matching buildResolveIndex). */
function importKeys(spec: string, fileExt: string): string[] {
  // Multi-segment keys only (mirror buildResolveIndex — no ambiguous bare basename).
  if (fileExt === '.py') {
    const segs = spec.replace(/^\.+/, '').split('.').filter(Boolean);
    const keys: string[] = [];
    for (let start = 0; start <= segs.length - 2; start++) keys.push(segs.slice(start).join('.'));
    return keys;
  }
  const clean = spec.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/i, '').replace(/^[./]+/, '');
  const segs = clean.split('/').filter(Boolean);
  const keys: string[] = [];
  for (let start = 0; start <= segs.length - 2; start++) keys.push(segs.slice(start).join('/'));
  return keys;
}

/**
 * Infers feature→feature depends_on edges from the import graph of each feature's modules.
 * `read` returns a module file's source (or null). Deterministic + pure given identical spec
 * + identical file contents; edges + suggestions are sorted for byte-stable output.
 */
export function inferDependsOn(spec: Spec, read: ModuleReader, opts: InferOptions = {}): InferResult {
  const maxAmbiguity = opts.maxOwnerAmbiguity ?? 1;
  const ri = reverseIndexOf(spec);
  const resolve = buildResolveIndex(ri.moduleOwners);
  const features = spec.features ?? [];

  // edgeKey → InferredEdge (dedup; keep the first `via` for evidence, deterministically smallest)
  const edgeMap = new Map<string, InferredEdge>();
  const dynamicFiles = new Set<string>();
  for (const f of features) {
    const fromId = f.id;
    for (const modPath of f.modules ?? []) {
      const fileExt = ext(modPath);
      if (fileExt !== '.py' && !['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(fileExt)) continue;
      const src = read(modPath);
      if (src == null) continue;
      if (DYNAMIC_IMPORT.test(src)) dynamicFiles.add(modPath); // edges may be under-reported here
      for (const spec0 of extractImports(src, fileExt)) {
        for (const key of importKeys(spec0, fileExt)) {
          const owners = resolve.get(key);
          if (!owners || owners.size > maxAmbiguity) continue; // ambiguous shared module → weak signal, skip
          for (const ownerId of owners) {
            if (ownerId === fromId) continue; // a feature importing its own module is not a dep
            const k = `${fromId}\u0000${ownerId}`;
            const existing = edgeMap.get(k);
            if (!existing || modPath < existing.via) edgeMap.set(k, {from: fromId, to: ownerId, via: modPath});
          }
        }
      }
    }
  }

  const declared = new Map(features.map((f) => [f.id, new Set(f.depends_on ?? [])]));
  const all = [...edgeMap.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  const edges: InferredEdge[] = [];
  const already: InferredEdge[] = [];
  const sugg: Record<string, Set<string>> = {};
  for (const e of all) {
    if (declared.get(e.from)?.has(e.to)) already.push(e);
    else {
      edges.push(e);
      (sugg[e.from] ??= new Set()).add(e.to);
    }
  }
  const suggestions: Record<string, string[]> = {};
  for (const [fid, set] of Object.entries(sugg)) suggestions[fid] = [...set].sort();

  return {edges, alreadyDeclared: already, suggestions, dynamicImportFiles: [...dynamicFiles].sort()};
}
