// Cladding · conformance tests for scan-layer-glob-source-root (F-77a90ac6)
//
// Contract (spec/features/scan-layer-glob-source-root-77a90ac6.yaml):
//   AC-001 — a subdirectory layer's `dir` (and the emitted
//     `modules: ["<dir>/**"]` glob) carries the full cwd-relative path
//     (`<root.relPath>/<segment>`, e.g. `src/api`), so the glob matches the
//     layer's real files — not the bare segment (`api/**`, which matched none).
//   AC-002 — a flat project whose files sit directly in the source root (or
//     cwd) emits NO architecture layer: the `_root`->basename(cwd) promotion
//     no longer surfaces a bogus layer named after the project directory.
//   AC-003 — workspace/monorepo layer NAMES stay unchanged (`react`, `a`,
//     `a:core`) while each glob gains its correct full source-root path.
//
// The reproduction that motivated this (bare `layers:` + `<basename>/**`
// globs matching zero files, on npm cladding@0.8.1 AND HEAD) is recorded in
// scratchpad/uxlang/initbug-repro.md and externally re-verified against the
// published npm engine under /private/tmp/clad-initbug-repro.
//
// Sibling feature F-284be4f6 (init-empty-layers-valid-yaml) owns the
// empty-array RENDER contract (`layers: []`); this suite owns the layer
// GLOB/NAME derivation upstream in extractArchitecture, so each feature keeps
// a 1:1 spec-to-suite mapping even though both touch src/cli/scan.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {scanRoot} from '../../src/cli/scan/index.js';
import {resolveLayerDir} from '../../src/cli/scan/architecture.js';
import {deterministicInterpret} from '../../src/cli/scan/llm.js';
import type {SourceRoot} from '../../src/cli/scan/types.js';
import {loadSpec} from '../../src/spec/load.js';

function seed(dir: string, layout: Record<string, string>): void {
  for (const [path, content] of Object.entries(layout)) {
    const abs = join(dir, path);
    mkdirSync(join(abs, '..'), {recursive: true});
    writeFileSync(abs, content);
  }
}

/** Extract the `modules: [...]` line for a given layer name from a rendered
 * architecture.yaml body (via the same deterministic path clad init uses). */
function moduleGlobOf(architectureYaml: string, layerName: string): string | undefined {
  const lines = architectureYaml.split('\n');
  const idx = lines.findIndex((l) => l.trim() === `- name: ${layerName}`);
  if (idx === -1) return undefined;
  const modLine = lines.slice(idx + 1).find((l) => l.trim().startsWith('modules:'));
  return modLine?.trim();
}

