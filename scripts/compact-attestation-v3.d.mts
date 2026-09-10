/**
 * Content-addresses one identity set exactly as the attestation writer does.
 *
 * @param identities Stored identities, in any order and possibly repeated.
 * @returns SHA-256 of the compact JSON array of the sorted, unique identities.
 */
export function observationSetSha256(identities: readonly string[]): string;

/**
 * Rewrites the pre-compaction rows of one attestation document.
 *
 * Rows already carrying the digest, malformed rows, and every section outside
 * `attested_v3:` pass through unchanged, so a compact document is its own output.
 *
 * @param text Whole attestation file contents.
 * @returns Rewritten contents and the number of rows rewritten.
 */
export function compactAttestationV3(text: string): {text: string; compacted: number};
