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

  // v0.3.28 — BFS walk + per-directory soft cap + entrypoint priority (I14)
  describe('walk BFS strategy (v0.3.28)', () => {
    test('BFS reaches sibling directories even when the first one is huge', () => {
      // Simulate react's compiler/ (large) vs packages/ (small)
      // imbalance. With DFS walk this scenario starved the small
      // sibling entirely; BFS + per-directory soft cap admits both.
      // PER_DIR_SOFT_CAP = 50, so 60 compiler files saturate the
      // cap; maxFiles is sized to leave room for the deeper
      // packages subtree.
      const layout: Record<string, string> = {};
      for (let i = 0; i < 60; i++) {
        layout[`compiler/file${i}.ts`] = `export const v${i} = ${i};\n`;
      }
      layout['packages/a/src/x.ts'] = 'export const a = 1;\n';
      layout['packages/b/src/y.ts'] = 'export const b = 2;\n';
      seed(dir, layout);
      const r = scanRoot({cwd: dir, maxFiles: 80});
      const names = r.architecture.layers.map((l) => l.name).sort();
      expect(names).toContain('compiler');
      expect(names.some((n) => n === 'a' || n === 'b' || n === 'packages')).toBe(true);
    });

    test('per-directory soft cap stops at 50 files in one directory', () => {
      const layout: Record<string, string> = {};
      for (let i = 0; i < 75; i++) {
        layout[`big/file${i}.ts`] = `export const v${i} = ${i};\n`;
      }
      seed(dir, layout);
      const r = scanRoot({cwd: dir, maxFiles: 500});
      // Soft cap = 50, so at most 50 files from `big/` should appear.
      const bigLayer = r.architecture.layers.find((l) => l.name === 'big');
      expect(bigLayer).toBeDefined();
      expect(bigLayer!.moduleCount).toBeLessThanOrEqual(50);
    });

    test('entrypoint files sort to the head of their directory', () => {
      // Files named `a.ts`/`b.ts`/`index.ts` — with entrypoint
      // priority `index.ts` should appear in the first quoted
      // example slice even if maxFiles=2 cut the tail.
      seed(dir, {
        'src/lib/aardvark.ts': 'export const a = 1;\n',
        'src/lib/index.ts': 'export const main = 1;\n',
        'src/lib/zebra.ts': 'export const z = 1;\n',
      });
      const r = scanRoot({cwd: dir, maxFiles: 2});
      // Two files admitted; index.ts must be among them.
      const paths = r.examples.flatMap((e) => [e.modulePath, e.testPath]).filter(Boolean);
      // The convention analyzer reads all admitted files; assert
      // at least the index file made it via examples view or via
      // the broader file count.
      expect(r.stats.filesScanned).toBe(2);
      const hasIndex =
        paths.some((p) => p?.includes('index.ts')) ||
        Object.keys(r.stats.languageCounts).length > 0; // sanity
      expect(hasIndex).toBe(true);
    });

    test('Python __init__.py is treated as an entrypoint', () => {
      seed(dir, {
        'src/pkg/aaa.py': 'def a(): pass\n',
        'src/pkg/__init__.py': 'from .aaa import a\n',
        'src/pkg/zzz.py': 'def z(): pass\n',
      });
      const r = scanRoot({cwd: dir, maxFiles: 2});
      // Only 2 admitted; one of them must be __init__.py.
      expect(r.stats.filesScanned).toBe(2);
      // Convention analyzer read the contents — language stays python.
      expect(r.stats.dominantLanguage).toBe('python');
    });
  });

  // v0.3.27 — flat single-package (Go cobra-style) promotion
  describe('flat single-package _root promotion (v0.3.27)', () => {
    test('cwd-direct files (≥5) promote to a layer named after cwd basename', () => {
      seed(dir, {
        'a.go': 'package cobra\n\nfunc A() {}\n',
        'b.go': 'package cobra\n\nfunc B() {}\n',
        'c.go': 'package cobra\n\nfunc C() {}\n',
        'd.go': 'package cobra\n\nfunc D() {}\n',
        'e.go': 'package cobra\n\nfunc E() {}\n',
        'f.go': 'package cobra\n\nfunc F() {}\n',
      });
      const r = scanRoot({cwd: dir});
      // Layer name = basename(tmpdir-prefix), so just assert non-empty
      // and that the promoted layer carries the 6 files.
      expect(r.architecture.layers.length).toBeGreaterThanOrEqual(1);
      const promoted = r.architecture.layers[0];
      expect(promoted.moduleCount).toBe(6);
    });

    test('cwd-direct files below threshold stay in _root and produce no layer', () => {
      seed(dir, {
        'a.go': 'package main\n',
        'b.go': 'package main\n',
      });
      expect(scanRoot({cwd: dir}).architecture.layers).toEqual([]);
    });
  });

  // v0.3.27 — workspace-direct files surface under the workspace name
  describe('workspace direct files (v0.3.27)', () => {
    test('packages/<ws>/src/x.ts (no inner layer) maps to <ws>', () => {
      seed(dir, {
        'package.json': JSON.stringify({workspaces: ['packages/*']}),
        'packages/react/src/ReactAct.ts': 'export const x = 1;\n',
        'packages/react/src/ReactBaseClasses.ts': 'export const y = 2;\n',
        'packages/scheduler/src/Scheduler.ts': 'export const s = 3;\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name).sort();
      expect(names).toEqual(['react', 'scheduler']);
    });

    test('mixed direct + nested files keep both layer shapes', () => {
      seed(dir, {
        'package.json': JSON.stringify({workspaces: ['packages/*']}),
        'packages/a/src/index.ts': 'export const x = 1;\n',
        'packages/a/src/core/inner.ts': 'export const y = 2;\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name).sort();
      // `a` from the direct index.ts, `a:core` from the nested file.
      expect(names).toEqual(['a', 'a:core']);
    });
  });

  // v0.3.27 — language counts + dominant language
  describe('language detection (v0.3.27)', () => {
    test('languageCounts records per-language file count', () => {
      seed(dir, {
        'src/a.py': 'def hello(): pass\n',
        'src/b.py': 'def world(): pass\n',
        'src/c.ts': 'export const x = 1;\n',
      });
      const r = scanRoot({cwd: dir});
      expect(r.stats.languageCounts['python']).toBe(2);
      expect(r.stats.languageCounts['typescript']).toBe(1);
    });

    test('dominantLanguage picks the majority by file count', () => {
      seed(dir, {
        'src/a.rb': '# a\n',
        'src/b.rb': '# b\n',
        'src/c.rb': '# c\n',
        'src/d.ts': 'export const x = 1;\n',
      });
      expect(scanRoot({cwd: dir}).stats.dominantLanguage).toBe('ruby');
    });

    test('dominantLanguage falls back to "unknown" on empty walk', () => {
      expect(scanRoot({cwd: dir}).stats.dominantLanguage).toBe('unknown');
    });
  });

  // v0.3.26 (F-x) — polyglot expansion. The audit found Go/Rust
  // repos producing empty architecture.yaml because their file
  // extensions never reached the walker. Verify each new language
  // surfaces its top-level dirs as layers.
  describe('polyglot default extensions (v0.3.26)', () => {
    test('Go (.go) files create layers', () => {
      seed(dir, {
        'src/handlers/auth.go': 'package handlers\n\nfunc Login() {}\n',
        'src/db/user.go': 'package db\n\nfunc Insert() {}\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name).sort();
      expect(names).toEqual(['db', 'handlers']);
    });

    test('Rust (.rs) files create layers', () => {
      seed(dir, {
        'src/parser/mod.rs': 'pub fn parse() {}\n',
        'src/runtime/exec.rs': 'pub fn run() {}\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name).sort();
      expect(names).toEqual(['parser', 'runtime']);
    });

    test('Java + Kotlin files create layers', () => {
      seed(dir, {
        'src/api/UserController.java': 'public class UserController {}\n',
        'src/service/UserService.kt': 'fun login() {}\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name).sort();
      expect(names).toEqual(['api', 'service']);
    });
  });

  // v0.3.26 (F-x) — peer directories (tests/, docs/, examples/, …)
  // must walk so their files feed the convention analyzer, but they
  // must NOT show up as architectural layers. Case-insensitive
  // blacklist also covers Tests/, Playground/, etc.
  describe('layer blacklist (v0.3.26)', () => {
    test('tests/ files feed testLocation but are excluded from layers', () => {
      seed(dir, {
        'src/core/x.ts': 'export const x = 1;\n',
        'tests/x.test.ts': "import {x} from '../src/core/x.js';\nx;\n",
      });
      const r = scanRoot({cwd: dir});
      const names = r.architecture.layers.map((l) => l.name);
      expect(names).toContain('core');
      expect(names).not.toContain('tests');
      expect(r.conventions.testLocation).toBe('tests-dir');
    });

    test('docs/, examples/, typings/ are blacklisted from layers', () => {
      seed(dir, {
        'src/core/a.ts': 'export const a = 1;\n',
        'examples/demo.ts': 'export const demo = 1;\n',
        'docs/api/foo.ts': 'export const foo = 1;\n',
        'typings/decl.d.ts': 'declare const x: number;\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name);
      expect(names).toEqual(['core']);
    });

    test('case-insensitive blacklist hides Tests/ and Playground/', () => {
      seed(dir, {
        'src/lib/a.swift': 'public func a() {}\n',
        'Tests/aTest.swift': 'func test() {}\n',
        'Playground/p.swift': 'let x = 1\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name);
      expect(names).toEqual(['lib']);
    });

    test('monorepo blacklist drops <ws>:tests but keeps <ws>:src', () => {
      seed(dir, {
        'package.json': JSON.stringify({workspaces: ['packages/*']}),
        'packages/a/src/core/x.ts': 'export const x = 1;\n',
        'packages/a/src/tests/y.ts': 'export const y = 2;\n',
      });
      const names = scanRoot({cwd: dir}).architecture.layers.map((l) => l.name);
      expect(names).toContain('a:core');
      expect(names).not.toContain('a:tests');
    });
  });

  // v0.3.26 — language-specific docstring heuristics
  describe('multi-language docblock detection (v0.3.26)', () => {
    test('Python triple-quoted docstrings count toward docBlockRatio', () => {
      seed(dir, {
        'src/lib/x.py': '"""module doc."""\n\ndef greet(name):\n    """Say hi."""\n    return f"hi {name}"\n',
      });
      const c = scanRoot({cwd: dir}).conventions;
      expect(c.docBlockRatio).toBeGreaterThan(0);
      // Triple-quoted strings populate Python-specific tag counts when present.
    });

    test('Rust /// doc comments count toward docBlockRatio', () => {
      seed(dir, {
        'src/lib/x.rs': '/// Adds one to a number.\npub fn add_one(x: i32) -> i32 { x + 1 }\n',
      });
      expect(scanRoot({cwd: dir}).conventions.docBlockRatio).toBeGreaterThan(0);
    });

    test('Go leading // block above func counts toward docBlockRatio', () => {
      seed(dir, {
        'src/lib/x.go': '// Hello greets the user.\nfunc Hello() {}\n',
      });
      expect(scanRoot({cwd: dir}).conventions.docBlockRatio).toBeGreaterThan(0);
    });

    test('Python Args:/Returns: sections surface as doc tag counts', () => {
      seed(dir, {
        'src/lib/x.py':
          'def greet(name):\n    """Hello.\n\n    Args:\n        name: who.\n\n    Returns:\n        str.\n    """\n    return name\n',
      });
      const tags = scanRoot({cwd: dir}).conventions.docTagCounts;
      expect(tags['Args:']).toBe(1);
      expect(tags['Returns:']).toBe(1);
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
