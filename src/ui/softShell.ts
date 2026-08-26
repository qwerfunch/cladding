// Cladding · UI · Soft Shell formatter
//
// Per `ironclad-design/03-ux-routing.md` §1.2-1.3 (Iron Core vs Soft
// Shell boundary), internal identifiers (`F-NNN`, `AC-NNN`, stage IDs,
// halt-class enum values) must not leak into user-facing output by
// default. The audit log retains them verbatim for replay and forensic
// use; the user surface sees business language.
//
// This module is the single conversion layer. Anywhere the CLI prints
// to a user, route the value through one of these functions first.
// Anywhere the audit log records evidence, keep the internal id raw.

import type {HaltReason} from '../drive/halt.js';
import type {Spec} from '../spec/types.js';

const HALT_MESSAGES: Readonly<Record<HaltReason['class'], string>> = {
  ALL_FEATURES_DONE: 'All work complete.',
  MAX_ITERATIONS: 'Stopped — reached the iteration limit.',
  WALL_CLOCK: 'Stopped — exceeded the time budget.',
  BUDGET_EXCEEDED: 'Stopped — budget exhausted.',
  BLOCKED_FEATURE: 'Stopped — a feature is blocked by dependencies.',
  RETRY_THRESHOLD: 'Stopped — a feature failed too many times.',
  GATE_NO_PROGRESS: 'Stopped — gates are not making progress.',
  HUMAN_REQUIRED: 'Paused — needs human sign-off.',
  TRANSPORT_AUTH_FAILED: 'Stopped — agent rejected the credentials. Check your API key.',
  TRANSPORT_RATE_LIMITED: 'Stopped — agent is rate-limited. Try again after the cooldown.',
  TRANSPORT_NETWORK: 'Stopped — could not reach the agent over the network.',
  LLM_UNAVAILABLE: 'Stopped — could not reach the agent.',
  UNCAUGHT_ERROR: 'Stopped — unexpected error.',
};

const GATE_LABELS: Readonly<Record<string, string>> = {
  'stage_1.1': 'Type',
  'stage_1.2': 'Lint',
  'stage_1.3': 'Drift',
  'stage_1.4': 'Commit',
  'stage_1.5': 'Architecture',
  'stage_1.6': 'Secret',
  'stage_2.1': 'Unit tests',
  'stage_2.2': 'Coverage',
  'stage_2.3': 'Spec conformance',
  'stage_2.4': 'Deliverable smoke',
  'stage_3.1': 'Smoke',
  'stage_3.2': 'Performance',
  'stage_3.3': 'Visual',
  'stage_4.1': 'Audit',
  'stage_4.2': 'UAT',
};

/**
 * Returns the user-facing label for a feature.
 *
 * Falls back to the raw id when the spec has no matching entry — this
 * preserves debuggability for an audit-time mismatch without crashing
 * the render.
 *
 * @param featureId - Internal feature id, e.g. `F-049`.
 * @param spec - The loaded spec; `spec.features[].title` is the source.
 * @returns The feature's business title, or the id when no title exists.
 * @see ironclad-design/03-ux-routing.md §1.2 — user-facing ID ban.
 */
export function featureLabel(featureId: string, spec: Spec): string {
  const match = spec.features.find((f) => f.id === featureId);
  if (match && match.title) return match.title;
  return featureId;
}

/**
 * Converts a `HaltReason` into a plain user-facing sentence.
 *
 * The internal enum (`HUMAN_REQUIRED`, `LLM_UNAVAILABLE`, …) stays in
 * the audit log; the user sees a sentence. When the halt detail field
 * starts with a known feature id, the id is rewritten to the feature's
 * business title for the user-facing string.
 *
 * @param halt - The internal halt reason.
 * @param spec - The loaded spec, used for id-to-title translation.
 * @returns A user-readable sentence.
 * @see drive/halt.ts — the closed halt-class enum this maps from.
 */
export function haltMessage(halt: HaltReason, spec: Spec): string {
  const base = HALT_MESSAGES[halt.class] ?? 'Stopped.';
  const detail = translateFeatureIdsInDetail(halt.detail, spec);
  return detail ? `${base} ${detail}` : base;
}

