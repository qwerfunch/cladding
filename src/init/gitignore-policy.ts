// Cladding · .gitignore policy for the `.cladding/` runtime directory
//
// Why this module exists: `.cladding/` holds two kinds of file with opposite
// fates. Runtime state (events.log.jsonl, stop-block.json, scan proposals) is
// per-developer noise that must stay untracked. The gate configuration
// (`.cladding/config.yaml` — scope, commands, coverage, test_report) is a
// project decision that CI and every fresh clone must see; the strict gate is
// CI's reason to exist, so losing its tuning silently is the worst outcome.
//
// Git cannot separate the two from a *directory* exclusion. Once a pattern
// excludes a directory, git never descends into it, so a later
// `!.cladding/config.yaml` re-include is unreachable and the file stays
// ignored no matter what follows it. Only the contents form `.cladding/*`
// leaves the directory itself un-excluded, which is what makes the negation
// effective. Verified with `git check-ignore` before this module existed:
// every documented gate override was silently local-only.
//
// Pure by design (F-b0c2e724 AC-f30a7c62): rendering the managed entry and
// classifying an existing file are string operations, so the contract is
// testable without a git repository or a built binary, and the one place that
// needs git agreement is proven once against the rendered content.

/**
 * The managed ignore block `clad init` writes for a project that has no
 * cladding entry yet: runtime state ignored, gate config committable.
 */
export const CLADDING_IGNORE_BLOCK = '# Cladding runtime state\n.cladding/*\n!.cladding/config.yaml\n';

/**
 * Whether `.cladding/config.yaml` can be committed under a given `.gitignore`.
 *
 * - `commitable` — nothing ignores the gate config (no cladding entry at all,
 *   or the contents form followed by the re-include).
 * - `blocked` — the gate config is ignored, so CI and fresh clones cannot see it.
 * - `absent` — there is no `.gitignore` file to classify.
 */
export type GateConfigIgnoreStatus = 'commitable' | 'blocked' | 'absent';

/** Ignore lines this project recognizes as "the cladding entry", in any generation. */
const RECOGNIZED_ENTRIES: ReadonlySet<string> = new Set(['.cladding/', '.cladding', '.cladding/*']);

/**
 * Directory-matching forms. Both exclude the directory itself, and git never
 * descends into an excluded directory — so no later negation can re-include a
 * child. Conservative by design: a hand-crafted file that first excludes the
 * directory and then un-excludes it is reported blocked, which only ever
 * advises a clearer rewrite.
 */
const DIRECTORY_FORMS: ReadonlySet<string> = new Set(['.cladding/', '.cladding']);

/** The contents form — excludes children while leaving the directory itself walkable. */
const CONTENTS_FORM = '.cladding/*';

/** The negation that re-includes the gate config; only effective after {@link CONTENTS_FORM}. */
const GATE_CONFIG_REINCLUDE = '!.cladding/config.yaml';

/**
 * Trimmed, non-empty, non-comment lines — the only ones git treats as patterns.
 */
function patternLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Whether a `.gitignore` text already carries a cladding ignore entry in any
 * recognized generation (`.cladding/`, `.cladding`, or `.cladding/*`).
 *
 * Used by `clad init` to stay idempotent: when this is true the file is left
 * byte-identical, so no adopter's hand-tuned ignore file is rewritten behind
 * their back and no migration happens without being asked.
 *
 * @param gitignoreText - Full text of a `.gitignore`; `''` for an absent file.
 * @returns True when a recognized entry is present on its own pattern line.
 * @throws Never.
 * @example
 * ```ts
 * hasCladdingIgnoreEntry('node_modules/\n.cladding/\n'); // true (legacy form)
 * hasCladdingIgnoreEntry('# .cladding/\n');              // false (comment)
 * ```
 * @see spec/features/gate-config-committable-b0c2e724.yaml AC-6a58f0d1
 * @since 0.9.4
 */
export function hasCladdingIgnoreEntry(gitignoreText: string): boolean {
  return patternLines(gitignoreText).some((line) => RECOGNIZED_ENTRIES.has(line));
}

/**
 * Classifies whether a `.gitignore` lets `.cladding/config.yaml` be committed.
 *
 * Follows git's own resolution order: the directory forms are terminal (git
 * cannot re-include a file whose parent directory is excluded), while the
 * contents form is only safe when the re-include comes *after* it — a later
 * pattern wins in git, so `!.cladding/config.yaml` above `.cladding/*` is dead.
 *
 * @param gitignoreText - Full text of the root `.gitignore`, or null/undefined when the file does not exist.
 * @returns `absent` for no file, `blocked` when the gate config is ignored, `commitable` otherwise.
 * @throws Never; every input maps to a status.
 * @example
 * ```ts
 * gateConfigIgnoreStatus(CLADDING_IGNORE_BLOCK); // 'commitable'
 * gateConfigIgnoreStatus('.cladding/\n');        // 'blocked'
 * gateConfigIgnoreStatus(null);                  // 'absent'
 * ```
 * @see spec/features/gate-config-committable-b0c2e724.yaml AC-d47b93c5, AC-f30a7c62
 * @since 0.9.4
 */
export function gateConfigIgnoreStatus(gitignoreText: string | null | undefined): GateConfigIgnoreStatus {
  if (gitignoreText === null || gitignoreText === undefined) return 'absent';

  const lines = patternLines(gitignoreText);
  let contentsAt = -1;
  let reincludeAt = -1;
  for (const [index, line] of lines.entries()) {
    if (DIRECTORY_FORMS.has(line)) return 'blocked';
    if (line === CONTENTS_FORM) contentsAt = index;
    else if (line === GATE_CONFIG_REINCLUDE) reincludeAt = index;
  }

  // No contents exclusion at all → nothing ignores the gate config.
  if (contentsAt === -1) return 'commitable';
  return reincludeAt > contentsAt ? 'commitable' : 'blocked';
}
