// Cladding · work · drive transaction (0.4.4, F-d23cd4)
//
// Scenario-unit transaction. `executeDrive({scenarioId | intent})`:
//   1. resolves a scenario (by id, or by deterministic intent match)
//   2. sorts the scenario's features into a dependency-respecting plan
//   3. auto-enters the first ready feature via the work transaction
//   4. emits a `drive_started` event with the full plan
//   5. returns the plan + first work entry so the host AI can iterate
//      enter_work / complete_work for the remaining features
//
// 0.4.4 minimal scope:
//   - scenarioId mode is the primary path (deterministic).
//   - intent mode does substring + token overlap against scenario
//     titles + flow text. LLM-based scenario matching is a 0.5.x
//     option (MCP sampling, Claude-Code-only first).
//   - drive_completed event is NOT auto-emitted in 0.4.4. The host
//     AI calls completeDrive explicitly after the last work
//     completes; auto-detection (last feature done → close drive)
//     lands in 0.4.5 alongside Layer-D unmapped-change scan.

import {newEvent, appendEvent} from '../events/log.js';
import {loadSpec} from '../spec/load.js';
import type {Feature, Scenario} from '../spec/types.js';
import {enterWork, type EnterWorkResult} from './transaction.js';

export class ScenarioNotFoundError extends Error {
  constructor(scenarioId: string) {
    super(`cladding: no scenario shard for id ${scenarioId} under spec/scenarios/`);
    this.name = 'ScenarioNotFoundError';
  }
}

export class NoMatchingScenarioError extends Error {
  constructor(intent: string) {
    super(`cladding: no scenario in spec/scenarios/ matches the intent: "${truncate(intent, 60)}"`);
    this.name = 'NoMatchingScenarioError';
  }
}

export interface ExecuteDriveOptions {
  /** Direct scenario id (e.g. S-d21acd). Mutually exclusive with intent. */
  readonly scenarioId?: string;
  /** Free-form intent the host AI extracted. Deterministically matched against scenario.title + flow in 0.4.4. */
  readonly intent?: string;
  readonly cwd?: string;
}

/**
 * A parallel-dispatch group from topologicalGroups (0.4.11 PR-B).
 * Every feature in a group is dependency-disjoint from every other
 * feature in the same group, so the host AI may fan them out
 * concurrently (Claude Code: parallel Task() calls; Codex:
 * `agents.max_threads`; Cursor: `/multitask`; Gemini: multiple
 * `@agent` invocations).
 *
 * Groups are returned in ordinal order — every feature in group N
 * may start as soon as every feature in groups 0..N-1 has completed.
 */
export interface ParallelGroup {
  readonly ordinal: number;
  readonly featureIds: readonly string[];
}

export interface ExecuteDriveResult {
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  /**
   * Flat dependency-sorted feature id list. Kept for one minor cycle
   * (0.4.x) for backward-compat with hosts that don't yet consume
   * `groups`. New host AIs should read `groups` instead — it carries
   * the parallel-dispatch hint missing from the flat order.
   */
  readonly plan: readonly string[];
  /**
   * 0.4.11 PR-B — Kahn-levels grouping. groups[0] has no dependencies
   * inside the scenario; groups[i] depends only on groups[0..i-1].
   * Within a group, features may run concurrently.
   */
  readonly groups: readonly ParallelGroup[];
  /** First feature in the plan, already entered via enterWork. Undefined when plan is empty (all features already done). */
  readonly firstWork?: EnterWorkResult;
  /** Free-form instructions for the host AI on what to do with the remaining plan. */
  readonly instructions: string;
}

/**
 * Opens a drive transaction. The host AI receives the ordered plan
 * plus the first work entry; it must call enter_work / complete_work
 * itself for each subsequent feature in the plan, then complete_drive
 * to seal the scenario-level transaction.
 *
 * Throws {@link ScenarioNotFoundError} when scenarioId is unknown, or
 * {@link NoMatchingScenarioError} when intent matches no scenario.
 */
