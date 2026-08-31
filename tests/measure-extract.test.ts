// Cladding · structural pins for the measure-family LIGHT extraction (F-1e9ef827)
//
// C6 moved runSessionsMeasure / renderAdoptionSection (private) / runTrendMeasure
// out of clad.ts into src/cli/measure.ts, keeping runMeasureCommand in clad.ts as
// the thin command wrapper (the done.ts/update.ts house pattern) — the LIGHT
// variant needs zero spec-shard module edits because ~40 shards still bind
// src/cli/clad.ts as the measure feature's module. The three extracted paths
// below remain byte-identical to their command-wrapper routes; the default
// report is pinned separately with its fixed mocked report bytes.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test, vi} from 'vitest';

import {runMeasureCommand} from '../src/cli/clad.js';
import {appendEvent, newEvent} from '../src/events/log.js';
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

  test('[covers:F-1e9ef827/AC-30b84594] keeps measure renderers in measure.ts and clad.ts as the dispatch-only wrapper', () => {
    const measureSource = read('src/cli/measure.ts');
    const cladSource = read('src/cli/clad.ts');

    expect(measureSource).toContain('export function runSessionsMeasure');
    expect(measureSource).toContain('function renderAdoptionSection');
    expect(measureSource).toContain('export function runTrendMeasure');
    expect(measureSource).not.toMatch(/(?:export\s+)?function\s+runMeasureCommand/);
    expect(cladSource).toContain("import {runSessionsMeasure, runTrendMeasure} from './measure.js';");
    expect(cladSource).toContain('export function runMeasureCommand');
    expect(cladSource).not.toContain('function renderAdoptionSection');
  });

  test('[covers:F-1e9ef827/AC-815591d4] sessions, sessions JSON, and trend remain byte-identical to their command-wrapper paths', () => {
    const originalCwd = process.cwd();
    const cwd = mkdtempSync(join(tmpdir(), 'clad-measure-extract-'));
    const capture = (invoke: () => void): {bytes: string; exits: readonly unknown[][]} => {
      const chunks: string[] = [];
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      });
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      try {
        invoke();
        return {bytes: chunks.join(''), exits: exit.mock.calls};
      } finally {
        stdout.mockRestore();
        exit.mockRestore();
      }
    };
    try {
      process.chdir(cwd);
      appendEvent('.', newEvent('impact_card_fired', {file: 'src/a.ts', feature: 'F-a'}));
      mkdirSync('.cladding', {recursive: true});
      const snapshot = (timestamp: string, head: string, slice: number) => ({
        timestamp,
        head,
        spec_digest: 'a'.repeat(64),
        featureCount: 1,
        measured: 1,
        context: {medianSliceTokens: slice, medianStructuralRatio: 1, truncatedCount: 0},
        search: {p95Depth: 1},
        stability: {medianCoverage: 1},
      });
      writeFileSync(
        join(cwd, '.cladding', 'measure.jsonl'),
        `${JSON.stringify(snapshot('2026-01-01T00:00:00.000Z', 'a'.repeat(40), 10))}\n` +
          `${JSON.stringify(snapshot('2026-01-02T00:00:00.000Z', 'b'.repeat(40), 12))}\n`,
      );

      expect(capture(() => runMeasureCommand({sessions: true}))).toEqual(
        capture(() => measureModule.runSessionsMeasure({})),
      );
      expect(capture(() => runMeasureCommand({sessions: true, json: true}))).toEqual(
        capture(() => measureModule.runSessionsMeasure({json: true})),
      );
      expect(capture(() => runMeasureCommand({trend: true}))).toEqual(
        capture(() => measureModule.runTrendMeasure({trend: true})),
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, {recursive: true, force: true});
    }
  });
});
