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
import type {Deliverable, SmokeProbe} from '../spec/types.js';
import type {CommandStageOptions, Disposition, ProbeOutcome, StageResult} from './types.js';
import {isMissingBinary, missingToolSkip} from './util.js';

const STAGE = 'stage_2.4';
const DEFAULT_TIMEOUT_MS = 5000;
/** Whole-stage wall-clock ceiling: never spend more than this across ALL probes. */
const STAGE_CEILING_MS = 30_000;

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
  let probes: readonly SmokeProbe[] = [];
  let anyDone = false;
  let featureStatus = new Map<string, string>();
  try {
    const spec = loadSpec(cwd);
    deliverable = spec.project.deliverable;
    probes = spec.project.smoke ?? [];
    anyDone = spec.features.some((f) => f.status === 'done');
    // Per-feature status: the per-probe binding gate reads this to smoke a bound
    // probe only once ITS feature is done (F-4ef09f38 — demand goes per-feature).
    featureStatus = new Map(spec.features.map((f) => [f.id, f.status]));
  } catch {
    // Unreadable spec → ABSENCE_OF_GOVERNANCE blocks; this stage just skips.
    return {stage: STAGE, pass: false, exitCode: 2, stderr: 'spec.yaml not loaded — deliverable smoke skipped'};
  }
  // F-g' — functional smoke probes take precedence over the legacy deliverable.
  // F-4ef09f38 — EVERY declared probe runs (worst-of aggregation); N=1 is the
  // degenerate case of the same runner, so single-probe semantics are unchanged.
  if (probes.length > 0) return runSmokeProbes(cwd, probes, {anyDone, featureStatus});
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
  // F-8f419e — a legacy exit-only deliverable that runs clean is LIVENESS, not a
  // green PASS: it proves the entry doesn't crash, NOT that any AC behaviour holds.
  // The reducer (stages/disposition.ts) renders 'liveness' non-green + non-blocking.
  if (got === expect) return {stage: STAGE, pass: true, exitCode: 0, disposition: 'liveness'};
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

// ── multi-probe smoke (F-4ef09f38) ──────────────────────────────────────────
//
// EVERY declared probe runs, in declaration order, and the stage disposition is
// the WORST per-probe disposition — one green probe can never mask a red one
// (the only honest aggregate for a gate). v1 ran only probes[0], silently
// non-executing probes 2..N: a latent vacuous green of the exact class the
// Honest series forbids.

/**
 * Internal per-probe outcome. `disposition` widens the fixed Disposition enum
 * with a `skip` sentinel (execaSync ENOENT / no-argv / project-global gating) —
 * the legacy "cladding chose not to run" lane (exit 2, non-blocking). `skip`
 * never leaves this module: the stage folds all-skip → the exit-2 skip lane, and
 * the structured ProbeOutcome maps it to `na`.
 */
type ProbeDisposition = Disposition | 'skip';
interface ProbeEval {
  readonly argv: string;
  readonly kind: 'cli' | 'none';
  readonly disposition: ProbeDisposition;
  readonly detail: string;
  readonly feature?: string;
  readonly why?: string;
}

/** Worst-of ordering: fail > pending_env/advisory > liveness > pass > na > skip. */
const RANK: Record<ProbeDisposition, number> = {
  fail: 5,
  advisory: 4,
  pending_env: 4,
  liveness: 3,
  pass: 2,
  na: 1,
  skip: 0,
};

/** Report glyph per disposition (one line per probe — visible non-execution). */
const GLYPH: Record<ProbeDisposition, string> = {
  pass: '✓',
  fail: '✗',
  liveness: 'liveness',
  na: 'na',
  pending_env: 'pending_env',
  advisory: 'advisory',
  skip: 'skip',
};

interface ProbeCtx {
  readonly anyDone: boolean;
  readonly featureStatus: ReadonlyMap<string, string>;
}

/**
 * Executes each probe in declaration order under a whole-stage wall-clock
 * ceiling (min of probe-count × per-probe timeout, 30 s). A probe that cannot
 * START before the ceiling is truncated reports `pending_env` (reason: stage
 * time ceiling) — never dropped, because visible non-execution is the point.
 * The stage disposition is the worst per-probe disposition; the exit code
 * follows the disposition spine (blocking ⇒ 1, all-skip ⇒ 2, else 0).
 */
function runSmokeProbes(cwd: string, probes: readonly SmokeProbe[], ctx: ProbeCtx): StageResult {
  const ceiling = Math.min(probes.length * DEFAULT_TIMEOUT_MS, STAGE_CEILING_MS);
  const started = Date.now();
  const evals: ProbeEval[] = [];
  for (const probe of probes) {
    // The ceiling gates STARTING a probe; a probe already begun keeps its own
    // per-probe timeout. Non-executing probes (na/skip) accrue ~0 wall-clock, so
    // only real execution can push later probes past the ceiling. The first probe
    // always starts (ceiling ≥ one per-probe timeout).
    if (Date.now() - started >= ceiling) {
      evals.push({
        argv: (probe.run ?? []).join(' ') || '(none)',
        kind: probe.kind,
        disposition: 'pending_env',
        detail: 'stage time ceiling — not started',
        feature: probe.feature,
        why: probe.why,
      });
      continue;
    }
    evals.push(evalProbe(cwd, probe, ctx));
  }
  return finalizeSmoke(evals);
}

