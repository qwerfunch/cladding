// Cladding · unit tests for src/report/report.ts (F-f6cc5e5a)
//
// Pure-level contract of the review-packet renderer. Written from the ACs, not
// the implementation body — a synthetic model in, deterministic markdown out.
//   - AC-cbf1c202 · six ## sections in order, byte-identical across two renders
//   - AC-cbf1c202 · buildReportModel folds inputs → sorted/deduped model
//   - AC-7672ce5d · unowned files surface under a section, owned never do,
//                   empty unowned → no section (pinned current behaviour)
//   - AC-41572299 · blank ledger carries the unknown-not-safe disclosure

import {describe, expect, test} from 'vitest';

import type {ChangelogManifest, SpecEntryRevision} from '../../src/changelog/collect.js';
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

/** The six mandated section headers, in the order the packet must present them. */
const SECTIONS = [
  '## Spec changes',
  '## How the acceptance criteria moved',
  '## Code changes → owning features',
  '## Declared tests',
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

describe('report/report — renderReportMarkdown six sections + determinism (AC-cbf1c202)', () => {
  test('emits the six mandated sections in order', () => {
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

  test('names the revision actually compared against when it differs from the named ref', () => {
    // The packet anchors on the merge base, which on a branch that forked
    // earlier is NOT the tag the reader named. An audit artifact that does not
    // say what it audited against cannot be reproduced by hand.
    const md = renderReportMarkdown(buildReportModel(mkInputs()), {
      ...META,
      baseSha: 'abc123def4560000000000000000000000000000',
    });
    expect(md).toContain('Compared against abc123def456');
    expect(md).toContain('the merge base of v0 and HEAD');
  });

  test('renders whenever a base is supplied — the CLI, not the renderer, decides', () => {
    // A ref NAME and a sha are different kinds of thing; only git can say
    // whether they denote the same commit (an annotated tag is not its own
    // commit). Comparing them here announced a difference on every linear
    // range, so the decision moved to the layer that can resolve refs.
    const md = renderReportMarkdown(buildReportModel(mkInputs()), {...META, baseSha: 'abc123def4560000000000000000000000000000'});
    expect(md).toContain('Compared against abc123def456');
  });

  test('an absent base sha renders as before — the field is additive', () => {
    const without = renderReportMarkdown(buildReportModel(mkInputs()), META);
    expect(without).not.toContain('Compared against');
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

describe('AC-e68c868a · declared tests and whether they moved with the code', () => {
  /** One touched entry whose single criterion declares `refs`. */
  function entryDeclaring(refs: readonly string[]): SpecEntryRevision {
    return {
      path: 'spec/features/thing-abcd1234.yaml',
      id: 'F-abcd1234',
      title: 'A thing',
      statusBefore: 'planned',
      statusAfter: 'done',
      baseAcs: [],
      headAcs: [{id: 'AC-0001', text: 'shall do the thing', test_refs: refs}],
    };
  }

  function statesFor(refs: readonly string[], changed: readonly string[]) {
    const model = buildReportModel(
      mkInputs({specEntries: [entryDeclaring(refs)], changedPaths: changed}),
    );
    return model.testRefRows.map((r) => r.state);
  }

  test('a declared test that also changed in the range reads as co-changed', () => {
    expect(statesFor(['tests/thing.test.ts'], ['tests/thing.test.ts'])).toEqual(['co-changed']);
  });

  test('a declared test that did not change reads as unchanged', () => {
    expect(statesFor(['tests/thing.test.ts'], ['src/thing.ts'])).toEqual(['unchanged']);
  });

  test('an anchored reference resolves on its file path, not the whole string', () => {
    expect(statesFor(['tests/thing.test.ts#some case'], ['tests/thing.test.ts'])).toEqual([
      'co-changed',
    ]);
  });

  test('a declared test with no file on disk is not passed off as an untouched test', () => {
    // Every sibling existence check is done-only, so this status-blind section
    // is the only surface that speaks for planned/in_progress entries — and
    // "unchanged" there reads as "a real test that simply did not move".
    const model = buildReportModel(
      mkInputs({
        specEntries: [entryDeclaring(['tests/gone.test.ts'])],
        changedPaths: [],
        missingTestRefs: ['tests/gone.test.ts'],
      }),
    );
    expect(model.testRefRows.map((r) => r.state)).toEqual(['missing']);
  });

  test('a missing file wins over co-change — a path that cannot exist did not move', () => {
    const model = buildReportModel(
      mkInputs({
        specEntries: [entryDeclaring(['tests/gone.test.ts'])],
        changedPaths: ['tests/gone.test.ts'],
        missingTestRefs: ['tests/gone.test.ts'],
      }),
    );
    expect(model.testRefRows[0]?.state).toBe('missing');
  });

  test('a harness-written placeholder is never reported as an untouched test', () => {
    // `clad sync` writes `derived:` refs as unconfirmed suggestions. Rendering
    // one as "declared but did not change" would pass a harness guess off as a
    // reviewed fact.
    for (const pseudo of ['derived:tests/thing.test.ts', 'fixture:NAME', 'script:build', 'self-dogfood:x']) {
      expect(statesFor([pseudo], [])).toEqual(['placeholder']);
    }
  });

  test('[covers:F-5dfbac9c/AC-e68c868a] every declared ref reports co-change, unchanged, missing, or placeholder from its concrete path', () => {
    const model = buildReportModel(
      mkInputs({
        specEntries: [entryDeclaring([
          'tests/moved.test.ts#proof',
          'tests/still.test.ts',
          'tests/gone.test.ts',
          'derived:tests/suggested.test.ts',
        ])],
        changedPaths: ['tests/moved.test.ts'],
        missingTestRefs: ['tests/gone.test.ts'],
      }),
    );
    expect(model.testRefRows.map((item) => [item.ref, item.state])).toEqual([
      ['derived:tests/suggested.test.ts', 'placeholder'],
      ['tests/gone.test.ts', 'missing'],
      ['tests/moved.test.ts#proof', 'co-changed'],
      ['tests/still.test.ts', 'unchanged'],
    ]);
  });

  test('the row keeps the reference exactly as authored, anchor included', () => {
    const model = buildReportModel(
      mkInputs({specEntries: [entryDeclaring(['tests/thing.test.ts#some case'])], changedPaths: []}),
    );
    expect(model.testRefRows[0]?.ref).toBe('tests/thing.test.ts#some case');
    expect(model.testRefRows[0]?.acId).toBe('AC-0001');
    expect(model.testRefRows[0]?.featureId).toBe('F-abcd1234');
  });

  test('rows sort by feature, then criterion, then reference', () => {
    const model = buildReportModel(
      mkInputs({specEntries: [entryDeclaring(['tests/z.test.ts', 'tests/a.test.ts'])], changedPaths: []}),
    );
    expect(model.testRefRows.map((r) => r.ref)).toEqual(['tests/a.test.ts', 'tests/z.test.ts']);
  });

  test('the section renders and states which files moved', () => {
    const md = renderReportMarkdown(
      buildReportModel(
        mkInputs({specEntries: [entryDeclaring(['tests/thing.test.ts'])], changedPaths: ['tests/thing.test.ts']}),
      ),
      META,
    );
    expect(md).toContain('## Declared tests');
    expect(md).toContain('tests/thing.test.ts');
  });

  test('a range with no touched entry says so rather than rendering an empty list', () => {
    const md = renderReportMarkdown(buildReportModel(mkInputs()), META);
    expect(md).toContain('No touched entry declares a test.');
  });

  test('the packet grades nothing — a production path declared as a test gets the same states as any other', () => {
    // Whether a declared test genuinely verifies its criterion is not
    // mechanically decidable, so the packet reports movement and withholds
    // judgement. A criterion pointing at production source must therefore be
    // described exactly like one pointing at a test file.
    const model = buildReportModel(
      mkInputs({specEntries: [entryDeclaring(['src/thing.ts'])], changedPaths: []}),
    );
    expect(model.testRefRows.map((r) => r.state)).toEqual(['unchanged']);

    const md = renderReportMarkdown(model, META);
    const section = md.slice(md.indexOf('## Declared tests'));
    for (const verdict of ['circular', 'vacuous', 'invalid', 'FAIL', 'suspect']) {
      expect(section).not.toContain(verdict);
    }
  });
});

describe('AC-c32cbab2 · the criterion-movement section in the rendered packet', () => {
  test('the section names the status transition and every non-unchanged criterion', () => {
    const md = renderReportMarkdown(
      buildReportModel(
        mkInputs({
          specEntries: [
            {
              path: 'spec/features/thing-abcd1234.yaml',
              id: 'F-abcd1234',
              title: 'A thing',
              statusBefore: 'planned',
              statusAfter: 'done',
              baseAcs: [{id: 'AC-0001', text: 'shall always', ears: 'state'}],
              headAcs: [
                {id: 'AC-0001', text: 'shall never', ears: 'unwanted'},
                {id: 'AC-0002', text: 'a fresh one'},
              ],
            },
          ],
        }),
      ),
      META,
    );
    expect(md).toContain('## How the acceptance criteria moved');
    expect(md).toContain('planned → done');
    expect(md).toContain('REWRITTEN AC-0001');
    expect(md).toContain('state → unwanted');
    expect(md).toContain('NEW AC-0002');
  });

  test('a range that moved no spec entry says so', () => {
    const md = renderReportMarkdown(buildReportModel(mkInputs()), META);
    expect(md).toContain('No feature spec entry changed in this range.');
  });
});
