// Cladding · Spec 0.2 F2 · strict statement-parser acceptance cases.

import {describe, expect, test} from 'vitest';

import {analyzeAtomicityRisk, parseStrictStatement} from '../../src/spec/statement-parser.js';

function valid(statement: string) {
  const result = parseStrictStatement(statement);
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') throw new Error('expected valid strict statement');
  return result;
}

describe('Spec 0.2 strict statement parser', () => {
  test('[covers:F-14c9d647/AC-b431ecb1] P01 ubiquitous', () => {
    expect(valid('The system shall retain an audit record.')).toMatchObject({pattern: 'ubiquitous', modal: 'shall'});
  });

  test('P02 event', () => {
    expect(valid('When a user submits a form, the system shall persist the form.')).toMatchObject({pattern: 'event', clauses: [{keyword: 'when'}]});
  });

  test('P03 state', () => {
    expect(valid('While the network is unavailable, the client shall queue submissions.')).toMatchObject({pattern: 'state'});
  });

  test('P04 optional', () => {
    expect(valid('Where offline support is enabled, the client shall cache drafts.')).toMatchObject({pattern: 'optional'});
  });

  test('P05 unwanted+then', () => {
    expect(valid('If a request fails, then the client shall not discard the draft.')).toMatchObject({pattern: 'unwanted', modal: 'shall not'});
  });

  test('P06 compound order/comma', () => {
    expect(valid('When a user submits a form, while the account is active, where sync is enabled, if a retry is needed, then the client shall preserve the draft.'))
      .toMatchObject({pattern: 'compound', clauses: [{keyword: 'when'}, {keyword: 'while'}, {keyword: 'where'}, {keyword: 'if'}]});
    expect(parseStrictStatement('While the account is active, when a user submits a form, the client shall preserve the draft.')).toMatchObject({status: 'invalid'});
    expect(parseStrictStatement('When a user submits a form the client shall preserve the draft.')).toMatchObject({status: 'invalid'});
  });

  test('P07 negation', () => {
    expect(valid('The service shall not retain plaintext passwords.').modal).toBe('shall not');
  });

  test('P08 protected modal', () => {
    expect(valid('The system shall retain the literal `must shall should` in its diagnostic.').response).toContain('`must shall should`');
    expect(valid("The system shall retain the quoted 'shall not' marker.").status).toBe('valid');
    expect(valid("The user's client shall retain a user's draft when it can't sync.").status).toBe('valid');
    expect(valid("The system shall retain the quoted 'user's shall not' marker.").status).toBe('valid');
    expect(valid('The system shall retain ("must \\"shall\\"", (`should`)) details.').status).toBe('valid');
  });

  test('keeps plural possessive apostrophes outside quoted spans', () => {
    expect(valid("The users' sessions service shall retain James' client records.").status).toBe('valid');
  });

  test('P09 multiple-modal rejection', () => {
    expect(parseStrictStatement('The system shall persist the form and shall notify the user.')).toMatchObject({status: 'invalid', issues: [expect.objectContaining({code: 'MODAL_COUNT'})]});
  });

  test('[covers:F-14c9d647/AC-b431ecb1] P10 fragment/unbalanced rejection', () => {
    expect(parseStrictStatement('The system shall.')).toMatchObject({status: 'invalid', issues: [expect.objectContaining({code: 'EMPTY_RESPONSE'})]});
    expect(parseStrictStatement('When (an event occurs, the system shall record it.')).toMatchObject({status: 'invalid', issues: [expect.objectContaining({code: 'UNBALANCED_PROTECTED_SPAN'})]});
  });

  test('keeps the F7-B4 strict replacement statements parseable without weakening the grammar', () => {
    for (const statement of [
      'When the finding parser emits a location-bearing finding, the finding parser shall derive every reported location only from the structured output supplied by the declared tool adapter without performing a second source analysis.',
      'When a changed compacted module has a compiled proof closure, the assurance engine shall evaluate the current bound observations in that closure without inferring behavior preservation from an unchanged test-file set.',
      [
        'The machine finding-tail renderer shall render machine finding tails from detector and normalized-path values only, with no locale resolver, locale type, user',
        '-locale sidecar, or project',
        '.locale field in the compiled product closure.',
      ].join(''),
      'When the plugin mirror build runs, the plugin mirror builder shall derive every managed persona and skill mirror from its canonical src/agents/ or skills/ input, reject a missing/extra/stale generated destination, and produce no diff on a second run.',
    ]) expect(valid(statement).status).toBe('valid');
  });

  test('reports genuine atomicity signals without invalidating a statement', () => {
    const statement = valid('When an order completes, the system shall persist the receipt, notify the customer, and emit an audit event.');
    expect(analyzeAtomicityRisk(statement).signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      'TOP_LEVEL_OBLIGATION_LIST', 'COORDINATED_INDEPENDENT_PREDICATES',
    ]));
  });

  test('keeps a long valid control nonblocking even when length is advisory', () => {
    const statement = valid('The system shall preserve a durable operational narrative whose purpose is to retain one indivisible record for a reviewer by describing a detailed context in a single continuous expression that remains deliberately long enough to exercise advisory length analysis without introducing any second obligation or any independently actionable predicate whatsoever.');
    expect(analyzeAtomicityRisk(statement)).toMatchObject({
      advisory: true,
      signals: [expect.objectContaining({code: 'EXCESSIVE_LENGTH'})],
    });
    expect(statement.status).toBe('valid');
  });
});
