// Cladding · `clad init --scan` — observed-conventions extractor
//
// ironclad-design 07-ssot-init §3 B (Existing Project 시나리오). When
// an external project adopts cladding, scan walks its source tree and
// extracts 14 deterministic conventions plus representative example
// modules so a downstream LLM dispatch (scan-llm.ts) can compose the
// `docs/conventions.md` brief that guides specialist agents during
// dispatch. The brief lets AI maintain the project in the same shape
// the original authors used — same function signatures, same comment
// style, same module boilerplate — instead of inventing fresh style.
//
// scan.ts is fully deterministic; LLM interpretation lives separately
// in scan-llm.ts so the `--no-llm` fallback path is byte-identical to
// what a deterministic-only run produces.
//
// @see ironclad-design/07-ssot-init.md §3 B
// @see ironclad-design/14-agent-orchestration.md §2.1 #5 — minimum
//   context injection (v0.3.25 wires scan output into AgentContext)

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {basename, extname, join, relative, sep} from 'node:path';

/** Per-call config for {@link scanRoot}. */
export interface ScanOptions {
  /** Project root cladding is adopting into. */
  readonly cwd: string;
  /** File extensions to analyse. Default: ts/tsx/js/jsx/mjs/py. */
  readonly extensions?: readonly string[];
  /** Directories skipped during the walk. Default: node_modules, dist, build, .cladding, .git. */
  readonly ignore?: readonly string[];
  /** Hard cap on files scanned to keep cost predictable. Default: 500. */
  readonly maxFiles?: number;
}

/** 14 deterministic convention observations. */
export interface Conventions {
  readonly indent: 'two-space' | 'four-space' | 'tab' | 'mixed';
  readonly quote: 'single' | 'double' | 'mixed';
  readonly semicolon: 'present' | 'absent' | 'mixed';
  readonly namingExports: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
  readonly namingConstants: 'UPPER_SNAKE' | 'camelCase' | 'mixed';
  readonly docBlockRatio: number; // 0..1
  readonly docTagCounts: Readonly<Record<string, number>>;
  readonly importOrder: 'node-first' | 'external-first' | 'mixed' | 'unknown';
  readonly exportPattern: 'named-only' | 'default-mixed' | 'default-primary' | 'unknown';
  readonly errorHandling: 'throw-primary' | 'result-pattern' | 'mixed';
  readonly typeDefLocation: 'inline' | 'types-file' | 'mixed';
  readonly fileHeaderPattern: string | null;
  readonly testLocation: 'sibling-test' | 'tests-dir' | 'tests-and-sibling' | 'none';
  readonly moduleBoilerplate: string | null;
}

/** A top-level directory treated as one architectural layer. */
export interface Layer {
  readonly name: string;
  readonly dir: string;
  readonly moduleCount: number;
}

/** One directed edge in the inferred import graph. */
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

export interface ArchitectureScan {
  readonly layers: readonly Layer[];
  readonly importGraph: readonly ImportEdge[];
}

export interface ScenarioStub {
  readonly slug: string;
  readonly dir: string;
  readonly moduleCount: number;
}

/** Representative module quoted directly into docs/conventions.md. */
export interface ExampleQuote {
  readonly layer: string;
  readonly modulePath: string;
  readonly moduleContent: string;
  readonly testPath?: string;
  readonly testContent?: string;
}

export interface ScanResult {
  readonly conventions: Conventions;
  readonly architecture: ArchitectureScan;
  readonly scenarios: readonly ScenarioStub[];
  readonly examples: readonly ExampleQuote[];
  readonly stats: ScanStats;
}

export interface ScanStats {
  readonly filesScanned: number;
  readonly languagesSeen: readonly string[];
  readonly sourceRoot: string;
}

const DEFAULT_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py'];
const DEFAULT_IGNORE: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  '.cladding',
  '.git',
  'coverage',
  '.next',
  '.nuxt',
];
const DEFAULT_MAX_FILES = 500;

/**
 * Walks the project, collects 14 convention signals, and selects the
 * representative module per top-level directory. Returns a structured
 * ScanResult ready for {@link writeScanArtifacts} or downstream LLM
 * interpretation in scan-llm.ts.
 *
 * The function is intentionally side-effect free — file writes happen
 * in {@link writeScanArtifacts} so callers can preview the diff via
 * `--dry-run` before touching the working tree.
 */
