// Cladding · unit tests for stages/detectors/unmapped-artifact.ts
//
// The detector compares real source files against the set of paths
// declared in `features[].modules`; an unclaimed file emits an `error`
// finding. Which files count as "real source" is the scan universe, and
// since F-87bb7ed3 that universe is built from evidence — what the tree
// contains plus what the spec claims — never from `project.language`.
//
// What's notable about this detector and how we test it:
//   - Below the scale gate the universe is the **narrow legacy pair**, on
//     purpose, so day-1 adoptions are not walled off by findings for
//     files they have not claimed yet.
//   - Above it, scope is **evidenced**: observed extensions keep a lazy
//     spec honest, claimed modules teach roots and unknown languages.
//     Only modules under a declared layer teach, so a root-level docs
//     claim cannot widen the source universe.
//   - It is status-blind: an archived feature still claims its modules,
//     because deleting the archived feature's source is a separate
//     workflow that STATUS_DRIFT / STALE_SPECIFICATION owns.
//   - Spec absence → single `info` finding, not a throw — projects mid-
//     migration that never wrote a spec keep their pipeline green.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {scanPatterns, unmappedArtifact} from '../../src/stages/detectors/unmapped-artifact.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

/** Writes `rel` under `dir`, creating parent directories. */
function write(dir: string, rel: string, body = 'x\n'): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), {recursive: true});
  writeFileSync(full, body);
}

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

// ─── scan universe: declared layers (F-aee61f) × evidence (F-87bb7ed3) ───

const EIGHT_FEATURES = Array.from({length: 8}, (_, i) => ({
  id: `F-00000${i}`,
  title: 't',
  status: 'done',
  modules: [] as string[],
  acceptance_criteria: [],
}));

/** The eight features of the full-scan scale gate, the first one claiming `modules`. */
function claiming(...modules: string[]): unknown[] {
  return EIGHT_FEATURES.map((f, i) => (i === 0 ? {...f, modules} : f));
}