export function executeDrive(opts: ExecuteDriveOptions): ExecuteDriveResult {
  const cwd = opts.cwd ?? '.';
  if (!opts.scenarioId && !opts.intent) {
    throw new Error('executeDrive requires either scenarioId or intent');
  }

  const spec = loadSpec(cwd);
  const scenario = resolveScenario(spec.scenarios ?? [], opts);

  // Pull features out, drop already-done/archived, topologically sort.
  const featureMap = new Map<string, Feature>(spec.features.map((f) => [f.id, f]));
  const targets: Feature[] = [];
  for (const fid of scenario.features ?? []) {
    const f = featureMap.get(fid);
    if (!f) continue; // dangling reference — REFERENCE_INTEGRITY detector surfaces it elsewhere
    if (f.status === 'done' || f.status === 'archived') continue;
    targets.push(f);
  }
  const ordered = topologicalSort(targets);
  const plan = ordered.map((f) => f.id);
  const groups = topologicalGroups(targets);

  appendEvent(
    cwd,
    newEvent('drive_started', {
      scenarioId: scenario.id,
      plan,
      // 0.4.11 PR-B — parallel groups on the event payload for audit.
      groups: groups.map((g) => ({ordinal: g.ordinal, featureIds: g.featureIds})),
      intent: opts.intent ?? null,
    }),
  );

  let firstWork: EnterWorkResult | undefined;
  if (plan.length > 0) {
    firstWork = enterWork({
      featureId: plan[0],
      intent: opts.intent ?? `drive:${scenario.id}`,
      cwd,
    });
  }

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    plan,
    groups,
    firstWork,
    instructions: instructionsFor(scenario, plan, groups),
  };
}

export interface CompleteDriveOptions {
  readonly scenarioId: string;
  readonly cwd?: string;
}

export interface CompleteDriveResult {
  readonly scenarioId: string;
  readonly featuresPassed: readonly string[];
  readonly featuresFailed: readonly string[];
  readonly featuresPending: readonly string[];
}

/**
 * Seals a drive transaction. Inspects the scenario's features on disk
 * and partitions them into passed (status=done) / failed (status in
 * [blocked, in_progress without recent activity]) / pending. Emits a
 * `drive_completed` event with the partition. Does NOT mutate
 * spec.yaml itself — the underlying work transactions already wrote
 * each feature's status via updateFeatureStatus.
 */
export function completeDrive(opts: CompleteDriveOptions): CompleteDriveResult {
  const cwd = opts.cwd ?? '.';
  const spec = loadSpec(cwd);
  const scenario = spec.scenarios?.find((s) => s.id === opts.scenarioId);
  if (!scenario) throw new ScenarioNotFoundError(opts.scenarioId);

  const featureMap = new Map<string, Feature>(spec.features.map((f) => [f.id, f]));
  const featuresPassed: string[] = [];
  const featuresFailed: string[] = [];
  const featuresPending: string[] = [];
  for (const fid of scenario.features ?? []) {
    const f = featureMap.get(fid);
    if (!f) continue;
    if (f.status === 'done' || f.status === 'archived') featuresPassed.push(fid);
    else if (f.status === 'blocked') featuresFailed.push(fid);
    else featuresPending.push(fid);
  }

  appendEvent(
    cwd,
    newEvent('drive_completed', {
      scenarioId: scenario.id,
      completedAt: new Date().toISOString(),
      featuresPassed,
      featuresFailed,
      featuresPending,
    }),
  );

  return {
    scenarioId: scenario.id,
    featuresPassed,
    featuresFailed,
    featuresPending,
  };
}

function resolveScenario(scenarios: readonly Scenario[], opts: ExecuteDriveOptions): Scenario {
  if (opts.scenarioId) {
    const hit = scenarios.find((s) => s.id === opts.scenarioId);
    if (!hit) throw new ScenarioNotFoundError(opts.scenarioId);
    return hit;
  }
  // intent mode — score each scenario, pick the best.
  const intent = (opts.intent ?? '').toLowerCase();
  if (!intent) throw new Error('executeDrive intent is empty');

  const intentTokens = tokenize(intent);
  let best: {scenario: Scenario; score: number} | undefined;
  for (const s of scenarios) {
    const haystack = `${s.title} ${s.flow ?? ''}`.toLowerCase();
    // Substring boost — title or flow contains the literal intent.
    let score = 0;
    if (haystack.includes(intent)) score += 10;
    // Token overlap — count of intent tokens present in scenario text.
    const haystackTokens = new Set(tokenize(haystack));
    for (const t of intentTokens) if (haystackTokens.has(t)) score += 1;
    if (score > 0 && (!best || score > best.score)) {
      best = {scenario: s, score};
    }
  }
  if (!best) throw new NoMatchingScenarioError(opts.intent ?? '');
  return best.scenario;
}

