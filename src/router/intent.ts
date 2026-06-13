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
// 0.6.0 rename (docs/glossary.md): the former `drive` and `work`
// intents both classify to `run` — `drive` was renamed and the
// reserved `work` stub verb was removed, with `run` owning the
// execute-the-plan slot. The match patterns of both old rules are
// kept; only the returned verb changed.
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

/** The Iron Core verbs cladding's router resolves, plus `unknown`. */
export type Intent = 'init' | 'run' | 'sync' | 'check' | 'unknown';

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
    intent: 'run',
    // Run means "execute an already-defined plan as a feature
    // group" (the former `drive` patterns). Planning intents (plan ·
    // planning · roadmap · 기획 · 로드맵) return `unknown` on
    // purpose — they belong to the planner persona and the host's
    // natural-language layer, not to a fixed verb.
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
    intent: 'run',
    // Broadest rule — the former `work` verb's build/implement
    // patterns, placed last so it doesn't shadow more-specific
    // intents (a `"initialize and build"` prompt routes to `init`,
    // not `run`, because `init` is evaluated first). The `work` verb
    // itself was removed in 0.6.0; `run` absorbs its classification.
    patterns: {
      en: [/\b(work|build|develop|implement|test)\b/i],
      ko: [/(만들어|구현|기능)/],
    },
  },
];

/**
 * Classifies a free-form prompt to one of the router's verbs.
 *
 * Order of rule evaluation is fixed: init → run (execute) → sync →
 * check → run (build, the former `work` rule). The build rule is
 * broadest and lands last so it doesn't shadow more-specific verbs.
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

// ---------------------------------------------------------------------
// 0.6.0 (F-1d23a6) — suggestion-only HIGH-RECALL tier.
//
// The file header's false-positive economics ("a mismatched verb may
// trigger destructive work") do NOT apply here: suggestIntent's output
// is only ever injected as advisory context by the UserPromptSubmit
// host hook — never executed — so a wrong guess costs one ignorable
// context line. classifyIntent stays byte-identical in behavior: this
// tier consults it first and only widens the net on `unknown`.

/** EN build-verb + artifact-noun conjunction — "add a login feature"
 * classified as unknown pre-0.6; requiring BOTH keeps bare "add"/"new"
 * (too broad even for the suggestion tier) from firing. */
const SUGGEST_RUN_VERB = /\b(add|create|new|make)\b/i;
const SUGGEST_RUN_NOUN = /\b(feature|flow|page|api|endpoint|component)s?\b/i;
/** Wrap-up phrasings → "verify before you call it done". `drift` is
 * NOT repeated here — classifyIntent's check rule already owns it. */
const SUGGEST_CHECK = [/\b(finish|complete|ship|done)\b/i, /\bwrap\s*up\b/i];
/** Consistency questions → check. Matched BEFORE classifyIntent because
 * its `\bsync\b` pattern would otherwise read "in sync" as the sync verb. */
const SUGGEST_CONSISTENCY = /\b(in sync|consistent)\b/i;

/**
 * Classifies a prompt for SUGGESTION purposes only (injected context,
 * never execution) — a recall-over-precision second tier on top of
 * {@link classifyIntent}. KO patterns (기능 추가 / 만들어 …) flow
 * through the precision tier's existing rules unchanged.
 *
 * @param prompt - Free-form user prompt.
 * @returns The suggested intent, or `null` when nothing fires (the
 *     hook prints nothing — silence, not `'unknown'`).
 * @see cli/hook.ts — the UserPromptSubmit consumer.
 */
export function suggestIntent(prompt: string): Intent | null {
  if (SUGGEST_CONSISTENCY.test(prompt)) return 'check';
  const precise = classifyIntent(prompt);
  if (precise !== 'unknown') return precise;
  if (SUGGEST_RUN_VERB.test(prompt) && SUGGEST_RUN_NOUN.test(prompt)) return 'run';
  if (SUGGEST_CHECK.some((p) => p.test(prompt))) return 'check';
  return null;
}
