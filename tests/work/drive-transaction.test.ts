// Cladding · unit tests for src/work/drive-transaction.ts (0.4.4, F-d23cd4)

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors} from '../../src/stages/drift.js';
import {
  completeDrive,
  executeDrive,
  NoMatchingScenarioError,
  ScenarioNotFoundError,
} from '../../src/work/drive-transaction.js';

interface SeedFeature {
  readonly id: string;
  readonly slug: string;
  readonly status: 'planned' | 'in_progress' | 'done' | 'blocked' | 'archived';
  readonly modules?: readonly string[];
  readonly depends_on?: readonly string[];
}

interface SeedScenario {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly flow?: string;
  readonly features: readonly string[];
}

function seedProject(cwd: string, scenarios: SeedScenario[], features: SeedFeature[]): void {
  // Root spec.yaml — minimal but loader-friendly.
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
  // Per-feature shards.
  const featuresDir = join(cwd, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});
  for (const f of features) {
    const modulesBlock =
      f.modules && f.modules.length > 0 ? `modules:\n${f.modules.map((m) => `  - ${m}`).join('\n')}\n` : 'modules: []\n';
    const depsBlock =
      f.depends_on && f.depends_on.length > 0
        ? `depends_on:\n${f.depends_on.map((d) => `  - ${d}`).join('\n')}\n`
        : '';
    writeFileSync(
      join(featuresDir, `${f.slug}-${f.id.slice(2)}.yaml`),
      [
        `id: ${f.id}`,
        `slug: ${f.slug}`,
        `title: "${f.slug}"`,
        `status: ${f.status}`,
        modulesBlock.trimEnd(),
        depsBlock.trimEnd(),
        'acceptance_criteria: []',
        '',
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    );
  }
  // Per-scenario shards.
  const scenariosDir = join(cwd, 'spec', 'scenarios');
  mkdirSync(scenariosDir, {recursive: true});
  for (const s of scenarios) {
    const featuresLine =
      s.features.length === 0 ? 'features: []' : `features:\n${s.features.map((f) => `  - ${f}`).join('\n')}`;
    writeFileSync(
      join(scenariosDir, `${s.slug}-${s.id.slice(2)}.yaml`),
      [
        `id: ${s.id}`,
        `slug: ${s.slug}`,
        `title: "${s.title}"`,
        s.flow ? `flow: |\n  ${s.flow.replace(/\n/g, '\n  ')}` : '',
        featuresLine,
        '',
      ]
        .filter((l) => l.length > 0)
        .join('\n'),
    );
  }
}

describe('executeDrive — scenarioId mode', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-'));
    clearDetectors();
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('returns ordered plan + auto-enters first feature + emits drive_started event', () => {
    seedProject(
      cwd,
      [
        {
          id: 'S-aaaaaa',
          slug: 'cart',
          title: 'Cart checkout',
          flow: 'User adds items then checks out',
          features: ['F-111111', 'F-222222'],
        },
      ],
      [
        {id: 'F-111111', slug: 'cart-add', status: 'planned', modules: ['src/cart/add.ts']},
        {id: 'F-222222', slug: 'cart-checkout', status: 'planned', modules: ['src/cart/checkout.ts']},
      ],
    );
    const result = executeDrive({scenarioId: 'S-aaaaaa', cwd});
    expect(result.scenarioId).toBe('S-aaaaaa');
    expect(result.plan).toEqual(['F-111111', 'F-222222']);
    expect(result.firstWork).toBeDefined();
    expect(result.firstWork?.featureId).toBe('F-111111');
    expect(result.firstWork?.status).toBe('entered');

    // Event log received drive_started.
    const events = readFileSync(join(cwd, '.cladding', 'events.log.jsonl'), 'utf8');
    expect(events).toContain('"type":"drive_started"');
    expect(events).toContain('"scenarioId":"S-aaaaaa"');
  });

  test('throws ScenarioNotFoundError for unknown id', () => {
    seedProject(cwd, [], []);
    expect(() => executeDrive({scenarioId: 'S-zzzzzz', cwd})).toThrow(ScenarioNotFoundError);
  });

  test('skips done/archived features in plan', () => {
    seedProject(
      cwd,
      [{id: 'S-bbbbbb', slug: 'mixed', title: 'Mixed', features: ['F-333333', 'F-444444', 'F-555555']}],
      [
        {id: 'F-333333', slug: 'first', status: 'done'},
        {id: 'F-444444', slug: 'middle', status: 'archived'},
        {id: 'F-555555', slug: 'pending', status: 'planned', modules: ['src/x.ts']},
      ],
    );
    const result = executeDrive({scenarioId: 'S-bbbbbb', cwd});
    expect(result.plan).toEqual(['F-555555']);
  });

  test('empty plan (all features done) returns no firstWork', () => {
    seedProject(
      cwd,
      [{id: 'S-cccccc', slug: 'all-done', title: 'All Done', features: ['F-666666']}],
      [{id: 'F-666666', slug: 'finished', status: 'done'}],
    );
    const result = executeDrive({scenarioId: 'S-cccccc', cwd});
    expect(result.plan).toEqual([]);
    expect(result.firstWork).toBeUndefined();
  });

  test('respects depends_on ordering', () => {
    seedProject(
      cwd,
      [{id: 'S-dddddd', slug: 'deps', title: 'Deps', features: ['F-777777', 'F-888888', 'F-999999']}],
      [
        // Author order is 777, 888, 999 — but 888 depends on 999, so plan must put 999 first.
        {id: 'F-777777', slug: 'a', status: 'planned', modules: ['src/a.ts']},
        {id: 'F-888888', slug: 'b', status: 'planned', modules: ['src/b.ts'], depends_on: ['F-999999']},
        {id: 'F-999999', slug: 'c', status: 'planned', modules: ['src/c.ts']},
      ],
    );
    const result = executeDrive({scenarioId: 'S-dddddd', cwd});
    // 777 (no deps) and 999 (no deps) are both ready; 888 must come after 999.
    expect(result.plan.indexOf('F-999999')).toBeLessThan(result.plan.indexOf('F-888888'));
  });
});

