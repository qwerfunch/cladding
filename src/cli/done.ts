// Cladding · `clad done <featureId>` — the gated done-transition.
//
// WHY this exists: `status: done` is normally just the host AI writing YAML, so
// a feature can be declared "done" while its code does not typecheck or its
// tests are missing. The A/B run observed exactly this — a host marked 23
// features done while `clad check --tier=pre-push --strict` was RED (Type / Lint
// / Coverage failing). `done` claimed more than it had earned.
//
// `clad done` makes the transition EARN itself. Schema 0.1 retains its shipped
// flip → strict gate → rollback compatibility path. Schema 0.2 evaluates a
// prospective done view and only journals the claim with its GREEN v3 receipt.
// It is the floor that keeps `done` honest even outside the per-feature driver
// loop (a host that hand-writes `status: done` bypasses this verb, but the same
// gate at push/CI then fails on that feature's red stages).
//
// The legacy flip-then-gate order is deliberate: done-aware detectors skip
// features that are not yet `done`. Schema 0.2 supplies that same detector and
// compiler view in memory, so a process death cannot strand a done shard with
// no receipt.

import {existsSync, readdirSync} from 'node:fs';
import {recordEvent} from '../events/log.js';
import {blockingDetectorNames, type TelemetryStage} from '../events/stop-telemetry.js';
import {join} from 'node:path';

import {parseSpec} from '../spec/parse.js';
import {
  finalizeFeatureDoneForGate,
  markFeatureDoneForGate,
  prepareSchema02DoneEvent,
  restoreFailedDoneForGate,
  type DoneGateFinalization,
  type GeneratedAttestationCompletion,
  type DoneGateMark,
  type PreparedSchema02DoneEvent,
} from '../spec/edit.js';
import {doneRefusalLead, doneSelfCertRefusalLead} from '../ui/softShell.js';
import {computeIndependence, type IndependenceLabel} from '../hitl/independence.js';
import type {Evidence} from '../hitl/identity.js';
import type {GitOperation} from '../core/git-ops.js';

/**
 * The independence label a completion can report.
 *
 * Schema 0.1 reports the two-valued evidence-ledger label. Schema 0.2 reports
 * the assurance kernel's scope label, which adds `not-applicable` (the profile
 * asks for no human review) and `unobserved` (the implementation authors are
 * not fully mapped, so no reviewer can be told apart from them).
 */
export type DoneIndependenceLabel = IndependenceLabel | 'not-applicable' | 'unobserved';

/** Where a reported independence label came from. */
export type DoneIndependenceSource = 'evidence-ledger' | 'assurance-kernel';

/** Gate runner injected so tests can drive `runDone` without spawning tsc/vitest. */
export interface DoneDeps {
  /** Runs a tier's stages; returns the worst exit code (0 = GREEN). */
  readonly checkStages: (opts: {
    strict?: boolean;
    tier?: string;
    profile?: string;
    focusModules?: readonly string[];
    scopeSubjects?: readonly string[];
    deferAttestation?: boolean;
    prospectiveFeatureId?: string;
    completionGate?: DoneGateMark;
    completionEvent?: PreparedSchema02DoneEvent;
  }) => {
    worst: number;
    anyFailed?: boolean;
    stages?: readonly TelemetryStage[];
    /**
     * The canonical assurance projection of this run (schema 0.2). Only the
     * scope independence label is read here: it is the label the receipt that
     * attests the completion carries, so it — not the evidence ledger — is what
     * a schema 0.2 completion reports and enforces (F-8e7f399b).
     */
    assurance?: {readonly independence: DoneIndependenceLabel};
    commitAttestation?: (completion: GeneratedAttestationCompletion) => void;
  };
  /**
   * Regenerate the committed feature index after a status flip (on BOTH the
   * kept and the reverted branch) so spec/index.yaml's per-row status never lags
   * the shard. Optional + injected so unit tests stay hermetic; wired to
   * writeFeatureIndex in runDoneCommand. (F-37b4a8 — index status fidelity.)
   */
  readonly onIndex?: (cwd: string) => void;
  /**
   * Names any git merge / rebase / cherry-pick in progress under `cwd` (else
   * null). Injected + optional so unit tests stay hermetic: an omitted probe
   * (or one returning null) leaves the transition unguarded exactly as before.
   * Wired to gitOperationInProgressName in runDoneCommand — a settled tree is a
   * precondition of an earned `done`, so a mid-operation flip is refused before
   * any shard, index, or attestation write.
   */
  readonly gitOpInProgress?: (cwd: string) => GitOperation | null;
  /**
   * OPTIONAL independence seam (F-c566f590). On schema 0.1, runDone computes the
   * feature's evidence-based independence label from `evidence` and threads it
   * into the DoneResult + the done_attempted event. Under `policy: 'require'` it
   * additionally REFUSES to keep a self-certified feature done (revert + re-sync,
   * exactly like a red gate). Injected + optional so runDone stays hermetic — no
   * loadSpec / readEvidence inside; an omitted dep behaves exactly as before
   * (label absent). Wired to project.independence_policy + readEvidence in
   * runDoneCommand.
   *
   * Schema 0.2 reads the attested label from the gate instead (F-8e7f399b), so
   * there this dep supplies only the policy and its `evidence` is unread.
   */
  readonly independence?: {
    /**
     * 'label' = annotate only (default); 'require' = block a done the project's
     * policy will not accept. Schema 0.1 blocks a self-certified feature; schema
     * 0.2 blocks the kernel labels `self-certified` and `unobserved`, and lets
     * `independent` and `not-applicable` through (F-8e7f399b).
     */
    readonly policy: 'label' | 'require';
    /** The evidence ledger slice runDone weighs the feature against. */
    readonly evidence: readonly Evidence[];
  };
}

