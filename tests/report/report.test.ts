// Cladding · unit tests for src/report/report.ts (F-f6cc5e5a)
//
// Pure-level contract of the review-packet renderer. Written from the ACs, not
// the implementation body — a synthetic model in, deterministic markdown out.
//   - AC-cbf1c202 · four ## sections in order, byte-identical across two renders
//   - AC-cbf1c202 · buildReportModel folds inputs → sorted/deduped model
//   - AC-7672ce5d · unowned files surface under a section, owned never do,
//                   empty unowned → no section (pinned current behaviour)
//   - AC-41572299 · blank ledger carries the unknown-not-safe disclosure

import {describe, expect, test} from 'vitest';

import type {ChangelogManifest} from '../../src/changelog/collect.js';
import {
  buildReportModel,
  renderReportMarkdown,
  type CodeChangeInput,
  type GateStateInput,
  type ReportInputs,
  type ReportMeta,
} from '../../src/report/report.js';

/** A minimal, valid ChangelogManifest with one shipped feature. */
function mkManifest(): ChangelogManifest {
  return {
    groups: [
      {
        capability: 'uncategorized',
        title: 'Uncategorized',
        features: [
          {id: 'F-0001', title: 'One feature', change: 'flipped-to-done', acceptance: []},
        ],
      },
    ],
    head: 'deadbeefcafe0000000000000000000000000000',
    inventory: {
      before: {capabilities: 1, features: 1, scenarios: 0, test_files: 0},
      after: {capabilities: 1, features: 2, scenarios: 0, test_files: 1},
    },
    since: 'v0',
    unsharded_commits: [],
  };
}

const NO_GATE: GateStateInput = {attestedCount: null, lastGateRun: null};

const META: ReportMeta = {sinceRef: 'v0', head: 'deadbeefcafe0000000000000000000000000000'};

/** The four mandated section headers, in the order the packet must present them. */
const SECTIONS = [
  '## Spec changes',
  '## Code changes → owning features',
  '## Regression set',
  '## Gate & attestation',
] as const;

function mkInputs(overrides: Partial<ReportInputs> = {}): ReportInputs {
  return {
    specChanges: mkManifest(),
    codeChanges: [],
    ledgerEmpty: false,
    gate: NO_GATE,
    ...overrides,
  };
}

describe('report/report — buildReportModel (AC-cbf1c202)', () => {
  test('partitions changed files into owned vs unowned by owner count', () => {
    const codeChanges: CodeChangeInput[] = [
      {path: 'src/orphan.ts', owners: [], testRefs: []},
      {path: 'src/owned.ts', owners: [{id: 'F-aaa', title: 'Alpha'}], testRefs: ['tests/a.test.ts#x']},
    ];
    const model = buildReportModel(mkInputs({codeChanges}));
    expect(model.codeChanges.map((c) => c.path)).toEqual(['src/owned.ts']);
    expect(model.unowned).toEqual(['src/orphan.ts']);
  });

  test('sorts owned changes by path and unowned by path', () => {
    const codeChanges: CodeChangeInput[] = [
      {path: 'src/z.ts', owners: [{id: 'F-a', title: 'A'}], testRefs: []},
      {path: 'src/a.ts', owners: [{id: 'F-a', title: 'A'}], testRefs: []},
      {path: 'src/y.ts', owners: [], testRefs: []},
      {path: 'src/b.ts', owners: [], testRefs: []},
    ];
    const model = buildReportModel(mkInputs({codeChanges}));
    expect(model.codeChanges.map((c) => c.path)).toEqual(['src/a.ts', 'src/z.ts']);
    expect(model.unowned).toEqual(['src/b.ts', 'src/y.ts']);
  });

  test('regression set is the deduped, sorted union of test_refs across every changed file', () => {
    const codeChanges: CodeChangeInput[] = [
      {path: 'src/a.ts', owners: [{id: 'F-a', title: 'A'}], testRefs: ['tests/b.test.ts#2', 'tests/a.test.ts#1']},
      {path: 'src/b.ts', owners: [{id: 'F-b', title: 'B'}], testRefs: ['tests/a.test.ts#1', 'tests/c.test.ts#3']},
    ];
    const model = buildReportModel(mkInputs({codeChanges}));
    expect(model.regressionSet).toEqual([
      'tests/a.test.ts#1',
      'tests/b.test.ts#2',
      'tests/c.test.ts#3',
    ]);
  });

  test('dedupes owners on a file and sorts them by id', () => {
    const codeChanges: CodeChangeInput[] = [
      {
        path: 'src/a.ts',
        owners: [
          {id: 'F-z', title: 'Zed'},
          {id: 'F-a', title: 'Ay'},
          {id: 'F-z', title: 'Zed'},
        ],
        testRefs: [],
      },
    ];
    const model = buildReportModel(mkInputs({codeChanges}));
    expect(model.codeChanges[0].owners.map((o) => o.id)).toEqual(['F-a', 'F-z']);
  });

  test('carries the ledgerEmpty flag through to the model unchanged', () => {
    expect(buildReportModel(mkInputs({ledgerEmpty: true})).ledgerEmpty).toBe(true);
    expect(buildReportModel(mkInputs({ledgerEmpty: false})).ledgerEmpty).toBe(false);
  });
});

