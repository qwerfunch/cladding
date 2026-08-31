// Cladding · Spec 0.2 F7 · shared safe live-test binding census.

import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

import type {SpecCompilation} from '../spec/compiler/types.js';
import {safeProofDirectory, safeProofWorkspacePath} from './fs-safety.js';
import type {TestBinding} from './types.js';
import {harvestVitestJestBindings, knownCriteriaFromCompilerView} from './vitest-jest.js';

/**
 * One byte-bound scan of the native live-test source surface.
 * @see docs/design/spec-0.2/proof-and-editing.md#f5--live-test-bindings
 */
export interface CurrentSafeBindingCensus {
  /** Safe source declarations recognized by the F5 adapter. */
  readonly bindings: readonly TestBinding[];
  /** Digest of the exact supported source bytes inspected for those bindings. */
  readonly digest: string;
}

/**
 * Harvests all safe live Vitest/Jest `[covers:]` declarations for a compiler
 * snapshot. Any unsafe path, unreadable source, or unsupported syntax fails
 * closed to no live bindings rather than upgrading historic proof evidence.
 *
 * @param cwd - Workspace root that owns the test tree.
 * @param compilation - Compiler snapshot that owns known criterion addresses.
 * @returns Deterministically ordered safe live bindings, or an empty result.
 * @see docs/design/spec-0.2/proof-and-editing.md#f5--live-test-bindings
 */
export function currentSafeBindings(cwd: string, compilation: SpecCompilation): readonly TestBinding[] {
  return currentSafeBindingCensus(cwd, knownCriteriaFromCompilerView(compilation.nodes)).bindings;
}

/**
 * Harvests safe F5 declarations for an explicit current criterion address set.
 * The digest lets callers reject a source change between validation and a
 * subsequent durable action without treating historic paths as live proof.
 *
 * @param cwd - Workspace root that owns the test tree.
 * @param knownCriteria - Current compiler-owned criterion addresses.
 * @returns Safe bindings and a digest of their inspected supported sources.
 * @see docs/design/spec-0.2/proof-and-editing.md#f5--live-test-bindings
 */
export function currentSafeBindingCensus(cwd: string, knownCriteria: ReadonlySet<string>): CurrentSafeBindingCensus {
  const rootRelative = 'tests';
  if (!existsSync(join(cwd, rootRelative))) return emptyCensus('absent');
  try {
    const root = safeProofDirectory(cwd, rootRelative);
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, {withFileTypes: true}).sort((left, right) => comparePath(left.name, right.name))) {
        const absolute = join(directory, entry.name);
        const repoPath = relative(resolve(cwd), absolute).replaceAll('\\', '/');
        safeProofWorkspacePath(cwd, repoPath);
        const stat = lstatSync(absolute);
        if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error('unsafe proof link');
        if (stat.isDirectory()) visit(absolute);
        else if (stat.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(repoPath);
      }
    };
    visit(root);
    const manifest: {file: string; sha256: string}[] = [];
    const bindings = files.sort(comparePath).flatMap((file) => {
      try {
        const bytes = readFileSync(safeProofWorkspacePath(cwd, file));
        const source = bytes.toString('utf8');
        manifest.push({file, sha256: digest(bytes)});
        return harvestVitestJestBindings({file, source, knownCriteria}).bindings;
      } catch (error) {
        manifest.push({file, sha256: `<unavailable:${(error as Error).name}>`});
        return [];
      }
    });
    return {bindings, digest: digest(JSON.stringify(manifest))};
  } catch {
    return emptyCensus('unsafe');
  }
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyCensus(state: 'absent' | 'unsafe'): CurrentSafeBindingCensus {
  return {bindings: [], digest: digest(state)};
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
