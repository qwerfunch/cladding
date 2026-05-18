// Cladding · drift detector · COVERAGE_DROP
//
// Detector #9 from the catalog (axis: code_vs_test, severity: warn).
// v0.1 floor: parses the vitest `coverage/coverage-summary.json`
// artifact (if present) and emits a warn finding when the total line
// coverage falls below 70% (project-configurable later via
// spec.yaml architecture or plugin.json).
//
// Cladding does NOT spawn the coverage tool from inside the detector
// — that's stage_2.2's job. The detector reads the artifact left
// behind by a prior run. Missing artifact → single info finding.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'COVERAGE_DROP';
const COVERAGE_SUMMARY = 'coverage/coverage-summary.json';
const FLOOR_PERCENT = 70;

interface CoverageSummary {
  total?: {
    lines?: {pct?: number};
    statements?: {pct?: number};
  };
}

function runCoverageDrop(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const path = join(cwd, COVERAGE_SUMMARY);
  if (!existsSync(path)) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `${COVERAGE_SUMMARY} not present — run stage_2.2 first`,
      },
    ];
  }
  let summary: CoverageSummary;
  try {
    summary = JSON.parse(readFileSync(path, 'utf8')) as CoverageSummary;
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'warn',
        message: `${COVERAGE_SUMMARY} unparseable: ${(err as Error).message}`,
      },
    ];
  }
  const lines = summary.total?.lines?.pct ?? 0;
  if (lines >= FLOOR_PERCENT) return [];
  return [
    {
      detector: NAME,
      severity: 'warn',
      message: `line coverage ${lines.toFixed(1)}% < floor ${FLOOR_PERCENT}%`,
    },
  ];
}

export const coverageDrop: DriftDetector = {
  name: NAME,
  run: runCoverageDrop,
};
