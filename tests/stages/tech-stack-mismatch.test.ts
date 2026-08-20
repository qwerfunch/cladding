// Cladding · unit tests for stages/detectors/tech-stack-mismatch.ts
//
// Detector under test cross-checks `spec.project.language` against the
// language `detectToolchain` resolves by walking the project's manifest
// chain. The three reachable outcomes:
//
//   - languages agree           → no finding
//   - languages differ          → warn finding (typo / unported drift)
//   - manifest chain returns
//     'unknown' (no manifest)   → info finding (cannot cross-check)
//
// The detector relies on the manifest priority chain in
// stages/toolchain/detect.ts: package.json (TypeScript) beats
// pyproject.toml (Python) in priority order. These tests exercise that
// priority chain at the cladding-detector level — the chain itself has
// dedicated coverage in tests/stages/toolchain.test.ts.

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

describe('TECH_STACK_MISMATCH detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-tsm-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('silent when spec language matches the detected manifest', () => {
    writeSpec(dir, 'typescript');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('emits warn when spec language differs from the detected manifest', () => {
    writeSpec(dir, 'python');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain("'python'");
    expect(findings[0].message).toContain("'typescript'");
  });

  test('emits info when no manifest matches at all', () => {
    writeSpec(dir, 'typescript');
    // intentionally no package.json, no pyproject.toml, etc.
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('no manifest matched');
  });

  test('package.json wins over pyproject.toml (priority chain)', () => {
    // Both manifests present → priority chain returns the first match,
    // which is package.json (typescript). Spec says python → mismatch
    // confirms the priority order.
    writeSpec(dir, 'python');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain("'typescript'");
  });

  test('absent spec.yaml emits one info finding (not a throw)', () => {
    // No spec.yaml at all; package.json still present.
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });

  function declareLanguage(language: string): void {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), `gate:\n  language: ${language}\n`);
  }

  test('a matching gate.language declaration silences the manifest mismatch', () => {
    // The manifest chain would say typescript (package.json), but the product
    // language is declared — the exact repo shape the escape hatch exists for.
    writeSpec(dir, 'cpp');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    declareLanguage('cpp');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });

  test('a gate.language declaration differing from the spec still warns', () => {
    // Declaration does not silence the check — spec vs declaration must agree.
    writeSpec(dir, 'cpp');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    declareLanguage('java');
    const findings = techStackMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain("'cpp'");
    expect(findings[0].message).toContain("declares 'java'");
  });

  test('a matching declaration also covers the no-manifest case (no info fallback)', () => {
    // With a declaration the cross-check has an anchor even when no manifest
    // matches, so the "cannot be cross-checked" info is not emitted.
    writeSpec(dir, 'cpp');
    declareLanguage('cpp');
    expect(techStackMismatch.run({cwd: dir})).toEqual([]);
  });
});
