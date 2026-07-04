// Cladding · unit tests for src/report/sarif.ts (F-f6cc5e5a · AC-46e8c26f)
//
// Pure-level contract of the SARIF 2.1.0 emitter, driven from synthetic drift
// findings. Structural shape assertions only — no SARIF-schema dependency:
//   - one result per error|warn finding; info EXCLUDED
//   - ruleId = detector name; level error→error, warn→warning
//   - physicalLocation present only when path present; startLine defaults to 1
//   - rules deduped into tool.driver.rules
//   - results sorted (byte-stable determinism across two runs)
//   - version "2.1.0" + $schema present

import {describe, expect, test} from 'vitest';

import {toSarif, type SarifFinding} from '../../src/report/sarif.js';

/** The subset of the SARIF log shape these tests read. */
interface SarifLog {
  readonly $schema?: string;
  readonly version?: string;
  readonly runs: readonly {
    readonly tool: {readonly driver: {readonly name: string; readonly rules: readonly {readonly id: string}[]}};
    readonly results: readonly {
      readonly ruleId: string;
      readonly level: string;
      readonly message: {readonly text: string};
      readonly locations?: readonly {
        readonly physicalLocation: {
          readonly artifactLocation: {readonly uri: string};
          readonly region: {readonly startLine: number};
        };
      }[];
    }[];
  }[];
}

function sarif(findings: readonly SarifFinding[]): SarifLog {
  return toSarif(findings) as SarifLog;
}

describe('report/sarif — toSarif (AC-46e8c26f)', () => {
  test('emits exactly one result per error|warn finding and excludes info', () => {
    const log = sarif([
      {detector: 'D_ERR', severity: 'error', message: 'boom', path: 'src/a.ts', line: 3},
      {detector: 'D_WARN', severity: 'warn', message: 'careful', path: 'src/b.ts'},
      {detector: 'D_INFO', severity: 'info', message: 'fyi', path: 'src/c.ts'},
    ]);
    const results = log.runs[0].results;
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.ruleId).sort()).toEqual(['D_ERR', 'D_WARN']);
    // the info finding contributes neither a result …
    expect(results.some((r) => r.ruleId === 'D_INFO')).toBe(false);
    // … nor a rule.
    expect(log.runs[0].tool.driver.rules.map((r) => r.id)).not.toContain('D_INFO');
  });

  test('ruleId is the detector name and level maps error→error, warn→warning', () => {
    const log = sarif([
      {detector: 'ALPHA', severity: 'error', message: 'e'},
      {detector: 'BETA', severity: 'warn', message: 'w'},
    ]);
    const byRule = new Map(log.runs[0].results.map((r) => [r.ruleId, r.level]));
    expect(byRule.get('ALPHA')).toBe('error');
    expect(byRule.get('BETA')).toBe('warning');
  });

  test('physicalLocation is built from a present path, and startLine defaults to 1', () => {
    const log = sarif([
      {detector: 'WITH_LINE', severity: 'error', message: 'm', path: 'src/x.ts', line: 42},
      {detector: 'NO_LINE', severity: 'warn', message: 'm', path: 'src/y.ts'},
    ]);
    const byRule = new Map(log.runs[0].results.map((r) => [r.ruleId, r]));
    const withLine = byRule.get('WITH_LINE')!;
    expect(withLine.locations?.[0].physicalLocation.artifactLocation.uri).toBe('src/x.ts');
    expect(withLine.locations?.[0].physicalLocation.region.startLine).toBe(42);
    const noLine = byRule.get('NO_LINE')!;
    expect(noLine.locations?.[0].physicalLocation.artifactLocation.uri).toBe('src/y.ts');
    expect(noLine.locations?.[0].physicalLocation.region.startLine).toBe(1);
  });

  test('a finding with no path carries no locations at all', () => {
    const log = sarif([{detector: 'NO_PATH', severity: 'error', message: 'pathless'}]);
    expect(log.runs[0].results[0].locations).toBeUndefined();
  });

  test('rules are deduped into tool.driver.rules (one rule per detector, sorted)', () => {
    const log = sarif([
      {detector: 'DUP', severity: 'error', message: 'a', path: 'src/a.ts'},
      {detector: 'DUP', severity: 'warn', message: 'b', path: 'src/b.ts'},
      {detector: 'AAA', severity: 'error', message: 'c', path: 'src/c.ts'},
    ]);
    const ids = log.runs[0].tool.driver.rules.map((r) => r.id);
    expect(ids).toEqual(['AAA', 'DUP']);
    // three results, but only two distinct rules.
    expect(log.runs[0].results).toHaveLength(3);
  });

  test('results are sorted for byte-stable output (two runs serialize identically)', () => {
    const findings: SarifFinding[] = [
      {detector: 'ZED', severity: 'error', message: 'z', path: 'src/z.ts', line: 2},
      {detector: 'ABLE', severity: 'warn', message: 'a', path: 'src/a.ts', line: 5},
      {detector: 'ABLE', severity: 'error', message: 'a2', path: 'src/a.ts', line: 1},
    ];
    const first = JSON.stringify(toSarif(findings));
    const second = JSON.stringify(toSarif([...findings].reverse()));
    // order of input does not change the serialized output — the sort is total.
    expect(second).toBe(first);
    // and the results are actually ordered by ruleId then path then line.
    const results = (toSarif(findings) as SarifLog).runs[0].results;
    expect(results.map((r) => r.ruleId)).toEqual(['ABLE', 'ABLE', 'ZED']);
    const ableLines = results
      .filter((r) => r.ruleId === 'ABLE')
      .map((r) => r.locations?.[0].physicalLocation.region.startLine);
    expect(ableLines).toEqual([1, 5]);
  });

  test('stamps SARIF version 2.1.0 and a $schema, with a single run', () => {
    const log = sarif([{detector: 'D', severity: 'error', message: 'm'}]);
    expect(log.version).toBe('2.1.0');
    expect(typeof log.$schema).toBe('string');
    expect(log.$schema!.length).toBeGreaterThan(0);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe('cladding');
  });

  test('no findings → an empty-but-valid run (no results, no rules)', () => {
    const log = sarif([]);
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0].results).toHaveLength(0);
    expect(log.runs[0].tool.driver.rules).toHaveLength(0);
  });
});
