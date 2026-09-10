import { describe, expect, test } from 'vitest';
import { inferDependsOn } from '../../src/optimizer/infer-depends-on.js';
import type { Spec } from '../../src/spec/types.js';

type Feature = {
  id: string;
  slug: string;
  title: string;
  status: string;
  modules: string[];
  depends_on: string[];
  acceptance_criteria: unknown[];
};

const feature = (id: string, slug: string, modules: string[]): Feature => ({
  id,
  slug,
  title: slug.toUpperCase(),
  status: 'done',
  modules,
  depends_on: [],
  acceptance_criteria: [],
});

const specOf = (features: Feature[]): Spec => ({ features }) as unknown as Spec;

const readerOf =
  (sources: Record<string, string>) =>
  (path: string): string | null =>
    Object.prototype.hasOwnProperty.call(sources, path) ? sources[path] : null;

describe('inferDependsOn — dynamicImportFiles', () => {
  test('[covers:F-0f2984d0/AC-d7c33b] flags a module with dynamic imports in dynamicImportFiles', () => {
    const spec = specOf([
      feature('F-aaa111', 'a', ['pkg/a.py']),
      feature('F-bbb222', 'b', ['pkg/b.py']),
    ]);
    const read = readerOf({
      'pkg/a.py': 'import importlib\nmod = importlib.import_module("pkg.b")\n',
      'pkg/b.py': 'name = "pkg.c"\nmod = __import__(name)\n',
    });

    const result = inferDependsOn(spec, read);

    expect(result.dynamicImportFiles).toContain('pkg/a.py');
    expect(result.dynamicImportFiles).toContain('pkg/b.py');
    expect(result.dynamicImportFiles).toHaveLength(2);
  });

  test('[covers:F-0f2984d0/AC-d7c33b] leaves dynamicImportFiles empty when all imports are static', () => {
    const spec = specOf([
      feature('F-aaa111', 'a', ['pkg/a.py']),
      feature('F-bbb222', 'b', ['pkg/b.py']),
    ]);
    const read = readerOf({
      'pkg/a.py': 'from pkg.b import x\nimport os\n',
      'pkg/b.py': 'import sys\nfrom pkg.a import y\n',
    });

    const result = inferDependsOn(spec, read);

    expect(result.dynamicImportFiles).toHaveLength(0);
    expect(result.dynamicImportFiles).toEqual([]);
  });

  test('[covers:F-0f2984d0/AC-1781e6] dynamicImportFiles is deterministic and does not alter inferred edges', () => {
    const spec = specOf([
      feature('F-aaa111', 'a', ['pkg/a.py']),
      feature('F-bbb222', 'b', ['pkg/b.py']),
    ]);
    const read = readerOf({
      'pkg/a.py':
        'from pkg.b import x\nimport importlib\nmod = importlib.import_module("pkg.c")\n',
      'pkg/b.py': 'x = 1\n',
    });

    const result = inferDependsOn(spec, read);

    // (a) the static edge F-a -> F-b survives dynamic detection
    const connectsAtoB = result.edges.some((edge) => {
      const json = JSON.stringify(edge);
      return json.includes('F-aaa111') && json.includes('F-bbb222');
    });
    expect(connectsAtoB).toBe(true);

    // (b) the dynamic-import owner is flagged
    expect(result.dynamicImportFiles).toContain('pkg/a.py');

    // (c) deterministic across identical calls
    const again = inferDependsOn(spec, read);
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });
});
