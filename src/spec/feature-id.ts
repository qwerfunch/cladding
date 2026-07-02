// Cladding · spec · canonical F-id lexer — shared by the graph layer's prose scanners
//
// v0.7.0 shipped TWO diverging F-id finders: doc-references.ts matched only
// hash ids (`\bF-[0-9a-f]{6,8}\b`), so every legacy sequential id (F-001…F-083,
// 80 live shards) was invisible to the doc graph and DOC_LINK_INTEGRITY, while
// graph-health.ts carried the correct alternation. One source of truth here so
// the scan sites can never diverge again. Legacy = 3+ digits; hash = 6–8
// lowercase hex (8 since 0.6.0, legacy 6-char stays valid — CLAUDE.md).
// Scope: prose/message SCANNING only — the anchored full-match validators
// (spec/new.ts, serve/server.ts zod schemas) are a different contract.

export const FEATURE_ID_SOURCE = String.raw`\bF-(?:\d{3,}|[0-9a-f]{6,8})\b`;

/** Fresh RegExp per call — a shared global regex object would leak lastIndex state. */
export function featureIdRe(flags: string = ''): RegExp {
  return new RegExp(FEATURE_ID_SOURCE, flags);
}
