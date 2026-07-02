// Cladding · toolchain · language file-convention config
//
// The polyglot adapter's *second half*. `detectToolchain` answers "which
// command runs each gate"; this module answers "where does this language
// keep its source, what extension does it use, how are imports written" —
// the facts the drift detectors need so they stop hardcoding `.ts` / `src/`
// / the vitest coverage path.
//
// Design rule — no regression: only languages with an explicit entry below
// diverge from the TypeScript baseline. Every other language (python, rust,
// go, …) resolves to the TS config, which is byte-for-byte what the
// detectors assumed before this module existed. So adding Kotlin changes
// Kotlin behaviour and nothing else.

import {detectToolchain} from './detect.js';
import type {Language} from './types.js';

/** How a detector should read a language's source layout and import syntax. */
export interface LanguageConfig {
  /** Primary source extension without the leading dot (e.g. `'ts'`, `'kt'`). */
  readonly ext: string;
  /** All source extensions, with leading dot, used when walking a tree. */
  readonly extensions: readonly string[];
  /** Directories that hold source the detectors should inspect. */
  readonly sourceRoots: readonly string[];
  /**
   * The root under which architectural *layer* directories live. For TS this
   * is `src`; for Kotlin it is `src/main/kotlin`. Layer checks join
   * `<mainRoot>/<layer>`.
   */
  readonly mainRoot: string;
  /** Globs (relative to cwd) matching the language's test files. */
  readonly testGlobs: readonly string[];
  /** Coverage artifact a prior gate run leaves behind. */
  readonly coverageSummary: string;
  /** How {@link coverageSummary} is encoded. */
  readonly coverageFormat: 'istanbul-json' | 'jacoco-xml';
  /** Global regex capturing the imported module/package in group 1. */
  readonly importMatcher: RegExp;
  /**
   * How {@link importMatcher}'s capture is interpreted by a layer check:
   * `relative` — TS/ES `./a/b` path segments; `dotted` — JVM `a.b.C` package
   * segments.
   */
  readonly importStyle: 'relative' | 'dotted';
}

// ES module import matcher — captures the from-string for both
// `import X from '...'` and `import('...')` forms. (Lifted verbatim from the
// original ARCHITECTURE_FROM_SPEC detector so TS behaviour is unchanged.)
const ES_IMPORT_RE = /(?:import\s+(?:[\s\S]*?\sfrom\s+)?|import\s*\()['"]([^'"]+)['"]\)?/g;

// JVM import matcher — `import a.b.C`, `import a.b.C as D`, `import a.b.*`.
const JVM_IMPORT_RE = /^[ \t]*import\s+([\w.]+)/gm;

const TS_CONFIG: LanguageConfig = {
  ext: 'ts',
  extensions: ['.ts', '.tsx'],
  sourceRoots: ['src'],
  mainRoot: 'src',
  testGlobs: ['tests/**/*.test.ts'],
  coverageSummary: 'coverage/coverage-summary.json',
  coverageFormat: 'istanbul-json',
  importMatcher: ES_IMPORT_RE,
  importStyle: 'relative',
};

const KOTLIN_CONFIG: LanguageConfig = {
  ext: 'kt',
  extensions: ['.kt', '.kts'],
  sourceRoots: ['src/main/kotlin', 'src/test/kotlin'],
  mainRoot: 'src/main/kotlin',
  testGlobs: ['src/test/kotlin/**/*Test.kt', 'src/test/kotlin/**/*Tests.kt'],
  // Gradle JaCoCo's default XML report location (jacocoTestReport task).
  coverageSummary: 'build/reports/jacoco/test/jacocoTestReport.xml',
  coverageFormat: 'jacoco-xml',
  importMatcher: JVM_IMPORT_RE,
  importStyle: 'dotted',
};

/**
 * Languages with file conventions that diverge from the TS baseline. Anything
 * not listed here intentionally resolves to {@link TS_CONFIG} — that is the
 * no-regression default the detectors relied on before this module.
 */
const CONFIGS: Partial<Record<Language, LanguageConfig>> = {
  typescript: TS_CONFIG,
  kotlin: KOTLIN_CONFIG,
};

/**
 * Extensions cladding watches for the PostToolUse impact card (F-63b989e5),
 * lowercased and dot-prefixed. Built from every registered
 * {@link LanguageConfig.extensions} (TS `.ts .tsx`, Kotlin `.kt .kts`) unioned
 * with a supplement table for the languages cladding *claims* to support but
 * that do not yet carry a full LanguageConfig entry — they resolve to
 * {@link TS_CONFIG} today (see {@link CONFIGS}), so their extensions live here
 * until each grows its own entry. This is the single place to update when a new
 * language is added, so the impact card never silently omits a claimed language.
 */
const SUPPLEMENTAL_EXTENSIONS: readonly string[] = [
  // JS/TS family beyond the TS entry's own `.ts` / `.tsx`.
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  // Languages with no full LanguageConfig entry yet (all resolve to TS_CONFIG).
  '.py',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.cs',
  '.fs',
  '.ex',
  '.exs',
];

export const WATCHED_EXTENSIONS: ReadonlySet<string> = new Set<string>(
  [...Object.values(CONFIGS).flatMap((c) => c?.extensions ?? []), ...SUPPLEMENTAL_EXTENSIONS].map((e) =>
    e.toLowerCase(),
  ),
);

/**
 * Resolves the {@link LanguageConfig} for a project. Prefers the explicit
 * `spec.project.language` (cheap, no filesystem walk) and falls back to
 * manifest detection; unknown or unlisted languages get the TS baseline.
 *
 * @param cwd  Project root (only consulted when no spec language is given).
 * @param specLanguage  The free-form `spec.project.language` string, if known.
 */
export function resolveLanguageConfig(cwd: string = '.', specLanguage?: string): LanguageConfig {
  const declared = (specLanguage ?? '').trim().toLowerCase();
  const lang = (declared || detectToolchain(cwd).language) as Language;
  return CONFIGS[lang] ?? TS_CONFIG;
}
