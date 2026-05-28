// Cladding · unit tests for topologicalGroups (0.4.11 PR-B).
//
// The drive transaction's flat `plan` field stays for one minor cycle
// (backward compat); the new `groups` field carries the Kahn-levels
// parallel-dispatch grouping that hosts with native multi-agent
// surfaces (Tier 1) can fan out concurrently.
//
// Scenarios covered:
//   - 5-feature serial chain  A → B → C → D → E   → 5 groups, 1 each
//   - 3-feature diamond       A → {B, C} → D      → 3 groups [[A], [B,C], [D]]
//   - 5-feature mixed         A → B → C + indep D, E  → groups [[A,D,E], [B], [C]]
//   - empty scenario          → 0 groups
//   - cycle                    A → B → A         → 1 group containing both
//   - out-of-scope deps treated as already-done
//   - groups echoed on the drive_started event payload

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors} from '../../src/stages/drift.js';
import {executeDrive} from '../../src/work/drive-transaction.js';

interface SeedFeature {
  readonly id: string;
  readonly slug: string;
  readonly status?: 'planned' | 'done' | 'archived';
  readonly modules?: readonly string[];
  readonly depends_on?: readonly string[];
}

interface SeedScenario {
  readonly id: string;
  readonly title: string;
  readonly features: readonly string[];
}

function seedProject(cwd: string, scenario: SeedScenario, features: SeedFeature[]): void {
  writeFileSync(
    join(cwd, 'spec.yaml'),
    [
      'schema: "0.1"',
      'project:',
      '  name: probe',
      '  language: typescript',
      'features: []',
      'scenarios: []',
      '',
    ].join('\n'),
  );
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  for (const f of features) {
    const status = f.status ?? 'planned';
    const modulesBlock =
      f.modules && f.modules.length > 0
        ? `modules:\n${f.modules.map((m) => `  - ${m}`).join('\n')}`
        : 'modules:\n  - src/feat.ts';
    const depsBlock =
      f.depends_on && f.depends_on.length > 0
        ? `depends_on:\n${f.depends_on.map((d) => `  - ${d}`).join('\n')}`
        : '';
    writeFileSync(
      join(cwd, 'spec', 'features', `${f.slug}-${f.id.slice(2)}.yaml`),
      [
        `id: ${f.id}`,
        `slug: ${f.slug}`,
        `title: "${f.slug}"`,
        `status: ${status}`,
        modulesBlock,
        depsBlock,
        'acceptance_criteria: []',
        '',
      ]
        .filter((l) => l.length > 0)
        .join('\n'),
    );
  }
  mkdirSync(join(cwd, 'spec', 'scenarios'), {recursive: true});
  const featuresLine =
    scenario.features.length === 0
      ? 'features: []'
      : `features:\n${scenario.features.map((f) => `  - ${f}`).join('\n')}`;
  writeFileSync(
    join(cwd, 'spec', 'scenarios', `scn-${scenario.id.slice(2)}.yaml`),
    [`id: ${scenario.id}`, `slug: scn`, `title: "${scenario.title}"`, featuresLine, ''].join('\n'),
  );
}

function readEvents(cwd: string): Array<{type: string; payload: Record<string, unknown>}> {
  const path = join(cwd, '.cladding', 'events.log.jsonl');
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe('topologicalGroups — single-feature scenarios', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-parallel-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('empty scenario → 0 groups', () => {
    seedProject(cwd, {id: 'S-aaaaaa', title: 'empty', features: []}, []);
    const r = executeDrive({scenarioId: 'S-aaaaaa', cwd});
    expect(r.groups).toEqual([]);
    expect(r.plan).toEqual([]);
  });

  test('single feature → 1 group of 1', () => {
    seedProject(
      cwd,
      {id: 'S-bbbbbb', title: 'one', features: ['F-100001']},
      [{id: 'F-100001', slug: 'one'}],
    );
    const r = executeDrive({scenarioId: 'S-bbbbbb', cwd});
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].ordinal).toBe(0);
    expect(r.groups[0].featureIds).toEqual(['F-100001']);
  });
});

describe('topologicalGroups — serial chains', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-parallel-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('A → B → C → D → E → 5 groups of 1 each', () => {
    seedProject(
      cwd,
      {id: 'S-cccccc', title: 'serial', features: ['F-a00001', 'F-b00002', 'F-c00003', 'F-d00004', 'F-e00005']},
      [
        {id: 'F-a00001', slug: 'a'},
        {id: 'F-b00002', slug: 'b', depends_on: ['F-a00001']},
        {id: 'F-c00003', slug: 'c', depends_on: ['F-b00002']},
        {id: 'F-d00004', slug: 'd', depends_on: ['F-c00003']},
        {id: 'F-e00005', slug: 'e', depends_on: ['F-d00004']},
      ],
    );
    const r = executeDrive({scenarioId: 'S-cccccc', cwd});
    expect(r.groups).toHaveLength(5);
    expect(r.groups.map((g) => g.featureIds)).toEqual([
      ['F-a00001'],
      ['F-b00002'],
      ['F-c00003'],
      ['F-d00004'],
      ['F-e00005'],
    ]);
  });
});

