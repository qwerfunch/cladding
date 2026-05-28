// Cladding · unit tests for src/agents/routing.ts (0.4.10, PR-A)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {resolvePersona, type ResolvePersonaInput} from '../../src/agents/routing.js';

function seedRouting(cwd: string, body: string): void {
  const dir = join(cwd, 'agents');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'routing.yaml'), body);
}

const baseInput = (cwd: string, overrides: Partial<ResolvePersonaInput> = {}): ResolvePersonaInput => ({
  featureId: 'F-aaaaaa',
  intent: undefined,
  scope: {slug: 'demo', modules: []},
  cwd,
  ...overrides,
});

describe('resolvePersona', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-routing-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
  });

  test('no routing.yaml → fallback specialists with __fallback__ rule', () => {
    const result = resolvePersona(baseInput(cwd));
    expect(result.personaId).toBe('specialists');
    expect(result.matchedRule).toBe('__fallback__');
  });

  test('module_prefix match — spec/* → librarian', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: spec-mutation',
        '    when:',
        '      module_prefix: [spec/]',
        '    persona: librarian',
        '    parallel_group: spec',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {scope: {slug: 'x', modules: ['spec/features/a.yaml']}}));
    expect(result.personaId).toBe('librarian');
    expect(result.matchedRule).toBe('spec-mutation');
    expect(result.parallelGroup).toBe('spec');
  });

  test('intent_tokens match — "review" → reviewer', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: architecture-review',
        '    when:',
        '      intent_tokens: [review, audit]',
        '    persona: reviewer',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {intent: 'please review the auth module'}));
    expect(result.personaId).toBe('reviewer');
    expect(result.matchedRule).toBe('architecture-review');
  });

  test('first-match wins — earlier rule beats later same match', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: first',
        '    when: {module_prefix: [src/]}',
        '    persona: librarian',
        '  - name: second',
        '    when: {module_prefix: [src/spec/]}',
        '    persona: reviewer',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {scope: {slug: 'x', modules: ['src/spec/load.ts']}}));
    expect(result.matchedRule).toBe('first');
    expect(result.personaId).toBe('librarian');
  });

  test('AND between fields — both module_prefix AND intent_tokens required', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: both',
        '    when:',
        '      module_prefix: [src/]',
        '      intent_tokens: [review]',
        '    persona: reviewer',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    // Only module_prefix matches (no intent) → falls through to default.
    const noIntent = resolvePersona(baseInput(cwd, {scope: {slug: 'x', modules: ['src/a.ts']}}));
    expect(noIntent.matchedRule).toBe('default');
    // Only intent matches (no module overlap) → falls through.
    const noPrefix = resolvePersona(baseInput(cwd, {intent: 'review please'}));
    expect(noPrefix.matchedRule).toBe('default');
    // Both match → first rule wins.
    const both = resolvePersona(baseInput(cwd, {scope: {slug: 'x', modules: ['src/a.ts']}, intent: 'review'}));
    expect(both.matchedRule).toBe('both');
  });

  test('default rule with preferredPersona tie-breaker → uses ai_hints', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {preferredPersona: 'librarian'}));
    expect(result.personaId).toBe('librarian');
    expect(result.matchedRule).toBe('default+ai_hints');
  });

  test('non-default rule ignores preferredPersona — explicit match wins', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: spec-mutation',
        '    when: {module_prefix: [spec/]}',
        '    persona: librarian',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(
      baseInput(cwd, {scope: {slug: 'x', modules: ['spec/features/a.yaml']}, preferredPersona: 'reviewer'}),
    );
    expect(result.matchedRule).toBe('spec-mutation');
    expect(result.personaId).toBe('librarian'); // not reviewer
  });

  test('malformed yaml → fallback', () => {
    seedRouting(cwd, '{{{not valid yaml');
    const result = resolvePersona(baseInput(cwd));
    expect(result.matchedRule).toBe('__fallback__');
  });

  test('empty rules array → fallback', () => {
    seedRouting(cwd, 'version: 1\nrules: []\n');
    const result = resolvePersona(baseInput(cwd));
    expect(result.matchedRule).toBe('__fallback__');
  });

  test('trailing slash on module_prefix is optional', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: nost',
        '    when: {module_prefix: [src/work]}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {scope: {slug: 'x', modules: ['src/work/transaction.ts']}}));
    expect(result.matchedRule).toBe('nost');
  });

  test('exact module path match (no trailing slash)', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: exact',
        '    when: {module_prefix: [README.md]}',
        '    persona: librarian',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {scope: {slug: 'x', modules: ['README.md']}}));
    expect(result.matchedRule).toBe('exact');
  });

  test('intent matching is case-insensitive', () => {
    seedRouting(
      cwd,
      [
        'version: 1',
        'rules:',
        '  - name: token',
        '    when: {intent_tokens: [REVIEW]}',
        '    persona: reviewer',
        '',
      ].join('\n'),
    );
    const result = resolvePersona(baseInput(cwd, {intent: 'Please Review This'}));
    expect(result.matchedRule).toBe('token');
  });
});
