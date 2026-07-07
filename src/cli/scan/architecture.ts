// Cladding · scan · architecture inference
//
// Three responsibilities:
//   1. layerOf — file → layer name resolution (workspace-aware).
//   2. groupByLayer — file list → layer-bucketed map, with peer-dir
//      blacklist + flat single-package promotion.
//   3. extractArchitecture — layer list + import graph + forbidden
//      import candidates.
//
// The forbidden-import candidate set is intentionally coarse: every
// layer pair the import graph never observed. Maintainers prune
// before committing — the comment in architecture.yaml says so
// explicitly.

import {basename, resolve} from 'node:path';

import {isJsLike} from './helpers.js';
import {LAYER_BLACKLIST, ROOT_PROMOTION_THRESHOLD} from './thresholds.js';
import type {ArchitectureScan, ImportEdge, Layer, SourceFile, SourceRoot} from './types.js';

/**
 * Resolves the architecture layer for a relative path.
 *
 * - If `relPath` lives under a source root, the layer is the first
 *   segment inside the root. Monorepo roots prefix with their
 *   `workspaceName:` so duplicate inner layer names don't collide.
 * - Workspace direct files (no intermediate dir) surface under the
 *   workspace name itself — I12 fix from v0.3.27.
 * - Otherwise the layer is the file's top-level directory.
 * - Files at cwd directly bucket under `_root` (promoted by
 *   groupByLayer when the bucket carries enough modules).
 */
export function layerOf(relPath: string, roots: readonly SourceRoot[]): string {
  for (const r of roots) {
    if (r.relPath === '') continue;
    const prefix = `${r.relPath}/`;
    if (relPath === r.relPath || relPath.startsWith(prefix)) {
      const inside = relPath.slice(prefix.length).split('/');
      if (inside.length === 1) {
        return r.workspaceName ?? '_root';
      }
      if (inside.length === 0) continue;
      const layer = inside[0];
      return r.workspaceName ? `${r.workspaceName}:${layer}` : layer;
    }
  }
  // relPath is always `/`-normalized (roots.ts builds it via `.split(sep).join('/')`),
  // so split on `/`, not the platform `sep` — on Windows `sep='\\'` would never split.
  const segments = relPath.split('/');
  if (segments.length > 1) return segments[0];
  return '_root';
}

/**
 * Resolves the full cwd-relative directory of a layer, so the emitted
 * `modules` glob (`<dir>/**`) actually matches the layer's files.
 *
 * `layerOf` deliberately drops the source-root prefix to form a short,
 * human-readable NAME (`api`, not `src/api`); this keeps it. The name is what
 * the architecture detector resolves (via `<mainRoot>/<name>`), but the glob
 * written into `spec/architecture.yaml` is cwd-relative, so it must carry the
 * root prefix — otherwise a scanned `src/api/**` layer ships a `api/**` glob
 * that matches nothing.
 *
 *   src/api/foo.ts            under root `src`             → `src/api`
 *   packages/a/src/index.ts   under root `packages/a/src` → `packages/a/src`
 *   top/mod.ts                (no matching root)           → `top`
 */
export function resolveLayerDir(relPath: string, roots: readonly SourceRoot[]): string {
  for (const r of roots) {
    if (r.relPath === '') continue;
    const prefix = `${r.relPath}/`;
    if (relPath === r.relPath || relPath.startsWith(prefix)) {
      const inside = relPath.slice(prefix.length).split('/');
      if (inside.length <= 1) return r.relPath; // direct file in the root → the root itself
      return `${r.relPath}/${inside[0]}`; // subdir layer → root/segment
    }
  }
  const segments = relPath.split('/');
  if (segments.length > 1) return segments[0];
  return '';
}

export interface GroupByLayerOptions {
  readonly cwd: string;
  readonly rootPromotionThreshold?: number;
  readonly layerBlacklist?: ReadonlySet<string>;
}

/**
 * Buckets files by architecture layer, hiding peer directories
 * (tests/, docs/, examples/, …) from the layer view but keeping
 * them readable by the convention analyzer.
 *
 * Flat single-package projects (Go cobra style) get a layer named
 * after `basename(cwd)` when `_root` carries ≥ threshold files
 * — without the promotion they'd report zero layers.
 */
export function groupByLayer(
  files: readonly SourceFile[],
  roots: readonly SourceRoot[],
  opts: GroupByLayerOptions,
): Map<string, SourceFile[]> {
  const blacklist = opts.layerBlacklist ?? LAYER_BLACKLIST;
  const promotionThreshold = opts.rootPromotionThreshold ?? ROOT_PROMOTION_THRESHOLD;
  const map = new Map<string, SourceFile[]>();
  for (const f of files) {
    const layer = layerOf(f.relPath, roots);
    if (blacklist.has(layer.toLowerCase())) continue;
    const colonIdx = layer.indexOf(':');
    if (colonIdx > 0 && blacklist.has(layer.slice(colonIdx + 1).toLowerCase())) continue;
    if (!map.has(layer)) map.set(layer, []);
    map.get(layer)!.push(f);
  }
  const rootBucket = map.get('_root');
  if (rootBucket && rootBucket.length >= promotionThreshold) {
    // I15 (v0.3.31) — cobra was scanned with `opts.cwd = '.'`, which
    // collapsed `basename('.')` into `.` and produced a layer literally
    // named `.`. Resolve cwd to an absolute path first so the promoted
    // layer reads the directory's *actual* name (`cobra`, `gin`, …).
    const promotedName = basename(resolve(opts.cwd)) || 'root';
    if (!map.has(promotedName)) {
      map.set(promotedName, rootBucket);
      map.delete('_root');
    }
  }
  return map;
}

