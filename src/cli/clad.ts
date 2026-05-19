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
import {runInit} from './init.js';
import {runArch} from '../stages/arch.js';
import {runAudit} from '../stages/audit.js';
import {runCommit} from '../stages/commit.js';
import {runCov} from '../stages/cov.js';
import {runDrift} from '../stages/drift.js';
import {runLint} from '../stages/lint.js';
import {runPerf} from '../stages/perf.js';
import {runSecret} from '../stages/secret.js';
import {runSmoke} from '../stages/smoke.js';
import {runType} from '../stages/type.js';
import {runUat} from '../stages/uat.js';
import {runUnit} from '../stages/unit.js';
import {runVisual} from '../stages/visual.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';
import {renderPanel} from '../ui/panel.js';
import {featureLabel, gateLabel, haltMessage} from '../ui/softShell.js';

/** Handler for `clad serve`. Boots the MCP server over stdio (v0.2.24). */
export async function runServeCommand(opts: {cwd?: string}): Promise<void> {
  // Dynamic import: the MCP SDK is sizeable and most `clad` invocations
  // never reach `serve`. Loading it on-demand keeps cold-start fast.
  const [{buildServer}, {StdioServerTransport}] = await Promise.all([
    import('../serve/server.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
  ]);
  const server = buildServer({cwd: opts.cwd});
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

/** Handler for `clad init`. Scaffolds a workspace at cwd, then exits 0. */
export function runInitCommand(opts: {name?: string; force?: boolean}): void {
  const result = runInit({projectName: opts.name, force: opts.force});
  for (const c of result.created) pulse('pass', `created ${c}`);
  for (const s of result.skipped) pulse('skip', s);
  pulse('note', 'init done', `language: ${result.language}`);
  process.exit(0);
}

/** Handler for `clad work [verb]`. Stub — full intent handling lands later. */
export function runWorkCommand(verb?: string): void {
  if (!verb) {
    pulse('note', 'work', 'specify a stage or natural-language intent');
    process.exit(2);
    return;
  }
  pulse('start', `work ${verb}`);
  process.exit(0);
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

/** Handler for `clad sync`. Validates the spec and reports feature count. */
export function runSyncCommand(): void {
  try {
    const spec = loadSpec();
    pulse('pass', 'sync', `${spec.features.length} features valid`);
    process.exit(0);
  } catch (err) {
    pulse('fail', 'sync', (err as Error).message);
    process.exit(1);
  }
}

/** Handler for `clad check`. Runs every Iron Law stage; exits with worst code. */
export function runCheckCommand(opts: {internal?: boolean; strict?: boolean}): void {
  const stages = [
    ['stage_1.1', runType],
    ['stage_1.2', runLint],
    ['stage_1.3', () => runDrift({strict: opts.strict})],
    ['stage_1.4', runCommit],
    ['stage_1.5', runArch],
    ['stage_1.6', runSecret],
    ['stage_2.1', runUnit],
    ['stage_2.2', runCov],
    ['stage_3.1', runSmoke],
    ['stage_3.2', runPerf],
    ['stage_3.3', runVisual],
    ['stage_4.1', runAudit],
    ['stage_4.2', runUat],
  ] as const;
  let worst = 0;
  for (const [name, run] of stages) {
    const r = run({}) as {pass: boolean; exitCode: number};
    const label = opts.internal ? name : gateLabel(name);
    if (r.pass) {
      pulse('pass', label);
    } else if (r.exitCode === 2) {
      pulse('skip', label);
    } else {
      pulse('fail', label);
      if (r.exitCode > worst) worst = r.exitCode;
    }
  }
  process.exit(worst);
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
  program.name('clad').description('Reference Ironclad CLI').version('0.2.25');

  program
    .command('init')
    .description('Scaffold a cladding workspace in the current directory')
    .option('-n, --name <name>', 'Project name (default: cwd basename)')
    .option('-f, --force', 'Overwrite existing spec.yaml')
    .action(runInitCommand);

  program
    .command('work [verb]')
    .description('Run a stage or a free-form intent')
    .action(runWorkCommand);

  program
    .command('drive [goal]')
    .description('Autonomous loop (deterministic floor; LLM dispatch arrives with F-049 in v0.2) — iterate ready features, create stubs, run L1 gates, record evidence')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .option('--max-iterations <n>', 'cap iterations (default 50)', '50')
    .option('--max-wall-clock-ms <ms>', 'cap wall clock (default 600000)', '600000')
    .option('--max-retries <n>', 'cap retries per feature (default 3)', '3')
    .option('--json', 'emit the raw internal result (Iron Core view); default is a plain Soft Shell summary')
    .action(runDriveCommand);

  program
    .command('sync')
    .description('Validate spec.yaml against schema and report')
    .action(runSyncCommand);

  program
    .command('check')
    .description('Run every Iron Law stage and the drift detector suite')
    .option('--internal', 'show stage codes (`stage_1.1`) instead of names (`Type`)')
    .option('--strict', 'promote warn-severity drift findings to errors (CI / pre-publish gate)')
    .action(runCheckCommand);

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
    .description('Run cladding as an MCP server over stdio (v0.2.24) — tools/resources/prompts for any MCP client')
    .option('--cwd <path>', 'project directory exposed to the client (default cwd)')
    .action(runServeCommand);

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
