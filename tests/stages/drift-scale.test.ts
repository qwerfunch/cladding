// Cladding · F-003 / F-cd0415 — Drift CLI flush + the at-scale latency floor
//
// Every withSpec detector used to re-parse the whole shard tree —
// O(detectors × shards) YAML parses per gate run (~150k parses at 5k shards,
// on every commit). runDrift now primes a run-scoped cache: one disk load
// per pass, cleared in finally. The 5k-shard budget below is generous
// (uncached behavior takes minutes) — it exists to fail loudly if a future
// change quietly returns to per-detector re-parsing.

import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';

import {loadSpec, primeSpecCache} from '../../src/spec/load.js';
import {runDrift} from '../../src/stages/drift.js';

function scaffold(dir: string, shards: number): void {
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  mkdirSync(join(dir, 'src', 'core'), {recursive: true});
  writeFileSync(join(dir, 'src', 'core', 'm.ts'), 'export const ok = 1;\n');
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject: {name: scale, language: typescript}\nfeatures: []\n',
  );
  for (let i = 0; i < shards; i++) {
    const id = `F-${i.toString(16).padStart(8, '0')}`;
    writeFileSync(
      join(dir, 'spec', 'features', `f${i}-${id.slice(2)}.yaml`),
      `id: ${id}\nslug: f${i}\ntitle: f${i}\nstatus: done\nmodules: [src/core/m.ts]\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n`,
    );
  }
}

describe('run-scoped spec cache (F-cd0415)', () => {
  test('primed cache returns the same object; cleared cache reads fresh from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-cache-'));
    try {
      scaffold(dir, 2);
      const first = loadSpec(dir);
      primeSpecCache(dir, first);
      expect(loadSpec(dir)).toBe(first); // identity — no re-parse
      primeSpecCache(dir, null);
      expect(loadSpec(dir)).not.toBe(first); // fresh object after clear
    } finally {
      primeSpecCache(dir, null);
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('runDrift clears the cache afterwards — later loadSpec sees later edits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-cache-run-'));
    try {
      scaffold(dir, 2);
      runDrift({cwd: dir});
      // Mutate after the pass; an un-cleared cache would hide this feature.
      writeFileSync(
        join(dir, 'spec', 'features', 'late-ffffffff.yaml'),
        'id: F-ffffffff\nslug: late\ntitle: late\nstatus: done\nmodules: [src/core/m.ts]\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n',
      );
      expect(loadSpec(dir).features.some((f) => f.id === 'F-ffffffff')).toBe(true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  describe('5000-shard product latency', () => {
    let dir = '';
    let setupElapsed = 0;
    let cleanupElapsed = 0;
    let runFailed = false;

    // Fixture I/O is deliberately outside the product budget: a saturated
    // full-suite worker must not turn temporary-file creation into a false
    // regression in runDrift itself.
    beforeAll(() => {
      const started = performance.now();
      dir = mkdtempSync(join(tmpdir(), 'clad-scale-'));
      scaffold(dir, 5000);
      setupElapsed = performance.now() - started;
    }, 60_000);

    afterAll(() => {
      const started = performance.now();
      if (dir) rmSync(dir, {recursive: true, force: true});
      cleanupElapsed = performance.now() - started;
      if (runFailed) {
        console.error(
          `drift scale phase timings: setup=${Math.round(setupElapsed)}ms cleanup=${Math.round(cleanupElapsed)}ms`,
        );
      }
    }, 60_000);

    test('5000-shard drift pass completes within the hard latency budget', {timeout: 20_000}, () => {
      const t0 = performance.now();
      const report = runDrift({cwd: dir});
      const elapsed = performance.now() - t0;
      try {
        expect(report.stage).toBe('stage_1.3');
        // Generous hard budget: one cached load at 5k shards runs in a few
        // seconds; the uncached O(detectors × shards) behavior takes minutes.
        expect(elapsed).toBeLessThan(15_000);
      } catch (error) {
        runFailed = true;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`drift scale run=${Math.round(elapsed)}ms setup=${Math.round(setupElapsed)}ms: ${detail}`);
      }
    });

    test('flushes complete strict JSON beyond 64 KiB before preserving the report exit code', {timeout: 30_000}, () => {
      const child = spawnSync(
        resolve('node_modules', '.bin', 'tsx'),
        [resolve('src', 'stages', 'drift.ts'), '--strict'],
        {cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
      );

      expect(child.error).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(Buffer.byteLength(child.stdout, 'utf8')).toBeGreaterThan(64 * 1024);
      expect(child.stdout.endsWith('\n')).toBe(true);
      const report = JSON.parse(child.stdout) as {readonly stage: string; readonly exitCode: number};
      expect(report.stage).toBe('stage_1.3');
      expect(report.exitCode).toBe(child.status);
    });
  });
});
