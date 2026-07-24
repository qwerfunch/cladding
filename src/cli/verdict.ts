// Cladding · `clad verdict` handler (F-2e28cc72)
//
// Wires the pure reducer (src/verdict/verdict.ts) to the REAL gate + spec:
//   loadSpec → checkStages(pre-push, strict, SILENT, exactly once) → computeVerdict
// One gate touch per poll, subsumed here — a host loop calls THIS instead of the
// gate, not in addition. The poll is read-only: `silent` suppresses every
// user-facing write AND the attestation stamp, so calling `clad verdict` never
// mutates spec/attestation.yaml.
//
// The gate is INJECTED (mirrors DoneDeps.checkStages): this handler must not
// import the clad.ts module, or madge flags the clad.ts ↔ verdict.ts import
// cycle as a blocking ARCHITECTURE_VIOLATION. clad.ts imports us one-way and
// passes runCheckStages in. DI also keeps the handler hermetically testable.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import process from 'node:process';

import {loadSpec} from '../spec/load.js';
import {readEvidence} from '../hitl/audit.js';
import {independenceSummary} from '../hitl/independence.js';
import {fingerprintFindings, nextProgress, type ProgressState} from '../verdict/gate-progress.js';
import {computeVerdict, type Verdict, type VerdictOutcome} from '../verdict/verdict.js';

/** Gitignored per-poll progress state — the ONLY new write. Never a tracked
 *  file, never attestation, so the poll-not-mutate lock holds for the tree. */
function progressPath(): string {
  return join(process.cwd(), '.cladding', 'verdict-progress.json');
}

/** Best-effort read of the previous poll's progress. Missing/corrupt → undefined
 *  (a first-ever or unreadable state is simply "no prior" — never stuck). */
function readProgress(): ProgressState | undefined {
  try {
    const raw = JSON.parse(readFileSync(progressPath(), 'utf8')) as {fingerprint?: unknown; repeat?: unknown};
    const fingerprint = typeof raw.fingerprint === 'string' ? raw.fingerprint : undefined;
    const repeat = typeof raw.repeat === 'number' ? raw.repeat : undefined;
    if (fingerprint === undefined) return undefined;
    return {fingerprint, repeat: repeat ?? 1};
  } catch {
    return undefined;
  }
}

/** Best-effort persist of the new progress state. A write failure must NEVER
 *  crash the poll or change the verdict — it just means "stuck" won't persist. */
function writeProgress(state: ProgressState): void {
  try {
    const path = progressPath();
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, `${JSON.stringify(state)}\n`, 'utf8');
  } catch {
    /* unwritable state dir → poll still answers; the streak just won't persist */
  }
}

/** Injected dependency: the REAL gate runner (runCheckStages), so the handler
 *  never reaches into the cli entry module. Return type is the reducer's
 *  structural mirror of CheckOutcome — runCheckStages satisfies it. */
export interface VerdictDeps {
  readonly checkStages: (opts: {tier?: string; strict?: boolean; silent?: boolean}) => VerdictOutcome;
}

/** Handler for `clad verdict`. Exit 0 on a successful poll — the `verdict` field
 *  IS the signal (DONE/ITERATE/…); we do NOT map it to the gate's exit code. */
export function runVerdictCommand(opts: {json?: boolean; tier?: string}, deps: VerdictDeps): void {
  let spec;
  try {
    spec = loadSpec();
  } catch (err) {
    // A spec that will not load is not a poll failure to hide — it is a human's
    // problem. Answer ESCALATE (a stable, machine-readable poll result) so the
    // host loop stops cleanly instead of crashing.
    const v: Verdict = {
      verdict: 'ESCALATE',
      next_action: `spec could not be loaded: ${(err as Error).message} — fix the spec, then run the gate`,
      remaining: [],
      halt_class: 'SPEC_UNREADABLE',
    };
    emit(v, opts.json === true);
    process.exit(0);
  }

  const outcome = deps.checkStages({tier: opts.tier ?? 'pre-push', strict: true, silent: true});

  // Stuck detection (F-b0c8ba2c): fingerprint THIS run's blocking findings, compare
  // to the previous poll's persisted state, and persist the new state. All of it
  // lives in verdict's OWN gitignored state file — the gate is never touched (the
  // `gate_run` event dedupes two identical stuck runs to one, so "stuck" cannot be
  // read from there). computeVerdict stays PURE: `stuck` flows in as an input.
  const prior = readProgress();
  const currentFp = fingerprintFindings(outcome.stages ?? []);
  const prog = nextProgress(currentFp, prior);
  writeProgress({fingerprint: prog.fingerprint, repeat: prog.repeat});

  // F-c566f590 — annotate each DONE feature with its evidence-based independence
  // label, computed HERE (CLI wrapper) from the read-only ledger so the pure
  // reducer stays IO-free (AC-6f228987). Reading evidence touches no tracked file
  // → the poll-not-mutate lock (module header) holds.
  const doneIds = spec.features.filter((f) => f.status === 'done').map((f) => f.id);
  const summary = independenceSummary(doneIds, readEvidence(process.cwd()));
  const v: Verdict = {...computeVerdict({outcome, spec, stuck: prog.stuck}), independence: summary.labels};
  emit(v, opts.json === true);
  process.exit(0);
}

/** Machine JSON under --json; one concise plain line otherwise. */
function emit(v: Verdict, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
    return;
  }
  const tail = v.next_action ? ` — ${v.next_action}` : '';
  // Append the independence split ONLY when at least one done feature is
  // self-certified — the signal worth surfacing (an all-independent run stays
  // quiet). The counts come straight off the labels the JSON already carries.
  const labels = v.independence ?? [];
  const selfCertified = labels.filter((l) => l.label === 'self-certified').length;
  const indep =
    selfCertified > 0
      ? ` — independence: ${labels.length - selfCertified} independent / ${selfCertified} self-certified`
      : '';
  process.stdout.write(`verdict: ${v.verdict}${tail}${indep}\n`);
}
