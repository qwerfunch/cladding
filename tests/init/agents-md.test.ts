// Cladding · unit tests for src/init/agents-md.ts (F-a4085adf, issue #199)
//
// Covers the 5 ACs of spec/features/spec-driven-agents-md-a4085adf.yaml:
//   AC-7e1a9c04 — renders ai_hints (test framework, branch, forbidden/preferred
//                 patterns, preferred persona) into the managed block.
//   AC-2c8b5f61 — re-emission regenerates ONLY the marker-delimited block,
//                 preserves surrounding user prose, and is byte-stable when
//                 the spec is unchanged.
//   AC-9d3f2e88 — the block always carries the persona → capabilities map
//                 (cross-host: Codex/Gemini/other AGENTS.md readers).
//   AC-4b6c1a97 — no spec / no ai_hints degrades to the generic block, never
//                 throws.
//   AC-1f8d7b02 — an existing markerless (hand-authored) AGENTS.md — e.g.
//                 cladding's own root AGENTS.md — is left byte-for-byte
//                 untouched. Load-bearing safety AC.

import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  renderAgentsMdManagedBlock,
  upsertAgentsMdBlock,
  writeSpecDrivenAgentsMd,
} from '../../src/init/agents-md.js';
import {loadSpec} from '../../src/spec/load.js';
import {checkEarsShape} from '../../src/spec/ears.js';
import type {EarsPattern} from '../../src/spec/types.js';

/** A spec.yaml with a fully-populated project.ai_hints, matching the shard's
 * own notes fixture (acme-payments) so assertions read naturally. */
const FULL_HINTS_SPEC = [
  'schema: "0.1"',
  'project:',
  '  name: acme-payments',
  '  language: typescript',
  '  intent_summary: PCI-safe payment orchestration for small merchants.',
  '  ai_hints:',
  '    test_framework: jest',
  '    primary_branch: trunk',
  '    preferred_persona: developer',
  '    forbidden_patterns:',
  '      - child_process',
  '      - "eval("',
  '    preferred_patterns:',
  '      - when: handling money amounts',
  '        prefer: integer minor units (cents)',
  '        over: floating-point dollars',
  '      - when: a new HTTP handler',
  '        prefer: zod-validated request bodies',
  'features: []',
  '',
].join('\n');

/** Minimal valid spec — project present, no ai_hints at all. */
const NO_HINTS_SPEC = ['schema: "0.1"', 'project:', '  name: bare-project', '  language: typescript', 'features: []', ''].join(
  '\n',
);

describe('renderAgentsMdManagedBlock — AC-7e1a9c04 (spec-driven conventions)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-render-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-a4085adf/AC-7e1a9c04] renders test_framework, primary_branch, forbidden_patterns, preferred_patterns, preferred_persona', () => {
    writeFileSync(join(dir, 'spec.yaml'), FULL_HINTS_SPEC);
    const spec = loadSpec(dir);
    const block = renderAgentsMdManagedBlock(spec, dir);

    // Project identity.
    expect(block).toContain('acme-payments');
    expect(block).toContain('PCI-safe payment orchestration for small merchants.');

    // test_framework
    expect(block).toContain('**jest**');

    // primary_branch
    expect(block).toContain('**trunk**');

    // forbidden_patterns — backtick-wrapped identifiers
    expect(block).toContain('`child_process`');
    expect(block).toContain('`eval(`');

    // preferred_patterns — {when, prefer, over} triples
    expect(block).toContain('handling money amounts → prefer integer minor units (cents) over floating-point dollars.');
    expect(block).toContain('a new HTTP handler → prefer zod-validated request bodies.');

    // preferred_persona
    expect(block).toContain('The default persona for this project is **developer**.');

    // Managed markers frame the whole block source (writer wraps these on).
    expect(block).not.toContain(AGENTS_MD_BEGIN); // markers added by the writer, not the renderer
    expect(block).not.toContain(AGENTS_MD_END);
    // preferred_patterns with NO `over` (optional field) still renders cleanly
    // — the second triple in the fixture omits `over`.
    expect(block).not.toContain('zod-validated request bodies over');
  });
});

