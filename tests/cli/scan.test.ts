// Cladding · unit tests for cli/scan.ts (v0.3.24, F-x)
//
// Deterministic 14-convention extractor. Each branch is exercised on
// a synthetic source tree under tmpdir, then asserted against the
// recorded heuristic (majority rule for most signals).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {scanRoot} from '../../src/cli/scan.js';

function seed(dir: string, layout: Record<string, string>): void {
  for (const [path, content] of Object.entries(layout)) {
    const abs = join(dir, path);
    mkdirSync(join(abs, '..'), {recursive: true});
    writeFileSync(abs, content);
  }
}

describe('scanRoot', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-scan-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('returns empty result when no source files exist', () => {
    const r = scanRoot({cwd: dir});
    expect(r.stats.filesScanned).toBe(0);
    expect(r.architecture.layers).toEqual([]);
    expect(r.scenarios).toEqual([]);
  });

  test('detects two-space indent majority', () => {
    seed(dir, {
      'src/a/x.ts': 'export const x = 1;\nfunction y() {\n  return 2;\n}\n',
      'src/a/y.ts': 'function z() {\n  return 3;\n}\n',
    });
    expect(scanRoot({cwd: dir}).conventions.indent).toBe('two-space');
  });

  test('detects four-space indent majority', () => {
    seed(dir, {
      'src/a/x.ts': 'function y() {\n    return 1;\n}\n'.repeat(10),
    });
    expect(scanRoot({cwd: dir}).conventions.indent).toBe('four-space');
  });

  test('detects single-quote dominance', () => {
    seed(dir, {
      'src/a/x.ts': "const x = 'a'; const y = 'b'; const z = 'c';\n",
    });
    expect(scanRoot({cwd: dir}).conventions.quote).toBe('single');
  });

  test('detects camelCase exports', () => {
    seed(dir, {
      'src/a/x.ts': 'export const fooBar = 1;\nexport function bazQux() {}\n',
    });
    expect(scanRoot({cwd: dir}).conventions.namingExports).toBe('camelCase');
  });

  test('detects named-only export pattern', () => {
    seed(dir, {
      'src/a/x.ts': 'export const a = 1;\nexport function b() {}\nexport interface C {}\n',
    });
    expect(scanRoot({cwd: dir}).conventions.exportPattern).toBe('named-only');
  });

  test('detects default-primary when default outnumbers named', () => {
    seed(dir, {
      'src/a/x.ts': 'export default function x() {}\n',
      'src/a/y.ts': 'export default 42;\n',
    });
    expect(scanRoot({cwd: dir}).conventions.exportPattern).toBe('default-primary');
  });

  test('detects throw-primary error handling', () => {
    seed(dir, {
      'src/a/x.ts': "throw new Error('a'); throw new Error('b'); throw new Error('c');\n",
    });
    expect(scanRoot({cwd: dir}).conventions.errorHandling).toBe('throw-primary');
  });

  test('detects UPPER_SNAKE constants', () => {
    seed(dir, {
      'src/a/x.ts': 'export const DEFAULT_TIMEOUT = 5000;\nexport const MAX_RETRIES = 3;\n',
    });
    expect(scanRoot({cwd: dir}).conventions.namingConstants).toBe('UPPER_SNAKE');
  });

  test('detects tests-dir test location', () => {
    seed(dir, {
      'src/a/x.ts': 'export const a = 1;\n',
      'tests/x.test.ts': "import {a} from '../src/a/x.js';\n",
    });
    expect(scanRoot({cwd: dir}).conventions.testLocation).toBe('tests-dir');
  });

  test('layers reflect top-level src/ directories', () => {
    seed(dir, {
      'src/core/a.ts': 'export const a = 1;\n',
      'src/cli/b.ts': 'export const b = 2;\n',
      'src/ui/c.ts': 'export const c = 3;\n',
    });
    const r = scanRoot({cwd: dir});
    const names = r.architecture.layers.map((l) => l.name);
    expect(names).toContain('core');
    expect(names).toContain('cli');
    expect(names).toContain('ui');
  });

  test('scenarios mirror layers', () => {
    seed(dir, {
      'src/core/a.ts': 'export const a = 1;\n',
      'src/cli/b.ts': 'export const b = 2;\n',
    });
    const slugs = scanRoot({cwd: dir}).scenarios.map((s) => s.slug);
    expect(slugs).toContain('core-flow');
    expect(slugs).toContain('cli-flow');
  });

  test('examples pick the longest non-test module per layer', () => {
    seed(dir, {
      'src/core/short.ts': 'export const s = 1;\n',
      'src/core/long.ts': 'export const l = 1;\n' + '// line\n'.repeat(40),
      'src/core/long.test.ts': "import {l} from './long.js';\nl;\n",
    });
    const examples = scanRoot({cwd: dir}).examples;
    const core = examples.find((e) => e.layer === 'core');
    expect(core?.modulePath).toContain('long.ts');
    expect(core?.testPath).toContain('long.test.ts');
  });

  test('import graph edges count cross-layer imports', () => {
    seed(dir, {
      'src/cli/x.ts': "import {a} from '../core/a.js';\nimport {b} from '../core/b.js';\nexport const x = a + b;\n",
      'src/core/a.ts': 'export const a = 1;\n',
      'src/core/b.ts': 'export const b = 2;\n',
    });
    const edges = scanRoot({cwd: dir}).architecture.importGraph;
    const cliToCore = edges.find((e) => e.from === 'cli' && e.to === 'core');
    expect(cliToCore?.count).toBe(2);
  });

  test('docblock ratio + tag counts read TSDoc usage', () => {
    seed(dir, {
      'src/a/x.ts':
        '/**\n * does x\n * @param a foo\n * @returns bar\n */\nexport function x(a: number) {\n  return a;\n}\n',
    });
    const c = scanRoot({cwd: dir}).conventions;
    expect(c.docBlockRatio).toBeGreaterThan(0);
    expect(c.docTagCounts['@param']).toBe(1);
    expect(c.docTagCounts['@returns']).toBe(1);
  });

  test('respects ignore list', () => {
    seed(dir, {
      'src/core/a.ts': 'export const a = 1;\n',
      'node_modules/pkg/index.ts': 'export default 1;\n',
    });
    const r = scanRoot({cwd: dir});
    expect(r.architecture.layers.map((l) => l.name)).not.toContain('pkg');
  });

  // v0.3.25 (F-x) — source root inference: layerOf must collapse
  // src/<layer>/ across flat projects, monorepo workspaces, and CLI
  // overrides without losing the workspace prefix on monorepo layers.
  describe('source root inference (v0.3.25)', () => {
    test('monorepo packages/<ws>/src/<layer> produces <ws>:<layer> labels', () => {
      seed(dir, {
        'package.json': JSON.stringify({workspaces: ['packages/*']}),
        'packages/a/src/core/x.ts': 'export const x = 1;\n',
        'packages/a/src/cli/y.ts': 'export const y = 2;\n',
        'packages/b/src/core/z.ts': 'export const z = 3;\n',
      });
      const r = scanRoot({cwd: dir});
      const names = r.architecture.layers.map((l) => l.name).sort();
      expect(names).toEqual(['a:cli', 'a:core', 'b:core']);
    });

    test('--roots override forces a specific layer set', () => {
      seed(dir, {
        'src/core/x.ts': 'export const x = 1;\n',
        'custom/widget/y.ts': 'export const y = 2;\n',
      });
      const r = scanRoot({cwd: dir, roots: ['custom']});
      const names = r.architecture.layers.map((l) => l.name);
      expect(names).toContain('widget');
    });

    test('flat src/ project still maps src/<layer> to <layer> (no regression)', () => {
      seed(dir, {
        'src/core/a.ts': 'export const a = 1;\n',
        'src/cli/b.ts': 'export const b = 2;\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name).sort();
      expect(names).toEqual(['cli', 'core']);
    });
  });

  // v0.3.25 (F-x) — forbidden_imports candidates. The architecture
  // extractor records every layer pair the import graph never
  // exercised; the candidate set surfaces in architecture.yaml as a
  // reviewer-pruned suggestion list.
  describe('forbidden_imports candidates (v0.3.25)', () => {
    test('layer pairs without observed edges become forbidden candidates', () => {
      seed(dir, {
        'src/cli/x.ts': "import {a} from '../core/a.js';\nexport const x = a;\n",
        'src/core/a.ts': 'export const a = 1;\n',
        'src/ui/u.ts': 'export const u = 2;\n',
      });
      const arch = scanRoot({cwd: dir}).architecture;
      // cli to core observed → not a candidate. Every other pair
      // is unobserved → cli to ui, ui to cli, core to cli, core to ui,
      // ui to core all candidates.
      expect(arch.forbiddenImportCandidates['cli']).toEqual(['ui']);
      expect((arch.forbiddenImportCandidates['core'] ?? []).slice().sort()).toEqual(['cli', 'ui']);
    });

    test('all-to-all observed graph leaves no candidates', () => {
      seed(dir, {
        'src/a/x.ts': "import {b} from '../b/b.js';\nexport const x = b;\n",
        'src/b/b.ts': "import {a} from '../a/x.js';\nexport const b = a;\n",
      });
      const arch = scanRoot({cwd: dir}).architecture;
      expect(arch.forbiddenImportCandidates).toEqual({});
    });
  });
});