/** Outcome of a `clad done` attempt — `code` is the process exit code. */
export interface DoneResult {
  readonly ok: boolean;
  readonly code: number;
  readonly featureId: string;
  readonly prevStatus?: string;
  readonly shardPath?: string;
  /**
   * The feature's independence label. Present only once the gate has run;
   * absent on the early refusals (git-op / missing shard / design impact).
   *
   * Schema 0.1 keeps the evidence-based label (F-c566f590) and reports it only
   * when the optional `independence` dep was supplied. Schema 0.2 reports the
   * label the assurance kernel attested for this completion (F-8e7f399b), with
   * or without that dep — the dep only decides whether the label is enforced.
   */
  readonly independence?: DoneIndependenceLabel;
  /**
   * Which authority produced `independence`, so a reader never mistakes the
   * ledger label for the attested one. Absent exactly when no label is present.
   */
  readonly independence_source?: DoneIndependenceSource;
  /**
   * Schema of the workspace the transition ran against. Present once the gate
   * has run, so the CLI can say what a schema 0.2 completion leaves to do.
   */
  readonly schemaVersion?: '0.1' | '0.2';
  readonly reason: string;
}

interface ShardHit {
  readonly path: string;
  readonly status: string;
  /** The feature's declared `modules[]` — forwarded to scope the gate. */
  readonly modules: readonly string[];
  readonly designImpactStatus?: string;
}

/**
 * Finds the `spec/features/` shard file whose top-level `id` equals `featureId`,
 * returning its path and current status. Returns null when no shard matches
 * (e.g. the feature is inlined in spec.yaml, or the id is unknown).
 */
export function findShardFile(cwd: string, featureId: string): ShardHit | null {
  const dir = join(cwd, 'spec', 'features');
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
    const path = join(dir, f);
    let doc: unknown;
    try {
      doc = parseSpec(path);
    } catch {
      continue;
    }
    const rec = doc as {id?: unknown; status?: unknown; modules?: unknown; design_impact?: {status?: unknown}};
    if (rec && rec.id === featureId) {
      const modules = Array.isArray(rec.modules)
        ? rec.modules.filter((m): m is string => typeof m === 'string')
        : [];
      return {
        path,
        status: typeof rec.status === 'string' ? rec.status : '',
        modules,
        designImpactStatus: typeof rec.design_impact?.status === 'string' ? rec.design_impact.status : undefined,
      };
    }
  }
  return null;
}

/**
 * Rewrites a shard body's top-level `status:` line to `status: <status>`,
 * preserving every other byte (comments, ordering, quoting elsewhere). Falls
 * back to inserting the line after `id:` when no status line exists.
 */
export function setStatus(body: string, status: string): string {
  if (/^status:[ \t]*.*$/m.test(body)) {
    return body.replace(/^status:[ \t]*.*$/m, `status: ${status}`);
  }
  if (/^id:[ \t]*.*$/m.test(body)) {
    return body.replace(/^(id:[ \t]*.*)$/m, `$1\nstatus: ${status}`);
  }
  return `status: ${status}\n${body}`;
}

