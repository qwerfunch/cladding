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

import {inferSourceRoots, type SourceRoot} from './scan-roots.js';

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
  /**
   * Explicit source-root override (e.g. `--roots packages/a/src,packages/b/src`).
   * When unset, {@link inferSourceRoots} probes manifests + heuristics; an empty
   * inferred set means the scanner walks cwd directly and `layerOf` uses the
   * top-level directory name verbatim.
   */
  readonly roots?: readonly string[];
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
  /**
   * Layer pairs with no observed import edge — surfaces as
   * `forbidden_imports` candidates in the generated
   * `spec/architecture.yaml`. The key is the importing layer, the
   * value lists layers it currently never imports from. A reviewer
   * (or the LLM dispatcher in v0.3.26) decides which candidates
   * become real prohibitions.
   */
  readonly forbiddenImportCandidates: Readonly<Record<string, readonly string[]>>;
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
  /**
   * v0.3.27 — per-language file counts so callers can pick the
   * dominant language by majority instead of guessing from the
   * project manifest. `detectToolchain` (src/stages/toolchain/
   * detect.ts) prefers package.json, which mis-identifies polyglot
   * repos that ship a package.json for tooling but are actually
   * Python / Ruby / Go.
   */
  readonly languageCounts: Readonly<Record<string, number>>;
  /** Most-common language inferred from file extensions; falls back to 'unknown'. */
  readonly dominantLanguage: string;
  readonly sourceRoot: string;
}

// v0.3.26 polyglot expansion (audit 2026-05-20 P0 fix). Until this
// patch the scanner saw .ts/.js/.py only — Go/Rust/Java/C# repos
// produced an empty `architecture.yaml`. The list below covers the
// nine languages cladding advertises plus a few common companions
// (TSX/JSX, mjs, Kotlin scripts, Elixir, C++). Single-bundle
// philosophy stays intact: no external parsers, just file walking.
const DEFAULT_EXTENSIONS: readonly string[] = [
  // JS/TS family
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  // Polyglot 9 languages
  '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.rb', '.php', '.swift',
  // Common additions
  '.ex', '.exs', '.scala', '.dart',
  '.cpp', '.cc', '.cxx', '.hpp', '.h',
];

// Tooling output + language caches that should never enter the walk.
// Peer directories (tests/, docs/, examples/, ...) move to
// {@link LAYER_BLACKLIST} so the walker still sees their files
// (so testLocation detection works) but groupByLayer / proposeScenarios
// skip them when building the architecture view.
const DEFAULT_IGNORE: readonly string[] = [
  // Tooling output
  'node_modules', 'dist', 'build', '.cladding', '.git', 'coverage',
  '.next', '.nuxt', 'target', 'vendor', '.bundle',
  // Language runtimes / caches
  'venv', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.gradle', '.idea', '.vscode',
];

// Peer directories scan walks but does NOT treat as architectural
// layers. The audit (2026-05-20 P0) found commander, express,
// fastapi, and similar repos surfacing tests/, docs/, examples/ as
// if they were layers — they're not. Files inside still feed
// testLocation, docstring counts, etc., but groupByLayer hides them.
// Case-insensitive: `Tests/`, `Playground/`, etc. also blacklist.
const LAYER_BLACKLIST: ReadonlySet<string> = new Set([
  'tests', 'test', '__tests__', 'spec', 'specs',
  'docs', 'doc', 'examples', 'example', 'sample', 'samples',
  'typings', 'e2e', 'integration', '__fixtures__', 'fixtures',
  'benchmark', 'benchmarks', 'bench',
  'playground', 'playgrounds', 'demo', 'demos',
]);
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

  // Walk from `cwd` so `tests/` and other peer directories are
  // reachable; layer resolution below uses the inferred source roots
  // to keep the architecture view consistent across project shapes
  // (cladding's flat `src/`, monorepo `packages/*/src/`, Go's
  // `cmd/` + `internal/` + `pkg/`, …).
  const roots = inferSourceRoots({cwd: opts.cwd, override: opts.roots});
  const files = walk(opts.cwd, extensions, ignore, maxFiles);
  const filesByLayer = groupByLayer(files, roots, opts.cwd);

  return {
    conventions: extractConventions(files),
    architecture: extractArchitecture(files, filesByLayer, roots),
    scenarios: proposeScenarios(filesByLayer),
    examples: pickExamples(filesByLayer),
    stats: buildStats(files, opts.cwd),
  };
}

/** Maps a file extension to a normalised language label. */
const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.ex': 'elixir', '.exs': 'elixir',
  '.scala': 'scala',
  '.dart': 'dart',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.h': 'cpp',
};

