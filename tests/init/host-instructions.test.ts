// Cladding · unit tests for src/init/host-instructions.ts (F-90d054)
//
// Covers AC-008 (AGENTS.md written), AC-009 (CLAUDE.md created when absent),
// and AC-010 (CLAUDE.md `## cladding` section appended idempotently when
// present).

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {renderAgentsMdManagedBlock} from '../../src/init/agents-md.js';
import {
    CLAUDE_MD_SECTION,
  CLAUDE_MD_SECTION_MARKER,
  isStaleInstructions,
  writeClaudeMdSection,
} from '../../src/init/host-instructions.js';

describe('writeClaudeMdSection (F-90d054 AC-009 + AC-010)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-claudemd-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('creates CLAUDE.md when absent (AC-009)', () => {
    const r = writeClaudeMdSection(dir);
    expect(r).toBe('created');
    const body = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(body).toBe(CLAUDE_MD_SECTION);
    expect(body).toContain(CLAUDE_MD_SECTION_MARKER);
  });

  test('appends ## cladding section when CLAUDE.md exists without it (AC-010)', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project memory\n\nuser-authored content here.\n');
    const r = writeClaudeMdSection(dir);
    expect(r).toBe('appended');
    const body = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(body).toContain('# Project memory');
    expect(body).toContain('user-authored content here.');
    expect(body).toContain(CLAUDE_MD_SECTION_MARKER);
  });

  test('is idempotent — second call leaves CLAUDE.md unchanged (AC-010)', () => {
    writeClaudeMdSection(dir);
    const before = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    const r = writeClaudeMdSection(dir);
    expect(r).toBe('unchanged');
    const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(after).toBe(before);
    // No duplicate section header.
    expect(after.match(/## cladding/g)?.length).toBe(1);
  });

  test('handles missing trailing newline on existing CLAUDE.md', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project memory');
    const r = writeClaudeMdSection(dir);
    expect(r).toBe('appended');
    const body = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(body.startsWith('# Project memory')).toBe(true);
    expect(body).toContain(CLAUDE_MD_SECTION_MARKER);
  });

  test('[covers:F-0f4dd6/AC-019] refreshes only the ## cladding section when v0.3.x markers are present', () => {
    const stale = [
      '# Project memory',
      '',
      'My own notes that should survive.',
      '',
      '## cladding',
      '',
      'This project is managed by **cladding**.',
      '',
      '**First-task rule** — If `spec.yaml._meta.enrichment_status` equals',
      '`"pending"`, complete enrichment_scope before any other work.',
      '',
      '**Hash-based IDs** — Use `clad_create_feature` MCP tool.',
      '',
      '## My other notes',
      '',
      'Should also survive.',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'CLAUDE.md'), stale);
    const r = writeClaudeMdSection(dir);
    expect(r).toBe('refreshed-stale');
    const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('# Project memory');
    expect(after).toContain('My own notes that should survive.');
    expect(after).toContain('## My other notes');
    expect(after).toContain('Should also survive.');
    expect(after).not.toContain('enrichment_status');
    expect(after).not.toContain('enrichment_scope');
    expect(after).toContain('**Hash-based IDs** — Never hand-author');
    expect(after.match(/## cladding/g)?.length).toBe(1);
  });

  test('leaves the cladding section alone when it already matches the v0.4.0 template', () => {
    writeClaudeMdSection(dir);
    const before = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    const r = writeClaudeMdSection(dir);
    expect(r).toBe('unchanged');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(before);
  });
});

describe('isStaleInstructions', () => {
  test('flags v0.3.x enrichment markers', () => {
    expect(isStaleInstructions('text including _meta.enrichment_status')).toBe(true);
    expect(isStaleInstructions('See `first-task enrichment rule` section')).toBe(true);
    expect(isStaleInstructions('mentions enrichment_scope checklist')).toBe(true);
  });

  test('flags lone clad_create_feature MCP tool wording', () => {
    expect(
      isStaleInstructions('Use `clad_create_feature` MCP tool to add features.'),
    ).toBe(true);
    expect(
      isStaleInstructions('Use `clad_create_feature` MCP\n  tool to add features.'),
    ).toBe(true);
  });

  test('does not flag the current emitted surfaces (no re-sync churn)', () => {
    expect(isStaleInstructions(renderAgentsMdManagedBlock(null))).toBe(false);
    expect(isStaleInstructions(CLAUDE_MD_SECTION)).toBe(false);
  });

  test('flags a cladding-authored block that predates the feature-cycle cadence', () => {
    // Carries the anti-self-cert signature (so it is recognizably cladding's
    // output) but lacks the v0.4.x feature-cycle rule → must re-sync.
    const preCadence = [
      '## cladding',
      '',
      '**Persona separation** — the agent that authors must not sign off on',
      'its own work (anti-self-cert invariant).',
      '',
    ].join('\n');
    expect(isStaleInstructions(preCadence)).toBe(true);
  });

  test('both emitted surfaces carry the feature-cycle cadence marker', () => {
    expect(renderAgentsMdManagedBlock(null)).toContain('Feature cycle — one at a time');
    expect(CLAUDE_MD_SECTION).toContain('Feature cycle — one at a time');
  });

  test('does not flag arbitrary user prose', () => {
    expect(isStaleInstructions('# My notes\n\nNothing about cladding here.')).toBe(false);
  });
});
