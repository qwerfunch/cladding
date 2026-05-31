// Cladding · the /cladding:next in-session driver skill ships, and its
// host mirrors stay byte-in-sync with the canonical source.
//
// Why: `next` is the per-feature driver — the execution structure that turns
// the cadence from advice into a rail. It is a PROMPT artifact, so the test it
// can carry is structural: the canonical skill states the one-feature cycle
// (ending at `clad done`, naming the PLANNED_BACKLOG floor), and the generated
// Claude Code slash command + Codex skill are verbatim copies — so an edit that
// forgets `npm run build:plugin` fails the gate instead of shipping drift.

import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';

const SKILL = 'skills/next/SKILL.md';
const CLAUDE_CMD = 'plugins/claude-code/commands/next.md';
const CODEX_SKILL = 'plugins/codex/skills/next/SKILL.md';
const read = (p: string): string => readFileSync(p, 'utf8');

describe('/cladding:next driver skill', () => {
  test('canonical skill states the gated one-feature cycle', () => {
    const body = read(SKILL);
    expect(body).toMatch(/^---[\s\S]*?description:/);
    expect(body).toContain('one feature, end-to-end');
    expect(body).toContain('clad done'); // routes done through the gated verb, not a hand flip
    expect(body).toContain('PLANNED_BACKLOG'); // names the cadence floor
    expect(body).toContain('One feature per invocation');
  });

  test('Claude Code slash command is generated verbatim (build:plugin in sync)', () => {
    expect(existsSync(CLAUDE_CMD)).toBe(true);
    expect(read(CLAUDE_CMD)).toBe(read(SKILL));
  });

  test('Codex skill mirror is generated verbatim (build:plugin in sync)', () => {
    expect(existsSync(CODEX_SKILL)).toBe(true);
    expect(read(CODEX_SKILL)).toBe(read(SKILL));
  });
});
