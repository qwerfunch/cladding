// Cladding · drive · autonomous loop (agent dispatch)
//
// v0.2.0 rewires the v0.1 deterministic floor so each ready feature
// is now authored through the {@link AgentAdapter} layer:
//
//   1. developer persona drafts the implementation (mock or real),
//   2. its mutations are applied to the working tree,
//   3. L1 gates (Type / Lint / Arch) verify the result,
//   4. reviewer persona inspects in a separate dispatch — the
//      reviewer-vs-author identity barrier (F-049 AC-086) is
//      enforced inside `drive/agent.ts`,
//   5. UAT (stage_4.2) confirms a human-pass evidence exists; if
//      not, the loop halts with `HUMAN_REQUIRED`.
//
// Any adapter error short-circuits the loop with a transport-specific
// halt class — `TRANSPORT_AUTH_FAILED`, `TRANSPORT_RATE_LIMITED`,
// `TRANSPORT_NETWORK`, or `LLM_UNAVAILABLE` as the catch-all — chosen
// by `classifyTransportError` (v0.2.22, F-071). The mock host adapters
// never throw, but real SDK transports (AnthropicTransport since
// v0.2.20) do, and the classifier picks the most actionable category.
//
// @see spec/features/F-049.yaml AC-085 / AC-086 / AC-087 / AC-088.
// @see adapters/types.ts — `AgentAdapter` contract.
// @see drive/agent.ts — `runAgent` + reviewer barrier.

