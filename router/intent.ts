// Cladding · Intent Router — natural language → CLI verb
//
// The "Soft Shell" of ironclad-design/03-ux-routing.md: users speak
// natural language, the router dispatches to the 5 Iron Core verbs
// (init / work / drive / sync / check). v0.1 floor is pattern-based,
// not LLM-based — every match is deterministic.
//
// Supported in v0.1:
//   - Korean and English phrasings
//   - Single-intent classification (no compound "do A and B")
//
// Out of scope for v0.1:
//   - LLM-assisted disambiguation (T9 specialist agent owns that)
//   - Parameter extraction (just the verb for now)

/** The 5 Iron Core verbs cladding exposes. */
export type Intent = 'init' | 'work' | 'drive' | 'sync' | 'check' | 'unknown';

interface Rule {
  readonly intent: Intent;
  readonly patterns: readonly RegExp[];
}

const RULES: readonly Rule[] = [
  {
    intent: 'init',
    // \b doesn't fire on Korean boundaries, so the Korean tokens stand alone.
    patterns: [
      /\b(init|initialize|bootstrap|scaffold)\b/i,
      /(새\s*프로젝트|시작해)/,
    ],
  },
  {
    intent: 'drive',
    patterns: [
      /\b(plan|planning|roadmap|drive)\b/i,
      /(기획|로드맵|드라이브)/,
    ],
  },
  {
    intent: 'sync',
    patterns: [
      /\b(sync)\b/i,
      /(동기화|명세\s*갱신)/,
    ],
  },
  {
    intent: 'check',
    patterns: [
      /\b(check|verify|drift)\b/i,
      /(확인|점검|검증)/,
    ],
  },
  {
    intent: 'work',
    // 'work' is the broadest verb — placed last so it doesn't shadow
    // more-specific intents.
    patterns: [
      /\b(work|build|develop|implement|test)\b/i,
      /(만들어|구현|기능)/,
    ],
  },
];

/**
 * Classifies a free-form prompt to one of the 5 verbs.
 * Order of rule evaluation is fixed: init / drive / sync / check before work.
 *
 * @param naturalLanguage - Free-form user prompt (Korean or English).
 * @returns The matched intent, or `'unknown'` if nothing fires.
 */
export function classifyIntent(naturalLanguage: string): Intent {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(naturalLanguage))) return rule.intent;
  }
  return 'unknown';
}
