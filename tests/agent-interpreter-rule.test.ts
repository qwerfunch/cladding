// Cladding · agent interpreter rule pins (F-723c81dd)
//
// Real-adopter screenshot: most sentences the adopter reads are spoken by the
// HOST AGENT ("Shard AC 3개 추가 완료"), not by a detector or the audit log.
// cladding's injected instructions taught shard/AC/stage_X.Y vocabulary and
// never told the agent to translate it for the human. This suite pins the
// three-layer fix's agent-facing layer (hooks render plain = U2, cards drop
// jargon = U3, the agent's own sentences translate = U4, this feature):
//   - AC-ad928912: CLAUDE_MD_SECTION + AGENTS_MD_BLOCK both carry the
//     interpreter rule, both freshness literals still survive verbatim
//     (isStaleInstructions must not self-flag a fresh emission), and
//     CLAUDE_MD_SECTION stays under the (deliberately raised) byte ceiling.
//   - AC-6bf501f8: all five persona prompts extend "User-facing language
//     (Soft Shell)" with translate-by-meaning (shard = spec entry, etc.),
//     the user's-own-language clause, and never-lead-with-ids — each
//     within its pinned tests/scenarios/_size-budgets.ts budget.
//   - AC-b3b7a118: the size ceiling was deliberately RAISED with a recorded,
//     dated rationale (not silently loosened), and the repo's own CLAUDE.md
//     equals the template output byte-for-byte (dogfood parity).
//
// Sibling: tests/claude-md-diet.test.ts owns the diet's pre-existing five
// policy anchors + the freshness-literal round trip machinery (AC-b07dce5d /
// AC-9bea7d88 / AC-a684ae50 / AC-26e087d1) and — per its own inline comment —
// the raised-ceiling rationale itself; tests/init/host-instructions.test.ts
// owns the general writeAgentsMd/writeClaudeMdSection/isStaleInstructions
// behavior (untouched by this feature). This file owns the SIXTH
// (interpreter) anchor and the persona extension.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {CLAUDE_MD_SECTION, isStaleInstructions} from '../src/init/host-instructions.js';
import {renderAgentsMdManagedBlock} from '../src/init/agents-md.js';

// The live cross-host surface: the spec-driven AGENTS.md managed block
// (F-a4085adf) replaced the old static AGENTS_MD_BLOCK in 0.9.0.
const AGENTS_MD_BLOCK = renderAgentsMdManagedBlock(null);
import {checkBudget, PERSONA_BUDGETS} from './scenarios/_size-budgets.js';
import {measureFile} from './scenarios/_token-meter.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const norm = (s: string): string => s.replace(/\s+/g, ' ');

// Tolerant patterns — phrasing legitimately varies per template/persona.
// Orchestrator's is the most compressed variant ("attestation = sign-off",
// "never lead with ids" — no article, no "internal"); every persona and
// both templates must still satisfy the semantic elements.
const TRANSLATE_BY_MEANING = /translate by meaning/i;
const USERS_OWN_LANGUAGE = /user's own language/i;
const NEVER_LEAD_WITH_IDS = /never lead with(?: an)?(?: internal)? ids?/i;
// The translate-by-meaning clause names example equivalences reported "by
// meaning". "shard" was dropped from those examples (cladding no longer
// exposes "shard" to users — it says "spec entry" directly), so attestation +
// finding prove the clause is a real mapping list, not a bare phrase.
const ATTESTATION_EQUIV = /attestation\s*=\s*(a\s+)?(signed\s+)?sign-off/i;
const FINDING_EQUIV = /finding\s*=\s*what drifted/i;

describe('AC-ad928912 · CLAUDE_MD_SECTION + the AGENTS.md managed block carry the interpreter rule', () => {
  test('CLAUDE_MD_SECTION leads with the "Speak the user\'s language" anchor', () => {
    expect(CLAUDE_MD_SECTION).toContain("**Speak the user's language**");
  });

  test('[covers:F-723c81dd/AC-ad928912] CLAUDE_MD_SECTION states translate-to-plain-words + never-lead-with-ids', () => {
    const flat = norm(CLAUDE_MD_SECTION);
    expect(flat).toMatch(USERS_OWN_LANGUAGE);
    expect(flat).toMatch(NEVER_LEAD_WITH_IDS);
    expect(flat).toContain('translate');
    expect(flat).toContain('plain words');
  });

  test('the AGENTS.md managed block carries the equivalent "Speak the user\'s language" section', () => {
    expect(AGENTS_MD_BLOCK).toContain("## Speak the user's language");
    const flat = norm(AGENTS_MD_BLOCK);
    expect(flat).toMatch(USERS_OWN_LANGUAGE);
    expect(flat).toMatch(NEVER_LEAD_WITH_IDS);
  });

  test('both freshness literals survive verbatim in both templates', () => {
    for (const tpl of [CLAUDE_MD_SECTION, AGENTS_MD_BLOCK]) {
      expect(tpl).toContain('anti-self-cert');
      expect(tpl).toContain('Feature cycle — one at a time');
    }
  });

  test('round trip holds: a freshly emitted section of either template is NOT stale (no re-sync churn)', () => {
    expect(isStaleInstructions(CLAUDE_MD_SECTION)).toBe(false);
    expect(isStaleInstructions(AGENTS_MD_BLOCK)).toBe(false);
  });

  test('CLAUDE_MD_SECTION stays under the 1250-byte ceiling (measured in bytes, not UTF-16 code units)', () => {
    expect(Buffer.byteLength(CLAUDE_MD_SECTION, 'utf8')).toBeLessThan(1250);
  });
});

