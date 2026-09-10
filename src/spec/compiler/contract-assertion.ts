// Cladding · Spec 0.2 F7 · shared complete-contract assertion.

import type {Schema02ContractProjection, SpecCompilation} from './types.js';

/**
 * Requires the complete compiler authority needed by schema 0.2 consumers.
 *
 * @param compilation - A compiler snapshot obtained from the workspace authority.
 * @returns The complete schema 0.2 contract projection.
 * @throws Error when the workspace is another schema or has blocking diagnostics.
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 */
export function requireSchema02Contract(compilation: SpecCompilation): Schema02ContractProjection {
  if (compilation.schemaVersion !== '0.2') {
    throw new Error('Schema 0.2 compiler consumers require a schema 0.2 workspace.');
  }
  const blocking = compilation.diagnostics.filter((diagnostic) => diagnostic.severity !== 'advisory');
  if (compilation.contract && blocking.length === 0) return compilation.contract;
  const detail = blocking.map((diagnostic) => diagnostic.message).join('; ');
  throw new Error(
    `Schema 0.2 compiler contract is unavailable${detail ? `: ${detail}` : ''}. ` +
    'Correct the specification before continuing.',
  );
}
