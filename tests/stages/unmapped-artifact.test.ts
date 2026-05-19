// Cladding · unit tests for stages/detectors/unmapped-artifact.ts
//
// Detector under test scans `stages/**/*.ts` and `spec/**/*.ts` from the
// cwd, comparing every file against the set of paths declared in
// `features[].modules`. An unclaimed file emits an `error` finding.
//
// What's notable about this detector and how we test it:
//   - Scope is **narrow on purpose** (tsconfig.include mirror) so test
//     fixtures, tooling configs, and generated files do not appear as
//     findings. Tests need to confirm that narrow scoping holds.
//   - It is status-blind: an archived feature still claims its modules,
//     because deleting the archived feature's source is a separate
//     workflow that STATUS_DRIFT / STALE_SPECIFICATION owns.
//   - Spec absence → single `info` finding, not a throw — projects mid-
//     migration that never wrote a spec keep their pipeline green.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {unmappedArtifact} from '../../src/stages/detectors/unmapped-artifact.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('UNMAPPED_ARTIFACT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-unmapped-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src', 'stages'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('silent when every scanned file is claimed', () => {
    writeFileSync(join(dir, 'src', 'stages', 'alpha.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [src/stages/alpha.ts]\n',
    );
    expect(unmappedArtifact.run({cwd: dir})).toEqual([]);
  });

  test('emits error for each unclaimed source file in scope', () => {
    writeFileSync(join(dir, 'src', 'stages', 'orphan-1.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src', 'stages', 'orphan-2.ts'), 'export const b = 2;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    const findings = unmappedArtifact.run({cwd: dir});
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(f.message).toMatch(/orphan-[12]\.ts/);
    }
  });

  test('files outside the scan paths are not flagged', () => {
    // `tests/` and `bin/` are NOT in the scan patterns
    // (stages/**/*.ts + spec/**/*.ts only)
    mkdirSync(join(dir, 'tests'), {recursive: true});
    mkdirSync(join(dir, 'bin'), {recursive: true});
    writeFileSync(join(dir, 'tests', 'helper.ts'), 'export const h = 1;\n');
    writeFileSync(join(dir, 'bin', 'cli.ts'), 'export const c = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    // Neither test/ nor bin/ files are scanned → no findings
    expect(unmappedArtifact.run({cwd: dir})).toEqual([]);
  });

  test('archived feature still claims its modules', () => {
    writeFileSync(join(dir, 'src', 'stages', 'legacy.ts'), 'export const l = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: legacy\nstatus: archived\nmodules: [src/stages/legacy.ts]\n',
    );
    expect(unmappedArtifact.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding (not a throw)', () => {
    rmSync(join(dir, 'spec.yaml'));
    writeFileSync(join(dir, 'src', 'stages', 'whatever.ts'), 'export const w = 1;\n');
    const findings = unmappedArtifact.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });

  test('files claimed by different features are all silent', () => {
    writeFileSync(join(dir, 'src', 'stages', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src', 'stages', 'b.ts'), 'export const b = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [src/stages/a.ts]\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: t\nstatus: done\nmodules: [src/stages/b.ts]\n',
    );
    expect(unmappedArtifact.run({cwd: dir})).toEqual([]);
  });
});
