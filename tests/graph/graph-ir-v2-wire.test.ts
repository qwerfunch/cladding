// Cladding · Spec 0.2 F8 · GraphIR v2 public wire record and bounded packer tests.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../../src/graph/query.js';
import {
  defaultRulesFor,
  exportGraphV2,
  focusedProjectionV2,
  statisticsV2,
  type WireEnvelopeV2,
} from '../../src/graph/wire-v2.js';

const roots: string[] = [];

interface FixtureFeature {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly modules?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly criteria?: readonly string[];
}

function fixture(
  features: readonly FixtureFeature[],
  files: Readonly<Record<string, string | Uint8Array>> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-graph-wire-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"',
    'project: {name: graph-wire, language: typescript}',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  for (const feature of features) {
    const criteria = feature.criteria ?? ['AC-11111111'];
    writeFileSync(join(root, 'spec', 'features', `${feature.slug}-${feature.id.slice(2)}.yaml`), [
      `id: ${feature.id}`,
      `slug: ${feature.slug}`,
      `title: ${feature.title}`,
      'status: planned',
      'modules:',
      ...(feature.modules ?? []).map((module) => `  - ${module}`),
      ...(feature.dependsOn ? ['depends_on:', ...feature.dependsOn.map((id) => `  - ${id}`)] : []),
      'acceptance_criteria:',
      ...criteria.flatMap((id) => [
        `  - id: ${id}`,
        `    text: The system shall retain ${id} on the public graph wire.`,
      ]),
      '',
    ].join('\n'));
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Alpha depends on beta, beta depends on gamma; gamma is the neighbour of a neighbour. */
function chainWorkspace(): GraphIrV2Workspace {
  return loadGraphIrV2Workspace(fixture([
    {
      id: 'F-aaaaaaaa', slug: 'alpha', title: 'Alpha',
      modules: ['src/alpha.ts', 'tests/alpha.test.ts'], dependsOn: ['F-bbbbbbbb'],
    },
    {id: 'F-bbbbbbbb', slug: 'beta', title: 'Beta', modules: ['src/beta.ts'], dependsOn: ['F-cccccccc']},
    {id: 'F-cccccccc', slug: 'gamma', title: 'Gamma', modules: ['src/gamma.ts']},
  ]));
}

function addresses(envelope: WireEnvelopeV2): readonly string[] {
  return (envelope.nodes ?? []).map((node) => node.address);
}

function serializedBytes(envelope: WireEnvelopeV2): number {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('GraphIR v2 public wire records', () => {
  test('[covers:F-208eaa79/AC-945363a4] emits deterministic schema-version-2 records in a canonical key order', () => {
    const root = fixture([
      {id: 'F-aaaaaaaa', slug: 'alpha', title: 'Alpha', modules: ['src/alpha.ts'], dependsOn: ['F-bbbbbbbb']},
      {id: 'F-bbbbbbbb', slug: 'beta', title: 'Beta', modules: ['src/beta.ts']},
    ]);

    const first = focusedProjectionV2(loadGraphIrV2Workspace(root), {query: 'feature:F-aaaaaaaa'});
    const second = focusedProjectionV2(loadGraphIrV2Workspace(root), {query: 'feature:F-aaaaaaaa'});

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.schema_version).toBe(2);
    expect(first.workspace_schema).toBe('0.1');
    expect(Object.keys(first)).toEqual([
      'schema_version', 'kind', 'workspace_schema', 'layers', 'completeness', 'reasons', 'nodes', 'edges', 'meta',
    ]);
    expect(Object.keys(first.meta)).toEqual([
      'seeds', 'rules', 'bounds', 'counts', 'omitted', 'required_overflow',
      'payload_utf8_bytes', 'byte_ceiling', 'token_estimate',
    ]);
    const seed = first.nodes?.find((node) => node.address === 'feature:F-aaaaaaaa');
    expect(Object.keys(seed ?? {})).toEqual(['address', 'type', 'kind', 'provenance', 'owner', 'title', 'slug', 'status']);
    expect(seed).toMatchObject({type: 'semantic', kind: 'feature', title: 'Alpha', slug: 'alpha', status: 'planned'});
    expect(seed?.owner).toMatch(/^spec\/features\/alpha-aaaaaaaa\.yaml:\d+$/);
    const artifact = first.nodes?.find((node) => node.address === 'artifact:src/alpha.ts');
    expect(artifact).toMatchObject({type: 'artifact', roles: expect.arrayContaining(['source'])});
    const dependency = first.edges?.find((edge) => edge.relation === 'depends_on');
    expect(Object.keys(dependency ?? {})).toEqual(['id', 'from', 'to', 'relation', 'provenance']);
    expect(dependency).toMatchObject({
      from: 'feature:F-aaaaaaaa', to: 'feature:F-bbbbbbbb', provenance: 'authored',
    });
    expect(dependency?.state).toBeUndefined();
    expect(first.nodes?.[0]?.address).toBe('feature:F-aaaaaaaa');
    expect([...(first.edges ?? [])].sort((left, right) => left.id.localeCompare(right.id)).map((edge) => edge.id))
      .toEqual(first.edges?.map((edge) => edge.id));
  });

  test('[covers:F-208eaa79/AC-b61f6aa5] returns a depth-1 bounded projection whose rules follow the seed taxonomy', () => {
    const workspace = chainWorkspace();

    const feature = focusedProjectionV2(workspace, {query: 'F-aaaaaaaa'});
    const artifact = focusedProjectionV2(workspace, {query: 'src/alpha.ts'});

    expect(feature.kind).toBe('projection');
    expect(feature.meta.bounds).toEqual({max_depth: 1, max_nodes: 64, max_edges: 128});
    expect(feature.meta.seeds).toEqual(['feature:F-aaaaaaaa']);
    expect(feature.meta.rules).toEqual(defaultRulesFor('feature:F-aaaaaaaa'));
    expect(addresses(feature)).toEqual([
      'feature:F-aaaaaaaa',
      'artifact:src/alpha.ts',
      'artifact:tests/alpha.test.ts',
      'criterion:F-aaaaaaaa/AC-11111111',
      'feature:F-bbbbbbbb',
    ]);
    expect(feature.edges?.every((edge) =>
      edge.from === 'feature:F-aaaaaaaa' || edge.to === 'feature:F-aaaaaaaa')).toBe(true);

    expect(artifact.kind).toBe('projection');
    expect(artifact.meta.seeds).toEqual(['artifact:src/alpha.ts']);
    expect(artifact.meta.rules).toEqual(defaultRulesFor('artifact:src/alpha.ts'));
    expect(addresses(artifact)).toEqual(['artifact:src/alpha.ts', 'feature:F-aaaaaaaa']);
    expect(artifact.edges?.map((edge) => edge.relation)).toEqual(['touches']);
    expect(artifact.meta.counts).toEqual({nodes: 2, edges: 1});
  });

  test('[covers:F-208eaa79/AC-1f6fd7fe] never expands to a neighbour of a neighbour at depth 1', () => {
    const workspace = chainWorkspace();

    const depthOne = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa'});
    const depthTwo = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_depth: 2});

    expect(addresses(depthOne)).toContain('feature:F-bbbbbbbb');
    expect(addresses(depthOne)).not.toContain('feature:F-cccccccc');
    expect(addresses(depthOne)).not.toContain('artifact:src/beta.ts');
    expect(depthOne.edges?.some((edge) => edge.from === 'feature:F-bbbbbbbb')).toBe(false);

    expect(addresses(depthTwo)).toContain('feature:F-cccccccc');
    expect(addresses(depthTwo)).not.toContain('artifact:src/gamma.ts');
    expect(depthTwo.edges?.every((edge) =>
      addresses(depthTwo).includes(edge.from) && addresses(depthTwo).includes(edge.to))).toBe(true);
  });

  test('[covers:F-208eaa79/AC-4ce9a97d] rejects invalid or unbounded graph bounds without throwing', () => {
    const workspace = chainWorkspace();

    const zero = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_nodes: 0});
    const oversize = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_nodes: 201});
    const fractional = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_edges: 3.5});
    const negative = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_edges: -1});
    const deep = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_depth: 4});
    const every = focusedProjectionV2(workspace, {
      query: 'feature:F-aaaaaaaa', max_depth: 0, max_nodes: 0, max_edges: 0,
    });

    for (const rejected of [zero, oversize, fractional, negative, deep, every]) {
      expect(rejected.kind).toBe('rejected');
      expect(rejected.completeness).toBe('unknown');
      expect(rejected.nodes).toBeUndefined();
      expect(rejected.edges).toBeUndefined();
      expect(rejected.meta.payload_utf8_bytes).toBe(serializedBytes(rejected));
    }
    expect(zero.reasons).toEqual(['max_nodes must be an integer between 1 and 200']);
    expect(oversize.reasons).toEqual(['max_nodes must be an integer between 1 and 200']);
    expect(fractional.reasons).toEqual(['max_edges must be an integer between 1 and 400']);
    expect(negative.reasons).toEqual(['max_edges must be an integer between 1 and 400']);
    expect(deep.reasons).toEqual(['max_depth must be an integer between 1 and 3']);
    expect(every.reasons).toEqual([
      'max_depth must be an integer between 1 and 3',
      'max_nodes must be an integer between 1 and 200',
      'max_edges must be an integer between 1 and 400',
    ]);
    expect(focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_depth: 3}).kind).toBe('projection');
    expect(focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa', max_nodes: 200}).kind).toBe('projection');
  });

  test('[covers:F-208eaa79/AC-98be095b] answers an unresolved or ambiguous query with an explicit non-answer', () => {
    const workspace = chainWorkspace();
    const collision = loadGraphIrV2Workspace(fixture([
      {id: 'F-aaaaaaaa', slug: 'shared', title: 'Alpha', modules: ['src/alpha.ts']},
      {id: 'F-bbbbbbbb', slug: 'shared', title: 'Beta', modules: ['src/beta.ts']},
    ]));

    const missing = focusedProjectionV2(workspace, {query: 'feature:F-99999999'});
    const bare = focusedProjectionV2(workspace, {query: 'AC-11111111'});
    const ambiguous = focusedProjectionV2(collision, {query: 'shared'});

    for (const answer of [missing, bare, ambiguous]) {
      expect(answer.kind).toBe('unresolved');
      expect(answer.completeness).toBe('unresolved');
      expect(answer.nodes).toBeUndefined();
      expect(answer.edges).toBeUndefined();
      expect(answer.resolution?.accepted_forms).toEqual([
        'canonical address (feature:F-…, criterion:F-…/AC-…, artifact:<path>, anchor:<path>#<selector>)',
        'feature id (F-…)',
        'feature slug',
        'repository path',
      ]);
      expect(answer.meta.payload_utf8_bytes).toBe(serializedBytes(answer));
    }
    expect(missing.resolution).toMatchObject({state: 'unresolved', input: 'feature:F-99999999'});
    expect(missing.resolution?.candidates).toBeUndefined();
    expect(bare.resolution).toMatchObject({
      state: 'unresolved',
      input: 'AC-11111111',
      reason: 'bare criterion ids are noncanonical and are never guessed',
    });
    expect(ambiguous.resolution).toMatchObject({
      state: 'ambiguous',
      input: 'shared',
      candidates: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb'],
    });
  });

  test('[covers:F-208eaa79/AC-286cc0a8] measures the complete outer serialization to a byte fixed point', () => {
    const workspace = chainWorkspace();

    for (const request of [
      {query: 'feature:F-aaaaaaaa'},
      {query: 'src/alpha.ts', view: 'full' as const},
      {query: 'feature:F-99999999'},
      {query: 'feature:F-aaaaaaaa', max_nodes: 0},
    ]) {
      const envelope = focusedProjectionV2(workspace, request);
      expect(envelope.meta.payload_utf8_bytes).toBe(serializedBytes(envelope));
      expect(envelope.meta.token_estimate).toEqual({
        estimator: 'characters/4',
        tokens: Math.ceil(envelope.meta.payload_utf8_bytes / 4),
      });
      expect(envelope.meta.byte_ceiling).toBe(16_384);
    }
    const unbounded = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa'}, {byteCeiling: null});
    expect(unbounded.meta.byte_ceiling).toBeNull();
    expect(unbounded.meta.payload_utf8_bytes).toBe(serializedBytes(unbounded));
    expect(unbounded.meta.omitted).toEqual({nodes: 0, edges: 0, reasons: 0, fields: 0});
  });

  test('[covers:F-208eaa79/AC-a0d60a0b] reports exact final bytes and exact omission counts', () => {
    const workspace = chainWorkspace();
    const complete = focusedProjectionV2(workspace, {query: 'feature:F-aaaaaaaa'});

    expect(complete.meta.counts).toEqual({nodes: complete.nodes?.length, edges: complete.edges?.length});
    expect(complete.meta.omitted).toEqual({nodes: 0, edges: 0, reasons: 0, fields: 0});
    expect(complete.completeness).toBe('complete');

    const dense = loadGraphIrV2Workspace(fixture([{
      id: 'F-aaaaaaaa', slug: 'dense', title: 'Dense',
      modules: Array.from({length: 160}, (_, index) => `src/dense-${String(index).padStart(3, '0')}.ts`),
    }]));
    const trimmed = focusedProjectionV2(dense, {query: 'feature:F-aaaaaaaa', max_nodes: 200, max_edges: 400});
    const kept = new Set(addresses(trimmed));

    expect(trimmed.meta.payload_utf8_bytes).toBe(serializedBytes(trimmed));
    expect(trimmed.meta.counts).toEqual({nodes: trimmed.nodes?.length, edges: trimmed.edges?.length});
    expect(trimmed.meta.omitted.nodes).toBe(162 - (trimmed.nodes?.length ?? 0));
    expect(trimmed.meta.omitted.edges).toBe(161 - (trimmed.edges?.length ?? 0));
    expect(trimmed.edges?.every((edge) => kept.has(edge.from) && kept.has(edge.to))).toBe(true);
    expect(trimmed.meta.omitted.fields).toBeGreaterThan(0);
    expect(trimmed.nodes?.find((node) => node.address === 'feature:F-aaaaaaaa')?.title).toBe('Dense');
    expect(trimmed.nodes?.filter((node) => node.address !== 'feature:F-aaaaaaaa').every((node) =>
      node.title === undefined && node.owner === undefined)).toBe(true);
  });

  test('[covers:F-208eaa79/AC-d183d625] packs a dense seed within the 16 KiB observe-profile ceiling', () => {
    const dense = loadGraphIrV2Workspace(fixture([{
      id: 'F-aaaaaaaa', slug: 'dense', title: 'Dense',
      modules: Array.from({length: 160}, (_, index) => `src/dense-${String(index).padStart(3, '0')}.ts`),
    }]));

    const envelope = focusedProjectionV2(dense, {query: 'feature:F-aaaaaaaa', max_nodes: 200, max_edges: 400});

    expect(envelope.meta.payload_utf8_bytes).toBeLessThanOrEqual(16_384);
    expect(envelope.meta.payload_utf8_bytes).toBe(serializedBytes(envelope));
    expect(envelope.meta.omitted.nodes).toBeGreaterThan(0);
    expect(envelope.meta.required_overflow).toBe(false);
    expect(envelope.completeness).toBe('bounded');
    expect(addresses(envelope)).toContain('feature:F-aaaaaaaa');
    expect(envelope.reasons.some((reason) => reason.startsWith('packer: dropped'))).toBe(true);
  });

  test('[covers:F-208eaa79/AC-cf399eba] reports required_overflow instead of dropping required seed facts', () => {
    const workspace = chainWorkspace();

    const envelope = focusedProjectionV2(
      workspace,
      {query: 'feature:F-aaaaaaaa', max_nodes: 1, max_edges: 1},
      {byteCeiling: 256},
    );

    expect(envelope.meta.required_overflow).toBe(true);
    expect(envelope.meta.payload_utf8_bytes).toBeGreaterThan(256);
    expect(envelope.meta.payload_utf8_bytes).toBe(serializedBytes(envelope));
    expect(envelope.meta.byte_ceiling).toBe(256);
    expect(envelope.meta.omitted.nodes).toBe(0);
    expect(envelope.meta.omitted.edges).toBe(0);
    expect(addresses(envelope)).toEqual(['feature:F-aaaaaaaa']);
    expect(envelope.nodes?.[0]).toMatchObject({title: 'Alpha', slug: 'alpha', status: 'planned'});
    expect(envelope.reasons).toContain('packer: required seed facts exceed the byte ceiling and were retained in full');
  });

  test('[covers:F-208eaa79/AC-d452908b] passes records through an unknown fact layer with its explicit reasons', () => {
    const complete = chainWorkspace();
    const degraded = loadGraphIrV2Workspace(fixture(
      [{
        id: 'F-aaaaaaaa', slug: 'alpha', title: 'Alpha',
        modules: ['src/alpha.ts', 'src/undecodable.ts'], dependsOn: ['F-bbbbbbbb'],
      },
      {id: 'F-bbbbbbbb', slug: 'beta', title: 'Beta', modules: ['src/beta.ts']}],
      {'src/alpha.ts': 'export const alpha = true;\n', 'src/undecodable.ts': Buffer.from([0xc3, 0x28])},
    ));

    expect(complete.layers.every((layer) => layer.completeness === 'complete')).toBe(true);
    expect(focusedProjectionV2(complete, {query: 'feature:F-aaaaaaaa'}).completeness).toBe('complete');

    const envelope = focusedProjectionV2(degraded, {query: 'feature:F-aaaaaaaa'});
    const unknownLayer = envelope.layers.find((layer) => layer.id === 'source-references');

    expect(unknownLayer?.completeness).toBe('unknown');
    expect(unknownLayer?.reasons).toEqual(['source artifact src/undecodable.ts is invalid_utf8']);
    expect(envelope.completeness).toBe('unknown');
    expect(envelope.reasons).toContain('source-references: source artifact src/undecodable.ts is invalid_utf8');
    expect(addresses(envelope)).toContain('feature:F-aaaaaaaa');
    expect(addresses(envelope)).toContain('artifact:src/undecodable.ts');
    expect(envelope.edges?.length).toBeGreaterThan(0);
    expect(envelope.meta.payload_utf8_bytes).toBe(serializedBytes(envelope));
  });

  test('[covers:F-208eaa79/AC-945363a4] exports and counts the whole graph deterministically', () => {
    const workspace = chainWorkspace();

    const first = exportGraphV2(workspace);
    const second = exportGraphV2(workspace);
    const statistics = statisticsV2(workspace);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.kind).toBe('export');
    expect(first.meta.byte_ceiling).toBeNull();
    expect(first.meta.bounds).toEqual({max_depth: null, max_nodes: null, max_edges: null});
    expect(first.meta.omitted).toEqual({nodes: 0, edges: 0, reasons: 0, fields: 0});
    expect(first.meta.payload_utf8_bytes).toBe(serializedBytes(first));
    expect(addresses(first)).toEqual(expect.arrayContaining([
      'project', 'feature:F-aaaaaaaa', 'criterion:F-aaaaaaaa/AC-11111111', 'artifact:src/gamma.ts',
    ]));
    expect(first.completeness).toBe('unknown');
    expect(first.reasons[0]).toMatch(/^whole-graph read: traversal from compiler-owned seeds/);

    expect(statistics.kind).toBe('statistics');
    expect(statistics.nodes).toBeUndefined();
    expect(statistics.edges).toBeUndefined();
    expect(statistics.meta.payload_utf8_bytes).toBe(serializedBytes(statistics));
    expect(statistics.statistics?.nodes.total).toBe(first.meta.counts.nodes);
    expect(statistics.statistics?.edges.total).toBe(first.meta.counts.edges);
    expect(statistics.statistics?.nodes.by_kind.feature).toBe(3);
    expect(statistics.statistics?.nodes.by_type.artifact).toBe(8);
    expect(statistics.statistics?.edges.by_relation.touches).toBe(4);
    expect(Object.keys(statistics.statistics?.nodes.by_kind ?? {}))
      .toEqual([...Object.keys(statistics.statistics?.nodes.by_kind ?? {})].sort());
    expect(statistics.statistics?.artifact_hubs.length).toBeLessThanOrEqual(10);
  });
});

