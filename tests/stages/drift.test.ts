// Cladding · unit tests for stages/drift.ts registry mechanics

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors, registerDetector, registeredDetectors, runDrift} from '../../src/stages/drift.js';
import type {DriftDetector} from '../../src/stages/types.js';

const noop: DriftDetector = {name: 'TEST_NOOP', run: () => []};
const failer: DriftDetector = {
  name: 'TEST_FAILER',
  run: () => [{detector: 'TEST_FAILER', severity: 'error' as const, message: 'boom'}],
};

describe('drift registry', () => {
  beforeEach(() => {
    clearDetectors();
  });
  afterEach(() => {
    clearDetectors();
  });

  test('empty registry → pass with no findings', () => {
    const report = runDrift({cwd: '.'});
    expect(report.pass).toBe(true);
    expect(report.findings).toEqual([]);
  });

  test('registerDetector accepts and lists', () => {
    registerDetector(noop);
    expect(registeredDetectors()).toContain('TEST_NOOP');
  });

  test('registering same name twice replaces idempotently', () => {
    registerDetector(noop);
    registerDetector(noop);
    expect(registeredDetectors().filter((n) => n === 'TEST_NOOP')).toHaveLength(1);
  });

  test('error-severity finding fails the stage', () => {
    registerDetector(failer);
    const report = runDrift({cwd: '.'});
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.findings).toHaveLength(1);
  });
});

describe('drift --strict mode (F-051)', () => {
  const warner: DriftDetector = {
    name: 'TEST_WARNER',
    run: () => [{detector: 'TEST_WARNER', severity: 'warn' as const, message: 'soft drift'}],
  };

  beforeEach(() => clearDetectors());
  afterEach(() => clearDetectors());

  test('default: warn finding does NOT fail the stage', () => {
    registerDetector(warner);
    const report = runDrift({cwd: '.'});
    expect(report.pass).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.findings).toHaveLength(1);
  });

  test('strict: warn finding DOES fail the stage', () => {
    registerDetector(warner);
    const report = runDrift({cwd: '.', strict: true});
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('strict: error still fails (existing behavior preserved)', () => {
    registerDetector(failer);
    const report = runDrift({cwd: '.', strict: true});
    expect(report.pass).toBe(false);
  });

  test('strict: info-severity does not fail (only error + warn)', () => {
    const infoer: DriftDetector = {
      name: 'TEST_INFOER',
      run: () => [{detector: 'TEST_INFOER', severity: 'info' as const, message: 'just a note'}],
    };
    registerDetector(infoer);
    const report = runDrift({cwd: '.', strict: true});
    expect(report.pass).toBe(true);
  });
});

describe('drift --scope filter (0.4.2)', () => {
  const inScope: DriftDetector = {
    name: 'TEST_IN_SCOPE',
    run: () => [
      {detector: 'TEST_IN_SCOPE', severity: 'error' as const, path: 'src/work/loop.ts', message: 'inside'},
    ],
  };
  const outOfScope: DriftDetector = {
    name: 'TEST_OUT_OF_SCOPE',
    run: () => [
      {detector: 'TEST_OUT_OF_SCOPE', severity: 'error' as const, path: 'src/other/file.ts', message: 'outside'},
    ],
  };
  const projectLevel: DriftDetector = {
    name: 'TEST_PROJECT_LEVEL',
    run: () => [
      {detector: 'TEST_PROJECT_LEVEL', severity: 'error' as const, message: 'no path — cross-cutting'},
    ],
  };

  beforeEach(() => clearDetectors());
  afterEach(() => clearDetectors());

  test('no scope → all findings kept (regression check)', () => {
    registerDetector(inScope);
    registerDetector(outOfScope);
    const report = runDrift({cwd: '.'});
    expect(report.findings).toHaveLength(2);
  });

  test('scope keeps matching path findings, drops out-of-scope', () => {
    registerDetector(inScope);
    registerDetector(outOfScope);
    const report = runDrift({cwd: '.', scope: ['src/work/']});
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].detector).toBe('TEST_IN_SCOPE');
  });

  test('project-level findings (no path) bypass the scope filter', () => {
    registerDetector(outOfScope);
    registerDetector(projectLevel);
    const report = runDrift({cwd: '.', scope: ['src/work/']});
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].detector).toBe('TEST_PROJECT_LEVEL');
  });

  test('multiple scope entries are OR-ed', () => {
    registerDetector(inScope);
    registerDetector(outOfScope);
    const report = runDrift({cwd: '.', scope: ['src/work/', 'src/other/']});
    expect(report.findings).toHaveLength(2);
  });

  test('trailing slash is optional — scope "src/work" matches src/work/loop.ts', () => {
    registerDetector(inScope);
    const report = runDrift({cwd: '.', scope: ['src/work']});
    expect(report.findings).toHaveLength(1);
  });

  test('exact path match works (no trailing slash needed)', () => {
    const exact: DriftDetector = {
      name: 'TEST_EXACT',
      run: () => [{detector: 'TEST_EXACT', severity: 'error' as const, path: 'README.md', message: 'x'}],
    };
    registerDetector(exact);
    const report = runDrift({cwd: '.', scope: ['README.md']});
    expect(report.findings).toHaveLength(1);
  });

  test('pass policy still applies after scope filter (in_scope error fails stage)', () => {
    registerDetector(inScope);
    const report = runDrift({cwd: '.', scope: ['src/work/']});
    expect(report.pass).toBe(false);
  });

  test('all findings filtered out → stage passes', () => {
    registerDetector(outOfScope);
    const report = runDrift({cwd: '.', scope: ['src/work/']});
    expect(report.pass).toBe(true);
    expect(report.findings).toHaveLength(0);
  });
});
