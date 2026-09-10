// Cladding · Spec 0.2 F8 · canonical GraphIR address authority.

import type {SemanticNodeKind} from './types.js';

/**
 * Normalizes a repository-relative path before it is made into a GraphIR address.
 *
 * @param path - Repository-relative path supplied by an authored fact or query.
 * @returns The slash-normalized path without a leading `./`.
 * @throws Error when the path can escape the repository or is empty.
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-b8ed5507
 */
export function normalizeGraphArtifactPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`GraphIR artifact path must be repository-relative: ${path}`);
  }
  return normalized;
}

/**
 * Makes the one canonical address for a semantic GraphIR node.
 *
 * @param kind - Semantic node category.
 * @param identifier - Required stable identifier except for the project singleton.
 * @returns Canonical GraphIR semantic address.
 * @throws Error when a non-project semantic address has no identifier.
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-b8ed5507
 */
export function semanticAddress(kind: SemanticNodeKind, identifier?: string): string {
  if (kind === 'project') return 'project';
  if (!identifier) throw new Error(`${kind} address requires an identifier`);
  return `${kind}:${identifier}`;
}

/**
 * Makes the one canonical GraphIR address for a physical artifact.
 *
 * @param path - Repository-relative path.
 * @returns Canonical artifact address.
 * @throws Error when the path is not repository-relative.
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-b8ed5507
 */
export function artifactAddress(path: string): string {
  return `artifact:${normalizeGraphArtifactPath(path)}`;
}

/**
 * Makes the one canonical GraphIR address for a stable artifact selector.
 *
 * @param path - Repository-relative artifact path.
 * @param selector - Exact stable selector on that artifact.
 * @returns Canonical anchor address.
 * @throws Error when the selector is absent or the path is invalid.
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-b8ed5507
 */
export function anchorAddress(path: string, selector: string): string {
  if (!selector) throw new Error('GraphIR anchors require an exact selector');
  return `anchor:${normalizeGraphArtifactPath(path)}#${selector}`;
}

/**
 * Splits an exact anchor address without accepting partial or inferred selectors.
 *
 * @param address - Candidate canonical anchor address.
 * @returns Normalized path and selector, or undefined when the form is not exact.
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-ff543b95
 */
export function parseAnchorAddress(address: string): {readonly path: string; readonly selector: string} | undefined {
  if (!address.startsWith('anchor:')) return undefined;
  const body = address.slice('anchor:'.length);
  const separator = body.indexOf('#');
  if (separator <= 0 || separator === body.length - 1) return undefined;
  try {
    return {path: normalizeGraphArtifactPath(body.slice(0, separator)), selector: body.slice(separator + 1)};
  } catch {
    return undefined;
  }
}
