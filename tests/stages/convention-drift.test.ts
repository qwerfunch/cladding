// Cladding · unit tests for stages/detectors/convention-drift.ts
//
// Detector under test enforces the "Documentation: Why > What" guardrail
// from ironclad-design/13-philosophical-guardrails.md. For every
// features[].modules[] source file for the configured language, the first non-empty line
// must begin a language-appropriate comment or Python docstring. Missing header → warn.
//
// The detector intentionally:
//   - skips non-`.ts` modules (yaml, json, md are out of scope)
//   - skips modules that don't exist on disk (UNMAPPED_ARTIFACT and
//     MISSING_IMPLEMENTATION own the absence question)
//   - opts out silently on spec absence (info, not error)
//
// The full LLM-assisted semantic variant lands later behind the
// `reviewer` agent; this brick covers only the deterministic v0.1 floor.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {conventionDrift} from '../../src/stages/detectors/convention-drift.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('CONVENTION_DRIFT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-conv-drift-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'stages'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('TS module with a leading line-comment header → no finding', () => {
    writeFileSync(
      join(dir, 'stages', 'good.ts'),
      '// Why this exists: intent stated up front.\nexport const x = 1;\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/good.ts]\n',
    );
    expect(conventionDrift.run({cwd: dir})).toEqual([]);
  });

  test('TS module with a leading block-comment header → no finding', () => {
    writeFileSync(
      join(dir, 'stages', 'good.ts'),
      '/* Why this exists: block form. */\nexport const x = 1;\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/good.ts]\n',
    );
    expect(conventionDrift.run({cwd: dir})).toEqual([]);
  });

  test.each([
    ['hash comment', '# Why this exists: intent stated up front.\nVALUE = 1\n'],
    ['double-quoted module docstring', '"""Why this module exists."""\nVALUE = 1\n'],
    ['single-quoted module docstring', "'''Why this module exists.'''\nVALUE = 1\n"],
  ])('Python module with a leading %s → no finding', (_label, source) => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: x, language: python}\nfeatures: []\n',
    );
    mkdirSync(join(dir, 'backend'), {recursive: true});
    writeFileSync(join(dir, 'backend', 'good.py'), source);
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [backend/good.py]\n',
    );
    expect(conventionDrift.run({cwd: dir})).toEqual([]);
  });

  test("[covers:F-056/AC-129] Python module without a header comment or docstring → warn finding", () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: x, language: python}\nfeatures: []\n',
    );
    mkdirSync(join(dir, 'backend'), {recursive: true});
    writeFileSync(join(dir, 'backend', 'bare.py'), 'VALUE = 1\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [backend/bare.py]\n',
    );
    const findings = conventionDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('backend/bare.py');
  });

  test('TS module without any header comment → warn finding', () => {
    writeFileSync(join(dir, 'stages', 'bare.ts'), 'export const x = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/bare.ts]\n',
    );
    const findings = conventionDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('stages/bare.ts');
    expect(findings[0].message).toContain('no file-header comment');
  });

  test('module path that does not exist on disk → silent (UNMAPPED owns it)', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/never-existed.ts]\n',
    );
    expect(conventionDrift.run({cwd: dir})).toEqual([]);
  });

  test('non-TS module (yaml / json) is skipped', () => {
    writeFileSync(join(dir, 'stages', 'config.json'), '{"x":1}\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/config.json]\n',
    );
    expect(conventionDrift.run({cwd: dir})).toEqual([]);
  });

  test('multiple bare modules across features → one finding per offender', () => {
    writeFileSync(join(dir, 'stages', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'stages', 'b.ts'), 'export const b = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/a.ts]\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: t\nstatus: done\nmodules: [stages/b.ts]\n',
    );
    const findings = conventionDrift.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['stages/a.ts', 'stages/b.ts']);
  });

  test('absent spec.yaml emits one info finding (not a throw)', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = conventionDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});
