// Conformance oracle for feature F-b81d203e (vacuous-test guard).
//
// Authored impl-blind: assertions derive ONLY from the acceptance criteria in
// spec/features/vacuous-test-guard-b81d203e.yaml and the declared interface
// contract for src/stages/vacuous-tests.ts (handoff 02). The implementation
// body of that file was never opened. A failure here is a FINDING against the
// spec, not a bug in the test.
//
// AC-41e112d3 (unwanted, "AC1"): a done feature whose declared test_ref file
//   executed zero passing assertions => a blocking VACUOUS_TESTS finding
//   naming the feature.
// AC-5d9c66b8 (state, "AC2"): while the runner produces machine-readable
//   per-test results, per-file executed-pass counts are computed from them.
//   (Exercised implicitly by every fixture below; parseExecutedPassCounts is
//   also probed directly.)
// AC-1a0b1b26 (unwanted, "AC3"): unparseable/empty/adversarial input, or a
//   test_ref absent from the json, or a missing json file => [] / null, never
//   a throw.
// AC-d7a9568e (state, "AC4"): a done feature with >=1 passing assertion in
//   ANY declared test_ref => no finding. A mix of one vacuous + one real done
//   feature flags only the vacuous one.
// AC-4f3d74ee (ubiquitous, "AC5"): the guard applies only to done features;
//   planned/in_progress features are never flagged.
//
// House rule (tests/self-consistency.test.ts): no raw NUL bytes, no backtick
// template literals in test source. Exotic bytes, where needed, are built at
// runtime via String.fromCharCode so the file on disk stays pure ASCII.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {AcceptanceCriterion, Feature, Spec} from '../../src/spec/types.js';
import {primeSpecCache} from '../../src/spec/load.js';
import {
  findVacuousDoneFeatures,
  parseExecutedPassCounts,
  vacuousDoneFindings,
} from '../../src/stages/vacuous-tests.js';

// A fixed, non-filesystem-touching cwd for the pure-function tests: path.resolve
// is string-only when the base is already absolute, so this never hits disk.
const CWD = '/repo';

function vitestJson(files: ReadonlyArray<{name: string; statuses: string[]}>): string {
  return JSON.stringify({
    testResults: files.map((f) => ({
      name: f.name,
      assertionResults: f.statuses.map((status, i) => ({
        status,
        fullName: 'case ' + String(i),
      })),
    })),
  });
}

function feature(overrides: Partial<Feature>): Feature {
  return {
    id: 'F-test0001',
    slug: 'test-feature',
    title: 'Test feature',
    status: 'done',
    acceptance_criteria: [],
    ...overrides,
  } as Feature;
}

function specOf(features: ReadonlyArray<Feature>): Spec {
  return {
    schema: '0.1',
    project: {name: 'fixture'},
    features,
  } as unknown as Spec;
}

