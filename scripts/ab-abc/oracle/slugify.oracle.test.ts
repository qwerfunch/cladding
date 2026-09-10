// Cladding · scripts/ab-abc/oracle/slugify.oracle.test.ts — the hidden oracle
//
// Written before the campaign and never placed in any arm's fixture: the driver
// copies it in after a cell has finished, runs it once, records pass/total, and
// deletes it. No arm can see it, so it cannot be optimised against.
//
// It deliberately reaches past the three stated acceptance criteria — trailing
// separators, idempotence, decomposed Unicode — because the question it answers
// is "what did the arm actually build", not "did it satisfy the brief it read".
//
// PRE-REGISTERED: this is a correctness axis, and four prior campaigns found
// correctness orthogonal to the harness. A tie is expected. Whatever it shows,
// it is REPORTED ONLY and never feeds the release verdict.
//
// It imports `slugify` alone. The error class is checked by name rather than by
// import, so an arm that keeps its error type module-private is not penalised
// for a decision the brief never constrained.

import {describe, expect, test} from 'vitest';

// Resolved once the driver copies this file into the fixture's tests/ directory.
import {slugify} from '../src/slugify.js';

/** Runs `slugify` and returns the thrown error, or null when it returned. */
const thrownBy = (input: string): unknown => {
  try {
    slugify(input);
    return null;
  } catch (error) {
    return error;
  }
};

const errorName = (error: unknown): string =>
  error instanceof Error ? (error.name === 'Error' ? error.constructor.name : error.name) : String(error);

describe('oracle · the stated criteria', () => {
  test('O-1 lower-cases, drops punctuation, joins words with single hyphens', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  test('O-2 folds diacritics to their base letters', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  test('O-3 rejects an input with nothing slug-able in it', () => {
    expect(errorName(thrownBy('   '))).toBe('EmptySlugError');
  });
});

describe('oracle · beyond the brief', () => {
  test('O-4 collapses runs of whitespace into one hyphen', () => {
    expect(slugify('a   b')).toBe('a-b');
  });

  test('O-5 trims leading and trailing whitespace before slugging', () => {
    expect(slugify('  Hello  ')).toBe('hello');
  });

  test('O-6 leaves no punctuation anywhere in the result', () => {
    expect(slugify('Hello, World! (2024)')).toMatch(/^[a-z0-9-]+$/);
  });

  test('O-7 rejects the empty string the same way as whitespace', () => {
    expect(errorName(thrownBy(''))).toBe('EmptySlugError');
  });

  test('O-8 preserves digits', () => {
    expect(slugify('Top 10 Songs')).toBe('top-10-songs');
  });

  test('O-9 folds decomposed Unicode, not only precomposed', () => {
    // 'Cre' + COMBINING ACUTE ACCENT + 'me' — the same word, decomposed.
    expect(slugify('Cre\u0301me')).toBe('creme');
  });

  test('O-10 lower-cases an all-caps input', () => {
    expect(slugify('HELLO')).toBe('hello');
  });

  test('O-11 collapses adjacent separators rather than emitting empty segments', () => {
    expect(slugify('a -- b')).toBe('a-b');
  });

  test('O-12 never ends or begins with a hyphen', () => {
    const slug = slugify('!! Hello World !!');
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
  });

  test('O-13 is idempotent on something already a slug', () => {
    expect(slugify('hello-world')).toBe('hello-world');
  });

  test('O-14 handles a long title without producing a trailing separator', () => {
    const slug = slugify(`${'Long Title '.repeat(20)}End`);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});
