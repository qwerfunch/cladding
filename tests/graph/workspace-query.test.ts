// Cladding · Spec 0.2 F8 · coherent GraphIR workspace query tests.

import {mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {graphIrV2} from '../../src/spec/compiler/graph-ir-v2.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {
  loadGraphIrV2Workspace,
  loadGraphIrV2WorkspaceFromStableSnapshot,
} from '../../src/graph/query.js';
import {loadSpec} from '../../src/spec/load.js';
import {
  prospectiveDoneCompilation,
  prospectiveDoneSpec,
  withProspectiveCompilationOverlay,
  withProspectiveSpecOverlay,
} from '../../src/spec/prospective.js';
import {withStableSpecWorkspaceSnapshot} from '../../src/spec/transaction.js';
import type {Feature} from '../../src/spec/types.js';

const temporary: string[] = [];

function workspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-graph-workspace-query-'));
  temporary.push(root);
  return root;
}

function writeSchema01Workspace(root: string, title: string = 'Legacy query boundary'): void {
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"',
    'project: {name: graph-query, language: typescript}',
    'features:',
    '  - id: F-aaaaaaaa',
    `    title: ${title}`,
    '    status: planned',
    '    modules: [src/legacy.ts]',
    '    acceptance_criteria:',
    '      - id: AC-bbbbbbbb',
    '        text: The system shall preserve the legacy presentation boundary.',
    '',
  ].join('\n'));
}