describe('scanPatterns', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-unmapped-universe-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('scale gate: under 8 features the legacy narrow patterns apply even with layers declared', () => {
    write(dir, 'src/cli/a.ts');
    const spec = {
      project: {name: 'x', language: 'typescript'},
      features: EIGHT_FEATURES.slice(0, 3),
      architecture: {layers: [['cli']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/stages/**/*.ts', 'src/spec/**/*.ts']);
  });

  test('falls back to the legacy narrow patterns when no architecture is declared', () => {
    const spec = {project: {name: 'x', language: 'typescript'}, features: []} as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/stages/**/*.ts', 'src/spec/**/*.ts']);
  });

  test('derives one pattern per declared layer (canonical string-tier form) from the observed extension', () => {
    write(dir, 'src/cli/a.ts');
    const spec = {
      project: {name: 'x', language: 'typescript'},
      features: EIGHT_FEATURES,
      architecture: {layers: [['cli', 'serve'], ['core']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual([
      'src/cli/**/*.ts',
      'src/core/**/*.ts',
      'src/serve/**/*.ts',
    ]);
  });

  test('accepts the {name} object layer form', () => {
    write(dir, 'src/api/handler.py');
    const spec = {
      project: {name: 'x', language: 'python'},
      features: EIGHT_FEATURES,
      architecture: {layers: [{name: 'api'}, {name: 'domain'}]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/api/**/*.py', 'src/domain/**/*.py']);
  });

  test('AC-4d21c8a7 — every observed extension enters the universe, not just one per language', () => {
    // The measured defect: `cpp` had no table entry, so the universe was
    // `*.ts` and matched nothing. Both C++ extensions must now be scanned.
    write(dir, 'src/engine/vm.cpp');
    write(dir, 'src/engine/vm.h');
    const spec = {
      project: {name: 'x', language: 'cpp'},
      features: EIGHT_FEATURES,
      architecture: {layers: [['engine']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/engine/**/*.cpp', 'src/engine/**/*.h']);
  });

  test('AC-4d21c8a7 — observation keeps a lazy spec honest: an unclaimed language stays in scope', () => {
    write(dir, 'src/engine/vm.cpp'); // nothing claims this one
    write(dir, 'src/engine/Bridge.java');
    const spec = {
      project: {name: 'x', language: 'java'},
      features: claiming('src/engine/Bridge.java'),
      architecture: {layers: [['engine']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/engine/**/*.cpp', 'src/engine/**/*.java']);
  });

  test('AC-4d21c8a7 — a claimed module teaches an extension the vocabulary has never heard of', () => {
    write(dir, 'src/core/vm.zig'); // unknown to the vocabulary → observation ignores it
    const spec = {
      project: {name: 'x', language: 'zig'},
      features: claiming('src/core/vm.zig'),
      architecture: {layers: [['core']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/core/**/*.zig']);
  });

  test('AC-9a6f02d3 — the scan root is inferred from the segments before the layer', () => {
    write(dir, 'src/main/kotlin/core/A.kt');
    const spec = {
      project: {name: 'x', language: 'kotlin'},
      features: claiming('src/main/kotlin/core/A.kt'),
      architecture: {layers: [['core']]},
    } as never;
    // Used to require a ROOT_BY_LANGUAGE entry; now the claim teaches it.
    expect(scanPatterns(spec, dir)).toEqual(['src/main/kotlin/core/**/*.kt']);
  });

  test('AC-9a6f02d3 — two substantial source roots both survive (Gradle kotlin + java split)', () => {
    const spec = {
      project: {name: 'x', language: 'kotlin'},
      features: claiming('src/main/kotlin/core/A.kt', 'src/main/java/core/B.java'),
      architecture: {layers: [['core']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual([
      'src/main/java/core/**/*.java',
      'src/main/java/core/**/*.kt',
      'src/main/kotlin/core/**/*.java',
      'src/main/kotlin/core/**/*.kt',
    ]);
  });

  test('AC-9a6f02d3 — src is the fallback root when no module teaches one', () => {
    write(dir, 'src/core/a.ts');
    const spec = {
      project: {name: 'x', language: 'typescript'},
      features: claiming('README.md'), // claimed, but under no declared layer
      architecture: {layers: [['core']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/core/**/*.ts']);
  });

  test('a directory that merely reuses a layer name does not become a scan root', () => {
    // `tests/core/...` teaches the root `tests` by segment match alone. Left
    // unfiltered, a mirrored test tree turns every unclaimed test file into a
    // finding — so a root has to carry a real share of the claims.
    write(dir, 'src/core/a.ts');
    write(dir, 'tests/core/a.test.ts');
    const spec = {
      project: {name: 'x', language: 'typescript'},
      features: claiming(
        'src/core/a.ts',
        'src/core/b.ts',
        'src/core/c.ts',
        'src/core/d.ts',
        'src/core/e.ts',
        'src/core/f.ts',
        'src/core/g.ts',
        'src/core/h.ts',
        'src/core/i.ts',
        'tests/core/a.test.ts',
      ),
      architecture: {layers: [['core']]},
    } as never;
    expect(scanPatterns(spec, dir)).toEqual(['src/core/**/*.ts']);
  });

  test('claims outside every declared layer teach neither a root nor an extension', () => {
    write(dir, 'src/core/a.ts');
    const base = {
      project: {name: 'x', language: 'typescript'},
      features: claiming('src/core/a.ts'),
      architecture: {layers: [['core']]},
    };
    const withDocs = {
      ...base,
      features: claiming('src/core/a.ts', 'CHANGELOG.md', 'docs/guide.md'),
    };
    expect(scanPatterns(withDocs as never, dir)).toEqual(scanPatterns(base as never, dir));
    expect(scanPatterns(withDocs as never, dir)).toEqual(['src/core/**/*.ts']);
  });

  test('AC-7f14d6e0 — the universe is identical whatever project.language says', () => {
    write(dir, 'src/core/vm.cpp');
    write(dir, 'src/core/vm.h');
    const universe = (language: unknown): readonly string[] =>
      scanPatterns(
        {
          project: language === undefined ? {name: 'x'} : {name: 'x', language},
          features: EIGHT_FEATURES,
          architecture: {layers: [['core']]},
        } as never,
        dir,
      );
    const expected = ['src/core/**/*.cpp', 'src/core/**/*.h'];
    expect(universe('cpp')).toEqual(expected);
    expect(universe('typescript')).toEqual(expected); // a wrong label cannot misdirect it
    expect(universe('brainfuck')).toEqual(expected); // nor an unknown one
    expect(universe(undefined)).toEqual(expected); // nor a missing one
  });
});

// ─── end-to-end: the universe reaches real findings ───

/** An inline spec with `count` features, the given layers, and an optional claim. */
function inlineSpec(language: string, layers: string[], modules: string[] = []): string {
  return (
    [
      'schema: "0.1"',
      `project: {name: f, language: ${language}}`,
      'architecture:',
      '  layers:',
      `    - [${layers.join(', ')}]`,
      'features:',
      ...Array.from({length: 8}, (_, i) =>
        [
          `  - id: F-10000${i}`,
          '    title: t',
          '    status: done',
          `    modules: [${i === 0 ? modules.join(', ') : ''}]`,
          '    acceptance_criteria:',
          '      - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}',
        ].join('\n'),
      ),
    ].join('\n') + '\n'
  );
}

describe('UNMAPPED_ARTIFACT — declared layers reach real files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-unmapped-arch-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('a file in a declared layer that no feature claims is FOUND (was blind pre-0.6)', () => {
    write(dir, 'src/router/orphan.ts', 'export const x = 1;\n');
    writeFileSync(join(dir, 'spec.yaml'), inlineSpec('typescript', ['router']));
    const findings = unmappedArtifact.run({cwd: dir});
    const hit = findings.find((f) => f.path === 'src/router/orphan.ts');
    expect(hit?.severity).toBe('error');
  });

  test('AC-4d21c8a7 — a C++ project is scanned instead of passing vacuously', () => {
    // Pre-F-87bb7ed3 this project globbed `src/router/**/*.ts`, matched
    // nothing, and reported a clean bill of health.
    write(dir, 'src/router/orphan.cpp', 'int main() { return 0; }\n');
    write(dir, 'src/router/claimed.cpp', 'int claimed() { return 1; }\n');
    writeFileSync(join(dir, 'spec.yaml'), inlineSpec('cpp', ['router'], ['src/router/claimed.cpp']));
    const findings = unmappedArtifact.run({cwd: dir});
    expect(findings.map((f) => f.path)).toEqual(['src/router/orphan.cpp']);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('not claimed by any feature');
  });

  test('AC-9a6f02d3 — a nested source root inferred from a claim reaches its unclaimed neighbour', () => {
    write(dir, 'src/main/kotlin/core/Claimed.kt', 'fun claimed() {}\n');
    write(dir, 'src/main/kotlin/core/Orphan.kt', 'fun orphan() {}\n');
    writeFileSync(
      join(dir, 'spec.yaml'),
      inlineSpec('kotlin', ['core'], ['src/main/kotlin/core/Claimed.kt']),
    );
    const findings = unmappedArtifact.run({cwd: dir});
    expect(findings.map((f) => f.path)).toEqual(['src/main/kotlin/core/Orphan.kt']);
  });
});
