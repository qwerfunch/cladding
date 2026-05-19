// Cladding · drift detector · HARNESS_INTEGRITY
//
// Detector #17 from the catalog (axis: environment, severity: error).
// Verifies cladding's own metadata is self-consistent: the count of
// detector files under `stages/detectors/` (excluding `index.ts`)
// must match the numerator of `plugin.json current.detectors`.
//
// Filesystem-based rather than importing `allDetectors`, on purpose:
// importing the registry would create a circular dependency the
// ARCHITECTURE_VIOLATION detector would immediately flag.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {globSync} from 'tinyglobby';

import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'HARNESS_INTEGRITY';

interface PluginManifest {
  ironclad?: {
    current?: {
      detectors?: string;
    };
  };
}

function countDetectorFiles(cwd: string): number {
  const files = globSync(['src/stages/detectors/*.ts'], {cwd, dot: false});
  return files.filter((f) => !f.endsWith('/index.ts') && !f.endsWith('\\index.ts')).length;
}

function runHarnessIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const manifestPath = join(cwd, '.claude-plugin', 'plugin.json');
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `plugin.json not loaded: ${(err as Error).message}`,
      },
    ];
  }
  const declared = manifest.ironclad?.current?.detectors;
  if (!declared) return [];
  const match = declared.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    return [
      {
        detector: NAME,
        severity: 'warn',
        message: `plugin.json current.detectors='${declared}' is not in 'N/M' form`,
      },
    ];
  }
  const numerator = Number(match[1]);
  const actual = countDetectorFiles(cwd);
  if (numerator === actual) return [];
  return [
    {
      detector: NAME,
      severity: 'error',
      message:
        `plugin.json current.detectors='${declared}' but stages/detectors/` +
        `contains ${actual} non-index .ts file(s)`,
    },
  ];
}

export const harnessIntegrity: DriftDetector = {
  name: NAME,
  run: runHarnessIntegrity,
};