describe('renderAgentsMdManagedBlock — AC-9d3f2e88 (cross-host persona map)', () => {
  test('[covers:F-a4085adf/AC-9d3f2e88] always includes the persona → capabilities map, regardless of spec', () => {
    const withSpecBlock = renderAgentsMdManagedBlock(
      {
        schema: '0.1',
        project: {name: 'x', language: 'typescript'},
        features: [],
      } as never,
      '.',
    );
    const withoutSpecBlock = renderAgentsMdManagedBlock(null, '.');

    for (const block of [withSpecBlock, withoutSpecBlock]) {
      expect(block).toContain('## Personas — cross-host capability map');
      expect(block).toContain('- planner — read, write, edit, exec');
      expect(block).toContain('- developer — read, write, edit, exec');
      expect(block).toContain('- reviewer — read, exec');
      expect(block).toContain('- blind-author — write, exec');
      expect(block).toContain('- observability — read, exec');
      expect(block).toContain('- orchestrator — read, write, edit, exec, dispatch');
      // Anti-self-cert framing must accompany the map (the "why" for #199's
      // cross-host ask — non-Claude hosts get the same governance rule).
      expect(block).toContain('must not sign off on it');
    }
  });
});

describe('renderAgentsMdManagedBlock — AC-9255e821 (personas are not an exclusivity roster)', () => {
  test('[covers:F-9d8ece66/AC-9255e821] states the briefs are touchpoint manuals, not a roster of permitted agents, and ties identity only to the independence label', () => {
    const withSpecBlock = renderAgentsMdManagedBlock(
      {
        schema: '0.1',
        project: {name: 'x', language: 'typescript'},
        features: [],
      } as never,
      '.',
    );
    const withoutSpecBlock = renderAgentsMdManagedBlock(null, '.');

    for (const block of [withSpecBlock, withoutSpecBlock]) {
      expect(block).toContain('not a roster of permitted agents');
      expect(block).toContain('independence label');
    }
  });
});

describe('renderAgentsMdManagedBlock — post-init command integrity', () => {
  test('[covers:F-0f4dd6/AC-022] pins shell commands to the project engine and requires non-vacuous portable tests', () => {
    const block = renderAgentsMdManagedBlock(null, '.');

    expect(block).toContain('node .cladding/host/serve.cjs <arguments>');
    expect(block).toContain('same engine as MCP');
    expect(block).toContain('confirm it collected relevant tests');
    expect(block).toContain('must not depend on shell-expanded glob patterns');
  });
});