export function scanRoot(opts: ScanOptions): ScanResult {
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const ignore = new Set(opts.ignore ?? DEFAULT_IGNORE);
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;

  // Walk from `cwd` (not `src/`) so `tests/` and other peer
  // directories are reachable; the layer grouping below maps src/<x>
  // → `<x>` so the architecture view stays src-centric.
  const files = walk(opts.cwd, extensions, ignore, maxFiles);
  const filesByLayer = groupByLayer(files);

  return {
    conventions: extractConventions(files),
    architecture: extractArchitecture(files, filesByLayer),
    scenarios: proposeScenarios(filesByLayer),
    examples: pickExamples(filesByLayer),
    stats: {
      filesScanned: files.length,
      languagesSeen: Array.from(new Set(files.map((f) => extname(f.path)))).sort(),
      sourceRoot: opts.cwd,
    },
  };
}

interface SourceFile {
  readonly path: string;
  readonly relPath: string;
  readonly content: string;
  readonly loc: number;
}

function walk(
  root: string,
  extensions: readonly string[],
  ignore: ReadonlySet<string>,
  maxFiles: number,
): readonly SourceFile[] {
  const out: SourceFile[] = [];
  function rec(dir: string): void {
    if (out.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (ignore.has(e) || e.startsWith('.')) continue;
      const abs = join(dir, e);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        rec(abs);
      } else if (s.isFile() && extensions.includes(extname(abs))) {
        const content = readFileSync(abs, 'utf8');
        out.push({
          path: abs,
          relPath: relative(root, abs),
          content,
          loc: content.split('\n').length,
        });
      }
    }
  }
  rec(root);
  return out;
}

/** Resolves the architecture layer for a relative path, collapsing `src/<layer>/...` → `<layer>`. */
function layerOf(relPath: string): string {
  const segments = relPath.split(sep);
  if (segments[0] === 'src' && segments.length > 2) return segments[1];
  if (segments.length > 1) return segments[0];
  return '_root';
}

function groupByLayer(files: readonly SourceFile[]): Map<string, SourceFile[]> {
  // `src/<layer>/...` collapses to `<layer>` so the architecture map
  // stays src-centric even when the walk roots at cwd. Non-src
  // directories (tests/, scripts/, docs/) bucket under their own
  // top-level name; the `_root` bucket catches files at cwd directly.
  const map = new Map<string, SourceFile[]>();
  for (const f of files) {
    const layer = layerOf(f.relPath);
    if (!map.has(layer)) map.set(layer, []);
    map.get(layer)!.push(f);
  }
  return map;
}

// ---- 14 conventions ----------------------------------------------

/** Aggregates 14 convention signals across the file set. */
function extractConventions(files: readonly SourceFile[]): Conventions {
  return {
    indent: detectIndent(files),
    quote: detectQuote(files),
    semicolon: detectSemicolon(files),
    namingExports: detectNamingExports(files),
    namingConstants: detectNamingConstants(files),
    docBlockRatio: detectDocBlockRatio(files),
    docTagCounts: detectDocTagCounts(files),
    importOrder: detectImportOrder(files),
    exportPattern: detectExportPattern(files),
    errorHandling: detectErrorHandling(files),
    typeDefLocation: detectTypeDefLocation(files),
    fileHeaderPattern: detectFileHeaderPattern(files),
    testLocation: detectTestLocation(files),
    moduleBoilerplate: detectModuleBoilerplate(files),
  };
}

function detectIndent(files: readonly SourceFile[]): Conventions['indent'] {
  let two = 0;
  let four = 0;
  let tab = 0;
  for (const f of files) {
    for (const line of f.content.split('\n')) {
      if (line.startsWith('\t')) tab++;
      else if (line.startsWith('    ') && !line.startsWith('     ')) four++;
      else if (line.startsWith('  ') && !line.startsWith('   ')) two++;
    }
  }
  const max = Math.max(two, four, tab);
  if (max === 0) return 'mixed';
  if (max === two && two > four * 2 && two > tab * 2) return 'two-space';
  if (max === four && four > two * 2 && four > tab * 2) return 'four-space';
  if (max === tab && tab > two * 2 && tab > four * 2) return 'tab';
  return 'mixed';
}