describe('topologicalGroups — diamonds + mixed', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-parallel-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('diamond A → {B, C} → D → 3 groups [[A], [B, C], [D]]', () => {
    seedProject(
      cwd,
      {id: 'S-dddddd', title: 'diamond', features: ['F-aa1111', 'F-bb2222', 'F-cc3333', 'F-dd4444']},
      [
        {id: 'F-aa1111', slug: 'a'},
        {id: 'F-bb2222', slug: 'b', depends_on: ['F-aa1111']},
        {id: 'F-cc3333', slug: 'c', depends_on: ['F-aa1111']},
        {id: 'F-dd4444', slug: 'd', depends_on: ['F-bb2222', 'F-cc3333']},
      ],
    );
    const r = executeDrive({scenarioId: 'S-dddddd', cwd});
    expect(r.groups).toHaveLength(3);
    expect(r.groups[0].featureIds).toEqual(['F-aa1111']);
    expect(new Set(r.groups[1].featureIds)).toEqual(new Set(['F-bb2222', 'F-cc3333']));
    expect(r.groups[2].featureIds).toEqual(['F-dd4444']);
  });

  test('mixed: A → B → C + independent D, E → groups [[A, D, E], [B], [C]]', () => {
    seedProject(
      cwd,
      {id: 'S-eeeeee', title: 'mixed', features: ['F-a11111', 'F-b22222', 'F-c33333', 'F-d44444', 'F-e55555']},
      [
        {id: 'F-a11111', slug: 'a'},
        {id: 'F-b22222', slug: 'b', depends_on: ['F-a11111']},
        {id: 'F-c33333', slug: 'c', depends_on: ['F-b22222']},
        {id: 'F-d44444', slug: 'd'},
        {id: 'F-e55555', slug: 'e'},
      ],
    );
    const r = executeDrive({scenarioId: 'S-eeeeee', cwd});
    expect(r.groups).toHaveLength(3);
    expect(new Set(r.groups[0].featureIds)).toEqual(new Set(['F-a11111', 'F-d44444', 'F-e55555']));
    expect(r.groups[1].featureIds).toEqual(['F-b22222']);
    expect(r.groups[2].featureIds).toEqual(['F-c33333']);
  });
});

describe('topologicalGroups — edge cases', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-parallel-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('cycle A → B → A → falls back to one trailing group with both', () => {
    seedProject(
      cwd,
      {id: 'S-ffffff', title: 'cycle', features: ['F-aa9999', 'F-bb8888']},
      [
        {id: 'F-aa9999', slug: 'a', depends_on: ['F-bb8888']},
        {id: 'F-bb8888', slug: 'b', depends_on: ['F-aa9999']},
      ],
    );
    const r = executeDrive({scenarioId: 'S-ffffff', cwd});
    expect(r.groups).toHaveLength(1);
    expect(new Set(r.groups[0].featureIds)).toEqual(new Set(['F-aa9999', 'F-bb8888']));
  });

  test('out-of-scenario depends_on are treated as satisfied', () => {
    seedProject(
      cwd,
      {id: 'S-007777', title: 'out-of-scope-dep', features: ['F-aa0099']},
      [
        // F-aa0099 depends on F-deaded which is NOT in the scenario;
        // the in-scenario filter treats that as already-done.
        {id: 'F-aa0099', slug: 'z', depends_on: ['F-deaded']},
      ],
    );
    const r = executeDrive({scenarioId: 'S-007777', cwd});
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].featureIds).toEqual(['F-aa0099']);
  });

  test('done/archived features are dropped before grouping', () => {
    seedProject(
      cwd,
      {id: 'S-006666', title: 'with-done', features: ['F-aa0001', 'F-bb0002', 'F-cc0003']},
      [
        {id: 'F-aa0001', slug: 'a', status: 'done'},
        {id: 'F-bb0002', slug: 'b', depends_on: ['F-aa0001']},
        {id: 'F-cc0003', slug: 'c', depends_on: ['F-bb0002']},
      ],
    );
    const r = executeDrive({scenarioId: 'S-006666', cwd});
    expect(r.plan).toEqual(['F-bb0002', 'F-cc0003']);
    // F-bb0002's only dep (F-aa0001) is done and out of the resolved
    // target set; topologicalGroups treats it as satisfied.
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].featureIds).toEqual(['F-bb0002']);
    expect(r.groups[1].featureIds).toEqual(['F-cc0003']);
  });
});

describe('topologicalGroups — event payload', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-parallel-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('drive_started event carries the groups array', () => {
    seedProject(
      cwd,
      {id: 'S-009999', title: 'event', features: ['F-aa0001', 'F-bb0002']},
      [
        {id: 'F-aa0001', slug: 'a'},
        {id: 'F-bb0002', slug: 'b'},
      ],
    );
    executeDrive({scenarioId: 'S-009999', cwd});
    const events = readEvents(cwd);
    const drive = events.find((e) => e.type === 'drive_started');
    expect(drive).toBeDefined();
    const groups = drive!.payload.groups as Array<{ordinal: number; featureIds: string[]}>;
    expect(groups).toHaveLength(1);
    expect(new Set(groups[0].featureIds)).toEqual(new Set(['F-aa0001', 'F-bb0002']));
  });

  test('instructions surface parallelism when groups have >1 feature', () => {
    seedProject(
      cwd,
      {id: 'S-008888', title: 'parallel-narrative', features: ['F-aa0001', 'F-bb0002']},
      [
        {id: 'F-aa0001', slug: 'a'},
        {id: 'F-bb0002', slug: 'b'},
      ],
    );
    const r = executeDrive({scenarioId: 'S-008888', cwd});
    expect(r.instructions).toContain('parallel group');
  });
});
