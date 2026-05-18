// Cladding · integration test — cladding's own sharded spec parses + validates
//
// Guards against the L21.11 silent failure: yaml plain-value reserved
// characters (backtick, brace, bracket) snuck into AC text fields and
// only stage:drift's per-detector try/catch surfaced it — never the
// outer pipeline. This test loads the *real* spec via spec/load.ts
// from the repo root so any new yaml-reserved-char regression fails
// CI loudly.

import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

import {loadSpec} from '../../spec/load.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('cladding own spec', () => {
  test('loadSpec(repoRoot) parses + validates without throwing', () => {
    expect(() => loadSpec(repoRoot)).not.toThrow();
  });

  test('parsed spec has the expected scale (≥ 40 features)', () => {
    const spec = loadSpec(repoRoot);
    expect(spec.features.length).toBeGreaterThanOrEqual(40);
  });

  test('every feature has a unique F-NNN id', () => {
    const spec = loadSpec(repoRoot);
    const ids = spec.features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every AC id within a feature is unique', () => {
    const spec = loadSpec(repoRoot);
    for (const feature of spec.features) {
      const acIds = (feature.acceptance_criteria ?? []).map((a) => a.id);
      expect(new Set(acIds).size).toBe(acIds.length);
    }
  });
});
