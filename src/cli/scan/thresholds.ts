// Cladding · scan · tunable defaults
//
// All magic numbers + name sets are gathered here so external
// adopters can override them through {@link ScanOptions}.
//
// Changing a default has audit-wide implications — every release
// note that calls out a heuristic adjustment names the constant it
// touched, so reviewers can grep the changelog.
//
// @see ironclad-design/07-ssot-init.md §3 B

/** Maximum files admitted by the BFS walker in a single scan. */
export const DEFAULT_MAX_FILES = 500;

/**
 * Per-directory soft cap. Once a single directory contributes this
 * many files, the walker moves on so a deep subtree cannot starve
 * its siblings (v0.3.28 BFS introduction, audit I14).
 */
export const PER_DIR_SOFT_CAP = 50;

/**
 * `_root` bucket promotion threshold. When a project drops 5+
 * source files directly at cwd (Go single-package layout), the
 * bucket promotes to a layer named after `basename(cwd)`.
 */
export const ROOT_PROMOTION_THRESHOLD = 5;

/**
 * File extensions the walker considers. Covers the 9 official
 * polyglot languages plus common companions (TSX/JSX, .mjs/.cjs,
 * .kts Kotlin scripts, .ex/.exs Elixir, C++ headers).
 *
 * @see v0.3.26 release notes — polyglot expansion (audit P0 fix)
 */
export const DEFAULT_EXTENSIONS: readonly string[] = [
  // JS / TS family
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  // Polyglot 9 languages
  '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.rb', '.php', '.swift',
  // Common additions
  '.ex', '.exs', '.scala', '.dart',
  '.cpp', '.cc', '.cxx', '.hpp', '.h',
];

/**
 * Directories the walker never enters. Tooling caches, build
 * outputs, language runtimes — never source. Match is
 * case-insensitive at use site.
 */
export const DEFAULT_IGNORE: readonly string[] = [
  // Tooling output
  'node_modules', 'dist', 'build', '.cladding', '.git', 'coverage',
  '.next', '.nuxt', 'target', 'vendor', '.bundle',
  // Language runtimes / caches
  'venv', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.gradle', '.idea', '.vscode',
];

/**
 * Peer directories scan walks but does NOT treat as architectural
 * layers. The 2026-05-20 audit found commander, express, fastapi,
 * etc. surfacing tests/, docs/, examples/ as if they were layers —
 * they're not. Files inside still feed testLocation, docstring
 * counts, etc., but groupByLayer hides them from the architecture
 * view. Case-insensitive: `Tests/`, `Playground/`, etc. also
 * blacklist.
 */
export const LAYER_BLACKLIST: ReadonlySet<string> = new Set([
  // Tests
  'tests', 'test', '__tests__', 'spec', 'specs',
  // Documentation
  'docs', 'doc', 'docs_src', 'documentation',
  // Examples / samples / playgrounds
  'examples', 'example', 'sample', 'samples',
  'playground', 'playgrounds', 'demo', 'demos',
  // Types-only
  'typings', 'types',
  // Test-shape directories
  'e2e', 'integration', '__fixtures__', 'fixtures',
  'benchmark', 'benchmarks', 'bench',
  // Packaging / distribution (audit 2026-05-20 I18 — ripgrep
  // HomebrewFormula, sphinx docs_src, etc.). `scripts` / `tools`
  // are intentionally NOT blacklisted because some projects keep
  // genuine source there.
  'homebrewformula', 'formulas', 'packaging',
]);

/**
 * File stems treated as conventional entry points. Sorted to the
 * head of each directory's file list so layer identity survives
 * even when {@link PER_DIR_SOFT_CAP} truncates the tail.
 *
 * Covers JS/TS (index, main, app, server, client), Python
 * (__init__, __main__), Rust (lib, mod), Go (doc), and the
 * capitalised forms common to C# / Java / Kotlin (Program, Main,
 * App). Lookup is case-insensitive at use site.
 */
export const ENTRYPOINT_NAMES: ReadonlySet<string> = new Set([
  'index', 'main', 'app', 'server', 'client',
  '__init__', '__main__',
  'lib', 'mod',
  'doc',
  'Program', 'Main', 'App',
]);

/**
 * Maps a file extension to a normalised language label.
 *
 * Owned by `core/language-evidence.ts` since F-9e1279d4 and re-exported
 * here so the scan layer's import surface is unchanged. The map moved to
 * the foundation tier because the drift detectors need the same
 * vocabulary and the architecture forbids `stages → cli`; when scan and
 * the detectors read different tables, `clad init` seeds labels the gate
 * then rejects.
 */
export {EXT_TO_LANGUAGE} from '../../core/language-evidence.js';
