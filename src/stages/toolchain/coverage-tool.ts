// Cladding · toolchain · Kotlin coverage tool selection (Kover | JaCoCo)
//
// Kotlin repos use either JaCoCo (`jacocoTestReport`) or Kover
// (`koverXmlReport`). The two emit the SAME JaCoCo-format XML (one
// `<counter type="LINE" …/>` aggregate), so the parser is shared — only the
// Gradle task name and the report path differ.
//
// Selection precedence:
//   1. explicit  — `.cladding/config.yaml` gate.coverage: kover | jacoco
//   2. auto      — the Kover plugin id referenced anywhere a build declares
//                  plugins (root build, settings, version catalog, buildSrc,
//                  build-logic). Text-scan, because this repo applies Kover via
//                  a convention plugin keyed on gradle.properties, so the token
//                  may live outside the module build files.
//   3. default   — jacoco (the pre-existing behavior; no regression).

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

import {readGateConfig} from './gate-config.js';
import type {CoverageTool} from './gate-config.js';

export type {CoverageTool};

/** Gradle task that produces each tool's XML report. */
export const COVERAGE_TASK: Record<CoverageTool, string> = {
  kover: 'koverXmlReport',
  jacoco: 'jacocoTestReport',
};

/** Default XML report path each tool writes (relative to a project dir). */
export const COVERAGE_REPORT: Record<CoverageTool, string> = {
  kover: 'build/reports/kover/report.xml',
  jacoco: 'build/reports/jacoco/test/jacocoTestReport.xml',
};

/** Report paths probed (Kover-first) when reading coverage by existence. */
export const COVERAGE_REPORTS_PROBE: readonly string[] = [
  COVERAGE_REPORT.kover,
  COVERAGE_REPORT.jacoco,
];

const KOVER_RE = /kover/i;

/** True when a directory's build script / gradle.properties references Kover. */
export function dirHasKover(dir: string): boolean {
  for (const name of ['build.gradle.kts', 'build.gradle', 'gradle.properties']) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try {
      if (KOVER_RE.test(readFileSync(p, 'utf8'))) return true;
    } catch {
      /* unreadable → treat as no kover */
    }
  }
  return false;
}

// Files most likely to declare the Kover plugin, beyond the module build.
const ROOT_PROBE_FILES = [
  'build.gradle.kts',
  'build.gradle',
  'settings.gradle.kts',
  'settings.gradle',
  'gradle/libs.versions.toml',
];
const CONVENTION_DIRS = ['buildSrc', 'build-logic'];

function fileHasKover(path: string): boolean {
  try {
    return existsSync(path) && KOVER_RE.test(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

/** Shallow recursive Kover scan of a convention dir (bounded, *.kts/*.gradle/*.toml). */
function dirTreeHasKover(dir: string, depth = 0): boolean {
  if (depth > 4 || !existsSync(dir)) return false;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (e === 'build' || e === '.gradle' || e === 'node_modules') continue;
      if (dirTreeHasKover(p, depth + 1)) return true;
    } else if (/\.(kts|gradle|toml)$/.test(e) && fileHasKover(p)) {
      return true;
    }
  }
  return false;
}

function autoDetectKover(cwd: string): boolean {
  if (dirHasKover(cwd)) return true;
  for (const rel of ROOT_PROBE_FILES) if (fileHasKover(join(cwd, rel))) return true;
  for (const d of CONVENTION_DIRS) if (dirTreeHasKover(join(cwd, d))) return true;
  return false;
}

/**
 * Resolves the Kotlin coverage tool for a project. Explicit config wins; then
 * Kover auto-detection; then jacoco.
 */
export function resolveKotlinCoverageTool(cwd: string = '.'): CoverageTool {
  const explicit = readGateConfig(cwd).coverage;
  if (explicit) return explicit;
  return autoDetectKover(cwd) ? 'kover' : 'jacoco';
}

/** The Gradle coverage task for a Kotlin project (root/aggregate scope). */
export function kotlinCoverageTask(cwd: string = '.'): string {
  return COVERAGE_TASK[resolveKotlinCoverageTool(cwd)];
}

/** The expected coverage report path for a Kotlin project (resolved tool). */
export function kotlinCoverageReport(cwd: string = '.'): string {
  return COVERAGE_REPORT[resolveKotlinCoverageTool(cwd)];
}
