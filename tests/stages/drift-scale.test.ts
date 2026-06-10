// Cladding · F-cd0415 — spec-load-once + the at-scale latency floor
//
// Every withSpec detector used to re-parse the whole shard tree —
// O(detectors × shards) YAML parses per gate run (~150k parses at 5k shards,
// on every commit). runDrift now primes a run-scoped cache: one disk load
// per pass, cleared in finally. The 5k-shard budget below is generous
// (uncached behavior takes minutes) — it exists to fail loudly if a future
// change quietly returns to per-detector re-parsing.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

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

  test('5000-shard drift pass completes within the hard latency budget', {timeout: 60_000}, () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-scale-'));
    try {
      scaffold(dir, 5000);
      const t0 = performance.now();
      const report = runDrift({cwd: dir});
      const elapsed = performance.now() - t0;
      expect(report.stage).toBe('stage_1.3');
      // Generous hard budget: one cached load at 5k shards runs in a few
      // seconds; the uncached O(detectors × shards) behavior takes minutes.
      expect(elapsed).toBeLessThan(15_000);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