/**
 * Schema 0.1 flips `featureId` before the strict gate and restores it on RED.
 * Schema 0.2 evaluates an immutable in-memory done view and publishes that
 * view only with a GREEN v3 receipt in one final F4 transaction.
 */
export function runDone(cwd: string, featureId: string, deps: DoneDeps): DoneResult {
  if (!featureId) {
    return {ok: false, code: 2, featureId, reason: 'feature id required (e.g. clad done F-001)'};
  }
  const op = deps.gitOpInProgress?.(cwd) ?? null;
  if (op) {
    return {
      ok: false,
      code: 1,
      featureId,
      reason:
        `${op} in progress — refusing done until the tree settles.` +
        ` Complete or abort the ${op}, then re-run \`clad done\`. Nothing in the spec or its records was changed.`,
    };
  }
  const hit = findShardFile(cwd, featureId);
  if (!hit) {
    return {
      ok: false,
      code: 1,
      featureId,
      reason:
        `no feature in the spec declares id '${featureId}'` +
        ' (inline features: edit spec.yaml then run `clad check --tier=pre-push --strict` manually)',
    };
  }
  if (hit.designImpactStatus === 'review_required') {
    return {
      ok: false,
      code: 1,
      featureId,
      reason:
        'structural design impact still needs review — apply the listed architecture, capability, or project-context changes, ' +
        'then resolve the design impact before marking this feature done.',
    };
  }
  let marked: DoneGateMark;
  // Schema 0.1 flips before gating for compatibility. Schema 0.2 only
  // prepares a byte-bound prospective target here. `runCheckStages` consumes
  // that capability before it creates the sole done-aware overlay, without a
  // durable claim.
  try {
    marked = markFeatureDoneForGate(cwd, featureId);
  } catch (error) {
    return {
      ok: false,
      code: 1,
      featureId,
      prevStatus: hit.status,
      shardPath: hit.path,
      reason: (error as Error).message,
    };
  }
  // Schema 0.1's evidence decision is immutable for the whole completion
  // attempt: its exact label is sealed into the private success-event binding
  // before any stage can issue a writer callback. Schema 0.2 seals no such
  // label — the label it reports and enforces is the kernel's, which exists
  // only once the gate that consumes the sealed event has run (F-8e7f399b).
  const ledgerIndependence = marked.schemaVersion === '0.1' && deps.independence
    ? computeIndependence(featureId, deps.independence.evidence).label
    : undefined;
  let completionEvent: PreparedSchema02DoneEvent | undefined;
  if (marked.schemaVersion === '0.2') {
    try {
      completionEvent = prepareSchema02DoneEvent(cwd, marked, undefined);
    } catch (error) {
      return {
        ok: false,
        code: 1,
        featureId,
        prevStatus: marked.previousStatus,
        shardPath: marked.path,
        reason: (error as Error).message,
      };
    }
  }
  // Scope the gate to THIS feature's modules (Gradle monorepos). Empty → the
  // gate runs whole-repo, exactly as before. @see toolchain/scoped-command.ts
  let gate: {
    worst: number;
    anyFailed?: boolean;
    stages?: readonly TelemetryStage[];
    assurance?: {readonly independence: DoneIndependenceLabel};
    commitAttestation?: (completion: GeneratedAttestationCompletion) => void;
  };
  const schemaVersion = marked.schemaVersion;
  try {
    const runGate = () => deps.checkStages({
      tier: 'pre-push',
      // Schema 0.2 completion authority is the canonical profile reducer:
      // adding the legacy strict flag would make a transport switch decide an
      // otherwise identical authoritative verdict.  Schema 0.1 keeps its
      // historical strict pre-push compatibility unchanged.
      ...(schemaVersion === '0.2'
        ? {
          profile: 'completion', scopeSubjects: [`feature:${featureId}`], deferAttestation: true,
          prospectiveFeatureId: featureId, completionGate: marked, completionEvent,
        }
        : {strict: true}),
      focusModules: marked.gateScope.modules,
    });
    gate = runGate();
  } catch (error) {
    if (schemaVersion === '0.1') {
      try {
        restoreFailedDoneForGate(cwd, marked.rollback);
      } catch (compensationError) {
        return {
          ok: false,
          code: 1,
          featureId,
          prevStatus: marked.previousStatus,
          shardPath: marked.path,
          reason: `strict gate threw and automatic compensation also failed: ${(error as Error).message}; ${(compensationError as Error).message}`,
        };
      }
    }
    return {
      ok: false,
      code: 1,
      featureId,
      prevStatus: marked.previousStatus,
      shardPath: marked.path,
      reason: `strict gate threw; status left at '${marked.previousStatus || 'unset'}': ${(error as Error).message}`,
    };
  }
  const {worst, anyFailed, stages} = gate;
  const blockers = blockingDetectorNames(stages ?? []);
  // A schema 0.2 completion reports what its own receipt attested. A kernel that
  // published no label at all is reported as `unobserved` rather than silently
  // dropped: absence of the fact is exactly what that value names.
  const independence: DoneIndependenceLabel | undefined = schemaVersion === '0.2'
    ? gate.assurance?.independence ?? 'unobserved'
    : ledgerIndependence;
  const reported: Pick<DoneResult, 'independence' | 'independence_source'> = independence === undefined
    ? {}
    : {
      independence,
      independence_source: schemaVersion === '0.2' ? 'assurance-kernel' : 'evidence-ledger',
    };
  // Under the opt-in `require` policy a GREEN gate is necessary but NOT
  // sufficient: the completion must earn the independent or human review the
  // project asks for before it keeps done. Schema 0.1 weighs its evidence-ledger
  // label; schema 0.2 weighs the attested one, where `not-applicable` (this
  // profile asks for no human review) is nothing to withhold and `unobserved`
  // (the authors are not fully mapped) is not a review that happened. This
  // refusal reverts exactly like a red gate — but a genuinely red gate takes
  // precedence (its message stays unchanged).
  const selfCertBlocked = worst === 0 && deps.independence?.policy === 'require'
    && (independence === 'self-certified' || (schemaVersion === '0.2' && independence === 'unobserved'));
  // A schema 0.2 completion is one combined status-and-receipt authority
  // action.  A green compatibility gate without the prepared F6 commit seam
  // cannot leave a new `done` status behind.
  const missingSchema02Receipt = schemaVersion === '0.2' && worst === 0
    && !selfCertBlocked && gate.commitAttestation === undefined;
  if (missingSchema02Receipt) {
    return {
      ok: false,
      code: 1,
      featureId,
      prevStatus: marked.previousStatus,
      shardPath: marked.path,
      ...reported,
      reason: 'completion receipt was not prepared, so no completion claim was written.',
    };
  }
  if (worst === 0 && !selfCertBlocked) {
    if (schemaVersion === '0.2' && gate.commitAttestation) {
      try {
        // The F4 writer receives all preimages plus the sole success event.
        // Its one recovery journal publishes status, generated projections,
        // v3 attestation, and `done_attempted` together, or none of them.
        gate.commitAttestation({
          rollback: marked.rollback,
          targetGeneration: marked.targetGeneration,
          targetBytes: marked.targetBytes,
          rootBefore: marked.rootBefore,
          attestationBefore: marked.attestationBefore,
          event: {
            type: 'done_attempted',
            payload: {
              feature: featureId,
              worst: 0,
              anyFailed: false,
              kept: true,
              blockers: [],
              // No independence key: the ledger label is not what this
              // completion enforces, and the label that is exists only after
              // this event was sealed (F-8e7f399b AC-64feb2ea).
            },
          },
        });
      } catch (error) {
        return {
          ok: false,
          code: 1,
          featureId,
          prevStatus: marked.previousStatus,
          shardPath: marked.path,
          ...reported,
          reason: `completion receipt could not be recorded; no completion claim was written: ${(error as Error).message}`,
        };
      }
    }
  }
  if (worst === 0 && !selfCertBlocked && schemaVersion === '0.1') {
    let finalization: DoneGateFinalization;
    try {
      finalization = finalizeFeatureDoneForGate(cwd, marked.rollback, marked.targetGeneration);
    } catch (error) {
      return {
        ok: false,
        code: 1,
        featureId,
        prevStatus: marked.previousStatus,
        shardPath: marked.path,
        ...reported,
        reason: `strict gate GREEN but final status verification failed: ${(error as Error).message}`,
      };
    }
    if (!finalization.kept) {
      recordEvent(cwd, 'done_attempted', {
        feature: featureId,
        worst,
        anyFailed: anyFailed ?? false,
        kept: false,
        blockers,
        ...(ledgerIndependence ? {independence: ledgerIndependence} : {}),
      });
      return {
        ok: false,
        code: 1,
        featureId,
        prevStatus: marked.previousStatus,
        shardPath: marked.path,
        ...reported,
        reason:
          'The feature changed while its verification ran, so the GREEN gate result is stale and status was not kept as done. ' +
          'Review the latest feature state, then re-run `clad done`.',
      };
    }
  }
  const kept = worst === 0 && !selfCertBlocked;
  // Schema 0.1 preserves F-b84c38's forensic events on both outcomes. Schema
  // 0.2 journals only the successful completion event with its F4 transaction.
  if (kept) {
    // Schema 0.2 placed this exact success record in the same F4 journal as
    // the status and attestation. Schema 0.1 preserves its historical
    // observer append after the kept flip.
    if (schemaVersion === '0.1') {
      recordEvent(cwd, 'done_attempted', {
        feature: featureId,
        worst,
        anyFailed: anyFailed ?? worst > 0,
        kept,
        blockers,
        ...(ledgerIndependence ? {independence: ledgerIndependence} : {}),
      });
    }
    return {
      ok: true,
      code: 0,
      featureId,
      prevStatus: marked.previousStatus,
      shardPath: marked.path,
      ...reported,
      schemaVersion,
      reason: `strict gate GREEN — status: ${marked.previousStatus || 'unset'} → done`,
    };
  }
  // Schema 0.1 reverts and re-syncs its legacy pre-gate flip. Schema 0.2 has
  // no durable target yet, so its RED and policy refusals leave canonical
  // completion artifacts untouched.
  if (schemaVersion === '0.1') {
    try {
      restoreFailedDoneForGate(cwd, marked.rollback);
    } catch (error) {
      return {
        ok: false,
        code: 1,
        featureId,
        prevStatus: marked.previousStatus,
        shardPath: marked.path,
        ...reported,
        reason: `strict gate not GREEN and automatic compensation failed: ${(error as Error).message}`,
      };
    }
  }
  if (schemaVersion === '0.1') {
    recordEvent(cwd, 'done_attempted', {
      feature: featureId,
      worst,
      anyFailed: anyFailed ?? worst > 0,
      kept,
      blockers,
      ...(ledgerIndependence ? {independence: ledgerIndependence} : {}),
    });
  }
  // Plain-first (F-dd8dc994): a plain English lead first; the machine sentence
  // (kept byte-for-byte) follows as a language-neutral tail so contract pins
  // survive. The host agent renders the user's own language (F-9af291fa).
  if (selfCertBlocked) {
    // GREEN gate, but the project requires the independent review this feature
    // lacks (AC-ad5ea48b). Schema 0.1 reverts; schema 0.2 has not written.
    // An unobserved label is a third state: the review may exist, but the run
    // could not tell its author apart from the implementation's, so it says so
    // instead of reading the gap as either answer (AC-c426d070).
    const unobservedNote = independence === 'unobserved'
      ? ' independence could not be observed here because the implementation authors are not fully mapped,'
        + ' so no reviewer can be told apart from them.'
      : '';
    // What actually clears the refusal differs by schema: the ledger accepts a
    // human sign-off from anyone, while the attested label only moves when the
    // reviewer is someone other than the implementation's own authors.
    const remedy = schemaVersion === '0.2'
      ? ' Ask a registered issuer other than the implementation authors for a verified review, then re-run `clad done`.'
      : ' Add a human sign-off or an independent (blind) review, then re-run `clad done`.';
    return {
      ok: false,
      code: 1,
      featureId,
      prevStatus: marked.previousStatus,
      shardPath: marked.path,
      ...reported,
      reason:
        `${doneSelfCertRefusalLead()}. ` +
        `no independent or human review backs this feature — status left at '${marked.previousStatus || 'unset'}'.` +
        unobservedNote +
        remedy,
    };
  }
  // Red gate: the feature has not earned done. Contract pins ('not GREEN',
  // 'status left at') survive in the machine tail.
  return {
    ok: false,
    code: 1,
    featureId,
    prevStatus: marked.previousStatus,
    shardPath: marked.path,
    ...reported,
    reason:
      `${doneRefusalLead()}. ` +
      `strict gate not GREEN — status left at '${marked.previousStatus || 'unset'}'.` +
      ' Fix the failing stage(s) above, then re-run `clad done`.',
  };
}
