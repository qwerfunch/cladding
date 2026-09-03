// Cladding · Spec 0.2 F9a · cycle context envelope: task projections packed to measured, fixed-point budgets.
//
// D19 keys context by the OPERATION, never by a persona name. Five task profiles
// name the sections one operation actually needs, and the packer proves the
// physical cost of what it sends instead of assuming it. Four rules make that a
// measurement contract rather than a slogan:
//
//   • Required contract facts are never truncated. When they alone exceed the
//     profile ceiling the envelope reports `required_overflow` and names the
//     oversized section, so a reader can never mistake a plausible-looking
//     partial contract for a whole one.
//   • Optional sections are dropped lowest-priority-first and every drop is
//     aggregated in `budget.omitted` with the exact bytes it saved.
//   • A profile's LAZY sections are never packed by default, however much budget
//     is free. D19 calls them available lazily, and that is a cost rule, not a
//     wording preference: a caller who needs one names it in `include` and pays a
//     second packet for it, so the default path never carries a summary nobody
//     asked for. An included lazy section packs below every optional one, which
//     makes it the first thing shed if the packet still does not fit.
//   • `payload_utf8_bytes` measures the FINAL serialization, its own budget and
//     omission metadata included, so the number the envelope prints is the number
//     it costs. The measure loop repeats until that reaches a byte fixed point.
//
// This module is also the covered successor of the retired preamble and tail
// helpers (F-041 AC-065/AC-066; F-063 AC-161). Persona-preamble
// stripping and head/tail elision are packing rules applied to diagnostic sections
// BEFORE measurement, which is the only place either behavior was ever meant to
// act: as standalone helpers they had no production consumer at all.
//
// It is deliberately NOT the `clad_get_context` wire. D19 freezes that public
// surface at schema_version 1; this envelope is internal and travels by import.
//
// WHY the workspace is a parameter and the disk is barely touched: the envelope is
// a projection, not a second reader. Everything structural comes from one already
// coherent GraphIR workspace; the only files read are the feature shard (for its
// input revision) and, for the blind-oracle profile, declaration-only export lines.
// Runtime facts a workspace cannot know — observed results, gate diagnostics, prior
// attempts, attestation rows — arrive from the caller, so the same inputs always
// serialize to the same bytes.
//
// @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-87b85505
// @see docs/design/spec-0.2/context-and-orchestration.md#d19--cycle-context-envelope-and-token-discipline

import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {graphIrConsumerView, type GraphConsumerView} from '../graph/consumers.js';
import type {GraphIrV2Workspace} from '../graph/query.js';
import {buildBlindPayload} from '../oracle/payload.js';
import type {CriterionProofView} from '../proof/view.js';
import type {
  Schema02CriterionContract,
  Schema02FeatureContract,
} from '../spec/compiler/types.js';
import type {PriorAttempts} from './prior-attempts.js';

/** Deterministic projection policies; none of them selects a model or a host role. */
export type TaskProfile = 'spec-edit' | 'implement' | 'verify' | 'observe' | 'blind-oracle';

/** How a write set was learned; `unknown` is explicit and never means "empty". */
export type WriteScopeProvenance = 'predicted' | 'observed' | 'unknown';

/** Observed state of the resident prefix; stays `unknown` when the host cannot prove it. */
export type ContextCacheState = 'cold' | 'warm' | 'unknown';

/**
 * One projected fact block.
 *
 * `body` is plain data so the whole envelope is a single JSON value: sections
 * never carry rendered prose, and a fact that already exists elsewhere in the
 * envelope is referenced by its stable address rather than copied.
 *
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-87b85505
 * @since 0.10.0
 * @internal
 */
export interface ContextSection {
  /** Stable section address, unique inside one envelope. */
  readonly id: string;
  /** Required sections are never dropped; an overflow is reported instead. */
  readonly required: boolean;
  /** Drop order for optional sections: 0 is required, then 1 is kept longest. */
  readonly priority: number;
  /** Projected facts; plain JSON data, never rendered text. */
  readonly body: unknown;
}

/**
 * One aggregated omission, so nothing leaves the envelope silently.
 *
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-fb5c7567
 * @since 0.10.0
 * @internal
 */
export interface OmissionSummary {
  /** Section address the omission applies to; a diagnostic uses `<section>#<id>`. */
  readonly section: string;
  /** Why the content is not present: budget pressure, line elision, or preamble stripping. */
  readonly reason: 'budget' | 'elided' | 'preamble';
  /** Exact serialized bytes the omission removed, when the unit is bytes. */
  readonly omitted_bytes?: number;
  /** Exact line count the omission removed, when the unit is lines. */
  readonly omitted_lines?: number;
}

/**
 * The internal D19 measurement contract for one operation.
 *
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-a9150a5d
 * @see docs/design/spec-0.2/context-and-orchestration.md#internal-measurement-contract
 * @since 0.10.0
 * @internal
 */
export interface CycleContextEnvelope {
  /** Operation this projection serves. */
  readonly task: TaskProfile;
  /** Feature the operation acts on. */
  readonly feature: string;
  /** Digest of the complete pre-packing projection, so a later delta can prove the same source facts. */
  readonly context_revision: string;
  /** Canonical source revisions the projection was read from, keyed by repository path. */
  readonly input_revisions: Readonly<Record<string, string>>;
  /** The operation's write set and how it was learned. */
  readonly write_scope: {
    readonly paths: readonly string[];
    readonly provenance: WriteScopeProvenance;
  };
  /** Retained sections in canonical order. */
  readonly sections: readonly ContextSection[];
  /** Physical accounting for this packet plus the caller's resident input. */
  readonly budget: {
    readonly payload_utf8_bytes: number;
    readonly resident_utf8_bytes: number;
    readonly total_utf8_bytes: number;
    readonly cache: ContextCacheState;
    readonly estimator: string;
    readonly estimated_tokens: {
      readonly payload: number;
      readonly resident: number;
      readonly total: number;
    };
    readonly omitted: readonly OmissionSummary[];
    readonly required_overflow: boolean;
  };
}

