// Cladding · drift detector · COVERAGE_DROP
//
// Detector #9 from the catalog (axis: code_vs_test, severity: warn).
// Parses the vitest `coverage/coverage-summary.json` artifact (if present)
// and emits a warn finding when the total line coverage falls below the
// floor. The floor defaults to 70% but is project-configurable via
// `spec.yaml::project.coverage_floor` (F-14ad7e75) — project-WIDE, because
// vitest coverage is a single project number and the detector has no
// per-feature context. Lower it where instrumentation overhead (perf
// harnesses, generated files) makes a uniform 70 punitive; raise it to demand
// more.
//
// Cladding does NOT spawn the coverage tool from inside the detector
// — that's stage_2.2's job. The detector reads the artifact left
// behind by a prior run. Missing artifact → single info finding.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'COVERAGE_DROP';
const COVERAGE_SUMMARY = 'coverage/coverage-summary.json';
const DEFAULT_FLOOR_PERCENT = 70;

/**
 * Resolves the line-coverage floor for `cwd`: `project.coverage_floor` when a
 * spec declares a valid percent [0,100], else the 70% default. Reading the spec
 * is best-effort and isolated in a try/catch — an absent or invalid spec must
 * NOT crash the coverage check (error-as-data: a broken SSoT root is
 * ABSENCE_OF_GOVERNANCE's finding to raise, not this detector's). loadSpec hits
 * the run-scoped cache during a gate run, so this adds no extra YAML parse.
 */
function resolveFloor(cwd: string): number {
  try {
    const floor = loadSpec(cwd).project?.coverage_floor;
    if (typeof floor === 'number' && Number.isFinite(floor) && floor >= 0 && floor <= 100) {
      return floor;
    }
  } catch {
    // spec absent or unparseable → keep the default; the check works spec-less.
  }
  return DEFAULT_FLOOR_PERCENT;
}

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
  const floor = resolveFloor(cwd);
  const lines = summary.total?.lines?.pct ?? 0;
  if (lines >= floor) return [];
  return [
    {
      detector: NAME,
      severity: 'warn',
      message:
        `line coverage ${lines.toFixed(1)}% < floor ${floor}%` +
        ' (raise coverage, or set project.coverage_floor to a justified lower bound)',
    },
  ];
}

export const coverageDrop: DriftDetector = {
  name: NAME,
  run: runCoverageDrop,
};
