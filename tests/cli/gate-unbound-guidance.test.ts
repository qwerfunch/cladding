// Cladding · F-6349870d — the gate names the token that binds a test when it
// reports a criterion as unobserved for want of one.
//
// On schema 0.2 the FIRST red an adopting host meets is not `clad done`: it is
// the pre-push run reporting a kernel obligation as unobserved because no test
// claims the criterion. The run used to say only that something failed. It now
// prints, and publishes to its machine document, the single cure — the covers
// token that opens a test title, with the criterion's own address inside it.
//
// The fixture records a real run proof that names ONE of two criteria, which is
// what makes the other criterion genuinely `unbound` rather than merely stale:
// the gate observed a runner, so the absent binding is the whole reason.
//
// Covers:
//   AC-336d461f — the gate output names the title token for an unbound
//                 criterion, in the human run and in the machine document, and
//                 says nothing once a test claims it.
//   AC-d8343efa — schema 0.1 machine output is unchanged (no new key), and the
//                 verdict itself moves only with the binding.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/stages/type.js', () => ({runType: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/lint.js', () => ({runLint: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));
// The Unit stage is the only place a real run proof can enter a gate: the gate
// opens its own shared-run session, so a proof primed from outside is wiped.
// This stand-in does exactly what the real stage does with a vitest JSON
// reporter — records the titles that ran and passed — for the criteria the test
// under way declares.
const claimed = vi.hoisted(() => ({criteria: [] as string[]}));
vi.mock('../../src/stages/unit.js', async () => {
  const {mkdtempSync: mkdtemp, writeFileSync: write} = await import('node:fs');
  const {tmpdir: tmp} = await import('node:os');
  const {join: joinPath} = await import('node:path');
  const {captureCurrentVitestProof: capture} = await import('../../src/stages/test-run-cache.js');
  return {
    runUnit: () => {
      const reporter = joinPath(mkdtemp(joinPath(tmp(), 'clad-unbound-report-')), 'vitest.json');
      write(reporter, JSON.stringify({
        testResults: [{
          name: joinPath(process.cwd(), 'tests', 'bound.test.ts'),
          assertionResults: claimed.criteria.map((criterion) => ({status: 'passed', fullName: `[covers:${criterion}] claims it`})),
        }],
      }));
      capture('.', reporter, ['vitest', 'run']);
      return {pass: true, exitCode: 0};
    },
  };
});
vi.mock('../../src/stages/cov.js', () => ({runCov: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: () => ({pass: true, exitCode: 0})}));

import {runCheckStages} from '../../src/cli/clad.js';

const FEATURE = 'F-6349870d';
const BOUND_AC = 'AC-11111111';
const UNBOUND_AC = 'AC-22222222';
const roots: string[] = [];

interface GateJson {
  readonly unbound_criteria?: readonly string[];
  readonly obligations?: readonly {readonly obligation: string; readonly subject: string; readonly reason?: string}[];
  readonly input_sha256?: string;
}

function workspace(schema: '0.1' | '0.2'): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-unbound-guidance-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  mkdirSync(join(cwd, 'src'), {recursive: true});
  mkdirSync(join(cwd, 'tests'), {recursive: true});
  writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1;\n');
  if (schema === '0.1') {
    writeFileSync(join(cwd, 'spec.yaml'), [
      'schema: "0.1"', 'project: {name: unbound-fixture, language: typescript}', 'features: []', '',
    ].join('\n'));
    writeFileSync(join(cwd, 'spec', 'features', 'legacy-6349870d.yaml'), [
      `id: ${FEATURE}`, 'title: Legacy', 'status: in_progress', 'modules: [src/a.ts]',
      'acceptance_criteria:', `  - id: ${BOUND_AC}`,
      '    text: The system shall keep the legacy machine document unchanged.', '',
    ].join('\n'));
    return cwd;
  }
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: unbound-fixture', '  language: typescript',
    '  purpose: Report an unclaimed criterion with its cure.', '  assurance_level: L2',
    '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'features', 'binding-6349870d.yaml'), [
    `id: ${FEATURE}`, 'title: Binding', 'status: done',
    'purpose: Carry one claimed criterion and one that no test claims.',
    'modules: [src/a.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    `  - id: ${BOUND_AC}`, '    kind: behavior',
    '    statement: The system shall carry one criterion a test claims.',
    `  - id: ${UNBOUND_AC}`, '    kind: behavior',
    '    statement: The system shall carry one criterion no test claims.', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  return cwd;
}

