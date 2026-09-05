// Cladding · Spec 0.2 F8 · bounded source @see GraphIR adapter tests.

import {lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, type Stats, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {
  scanSourceReferences,
  sourceReferenceAugmentation,
  type SourceReferenceScan,
} from '../../src/graph/source-references.js';
import {graphIrV2, type GraphIrV2Augmentation} from '../../src/spec/compiler/graph-ir-v2.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import type {GraphNode} from '../../src/spec/compiler/types.js';

const roots: string[] = [];
const SHARD = 'spec/features/alpha-aaaaaaaa.yaml';
const CRITERION = 'criterion:F-aaaaaaaa/AC-11111111';

function workspace(modules: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-source-references-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"', 'project: {name: source-references, language: typescript}', 'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, SHARD), [
    'id: F-aaaaaaaa', 'slug: alpha', 'title: Alpha', 'status: planned',
    `modules: [${modules.join(', ')}]`,
    'acceptance_criteria:',
    '  - id: AC-11111111', '    text: The system shall retain source references.',
    '  - id: AC-22222222', '    text: The system shall retain continued source references.',
    '',
  ].join('\n'));
  return root;
}

function source(root: string, path: string, text: string | Uint8Array): void {
  mkdirSync(join(root, path, '..'), {recursive: true});
  writeFileSync(join(root, path), text);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('bounded source-reference scanner', () => {
  test('[covers:F-208eaa79/AC-4f8c2542] admits only line-start comment carriers and continued composite criteria', () => {
    const root = workspace(['src/carriers.ts']);
    source(root, 'src/carriers.ts', [
      `// @see ${SHARD} AC-11111111 /`,
      '// AC-22222222 — continuation',
      `/// @see ${SHARD} AC-11111111`,
      `/* @see ${SHARD} AC-22222222 */`,
      ` * @see ${SHARD} AC-11111111`,
      `# @see ${SHARD} AC-22222222`,
      `-- @see ${SHARD} AC-11111111`,
      `    //   @see ${SHARD} AC-11111111`,
      `const string = '@see ${SHARD} AC-22222222';`,
      `const template = \`@see ${SHARD} AC-22222222\`;`,
      `const inline = true; // @see ${SHARD} AC-22222222`,
      `organic prose @see ${SHARD} AC-22222222`,
      'const bare = "AC-22222222";',
      '',
    ].join('\n'));

    const scan = scanSourceReferences(root, compileSpecWorkspace(root));

    expect(scan).toMatchObject({completeness: 'complete', issues: [], unknownFiles: []});
    expect(scan.records).toHaveLength(8);
    expect(scan.records.map((record) => record.normalizedTarget)).toEqual(expect.arrayContaining([
      'criterion:F-aaaaaaaa/AC-11111111',
      'criterion:F-aaaaaaaa/AC-22222222',
    ]));
    expect(scan.records.every((record) => record.raw.includes('@see '))).toBe(true);
    expect(scan.records.every((record) => record.selector.startsWith('source-reference:'))).toBe(true);
    expect(scan.records.find((record) => record.raw.includes('\n'))).toMatchObject({
      raw: `// @see ${SHARD} AC-11111111 /\n// AC-22222222 — continuation`,
    });
    expect(scan.records.find((record) => record.raw.startsWith('    //'))?.location).toEqual({line: 8, column: 10});
    expect(Object.isFrozen(scan.records[0])).toBe(true);
    expect(Object.isFrozen(scan.records[0]!.location)).toBe(true);
    expect(() => { (scan.records[0]!.location as {line: number}).line = 99; }).toThrow();
  });

  test('[covers:F-208eaa79/AC-4f8c2542] retains CRLF authored carriers while parsing continued composite criteria', () => {
    const root = workspace(['src/carriers.ts']);
    const rawCarrier = `// @see ${SHARD} AC-11111111 /\r\n// AC-22222222 — continuation\r`;
    source(root, 'src/carriers.ts', `${rawCarrier}\n`);

    const scan = scanSourceReferences(root, compileSpecWorkspace(root));

    expect(scan).toMatchObject({completeness: 'complete', issues: [], unknownFiles: [], unknownReasons: []});
    expect(scan.records).toEqual([
      expect.objectContaining({
        normalizedTarget: 'criterion:F-aaaaaaaa/AC-11111111', state: 'resolved', raw: rawCarrier,
        location: {line: 1, column: 4},
      }),
      expect.objectContaining({
        normalizedTarget: 'criterion:F-aaaaaaaa/AC-22222222', state: 'resolved', raw: rawCarrier,
        location: {line: 1, column: 4},
      }),
    ]);
    expect(new Set(scan.records.map((record) => record.selector))).toEqual(new Set([
      'source-reference:["src/carriers.ts","feature:F-aaaaaaaa",["criterion:F-aaaaaaaa/AC-11111111","criterion:F-aaaaaaaa/AC-22222222"]]:1',
    ]));
  });

  test('[covers:F-208eaa79/AC-4f8c2542] materializes authored anchors and traces_to edges without an artifact edge', () => {
    const root = workspace(['src/carriers.ts']);
    source(root, 'src/carriers.ts', [
      `// @see ${SHARD} AC-11111111 /`,
      '// AC-22222222 / AC-22222222',
      '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    const scan = scanSourceReferences(root, compilation);
    const layer = sourceReferenceAugmentation(compilation, scan);
    const kernel = graphIrV2(compilation, [layer]);
    const record = scan.records.find((candidate) => candidate.normalizedTarget === CRITERION)!;
    const anchor = `anchor:src/carriers.ts#${record.selector}`;

    expect(layer).toMatchObject({layerId: 'source-references', completeness: 'complete'});
    expect(scan.records).toHaveLength(2);
    expect(new Set(scan.records.map((candidate) => candidate.selector))).toEqual(new Set([record.selector]));
    expect(layer.nodes).toEqual([expect.objectContaining({
      address: anchor, artifact: 'artifact:src/carriers.ts', selectorProvenance: 'authored', provenance: 'authored',
    })]);
    expect(layer.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: anchor, to: CRITERION, relation: 'traces_to', provenance: 'authored', state: 'resolved',
        owner: {kind: 'text_source', path: 'src/carriers.ts', selector: record.selector},
        raw: `// @see ${SHARD} AC-11111111 /\n// AC-22222222 / AC-22222222`, normalizedTarget: CRITERION,
      }),
      expect.objectContaining({from: anchor, to: 'criterion:F-aaaaaaaa/AC-22222222', relation: 'traces_to'}),
    ]));
    expect(layer.edges).toHaveLength(2);
    expect(kernel.project({
      seeds: [CRITERION], rules: [{relation: 'traces_to', direction: 'inbound'}], maxHops: 1, maxNodes: 2, maxEdges: 1,
    }).edges).toEqual([expect.objectContaining({from: anchor, to: CRITERION, relation: 'traces_to'})]);
    expect(kernel.project({
      seeds: [anchor], rules: [{relation: 'traces_to', direction: 'outbound'}], maxHops: 1, maxNodes: 3, maxEdges: 2,
    }).edges).toHaveLength(2);
    expect(kernel.resolveAddress(anchor)).toEqual({
      state: 'resolved', input: anchor, canonical: anchor, via: 'anchor',
    });
    expect(kernel.project({
      seeds: ['artifact:src/carriers.ts'], rules: [{relation: 'traces_to', direction: 'outbound'}], maxHops: 1, maxNodes: 2, maxEdges: 1,
    }).edges).toEqual([]);
    expect(kernel.corpusRecords()).toEqual(graphIrV2(compilation).corpusRecords());
  });

  test('[covers:F-208eaa79/AC-4f8c2542] keeps selectors stable across unrelated additions and ordinals only identical facts', () => {
    const root = workspace(['src/carriers.ts']);
    source(root, 'src/carriers.ts', [
      `// @see ${SHARD} AC-11111111`,
      `// @see ${SHARD} AC-11111111`,
      '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    const first = scanSourceReferences(root, compilation);
    source(root, 'src/carriers.ts', [
      '// unrelated inserted carrier-free comment',
      `// @see ${SHARD} AC-22222222`,
      `// @see ${SHARD} AC-11111111`,
      `// @see ${SHARD} AC-11111111`,
      '',
    ].join('\n'));
    const second = scanSourceReferences(root, compilation);

    const firstDuplicateSelectors = first.records.map((record) => record.selector).sort();
    const secondDuplicateSelectors = second.records
      .filter((record) => record.normalizedTarget === CRITERION)
      .map((record) => record.selector)
      .sort();
    expect(firstDuplicateSelectors).toEqual(secondDuplicateSelectors);
    expect(firstDuplicateSelectors).toHaveLength(2);
    expect(firstDuplicateSelectors[0]).toContain(':1');
    expect(firstDuplicateSelectors[1]).toContain(':2');
    expect(sourceReferenceAugmentation(compilation, first).edges.map((edge) => edge.identity).sort())
      .toEqual(sourceReferenceAugmentation(compilation, second).edges
        .filter((edge) => edge.to === CRITERION).map((edge) => edge.identity).sort());
  });

  test('[covers:F-208eaa79/AC-d452908b] retains unresolved known shards and issues without guessing a target', () => {
    const root = workspace(['src/carriers.ts']);
    source(root, 'src/carriers.ts', [
      `// @see ${SHARD} AC-deadbeef / AC-11111111`,
      '// @see spec/features/unknown-ffffffff.yaml AC-11111111',
      `// @see ${SHARD}`,
      '// @see ./spec/features/alpha-aaaaaaaa.yaml AC-11111111',
      '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    const scan = scanSourceReferences(root, compilation);
    const layer = sourceReferenceAugmentation(compilation, scan);
    const kernel = graphIrV2(compilation, [layer]);

    expect(scan.issues.map((issue) => issue.code).sort()).toEqual([
      'FEATURE_ONLY', 'NONCANONICAL_FEATURE_PATH', 'UNKNOWN_CRITERION', 'UNKNOWN_FEATURE_SHARD',
    ]);
    expect(scan.records).toEqual(expect.arrayContaining([expect.objectContaining({
      normalizedTarget: 'criterion:F-aaaaaaaa/AC-deadbeef', state: 'unresolved',
    })]));
    expect(layer).toMatchObject({completeness: 'unknown'});
    expect(layer.nodes).toHaveLength(4);
    expect(new Set(layer.nodes.map((node) => node.address)).size).toBe(layer.nodes.length);
    const unresolved = scan.records.find((record) => record.normalizedTarget === 'criterion:F-aaaaaaaa/AC-deadbeef')!;
    expect(scan.issues.find((issue) => issue.code === 'UNKNOWN_CRITERION')?.selector).toBe(unresolved.selector);
    expect(new Set(scan.records.filter((record) => record.raw.includes('AC-deadbeef')).map((record) => record.selector)))
      .toEqual(new Set([unresolved.selector]));
    expect(Object.isFrozen(scan.issues[0])).toBe(true);
    expect(Object.isFrozen(scan.issues[0]!.location)).toBe(true);
    expect(() => { (scan.issues[0]!.location as {column: number}).column = 99; }).toThrow();
    expect(layer.edges).toEqual(expect.arrayContaining([expect.objectContaining({
      relation: 'traces_to', state: 'unresolved', to: 'criterion:F-aaaaaaaa/AC-deadbeef',
    })]));
    expect(layer.unknownReasons).toEqual(expect.arrayContaining([
      'source reference target is unresolved: criterion:F-aaaaaaaa/AC-deadbeef',
    ]));
    expect(kernel.project({
      seeds: ['artifact:src/carriers.ts'], rules: [{relation: 'traces_to', direction: 'outbound'}], maxHops: 2, maxNodes: 3, maxEdges: 1,
    })).toMatchObject({completeness: 'unknown'});
  });

  test('[covers:F-208eaa79/AC-d452908b] keeps source references optional and skips directory ownership artifacts without reading or recursing', () => {
    const root = workspace(['src/carriers.ts', 'src/ordinary.ts', 'src/ownership']);
    const carrier = join(root, 'src', 'carriers.ts');
    const ordinary = join(root, 'src', 'ordinary.ts');
    const ownership = join(root, 'src', 'ownership');
    const nested = join(ownership, 'nested.ts');
    source(root, 'src/carriers.ts', `// @see ${SHARD} AC-11111111\n`);
    source(root, 'src/ordinary.ts', 'export const ordinary = true;\n');
    mkdirSync(ownership, {recursive: true});
    writeFileSync(nested, `// @see ${SHARD} AC-22222222\n`);
    const lstatPaths: string[] = [];
    const readPaths: string[] = [];

    const scan = scanSourceReferences(root, compileSpecWorkspace(root), {
      lstat: (path) => {
        lstatPaths.push(path);
        return lstatSync(path);
      },
      readFile: (path) => {
        readPaths.push(path);
        return readFileSync(path);
      },
    });

    expect(scan).toMatchObject({completeness: 'complete', issues: [], unknownFiles: []});
    expect(scan.records).toEqual([expect.objectContaining({
      sourcePath: 'src/carriers.ts', normalizedTarget: CRITERION, state: 'resolved',
    })]);
    expect(readPaths).toEqual([carrier, ordinary]);
    expect(lstatPaths).not.toContain(nested);
  });

  test('[covers:F-208eaa79/AC-d452908b] fails closed for symbolic-link roots and ancestors without reading', () => {
    const root = workspace(['src/carriers.ts']);
    const carrier = join(root, 'src', 'carriers.ts');
    const symlinkStats = {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => true,
    } as Stats;
    source(root, 'src/carriers.ts', `// @see ${SHARD} AC-11111111\n`);
    const compilation = compileSpecWorkspace(root);

    for (const unsafePath of [root, join(root, 'src')]) {
      const readPaths: string[] = [];
      const scan = scanSourceReferences(root, compilation, {
        lstat: (path) => path === unsafePath ? symlinkStats : lstatSync(path),
        readFile: (path) => {
          readPaths.push(path);
          return readFileSync(path);
        },
      });

      expect(scan).toMatchObject({
        records: [], issues: [], completeness: 'unknown', unknownFiles: [{path: 'src/carriers.ts', reason: 'symlink'}],
      });
      expect(readPaths).toEqual([]);
      expect(readPaths).not.toContain(carrier);
    }
  });

  test('[covers:F-208eaa79/AC-d452908b] records a declared-but-absent module as a known negative rather than unknown topology', () => {
    const root = workspace(['src/carriers.ts', 'src/not-written-yet.ts']);
    source(root, 'src/carriers.ts', `// @see ${SHARD} AC-11111111\n`);
    const compilation = compileSpecWorkspace(root);

    const scan = scanSourceReferences(root, compilation);

    expect(scan.absentSources).toEqual(['src/not-written-yet.ts']);
    expect(scan.unknownFiles).toEqual([]);
    expect(scan.unknownReasons).toEqual([]);
    expect(scan.completeness).toBe('complete');
    expect(scan.records.map((record) => record.normalizedTarget)).toEqual(['criterion:F-aaaaaaaa/AC-11111111']);
    expect(Object.isFrozen(scan.absentSources)).toBe(true);
  });

  test('[covers:F-208eaa79/AC-d452908b] fails closed for symlinked, invalid-UTF8, and non-directory non-files while an absent module stays a known negative', () => {
    const root = workspace([
      'src/missing.ts', 'src/link.ts', 'src/invalid.ts', 'src/not-file.ts', 'src/unreadable.ts', 'plugins/claude-code/dist/clad.js',
    ]);
    const outside = join(root, 'outside.ts');
    const nonFile = join(root, 'src', 'not-file.ts');
    const nonRegularStats = {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as Stats;
    source(root, 'outside.ts', `// @see ${SHARD} AC-11111111\n`);
    mkdirSync(join(root, 'src'), {recursive: true});
    symlinkSync(outside, join(root, 'src', 'link.ts'));
    writeFileSync(join(root, 'src', 'invalid.ts'), Buffer.from([0xc3, 0x28]));
    source(root, 'src/unreadable.ts', 'export const unreadable = true;\n');
    source(root, 'plugins/claude-code/dist/clad.js', `// @see ${SHARD} AC-11111111\n`);
    const compilation = compileSpecWorkspace(root);
    let outsideReads = 0;
    const readPaths: string[] = [];
    const scan = scanSourceReferences(root, compilation, {
      lstat: (path) => path === nonFile ? nonRegularStats : lstatSync(path),
      readFile: (path) => {
        readPaths.push(path);
        if (path === outside) outsideReads++;
        if (path === join(root, 'src', 'unreadable.ts')) {
          throw Object.assign(new Error('denied'), {code: 'EACCES'});
        }
        return readFileSync(path);
      },
    });

    expect(scan.records).toEqual([]);
    expect(scan.completeness).toBe('unknown');
    expect(scan.unknownFiles).toEqual(expect.arrayContaining([
      {path: 'src/link.ts', reason: 'symlink'},
      {path: 'src/invalid.ts', reason: 'invalid_utf8'},
      {path: 'src/not-file.ts', reason: 'not_file'},
      {path: 'src/unreadable.ts', reason: 'unreadable'},
    ]));
    expect(scan.absentSources).toEqual(['src/missing.ts']);
    expect(scan.unknownFiles.map((file) => file.path)).not.toContain('src/missing.ts');
    expect(scan.unknownReasons).not.toContain('source artifact src/missing.ts is missing');
    expect(scan.unknownFiles.map((file) => file.path)).not.toContain('plugins/claude-code/dist/clad.js');
    expect(Object.isFrozen(scan.unknownFiles[0])).toBe(true);
    expect(outsideReads).toBe(0);
    expect(readPaths).not.toContain(nonFile);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] discovers the complete compiler-bounded repository source-reference census', () => {
    const root = process.cwd();
    const compilation = compileSpecWorkspace(root);
    const scan = scanSourceReferences(root, compilation);
    const carriers = new Set(scan.records.map((record) =>
      `${record.sourcePath}\u0000${record.location.line}\u0000${record.location.column}\u0000${record.raw}`));
    const sourceArtifacts = new Set(compilation.nodes
      .filter((node): node is Extract<GraphNode, {readonly nodeType: 'artifact'}> => node.nodeType === 'artifact')
      .filter((node) => node.roles.includes('source'))
      .map((node) => node.address.slice('artifact:'.length)));
    const declarationRecords = scan.records.filter((record) => record.sourcePath === 'scripts/plugin-mirror-policy.d.mts');
    const currentGateObservationRecords = scan.records
      .filter((record) => record.sourcePath === 'src/graph/test-observations.ts');

    expect(carriers.size).toBe(142);
    expect(scan.records).toHaveLength(180);
    expect(scan.records.every((record) => record.state === 'resolved' && sourceArtifacts.has(record.sourcePath))).toBe(true);
    expect(scan.issues).toEqual([]);
    expect(scan.unknownFiles).toEqual([]);
    expect(scan.absentSources).toEqual([]);
    expect(scan.unknownReasons).toEqual([]);
    expect(scan.completeness).toBe('complete');
    expect(declarationRecords).toHaveLength(14);
    expect(declarationRecords.filter((record) => record.normalizedTarget === 'criterion:F-40327b/AC-003')).toHaveLength(3);
    expect(declarationRecords.filter((record) => record.normalizedTarget === 'criterion:F-40327b/AC-004')).toHaveLength(11);
    expect(currentGateObservationRecords.map(({normalizedTarget, state}) => ({normalizedTarget, state})).sort(
      (left, right) => left.normalizedTarget.localeCompare(right.normalizedTarget),
    )).toEqual([
      {normalizedTarget: 'criterion:F-208eaa79/AC-4f8c2542', state: 'resolved'},
      {normalizedTarget: 'criterion:F-208eaa79/AC-d452908b', state: 'resolved'},
    ]);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] preserves compiler artifact role unions and caller-owned input immutability', () => {
    const root = workspace(['src/carriers.ts']);
    source(root, 'src/carriers.ts', `// @see ${SHARD} AC-11111111\n`);
    const compilation = compileSpecWorkspace(root);
    const scan = scanSourceReferences(root, compilation);
    const mutableRecord = {...scan.records[0]!, location: {...scan.records[0]!.location}};
    const mutableScan = {
      ...scan,
      records: [mutableRecord],
      issues: [...scan.issues], unknownFiles: [...scan.unknownFiles], unknownReasons: [...scan.unknownReasons],
    } satisfies SourceReferenceScan;
    const layer = sourceReferenceAugmentation(compilation, mutableScan);
    mutableScan.records[0]!.raw = 'mutated';
    const unionCompilation = {
      ...compilation,
      nodes: compilation.nodes.map((node): GraphNode => node.nodeType === 'artifact' && node.address === 'artifact:src/carriers.ts'
        ? {...node, roles: ['source', 'test'] as const}
        : node),
    };

    expect(layer.edges[0]).toMatchObject({raw: `// @see ${SHARD} AC-11111111`});
    expect(graphIrV2(unionCompilation, [layer]).project({
      seeds: ['artifact:src/carriers.ts'], rules: [{relation: 'traces_to', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    }).nodes).toEqual([expect.objectContaining({address: 'artifact:src/carriers.ts', roles: ['source', 'test']})]);
    expect(graphIrV2(unionCompilation, [layer]).corpusRecords()).toEqual(graphIrV2(unionCompilation).corpusRecords());
    const testArtifact = 'artifact:tests/independent.test.ts';
    const testAnchor = 'anchor:tests/independent.test.ts#independent case';
    const testLocator = {kind: 'text_source' as const, path: 'tests/independent.test.ts', selector: 'independent case'};
    const testLayer: GraphIrV2Augmentation = {
      layerId: 'independent-test-facts',
      nodes: [
        {address: testArtifact, nodeType: 'artifact', roles: ['test'], owners: ['feature:F-aaaaaaaa'], provenance: 'authored', locator: testLocator},
        {
          address: testAnchor, nodeType: 'anchor', artifact: testArtifact, selector: 'independent case',
          selectorProvenance: 'authored', provenance: 'authored', locator: testLocator,
        },
      ],
      edges: [{
        identity: 'independent-test-covers', from: testAnchor, to: CRITERION, relation: 'covers', provenance: 'authored',
        owner: testLocator, state: 'resolved', raw: '[covers:F-aaaaaaaa/AC-11111111]', normalizedTarget: CRITERION,
        selector: {precision: 'fragment', value: 'independent case'},
      }],
      completeness: 'complete', unknownReasons: [],
    };
    const documentArtifact = 'artifact:docs/independent.md';
    const documentAnchor = 'anchor:docs/independent.md#independent section';
    const documentLocator = {kind: 'text_source' as const, path: 'docs/independent.md', selector: 'independent section'};
    const documentLayer: GraphIrV2Augmentation = {
      layerId: 'independent-document-facts',
      nodes: [
        {address: documentArtifact, nodeType: 'artifact', roles: ['doc'], owners: [], provenance: 'derived', locator: documentLocator},
        {
          address: documentAnchor, nodeType: 'anchor', artifact: documentArtifact, selector: 'independent section',
          selectorProvenance: 'derived', provenance: 'derived', locator: documentLocator,
        },
      ],
      edges: [{
        identity: 'independent-document-mentions', from: documentAnchor, to: 'feature:F-aaaaaaaa', relation: 'mentions', provenance: 'derived',
        owner: documentLocator, state: 'resolved', raw: 'F-aaaaaaaa', normalizedTarget: 'feature:F-aaaaaaaa',
        selector: {precision: 'fragment', value: 'independent section'},
      }],
      completeness: 'complete', unknownReasons: [],
    };
    const layers = [layer, testLayer, documentLayer] as const;
    const orders: readonly (readonly GraphIrV2Augmentation[])[] = [
      [layers[0], layers[1], layers[2]], [layers[0], layers[2], layers[1]],
      [layers[1], layers[0], layers[2]], [layers[1], layers[2], layers[0]],
      [layers[2], layers[0], layers[1]], [layers[2], layers[1], layers[0]],
    ];
    const outcomes = orders.map((order) => {
      const permuted = graphIrV2(unionCompilation, order);
      const projection = permuted.project({
        seeds: [
          `anchor:src/carriers.ts#${scan.records[0]!.selector}`,
          testAnchor,
          documentAnchor,
        ],
        rules: [
          {relation: 'traces_to', direction: 'outbound'},
          {relation: 'covers', direction: 'outbound'},
          {relation: 'mentions', direction: 'outbound'},
        ],
        maxHops: 1,
        maxNodes: 5,
        maxEdges: 3,
      });
      return {
        resolutions: [
          permuted.resolveAddress(`anchor:src/carriers.ts#${scan.records[0]!.selector}`),
          permuted.resolveAddress(testAnchor),
          permuted.resolveAddress(documentAnchor),
        ],
        projection,
        corpus: permuted.corpusRecords(),
        completeness: [projection.completeness, permuted.criterionProofs(CRITERION).completeness],
      };
    });
    expect(orders).toHaveLength(6);
    expect(outcomes.slice(1)).toEqual(Array.from({length: 5}, () => outcomes[0]));
  });
});
