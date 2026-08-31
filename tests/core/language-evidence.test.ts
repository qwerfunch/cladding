// Cladding · unit tests for core/language-evidence.ts
//
// Contract under test is AC-1c7a90b2 of F-9e1279d4: ONE foundation module
// owns the extension→language vocabulary and the observed source
// distribution, so the scan layer (cli) and the drift detectors (stages)
// can never read different tables.
//
// What the tests pin:
//   - the vocabulary object the scan layer imports IS the core one
//     (identity, not a copy that can drift);
//   - classification counts per language, the sorted observed set, the
//     dominant language, and share() as counts/classified;
//   - the walk skips vendored/generated directories (node_modules et al.)
//     and every dot-directory, so build output cannot outvote source;
//   - extensions outside the vocabulary are ignored, and an empty tree
//     yields classified 0 / dominant null / share 0 rather than a throw;
//   - the walk is capped, so a detector invoking it on every gate run
//     stays bounded (asserted through the exported cap + the injectable
//     `maxFiles` override — 20 000 real files are never created);
//   - `observedKnownExtensions` reports the extensions actually present
//     rather than every extension the matching label could have — the
//     glob-building contract UNMAPPED_ARTIFACT depends on (AC-4d21c8a7
//     of F-87bb7ed3).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  classifySources,
  EXT_TO_LANGUAGE,
  LANGUAGE_VOCABULARY,
  MAX_FILES,
  observedKnownExtensions,
} from '../../src/core/language-evidence.js';
import {EXT_TO_LANGUAGE as SCAN_EXT_TO_LANGUAGE} from '../../src/cli/scan/thresholds.js';

/** Writes `count` files named `f0..f<count-1>` with `ext` under `dir/<sub>`. */
function seed(dir: string, sub: string, ext: string, count: number): void {
  const target = join(dir, sub);
  mkdirSync(target, {recursive: true});
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(target, `f${i}${ext}`), '// x\n');
  }
}

describe('core/language-evidence — shared vocabulary', () => {
  test("[covers:F-9e1279d4/AC-1c7a90b2] AC-1c7a90b2 — the scan layer re-exports the core map itself, not a copy", () => {
    expect(SCAN_EXT_TO_LANGUAGE).toBe(EXT_TO_LANGUAGE);
  });

  test('AC-1c7a90b2 — the vocabulary is exactly the label set of the map', () => {
    expect([...LANGUAGE_VOCABULARY].sort()).toEqual([...new Set(Object.values(EXT_TO_LANGUAGE))].sort());
    for (const label of ['typescript', 'python', 'kotlin', 'cpp', 'rust', 'go']) {
      expect(LANGUAGE_VOCABULARY.has(label), label).toBe(true);
    }
    expect(LANGUAGE_VOCABULARY.has('zig')).toBe(false);
  });
});