/** Runs the push gate inside `cwd`, returning both faces of its output. */
function gate(cwd: string, opts: {readonly json: boolean}): {readonly stdout: string; readonly doc: GateJson} {
  let stdout = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as never);
  const origin = process.cwd();
  process.chdir(cwd);
  try {
    runCheckStages({profile: 'push', json: opts.json});
  } finally {
    process.chdir(origin);
    write.mockRestore();
  }
  return {stdout, doc: opts.json ? (JSON.parse(stdout) as GateJson) : {}};
}

/**
 * Declares which criteria a passing test claims in this run: the test file the
 * workspace carries, and the titles the stand-in Unit stage reports as passed.
 */
function claimCriteria(cwd: string, criteria: readonly string[]): void {
  writeFileSync(
    join(cwd, 'tests', 'bound.test.ts'),
    criteria.map((criterion) => `it('[covers:${criterion}] claims it', () => {});\n`).join(''),
  );
  claimed.criteria = [...criteria];
}

afterEach(() => {
  claimed.criteria = [];
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('AC-336d461f · the gate names the covers token for a criterion no test claims', () => {
  test('[covers:F-6349870d/AC-336d461f] the machine document names the token, with the unclaimed criterion inside it', () => {
    const cwd = workspace('0.2');
    claimCriteria(cwd, [`${FEATURE}/${BOUND_AC}`]);
    const doc = gate(cwd, {json: true}).doc;

    const unbound = doc.obligations?.filter((row) => row.reason === 'unbound') ?? [];
    expect(unbound.map((row) => row.subject)).toContain(`criterion:${FEATURE}/${UNBOUND_AC}`);
    expect(doc.unbound_criteria).toContain(
      `no test claims this criterion — start a test title with \`[covers:${FEATURE}/${UNBOUND_AC}]\``,
    );
    // The criterion a test DOES claim is never prescribed a cure it has.
    expect((doc.unbound_criteria ?? []).join('\n')).not.toContain(BOUND_AC);
  });

  test('[covers:F-6349870d/AC-336d461f] the human run prints the same cure', () => {
    const cwd = workspace('0.2');
    claimCriteria(cwd, [`${FEATURE}/${BOUND_AC}`]);
    expect(gate(cwd, {json: false}).stdout).toContain(`[covers:${FEATURE}/${UNBOUND_AC}]`);
  });

  test('[covers:F-6349870d/AC-336d461f] once every criterion is claimed the gate prescribes nothing', () => {
    const cwd = workspace('0.2');
    claimCriteria(cwd, [`${FEATURE}/${BOUND_AC}`, `${FEATURE}/${UNBOUND_AC}`]);
    const run = gate(cwd, {json: true});
    expect(run.doc.unbound_criteria).toEqual([]);
    expect(run.doc.obligations?.some((row) => row.reason === 'unbound')).toBe(false);
  });
});

describe('AC-d8343efa · the schema 0.1 machine document is unchanged', () => {
  test('[covers:F-6349870d/AC-d8343efa] a schema 0.1 gate publishes no binding-guidance key', () => {
    const doc = gate(workspace('0.1'), {json: true}).doc;
    expect(Object.prototype.hasOwnProperty.call(doc, 'unbound_criteria')).toBe(false);
  });
});
