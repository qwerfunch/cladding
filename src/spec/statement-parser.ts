// Cladding · Spec 0.2 F2 · strict, pure EARS statement parser.

/** Structural EARS forms recognized by the schema 0.2 statement surface. */
export type StrictStatementPattern = 'ubiquitous' | 'event' | 'state' | 'optional' | 'unwanted' | 'compound';

/** One clause retained from an accepted compound statement. */
export interface StrictStatementClause {
  /** The structural keyword that owns this precondition. */
  readonly keyword: 'when' | 'while' | 'where' | 'if';
  /** Exact authored clause body, excluding the keyword and comma. */
  readonly value: string;
}

/** A stable diagnostic suitable for a schema authoring surface. */
export interface StrictStatementIssue {
  /** Machine-stable invalidity category. */
  readonly code:
    | 'INVALID_INPUT'
    | 'EMPTY_STATEMENT'
    | 'UNBALANCED_PROTECTED_SPAN'
    | 'MISSING_TERMINAL_PERIOD'
    | 'DISALLOWED_MODAL'
    | 'MODAL_COUNT'
    | 'INVALID_PREFIX'
    | 'MISSING_COMMA'
    | 'EMPTY_CLAUSE'
    | 'OUT_OF_ORDER_CLAUSE'
    | 'MISSING_THEN'
    | 'EMPTY_SYSTEM'
    | 'EMPTY_RESPONSE';
  /** Human-readable remediation without inventing requirement content. */
  readonly message: string;
}

/** A parsed, single-modal schema 0.2 statement. */
export interface ValidStrictStatement {
  /** Discriminator for a syntactically valid statement. */
  readonly status: 'valid';
  /** EARS grammar form. */
  readonly pattern: StrictStatementPattern;
  /** Ordered condition clauses; empty only for ubiquitous requirements. */
  readonly clauses: readonly StrictStatementClause[];
  /** Exact authored system noun phrase. */
  readonly system: string;
  /** The sole permitted modal, including an optional prohibition. */
  readonly modal: 'shall' | 'shall not';
  /** Exact opaque response phrase without the terminal period. */
  readonly response: string;
  /** The original authored statement. */
  readonly statement: string;
}

/** An invalid statement with every deterministic structural issue observed. */
export interface InvalidStrictStatement {
  /** Discriminator for a rejected statement. */
  readonly status: 'invalid';
  /** Stable structural issues. */
  readonly issues: readonly StrictStatementIssue[];
}

/** Discriminated parser result; arbitrary input is always returned, never thrown. */
export type StrictStatementResult = ValidStrictStatement | InvalidStrictStatement;

/** Advisory signal derived only after syntax has already succeeded. */
export interface AtomicityRiskSignal {
  /** Stable observed-signal code. */
  readonly code:
    | 'TOP_LEVEL_OBLIGATION_LIST'
    | 'COORDINATED_INDEPENDENT_PREDICATES'
    | 'SEVERAL_SELECTABLE_OUTCOMES'
    | 'EXCESSIVE_LENGTH';
  /** Concrete parser-observed detail, never an inferred rewrite. */
  readonly detail: string;
}

/** Non-blocking atomicity analysis. */
export interface AtomicityAnalysis {
  /** Atomicity is an advisory and has no validity outcome. */
  readonly advisory: true;
  /** Stable sorted observed signals. */
  readonly signals: readonly AtomicityRiskSignal[];
}

interface ProtectedMask {
  readonly masked: string;
  readonly balanced: boolean;
}

const CLAUSE_ORDER: readonly StrictStatementClause['keyword'][] = ['when', 'while', 'where', 'if'];
const DISALLOWED_MODAL = /\b(?:should|must|will)\b/gi;
const SHALL_MODAL = /\bshall\b(?:\s+not\b)?/gi;
const INDEPENDENT_VERB = /\b(?:create|update|delete|send|emit|record|render|display|persist|store|queue|validate|reject|allow|deny|log|notify|start|stop|retry|write|read|calculate|schedule|run|return)\b[\s\S]{0,80}\b(?:and|or)\b\s+(?:the\s+)?\b(?:create|update|delete|send|emit|record|render|display|persist|store|queue|validate|reject|allow|deny|log|notify|start|stop|retry|write|read|calculate|schedule|run|return)\b/i;

