// Cladding · Spec 0.2 F9d · implementation-author mapping for human receipts.
//
// D20 binds `implementation_authors_sha256` to the sorted unique normalized
// `{root, assurance, author, name}` records for every implementation root in a
// feature's runtime dependency closure. Hashing that mapping binds the DECLARED
// authorship; it never upgrades an asserted identity into a verified one.
//
// Source order is a strict fallback chain, and every step keeps its own
// provenance rather than laundering a weaker one:
//
//   1. audit-log mutation identity — an evidence entry that names the root as
//      its artifact. That is the only channel in which the workspace records
//      "who touched this file"; a feature-level note names no root and so
//      cannot attribute one.
//   2. the root's git author, recorded as `{author: 'git'}` and always
//      `asserted`: git metadata is self-reported and is not a signed identity.
//   3. the explicit sentinel `{author: 'unknown', name: ''}` for an
//      unattributable root, which makes the mapping incomplete and leaves an
//      independence requirement unobserved instead of quietly passing.

import {spawnSync} from 'node:child_process';

import {readEvidence} from '../hitl/audit.js';
import type {Evidence} from '../hitl/identity.js';
import {canonicalizeJson} from './receipt.js';
import {createHash} from 'node:crypto';

/** Milliseconds a single `git log` probe may take before the root is unattributed. */
const GIT_PROBE_TIMEOUT_MS = 2_000;

/** One normalized mutation-provenance record for one implementation root. */
export interface ImplementationAuthorRecord {
  /** Authored module path exactly as the feature declares it. */
  readonly root: string;
  /** Always `asserted` in F9d; no channel yet proves a mutation identity. */
  readonly assurance: 'asserted' | 'verified';
  /** Provenance channel: an evidence author, `git`, or the `unknown` sentinel. */
  readonly author: string;
  /** Stable handle for that channel; empty only for the sentinel. */
  readonly name: string;
}

/** The complete mapping for one feature plus the digest a receipt binds. */
export interface ImplementationAuthorMapping {
  readonly records: readonly ImplementationAuthorRecord[];
  /** True when no root carries the `unknown` sentinel. */
  readonly complete: boolean;
  /** SHA-256 over the RFC 8785 canonical JSON of the sorted unique records. */
  readonly sha256: string;
  /** Distinct non-sentinel handles credited with mutating these roots. */
  readonly names: readonly string[];
}

/**
 * Builds the mutation-provenance mapping for a feature's implementation roots.
 *
 * @param cwd - Workspace root the roots are relative to.
 * @param roots - Authored module paths from the runtime dependency closure.
 * @param evidence - Audit-log entries; read from the workspace when omitted.
 * @returns Sorted unique records with the digest a human receipt must carry.
 * @example
 * ```ts
 * const mapping = implementationAuthorMapping(cwd, ['src/proof/authors.ts']);
 * ```
 * @since 0.10.0
 * @internal
 */
export function implementationAuthorMapping(
  cwd: string,
  roots: readonly string[],
  evidence?: readonly Evidence[],
): ImplementationAuthorMapping {
  const entries = evidence ?? safeEvidence(cwd);
  const byRoot = new Map<string, ImplementationAuthorRecord[]>();
  for (const root of new Set(roots)) {
    const normalized = normalizeRoot(root);
    const audited = auditIdentities(entries, normalized).map((identity) => ({
      root, assurance: 'asserted' as const, author: identity.author, name: identity.name,
    }));
    if (audited.length > 0) { byRoot.set(root, audited); continue; }
    const gitAuthor = gitRootAuthor(cwd, normalized);
    byRoot.set(root, [gitAuthor === undefined
      ? {root, assurance: 'asserted', author: 'unknown', name: ''}
      : {root, assurance: 'asserted', author: 'git', name: gitAuthor}]);
  }
  const unique = new Map<string, ImplementationAuthorRecord>();
  for (const record of [...byRoot.values()].flat()) unique.set(canonicalizeJson(record), record);
  const records = [...unique.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, record]) => Object.freeze(record));
  return Object.freeze({
    records: Object.freeze(records),
    complete: records.every((record) => record.author !== 'unknown'),
    sha256: createHash('sha256').update(canonicalizeJson(records.map((record) => ({
      root: record.root, assurance: record.assurance, author: record.author, name: record.name,
    }))), 'utf8').digest('hex'),
    names: Object.freeze([...new Set(records
      .filter((record) => record.author !== 'unknown' && record.name.length > 0)
      .map((record) => record.name))].sort()),
  });
}

/** Whether an issuer handle is outside a mapping's credited author names. */
export function isIndependentIssuer(mapping: ImplementationAuthorMapping, issuer: string): boolean {
  const normalized = issuer.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return !mapping.names.some((name) => name.trim().toLowerCase() === normalized);
}

/** Audit-log identities that explicitly name this root as their artifact. */
function auditIdentities(entries: readonly Evidence[], root: string): readonly {author: string; name: string}[] {
  const identities = new Map<string, {author: string; name: string}>();
  for (const entry of entries) {
    if (entry.artifact === undefined || normalizeRoot(entry.artifact) !== root) continue;
    const identity = {author: entry.identity.author, name: entry.identity.name ?? ''};
    identities.set(`${identity.author}\u0000${identity.name}`, identity);
  }
  return [...identities.values()];
}

/**
 * Reads one root's last git author.
 *
 * A non-repository workspace, an untracked root, and a git binary that is not
 * installed are the same fact here: nothing attributed this root, so the
 * caller records the sentinel rather than a plausible guess.
 */
function gitRootAuthor(cwd: string, root: string): string | undefined {
  try {
    const result = spawnSync('git', ['log', '-1', '--format=%an', '--', root], {
      cwd, encoding: 'utf8', timeout: GIT_PROBE_TIMEOUT_MS, windowsHide: true,
    });
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return undefined;
    const name = result.stdout.split('\n')[0]?.trim() ?? '';
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

function safeEvidence(cwd: string): readonly Evidence[] {
  try { return readEvidence(cwd); } catch { return []; }
}

function normalizeRoot(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