/** One diagnostic blob the host observed; the packer owns its preamble and line budget. */
export interface ContextDiagnostic {
  /** Stable diagnostic identity, such as a gate or detector id. */
  readonly id: string;
  /** Raw observed text, persona preamble and all. */
  readonly text: string;
}

/** Bounded attestation facts a host already holds; the envelope never parses the ledger itself. */
export interface ContextAttestationSnapshot {
  /** Verifier-policy digest recorded with the ledger, when the host has one. */
  readonly digest?: string;
  /** Feature ids carrying a v3 closure row. */
  readonly v3_features?: readonly string[];
}

/**
 * One operation's request for context.
 *
 * Every runtime-only field is optional and its absence is projected as an explicit
 * unknown, never as a zero or an empty success.
 *
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-06ad5c92
 * @since 0.10.0
 * @internal
 */
export interface CycleContextRequest {
  /** Operation to project for. */
  readonly task: TaskProfile;
  /** Feature id, slug, or canonical feature address. */
  readonly feature: string;
  /** Predicted or observed write set; omitted means unknown, which is not empty. */
  readonly write_scope?: {
    readonly paths: readonly string[];
    readonly provenance: WriteScopeProvenance;
  };
  /** Cladding-controlled bytes already resident outside this packet. */
  readonly resident_utf8_bytes?: number;
  /** Observed resident-prefix cache state. */
  readonly cache?: ContextCacheState;
  /** Observed gate or detector output for the diagnostic sections. */
  readonly diagnostics?: readonly ContextDiagnostic[];
  /** Compiled failure history for this feature. */
  readonly prior_attempts?: PriorAttempts;
  /** Proof rows observed by a current gate run; the envelope never runs a gate. */
  readonly proof_views?: readonly CriterionProofView[];
  /** Bounded attestation facts; absent leaves freshness explicitly unknown. */
  readonly attestation?: ContextAttestationSnapshot;
  /** Criterion for the blind-oracle projection; the first criterion is used when absent. */
  readonly criterion?: string;
  /**
   * Lazy section ids to pack in this build. Only ids the profile declares lazy are
   * accepted; anything else is a caller mistake the envelope refuses rather than
   * silently drops, because a quietly ignored request looks exactly like a section
   * that was packed and then shed.
   */
  readonly include?: readonly string[];
}

/** Packing knobs; the profile owns every default. */
export interface CycleContextOptions {
  /** Overrides the profile ceiling, for callers proving overflow behavior. */
  readonly ceiling_bytes?: number;
  /** Workspace root for the two bounded file reads. */
  readonly cwd?: string;
  /**
   * Fixed-point round budget. The default covers every payload below a gigabyte;
   * it is a parameter so the non-convergence guard is provable rather than dead code.
   */
  readonly max_measure_rounds?: number;
}

/** One profile's required set, optional priority order, lazy set, and payload ceiling. */
export interface TaskProfileDefinition {
  /** Section ids that are always projected and never dropped. */
  readonly required: readonly string[];
  /** Optional section ids in priority order: earliest is kept longest. */
  readonly optional: readonly string[];
  /**
   * Section ids never packed by default, whatever budget is free. A request names one
   * in `include` to have it packed, below every optional section.
   */
  readonly lazy: readonly string[];
  /** D19 payload ceiling in UTF-8 bytes. */
  readonly ceiling_bytes: number;
}

/** The estimator is always named because provider tokenizers differ. */
const TOKEN_ESTIMATOR = 'characters/4';

/**
 * `payload_utf8_bytes`, `total_utf8_bytes`, the token estimates, and any overflow
 * figure all widen monotonically as the measured value gains digits, so the
 * remeasure sequence is non-decreasing and converges once no number changes width.
 */
const DEFAULT_MEASURE_ROUNDS = 8;

/** Diagnostic head allowance, inherited from the retired tail helper. */
const DIAGNOSTIC_HEAD_LINES = 5;

/** Diagnostic tail allowance, inherited from the retired tail helper. */
const DIAGNOSTIC_TAIL_LINES = 30;

/**
 * Impact starts at the write set and stops at the first ring.
 *
 * A saturating closure on this corpus reaches 286 of 292 features through
 * shared-module hubs, which is a true answer that no operation can act on. One ring
 * plus an explicit `impact_complete: false` is the honest bounded alternative.
 */
const IMPACT_DEPTH = 1;

/**
 * Persona-boilerplate lines that are safe to remove from any observed diagnostic.
 *
 * Ported verbatim from the retired preamble helper, whose behavior
 * F-041/AC-065 protects; the patterns are the data, the decision to apply them is
 * the packer's.
 *
 * @see spec/features/F-041.yaml AC-065
 */
const PREAMBLE_PATTERNS: readonly RegExp[] = Object.freeze([
  /^You are (the |a |an )?[A-Z][\w-]+ agent.*$/gm,
  /^# (Orchestrator|Librarian|Reviewer|Observability|Specialists)$/gm,
  /^Your job is to .*$/gm,
]);

/**
 * The D19 task projection table.
 *
 * `required` and `optional` are what a packet may carry on its own; `lazy` is the
 * other half of D19's table — content the design calls available lazily, which the
 * packer reads as "never sent unless the request asks for it by name".
 *
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-87b85505
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-d609cdef
 * @since 0.10.0
 * @internal
 */
