// Cladding · Spec 0.2 · legacy reference normalization shared by every reference reader.
//
// `test_refs` mixes two things a reader must never conflate: real file references
// (`tests/foo.test.ts#a test name`) and pseudo-evidence markers (`derived:`,
// `fixture:`, `script:`, `self-dogfood:`) that name no file at all. Every surface
// that answers "which file does this reference point at" — the GraphIR consumer
// facade, the review packet, the CLI report, the knowledge-graph model — needs the
// SAME answer, so the rule lives here as one pure module with no spec, compiler, or
// filesystem dependency. A second private copy of this rule would drift from the
// citation counts it has to agree with.

/**
 * test_ref prefixes that are NOT file paths — pseudo-evidence markers handled
 * elsewhere (test-ref-repair suggestions, registered fixtures, package scripts,
 * the self-dogfood vouch). They must never enter a path-keyed index.
 */
export const PSEUDO_REF_PREFIXES = ['derived:', 'fixture:', 'script:', 'self-dogfood:'] as const;

/**
 * Normalizes one authored reference to its file path, or null when it is a pseudo-ref.
 *
 * The `#anchor` (the runner's test title) is dropped so every reference to the same
 * file collapses to one key.
 *
 * @param ref - One authored `test_refs` spelling.
 * @returns The trimmed file path, or null for a pseudo-ref or an empty path.
 * @example
 * ```ts
 * testRefPath('tests/a.test.ts#covers x'); // 'tests/a.test.ts'
 * testRefPath('fixture:registered');       // null
 * ```
 * @since 0.10.0
 * @internal
 */
export function testRefPath(ref: string): string | null {
  for (const prefix of PSEUDO_REF_PREFIXES) {
    if (ref.startsWith(prefix)) return null;
  }
  const hash = ref.indexOf('#');
  const path = hash >= 0 ? ref.slice(0, hash) : ref;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}
