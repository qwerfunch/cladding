/** A public all-pass claim represented as `[passed, total]`. */
export type TestCountPair = readonly [number, number];

/**
 * Extracts the badge and release-status claim pairs from a README variant.
 *
 * @param body README source text.
 * @param kind README representation.
 * @returns Public pass and total pairs.
 */
export function claimPairs(body: string, kind: 'markdown' | 'html'): TestCountPair[];

/**
 * Validates a README variant against the collected test total.
 *
 * @param body README source text.
 * @param kind README representation.
 * @param expected Collected Vitest total.
 * @param file Diagnostic file label.
 * @throws When the public claim is missing, partial, or stale.
 */
export function checkClaimText(
  body: string,
  kind: 'markdown' | 'html',
  expected: number,
  file?: string,
): void;

/**
 * Rewrites both public claims in a validated README variant.
 *
 * @param body README source text.
 * @param kind README representation.
 * @param expected Collected Vitest total.
 * @param file Diagnostic file label.
 * @returns README text with both claims updated.
 * @throws When the existing public claim is malformed or partial.
 */
export function rewriteClaimText(
  body: string,
  kind: 'markdown' | 'html',
  expected: number,
  file?: string,
): string;

/**
 * Returns the number of tests currently collected by Vitest.
 *
 * @returns Number of collected Vitest tests.
 * @throws When collection fails or returns an empty suite.
 */
export function collectTestCount(): number;
