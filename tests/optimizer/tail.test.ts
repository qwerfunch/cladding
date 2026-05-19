// Cladding · unit tests for optimizer/tail.ts
//
// headTail keeps the first N + last M lines of a text blob, joined by
// an elision marker when the middle was cut. Tests cover the cut/no-cut
// boundary plus the elision-count formula.

import {describe, expect, test} from 'vitest';

import {headTail} from '../../optimizer/tail.js';

describe('headTail', () => {
  test('returns input unchanged when total lines ≤ head + tail', () => {
    const input = 'a\nb\nc\nd\ne';
    expect(headTail(input, 5, 30)).toBe(input);
  });

  test('cuts the middle when total > head + tail', () => {
    const lines = Array.from({length: 100}, (_, i) => `line-${i}`);
    const input = lines.join('\n');
    const out = headTail(input, 2, 3);
    const split = out.split('\n');
    expect(split).toEqual(['line-0', 'line-1', '… [95 line(s) elided]', 'line-97', 'line-98', 'line-99']);
  });

  test('default head=5 / tail=30 boundary works', () => {
    const lines = Array.from({length: 40}, (_, i) => `${i}`);
    const out = headTail(lines.join('\n'));
    expect(out).toContain('… [5 line(s) elided]');
    expect(out.startsWith('0\n1\n2\n3\n4\n')).toBe(true);
    expect(out.endsWith('39')).toBe(true);
  });

  test('exact boundary (lines === head+tail) is unchanged', () => {
    const lines = Array.from({length: 10}, (_, i) => `${i}`);
    const out = headTail(lines.join('\n'), 5, 5);
    expect(out).toBe(lines.join('\n'));
    expect(out).not.toContain('elided');
  });

  test('one-over boundary (lines === head+tail+1) triggers elision', () => {
    const lines = Array.from({length: 11}, (_, i) => `${i}`);
    const out = headTail(lines.join('\n'), 5, 5);
    expect(out).toContain('… [1 line(s) elided]');
  });

  test('empty input is returned as-is', () => {
    expect(headTail('', 5, 30)).toBe('');
  });

  test('elision marker mentions exact count', () => {
    const lines = Array.from({length: 50}, (_, i) => `${i}`);
    const out = headTail(lines.join('\n'), 3, 3);
    expect(out).toContain('… [44 line(s) elided]');
  });
});
