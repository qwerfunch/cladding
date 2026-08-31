// Cladding · unit tests for optimizer/preamble.ts
//
// suppressPreamble strips persona-boilerplate lines so the same prompt
// header isn't repeated on every LLM turn. Tests cover:
//   - default patterns strip "You are X agent" / "# Orchestrator" / "Your job is to …"
//   - non-matching prompt is returned unchanged (minus trim)
//   - collapsing of 3+ blank lines into 2
//   - custom patterns override defaults

import {describe, expect, test} from 'vitest';

import {DEFAULT_PREAMBLE_PATTERNS, suppressPreamble} from '../../src/optimizer/preamble.js';

describe('suppressPreamble', () => {
  test('strips "You are X agent" preamble', () => {
    const prompt =
      'You are the Reviewer agent for cladding.\nReview this diff:\n\nfunction x() {}\n';
    const out = suppressPreamble(prompt);
    expect(out).not.toContain('You are the Reviewer');
    expect(out).toContain('Review this diff');
    expect(out).toContain('function x()');
  });

  test('strips persona heading like "# Orchestrator"', () => {
    const prompt = '# Orchestrator\n\nFire the loop.';
    const out = suppressPreamble(prompt);
    expect(out).not.toContain('# Orchestrator');
    expect(out).toContain('Fire the loop');
  });

  test("[covers:F-063/AC-161] strips \"Your job is to\" line", () => {
    const prompt = 'Your job is to review the diff carefully.\n\nDiff: ...';
    const out = suppressPreamble(prompt);
    expect(out).not.toContain('Your job is to');
    expect(out).toContain('Diff: ...');
  });

  test('collapses 3+ blank lines after stripping', () => {
    const prompt =
      'You are the Reviewer agent.\n\n\n\nReview this.\n';
    const out = suppressPreamble(prompt);
    // Should not contain runs of 3+ \n
    expect(/\n{3,}/.test(out)).toBe(false);
    expect(out).toContain('Review this');
  });

  test('prompt with no preamble is returned almost unchanged (trim only)', () => {
    const prompt = 'Just a question.\n';
    expect(suppressPreamble(prompt)).toBe('Just a question.');
  });

  test('custom patterns override defaults', () => {
    const prompt = 'KEEP me\nDROP me\n';
    const out = suppressPreamble(prompt, [/^DROP me$/gm]);
    expect(out).toContain('KEEP me');
    expect(out).not.toContain('DROP me');
  });

  test('DEFAULT_PREAMBLE_PATTERNS is non-empty (regression guard)', () => {
    expect(DEFAULT_PREAMBLE_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });
});
