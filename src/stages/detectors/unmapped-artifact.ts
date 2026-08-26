// Cladding · drift detector · UNMAPPED_ARTIFACT
//
// Second Ironclad-native detector (T4). Detector #1 from the catalog
// (axis: spec_vs_code, severity: error). The mirror image of
// MISSING_IMPLEMENTATION: it scans real source files and flags any
// that no feature in spec.yaml claims via `features[].modules`.
//
// The scan universe is EVIDENCE, never a language label (F-87bb7ed3).
// Three sources compose, each covering the others' blind spots:
//
//   1. Declared layer globs — a layer written in object form with its
//      own `modules: ["core/src/main/cpp/**"]` has already said where it
//      lives, so that layer's patterns are its globs crossed with the
//      evidenced extensions and name-segment inference is not used for
//      it at all. The defect this repairs (external E2E, D1): two specs
//      identical except the layer name — `core` (a real path segment)
//      reported 21 unclaimed files, `native` (no matching segment)
//      reported 0, silently, though both declared the same glob. The
//      declared architecture is the SSoT; the detector was ignoring a
//      surface the schema already carried.
//   2. Observation — every vocabulary-known extension that actually
//      occurs in the tree (core/language-evidence). This covers the
//      lazy spec: an unclaimed `.cpp` file stays visible even when the
//      spec claims only `.java` ones, which is the exact case this
//      detector exists for.
//   3. Claimed modules — the extension and the root of every module a
//      feature claims under a declared layer. This teaches languages
//      the vocabulary has never heard of: a claimed `.zig` file enters
//      the universe with no table to grow, and a claimed
//      `src/main/kotlin/core/A.kt` teaches the root `src/main/kotlin`
//      that used to need a per-language table entry.
//
// `EXT_BY_LANGUAGE` and `ROOT_BY_LANGUAGE` are gone, and with them every
// read of `spec.project.language`. Those tables knew six languages, so a
// project declaring `cpp`, `java`, or `csharp` fell through to a `*.ts`
// glob that matched nothing — a silent pass on precisely the projects
// the module→feature honesty check is for. A label can be wrong; what
// is on disk and what the spec claims cannot be mislabelled the same way.
//
// A universe can still come out empty: a layer name matching no directory,
// a declared glob pointing at a moved tree, a tree of extensions nothing
// knows or claims. Zero scanned files reads exactly like a clean bill of
// health, so it is never silent — an ACTIVE full scan that matches nothing
// emits ONE `info` finding naming the layers and the roots it looked under
// (AC-e20dbafe). Below the scale gate, and whenever files were scanned,
// the diagnostic stays quiet.
//
// Pure spec ↔ filesystem comparison, no OSS for the *logic* — though
// glob scanning is delegated to `tinyglobby` because Node's stdlib
// doesn't ship a globber.
//
// @see spec/features/self-describing-scan-universe-87bb7ed3.yaml

import {extname} from 'node:path';

import {globSync} from 'tinyglobby';

