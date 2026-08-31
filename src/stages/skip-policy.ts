// Cladding · strict skip-policy (F-67d2e9)
//
// INVARIANT (gate core): exit 2 = "skipped — cladding chose not to run" and
// is non-blocking. That leniency is correct for fresh projects and partial
// toolchains, but it converts "done = verified" into a silent pass whenever
// the missing tool happens to be the one the spec RELIES on. Pre-0.6 only
// the Unit stage had a guard; this module generalizes it: under --strict, a
// skipped stage the spec DEMANDS is a fail, appended as its own entry so the
// user sees exactly which demand went unmet.
//
// Demand-gated, never blanket — no demand ⇒ skip stays green. This is the
// false-RED defense that ships BEFORE the 0.6 enforcement hooks lean on it.

import type {Spec} from '../spec/types.js';

/** One unmet demand: a skipped stage the spec relies on. */
export interface SkipViolation {
  readonly stage: string;
  readonly label: string;
  readonly message: string;
}

/** Stages this policy can demand, in pipeline order. */
const DEMANDABLE = ['stage_1.1', 'stage_2.1', 'stage_2.3', 'stage_2.4'] as const;
type Demandable = (typeof DEMANDABLE)[number];

function doneFeatures(spec: Spec): readonly Spec['features'][number][] {
  return (spec.features ?? []).filter((f) => f.status === 'done');
}

/**
 * Evaluates the demand table for one stage. Returns the violation message
 * when the spec demands the stage, or null when the skip is legitimate.
 */
function demand(spec: Spec, stage: Demandable): string | null {
  const done = doneFeatures(spec);
  switch (stage) {
    case 'stage_1.1': {
      // A declared language with shipped features means the type toolchain
      // is part of the project's verification story, not an optional extra.
      if (!spec.project?.language || done.length === 0) return null;
      return (
        `project.language is '${spec.project.language}' and ${done.length} feature(s) are done, ` +
        'but the type checker did not run (skipped) — type safety of shipped code was never verified. ' +
        "Install the language toolchain; under --strict, an unverifiable 'done' is not GREEN."
      );
    }
    case 'stage_2.1': {
      const testedDone = done.filter((f) =>
        (f.acceptance_criteria ?? []).some((ac) => (ac.test_refs ?? []).length > 0),
      ).length;
      if (testedDone === 0) return null;
      return (
        `${testedDone} done feature(s) declare tests but the test runner did not run (skipped) — ` +
        "the implementation was never verified. Install the test framework; under --strict, an unverifiable 'done' is not GREEN."
      );
    }
    case 'stage_2.3': {
      const oracleAcs = done
        .flatMap((f) => f.acceptance_criteria ?? [])
        .filter((ac) => ((ac as {oracle_refs?: readonly string[]}).oracle_refs ?? []).length > 0).length;
      if (oracleAcs === 0) return null;
      return (
        `${oracleAcs} done AC(s) declare oracle_refs but the conformance runner did not run (skipped) — ` +
        "the declared oracles never executed. Under --strict, declared-but-unrun verification is not GREEN."
      );
    }
    case 'stage_2.4': {
      const deliverable = spec.project?.deliverable;
      if (!deliverable?.is_safe_to_smoke || done.length === 0) return null;
      return (
        `project.deliverable '${deliverable.path}' is marked is_safe_to_smoke and ${done.length} feature(s) are done, ` +
        "but the deliverable smoke did not run (skipped) — the declared runnable entry was never verified. Under --strict, an unverifiable 'done' is not GREEN."
      );
    }
  }
}

/**
 * The strict skip-policy: given the per-stage outcomes of a gate run, return
 * one violation per skipped stage the spec demands. The caller appends each
 * as a fail entry and forces worst ≥ 1. Spec load failures yield no
 * violations — ABSENCE_OF_GOVERNANCE owns that blocking signal.
 */
export function strictSkipViolations(
  spec: Spec,
  // `status` is widened from the legacy 3-bucket to any gate status (smoke adds
  // pending_env/advisory/na/liveness, F-e0f6c7); this policy only keys on 'skip'.
  outcomes: ReadonlyArray<{readonly stage: string; readonly status: string}>,
): readonly SkipViolation[] {
  const violations: SkipViolation[] = [];
  for (const stage of DEMANDABLE) {
    const skipped = outcomes.some((o) => o.stage === stage && o.status === 'skip');
    if (!skipped) continue;
    const message = demand(spec, stage);
    if (message) violations.push({stage, label: 'Verification', message});
  }
  return violations;
}
