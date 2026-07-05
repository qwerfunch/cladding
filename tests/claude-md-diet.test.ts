// Cladding · CLAUDE.md template diet pins (F-288864ae)
//
// The emitted `## cladding` section (CLAUDE_MD_SECTION) was shrunk ~30% (1404
// -> 972 bytes) by cutting redundant phrasing while keeping the five policy
// anchors. These pins guard the three ways that diet could silently regress
// later: (1) either freshness literal disappearing from the template — every
// fresh `clad init`/`clad update` would then self-flag as stale and churn
// forever (AC-b07dce5d); (2) one of the five policy anchors the AC names
// getting cut along with the redundant prose (AC-9bea7d88); (3) the section
// silently regrowing past the diet with nothing to catch it. AC-a684ae50
// (round trip) and AC-26e087d1 (repo dogfood) are pinned directly against the
// real module / the repo's own CLAUDE.md, not a fixture.
//
// tests/init/host-instructions.test.ts owns the general
// writeAgentsMd/writeClaudeMdSection/isStaleInstructions behavior; this file
// owns the diet-specific content and regression guards.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {AGENTS_MD_TEMPLATE, CLAUDE_MD_SECTION, isStaleInstructions} from '../src/init/host-instructions.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('AC-b07dce5d · both freshness literals survive verbatim in the emitted template', () => {
  test('CLAUDE_MD_SECTION contains the anti-self-cert signature literal', () => {
    expect(CLAUDE_MD_SECTION).toContain('anti-self-cert');
  });

  test('CLAUDE_MD_SECTION contains the "Feature cycle — one at a time" fresh marker (em dash)', () => {
    expect(CLAUDE_MD_SECTION).toContain('Feature cycle — one at a time');
  });

  // Symmetric pin: AGENTS_MD_TEMPLATE is out of scope for the diet but carries
  // the same signature literal today (checked directly, not assumed) — if a
  // future edit drops it there too, isStaleInstructions would misjudge a
  // cladding-authored AGENTS.md as arbitrary user prose and never re-sync it.
  test('AGENTS_MD_TEMPLATE also carries the anti-self-cert signature literal', () => {
    expect(AGENTS_MD_TEMPLATE).toContain('anti-self-cert');
  });
});

describe('AC-9bea7d88 · the five policy anchors survive the diet, load-bearing substrings pinned', () => {
  test('anchor 1 — spec is SSoT + the gate-verify sentence', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Spec is SSoT**');
    expect(CLAUDE_MD_SECTION).toContain('Run `clad check --strict` before commit.');
  });

  test('anchor 2 — anti-self-cert (persona separation)', () => {
    expect(CLAUDE_MD_SECTION).toContain('(anti-self-cert)');
  });

  test('anchor 3 — one-feature-at-a-time with done-via-gate', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Feature cycle — one at a time**');
    expect(CLAUDE_MD_SECTION).toContain('clad done <featureId>');
    expect(CLAUDE_MD_SECTION).toContain('is GREEN');
  });

  test('anchor 4 — hash-based IDs rule + pointer', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Hash-based IDs**');
    expect(CLAUDE_MD_SECTION).toContain('docs/spec-ids-multi-dev.md');
  });

  test('anchor 5 — drift detectors', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Drift detectors**');
  });

  test('size regression guard — cannot silently regrow past the diet ceiling', () => {
    // Measured in BYTES (not .length/UTF-16 code units) because the AC's own
    // "~430 bytes / ~30%" claim is a byte count, and this template's em
    // dashes/arrows cost more bytes than code units. Today (post-diet): 972
    // bytes. Pre-diet: 1404 bytes. The ceiling sits comfortably above the
    // diet result but well under the pre-diet size, so a future re-bloat
    // trips this before it ships.
    const bytes = Buffer.byteLength(CLAUDE_MD_SECTION, 'utf8');
    expect(bytes).toBeLessThan(1100);
  });
});

describe('AC-a684ae50 · round trip holds in both directions', () => {
  test('a freshly emitted section is NOT stale (no churn)', () => {
    expect(isStaleInstructions(CLAUDE_MD_SECTION)).toBe(false);
  });

  test('a genuinely-legacy section (pre-feature-cycle-cadence) still reads stale', () => {
    // Mirrors tests/init/host-instructions.test.ts's pre-cadence fixture:
    // carries the anti-self-cert signature (recognizably cladding-authored)
    // but predates the feature-cycle cadence rule -> must still upgrade.
    const preCadence = [
      '## cladding',
      '',
      '**Persona separation** — the agent that authors must not sign off on',
      'its own work (anti-self-cert invariant).',
      '',
    ].join('\n');
    expect(isStaleInstructions(preCadence)).toBe(true);
  });
});

describe('AC-26e087d1 · the repo dogfoods its own emission', () => {
  test("this repo's own CLAUDE.md contains CLAUDE_MD_SECTION verbatim", () => {
    expect(read('CLAUDE.md')).toContain(CLAUDE_MD_SECTION);
  });
});
