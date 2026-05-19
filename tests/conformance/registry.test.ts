// Cladding · integration test — conformance/fixtures.yaml SSoT integrity
//
// Guards two invariants v0.2.4 introduced (F-053):
//   1. Every `kind: runnable` entry in fixtures.yaml has a matching
//      hardcoded fixture id in conformance/runner.ts. If we add a
//      runnable fixture to the registry without wiring its
//      setup/run pair, the conformance sweep would silently skip it.
//   2. Every fixture id hardcoded in runner.ts has a registry entry.
//      A runner-only fixture would be unciteable from spec/features
//      because FIXTURE_REFERENCE_INVALID would reject the citation.
//
// The bidirectional check is what makes the registry an SSoT rather
// than a hint. The two sides must agree exactly.

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';
import {parse} from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface RegistryEntry {
  readonly name: string;
  readonly kind: 'runnable' | 'documentary';
}

function loadRegistry(): readonly RegistryEntry[] {
  const text = readFileSync(resolve(repoRoot, 'conformance/fixtures.yaml'), 'utf8');
  const data = parse(text) as {fixtures: RegistryEntry[]};
  return data.fixtures;
}

function loadRunnerIds(): readonly string[] {
  const text = readFileSync(resolve(repoRoot, 'conformance/runner.ts'), 'utf8');
  return [...text.matchAll(/id:\s*'(stage_[\d.]+\.(?:pass|fail))'/g)].map((m) => m[1]);
}

describe('conformance/fixtures.yaml SSoT', () => {
  test('every runnable entry exists in conformance/runner.ts', () => {
    const registry = loadRegistry();
    const runnableNames = registry.filter((f) => f.kind === 'runnable').map((f) => f.name);
    const runnerIds = new Set(loadRunnerIds());
    const orphans = runnableNames.filter((n) => !runnerIds.has(n));
    expect(orphans).toEqual([]);
  });

  test('every fixture id in conformance/runner.ts is in the registry', () => {
    const registry = loadRegistry();
    const registeredNames = new Set(registry.map((f) => f.name));
    const runnerIds = loadRunnerIds();
    const unregistered = runnerIds.filter((id) => !registeredNames.has(id));
    expect(unregistered).toEqual([]);
  });

  test('every registry entry declares a kind', () => {
    const registry = loadRegistry();
    const malformed = registry.filter((f) => f.kind !== 'runnable' && f.kind !== 'documentary');
    expect(malformed).toEqual([]);
  });

  test('every registry entry has a unique name', () => {
    const registry = loadRegistry();
    const names = registry.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
