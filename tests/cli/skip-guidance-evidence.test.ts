// Cladding · impl-blind oracle for F-c17e1edc — authored from the spec contract only.
//
// AC under test: runner-less skips name their exit.
//   1. No registered runner for the project language  -> the four command stages
//      ('Type', 'Lint', 'Unit tests', 'Coverage') end status 'skip' AND carry
//      skipReason: 'no-runner'.
//   2. By-design skips ('Spec conformance', 'Deliverable smoke') stay skip/na and
//      carry NO skipReason.
//   3. With gate.commands declared in .cladding/config.yaml those four stages no
//      longer skip and carry no skipReason.
//   4. skipReason is only ever 'no-runner' | 'tool-missing' | absent — on any stage.
//   5. The runner-less stderr message is unchanged: /no .* registered for language/.
//
// Written without reading src/cli/clad.ts — behaviour is asserted against the
// declared public surface `runCheckStages({tier, silent}) -> {stages: [...]}` only.

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {runCheckStages} from '../../src/cli/clad.js';

type StageRow = {
  stage?: unknown;
  label?: string;
  status?: string;
  exitCode?: number;
  stderr?: string;
  skipReason?: string;
};
type CheckResult = {stages: StageRow[]};

const COMMAND_LABELS = ['Type', 'Lint', 'Unit tests', 'Coverage'] as const;
const BY_DESIGN_SKIP_LABELS = ['Spec conformance', 'Deliverable smoke'] as const;
const ALLOWED_SKIP_REASONS = ['no-runner', 'tool-missing'];
const RUNNERLESS_STDERR = /no .* registered for language/;

const GATE_COMMANDS_YAML = [
  'gate:',
  '  commands:',
  '    type: ["node", "--version"]',
  '    lint: ["node", "--version"]',
  '    test: ["node", "--version"]',
  '    coverage: ["node", "--version"]',
  '',
].join('\n');

/** A project in a language with no registered runner: a tree of .zig files. */
function makeFixture(withGateCommands: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'clad-oracle-c17e1edc-'));
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject: {name: x, language: zig}\nfeatures: []\n',
    'utf8',
  );
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  mkdirSync(join(dir, 'src', 'core'), {recursive: true});
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(dir, 'src', 'core', `f${i}.zig`), '// x\n', 'utf8');
  }
  if (withGateCommands) {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), GATE_COMMANDS_YAML, 'utf8');
  }
  return dir;
}

/** runCheckStages has no cwd parameter — stages run in '.', so chdir around it. */
function runInDir(dir: string): CheckResult {
  if (typeof process.chdir !== 'function') {
    throw new Error(
      'process.chdir is unavailable in this vitest pool; this oracle needs a pool where cwd can be changed (forks)',
    );
  }
  const origin = process.cwd();
  process.chdir(dir);
  try {
    return runCheckStages({tier: 'pre-push', silent: true} as never) as unknown as CheckResult;
  } finally {
    process.chdir(origin);
  }
}

function stageByLabel(result: CheckResult, label: string): StageRow {
  const row = result.stages.find(s => s.label === label);
  expect(row, `expected a stage labelled '${label}' in: ${labelsOf(result).join(', ')}`).toBeDefined();
  return row as StageRow;
}

function labelsOf(result: CheckResult): string[] {
  return result.stages.map(s => String(s.label));
}

let dirNoRunner = '';
let dirConfigured = '';
let noRunner: CheckResult;
let configured: CheckResult;

beforeAll(() => {
  dirNoRunner = makeFixture(false);
  dirConfigured = makeFixture(true);
  // One real gate run per fixture; every assertion below reuses these two results.
  noRunner = runInDir(dirNoRunner);
  configured = runInDir(dirConfigured);
}, 300_000);

afterAll(() => {
  for (const dir of [dirNoRunner, dirConfigured]) {
    if (dir) rmSync(dir, {recursive: true, force: true});
  }
});

describe('F-c17e1edc — runner-less skips name their exit', () => {
  it('produces a stage list for both fixtures', () => {
    expect(Array.isArray(noRunner?.stages)).toBe(true);
    expect(noRunner.stages.length).toBeGreaterThan(0);
    expect(Array.isArray(configured?.stages)).toBe(true);
    expect(configured.stages.length).toBeGreaterThan(0);
  });

  it.each(COMMAND_LABELS)(
    "with no registered runner, the '%s' stage skips with skipReason 'no-runner'",
    label => {
      const row = stageByLabel(noRunner, label);
      expect(row.status, `status of '${label}'`).toBe('skip');
      expect(row.skipReason, `skipReason of '${label}'`).toBe('no-runner');
    },
  );

  it.each(BY_DESIGN_SKIP_LABELS)(
    "the by-design skip '%s' carries no skipReason",
    label => {
      const row = stageByLabel(noRunner, label);
      expect(['skip', 'na'], `status of '${label}'`).toContain(String(row.status));
      expect(row.skipReason, `skipReason of '${label}'`).toBeUndefined();
    },
  );

  it.each(COMMAND_LABELS)(
    "with gate.commands declared, the '%s' stage no longer skips and names no exit",
    label => {
      const row = stageByLabel(configured, label);
      expect(row.status, `status of '${label}' with gate.commands`).not.toBe('skip');
      expect(row.skipReason, `skipReason of '${label}' with gate.commands`).toBeUndefined();
    },
  );

  it('never emits a skipReason outside the declared vocabulary, in either fixture', () => {
    const offenders: string[] = [];
    for (const [fixture, result] of [
      ['no-runner fixture', noRunner],
      ['gate.commands fixture', configured],
    ] as const) {
      for (const row of result.stages) {
        if (row.skipReason === undefined) continue;
        if (!ALLOWED_SKIP_REASONS.includes(row.skipReason)) {
          offenders.push(`${fixture}: '${row.label}' -> ${JSON.stringify(row.skipReason)}`);
        }
      }
    }
    expect(offenders, `skipReason must be one of ${ALLOWED_SKIP_REASONS.join(' | ')} or absent`).toEqual([]);
  });

  it.each(COMMAND_LABELS)(
    "the '%s' runner-less skip still explains itself in stderr",
    label => {
      const row = stageByLabel(noRunner, label);
      expect(row.status).toBe('skip');
      expect(String(row.stderr ?? ''), `stderr of '${label}'`).toMatch(RUNNERLESS_STDERR);
    },
  );
});
