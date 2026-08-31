// Cladding · detector purity invariants (Iron Law structural tripwire)
//
// The Iron Law fixes stage_1.3 (Drift) as SYNCHRONOUS, DETERMINISTIC, and
// ZERO-LLM: every registered detector is a pure function
// `(opts) => readonly DriftFinding[]` (see src/stages/types.ts). This suite is
// the structural tripwire for that contract, in two layers:
//
//   1. No detector's `run` may be an async function. An async `run` could
//      `await` I/O / an LLM / a subprocess mid-scan, breaking the "in-process,
//      deterministic, no-network" guarantee the whole gate rests on. We inspect
//      the function's prototype constructor rather than INVOKING run() — calling
//      every detector here would spawn real madge / secretlint subprocesses
//      (ARCHITECTURE_*, HARDCODED_SECRET, …), i.e. exactly the non-determinism
//      this file exists to forbid. So this is a static, allocation-free check.
//   2. The architecture layer (spec/architecture.yaml) must forbid the detector
//      layer from importing the adapters layer. Adapters are where the
//      subprocess / SDK shells live; a detector reaching into adapters is how
//      async / non-determinism would sneak back in through the import graph
//      even while every `run` stays syntactically synchronous.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {allDetectors} from '../../src/stages/detectors/index.js';

const ROOT = process.cwd();

describe('detector purity — Iron Law stage_1.3 is synchronous + deterministic (F-b010427b)', () => {
  test('[covers:F-b010427b/AC-42870a39] every detector.run is a synchronous (non-async) function', () => {
    expect(allDetectors.length, 'the registry must expose at least one detector').toBeGreaterThan(0);
    for (const d of allDetectors) {
      expect(typeof d.run, `${d.name}.run must be a function`).toBe('function');
      // An AsyncFunction's prototype constructor is named 'AsyncFunction';
      // a plain function's is 'Function'. We deliberately do NOT call d.run() —
      // invoking all detectors would spawn madge/secretlint subprocesses (see
      // file header). This is the structural tripwire, not a behavioural one.
      const kind = Object.getPrototypeOf(d.run).constructor.name;
      expect(
        kind,
        `${d.name}.run must not be async — detectors are synchronous, deterministic, zero-LLM (Iron Law stage_1.3)`,
      ).not.toBe('AsyncFunction');
    }
  });

  test('[covers:F-b010427b/AC-f74f18f9] spec/architecture.yaml forbids the detector layer from importing adapters', () => {
    // forbidden_imports paths are relative to src/ (cfg.mainRoot in
    // architecture-from-spec.ts); tolerate an explicit `src/` prefix or a
    // trailing slash in either direction.
    const schema = (parseYaml(readFileSync(join(ROOT, 'spec.yaml'), 'utf8')) as {schema?: unknown}).schema;
    expect(schema, 'spec.yaml must declare a supported schema').toMatch(/^(?:0\.1|0\.2)$/);
    const arch = parseYaml(readFileSync(join(ROOT, 'spec/architecture.yaml'), 'utf8')) as {
      forbidden_imports?: ReadonlyArray<{from?: string; to?: string}>;
      rules?: ReadonlyArray<{kind?: string; from?: string; to?: string}>;
    };
    const rules = schema === '0.1'
      ? arch.forbidden_imports ?? []
      : (arch.rules ?? []).filter((rule) => rule.kind === 'forbidden_import');
    const strip = (p: string): string => p.replace(/^src\//, '').replace(/\/+$/, '').trim();
    // A rule scope "covers" a path when the path equals the scope or sits under
    // it (e.g. scope 'adapters' covers 'adapters' and 'adapters/host').
    const covers = (scope: string | undefined, path: string): boolean => {
      if (!scope) return false;
      const s = strip(scope);
      return path === s || path.startsWith(s + '/');
    };
    // The `.includes('detectors')` clause pins this to the detectors-specific
    // rule so a broad stages→adapters ban could not satisfy it by accident.
    const rule = rules.find(
      (r) => strip(r.from ?? '').includes('detectors') && covers(r.from, 'stages/detectors') && covers(r.to, 'adapters'),
    );
    expect(
      rule,
      'spec/architecture.yaml must declare a schema-appropriate forbidden-import rule from src/stages/detectors to src/adapters',
    ).toBeDefined();
  });
});
