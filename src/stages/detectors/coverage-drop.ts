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

import {
  COVERAGE_REPORTS_PROBE,
  kotlinCoverageReport,
} from '../toolchain/coverage-tool.js';
import {resolveLanguageConfig} from '../toolchain/language-config.js';
import {isGradleCmd, mapModulesToProjects} from '../toolchain/module-scope.js';
import {detectToolchain} from '../toolchain/detect.js';
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
 * JaCoCo / Kover XML → the report-level LINE counter `{missed, covered}`.
 *
 * Both tools emit one `<counter type="LINE" missed=… covered=…/>` per class,
 * per package, and a final report-level aggregate — the aggregate is the LAST
 * LINE counter in the document (Kover's XML is JaCoCo-format, so one parser
 * serves both).
 */
function lastLineCounter(body: string): {missed: number; covered: number} | null {
  const re = /<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) last = m;
  if (!last) return null;
  return {missed: Number(last[1]), covered: Number(last[2])};
}

function pct(missed: number, covered: number): number {
  const total = missed + covered;
  return total === 0 ? 100 : (covered / total) * 100;
}

/** JaCoCo/Kover XML → overall LINE pct, or null when no LINE counter exists. */
function readJacocoLinePct(body: string): number | null {
  const c = lastLineCounter(body);
  return c === null ? null : pct(c.missed, c.covered);
}

/**
 * Module-scoped coverage: collects each focus-feature project's per-module
 * report (Kover first, JaCoCo fallback) and merges their LINE counters into
 * one aggregate pct. Returns the merged findings, or null when scoping does
 * not apply (no focus modules, or a non-Gradle repo) so the caller falls back
 * to the repo-level single-summary path.
 */
function runModuleScoped(cwd: string, focusModules: readonly string[]): readonly DriftFinding[] | null {
  if (!isGradleCmd(detectToolchain(cwd).gates.coverage?.cmd)) return null;
  let projects;
  try {
    projects = mapModulesToProjects(cwd, focusModules);
  } catch (err) {
    return [{detector: NAME, severity: 'error', message: (err as Error).message}];
  }
  let missed = 0;
  let covered = 0;
  let found = 0;
  const absent: string[] = [];
  for (const p of projects) {
    const rel = COVERAGE_REPORTS_PROBE.find((r) => existsSync(join(p.dir, r)));
    if (!rel) {
      absent.push(p.path);
      continue;
    }
    const c = lastLineCounter(readFileSync(join(p.dir, rel), 'utf8'));
    if (c) {
      missed += c.missed;
      covered += c.covered;
      found++;
    }
  }
  if (found === 0) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `no module coverage report present for ${projects
          .map((p) => p.path)
          .join(', ')} — run stage_2.2 first`,
      },
    ];
  }
  const merged = pct(missed, covered);
  if (merged < FLOOR_PERCENT) {
    return [
      {
        detector: NAME,
        severity: 'warn',
        message: `merged module line coverage ${merged.toFixed(1)}% < floor ${FLOOR_PERCENT}% (${found} module(s))`,
      },
    ];
  }
  return absent.length > 0
    ? [
        {
          detector: NAME,
          severity: 'info',
          message: `module coverage ${merged.toFixed(1)}% OK; no report yet for ${absent.join(', ')}`,
        },
      ]
    : [];
}

function runCoverageDrop(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  if (opts.focusModules && opts.focusModules.length > 0) {
    const scoped = runModuleScoped(cwd, opts.focusModules);
    if (scoped) return scoped;
  }
  const cfg = resolveLanguageConfig(cwd);
  // Kotlin: the coverage report is Kover OR JaCoCo. Probe both by existence
  // (Kover-first); when neither is present yet, name the resolved tool's path
  // so the "run stage_2.2 first" hint points at the right file.
  const summaryRel =
    detectToolchain(cwd).language === 'kotlin'
      ? (COVERAGE_REPORTS_PROBE.find((r) => existsSync(join(cwd, r))) ?? kotlinCoverageReport(cwd))
      : cfg.coverageSummary;
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
