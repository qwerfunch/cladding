// Cladding · drift detector · MISSING_IMPLEMENTATION
//
// First Ironclad-native detector (T4). Detector #2 from the catalog
// (axis: spec_vs_code, severity: error).
//
// Compares `features[].modules` from spec.yaml against the actual file
// system. A module declared in the spec but absent from disk is a
// concrete, unambiguous drift — the feature has been *promised* but
// not implemented (or was renamed without spec update).
//
// Pure Ironclad-native: no OSS dependency, no toolchain delegation —
// just spec ↔ filesystem comparison. This is the kind of detector that
// makes cladding distinct from "just a polyglot CI wrapper".

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'MISSING_IMPLEMENTATION';

/**
 * Verifies every module path declared in spec.yaml exists on disk.
 *
 * Per-feature, per-module: `error` finding when the path is absent.
 * When spec.yaml itself cannot be loaded, emits a single `info` finding
 * — the detector is *opt-in* on spec presence, not a failure on
 * spec-less projects.
 *
 * @see iron-law.md stage_1.3 — detector contract.
 * @see ironclad-design/08-drift-detectors.md — MISSING_IMPLEMENTATION (#2).
 */
function runMissingImplementation(opts: CommandStageOptions): readonly DriftFinding[] {
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
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    for (const modulePath of feature.modules ?? []) {
      const absolute = join(cwd, modulePath);
      if (existsSync(absolute)) continue;
      findings.push({
        detector: NAME,
        severity: 'error',
        path: modulePath,
        message:
          `feature ${feature.id} declares module '${modulePath}'` +
          ' but the file does not exist',
      });
    }
  }
  return findings;
}

export const missingImplementation: DriftDetector = {
  name: NAME,
  run: runMissingImplementation,
};