describe('report/report — renderReportMarkdown four sections + determinism (AC-cbf1c202)', () => {
  test('emits the four mandated sections in order', () => {
    const model = buildReportModel(
      mkInputs({
        codeChanges: [
          {path: 'src/owned.ts', owners: [{id: 'F-a', title: 'Alpha'}], testRefs: ['tests/a.test.ts#x']},
        ],
      }),
    );
    const md = renderReportMarkdown(model, META);
    const positions = SECTIONS.map((h) => md.indexOf(h));
    // every section present …
    for (const [i, pos] of positions.entries()) {
      expect(pos, `section ${SECTIONS[i]} missing`).toBeGreaterThanOrEqual(0);
    }
    // … and strictly increasing (i.e. in the mandated order).
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test('two renders on the same model are byte-identical', () => {
    const model = buildReportModel(
      mkInputs({
        codeChanges: [
          {path: 'src/b.ts', owners: [{id: 'F-b', title: 'Bee'}], testRefs: ['tests/b.test.ts#y']},
          {path: 'src/a.ts', owners: [{id: 'F-a', title: 'Ay'}], testRefs: ['tests/a.test.ts#x']},
          {path: 'src/orphan.ts', owners: [], testRefs: []},
        ],
      }),
    );
    const first = renderReportMarkdown(model, META);
    const second = renderReportMarkdown(model, META);
    expect(second).toBe(first);
  });

  test('the header stamps the since ref and a short HEAD, both stable for a fixed state', () => {
    const md = renderReportMarkdown(buildReportModel(mkInputs()), META);
    expect(md).toContain('# Review packet — v0..deadbeefcafe');
  });
});

describe('report/report — unowned surfacing (AC-7672ce5d)', () => {
  test('lists an unowned changed file under an Unowned changes section', () => {
    const model = buildReportModel(
      mkInputs({
        codeChanges: [
          {path: 'src/owned.ts', owners: [{id: 'F-a', title: 'Alpha'}], testRefs: []},
          {path: 'src/orphan.ts', owners: [], testRefs: []},
        ],
      }),
    );
    const md = renderReportMarkdown(model, META);
    expect(md).toContain('### Unowned changes');
    expect(md).toContain('- src/orphan.ts');
  });

  test('an owned file never appears under the Unowned changes section', () => {
    const model = buildReportModel(
      mkInputs({
        codeChanges: [
          {path: 'src/owned.ts', owners: [{id: 'F-a', title: 'Alpha'}], testRefs: []},
          {path: 'src/orphan.ts', owners: [], testRefs: []},
        ],
      }),
    );
    const md = renderReportMarkdown(model, META);
    const unownedBlock = md.slice(md.indexOf('### Unowned changes'));
    expect(unownedBlock).not.toContain('src/owned.ts');
  });

  test('no unowned changes → no Unowned changes section at all', () => {
    const model = buildReportModel(
      mkInputs({
        codeChanges: [{path: 'src/owned.ts', owners: [{id: 'F-a', title: 'Alpha'}], testRefs: []}],
      }),
    );
    const md = renderReportMarkdown(model, META);
    expect(md).not.toContain('### Unowned changes');
  });
});

describe('report/report — blank-ledger disclosure (AC-41572299)', () => {
  test('an empty ledger carries the unknown-not-safe disclosure in the regression section', () => {
    const md = renderReportMarkdown(buildReportModel(mkInputs({ledgerEmpty: true})), META);
    expect(md).toContain('UNKNOWN, not safe');
    expect(md).toContain('dependency ledger is empty');
  });

  test('a non-empty ledger carries no such disclosure', () => {
    const md = renderReportMarkdown(buildReportModel(mkInputs({ledgerEmpty: false})), META);
    expect(md).not.toContain('UNKNOWN, not safe');
    expect(md).not.toContain('dependency ledger is empty');
  });
});
