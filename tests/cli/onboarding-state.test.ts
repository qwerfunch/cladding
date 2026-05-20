// Cladding · unit tests for cli/scan/onboarding-state (v0.3.44, F-09d68b)
//
// Pure I/O tests over a tmpdir. Each test exercises one helper or
// state-mutation path so the refine handler can rely on the
// contract without re-asserting it.

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  appendNewQuestions,
  firstPendingIndex,
  isComplete,
  loadState,
  markDone,
  markFirstPendingAnswered,
  saveState,
  type OnboardingState,
} from '../../src/cli/scan/onboarding-state.js';

function fakeState(over: Partial<OnboardingState> = {}): OnboardingState {
  return {
    intent: 'demo intent',
    language: 'typescript',
    projectName: 'demo',
    mode: 'greenfield',
    startedAt: '2026-05-21T00:00:00.000Z',
    status: 'active',
    qa: [
      {question: 'Q1?', answer: null},
      {question: 'Q2?', answer: null},
    ],
    ...over,
  };
}

describe('saveState / loadState round-trip', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-state-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('writes the file under .cladding/onboarding/state.yaml', () => {
    saveState(dir, fakeState());
    expect(existsSync(join(dir, '.cladding', 'onboarding', 'state.yaml'))).toBe(true);
  });

  test('loadState returns the same shape that was saved', () => {
    const state = fakeState({intent: '결제 SaaS for B2B'});
    saveState(dir, state);
    expect(loadState(dir)).toEqual(state);
  });

  test('loadState returns null when no state file exists', () => {
    expect(loadState(dir)).toBeNull();
  });

  test('loadState normalises a hand-edited mode value', () => {
    mkdirSync(join(dir, '.cladding', 'onboarding'), {recursive: true});
    writeFileSync(
      join(dir, '.cladding', 'onboarding', 'state.yaml'),
      [
        'intent: demo',
        'language: typescript',
        'projectName: demo',
        'mode: bogus',
        'startedAt: 2026-05-21T00:00:00.000Z',
        'status: active',
        'qa: []',
      ].join('\n'),
      'utf8',
    );
    expect(loadState(dir)?.mode).toBe('greenfield');
  });

  test('loadState coerces hand-edited answer null/undefined to null', () => {
    mkdirSync(join(dir, '.cladding', 'onboarding'), {recursive: true});
    writeFileSync(
      join(dir, '.cladding', 'onboarding', 'state.yaml'),
      [
        'intent: demo',
        'language: typescript',
        'projectName: demo',
        'mode: greenfield',
        'startedAt: 2026-05-21T00:00:00.000Z',
        'status: active',
        'qa:',
        '  - question: Q1',
        '  - question: Q2',
        '    answer: ~',
      ].join('\n'),
      'utf8',
    );
    expect(loadState(dir)?.qa).toEqual([
      {question: 'Q1', answer: null},
      {question: 'Q2', answer: null},
    ]);
  });

  test('saved YAML preserves Unicode (intent in Korean)', () => {
    saveState(dir, fakeState({intent: '결제 SaaS for B2B'}));
    const raw = readFileSync(join(dir, '.cladding', 'onboarding', 'state.yaml'), 'utf8');
    expect(raw).toContain('결제 SaaS for B2B');
  });
});

describe('firstPendingIndex', () => {
  test('returns 0 when every question is pending', () => {
    expect(firstPendingIndex(fakeState())).toBe(0);
  });

  test('returns the index of the first null answer', () => {
    const state = fakeState({
      qa: [
        {question: 'Q1', answer: 'A1'},
        {question: 'Q2', answer: null},
        {question: 'Q3', answer: null},
      ],
    });
    expect(firstPendingIndex(state)).toBe(1);
  });

  test('returns -1 when every question is answered', () => {
    const state = fakeState({
      qa: [
        {question: 'Q1', answer: 'A1'},
        {question: 'Q2', answer: 'A2'},
      ],
    });
    expect(firstPendingIndex(state)).toBe(-1);
  });

  test('returns -1 on empty qa array', () => {
    expect(firstPendingIndex(fakeState({qa: []}))).toBe(-1);
  });
});

describe('markFirstPendingAnswered', () => {
  test('fills in the first null answer and leaves others intact', () => {
    const before = fakeState();
    const after = markFirstPendingAnswered(before, '법인 사업자만');
    expect(after.qa[0].answer).toBe('법인 사업자만');
    expect(after.qa[1].answer).toBeNull();
    // immutable — original unchanged
    expect(before.qa[0].answer).toBeNull();
  });

  test('throws when no question is pending', () => {
    const state = fakeState({
      qa: [
        {question: 'Q1', answer: 'A1'},
        {question: 'Q2', answer: 'A2'},
      ],
    });
    expect(() => markFirstPendingAnswered(state, 'late')).toThrow(/no pending question/);
  });
});

describe('appendNewQuestions', () => {
  test('appends questions not already present', () => {
    const before = fakeState();
    const after = appendNewQuestions(before, ['Q3?', 'Q4?']);
    expect(after.qa).toHaveLength(4);
    expect(after.qa[2]).toEqual({question: 'Q3?', answer: null});
    expect(after.qa[3]).toEqual({question: 'Q4?', answer: null});
  });

  test('de-duplicates questions that are already present (regardless of answer state)', () => {
    const before = fakeState({
      qa: [
        {question: 'Q1?', answer: 'A1'},
        {question: 'Q2?', answer: null},
      ],
    });
    const after = appendNewQuestions(before, ['Q1?', 'Q2?', 'Q3?']);
    expect(after.qa.map((q) => q.question)).toEqual(['Q1?', 'Q2?', 'Q3?']);
    // Existing answer preserved
    expect(after.qa[0].answer).toBe('A1');
  });

  test('returns the same reference when there are no new questions to add', () => {
    const before = fakeState();
    expect(appendNewQuestions(before, [])).toBe(before);
    const after = appendNewQuestions(before, ['Q1?', 'Q2?']);
    expect(after).toBe(before); // both already present
  });
});

describe('isComplete', () => {
  test('false on empty qa array', () => {
    expect(isComplete(fakeState({qa: []}))).toBe(false);
  });

  test('false while any answer is null', () => {
    expect(isComplete(fakeState())).toBe(false);
  });

  test('true when every answer is non-null', () => {
    const state = fakeState({
      qa: [
        {question: 'Q1', answer: 'A1'},
        {question: 'Q2', answer: 'A2'},
      ],
    });
    expect(isComplete(state)).toBe(true);
  });
});

describe('markDone', () => {
  test('flips status to done without touching other fields', () => {
    const before = fakeState({status: 'active'});
    const after = markDone(before);
    expect(after.status).toBe('done');
    expect(after.intent).toBe(before.intent);
    expect(after.qa).toEqual(before.qa);
  });
});
