// Cladding · conformance tests for init-onboarding-english-source (F-5cac007a)
//
// Completes the instruction-led-language pivot (F-9af291fa) for the
// init/onboarding CLI surface: cladding emits ONE English source string per
// line and the host agent relays it into the user's language (per the
// CLAUDE.md/AGENTS.md rule). This suite pins:
//
//   AC-001/AC-003 — structural sweep: the three init/onboarding OUTPUT files
//     carry no Hangul (in strings OR comments), with a mutation probe proving
//     the sweep discriminates. Input-matching regexes that legitimately match
//     Korean user input live in src/cli/hook.ts and src/router/intent.ts and
//     are deliberately NOT swept.
//   AC-002 — behavioral: renderSetupReport returns an English report that
//     leads its tail with a "Next steps:" block and contains no Hangul.
//
// (The clad init hint stdout and clad clarify prompts are pinned behaviorally
// by tests/cli/clad.test.ts and via clarify's own suite; this file owns the
// cross-surface English-source invariant + the regression guard.)

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {renderSetupReport} from '../../src/init/host-setup.js';

const ROOT = join(__dirname, '..', '..');

// Hangul syllables block. The sweep below reads only the three named src
// files (never tests/), so the Korean bound chars in this pattern cannot
// self-trip it.
const HANGUL = /[가-힣]/;

// The three OUTPUT-only surfaces the pivot must keep English.
const OUTPUT_FILES = ['src/cli/clad.ts', 'src/init/host-setup.ts', 'src/cli/clarify.ts'];

describe('init-onboarding-english-source (F-5cac007a)', () => {
  describe('AC-001/AC-003 — the init/onboarding output files carry no Hangul', () => {
    for (const rel of OUTPUT_FILES) {
      test(`${rel} has no Hangul characters`, () => {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const lines = src.split('\n');
        const offenders = lines
          .map((line, i) => ({line, n: i + 1}))
          .filter(({line}) => HANGUL.test(line));
        expect(
          offenders,
          `hardcoded Korean must not reappear in ${rel} — cladding emits English, the agent relays:\n` +
            offenders.map((o) => `  L${o.n}: ${o.line.trim()}`).join('\n'),
        ).toEqual([]);
      });
    }

    test('mutation probe — the sweep would catch a re-introduced Korean line', () => {
      // Build a Korean sample from code points so the probe is not a literal.
      const koreanSample = String.fromCharCode(0xb2e4, 0xc74c, 0x20, 0xb2e8, 0xacc4); // "다음 단계"
      expect(HANGUL.test(koreanSample)).toBe(true);
      expect(HANGUL.test('Next steps:')).toBe(false);
    });
  });

  describe('AC-002 — renderSetupReport is English single-source', () => {
    const result = {
      projectRoot: '/tmp/project',
      wiring: {runtime: 'created', shared_init_skill: 'created', claude: 'created', codex: 'created', antigravity: 'created', cursor: 'created'},
      legacyCleanup: {claude_plugin: 'unchanged', antigravity_plugin: 'unchanged', codex_skills: 'unchanged', codex_mcp: 'unchanged', cursor_mcp: 'unchanged'},
      errors: [],
      warnings: [],
      statusFile: '/tmp/status.json',
      cladding_root: '/tmp/pkg',
      cladding_version: '0.8.1',
      last_setup_version: null,
    } as const;

    test('the wiring report ends with an English "Next steps:" block, no Hangul', () => {
      const detection = {claude: true, antigravity: false, codex: false, agents: false, cursor: false};
      const report = renderSetupReport(result, detection);
      expect(report).toContain('Next steps:');
      expect(report).toContain('1. Start a new AI session in this project directory');
      expect(HANGUL.test(report)).toBe(false);
    });

    test('the "no AI tools detected" branch is English, no Hangul', () => {
      const detection = {claude: false, antigravity: false, codex: false, agents: false, cursor: false};
      const report = renderSetupReport(result, detection);
      expect(report).toContain('project activation');
      expect(HANGUL.test(report)).toBe(false);
    });
  });
});