/**
 * Returns the user-facing label for an Iron Law stage id.
 *
 * @param stageId - Internal stage id, e.g. `stage_1.3`.
 * @returns A short business name (e.g. `Drift`), or the id when unknown.
 */
export function gateLabel(stageId: string): string {
  return GATE_LABELS[stageId] ?? stageId;
}

/**
 * Rewrites any `F-NNN` token in a detail string to its feature title.
 *
 * Halt detail strings are produced by the drive loop in internal form
 * (e.g. `F-042 retried 3 times`). We translate the id portion so the
 * user-facing line reads `"Login flow" retried 3 times` instead. The
 * rest of the string passes through unchanged.
 */
function translateFeatureIdsInDetail(detail: string, spec: Spec): string {
  if (!detail) return '';
  // Match legacy sequential ids (F-NNN) AND the v0.3.9+ hash model (F-<6-8 hex>),
  // so a hash-id feature title translates in halt detail strings too.
  return detail.replace(/\bF-(?:[0-9a-f]{6,8}|\d{3,})\b/g, (id) => {
    const title = featureLabel(id, spec);
    return title === id ? id : `"${title}"`;
  });
}

// ─── Plain-first finding render (F-dd8dc994, F-9af291fa) ───────────────
//
// The loudest emitters — the Stop hook block, the PostToolUse drift line, the
// `clad check` finding block, and the `clad done` refusal — used to print raw
// `DETECTOR_ID: mechanism message`. This catalog is the human-render boundary
// for those surfaces: every drift detector gets ONE clear plain-English lead,
// and the machine detail (detector id + path) is demoted to a parenthetical
// tail. There is exactly one English string per detector — the host agent,
// directed by the interpreter instruction (src/init/host-instructions.ts),
// renders the user's own language by meaning (2026-07-06 pivot). cladding no
// longer ships, detects, or resolves a locale; hook text is an agent-delivered
// channel, and the LLM carries the language load.

interface PlainEntry {
  /** One plain sentence a non-developer understands. No trailing period. */
  readonly lead: string;
  /** Optional next step. CLI commands allowed; MCP tool names never. */
  readonly action?: string;
}

/**
 * Per-detector plain wording, one clear English entry per detector. Keys are the
 * frozen detector ids from `allDetectors` (src/stages/detectors/index.ts); the
 * completeness test asserts every registered detector has a row here with a
 * non-empty lead (AC-746969b3). Seeded from docs/glossary.md and each detector
 * file header — one plain sentence, jargon-free. This is the single translation
 * source; the host agent renders the user's own language from it (2026-07-06 pivot).
 */