function buildStats(files: readonly SourceFile[], cwd: string): ScanStats {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const lang = EXT_TO_LANGUAGE[extname(f.path)] ?? 'other';
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  // Pick the dominant language by file count; fall back to 'unknown'
  // when no recognised extension is in the count map.
  let dominant: [string, number] | null = null;
  for (const entry of Object.entries(counts)) {
    if (!dominant || entry[1] > dominant[1]) dominant = entry;
  }
  return {
    filesScanned: files.length,
    languagesSeen: Array.from(new Set(files.map((f) => extname(f.path)))).sort(),
    languageCounts: counts,
    dominantLanguage: dominant?.[0] ?? 'unknown',
    sourceRoot: cwd,
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
      // Ignore-match is case-insensitive for tooling caches; peer
      // directories (tests/, docs/) are no longer ignored at walk
      // time — they reach groupByLayer where LAYER_BLACKLIST hides
      // them from the architecture view but lets the convention
      // analyzer still see *.test.* and friends.
      if (ignore.has(e) || ignore.has(e.toLowerCase()) || e.startsWith('.')) continue;
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

/**
 * Resolves the architecture layer for a relative path.
 *
 * The roots argument is the inferred {@link SourceRoot} set:
 *   - If `relPath` lives under a root, the layer is the first segment
 *     *inside* that root. Monorepo roots prefix it with their
 *     `workspaceName:` so two workspaces with the same internal layer
 *     name don't collide.
 *   - Otherwise the layer is the file's top-level directory (matches
 *     the v0.3.24 fallback so `tests/`, `scripts/`, etc. stay visible).
 *   - Files at cwd directly bucket under `_root`.
 */
export function layerOf(relPath: string, roots: readonly SourceRoot[]): string {
  for (const r of roots) {
    if (r.relPath === '') continue;
    const prefix = `${r.relPath}/`;
    if (relPath === r.relPath || relPath.startsWith(prefix)) {
      const inside = relPath.slice(prefix.length).split('/');
      // I12 (v0.3.27) — direct files inside a workspace src root used
      // to skip layer assignment entirely (the `inside.length < 2`
      // guard). That left react's `packages/react/src/ReactAct.js`
      // and friends invisible from the architecture view. Surface
      // them under the workspace's own name so the workspace stays
      // a layer even when its src/ is flat.
      if (inside.length === 1) {
        return r.workspaceName ?? '_root';
      }
      if (inside.length === 0) continue;
      const layer = inside[0];
      return r.workspaceName ? `${r.workspaceName}:${layer}` : layer;
    }
  }
  const segments = relPath.split(sep);
  if (segments.length > 1) return segments[0];
  return '_root';
}

/** Modules-at-cwd-root threshold above which `_root` promotes to a real layer. */
const ROOT_PROMOTION_THRESHOLD = 5;

function groupByLayer(
  files: readonly SourceFile[],
  roots: readonly SourceRoot[],
  cwd: string,
): Map<string, SourceFile[]> {
  const map = new Map<string, SourceFile[]>();
  for (const f of files) {
    const layer = layerOf(f.relPath, roots);
    if (LAYER_BLACKLIST.has(layer.toLowerCase())) continue;
    // Monorepo workspace layers (`<ws>:<inner>`) — exclude when the
    // inner segment matches the blacklist (`<ws>:tests`, …).
    const colonIdx = layer.indexOf(':');
    if (colonIdx > 0 && LAYER_BLACKLIST.has(layer.slice(colonIdx + 1).toLowerCase())) continue;
    if (!map.has(layer)) map.set(layer, []);
    map.get(layer)!.push(f);
  }
  // I11 (v0.3.27) — flat single-package projects (Go's cobra is the
  // canonical example) put every source file at cwd directly, so the
  // `_root` bucket ends up holding the real work surface. Promote it
  // to a named layer using cwd's basename when the bucket carries
  // more than the threshold so cobra-style repos no longer report
  // zero layers.
  const rootBucket = map.get('_root');
  if (rootBucket && rootBucket.length >= ROOT_PROMOTION_THRESHOLD) {
    const promotedName = basename(cwd) || 'root';
    if (!map.has(promotedName)) {
      map.set(promotedName, rootBucket);
      map.delete('_root');
    }
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

/**
 * Counts function declarations and matching doc blocks across the
 * file set. v0.3.26 expands the language matrix beyond JS/TS to
 * Python (def + triple-quoted strings), Go (func + leading //
 * block), Rust (fn + /// block), Swift (func + ///), Java/Kotlin
 * (JavaDoc-shape /** block), and Ruby (def + leading # block).
 * Heuristics stay regex-only — no AST — so a function with a doc
 * block counts on co-presence in the same file, not strict
 * adjacency. Matches the existing TSDoc ratio behaviour and keeps
 * single-bundle runtime free of language-specific parsers.
 */
function detectDocBlockRatio(files: readonly SourceFile[]): number {
  let funcs = 0;
  let docBlocks = 0;
  for (const f of files) {
    if (isJsLike(f.relPath) || /\.(java|kt|kts|cpp|cc|cxx|hpp|h|cs|scala|dart)$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/gm) ?? []).length;
      funcs += (f.content.match(/^\s*(?:public|private|protected|internal|static|fun|def)\s+[\w<>]+\s+\w+\s*\(/gm) ?? []).length;
      docBlocks += (f.content.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
    } else if (/\.pyi?$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:async\s+)?def\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/"""[\s\S]*?"""/g) ?? []).length;
      docBlocks += (f.content.match(/'''[\s\S]*?'''/g) ?? []).length;
    } else if (/\.go$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*func\s+(?:\([^)]+\)\s+)?\w+/gm) ?? []).length;
      // godoc convention: at least one `//` line directly above the func.
      docBlocks += (f.content.match(/(?:^\s*\/\/[^\n]*\n)+\s*func\s+/gm) ?? []).length;
    } else if (/\.rs$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/(?:^\s*\/\/\/[^\n]*\n)+/gm) ?? []).length;
    } else if (/\.swift$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*(?:public|private|internal|fileprivate|open)?\s*func\s+\w+/gm) ?? []).length;
      docBlocks += (f.content.match(/(?:^\s*\/\/\/[^\n]*\n)+/gm) ?? []).length;
    } else if (/\.rb$/.test(f.relPath)) {
      funcs += (f.content.match(/^\s*def\s+\w+/gm) ?? []).length;
      // RDoc convention: leading `#` block above the def.
      docBlocks += (f.content.match(/(?:^\s*#[^\n]*\n)+\s*def\s+/gm) ?? []).length;
    }
  }
  if (funcs === 0) return 0;
  return Math.min(1, docBlocks / funcs);
}

/**
 * Counts doc-comment tags across the file set. Recognises the union
 * of the conventions cladding's `docs/code-style.md` policy already
 * names (JSDoc/TSDoc, Java/Kotlin JavaDoc-shape) plus Python's
 * Google-style headings and rustdoc / godoc sentinels added in v0.3.26.
 */
function detectDocTagCounts(files: readonly SourceFile[]): Readonly<Record<string, number>> {
  const tags = ['@param', '@returns', '@throws', '@example', '@see', '@deprecated'];
  const counts: Record<string, number> = {};
  for (const tag of tags) {
    let c = 0;
    for (const f of files) {
      if (!isJsLike(f.relPath) && !/\.(java|kt|kts|cpp|cs|scala|dart)$/.test(f.relPath)) continue;
      c += (f.content.match(new RegExp(tag, 'g')) ?? []).length;
    }
    counts[tag] = c;
  }
  // Python Google-style docstring sections — surface separately so the
  // conventions doc names the right vocabulary instead of forcing
  // `@param` onto a Python codebase.
  for (const section of ['Args:', 'Returns:', 'Raises:', 'Examples:']) {
    let c = 0;
    for (const f of files) {
      if (!/\.pyi?$/.test(f.relPath)) continue;
      c += (f.content.match(new RegExp(section, 'g')) ?? []).length;
    }
    if (c > 0) counts[section] = c;
  }
  // godoc + rustdoc sentinels.
  let goDeprecated = 0;
  let rustErrors = 0;
  let rustSafety = 0;
  for (const f of files) {
    if (/\.go$/.test(f.relPath)) {
      goDeprecated += (f.content.match(/Deprecated:/g) ?? []).length;
    } else if (/\.rs$/.test(f.relPath)) {
      rustErrors += (f.content.match(/^\s*\/\/\/\s*#\s*Errors/gm) ?? []).length;
      rustSafety += (f.content.match(/^\s*\/\/\/\s*#\s*Safety/gm) ?? []).length;
    }
  }
  if (goDeprecated > 0) counts['Deprecated:'] = goDeprecated;
  if (rustErrors > 0) counts['# Errors'] = rustErrors;
  if (rustSafety > 0) counts['# Safety'] = rustSafety;
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
  roots: readonly SourceRoot[],
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
    const fromLayer = layerOf(f.relPath, roots);
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

  // Forbidden import candidates: every layer pair that never co-occurs
  // in the observed import graph. This is a coarse heuristic — a
  // genuinely useful pair may simply not have been needed yet — so
  // architecture.yaml surfaces these as suggestions, not enforced
  // rules. A reviewer (or the LLM dispatcher in v0.3.26) prunes the
  // list before committing.
  const seen = new Set<string>();
  for (const e of importGraph) seen.add(`${e.from}→${e.to}`);
  const layerNames = layers.map((l) => l.name);
  const forbiddenImportCandidates: Record<string, string[]> = {};
  for (const from of layerNames) {
    const candidates: string[] = [];
    for (const to of layerNames) {
      if (from === to) continue;
      if (!seen.has(`${from}→${to}`)) candidates.push(to);
    }
    if (candidates.length > 0) forbiddenImportCandidates[from] = candidates;
  }
  return {layers, importGraph, forbiddenImportCandidates};
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
