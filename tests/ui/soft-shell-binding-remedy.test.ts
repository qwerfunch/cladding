// Cladding · F-6349870d — the soft shell names the schema 0.2 test binding.
//
// Two plain-language surfaces have to say how a test claims a criterion: the
// MISSING_TESTS remedy (schema-agnostic copy, so it names both schemas) and the
// per-criterion guidance a schema 0.2 gate prints for a criterion no test
// claims. Both are rendered here, never stored in a verdict.
//
// Covers:
//   AC-8f563d88 — the MISSING_TESTS remedy names the 0.2 title token and the
//                 0.1 test reference.
//   AC-336d461f — the unbound guidance names the covers token, with the real
//                 criterion address inside it, and stays silent otherwise.

import {describe, expect, test} from 'vitest';

import {DETECTOR_PLAIN, unboundCriterionGuidance} from '../../src/ui/softShell.js';

describe('AC-8f563d88 · the MISSING_TESTS remedy covers both schemas', () => {
  test('[covers:F-6349870d/AC-8f563d88] the remedy names the schema 0.2 title token and the schema 0.1 test reference', () => {
    const action = DETECTOR_PLAIN.MISSING_TESTS.action ?? '';
    expect(action).toContain('[covers:<feature id>/<criterion id>]');
    expect(action).toContain('title');
    expect(action).toContain('0.2');
    expect(action).toContain('evidence reference');
    expect(action).toContain('0.1');
  });

  test('[covers:F-6349870d/AC-8f563d88] the remedy leads with the action, never with an internal id', () => {
    const action = DETECTOR_PLAIN.MISSING_TESTS.action ?? '';
    expect(action.startsWith('start the verifying test title')).toBe(true);
    // The token placeholder is generic — no live feature or criterion id leaks
    // into copy that is shown before the gate knows which criterion is meant.
    expect(action).not.toMatch(/\bF-[0-9a-f]{6,}\b/);
  });
});

describe('AC-336d461f · the unbound guidance names the token that binds a test', () => {
  test('[covers:F-6349870d/AC-336d461f] an unbound criterion row yields one sentence carrying its own covers token', () => {
    const lines = unboundCriterionGuidance([
      {subject: 'criterion:F-6349870d/AC-336d461f', state: 'unobserved', reason: 'unbound'},
    ]);
    expect(lines).toEqual(['no test claims this criterion — start a test title with `[covers:F-6349870d/AC-336d461f]`']);
  });

  test('[covers:F-6349870d/AC-336d461f] the same criterion is named once even when several obligations report it unbound', () => {
    const lines = unboundCriterionGuidance([
      {subject: 'criterion:F-aaaaaaaa/AC-11111111', state: 'unobserved', reason: 'unbound'},
      {subject: 'criterion:F-aaaaaaaa/AC-11111111', state: 'unobserved', reason: 'unbound'},
      {subject: 'criterion:F-aaaaaaaa/AC-22222222', state: 'unobserved', reason: 'unbound'},
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[covers:F-aaaaaaaa/AC-11111111]');
    expect(lines[1]).toContain('[covers:F-aaaaaaaa/AC-22222222]');
  });

  test('[covers:F-6349870d/AC-336d461f] a passing, failing, or stale row prescribes nothing', () => {
    expect(unboundCriterionGuidance([
      {subject: 'criterion:F-aaaaaaaa/AC-11111111', state: 'pass'},
      {subject: 'criterion:F-aaaaaaaa/AC-11111111', state: 'fail'},
      {subject: 'criterion:F-aaaaaaaa/AC-22222222', state: 'unobserved', reason: 'stale'},
      {subject: 'scope:abc', state: 'unobserved', reason: 'unresolved'},
    ])).toEqual([]);
  });
});
