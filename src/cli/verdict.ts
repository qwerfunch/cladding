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

import process from 'node:process';

import {loadSpec} from '../spec/load.js';
import {computeVerdict, type Verdict, type VerdictOutcome} from '../verdict/verdict.js';

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
  const v = computeVerdict({outcome, spec});
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
  process.stdout.write(`verdict: ${v.verdict}${tail}\n`);
}
