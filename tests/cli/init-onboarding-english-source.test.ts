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
// (The direct renderer proof below pins the init and clarify framing alongside
// the setup report; this file owns the cross-surface English-source invariant
// plus its regression guard.)

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {renderInitCompletionHints} from '../../src/cli/clad.js';
import {renderClarifyPrompts} from '../../src/cli/clarify.js';
import {renderSetupReport} from '../../src/init/host-setup.js';

const ROOT = join(__dirname, '..', '..');

// Hangul syllables block. The sweep below reads only the three named src
// files (never tests/), so the Korean bound chars in this pattern cannot
// self-trip it.
const HANGUL = /[가-힣]/;

// The three OUTPUT-only surfaces the pivot must keep English.
const OUTPUT_FILES = ['src/cli/clad.ts', 'src/init/host-setup.ts', 'src/cli/clarify.ts'];

describe('init-onboarding-english-source (F-5cac007a)', () => {
  const setupResult = {
    projectRoot: '/tmp/project',
    wiring: {runtime: 'created', shared_init_skill: 'created', claude: 'created', codex: 'created', gemini: 'created', antigravity: 'created', cursor: 'created'},
    legacyCleanup: {claude_plugin: 'unchanged', gemini_extension: 'unchanged', antigravity_plugin: 'unchanged', codex_skills: 'unchanged', codex_mcp: 'unchanged', cursor_mcp: 'unchanged'},
    errors: [],
    warnings: [],
    statusFile: '/tmp/status.json',
    cladding_root: '/tmp/pkg',
    cladding_version: '0.8.1',
    last_setup_version: null,
  } as const;

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

    test('[covers:F-5cac007a/AC-7c50ac34] all three init/onboarding output sources reject a reintroduced Hangul character', () => {
      for (const rel of OUTPUT_FILES) {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        expect(HANGUL.test(src), rel).toBe(false);
      }
    });

    test('mutation probe — the sweep would catch a re-introduced Korean line', () => {
      // Build a Korean sample from code points so the probe is not a literal.
      const koreanSample = String.fromCharCode(0xb2e4, 0xc74c, 0x20, 0xb2e8, 0xacc4); // "다음 단계"
      expect(HANGUL.test(koreanSample)).toBe(true);
      expect(HANGUL.test('Next steps:')).toBe(false);
    });
  });

  describe('AC-002 — renderSetupReport is English single-source', () => {
    test('[covers:F-5cac007a/AC-b32265b7] the wiring report ends with an English "Next steps:" block, no Hangul', () => {
      const detection = {claude: true, gemini: false, antigravity: false, codex: false, agents: false, cursor: false};
      const report = renderSetupReport(setupResult, detection);
      expect(report).toContain('Next steps:');
      expect(report).toContain('1. Start a new AI session in this project directory');
      expect(HANGUL.test(report)).toBe(false);
    });

    test('the "no AI tools detected" branch is English, no Hangul', () => {
      const detection = {claude: false, gemini: false, antigravity: false, codex: false, agents: false, cursor: false};
      const report = renderSetupReport(setupResult, detection);
      expect(report).toContain('project activation');
      expect(HANGUL.test(report)).toBe(false);
    });
  });

  test('[covers:F-5cac007a/AC-f12ce851] init hints, setup activation, and clarify prompts render exact English framing while preserving question data', () => {
    const initHints = renderInitCompletionHints({
      created: ['spec.yaml'],
      clarifyingQuestions: ['Who will use the product?'],
    }, 'payment SaaS');
    expect(initHints).toBe([
      '',
      '💡 A few more details would sharpen the spec:',
      '   1. Who will use the product?',
      '',
      '',
    ].join('\n'));
    const initTip = renderInitCompletionHints({
      created: ['docs/conventions.md'],
      clarifyingQuestions: [],
    }, undefined);
    expect(initTip).toBe([
      '',
      '💡 Tip: for a more precise scaffold, describe the project:',
      '   clad init <project description>',
      '   e.g. clad init payment SaaS for B2B',
      '   The existing seeds divert to .cladding/scan/*.proposal.',
      '',
      '',
    ].join('\n'));

    const setupReport = renderSetupReport(setupResult);
    expect(setupReport).toBe([
      'cladding setup — project activation: /tmp/project',
      '',
      '  Claude Code  → wired',
      '  Codex        → wired',
      '  Gemini CLI   → wired',
      '  Antigravity  → wired',
      '  Cursor       → wired',
      '',
      '  Note: Antigravity reads MCP config machine-wide only, so its wire lives in ~/.gemini/config/plugins/cladding (each session still resolves the project from its working directory).',
      '',
      'Next steps:',
      '  1. Start a new AI session in this project directory',
      '  2. Ask: "Apply Cladding to this project"',
      '  3. Review the preview and reply with its exact approval phrase',
      '  4. After initialization, develop normally in natural language',
    ].join('\n'));

    const clarifyPrompts = renderClarifyPrompts({
      newQuestions: ['Which market should launch first?'],
      remainingQuestions: 1,
      status: 'active',
    });
    expect(clarifyPrompts).toBe([
      '',
      '💡 Next questions:',
      '   1. Which market should launch first?',
      '',
      '1 question(s) left · Continue with `clad clarify <answer>`.',
      '',
      '',
    ].join('\n'));
    const clarifyDone = renderClarifyPrompts({
      newQuestions: [],
      remainingQuestions: 0,
      status: 'done',
    });
    expect(clarifyDone).toBe([
      '',
      '✓ All questions answered — onboarding complete.',
      "  Next: author your first feature's spec — its acceptance criteria (the testable promises) and the files it will cover — before writing code. The feature cycle starts there.",
      '',
      '',
    ].join('\n'));
    const clarifyContinue = renderClarifyPrompts({
      newQuestions: [],
      remainingQuestions: 2,
      status: 'active',
    });
    expect(clarifyContinue).toBe([
      '',
      '2 question(s) left. Continue with `clad clarify <answer>`.',
      '',
      '',
    ].join('\n'));

    for (const output of [initHints, initTip, setupReport, clarifyPrompts, clarifyDone, clarifyContinue]) {
      expect(HANGUL.test(output)).toBe(false);
    }

    const koreanQuestion = '주 사용자는 누구인가요?';
    expect(renderInitCompletionHints({created: [], clarifyingQuestions: [koreanQuestion]}, '결제 SaaS')).toContain(koreanQuestion);
    expect(renderClarifyPrompts({newQuestions: [koreanQuestion], remainingQuestions: 1, status: 'active'})).toContain(koreanQuestion);
  });
});
