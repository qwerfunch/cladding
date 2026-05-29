// Cladding · intent · prompt-stage classifier (0.4.13 PR-D.1, F-b426b0)
//
// Pure deterministic classifier — same input always produces the same
// output. No LLM calls, no I/O beyond optional spec.features[] reads
// for featureCandidates. Used by:
//   - plugins/claude-code/hooks/user-prompt-submit.mjs (PR-D.2) — hint
//     injection on UserPromptSubmit
//   - src/serve/server.ts (PR-D.1) — `assess_intent` MCP tool for hosts
//     without UserPromptSubmit support (Codex / Cursor / Antigravity /
//     Gemini): the host AI self-calls when unsure
//
// Design notes:
//   - Conservative bias toward triggering (false positive on the
//     trigger side is recoverable — the host AI just calls enter_work
//     and proceeds. False negative is worse — the user starts editing
//     without a transaction and Layer C must catch it).
//   - `ambiguous` is the silent fallback. When in doubt cladding stays
//     out of the way and lets Layer C (PreToolUse) enforce.
//   - featureCandidates is optional. When the project ships a Spec
//     with features[], dev-modify classifications include the top-3
//     fuzzy-matched features so the host AI can pick a featureId
//     without re-grepping the spec.

import {DEFAULT_LEXICON, type Lexicon, findMatches} from './lexicon.js';

export type IntentCategory =
  | 'dev-new'
  | 'dev-modify'
  | 'dev-review'
  | 'non-dev'
  | 'ambiguous';

export type SuggestedAction = 'clad_create_feature' | 'enter_work' | 'silent';

export interface FeatureCandidate {
  readonly id: string;
  readonly slug: string;
  readonly score: number;
}

export interface IntentClassification {
  readonly intent: IntentCategory;
  readonly confidence: 'high' | 'low';
  readonly matchedTokens: readonly string[];
  readonly suggestedAction: SuggestedAction;
  /** Present only for `dev-modify`. Top-3 by token overlap with prompt. */
  readonly featureCandidates?: readonly FeatureCandidate[];
}

export interface ClassifyOptions {
  /** Replace the default KO+EN lexicon (test-only). */
  readonly lexicon?: Lexicon;
  /**
   * Loaded spec features[] for `dev-modify` candidate ranking. When
   * omitted, classifications still work — `featureCandidates` is just
   * absent.
   */
  readonly features?: ReadonlyArray<{
    readonly id: string;
    readonly slug?: string;
    readonly title?: string;
  }>;
}

/**
 * Classifies a user prompt into one of the 5 categories. Deterministic.
 *
 * Algorithm:
 *   1. Find lexicon hits in the prompt (case-insensitive, word-boundary
 *      aware for ASCII, substring for Hangul).
 *   2. Apply the conflict resolution table:
 *        - any dev-* hit + any non-dev hit → ambiguous (low confidence)
 *        - dev-new only → dev-new (high)
 *        - dev-new + dev-modify → dev-new (high — new wins, more specific)
 *        - dev-modify only → dev-modify (high)
 *        - dev-modify + dev-review → dev-modify (high — modify is the
 *          more committal sibling)
 *        - dev-review only → dev-review (high)
 *        - non-dev only → non-dev (high)
 *        - nothing → ambiguous (low)
 *   3. Map intent → suggestedAction.
 *   4. If dev-modify and `features` provided, build top-3 featureCandidates
 *      by token-overlap score with prompt.
 */
export function classifyIntent(
  prompt: string,
  opts: ClassifyOptions = {},
): IntentClassification {
  const lexicon = opts.lexicon ?? DEFAULT_LEXICON;
  const text = prompt;

  const newHits = findMatches(text, lexicon.devNew);
  const modifyHits = findMatches(text, lexicon.devModify);
  const reviewHits = findMatches(text, lexicon.devReview);
  const nonDevHits = findMatches(text, lexicon.nonDev);

  const hasDev = newHits.length > 0 || modifyHits.length > 0 || reviewHits.length > 0;
  const hasNonDev = nonDevHits.length > 0;

  // Conflict: any dev-* + any non-dev → ambiguous.
  if (hasDev && hasNonDev) {
    return {
      intent: 'ambiguous',
      confidence: 'low',
      matchedTokens: [...newHits, ...modifyHits, ...reviewHits, ...nonDevHits],
      suggestedAction: 'silent',
    };
  }

  // Nothing matched.
  if (!hasDev && !hasNonDev) {
    return {
      intent: 'ambiguous',
      confidence: 'low',
      matchedTokens: [],
      suggestedAction: 'silent',
    };
  }

  // Only non-dev.
  if (hasNonDev && !hasDev) {
    return {
      intent: 'non-dev',
      confidence: 'high',
      matchedTokens: nonDevHits,
      suggestedAction: 'silent',
    };
  }

  // Dev family — pick the most specific.
  if (newHits.length > 0) {
    return {
      intent: 'dev-new',
      confidence: 'high',
      matchedTokens: [...newHits, ...modifyHits, ...reviewHits],
      suggestedAction: 'clad_create_feature',
    };
  }

  if (modifyHits.length > 0) {
    const featureCandidates = opts.features
      ? rankFeatureCandidates(text, opts.features)
      : undefined;
    return {
      intent: 'dev-modify',
      confidence: 'high',
      matchedTokens: [...modifyHits, ...reviewHits],
      suggestedAction: 'enter_work',
      ...(featureCandidates && featureCandidates.length > 0
        ? {featureCandidates}
        : {}),
    };
  }

  // Only dev-review remains.
  return {
    intent: 'dev-review',
    confidence: 'high',
    matchedTokens: reviewHits,
    suggestedAction: 'silent',
  };
}

/**
 * Tokenizes the prompt + each feature's slug/title and scores by
 * shared-token count. Returns the top-3 by score (descending), ties
 * broken by feature id ascending for determinism.
 *
 * Token: lowercased run of [a-z0-9가-힣] of length ≥ 2.
 */
function rankFeatureCandidates(
  prompt: string,
  features: ReadonlyArray<{readonly id: string; readonly slug?: string; readonly title?: string}>,
): readonly FeatureCandidate[] {
  const promptTokens = new Set(tokenize(prompt));
  if (promptTokens.size === 0) return [];

  const scored: FeatureCandidate[] = [];
  for (const f of features) {
    const haystack = `${f.slug ?? ''} ${f.title ?? ''}`;
    const tokens = tokenize(haystack);
    let score = 0;
    for (const t of tokens) {
      if (promptTokens.has(t)) score++;
    }
    if (score > 0) {
      scored.push({id: f.id, slug: f.slug ?? '', score});
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, 3);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/u)
    .filter((t) => t.length >= 2);
}
