// Cladding · F-6349870d — the managed AGENTS.md block tells a schema 0.2
// adopter how a test claims a criterion.
//
// A schema 0.2 workspace binds a test to a criterion ONLY through a covers
// token at the very start of the test title. None of the surfaces an adopting
// host reads said so, so a host with no outside instruction could not discover
// the rule. These tests hold the new 0.2 guidance in place, and hold the 0.1
// guidance byte-still against a pinned copy of the pre-feature render — the
// regression that would otherwise churn every existing adopter.
//
// Covers:
//   AC-6a6386a3 — the 0.2 block states the title-token rule and the kind +
//                 strict statement shape of a criterion.
//   AC-147722e1 — the 0.1 block is byte-identical to the pinned pre-feature
//                 render, for a full-hints spec, a bare spec, and no spec.

import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {renderAgentsMdManagedBlock, writeSpecDrivenAgentsMd, AGENTS_MD_BEGIN} from '../../src/init/agents-md.js';
import {isStaleInstructions} from '../../src/init/host-instructions.js';
import {loadSpec} from '../../src/spec/load.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const pinned = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** The same schema 0.1 inputs the pins were rendered from (tests/init/agents-md.test.ts). */
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
const BARE_SPEC = ['schema: "0.1"', 'project:', '  name: bare-project', '  language: typescript', 'features: []', ''].join('\n');
const SCHEMA_02_SPEC = [
  'schema: "0.2"',
  'project:',
  '  name: binding-fixture',
  '  language: typescript',
  '  purpose: Tell an adopting host how a test claims a criterion.',
  '  assurance_level: L1',
  '',
].join('\n');

/** Recreates the exact fixture the pins were rendered under: docs present. */
function workspace(dir: string, spec: string): void {
  writeFileSync(join(dir, 'spec.yaml'), spec);
  mkdirSync(join(dir, 'docs'), {recursive: true});
  writeFileSync(join(dir, 'docs', 'project-context.md'), 'x');
  writeFileSync(join(dir, 'docs', 'conventions.md'), 'x');
}

describe('AC-6a6386a3 · the schema 0.2 managed block carries the binding rule', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-02-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-6349870d/AC-6a6386a3] the block states that a test title starts with the covers token', () => {
    workspace(dir, SCHEMA_02_SPEC);
    const block = renderAgentsMdManagedBlock(null, dir, '0.2');
    expect(block).toContain('[covers:<feature id>/<criterion id>]');
    expect(block).toContain('a `describe()` title is never read');
    // The rule has to say the token OPENS the title, not merely appears in it.
    expect(block).toMatch(/STARTING\s+the test title|STARTING its title/);
  });

  test('[covers:F-6349870d/AC-6a6386a3] the block states that a criterion carries a kind and a strict statement', () => {
    workspace(dir, SCHEMA_02_SPEC);
    const block = renderAgentsMdManagedBlock(null, dir, '0.2');
    expect(block).toContain('`behavior`, `quality`, or `constraint`');
    expect(block).toContain('exactly one **shall**');
    // The 0.1 EARS table teaches fields schema 0.2 refuses — it must be gone.
    expect(block).not.toContain('| `ubiquitous` |');
    expect(block).not.toContain('`test_refs` are accepted');
  });

  test('[covers:F-6349870d/AC-6a6386a3] the language section teaches a strict statement, not the EARS condition it replaced', () => {
    workspace(dir, SCHEMA_02_SPEC);
    const block = renderAgentsMdManagedBlock(null, dir, '0.2');
    expect(block).toContain('statement: When the upload completes, the system shall notify the author.');
    expect(block).not.toContain('condition: "when the app exits"');
  });

  test('[covers:F-6349870d/AC-6a6386a3] the 0.2 block keeps both freshness signatures, so `clad update` does not read it as stale', () => {
    workspace(dir, SCHEMA_02_SPEC);
    const block = renderAgentsMdManagedBlock(null, dir, '0.2');
    expect(block).toContain('Feature cycle — one at a time');
    expect(block).toContain('anti-self-cert');
    expect(isStaleInstructions(block)).toBe(false);
  });

  test('[covers:F-6349870d/AC-6a6386a3] a written AGENTS.md in a schema 0.2 workspace carries the rule even when the spec cannot be loaded', () => {
    // A 0.2 workspace with no compiler inputs yields a null spec; the schema
    // comes from the root declaration, so the writer must not fall back to 0.1.
    writeFileSync(join(dir, 'spec.yaml'), SCHEMA_02_SPEC);
    expect(writeSpecDrivenAgentsMd(dir)).toBe('created');
    const body = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(body).toContain(AGENTS_MD_BEGIN);
    expect(body).toContain('[covers:<feature id>/<criterion id>]');
  });
});

describe('AC-147722e1 · the schema 0.1 managed block is byte-identical to its pinned pre-feature render', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-agentsmd-01-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-6349870d/AC-147722e1] a full ai_hints schema 0.1 spec renders the pinned block', () => {
    workspace(dir, FULL_HINTS_SPEC);
    expect(`${renderAgentsMdManagedBlock(loadSpec(dir), dir)}\n`).toBe(pinned('agents-md-block-0.1-full-hints.pinned.md'));
  });

  test('[covers:F-6349870d/AC-147722e1] a bare schema 0.1 spec renders the pinned block', () => {
    workspace(dir, BARE_SPEC);
    expect(`${renderAgentsMdManagedBlock(loadSpec(dir), dir)}\n`).toBe(pinned('agents-md-block-0.1-bare.pinned.md'));
  });

  test('[covers:F-6349870d/AC-147722e1] the degraded (no spec) render is the pinned block', () => {
    expect(`${renderAgentsMdManagedBlock(null, dir)}\n`).toBe(pinned('agents-md-block-0.1-null-spec.pinned.md'));
  });
});
