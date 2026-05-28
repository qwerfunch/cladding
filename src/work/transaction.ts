// Cladding · work · transaction (0.4.3, F-89406c / F-ca18ea)
//
// The single-feature work transaction. Wraps:
//   enter_work   → spec status planned → in_progress + persona prompt + scope
//   complete_work → scope-aware iron law + status → done + evidence append
//   abandon_work → status preserved + registry entry removed + event recorded
//
// Persona dispatch — option 1: cladding never invokes an LLM itself.
// `enter_work` returns the persona body string + the scoped module list,
// and the calling host AI adopts that persona for the next turn by
// injecting it as a system prompt. Keeps the harness host-agnostic and
// cost-free. See docs/0.5.0-architecture.md §"Persona dispatch".

import {loadPersona} from '../agents/loader.js';
import {newEvent, appendEvent} from '../events/log.js';
import {
  appendEvidence,
  getFeatureScope,
  updateFeatureStatus,
  FeatureNotFoundError,
  InvalidStatusTransitionError,
} from '../spec/update.js';
import {runDrift} from '../stages/drift.js';
import {
  type ActiveWork,
  getActiveWork,
  registerActiveWork,
  removeActiveWork,
} from './registry.js';

/** Default implicit-close timeout (10 minutes). Override via spec.yaml ai_hints.work_timeout_seconds. */
export const DEFAULT_WORK_TIMEOUT_MS = 10 * 60 * 1000;

export interface EnterWorkOptions {
  readonly featureId: string;
  /** Free-form intent the host AI extracted from the user prompt. */
  readonly intent?: string;
  readonly cwd?: string;
  /** Persona to adopt. Defaults to 'specialists' (0.4.3); routing.yaml override lands in 0.4.10. */
  readonly personaId?: string;
}

export interface EnterWorkResult {
  readonly featureId: string;
  readonly status: 'entered' | 'resumed';
  readonly scope: {readonly slug: string; readonly modules: readonly string[]};
  readonly personaId: string;
  readonly personaPrompt: string;
  readonly instructions: string;
}

/**
 * Opens a work transaction. Idempotent on featureId — a second call
 * while a transaction is already open returns the existing registry
 * entry with status `'resumed'` and does NOT re-emit a `work_entered`
 * event or re-touch the spec status.
 *
 * Throws {@link FeatureNotFoundError} when the feature id has no
 * shard, or {@link InvalidStatusTransitionError} when the feature is
 * archived (no transition into work from archived).
 */
export function enterWork(opts: EnterWorkOptions): EnterWorkResult {
  const cwd = opts.cwd ?? '.';
  const personaId = opts.personaId ?? 'specialists';

  // Idempotent fast path — already entered, just hand back the
  // registry record without re-emitting events or re-touching status.
  const existing = getActiveWork(cwd, opts.featureId);
  if (existing) {
    const persona = loadPersona(existing.personaId);
    return {
      featureId: opts.featureId,
      status: 'resumed',
      scope: existing.scope,
      personaId: existing.personaId,
      personaPrompt: persona.body,
      instructions: instructionsFor(existing.scope, 'resumed'),
    };
  }

  // Transition status — this is the first detector / writer touch and
  // it throws for archived features or missing ids before we register.
  updateFeatureStatus(cwd, opts.featureId, 'in_progress');
  const scope = getFeatureScope(cwd, opts.featureId);
  const persona = loadPersona(personaId);

  const work: ActiveWork = {
    featureId: opts.featureId,
    enteredAt: new Date().toISOString(),
    intent: opts.intent,
    scope,
    personaId,
  };
  registerActiveWork(cwd, work);

  appendEvent(
    cwd,
    newEvent('work_entered', {
      feature: opts.featureId,
      intent: opts.intent ?? null,
      personaId,
      modules: scope.modules,
    }),
  );

  return {
    featureId: opts.featureId,
    status: 'entered',
    scope,
    personaId,
    personaPrompt: persona.body,
    instructions: instructionsFor(scope, 'entered'),
  };
}

export interface CompleteWorkEvidence {
  readonly acId: string;
  readonly ref: string;
}

export interface CompleteWorkOptions {
  readonly featureId: string;
  /** AC ids + evidence refs to append before the status transition. Optional. */
  readonly evidence?: readonly CompleteWorkEvidence[];
  readonly cwd?: string;
}