describe('vacuous-tests (F-b81d203e)', () => {
  // ---------------------------------------------------------------------
  // AC-5d9c66b8 (AC2) — parseExecutedPassCounts: per-file executed-pass count
  // ---------------------------------------------------------------------
  describe('parseExecutedPassCounts', () => {
    it('[covers:F-b81d203e/AC-5d9c66b8] AC2-counts: maps each file name to its number of passed assertions', () => {
      const json = vitestJson([
        {name: resolve(CWD, 'tests/vacuous.test.ts'), statuses: ['skipped', 'skipped']},
        {name: resolve(CWD, 'tests/real.test.ts'), statuses: ['passed', 'skipped']},
      ]);
      const counts = parseExecutedPassCounts(json);
      expect(counts).not.toBeNull();
      expect(counts!.get(resolve(CWD, 'tests/vacuous.test.ts'))).toBe(0);
      expect(counts!.get(resolve(CWD, 'tests/real.test.ts'))).toBe(1);
    });

    it('AC2-todo-pending-not-counted: only status "passed" increments the count', () => {
      const json = vitestJson([
        {name: resolve(CWD, 'tests/mixed.test.ts'), statuses: ['todo', 'pending', 'skipped', 'failed']},
      ]);
      const counts = parseExecutedPassCounts(json);
      expect(counts!.get(resolve(CWD, 'tests/mixed.test.ts'))).toBe(0);
    });

    // ---------------------------------------------------------------------
    // AC-1a0b1b26 (AC3) — defensive: unparseable input never throws.
    // ---------------------------------------------------------------------
    it('AC3-unparseable: non-JSON text returns null, not a throw', () => {
      expect(() => parseExecutedPassCounts('not json')).not.toThrow();
      expect(parseExecutedPassCounts('not json')).toBeNull();
    });

    it('AC3-empty-string: empty input returns null', () => {
      expect(() => parseExecutedPassCounts('')).not.toThrow();
      expect(parseExecutedPassCounts('')).toBeNull();
    });

    it('AC3-adversarial: malformed / truncated / wrong-shape JSON never throws and stays total', () => {
      const NUL = String.fromCharCode(0x00);
      const REPLACEMENT = String.fromCharCode(0xfffd);
      const adversarial = [
        '{',
        '[]',
        ']{[',
        '{}',
        '{"testResults": "not-an-array"}',
        '{"testResults": [{"name": "x", "assertionResults": "nope"}]}',
        NUL + REPLACEMENT + ' garbage',
        'x'.repeat(50_000),
      ];
      for (const s of adversarial) {
        expect(() => parseExecutedPassCounts(s)).not.toThrow();
        const result = parseExecutedPassCounts(s);
        expect(result === null || result instanceof Map).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------
  // findVacuousDoneFeatures — pure logic over (spec, counts, cwd).
  // ---------------------------------------------------------------------
  describe('findVacuousDoneFeatures', () => {
    // AC-41e112d3 (AC1) — fires.
    it('[covers:F-b81d203e/AC-41e112d3] AC1-fires: a done feature whose sole test_ref executed 0 passing assertions is flagged', () => {
      const spec = specOf([
        feature({
          id: 'F-vacuous01',
          title: 'Vacuous feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/vacuous.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      const counts = new Map<string, number>([[resolve(CWD, 'tests/vacuous.test.ts'), 0]]);
      const findings = findVacuousDoneFeatures(spec, counts, CWD);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.detector).toBe('VACUOUS_TESTS');
      expect(findings[0]!.message).toContain('Vacuous feature');
      expect(['warn', 'error']).toContain(findings[0]!.severity);
    });

    // AC-d7a9568e (AC4) — no false positive.
    it('[covers:F-b81d203e/AC-d7a9568e] AC4-real-test-no-finding: a done feature with >=1 passing assertion is not flagged', () => {
      const spec = specOf([
        feature({
          id: 'F-real0001',
          title: 'Real feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/real.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      const counts = new Map<string, number>([[resolve(CWD, 'tests/real.test.ts'), 3]]);
      const findings = findVacuousDoneFeatures(spec, counts, CWD);
      expect(findings).toEqual([]);
    });

    it('AC4-mix: one vacuous + one real done feature flags only the vacuous one', () => {
      const spec = specOf([
        feature({
          id: 'F-vacuous02',
          title: 'Vacuous sibling',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/vacuous2.test.ts']} as AcceptanceCriterion,
          ],
        }),
        feature({
          id: 'F-real0002',
          title: 'Real sibling',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/real2.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      const counts = new Map<string, number>([
        [resolve(CWD, 'tests/vacuous2.test.ts'), 0],
        [resolve(CWD, 'tests/real2.test.ts'), 1],
      ]);
      const findings = findVacuousDoneFeatures(spec, counts, CWD);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain('Vacuous sibling');
      expect(findings.some((f) => f.message.includes('Real sibling'))).toBe(false);
    });

    it('AC4-conservative-mixed-refs: one 0-passed ref + one ref ABSENT from counts => no finding', () => {
      const spec = specOf([
        feature({
          id: 'F-ambiguous01',
          title: 'Ambiguous feature',
          status: 'done',
          acceptance_criteria: [
            {
              id: 'AC-1',
              test_refs: ['tests/zero.test.ts', 'tests/unmatched.test.ts'],
            } as AcceptanceCriterion,
          ],
        }),
      ]);
      // 'tests/unmatched.test.ts' is deliberately absent from counts.
      const counts = new Map<string, number>([[resolve(CWD, 'tests/zero.test.ts'), 0]]);
      const findings = findVacuousDoneFeatures(spec, counts, CWD);
      expect(findings).toEqual([]);
    });

    // AC-1a0b1b26 (AC3) — a test_ref entirely absent from counts (anchor/path
    // mismatch, non-vitest, unscanned file) is lenient: no finding.
    it('AC3-absent-ref: a test_ref never present in counts produces no finding', () => {
      const spec = specOf([
        feature({
          id: 'F-absent01',
          title: 'Absent-ref feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/never-ran.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      const findings = findVacuousDoneFeatures(spec, new Map(), CWD);
      expect(findings).toEqual([]);
    });

    it('AC3-no-test-refs: a done feature declaring no test_refs at all is not this guard\'s concern', () => {
      const spec = specOf([
        feature({
          id: 'F-notests01',
          title: 'No test refs feature',
          status: 'done',
          acceptance_criteria: [{id: 'AC-1'} as AcceptanceCriterion],
        }),
      ]);
      const findings = findVacuousDoneFeatures(spec, new Map(), CWD);
      expect(findings).toEqual([]);
    });

    // AC-4f3d74ee (AC5) — done-only.
    it('AC5-planned-not-flagged: a planned feature with an all-skip test file is never flagged', () => {
      const spec = specOf([
        feature({
          id: 'F-planned01',
          title: 'Planned feature',
          status: 'planned',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/planned.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      const counts = new Map<string, number>([[resolve(CWD, 'tests/planned.test.ts'), 0]]);
      const findings = findVacuousDoneFeatures(spec, counts, CWD);
      expect(findings).toEqual([]);
    });

    it('AC5-in-progress-not-flagged: an in_progress feature with an all-skip test file is never flagged', () => {
      const spec = specOf([
        feature({
          id: 'F-inprog01',
          title: 'In progress feature',
          status: 'in_progress',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/inprogress.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      const counts = new Map<string, number>([[resolve(CWD, 'tests/inprogress.test.ts'), 0]]);
      const findings = findVacuousDoneFeatures(spec, counts, CWD);
      expect(findings).toEqual([]);
    });

    it('AC3-total-safe: never throws given an empty feature list or an empty counts map', () => {
      expect(() => findVacuousDoneFeatures(specOf([]), new Map(), CWD)).not.toThrow();
      expect(findVacuousDoneFeatures(specOf([]), new Map(), CWD)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // vacuousDoneFindings — total top-level entry (file I/O + spec load).
  // ---------------------------------------------------------------------
  describe('vacuousDoneFindings', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, {recursive: true, force: true});
      // Never leak a primed spec into an unrelated test file's loadSpec calls.
      primeSpecCache(dir || CWD, null);
    });

    it('AC1-end-to-end: a real json file + primed spec produces the finding via the public entry point', () => {
      dir = mkdtempSync(join(tmpdir(), 'clad-vacuous-tests-'));
      const jsonPath = join(dir, 'vitest-out.json');
      writeFileSync(
        jsonPath,
        vitestJson([{name: join(dir, 'tests/vacuous.test.ts'), statuses: ['skipped', 'skipped']}]),
      );
      const spec = specOf([
        feature({
          id: 'F-e2e0001',
          title: 'End to end vacuous feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/vacuous.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      primeSpecCache(dir, spec);
      const findings = vacuousDoneFindings(jsonPath, dir);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.detector).toBe('VACUOUS_TESTS');
      expect(findings[0]!.message).toContain('End to end vacuous feature');
    });

    // AC-1a0b1b26 (AC3) — defensive, total-safe, at the public entry point.
    it('AC3-missing-file: a nonexistent json file path returns [] (never throws)', () => {
      dir = mkdtempSync(join(tmpdir(), 'clad-vacuous-tests-'));
      expect(() => vacuousDoneFindings(join(dir, 'does-not-exist.json'), dir)).not.toThrow();
      expect(vacuousDoneFindings(join(dir, 'does-not-exist.json'), dir)).toEqual([]);
    });

    it('AC3-empty-file: an empty json file returns []', () => {
      dir = mkdtempSync(join(tmpdir(), 'clad-vacuous-tests-'));
      const jsonPath = join(dir, 'empty.json');
      writeFileSync(jsonPath, '');
      const spec = specOf([
        feature({
          id: 'F-empty0001',
          title: 'Empty json feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/whatever.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      primeSpecCache(dir, spec);
      expect(vacuousDoneFindings(jsonPath, dir)).toEqual([]);
    });

    it('AC3-garbage-file: a file full of non-JSON text returns [] without throwing', () => {
      dir = mkdtempSync(join(tmpdir(), 'clad-vacuous-tests-'));
      const jsonPath = join(dir, 'garbage.json');
      writeFileSync(jsonPath, 'this is not json at all, just prose output');
      const spec = specOf([
        feature({
          id: 'F-garbage01',
          title: 'Garbage json feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/whatever.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      primeSpecCache(dir, spec);
      expect(() => vacuousDoneFindings(jsonPath, dir)).not.toThrow();
      expect(vacuousDoneFindings(jsonPath, dir)).toEqual([]);
    });

    it('AC3-no-spec-primed: with no spec.yaml on disk and nothing primed, returns [] rather than throwing', () => {
      dir = mkdtempSync(join(tmpdir(), 'clad-vacuous-tests-'));
      const jsonPath = join(dir, 'vitest-out.json');
      writeFileSync(
        jsonPath,
        vitestJson([{name: join(dir, 'tests/vacuous.test.ts'), statuses: ['skipped']}]),
      );
      // No primeSpecCache call, no spec.yaml written to 'dir' => loadSpec(dir)
      // would throw on a real disk read. The guard must swallow that.
      expect(() => vacuousDoneFindings(jsonPath, dir)).not.toThrow();
      expect(vacuousDoneFindings(jsonPath, dir)).toEqual([]);
    });

    it('AC4-end-to-end-no-false-positive: a real passing test file produces no finding via the public entry point', () => {
      dir = mkdtempSync(join(tmpdir(), 'clad-vacuous-tests-'));
      const jsonPath = join(dir, 'vitest-out.json');
      writeFileSync(
        jsonPath,
        vitestJson([{name: join(dir, 'tests/real.test.ts'), statuses: ['passed']}]),
      );
      const spec = specOf([
        feature({
          id: 'F-e2ereal01',
          title: 'End to end real feature',
          status: 'done',
          acceptance_criteria: [
            {id: 'AC-1', test_refs: ['tests/real.test.ts']} as AcceptanceCriterion,
          ],
        }),
      ]);
      primeSpecCache(dir, spec);
      expect(vacuousDoneFindings(jsonPath, dir)).toEqual([]);
    });
  });
});