import {observedKnownExtensions} from '../../core/language-evidence.js';
import type {Architecture, ArchitectureLayerObject, Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {normalizeArchitecture} from './architecture-from-spec.js';
import {withSpec} from './with-spec.js';

const NAME = 'UNMAPPED_ARTIFACT';

/**
 * Legacy fallback scan roots — used only when the spec declares no
 * architecture layers (F-aee61f). Intentionally narrow so spec-less and
 * early projects see no findings from directories they never declared.
 */
const LEGACY_SCAN_PATTERNS: readonly string[] = ['src/stages/**/*.ts', 'src/spec/**/*.ts'];

const MIN_FEATURES_FOR_FULL_SCAN = 8; // same scale-gate idiom as HOLLOW_GOVERNANCE et al.

/** Where layer directories live when no claimed module teaches a root. */
const DEFAULT_ROOT = 'src';

/**
 * Share of layer-claimed modules a root must carry to become a scan root.
 *
 * Root inference reads a path segment, so any directory that happens to
 * reuse a layer name teaches a root: `tests/spec/parse.test.ts` teaches
 * `tests`, `skills/init/SKILL.md` teaches `skills`. Those are name
 * collisions, not source roots, and admitting them turns every mirrored
 * test tree into hundreds of "unclaimed" findings — the false-RED class
 * the scale gate below exists to prevent. A real second source root
 * carries a substantial share of the claims (a Gradle project split
 * across `src/main/kotlin` and `src/main/java` is near 50/50); an
 * incidental collision carries a thin tail. Measured on the dogfood repo
 * (279 features, 811 layer-claimed modules): unfiltered inference yields
 * 430 findings, all from collisions; at this threshold `src` alone
 * survives with 86% of the claims and the finding count is 0.
 */
const MIN_ROOT_SHARE = 0.25;

/**
 * Reads the `modules` globs each declared layer carries, keyed by layer name.
 *
 * `normalizeArchitecture` stays the SSoT for WHICH layers exist — it is
 * shared with ARCHITECTURE_FROM_SPEC and answers with names only. The globs
 * are read here, locally, because this detector is the one that consumes
 * them; layers declared in the canonical tier form (`[[cli, serve]]`) carry
 * no globs and are absent from the map.
 *
 * @param arch - `spec.architecture`, in either declared shape.
 * @returns Layer name → its non-empty declared globs; layers without globs
 *          are omitted, so `has(layer)` answers "declares its own location".
 */
function declaredGlobs(arch: Architecture): ReadonlyMap<string, readonly string[]> {
  const byLayer = new Map<string, string[]>();
  for (const tier of arch.layers ?? []) {
    if (Array.isArray(tier)) continue; // canonical tier form: names, no globs
    const layer = tier as ArchitectureLayerObject;
    if (typeof layer.name !== 'string' || layer.name.length === 0) continue;
    const globs = (layer.modules ?? []).filter(
      (glob): glob is string => typeof glob === 'string' && glob.length > 0,
    );
    if (globs.length === 0) continue;
    byLayer.set(layer.name, [...(byLayer.get(layer.name) ?? []), ...globs]);
  }
  return byLayer;
}

/**
 * The literal directory prefix of a declared glob — everything before its
 * first wildcard, slash-terminated: `core/src/main/cpp/**` and a
 * wildcard-free `core/src/main/cpp` both yield `core/src/main/cpp/`.
 *
 * Deliberately not a glob matcher. The only question asked of it is "does
 * this claimed module live where the layer says the layer lives", and a
 * prefix answers that for the directory globs `clad init --scan` writes
 * without pulling in a matching engine.
 */
function globPrefix(glob: string): string {
  const star = glob.indexOf('*');
  const literal = star < 0 ? glob : glob.slice(0, star);
  return literal.length === 0 || literal.endsWith('/') ? literal : `${literal}/`;
}

/**
 * Expands one declared glob into the scan pattern for `ext`.
 *
 * A glob that already ends in a recursive wildcard keeps that recursion and
 * only gains the file part; any other form gains the recursion too — so a
 * bare directory glob (`core/src/main/cpp`) and its wildcard spelling scan
 * the same tree.
 *
 * Both branches treat the declared glob as a DIRECTORY, which is the shape
 * the scan renderer writes. A hand-written glob that already names files
 * (`src/core/*.ts`) therefore expands to a pattern matching nothing; when
 * that leaves the whole scan empty, the finding below reports it rather
 * than passing silently.
 */
function expandGlob(glob: string, ext: string): string {
  return glob.endsWith('**') ? `${glob}/*${ext}` : `${glob}/**/*${ext}`;
}

/** What the spec's own module claims teach about the scan universe. */
interface ClaimedEvidence {
  /** Path prefixes that precede a declared layer name, dominance-filtered. */
  readonly roots: readonly string[];
  /** Extensions claimed under one of those roots or under a declared glob. */
  readonly extensions: readonly string[];
}

/**
 * Reads roots and extensions out of `features[].modules`.
 *
 * A module teaches only when it is layer-claimed, and there are two ways to
 * be: it sits under an inferred root + a declared layer name (the root it
 * teaches must then survive the dominance filter), or its path starts with
 * the literal prefix of a glob some layer declares. Anything else teaches
 * nothing — a root-level `CHANGELOG.md` claim cannot widen the source
 * universe.
 *
 * @param spec - The loaded spec; `features[].modules` is the only field read.
 * @param layers - Declared layer names, for the name-segment match.
 * @param globPrefixes - Literal prefixes of every declared layer glob.
 */
function claimedEvidence(
  spec: Spec,
  layers: ReadonlySet<string>,
  globPrefixes: readonly string[],
): ClaimedEvidence {
  const claimsByRoot = new Map<string, number>();
  const extensionsByRoot = new Map<string, Set<string>>();
  const underDeclaredGlob = new Set<string>();
  let total = 0;

  for (const feature of spec.features ?? []) {
    for (const modulePath of feature.modules ?? []) {
      const segments = modulePath.split('/');
      const ext = extname(segments[segments.length - 1]);

      // A layer's own glob needs no root inference — the declaration already
      // located the layer, so a claim under it only teaches its extension.
      if (ext !== '' && globPrefixes.some((prefix) => modulePath.startsWith(prefix))) {
        underDeclaredGlob.add(ext);
      }

      // The last segment is the file itself — a file named like a layer
      // is not a directory the layer lives in.
      const layerAt = segments.findIndex(
        (segment, i) => i < segments.length - 1 && layers.has(segment),
      );
      if (layerAt < 0) continue;

      const root = segments.slice(0, layerAt).join('/');
      claimsByRoot.set(root, (claimsByRoot.get(root) ?? 0) + 1);
      total += 1;

      if (ext === '') continue; // a claimed directory teaches its root, not an extension
      const known = extensionsByRoot.get(root) ?? new Set<string>();
      known.add(ext);
      extensionsByRoot.set(root, known);
    }
  }

  const roots: string[] = [];
  const extensions = new Set<string>(underDeclaredGlob);
  for (const [root, claims] of claimsByRoot) {
    if (claims / total < MIN_ROOT_SHARE) continue;
    roots.push(root);
    for (const ext of extensionsByRoot.get(root) ?? []) extensions.add(ext);
  }
  return {roots, extensions: [...extensions]};
}

/** The resolved scan universe plus what it took to build it. */
interface ScanUniverse {
  /** Globs to scan; the legacy narrow pair when the scale gate is not met. */
  readonly patterns: readonly string[];
  /** True only when the evidence universe is active (≥8 features + layers). */
  readonly fullScan: boolean;
  /** Declared layer names, in declaration order. */
  readonly layers: readonly string[];
  /** Where the scan looked: inferred roots, and each declared layer glob. */
  readonly roots: readonly string[];
  /** True when every declared layer brought its own globs. */
  readonly everyLayerDeclaresGlobs: boolean;
}

const LEGACY_UNIVERSE: ScanUniverse = {
  patterns: LEGACY_SCAN_PATTERNS,
  fullScan: false,
  layers: [],
  roots: [],
  everyLayerDeclaresGlobs: false,
};

/**
 * Resolves the glob set the detector scans, plus the layers and roots that
 * produced it (the empty-universe diagnostic reports them).
 *
 * Per layer, one of two derivations runs — never both:
 *   · the layer declared `modules` globs → its patterns are those globs
 *     crossed with the evidenced extensions (AC-96ff696f);
 *   · it did not → one pattern per inferred scan root, the layer NAME as a
 *     path segment, and each evidenced extension (AC-9a6f02d3).
 *
 * The extension set is shared by both: observed known extensions united
 * with the layer-claimed ones.
 */
function scanUniverse(spec: Spec, cwd: string): ScanUniverse {
  // Scale-gated (F-aee61f): a fresh adoption legitimately has scan-derived
  // architecture layers but features accumulating on demand — instantly
  // flagging every not-yet-claimed file would wall off day-1 adoption (the
  // false-RED class the 0.6 design review warned about). Once the project
  // is grown (≥8 features), an unclaimed file in a declared layer is drift.
  if ((spec.features ?? []).length < MIN_FEATURES_FOR_FULL_SCAN) return LEGACY_UNIVERSE;
  const architecture = spec.architecture ?? {};
  const {layers} = normalizeArchitecture(architecture);
  if (layers.size === 0) return LEGACY_UNIVERSE;

  const globsByLayer = declaredGlobs(architecture);
  const globPrefixes = [...globsByLayer.values()].flat().map(globPrefix);
  const claimed = claimedEvidence(spec, layers, globPrefixes);
  const roots = claimed.roots.length > 0 ? claimed.roots : [DEFAULT_ROOT];
  const extensions = new Set([...observedKnownExtensions(cwd), ...claimed.extensions]);

  const patterns = new Set<string>();
  const searched = new Set<string>();
  for (const layer of layers) {
    const globs = globsByLayer.get(layer);
    if (globs !== undefined) {
      for (const glob of globs) {
        searched.add(glob);
        for (const ext of extensions) patterns.add(expandGlob(glob, ext));
      }
      continue;
    }
    for (const root of roots) {
      // An empty root means the layers sit at the repository root itself.
      const prefix = root === '' ? '' : `${root}/`;
      searched.add(root === '' ? '.' : root);
      for (const ext of extensions) patterns.add(`${prefix}${layer}/**/*${ext}`);
    }
  }

  return {
    patterns: [...patterns].sort(),
    fullScan: true,
    layers: [...layers],
    roots: [...searched],
    everyLayerDeclaresGlobs: globsByLayer.size === layers.size,
  };
}

/**
 * Builds the glob set the detector scans: one pattern per declared layer
 * glob, or per scan root and layer name when the layer declares none.
 *
 * @param spec - The loaded spec; read for features, architecture, and
 *               module claims — never for `project.language`.
 * @param cwd - Project root, walked once for the observed extensions.
 * @returns Sorted, deduplicated glob patterns; the legacy narrow pair
 *          when the full-scan scale gate is not met.
 */
export function scanPatterns(spec: Spec, cwd: string): readonly string[] {
  return scanUniverse(spec, cwd).patterns;
}

/**
 * The single `info` finding for an active full scan that matched nothing.
 *
 * An empty universe and a fully-claimed tree produce the same silence, and
 * only one of them is good news — so the scan says where it looked and what
 * would move it. Info severity: it never blocks a gate, it just refuses to
 * let a scan of nothing read as a pass (AC-e20dbafe).
 */
function emptyUniverseFinding(universe: ScanUniverse): DriftFinding {
  const advice = universe.everyLayerDeclaresGlobs
    ? 'check the declared layer modules globs against the tree'
    : 'declare layer modules globs or align layer names with directories';
  return {
    detector: NAME,
    severity: 'info',
    message:
      `full scan matched no files — layers {${universe.layers.join(', ')}} ` +
      `under roots {${universe.roots.join(', ')}}; ${advice}`,
  };
}

/**
 * Finds source files not referenced by any `features[].modules`.
 *
 * Returns one `error` finding per unclaimed file. When spec.yaml is
 * absent or unparseable, returns a single `info` finding (opt-in:
 * spec-less projects keep green CI). The detector intentionally does
 * not walk the entire repo — only the roots, globs, and layers the spec
 * and the tree together evidence as source.
 *
 * @see iron-law.md stage_1.3 — detector contract.
 * @see ironclad-design/08-drift-detectors.md — UNMAPPED_ARTIFACT (#1).
 */
function runUnmappedArtifact(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const claimed = new Set<string>();
  for (const feature of spec.features) {
    for (const modulePath of feature.modules ?? []) claimed.add(modulePath);
  }

  const universe = scanUniverse(spec, cwd);
  // No evidenced extension means no source universe. Guarded rather than
  // handed to the globber, so "nothing to scan" can never be read as
  // "scan everything".
  const files =
    universe.patterns.length === 0 ? [] : globSync([...universe.patterns], {cwd, dot: false});
  // Empty patterns and matching patterns that find nothing are the same
  // outcome — a scan that inspected no file — and both are reported.
  if (universe.fullScan && files.length === 0) return [emptyUniverseFinding(universe)];

  const findings: DriftFinding[] = [];
  for (const file of files) {
    if (claimed.has(file)) continue;
    findings.push({
      detector: NAME,
      severity: 'error',
      path: file,
      message: `file '${file}' is not claimed by any feature in spec.yaml`,
    });
  }
  return findings;
}

export const unmappedArtifact: DriftDetector = {
  name: NAME,
  run: runUnmappedArtifact,
};