/**
 * Evaluates ONE probe (no cross-probe state). kind:none ⇒ na. A probe BOUND to a
 * feature (probe.feature) is per-feature-gated: not-done or dangling ⇒ na, argv
 * NOT executed (nothing shipped ⇒ nothing to smoke — SMOKE_PROBE_DEMAND warns the
 * dangling id separately); done ⇒ executes regardless of the project-global
 * anyDone rule. UNBOUND probes keep the project-global anyDone gating. When it
 * runs: exit mismatch ⇒ fail; clean exit + matched token ⇒ green pass; clean exit
 * + no token ⇒ exit-only liveness (non-green). The gate RE-EXECUTES the recipe.
 */
function evalProbe(cwd: string, probe: SmokeProbe, ctx: ProbeCtx): ProbeEval {
  const argv = (probe.run ?? []).join(' ') || '(none)';
  const why = probe.why;
  if (probe.kind === 'none') {
    return {argv: '(kind:none)', kind: 'none', disposition: 'na', detail: 'nothing to run (library/static)', why};
  }
  const bound = probe.feature;
  if (bound !== undefined) {
    const status = ctx.featureStatus.get(bound);
    if (status !== 'done') {
      // Not-done OR dangling → na, argv NOT executed (AC-3). A dangling id is
      // annotation drift, separately warned by SMOKE_PROBE_DEMAND (AC-4).
      const detail =
        status === undefined
          ? `bound feature ${bound} not found in spec — not executed`
          : `bound feature ${bound} is ${status}, not done — not executed`;
      return {argv, kind: 'cli', disposition: 'na', detail, feature: bound, why};
    }
    // Bound feature IS done → smoke it regardless of the project-global gate.
  } else if (!ctx.anyDone) {
    // Unbound: project-global gating unchanged — nothing shipped, nothing to run.
    return {argv, kind: 'cli', disposition: 'skip', detail: 'no done feature yet — smoke probe skipped', why};
  }
  const run = probe.run ?? [];
  if (run.length === 0) {
    return {argv: '(none)', kind: 'cli', disposition: 'skip', detail: 'cli smoke probe has no run argv — skipped', feature: bound, why};
  }
  const [bin, ...args] = run;
  // A leading ./ or / is a project-relative entry; otherwise a PATH binary (node, npm…).
  const exe = bin.startsWith('.') || bin.startsWith('/') ? resolve(cwd, bin) : bin;
  const timeout = DEFAULT_TIMEOUT_MS;
  let proc: ProcLike;
  try {
    proc = execaSync(exe, [...args], {cwd, reject: false, timeout}) as ProcLike;
  } catch (err) {
    proc = err as ProcLike;
  }
  if (isMissingBinary(proc)) {
    return {argv, kind: 'cli', disposition: 'skip', detail: `'${bin}' not installed`, feature: bound, why};
  }
  if (proc.timedOut) {
    return {argv, kind: 'cli', disposition: 'fail', detail: `timed out after ${timeout}ms`, feature: bound, why};
  }
  const expectExit = probe.expect?.exit ?? 0;
  const got = proc.exitCode ?? 1;
  if (got !== expectExit) {
    const d = String(proc.stderr ?? '').trim() || String(proc.stdout ?? '').trim();
    return {argv, kind: 'cli', disposition: 'fail', detail: `exited ${got}, expected ${expectExit}${d ? ` — ${d.slice(0, 200)}` : ''}`, feature: bound, why};
  }
  const token = probe.expect?.token;
  if (!token) {
    // Exit-only: proves the entry runs, NOT that any AC behaviour holds → liveness.
    return {argv, kind: 'cli', disposition: 'liveness', detail: `ran clean (exit ${got}), no token declared — exit-only`, feature: bound, why};
  }
  if (String(proc.stdout ?? '').includes(token)) {
    return {argv, kind: 'cli', disposition: 'pass', detail: `ran clean (exit ${got}), stdout contains ${JSON.stringify(token)}`, feature: bound, why};
  }
  return {
    argv,
    kind: 'cli',
    disposition: 'fail',
    detail: `ran (exit ${got}) but stdout did not contain the AC token ${JSON.stringify(token)}`,
    feature: bound,
    why,
  };
}

/**
 * Folds per-probe evals into the stage result. Stage disposition = worst by
 * RANK; the report is one line per probe in DECLARATION order (stable). All
 * probes `skip` (none ran, nothing to run) ⇒ the legacy exit-2 skip lane, no
 * disposition. Otherwise the worst disposition drives exit: blocking
 * {fail, pending_env, advisory} ⇒ 1; {liveness, pass, na} ⇒ 0.
 */
function finalizeSmoke(evals: readonly ProbeEval[]): StageResult {
  let worst: ProbeDisposition = 'skip';
  for (const e of evals) {
    if (RANK[e.disposition] > RANK[worst]) worst = e.disposition;
  }
  const stderr = evals
    .map((e) => {
      const why = e.why ? ` · ${e.why}` : '';
      return `${GLYPH[e.disposition]} ${e.argv} · ${e.detail}${why}`;
    })
    .join('\n');
  const probes: ProbeOutcome[] = evals.map((e, i) => ({
    id: `probe_${i + 1}`,
    kind: e.kind,
    // ProbeOutcome.disposition is the fixed Disposition enum — fold skip → na.
    disposition: e.disposition === 'skip' ? 'na' : e.disposition,
    bindsFeature: e.feature,
    why: e.why,
    detail: e.detail,
  }));
  if (worst === 'skip') {
    // Every probe was a non-run skip → cladding chose not to run (exit-2 lane).
    return {stage: STAGE, pass: false, exitCode: 2, stderr, probes};
  }
  const blocking = worst === 'fail' || worst === 'pending_env' || worst === 'advisory';
  return {
    stage: STAGE,
    pass: !blocking,
    exitCode: blocking ? 1 : 0,
    disposition: worst,
    stderr,
    probes,
  };
}

const isCliEntry =
  !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runDeliverableSmoke();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
