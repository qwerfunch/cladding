// Cladding · Intent Router — natural language → CLI verb
//
// Deterministic, regex-based, language-tagged. The router does not
// call an LLM — host AI tools (Claude Code · Codex · Gemini · …)
// handle ambiguous natural-language input; cladding's router stays
// in the predictable "high-precision over high-recall" lane.
//
// Design principle: false-positives are more expensive than false-
// negatives. A mismatched verb may trigger destructive work; an
// `unknown` return just hands the prompt back to the host's
// natural-language layer where it belongs.
//
// Adding a new language: add a key to `Rule.patterns` and supply
// regex patterns alongside a fixture test file
// (`tests/router/intent.<lang>.test.ts`). The matcher iterates every
// language array; the language tag is metadata, not a filter.
//
// @see ironclad-design/03-ux-routing.md §1.2-1.3 — Iron Core vs Soft
//      Shell boundary and the deterministic-router policy (P-11).
// @see docs/ux-routing-coverage.md — applied-status of all 12
//      prescriptions from 03-ux-routing.md.

/** The 5 Iron Core verbs cladding exposes, plus `unknown`. */
export type Intent = 'init' | 'work' | 'drive' | 'sync' | 'check' | 'unknown';

/** Pattern languages currently supported. Add a key to extend. */
type Lang = 'en' | 'ko';

interface Rule {
  readonly intent: Intent;
  readonly patterns: Readonly<Record<Lang, readonly RegExp[]>>;
}

const RULES: readonly Rule[] = [
  {
    intent: 'init',
    patterns: {
      en: [/\b(init|initialize|bootstrap|scaffold)\b/i],
      // `\b` does not fire on Korean boundaries — the Korean tokens
      // stand alone with spacing context where needed.
      ko: [/새\s*프로젝트/, /(?:^|\s)시작해/],
    },
  },
  {
    intent: 'drive',
    // Drive means "execute an already-defined plan as a feature
    // group". Planning intents (plan · planning · roadmap · 기획 ·
    // 로드맵) return `unknown` on purpose — they belong to the
    // librarian persona and the host's natural-language layer, not
    // to a fixed verb.
    patterns: {
      en: [/\b(drive|execute|orchestrate)\b/i, /\bkick off\b/i],
      ko: [/(드라이브|실행해|진행해|돌려줘|끌고)/],
    },
  },
  {
    intent: 'sync',
    patterns: {
      en: [/\bsync\b/i],
      ko: [/(동기화|명세\s*갱신)/],
    },
  },
  {
    intent: 'check',
    patterns: {
      en: [/\b(check|verify|drift)\b/i],
      ko: [/(확인|점검|검증)/],
    },
  },
  {
    intent: 'work',
    // Broadest verb — placed last so it doesn't shadow more-specific
    // intents (a `"initialize and build"` prompt routes to `init`,
    // not `work`, because `init` is evaluated first).
    patterns: {
      en: [/\b(work|build|develop|implement|test)\b/i],
      ko: [/(만들어|구현|기능)/],
    },
  },
];

/**
 * Classifies a free-form prompt to one of the 5 verbs.
 *
 * Order of rule evaluation is fixed: init → drive → sync → check →
 * work. The work rule is broadest and lands last so it doesn't
 * shadow more-specific verbs.
 *
 * Ambiguous prompts (planning intents, vague phrases like
 * `"어떻게든 마무리"`, anything that does not cleanly map) return
 * `'unknown'` — this is the explicit hand-off to the host AI
 * tool's natural-language layer, not an error.
 *
 * @param naturalLanguage - Free-form user prompt in any supported
 *     language (currently English and Korean).
 * @returns The matched intent, or `'unknown'` when no rule fires.
 * @see commands/clad.md — `clad route` documentation for the
 *     end-user-facing semantics of `unknown`.
 */
export function classifyIntent(naturalLanguage: string): Intent {
  for (const rule of RULES) {
    const allPatterns = [...rule.patterns.en, ...rule.patterns.ko];
    if (allPatterns.some((p) => p.test(naturalLanguage))) return rule.intent;
  }
  return 'unknown';
}