export const DETECTOR_PLAIN: Readonly<Record<string, PlainEntry>> = {
  HARDCODED_SECRET: {lead: 'A password or API key looks hard-coded in the source', action: 'move it to an environment variable or secret store'},
  ARCHITECTURE_VIOLATION: {lead: 'The code has an import loop or crosses a layer boundary the design forbids', action: 'break the import cycle or remove the disallowed import'},
  MISSING_IMPLEMENTATION: {lead: 'The spec lists a file that is not on disk yet', action: 'create the file, or remove it from the feature module list'},
  UNMAPPED_ARTIFACT: {lead: 'A source file exists that no feature in the spec claims', action: 'add it to a feature module list, or delete the file'},
  TECH_STACK_MISMATCH: {lead: 'The spec names one programming language but the source files on disk are another', action: 'update project.language to a language the source tree actually contains'},
  STATUS_DRIFT: {lead: 'A feature is marked done but its files or checks do not back that up', action: 'add the missing modules, or set the status back'},
  STALE_SPECIFICATION: {lead: "A feature's lifecycle labels don't match its actual state", action: 'reconcile the feature status and archive fields'},
  REFERENCE_INTEGRITY: {lead: 'The spec points to a feature id that does not exist', action: 'fix the reference or add the missing feature'},
  DOC_LINK_INTEGRITY: {lead: 'A documentation link or feature reference points to something that no longer exists', action: 'fix the broken link or reference in the doc'},
  HARNESS_INTEGRITY: {lead: 'The cladding setup is inconsistent — a version or count does not match across its files'},
  META_INTEGRITY: {lead: 'The spec schema files are missing or malformed', action: 'restore spec/schema.json (reinstall cladding if needed)'},
  AC_DRIFT: {lead: 'An acceptance criterion is incomplete or out of sync with the spec', action: 'write the criterion text or its when/shall/so-that fields'},
  MISSING_TESTS: {lead: 'A finished feature has an acceptance criterion with nothing proving it works', action: 'add a test file or evidence reference to the criterion'},
  STALE_TESTS: {lead: 'The tests are much older than the code they cover, so they may no longer match', action: 'review and refresh the outdated tests'},
  COVERAGE_DROP: {lead: 'Test coverage fell below the project minimum', action: 'add tests until coverage clears the floor'},
  PERFORMANCE_DRIFT: {lead: 'A measured performance number is noticeably worse than the saved baseline', action: 'investigate the slowdown or update the baseline'},
  EVIDENCE_MISMATCH: {lead: 'A recorded piece of evidence points to a file that is gone from disk', action: 'restore the file or update the evidence record'},
  STALE_EVIDENCE: {lead: 'A piece of verification evidence is more than 90 days old', action: 're-verify so the evidence is current'},
  UNTESTED_AC: {lead: 'A finished criterion names a test file that is not on disk', action: 'add the missing test file or fix the reference'},
  UNVERIFIED_AC: {lead: 'A finished criterion has a test that exists but never actually ran and passed', action: 'run the test suite so the result is recorded'},
  CONVENTION_DRIFT: {lead: 'A source file is missing its leading explanatory comment', action: 'add a short header comment explaining the file purpose'},
  FIXTURE_REFERENCE_INVALID: {lead: 'A criterion refers to a test fixture that is not registered', action: 'register the fixture or fix the reference name'},
  SLUG_CONFLICT: {lead: 'Two features or two scenarios share the same short name', action: 'rename one so each short name is unique'},
  ID_COLLISION: {lead: 'Two features or two scenarios share the same id', action: 'give one of them a new id'},
  INVENTORY_DRIFT: {lead: 'The spec summary counts do not match the spec files on disk', action: 'run `clad sync` to refresh the counts'},
  AC_DUPLICATE_WITHIN_FEATURE: {lead: 'The same criterion id appears twice inside one feature', action: 'renumber or remove the duplicate criterion'},
  ARCHITECTURE_FROM_SPEC: {lead: 'The code imports across layers in a way the architecture rules forbid', action: 'remove the cross-layer import or update the architecture rules'},
  CAPABILITIES_FEATURE_MAPPING: {lead: 'A capability lists a feature id that does not exist', action: 'fix the capability feature list'},
  ABSENCE_OF_GOVERNANCE: {lead: 'This project has no cladding spec set up, so the checks have nothing to inspect', action: 'ask your AI tool to apply Cladding to this project'},
  AI_HINTS_FORBIDDEN_PATTERN: {lead: 'The code uses a pattern the project rules told the AI never to use', action: 'remove the forbidden pattern named in the project ai_hints'},
  PLANNED_BACKLOG: {lead: 'Several features are specced but have no code yet — the plan has run ahead of the work', action: 'implement the pending features before adding more'},
  HOLLOW_GOVERNANCE: {lead: 'The design files exist but are still empty templates', action: 'fill in the capabilities and architecture files'},
  DEPENDENCY_CYCLE: {lead: 'Features depend on each other in a loop, so none of them can ever start', action: 'break the dependency loop between the features'},
  SCENARIO_COVERAGE: {lead: 'This project defines no user-journey scenarios, or a scenario links no features', action: 'add a scenario, or bind features to the empty one'},
  PROJECT_CONTEXT_DRIFT: {lead: 'The project why-it-exists document is still the empty starter stub', action: 'write docs/project-context.md, or ask your AI tool to refresh the Cladding project context'},
  SPEC_CONFORMANCE: {lead: 'A finished feature is missing the spec-derived test that should prove it', action: 'add the required oracle test — `clad oracle <feature>` prints the brief'},
  DELIVERABLE_INTEGRITY: {lead: 'The declared entry point is missing, or a shipped feature declares none to smoke-test', action: 'fix project.deliverable.path, or declare the entry point'},
  SMOKE_PROBE_DEMAND: {lead: 'A shipped, runnable project has no smoke check proving its entry point actually runs', action: 'add a smoke probe under project.smoke'},
  STALE_ATTESTATION: {lead: 'Shipped code has changed since it was last verified', action: 're-run `clad check --tier=pre-push --strict` to refresh the attestation'},
  INFERABLE_DEPENDS_ON: {lead: 'The code imports across feature boundaries the spec never recorded as dependencies', action: 'run `clad infer-deps` to see suggested dependency links'},
  HOST_CLAIM_DRIFT: {lead: 'The README claims a support level that the recorded test evidence does not back', action: 'align the README host-claim with the evidence'},
};

