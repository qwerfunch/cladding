// Cladding · drift detector · UNMAPPED_ARTIFACT
//
// Second Ironclad-native detector (T4). Detector #1 from the catalog
// (axis: spec_vs_code, severity: error). The mirror image of
// MISSING_IMPLEMENTATION: it scans real source files and flags any
// that no feature in spec.yaml claims via `features[].modules`.
//
// Pure spec ↔ filesystem comparison, no OSS for the *logic* — though
// glob scanning is delegated to `tinyglobby` because Node's stdlib
// doesn't ship a globber.

import {globSync} from 'tinyglobby';

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

const EXT_BY_LANGUAGE: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  rust: 'rs',
  go: 'go',
};

/**
 * F-aee61f — the scan universe derives from the DECLARED architecture: one
 * `src/<layer>/**` pattern per layer (both string-tier and {name} object
 * forms), extension from project.language. Before this, two hardcoded
 * directories left the module→feature honesty check blind to 13 of
 * cladding's own 15 src/ directories — a confidently wrong map is worse
 * than none. No architecture declared → legacy narrow fallback.
 * Exported for tests.
 */
const MIN_FEATURES_FOR_FULL_SCAN = 8; // same scale-gate idiom as HOLLOW_GOVERNANCE et al.

export function scanPatterns(spec: Spec): readonly string[] {
  // Scale-gated (F-aee61f): a fresh adoption legitimately has scan-derived
  // architecture layers but features accumulating on demand — instantly
  // flagging every not-yet-claimed file would wall off day-1 adoption (the
  // false-RED class the 0.6 design review warned about). Once the project
  // is grown (≥8 features), an unclaimed file in a declared layer is drift.
  if ((spec.features ?? []).length < MIN_FEATURES_FOR_FULL_SCAN) return LEGACY_SCAN_PATTERNS;
  const {layers} = normalizeArchitecture(spec.architecture ?? {});
  if (layers.size === 0) return LEGACY_SCAN_PATTERNS;
  const ext = EXT_BY_LANGUAGE[spec.project?.language ?? ''] ?? 'ts';
  return [...layers].sort().map((l) => `src/${l}/**/*.${ext}`);
}

/**
 * Finds source files not referenced by any `features[].modules`.
 *
 * Returns one `error` finding per unclaimed file. When spec.yaml is
 * absent or unparseable, returns a single `info` finding (opt-in:
 * spec-less projects keep green CI). The detector intentionally does
 * not walk the entire repo — only the directories cladding's own
 * tsconfig declares as source.
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

  const files = globSync([...scanPatterns(spec)], {cwd, dot: false});
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
