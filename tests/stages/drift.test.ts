// Cladding · unit tests for stages/drift.ts registry mechanics

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors, registerDetector, registeredDetectors, runDrift} from '../../stages/drift.js';
import type {DriftDetector} from '../../stages/types.js';

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
