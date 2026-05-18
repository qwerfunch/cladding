// Cladding · `clad` CLI entry — composes the 5 Iron Core verbs.
//
// Uses `commander` for parsing. Each verb maps to a thin wrapper
// over existing functions: stage runners, spec loader, drift
// aggregator, panel renderer.

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

const program = new Command();
program.name('clad').description('Reference Ironclad CLI').version('0.1.0-dev');

program
  .command('init')
  .description('Scaffold a cladding workspace in the current directory')
  .option('-n, --name <name>', 'Project name (default: cwd basename)')
  .option('-f, --force', 'Overwrite existing spec.yaml')
  .action((opts: {name?: string; force?: boolean}) => {
    const result = runInit({projectName: opts.name, force: opts.force});
    for (const c of result.created) pulse('pass', `created ${c}`);
    for (const s of result.skipped) pulse('skip', s);
    pulse('note', 'init done', `language: ${result.language}`);
    process.exit(0);
  });

program
  .command('work [verb]')
  .description('Run a stage or a free-form intent')
  .action((verb?: string) => {
    if (!verb) {
      pulse('note', 'work', 'specify a stage or natural-language intent');
      process.exit(2);
      return;
    }
    pulse('start', `work ${verb}`);
    process.exit(0);
  });

program
  .command('drive [goal]')
  .description('Autonomous loop — iterate ready features, create stubs, run L1 gates, record evidence')
  .option('--cwd <path>', 'target project directory (default cwd)')
  .option('--max-iterations <n>', 'cap iterations (default 50)', '50')
  .option('--max-wall-clock-ms <ms>', 'cap wall clock (default 600000)', '600000')
  .option('--max-retries <n>', 'cap retries per feature (default 3)', '3')
  .action(async (goal: string | undefined, opts: {cwd?: string; maxIterations: string; maxWallClockMs: string; maxRetries: string}) => {
    const {runDriveLoop} = await import('../drive/loop.js');
    const result = runDriveLoop({
      cwd: opts.cwd,
      goal,
      budget: {
        maxIterations: Number(opts.maxIterations),
        maxWallClockMs: Number(opts.maxWallClockMs),
        maxRetriesPerFeature: Number(opts.maxRetries),
      },
    });
    const tag = result.halt.class === 'ALL_FEATURES_DONE' ? 'pass' : 'note';
    pulse(
      tag,
      'drive',
      `halt=${result.halt.class} iter=${result.iterations} features=${result.featuresTouched.length} stubs=${result.stubsCreated.length} gates=${result.gateRuns}`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.halt.class === 'UNCAUGHT_ERROR' ? 1 : 0);
  });

program
  .command('sync')
  .description('Validate spec.yaml against schema and report')
  .action(() => {
    try {
      const spec = loadSpec();
      pulse('pass', 'sync', `${spec.features.length} features valid`);
      process.exit(0);
    } catch (err) {
      pulse('fail', 'sync', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Run every Iron Law stage and the drift detector suite')
  .action(() => {
    const stages = [
      ['stage_1.1', runType],
      ['stage_1.2', runLint],
      ['stage_1.3', () => runDrift()],
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
      if (r.pass) {
        pulse('pass', name);
      } else if (r.exitCode === 2) {
        pulse('skip', name);
      } else {
        pulse('fail', name);
        if (r.exitCode > worst) worst = r.exitCode;
      }
    }
    process.exit(worst);
  });

program
  .command('panel')
  .description('Render the feature × stage Integrity Panel')
  .action(() => {
    const spec = loadSpec();
    process.stdout.write(`${renderPanel(spec)}\n`);
    process.exit(0);
  });

program
  .command('route <prompt>')
  .description('Classify a natural-language prompt to a verb')
  .action((prompt: string) => {
    const intent = classifyIntent(prompt);
    pulse('note', `route → ${intent}`, prompt);
    process.exit(intent === 'unknown' ? 1 : 0);
  });

program.parse();
