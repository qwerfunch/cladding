// Cladding · stage_2.4 Deliverable smoke
//
// Closes the "broken entry shipped green" gap the Mini-Lang A/B benchmark exposed:
// an agent refactored its evaluator and broke the `./run` entry, yet the gate went
// GREEN because the unit tests import internals directly and never invoke the
// entry. This stage makes the GATE run the spec-declared deliverable ITSELF — not
// an agent-authored test — and assert it does not crash.
//
//   pass criteria: project.deliverable runs on smoke_args with exit === expect_exit
//   determinism:   probabilistic (real I/O) — like stage_3.1; pre-push+/all only
//   llm cost:      0 (no authoring; the gate executes existing code)
//
// SAFETY: executing the deliverable bears real side effects (a server binds a
// port, a migration mutates a DB), so it runs ONLY when the author vouches via
// `deliverable.is_safe_to_smoke: true` — never auto-executing arbitrary project
// code. Bounded further by a hard timeout and captured output; never wired into
// pre-commit. The complementary pure detector DELIVERABLE_INTEGRITY (stage_1.3)
// flags a declared-but-missing path and warns when done features ship modules
// with no deliverable, so silencing the smoke always leaves an auditable signal.
//
// BOUNDARY: catches "the entry is broken/unexercised", NOT "the entry runs but is
// wrong per spec" (stdout-vs-stderr, wrong output) — that stays the impl-blind
// oracle's (stage_2.3) job. Complementary, not a substitute.

import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import process from 'node:process';

import {execaSync} from 'execa';

import {loadSpec} from '../spec/load.js';
import type {Deliverable} from '../spec/types.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip} from './util.js';

const STAGE = 'stage_2.4';
const DEFAULT_TIMEOUT_MS = 5000;

/** An execaSync(reject:false) result OR a thrown ExecaError — same shape. */
interface ProcLike {
  readonly code?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
}

export function runDeliverableSmoke(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  let deliverable: Deliverable | undefined;
  let anyDone = false;
  try {
    const spec = loadSpec(cwd);
    deliverable = spec.project.deliverable;
    anyDone = spec.features.some((f) => f.status === 'done');
  } catch {
    // Unreadable spec → ABSENCE_OF_GOVERNANCE blocks; this stage just skips.
    return {stage: STAGE, pass: false, exitCode: 2, stderr: 'spec.yaml not loaded — deliverable smoke skipped'};
  }
  if (!deliverable) {
    return {stage: STAGE, pass: false, exitCode: 2, stderr: 'no project.deliverable declared — skipped'};
  }
  if (deliverable.is_safe_to_smoke !== true) {
    // Declaration-gated: never auto-execute project code the author hasn't vouched.
    return {stage: STAGE, pass: false, exitCode: 2, stderr: `deliverable '${deliverable.path}' not marked is_safe_to_smoke — skipped`};
  }
  if (!anyDone) {
    // Nothing shipped yet — the entry need not run.
    return {stage: STAGE, pass: false, exitCode: 2, stderr: 'no done feature yet — deliverable smoke skipped'};
  }
  const entry = resolve(cwd, deliverable.path);
  if (!existsSync(entry)) {
    // Declared safe + something done, but the entry is absent. DELIVERABLE_INTEGRITY
    // emits the blocking error; skip here to avoid double-reporting.
    return {stage: STAGE, pass: false, exitCode: 2, stderr: `deliverable '${deliverable.path}' not found — see DELIVERABLE_INTEGRITY`};
  }
  const timeout = deliverable.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  // execaSync(reject:false) RETURNS on a missing binary (ENOENT) and on a clean
  // non-zero exit, but may THROW on timeout in some versions — the catch maps the
  // thrown ExecaError (same shape) so both paths are handled uniformly.
  let proc: ProcLike;
  try {
    proc = execaSync(entry, [...(deliverable.smoke_args ?? [])], {cwd, reject: false, timeout}) as ProcLike;
  } catch (err) {
    proc = err as ProcLike;
  }
  const skip = missingToolSkip(STAGE, deliverable.path, proc);
  if (skip) return skip; // entry not executable / not found at exec time
  if (proc.timedOut) {
    return {stage: STAGE, pass: false, exitCode: 1, stderr: `deliverable '${deliverable.path}' timed out after ${timeout}ms (hung or too slow)`};
  }
  const expect = deliverable.expect_exit ?? 0;
  const got = proc.exitCode ?? 1;
  if (got === expect) return {stage: STAGE, pass: true, exitCode: 0};
  // INVARIANT (stages/util.ts): a stage that RAN and failed maps to exitCode 1,
  // never 2 (reserved for skip). An unexpected exit is a real, blocking failure.
  const detail = String(proc.stderr ?? '').trim() || String(proc.stdout ?? '').trim();
  return {
    stage: STAGE,
    pass: false,
    exitCode: 1,
    stderr: `deliverable '${deliverable.path}' exited ${got}, expected ${expect}${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
  };
}

const isCliEntry =
  !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runDeliverableSmoke();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
