// Cladding · `clad` CLI entry — composes the 5 Iron Core verbs.
//
// Uses `commander` for parsing. Each verb maps to a thin wrapper
// over existing functions: stage runners, spec loader, drift
// aggregator, minimap renderer.

import process from 'node:process';

import {Command} from 'commander';

import {classifyIntent} from '../router/intent.js';
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
import {renderMinimap} from '../ui/minimap.js';

const program = new Command();
program.name('clad').description('Reference Ironclad CLI').version('0.1.0-dev');

program
  .command('init')
  .description('Scaffold a cladding workspace in the current directory')
  .action(() => {
    pulse('note', 'init', 'placeholder — v0.1 scaffolds nothing; will mature in v0.2');
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
  .description('Autonomous loop (placeholder — full impl in v0.2)')
  .action((goal?: string) => {
    pulse('note', 'drive', goal ?? 'no goal supplied');
    process.exit(0);
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
  .command('minimap')
  .description('Render the feature × stage Territory Minimap')
  .action(() => {
    const spec = loadSpec();
    process.stdout.write(`${renderMinimap(spec)}\n`);
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
