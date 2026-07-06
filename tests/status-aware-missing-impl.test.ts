// Cladding · status-aware MISSING_IMPLEMENTATION pins (F-e8912be3)
//
// Real-adopter screenshot (2026-07-06): the Stop hook blocked a session with
// "feature F-x declares module ... but the file does not exist" during the
// exact window the feature-cycle documentation prescribes (author the spec
// entry, then implement). MISSING_IMPLEMENTATION was the only status-blind
// detector of its family — UNTESTED_AC and MISSING_TESTS are already
// done-scoped — so it fought the harness's own documented order.
//
// This suite drives the REAL detector through the full `runDrift` aggregator
// (the same seam the Stop hook / pre-commit gate use), on disposable tmp
// fixtures, and pins:
//   - AC-daff1078: planned/in_progress -> info, normality-phrased message.
//   - AC-9f1a7ad1: done/archived (and blocked, conservatively) -> error,
//     legacy message unchanged; the strict-window scenario (0 blocking
//     findings from THIS detector while in_progress) and the done-boundary
//     flip (both MISSING_IMPLEMENTATION and STATUS_DRIFT co-fire once the
//     feature is marked done) prove the demotion never reaches shipped code.
//   - AC-e8e0bf03 is pinned authoritatively by conformance/runner.ts's
//     F-014_AC-023 fixture (run via `npm run conformance`); the
//     strict-window test here is the unit-level equivalent of that fixture.
//   - AC-5b108de2: docs/feature-cycle.md no longer claims UNTESTED_AC is
//     status-blind (it is done-scoped) and documents the new window
//     tolerance instead.
//
// Sibling: tests/stages/missing-implementation.test.ts owns the detector's
// OWN pre-existing unit suite (silent-when-present, one-error-per-module,
// mixed features, no-modules-field, absent-spec.yaml); this file owns the
// cross-detector / strict-mode / doc-truth surface the new feature adds.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runDrift} from '../src/stages/drift.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const asm = (parts: readonly string[]): string => parts.join('');

const SPEC_HEADER = 'schema: "0.1"\nproject: {name: p, language: typescript}\nfeatures: []\n';
const MODULE_PATH = 'src/absent-module.ts';

/** Writes a single-feature sharded fixture (F-001, given status + modules) into `dir`. */
function writeFixture(dir: string, status: string, modules: readonly string[] = [MODULE_PATH]): string {
  const featPath = join(dir, 'spec', 'features', 'F-001.yaml');
  writeFileSync(
    featPath,
    `id: F-001\ntitle: probe\nstatus: ${status}\nmodules: [${modules.join(', ')}]\n`,
  );
  return featPath;
}

/** All `MISSING_IMPLEMENTATION`-attributed findings from a `runDrift` report. */
function miFindings(report: ReturnType<typeof runDrift>) {
  return report.findings.filter((f) => f.detector === 'MISSING_IMPLEMENTATION');
}