export const TASK_PROFILES: Readonly<Record<TaskProfile, TaskProfileDefinition>> = Object.freeze({
  'spec-edit': Object.freeze({
    required: Object.freeze(['intent', 'target-contract', 'referenced-constraints', 'affected-links']),
    optional: Object.freeze([]),
    lazy: Object.freeze([]),
    ceiling_bytes: 16_384,
  }),
  implement: Object.freeze({
    // The feature's own declared paths are a contract fact: an implement packet
    // without them is exactly the plausible-looking partial contract D19 forbids.
    // Only the ownership fan-out is the summary D19 keeps lazily available.
    required: Object.freeze([
      'purpose', 'criteria', 'constraints', 'prerequisites',
      'predicted-write-scope', 'candidate-affected-paths', 'required-proof',
    ]),
    // Failure detail outranks history.
    optional: Object.freeze(['current-failure', 'prior-attempts']),
    // The co-owner fan-out is the largest and least decision-bearing block on a
    // shared-module hub: resident it costs a p95 cycle more than the two-dispatch
    // path it replaces, and almost no operation reads it. It travels on request.
    lazy: Object.freeze(['ownership-fan-out']),
    ceiling_bytes: 24_576,
  }),
  verify: Object.freeze({
    required: Object.freeze([
      'contract', 'observed-write-scope', 'changed-artifacts', 'declared-bindings',
      'observed-results', 'impact-closure', 'evidence-state', 'freshness',
    ]),
    optional: Object.freeze(['diagnostics']),
    lazy: Object.freeze([]),
    ceiling_bytes: 16_384,
  }),
  observe: Object.freeze({
    required: Object.freeze(['gate-results', 'proof-freshness', 'attestation-digest', 'unresolved-layers']),
    optional: Object.freeze(['diagnostics']),
    lazy: Object.freeze([]),
    ceiling_bytes: 16_384,
  }),
  'blind-oracle': Object.freeze({
    required: Object.freeze(['criterion', 'public-signatures', 'target-test-path', 'subject-revisions']),
    optional: Object.freeze([]),
    lazy: Object.freeze([]),
    ceiling_bytes: 24_576,
  }),
});

/** Exact serialized cost of one value, the same unit the ceiling is written in. */
function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

/** SHA-256 hex of one string; the envelope's only identity function. */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Sorted-key record, so two builds of the same facts serialize to the same bytes. */
function sortedRecord(entries: readonly (readonly [string, string])[]): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries([...entries].sort((left, right) => left[0].localeCompare(right[0]))));
}

/**
 * Strips persona-boilerplate lines and collapses the blank runs they leave behind.
 *
 * @param text - Raw observed diagnostic text.
 * @returns The same text without persona preamble lines.
 * @see spec/features/F-041.yaml AC-065
 */