/** Stable topological sort respecting Feature.depends_on. Stable on tie (input order). */
function topologicalSort(features: readonly Feature[]): Feature[] {
  const sorted: Feature[] = [];
  const done = new Set<string>();
  const remaining = [...features];
  while (remaining.length > 0) {
    const idx = remaining.findIndex((f) => (f.depends_on ?? []).every((d) => done.has(d)));
    if (idx === -1) {
      // Circular dep or all remaining deps point outside the scenario —
      // append rest in original order. Drive cannot resolve; host AI sees
      // the full plan and may abandon or handle manually.
      sorted.push(...remaining);
      remaining.length = 0;
      break;
    }
    const [picked] = remaining.splice(idx, 1);
    sorted.push(picked);
    done.add(picked.id);
  }
  return sorted;
}

/**
 * Kahn-levels topological grouping (0.4.11 PR-B). Each group contains
 * features whose `depends_on` (scoped to the same scenario) resolve
 * to features already completed in an earlier group. Within a group,
 * features have no mutual dependencies → safe to fan out in parallel.
 *
 * Out-of-scenario `depends_on` entries are treated as "already done"
 * (matches the flat sort's existing semantics — drive only orders
 * within the scenario's feature set).
 *
 * Cycles or unresolvable deps collapse into a final trailing group
 * containing all leftover features in input order. The host AI sees
 * this and may abandon the scenario; the auditor can flag the
 * pathological group later.
 */
function topologicalGroups(features: readonly Feature[]): ParallelGroup[] {
  const featureIds = new Set(features.map((f) => f.id));
  const done = new Set<string>();
  const remaining = [...features];
  const groups: ParallelGroup[] = [];
  let ordinal = 0;

  while (remaining.length > 0) {
    // Pick every feature whose in-scenario deps are all done.
    const readyIdx: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i];
      const inScopeDeps = (f.depends_on ?? []).filter((d) => featureIds.has(d));
      if (inScopeDeps.every((d) => done.has(d))) {
        readyIdx.push(i);
      }
    }

    if (readyIdx.length === 0) {
      // Cycle / unresolvable → emit the leftovers as one final group.
      groups.push({ordinal, featureIds: remaining.map((f) => f.id)});
      break;
    }

    // readyIdx is ascending — picking in that order preserves input
    // stability within the group.
    const groupFeatures: Feature[] = [];
    for (const idx of readyIdx) groupFeatures.push(remaining[idx]);
    groups.push({ordinal, featureIds: groupFeatures.map((f) => f.id)});

    // Remove picked features from remaining (highest-to-lowest so the
    // earlier indices stay valid).
    for (let i = readyIdx.length - 1; i >= 0; i--) {
      remaining.splice(readyIdx[i], 1);
    }
    for (const f of groupFeatures) done.add(f.id);
    ordinal++;
  }

  return groups;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/u)
    .filter((t) => t.length >= 2);
}

function instructionsFor(
  scenario: Scenario,
  plan: readonly string[],
  groups: readonly ParallelGroup[],
): string {
  if (plan.length === 0) {
    return `Drive scenario ${scenario.id} has no ready features (all done/archived). No work needed.`;
  }
  if (plan.length === 1) {
    return [
      `Drive scenario ${scenario.id} has 1 ready feature: ${plan[0]}.`,
      `It has been auto-entered. Make the change, then call complete_work.`,
      `Finally call complete_drive with scenarioId: "${scenario.id}" to seal the drive transaction.`,
    ].join(' ');
  }
  // 0.4.11 PR-B — surface parallel groups when more than one level
  // exists. Single-level groups (everything parallel) and fully-serial
  // chains (one feature per group) reduce to the same flat narrative.
  const hasParallelism = groups.some((g) => g.featureIds.length > 1);
  const groupNarrative = hasParallelism
    ? ` Features split into ${groups.length} parallel group(s): ${groups
        .map((g) => `[${g.featureIds.join(', ')}]`)
        .join(' → ')}. Within a group, dispatches may run concurrently.`
    : '';
  return [
    `Drive scenario ${scenario.id} resolved into ${plan.length} ready features: ${plan.join(' → ')}.${groupNarrative}`,
    `The first (${plan[0]}) has been auto-entered.`,
    `After each complete_work, call enter_work on the next featureId in plan, then complete_work, repeat.`,
    `When the last feature completes, call complete_drive with scenarioId: "${scenario.id}".`,
  ].join(' ');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