describe('status-aware MISSING_IMPLEMENTATION (F-e8912be3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-status-aware-mi-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  describe('AC-daff1078 · planned/in_progress declares-but-missing -> info, normality-phrased', () => {
    for (const status of ['planned', 'in_progress'] as const) {
      test(`${status}: MISSING_IMPLEMENTATION emits exactly one info finding stating the window is normal`, () => {
        writeFixture(dir, status);
        const report = runDrift({cwd: dir});
        const mi = miFindings(report);
        expect(mi, `${status}: detector must still EMIT (not go silent)`).toHaveLength(1);
        expect(mi[0].severity, `${status}: severity`).toBe('info');
        expect(mi[0].message, `${status}: names the module as not built yet`).toContain('is not built yet');
        expect(mi[0].message, `${status}: states the normal-window phrasing`).toContain(
          'the normal state between authoring the spec entry and implementing it',
        );
      });
    }
  });

  describe('AC-9f1a7ad1 · done/archived (shipped-or-final) declares-but-missing -> error, legacy message unchanged', () => {
    // `blocked` is conservatively kept at error too (unenumerated by the ACs,
    // but neither `planned` nor `in_progress` — the source's isSpecFirstWindow
    // fallthrough), so it is pinned here alongside the two named statuses.
    for (const status of ['done', 'archived', 'blocked'] as const) {
      test(`${status}: MISSING_IMPLEMENTATION emits exactly one error finding, legacy phrasing verbatim`, () => {
        writeFixture(dir, status);
        const report = runDrift({cwd: dir});
        const mi = miFindings(report);
        expect(mi, `${status}: detector must EMIT`).toHaveLength(1);
        expect(mi[0].severity, `${status}: severity`).toBe('error');
        expect(mi[0].message, `${status}: legacy "declares module" phrasing`).toContain('declares module');
        expect(mi[0].message, `${status}: legacy "does not exist" phrasing`).toContain('but the file does not exist');
        // The demoted normality phrasing must NOT leak into the error path.
        expect(mi[0].message, `${status}: must not carry the info-path normality phrasing`).not.toContain(
          'is not built yet',
        );
      });
    }
  });

  describe('AC-9f1a7ad1 · strict-window scenario — in_progress + missing module never blocks the gate', () => {
    test('runDrift({strict: true}) yields zero error/warn findings FROM MISSING_IMPLEMENTATION (other detectors may still fire)', () => {
      writeFixture(dir, 'in_progress');
      const report = runDrift({cwd: dir, strict: true});
      const mi = miFindings(report);
      // Still emits (info), so this isn't "quietly didn't run".
      expect(mi).toHaveLength(1);
      expect(mi[0].severity).toBe('info');
      const blockingFromThisDetector = mi.filter((f) => f.severity === 'error' || f.severity === 'warn');
      expect(blockingFromThisDetector, JSON.stringify(mi)).toHaveLength(0);
    });
  });

  describe('AC-e8e0bf03 · in_progress all-missing runs non-strict -> pass (unit equivalent of the F-014_AC-023 fixture)', () => {
    test('the same fixture is non-strict PASS overall (no error-severity finding from any detector)', () => {
      // Unit-level equivalent of conformance/runner.ts's F-014_AC-023 fixture
      // (in_progress, all declared modules missing, non-strict -> pass). The
      // fixture itself + its narrative are pinned authoritatively by
      // conformance/runner.ts + conformance/fixtures.yaml, exercised via
      // `npm run conformance` (not vitest) — see this file's header comment.
      writeFixture(dir, 'in_progress');
      const report = runDrift({cwd: dir});
      expect(report.pass).toBe(true);
      expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
    });
  });

  describe('AC-9f1a7ad1 · done-boundary — flipping the SAME fixture to done restores the block (two-detector defense)', () => {
    test('flip in_progress -> done: MISSING_IMPLEMENTATION and STATUS_DRIFT both fire error on the identical missing module', () => {
      const featPath = writeFixture(dir, 'in_progress');
      const before = runDrift({cwd: dir, strict: true});
      expect(miFindings(before)[0]?.severity, 'sanity: starts info under the window').toBe('info');

      // `clad done` is flip-then-gate — model that here by rewriting the
      // SAME shard file in the SAME directory (no fresh tmpdir), so this
      // pins the loadSpec/runDrift boundary re-reads disk rather than
      // serving a stale cached spec across the two runDrift calls.
      writeFileSync(featPath, `id: F-001\ntitle: probe\nstatus: done\nmodules: [${MODULE_PATH}]\n`);
      const after = runDrift({cwd: dir, strict: true});

      const names = new Set(after.findings.map((f) => f.detector));
      expect(names.has('MISSING_IMPLEMENTATION'), 'MISSING_IMPLEMENTATION must co-fire').toBe(true);
      expect(names.has('STATUS_DRIFT'), 'STATUS_DRIFT must co-fire (two-detector defense)').toBe(true);

      const miAfter = miFindings(after);
      expect(miAfter).toHaveLength(1);
      expect(miAfter[0].severity).toBe('error');
      const sdAfter = after.findings.filter((f) => f.detector === 'STATUS_DRIFT');
      expect(sdAfter.length).toBeGreaterThan(0);
      expect(sdAfter[0].severity).toBe('error');
      expect(after.pass).toBe(false);
    });
  });
});

describe('AC-5b108de2 · docs/feature-cycle.md no longer claims UNTESTED_AC is status-blind', () => {
  const doc = read('docs/feature-cycle.md');

  // Assembled at runtime from fragments (never literal here) so this file
  // cannot itself read as a hit for the condemned claim it is asserting the
  // absence of — same hygiene precedent as tests/terminology-canon.test.ts.
  const OLD_WRONG_CLAIM = asm(['UNTESTED_AC', ') are status', '-blind']);

  test('the old wrong claim ("...UNTESTED_AC) are status-blind...") has zero hits', () => {
    expect(doc.includes(OLD_WRONG_CLAIM)).toBe(false);
  });

  test('planted-needle control — the scanner has teeth (clean=false, poisoned=true)', () => {
    const clean =
      'the spec-vs-code detectors are status-aware, so this window does not false-fail: UNTESTED_AC and MISSING_TESTS are done-scoped';
    const poisoned = 'the spec-vs-code detectors (MISSING_IMPLEMENTATION, UNTESTED_AC) are status-blind and would fire';
    expect(clean.includes(OLD_WRONG_CLAIM)).toBe(false);
    expect(poisoned.includes(OLD_WRONG_CLAIM)).toBe(true);
  });

  test('the new window-tolerance sentence is present: UNTESTED_AC/MISSING_TESTS done-scoped + MISSING_IMPLEMENTATION info while planned/in_progress', () => {
    expect(doc).toContain('spec-vs-code detectors are status-aware');
    expect(doc).toContain('UNTESTED_AC and');
    expect(doc).toContain('MISSING_TESTS are done-scoped');
    expect(doc).toContain('MISSING_IMPLEMENTATION reports a declared-but-unbuilt module');
    expect(doc).toMatch(/as\s+`info`\s+—\s+not a blocking error/);
    expect(doc).toContain('while the feature is `planned` / `in_progress`');
  });
});
