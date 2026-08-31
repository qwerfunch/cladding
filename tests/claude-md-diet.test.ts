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

import {CLAUDE_MD_SECTION, isStaleInstructions} from '../src/init/host-instructions.js';
import {renderAgentsMdManagedBlock} from '../src/init/agents-md.js';

const AGENTS_MD_BLOCK = renderAgentsMdManagedBlock(null);

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('AC-b07dce5d · both freshness literals survive verbatim in the emitted template', () => {
  test("[covers:F-288864ae/AC-b07dce5d] CLAUDE_MD_SECTION contains the anti-self-cert signature literal", () => {
    expect(CLAUDE_MD_SECTION).toContain('anti-self-cert');
  });

  test('CLAUDE_MD_SECTION contains the "Feature cycle — one at a time" fresh marker (em dash)', () => {
    expect(CLAUDE_MD_SECTION).toContain('Feature cycle — one at a time');
  });

  // Symmetric pin: the spec-driven AGENTS.md managed block is out of scope for
  // the diet but carries the same signature literal today (checked directly,
  // not assumed) — the anti-self-cert wording is the cross-host freshness
  // signature shared by both instruction surfaces.
  test('the AGENTS.md managed block also carries the anti-self-cert signature literal', () => {
    expect(AGENTS_MD_BLOCK).toContain('anti-self-cert');
  });
});

describe('AC-9bea7d88 · the five policy anchors survive the diet, load-bearing substrings pinned', () => {
  test('[covers:F-288864ae/AC-9bea7d88] anchor 1 — spec is SSoT + the gate-verify sentence', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Spec is SSoT**');
    expect(CLAUDE_MD_SECTION).toContain('Run `clad check --strict` before commit.');
  });

  test('[covers:F-288864ae/AC-9bea7d88] anchor 2 — anti-self-cert (persona separation)', () => {
    expect(CLAUDE_MD_SECTION).toContain('(anti-self-cert)');
  });

  test('[covers:F-288864ae/AC-9bea7d88] anchor 3 — one-feature-at-a-time with done-via-gate', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Feature cycle — one at a time**');
    expect(CLAUDE_MD_SECTION).toContain('clad done <featureId>');
    expect(CLAUDE_MD_SECTION).toContain('is GREEN');
  });

  test('[covers:F-288864ae/AC-9bea7d88] anchor 4 — hash-based IDs rule + pointer', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Hash-based IDs**');
    expect(CLAUDE_MD_SECTION).toContain('docs/spec-ids-multi-dev.md');
  });

  test('[covers:F-288864ae/AC-9bea7d88] anchor 5 — drift detectors', () => {
    expect(CLAUDE_MD_SECTION).toContain('**Drift detectors**');
  });

  test("[covers:F-288864ae/AC-9bea7d88] size regression guard — cannot silently regrow past the diet ceiling", () => {
    // Measured in BYTES (not .length/UTF-16 code units) because the AC's own
    // "~430 bytes / ~30%" claim is a byte count, and this template's em
    // dashes/arrows cost more bytes than code units. Diet result: 972 bytes.
    // Pre-diet: 1404 bytes.
    //
    // Ceiling deliberately raised 1100 -> 1250 on 2026-07-06 (F-723c81dd): the
    // interpreter rule ("Speak the user's language" — translate cladding terms
    // into the user's own language, never lead with internal ids) is a sixth
    // policy anchor that adds ~242 bytes (972 -> 1214). This is the guard's
    // sanctioned amendment path — the anchor earns its bytes, the ceiling still
    // sits well under the pre-diet 1404, so a future re-bloat trips before ship.
    const bytes = Buffer.byteLength(CLAUDE_MD_SECTION, 'utf8');
    expect(bytes).toBeLessThan(1250);
  });
});

describe('AC-a684ae50 · round trip holds in both directions', () => {
  test("[covers:F-288864ae/AC-a684ae50] a freshly emitted section is NOT stale (no churn)", () => {
    expect(isStaleInstructions(CLAUDE_MD_SECTION)).toBe(false);
  });

  test('[covers:F-288864ae/AC-a684ae50] a genuinely-legacy section (pre-feature-cycle-cadence) still reads stale', () => {
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
  test("[covers:F-288864ae/AC-26e087d1] this repo's own CLAUDE.md contains CLAUDE_MD_SECTION verbatim", () => {
    expect(read('CLAUDE.md')).toContain(CLAUDE_MD_SECTION);
  });
});
