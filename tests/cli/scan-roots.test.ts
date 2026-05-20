// Cladding · unit tests for cli/scan-roots.ts (v0.3.25, F-x)
//
// Source-root inference order: cli-override → manifest hints → directory heuristics → empty.
// Each branch is exercised against a synthetic project tree under tmpdir.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {inferSourceRoots} from '../../src/cli/scan-roots.js';

function seed(dir: string, layout: Record<string, string>): void {
  for (const [path, content] of Object.entries(layout)) {
    const abs = join(dir, path);
    mkdirSync(join(abs, '..'), {recursive: true});
    writeFileSync(abs, content);
  }
}

describe('inferSourceRoots', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-roots-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('empty project returns no roots', () => {
    expect(inferSourceRoots({cwd: dir})).toEqual([]);
  });

  // --- CLI override -------------------------------------------------

  test('cli override wins over manifests + heuristics', () => {
    seed(dir, {
      'src/a.ts': '',
      'custom/x.ts': '',
      'package.json': JSON.stringify({workspaces: ['packages/*']}),
    });
    const roots = inferSourceRoots({cwd: dir, override: ['custom']});
    expect(roots).toHaveLength(1);
    expect(roots[0].relPath).toBe('custom');
    expect(roots[0].source).toBe('cli-override');
  });

  test('cli override skips paths that do not exist', () => {
    seed(dir, {'src/a.ts': ''});
    const roots = inferSourceRoots({cwd: dir, override: ['missing']});
    expect(roots).toEqual([]);
  });

  // --- Manifest hints ----------------------------------------------

  test('package.json workspaces (array) discovers packages/<name>/src/', () => {
    seed(dir, {
      'package.json': JSON.stringify({workspaces: ['packages/*']}),
      'packages/a/src/x.ts': '',
      'packages/b/src/y.ts': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    const relPaths = roots.map((r) => r.relPath).sort();
    expect(relPaths).toEqual(['packages/a/src', 'packages/b/src']);
    expect(roots[0].workspaceName).toBe('a');
    expect(roots[0].source).toBe('manifest');
  });

  test('package.json workspaces (object) reads packages.packages field', () => {
    seed(dir, {
      'package.json': JSON.stringify({workspaces: {packages: ['apps/*']}}),
      'apps/web/src/main.ts': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    expect(roots).toHaveLength(1);
    expect(roots[0].relPath).toBe('apps/web/src');
    expect(roots[0].workspaceName).toBe('web');
  });

  test('pyproject.toml packages list maps to source roots', () => {
    seed(dir, {
      'pyproject.toml': '[tool.poetry]\nname = "x"\npackages = [{include = "mylib"}]\n',
      'mylib/__init__.py': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    expect(roots.some((r) => r.relPath === 'mylib')).toBe(true);
  });

  test('Cargo.toml [workspace] members map crate src dirs', () => {
    seed(dir, {
      'Cargo.toml': '[workspace]\nmembers = ["crates/parser", "crates/runtime"]\n',
      'crates/parser/src/lib.rs': '',
      'crates/runtime/src/lib.rs': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    const relPaths = roots.map((r) => r.relPath).sort();
    expect(relPaths).toEqual(['crates/parser/src', 'crates/runtime/src']);
    expect(roots[0].workspaceName).toBe('parser');
  });

  test('single-crate Cargo project falls back to src/', () => {
    seed(dir, {
      'Cargo.toml': '[package]\nname = "x"\n',
      'src/lib.rs': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    expect(roots).toHaveLength(1);
    expect(roots[0].relPath).toBe('src');
  });

  test('go.mod surfaces cmd/ internal/ pkg/ when present', () => {
    seed(dir, {
      'go.mod': 'module example.com/x\n',
      'cmd/main.go': '',
      'internal/foo.go': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    const relPaths = roots.map((r) => r.relPath).sort();
    expect(relPaths).toContain('cmd');
    expect(relPaths).toContain('internal');
    expect(relPaths).not.toContain('pkg');
  });

  // --- Heuristic fallback ------------------------------------------

  test('heuristic flat: bare src/ directory becomes a root', () => {
    seed(dir, {'src/a.ts': ''});
    const roots = inferSourceRoots({cwd: dir});
    expect(roots).toHaveLength(1);
    expect(roots[0].relPath).toBe('src');
    expect(roots[0].source).toBe('heuristic');
  });

  test('heuristic nested: packages/* expanded even without package.json', () => {
    seed(dir, {
      'packages/a/src/x.ts': '',
      'packages/b/src/y.ts': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    const names = roots.map((r) => r.workspaceName).sort();
    expect(names).toEqual(['a', 'b']);
  });

  test('heuristic strips hidden directories', () => {
    seed(dir, {
      'packages/.hidden/x.ts': '',
      'packages/visible/src/y.ts': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    expect(roots.map((r) => r.workspaceName)).toEqual(['visible']);
  });

  test('deduplicates roots discovered through multiple paths', () => {
    seed(dir, {
      'package.json': JSON.stringify({workspaces: ['packages/*']}),
      'packages/a/src/x.ts': '',
    });
    const roots = inferSourceRoots({cwd: dir});
    const paths = roots.map((r) => r.absPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
