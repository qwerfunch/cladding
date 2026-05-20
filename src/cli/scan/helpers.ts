// Cladding · scan · internal helpers shared by analyzer modules.

/**
 * Returns true when the path looks like a JS/TS family source file.
 * `conventions.ts`, `architecture.ts` and any module that needs to
 * narrow on the JS family imports this single source of truth.
 */
export function isJsLike(p: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
}
