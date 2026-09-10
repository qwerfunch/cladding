// Cladding · human-first cards — no MCP tool names, no the-retired-term (F-f46d5c61)
//
// TEST-AUTHOR context: written from the shard's 4 ACs, AS AMENDED 2026-07-06 —
// the locale-auto-detection AC (AC-37b6d2d6) now pins the INSTRUCTION-LED
// principle instead: no detection/store/force machinery was built into
// cladding itself; every string below is a plain-English constant the coding
// agent relays back to the user in their own language.
//   AC-2c63b999  zero MCP tool names / zero the retired spec-entry term on
//                every user-visible hook surface (session card, prompt
//                suggestions, PreToolUse block reasons, impact cards) —
//                capability phrasing + user-typeable CLI verbs only
//   AC-37b6d2d6  jargon-free plain English, single source; cladding shall
//                NOT detect/store/force the user's language (instruction-led,
//                not code-led)
//   AC-2a7fed0c  impact cards name what a person means — id+title focus,
//                "depend on this" / "guard it" phrasing — within the
//                existing 5-line/600-char caps
//   AC-ed9d8a26  the detector catalog doc matches the shipped
//                MISSING_IMPLEMENTATION status policy (aware / spec-first
//                window), not the stale narrative
//
// Sibling suites this file does NOT duplicate: tests/cli/hook.test.ts and
// tests/cli/hook-session-guidance.test.ts already pin the byte-exact
// SessionStart card shape + ordering; tests/optimizer/push-card.test.ts pins
// the Tier-1/Tier-2 render bounds; tests/cli/impact-card.test.ts pins
// formatImpactCard's own contract. This file owns the CROSS-SURFACE
// human-first sweep F-f46d5c61's own AC set asks for, which those
// pre-existing suites were never asked to prove.
//
// Needle hygiene: the internal spec-entry term this feature retired from
// user-facing surfaces is assembled at runtime via `asm()` — never literal in
// this file — same precedent as tests/terminology-canon.test.ts /
// tests/cli/verb-residue.test.ts / tests/status-aware-missing-impl.test.ts, so
// a future repo-wide residue sweep treats this file like any other.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {stringify as stringifyYaml} from 'yaml';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runHookEvent, formatImpactCard} from '../src/cli/hook.js';
import {formatPushOneLiner, formatWorkingSetCard} from '../src/optimizer/push-card.js';
import type {ImpactSlice} from '../src/optimizer/reverse-slice.js';
import type {WorkingSet} from '../src/optimizer/working-set.js';
import {TOOL_NAMES} from '../src/serve/server.js';
import {appendEvent, newEvent} from '../src/events/log.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const asm = (parts: readonly string[]): string => parts.join('');

// ─── needle hygiene (never literal in this file) ───────────────────────────
/** The internal spec-entry term retired from user-facing hook surfaces (AC-2c63b999). */
const RETIRED_TERM = asm(['sh', 'ard']);
/** Any future clad_-shaped identifier, not just the currently-registered ones. */
const MCP_SHAPE = /\bclad_[a-z_]+/;
/** Full registry names PLUS the underscore-stripped suffix (mirrors
 *  tests/plain-render.test.ts's DETECTOR_PLAIN sweep) — a future tool is
 *  covered automatically, nothing to update here when one is added. */
const MCP_NEEDLES: readonly string[] = TOOL_NAMES.flatMap((t) => [t, t.replace(/^clad_/, '')]);

/** Every internal-name / retired-term hit found in `s` (empty = clean). */
function findInternalNameHits(s: string): string[] {
  const hits: string[] = [];
  for (const n of MCP_NEEDLES) if (s.includes(n)) hits.push(n);
  if (MCP_SHAPE.test(s)) hits.push('clad_-shape');
  if (s.toLowerCase().includes(RETIRED_TERM)) hits.push(RETIRED_TERM);
  return hits;
}

/** Asserts `s` names no MCP tool (registered or clad_-shaped) and never says the retired term. */
function expectHumanFirst(s: string, label: string): void {
  expect(findInternalNameHits(s), `${label} must be human-first: "${s}"`).toEqual([]);
}

// ─── WorkingSet fixture factory (mirrors tests/optimizer/push-card.test.ts's
// local makeWs — not exported there, so reproduced here with the same shape;
// only the fields the formatters read matter). ──────────────────────────────

