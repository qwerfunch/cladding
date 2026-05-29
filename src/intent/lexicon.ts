// Cladding · intent · lexicon (0.4.13 PR-D.1, F-b426b0)
//
// Deterministic keyword sets for prompt-stage intent classification.
// Five categories — DEV_NEW / DEV_MODIFY / DEV_REVIEW / NON_DEV plus
// the catch-all `ambiguous` produced by classifyIntent() when no token
// or competing tokens match.
//
// The lexicon is intentionally small and hand-curated. Each token is
// case-insensitive and matched as a whole-word boundary (so "addable"
// does not match "add"). Keep this file the single source-of-truth so
// translateCapabilities-style host-agnostic logic can reuse it without
// drift.
//
// i18n policy: KO + EN ship in v0.4.13. JA / ZH / ES queued for 0.6.x
// — gated on `trigger_missed` audit data showing real demand.

export interface Lexicon {
  readonly devNew: ReadonlySet<string>;
  readonly devModify: ReadonlySet<string>;
  readonly devReview: ReadonlySet<string>;
  readonly nonDev: ReadonlySet<string>;
}

// Whole-word boundary characters. Korean has no word separator so we
// treat any non-letter/digit (including all Hangul syllables) as the
// surrounding context; the matcher checks for non-Hangul/letter/digit
// on both sides of a token.
const DEV_NEW_KO = [
  '구현',
  '구현해',
  '만들',
  '만들어',
  '추가',
  '추가해',
  '신규',
  '도입',
  '작성해',
  '새 기능',
  '새 feature',
  '새로 만들',
];

const DEV_NEW_EN = [
  'implement',
  'add',
  'build',
  'create',
  'introduce',
  'scaffold',
  'generate',
  'new feature',
];

const DEV_MODIFY_KO = [
  '수정',
  '수정해',
  '고쳐',
  '고치',
  '바꿔',
  '바꾸',
  '버그',
  '리팩토',
  '리팩토링',
  '변경',
  '개선',
  '깨졌',
  '안돼',
  '안 돼',
  '안 됨',
  '오류',
  '에러',
];

const DEV_MODIFY_EN = [
  'fix',
  'modify',
  'change',
  'refactor',
  'improve',
  'update',
  'bug',
  'broken',
  'failing',
  "doesn't work",
  'does not work',
  'error',
  'crash',
];

const DEV_REVIEW_KO = [
  '리뷰',
  '검토',
  '봐줘',
  '설명',
  '설명해',
  '분석',
  '이해',
  '동작 설명',
  '확인해',
];

const DEV_REVIEW_EN = [
  'review',
  'explain',
  'analyse',
  'analyze',
  'understand',
  'walk me through',
  'why does',
  'how does',
  'what does',
  'show me',
];

const NON_DEV_KO = [
  '뭐야',
  '어떻게',
  '왜',
  '실행',
  '실행해',
  '배포',
  '띄워',
  '돌려',
  '시작해',
  '시작',
];

const NON_DEV_EN = [
  'run',
  'execute',
  'deploy',
  'start',
  'launch',
  'what is',
  'how do i',
  'what are',
];

export const DEFAULT_LEXICON: Lexicon = {
  devNew: new Set<string>([...DEV_NEW_KO, ...DEV_NEW_EN]),
  devModify: new Set<string>([...DEV_MODIFY_KO, ...DEV_MODIFY_EN]),
  devReview: new Set<string>([...DEV_REVIEW_KO, ...DEV_REVIEW_EN]),
  nonDev: new Set<string>([...NON_DEV_KO, ...NON_DEV_EN]),
};

/**
 * True when `token` appears in `text` with non-letter/digit (or string
 * boundary) on each side. Case-insensitive. Hangul characters count as
 * letters so "구현해" inside "기능구현해주세요" matches as the substring
 * "구현해" with Hangul on both sides — for Korean we relax the boundary
 * to also accept letter-adjacent matches (CJK has no word delimiter).
 *
 * For ASCII tokens we keep strict word boundaries so "addable" does not
 * match "add" (false positive avoidance).
 */
export function matchesToken(text: string, token: string): boolean {
  if (token.length === 0) return false;
  const lowerText = text.toLowerCase();
  const lowerToken = token.toLowerCase();

  // Hangul-only token (no ASCII letters): substring match suffices —
  // Korean has no word separator and forcing whitespace boundaries
  // would miss most real-world matches like "기능구현해주세요".
  const isHangulOnly = /^[가-힣\s]+$/.test(lowerToken);
  if (isHangulOnly) {
    return lowerText.includes(lowerToken);
  }

  // ASCII / mixed token: enforce non-alphanumeric on each side.
  const escaped = lowerToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b doesn't handle Korean / non-ASCII boundaries cleanly, so we
  // build the boundary ourselves: start-of-string or non-alphanumeric
  // ASCII char on either side.
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`,
    'i',
  );
  return pattern.test(lowerText);
}

/**
 * Returns the subset of `tokens` that appear in `text`. Order preserved
 * for stable test fixtures.
 */
export function findMatches(text: string, tokens: ReadonlySet<string>): readonly string[] {
  const hits: string[] = [];
  for (const token of tokens) {
    if (matchesToken(text, token)) hits.push(token);
  }
  return hits;
}
