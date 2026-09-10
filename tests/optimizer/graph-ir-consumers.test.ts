// Cladding · Spec 0.2 F8 · consumer-facade parity between GraphIR and the structural projection.
//
// The structural projection is only legitimate while it answers exactly what the kernel
// answers. This suite is that proof: it sweeps a fixture workspace AND the self corpus and
// compares every question the facade exposes, so a divergence surfaces here rather than as
// a quietly different impact card.

import {mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {structuralView, viewFor, type GraphConsumerView} from '../../src/graph/consumers.js';
import {graphIrView} from '../../src/graph/query.js';
import {buildImpactSlice} from '../../src/optimizer/reverse-slice.js';
import {buildWorkingSet} from '../../src/optimizer/working-set.js';
import {testRefPath, PSEUDO_REF_PREFIXES} from '../../src/spec/compiler/legacy-reference.js';
import {loadSpec} from '../../src/spec/load.js';
import type {Spec} from '../../src/spec/types.js';

const roots: string[] = [];

interface FixtureFeature {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly modules?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly testRefs?: readonly string[];
}

/** Writes one schema 0.1 workspace on disk — the same shape the wire suite compiles. */
function fixture(features: readonly FixtureFeature[]): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-graph-consumers-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"',
    'project: {name: graph-consumers, language: typescript}',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  for (const feature of features) {
    writeFileSync(join(root, 'spec', 'features', `${feature.slug}-${feature.id.slice(2)}.yaml`), [
      `id: ${feature.id}`,
      `slug: ${feature.slug}`,
      `title: ${feature.title}`,
      'status: planned',
      'modules:',
      ...(feature.modules ?? []).map((module) => `  - ${module}`),
      ...(feature.dependsOn ? ['depends_on:', ...feature.dependsOn.map((id) => `  - ${id}`)] : []),
      'acceptance_criteria:',
      `  - id: AC-${feature.id.slice(2)}`,
      `    text: The system shall retain ${feature.id} in the consumer facade.`,
      ...(feature.testRefs ? ['    test_refs:', ...feature.testRefs.map((ref) => `      - ${ref}`)] : []),
      '',
    ].join('\n'));
  }
  for (const feature of features) {
    for (const module of feature.modules ?? []) {
      mkdirSync(join(root, module, '..'), {recursive: true});
      writeFileSync(join(root, module), `export const ${feature.id.slice(2)} = true;\n`);
    }
  }
  return root;
}

/** Alpha depends on beta, beta on gamma; delta shares gamma's module (the co-owner fan-out). */
function chainRoot(): string {
  return fixture([
    {
      id: 'F-aaaaaaaa', slug: 'alpha', title: 'Alpha', modules: ['src/alpha.ts'], dependsOn: ['F-bbbbbbbb'],
      testRefs: ['tests/alpha.test.ts#alpha holds', 'derived:suggested', 'fixture:registered'],
    },
    {id: 'F-bbbbbbbb', slug: 'beta', title: 'Beta', modules: ['src/beta.ts'], dependsOn: ['F-cccccccc']},
    {id: 'F-cccccccc', slug: 'gamma', title: 'Gamma', modules: ['src/shared.ts'], testRefs: ['tests/gamma.test.ts']},
    {id: 'F-dddddddd', slug: 'delta', title: 'Delta', modules: ['src/shared.ts'], testRefs: ['tests/gamma.test.ts#other']},
  ]);
}

/** Every question the facade exposes, rendered as one comparable value per feature. */
function answersFor(view: GraphConsumerView, spec: Spec): string {
  const features = [...(spec.features ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  const paths = [...new Set(features.flatMap((feature) => feature.modules ?? []))].sort();
  const testPaths = [...new Set(features.flatMap((feature) =>
    (feature.acceptance_criteria ?? []).flatMap((criterion) =>
      (criterion.test_refs ?? []).map(testRefPath).filter((path): path is string => path !== null))))].sort();
  const dependentsOf = (ids: readonly string[], depth: number): string => {
    const answer = view.dependents(ids, depth);
    return `${answer.completeness}:${[...answer.ids].sort().join('+')}`;
  };
  return JSON.stringify({
    ledger: view.ledger(),
    features: features.map((feature) => ({
      id: feature.id,
      resolvedById: view.resolveFeature(feature.id)?.id ?? null,
      resolvedBySlug: view.resolveFeature((feature as {slug?: string}).slug ?? feature.id)?.id ?? null,
      depth10: dependentsOf([feature.id], 10),
      depth1: dependentsOf([feature.id], 1),
      unbounded: dependentsOf([feature.id], Infinity),
      // A depth reaches the slice as `Number(flag)`, so the non-integers a CLI can
      // produce are swept too — that is where two independently-written walks drift.
      fractional: dependentsOf([feature.id], 2.5),
      notANumber: dependentsOf([feature.id], Number.NaN),
      negative: dependentsOf([feature.id], -1),
    })),
    owners: paths.map((path) => [path, view.owners(path), dependentsOf(view.owners(path), Infinity)]),
    citations: testPaths.map((path) => [path, view.citations(path)]),
  }, null, 2);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

/** Every `.ts`/`.mts`/`.mjs`/`.js` file under one of the scanned roots. */
function sourceFiles(root: string, into: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, into);
    } else if (/\.(?:ts|mts|cts|mjs|cjs|js)$/.test(entry)) {
      into.push(path);
    }
  }
  return into;
}