function stripPreamble(text: string): string {
  let out = text;
  for (const pattern of PREAMBLE_PATTERNS) out = out.replace(pattern, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Keeps the head and tail of a long diagnostic with an exact elision count.
 *
 * @param text - Diagnostic text after preamble stripping.
 * @returns The kept text and the number of lines the marker replaced.
 * @see spec/features/F-041.yaml AC-066
 */
function headTail(text: string): {readonly text: string; readonly elided: number} {
  const lines = text.split('\n');
  const allowance = DIAGNOSTIC_HEAD_LINES + DIAGNOSTIC_TAIL_LINES;
  if (lines.length <= allowance) return {text, elided: 0};
  const elided = lines.length - allowance;
  return {
    text: [
      ...lines.slice(0, DIAGNOSTIC_HEAD_LINES),
      `… [${elided} line(s) elided]`,
      ...lines.slice(-DIAGNOSTIC_TAIL_LINES),
    ].join('\n'),
    elided,
  };
}

/** One packed diagnostic plus the omissions its packing produced. */
interface PackedDiagnostic {
  readonly id: string;
  readonly text: string;
  readonly lines: number;
}

/**
 * Applies both diagnostic packing rules before anything is measured.
 *
 * `omitted_lines` for a preamble omission is the pre-strip line count minus the
 * post-strip count, so a stripped persona header plus the blank run it left behind
 * is reported as the whole number of lines that left the packet.
 *
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-249b7630
 */
function packDiagnostics(
  sectionId: string,
  diagnostics: readonly ContextDiagnostic[],
): {readonly packed: readonly PackedDiagnostic[]; readonly omissions: readonly OmissionSummary[]} {
  const packed: PackedDiagnostic[] = [];
  const omissions: OmissionSummary[] = [];
  for (const diagnostic of diagnostics) {
    const rawLines = diagnostic.text.split('\n').length;
    const stripped = stripPreamble(diagnostic.text);
    const strippedLines = stripped === '' ? 0 : stripped.split('\n').length;
    if (rawLines > strippedLines) {
      omissions.push({
        section: `${sectionId}#${diagnostic.id}`,
        reason: 'preamble',
        omitted_lines: rawLines - strippedLines,
      });
    }
    const kept = headTail(stripped);
    if (kept.elided > 0) {
      omissions.push({
        section: `${sectionId}#${diagnostic.id}`,
        reason: 'elided',
        omitted_lines: kept.elided,
      });
    }
    packed.push({id: diagnostic.id, text: kept.text, lines: strippedLines});
  }
  return {packed, omissions};
}

/** A section candidate before packing decides whether it survives. */
interface SectionCandidate {
  readonly id: string;
  readonly required: boolean;
  readonly priority: number;
  readonly body: unknown;
}

/** Everything one projection produced, before any byte is measured. */
interface Projection {
  readonly candidates: readonly SectionCandidate[];
  readonly omissions: readonly OmissionSummary[];
  readonly inputRevisions: Readonly<Record<string, string>>;
  readonly writeScope: {readonly paths: readonly string[]; readonly provenance: WriteScopeProvenance};
}

/** Criterion statement plus the fields a reader needs to act on it. */
function criterionBody(criterion: Schema02CriterionContract): Readonly<Record<string, unknown>> {
  return {
    id: criterion.id,
    kind: criterion.kind,
    statement: criterion.statement,
    ...(criterion.rationale === undefined ? {} : {rationale: criterion.rationale}),
    ...(criterion.constraintRefs.length === 0 ? {} : {constraint_refs: [...criterion.constraintRefs]}),
  };
}

/**
 * Declared proof facts for one criterion, straight from the kernel's proof relations.
 *
 * D19 requires `{criterion, state, selector, locator-or-digest}` for every relevant
 * proof, and takes the digest form deliberately: a live `[covers:]` anchor selector
 * is a whole nested test title, so carrying 101 of them verbatim costs 25 KB on this
 * corpus — four fifths of a packet, spent on strings no reader compares by eye. The
 * artifact path is the locator, the selector travels as a digest a consumer can
 * recompute from the same source, and proofs group by artifact so no path repeats.
 */
function criterionProofFacts(
  workspace: GraphIrV2Workspace,
  featureId: string,
  criterion: Schema02CriterionContract,
): Readonly<Record<string, unknown>> {
  const result = workspace.kernel.criterionProofs(`criterion:${featureId}/${criterion.id}`);
  const groups = new Map<string, {artifact: string; relation: string; state: string; selectors: Set<string>}>();
  for (const edge of result.records) {
    const address = edge.relation === 'covers' ? edge.from : edge.to;
    const bare = address.replace(/^(?:anchor|artifact):/, '');
    const hash = bare.indexOf('#');
    const artifact = hash < 0 ? bare : bare.slice(0, hash);
    const selector = hash < 0 ? '' : bare.slice(hash + 1);
    const state = edge.state ?? 'unknown';
    const key = `${artifact}\u0000${edge.relation}\u0000${state}`;
    const group = groups.get(key) ?? {artifact, relation: edge.relation, state, selectors: new Set<string>()};
    if (selector !== '') group.selectors.add(digest(selector).slice(0, 16));
    groups.set(key, group);
  }
  const proofs = [...groups.values()]
    .sort((left, right) =>
      left.artifact.localeCompare(right.artifact)
      || left.relation.localeCompare(right.relation)
      || left.state.localeCompare(right.state))
    .map((group) => ({
      artifact: group.artifact,
      relation: group.relation,
      state: group.state,
      selectors: [...group.selectors].sort(),
    }));
  return {
    criterion: criterion.id,
    state: result.records.length === 0 ? 'unbound' : 'declared',
    proofs,
  };
}

/** Architecture rules the feature's criteria actually reference, plus the refs that resolve to none. */
function constraintBody(
  workspace: GraphIrV2Workspace,
  feature: Schema02FeatureContract,
): Readonly<Record<string, unknown>> {
  const rules = workspace.compilation.contract?.architecture.rules ?? [];
  const referenced = [...new Set(feature.acceptanceCriteria.flatMap((criterion) => criterion.constraintRefs))].sort();
  const resolved = referenced
    .map((id) => rules.find((rule) => rule.id === id))
    .filter((rule): rule is (typeof rules)[number] => rule !== undefined)
    .map((rule) => ({id: rule.id, kind: rule.kind, from: rule.from, to: rule.to, rationale: rule.rationale}));
  const unresolved = referenced.filter((id) => !rules.some((rule) => rule.id === id));
  return {referenced: referenced.length, rules: resolved, unresolved};
}

/** Capability and scenario edges the feature participates in. */
function affectedLinksBody(
  workspace: GraphIrV2Workspace,
  feature: Schema02FeatureContract,
): Readonly<Record<string, unknown>> {
  const contract = workspace.compilation.contract;
  // The compiler refuses a capability_ref it cannot resolve, so a filter over the
  // catalog loses nothing and spares the envelope an unreachable "unresolved" arm.
  const capabilities = (contract?.capabilities ?? [])
    .filter((capability) => feature.capabilityRefs.includes(capability.id))
    .map((capability) => ({id: capability.id, title: capability.title, outcome: capability.outcome}));
  const scenarios = (contract?.scenarios ?? [])
    .filter((scenario) => scenario.featureRefs.includes(feature.id))
    .map((scenario) => ({id: scenario.id, title: scenario.title, success: scenario.success}));
  return {capabilities, scenarios};
}

/** Prerequisite features with the state a reader needs before starting. */
function prerequisiteBody(
  workspace: GraphIrV2Workspace,
  feature: Schema02FeatureContract,
): Readonly<Record<string, unknown>> {
  const features = workspace.compilation.contract?.features ?? [];
  const prerequisites = [...(feature.dependsOn ?? [])].sort().map((id) => {
    const prerequisite = features.find((entry) => entry.id === id);
    return prerequisite === undefined
      ? {id, state: 'unresolved'}
      : {id, title: prerequisite.title, status: prerequisite.status};
  });
  return {prerequisites, complete: prerequisites.every((entry) => entry.state !== 'unresolved')};
}

/**
 * Every path a co-owner of the feature's modules also declares.
 *
 * This is the largest and least decision-bearing block an implement packet can hold
 * on a shared-module hub, which is why D19 keeps it lazily available: it is built
 * here only when a request names `ownership-fan-out` in `include`.
 *
 * @param features - Every schema 0.2 feature contract, for the co-owners' own modules.
 * @param feature - The acting feature, excluded from its own fan-out.
 * @param moduleOwners - The feature's declared paths with the features owning each.
 * @returns One co-owner entry per feature that declares at least one path.
 */
function ownershipFanOutBody(
  features: readonly Schema02FeatureContract[],
  feature: Schema02FeatureContract,
  moduleOwners: readonly {readonly path: string; readonly owners: readonly string[]}[],
): Readonly<Record<string, unknown>> {
  const coOwners = [...new Set(moduleOwners.flatMap((entry) => [...entry.owners]))]
    .filter((owner) => owner !== feature.id).sort();
  return {
    fan_out: coOwners
      .map((owner) => ({
        feature: owner,
        paths: [...(features.find((entry) => entry.id === owner)?.modules ?? [])].sort(),
      }))
      .filter((entry) => entry.paths.length > 0),
  };
}

/** Impact from the write set outward, honest about the ring it stopped at. */
function impactBody(
  view: GraphConsumerView,
  feature: Schema02FeatureContract,
  writeScope: {readonly paths: readonly string[]; readonly provenance: WriteScopeProvenance},
): Readonly<Record<string, unknown>> {
  const owners = [...new Set(writeScope.paths.flatMap((path) => view.owners(path)))].sort();
  const seededFromScope = owners.length > 0;
  const seeds = seededFromScope ? owners : [feature.id];
  const result = view.dependents(seeds, IMPACT_DEPTH);
  const dependents = [...result.ids].sort();
  const complete = seededFromScope
    && writeScope.provenance !== 'unknown'
    && result.completeness === 'complete';
  const reasons: string[] = [];
  if (writeScope.provenance === 'unknown') {
    reasons.push('write scope provenance is unknown, so this closure is a floor and not the blast radius');
  }
  if (!seededFromScope) {
    reasons.push('no write path resolved to an owning feature, so the feature itself seeded the walk');
  }
  if (result.completeness !== 'complete') {
    reasons.push(`the walk stopped at depth ${IMPACT_DEPTH} with more frontier to visit`);
  }
  return {
    seeds,
    seeded_from: seededFromScope ? 'write_scope.paths' : 'feature',
    depth: IMPACT_DEPTH,
    dependents,
    completeness: result.completeness,
    impact_complete: complete,
    ...(reasons.length === 0 ? {} : {reasons}),
  };
}

/** Receipt-layer knowledge state plus the feature's own authored evidence channels. */
function evidenceStateBody(
  workspace: GraphIrV2Workspace,
  feature: Schema02FeatureContract,
): Readonly<Record<string, unknown>> {
  const layers = workspace.layers.map((layer) => ({
    id: layer.id,
    completeness: layer.completeness,
    reasons: [...layer.reasons],
  }));
  const channels = new Map<string, number>();
  for (const criterion of feature.acceptanceCriteria) {
    for (const edge of workspace.kernel.criterionProofs(`criterion:${feature.id}/${criterion.id}`).records) {
      // Only an authored legacy reference names a channel; a structural graph fact
      // has none, and calling that absence `graph` keeps the two distinguishable.
      const channel = 'channel' in edge && edge.channel !== undefined ? edge.channel : 'graph';
      channels.set(channel, (channels.get(channel) ?? 0) + 1);
    }
  }
  return {
    layers,
    declared_channels: Object.fromEntries([...channels].sort((left, right) => left[0].localeCompare(right[0]))),
  };
}

/** Proof freshness the graph can prove on its own, plus whatever ledger facts the host supplied. */
function freshnessBody(
  workspace: GraphIrV2Workspace,
  feature: Schema02FeatureContract,
  attestation: ContextAttestationSnapshot | undefined,
): Readonly<Record<string, unknown>> {
  let declared = 0;
  let observed = 0;
  const unbound: string[] = [];
  for (const criterion of feature.acceptanceCriteria) {
    const records = workspace.kernel.criterionProofs(`criterion:${feature.id}/${criterion.id}`).records;
    if (records.length === 0) unbound.push(criterion.id);
    else declared += 1;
    if (records.some((edge) => edge.provenance === 'observed')) observed += 1;
  }
  return {
    criteria: feature.acceptanceCriteria.length,
    declared,
    observed,
    unbound,
    attestation: attestation === undefined
      ? {state: 'unknown', reason: 'no bounded attestation snapshot was supplied with the request'}
      : {
        state: 'supplied',
        v3_row: (attestation.v3_features ?? []).includes(feature.id) ? 'present' : 'absent',
        ...(attestation.digest === undefined ? {} : {digest: attestation.digest}),
      },
  };
}

/** Blind-oracle target test path: a declared carrier when one exists, else the oracle convention. */
function targetTestPath(
  workspace: GraphIrV2Workspace,
  featureId: string,
  criterion: Schema02CriterionContract,
): Readonly<Record<string, unknown>> {
  const anchors = workspace.kernel.criterionProofs(`criterion:${featureId}/${criterion.id}`).records
    .filter((edge) => edge.relation === 'covers')
    .map((edge) => edge.from.replace(/^anchor:/, '').split('#')[0]!)
    .sort();
  return anchors.length === 0
    ? {path: 'tests/oracle/', provenance: 'convention'}
    : {path: anchors[0]!, provenance: 'declared'};
}

/** Section bodies for one profile, in canonical order with their drop priorities. */
function candidatesFor(
  workspace: GraphIrV2Workspace,
  view: GraphConsumerView,
  request: CycleContextRequest,
  feature: Schema02FeatureContract,
  writeScope: {readonly paths: readonly string[]; readonly provenance: WriteScopeProvenance},
  cwd: string,
): {readonly candidates: readonly SectionCandidate[]; readonly omissions: readonly OmissionSummary[]} {
  const contract = workspace.compilation.contract;
  const project = contract?.project;
  const criteria = feature.acceptanceCriteria.map(criterionBody);
  switch (request.task) {
    case 'spec-edit': {
      return {
        candidates: [
          {
            id: 'intent', required: true, priority: 0, body: {
              feature: feature.id,
              title: feature.title,
              status: feature.status,
              ...('purpose' in feature ? {purpose: feature.purpose} : {}),
              ...(project !== undefined && 'purpose' in project ? {project_purpose: project.purpose} : {}),
            },
          },
          {id: 'target-contract', required: true, priority: 0, body: {criteria}},
          {id: 'referenced-constraints', required: true, priority: 0, body: constraintBody(workspace, feature)},
          {id: 'affected-links', required: true, priority: 0, body: affectedLinksBody(workspace, feature)},
        ],
        omissions: [],
      };
    }
    case 'implement': {
      const modules = [...(feature.modules ?? [])].sort();
      const moduleOwners = modules.map((path) => ({path, owners: [...view.owners(path)]}));
      const optional: SectionCandidate[] = [];
      if (request.prior_attempts !== undefined) {
        const prior = request.prior_attempts;
        optional.push({
          id: 'current-failure', required: false, priority: 1, body: {
            ...(prior.last_failed_gate === undefined ? {} : {last_failed_gate: prior.last_failed_gate}),
            ...(prior.rolled_back_at === undefined ? {} : {rolled_back_at: prior.rolled_back_at}),
            ...(prior.recovery_hint === undefined ? {} : {recovery_hint: prior.recovery_hint}),
          },
        });
        optional.push({
          id: 'prior-attempts', required: false, priority: 2, body: {
            attempts: prior.attempts,
            ...(prior.retry_count === undefined ? {} : {retry_count: prior.retry_count}),
            ...(prior.drift_history === undefined ? {} : {drift_history: prior.drift_history.map((entry) => ({...entry}))}),
            ...(prior.truncated_history === undefined ? {} : {truncated_history: prior.truncated_history}),
          },
        });
      }
      // A lazy section is built only when the request named it: the thunk is what
      // keeps "not packed" from still costing the walk that would have packed it.
      const builders: Readonly<Record<string, () => unknown>> = {
        'ownership-fan-out': () => ownershipFanOutBody(contract?.features ?? [], feature, moduleOwners),
      };
      const profile = TASK_PROFILES.implement;
      const requested = new Set(request.include ?? []);
      // Iterated in the profile's order, not the caller's, so two requests naming the
      // same sections in different orders serialize to the same bytes.
      profile.lazy.forEach((id, index) => {
        if (!requested.has(id)) return;
        optional.push({
          id,
          required: false,
          // Below every optional section, so an included lazy block is shed first.
          priority: profile.optional.length + 1 + index,
          body: builders[id]!(),
        });
      });
      return {
        candidates: [
          {
            id: 'purpose', required: true, priority: 0, body: {
              feature: feature.id,
              title: feature.title,
              status: feature.status,
              ...('purpose' in feature ? {purpose: feature.purpose} : {}),
            },
          },
          {id: 'criteria', required: true, priority: 0, body: {criteria}},
          {id: 'constraints', required: true, priority: 0, body: constraintBody(workspace, feature)},
          {id: 'prerequisites', required: true, priority: 0, body: prerequisiteBody(workspace, feature)},
          {
            id: 'predicted-write-scope', required: true, priority: 0, body: {
              ref: 'write_scope',
              provenance: writeScope.provenance,
              paths: writeScope.paths.length,
              complete: writeScope.provenance !== 'unknown',
            },
          },
          {
            id: 'candidate-affected-paths', required: true, priority: 0, body: {modules: moduleOwners},
          },
          {
            id: 'required-proof', required: true, priority: 0, body: {
              criteria: feature.acceptanceCriteria.map((criterion) => criterionProofFacts(workspace, feature.id, criterion)),
            },
          },
          ...optional,
        ],
        omissions: [],
      };
    }
    case 'verify': {
      const diagnostics = packDiagnostics('diagnostics', request.diagnostics ?? []);
      return {
        candidates: [
          {id: 'contract', required: true, priority: 0, body: {feature: feature.id, status: feature.status, criteria}},
          {
            id: 'observed-write-scope', required: true, priority: 0, body: {
              ref: 'write_scope',
              provenance: writeScope.provenance,
              paths: writeScope.paths.length,
            },
          },
          {
            id: 'changed-artifacts', required: true, priority: 0, body: {
              ref: 'write_scope.paths',
              owners: writeScope.paths.map((path) => ({path, owners: [...view.owners(path)]})),
            },
          },
          {
            id: 'declared-bindings', required: true, priority: 0, body: {
              criteria: feature.acceptanceCriteria.map((criterion) => criterionProofFacts(workspace, feature.id, criterion)),
            },
          },
          {
            id: 'observed-results', required: true, priority: 0, body: request.proof_views === undefined
              ? {state: 'unobserved', reason: 'no current run supplied proof views; the envelope never runs a gate'}
              : {
                state: 'observed',
                rows: [...request.proof_views]
                  .filter((row) => row.criterion.startsWith(`${feature.id}/`))
                  .sort((left, right) => left.criterion.localeCompare(right.criterion))
                  .map((row) => ({
                    criterion: row.criterion,
                    test: row.test,
                    audit: row.audit,
                    uat: row.uat,
                    blind: row.blind,
                  })),
              },
          },
          {id: 'impact-closure', required: true, priority: 0, body: impactBody(view, feature, writeScope)},
          {id: 'evidence-state', required: true, priority: 0, body: evidenceStateBody(workspace, feature)},
          {id: 'freshness', required: true, priority: 0, body: freshnessBody(workspace, feature, request.attestation)},
          ...(diagnostics.packed.length === 0 ? [] : [{
            id: 'diagnostics', required: false, priority: 1, body: {entries: diagnostics.packed.map((entry) => ({id: entry.id, text: entry.text}))},
          }]),
        ],
        omissions: diagnostics.omissions,
      };
    }
    case 'observe': {
      const diagnostics = packDiagnostics('diagnostics', request.diagnostics ?? []);
      return {
        candidates: [
          {
            id: 'gate-results', required: true, priority: 0, body: diagnostics.packed.length === 0
              ? {state: 'unobserved', reason: 'no gate or detector output was supplied with the request'}
              : {state: 'observed', entries: diagnostics.packed.map((entry) => ({id: entry.id, lines: entry.lines}))},
          },
          {id: 'proof-freshness', required: true, priority: 0, body: freshnessBody(workspace, feature, request.attestation)},
          {
            id: 'attestation-digest', required: true, priority: 0, body: request.attestation?.digest === undefined
              ? {state: 'unknown', reason: 'the envelope never parses the attestation ledger; supply a bounded snapshot'}
              : {state: 'supplied', digest: request.attestation.digest},
          },
          {
            id: 'unresolved-layers', required: true, priority: 0, body: {
              layers: workspace.layers
                .filter((layer) => layer.completeness === 'unknown')
                .map((layer) => ({id: layer.id, reasons: [...layer.reasons]})),
            },
          },
          ...(diagnostics.packed.length === 0 ? [] : [{
            id: 'diagnostics', required: false, priority: 1, body: {entries: diagnostics.packed.map((entry) => ({id: entry.id, text: entry.text}))},
          }]),
        ],
        omissions: diagnostics.omissions,
      };
    }
    case 'blind-oracle': {
      const criterion = feature.acceptanceCriteria.find((entry) => entry.id === request.criterion)
        ?? feature.acceptanceCriteria[0];
      if (criterion === undefined) {
        throw new Error(`Cycle context envelope cannot project a blind oracle for ${feature.id}: it declares no criterion.`);
      }
      // buildBlindPayload reads declaration lines only; module bodies never enter
      // this projection, and neither do prior implementation results.
      const payload = buildBlindPayload(workspace.spec, feature.id, criterion.id, cwd);
      return {
        candidates: [
          {id: 'criterion', required: true, priority: 0, body: criterionBody(criterion)},
          {
            id: 'public-signatures', required: true, priority: 0, body: {
              signatures: [...(payload?.signatures ?? [])].sort(),
              read_manifest: [...(payload?.readManifest ?? [])].sort(),
            },
          },
          {id: 'target-test-path', required: true, priority: 0, body: targetTestPath(workspace, feature.id, criterion)},
          {
            id: 'subject-revisions', required: true, priority: 0, body: {
              ref: ['context_revision', 'input_revisions'],
              subject_sha256: digest(JSON.stringify(criterionBody(criterion))),
            },
          },
        ],
        omissions: [],
      };
    }
  }
}

/** Canonical input revision for the feature's authored shard, read from the compiler's own node. */
function inputRevisionsFor(workspace: GraphIrV2Workspace, featureId: string, cwd: string): Readonly<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const node of workspace.compilation.nodes) {
    if (node.nodeType !== 'semantic' || node.address !== `feature:${featureId}`) continue;
    try {
      entries.push([node.source.path, digest(readFileSync(join(cwd, node.source.path), 'utf8'))]);
    } catch {
      // A revision that cannot be read is named as unknown rather than dropped: the
      // caller still learns which artifact the projection depended on.
      entries.push([node.source.path, 'unknown']);
    }
  }
  return sortedRecord(entries);
}

