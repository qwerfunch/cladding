// Cladding · vacuous-green seed suite (0.6 release harness, review findings V6/V7)
//
// "Release gates must be re-runnable commands, not manual rituals." Each seed
// below is a deterministic fixture reproducing one vacuous-green (or false-RED)
// class the A/B benchmarks exposed, run through the REAL gate as a subprocess
// (`bin/clad check --tier=<t> --strict --json`) — exactly what a release
// engineer would run. If a future change re-opens one of these holes, this
// suite goes RED before the release does.
//
// Seeds:
//   1. broken-entry     — the Mini-Lang 0/69 class: declared deliverable crashes,
//                         gate must RUN it and fail (stage_2.4, F-9064ff).
//   2. toolchain-absent — the 7c37de7 class, generalized by F-67d2e9: declared
//                         language + tested done features must not silently
//                         waive verification when the toolchain is missing.
//   3. hand-flipped-done — a done AC with zero refs trips the MISSING_TESTS
//                         drift floor even without hooks.
//   4. clean-control    — zero false-RED: a verified spec stays GREEN; where
//                         the spec demands nothing, strict skips stay green.
//
// Determinism: fixtures carry NO toolchain (no package.json/tsconfig/
// node_modules), so stages 1.1/1.2/2.1/2.2 skip deterministically and no
// network or host toolchain is ever consulted.
//
// DEVIATION from the original 0.6 plan sketch (schema reality): the spec
// schema REQUIRES `project.language`, so the "NO language declared" clean
// control is unrepresentable — a language-less spec.yaml is schema-invalid and
// ABSENCE_OF_GOVERNANCE rightly blocks it. Consequence: any schema-valid spec
// with a done feature in a toolchain-less fixture is strict-pre-push RED by
// the stage_1.1 demand (BY DESIGN — an unverifiable `done` is not GREEN).
// Seed 4 therefore splits: 4a proves the pre-commit drift floor is quiet on a
// verified done feature; 4b proves the no-demand strict pre-push contract
// (no done features → every skip stays green). And since a GREEN strict
// pre-push with done features is unreachable without a real toolchain, 4b
// asserts spec/attestation.yaml is NOT written (nothing done = nothing to
// attest) instead of the planned "attestation exists" bonus.

import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import {afterAll, describe, expect, test} from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The repo's real CLI shim — the same command a release engineer runs. */
const CLAD_BIN = resolve(HERE, '..', '..', 'bin', 'clad');

const TIMEOUT = 30_000;

/** Shape of one entry in `clad check --json`'s `stages` array. */
interface GateStageEntry {
  readonly stage: string;
  readonly label: string;
  readonly status: 'pass' | 'skip' | 'fail';
  readonly exitCode: number;
  readonly stderr?: string;
  readonly findings?: ReadonlyArray<{
    readonly detector: string;
    readonly severity: 'info' | 'warn' | 'error';
    readonly message: string;
  }>;
}

interface GateReport {
  readonly tier: string;
  readonly worst: number;
  readonly anyFailed: boolean;
  readonly stages: readonly GateStageEntry[];
}

const fixtures: string[] = [];
afterAll(() => {
  for (const f of fixtures) rmSync(f, {recursive: true, force: true});
});

/**
 * Scaffolds a complete, schema-valid cladding workspace in a mkdtemp dir:
 * spec.yaml (inline features — unsharded is valid) plus the three governance
 * files ABSENCE_OF_GOVERNANCE warns about when absent (warns block --strict).
 */
function scaffoldFixture(prefix: string, specYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(dir);
  mkdirSync(join(dir, 'spec'), {recursive: true});
  mkdirSync(join(dir, 'docs'), {recursive: true});
  writeFileSync(join(dir, 'spec.yaml'), specYaml, 'utf8');
  writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers: []\n', 'utf8');
  writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'schema: "0.1"\nsource: intent\ncapabilities: []\n', 'utf8');
  writeFileSync(join(dir, 'docs', 'project-context.md'), '# Project context\n\nDeterministic seed fixture for the vacuous-green release harness.\n', 'utf8');
  return dir;
}

