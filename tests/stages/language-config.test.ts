// Cladding · unit tests for stages/toolchain/language-config.ts
//
// The polyglot adapter's file-convention half. Pins: an explicit
// spec.project.language of 'kotlin' resolves the Kotlin layout (kt ext,
// src/main/kotlin root, dotted imports, jacoco-xml coverage); every other
// language — including 'python', 'typescript', and the empty string with no
// detectable manifest — resolves to the TS baseline (the no-regression
// default the detectors relied on before this module existed).

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {resolveLanguageConfig} from '../../src/stages/toolchain/language-config.js';

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

  test("an unlisted language ('python') → TS defaults (intentional no-regression)", () => {
    const cfg = resolveLanguageConfig(dir, 'python');
    expect(cfg.ext).toBe('ts');
    expect(cfg.mainRoot).toBe('src');
    expect(cfg.importStyle).toBe('relative');
  });

  test('empty specLanguage on an empty dir (no manifest) → TS defaults', () => {
    const cfg = resolveLanguageConfig(dir, '');
    expect(cfg.ext).toBe('ts');
    expect(cfg.mainRoot).toBe('src');
    expect(cfg.importStyle).toBe('relative');
    expect(cfg.coverageFormat).toBe('istanbul-json');
  });
});