describe('renderAgentsMdManagedBlock — AC-4b6c1a97 (graceful degrade, never throws)', () => {
  test('[covers:F-a4085adf/AC-4b6c1a97] null spec renders the generic block without throwing', () => {
    expect(() => renderAgentsMdManagedBlock(null, '.')).not.toThrow();
    const block = renderAgentsMdManagedBlock(null, '.');
    expect(block).toContain('## What this project is');
    expect(block).not.toContain("This project's conventions");
    // Still spec-independent baseline content.
    expect(block).toContain('Single source of truth');
    expect(block).toContain('## Personas — cross-host capability map');
  });

  test('spec present but project.ai_hints absent degrades to the generic conventions (no section)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-nohints-'));
    try {
      writeFileSync(join(dir, 'spec.yaml'), NO_HINTS_SPEC);
      const spec = loadSpec(dir);
      expect(() => renderAgentsMdManagedBlock(spec, dir)).not.toThrow();
      const block = renderAgentsMdManagedBlock(spec, dir);
      expect(block).toContain('bare-project'); // project identity still renders
      expect(block).not.toContain("This project's conventions");
      expect(block).not.toContain('The default persona for this project is'); // no preferred_persona
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('writeSpecDrivenAgentsMd never throws when spec.yaml is entirely absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-nospec-'));
    try {
      expect(() => writeSpecDrivenAgentsMd(dir)).not.toThrow();
      const r = writeSpecDrivenAgentsMd(dir);
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
      const body = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
      expect(body).toContain(AGENTS_MD_BEGIN);
      expect(body).toContain(AGENTS_MD_END);
      expect(body).toContain('## Personas — cross-host capability map');
      expect(body).not.toContain("This project's conventions");
      // Second call with the still-absent spec is idempotent, not an error.
      expect(r === 'created' || r === 'unchanged').toBe(true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('writeSpecDrivenAgentsMd — AC-2c8b5f61 (marker upsert: prose-preserving, byte-stable)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-upsert-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('creates a fresh file framed by markers when AGENTS.md is absent', () => {
    writeFileSync(join(dir, 'spec.yaml'), FULL_HINTS_SPEC);
    const r = writeSpecDrivenAgentsMd(dir);
    expect(r).toBe('created');
    const body = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(body).toContain(AGENTS_MD_BEGIN);
    expect(body).toContain(AGENTS_MD_END);
    expect(body).toContain('**jest**');
  });

  test('second call with an unchanged spec is byte-stable ("unchanged", no rewrite)', () => {
    writeFileSync(join(dir, 'spec.yaml'), FULL_HINTS_SPEC);
    writeSpecDrivenAgentsMd(dir);
    const before = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const r2 = writeSpecDrivenAgentsMd(dir);
    expect(r2).toBe('unchanged');
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(after).toBe(before); // byte-stable
  });

  test('[covers:F-a4085adf/AC-2c8b5f61] preserves user prose added outside the markers across re-emission', () => {
    writeFileSync(join(dir, 'spec.yaml'), FULL_HINTS_SPEC);
    writeSpecDrivenAgentsMd(dir);
    const original = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

    // Splice in user-authored prose above the frame header and below the
    // closing marker — this is what an adopter would hand-write.
    const withProse = [
      '# My Custom Title',
      '',
      'Some hand-written notes about deploy secrets that must survive.',
      '',
      original,
      '',
      '## My other notes',
      '',
      'Should also survive re-emission.',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'AGENTS.md'), withProse);

    // Re-run with the SAME spec — block content is unchanged, so the whole
    // file (including the spliced-in prose) must be byte-stable.
    const rSame = writeSpecDrivenAgentsMd(dir);
    expect(rSame).toBe('unchanged');
    const afterSame = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(afterSame).toBe(withProse);
    expect(afterSame).toContain('My Custom Title');
    expect(afterSame).toContain('Some hand-written notes about deploy secrets that must survive.');
    expect(afterSame).toContain('My other notes');
    expect(afterSame).toContain('Should also survive re-emission.');

    // Now change the spec (test_framework jest → mocha) and re-run: only the
    // delimited block should regenerate — prose survives, block updates.
    writeFileSync(join(dir, 'spec.yaml'), FULL_HINTS_SPEC.replace('test_framework: jest', 'test_framework: mocha'));
    const rChanged = writeSpecDrivenAgentsMd(dir);
    expect(rChanged).toBe('updated');
    const afterChanged = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

    // Prose outside the markers survived verbatim.
    expect(afterChanged).toContain('My Custom Title');
    expect(afterChanged).toContain('Some hand-written notes about deploy secrets that must survive.');
    expect(afterChanged).toContain('My other notes');
    expect(afterChanged).toContain('Should also survive re-emission.');

    // The managed block itself reflects the new spec value.
    expect(afterChanged).toContain('**mocha**');
    // Only ONE managed-block pair exists — no marker duplication.
    expect(afterChanged.split(AGENTS_MD_BEGIN).length - 1).toBe(1);
    expect(afterChanged.split(AGENTS_MD_END).length - 1).toBe(1);
  });
});