export interface CompleteWorkResult {
  readonly featureId: string;
  readonly status: 'completed' | 'iron_law_failed';
  /** Scope-aware drift report — present in both pass and fail branches. */
  readonly driftFindings: ReadonlyArray<{
    readonly detector: string;
    readonly severity: 'error' | 'warn' | 'info';
    readonly path?: string;
    readonly message: string;
  }>;
  readonly evidenceAppended: number;
}

/**
 * Closes a work transaction with the scope-aware iron law gate. On
 * pass: status `in_progress → done`, evidence appended, registry
 * entry removed, `work_completed` event emitted. On fail: status
 * stays `in_progress` (no rollback in 0.4.x), registry entry stays
 * (caller may retry complete_work after fixing the drift), event
 * carries `driftPass: false`.
 *
 * 0.4.3 scope: stage 1.3 (drift, scoped to feature.modules). Adding
 * the L1 gates (type / lint / arch) and the reviewer dispatch is the
 * 0.4.5 patch — kept minimal here so the transaction shape itself
 * lands first and the iron-law expansion is a focused follow-up.
 */
export function completeWork(opts: CompleteWorkOptions): CompleteWorkResult {
  const cwd = opts.cwd ?? '.';

  const scope = getFeatureScope(cwd, opts.featureId);
  const driftReport = runDrift({cwd, scope: scope.modules});
  const findings = driftReport.findings.map((f) => ({
    detector: f.detector,
    severity: f.severity,
    path: f.path,
    message: f.message,
  }));

  if (!driftReport.pass) {
    appendEvent(
      cwd,
      newEvent('work_completed', {
        feature: opts.featureId,
        driftPass: false,
        errorCount: findings.filter((f) => f.severity === 'error').length,
      }),
    );
    return {
      featureId: opts.featureId,
      status: 'iron_law_failed',
      driftFindings: findings,
      evidenceAppended: 0,
    };
  }

  let evidenceAppended = 0;
  for (const ev of opts.evidence ?? []) {
    const result = appendEvidence(cwd, opts.featureId, ev.acId, ev.ref);
    if (result.appended) evidenceAppended++;
  }

  updateFeatureStatus(cwd, opts.featureId, 'done');
  removeActiveWork(cwd, opts.featureId);

  appendEvent(
    cwd,
    newEvent('work_completed', {
      feature: opts.featureId,
      driftPass: true,
      evidenceAppended,
    }),
  );

  return {
    featureId: opts.featureId,
    status: 'completed',
    driftFindings: findings,
    evidenceAppended,
  };
}

export interface AbandonWorkOptions {
  readonly featureId: string;
  readonly reason: string;
  readonly cwd?: string;
}

export interface AbandonWorkResult {
  readonly featureId: string;
  readonly status: 'abandoned' | 'not_active';
}

/**
 * Explicitly cancels a work transaction. Status is **preserved** —
 * the feature stays `in_progress`. The next session can resume the
 * same featureId or call abandon_work again (idempotent). 0.4.x has
 * no rollback — that's a 0.5.x candidate (git temp branch).
 */
export function abandonWork(opts: AbandonWorkOptions): AbandonWorkResult {
  const cwd = opts.cwd ?? '.';
  const existing = getActiveWork(cwd, opts.featureId);
  if (!existing) {
    return {featureId: opts.featureId, status: 'not_active'};
  }
  removeActiveWork(cwd, opts.featureId);
  appendEvent(
    cwd,
    newEvent('work_abandoned', {
      feature: opts.featureId,
      reason: opts.reason,
    }),
  );
  return {featureId: opts.featureId, status: 'abandoned'};
}

function instructionsFor(
  scope: {readonly slug: string; readonly modules: readonly string[]},
  state: 'entered' | 'resumed',
): string {
  const verb = state === 'entered' ? 'Adopt' : 'Continue with';
  const moduleList = scope.modules.length === 0 ? '(no modules declared)' : scope.modules.join(', ');
  return [
    `${verb} the persona prompt above for this turn.`,
    `Make all code-edit tool calls inside scope.modules: ${moduleList}.`,
    `When the change is complete, call complete_work with optional evidence refs.`,
    `When you need to back out (user changed direction, scope too large), call abandon_work with a reason.`,
  ].join(' ');
}

// Re-export error types so MCP handlers can catch them by name.
export {FeatureNotFoundError, InvalidStatusTransitionError};