function makeWorkingSet(over: {
  id?: string;
  title?: string;
  coOwners?: string[];
  impacted?: {id: string; title: string; status?: string}[];
  regression?: string[];
  highRisk?: {id: string; ears: string}[];
  dependsOnEdges?: number;
}): WorkingSet {
  return {
    must_edit: {
      id: over.id ?? 'F-focus1',
      title: over.title ?? 'Focus Feature',
      status: 'in_progress',
      modules: ['src/focus.ts'],
      acceptance_criteria: [],
      code: [],
      ...(over.coOwners ? {co_owners: over.coOwners} : {}),
    },
    needs: [],
    breaks_if_changed: {
      impacted: over.impacted ?? [],
      regression_tests: over.regression ?? [],
      ...(over.dependsOnEdges !== undefined
        ? {ledger: {depends_on_edges: over.dependsOnEdges, test_ref_edges: 0}}
        : {}),
    },
    verify: {
      scenarios: [],
      test_refs: [],
      oracle_refs: [],
      high_risk_acs: over.highRisk ?? [],
    },
    guidance: {preferred_patterns: []},
    budget: {max_tokens: 350, used_tokens: 0, truncated: []},
  };
}

function impactedFixtures(n: number, titleLen = 2): {id: string; title: string}[] {
  return Array.from({length: n}, (_, i) => ({id: `F-imp${String(i).padStart(3, '0')}`, title: 'T'.repeat(titleLen)}));
}

function testFixtures(n: number): string[] {
  return Array.from({length: n}, (_, i) => `tests/t${String(i).padStart(2, '0')}.test.ts`);
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-human-first-'));
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
});