/**
 * Parses a schema 0.2 EARS statement without relying on the legacy reader.
 *
 * Protected quotes, code spans, and nested parenthetical text remain opaque
 * while structural punctuation and modals are scanned.
 *
 * @param value - Candidate authored statement.
 * @returns A typed valid or invalid result for every input.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
export function parseStrictStatement(value: unknown): StrictStatementResult {
  if (typeof value !== 'string') return invalid('INVALID_INPUT', 'Statement must be a string.');
  const protectedMask = maskProtected(value);
  if (!protectedMask.balanced) return invalid('UNBALANCED_PROTECTED_SPAN', 'Statement contains an unbalanced quote, code span, or parenthesis.');
  const start = firstNonWhitespace(protectedMask.masked);
  const end = lastNonWhitespace(protectedMask.masked);
  if (start === -1 || end === -1) return invalid('EMPTY_STATEMENT', 'Statement must not be empty.');
  if (protectedMask.masked[end] !== '.') return invalid('MISSING_TERMINAL_PERIOD', 'Statement must end with one unprotected period.');

  const bodyMask = protectedMask.masked.slice(start, end);
  const body = value.slice(start, end);
  const disallowed = [...bodyMask.matchAll(DISALLOWED_MODAL)];
  if (disallowed.length > 0) return invalid('DISALLOWED_MODAL', 'Use exactly one shall or shall not modal; should, must, and will are not conformant.');
  const modals = [...bodyMask.matchAll(SHALL_MODAL)];
  if (modals.length !== 1) return invalid('MODAL_COUNT', 'Statement must contain exactly one unprotected shall or shall not modal.');

  const modal = modals[0];
  const modalIndex = modal.index ?? -1;
  const beforeModalMask = bodyMask.slice(0, modalIndex);
  const beforeModal = body.slice(0, modalIndex);
  const response = body.slice((modal.index ?? 0) + modal[0].length).trim();
  if (response.length === 0) return invalid('EMPTY_RESPONSE', 'Statement must include a response after its modal.');
  const prefix = parsePrefix(beforeModal, beforeModalMask);
  if (prefix.status === 'invalid') return prefix;
  if (prefix.system.length === 0) return invalid('EMPTY_SYSTEM', 'Statement must name a non-empty system before its modal.');
  return {
    status: 'valid',
    pattern: prefix.pattern,
    clauses: prefix.clauses,
    system: prefix.system,
    modal: /^shall\s+not$/i.test(modal[0]) ? 'shall not' : 'shall',
    response,
    statement: value,
  };
}

/**
 * Reports advisory atomicity signals for a syntactically valid single-modal statement.
 *
 * @param statement - Accepted parser result; invalid input has no advisory path.
 * @returns Observed risk signals that never affect parser or gate validity.
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
export function analyzeAtomicityRisk(statement: ValidStrictStatement): AtomicityAnalysis {
  const responseMask = maskProtected(statement.response).masked;
  const signals: AtomicityRiskSignal[] = [];
  if (/,[\s]*(?:and|or)\s+\S+/i.test(responseMask)) {
    signals.push({code: 'TOP_LEVEL_OBLIGATION_LIST', detail: 'response contains a top-level comma-separated obligation list'});
  }
  if (INDEPENDENT_VERB.test(responseMask)) {
    signals.push({code: 'COORDINATED_INDEPENDENT_PREDICATES', detail: 'response coordinates independently actionable predicates'});
  }
  if (/\b(?:either|one of|any of|select from|choose from)\b/i.test(responseMask)) {
    signals.push({code: 'SEVERAL_SELECTABLE_OUTCOMES', detail: 'response offers several independently selectable outcomes'});
  }
  if (statement.statement.length > 240) {
    signals.push({code: 'EXCESSIVE_LENGTH', detail: `statement is ${statement.statement.length} characters long`});
  }
  return {advisory: true, signals};
}

/**
 * Detects a requirement modal only when the shared protected-span scanner leaves it visible.
 *
 * @param value - Legacy prose that may contain a requirement-like modal.
 * @returns Whether an unprotected requirement modal is present.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function hasUnprotectedRequirementModal(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const protectedMask = maskProtected(value);
  return protectedMask.balanced && /\b(?:shall|must|should|will)\b/i.test(protectedMask.masked);
}

function parsePrefix(source: string, mask: string):
  | {readonly status: 'valid'; readonly pattern: StrictStatementPattern; readonly clauses: readonly StrictStatementClause[]; readonly system: string}
  | InvalidStrictStatement {
  let index = firstNonWhitespace(mask);
  if (index === -1) return invalid('EMPTY_SYSTEM', 'Statement must name a non-empty system before its modal.');
  const clauses: StrictStatementClause[] = [];
  let lastOrder = -1;
  while (true) {
    const keyword = wordAt(mask, index);
    if (keyword === 'the') {
      const systemStart = skipWhitespace(mask, index + 3);
      const system = source.slice(systemStart).trim();
      if (system.includes(',') && hasUnprotectedComma(mask.slice(systemStart))) {
        return invalid('INVALID_PREFIX', 'System phrase must end before the modal and cannot introduce another structural comma.');
      }
      const pattern: StrictStatementPattern = clauses.length === 0
        ? 'ubiquitous'
        : clauses.length === 1
          ? singleClausePattern(clauses[0].keyword)
          : 'compound';
      return {status: 'valid', pattern, clauses, system};
    }
    if (!isClauseKeyword(keyword)) {
      return invalid('INVALID_PREFIX', 'Statement must begin with The, When, While, Where, or If and place The before the system.');
    }
    const order = CLAUSE_ORDER.indexOf(keyword);
    if (order <= lastOrder) return invalid('OUT_OF_ORDER_CLAUSE', 'Compound clauses must appear once in When, While, Where, If order.');
    const comma = nextUnprotectedComma(mask, index + keyword.length);
    if (comma === -1) return invalid('MISSING_COMMA', `${capitalize(keyword)} clause must end at an unprotected comma.`);
    const value = source.slice(index + keyword.length, comma).trim();
    if (value.length === 0) return invalid('EMPTY_CLAUSE', `${capitalize(keyword)} clause must not be empty.`);
    clauses.push({keyword, value});
    lastOrder = order;
    index = skipWhitespace(mask, comma + 1);
    if (keyword === 'if') {
      if (wordAt(mask, index) !== 'then') return invalid('MISSING_THEN', 'If clause must use “then” after its comma.');
      index = skipWhitespace(mask, index + 4);
      if (wordAt(mask, index) !== 'the') return invalid('INVALID_PREFIX', 'If clause must continue with “then the <system> shall …”.');
      continue;
    }
    const next = wordAt(mask, index);
    if (next !== 'the' && !isClauseKeyword(next)) {
      return invalid('INVALID_PREFIX', 'Every non-If clause comma must be followed by the next clause or “the <system>”.');
    }
  }
}

function maskProtected(source: string): ProtectedMask {
  const characters = source.split('');
  const masked = source.split('');
  const blank = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) masked[index] = ' ';
  };
  let index = 0;
  while (index < characters.length) {
    const character = characters[index];
    if (isQuoteOpeningDelimiter(characters, index)) {
      const start = index;
      const end = consumeQuoted(characters, index);
      if (end === -1) return {masked: source, balanced: false};
      blank(start, end);
      index = end;
      continue;
    }
    if (character === '(') {
      const start = index;
      let depth = 0;
      while (index < characters.length) {
        const current = characters[index];
        if (isQuoteOpeningDelimiter(characters, index)) {
          const end = consumeQuoted(characters, index);
          if (end === -1) return {masked: source, balanced: false};
          index = end;
          continue;
        }
        if (current === '(') depth += 1;
        if (current === ')') {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        index += 1;
      }
      if (depth !== 0) return {masked: source, balanced: false};
      blank(start, index);
      continue;
    }
    if (character === ')') return {masked: source, balanced: false};
    index += 1;
  }
  return {masked: masked.join(''), balanced: true};
}

function consumeQuoted(characters: readonly string[], start: number): number {
  const quote = characters[start];
  let index = start + 1;
  while (index < characters.length) {
    if (characters[index] === '\\') {
      index += 2;
      continue;
    }
    if (characters[index] === quote && isQuoteClosingDelimiter(characters, index)) return index + 1;
    index += 1;
  }
  return -1;
}

function isQuoteOpeningDelimiter(characters: readonly string[], index: number): boolean {
  const character = characters[index];
  if (character === '`' || character === '"') return true;
  if (character !== "'") return false;
  return !isWordCharacter(characters[index - 1]);
}

function isQuoteClosingDelimiter(characters: readonly string[], index: number): boolean {
  const character = characters[index];
  if (character === '`' || character === '"') return true;
  return character === "'" && !isWordCharacter(characters[index + 1]);
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function invalid(code: StrictStatementIssue['code'], message: string): InvalidStrictStatement {
  return {status: 'invalid', issues: [{code, message}]};
}

function wordAt(source: string, index: number): string {
  const match = /^[A-Za-z]+/.exec(source.slice(index));
  return match ? match[0].toLowerCase() : '';
}

function isClauseKeyword(value: string): value is StrictStatementClause['keyword'] {
  return CLAUSE_ORDER.includes(value as StrictStatementClause['keyword']);
}

function singleClausePattern(keyword: StrictStatementClause['keyword']): 'event' | 'state' | 'optional' | 'unwanted' {
  switch (keyword) {
    case 'when': return 'event';
    case 'while': return 'state';
    case 'where': return 'optional';
    case 'if': return 'unwanted';
  }
}

function nextUnprotectedComma(source: string, from: number): number {
  return source.indexOf(',', from);
}

function hasUnprotectedComma(source: string): boolean {
  return source.includes(',');
}

function firstNonWhitespace(source: string): number {
  for (let index = 0; index < source.length; index += 1) if (!/\s/.test(source[index])) return index;
  return -1;
}

function lastNonWhitespace(source: string): number {
  for (let index = source.length - 1; index >= 0; index -= 1) if (!/\s/.test(source[index])) return index;
  return -1;
}

function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
