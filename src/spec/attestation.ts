// Cladding · verification attestation (F-a5228c; v2 encoding F-b0f898a6)
//
// "When was this tree last actually verified, and has shipped code changed
// since?" — the question the harness could not answer. The first design
// keyed it off the gitignored local events ledger: undefined on fresh
// clones/CI, broken by squash/rebase. This anchors on COMMITTED CONTENT
// instead: a Tier-C file written only by a GREEN strict verification run.
// Clone-portable, history-rewrite-immune.
//
// v2 (F-b0f898a6) splits the record into two sections so parallel work stops
// colliding: v1 keyed each done feature to ONE hash over ALL its module bytes,
// so a single shared-file edit rewrote every co-owner's line (the #1 merge
// surface in parallel work). v2 keys hashes to module FILES and marks features
// with a constant token — editing a file moves exactly its own line. The
// reader accepts both formats; adopters cross over on their next GREEN gate.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Feature, Spec} from './types.js';

const ATTESTATION_PATH = ['spec', 'attestation.yaml'] as const;

/**
 * Identity of the verification policy that earned an attestation.
 *
 * @see spec/features/attestation-policy-stamp-caff8598.yaml AC-a4d41de9
 * @since 0.9.4
 */
export interface AttestationPolicy {
  /** Running Cladding engine version, or `unknown` if its manifest was unavailable. */
  readonly cladding: string;
  /** Gate policy that promoted warnings and required the full verification ladder. */
  readonly blocking: 'strict';
  /** Full SHA-256 over the ordered detector catalog identity. */
  readonly detectorsSha256: string;
}

/**
 * Fingerprints the ordered detector catalog without serializing functions.
 *
 * The Cladding version identifies implementation bytes; this digest identifies
 * which stable names, order, and subprocess classes were registered.
 *
 * @param detectors - Ordered detector identities from the live registry.
 * @returns A deterministic lowercase, 64-character SHA-256 digest.
 * @throws Never for string names and boolean subprocess flags.
 * @example
 * ```ts
 * detectorCatalogSha256([{name: 'STATUS_DRIFT'}]);
 * ```
 * @see spec/features/attestation-policy-stamp-caff8598.yaml AC-1f6b157b
 * @since 0.9.4
 */
export function detectorCatalogSha256(
  detectors: readonly {readonly name: string; readonly subprocess?: true}[],
): string {
  const hash = createHash('sha256');
  detectors.forEach((detector, index) => {
    hash.update(`${index}\u0000${detector.name}\u0000${detector.subprocess === true ? 'subprocess' : 'pure'}\n`);
  });
  return hash.digest('hex');
}

/** sha256 over a done feature's modules: sorted path + file bytes per entry.
 * A missing module file hashes as absent (the MISSING_IMPLEMENTATION
 * detector owns that error; the hash just has to be deterministic). The v1
 * per-feature key; kept for reading v1 files and any external callers. */
export function moduleTreeHash(cwd: string, modules: readonly string[]): string {
  const h = createHash('sha256');
  for (const m of [...modules].sort()) {
    h.update(m);
    h.update('\u0000');
    try {
      h.update(readFileSync(join(cwd, m)));
    } catch {
      h.update('<absent>');
    }
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 16);
}

/** sha256 of ONE module file's bytes (v2). A missing file hashes the
 * '<absent>' sentinel exactly like {@link moduleTreeHash} — deterministic;
 * the MISSING_IMPLEMENTATION detector owns the error. */