function detectQuote(files: readonly SourceFile[]): Conventions['quote'] {
  let single = 0;
  let double = 0;
  for (const f of files) {
    single += (f.content.match(/'/g) ?? []).length;
    double += (f.content.match(/"/g) ?? []).length;
  }
  if (single > double * 2) return 'single';
  if (double > single * 2) return 'double';
  return 'mixed';
}

function detectSemicolon(files: readonly SourceFile[]): Conventions['semicolon'] {
  let withSemi = 0;
  let withoutSemi = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    for (const line of f.content.split('\n')) {
      const t = line.trim();
      if (t.length === 0 || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      if (t.endsWith(';')) withSemi++;
      else if (t.endsWith(')') || t.endsWith('}') || t.endsWith(',')) withoutSemi++;
    }
  }
  if (withSemi > withoutSemi * 3) return 'present';
  if (withoutSemi > withSemi * 3) return 'absent';
  return 'mixed';
}

function isJsLike(p: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs)$/.test(p);
}

function detectNamingExports(files: readonly SourceFile[]): Conventions['namingExports'] {
  let camel = 0;
  let snake = 0;
  let pascal = 0;
  for (const f of files) {
    for (const m of f.content.matchAll(/^\s*export\s+(?:const|function|let|var|class)\s+(\w+)/gm)) {
      const name = m[1];
      if (/^[A-Z]/.test(name)) pascal++;
      else if (name.includes('_')) snake++;
      else camel++;
    }
  }
  const max = Math.max(camel, snake, pascal);
  if (max === 0) return 'mixed';
  if (max === camel && camel > snake * 2 && camel > pascal * 2) return 'camelCase';
  if (max === snake && snake > camel * 2 && snake > pascal * 2) return 'snake_case';
  if (max === pascal && pascal > camel * 2 && pascal > snake * 2) return 'PascalCase';
  return 'mixed';
}

function detectNamingConstants(files: readonly SourceFile[]): Conventions['namingConstants'] {
  let upper = 0;
  let camel = 0;
  for (const f of files) {
    for (const m of f.content.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/gm)) {
      const name = m[1];
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) upper++;
      else if (/^[a-z]/.test(name)) camel++;
    }
  }
  if (upper > camel * 0.3) return 'UPPER_SNAKE';
  if (camel > upper * 3) return 'camelCase';
  return 'mixed';
}

function detectDocBlockRatio(files: readonly SourceFile[]): number {
  let funcs = 0;
  let docBlocks = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    funcs += (f.content.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/gm) ?? []).length;
    docBlocks += (f.content.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
  }
  if (funcs === 0) return 0;
  return Math.min(1, docBlocks / funcs);
}

function detectDocTagCounts(files: readonly SourceFile[]): Readonly<Record<string, number>> {
  const tags = ['@param', '@returns', '@throws', '@example', '@see', '@deprecated'];
  const counts: Record<string, number> = {};
  for (const tag of tags) {
    let c = 0;
    for (const f of files) {
      if (!isJsLike(f.relPath)) continue;
      c += (f.content.match(new RegExp(tag, 'g')) ?? []).length;
    }
    counts[tag] = c;
  }
  return counts;
}

function detectImportOrder(files: readonly SourceFile[]): Conventions['importOrder'] {
  let nodeFirst = 0;
  let externalFirst = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    const lines = f.content.split('\n');
    let firstNode = -1;
    let firstExternal = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t.startsWith('import ')) continue;
      const m = t.match(/from\s+['"]([^'"]+)['"]/);
      if (!m) continue;
      const src = m[1];
      if (src.startsWith('node:')) {
        if (firstNode === -1) firstNode = i;
      } else if (!src.startsWith('.') && !src.startsWith('/')) {
        if (firstExternal === -1) firstExternal = i;
      }
    }
    if (firstNode !== -1 && firstExternal !== -1) {
      if (firstNode < firstExternal) nodeFirst++;
      else externalFirst++;
    }
  }
  if (nodeFirst === 0 && externalFirst === 0) return 'unknown';
  if (nodeFirst > externalFirst * 2) return 'node-first';
  if (externalFirst > nodeFirst * 2) return 'external-first';
  return 'mixed';
}

function detectExportPattern(files: readonly SourceFile[]): Conventions['exportPattern'] {
  let named = 0;
  let defaults = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    named += (f.content.match(/^\s*export\s+(?:const|function|let|class|interface|type|enum)\s/gm) ?? [])
      .length;
    defaults += (f.content.match(/^\s*export\s+default\s/gm) ?? []).length;
  }
  if (defaults === 0 && named > 0) return 'named-only';
  if (named === 0 && defaults > 0) return 'default-primary';
  if (defaults > named) return 'default-primary';
  if (defaults > 0) return 'default-mixed';
  return 'unknown';
}

function detectErrorHandling(files: readonly SourceFile[]): Conventions['errorHandling'] {
  let throws = 0;
  let results = 0;
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    throws += (f.content.match(/\bthrow\s+new\s+/g) ?? []).length;
    results += (f.content.match(/return\s+\{\s*(?:ok|success|pass)\s*:\s*(?:false|true)/g) ?? []).length;
  }
  if (throws > results * 3) return 'throw-primary';
  if (results > throws * 2) return 'result-pattern';
  return 'mixed';
}

function detectTypeDefLocation(files: readonly SourceFile[]): Conventions['typeDefLocation'] {
  const typesFiles = files.filter((f) => /\btypes?\.ts$/.test(f.relPath));
  const inlineTypeFiles = files.filter((f) =>
    isJsLike(f.relPath) && /^\s*(?:export\s+)?(?:interface|type)\s+\w+/m.test(f.content),
  );
  if (typesFiles.length === 0) return 'inline';
  if (typesFiles.length >= 2 && inlineTypeFiles.length < typesFiles.length * 5) return 'types-file';
  return 'mixed';
}