/** Resolves the request's feature spelling against the compiler contract. */
function resolveFeature(workspace: GraphIrV2Workspace, view: GraphConsumerView, query: string): Schema02FeatureContract {
  const features = workspace.compilation.contract?.features ?? [];
  const direct = features.find((entry) => entry.id === query);
  if (direct !== undefined) return direct;
  const resolved = view.resolveFeature(query.replace(/^feature:/, ''));
  const contract = resolved === undefined ? undefined : features.find((entry) => entry.id === resolved.id);
  if (contract === undefined) {
    throw new Error(`Cycle context envelope requires a schema 0.2 feature contract; ${JSON.stringify(query)} resolved to none.`);
  }
  return contract;
}

/** Serializes, measures, and remeasures until the printed byte total is the real one. */
function measureToFixedPoint(
  build: (payloadBytes: number) => CycleContextEnvelope,
  rounds: number,
): {readonly envelope: CycleContextEnvelope; readonly bytes: number} {
  let bytes = 0;
  for (let round = 0; round < rounds; round++) {
    const envelope = build(bytes);
    const measured = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (measured === bytes) return {envelope, bytes};
    bytes = measured;
  }
  throw new Error('Cycle context envelope did not reach a serialized byte fixed point.');
}

/**
 * Projects one operation's context from a GraphIR workspace and packs it to a
 * measured, fixed-point budget.
 *
 * Required contract facts survive every packing decision: when they alone exceed
 * the profile ceiling the result reports `required_overflow` and names the oversized
 * section instead of shipping a partial contract. Optional sections leave
 * lowest-priority-first, each one aggregated in `budget.omitted`. The profile's lazy
 * sections are absent unless `request.include` names them, and an included one packs
 * below every optional section, so asking for it never displaces cheaper content.
 *
 * @param workspace - One coherent presentation, compilation, and GraphIR snapshot.
 * @param request - The operation, its feature, and the runtime facts the host observed.
 * @param options - Ceiling override, workspace root, and fixed-point round budget.
 * @returns One frozen, deterministic envelope whose `payload_utf8_bytes` is its own serialized length.
 * @throws Error when `include` names a section the profile does not declare lazy, when
 *   the feature has no schema 0.2 contract, or when the measurement never converges.
 * @example
 * ```ts
 * const envelope = buildCycleContextEnvelope(loadGraphIrV2Workspace('.'), {task: 'implement', feature: 'F-001'});
 * ```
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-87b85505
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-a9150a5d
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-d609cdef
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-fb5c7567
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-06ad5c92
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-249b7630
 * @see spec/features/spec-02-context-envelope-1a87a6bd.yaml AC-90ad1c33
 * @since 0.10.0
 * @internal
 */
