// Cladding · unit tests for src/init/host-instructions.ts (F-90d054)
//
// Covers AC-008 (AGENTS.md written), AC-009 (CLAUDE.md created when absent),
// and AC-010 (CLAUDE.md `## cladding` section appended idempotently when
// present).

import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  AGENTS_MD_TEMPLATE,
  CLAUDE_MD_SECTION,
  CLAUDE_MD_SECTION_MARKER,
  writeAgentsMd,
  writeClaudeMdSection,
} from '../../src/init/host-instructions.js';

describe('writeAgentsMd (F-90d054 AC-008)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-host-instr-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('creates AGENTS.md when absent', () => {
    const r = writeAgentsMd(dir);
    expect(r).toBe('created');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_TEMPLATE);
  });

  test('skips when AGENTS.md already exists (no --force)', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# user-authored\n');
    const r = writeAgentsMd(dir);
    expect(r).toBe('skipped-exists');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# user-authored\n');
  });

  test('overwrites when --force', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# user-authored\n');
    const r = writeAgentsMd(dir, {force: true});
    expect(r).toBe('overwritten');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_TEMPLATE);
  });

  test('template contains the enrichment first-task rule', () => {
    expect(AGENTS_MD_TEMPLATE).toContain('enrichment_status');
    expect(AGENTS_MD_TEMPLATE).toContain('first-task');
  });
});

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
});
