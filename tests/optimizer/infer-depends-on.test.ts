import {describe, test, expect} from 'vitest';
import {inferDependsOn} from '../../src/optimizer/infer-depends-on.js';
import type {Spec} from '../../src/spec/types.js';

// The `read` fake maps a module path to fake source code (its import
// statements), or null when "unreadable". This keeps inferDependsOn pure —
// no real files are touched.
type Reader = (path: string) => string | null;

// Build a synthetic Spec from plain feature objects. The contract only cares
// about feature `id`, `modules`, and `depends_on`, so we cast through unknown.
function makeSpec(features: unknown[]): Spec {
  return {
    schema: '0.1',
    project: {name: 't', language: 'python'},
    features,
  } as unknown as Spec;
}

function feature(
  id: string,
  modules: string[],
  dependsOn?: string[],
): unknown {
  return {
    id,
    slug: id.replace(/^F-/, ''),
    title: id.toUpperCase(),
    status: 'done',
    modules,
    depends_on: dependsOn ?? [],
    acceptance_criteria: [],
  };
}

describe('inferDependsOn', () => {
  test("infers A->B when A's module imports a file owned by B", () => {
    const spec = makeSpec([
      feature('F-a', ['backend/pkg/a.py']),
      feature('F-b', ['backend/pkg/b.py']),
    ]);
    const read: Reader = (p) =>
      p === 'backend/pkg/a.py' ? 'from pkg.b import x\n' : null;

    const result = inferDependsOn(spec, read);

    expect(result.edges).toContainEqual({
      from: 'F-a',
      to: 'F-b',
      via: 'backend/pkg/a.py',
    });
    expect(result.suggestions['F-a']).toContain('F-b');
  });

  test('emits no edge for stdlib/third-party/unowned imports', () => {
    const spec = makeSpec([feature('F-a', ['backend/pkg/a.py'])]);
    const read: Reader = (p) =>
      p === 'backend/pkg/a.py'
        ? 'import os\nfrom collections import OrderedDict\nfrom unowned.thing import z\n'
        : null;

    const result = inferDependsOn(spec, read);

    expect(result.edges).toEqual([]);
  });

  test('never emits a self-edge when a feature imports its own module', () => {
    const spec = makeSpec([
      feature('F-a', ['backend/pkg/a.py', 'backend/pkg/util.py']),
    ]);
    const read: Reader = (p) =>
      p === 'backend/pkg/a.py' ? 'from pkg.util import h\n' : null;

    const result = inferDependsOn(spec, read);

    // owner of util.py is F-a itself => no edge, no self-edge.
    expect(result.edges.some((e) => e.from === e.to)).toBe(false);
    expect(result.edges).toEqual([]);
  });

  test('skips imports of modules owned by multiple features by default', () => {
    const spec = makeSpec([
      feature('F-a', ['backend/pkg/a.py']),
      feature('F-b', ['backend/pkg/shared.py']),
      feature('F-c', ['backend/pkg/shared.py']),
    ]);
    const read: Reader = (p) =>
      p === 'backend/pkg/a.py' ? 'from pkg.shared import s\n' : null;

    // Default maxOwnerAmbiguity (1): shared.py has 2 owners => ambiguous => skipped.
    const result = inferDependsOn(spec, read);
    expect(result.edges.filter((e) => e.from === 'F-a')).toEqual([]);

    // With maxOwnerAmbiguity 2: owners.size 2 <= 2 => allowed => both edges appear.
    const result2 = inferDependsOn(spec, read, {maxOwnerAmbiguity: 2});
    expect(result2.edges).toContainEqual({
      from: 'F-a',
      to: 'F-b',
      via: 'backend/pkg/a.py',
    });
    expect(result2.edges).toContainEqual({
      from: 'F-a',
      to: 'F-c',
      via: 'backend/pkg/a.py',
    });
  });

  test('is deterministic for identical spec and file contents', () => {
    const spec = makeSpec([
      feature('F-a', ['backend/pkg/a.py']),
      feature('F-b', ['backend/pkg/b.py']),
      feature('F-c', ['backend/pkg/c.py']),
    ]);
    const read: Reader = (p) =>
      p === 'backend/pkg/a.py'
        ? 'from pkg.c import y\nfrom pkg.b import x\n'
        : null;

    const first = inferDependsOn(spec, read);
    const second = inferDependsOn(spec, read);

    expect(JSON.stringify(first.edges)).toBe(JSON.stringify(second.edges));
  });

  test('separates already-declared edges from new suggestions', () => {
    const spec = makeSpec([
      feature('F-a', ['backend/pkg/a.py'], ['F-b']),
      feature('F-b', ['backend/pkg/b.py']),
      feature('F-c', ['backend/pkg/c.py']),
    ]);
    const read: Reader = (p) =>
      p === 'backend/pkg/a.py'
        ? 'from pkg.b import x\nfrom pkg.c import y\n'
        : null;

    const result = inferDependsOn(spec, read);

    // F-a->F-b is already declared in depends_on.
    expect(result.alreadyDeclared).toContainEqual({
      from: 'F-a',
      to: 'F-b',
      via: 'backend/pkg/a.py',
    });
    expect(result.edges).not.toContainEqual({
      from: 'F-a',
      to: 'F-b',
      via: 'backend/pkg/a.py',
    });
    expect(result.suggestions['F-a']).not.toContain('F-b');

    // F-a->F-c is NOT declared => a new edge + suggestion.
    expect(result.edges).toContainEqual({
      from: 'F-a',
      to: 'F-c',
      via: 'backend/pkg/a.py',
    });
    expect(result.suggestions['F-a']).toContain('F-c');
  });

  // v0.7.0 shipped the whole JS/TS extraction branch with zero fixtures (all
  // Python) — on a TypeScript project (cladding itself!) nothing pinned it.
  describe('JS/TS extraction', () => {
    test('import…from, side-effect import, and require() all resolve owned edges', () => {
      const spec = makeSpec([
        feature('F-a', ['src/app/main.ts']),
        feature('F-b', ['src/lib/mod.ts']),
        feature('F-c', ['src/lib/side.ts']),
        feature('F-d', ['src/lib/legacy.ts']),
      ]);
      const read: Reader = (p) =>
        p === 'src/app/main.ts'
          ? [
              "import {x} from '../lib/mod.js';",
              "import '../lib/side.js';",
              "const legacy = require('src/lib/legacy');",
            ].join('\n')
          : null;

      const result = inferDependsOn(spec, read);
      const targets = result.edges.filter((e) => e.from === 'F-a').map((e) => e.to);
      expect(targets).toContain('F-b');
      expect(targets).toContain('F-c');
      expect(targets).toContain('F-d');
    });

    test("export…from re-exports (barrel files) are dependencies — v0.7.0 missed them", () => {
      const spec = makeSpec([
        feature('F-barrel', ['src/api/index.ts']),
        feature('F-impl', ['src/api/impl.ts']),
      ]);
      const read: Reader = (p) =>
        p === 'src/api/index.ts' ? "export {run} from './api/impl.js';\nexport * from 'src/api/impl';\n" : null;

      const result = inferDependsOn(spec, read);
      expect(result.edges).toContainEqual({from: 'F-barrel', to: 'F-impl', via: 'src/api/index.ts'});
    });

    test("a LITERAL dynamic import('…') is an edge; a non-literal one flags the file", () => {
      const spec = makeSpec([
        feature('F-a', ['src/app/lazy.ts']),
        feature('F-b', ['src/lib/mod.ts']),
        feature('F-x', ['src/app/plugin.ts']),
      ]);
      const read: Reader = (p) => {
        if (p === 'src/app/lazy.ts') return "const m = await import('src/lib/mod');\n";
        if (p === 'src/app/plugin.ts') return 'const m = await import(userChoice);\n';
        return null;
      };

      const result = inferDependsOn(spec, read);
      expect(result.edges).toContainEqual({from: 'F-a', to: 'F-b', via: 'src/app/lazy.ts'});
      expect(result.dynamicImportFiles).toContain('src/app/plugin.ts');
      expect(result.dynamicImportFiles).not.toContain('src/app/lazy.ts');
    });

    test('a bare single-segment specifier stays excluded (ambiguity rule holds in TS too)', () => {
      const spec = makeSpec([
        feature('F-a', ['src/app/main.ts']),
        feature('F-b', ['utils.ts']), // single segment — no multi-segment key exists
      ]);
      const read: Reader = (p) => (p === 'src/app/main.ts' ? "import u from 'utils';\n" : null);

      const result = inferDependsOn(spec, read);
      expect(result.edges).toEqual([]);
    });
  });
});