describe('scan-layer-glob-source-root (F-77a90ac6)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-glob-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  describe('AC-001 — subdir layer globs carry the source-root prefix', () => {
    test('src/api + src/db layers get dir src/api, src/db (not api, db)', () => {
      seed(dir, {
        'package.json': '{"name":"x","version":"1.0.0","private":true}',
        'src/api/handler.ts': 'export const h = () => 1;\n',
        'src/api/routes.ts': 'export const r = () => 2;\n',
        'src/db/client.ts': 'export const c = () => 3;\n',
      });
      const layers = scanRoot({cwd: dir}).architecture.layers;
      const byName = Object.fromEntries(layers.map((l) => [l.name, l.dir]));
      expect(byName).toEqual({api: 'src/api', db: 'src/db'});
    });

    test('the rendered architecture.yaml emits modules: ["src/api/**"], not ["api/**"]', () => {
      seed(dir, {
        'package.json': '{"name":"x","version":"1.0.0","private":true}',
        'src/api/handler.ts': 'export const h = () => 1;\n',
        'src/api/routes.ts': 'export const r = () => 2;\n',
        'src/db/client.ts': 'export const c = () => 3;\n',
      });
      const {architectureYaml} = deterministicInterpret(scanRoot({cwd: dir}));
      expect(moduleGlobOf(architectureYaml, 'api')).toBe('modules: ["src/api/**"]');
      expect(moduleGlobOf(architectureYaml, 'db')).toBe('modules: ["src/db/**"]');
      // The pre-fix, zero-matching form must not reappear.
      expect(architectureYaml).not.toContain('modules: ["api/**"]');
      expect(architectureYaml).not.toContain('modules: ["db/**"]');
    });

    test('strongest: the rendered glob actually matches the layer files under src/', () => {
      seed(dir, {
        'package.json': '{"name":"x","version":"1.0.0","private":true}',
        'src/api/handler.ts': 'export const h = () => 1;\n',
        'src/api/nested/deep.ts': 'export const d = () => 2;\n',
        'src/db/client.ts': 'export const c = () => 3;\n',
      });
      const apiLayer = scanRoot({cwd: dir}).architecture.layers.find((l) => l.name === 'api');
      // A `<dir>/**` glob rooted at the project dir must contain the real file
      // paths. This is the behavioral crux: `api/**` never matched
      // `src/api/handler.ts`; `src/api/**` does.
      expect(apiLayer?.dir).toBe('src/api');
      expect('src/api/handler.ts'.startsWith(`${apiLayer?.dir}/`)).toBe(true);
      expect('src/api/nested/deep.ts'.startsWith(`${apiLayer?.dir}/`)).toBe(true);
    });
  });

  describe('AC-002 — flat roots emit no bogus cwd-named layer', () => {
    test('flat cwd-direct files (>=5) produce no layer (layers: [])', () => {
      seed(dir, {
        'a.go': 'package cobra\n',
        'b.go': 'package cobra\n',
        'c.go': 'package cobra\n',
        'd.go': 'package cobra\n',
        'e.go': 'package cobra\n',
        'f.go': 'package cobra\n',
      });
      expect(scanRoot({cwd: dir}).architecture.layers).toEqual([]);
    });

    test('flat files directly in src/ (>=5, no subdir) produce no layer', () => {
      seed(dir, {
        'package.json': '{"name":"x","version":"1.0.0","private":true}',
        'src/a.ts': 'export const a = 1;\n',
        'src/b.ts': 'export const b = 2;\n',
        'src/c.ts': 'export const c = 3;\n',
        'src/d.ts': 'export const d = 4;\n',
        'src/e.ts': 'export const e = 5;\n',
      });
      const {architecture} = scanRoot({cwd: dir});
      expect(architecture.layers).toEqual([]);
    });

    test('the flat-root architecture.yaml renders schema-valid and loads (layers: [])', () => {
      seed(dir, {
        'package.json': '{"name":"x","version":"1.0.0","private":true}',
        'src/a.ts': 'export const a = 1;\n',
        'src/b.ts': 'export const b = 2;\n',
        'src/c.ts': 'export const c = 3;\n',
        'src/d.ts': 'export const d = 4;\n',
        'src/e.ts': 'export const e = 5;\n',
      });
      const {architectureYaml} = deterministicInterpret(scanRoot({cwd: dir}));
      expect(architectureYaml).toContain('layers: []');
      // no leaked project-dir-named layer glob
      expect(architectureYaml).not.toMatch(/modules: \["[^/]+\/\*\*"\]/);
      const parsed = parseYaml(architectureYaml) as {layers: unknown};
      expect(parsed.layers).toEqual([]);
    });
  });

  describe('AC-003 — workspace/monorepo names unchanged, globs corrected', () => {
    test('workspace-direct layers keep names but get full-path globs', () => {
      seed(dir, {
        'package.json': JSON.stringify({workspaces: ['packages/*']}),
        'packages/react/src/ReactAct.ts': 'export const x = 1;\n',
        'packages/react/src/ReactBaseClasses.ts': 'export const y = 2;\n',
        'packages/scheduler/src/Scheduler.ts': 'export const s = 3;\n',
      });
      const layers = scanRoot({cwd: dir}).architecture.layers;
      expect(layers.map((l) => l.name).sort()).toEqual(['react', 'scheduler']);
      const byName = Object.fromEntries(layers.map((l) => [l.name, l.dir]));
      expect(byName.react).toBe('packages/react/src');
      expect(byName.scheduler).toBe('packages/scheduler/src');
    });

    test('mixed direct + nested monorepo layers: names a/a:core, correct globs', () => {
      seed(dir, {
        'package.json': JSON.stringify({workspaces: ['packages/*']}),
        'packages/a/src/index.ts': 'export const x = 1;\n',
        'packages/a/src/core/inner.ts': 'export const y = 2;\n',
      });
      const layers = scanRoot({cwd: dir}).architecture.layers;
      expect(layers.map((l) => l.name).sort()).toEqual(['a', 'a:core']);
      const byName = Object.fromEntries(layers.map((l) => [l.name, l.dir]));
      expect(byName.a).toBe('packages/a/src');
      expect(byName['a:core']).toBe('packages/a/src/core');
    });
  });

  describe('resolveLayerDir unit — the source-root prefix reconstruction', () => {
    const roots: SourceRoot[] = [{absPath: '/x/src', relPath: 'src', source: 'heuristic'}];
    const monorepo: SourceRoot[] = [
      {absPath: '/x/packages/a/src', relPath: 'packages/a/src', workspaceName: 'a', source: 'manifest'},
    ];

    test('subdir file → root/segment', () => {
      expect(resolveLayerDir('src/api/foo.ts', roots)).toBe('src/api');
      expect(resolveLayerDir('src/api/nested/deep.ts', roots)).toBe('src/api');
    });
    test('direct-in-root file → the root itself', () => {
      expect(resolveLayerDir('src/index.ts', roots)).toBe('src');
    });
    test('monorepo subdir → full package path', () => {
      expect(resolveLayerDir('packages/a/src/core/inner.ts', monorepo)).toBe('packages/a/src/core');
    });
    test('no matching root → top-level directory', () => {
      expect(resolveLayerDir('top/mod.ts', [])).toBe('top');
    });
  });

  describe('end-to-end — corrected layers load through the real assembled spec', () => {
    test('a scanned src/api+src/db architecture.yaml loads and preserves layers', () => {
      seed(dir, {
        'package.json': '{"name":"x","version":"1.0.0","private":true}',
        'src/api/handler.ts': 'export const h = () => 1;\n',
        'src/api/routes.ts': 'export const r = () => 2;\n',
        'src/db/client.ts': 'export const c = () => 3;\n',
      });
      const sp0 = mkdtempSync(join(tmpdir(), 'clad-glob-spec-'));
      try {
        const {architectureYaml} = deterministicInterpret(scanRoot({cwd: dir}));
        writeFileSync(
          join(sp0, 'spec.yaml'),
          'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n',
        );
        mkdirSync(join(sp0, 'spec'), {recursive: true});
        writeFileSync(join(sp0, 'spec', 'architecture.yaml'), architectureYaml);
        let spec: ReturnType<typeof loadSpec> | undefined;
        expect(() => {
          spec = loadSpec(sp0);
        }).not.toThrow();
        expect(spec?.architecture?.layers).toHaveLength(2);
      } finally {
        rmSync(sp0, {recursive: true, force: true});
      }
    });
  });
});