/** Clip a string to a budget, appending an ellipsis. Keeps a render bounded. */
function clip(s: string, max = 160): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * The plain English lead for a detector. Falls back to the raw machine message
 * for synthetic findings that carry no catalog row (the Stop gate's ARCH /
 * SECRET adapter failures), so nothing is ever swallowed. The host agent
 * renders the user's own language from this English source (2026-07-06 pivot).
 *
 * @param detector - The frozen detector id (or a synthetic label).
 * @param fallback - Raw message used when the detector has no catalog row.
 */
export function plainLead(detector: string, fallback = ''): string {
  const entry = DETECTOR_PLAIN[detector];
  if (entry) return entry.lead;
  return clip(fallback || detector);
}

/**
 * Renders one finding plain-first as `<lead> (<detector> · <path>)`: the plain
 * sentence leads, and the machine detail (detector id + path) is demoted to the
 * parenthetical tail (AC-263adf79). The parameter is structural so it accepts a
 * DriftFinding, a Stop-gate failure, or a check-stage finding alike.
 *
 * @param f - Any finding-shaped value with a detector, message, and path.
 */
export function plainFinding(f: {readonly detector: string; readonly path?: string; readonly message: string}): string {
  const lead = plainLead(f.detector, f.message);
  const where = f.path ? ` · ${f.path}` : '';
  return `${lead} (${f.detector}${where})`;
}

/**
 * Stop-gate block message. `examples` are already rendered via {@link plainFinding};
 * the count is preserved so the surface still says how many things drifted.
 */
export function stopBlockMessage(count: number, examples: string): string {
  if (count === 1) {
    return `cladding paused before finishing: 1 thing doesn't match the spec yet — e.g. ${examples}. In-progress work? Stop once more to snooze.`;
  }
  return `cladding paused before finishing: ${count} things don't match the spec yet — e.g. ${examples}. In-progress work? Stop once more to snooze.`;
}

/**
 * PostToolUse drift-nudge line. `lead` is the plain sentence; the detector id is
 * demoted to a `(details: …)` tail; `deferred` carries the language-neutral
 * `(+N deferred to commit)` note verbatim (may be empty).
 */
export function driftNudge(count: number, lead: string, detector: string, deferred: string): string {
  return `cladding drift: ${count} error(s) — ${lead} (details: ${detector})${deferred}`;
}

/**
 * The plain lead a `clad done` refusal opens with. The machine sentence
 * (`strict gate not GREEN — status left at …`) follows as a language-neutral tail.
 */
export function doneRefusalLead(): string {
  return 'the completion check found problems above — fix them and re-run';
}

/**
 * The plain lead a `clad done` refusal opens with when the gate was GREEN but the
 * project's independence policy is `require` and the feature is self-certified
 * (F-c566f590). Soft-shell: it asks, in plain words, for the independent or human
 * review the feature lacks — the machine tail (`status left at …`) follows.
 */
export function doneSelfCertRefusalLead(): string {
  return 'the checks passed, but this feature has no independent or human review yet — this project asks for one before completion';
}
