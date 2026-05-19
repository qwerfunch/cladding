// Cladding · drift detector · PERFORMANCE_DRIFT
//
// Detector #12 from the catalog (axis: code_vs_test, severity: warn).
// v0.1 floor: parses an optional `perf/baseline.json` artifact and
// compares it to `perf/current.json`. When a metric regresses by more
// than 10% it emits a warn. Schema is intentionally permissive:
//
//   { "metrics": { "<name>": { "value": <number>, "unit": "<string>" } } }
//
// Missing baseline OR current → info finding (opt-in). The richer
// k6 / lighthouse / wrk-specific variants can land per-toolchain later.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'PERFORMANCE_DRIFT';
const BASELINE = 'perf/baseline.json';
const CURRENT = 'perf/current.json';
const REGRESSION_PERCENT = 10;

interface PerfReport {
  metrics?: Record<string, {value?: number; unit?: string}>;
}

function load(path: string): PerfReport | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PerfReport;
  } catch {
    return undefined;
  }
}

function runPerformanceDrift(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const baseline = load(join(cwd, BASELINE));
  const current = load(join(cwd, CURRENT));
  if (!baseline || !current) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: 'perf baseline or current missing — run stage_3.2 with --record first',
      },
    ];
  }
  const findings: DriftFinding[] = [];
  for (const [name, bMetric] of Object.entries(baseline.metrics ?? {})) {
    const cMetric = current.metrics?.[name];
    if (!cMetric || typeof bMetric.value !== 'number' || typeof cMetric.value !== 'number') continue;
    if (bMetric.value === 0) continue;
    const deltaPct = ((cMetric.value - bMetric.value) / bMetric.value) * 100;
    if (deltaPct > REGRESSION_PERCENT) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message:
          `${name} regressed ${deltaPct.toFixed(1)}% (baseline ${bMetric.value}${bMetric.unit ?? ''}` +
          ` → current ${cMetric.value}${cMetric.unit ?? ''})`,
      });
    }
  }
  return findings;
}

export const performanceDrift: DriftDetector = {
  name: NAME,
  run: runPerformanceDrift,
};
