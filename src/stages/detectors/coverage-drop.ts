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

import {resolveLanguageConfig} from '../toolchain/language-config.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'COVERAGE_DROP';
const FLOOR_PERCENT = 70;

interface CoverageSummary {
  total?: {
    lines?: {pct?: number};
    statements?: {pct?: number};
  };
}

/** Istanbul/vitest `coverage-summary.json` → total line pct, or null if absent. */
function readIstanbulLinePct(body: string): number | null {
  const summary = JSON.parse(body) as CoverageSummary;
  return summary.total?.lines?.pct ?? 0;
}

/**
 * JaCoCo XML (`jacocoTestReport`) → overall LINE pct.
 *
 * JaCoCo emits one `<counter type="LINE" missed=… covered=…/>` per class,
 * per package, and a final report-level aggregate — the aggregate is the
 * LAST LINE counter in the document. pct = covered / (covered + missed).
 */
function readJacocoLinePct(body: string): number | null {
  const re = /<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) last = m;
  if (!last) return null;
  const missed = Number(last[1]);
  const covered = Number(last[2]);
  const total = missed + covered;
  return total === 0 ? 100 : (covered / total) * 100;
}

function runCoverageDrop(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const cfg = resolveLanguageConfig(cwd);
  const summaryRel = cfg.coverageSummary;
  const path = join(cwd, summaryRel);
  if (!existsSync(path)) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `${summaryRel} not present — run stage_2.2 first`,
      },
    ];
  }
  let lines: number | null;
  try {
    const body = readFileSync(path, 'utf8');
    lines =
      cfg.coverageFormat === 'jacoco-xml' ? readJacocoLinePct(body) : readIstanbulLinePct(body);
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'warn',
        message: `${summaryRel} unparseable: ${(err as Error).message}`,
      },
    ];
  }
  if (lines === null) {
    return [
      {
        detector: NAME,
        severity: 'warn',
        message: `${summaryRel} contained no line-coverage counter`,
      },
    ];
  }
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
