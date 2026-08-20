// Cladding · toolchain · gate config (`.cladding/config.yaml::gate`)
//
// Extends the existing config surface (which parsed only `agent.{mode,name}`
// and `model`) with an OPTIONAL `gate:` block that steers module-scoped
// gating:
//
//   gate:
//     scope: feature            # feature (default) | repo (force whole-repo)
//     commands:                 # optional — replaces toolchain auto-detection
//       test: ["./gradlew", "{modules:test}"]
//     language: cpp             # optional — declared label for the spec cross-check
//
// The `{modules:TASK}` token expands to one `:<project>:TASK` argument per
// focus-feature project. No config file, or no `gate:` block, means the
// default `{scope: 'feature'}` — i.e. auto module-scoping with no override.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parse as parseYaml} from 'yaml';

import {gradleTask} from './module-scope.js';
import type {GradleProject} from './module-scope.js';

/** The four gate stages a `gate.commands` block may override. */
export type ScopedStageKey = 'type' | 'lint' | 'test' | 'coverage';

const STAGE_KEYS: readonly ScopedStageKey[] = ['type', 'lint', 'test', 'coverage'];

/** Kotlin coverage tool. `gate.coverage` selects it explicitly; else auto-detected. */
export type CoverageTool = 'kover' | 'jacoco';

/** Parsed `gate:` block. `scope` always resolves; the rest are optional. */
export interface GateConfig {
  /** `feature` (default) scopes to the focus feature's modules; `repo` forces whole-repo. */
  readonly scope: 'feature' | 'repo';
  /** Per-stage command templates that REPLACE toolchain auto-detection. */
  readonly commands?: Partial<Record<ScopedStageKey, readonly string[]>>;
  /**
   * Explicit Kotlin coverage tool. When set, overrides auto-detection for BOTH
   * the Gradle task (koverXmlReport / jacocoTestReport) and the report path the
   * COVERAGE_DROP detector reads. Absent → auto-detect, default jacoco.
   */
  readonly coverage?: CoverageTool;
  /**
   * Path to a JUnit XML test-result report (relative to cwd). When set and the
   * file exists, UNVERIFIED_AC reads it to confirm each done AC's test_refs
   * actually RAN and PASSED — closing the AC → test → observed-pass loop.
   * Absent (or file missing) → the check degrades to existence-only UNTESTED_AC.
   */
  readonly testReport?: string;
  /**
   * Declared toolchain-language label for the spec cross-check. The manifest
   * chain reads build orchestration, so a repository whose product language
   * differs from its build host (e.g. a C++ SDK built through Gradle) is
   * mislabelled by construction. When set, TECH_STACK_MISMATCH compares
   * `spec.project.language` against this declaration instead of the manifest
   * heuristic — keeping the spec truthful without silencing the check. The
   * value must match `spec.project.language` exactly (no normalisation).
   */
  readonly language?: string;
}

const DEFAULT: GateConfig = {scope: 'feature'};

/**
 * Conventional JUnit paths inspected when `gate.test_report` is not explicit.
 *
 * Kept beside the gate config resolver so the detector that consumes a report
 * and any scoped test stage that must preserve it share exactly one path set.
 *
 * @see spec/features/spec-conformance-oracle-stage-c4c5ae.yaml AC-008
 */
export const DEFAULT_TEST_REPORT_CANDIDATES = [
  'test-report.junit.xml',
  join('coverage', 'junit.xml'),
  join('.cladding', 'test-report.junit.xml'),
] as const;

