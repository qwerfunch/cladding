// Cladding · unit tests for stages/toolchain/language-config.ts
//
// The polyglot adapter's file-convention half. Pins: an explicit
// spec.project.language of 'kotlin' resolves the Kotlin layout (kt ext,
// src/main/kotlin root, dotted imports, jacoco-xml coverage); 'python' resolves
// the Python layout (py ext, dotted imports, cobertura-xml coverage — F-803386ab);
// 'typescript' and the empty string with no detectable manifest resolve to the
// TS baseline (the no-regression default the detectors relied on before this
// module existed).

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  WATCHED_EXTENSIONS,
  resolveLanguageConfig,
} from '../../src/stages/toolchain/language-config.js';

describe('resolveLanguageConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-langcfg-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test("specLanguage 'kotlin' → Kotlin file conventions", () => {
    const cfg = resolveLanguageConfig(dir, 'kotlin');
    expect(cfg.ext).toBe('kt');
    expect(cfg.extensions).toEqual(['.kt', '.kts']);
    expect(cfg.mainRoot).toBe('src/main/kotlin');
    expect(cfg.sourceRoots).toContain('src/main/kotlin');
    expect(cfg.importStyle).toBe('dotted');
    expect(cfg.coverageFormat).toBe('jacoco-xml');
    expect(cfg.testGlobs).toContain('src/test/kotlin/**/*Test.kt');
  });

  test("specLanguage 'typescript' → TS defaults", () => {
    const cfg = resolveLanguageConfig(dir, 'typescript');
    expect(cfg.ext).toBe('ts');
    expect(cfg.mainRoot).toBe('src');
    expect(cfg.importStyle).toBe('relative');
    expect(cfg.coverageFormat).toBe('istanbul-json');
  });

  test("specLanguage 'python' → Python file conventions (F-803386ab)", () => {
    const cfg = resolveLanguageConfig(dir, 'python');
    expect(cfg.ext).toBe('py');
    expect(cfg.mainRoot).toBe('src');
    expect(cfg.importStyle).toBe('dotted');
    expect(cfg.coverageFormat).toBe('cobertura-xml');
  });

  // AC-2b542ed8 — the full PYTHON_CONFIG shape: .py extensions, the three pytest
  // discovery globs, the Cobertura coverage artifact, and a dotted import matcher
  // that captures both `import a.b` and `from a.b import c` (without double-matching
  // the second `import` keyword on a from-line).
  test("specLanguage 'python' → full config shape + pytest globs + cobertura summary (AC-2b542ed8)", () => {
    const cfg = resolveLanguageConfig(dir, 'python');
    expect(cfg.extensions).toEqual(['.py']);
    expect(cfg.testGlobs).toEqual([
      'tests/test_*.py',
      'tests/**/test_*.py',
      'tests/**/*_test.py',
    ]);
    expect(cfg.coverageSummary).toBe('coverage.xml');
    expect(cfg.coverageFormat).toBe('cobertura-xml');
    expect(cfg.importStyle).toBe('dotted');
  });

  test("python importMatcher captures 'a.b' from BOTH import forms, no from-line double-match (AC-2b542ed8)", () => {
    const re = resolveLanguageConfig(dir, 'python').importMatcher;
    // matchAll copies the regex's lastIndex; reset so a shared module-level
    // global regex starts from position 0 regardless of any prior scan.
    re.lastIndex = 0;
    const bothForms = 'import a.b\nfrom a.b import c\n';
    // Exactly two captures — one per line. If the `import` keyword inside the
    // from-line were double-matched, this would be length 3.
    expect([...bothForms.matchAll(re)].map((m) => m[1])).toEqual(['a.b', 'a.b']);

    re.lastIndex = 0;
    // The from-line alone yields exactly one capture (the `from a.b` head), never
    // a second from its trailing `import c`.
    expect([...'from a.b import c\n'.matchAll(re)].map((m) => m[1])).toEqual(['a.b']);
  });

  test('empty specLanguage on an empty dir (no manifest) → TS defaults', () => {
    const cfg = resolveLanguageConfig(dir, '');
    expect(cfg.ext).toBe('ts');
    expect(cfg.mainRoot).toBe('src');
    expect(cfg.importStyle).toBe('relative');
    expect(cfg.coverageFormat).toBe('istanbul-json');
  });
});

// AC-b5358945 — adding the Python entry is zero-cost for existing TS/Kotlin
// users: cladding's own TS repo still resolves the TS config by manifest
// detection, and WATCHED_EXTENSIONS stays a superset that already carried `.py`
// (now sourced from PYTHON_CONFIG.extensions rather than the supplemental table).
describe('no-regression after the Python entry (AC-b5358945)', () => {
  test('cladding\'s own repo (package.json, TS) still resolves the TS config by manifest detection', () => {
    const cfg = resolveLanguageConfig(process.cwd());
    expect(cfg.ext).toBe('ts');
    expect(cfg.extensions).toEqual(['.ts', '.tsx']);
    expect(cfg.mainRoot).toBe('src');
    expect(cfg.importStyle).toBe('relative');
    expect(cfg.coverageFormat).toBe('istanbul-json');
  });

  test('WATCHED_EXTENSIONS still contains .py (and the stable full set) — impact card unchanged', () => {
    expect(WATCHED_EXTENSIONS.has('.py')).toBe(true);
    // The membership set is a ReadonlySet, dot-prefixed + lowercased. Pin the
    // whole membership so a regression that drops `.py` (or any watched ext) is
    // caught, and the size so a silent add/remove is caught too.
    expect(WATCHED_EXTENSIONS.has('.ts')).toBe(true);
    expect(WATCHED_EXTENSIONS.has('.kt')).toBe(true);
    expect(WATCHED_EXTENSIONS.size).toBe(18);
  });
});