/** Runs the real gate as a subprocess and parses its `--json` report. */
function runGate(cwd: string, tier: 'pre-commit' | 'pre-push', strict: boolean): GateReport {
  const args = [CLAD_BIN, 'check', `--tier=${tier}`, ...(strict ? ['--strict'] : []), '--json'];
  const proc = spawnSync(process.execPath, args, {cwd, encoding: 'utf8', timeout: TIMEOUT});
  expect(proc.error, `gate spawn failed: ${proc.error?.message ?? ''}`).toBeUndefined();
  expect(proc.stdout, `gate emitted no stdout (stderr: ${proc.stderr})`).toBeTruthy();
  return JSON.parse(proc.stdout) as GateReport;
}

/** Every blocking (error/warn) drift finding in the report's stage_1.3 entry. */
function blockingDriftFindings(report: GateReport): ReadonlyArray<{detector: string; severity: string; message: string}> {
  const drift = report.stages.find((s) => s.stage === 'stage_1.3');
  return (drift?.findings ?? []).filter((f) => f.severity === 'error' || f.severity === 'warn');
}

describe('vacuous-green seeds — the release gate as a re-runnable command (V6/V7)', () => {
  test(
    'SEED broken-entry: the gate RUNS the declared deliverable and fails on its crash (Mini-Lang 0/69 class)',
    () => {
      const dir = scaffoldFixture('vg-seed-broken-entry-', [
        'schema: "0.1"',
        'project:',
        '  name: seed-broken-entry',
        '  language: shell',
        '  deliverable:',
        '    path: ./run',
        '    smoke_args: []',
        '    is_safe_to_smoke: true',
        'features:',
        '  - id: F-aaaaaa',
        '    title: Broken entry shipped done',
        '    status: done',
        '    modules: [run]',
        '    acceptance_criteria:',
        '      - id: AC-aaaaaa',
        '        text: the entry point runs',
        '        test_refs: [spec.yaml]',
        '',
      ].join('\n'));
      writeFileSync(join(dir, 'run'), '#!/bin/sh\nexit 3\n', 'utf8');
      chmodSync(join(dir, 'run'), 0o755);

      const report = runGate(dir, 'pre-push', true);
      expect(report.worst).toBe(1);
      const smoke = report.stages.find((s) => s.stage === 'stage_2.4');
      expect(smoke, 'stage_2.4 entry missing from gate report').toBeDefined();
      expect(smoke?.status).toBe('fail');
      // The stage executed the entry itself — the failure names the real exit code.
      expect(smoke?.stderr).toMatch(/exited 3/);
    },
    TIMEOUT,
  );

  test(
    'SEED toolchain-absent: declared language + tested done feature must not silently waive verification (strict demand table, F-67d2e9)',
    () => {
      const dir = scaffoldFixture('vg-seed-toolchain-absent-', [
        'schema: "0.1"',
        'project:',
        '  name: seed-toolchain-absent',
        '  language: typescript',
        'features:',
        '  - id: F-bbbbbb',
        '    title: Shipped without a toolchain',
        '    status: done',
        '    acceptance_criteria:',
        '      - id: AC-bbbbbb',
        '        text: verified by declared tests',
        '        test_refs: [spec.yaml]',
        '',
      ].join('\n'));

      // Strict: the demand table converts the silent skips into appended fails.
      const strict = runGate(dir, 'pre-push', true);
      expect(strict.worst).toBe(1);
      const entriesOf = (stage: string) => strict.stages.filter((s) => s.stage === stage);
      // The stage itself skipped (no toolchain in the fixture, deterministically)…
      expect(entriesOf('stage_1.1').some((s) => s.status === 'skip')).toBe(true);
      expect(entriesOf('stage_2.1').some((s) => s.status === 'skip')).toBe(true);
      // …and the demand table APPENDED a blocking fail entry for each unmet demand.
      const demandFails = strict.stages.filter(
        (s) => (s.stage === 'stage_1.1' || s.stage === 'stage_2.1') && s.status === 'fail',
      );
      expect(demandFails.length).toBeGreaterThanOrEqual(2);
      expect(demandFails.map((s) => s.stage)).toContain('stage_1.1');
      expect(demandFails.map((s) => s.stage)).toContain('stage_2.1');

      // False-RED guard: WITHOUT --strict the lenient skip-as-pass contract holds.
      const lenient = runGate(dir, 'pre-push', false);
      expect(lenient.worst).toBe(0);
    },
    TIMEOUT,
  );

  test(
    'SEED hand-flipped-done: a done AC with no test_refs/evidence_refs trips the MISSING_TESTS drift floor at pre-commit',
    () => {
      const dir = scaffoldFixture('vg-seed-hand-flipped-', [
        'schema: "0.1"',
        'project:',
        '  name: seed-hand-flipped-done',
        '  language: typescript',
        'features:',
        '  - id: F-cccccc',
        '    title: Hand-flipped to done',
        '    status: done',
        '    acceptance_criteria:',
        '      - id: AC-cccccc',
        '        text: an unverified claim',
        '',
      ].join('\n'));

      const report = runGate(dir, 'pre-commit', true);
      expect(report.worst).toBe(1);
      const drift = report.stages.find((s) => s.stage === 'stage_1.3');
      expect(drift?.status).toBe('fail');
      const missingTests = (drift?.findings ?? []).filter(
        (f) => f.detector === 'MISSING_TESTS' && f.severity === 'error',
      );
      expect(missingTests.length).toBeGreaterThanOrEqual(1);
      expect(missingTests[0].message).toContain('F-cccccc');
    },
    TIMEOUT,
  );

  test(
    'SEED clean-control: a verified spec stays GREEN — no demand means strict skips stay green (zero false-RED)',
    () => {
      // 4a — verified done feature: the pre-commit drift floor must be silent.
      // (`project.language` is schema-REQUIRED, so the planned language-less
      // variant is unrepresentable; see the header DEVIATION note.)
      const doneControl = scaffoldFixture('vg-seed-clean-done-', [
        'schema: "0.1"',
        'project:',
        '  name: seed-clean-control',
        '  language: typescript',
        'features:',
        '  - id: F-dddddd',
        '    title: Verified and done',
        '    status: done',
        '    acceptance_criteria:',
        '      - id: AC-dddddd',
        '        text: verified via declared evidence',
        '        test_refs: [spec.yaml]',
        '',
      ].join('\n'));
      const preCommit = runGate(doneControl, 'pre-commit', true);
      expect(preCommit.worst).toBe(0);
      // Anything STALE_ATTESTATION (or any detector) says here must be info-only.
      expect(blockingDriftFindings(preCommit)).toEqual([]);

      // 4b — no done features: the spec demands nothing, so EVERY strict skip
      // stays green at both tiers (the false-RED guard for fresh projects).
      const noDemand = scaffoldFixture('vg-seed-clean-nodemand-', [
        'schema: "0.1"',
        'project:',
        '  name: seed-clean-control',
        '  language: typescript',
        'features:',
        '  - id: F-eeeeee',
        '    title: Still in flight',
        '    status: in_progress',
        '    acceptance_criteria:',
        '      - id: AC-eeeeee',
        '        text: not yet shipped',
        '        test_refs: [spec.yaml]',
        '',
      ].join('\n'));
      const ncPreCommit = runGate(noDemand, 'pre-commit', true);
      expect(ncPreCommit.worst).toBe(0);
      const ncPrePush = runGate(noDemand, 'pre-push', true);
      expect(ncPrePush.worst).toBe(0);
      expect(blockingDriftFindings(ncPrePush)).toEqual([]);
      // GREEN strict pre-push with zero done features attests nothing —
      // spec/attestation.yaml must NOT appear (writeAttestation's contract).
      expect(existsSync(join(noDemand, 'spec', 'attestation.yaml'))).toBe(false);
    },
    TIMEOUT,
  );
});