/**
 * Builds layer list + import graph + forbidden-import candidate set
 * from the bucketed file map. The candidate set is every layer pair
 * not observed in the import graph; a reviewer prunes before committing.
 */
export function extractArchitecture(
  files: readonly SourceFile[],
  filesByLayer: ReadonlyMap<string, SourceFile[]>,
  roots: readonly SourceRoot[],
): ArchitectureScan {
  const layers: Layer[] = [];
  for (const [name, layerFiles] of filesByLayer) {
    if (name === '_root') continue;
    // Drop the flat single-root promotion. `groupByLayer` renames the `_root`
    // bucket to `basename(cwd)` when a flat project's files sit directly in the
    // source root — but those files form no *sub*-layer: the object-form
    // architecture the detector consumes resolves each layer as
    // `<mainRoot>/<name>`, and there is no name that resolves back to the root
    // itself. Emitting one produced a bogus layer named after the project
    // directory with a `<basename>/**` glob that matched nothing. A flat
    // project honestly has zero architecture layers (renders `layers: []`).
    // The promoted bucket is identified by re-deriving its files' pre-promotion
    // layer — flat-root files resolve to `_root`; workspace roots resolve to
    // their `workspaceName`, so monorepo layers are untouched.
    if (layerOf(layerFiles[0].relPath, roots) === '_root') continue;
    layers.push({name, dir: resolveLayerDir(layerFiles[0].relPath, roots), moduleCount: layerFiles.length});
  }
  layers.sort((a, b) => a.name.localeCompare(b.name));

  const edgeMap = new Map<string, number>();
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    const fromLayer = layerOf(f.relPath, roots);
    for (const m of f.content.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = m[1];
      const ups = target.match(/^(\.\.\/)+/);
      if (!ups) continue;
      const stripped = target.replace(/^(\.\.\/)+/, '');
      const toLayer = stripped.split('/')[0];
      if (!toLayer || toLayer === fromLayer) continue;
      const key = `${fromLayer}→${toLayer}`;
      edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
    }
  }
  const importGraph: ImportEdge[] = [];
  for (const [key, count] of edgeMap) {
    const [from, to] = key.split('→');
    importGraph.push({from, to, count});
  }
  importGraph.sort((a, b) => b.count - a.count);

  const seen = new Set<string>();
  for (const e of importGraph) seen.add(`${e.from}→${e.to}`);

  // I17 (v0.3.31) — forbidden-import noise reduction. Until this
  // patch every N-layer scan produced N×(N-1) candidate pairs. The
  // 5차 audit measured 195 entries on ripgrep (15 layers) and 380+
  // on vitest (20 layers); reviewer fatigue was real. Two prune
  // rules narrow the surface to architecturally meaningful pairs:
  //
  //   - Skip pairs where either side is a "trivial" layer
  //     (FORBIDDEN_TRIVIAL_THRESHOLD modules or fewer). A layer
  //     with one or two files rarely carries a real import policy;
  //     forbidding access to/from it produces a guess, not a rule.
  //   - Keep only the top-K candidates per importer when a layer
  //     would otherwise emit too many. Sort by importing layer
  //     size desc — the more code in the source layer, the more
  //     load-bearing the candidate.
  //
  // Reviewers prune further, but the default no longer ships a
  // wall of guesses.
  const FORBIDDEN_TRIVIAL_THRESHOLD = 2;
  const FORBIDDEN_TOP_K = 8;
  const layerSize = new Map<string, number>();
  for (const l of layers) layerSize.set(l.name, l.moduleCount);
  const layerNames = layers.map((l) => l.name);
  const forbiddenImportCandidates: Record<string, string[]> = {};
  for (const from of layerNames) {
    const fromSize = layerSize.get(from) ?? 0;
    if (fromSize <= FORBIDDEN_TRIVIAL_THRESHOLD) continue;
    const candidates: {name: string; size: number}[] = [];
    for (const to of layerNames) {
      if (from === to) continue;
      const toSize = layerSize.get(to) ?? 0;
      if (toSize <= FORBIDDEN_TRIVIAL_THRESHOLD) continue;
      if (!seen.has(`${from}→${to}`)) candidates.push({name: to, size: toSize});
    }
    // Keep candidates whose target layer is large enough to act as
    // a load-bearing target; cap at K so a 20-layer monorepo no
    // longer ships a 19-element forbidden_imports per row.
    candidates.sort((a, b) => b.size - a.size);
    const pruned = candidates.slice(0, FORBIDDEN_TOP_K).map((c) => c.name).sort();
    if (pruned.length > 0) forbiddenImportCandidates[from] = pruned;
  }
  return {layers, importGraph, forbiddenImportCandidates};
}
