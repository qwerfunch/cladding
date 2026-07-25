// Cladding · `clad done <featureId>` — the gated done-transition.
//
// WHY this exists: `status: done` is normally just the host AI writing YAML, so
// a feature can be declared "done" while its code does not typecheck or its
// tests are missing. The A/B run observed exactly this — a host marked 23
// features done while `clad check --tier=pre-push --strict` was RED (Type / Lint
// / Coverage failing). `done` claimed more than it had earned.
//
// `clad done` makes the transition EARN itself: flip the shard to done, run the
// pre-push strict gate, and KEEP done only if that gate is GREEN — otherwise
// revert. It is the floor that keeps `done` honest even outside the per-feature
// driver loop (a host that hand-writes `status: done` bypasses this verb, but
// the same gate at push/CI then fails on that feature's red stages).
//
// FLIP-THEN-GATE ORDER is deliberate: the done-aware detectors UNTESTED_AC and
// MISSING_TESTS skip features that are not yet `done`, so gating BEFORE the flip
// would green-light a feature that has no tests. We flip first so the gate
// evaluates the feature as done, then revert if it does not hold.

import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {recordEvent} from '../events/log.js';
import {join} from 'node:path';

import {parseSpec} from '../spec/parse.js';
import {doneRefusalLead, doneSelfCertRefusalLead} from '../ui/softShell.js';
import {computeIndependence, type IndependenceLabel} from '../hitl/independence.js';
import type {Evidence} from '../hitl/identity.js';
import type {GitOperation} from '../core/git-ops.js';

/** Gate runner injected so tests can drive `runDone` without spawning tsc/vitest. */
export interface DoneDeps {
  /** Runs a tier's stages; returns the worst exit code (0 = GREEN). */
  readonly checkStages: (opts: {
    strict?: boolean;
    tier?: string;
    focusModules?: readonly string[];
  }) => {worst: number; anyFailed?: boolean};
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
   * OPTIONAL independence seam (F-c566f590). When present, runDone computes the
   * feature's evidence-based independence label from `evidence` and threads it
   * into the DoneResult + the done_attempted event. Under `policy: 'require'` it
   * additionally REFUSES to keep a self-certified feature done (revert + re-sync,
   * exactly like a red gate). Injected + optional so runDone stays hermetic — no
   * loadSpec / readEvidence inside; an omitted dep behaves exactly as before
   * (label absent). Wired to project.independence_policy + readEvidence in
   * runDoneCommand.
   */
  readonly independence?: {
    /** 'label' = annotate only (default); 'require' = block a self-certified done. */
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
   * The feature's evidence-based independence label (F-c566f590). Present only
   * once the gate has run with an injected `independence` dep; absent on the
   * early refusals (git-op / missing shard / design impact) and when no dep was
   * supplied.
   */
  readonly independence?: IndependenceLabel;
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
 * Flips `featureId` to `done` iff the pre-push strict gate is GREEN with the
 * feature evaluated as done; reverts the shard byte-for-byte on a red gate.
 * All IO is the shard file under `cwd` plus the injected gate runner, so this
 * is unit-testable without the real toolchain.
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
  const original = readFileSync(hit.path, 'utf8');
  // Flip to done BEFORE gating so the done-aware detectors evaluate this
  // feature's test evidence (see module header).
  writeFileSync(hit.path, setStatus(original, 'done'));
  // Keep the committed index honest BEFORE gating: pre-push runs the
  // status-aware INVENTORY_DRIFT detector, so the index must already reflect
  // this flip — otherwise the new detector would RED this very write and the
  // gate would revert every legitimate `clad done`. (F-37b4a8)
  deps.onIndex?.(cwd);
  // Scope the gate to THIS feature's modules (Gradle monorepos). Empty → the
  // gate runs whole-repo, exactly as before. @see toolchain/scoped-command.ts
  const {worst, anyFailed} = deps.checkStages({
    tier: 'pre-push',
    strict: true,
    focusModules: hit.modules,
  });
  // F-c566f590 — the evidence-based independence label. Computed once from the
  // injected evidence slice (an omitted dep ⇒ undefined ⇒ pre-independence
  // behavior). It does NOT depend on the gate: a feature can be GREEN yet still
  // be self-certified (no human/blind evidence backs it).
  const independence = deps.independence
    ? computeIndependence(featureId, deps.independence.evidence).label
    : undefined;
  // Under the opt-in `require` policy a GREEN gate is necessary but NOT
  // sufficient: a self-certified feature must earn independent or human review
  // before it keeps done. This refusal reverts exactly like a red gate — but a
  // genuinely red gate takes precedence (its message stays unchanged).
  const selfCertBlocked =
    worst === 0 && deps.independence?.policy === 'require' && independence === 'self-certified';
  const kept = worst === 0 && !selfCertBlocked;
  // F-b84c38 — every done transition (kept or reverted) is forensic data; the
  // independence label rides along on both paths (F-c566f590).
  recordEvent(cwd, 'done_attempted', {
    feature: featureId,
    worst,
    anyFailed: anyFailed ?? worst > 0,
    kept,
    ...(independence ? {independence} : {}),
  });
  if (kept) {
    return {
      ok: true,
      code: 0,
      featureId,
      prevStatus: hit.status,
      shardPath: hit.path,
      independence,
      reason: `strict gate GREEN — status: ${hit.status || 'unset'} → done`,
    };
  }
  // Not kept — revert to exactly what was there and re-sync the index
  // symmetrically, else it would keep the pre-gate `done` row against a reverted
  // shard (inverse staleness). (F-37b4a8) BOTH the red-gate and the
  // require-policy refusal share this revert.
  writeFileSync(hit.path, original);
  deps.onIndex?.(cwd);
  // Plain-first (F-dd8dc994): a plain English lead first; the machine sentence
  // (kept byte-for-byte) follows as a language-neutral tail so contract pins
  // survive. The host agent renders the user's own language (F-9af291fa).
  if (selfCertBlocked) {
    // GREEN gate, but the project requires the independent review this feature
    // lacks (AC-ad5ea48b). Same revert as a red gate; a different plain lead.
    return {
      ok: false,
      code: 1,
      featureId,
      prevStatus: hit.status,
      shardPath: hit.path,
      independence,
      reason:
        `${doneSelfCertRefusalLead()}. ` +
        `no independent or human review backs this feature — status left at '${hit.status || 'unset'}'.` +
        ' Add a human sign-off or an independent (blind) review, then re-run `clad done`.',
    };
  }
  // Red gate: the feature has not earned done. Contract pins ('not GREEN',
  // 'status left at') survive in the machine tail.
  return {
    ok: false,
    code: 1,
    featureId,
    prevStatus: hit.status,
    shardPath: hit.path,
    independence,
    reason:
      `${doneRefusalLead()}. ` +
      `strict gate not GREEN — status left at '${hit.status || 'unset'}'.` +
      ' Fix the failing stage(s) above, then re-run `clad done`.',
  };
}