import {existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {loadPersona} from '../agents/loader.js';
import {runAgent, ReviewerIdentityCollisionError} from './agent.js';
import {selectAdapter} from '../adapters/index.js';
import {findLatestCheckpoint, recordCheckpoint, recordRollback} from '../core/checkpoint.js';
import {writePostMortem} from '../core/postmortem.js';
import {appendEvent, newEvent} from '../events/log.js';
import {newEvidence} from '../hitl/identity.js';
import {appendEvidence} from '../hitl/audit.js';
import {loadSpec} from '../spec/load.js';
import {pulseProgress, pulseProgressEnd} from '../ui/pulse.js';
import type {Feature, Spec} from '../spec/types.js';
import {runArch} from '../stages/arch.js';
import {runLint} from '../stages/lint.js';
import {runType} from '../stages/type.js';
import {runUat} from '../stages/uat.js';
import type {AgentContext, AgentMutation} from '../adapters/types.js';
import {
  DEFAULT_BUDGET,
  type HaltReason,
  type LoopBudget,
  checkBudget,
  classifyTransportError,
} from './halt.js';

export interface DriveOptions {
  readonly cwd?: string;
  readonly goal?: string;
  readonly budget?: LoopBudget;
  /**
   * Skips the pre-flight `adapter.healthCheck()` (v0.2.23, F-072).
   * Production callers leave this `false` so a missing API key, an
   * unreachable host, or a misconfigured transport halts the loop
   * before any iteration. Unit tests that stub `runAgent` set it to
   * `true` so the loop's control flow can be exercised without a
   * live adapter.
   */
  readonly skipHealthCheck?: boolean;
}

export interface DriveResult {
  readonly halt: HaltReason;
  readonly iterations: number;
  readonly featuresTouched: readonly string[];
  readonly stubsCreated: readonly string[];
  readonly gateRuns: number;
}

function nextReady(spec: Spec, done: ReadonlySet<string>): Feature | undefined {
  for (const f of spec.features) {
    if (done.has(f.id)) continue;
    if (f.status === 'archived') continue;
    const deps = f.depends_on ?? [];
    if (deps.every((d) => done.has(d))) return f;
  }
  return undefined;
}

/**
 * Materialises an empty stub at {@link modulePath} only when the
 * adapter declined to author the file itself. Real adapters return
 * proper mutations and this fallback is a no-op; the stub keeps the
 * v0.1 floor's L1 gates passing on mock adapters that report zero
 * mutations.
 */
function ensureStub(cwd: string, modulePath: string): boolean {
  const abs = join(cwd, modulePath);
  if (existsSync(abs)) return false;
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(
    abs,
    '// auto-stub created by clad drive — replace with real implementation\nexport {};\n',
  );
  return true;
}

/**
 * Applies the adapter's mutations to the working tree.
 *
 * Each mutation is either a create (write contents), an edit
 * (overwrite contents — adapters do not produce diffs in v0.2.0),
 * or a delete (unlink). Directories are created on demand.
 */
function applyMutations(cwd: string, mutations: readonly AgentMutation[]): void {
  for (const m of mutations) {
    const abs = join(cwd, m.path);
    if (m.kind === 'delete') {
      if (existsSync(abs)) {
        try {
          unlinkSync(abs);
        } catch {
          rmSync(abs, {recursive: true, force: true});
        }
      }
      continue;
    }
    mkdirSync(dirname(abs), {recursive: true});
    writeFileSync(abs, m.contents ?? '');
  }
}

function ctxFor(cwd: string, feature: Feature): AgentContext {
  return {
    featureId: feature.id,
    featureShard: JSON.stringify(feature),
    guardrails: [],
    cwd,
  };
}

/** Runs the autonomous loop. Always returns a HaltReason. */
export async function runDriveLoop(opts: DriveOptions = {}): Promise<DriveResult> {
  const cwd = opts.cwd ?? '.';
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const startedAt = Date.now();
  const retries = new Map<string, number>();
  // Tracks the most recent failed gate per feature so the post-mortem
  // writer (Phase 3.3) can name the gate the rollback inherited from.
  const lastFailedGate = new Map<string, string>();
  const featuresTouched: string[] = [];
  const stubsCreated: string[] = [];
  let gateRuns = 0;
  let iteration = 0;

  let spec: Spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return {
      halt: {class: 'UNCAUGHT_ERROR', detail: `spec load failed: ${(err as Error).message}`, iteration: 0},
      iterations: 0,
      featuresTouched: [],
      stubsCreated: [],
      gateRuns: 0,
    };
  }

  // Pre-flight transport health check (v0.2.23, F-072). Fail fast on
  // missing credentials, bad transport config, or unreachable host
  // before any iteration begins. The reason string is routed through
  // classifyTransportError so the user gets the same actionable
  // halt class (AUTH_FAILED / RATE_LIMITED / NETWORK / LLM_UNAVAILABLE)
  // they would see if the throw had come from inside the loop.
  if (opts.skipHealthCheck !== true) {
    const adapter = selectAdapter(cwd);
    const health = await adapter.healthCheck();
    if (!health.ready) {
      const reason = health.reason ?? 'transport not ready';
      return {
        halt: {
          class: classifyTransportError(new Error(reason)),
          detail: `pre-flight health check failed: ${reason}`,
          iteration: 0,
        },
        iterations: 0,
        featuresTouched: [],
        stubsCreated: [],
        gateRuns: 0,
      };
    }
  }

  appendEvent(cwd, newEvent('feature_activated', {goal: opts.goal ?? null, total: spec.features.length}));
  const done = new Set(
    spec.features.filter((f) => f.status === 'done' || f.status === 'archived').map((f) => f.id),
  );

  const developer = loadPersona('developer');
  const reviewer = loadPersona('reviewer');

  while (true) {
    iteration += 1;
    const budgetHalt = checkBudget(iteration, startedAt, retries, budget);
    if (budgetHalt) {
      // Iron Law backbone Phase 3.2 (ironclad-design 02-iron-law §2.5) —
      // when the budget tripped because a single feature exhausted its
      // retry quota, auto-roll the working tree to that feature's
      // latest checkpoint. The checkpoint was pinned in the loop body
      // before the first specialist dispatch. recordRollback emits one
      // `feature_rolled_back` event so the audit trail captures the
      // transition; the actual git checkout stays with the maintainer
      // (Phase 1 boundary — see core/checkpoint.ts header).
      if (budgetHalt.class === 'RETRY_THRESHOLD') {
        for (const [featureId, count] of retries) {
          if (count >= budget.maxRetriesPerFeature) {
            const cp = findLatestCheckpoint(cwd, featureId);
            if (cp) {
              recordRollback(
                cwd,
                featureId,
                cp,
                `retry budget exhausted after ${count} attempts`,
              );
              // Phase 3.3 (ironclad-design 02-iron-law §2.5) — Librarian
              // authors a post-mortem markdown summarising the failure
              // so the next session has a starting brief. Phase 3.3
              // stops at file authoring; context injection into the
              // next agent dispatch is a v0.3.x+ follow-up.
              writePostMortem(cwd, {
                featureId,
                retryCount: count,
                lastFailedGate: lastFailedGate.get(featureId) ?? 'unknown',
                checkpoint: cp,
                rolledBackAt: new Date().toISOString(),
              });
            }
            break;
          }
        }
      }
      return finish(budgetHalt);
    }

    const ready = nextReady(spec, done);
    if (!ready) {
      const halt: HaltReason =
        done.size === spec.features.length
          ? {class: 'ALL_FEATURES_DONE', detail: `${done.size} features cleared`, iteration}
          : {class: 'BLOCKED_FEATURE', detail: 'no feature has its depends_on satisfied', iteration};
      return finish(halt);
    }

    featuresTouched.push(ready.id);
    // Iron Law backbone Phase 3.2 (ironclad-design 02-iron-law §2.5) —
    // pin a checkpoint before the first agent dispatch so a later
    // RETRY_THRESHOLD halt has a known-good state to roll back to.
    // Phase 1 (v0.3.20) shipped the event surface; this phase wires
    // the drive loop into it.
    recordCheckpoint(cwd, ready.id);
    const ctx = ctxFor(cwd, ready);

    // Step 1 — specialist authors the implementation.
    pulseProgress('run', ready.id, 'specialist');
    let specialistIdentity: string | undefined;
    try {
      const specialistOut = await runAgent(developer, ctx);
      specialistIdentity = specialistOut.result.identity.name;
      applyMutations(cwd, specialistOut.result.mutations);
    } catch (err) {
      pulseProgressEnd('fail', ready.id, 'specialist dispatch failed');
      return finish({
        class: classifyTransportError(err),
        detail: `specialist dispatch failed: ${(err as Error).message}`,
        iteration,
      });
    }

    // Step 2 — fall back to module stubs only when the adapter
    // produced no concrete file mutations (mock stage).
    for (const modulePath of ready.modules ?? []) {
      if (ensureStub(cwd, modulePath)) stubsCreated.push(modulePath);
    }

    // Step 3 — L1 gates verify the produced state. Drift (stage_1.3)
    // stays intentionally excluded — the loop runs while the spec
    // is partially stubbed and a spec-wide MISSING_IMPLEMENTATION
    // sweep would always fail. `clad check` covers drift after the
    // loop completes.
    pulseProgress('run', ready.id, 'L1 gates');
    const gates = [
      ['stage_1.1', runType({cwd})],
      ['stage_1.2', runLint({cwd})],
      ['stage_1.5', runArch({cwd})],
    ] as const;
    gateRuns += gates.length;
    // `exitCode !== 2` excludes genuine skips (missing tool / unknown language).
    // Safe because stages map a ran-tool failure to exitCode 1, never 2 (see
    // stages/util.ts::ranToolResult) — so a real type/lint/arch failure here is
    // exitCode 1 and correctly blocks the feature from advancing.
    const failed = gates.find(([, r]) => !r.pass && r.exitCode !== 2);
    if (failed) {
      retries.set(ready.id, (retries.get(ready.id) ?? 0) + 1);
      lastFailedGate.set(ready.id, failed[0]);
      appendEvent(cwd, newEvent('drift_detected', {feature: ready.id, gate: failed[0]}));
      pulseProgressEnd(
        'fail',
        ready.id,
        `${failed[0]} fail · retry ${retries.get(ready.id) ?? 0}/${budget.maxRetriesPerFeature}`,
      );
      continue;
    }

    // Step 4 — reviewer inspects. ReviewerIdentityCollisionError
    // bubbles up from drive/agent.ts when the adapter returns an
    // identity equal to the specialist — halt with HUMAN_REQUIRED.
    pulseProgress('run', ready.id, 'reviewer');
    try {
      await runAgent(reviewer, ctx, {implementerIdentityName: specialistIdentity});
    } catch (err) {
      if (err instanceof ReviewerIdentityCollisionError) {
        pulseProgressEnd('fail', ready.id, 'reviewer identity collision');
        return finish({
          class: 'HUMAN_REQUIRED',
          detail: `${ready.id}: reviewer identity matched implementer — needs human sign-off`,
          iteration,
        });
      }
      pulseProgressEnd('fail', ready.id, 'reviewer dispatch failed');
      return finish({
        class: classifyTransportError(err),
        detail: `reviewer dispatch failed: ${(err as Error).message}`,
        iteration,
      });
    }

    // Step 5 — UAT (stage_4.2) requires a human-pass evidence.
    // Without one the loop pauses for sign-off instead of marking
    // the feature done.
    pulseProgress('run', ready.id, 'UAT');
    const uat = runUat({cwd});
    if (!uat.pass && uat.exitCode !== 2) {
      pulseProgressEnd('fail', ready.id, 'UAT human sign-off required');
      return finish({
        class: 'HUMAN_REQUIRED',
        detail: `${ready.id}: UAT lacks human-pass evidence — needs human sign-off`,
        iteration,
      });
    }

    // Evidence is recorded per-AC when the feature declares
    // `acceptance_criteria`, otherwise a single feature-scoped entry
    // is logged as a fallback. The per-AC fan-out is what unlocks
    // anti-self-cert.checkAc() to operate at the AC granularity it
    // was designed for — without an `acId`, the guard sees only
    // unattributed tool/LLM evidence and can never tell which AC
    // is missing its human-author sign-off.
    //
    // @see hitl/identity.ts — Evidence.acId field has been part of
    //   the schema since v0.2.x but was previously unfilled here.
    // @see hitl/anti-self-cert.ts — checkAc filters by `e.acId`.
    const acIds = (ready.acceptance_criteria ?? []).map((ac) => ac.id);
    if (acIds.length === 0) {
      appendEvidence(
        cwd,
        newEvidence({
          featureId: ready.id,
          stage: 'stage_1.3',
          kind: 'pass',
          content: 'clad run — L1 gates pass after specialist + reviewer dispatch',
          identity: {author: 'tool', name: 'clad-drive'},
        }),
      );
    } else {
      for (const acId of acIds) {
        appendEvidence(
          cwd,
          newEvidence({
            featureId: ready.id,
            acId,
            stage: 'stage_1.3',
            kind: 'pass',
            content: `clad run — L1 gates pass for ${acId}`,
            identity: {author: 'tool', name: 'clad-drive'},
          }),
        );
      }
    }
    appendEvent(cwd, newEvent('feature_completed', {feature: ready.id, by: 'clad-drive'}));
    pulseProgressEnd('pass', ready.id, 'done');
    done.add(ready.id);
  }

  function finish(halt: HaltReason): DriveResult {
    appendEvent(cwd, newEvent('feature_completed', {halt: halt.class, detail: halt.detail}));
    return {halt, iterations: iteration, featuresTouched, stubsCreated, gateRuns};
  }
}