// ═══════════════════════════════════════════════════════════════════════
// AC-2c63b999 — zero MCP tool names, zero the retired term, on every
// user-visible hook surface. Drives the REAL emitters, not string literals.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-2c63b999 — zero MCP tool names, zero the retired term, on every user-visible hook surface', () => {
  function seedRichSessionStart(): void {
    writeFileSync(
      join(cwd, 'spec.yaml'),
      stringifyYaml({
        schema: '0.1',
        project: {
          name: 'fixture',
          ai_hints: {
            preferred_patterns: [
              {when: 'error handling', prefer: 'RESULT_TYPE', over: 'THROWING'},
              {when: 'async flow', prefer: 'ASYNC_AWAIT', over: 'CALLBACKS'},
            ],
          },
        },
      }),
      'utf8',
    );
    mkdirSync(join(cwd, 'spec'), {recursive: true});
    writeFileSync(
      join(cwd, 'spec', 'index.yaml'),
      [
        '# Cladding · Tier C — generated feature index',
        'features:',
        '  F-aaa111: {slug: alpha, status: done, modules: 2}',
        '  F-bbb222: {slug: beta, status: in_progress, modules: 1}',
        '  F-ccc333: {slug: gamma, status: planned, modules: 1}',
        '',
      ].join('\n'),
      'utf8',
    );
    appendEvent(
      cwd,
      newEvent('gate_run', {tier: 'pre-push', strict: true, worst: 0, anyFailed: false, head: 'abcdef1234567890'}),
    );
    writeFileSync(
      join(cwd, '.cladding', 'stop-block.json'),
      JSON.stringify({fingerprint: 'f'.repeat(64), count: 2, first: 'AC_DRIFT'}),
      'utf8',
    );
  }

  test('[covers:F-f46d5c61/AC-2c63b999] SessionStart — the full rendered card (counts, in-progress, gate, stop-block, prefer, context, policy) is entirely human-first', () => {
    seedRichSessionStart();
    const card = runHookEvent('SessionStart', {}, cwd);
    // vacuous-render guard: this must actually be the RICH multi-line card, not a degenerate one.
    expect(card.split('\n').length).toBeGreaterThanOrEqual(6);
    for (const line of card.split('\n')) expectHumanFirst(line, `SessionStart line "${line}"`);
    // F-ebbb20af AC-78c153fa — the stop-block line is seeded with the raw detector
    // name AC_DRIFT; it must be rendered as its plain lead, never surfaced raw.
    expect(card, 'stop-block line must not surface the raw detector name').not.toContain('AC_DRIFT');
  });

  const PROMPT_SAMPLES: Readonly<Record<string, string>> = {
    run: 'add a login feature',
    check: 'please verify the auth flow',
    sync: 'sync the spec with the code',
    init: 'scaffold a new service',
    completion: 'looks done, wrap it up',
  };

  test('[covers:F-f46d5c61/AC-2c63b999] UserPromptSubmit — every classified suggestion (run/check/sync/init/completion-claim) is human-first', () => {
    let sawAtLeastOneSuggestion = false;
    for (const [kind, prompt] of Object.entries(PROMPT_SAMPLES)) {
      const out = runHookEvent('UserPromptSubmit', {prompt}, cwd);
      expect(out.length, `"${prompt}" (${kind}) must still produce a suggestion`).toBeGreaterThan(0);
      sawAtLeastOneSuggestion = true;
      expectHumanFirst(out, `UserPromptSubmit "${prompt}"`);
    }
    expect(sawAtLeastOneSuggestion).toBe(true); // vacuous-loop guard
  });

  test('[covers:F-f46d5c61/AC-2c63b999] PreToolUse — both structural block reasons (done-flip, hash-id) are human-first', () => {
    const doneFlip = runHookEvent(
      'PreToolUse',
      {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'spec/features/x-abc123.yaml',
          old_string: 'status: in_progress',
          new_string: 'status: done',
        },
      },
      cwd,
    );
    const hashId = runHookEvent(
      'PreToolUse',
      {tool_name: 'Write', tool_input: {file_path: 'spec/features/F-777.yaml', content: 'id: F-777\nstatus: planned\n'}},
      cwd,
    );
    const doneReason = (JSON.parse(doneFlip) as {decision: string; reason: string}).reason;
    const hashReason = (JSON.parse(hashId) as {decision: string; reason: string}).reason;
    expectHumanFirst(doneReason, 'DONE_BLOCK_REASON');
    expectHumanFirst(hashReason, 'HASH_ID_REASON');
  });

  test('[covers:F-f46d5c61/AC-2c63b999] impact cards — formatImpactCard/formatPushOneLiner/formatWorkingSetCard are human-first across representative fixtures', () => {
    const slices: ImpactSlice[] = [
      {
        focus: {id: 'F-abc123', title: 'Login'},
        impacted: [{id: 'F-one', title: 'One'}, {id: 'F-two', title: 'Two'}],
        impacted_modules: [],
        scenarios: [],
        test_refs: ['t1'],
      },
      {
        focus: {module: 'src/x.ts', owners: ['F-aaa', 'F-bbb']},
        impacted: [],
        impacted_modules: [],
        scenarios: [],
        test_refs: [],
      },
      {
        focus: {module: 'src/y.ts', owners: ['F-aaa']},
        impacted: [],
        impacted_modules: [],
        scenarios: [],
        test_refs: [],
        ledger: {depends_on_edges: 0, test_ref_edges: 0},
      },
    ];
    for (const slice of slices) expectHumanFirst(formatImpactCard(slice, 'src/touched.ts'), 'formatImpactCard');

    const ws = makeWorkingSet({
      impacted: impactedFixtures(4),
      regression: testFixtures(4),
      highRisk: [{id: 'AC-0', ears: 'unwanted'}],
    });
    expectHumanFirst(formatPushOneLiner(ws, 'src/focus.ts'), 'formatPushOneLiner');
    expectHumanFirst(formatWorkingSetCard(ws, 'src/focus.ts'), 'formatWorkingSetCard');
  });

  test('[covers:F-f46d5c61/AC-2c63b999] the sweep has teeth — a planted tool name, a planted clad_-shaped name, and the retired term are each caught (negative control)', () => {
    expect(MCP_NEEDLES.length).toBeGreaterThan(0); // vacuous-needle-list guard
    expect(findInternalNameHits(`ask ${TOOL_NAMES[0]} to do it`).length).toBeGreaterThan(0);
    expect(findInternalNameHits('a brand-new clad_something_new tool').length).toBeGreaterThan(0);
    expect(findInternalNameHits(`please use a ${RETIRED_TERM} for that`)).toContain(RETIRED_TERM);
    expect(findInternalNameHits('nothing suspicious in this plain sentence')).toEqual([]);
  });

  test('[covers:F-f46d5c61/AC-2c63b999] user-typeable CLI commands stay allowed — clad check --strict / clad done survive the sweep unflagged', () => {
    expect(findInternalNameHits('verify with clad check --strict')).toEqual([]);
    expect(findInternalNameHits('run `clad done <F-id>`')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-37b6d2d6 — plain English single source; instruction-led, not
// detection-led. cladding shall not detect/store/force the user's language.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-37b6d2d6 — plain English single source; instruction-led, not detection-led', () => {
  function seedMinimalProject(): void {
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
  }

  describe('prefix + phrasing invariants', () => {
    test('[covers:F-f46d5c61/AC-37b6d2d6] POLICY_LINE keeps the "policy:" prefix and states the source-of-truth phrasing', () => {
      seedMinimalProject();
      const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
      const policy = lines.find((l) => l.startsWith('policy:'));
      expect(policy, 'a policy: line must render').toBeTruthy();
      expect(policy as string).toContain('source of truth');
      expectHumanFirst(policy as string, 'POLICY_LINE');
    });

    test('[covers:F-f46d5c61/AC-37b6d2d6] the context line keeps its "context:" prefix and names no tool', () => {
      seedMinimalProject();
      const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
      const ctx = lines.find((l) => l.startsWith('context:'));
      expect(ctx, 'a context: line must render').toBeTruthy();
      expect(ctx as string).not.toMatch(MCP_SHAPE);
      expectHumanFirst(ctx as string, 'CONTEXT_LINE');
    });

    test('[covers:F-f46d5c61/AC-37b6d2d6] DONE_BLOCK_REASON is action-guiding plain English: names clad done, not an MCP tool', () => {
      const out = runHookEvent(
        'PreToolUse',
        {
          tool_name: 'Edit',
          tool_input: {
            file_path: 'spec/features/x-abc123.yaml',
            old_string: 'status: in_progress',
            new_string: 'status: done',
          },
        },
        cwd,
      );
      const reason = (JSON.parse(out) as {reason: string}).reason;
      expect(reason).toContain('clad done'); // the user-typeable command it points at
      expect(reason).toMatch(/ask|run/i); // action-guiding cue, not a flat refusal
      expectHumanFirst(reason, 'DONE_BLOCK_REASON');
    });

    test('[covers:F-f46d5c61/AC-37b6d2d6] HASH_ID_REASON is action-guiding plain English: no MCP tool, still tells the agent what to do', () => {
      const out = runHookEvent(
        'PreToolUse',
        {tool_name: 'Write', tool_input: {file_path: 'spec/features/F-778.yaml', content: 'id: F-778\nstatus: planned\n'}},
        cwd,
      );
      const reason = (JSON.parse(out) as {reason: string}).reason;
      expect(reason).toMatch(/ask/i); // action-guiding cue
      expectHumanFirst(reason, 'HASH_ID_REASON');
    });
  });

  describe('no locale-detection artifacts in the UserPromptSubmit lane (2026-07-06 pivot)', () => {
    const hookSrc = read('src/cli/hook.ts');

    /** Slices hookSrc between two unique anchor strings — fails loudly if either is absent. */
    function sliceBetween(startAnchor: string, endAnchor: string): string {
      const start = hookSrc.indexOf(startAnchor);
      expect(start, `anchor "${startAnchor}" must exist in src/cli/hook.ts`).toBeGreaterThanOrEqual(0);
      const end = hookSrc.indexOf(endAnchor, start + startAnchor.length);
      expect(end, `anchor "${endAnchor}" must exist after the start anchor`).toBeGreaterThan(start);
      return hookSrc.slice(start, end);
    }

    test('[covers:F-f46d5c61/AC-37b6d2d6] the UserPromptSubmit suggestion section (INTENT_HINTS + the classifier) carries no locale-sidecar write', () => {
      const section = sliceBetween('// --- UserPromptSubmit', '// --- PreToolUse');
      expect(section).not.toContain('user-locale');
      expect(section).not.toContain('resolveLocale');
      expect(section).not.toContain('writeFileSync');
    });

    test('[covers:F-f46d5c61/AC-37b6d2d6] the UserPromptSubmit dispatch case carries no locale-sidecar write either', () => {
      const section = sliceBetween("case 'UserPromptSubmit':", "case 'PreToolUse':");
      expect(section).not.toContain('user-locale');
      expect(section).not.toContain('writeFileSync');
    });

    test('[covers:F-f46d5c61/AC-37b6d2d6] corroborating whole-file pin — src/cli/hook.ts references the user-locale sidecar nowhere at all', () => {
      // Stronger than the two scoped slices above: proves no detection-write
      // code was tucked in ANY lane of this file, not just the one the
      // original (pre-pivot) brief targeted.
      expect(hookSrc).not.toContain('user-locale');
    });

    test('[covers:F-f46d5c61/AC-37b6d2d6] post-pivot (F-9af291fa) — src/cli/hook.ts references resolveLocale nowhere at all', () => {
      // The locale machinery is gone: hook text is an agent-delivered channel,
      // and the host agent renders the user's language from the English source.
      expect(hookSrc).not.toContain('resolveLocale');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-2a7fed0c — impact cards name what a person means: id + title focus,
// "depend on this" phrasing, within the existing line/byte caps.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-2a7fed0c — impact cards name what a person means: id + title, "depend on this", within caps', () => {
  test('[covers:F-f46d5c61/AC-2a7fed0c] formatImpactCard: focus renders as "id title"; plural dependents read "depend on this" and tests "guard it"', () => {
    const slice: ImpactSlice = {
      focus: {id: 'F-abc123', title: 'Login'},
      impacted: [{id: 'F-one', title: 'One'}, {id: 'F-two', title: 'Two'}],
      impacted_modules: [],
      scenarios: [],
      test_refs: ['t1', 't2', 't3'],
    };
    const card = formatImpactCard(slice, 'src/login.ts');
    expect(card).toContain('F-abc123 Login');
    expect(card).toContain('depend on this');
    expect(card).toContain('guard it');
  });

  test('[covers:F-f46d5c61/AC-2a7fed0c] formatPushOneLiner / formatWorkingSetCard: focus renders as "id title"; caps (<=5 lines, <=600 chars) hold at a stress fixture', () => {
    // Mirrors tests/optimizer/push-card.test.ts's own 600-char-ceiling fixture
    // shape (long titles + several impacted/tests/risk rows) — reproduced
    // locally since that file's makeWs/impactedList are not exported — proving
    // the AC-2a7fed0c title enrichment did not blow the pre-existing caps.
    const ws = makeWorkingSet({
      id: 'F-focus9',
      title: 'The Focus Feature',
      impacted: [
        {id: 'F-imp000', title: 'X'.repeat(200)},
        {id: 'F-imp001', title: 'Y'.repeat(200)},
        {id: 'F-imp002', title: 'Z'.repeat(200)},
        {id: 'F-imp003', title: 'W'.repeat(200)},
      ],
      regression: testFixtures(6),
      highRisk: [{id: 'AC-0', ears: 'unwanted'}],
    });

    const oneLiner = formatPushOneLiner(ws, 'src/focus.ts');
    expect(oneLiner).toContain('F-focus9 The Focus Feature');
    expect(oneLiner).toContain('depend on this');

    const card = formatWorkingSetCard(ws, 'src/focus.ts');
    expect(card.split('\n').length).toBeLessThanOrEqual(5);
    expect(card.length).toBeLessThanOrEqual(600);
    expect(card).toContain('F-focus9 The Focus Feature');
    expect(card).toContain('depend on this');
    expectHumanFirst(card, 'stress-fixture formatWorkingSetCard');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-ed9d8a26 — the detector catalog doc matches the shipped
// MISSING_IMPLEMENTATION status policy (aware / spec-first window).
// ═══════════════════════════════════════════════════════════════════════
describe('AC-ed9d8a26 — detector catalog doc matches the shipped MISSING_IMPLEMENTATION status policy', () => {
  const readme = read('src/stages/detectors/README.md');

  test('[covers:F-f46d5c61/AC-ed9d8a26] the MISSING_IMPLEMENTATION catalog row says aware + spec-first window, not blind', () => {
    const row = readme
      .split('\n')
      .find((l) => l.includes('`MISSING_IMPLEMENTATION`') && l.includes('missing-implementation.ts'));
    expect(row, 'the MISSING_IMPLEMENTATION catalog row must exist').toBeTruthy();
    expect(row as string).toContain('aware');
    expect(row as string).toContain('spec-first window');
    expect(row as string).not.toContain('blind');
  });

  test('[covers:F-f46d5c61/AC-ed9d8a26] the status-policy narrative documents the graduated severity behavior, not the stale status-blind claim', () => {
    expect(readme).toContain('graduates severity by status');
    expect(readme).toContain('an `error` for a `done`/`archived`/`blocked` feature');
    expect(readme).toContain('only `info` for a `planned`/`in_progress` one');
    expect(readme).toContain('spec-first window');
  });
});
