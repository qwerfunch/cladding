// Cladding · drift detector · UNMAPPED_ARTIFACT
//
// Second Ironclad-native detector (T4). Detector #1 from the catalog
// (axis: spec_vs_code, severity: error). The mirror image of
// MISSING_IMPLEMENTATION: it scans real source files and flags any
// that no feature in spec.yaml claims via `features[].modules`.
//
// The scan universe is EVIDENCE, never a language label (F-87bb7ed3).
// Two sources compose, each covering the other's blind spot:
//
//   1. Observation — every vocabulary-known extension that actually
//      occurs in the tree (core/language-evidence). This covers the
//      lazy spec: an unclaimed `.cpp` file stays visible even when the
//      spec claims only `.java` ones, which is the exact case this
//      detector exists for.
//   2. Claimed modules — the extension and the root of every module a
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
// Pure spec ↔ filesystem comparison, no OSS for the *logic* — though
// glob scanning is delegated to `tinyglobby` because Node's stdlib
// doesn't ship a globber.
//
// @see spec/features/self-describing-scan-universe-87bb7ed3.yaml

import {extname} from 'node:path';

import {globSync} from 'tinyglobby';

import {observedKnownExtensions} from '../../core/language-evidence.js';
import type {Spec} from '../../spec/types.js';
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

/** What the spec's own module claims teach about the scan universe. */
interface ClaimedEvidence {
  /** Path prefixes that precede a declared layer name, dominance-filtered. */
  readonly roots: readonly string[];
  /** Extensions claimed under one of those roots, with leading dot. */
  readonly extensions: readonly string[];
}

/**
 * Reads roots and extensions out of `features[].modules`.
 *
 * Only a module that sits under a declared layer teaches anything: a
 * root-level `CHANGELOG.md` claim contributes neither a root nor an
 * extension, so documentation claims cannot widen the source universe.
 */
function claimedEvidence(spec: Spec, layers: ReadonlySet<string>): ClaimedEvidence {
  const claimsByRoot = new Map<string, number>();
  const extensionsByRoot = new Map<string, Set<string>>();
  let total = 0;

  for (const feature of spec.features ?? []) {
    for (const modulePath of feature.modules ?? []) {
      const segments = modulePath.split('/');
      // The last segment is the file itself — a file named like a layer
      // is not a directory the layer lives in.
      const layerAt = segments.findIndex(
        (segment, i) => i < segments.length - 1 && layers.has(segment),
      );
      if (layerAt < 0) continue;

      const root = segments.slice(0, layerAt).join('/');
      claimsByRoot.set(root, (claimsByRoot.get(root) ?? 0) + 1);
      total += 1;

      const ext = extname(segments[segments.length - 1]);
      if (ext === '') continue; // a claimed directory teaches its root, not an extension
      const known = extensionsByRoot.get(root) ?? new Set<string>();
      known.add(ext);
      extensionsByRoot.set(root, known);
    }
  }

  const roots: string[] = [];
  const extensions = new Set<string>();
  for (const [root, claims] of claimsByRoot) {
    if (claims / total < MIN_ROOT_SHARE) continue;
    roots.push(root);
    for (const ext of extensionsByRoot.get(root) ?? []) extensions.add(ext);
  }
  return {roots, extensions: [...extensions]};
}

/**
 * Builds the glob set the detector scans: one pattern per scan root,
 * declared layer, and evidenced extension.
 *
 * @param spec - The loaded spec; read for features, architecture, and
 *               module claims — never for `project.language`.
 * @param cwd - Project root, walked once for the observed extensions.
 * @returns Sorted, deduplicated glob patterns; the legacy narrow pair
 *          when the full-scan scale gate is not met.
 */
export function scanPatterns(spec: Spec, cwd: string): readonly string[] {
  // Scale-gated (F-aee61f): a fresh adoption legitimately has scan-derived
  // architecture layers but features accumulating on demand — instantly
  // flagging every not-yet-claimed file would wall off day-1 adoption (the
  // false-RED class the 0.6 design review warned about). Once the project
  // is grown (≥8 features), an unclaimed file in a declared layer is drift.
  if ((spec.features ?? []).length < MIN_FEATURES_FOR_FULL_SCAN) return LEGACY_SCAN_PATTERNS;
  const {layers} = normalizeArchitecture(spec.architecture ?? {});
  if (layers.size === 0) return LEGACY_SCAN_PATTERNS;

  const claimed = claimedEvidence(spec, layers);
  const roots = claimed.roots.length > 0 ? claimed.roots : [DEFAULT_ROOT];
  const extensions = new Set([...observedKnownExtensions(cwd), ...claimed.extensions]);

  const patterns = new Set<string>();
  for (const root of roots) {
    // An empty root means the layers sit at the repository root itself.
    const prefix = root === '' ? '' : `${root}/`;
    for (const layer of layers) {
      for (const ext of extensions) patterns.add(`${prefix}${layer}/**/*${ext}`);
    }
  }
  return [...patterns].sort();
}

/**
 * Finds source files not referenced by any `features[].modules`.
 *
 * Returns one `error` finding per unclaimed file. When spec.yaml is
 * absent or unparseable, returns a single `info` finding (opt-in:
 * spec-less projects keep green CI). The detector intentionally does
 * not walk the entire repo — only the roots and layers the spec and the
 * tree together evidence as source.
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

  const patterns = scanPatterns(spec, cwd);
  // No evidenced extension means no source universe. Guarded rather than
  // handed to the globber, so "nothing to scan" can never be read as
  // "scan everything".
  const files = patterns.length === 0 ? [] : globSync([...patterns], {cwd, dot: false});
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