describe('executeDrive — intent mode', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-'));
    clearDetectors();
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('matches scenario by intent substring against title + flow', () => {
    seedProject(
      cwd,
      [
        {
          id: 'S-eeeeee',
          slug: 'auth',
          title: 'Authentication flow',
          flow: 'User logs in via OAuth',
          features: ['F-aaaaaa'],
        },
        {
          id: 'S-ffffff',
          slug: 'cart',
          title: 'Cart checkout',
          flow: 'User pays',
          features: ['F-bbbbbb'],
        },
      ],
      [
        {id: 'F-aaaaaa', slug: 'login', status: 'planned', modules: ['src/auth.ts']},
        {id: 'F-bbbbbb', slug: 'pay', status: 'planned', modules: ['src/pay.ts']},
      ],
    );
    const result = executeDrive({intent: 'add oauth login support', cwd});
    expect(result.scenarioId).toBe('S-eeeeee');
  });

  test('throws NoMatchingScenarioError when intent matches nothing', () => {
    seedProject(
      cwd,
      [{id: 'S-aaaaaa', slug: 'auth', title: 'Auth', flow: 'login', features: []}],
      [],
    );
    expect(() => executeDrive({intent: 'completely unrelated topic xyz', cwd})).toThrow(NoMatchingScenarioError);
  });

  test('throws when neither scenarioId nor intent is supplied', () => {
    seedProject(cwd, [], []);
    expect(() => executeDrive({cwd})).toThrow(/scenarioId or intent/);
  });
});

describe('completeDrive', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-drive-'));
    clearDetectors();
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('partitions features into passed / failed / pending and emits drive_completed', () => {
    seedProject(
      cwd,
      [{id: 'S-aaaaaa', slug: 'mix', title: 'Mix', features: ['F-111111', 'F-222222', 'F-333333']}],
      [
        {id: 'F-111111', slug: 'one', status: 'done'},
        {id: 'F-222222', slug: 'two', status: 'blocked'},
        {id: 'F-333333', slug: 'three', status: 'in_progress'},
      ],
    );
    const result = completeDrive({scenarioId: 'S-aaaaaa', cwd});
    expect(result.featuresPassed).toEqual(['F-111111']);
    expect(result.featuresFailed).toEqual(['F-222222']);
    expect(result.featuresPending).toEqual(['F-333333']);
    const events = readFileSync(join(cwd, '.cladding', 'events.log.jsonl'), 'utf8');
    expect(events).toContain('"type":"drive_completed"');
  });

  test('throws ScenarioNotFoundError for unknown scenarioId', () => {
    seedProject(cwd, [], []);
    expect(() => completeDrive({scenarioId: 'S-zzzzzz', cwd})).toThrow(ScenarioNotFoundError);
  });
});
