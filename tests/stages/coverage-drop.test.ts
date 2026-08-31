// Cladding · unit tests for stages/detectors/coverage-drop.ts
//
// Detector under test reads vitest's `coverage/coverage-summary.json`
// artifact left by stage_2.2 and emits a warn finding when total line
// coverage falls below the 70% floor. The detector never spawns the
// coverage tool itself — it's strictly opt-in on a prior run leaving
// the artifact in place.
//
// Branches:
//   - artifact absent          → info  (opt-in signal)
//   - artifact malformed       → warn  (parser error surfaces)
//   - coverage >= floor        → silent
//   - coverage <  floor        → warn  (with actual + floor in message)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {coverageDrop} from '../../src/stages/detectors/coverage-drop.js';

function writeSummary(dir: string, content: string): void {
  mkdirSync(join(dir, 'coverage'), {recursive: true});
  writeFileSync(join(dir, 'coverage', 'coverage-summary.json'), content);
}

describe('COVERAGE_DROP detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-cov-drop-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('coverage-summary.json absent → info finding', () => {
    const findings = coverageDrop.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('not present');
    expect(findings[0].message).toContain('stage_2.2');
  });

  test('line coverage above floor → silent', () => {
    writeSummary(dir, JSON.stringify({total: {lines: {pct: 85.4}}}));
    expect(coverageDrop.run({cwd: dir})).toEqual([]);
  });

  test('line coverage exactly at floor (70%) → silent', () => {
    writeSummary(dir, JSON.stringify({total: {lines: {pct: 70}}}));
    expect(coverageDrop.run({cwd: dir})).toEqual([]);
  });

  test("[covers:F-057/AC-133] line coverage below floor → warn finding with actual + floor", () => {
    writeSummary(dir, JSON.stringify({total: {lines: {pct: 45.2}}}));
    const findings = coverageDrop.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('45.2%');
    expect(findings[0].message).toContain('70%');
  });

  test('summary present but malformed JSON → warn finding', () => {
    writeSummary(dir, '{not valid json');
    const findings = coverageDrop.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('unparseable');
  });

  test('summary lacking total.lines.pct → treated as 0 (below floor)', () => {
    writeSummary(dir, JSON.stringify({total: {}}));
    const findings = coverageDrop.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('0.0%');
  });
});
