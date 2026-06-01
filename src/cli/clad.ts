// Cladding · `clad` CLI entry — composes the 7 Iron Core verbs.
//
// Uses `commander` for parsing. Each verb's handler is exported as a
// named function so unit tests can exercise it without spawning a
// subprocess; the top-level `program.parse()` is guarded by
// `isCliEntry` so importing the module from a test does not trigger
// CLI behavior.

import process from 'node:process';

import {Command} from 'commander';

import {classifyIntent} from '../router/intent.js';
import {runDoctorCommand} from './doctor.js';
import {performDone} from './done.js';
import {performUpdate} from './update.js';
import {runInit} from './init.js';
import {runRefineCommand} from './refine.js';
import {runHostSetup} from '../init/host-setup.js';
import {runArch} from '../stages/arch.js';
import {runAudit} from '../stages/audit.js';
import {runCommit} from '../stages/commit.js';
import {runCov} from '../stages/cov.js';
import {runDrift} from '../stages/drift.js';
import {runLint} from '../stages/lint.js';
import {runPerf} from '../stages/perf.js';
import {runSecret} from '../stages/secret.js';
import {runSmoke} from '../stages/smoke.js';
import {runSpecConformance} from '../stages/spec-conformance.js';
import {runType} from '../stages/type.js';
import {runUat} from '../stages/uat.js';
import {runUnit} from '../stages/unit.js';
import {runVisual} from '../stages/visual.js';
import type {DriftFinding} from '../stages/types.js';
import {staleSpecification} from '../stages/detectors/stale-specification.js';
import {findLatestCheckpoint, recordCheckpoint, recordRollback} from '../core/checkpoint.js';
import {computeInventory, writeInventoryToSpecYaml} from '../spec/inventory.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';
import {renderPanel} from '../ui/panel.js';
import {featureLabel, gateLabel, haltMessage} from '../ui/softShell.js';

