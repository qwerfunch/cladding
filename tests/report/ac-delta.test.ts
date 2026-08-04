// Cladding · unit tests for src/report/ac-delta.ts (F-5dfbac9c)
//
// Written from the acceptance criteria, not the implementation body: synthetic
// revision pairs in, a classification out.
//   - AC-c32cbab2 · new / rewritten / removed / unchanged, joined on criterion
//                   id; a differing text, EARS pattern, or condition is a
//                   rewrite; a whitespace-only difference is not
//   - AC-4faef94d · rows ordered by criterion id, no wall-clock, byte-stable

import {describe, expect, test} from 'vitest';

import type {SpecEntryRevision} from '../../src/changelog/collect.js';
import {buildSpecEntryDeltas} from '../../src/report/ac-delta.js';
import type {AcceptanceCriterion} from '../../src/spec/types.js';

function ac(id: string, over: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {id, text: 'the system shall do the thing', ears: 'ubiquitous', ...over};
}

function entry(
  baseAcs: readonly AcceptanceCriterion[],
  headAcs: readonly AcceptanceCriterion[],
  over: Partial<SpecEntryRevision> = {},
): SpecEntryRevision {
  return {
    path: 'spec/features/thing-abcd1234.yaml',
    id: 'F-abcd1234',
    title: 'A thing',
    statusBefore: 'planned',
    statusAfter: 'done',
    baseAcs,
    headAcs,
    ...over,
  };
}

/** One entry's delta from a base/head criterion pair — the common shape below. */
function buildSpecDeltasFor(
  baseAcs: readonly AcceptanceCriterion[],
  headAcs: readonly AcceptanceCriterion[],
) {
  return buildSpecEntryDeltas([entry(baseAcs, headAcs)]);
}

/** The single row for `id`, asserted to exist. */
function row(deltas: ReturnType<typeof buildSpecEntryDeltas>, id: string) {
  const found = deltas[0]?.rows.find((r) => r.id === id);
  expect(found, `expected a row for ${id}`).toBeDefined();
  return found!;
}

