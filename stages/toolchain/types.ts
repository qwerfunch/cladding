// Cladding · toolchain · shared types
//
// Polyglot adapter: cladding stage runners delegate language-specific work
// to the project's own toolchain. `detectToolchain` returns a `Toolchain`
// describing which command implements each gate (type/lint/test/coverage/secret)
// for the project rooted at a given directory.

/** Languages cladding recognizes via manifest detection. */
export type Language =
  | 'typescript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'php'
  | 'ruby'
  | 'elixir'
  | 'dotnet'
  | 'unknown';

/** A concrete command (cmd + args) used to run one gate. */
export interface ToolSpec {
  /** Executable to invoke. */
  readonly cmd: string;
  /** Arguments passed to the executable. */
  readonly args: readonly string[];
}

/** Per-gate command mapping for a single language. */
export interface ToolchainGates {
  readonly type?: ToolSpec;
  readonly lint?: ToolSpec;
  readonly test?: ToolSpec;
  readonly coverage?: ToolSpec;
  readonly secret?: ToolSpec;
}

/**
 * Result of {@link detectToolchain}. Stage runners read `gates.<stage>` and
 * invoke it via execa. `language: 'unknown'` means no recognized manifest
 * was found — stages should return a `skipped` shape rather than fail.
 *
 * @see iron-law.md stage_1.1, 1.2, 2.1, 2.2, 1.6 — these stages delegate
 *      *what* tool runs to this detection chain.
 */
export interface Toolchain {
  /** Detected language; `'unknown'` when no manifest matched. */
  readonly language: Language;
  /** Manifest filename used to identify the language (e.g. `'package.json'`). */
  readonly manifest: string;
  /** Per-gate command mapping. Empty when `language === 'unknown'`. */
  readonly gates: ToolchainGates;
}