export function moduleFileHash(cwd: string, path: string): string {
  const h = createHash('sha256');
  try {
    h.update(readFileSync(join(cwd, path)));
  } catch {
    h.update('<absent>');
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * The parsed attestation file. Each section is `null` when its header is
 * absent, so a caller can tell a v1 file (only `v1`), a v2 file (`modules` +
 * `features`), and a union-merge Frankenstein (all present) apart. A whole
 * absent FILE is signalled by {@link readAttestation} returning `null`.
 */
export interface AttestationFile {
  /** v2.1+ verification-policy identity; null for legacy attestations. */
  readonly policy: AttestationPolicy | null;
  /** v1 `attested:` section — feature id → module tree-hash. */
  readonly v1: Map<string, string> | null;
  /** v2 `attested_modules:` section — module path → file hash. */
  readonly modules: Map<string, string> | null;
  /** v2 `attested_features:` section — the set of marked done features. */
  readonly features: Set<string> | null;
}

/** Reads the committed attestation, section-aware, accepting v1 and v2 (and a
 * Frankenstein carrying both — every section present is parsed, duplicate
 * lines last-win). Returns `null` only when the file is absent (verification
 * state unknown — never a blanket failure). */
export function readAttestation(cwd: string): AttestationFile | null {
  const path = join(cwd, ...ATTESTATION_PATH);
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let v1: Map<string, string> | null = null;
  let modules: Map<string, string> | null = null;
  let features: Set<string> | null = null;
  const policyFields: {cladding?: string; blocking?: 'strict'; detectorsSha256?: string} = {};
  let section: 'policy' | 'v1' | 'modules' | 'features' | 'other' = 'other';
  for (const line of text.split('\n')) {
    if (line === 'policy:') {
      section = 'policy';
      continue;
    }
    if (line === 'attested:') {
      section = 'v1';
      v1 ??= new Map();
      continue;
    }
    if (line === 'attested_modules:') {
      section = 'modules';
      modules ??= new Map();
      continue;
    }
    if (line === 'attested_features:') {
      section = 'features';
      features ??= new Set();
      continue;
    }
    if (line.startsWith('#') || line.trim() === '') continue;
    if (section === 'policy') {
      const cladding = line.match(/^ {2}cladding: "([^"]+)"$/);
      const blocking = line.match(/^ {2}blocking: (strict)$/);
      const detectors = line.match(/^ {2}detectors_sha256: ([0-9a-f]{64})$/);
      if (cladding) policyFields.cladding = cladding[1];
      if (blocking) policyFields.blocking = blocking[1] as 'strict';
      if (detectors) policyFields.detectorsSha256 = detectors[1];
    } else if (section === 'v1') {
      const m = line.match(/^ {2}(F-[\w-]+): ([0-9a-f]{16})$/);
      if (m) v1!.set(m[1], m[2]);
    } else if (section === 'modules') {
      const m = line.match(/^ {2}(.+): ([0-9a-f]{16})$/);
      if (m) modules!.set(m[1], m[2]);
    } else if (section === 'features') {
      const m = line.match(/^ {2}(F-[\w-]+): ok$/);
      if (m) features!.add(m[1]);
    }
  }
  const policy =
    policyFields.cladding !== undefined &&
    policyFields.blocking === 'strict' &&
    policyFields.detectorsSha256 !== undefined
      ? {
          cladding: policyFields.cladding,
          blocking: policyFields.blocking,
          detectorsSha256: policyFields.detectorsSha256,
        }
      : null;
  return {policy, v1, modules, features};
}

/** How many features an attestation vouches for — v2 markers when present,
 * else v1 entries. The count `doctor`/`report` surface as "N feature(s)
 * stamped". */
export function attestedFeatureCount(att: AttestationFile): number {
  return att.features?.size ?? att.v1?.size ?? 0;
}

/** Freshness of one done feature against an attestation. The single verdict
 * both STALE_ATTESTATION and the Integrity Panel consume. Never throws.
 *
 *   fresh       — v2: marker present AND every module's current file-hash
 *                 matches; v1: the recorded tree-hash matches.
 *   stale       — a module drifted (v2 names the first mismatching `module`;
 *                 v1 has no per-module resolution so `module` is omitted).
 *   unattested  — the feature has no marker (v2) / no entry (v1): its code
 *                 was never verified by an attested gate.
 *
 * v2 wins whenever the file carries v2 sections; a pure v1 file keeps its
 * pre-change verdicts. */
export function featureAttestation(
  att: AttestationFile,
  cwd: string,
  feature: Feature,
): {state: 'fresh'} | {state: 'stale'; module?: string} | {state: 'unattested'} {
  const modules = feature.modules ?? [];
  if (att.modules !== null || att.features !== null) {
    // v2 path.
    if (!att.features?.has(feature.id)) return {state: 'unattested'};
    const stamped = att.modules ?? new Map<string, string>();
    for (const m of [...modules].sort()) {
      if (stamped.get(m) !== moduleFileHash(cwd, m)) return {state: 'stale', module: m};
    }
    return {state: 'fresh'};
  }
  // v1 path — previous behavior: tree-hash compare; missing entry = unattested.
  const recorded = att.v1?.get(feature.id);
  if (recorded === undefined) return {state: 'unattested'};
  return recorded === moduleTreeHash(cwd, modules) ? {state: 'fresh'} : {state: 'stale'};
}

const HEADER =
  '# Cladding · Tier C — verification attestation (v2). Written ONLY by a GREEN\n' +
  '# `clad check --tier=pre-push --strict` gate — the file\'s one honest author.\n' +
  '# Do not edit by hand.\n' +
  '#\n' +
  '#   policy:             verifier identity: Cladding version, strict blocking,\n' +
  '#                       and SHA-256 of the ordered detector catalog.\n' +
  '#   attested_modules:  one line per module file across all done features,\n' +
  '#                      value = sha256 of that file\'s bytes (16 hex). Editing a\n' +
  '#                      file moves exactly its own line — not every co-owning\n' +
  '#                      feature\'s — so parallel work rarely conflicts here.\n' +
  '#   attested_features: one constant `ok` marker per done feature with modules.\n' +
  '#                      STALE_ATTESTATION calls a feature fresh only when its\n' +
  '#                      marker is present AND every module hash still matches.\n' +
  '#\n' +
  '# Merge conflict here? NEVER hand-resolve the hashes — keep either side and run\n' +
  '# `clad check --tier=pre-push --strict`; the GREEN gate rewrites the truth.\n' +
  '# Content-anchored: survives fresh clones and squash/rebase.\n';

/**
 * Writes the v2 attestation for every done feature with modules.
 *
 * Only a GREEN strict verification run supplies a policy and calls this in
 * production. Output is whole-file, sorted, LF, and deterministic.
 *
 * @param cwd - Project root containing the attested modules and `spec/`.
 * @param spec - Loaded project spec whose done features will be stamped.
 * @param policy - Optional verifier identity; omitted only for legacy-compatible callers.
 * @returns False without writing when no done feature has modules; otherwise true.
 * @throws When the canonical attestation file cannot be written.
 * @example
 * ```ts
 * writeAttestation('/workspace', spec, policy);
 * ```
 * @see spec/features/attestation-policy-stamp-caff8598.yaml AC-a4d41de9
 * @since 0.9.4
 */
export function writeAttestation(cwd: string, spec: Spec, policy?: AttestationPolicy): boolean {
  const done = (spec.features ?? []).filter((f) => f.status === 'done' && (f.modules ?? []).length > 0);
  if (done.length === 0) return false;

  const moduleSet = new Set<string>();
  for (const f of done) for (const m of f.modules ?? []) moduleSet.add(m);
  const moduleRows = [...moduleSet]
    .sort()
    .map((m) => `  ${m}: ${moduleFileHash(cwd, m)}`);
  const featureRows = done.map((f) => `  ${f.id}: ok`).sort();

  const body =
    HEADER +
    (policy
      ? 'policy:\n' +
        `  cladding: ${JSON.stringify(policy.cladding)}\n` +
        `  blocking: ${policy.blocking}\n` +
        `  detectors_sha256: ${policy.detectorsSha256}\n`
      : '') +
    'attested_modules:\n' +
    moduleRows.join('\n') +
    '\n' +
    'attested_features:\n' +
    featureRows.join('\n') +
    '\n';
  writeFileSync(join(cwd, ...ATTESTATION_PATH), body, 'utf8');
  return true;
}
