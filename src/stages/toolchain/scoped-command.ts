// Cladding · toolchain · scoped stage-command resolution
//
// The single brain the command stages (1.1 type, 1.2 lint, 2.1 unit, 2.2 cov)
// share to decide WHAT to run. Precedence, highest first:
//
//   1. opts.cmd            — explicit per-call override (tests, power users)
//   2. gate.commands[stage] — `.cladding/config.yaml` template (token-expanded)
//   3. module-scoped gate  — focus feature's `modules[]` → `:project:task`
//   4. repo gate           — toolchain auto-detection (the original behavior)
//
// Module-scoping engages ONLY when: scope is `feature` (the default), the
// focus feature carries `modules[]`, AND the repo's gate is Gradle. Every
// other path (no modules, `scope: repo`, non-Gradle language) falls through
// to the repo gate, so existing behavior is byte-for-byte preserved.

import type {CommandStageOptions} from '../types.js';

import {COVERAGE_TASK, dirHasKover} from './coverage-tool.js';
import {detectToolchain, gradleCmd} from './detect.js';
import {expandModuleTokens, readGateConfig} from './gate-config.js';
import type {CoverageTool, ScopedStageKey} from './gate-config.js';
import {gradleTask, isGradleCmd, mapModulesToProjects} from './module-scope.js';
import type {GradleProject} from './module-scope.js';

/** The toolchain gate key each scoped stage maps to. */
const GATE_KEY: Record<ScopedStageKey, 'type' | 'lint' | 'test' | 'coverage'> = {
  type: 'type',
  lint: 'lint',
  test: 'test',
  coverage: 'coverage',
};

/** Resolved stage command. `cmd`/`args` undefined → stage reports a skip. */
export interface ResolvedStageCommand {
  readonly cmd?: string;
  readonly args?: readonly string[];
  /** Detected project language, for the stage's "no X registered" message. */
  readonly language: string;
}

/** Builds the batched, single-invocation Gradle task list for a scoped stage. */
function buildScopedGate(
  cwd: string,
  stage: ScopedStageKey,
  projects: readonly GradleProject[],
  coverageTool?: CoverageTool,
): {cmd: string; args: readonly string[]} {
  const g = gradleCmd(cwd);
  let args: string[];
  switch (stage) {
    case 'type':
      args = projects.flatMap((p) => [
        gradleTask(p.path, 'compileKotlin'),
        gradleTask(p.path, 'compileTestKotlin'),
      ]);
      break;
    case 'lint':
      args = projects.map((p) => gradleTask(p.path, 'ktlintCheck'));
      break;
    case 'test':
      args = projects.map((p) => gradleTask(p.path, 'test'));
      break;
    case 'coverage':
      // Explicit gate.coverage applies to every module; otherwise pick
      // per-module (Kover when the module declares it, else JaCoCo).
      args = projects.map((p) => {
        const tool: CoverageTool = coverageTool ?? (dirHasKover(p.dir) ? 'kover' : 'jacoco');
        return gradleTask(p.path, COVERAGE_TASK[tool]);
      });
      break;
  }
  return {cmd: g, args};
}

/**
 * Resolves the command a scoped stage should execute. See the module header
 * for precedence. Throws when the focus feature declares `modules[]` that
 * cannot be mapped to a Gradle project — a loud failure, never a silent
 * whole-repo fallback (the empty-`modules[]` case never reaches here).
 *
 * @throws Error from {@link mapModulesToProjects} on an unmappable module.
 */
export function resolveStageCommand(
  stage: ScopedStageKey,
  opts: CommandStageOptions = {},
): ResolvedStageCommand {
  const cwd = opts.cwd ?? '.';
  const toolchain = detectToolchain(cwd);
  const language = toolchain.language;
  // 1. Explicit override wins outright.
  if (opts.cmd) return {cmd: opts.cmd, args: opts.args ?? [], language};

  const repoGate = toolchain.gates[GATE_KEY[stage]];
  const cfg = readGateConfig(cwd);
  const gradle = isGradleCmd(repoGate?.cmd);

  // Module-scoping only resolves projects for a Gradle repo under feature scope
  // with a non-empty focus. mapModulesToProjects throws on an unmappable path.
  let projects: GradleProject[] = [];
  if (cfg.scope === 'feature' && gradle && opts.focusModules && opts.focusModules.length > 0) {
    projects = mapModulesToProjects(cwd, opts.focusModules);
  }

  // 2. Config template override (token-expanded). A `{modules:…}` template with
  // no projects → null → fall through to the repo gate.
  const template = cfg.commands?.[stage];
  if (template) {
    const expanded = expandModuleTokens(template, projects);
    if (expanded) return {cmd: expanded.cmd, args: expanded.args, language};
  }

  // 3. Auto module-scoped Gradle gate.
  if (projects.length > 0) {
    const scoped = buildScopedGate(cwd, stage, projects, cfg.coverage);
    return {cmd: scoped.cmd, args: scoped.args, language};
  }

  // 4. Repo gate — the original toolchain default.
  return {cmd: repoGate?.cmd, args: repoGate?.args, language};
}
