// Cladding · core · source-language vocabulary + observed distribution
//
// Three divergent language tables used to live in three layers (the scan
// layer's extension map, the toolchain chain, the unmapped-artifact
// extension-by-language map). `clad init` could therefore seed a label —
// `cpp`, `rust` — that the detector layer then refused under `--strict`,
// with zero user error. The fix is a single vocabulary, owned by the
// foundation tier so BOTH the scan layer (cli) and the drift detectors
// (stages) can import it: the architecture forbids `stages → cli`, so
// there is no other legal shared home.
//
// The second export answers the question a detector actually has —
// "what language IS this tree?" — from the files on disk rather than
// from a build manifest. A build manifest names the build host (gradle
// says java), which is the right answer for "what command do we run"
// and the wrong answer for project identity.
//
// Deterministic + synchronous by contract (Iron Law): filesystem reads
// only, no LLM, never throws. An unreadable directory is skipped, not
// raised, so a permission-denied subtree can never break a gate run.
//
// @see F-9e1279d4 — language evidence core.

import {readdirSync, type Dirent} from 'node:fs';
import {extname, join} from 'node:path';

/**
 * Maps a file extension to a normalised language label. The single
 * vocabulary for the whole toolchain — the scan layer re-exports this
 * from `cli/scan/thresholds.ts` so existing scan imports are unchanged.
 */
export const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
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

/**
 * Every language label {@link EXT_TO_LANGUAGE} can produce. A declared
 * `spec.project.language` outside this set is unknown to cladding, not
 * wrong — callers must treat absence here as "cannot judge", never as drift.
 */
export const LANGUAGE_VOCABULARY: ReadonlySet<string> = new Set(Object.values(EXT_TO_LANGUAGE));

/**
 * Directories the walk never enters: vendored dependencies, build
 * output, coverage reports, and cladding's own runtime state. Any
 * dot-directory is skipped too (see {@link classifySources}), so `.git`
 * and `.cladding` are listed only for readability.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  'coverage', 'target', 'vendor', '.cladding',
]);

/**
 * Hard cap on files visited by one {@link classifySources} walk. A drift
 * detector calls this on EVERY gate run, so the walk must be bounded
 * rather than proportional to repository size: at the cap the walk stops
 * and the counts collected so far are returned. 20 000 files is roughly
 * an order of magnitude above cladding's own source tree and still costs
 * only a few hundred milliseconds of `readdirSync`, so a monorepo slows
 * the gate by a bounded amount instead of an unbounded one. The
 * distribution is a ratio, and a 20 000-file sample settles a ratio.
 *
 * Below the cap the result is fully determined by the tree contents; a
 * tree that exceeds the cap is sampled in directory-read order, so its
 * ratio is an estimate rather than a census. Consumers therefore compare
 * the distribution against wide bands, never against exact counts.
 */
export const MAX_FILES = 20_000;

/** The observed source-language distribution of one project tree. */
export interface SourceEvidence {
  /** Files counted per language label; languages with zero files are absent. */
  readonly counts: Readonly<Record<string, number>>;
  /** Total files whose extension was in the vocabulary. */
  readonly classified: number;
  /** The language labels observed, sorted alphabetically. */
  readonly set: readonly string[];
  /** Most-seen language (alphabetical tie-break), or null when nothing was classified. */
  readonly dominant: string | null;
  /**
   * Fraction of classified files written in `language`, in [0, 1].
   * Zero for an unobserved language and for an empty tree.
   */
  share(language: string): number;
}

/** Tuning knobs for {@link classifySources}. Present for testability. */
export interface ClassifyOptions {
  /** Override for {@link MAX_FILES}. Values below 1 are ignored. */
  readonly maxFiles?: number;
}

/**
 * Walks `cwd` and counts source files per language.
 *
 * The walk is synchronous, iterative (no recursion depth limit), and
 * bounded by {@link MAX_FILES}. Symlinked directories are not followed —
 * `Dirent.isDirectory()` is false for a symlink — so a cyclic link
 * cannot hang the walk. Unreadable directories are skipped silently.
 *
 * @param cwd - Project root to classify.
 * @param opts - Optional {@link ClassifyOptions}.
 * @returns The observed {@link SourceEvidence}; an empty tree yields
 *          `classified: 0`, `dominant: null`, and `share() === 0`.
 */
export function classifySources(cwd: string, opts: ClassifyOptions = {}): SourceEvidence {
  const cap = opts.maxFiles !== undefined && opts.maxFiles >= 1 ? opts.maxFiles : MAX_FILES;
  const counts: Record<string, number> = {};
  let classified = 0;
  let visited = 0;

  const stack: string[] = [cwd];
  while (stack.length > 0 && visited < cap) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch {
      continue; // unreadable subtree — skipped, never raised
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        stack.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (visited >= cap) break;
      visited += 1;
      const language = EXT_TO_LANGUAGE[extname(entry.name).toLowerCase()];
      if (language === undefined) continue;
      counts[language] = (counts[language] ?? 0) + 1;
      classified += 1;
    }
  }

  const set = Object.keys(counts).sort();
  let dominant: string | null = null;
  for (const language of set) {
    if (dominant === null || counts[language] > counts[dominant]) dominant = language;
  }

  return {
    counts,
    classified,
    set,
    dominant,
    share(language: string): number {
      if (classified === 0) return 0;
      return (counts[language] ?? 0) / classified;
    },
  };
}
