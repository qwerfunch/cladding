// Cladding · F-6349870d — the managed CLAUDE.md section names the title token
// on a schema 0.2 workspace.
//
// The `## cladding` section is the first instruction a Claude host reads in an
// adopting project. On schema 0.2 the only way a test claims a criterion is the
// covers token that opens the test title, so the feature-cycle paragraph has to
// say it. Schema 0.1 keeps the section it has always had, byte for byte.
//
// Covers:
//   AC-4eb00621 — the 0.2 section names the title token in the feature cycle,
//                 and this repository (a 0.2 workspace) dogfoods that render.
//   AC-147722e1 — the 0.1 section is byte-identical to its pinned pre-feature
//                 copy, and a 0.1 workspace is written that section.

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  CLAUDE_MD_SECTION,
  claudeMdSectionFor,
  isStaleInstructions,
  writeClaudeMdSection,
} from '../../src/init/host-instructions.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PINNED_01 = readFileSync(join(FIXTURES, 'claude-md-section-0.1.pinned.md'), 'utf8');
const REPO_CLAUDE_MD = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');

const SPEC = (schema: string): string => [
  `schema: "${schema}"`,
  'project:',
  '  name: binding-fixture',
  '  language: typescript',
  '  purpose: Tell an adopting host how a test claims a criterion.',
  '  assurance_level: L1',
  'features: []',
  '',
].join('\n');

describe('AC-4eb00621 · the schema 0.2 CLAUDE.md section names the title token', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-claudemd-02-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-6349870d/AC-4eb00621] the feature cycle paragraph names the token as how a test claims a criterion', () => {
    const section = claudeMdSectionFor('0.2');
    expect(section).toContain('A test claims a criterion by');
    expect(section).toContain('[covers:F-…/AC-…]');
    expect(section).toContain('`test_refs` are not accepted on');
    // The sentence belongs to the feature-cycle paragraph, not a new section.
    const cycle = section.slice(section.indexOf('**Feature cycle'), section.indexOf('**Hash-based IDs**'));
    expect(cycle).toContain('[covers:F-…/AC-…]');
  });

  test('[covers:F-6349870d/AC-4eb00621] a schema 0.2 workspace is written the 0.2 section', () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC('0.2'));
    expect(writeClaudeMdSection(dir)).toBe('created');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(claudeMdSectionFor('0.2'));
  });

  test('[covers:F-6349870d/AC-4eb00621] the 0.2 section stays fresh to `clad update` and keeps every policy anchor', () => {
    const section = claudeMdSectionFor('0.2');
    expect(isStaleInstructions(section)).toBe(false);
    for (const anchor of ['**Spec is SSoT**', '(anti-self-cert)', '**Feature cycle — one at a time**', '**Hash-based IDs**', '**Drift detectors**', "**Speak the user's language**"]) {
      expect(section).toContain(anchor);
    }
  });

  test('[covers:F-6349870d/AC-4eb00621] a workspace that migrated to schema 0.2 is refreshed off its schema 0.1 section', () => {
    // The section a migrated adopter carries is stale by no marker, yet it
    // teaches the binding this schema refuses. `clad update` must replace it.
    expect(isStaleInstructions(CLAUDE_MD_SECTION, '0.2')).toBe(true);
    writeFileSync(join(dir, 'spec.yaml'), SPEC('0.2'));
    writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD_SECTION);
    expect(writeClaudeMdSection(dir)).toBe('refreshed-stale');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('[covers:F-…/AC-…]');
  });

  test("[covers:F-6349870d/AC-4eb00621] this repository's own CLAUDE.md carries the 0.2 section (dogfood)", () => {
    expect(REPO_CLAUDE_MD).toContain(claudeMdSectionFor('0.2'));
  });
});

describe('AC-147722e1 · the schema 0.1 CLAUDE.md section is byte-identical to its pinned copy', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-claudemd-01-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-6349870d/AC-147722e1] the exported section equals the pre-feature pin', () => {
    expect(CLAUDE_MD_SECTION).toBe(PINNED_01);
    expect(claudeMdSectionFor('0.1')).toBe(PINNED_01);
  });

  test('[covers:F-6349870d/AC-147722e1] the schema 0.1 staleness verdict is unchanged by the 0.2 rule', () => {
    expect(isStaleInstructions(CLAUDE_MD_SECTION)).toBe(false);
    expect(isStaleInstructions(CLAUDE_MD_SECTION, '0.1')).toBe(false);
    writeFileSync(join(dir, 'spec.yaml'), SPEC('0.1'));
    writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD_SECTION);
    expect(writeClaudeMdSection(dir)).toBe('unchanged');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(PINNED_01);
  });

  test('[covers:F-6349870d/AC-147722e1] a schema 0.1 workspace is written the pinned section', () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC('0.1'));
    expect(writeClaudeMdSection(dir)).toBe('created');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(PINNED_01);
  });

  test('[covers:F-6349870d/AC-147722e1] a directory with no readable spec keeps the schema 0.1 section', () => {
    expect(writeClaudeMdSection(dir)).toBe('created');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(PINNED_01);
  });
});
