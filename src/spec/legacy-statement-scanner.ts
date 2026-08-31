// Cladding · Spec 0.2 F2 · total legacy EARS migration scanner.

import {
  hasUnprotectedRequirementModal,
  parseStrictStatement,
  type StrictStatementIssue,
  type StrictStatementPattern,
  type ValidStrictStatement,
} from './statement-parser.js';

/** Legacy EARS labels still readable from schema 0.1 source. */
export type LegacyDeclaredEarsPattern = 'ubiquitous' | 'event' | 'state' | 'optional' | 'unwanted' | 'complex';

/** A legacy statement accepted by the strict parser and aligned with its declaration. */
export interface ParsedLegacyStatement {
  /** Scanner discriminator. */
  readonly status: 'parsed';
  /** Strict grammar result retained without source reconstruction. */
  readonly statement: ValidStrictStatement;
}

/** Ordinary legacy prose that is not attempting an EARS structure. */
export interface OpaqueLegacyStatement {
  /** Scanner discriminator. */
  readonly status: 'opaque';
}

/** EARS-looking legacy source requiring human resolution before a migration. */
export interface ConflictLegacyStatement {
  /** Scanner discriminator. */
  readonly status: 'conflict';
  /** Stable reason for the review item. */
  readonly reason: 'DECLARED_PATTERN_MISMATCH' | 'MALFORMED_EARS';
  /** Parser observations when the source was structurally malformed. */
  readonly issues?: readonly StrictStatementIssue[];
}

/** Total classification of one legacy authored text. */
export type LegacyStatementScan = ParsedLegacyStatement | OpaqueLegacyStatement | ConflictLegacyStatement;

/**
 * Classifies legacy source without rebuilding it from partial structured EARS fields.
 *
 * @param text - Authored legacy `text` value.
 * @param declaredPattern - Optional schema 0.1 EARS declaration.
 * @returns `parsed`, `opaque`, or `conflict` for every input.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function scanLegacyStatement(text: unknown, declaredPattern?: unknown): LegacyStatementScan {
  const parsed = parseStrictStatement(text);
  if (parsed.status === 'valid') {
    if (typeof declaredPattern === 'string' && declaredPattern !== patternToLegacy(parsed.pattern)) {
      return {status: 'conflict', reason: 'DECLARED_PATTERN_MISMATCH'};
    }
    return {status: 'parsed', statement: parsed};
  }
  if (isDeclaredLegacyPattern(declaredPattern) || looksLikeEars(text) || hasUnprotectedRequirementModal(text)) {
    return {status: 'conflict', reason: 'MALFORMED_EARS', issues: parsed.issues};
  }
  return {status: 'opaque'};
}

function patternToLegacy(pattern: StrictStatementPattern): LegacyDeclaredEarsPattern {
  return pattern === 'compound' ? 'complex' : pattern;
}

function looksLikeEars(value: unknown): boolean {
  return typeof value === 'string' && /^\s*(?:the|when|while|where|if)\b/i.test(value);
}

function isDeclaredLegacyPattern(value: unknown): value is LegacyDeclaredEarsPattern {
  return value === 'ubiquitous' || value === 'event' || value === 'state'
    || value === 'optional' || value === 'unwanted' || value === 'complex';
}
