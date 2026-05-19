// Cladding · Token Optimizer · Preamble Suppression
//
// Per ironclad-design/04-token-efficiency.md §Preamble Suppression:
// the same boilerplate ("You are an Ironclad agent…") gets sent every
// invocation. Strip it after the first turn of a session.
//
// The implementation is intentionally minimal — a list of regex
// fragments that callers can extend. The data is the prompt; the
// decision (when to strip) belongs to the agent runtime.

/** Patterns whose removal is safe across cladding's agent personas. */
export const DEFAULT_PREAMBLE_PATTERNS: readonly RegExp[] = [
  /^You are (the |a |an )?[A-Z][\w-]+ agent.*$/gm,
  /^# (Orchestrator|Librarian|Reviewer|Observability|Specialists)$/gm,
  /^Your job is to .*$/gm,
];

/** Strips every line matching any pattern; collapses resulting blank runs. */
export function suppressPreamble(
  prompt: string,
  patterns: readonly RegExp[] = DEFAULT_PREAMBLE_PATTERNS,
): string {
  let out = prompt;
  for (const p of patterns) {
    out = out.replace(p, '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
