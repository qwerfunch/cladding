// Cladding · structural pins for the measure-family LIGHT extraction (F-1e9ef827)
//
// C6 moved runSessionsMeasure / renderAdoptionSection (private) / runTrendMeasure
// out of clad.ts into src/cli/measure.ts, keeping runMeasureCommand in clad.ts as
// the thin command wrapper (the done.ts/update.ts house pattern) — the LIGHT
// variant needs zero spec-shard module edits because ~40 shards still bind
// src/cli/clad.ts as the measure feature's module. BEHAVIOR (byte-identical
// output across all four `clad measure` invocations) is already pinned by the
// untouched tests/cli/measure-sessions.test.ts and
// tests/cli/measure-adoption.test.ts suites (AC-815591d4) — this file only
// pins the STRUCTURE (AC-30b84594): the symbols live in the right file and are
// wired the right way.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {runMeasureCommand} from '../src/cli/clad.js';
import * as measureModule from '../src/cli/measure.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('AC-30b84594 · measure internals live in src/cli/measure.ts, runMeasureCommand stays a thin clad.ts wrapper', () => {
  test('src/cli/measure.ts exists', () => {
    expect(existsSync(join(ROOT, 'src/cli/measure.ts'))).toBe(true);
  });

  test('src/cli/measure.ts exports exactly runSessionsMeasure and runTrendMeasure', () => {
    expect(typeof measureModule.runSessionsMeasure).toBe('function');
    expect(typeof measureModule.runTrendMeasure).toBe('function');
    // renderAdoptionSection stays a private (non-exported) helper — only
    // these two cross the module boundary.
    expect(Object.keys(measureModule).sort()).toEqual(['runSessionsMeasure', 'runTrendMeasure']);
  });

  test("src/cli/clad.ts imports both from './measure.js'", () => {
    const importLine = read('src/cli/clad.ts')
      .split('\n')
      .find((l) => l.includes("from './measure.js'"));
    expect(importLine, "clad.ts should import from './measure.js'").toBeDefined();
    expect(importLine).toContain('runSessionsMeasure');
    expect(importLine).toContain('runTrendMeasure');
  });

  test('runMeasureCommand remains defined (exported) in clad.ts, not measure.ts', () => {
    expect(typeof runMeasureCommand).toBe('function');
    expect(read('src/cli/clad.ts')).toContain('export function runMeasureCommand');
    expect(Object.keys(measureModule)).not.toContain('runMeasureCommand');
  });
});
