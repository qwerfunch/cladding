// Cladding · EARS syntactic validator — 5 canonical patterns
//
// EARS (Easy Approach to Requirements Syntax) defines 5 sentence
// shapes. This module checks the *syntactic* surface of each AC; the
// semantic content (does the AC actually match the implementation?)
// is left to the LLM-assisted AC_DRIFT enrichment in T9.
//
// Patterns (per ironclad/ears.md):
//
//   ubiquitous     "The system shall X."             — no trigger
//   event-driven   "When Y, the system shall X."     — trigger 'when'
//   state-driven   "While Y, the system shall X."    — trigger 'while'
//   optional       "Where Y, the system shall X."    — trigger 'where'
//   unwanted       "If Y, then the system shall X."  — trigger 'if'
//
// The validator is *syntactic, lenient*: it inspects only the trigger
// keyword for non-ubiquitous patterns and only checks `condition`
// (not the rendered `text`). A missing or misaligned trigger is the
// cheapest, highest-signal failure mode to catch deterministically.

import type {AcceptanceCriterion, EarsPattern, Feature} from './types.js';

/** One syntactic issue found on a single AC. */
export interface EarsIssue {
  readonly featureId: string;
  readonly acId: string;
  readonly pattern: EarsPattern | 'unspecified';
  readonly message: string;
}

const TRIGGERS: Record<Exclude<EarsPattern, 'ubiquitous'>, string> = {
  event: 'when',
  state: 'while',
  optional: 'where',
  unwanted: 'if',
};

/** First non-whitespace word of the input, lower-cased. */
function firstWord(text: string): string {
  const match = text.trim().match(/^(\S+)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * The pure EARS-shape rule for one AC, decoupled from spec identity so it can
 * be reused at AUTHORING time (clad_create_feature, before ids/Feature exist)
 * as well as at gate time (checkAc / AC_DRIFT). Returns a human-readable issue
 * message, or null when the (pattern, condition) pair is well-formed.
 *
 * Returns a SINGLE message (not a list): the EARS rules are mutually exclusive,
 * so one AC cannot simultaneously be e.g. ubiquitous-with-condition AND
 * event-without-`when`.
 *
 * @param pattern - The declared EARS pattern (or undefined).
 * @param conditionRaw - The AC's `condition` text (or undefined).
 * @returns A single issue message, or null when shape is valid.
 */
export function checkEarsShape(pattern: EarsPattern | undefined, conditionRaw: string | undefined): string | null {
  const condition = conditionRaw?.trim() ?? '';

  if (!pattern) {
    return condition.length > 0 ? 'condition is present but ears pattern is not declared' : null;
  }
  if (pattern === 'ubiquitous') {
    return condition.length > 0 ? `ears='ubiquitous' but condition is present ('${condition.slice(0, 40)}…')` : null;
  }
  const expected = TRIGGERS[pattern];
  if (condition.length === 0) {
    return `ears='${pattern}' requires condition starting with '${expected}' — empty`;
  }
  if (firstWord(condition) !== expected) {
    return `ears='${pattern}' requires condition to start with '${expected}' — got '${firstWord(condition)}'`;
  }
  return null;
}

/**
 * Checks a single AC against its declared EARS pattern.
 *
 * Returns zero issues when the AC's `condition` (or absence thereof)
 * matches the EARS pattern's trigger expectation. Returns one issue
 * per misalignment — typically a missing/misplaced trigger word.
 * Thin wrapper over `checkEarsShape` that attaches spec identity.
 *
 * @param feature - The feature containing the AC (for context in messages).
 * @param ac - The acceptance criterion to validate.
 * @returns A (possibly empty) list of issues.
 */
export function checkAc(feature: Feature, ac: AcceptanceCriterion): readonly EarsIssue[] {
  const message = checkEarsShape(ac.ears, ac.condition);
  if (!message) return [];
  return [{featureId: feature.id, acId: ac.id, pattern: ac.ears ?? 'unspecified', message}];
}

/** Sweeps every AC in every feature; aggregates issues. */
export function checkAllFeatures(features: readonly Feature[]): readonly EarsIssue[] {
  const out: EarsIssue[] = [];
  for (const f of features) {
    for (const ac of f.acceptance_criteria ?? []) {
      out.push(...checkAc(f, ac));
    }
  }
  return out;
}
