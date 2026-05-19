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

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'UNMAPPED_ARTIFACT';

/**
 * Directories cladding scans for "real" source files when looking for
 * artifacts not claimed by any feature. This list mirrors the
 * `tsconfig.include` patterns; it is intentionally narrow so test
 * fixtures, generated files, and tooling configs don't appear as
 * findings.
 */
const SCAN_PATTERNS: readonly string[] = ['src/stages/**/*.ts', 'src/spec/**/*.ts'];

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
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `spec.yaml not loaded: ${(err as Error).message}`,
      },
    ];
  }
  const claimed = new Set<string>();
  for (const feature of spec.features) {
    for (const modulePath of feature.modules ?? []) claimed.add(modulePath);
  }

  const files = globSync([...SCAN_PATTERNS], {cwd, dot: false});
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
