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
  return detail.replace(/\bF-\d{3,}\b/g, (id) => {
    const title = featureLabel(id, spec);
    return title === id ? id : `"${title}"`;
  });
}
