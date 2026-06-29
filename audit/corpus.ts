// Cladding · detector regression-audit corpus (F-b91fce34).
//
// WHY: conformance fixtures assert a detector *fires* on a drift case. They do
// NOT systematically assert it stays *silent* on an adversarial near-miss — a
// clean input that superficially resembles drift. A detector can rot in two
// directions: toward NOISE (firing on clean inputs → users learn to ignore it)
// or toward BLINDNESS (missing real drift → the documented security-adjacent
// risk in SECURITY.md). This corpus pairs, per detector, drift cases (must
// fire) with clean/near-miss cases (must stay silent) so both failure modes are
// measured and guarded against regression — NOT a population accuracy claim.
//
// Each case materializes a tiny synthetic project; the runner looks the named
// detector up in `allDetectors`, runs it against the dir, and classifies the
// outcome (see audit/detector-audit.ts). v1 covers PURE detectors only —
// shell-based ones (HARDCODED_SECRET / ARCHITECTURE_VIOLATION / COVERAGE_DROP)
// are out of scope here.

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** `drift` = the detector SHOULD fire; `clean` = it should stay silent. */
export type Expect = 'drift' | 'clean';

export interface CorpusCase {
  /** Stable id, e.g. `UNTESTED_AC.clean.dogfood-prefix`. */
  readonly id: string;
  /** Detector NAME as emitted in DriftFinding.detector, e.g. `UNTESTED_AC`. */
  readonly detector: string;
  readonly expect: Expect;
  /**
   * When set, only a finding of THIS severity counts as "fired" (lets a clean
   * case tolerate a lower-severity advisory). Unset → any finding counts.
   */
  readonly severity?: 'error' | 'warn' | 'info';
  /** Why this case exists — especially the near-miss it pins down. */
  readonly note: string;
  setup(dir: string): void;
}

// ── helpers ────────────────────────────────────────────────────────────────

function writeSpec(dir: string, featuresYaml: string): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\n' + 'project: {name: f, language: typescript}\n' + 'features:\n' + featuresYaml,
  );
}

function touch(dir: string, rel: string, body = 'export const x = 1;\n'): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), {recursive: true});
  writeFileSync(full, body);
}

/** A JUnit `<testsuite>` of one `<testcase>` (with optional failure/skip child). */
function junit(attrs: string, child = ''): string {
  return `<?xml version="1.0"?><testsuites><testsuite><testcase ${attrs}>${child}</testcase></testsuite></testsuites>`;
}

// ── corpus ───────────────────────────────────────────────────────────────────