/** Handler for `clad serve`. Boots the MCP server over stdio. */
export async function runServeCommand(opts: {cwd?: string}): Promise<void> {
  // Dynamic import: the MCP SDK is sizeable and most `clad` invocations
  // never reach `serve`. Loading it on-demand keeps cold-start fast.
  const [{buildServer}, {StdioServerTransport}, {setHostMcpServer}] = await Promise.all([
    import('../serve/server.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('../adapters/host/sampling-context.js'),
  ]);
  const server = buildServer({cwd: opts.cwd});
  // v0.2.26 (F-075): register the server in the sampling context so
  // the host adapters (`generic-mcp`, `claude-code`) automatically
  // route LLM dispatch through McpSamplingTransport instead of the
  // Mock fallback. The registration is process-scoped; clearing it
  // is not necessary because the cladding process exits when stdio
  // closes.
  setHostMcpServer(server.server);
  const transport = new StdioServerTransport();
  // stdout is reserved for MCP protocol traffic on stdio transport, so
  // status lines go to stderr via pulse (which writes to stderr by
  // default; verified below if pulse changes).
  pulse('start', 'serve', `stdio transport · cwd=${opts.cwd ?? '.'}`);
  await server.connect(transport);
  // The server runs until the client closes stdio; connect() does not
  // resolve until then on stdio transport, so we await it as-is. If a
  // host wraps cladding without proper close semantics, Ctrl-C in the
  // host process terminates this child.
}

/**
 * Handler for `clad init`. Scaffolds a workspace at cwd, then exits 0.
 *
 * `--scan` walks the existing codebase and writes `docs/conventions.md`
 * + `spec/architecture.yaml` + per-layer scenario stubs so external
 * projects adopting cladding inherit a maintenance brief — see
 * ironclad-design/07-ssot-init.md §3 B. `--no-llm` forces the
 * deterministic interpreter (v0.3.24 default until v0.3.25 wires the
 * MCP sampling dispatcher).
 */
export async function runInitCommand(
  intentTokens: readonly string[] | undefined,
  opts: {
    name?: string;
    force?: boolean;
    scan?: boolean;
    noLlm?: boolean;
    roots?: string;
    withHook?: boolean;
  },
): Promise<void> {
  const intent = intentTokens && intentTokens.length > 0 ? intentTokens.join(' ').trim() : undefined;
  const result = await runInit({
    projectName: opts.name,
    force: opts.force,
    scan: opts.scan,
    noLlm: opts.noLlm,
    roots: opts.roots ? opts.roots.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    intent,
    withHook: opts.withHook,
  });
  for (const c of result.created) pulse('pass', `created ${c}`);
  for (const s of result.skipped) pulse('skip', s);
  for (const p of result.proposals ?? []) pulse('note', 'proposal', p);
  const modeDetail = result.onboardingMode ? `language: ${result.language} · mode: ${result.onboardingMode}` : `language: ${result.language}`;
  pulse('note', 'init done', modeDetail);

  // v0.3.43 — surface LLM-generated clarifying questions so the AI
  // host (or a direct CLI user) sees the next-step prompts that
  // refine the spec. The questions are calibrated to product-owner
  // vocabulary — no implementation jargon.
  if (result.clarifyingQuestions && result.clarifyingQuestions.length > 0) {
    process.stdout.write('\n💡 다음 정보가 있으면 더 정확한 스펙이 됩니다:\n');
    for (const [i, q] of result.clarifyingQuestions.entries()) {
      process.stdout.write(`   ${i + 1}. ${q}\n`);
    }
    process.stdout.write('\n');
  } else if (!intent) {
    // Greenfield + no intent + direct CLI user — emit a gentle hint
    // suggesting the intent-driven path so they can re-run with more
    // context. The orchestrator persona normally asks for intent
    // BEFORE invoking `clad init`, so this hint fires mostly for
    // power users who skip the chat flow.
    const greenfield = result.created.some((c) => c === 'docs/conventions.md');
    if (greenfield) {
      process.stdout.write('\n💡 Tip: 더 정확한 스캐폴드를 원하시면\n');
      process.stdout.write('   clad init <project description>\n');
      process.stdout.write('   예: clad init 결제 SaaS for B2B\n');
      process.stdout.write('   기존 seeds 는 .cladding/scan/*.proposal 로 분기됩니다.\n\n');
    }
  }

  process.exit(0);
}

/**
 * Handler for `clad work [verb]`. Reserved-but-unimplemented intent-routing
 * entry point (see skills/work/SKILL.md).
 *
 * It must NOT exit 0 for work it did not do — a no-op that reports success is
 * Vacuous Green at the command level (a script/CI calling `clad work X` would
 * read the exit-0 as "done"). Until the real router lands, it declines
 * honestly with exitCode 2 (not-applicable / skipped) and points at the
 * working paths: `clad route <prompt>` to classify intent, then run the
 * resolved verb — or just ask the AI host in natural language.
 */
export function runWorkCommand(verb?: string): void {
  if (verb) {
    pulse(
      'skip',
      `work ${verb}`,
      'not implemented — run `clad route <prompt>` then the resolved verb, or ask your AI host in natural language',
    );
  } else {
    pulse('note', 'work', 'specify a stage or natural-language intent');
  }
  process.exit(2);
}

interface DriveCommandOptions {
  cwd?: string;
  maxIterations: string;
  maxWallClockMs: string;
  maxRetries: string;
  json?: boolean;
}

/** Handler for `clad drive [goal]`. Runs the autonomous loop. */
export async function runDriveCommand(
  goal: string | undefined,
  opts: DriveCommandOptions,
): Promise<void> {
  const {runDriveLoop} = await import('../drive/loop.js');
  const result = await runDriveLoop({
    cwd: opts.cwd,
    goal,
    budget: {
      maxIterations: Number(opts.maxIterations),
      maxWallClockMs: Number(opts.maxWallClockMs),
      maxRetriesPerFeature: Number(opts.maxRetries),
    },
  });
  const tag = result.halt.class === 'ALL_FEATURES_DONE' ? 'pass' : 'note';
  if (opts.json) {
    pulse(
      tag,
      'drive',
      `halt=${result.halt.class} iter=${result.iterations} features=${result.featuresTouched.length} stubs=${result.stubsCreated.length} gates=${result.gateRuns}`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const spec = loadSpec(opts.cwd ?? '.');
    const touched = result.featuresTouched.map((id) => featureLabel(id, spec));
    const summary = `${haltMessage(result.halt, spec)} iter=${result.iterations} features=${touched.length} stubs=${result.stubsCreated.length} gates=${result.gateRuns}`;
    pulse(tag, 'drive', summary);
    if (touched.length > 0) {
      process.stdout.write(`Touched: ${touched.join(', ')}\n`);
    }
  }
  process.exit(result.halt.class === 'UNCAUGHT_ERROR' ? 1 : 0);
}

/**
 * Handler for `clad sync`. Validates the spec and reports feature
 * count. With `--propose-archive`, runs the STALE_SPECIFICATION
 * detector and prints the subset of findings whose
 * `suggestion.action === 'propose-archive'` — the Phased
 * Decommissioning Tier 2 entry point (ironclad-design 07-ssot-init §5).
 *
 * Output format matches the Pulse UI conventions — one note per
 * candidate, then a summary. Exit 0 either way; the maintainer
 * decides whether to update the spec.
 */
export function runSyncCommand(opts: {proposeArchive?: boolean} = {}): void {
  try {
    const spec = loadSpec();
    // v0.3.56 (F-5b9f9f) — auto-rewrite the `inventory:` block in
    // spec.yaml on every sync so AI agents can grep 1 file to see
    // the project's whole scale. ISO-date `last_synced` keeps the
    // file commit-stable across same-day runs.
    const inventory = computeInventory('.');
    writeInventoryToSpecYaml('.', inventory);
    if (opts.proposeArchive) {
      const findings = staleSpecification.run({cwd: '.'});
      const proposals = findings.filter(
        (f) => f.suggestion?.action === 'propose-archive',
      );
      if (proposals.length === 0) {
        pulse('pass', 'sync', `${spec.features.length} features · 0 archive candidates`);
        process.exit(0);
        return;
      }
      for (const p of proposals) {
        const args = p.suggestion?.args ?? {};
        const featureId = String(args.featureId ?? '?');
        const reason = String(args.reason ?? p.message);
        pulse('note', `propose-archive · ${featureId}`, reason);
      }
      pulse(
        'pass',
        'sync',
        `${spec.features.length} features · ${proposals.length} archive candidate(s)`,
      );
      process.exit(0);
      return;
    }
    pulse('pass', 'sync', `${spec.features.length} features valid`);
    process.exit(0);
  } catch (err) {
    pulse('fail', 'sync', (err as Error).message);
    process.exit(1);
  }
}

/**
 * Handler for `clad checkpoint <featureId>`. Phase 1 of the
 * Iron Law backbone — records a `feature_checkpoint` event capturing
 * git HEAD + spec digest. No working-tree mutation. The maintainer
 * keeps the option to actually freeze the state with a normal git
 * commit; cladding only stamps the audit-log entry.
 *
 * @see iron-law.md §2.5
 */
export function runCheckpointCommand(featureId: string): void {
  if (!featureId) {
    pulse('fail', 'checkpoint', 'feature id required (e.g. clad checkpoint F-001)');
    process.exit(2);
    return;
  }
  const cp = recordCheckpoint('.', featureId);
  const head = cp.gitHead ? cp.gitHead.slice(0, 12) : '(no git)';
  pulse('pass', `checkpoint · ${featureId}`, `head=${head} digest=${cp.specDigest.slice(0, 12)}`);
  process.exit(0);
}

/**
 * Handler for `clad rollback <featureId>`. Phase 1 records the
 * `feature_rolled_back` transition and prints the maintainer-runnable
 * git command for the latest checkpoint. Cladding does **not** run the
 * checkout itself — the host's branch policy and dirty-working-tree
 * state may demand a non-default strategy, so the decision stays with
 * the maintainer. A later phase may take this over for the drive loop.
 */
export function runRollbackCommand(featureId: string, opts: {reason?: string} = {}): void {
  if (!featureId) {
    pulse('fail', 'rollback', 'feature id required (e.g. clad rollback F-001)');
    process.exit(2);
    return;
  }
  const cp = findLatestCheckpoint('.', featureId);
  if (!cp) {
    pulse('fail', `rollback · ${featureId}`, 'no prior checkpoint recorded');
    process.exit(1);
    return;
  }
  recordRollback('.', featureId, cp, opts.reason);
  const head = cp.gitHead ? cp.gitHead.slice(0, 12) : '(no git)';
  pulse('pass', `rollback · ${featureId}`, `target head=${head} ts=${cp.timestamp}`);
  if (cp.gitHead) {
    process.stdout.write(`Run: git checkout ${cp.gitHead}\n`);
  } else {
    process.stdout.write('No git head pinned — restore spec.yaml manually from VCS history.\n');
  }
  process.exit(0);
}

/** Handler for `clad setup`. Wires cladding into installed AI tool host channels. */
export async function runSetupCommand(opts: {force?: boolean; quiet?: boolean}): Promise<void> {
  const result = await runHostSetup({force: opts.force, quiet: opts.quiet});
  process.exit(result.errors.length > 0 ? 1 : 0);
}

/**
 * Handler for `clad update`. The one-command "after you upgraded the engine"
 * step, run from INSIDE the project you want to reconcile: re-wire hosts +
 * reconcile the spec inventory + refresh the managed CLAUDE.md/AGENTS.md section
 * (all safe + idempotent — see cli/update.ts), THEN run the now-stricter
 * detectors in REPORT mode. The drift report never blocks and never edits the
 * user's spec — it only surfaces the bar the upgrade raised, so `clad update`
 * can't quietly hide that the engine got stricter. It reconciles only the
 * CURRENT directory (no `--cwd`): the inventory/section refresh and the drift
 * report must all see the same tree, so the honest contract is "cd in, then
 * run". The engine itself is NOT self-updated here: `npm update -g cladding` is
 * the user's step.
 */
export async function runUpdateCommand(): Promise<void> {
  pulse('note', 'update', 'reconciling the current project after the engine upgrade');
  const r = await performUpdate('.', {
    wireHosts: async () => (await runHostSetup({quiet: true})).errors.length,
  });
  pulse(r.wiringErrors > 0 ? 'fail' : 'pass', 'hosts', r.wiringErrors > 0 ? `${r.wiringErrors} wiring error(s)` : 're-wired');
  if (!r.isProject) {
    pulse('skip', 'spec', 'no spec.yaml here — run `clad init` to put this project under cladding');
    process.exit(r.code);
    return;
  }
  pulse('pass', 'spec', `inventory synced · ${r.features} features`);
  pulse(r.claudeMd === 'refreshed-stale' ? 'note' : 'pass', 'CLAUDE.md', r.claudeMd);
  pulse(r.agentsMd === 'refreshed-stale' ? 'note' : 'pass', 'AGENTS.md', r.agentsMd);
  // Surface what the now-stricter detectors flag — REPORT only, never blocks.
  process.stdout.write('\n→ drift check (report-only · does not block, does not edit your spec):\n');
  const drift = runCheckStages({tier: 'pre-commit', strict: true});
  if (drift.anyFailed) {
    process.stdout.write(
      '\nℹ The findings above are the bar this upgrade raised — not a failed update.' +
      ' Reconcile them in YOUR spec when ready (`clad check --strict` for the full gate).\n',
    );
  } else {
    pulse('pass', 'drift', 'clean against the stricter detectors');
  }
  process.exit(r.code);
}

/**
 * Stages run by each `clad check --tier` (Phase 2 ambient hooks). Each trigger
 * runs the subset that is fast + meaningful in its context:
 *   pre-commit — drift/arch/secret: cheap, spec-native, deterministic, no
 *                whole-toolchain spawn → instant per-commit feedback.
 *   pre-push   — + type/lint/unit/cov: deterministic but heavier; run before
 *                push, not on every commit (avoids `--no-verify` fatigue).
 *   all        — every stage (default; backward-compatible; CI uses this).
 * Excluded from local hooks: commit(1.4) needs a clean tree (would always fail
 * pre-commit); smoke/perf/visual(3.x) are probabilistic; audit/uat(4.x) need
 * human evidence — these run in CI (`clad check`, i.e. tier=all).
 * Exported for testing.
 */
export const TIER_STAGES: Record<string, readonly string[]> = {
  'pre-commit': ['stage_1.3', 'stage_1.5', 'stage_1.6'],
  'pre-push': ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3'],
  all: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_3.1', 'stage_3.2', 'stage_3.3', 'stage_4.1', 'stage_4.2'],
};

/** Outcome of running a tier's stages — exported so `clad done` can gate on
 *  the identical code path `clad check` uses (not a weaker re-implementation). */
export interface CheckOutcome {
  /** Worst exit code across the run stages (0 = all green/skip). */
  readonly worst: number;
  /** True when at least one stage RAN and failed (exitCode 1). */
  readonly anyFailed: boolean;
}

/**
 * Runs a tier's Iron Law stages in-process and reports the worst exit code.
 * Shared by `clad check` (which wraps it with `process.exit`) and `clad done`
 * (which gates the status flip on it), so the two verify against the SAME stage
 * pipeline.
 */
export function runCheckStages(opts: {internal?: boolean; strict?: boolean; tier?: string; json?: boolean}): CheckOutcome {
  const tier = opts.tier ?? 'all';
  const allowed = TIER_STAGES[tier];
  if (!allowed) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({tier, error: `unknown tier '${tier}'`, worst: 2, anyFailed: true, stages: []}, null, 2)}\n`);
    } else {
      pulse('fail', 'check', `unknown --tier '${tier}' (expected: pre-commit | pre-push | all)`);
    }
    return {worst: 2, anyFailed: true};
  }
  const allStages = [
    ['stage_1.1', runType],
    ['stage_1.2', runLint],
    ['stage_1.3', () => runDrift({strict: opts.strict})],
    ['stage_1.4', runCommit],
    ['stage_1.5', runArch],
    ['stage_1.6', runSecret],
    ['stage_2.1', runUnit],
    ['stage_2.2', runCov],
    ['stage_2.3', runSpecConformance],
    ['stage_3.1', runSmoke],
    ['stage_3.2', runPerf],
    ['stage_3.3', runVisual],
    ['stage_4.1', runAudit],
    ['stage_4.2', runUat],
  ] as const;
  const stages = allStages.filter(([name]) => allowed.includes(name));
  let worst = 0;
  let anyFailed = false;
  const collected: {stage: string; label: string; status: 'pass' | 'skip' | 'fail'; exitCode: number; stderr?: string; findings?: readonly DriftFinding[]}[] = [];
  for (const [name, run] of stages) {
    const r = run({}) as {
      pass: boolean;
      exitCode: number;
      stderr?: string;
      findings?: readonly DriftFinding[];
    };
    const label = opts.internal ? name : gateLabel(name);
    // INVARIANT: exitCode 2 means "skipped" (cladding chose not to run — tool
    // missing / unknown language). It is NON-blocking. A stage that RAN and
    // found a real problem MUST return exitCode 1, never 2 — see
    // stages/util.ts::ranToolResult. (tsc exits 2 on type errors; relaying that
    // raw 2 here is what let a real type failure pass as a skip.)
    const status: 'pass' | 'skip' | 'fail' = r.pass ? 'pass' : r.exitCode === 2 ? 'skip' : 'fail';
    if (status === 'fail') {
      anyFailed = true;
      if (r.exitCode > worst) worst = r.exitCode;
    }
    collected.push({stage: name, label, status, exitCode: r.exitCode, stderr: r.stderr, findings: r.findings});
    if (!opts.json) {
      if (status === 'fail') {
        pulse('fail', label);
        printStageDetails(r);
      } else {
        pulse(status, label);
      }
    }
  }
  if (opts.json) {
    // Machine-readable, UNTRUNCATED — findings carry file/line/suggestion so an
    // agent fixes in one pass instead of re-running to discover where + what.
    process.stdout.write(`${JSON.stringify({tier, worst, anyFailed, stages: collected}, null, 2)}\n`);
  } else if (anyFailed) {
    process.stdout.write('\nℹ Run `clad doctor` for the event log, or `clad sync` to validate spec shards. Drift findings above name the offending detector.\n');
  }
  return {worst, anyFailed};
}

/** Handler for `clad check`. Runs the tier's Iron Law stages; exits with worst code. */
export function runCheckCommand(opts: {internal?: boolean; strict?: boolean; tier?: string; json?: boolean}): void {
  process.exit(runCheckStages(opts).worst);
}

/**
 * Handler for `clad done <featureId>`. Gates the `status: done` transition on a
 * GREEN `clad check --tier=pre-push --strict` (flip → gate → keep-or-revert),
 * so `done` cannot claim more than the gate verifies. @see cli/done.ts
 */
export function runDoneCommand(featureId: string): void {
  const r = performDone('.', featureId, {checkStages: runCheckStages});
  pulse(r.ok ? 'pass' : 'fail', `done · ${featureId}`, r.reason);
  process.exit(r.code);
}

function printStageDetails(r: {
  stderr?: string;
  findings?: readonly {detector: string; severity: string; message: string; path?: string}[];
}): void {
  if (r.findings && r.findings.length > 0) {
    const errors = r.findings.filter((f) => f.severity === 'error');
    const warns = r.findings.filter((f) => f.severity === 'warn');
    const surface = errors.length > 0 ? errors : warns;
    for (const f of surface.slice(0, 3)) {
      const where = f.path ? ` ${f.path}` : '';
      process.stdout.write(`    [${f.detector}]${where} — ${truncate(f.message, 140)}\n`);
    }
    if (surface.length > 3) {
      process.stdout.write(`    … and ${surface.length - 3} more finding(s)\n`);
    }
    return;
  }
  if (r.stderr && r.stderr.trim().length > 0) {
    const first = r.stderr.split('\n').find((l) => l.trim().length > 0);
    if (first) {
      process.stdout.write(`    ${truncate(first.trim(), 160)}\n`);
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Handler for `clad panel`. Renders the Integrity Panel. */
export function runPanelCommand(opts: {internal?: boolean}): void {
  const spec = loadSpec();
  process.stdout.write(`${renderPanel(spec, '.', {internal: opts.internal})}\n`);
  process.exit(0);
}

/** Handler for `clad route <prompt>`. Classifies natural language → verb. */
export function runRouteCommand(prompt: string): void {
  const intent = classifyIntent(prompt);
  pulse('note', `route → ${intent}`, prompt);
  process.exit(intent === 'unknown' ? 1 : 0);
}

/**
 * Builds the commander Program with every verb wired up. Exported so
 * unit tests can invoke specific subcommands via
 * `createProgram().parse([verb, ...args], {from: 'user'})` without
 * touching `process.argv`.
 */
export function createProgram(): Command {
  const program = new Command();
  program.name('clad').description('Reference Ironclad CLI').version('0.5.0');

  program
    .command('init [intent...]')
    .description(
      'Scaffold a cladding workspace. Pass a free-text project description as positional argument ' +
        '(e.g. `clad init 결제 SaaS for B2B`) to drive intent-aware onboarding — the LLM dispatcher then ' +
        'produces domain-aware capabilities/architecture/project-context plus product-level follow-up questions. ' +
        'Bare `clad init` keeps the v0.3.42 behaviour (greenfield seeds, or observed scan when ≥3 source files exist).',
    )
    .option('-n, --name <name>', 'Project name (default: cwd basename)')
    .option('-f, --force', 'Overwrite existing spec.yaml')
    .option('--scan', 'Force-walk the existing codebase. Default auto-detects (≥3 source files trigger scan). Use --no-scan to skip even when source is present.')
    .option('--no-llm', 'Force the deterministic interpreter (skip the LLM dispatcher chain). Intent text falls back to a deterministic quote in project-context.md.')
    .option('--roots <list>', 'Override scanner source roots, comma-separated (e.g. packages/a/src,packages/b/src). Otherwise inferred from manifests + directory heuristics.')
    .option('--with-hook', 'Install a git pre-commit hook running `clad check --tier=pre-commit` (drift/arch/secret). Opt-in; cladding never touches .git without it.')
    .action(runInitCommand);

  program
    .command('work [verb]')
    .description('Run a stage or a free-form intent')
    .action(runWorkCommand);

  program
    .command('drive [goal]')
    .description('Autonomous loop — iterate ready features, dispatch specialist + reviewer personas, run L1 gates, enforce anti-self-cert, record evidence')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .option('--max-iterations <n>', 'cap iterations (default 50)', '50')
    .option('--max-wall-clock-ms <ms>', 'cap wall clock (default 600000)', '600000')
    .option('--max-retries <n>', 'cap retries per feature (default 3)', '3')
    .option('--json', 'emit the raw internal result (Iron Core view); default is a plain Soft Shell summary')
    .action(runDriveCommand);

  program
    .command('sync')
    .description('Validate spec.yaml against schema and report')
    .option(
      '--propose-archive',
      'list STALE_SPECIFICATION findings whose suggestion.action is propose-archive (Phased Decommissioning Tier 2)',
    )
    .action(runSyncCommand);

  program
    .command('setup')
    .description('Wire cladding into installed AI tool host channels (Claude Code / Codex / Gemini)')
    .option('--force', 'overwrite directory-copy wires (Windows fallback) even when changes detected')
    .option('--quiet', 'suppress stdout output')
    .action(runSetupCommand);

  program
    .command('update')
    .description('Run from a project dir AFTER `npm update -g cladding`: re-wire hosts + sync inventory + refresh the managed CLAUDE.md/AGENTS.md section, then report (without blocking) what the now-stricter detectors flag')
    .action(runUpdateCommand);

  program
    .command('check')
    .description('Run every Iron Law stage and the drift detector suite')
    .option('--internal', 'show stage codes (`stage_1.1`) instead of names (`Type`)')
    .option('--strict', 'promote warn-severity drift findings to errors (CI / pre-publish gate)')
    .option(
      '--tier <tier>',
      'run only the stages for a trigger: pre-commit (drift/arch/secret) | pre-push (+ type/lint/unit/cov/spec-conformance) | all (default; full 14-stage gate, used by CI)',
    )
    .option('--json', 'emit structured per-stage results (machine-readable: findings with file/line/suggestion, untruncated) — for agents/CI; cuts RED→fix round-trips')
    .action(runCheckCommand);

  program
    .command('checkpoint <featureId>')
    .description('Record a checkpoint event pinning git HEAD + spec digest for the feature (iron-law §2.5)')
    .action(runCheckpointCommand);

  program
    .command('done <featureId>')
    .description('Mark a feature done ONLY if `clad check --tier=pre-push --strict` is GREEN (flip → gate → revert-on-red). Keeps `done` honest.')
    .action(runDoneCommand);

  program
    .command('rollback <featureId>')
    .description('Record a rollback event and print the maintainer-runnable git command for the latest checkpoint')
    .option('-r, --reason <reason>', 'optional free-text reason recorded on the event payload')
    .action(runRollbackCommand);

  program
    .command('panel')
    .description('Render the feature × stage Integrity Panel (business titles; use --internal for raw F-NNN ids)')
    .option('--internal', 'show internal F-NNN ids and stage codes')
    .action(runPanelCommand);

  program
    .command('route <prompt>')
    .description('Classify a natural-language prompt to a verb')
    .action(runRouteCommand);

  program
    .command('serve')
    .description('Run cladding as an MCP server over stdio — tools/resources/prompts for any MCP client')
    .option('--cwd <path>', 'project directory exposed to the client (default cwd)')
    .action(runServeCommand);

  program
    .command('doctor')
    .description('Summarise .cladding/events.log.jsonl — sentinel-miss frequency by phase/cause/fallback plus the top missed sentinels (LLM dispatcher health check)')
    .option('--cwd <path>', 'project directory to read events from (default cwd)')
    .option('--json', 'emit the raw DoctorReport for tooling; default is the human-readable surface')
    .action(runDoctorCommand);

  program
    .command('refine [answer...]')
    .description(
      'Advance the onboarding Q&A loop. Pass the user\'s answer to the next pending question as a positional ' +
        '(no quotes needed, e.g. `clad refine 법인 사업자만`); the LLM refines spec/docs based on the full Q-A ' +
        'history and may emit new follow-up questions. Reads/writes `.cladding/onboarding/state.yaml`. Requires ' +
        '`clad init <intent>` to have started a session first.',
    )
    .option('--cwd <path>', 'project directory containing .cladding/onboarding/state.yaml (default cwd)')
    .option('--no-llm', 'force the deterministic interpreter (preserves current artifacts, logs the answer)')
    .option('--json', 'emit the raw RefineReport for tooling; default is the human-readable surface')
    .action(runRefineCommand);

  return program;
}

// CLI entry — `tsx cli/clad.ts ...` or `node bin/clad ...`.
//
// Unlike helper modules, this file IS the CLI entry, so the bundled
// build (esbuild → dist/clad.js) must always trigger parsing. The
// guard exists only so unit tests can `import` the module to get the
// handler exports without commander touching `process.argv`.
const isBundled = Boolean((globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED);
const isCliEntry = isBundled || import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) createProgram().parse();