describe('writeSpecDrivenAgentsMd — AC-1f8d7b02 (markerless / hand-authored file untouched)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-markerless-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-a4085adf/AC-1f8d7b02] an existing AGENTS.md with no clad markers is left byte-for-byte untouched', () => {
    writeFileSync(join(dir, 'spec.yaml'), FULL_HINTS_SPEC);
    const handAuthored = [
      '# AGENTS.md',
      '',
      'This project is hand-maintained. It has its own conventions and its',
      'own drift-detector count that must never be regenerated by a tool.',
      '',
      '41 drift detectors, 15 Iron Law stages.',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'AGENTS.md'), handAuthored);

    const r = writeSpecDrivenAgentsMd(dir);
    expect(r).toBe('skipped-unmanaged');

    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(after).toBe(handAuthored); // byte-for-byte identical
  });

  test('upsertAgentsMdBlock is a pure no-op on markerless/malformed input', () => {
    const markerless = '# My notes\n\nNothing about cladding here.\n';
    expect(upsertAgentsMdBlock(markerless, 'fresh block')).toBe(markerless);

    // Malformed: end marker present but begin absent (or reversed order).
    const malformed = `some text ${AGENTS_MD_END} more text ${AGENTS_MD_BEGIN} tail`;
    expect(upsertAgentsMdBlock(malformed, 'fresh block')).toBe(malformed);
  });
});

describe('the managed block teaches EARS, and cannot drift from the validator', () => {
  test('every example in the EARS table actually passes checkEarsShape', () => {
    // The adopter receives no docs/ — package.json#files ships none — so this
    // table is the only place an authoring agent can learn the rules. Two of
    // three agents in an A/B run reverse-engineered them from the minified
    // bundle instead. A table that drifts from the validator is worse than
    // none, so it is checked against the validator rather than eyeballed.
    const block = renderAgentsMdManagedBlock(null, '.');
    const rows = block
      .split('\n')
      .filter((l) => /^\| `(ubiquitous|event|state|optional|unwanted|complex)` \|/.test(l));
    expect(rows.length, 'the EARS table is missing from the managed block').toBe(6);

    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      const pattern = cells[1].replace(/`/g, '') as EarsPattern;
      const example = cells[3].replace(/`/g, '').replace(/\*\(none\)\*/, '').trim();
      expect(checkEarsShape(pattern, example), `${pattern}: "${example}"`).toBeNull();
    }
  });

  test('the table covers every pattern the schema accepts', () => {
    const block = renderAgentsMdManagedBlock(null, '.');
    for (const pattern of ['ubiquitous', 'event', 'state', 'optional', 'unwanted', 'complex']) {
      expect(block, `${pattern} is missing from the EARS table`).toContain(`| \`${pattern}\` |`);
    }
  });
});

describe('the managed block says what language a spec entry is written in', () => {
  // No rule existed, so adopters diverged: two repositories reached ~100%
  // Korean titles while two others stayed fully English. The rule lives here
  // rather than in the CLAUDE.md block (21 characters of headroom against a
  // pinned ceiling) or a persona prompt (3 characters, and it only reaches
  // hosts that install the plugin).
  const block = () => renderAgentsMdManagedBlock(null, '.');

  test('it states the default, and that existing entries decide instead', () => {
    expect(block()).toContain('Default to English');
    expect(block()).toMatch(/match the language THEY use/);
    expect(block()).toMatch(/Where they disagree, write English/);
  });

  test('a language request covers the prose fields and carries forward on its own', () => {
    const b = block();
    expect(b).toMatch(/asks for another language/);
    for (const field of ['`title`', '`notes`', '`text`']) expect(b).toContain(field);
    expect(b).toMatch(/carries forward/);
  });

  test('it forbids rewriting existing entries into another language', () => {
    expect(block()).toMatch(/never rewrite existing ones/);
  });

  test('the four trigger words are named as fixed, and only the first word is constrained', () => {
    const b = block();
    for (const w of ['when', 'while', 'if', 'where']) expect(b).toContain(`**${w}**`);
    expect(b).toMatch(/Only the FIRST word/);
  });

  test('it shows a mixed condition, so "English trigger" is not read as "English sentence"', () => {
    // The whole point of naming only four words: everything after them is free.
    // A reader who cannot see that will over-translate or under-translate.
    const example = block().split('\n').find((l) => l.includes('condition:') && /[가-힣]/.test(l));
    expect(example, 'no mixed-language condition example in the block').toBeDefined();
    expect(example).toMatch(/^\s*condition: "when /m);
  });

  test('identifiers are excluded from translation', () => {
    expect(block()).toMatch(/Identifiers are not prose/);
  });
});