export function buildCycleContextEnvelope(
  workspace: GraphIrV2Workspace,
  request: CycleContextRequest,
  options: CycleContextOptions = {},
): CycleContextEnvelope {
  const cwd = options.cwd ?? '.';
  const rounds = options.max_measure_rounds ?? DEFAULT_MEASURE_ROUNDS;
  const profile = TASK_PROFILES[request.task];
  const ceiling = options.ceiling_bytes ?? profile.ceiling_bytes;
  for (const id of request.include ?? []) {
    if (profile.lazy.includes(id)) continue;
    throw new Error(
      `Cycle context envelope cannot include ${JSON.stringify(id)} in a ${request.task} packet; `
      + `that profile's lazy sections are ${profile.lazy.length === 0 ? 'none' : profile.lazy.join(', ')}.`,
    );
  }
  const view = graphIrConsumerView(workspace, workspace.spec);
  const feature = resolveFeature(workspace, view, request.feature);
  // An absent write scope is explicitly unknown. Downstream impact treats that as
  // incomplete closure, never as "nothing is affected".
  const writeScope = request.write_scope === undefined
    ? {paths: Object.freeze([]) as readonly string[], provenance: 'unknown' as const}
    : {paths: Object.freeze([...request.write_scope.paths].sort()), provenance: request.write_scope.provenance};
  const projected = candidatesFor(workspace, view, request, feature, writeScope, cwd);
  const inputRevisions = inputRevisionsFor(workspace, feature.id, cwd);
  const projection: Projection = {
    candidates: projected.candidates,
    omissions: projected.omissions,
    inputRevisions,
    writeScope,
  };
  const contextRevision = digest(JSON.stringify({
    task: request.task,
    feature: feature.id,
    input_revisions: projection.inputRevisions,
    write_scope: projection.writeScope,
    sections: projection.candidates,
  }));
  const residentBytes = request.resident_utf8_bytes ?? 0;
  const cache = request.cache ?? 'unknown';

  const sectionBytes = new Map(projection.candidates.map((candidate) => [candidate.id, bytesOf(candidate)]));
  const build = (
    kept: readonly SectionCandidate[],
    omissions: readonly OmissionSummary[],
    requiredOverflow: boolean,
  ) => (payloadBytes: number): CycleContextEnvelope => ({
    task: request.task,
    feature: feature.id,
    context_revision: contextRevision,
    input_revisions: projection.inputRevisions,
    write_scope: {paths: projection.writeScope.paths, provenance: projection.writeScope.provenance},
    sections: kept.map((candidate) => ({
      id: candidate.id,
      required: candidate.required,
      priority: candidate.priority,
      body: candidate.body,
    })),
    budget: {
      payload_utf8_bytes: payloadBytes,
      resident_utf8_bytes: residentBytes,
      total_utf8_bytes: payloadBytes + residentBytes,
      cache,
      estimator: TOKEN_ESTIMATOR,
      estimated_tokens: {
        payload: Math.ceil(payloadBytes / 4),
        resident: Math.ceil(residentBytes / 4),
        total: Math.ceil((payloadBytes + residentBytes) / 4),
      },
      omitted: requiredOverflow
        ? [...omissions, {
          section: largestRequiredId(kept, sectionBytes),
          reason: 'budget' as const,
          // Computed inside the measure loop so the printed overflow is exact at
          // the fixed point rather than one round stale.
          omitted_bytes: Math.max(0, payloadBytes - ceiling),
        }]
        : omissions,
      required_overflow: requiredOverflow,
    },
  });

  // Recorded in the order the packer dropped them, so the summary states the
  // sequence a reader would have to reverse to get the content back.
  const dropped: string[] = [];
  for (;;) {
    const kept = projection.candidates.filter((candidate) => !dropped.includes(candidate.id));
    const omissions = [
      ...projection.omissions,
      ...dropped.map((id) => ({
        section: id,
        reason: 'budget' as const,
        omitted_bytes: sectionBytes.get(id) ?? 0,
      })),
    ];
    const measured = measureToFixedPoint(build(kept, omissions, false), rounds);
    if (measured.bytes <= ceiling) return Object.freeze(measured.envelope);
    const next = [...kept]
      .filter((candidate) => !candidate.required)
      .sort((left, right) => right.priority - left.priority || right.id.localeCompare(left.id))[0];
    if (next !== undefined) {
      dropped.push(next.id);
      continue;
    }
    // Only required facts remain. D19 forbids truncating them, so the envelope
    // keeps every one and reports which section made the packet oversized.
    return Object.freeze(measureToFixedPoint(build(kept, omissions, true), rounds).envelope);
  }
}

/** The required section that dominates an oversized packet, named rather than trimmed. */
function largestRequiredId(
  kept: readonly SectionCandidate[],
  sectionBytes: ReadonlyMap<string, number>,
): string {
  return [...kept]
    .filter((candidate) => candidate.required)
    .sort((left, right) =>
      (sectionBytes.get(right.id) ?? 0) - (sectionBytes.get(left.id) ?? 0) || left.id.localeCompare(right.id))[0]?.id
    ?? 'sections';
}
