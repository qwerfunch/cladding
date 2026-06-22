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
}

const DEFAULT: GateConfig = {scope: 'feature'};

/** Reads `.cladding/config.yaml::gate`, returning the default on any absence/error. */
export function readGateConfig(cwd: string = '.'): GateConfig {
  const path = join(cwd, '.cladding', 'config.yaml');
  if (!existsSync(path)) return DEFAULT;
  try {
    const parsed = parseYaml(readFileSync(path, 'utf8')) as {
      gate?: {scope?: unknown; commands?: Record<string, unknown>; coverage?: unknown};
    } | null;
    const gate = parsed?.gate;
    if (!gate) return DEFAULT;
    const scope = gate.scope === 'repo' ? 'repo' : 'feature';
    const coverage: CoverageTool | undefined =
      gate.coverage === 'kover' || gate.coverage === 'jacoco' ? gate.coverage : undefined;
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
    return out;
  } catch {
    return DEFAULT;
  }
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