describe('AC-6bf501f8 · all five personas extend Soft Shell with the three semantic elements', () => {
  const PERSONA_FILES = [
    'src/agents/orchestrator.md',
    'src/agents/developer.md',
    'src/agents/planner.md',
    'src/agents/reviewer.md',
    'src/agents/observability.md',
  ] as const;

  test('[covers:F-ef93141b/AC-4f568698] exactly the five named personas are in scope, each a recognized PERSONA_BUDGETS key', () => {
    expect(PERSONA_FILES).toHaveLength(5);
    for (const f of PERSONA_FILES) {
      expect(Object.prototype.hasOwnProperty.call(PERSONA_BUDGETS, f), f).toBe(true);
    }
    // blind-author.md is a sixth PERSONA_BUDGETS entry but NOT one of the
    // five personas this feature touches (structural anti-self-cert agent,
    // out of scope per the brief) — confirm it is excluded, not forgotten.
    expect(PERSONA_FILES as readonly string[]).not.toContain('src/agents/blind-author.md');
  });

  for (const relPath of PERSONA_FILES) {
    test(`${relPath}: Soft Shell section translates by meaning, in the user's own language, never leading with ids`, () => {
      const body = read(relPath);
      const sectionStart = body.indexOf('## User-facing language');
      expect(sectionStart, `${relPath}: must have a "User-facing language" section`).toBeGreaterThanOrEqual(0);
      const section = body.slice(sectionStart);
      expect(section, `${relPath}: translate-by-meaning clause`).toMatch(TRANSLATE_BY_MEANING);
      expect(section, `${relPath}: attestation = sign-off equivalence`).toMatch(ATTESTATION_EQUIV);
      expect(section, `${relPath}: detector finding = what drifted equivalence`).toMatch(FINDING_EQUIV);
      expect(section, `${relPath}: user's-own-language clause`).toMatch(USERS_OWN_LANGUAGE);
      expect(section, `${relPath}: never-lead-with-ids clause`).toMatch(NEVER_LEAD_WITH_IDS);
    });

    test(`${relPath}: stays within its pinned PERSONA_BUDGETS char/line budget`, () => {
      const measurement = measureFile(join(ROOT, relPath));
      const result = checkBudget(relPath, measurement, PERSONA_BUDGETS[relPath]);
      expect(result.violations, result.violations.join('; ')).toEqual([]);
    });
  }

  test('[covers:F-723c81dd/AC-6bf501f8] planted-needle control — the tolerant patterns have teeth (miss a stub, catch the real sentence)', () => {
    const stub =
      'Use src/ui/softShell.ts (featureLabel, gateLabel) to keep F-NNN / stage_X.Y codes out of user-facing prose.';
    expect(TRANSLATE_BY_MEANING.test(stub)).toBe(false);
    expect(ATTESTATION_EQUIV.test(stub)).toBe(false);
    expect(FINDING_EQUIV.test(stub)).toBe(false);
    expect(USERS_OWN_LANGUAGE.test(stub)).toBe(false);
    expect(NEVER_LEAD_WITH_IDS.test(stub)).toBe(false);

    const real =
      "translate by meaning in the user's own language — an attestation = a signed sign-off, a detector finding = what drifted and why; never lead with internal ids.";
    expect(TRANSLATE_BY_MEANING.test(real)).toBe(true);
    expect(ATTESTATION_EQUIV.test(real)).toBe(true);
    expect(FINDING_EQUIV.test(real)).toBe(true);
    expect(USERS_OWN_LANGUAGE.test(real)).toBe(true);
    expect(NEVER_LEAD_WITH_IDS.test(real)).toBe(true);

    const orchestratorVariant = 'translate by meaning in the user\'s own language — attestation = sign-off, finding = what drifted; never lead with ids.';
    expect(ATTESTATION_EQUIV.test(orchestratorVariant)).toBe(true);
    expect(NEVER_LEAD_WITH_IDS.test(orchestratorVariant)).toBe(true);
  });
});

describe('AC-b3b7a118 · the size ceiling was deliberately raised (documented), not silently loosened', () => {
  test('tests/claude-md-diet.test.ts records the raised 1250 ceiling with a dated rationale comment', () => {
    const src = read('tests/claude-md-diet.test.ts');
    expect(src).toContain('1250');
    // "dated" — a real calendar-date literal must sit near the number, not
    // just the bare digits (a structural pin that the bump is *documented*,
    // matching this feature's own "sanctioned amendment path" contract).
    const idx = src.indexOf('1250');
    const vicinity = src.slice(Math.max(0, idx - 500), idx + 200);
    expect(vicinity).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(vicinity.toLowerCase()).toMatch(/rais(e|ed)|ceiling/);
  });

  test('planted-needle control — a bare undated "1250" elsewhere would NOT satisfy the vicinity check', () => {
    const undated = 'const MAX = 1250; // just a number, no story';
    const idx = undated.indexOf('1250');
    const vicinity = undated.slice(Math.max(0, idx - 500), idx + 200);
    expect(vicinity).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
  });

  test("[covers:F-723c81dd/AC-b3b7a118] this repo's own CLAUDE.md `## cladding` section equals CLAUDE_MD_SECTION byte-for-byte (dogfood parity)", () => {
    expect(read('CLAUDE.md')).toContain(CLAUDE_MD_SECTION);
  });
});
