// Cladding — "shard" stays out of the AI-facing surfaces (say "spec entry").
//
// The AI mirrors whatever term it reads in the surfaces it consumes while
// serving a user: the persona prompts, and the managed AGENTS.md / CLAUDE.md
// blocks cladding writes into the project. 0.9.1 kept "shard" in those and bet
// the AI would translate it to "spec entry" at relay time; a live test showed
// the AI mirrors "shard" verbatim instead. This guard keeps exactly those
// surfaces shard-free so the leak can't creep back into them.
//
// "shard" is still fine in code, identifiers, --json machine messages, and
// maintainer docs — this only fences the AI-/user-facing prose.

import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, test} from 'vitest';

const {renderAgentsMdManagedBlock} = await import('../src/init/agents-md.js');
const {CLAUDE_MD_SECTION} = await import('../src/init/host-instructions.js');

const SHARD = /\bshards?\b/i;
const agentsDir = fileURLToPath(new URL('../src/agents/', import.meta.url));

describe('AI-facing surfaces stay shard-free — say "spec entry"', () => {
  test('the generated AGENTS.md managed block has no "shard"', () => {
    const block = renderAgentsMdManagedBlock(null);
    expect(block, 'AGENTS.md managed block must say "spec entry", never "shard"').not.toMatch(SHARD);
  });

  test('the generated CLAUDE.md `## cladding` section has no "shard"', () => {
    expect(CLAUDE_MD_SECTION, 'CLAUDE.md section must say "spec entry", never "shard"').not.toMatch(SHARD);
  });

  test('every persona prompt has no "shard"', () => {
    const personas = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    expect(personas.length).toBeGreaterThan(0);
    for (const file of personas) {
      const body = readFileSync(join(agentsDir, file), 'utf8');
      expect(body, `src/agents/${file} must say "spec entry", never "shard"`).not.toMatch(SHARD);
    }
  });
});
