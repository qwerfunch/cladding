// Cladding · unit tests for enterWork sub-agent dispatch hint
// (0.4.10 PR-A.3, F-9c2741).
//
// Covers the dispatch hint shape per Tier — Tier 1 hosts get a
// regular hint, Tier 2 (Gemini) gets advisory:true, Tier 3 (generic)
// gets none. Also covers the routing field that piggybacks on
// resolvePersona's matched-rule trace.
//
// The hint is what the host AI is supposed to obey: instead of
// adopting the persona prompt itself, the host should call the named
// tool (Task / agent / mode_switch / spawn_subagent) with the
// subagent_type id. Tests pin the per-host tool names so a typo in
// transaction.ts surfaces here instead of in dogfood.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors} from '../../src/stages/drift.js';
import {enterWork, type SubAgentDispatchHint} from '../../src/work/transaction.js';

function seedFeature(cwd: string, filename: string, body: string): void {
  const dir = join(cwd, 'spec', 'features');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, filename), body);
}

function seedDocsFeature(cwd: string): string {
  // Hits the docs-librarian routing rule (module_prefix: docs/).
  seedFeature(
    cwd,
    'docs-aaa111.yaml',
    [
      'id: F-aaa111',
      'slug: docs-update',
      'status: planned',
      'modules:',
      '  - docs/readme.md',
      'acceptance_criteria: []',
      '',
    ].join('\n'),
  );
  return 'F-aaa111';
}

function seedSrcFeature(cwd: string): string {
  // Hits the __fallback__ rule when no routing.yaml present.
  seedFeature(
    cwd,
    'feat-bbb222.yaml',
    [
      'id: F-bbb222',
      'slug: feat',
      'status: planned',
      'modules:',
      '  - src/feat.ts',
      'acceptance_criteria: []',
      '',
    ].join('\n'),
  );
  return 'F-bbb222';
}

describe('enterWork — subAgentDispatchHint', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-dispatch-hint-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('Tier 1 — claude-code emits Task hint with persona subagent_type', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'claude-code'});

    expect(result.subAgentDispatchHint).toBeDefined();
    const hint = result.subAgentDispatchHint as SubAgentDispatchHint;
    expect(hint.host).toBe('claude-code');
    expect(hint.tool).toBe('Task');
    expect(hint.subagent_type).toBe(result.personaId);
    expect(hint.advisory).toBeUndefined();
  });

  test('Tier 1 — codex emits agent hint', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'codex'});

    const hint = result.subAgentDispatchHint as SubAgentDispatchHint;
    expect(hint.host).toBe('codex');
    expect(hint.tool).toBe('agent');
    expect(hint.advisory).toBeUndefined();
  });

  test('Tier 1 — cursor emits mode_switch hint', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'cursor'});

    const hint = result.subAgentDispatchHint as SubAgentDispatchHint;
    expect(hint.host).toBe('cursor');
    expect(hint.tool).toBe('mode_switch');
    expect(hint.advisory).toBeUndefined();
  });

  test('Tier 1 — antigravity emits spawn_subagent hint', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'antigravity'});

    const hint = result.subAgentDispatchHint as SubAgentDispatchHint;
    expect(hint.host).toBe('antigravity');
    expect(hint.tool).toBe('spawn_subagent');
    expect(hint.advisory).toBeUndefined();
  });

  test('Tier 2 — gemini emits @agent hint with advisory:true', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'gemini'});

    const hint = result.subAgentDispatchHint as SubAgentDispatchHint;
    expect(hint.host).toBe('gemini');
    expect(hint.tool).toBe('@agent');
    expect(hint.advisory).toBe(true);
  });

  test('Tier 3 — generic emits NO dispatch hint (host self-injects)', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'generic'});

    expect(result.subAgentDispatchHint).toBeUndefined();
    // Persona prompt body is still present — Tier 3 path uses it directly.
    expect(result.personaPrompt.length).toBeGreaterThan(0);
  });

  test('resumed work also carries the same dispatch hint shape', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({featureId, cwd, hostOverride: 'claude-code'});
    const resumed = enterWork({featureId, cwd, hostOverride: 'claude-code'});

    expect(resumed.status).toBe('resumed');
    expect(resumed.subAgentDispatchHint).toBeDefined();
    expect(resumed.subAgentDispatchHint?.host).toBe('claude-code');
    expect(resumed.subAgentDispatchHint?.tool).toBe('Task');
  });
});

describe('enterWork — routing trace', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-dispatch-routing-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('routing field absent when caller passes explicit personaId', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({
      featureId,
      cwd,
      personaId: 'reviewer',
      hostOverride: 'claude-code',
    });

    expect(result.personaId).toBe('reviewer');
    expect(result.routing).toBeUndefined();
  });

  test('routing field present with __fallback__ when no routing.yaml exists', () => {
    const featureId = seedSrcFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'claude-code'});

    expect(result.routing).toBeDefined();
    expect(result.routing?.matchedRule).toBe('__fallback__');
    expect(result.personaId).toBe('specialists');
  });

  test('routing matches docs-librarian rule when routing.yaml present', () => {
    // Seed a minimal routing.yaml at cwd that matches docs/ to librarian.
    mkdirSync(join(cwd, 'agents'), {recursive: true});
    writeFileSync(
      join(cwd, 'agents', 'routing.yaml'),
      [
        'version: 1',
        'rules:',
        '  - name: docs-librarian',
        '    when:',
        '      module_prefix: [docs/]',
        '    persona: librarian',
        '  - name: default',
        '    when: {}',
        '    persona: specialists',
        '',
      ].join('\n'),
    );
    const featureId = seedDocsFeature(cwd);
    const result = enterWork({featureId, cwd, hostOverride: 'claude-code'});

    expect(result.routing?.matchedRule).toBe('docs-librarian');
    expect(result.personaId).toBe('librarian');
  });
});
