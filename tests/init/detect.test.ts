// Cladding · unit tests for src/init/detect.ts (F-90d054)
//
// Validates the deterministic context detection that populates
// `spec.yaml._meta.detected`. Used by AC-011 to give host AI a ground truth
// (rather than letting it invent project metadata).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {detectContext} from '../../src/init/detect.js';

function touch(dir: string, rel: string, body = ''): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), {recursive: true});
  writeFileSync(abs, body);
}

describe('detectContext (F-90d054)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-detect-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('empty directory → greenfield', () => {
    const ctx = detectContext(dir);
    expect(ctx.project_type).toBe('greenfield');
    expect(ctx.source_files).toBe(0);
    expect(ctx.test_files).toBe(0);
    expect(ctx.observed_layers).toEqual([]);
    expect(ctx.detected_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('three TS source files → brownfield', () => {
    touch(dir, 'src/api/router.ts');
    touch(dir, 'src/api/handlers.ts');
    touch(dir, 'src/db/users.ts');
    const ctx = detectContext(dir);
    expect(ctx.project_type).toBe('brownfield');
    expect(ctx.source_files).toBe(3);
    expect(ctx.primary_language).toBe('typescript');
    expect(ctx.observed_layers).toEqual(['src/api', 'src/db']);
  });

  test('detects test files separately from source files', () => {
    touch(dir, 'src/api/router.ts');
    touch(dir, 'src/api/handlers.ts');
    touch(dir, 'tests/router.test.ts');
    touch(dir, 'tests/handlers.spec.ts');
    const ctx = detectContext(dir);
    expect(ctx.source_files).toBe(2);
    expect(ctx.test_files).toBe(2);
    expect(ctx.has_existing_tests).toBe(true);
  });

  test('detects package manager — npm', () => {
    touch(dir, 'package.json', '{"name":"x"}');
    touch(dir, 'package-lock.json', '{}');
    expect(detectContext(dir).package_manager).toBe('npm');
  });

  test('detects package manager — pnpm', () => {
    touch(dir, 'package.json', '{"name":"x"}');
    touch(dir, 'pnpm-lock.yaml', '');
    expect(detectContext(dir).package_manager).toBe('pnpm');
  });

  test('detects package manager — cargo', () => {
    touch(dir, 'Cargo.toml', '');
    touch(dir, 'src/main.rs');
    expect(detectContext(dir).package_manager).toBe('cargo');
  });

  test('flags README presence', () => {
    expect(detectContext(dir).has_readme).toBe(false);
    touch(dir, 'README.md', '# x');
    expect(detectContext(dir).has_readme).toBe(true);
  });

  test('skips node_modules and dist when walking', () => {
    touch(dir, 'src/api/router.ts');
    touch(dir, 'node_modules/some-pkg/index.ts');
    touch(dir, 'node_modules/some-pkg/sub/foo.ts');
    touch(dir, 'dist/router.js');
    const ctx = detectContext(dir);
    expect(ctx.source_files).toBe(1);
  });

  test('caps observed_layers to a reasonable size', () => {
    for (let i = 0; i < 30; i++) {
      touch(dir, `src/layer-${i}/file.ts`);
    }
    const ctx = detectContext(dir);
    expect(ctx.observed_layers.length).toBeLessThanOrEqual(10);
  });
});