export const corpus: readonly CorpusCase[] = [
  // ─── UNTESTED_AC — a done AC's test_ref must exist on disk ──────────────────
  {
    id: 'UNTESTED_AC.drift.missing-file',
    detector: 'UNTESTED_AC',
    expect: 'drift',
    note: 'done AC references a test file that does not exist → must fire',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [tests/ghost.test.ts]\n',
      );
      touch(d, 'a.ts');
    },
  },
  {
    id: 'UNTESTED_AC.clean.file-exists',
    detector: 'UNTESTED_AC',
    expect: 'clean',
    note: 'done AC whose test_ref resolves to a real file → must stay silent',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [tests/real.test.ts]\n',
      );
      touch(d, 'a.ts');
      touch(d, 'tests/real.test.ts', 'export const tested = true;\n');
    },
  },
  {
    id: 'UNTESTED_AC.clean.dogfood-prefix',
    detector: 'UNTESTED_AC',
    expect: 'clean',
    note: 'NEAR-MISS: a self-dogfood:/fixture: pseudo-ref looks unresolvable but is intentionally exempt → must NOT fire',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [self-dogfood:build]\n',
      );
      touch(d, 'a.ts');
    },
  },

  // ─── STATUS_DRIFT — a done feature's modules must exist ──────────────────────
  {
    id: 'STATUS_DRIFT.drift.done-missing-module',
    detector: 'STATUS_DRIFT',
    expect: 'drift',
    note: 'status=done but a declared module is absent → must fire',
    setup(d) {
      writeSpec(d, '  - id: F-001\n    title: t\n    status: done\n    modules: [gone.ts]\n');
    },
  },
  {
    id: 'STATUS_DRIFT.clean.done-modules-present',
    detector: 'STATUS_DRIFT',
    expect: 'clean',
    note: 'status=done with every module present → must stay silent',
    setup(d) {
      writeSpec(d, '  - id: F-001\n    title: t\n    status: done\n    modules: [there.ts]\n');
      touch(d, 'there.ts');
    },
  },
  {
    id: 'STATUS_DRIFT.clean.planned-missing-module',
    detector: 'STATUS_DRIFT',
    expect: 'clean',
    note: 'NEAR-MISS: status=planned with absent modules looks like the drift case but planned features are exempt → must NOT fire',
    setup(d) {
      writeSpec(d, '  - id: F-001\n    title: t\n    status: planned\n    modules: [not-yet.ts]\n');
    },
  },

  // ─── AC_DRIFT — an AC must carry text or EARS structure ──────────────────────
  {
    id: 'AC_DRIFT.drift.empty-ac',
    detector: 'AC_DRIFT',
    expect: 'drift',
    note: 'an AC with neither text nor any EARS field is structurally hollow → must fire',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n',
      );
      touch(d, 'a.ts');
    },
  },
  {
    id: 'AC_DRIFT.clean.well-formed-ac',
    detector: 'AC_DRIFT',
    expect: 'clean',
    note: 'a well-formed AC (rendered text present) → must stay silent',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: the system shall do X\n',
      );
      touch(d, 'a.ts');
    },
  },

  // ─── UNVERIFIED_AC — a done AC's test_refs must have RUN and PASSED ──────────
  // (also dogfoods the multi-framework matching from F-d980359c)
  {
    id: 'UNVERIFIED_AC.drift.failing-test',
    detector: 'UNVERIFIED_AC',
    expect: 'drift',
    note: 'JUnit report present and the referenced test FAILED → must fire',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [tests/x.test.ts]\n',
      );
      touch(d, 'a.ts');
      touch(d, 'tests/x.test.ts', 'export const t = 1;\n');
      writeFileSync(join(d, 'test-report.junit.xml'), junit('classname="tests/x.test.ts" name="a"', '<failure message="boom"/>'));
    },
  },
  {
    id: 'UNVERIFIED_AC.clean.no-report',
    detector: 'UNVERIFIED_AC',
    expect: 'clean',
    note: 'NEAR-MISS: no JUnit report present → graceful degrade, UNTESTED_AC stays the baseline → must NOT fire',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [tests/x.test.ts]\n',
      );
      touch(d, 'a.ts');
      touch(d, 'tests/x.test.ts', 'export const t = 1;\n');
    },
  },
  {
    id: 'UNVERIFIED_AC.clean.pytest-passed',
    detector: 'UNVERIFIED_AC',
    expect: 'clean',
    note: 'NEAR-MISS (dogfoods F-d980359c): a pytest-shaped report (dotted classname + file= attr) whose test PASSED must match cross-framework and stay silent',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [tests/test_foo.py]\n',
      );
      touch(d, 'a.ts');
      writeFileSync(join(d, 'test-report.junit.xml'), junit('classname="tests.test_foo" file="tests/test_foo.py" name="t"'));
    },
  },
  {
    id: 'UNVERIFIED_AC.clean.jest-describe-degrade',
    detector: 'UNVERIFIED_AC',
    expect: 'clean',
    note: 'NEAR-MISS (dogfoods F-d980359c): a jest describe-title report has no path-like keys → confident-or-degrade → must NOT flood false absents',
    setup(d) {
      writeSpec(
        d,
        '  - id: F-001\n    title: t\n    status: done\n    modules: [a.ts]\n' +
          '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs: [src/MyComponent.test.tsx]\n',
      );
      touch(d, 'a.ts');
      writeFileSync(join(d, 'test-report.junit.xml'), junit('classname="MyComponent renders correctly" name="t"'));
    },
  },
];