describe('AC-c32cbab2 · classifying how each criterion moved', () => {
  test('a criterion absent at the base is new', () => {
    const d = buildSpecEntryDeltas([entry([], [ac('AC-0001')])]);
    expect(row(d, 'AC-0001').kind).toBe('new');
    expect(d[0]?.counts.new).toBe(1);
  });

  test('a criterion absent at HEAD is removed — a silent deletion still reports', () => {
    const d = buildSpecEntryDeltas([entry([ac('AC-0001')], [])]);
    expect(row(d, 'AC-0001').kind).toBe('removed');
    expect(d[0]?.counts.removed).toBe(1);
  });

  test('an identical criterion is unchanged', () => {
    const d = buildSpecEntryDeltas([entry([ac('AC-0001')], [ac('AC-0001')])]);
    expect(row(d, 'AC-0001').kind).toBe('unchanged');
  });

  test('changed statement text is a rewrite', () => {
    const d = buildSpecEntryDeltas([
      entry([ac('AC-0001', {text: 'shall always run the kill'})], [ac('AC-0001', {text: 'shall never run the kill'})]),
    ]);
    expect(row(d, 'AC-0001').kind).toBe('rewritten');
  });

  test('changed trigger condition is a rewrite even when the text is identical', () => {
    const d = buildSpecEntryDeltas([
      entry(
        [ac('AC-0001', {ears: 'event', condition: 'when the app exits'})],
        [ac('AC-0001', {ears: 'event', condition: 'when the device disconnects'})],
      ),
    ]);
    expect(row(d, 'AC-0001').kind).toBe('rewritten');
  });

  test('a changed EARS pattern is a rewrite and names the shift', () => {
    const d = buildSpecEntryDeltas([
      entry([ac('AC-0001', {ears: 'state'})], [ac('AC-0001', {ears: 'unwanted'})]),
    ]);
    const r = row(d, 'AC-0001');
    expect(r.kind).toBe('rewritten');
    expect(r.earsShift).toBe('state → unwanted');
  });

  test('an unshifted rewrite carries no pattern annotation', () => {
    const d = buildSpecEntryDeltas([
      entry([ac('AC-0001', {text: 'one'})], [ac('AC-0001', {text: 'two'})]),
    ]);
    expect(row(d, 'AC-0001').earsShift).toBeUndefined();
  });

  test('whitespace-only differences are not a rewrite — reflowing a line is not a contract change', () => {
    const d = buildSpecEntryDeltas([
      entry(
        [ac('AC-0001', {text: 'the system shall  do\n  the thing'})],
        [ac('AC-0001', {text: 'the system shall do the thing'})],
      ),
    ]);
    expect(row(d, 'AC-0001').kind).toBe('unchanged');
  });

  test('a changed EARS action is a rewrite — it IS the obligation', () => {
    // `action` renders to the impl-blind oracle as "system shall:", so rewriting
    // it rewrites the requirement. 79% of this project's own criteria carry it,
    // and a sibling corpus has criteria with NO `text` at all — there the whole
    // obligation lives in these fields.
    const d = buildSpecDeltasFor(
      [ac('AC-0001', {text: undefined, ears: 'event', condition: 'when a file is uploaded', action: 'route it by filename extension'})],
      [ac('AC-0001', {text: undefined, ears: 'event', condition: 'when a file is uploaded', action: 'route it by validated content'})],
    );
    expect(row(d, 'AC-0001').kind).toBe('rewritten');
  });

  test('a changed EARS response is a rewrite', () => {
    const d = buildSpecDeltasFor(
      [ac('AC-0001', {response: 'the upload is accepted'})],
      [ac('AC-0001', {response: 'the upload is rejected'})],
    );
    expect(row(d, 'AC-0001').kind).toBe('rewritten');
  });

  test('an identical EARS-only criterion is still unchanged', () => {
    const same = {text: undefined, ears: 'state' as const, condition: 'while idle', action: 'hold the latch', response: 'nothing spawns'};
    const d = buildSpecDeltasFor([ac('AC-0001', same)], [ac('AC-0001', same)]);
    expect(row(d, 'AC-0001').kind).toBe('unchanged');
  });

  test('an expanded rationale alone is not a rewrite — notes are outside the contract key', () => {
    const d = buildSpecEntryDeltas([
      entry([ac('AC-0001', {notes: 'brief'})], [ac('AC-0001', {notes: 'a much longer WHY'})]),
    ]);
    expect(row(d, 'AC-0001').kind).toBe('unchanged');
  });

  test('the id is the join key — a polarity flip under a held id reads as one rewrite, not add+remove', () => {
    // The live reversal that motivated the feature: text flipped, pattern moved
    // state → unwanted, id unchanged.
    const d = buildSpecEntryDeltas([
      entry(
        [ac('AC-d7eb3f', {ears: 'state', text: 'the system shall still run adb kill-server'})],
        [ac('AC-d7eb3f', {ears: 'unwanted', text: 'the system shall never issue adb kill-server'})],
      ),
    ]);
    expect(d[0]?.counts).toEqual({new: 0, rewritten: 1, removed: 0, unchanged: 0});
  });

  test('a duplicated criterion id does not let the later occurrence hide a rewrite', () => {
    // A duplicate is invalid and the strict gate says so — but `clad report`
    // gates nothing, so it renders exactly in the window before green, where a
    // first-wins join reported "unchanged" while the packet's own spec-changes
    // section printed the new text. The packet must not contradict itself.
    const d = buildSpecDeltasFor(
      [ac('AC-0001', {text: 'first'}), ac('AC-0001', {text: 'second'})],
      [ac('AC-0001', {text: 'first'}), ac('AC-0001', {text: 'second REWRITTEN'})],
    );
    expect(d[0]?.counts.rewritten).toBe(1);
    expect(d[0]?.counts.unchanged).toBe(1);
  });

  test('a surplus duplicate at head is new; a surplus at base is removed', () => {
    const added = buildSpecDeltasFor([ac('AC-0001')], [ac('AC-0001'), ac('AC-0001')]);
    expect(added[0]?.counts).toMatchObject({new: 1, unchanged: 1});
    const dropped = buildSpecDeltasFor([ac('AC-0001'), ac('AC-0001')], [ac('AC-0001')]);
    expect(dropped[0]?.counts).toMatchObject({removed: 1, unchanged: 1});
  });

  test('the status transition rides along with the delta', () => {
    const d = buildSpecEntryDeltas([entry([], [], {statusBefore: 'planned', statusAfter: 'done'})]);
    expect(d[0]?.statusBefore).toBe('planned');
    expect(d[0]?.statusAfter).toBe('done');
  });

  test('an entry added within the range has a null base status', () => {
    const d = buildSpecEntryDeltas([entry([], [ac('AC-0001')], {statusBefore: null})]);
    expect(d[0]?.statusBefore).toBeNull();
    expect(row(d, 'AC-0001').kind).toBe('new');
  });
});

describe('AC-4faef94d · deterministic ordering', () => {
  test('rows sort by criterion id regardless of authored order', () => {
    const d = buildSpecEntryDeltas([
      entry([], [ac('AC-zzzz'), ac('AC-aaaa'), ac('AC-mmmm')]),
    ]);
    expect(d[0]?.rows.map((r) => r.id)).toEqual(['AC-aaaa', 'AC-mmmm', 'AC-zzzz']);
  });

  test('entries sort by feature id', () => {
    const d = buildSpecEntryDeltas([
      entry([], [], {id: 'F-cccc'}),
      entry([], [], {id: 'F-aaaa'}),
    ]);
    expect(d.map((x) => x.id)).toEqual(['F-aaaa', 'F-cccc']);
  });

  test('two builds over the same input serialize byte-identically', () => {
    const input = [entry([ac('AC-0002')], [ac('AC-0001'), ac('AC-0002', {text: 'moved'})])];
    expect(JSON.stringify(buildSpecEntryDeltas(input))).toBe(
      JSON.stringify(buildSpecEntryDeltas(input)),
    );
  });

  test('an empty range yields an empty delta, not a throw', () => {
    expect(buildSpecEntryDeltas([])).toEqual([]);
  });
});