/** Reads `.cladding/config.yaml::gate`, returning the default on any absence/error. */
export function readGateConfig(cwd: string = '.'): GateConfig {
  const path = join(cwd, '.cladding', 'config.yaml');
  if (!existsSync(path)) return DEFAULT;
  try {
    const parsed = parseYaml(readFileSync(path, 'utf8')) as {
      gate?: {
        scope?: unknown;
        commands?: Record<string, unknown>;
        coverage?: unknown;
        test_report?: unknown;
        language?: unknown;
      };
    } | null;
    const gate = parsed?.gate;
    if (!gate) return DEFAULT;
    const scope = gate.scope === 'repo' ? 'repo' : 'feature';
    const coverage: CoverageTool | undefined =
      gate.coverage === 'kover' || gate.coverage === 'jacoco' ? gate.coverage : undefined;
    const testReport = typeof gate.test_report === 'string' ? gate.test_report : undefined;
    const language =
      typeof gate.language === 'string' && gate.language.trim() !== '' ? gate.language.trim() : undefined;
    const commands: Partial<Record<ScopedStageKey, readonly string[]>> = {};
    if (gate.commands && typeof gate.commands === 'object') {
      for (const key of STAGE_KEYS) {
        const v = gate.commands[key];
        if (Array.isArray(v) && v.every((e) => typeof e === 'string')) {
          commands[key] = v as string[];
        }
      }
    }
    const out: GateConfig = {scope};
    if (Object.keys(commands).length > 0) (out as {commands?: unknown}).commands = commands;
    if (coverage) (out as {coverage?: unknown}).coverage = coverage;
    if (testReport) (out as {testReport?: unknown}).testReport = testReport;
    if (language) (out as {language?: unknown}).language = language;
    return out;
  } catch {
    return DEFAULT;
  }
}

/**
 * Returns every test-report path a scoped test run must leave untouched.
 *
 * The explicit `gate.test_report`, when present, is returned first, followed by
 * every conventional candidate. A scoped runner can still write its framework
 * default in addition to the configured evidence path, so report preservation
 * must cover both sets even though the detector consumes only the explicit one.
 *
 * @param cwd - Project root.
 * @returns Absolute-or-cwd-joined report paths in detector precedence order.
 * @see spec/features/spec-conformance-oracle-stage-c4c5ae.yaml AC-008
 */
export function testReportCandidatePaths(cwd: string = '.'): readonly string[] {
  const configured = readGateConfig(cwd).testReport;
  const candidates = configured
    ? [configured, ...DEFAULT_TEST_REPORT_CANDIDATES]
    : DEFAULT_TEST_REPORT_CANDIDATES;
  return [...new Set(candidates.map((candidate) => join(cwd, candidate)))];
}

/**
 * Resolves the first existing report using the detector's precedence rules.
 *
 * @param cwd - Project root.
 * @returns The selected report path, or null when no report exists.
 * @see spec/features/spec-conformance-oracle-stage-c4c5ae.yaml AC-008
 */
export function resolveTestReportPath(cwd: string = '.'): string | null {
  const configured = readGateConfig(cwd).testReport;
  if (configured) {
    const path = join(cwd, configured);
    return existsSync(path) ? path : null;
  }
  return DEFAULT_TEST_REPORT_CANDIDATES
    .map((candidate) => join(cwd, candidate))
    .find((candidate) => existsSync(candidate)) ?? null;
}

// `{modules:TASK}` — TASK is a Gradle task name (letters/digits/_.:- ).
const MODULE_TOKEN = /^\{modules:([A-Za-z0-9_.:-]+)\}$/;

/**
 * Expands a `gate.commands` template into a concrete `{cmd, args}`.
 *
 * Each `{modules:TASK}` element is replaced by one `:<project>:TASK` argument
 * per project. A static element (no token) passes through verbatim, so a
 * template with no token is just a plain command override.
 *
 * Returns null when the template carries a `{modules:…}` token but there are
 * no projects to expand it against — the caller then falls back to the
 * repo-level gate (the token would otherwise vanish, silently widening scope).
 */
export function expandModuleTokens(
  template: readonly string[],
  projects: readonly GradleProject[],
): {cmd: string; args: readonly string[]} | null {
  const out: string[] = [];
  let sawToken = false;
  for (const el of template) {
    const m = MODULE_TOKEN.exec(el);
    if (m) {
      sawToken = true;
      for (const p of projects) out.push(gradleTask(p.path, m[1]));
    } else {
      out.push(el);
    }
  }
  if (sawToken && projects.length === 0) return null;
  if (out.length === 0) return null;
  return {cmd: out[0], args: out.slice(1)};
}
