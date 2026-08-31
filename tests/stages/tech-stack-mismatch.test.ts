// Cladding · unit tests for stages/detectors/tech-stack-mismatch.ts
//
// Detector under test compares `spec.project.language` against the source
// files actually on disk (core/language-evidence.ts) — never against the
// build-manifest chain. Outcome table (F-9e1279d4):
//
//   declared language outside the vocabulary        → nothing (AC-3f8e6d15)
//   fewer than 5 classified source files            → nothing (AC-3f8e6d15)
//   declared absent from the observed set           → one warn, naming the
//                                                     declared language and
//                                                     the observed counts
//                                                     (AC-5b2d47c9)
//   declared observed but under 10% of sources      → one info, naming the
//                                                     share; never blocking
//                                                     (AC-8d94a1e6)
//   declared at or above 10% of sources             → nothing (AC-e07c3241)
//
// The manifest chain is deliberately not consulted for identity, so a
// package.json / build.gradle in the fixture must not move any outcome —
// that invariant is asserted directly. Fixtures write ≥5 real source files
// under <tmp>/src/pkg/ so the evidence floor is genuinely cleared rather
// than mocked.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {techStackMismatch} from '../../src/stages/detectors/tech-stack-mismatch.js';

function writeSpec(dir: string, language: string): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject: {name: x, language: ${language}}\nfeatures: []\n`,
  );
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
}

/** Writes `count` source files with `ext` under <dir>/src/pkg (prefix keeps names unique). */
function writeSources(dir: string, ext: string, count: number, prefix = 'f'): void {
  const target = join(dir, 'src', 'pkg');
  mkdirSync(target, {recursive: true});
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(target, `${prefix}${i}${ext}`), '// source\n');
  }
}

describe('TECH_STACK_MISMATCH detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-tsm-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('AC-e07c3241 — silent when the declared language is the majority of sources', () => {
    writeSpec(dir, 'typescript');
    writeSources(dir, '.ts', 8);
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('AC-e07c3241 — silent on a normal polyglot where the declared language is a plural presence', () => {
    // Android-shaped: Kotlin app with an NDK C++ core. Declared kotlin is
    // well above the minority band, so nothing is said.
    writeSpec(dir, 'kotlin');
    writeSources(dir, '.kt', 10, 'k');
    writeSources(dir, '.cpp', 4, 'n');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-9e1279d4/AC-5b2d47c9] AC-5b2d47c9 — warns when the declared language is absent from the tree', () => {
    writeSpec(dir, 'python');
    writeSources(dir, '.ts', 6);

    const findings = techStackMismatch.run({cwd: dir});

    expect(findings).toHaveLength(1);
    expect(findings[0].detector).toBe('TECH_STACK_MISMATCH');
    expect(findings[0].severity).toBe('warn');
    // names the declared language, the observed language, and the evidence count
    expect(findings[0].message).toContain("'python'");
    expect(findings[0].message).toContain('typescript');
    expect(findings[0].message).toContain('×6');
  });

  test('AC-5b2d47c9 — the warn lists every observed language, most-seen first', () => {
    writeSpec(dir, 'python');
    writeSources(dir, '.ts', 6);
    writeSources(dir, '.go', 2, 'g');

    const findings = techStackMismatch.run({cwd: dir});

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('{typescript ×6, go ×2}');
  });

  test('[covers:F-9e1279d4/AC-8d94a1e6] AC-8d94a1e6 — a declared language under 10% of sources is info, never blocking', () => {
    // Thin native SDK: 1 C++ file under 19 TypeScript files = 5%.
    writeSpec(dir, 'cpp');
    writeSources(dir, '.ts', 19);
    writeSources(dir, '.cpp', 1, 'n');

    const findings = techStackMismatch.run({cwd: dir});

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain("'cpp'");
    expect(findings[0].message).toContain('(1/20)');
  });

  test('AC-8d94a1e6 — the detector never emits an error severity', () => {
    for (const [language, ext, count] of [['python', '.ts', 6], ['cpp', '.ts', 19]] as const) {
      const local = mkdtempSync(join(tmpdir(), 'clad-tsm-sev-'));
      try {
        writeSpec(local, language);
        writeSources(local, ext, count);
        if (language === 'cpp') writeSources(local, '.cpp', 1, 'n');
        for (const finding of techStackMismatch.run({cwd: local})) {
          expect(finding.severity).not.toBe('error');
        }
      } finally {
        rmSync(local, {recursive: true, force: true});
      }
    }
  });

  test('AC-e07c3241 — exactly at the 10% threshold is silence, not disclosure', () => {
    // 2 of 20 = 10% — the band is "under 10%", so the boundary stays quiet.
    writeSpec(dir, 'cpp');
    writeSources(dir, '.ts', 18);
    writeSources(dir, '.cpp', 2, 'n');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('AC-3f8e6d15 — a language outside the vocabulary produces nothing', () => {
    // cladding has no extension mapping for zig; ignorance is not drift,
    // even though the tree is unambiguously TypeScript.
    writeSpec(dir, 'zig');
    writeSources(dir, '.ts', 8);
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('AC-3f8e6d15 — fewer than 5 classified source files produces nothing', () => {
    writeSpec(dir, 'python');
    writeSources(dir, '.ts', 4);
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-9e1279d4/AC-3f8e6d15] unknown languages and sub-five source sets both stay silent', () => {
    writeSpec(dir, 'zig');
    writeSources(dir, '.ts', 8);
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);

    rmSync(join(dir, 'src'), {recursive: true, force: true});
    writeSpec(dir, 'python');
    writeSources(dir, '.ts', 4);
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('AC-3f8e6d15 — the fifth file is the first that can carry an assertion', () => {
    writeSpec(dir, 'python');
    writeSources(dir, '.ts', 5);
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });

  test('AC-3f8e6d15 — a docs-only tree with no source files produces nothing', () => {
    writeSpec(dir, 'typescript');
    mkdirSync(join(dir, 'docs'), {recursive: true});
    writeFileSync(join(dir, 'docs', 'guide.md'), '# guide\n');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-9e1279d4/AC-e07c3241] AC-e07c3241 — a build manifest cannot contradict the sources', () => {
    // Old contract: package.json resolved "typescript" and warned against a
    // python spec even with zero source files. New contract: the manifest is
    // not consulted at all, so a truthful python tree stays silent.
    writeSpec(dir, 'python');
    writeSources(dir, '.py', 6);
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    writeFileSync(join(dir, 'build.gradle'), 'plugins {}\n');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('AC-e07c3241 — adding or removing manifests leaves the outcome identical', () => {
    writeSpec(dir, 'python');
    writeSources(dir, '.ts', 6);
    const withoutManifest = techStackMismatch.run({cwd: dir});
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    expect(techStackMismatch.run({cwd: dir})).toEqual(withoutManifest);
  });

  test('AC-e07c3241 — vendored dependencies cannot outvote the real sources', () => {
    writeSpec(dir, 'typescript');
    writeSources(dir, '.ts', 6);
    const vendored = join(dir, 'node_modules', 'left-pad');
    mkdirSync(vendored, {recursive: true});
    for (let i = 0; i < 40; i += 1) writeFileSync(join(vendored, `v${i}.py`), '# vendored\n');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding (not a throw)', () => {
    writeSources(dir, '.ts', 6);
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});
