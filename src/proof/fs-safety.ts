// Cladding · Spec 0.2 F5 · fail-closed proof filesystem boundary.

import {existsSync, lstatSync, realpathSync} from 'node:fs';
import {isAbsolute, join, relative, resolve} from 'node:path';

/** A proof source or historic reference attempted to traverse outside its workspace. */
export class ProofPathSafetyError extends Error {}

/**
 * Resolves a workspace-relative proof path without following a symlink at any
 * observed ancestor. Existing targets must also realpath beneath the workspace.
 */
export function safeProofWorkspacePath(cwd: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new ProofPathSafetyError(`Unsafe proof path ${relativePath}.`);
  }
  const root = resolve(cwd);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) throw new ProofPathSafetyError('Proof workspace root may not be a symbolic link.');
  const realRoot = realpathSync(root);
  const absolute = resolve(root, relativePath);
  if (relative(root, absolute).startsWith('..')) throw new ProofPathSafetyError(`Proof path escapes workspace: ${relativePath}.`);
  let cursor = root;
  for (const part of relativePath.split(/[\\/]/)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new ProofPathSafetyError(`Proof path has a symbolic-link ancestor: ${relativePath}.`);
  }
  if (existsSync(absolute)) {
    const realTarget = realpathSync(absolute);
    if (realTarget !== realRoot && relative(realRoot, realTarget).startsWith('..')) {
      throw new ProofPathSafetyError(`Proof path resolves outside workspace: ${relativePath}.`);
    }
  }
  return absolute;
}

/** Rejects a symlinked proof directory before a recursive source scan begins. */
export function safeProofDirectory(cwd: string, relativePath: string): string {
  return safeProofWorkspacePath(cwd, relativePath);
}