describe('core/language-evidence — classifySources', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-langev-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('AC-1c7a90b2 — counts per language, sorted set, dominant, and share', () => {
    seed(dir, join('src', 'app'), '.ts', 6);
    seed(dir, join('src', 'native'), '.cpp', 2);
    seed(dir, 'scripts', '.py', 2);

    const evidence = classifySources(dir);

    expect(evidence.counts).toEqual({typescript: 6, cpp: 2, python: 2});
    expect(evidence.classified).toBe(10);
    expect(evidence.set).toEqual(['cpp', 'python', 'typescript']);
    expect(evidence.dominant).toBe('typescript');
    expect(evidence.share('typescript')).toBeCloseTo(0.6, 10);
    expect(evidence.share('cpp')).toBeCloseTo(0.2, 10);
    expect(evidence.share('ruby')).toBe(0);
  });

  test('AC-1c7a90b2 — one language across several extensions folds into one label', () => {
    seed(dir, 'a', '.ts', 2);
    seed(dir, 'b', '.tsx', 3);
    const evidence = classifySources(dir);
    expect(evidence.counts).toEqual({typescript: 5});
    expect(evidence.set).toEqual(['typescript']);
    expect(evidence.share('typescript')).toBe(1);
  });

  test('AC-1c7a90b2 — vendored, generated and dot directories are skipped', () => {
    seed(dir, join('src', 'app'), '.ts', 3);
    // Each of these would outvote the real source if it were walked.
    for (const skipped of ['node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', '.cladding', '.git', '.venv']) {
      seed(dir, join(skipped, 'pkg'), '.py', 4);
    }

    const evidence = classifySources(dir);

    expect(evidence.counts).toEqual({typescript: 3});
    expect(evidence.set).toEqual(['typescript']);
    expect(evidence.dominant).toBe('typescript');
    expect(evidence.share('python')).toBe(0);
  });

  test('AC-1c7a90b2 — extensions outside the vocabulary are ignored', () => {
    seed(dir, 'src', '.ts', 2);
    seed(dir, 'docs', '.md', 9);
    seed(dir, 'assets', '.png', 5);
    writeFileSync(join(dir, 'Makefile'), 'all:\n');

    const evidence = classifySources(dir);

    expect(evidence.classified).toBe(2);
    expect(evidence.counts).toEqual({typescript: 2});
  });

  test('AC-1c7a90b2 — an empty tree classifies nothing and never throws', () => {
    const evidence = classifySources(dir);
    expect(evidence.classified).toBe(0);
    expect(evidence.counts).toEqual({});
    expect(evidence.set).toEqual([]);
    expect(evidence.dominant).toBeNull();
    expect(evidence.share('typescript')).toBe(0);
  });

  test('AC-1c7a90b2 — a directory that does not exist yields empty evidence', () => {
    const evidence = classifySources(join(dir, 'nope'));
    expect(evidence.classified).toBe(0);
    expect(evidence.dominant).toBeNull();
  });

  test('AC-1c7a90b2 — the walk is capped so a per-gate call stays bounded', () => {
    expect(MAX_FILES).toBe(20_000);

    seed(dir, 'src', '.ts', 12);
    // Same tree, tiny injected cap: the walk stops instead of classifying all 12.
    const capped = classifySources(dir, {maxFiles: 4});
    expect(capped.classified).toBe(4);
    expect(classifySources(dir).classified).toBe(12);
  });
});

describe('core/language-evidence — observedKnownExtensions', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-langext-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('AC-4d21c8a7 — reports the extensions present, not every extension the label covers', () => {
    seed(dir, join('src', 'engine'), '.cpp', 3);
    seed(dir, join('src', 'engine'), '.h', 1);
    seed(dir, 'scripts', '.py', 2);

    // `.cc`, `.cxx` and `.hpp` share the cpp label but are absent from the
    // tree — globbing for them would scan directories that cannot match.
    expect(observedKnownExtensions(dir)).toEqual(['.cpp', '.h', '.py']);
  });

  test('AC-4d21c8a7 — unknown extensions, vendored trees and dot directories are left out', () => {
    seed(dir, 'src', '.ts', 2);
    seed(dir, 'docs', '.md', 4);
    seed(dir, join('node_modules', 'pkg'), '.js', 5);
    seed(dir, join('.venv', 'lib'), '.py', 5);

    expect(observedKnownExtensions(dir)).toEqual(['.ts']);
  });

  test('AC-4d21c8a7 — an empty or missing tree yields no extensions, and the walk is capped', () => {
    expect(observedKnownExtensions(dir)).toEqual([]);
    expect(observedKnownExtensions(join(dir, 'nope'))).toEqual([]);

    seed(dir, 'a', '.ts', 6);
    seed(dir, 'b', '.py', 6);
    // Injected cap: the walk stops early, so it can miss a language — the
    // same bounded contract classifySources runs under.
    expect(observedKnownExtensions(dir, {maxFiles: 1}).length).toBe(1);
    expect(observedKnownExtensions(dir)).toEqual(['.py', '.ts']);
  });
});
