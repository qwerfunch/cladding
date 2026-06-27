// Cladding · F-acedface — SARIF 2.1.0 output mode for `clad check`.
//
// Unit-tests the pure serializer (toSarif) for the structural / mapping /
// fingerprint / no-false-clean ACs, then spawns the built bin for the two
// CLI-flag ACs (unknown --format errors; default output stays unchanged).

import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

import {toSarif, type SarifReportInput} from '../../src/stages/sarif.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const report = (stages: SarifReportInput['stages'], over: Partial<SarifReportInput> = {}): SarifReportInput => ({
  tier: 'all',
  worst: 0,
  anyFailed: false,
  stages,
  ...over,
});

// Narrowing helpers for the `unknown` return without `any`.
const run0 = (log: unknown): {tool: {driver: {version?: string; rules: Array<{id: string; defaultConfiguration: {level: string}}>}}; results: Array<{ruleId: string; level: string; message: {text: string}; locations?: Array<{physicalLocation: {artifactLocation: {uri: string}; region?: {startLine: number}}}>; partialFingerprints: Record<string, string>}>} =>
  (log as {runs: unknown[]}).runs[0] as never;

describe('toSarif (F-acedface)', () => {
  test('AC-2dfce7a7: emits a SARIF 2.1.0 log shell', () => {
    const log = toSarif(report([])) as {$schema: string; version: string; runs: unknown[]};
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif-2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(run0(log).tool.driver).toMatchObject({name: 'cladding'});
  });

  test('AC-4686f041: maps detector→rule, severity→level, path+line→physicalLocation', () => {
    const log = toSarif(
      report([
        {
          stage: 'stage_1.3',
          label: 'Drift',
          status: 'pass',
          exitCode: 0,
          findings: [
            {detector: 'AC_DRIFT', severity: 'error', path: 'src/a.ts', line: 12, message: 'bad'},
            {detector: 'STALE_TESTS', severity: 'warn', message: 'old'},
            {detector: 'DOC_DRIFT', severity: 'info', path: 'README.md', message: 'note'},
          ],
        },
      ]),
    );
    const r = run0(log);
    // levels
    const byRule = Object.fromEntries(r.tool.driver.rules.map((x) => [x.id, x.defaultConfiguration.level]));
    expect(byRule).toEqual({AC_DRIFT: 'error', STALE_TESTS: 'warning', DOC_DRIFT: 'note'});
    // result level mapping + location
    const acDrift = r.results.find((x) => x.ruleId === 'AC_DRIFT')!;
    expect(acDrift.level).toBe('error');
    expect(acDrift.locations![0].physicalLocation).toEqual({artifactLocation: {uri: 'src/a.ts'}, region: {startLine: 12}});
    // a finding with no path → no locations; a finding with path but no line → no region
    expect(r.results.find((x) => x.ruleId === 'STALE_TESTS')!.locations).toBeUndefined();
    expect(r.results.find((x) => x.ruleId === 'DOC_DRIFT')!.locations![0].physicalLocation.region).toBeUndefined();
  });

  test('AC-4686f041: a rule that emits mixed severities defaults to the most severe level', () => {
    const log = toSarif(
      report([
        {
          stage: 'stage_1.3',
          label: 'Drift',
          status: 'fail',
          exitCode: 1,
          findings: [
            {detector: 'AC_DRIFT', severity: 'info', message: 'a'},
            {detector: 'AC_DRIFT', severity: 'error', message: 'b'},
          ],
        },
      ]),
    );
    const rule = run0(log).tool.driver.rules.find((x) => x.id === 'AC_DRIFT')!;
    expect(rule.defaultConfiguration.level).toBe('error');
  });

  test('AC-12ff7ffa: fingerprints are deterministic and identity-sensitive', () => {
    const input = report([
      {stage: 'stage_1.3', label: 'Drift', status: 'pass', exitCode: 0, findings: [
        {detector: 'AC_DRIFT', severity: 'error', path: 'src/a.ts', line: 1, message: 'x'},
      ]},
    ]);
    // same input → byte-identical output (no clock/PRNG)
    expect(JSON.stringify(toSarif(input))).toBe(JSON.stringify(toSarif(input)));
    const fp = (log: unknown) => run0(log).results[0].partialFingerprints['claddingFindingHash/v1'];
    expect(fp(toSarif(input))).toMatch(/^[0-9a-f]{16}$/);
    // a finding differing only in message gets a different fingerprint
    const other = report([
      {stage: 'stage_1.3', label: 'Drift', status: 'pass', exitCode: 0, findings: [
        {detector: 'AC_DRIFT', severity: 'error', path: 'src/a.ts', line: 1, message: 'y'},
      ]},
    ]);
    expect(fp(toSarif(input))).not.toBe(fp(toSarif(other)));
  });

  test('AC-0eabdc17: a blocking stage with no findings still surfaces as a result', () => {
    const log = toSarif(
      report(
        [
          {stage: 'stage_1.1', label: 'Type', status: 'fail', exitCode: 1, stderr: 'src/x.ts(3,1): error TS2304'},
          {stage: 'stage_1.2', label: 'Lint', status: 'pass', exitCode: 0},
        ],
        {worst: 1, anyFailed: true},
      ),
    );
    const r = run0(log);
    const typeResult = r.results.find((x) => x.ruleId === 'stage_1.1')!;
    expect(typeResult).toBeDefined();
    expect(typeResult.level).toBe('error');
    expect(typeResult.message.text).toContain('TS2304');
    // a passing stage with no findings produces nothing
    expect(r.results.find((x) => x.ruleId === 'stage_1.2')).toBeUndefined();
  });

  test('tool.driver.version is stamped when provided, omitted otherwise', () => {
    expect(run0(toSarif(report([]), {version: '9.9.9'})).tool.driver.version).toBe('9.9.9');
    expect(run0(toSarif(report([]))).tool.driver.version).toBeUndefined();
  });
});

describe('clad check --format (F-acedface, e2e via built bin)', () => {
  const clad = (args: string[]): {status: number; stdout: string; stderr: string} => {
    try {
      const stdout = execFileSync('node', ['bin/clad', ...args], {cwd: repoRoot, encoding: 'utf8'});
      return {status: 0, stdout, stderr: ''};
    } catch (e) {
      const err = e as {status?: number; stdout?: string; stderr?: string};
      return {status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? ''};
    }
  };

  test('AC-ca59d7c7: an unknown --format value errors with a non-zero exit', () => {
    const {status, stdout, stderr} = clad(['check', '--tier=pre-commit', '--format', 'xml']);
    expect(status).not.toBe(0);
    expect(`${stdout}${stderr}`).toMatch(/unknown --format/);
  });

  test('AC-2dfce7a7 (e2e): --format sarif emits parseable SARIF 2.1.0', () => {
    const {stdout} = clad(['check', '--tier=pre-commit', '--format', 'sarif']);
    const log = JSON.parse(stdout) as {version: string; runs: unknown[]};
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
  });

  test('AC-e9bddf18: default output is the human summary, not SARIF/JSON', () => {
    const {stdout} = clad(['check', '--tier=pre-commit']);
    expect(stdout.trimStart().startsWith('{')).toBe(false);
  });
});