describe('GraphIR v2 public wire on the cladding corpus', () => {
  const workspace = loadGraphIrV2Workspace(process.cwd());

  test('[covers:F-208eaa79/AC-d183d625] keeps a self-corpus feature read inside the observe-profile ceiling', () => {
    const envelope = focusedProjectionV2(workspace, {query: 'feature:F-208eaa79'});

    expect(envelope.kind).toBe('projection');
    expect(envelope.meta.payload_utf8_bytes).toBeLessThanOrEqual(16_384);
    expect(envelope.meta.payload_utf8_bytes).toBe(serializedBytes(envelope));
    expect(envelope.meta.required_overflow).toBe(false);
    expect(addresses(envelope)).toContain('feature:F-208eaa79');
    expect(addresses(envelope)).toContain('artifact:src/graph/wire-v2.ts');
    // The packer's own account of its trimming survives the retained-reason
    // head even when the kernel already reported many traversal-bound reasons.
    expect(envelope.reasons[0]).toMatch(/^packer: dropped \d+ node\(s\)/);
    expect(envelope.meta.omitted.reasons).toBeGreaterThan(0);
  });

  test('[covers:F-208eaa79/AC-b61f6aa5] fans an artifact read out to every owning feature', () => {
    const envelope = focusedProjectionV2(workspace, {query: 'src/cli/clad.ts'});
    const owners = new Set((envelope.edges ?? [])
      .filter((edge) => edge.relation === 'touches' && edge.to === 'artifact:src/cli/clad.ts')
      .map((edge) => edge.from));

    expect(envelope.kind).toBe('projection');
    expect(envelope.meta.seeds).toEqual(['artifact:src/cli/clad.ts']);
    expect(owners.size).toBeGreaterThanOrEqual(5);
    expect([...owners].every((address) => address.startsWith('feature:'))).toBe(true);
    expect(envelope.meta.payload_utf8_bytes).toBeLessThanOrEqual(16_384);
  });

  test('[covers:F-208eaa79/AC-a0d60a0b] fits a small self-corpus feature with no omission at all', () => {
    const envelope = focusedProjectionV2(workspace, {query: 'feature:F-001'});

    expect(envelope.meta.omitted).toEqual({nodes: 0, edges: 0, reasons: 0, fields: 0});
    expect(envelope.meta.required_overflow).toBe(false);
    expect(envelope.completeness).toBe('complete');
    expect(envelope.meta.payload_utf8_bytes).toBe(serializedBytes(envelope));
    expect(envelope.meta.payload_utf8_bytes).toBeLessThan(16_384);
  });
});