function detectFileHeaderPattern(files: readonly SourceFile[]): string | null {
  const samples: string[] = [];
  for (const f of files.slice(0, 20)) {
    if (!isJsLike(f.relPath)) continue;
    const firstLine = f.content.split('\n', 1)[0]?.trim() ?? '';
    if (firstLine.startsWith('//') || firstLine.startsWith('/*')) samples.push(firstLine);
  }
  if (samples.length === 0) return null;
  // Prefer the most common literal prefix (first 20 chars) to capture
  // patterns like `// Cladding ·` without overfitting to one path.
  const prefixCount = new Map<string, number>();
  for (const s of samples) {
    const p = s.slice(0, 24);
    prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const entry of prefixCount) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best ? best[0] : null;
}

function detectTestLocation(files: readonly SourceFile[]): Conventions['testLocation'] {
  let sibling = 0;
  let tests = 0;
  for (const f of files) {
    if (/\.test\.[jt]sx?$/.test(f.relPath)) {
      if (f.relPath.startsWith(`tests${sep}`) || f.relPath.includes(`${sep}tests${sep}`)) tests++;
      else sibling++;
    }
  }
  if (sibling === 0 && tests === 0) return 'none';
  if (sibling > 0 && tests > 0) return 'tests-and-sibling';
  if (tests > 0) return 'tests-dir';
  return 'sibling-test';
}

function detectModuleBoilerplate(files: readonly SourceFile[]): string | null {
  // Heuristic: the smallest JS-like module containing a file header
  // plus at least one named export is the closest thing to a typical
  // "new module" template. We trim to the first 40 lines so the
  // boilerplate stays representative without quoting a whole file.
  const candidates = files
    .filter((f) => isJsLike(f.relPath) && /^\/\//.test(f.content) && /\bexport\s+/.test(f.content))
    .sort((a, b) => a.loc - b.loc);
  const pick = candidates[0];
  if (!pick) return null;
  return pick.content.split('\n').slice(0, 40).join('\n');
}

// ---- architecture & scenarios ------------------------------------

function extractArchitecture(
  files: readonly SourceFile[],
  filesByLayer: ReadonlyMap<string, SourceFile[]>,
): ArchitectureScan {
  const layers: Layer[] = [];
  for (const [name, layerFiles] of filesByLayer) {
    if (name === '_root') continue;
    layers.push({
      name,
      dir: name,
      moduleCount: layerFiles.length,
    });
  }
  layers.sort((a, b) => a.name.localeCompare(b.name));

  const edgeMap = new Map<string, number>();
  for (const f of files) {
    if (!isJsLike(f.relPath)) continue;
    const fromLayer = layerOf(f.relPath);
    for (const m of f.content.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = m[1];
      const ups = target.match(/^(\.\.\/)+/);
      if (!ups) continue;
      // ../<layer>/...
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
  return {layers, importGraph};
}

function proposeScenarios(filesByLayer: ReadonlyMap<string, SourceFile[]>): readonly ScenarioStub[] {
  const out: ScenarioStub[] = [];
  for (const [name, files] of filesByLayer) {
    if (name === '_root') continue;
    out.push({slug: `${name}-flow`, dir: name, moduleCount: files.length});
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

function pickExamples(filesByLayer: ReadonlyMap<string, SourceFile[]>): readonly ExampleQuote[] {
  // Centrality is approximated as LOC — the densest module per layer
  // typically reflects the most idiomatic patterns. Test pairing
  // finds a sibling `<name>.test.<ext>` when present; otherwise leaves
  // the test fields undefined so the LLM stage can note the absence.
  const out: ExampleQuote[] = [];
  for (const [layer, files] of filesByLayer) {
    if (layer === '_root') continue;
    const code = files
      .filter((f) => !/\.test\.[jt]sx?$/.test(f.relPath))
      .sort((a, b) => b.loc - a.loc)[0];
    if (!code) continue;
    const base = basename(code.relPath, extname(code.relPath));
    const test = files.find(
      (f) =>
        /\.test\.[jt]sx?$/.test(f.relPath) &&
        basename(f.relPath, extname(f.relPath)).startsWith(`${base}.test`),
    );
    out.push({
      layer,
      modulePath: code.relPath,
      moduleContent: code.content.split('\n').slice(0, 80).join('\n'),
      testPath: test?.relPath,
      testContent: test ? test.content.split('\n').slice(0, 60).join('\n') : undefined,
    });
  }
  out.sort((a, b) => a.layer.localeCompare(b.layer));
  return out;
}