describe('GraphIR consumer facade', () => {
  test('[covers:F-208eaa79/AC-616e6e74] answers every consumer question identically from GraphIR and the structural projection', () => {
    const root = chainRoot();
    const fixtureSpec = loadSpec(root);
    const fixtureKernel = graphIrView(root, fixtureSpec);

    expect(fixtureKernel.authority).toBe('graph-ir');
    expect(fixtureKernel.reasons).toEqual([]);
    expect(answersFor(fixtureKernel, fixtureSpec)).toBe(answersFor(structuralView(fixtureSpec), fixtureSpec));

    // The self corpus is the only place the two lanes meet a real migration window: shards
    // that carry live bindings, reviewed carry-forwards, 41-hop dependent chains, and files
    // claimed by many features at once.
    const selfSpec = loadSpec(process.cwd());
    const selfKernel = graphIrView(process.cwd(), selfSpec);
    expect(selfKernel.authority).toBe('graph-ir');
    expect(answersFor(selfKernel, selfSpec)).toBe(answersFor(structuralView(selfSpec), selfSpec));

    // `authority` is the ONLY field the two lanes may disagree on — a shared module query
    // on the self corpus exercises the co-owner fan-out, the ledger, and the regression set
    // in one payload.
    const withoutAuthority = (value: unknown): string =>
      JSON.stringify({...(value as Record<string, unknown>), authority: undefined});
    const query = 'src/spec/load.ts';
    expect(withoutAuthority(buildImpactSlice(selfSpec, query, {graph: selfKernel})))
      .toBe(withoutAuthority(buildImpactSlice(selfSpec, query)));
    expect(withoutAuthority(buildWorkingSet(selfSpec, query, {includeCode: false, maxTokens: 350, graph: selfKernel})))
      .toBe(withoutAuthority(buildWorkingSet(selfSpec, query, {includeCode: false, maxTokens: 350})));
    expect((buildImpactSlice(selfSpec, query, {graph: selfKernel}) as {authority?: string}).authority).toBe('graph-ir');
    expect((buildImpactSlice(selfSpec, query) as {authority?: string}).authority).toBe('spec-structural');
  }, 60_000);

  test('[covers:F-208eaa79/AC-616e6e74] leaves no consumer importing the retired reverse-index module', () => {
    // Assembled at runtime so this file is not itself a hit for the scan it runs.
    const retired = ['spec', 'reverse', 'index'].join('/').replace('reverse/index', 'reverse-index');
    const scanned = ['src', 'tests', 'scripts'].flatMap((directory) => sourceFiles(join(process.cwd(), directory)));
    const importers = scanned.filter((path) => readFileSync(path, 'utf8').includes(retired));

    expect(importers).toEqual([]);
    expect(scanned.length).toBeGreaterThan(100); // the scan actually walked the tree
  });

  test('[covers:F-208eaa79/AC-1f6fd7fe] walks dependents in one direction only and never expands to a sibling', () => {
    const root = chainRoot();
    const spec = loadSpec(root);
    for (const view of [graphIrView(root, spec), structuralView(spec)]) {
      // Alpha depends on beta, so beta's dependents contain alpha — and alpha's contain neither
      // its own prerequisite nor gamma, the prerequisite of its prerequisite.
      expect([...view.dependents(['F-bbbbbbbb'], 10).ids].sort()).toEqual(['F-aaaaaaaa']);
      expect([...view.dependents(['F-cccccccc'], 10).ids].sort()).toEqual(['F-aaaaaaaa', 'F-bbbbbbbb']);
      expect([...view.dependents(['F-aaaaaaaa'], Infinity).ids]).toEqual([]);
      // Delta shares gamma's module but depends on nothing, so a module query fans out to the
      // co-owners as SEEDS; the sibling never arrives as an impacted dependent.
      expect(view.owners('src/shared.ts')).toEqual(['F-cccccccc', 'F-dddddddd']);
      expect([...view.dependents(view.owners('src/shared.ts'), Infinity).ids].sort())
        .toEqual(['F-aaaaaaaa', 'F-bbbbbbbb']);
      // A bounded walk says so; the walk that closed on its own says that instead.
      expect(view.dependents(['F-cccccccc'], 1).completeness).toBe('bounded');
      expect(view.dependents(['F-cccccccc'], Infinity).completeness).toBe('complete');
    }
  });

  test('[covers:F-208eaa79/AC-616e6e74] counts a prerequisite that names no existing feature in both lanes', () => {
    // A freshly adopted project can declare every depends_on against ids that do not exist
    // yet. Those edges have no feature node to walk inbound from, so a ledger built by
    // walking would report zero — and `impacted: []` on a zero ledger reads as "unknown,
    // not safe", the opposite of what this corpus should say.
    const root = fixture([
      {id: 'F-aaaaaaaa', slug: 'alpha', title: 'Alpha', modules: ['src/alpha.ts'], dependsOn: ['F-99999999']},
      {id: 'F-bbbbbbbb', slug: 'beta', title: 'Beta', modules: ['src/beta.ts'], dependsOn: ['F-aaaaaaaa']},
    ]);
    const spec = loadSpec(root);
    const kernel = graphIrView(root, spec);

    expect(kernel.authority).toBe('graph-ir');
    expect(kernel.ledger()).toEqual(structuralView(spec).ledger());
    expect(kernel.ledger().depends_on_edges).toBe(2);
    expect([...kernel.dependents(['F-aaaaaaaa'], Infinity).ids]).toEqual(['F-bbbbbbbb']);
    expect(answersFor(kernel, spec)).toBe(answersFor(structuralView(spec), spec));
  });

  test('[covers:F-208eaa79/AC-ff543b95] resolves an ambiguous feature spelling to nothing in both lanes', () => {
    const root = fixture([
      {id: 'F-aaaaaaaa', slug: 'shared', title: 'Alpha', modules: ['src/alpha.ts']},
      {id: 'F-bbbbbbbb', slug: 'shared', title: 'Beta', modules: ['src/beta.ts']},
    ]);
    const spec = loadSpec(root);

    for (const view of [graphIrView(root, spec), structuralView(spec)]) {
      expect(view.resolveFeature('shared')).toBeUndefined();
      expect(view.resolveFeature('F-aaaaaaaa')?.id).toBe('F-aaaaaaaa');
      // A bare criterion id is noncanonical and is never guessed at either.
      expect(view.resolveFeature('AC-aaaaaaaa')).toBeUndefined();
      // A module path is not a feature spelling, and an unowned path owns nothing.
      expect(view.resolveFeature('src/alpha.ts')).toBeUndefined();
      expect(view.owners('src/nowhere.ts')).toEqual([]);
      expect(view.owners('/absolute/escape.ts')).toEqual([]);
    }

    const miss = buildImpactSlice(spec, 'shared', {graph: graphIrView(root, spec)});
    expect('not_found' in miss && miss.not_found).toBe('shared');
  });

  test('[covers:F-208eaa79/AC-d452908b] degrades to the structural projection with an explicit reason and stays deterministic', () => {
    const empty = mkdtempSync(join(tmpdir(), 'clad-graph-consumers-empty-'));
    roots.push(empty);
    const spec = loadSpec(chainRoot());

    const degraded = graphIrView(empty, spec);
    expect(degraded.authority).toBe('spec-structural');
    expect(degraded.reasons).toHaveLength(1);
    expect(degraded.reasons[0].startsWith('graph-ir workspace unavailable: ')).toBe(true);
    // Degraded still ANSWERS — a silent skip would read as "nothing depends on this".
    expect(answersFor(degraded, spec)).toBe(answersFor(structuralView(spec), spec));

    // Deterministic: identical inputs, identical answers, on both lanes.
    const root = chainRoot();
    const chainSpec = loadSpec(root);
    expect(answersFor(graphIrView(root, chainSpec), chainSpec))
      .toBe(answersFor(graphIrView(root, chainSpec), chainSpec));
    expect(structuralView(chainSpec)).toBe(structuralView(chainSpec)); // memoized per Spec instance

    // viewFor: an explicit view always wins; nothing at all is the structural projection.
    expect(viewFor(chainSpec, {graph: degraded})).toBe(degraded);
    expect(viewFor(chainSpec).authority).toBe('spec-structural');
    // Lane selection is explicit: a bare cwd never silently buys the canonical read.
    expect(viewFor(chainSpec, {graph: graphIrView(root, chainSpec)}).authority).toBe('graph-ir');
  });

  test('[covers:F-208eaa79/AC-d452908b] keeps pseudo-references out of every path-keyed answer', () => {
    expect(PSEUDO_REF_PREFIXES).toEqual(['derived:', 'fixture:', 'script:', 'self-dogfood:']);
    for (const prefix of PSEUDO_REF_PREFIXES) expect(testRefPath(`${prefix}anything`)).toBeNull();
    expect(testRefPath('tests/a.test.ts#a test name')).toBe('tests/a.test.ts');
    expect(testRefPath('  tests/a.test.ts  ')).toBe('tests/a.test.ts');
    expect(testRefPath('#only-an-anchor')).toBeNull();
    expect(testRefPath('')).toBeNull();

    const root = chainRoot();
    const spec = loadSpec(root);
    for (const view of [graphIrView(root, spec), structuralView(spec)]) {
      expect(view.citations('tests/alpha.test.ts')).toEqual(['F-aaaaaaaa']);
      expect(view.citations('tests/gamma.test.ts')).toEqual(['F-cccccccc', 'F-dddddddd']);
      expect(view.citations('derived:suggested')).toEqual([]);
      expect(view.citations('fixture:registered')).toEqual([]);
      // Three real (path, feature) pairs; the two pseudo-refs are counted nowhere.
      expect(view.ledger()).toEqual({depends_on_edges: 2, test_ref_edges: 3});
    }
  });
});