function writeSchema02Workspace(
  root: string,
  feature: {readonly status?: Feature['status']; readonly blockedReason?: string} = {},
): void {
  const status = feature.status ?? 'in_progress';
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"',
    'project:',
    '  name: graph-query',
    '  language: typescript',
    '  purpose: Keep presentation and graph reads coherent.',
    '  assurance_level: L2',
    '  scenario_policy: advisory',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'workspace-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa',
    'title: Workspace query',
    `status: ${status}`,
    ...(feature.blockedReason === undefined ? [] : [`blocked_reason: ${feature.blockedReason}`]),
    'purpose: Keep the legacy presentation tied to one compiler result.',
    'modules: []',
    'depends_on: []',
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-bbbbbbbb',
    '    kind: behavior',
    '    statement: The system shall use one compiler snapshot for GraphIR reads.',
    '    oracle_refs: [tests/oracle/workspace.test.ts]',
    '    evidence_refs: [docs/workspace-query.md]',
    '',
  ].join('\n'));
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('GraphIR workspace query boundary', () => {
  test('[covers:F-208eaa79/AC-4f8c2542] returns schema 0.1 presentation and GraphIR from one snapshot', () => {
    const root = workspaceRoot();
    writeSchema01Workspace(root);

    const workspace = loadGraphIrV2Workspace(root);

    expect(workspace.spec.features.map((feature) => [feature.id, feature.title])).toEqual([
      ['F-aaaaaaaa', 'Legacy query boundary'],
    ]);
    expect(workspace.compilation.schemaVersion).toBe('0.1');
    expect(workspace.kernel.resolveAddress('F-aaaaaaaa')).toMatchObject({
      state: 'resolved', canonical: 'feature:F-aaaaaaaa',
    });
    expect(graphIrV2(workspace.compilation)).toBe(workspace.kernel);
  });

  test('retains a blocked reason in the ordinary schema 0.2 consumer projection', () => {
    const root = workspaceRoot();
    writeSchema02Workspace(root, {
      status: 'blocked',
      blockedReason: 'Wait for the independent dependency review.',
    });

    expect(loadSpec(root).features).toEqual([
      expect.objectContaining({
        id: 'F-aaaaaaaa',
        status: 'blocked',
        blocked_reason: 'Wait for the independent dependency review.',
      }),
    ]);
  });

  test('[covers:F-208eaa79/AC-616e6e74] derives schema 0.2 presentation from the same complete compiler contract', () => {
    const root = workspaceRoot();
    writeSchema02Workspace(root);

    const workspace = loadGraphIrV2Workspace(root);

    expect(workspace.spec.features.map((feature) => [feature.id, feature.title, feature.status])).toEqual([
      ['F-aaaaaaaa', 'Workspace query', 'in_progress'],
    ]);
    expect(workspace.compilation.contract?.features.map((feature) => [feature.id, feature.title, feature.status])).toEqual([
      ['F-aaaaaaaa', 'Workspace query', 'in_progress'],
    ]);
    expect(workspace.spec.features[0]?.acceptance_criteria).toEqual([
      expect.objectContaining({
        id: 'AC-bbbbbbbb',
        text: 'The system shall use one compiler snapshot for GraphIR reads.',
        oracle_refs: ['tests/oracle/workspace.test.ts'],
        evidence_refs: ['docs/workspace-query.md'],
      }),
    ]);
    expect(workspace.kernel.resolveAddress('feature:F-aaaaaaaa')).toMatchObject({
      state: 'resolved', canonical: 'feature:F-aaaaaaaa',
    });
    expect(graphIrV2(workspace.compilation)).toBe(workspace.kernel);
  });

  test('uses a matching prospective completion pair without reading the on-disk workspace', () => {
    const root = workspaceRoot();
    writeSchema02Workspace(root);
    const prospectiveSpec = prospectiveDoneSpec(loadSpec(root), 'F-aaaaaaaa');
    const prospectiveCompilation = prospectiveDoneCompilation(compileSpecWorkspace(root), 'F-aaaaaaaa');

    withProspectiveSpecOverlay(root, prospectiveSpec, () =>
      withProspectiveCompilationOverlay(root, prospectiveCompilation, () => {
        unlinkSync(join(root, 'spec.yaml'));
        const workspace = loadGraphIrV2Workspace(root);

        expect(workspace.spec).toBe(prospectiveSpec);
        expect(workspace.compilation).toBe(prospectiveCompilation);
        expect(loadSpec(root)).toBe(prospectiveSpec);
        expect(compileSpecWorkspace(root)).toBe(prospectiveCompilation);
        expect(workspace.spec.features.find((feature) => feature.id === 'F-aaaaaaaa')?.status).toBe('done');
        expect(workspace.compilation.contract?.features.find((feature) => feature.id === 'F-aaaaaaaa')?.status).toBe('done');
        expect(workspace.kernel.presentationRecords().find((record) => record.address === 'feature:F-aaaaaaaa')?.status).toBe('done');
      }),
    );
  });

  test('fails closed for missing or mismatched prospective overlay sides', () => {
    const root = workspaceRoot();
    writeSchema02Workspace(root);
    const diskSpec = loadSpec(root);
    const diskCompilation = compileSpecWorkspace(root);
    const prospectiveSpec = prospectiveDoneSpec(diskSpec, 'F-aaaaaaaa');
    const prospectiveCompilation = prospectiveDoneCompilation(diskCompilation, 'F-aaaaaaaa');
    const mismatchedSpec = Object.freeze({
      ...prospectiveSpec,
      features: Object.freeze(prospectiveSpec.features.map((feature) =>
        feature.id === 'F-aaaaaaaa' ? Object.freeze({
          ...feature,
          modules: Object.freeze(['src/mismatched.ts']),
          depends_on: Object.freeze(['F-cccccccc']),
          acceptance_criteria: Object.freeze((feature.acceptance_criteria ?? []).map((criterion) =>
            Object.freeze({
              ...criterion,
              text: 'The system shall not mix compiler snapshots.',
              oracle_refs: Object.freeze(['tests/oracle/mismatched.test.ts']),
            }))),
        }) : feature)),
    });
    const schemaMismatchedSpec = Object.freeze({...prospectiveSpec, schema: '0.1'});

    withProspectiveSpecOverlay(root, prospectiveSpec, () => {
      unlinkSync(join(root, 'spec.yaml'));
      expect(() => loadGraphIrV2Workspace(root)).toThrow(/matching prospective Spec and compiler overlays/);
    });
    withProspectiveSpecOverlay(root, mismatchedSpec, () =>
      withProspectiveCompilationOverlay(root, prospectiveCompilation, () =>
        expect(() => loadGraphIrV2Workspace(root)).toThrow(/cannot prove schema 0.2 presentation and compiler contract structure/),
      ),
    );
    withProspectiveSpecOverlay(root, schemaMismatchedSpec, () =>
      withProspectiveCompilationOverlay(root, prospectiveCompilation, () =>
        expect(() => loadGraphIrV2Workspace(root)).toThrow(/cannot combine Spec schema/),
      ),
    );
  });

  test('rejects prospective overlays that differ only in blocked reason', () => {
    const root = workspaceRoot();
    writeSchema02Workspace(root, {
      status: 'blocked',
      blockedReason: 'Wait for the independent dependency review.',
    });
    const prospectiveSpec = loadSpec(root);
    const prospectiveCompilation = compileSpecWorkspace(root);
    const mismatchedSpec = Object.freeze({
      ...prospectiveSpec,
      features: Object.freeze(prospectiveSpec.features.map((feature) =>
        feature.id === 'F-aaaaaaaa'
          ? Object.freeze({...feature, blocked_reason: 'Wait for a different dependency review.'})
          : feature)),
    });

    withProspectiveSpecOverlay(root, mismatchedSpec, () =>
      withProspectiveCompilationOverlay(root, prospectiveCompilation, () =>
        expect(() => loadGraphIrV2Workspace(root)).toThrow(/cannot prove schema 0.2 presentation and compiler contract structure/),
      ),
    );
  });

  test('retries a moving stable epoch rather than returning a torn presentation/compiler pair', () => {
    const root = workspaceRoot();
    writeSchema01Workspace(root, 'Before replacement');
    let attempts = 0;

    const workspace = withStableSpecWorkspaceSnapshot(root, () => {
      attempts++;
      const result = loadGraphIrV2WorkspaceFromStableSnapshot(root);
      if (attempts === 1) writeSchema01Workspace(root, 'After replacement');
      return result;
    });

    expect(attempts).toBe(2);
    expect(workspace.spec.features).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'F-aaaaaaaa', title: 'After replacement'}),
    ]));
    expect(workspace.compilation.presentations).toEqual(expect.arrayContaining([
      expect.objectContaining({address: 'feature:F-aaaaaaaa', title: 'After replacement'}),
    ]));
  });

  test('returns deeply immutable values, a deterministic memoized kernel, and no stale cwd cache', () => {
    const root = workspaceRoot();
    writeSchema01Workspace(root, 'Before cache check');

    const first = loadGraphIrV2Workspace(root);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.spec.features)).toBe(true);
    expect(Object.isFrozen(first.compilation.nodes)).toBe(true);
    expect(Object.isFrozen(first.compilation.nodes[0]!)).toBe(true);
    expect(() => (first.spec.features as Feature[]).push({
      id: 'F-cccccccc', title: 'Mutation', status: 'planned',
    })).toThrow();
    expect(graphIrV2(first.compilation)).toBe(first.kernel);
    expect(first.kernel.resolveAddress('F-aaaaaaaa')).toEqual(first.kernel.resolveAddress('F-aaaaaaaa'));

    writeSchema01Workspace(root, 'After cache check');
    const second = loadGraphIrV2Workspace(root);
    expect(second).not.toBe(first);
    expect(second.compilation).not.toBe(first.compilation);
    expect(second.spec.features[0]?.title).toBe('After cache check');
  });

  test('fails closed for unknown schemas and incomplete schema 0.2 contracts', () => {
    const unknownRoot = workspaceRoot();
    writeFileSync(join(unknownRoot, 'spec.yaml'), 'schema: "9.9"\nproject: {}\n');
    expect(() => loadGraphIrV2Workspace(unknownRoot)).toThrow(/does not recognize workspace schema/);

    const incompleteRoot = workspaceRoot();
    writeSchema02Workspace(incompleteRoot);
    unlinkSync(join(incompleteRoot, 'spec', 'capabilities.yaml'));
    expect(() => loadGraphIrV2Workspace(incompleteRoot)).toThrow(/compiler contract is unavailable/);
  });
});
