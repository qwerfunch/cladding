// Cladding · unit tests for src/intent/lexicon.ts (0.4.13 PR-D.1, F-b426b0)
//
// Covers the matchesToken word-boundary semantics + findMatches scan
// + the DEFAULT_LEXICON mutual-exclusivity invariant (no single token
// belongs to two categories — would make classifier ambiguous).

import {describe, expect, test} from 'vitest';

import {DEFAULT_LEXICON, findMatches, matchesToken} from '../../src/intent/lexicon.js';

describe('matchesToken — ASCII word boundaries', () => {
  test('matches token surrounded by spaces', () => {
    expect(matchesToken('please add a button', 'add')).toBe(true);
  });

  test('matches token at start of string', () => {
    expect(matchesToken('add a feature', 'add')).toBe(true);
  });

  test('matches token at end of string', () => {
    expect(matchesToken('please add', 'add')).toBe(true);
  });

  test('does NOT match substring inside a longer word', () => {
    // "addable", "address", "padding" must not match "add"
    expect(matchesToken('this is addable', 'add')).toBe(false);
    expect(matchesToken('my address book', 'add')).toBe(false);
    expect(matchesToken('use padding', 'add')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(matchesToken('PLEASE ADD A FEATURE', 'add')).toBe(true);
    expect(matchesToken('Refactor This', 'refactor')).toBe(true);
  });

  test('matches multi-word tokens', () => {
    expect(matchesToken('please add a new feature here', 'new feature')).toBe(true);
    expect(matchesToken('this is broken', "doesn't work")).toBe(false);
    expect(matchesToken("it doesn't work right", "doesn't work")).toBe(true);
  });

  test('punctuation counts as boundary', () => {
    expect(matchesToken('add, please', 'add')).toBe(true);
    expect(matchesToken('(add)', 'add')).toBe(true);
    expect(matchesToken('"add it"', 'add')).toBe(true);
  });
});

describe('matchesToken — Hangul substring', () => {
  test('matches inside a Korean word (no word separator in CJK)', () => {
    expect(matchesToken('기능구현해주세요', '구현해')).toBe(true);
    expect(matchesToken('버그수정바람', '수정')).toBe(true);
  });

  test('matches across whitespace', () => {
    expect(matchesToken('새 기능 추가해줘', '추가')).toBe(true);
    expect(matchesToken('이 코드 봐줘', '봐줘')).toBe(true);
  });

  test('case-insensitive (Hangul has no case but mixed text)', () => {
    expect(matchesToken('Add 기능 add', '기능')).toBe(true);
  });

  test('empty token never matches', () => {
    expect(matchesToken('any text', '')).toBe(false);
  });
});

describe('findMatches', () => {
  test('returns all matching tokens from the set', () => {
    const hits = findMatches('please add and implement', new Set(['add', 'implement', 'fix']));
    expect([...hits].sort()).toEqual(['add', 'implement']);
  });

  test('returns empty array when none match', () => {
    expect(findMatches('hello world', new Set(['add', 'fix']))).toEqual([]);
  });

  test('handles mixed Hangul + ASCII', () => {
    const hits = findMatches('새 기능 add 구현', new Set(['기능', 'add', '구현', 'remove']));
    expect([...hits].sort()).toEqual(['add', '구현', '기능']);
  });
});

describe('DEFAULT_LEXICON — mutual exclusivity', () => {
  // No single token may appear in two different category sets — that
  // would make classifier output non-deterministic on the conflict
  // resolution path.
  test('no token appears in more than one category', () => {
    const seen = new Map<string, string[]>();
    const cats: Array<[string, ReadonlySet<string>]> = [
      ['devNew', DEFAULT_LEXICON.devNew],
      ['devModify', DEFAULT_LEXICON.devModify],
      ['devReview', DEFAULT_LEXICON.devReview],
      ['nonDev', DEFAULT_LEXICON.nonDev],
    ];
    for (const [cat, set] of cats) {
      for (const token of set) {
        const existing = seen.get(token) ?? [];
        existing.push(cat);
        seen.set(token, existing);
      }
    }
    const dups = [...seen.entries()].filter(([, cats]) => cats.length > 1);
    expect(dups).toEqual([]);
  });

  test('all tokens are lowercase (matcher is case-insensitive but storage should be canonical)', () => {
    const allTokens = [
      ...DEFAULT_LEXICON.devNew,
      ...DEFAULT_LEXICON.devModify,
      ...DEFAULT_LEXICON.devReview,
      ...DEFAULT_LEXICON.nonDev,
    ];
    for (const t of allTokens) {
      expect(t).toBe(t.toLowerCase());
    }
  });

  test('each category has at least 4 tokens (sanity floor)', () => {
    expect(DEFAULT_LEXICON.devNew.size).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_LEXICON.devModify.size).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_LEXICON.devReview.size).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_LEXICON.nonDev.size).toBeGreaterThanOrEqual(4);
  });
});
