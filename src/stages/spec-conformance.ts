// Cladding · stage_2.3 Spec-conformance (impl-blind oracle execution)
//
// The keystone of "No Vacuous Green". The v6r A/B proved cladding's gate went
// 7/7 GREEN on a 5-bug implementation: every prior stage validates the agent's
// OWN self-authored tests + drift + coverage — never whether the code matches
// the SPEC. This stage runs an IMPL-BLIND, spec-derived oracle suite (authored
// WITHOUT sight of the implementation) against the real code, so a pass means
// "matches the spec", not "matches what the coder happened to test".
//
//   pass criteria: oracle suite exit 0 — every spec-derived check passes
//   determinism: deterministic. The oracle is committed; only its AUTHORING
//                involved an LLM — the gate merely RUNS it.
//   llm cost: 0
//
// Oracle convention: test files under `tests/oracle/` (polyglot — the detected
// test runner is simply pointed at that directory). No oracles present → SKIP
// (exitCode 2, non-blocking): the *presence* obligation for `done` ACs is
// enforced separately by the SPEC_CONFORMANCE drift detector, so this stage
// never false-passes by silence — it only reports on oracles that exist.

import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

import {execaSync} from 'execa';

import {detectToolchain} from './toolchain/detect.js';
import {testReportCandidatePaths} from './toolchain/gate-config.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip, ranToolResult} from './util.js';

const STAGE = 'stage_2.3';
/** Where spec-derived oracle suites live (relative to project root). */
export const ORACLE_DIR = 'tests/oracle';

interface TestReportSnapshot {
  readonly path: string;
  /** Undefined means the candidate did not exist before the scoped run. */
  readonly body?: Buffer;
  readonly mode?: number;
  readonly atime?: Date;
  readonly mtime?: Date;
  /** A directory or other non-file candidate is never modified by restoration. */
  readonly nonFile?: boolean;
}

/** Capture report bytes and observable file metadata before the partial run. */
function snapshotTestReports(cwd: string): readonly TestReportSnapshot[] {
  return testReportCandidatePaths(cwd).map((path) => {
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return {path, nonFile: true};
      return {
        path,
        body: readFileSync(path),
        mode: stat.mode,
        atime: stat.atime,
        mtime: stat.mtime,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {path};
      throw error;
    }
  });
}

/** Restore existing reports and remove reports created only by the partial run. */
function restoreTestReports(snapshots: readonly TestReportSnapshot[]): readonly string[] {
  const errors: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.nonFile) continue;
    try {
      if (snapshot.body === undefined) {
        if (!existsSync(snapshot.path)) continue;
        if (!statSync(snapshot.path).isFile()) {
          errors.push(`${snapshot.path}: scoped oracle run created a non-file report candidate`);
          continue;
        }
        unlinkSync(snapshot.path);
        continue;
      }
      writeFileSync(snapshot.path, snapshot.body);
      if (snapshot.mode !== undefined) chmodSync(snapshot.path, snapshot.mode);
      if (snapshot.atime && snapshot.mtime) utimesSync(snapshot.path, snapshot.atime, snapshot.mtime);
    } catch (error) {
      errors.push(`${snapshot.path}: ${(error as Error).message}`);
    }
  }
  return errors;
}

/** True when `dir` contains at least one test/spec file (any nesting depth). */
function hasOracle(dir: string): boolean {
  let found = false;
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, {withFileTypes: true})) {
      if (found) return;
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(ent.name) || /_test\.py$/.test(ent.name)) found = true;
    }
  };
  try {
    walk(dir);
  } catch {
    /* unreadable dir → treated as "no oracles" */
  }
  return found;
}

/**
 * Runs the project's impl-blind spec-conformance oracle suite (under
 * `tests/oracle/`) against the implementation and returns an Ironclad-shaped
 * result. Absent oracles → SKIP (exitCode 2); a real oracle failure → blocking
 * fail (exitCode 1), so GREEN can finally fail on latent non-conformance.
 *
 * @param opts - Optional cwd override.
 * @returns A stage result.
 * @see stages/detectors/spec-conformance.ts — the presence/provenance guard.
 * @see spec/features/spec-conformance-oracle-stage-c4c5ae.yaml AC-008
 */
export function runSpecConformance(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  const abs = join(cwd, ORACLE_DIR);
  if (!existsSync(abs) || !hasOracle(abs)) {
    return {stage: STAGE, pass: false, exitCode: 2, stderr: `no spec-conformance oracles under ${ORACLE_DIR}/ — skipped`};
  }
  const toolchain = detectToolchain(cwd);
  const test = toolchain.gates.test;
  if (!test?.cmd || !test.args) {
    return {stage: STAGE, pass: false, exitCode: 2, stderr: `no test runner registered for language '${toolchain.language}'`};
  }
  // Point the detected test runner at the oracle dir only (npx vitest run
  // tests/oracle · pytest tests/oracle · …) — never the agent's own suite.
  //
  // A project reporter can write every invocation to one authoritative JUnit
  // path. Without isolation, this deliberately-partial oracle run replaces the
  // full unit report; the NEXT strict gate then misreads every ordinary test_ref
  // as unexecuted. Preserve every configured/conventional report candidate so
  // stage_2.3 cannot leak its narrower selection into another stage or run.
  let snapshots: readonly TestReportSnapshot[];
  try {
    snapshots = snapshotTestReports(cwd);
  } catch (error) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 1,
      stderr: `could not preserve the full test report before the scoped oracle run: ${(error as Error).message}`,
    };
  }
  let proc: ReturnType<typeof execaSync> | undefined;
  let runError: unknown;
  const runArgs = [...test.args, ORACLE_DIR];
  try {
    proc = execaSync(test.cmd, runArgs, {cwd, reject: false});
  } catch (error) {
    runError = error;
  }
  const restoreErrors = restoreTestReports(snapshots);
  if (restoreErrors.length > 0) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 1,
      stderr: `could not restore the full test report after the scoped oracle run: ${restoreErrors.join('; ')}`,
    };
  }
  if (runError || !proc) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 1,
      stderr: `oracle runner failed to start: ${(runError as Error)?.message ?? 'unknown error'}`,
    };
  }
  const skip = missingToolSkip(STAGE, test.cmd, proc, runArgs);
  if (skip) return skip;
  return ranToolResult(STAGE, proc);
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runSpecConformance();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
