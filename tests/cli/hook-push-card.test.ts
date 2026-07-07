// Cladding · F-35954d19 — the PostToolUse mini working-set push card, driven as
// a FUNCTION (no host, no subprocess). drift/arch/secret are stubbed per the
// gate-golden-matrix pattern so PostToolUse never spawns a toolchain.
//
// TEST-AUTHOR context: every assertion traces to an F-35954d19 AC:
//   AC-816f10c3  Tier-2 card fires for an owned edit with consequences; the
//                impact_card_fired event carries tier:2 + accurate counts
//   AC-1bfccb6b  hook stdout NEVER contains a code excerpt body
//   AC-f912fd40  zero-consequence edit → the Tier-1 one-liner, byte-identical to
//                the legacy formatImpactCard path (computed here on the same fixture);
//                fired event carries tier:1
//   AC-61ae9211  dedup ladder: Tier-2 → Tier-1 → silence, each repeat records dedup;
//                a different file under the same focus is a fresh Tier-2
//   AC-f4715e87  a session over budget suppresses cards + prints the notice once + records
//                ledger_exhausted; the notice does not spend budget; a fresh session resets
//   robustness   corrupt ledger → fresh start (no throw); 30-min rollover resets budget+fp

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

type StageResult = {pass: boolean; exitCode: number; stderr?: string};
type DriftFinding = {detector: string; severity: 'error' | 'warn' | 'info'; path?: string; message: string};
type DriftReport = StageResult & {findings: DriftFinding[]};

const STAGE_PASS: StageResult = {pass: true, exitCode: 0};
const DRIFT_CLEAN: DriftReport = {pass: true, exitCode: 0, findings: []};

const driftStub = vi.fn((): DriftReport => DRIFT_CLEAN);
const archStub = vi.fn((): StageResult => STAGE_PASS);
const secretStub = vi.fn((): StageResult => STAGE_PASS);

vi.mock('../../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => driftStub(...(a as []))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: (...a: unknown[]) => archStub(...(a as []))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: (...a: unknown[]) => secretStub(...(a as []))}));

const {runHookEvent, formatImpactCard} = await import('../../src/cli/hook.js');
const {readEvents} = await import('../../src/events/log.js');
const {buildImpactSlice} = await import('../../src/optimizer/reverse-slice.js');
const {loadSpec} = await import('../../src/spec/load.js');

// ─── fixtures ───

// SPEC_A: F-aaa111 owns src/foo.ts (unwanted AC + a test_ref), F-bbb222 depends on it.
// An edit to src/foo.ts → impacted 1, run 1 test, 1 high-risk AC → a rich Tier-2 card.
const SPEC_A = [
  'schema: "0.1"',
  'project: {name: t, language: typescript}',
  'features:',
  '  - id: F-aaa111',
  '    slug: alpha',
  '    title: alpha',
  '    status: done',
  '    modules: [src/foo.ts]',
  '    acceptance_criteria:',
  '      - id: AC-001',
  '        ears: unwanted',
  '        text: t',
  '        test_refs: [tests/foo.test.ts]',
  '  - id: F-bbb222',
  '    slug: beta',
  '    title: beta',
  '    status: done',
  '    depends_on: [F-aaa111]',
  '    modules: [src/bar.ts]',
  '    acceptance_criteria:',
  '      - id: AC-002',
  '        ears: ubiquitous',
  '        text: t',
  '',
].join('\n');

// SPEC_SOLO: one feature, no dependents, no tests, no high-risk ACs, no depends_on
// edges anywhere → a zero-consequence edit that must degrade to the Tier-1 one-liner
// WITH the deps-unledgered disclosure.
const SPEC_SOLO = [
  'schema: "0.1"',
  'project: {name: t, language: typescript}',
  'features:',
  '  - id: F-501010',
  '    slug: solo',
  '    title: solo',
  '    status: done',
  '    modules: [src/solo.ts]',
  '    acceptance_criteria:',
  '      - id: AC-001',
  '        ears: ubiquitous',
  '        text: t',
  '',
].join('\n');

// SPEC_MULTI: F-ccc333 owns TWO modules (src/a.ts, src/b.ts) with a high-risk AC; F-ddd444
// depends on it. Two distinct owned files under ONE focus → distinct fingerprints.
const SPEC_MULTI = [
  'schema: "0.1"',
  'project: {name: t, language: typescript}',
  'features:',
  '  - id: F-ccc333',
  '    slug: multi',
  '    title: multi',
  '    status: done',
  '    modules: [src/a.ts, src/b.ts]',
  '    acceptance_criteria:',
  '      - id: AC-001',
  '        ears: unwanted',
  '        text: t',
  '  - id: F-ddd444',
  '    slug: dep',
  '    title: dep',
  '    status: done',
  '    depends_on: [F-ccc333]',
  '    modules: [src/dep.ts]',
  '    acceptance_criteria:',
  '      - id: AC-002',
  '        ears: ubiquitous',
  '        text: t',
  '',
].join('\n');

let cwd: string;

function seed(spec: string): void {
  writeFileSync(join(cwd, 'spec.yaml'), spec, 'utf8');
}
function stampPath(): string {
  return join(cwd, '.cladding', 'hook-drift-ts');
}
function clearStamp(): void {
  rmSync(stampPath(), {force: true});
}
function ledgerPath(): string {
  return join(cwd, '.cladding', 'hook-push-ledger.json');
}
function writeLedger(led: Record<string, unknown>): void {
  mkdirSync(join(cwd, '.cladding'), {recursive: true});
  writeFileSync(ledgerPath(), JSON.stringify(led), 'utf8');
}
function readLedger(): {est_tokens_pushed: number; notice_printed: boolean; sessionKey: string; fingerprints: Record<string, number>} {
  return JSON.parse(readFileSync(ledgerPath(), 'utf8'));
}
function edit(file: string, n = 60, sessionId?: string): Record<string, unknown> {
  return {
    tool_name: 'Edit',
    tool_input: {file_path: file, new_string: 'x'.repeat(n)},
    ...(sessionId ? {session_id: sessionId} : {}),
  };
}
function post(input: unknown): string {
  return runHookEvent('PostToolUse', input, cwd);
}
function skips(reason?: string) {
  return readEvents(cwd).filter(
    (e) => e.type === 'impact_card_skipped' && (reason === undefined || e.payload.reason === reason),
  );
}
function fired() {
  return readEvents(cwd).filter((e) => e.type === 'impact_card_fired');
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-push-'));
  driftStub.mockImplementation(() => DRIFT_CLEAN);
  archStub.mockImplementation(() => STAGE_PASS);
  secretStub.mockImplementation(() => STAGE_PASS);
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

// ─── AC-816f10c3 — Tier-2 render + fired tier:2 + accurate counts ───

describe('Tier-2 card on an owned edit with consequences (AC-816f10c3)', () => {
  test('renders a bounded Tier-2 card naming impacted/tests/risk; fired carries tier:2 + counts', () => {
    seed(SPEC_A);
    clearStamp();
    const out = post(edit('src/foo.ts', 60, 'sess-1'));

    const lines = out.split('\n');
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(out.length).toBeLessThanOrEqual(600);
    // line 1: the one-liner — focus id + title, human-first consequence wording (F-f46d5c61)
    expect(lines[0]).toBe('cladding impact: src/foo.ts → F-aaa111 alpha · 1 feature depends on this · 1 test guards it');
    // detail lines name the impacted id, the test path, and the high-risk AC count
    expect(out).toContain('breaks: F-bbb222 beta');
    expect(out).toContain('run: tests/foo.test.ts');
    expect(out).toContain('risk: 1 high-risk AC(s), first AC-001');

    const f = fired();
    expect(f).toHaveLength(1);
    expect(f[0].payload).toMatchObject({file: 'src/foo.ts', feature: 'F-aaa111', impacted: 1, tests: 1, tier: 2});
  });
});

// ─── AC-1bfccb6b — no code excerpt body ever reaches stdout ───

describe('hook stdout never carries a code excerpt (AC-1bfccb6b)', () => {
  test('even when the edited module is large, the pushed card contains no source/clip marker', () => {
    seed(SPEC_A);
    mkdirSync(join(cwd, 'src'), {recursive: true});
    const SENTINEL = 'SENTINEL_HOOK_CODE_LEAK';
    writeFileSync(join(cwd, 'src', 'foo.ts'), `// ${SENTINEL}\n`.repeat(4000), 'utf8'); // large module
    clearStamp();
    const out = post(edit('src/foo.ts', 60, 'sess-2'));
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111'); // a card DID fire
    expect(out).not.toContain(SENTINEL); // ...but no code body
    expect(out).not.toContain('clipped');
    expect(out).not.toContain('```');
  });
});

// ─── AC-f912fd40 — zero consequences → the Tier-1 one-liner ───

describe('zero-consequence edit degrades to the one-liner (AC-f912fd40)', () => {
  test('degrade shares the legacy card, plus the focus TITLE the data-poor slice lacks (F-f46d5c61); fired tier:1', () => {
    seed(SPEC_SOLO);
    clearStamp();
    const out = post(edit('src/solo.ts', 60, 'sess-3'));

    // Compute the legacy expectation independently from the same spec. The impact
    // slice for a MODULE query carries only owner ids, so the legacy card is id-only;
    // the working set the hook actually renders enriches it with the focus title.
    const slice = buildImpactSlice(loadSpec(cwd), 'src/solo.ts');
    if ('not_found' in slice) throw new Error('fixture should resolve the module owner');
    const legacy = formatImpactCard(slice, 'src/solo.ts');
    expect(legacy).toBe('cladding impact: src/solo.ts → F-501010 · dependency map not yet recorded');
    expect(out).toBe('cladding impact: src/solo.ts → F-501010 solo · dependency map not yet recorded');

    expect(out).toContain('· dependency map not yet recorded'); // the disclosure survives the degrade
    expect(out).not.toContain('\n'); // a single line — no consequence detail lines

    const f = fired();
    expect(f).toHaveLength(1);
    expect(f[0].payload.tier).toBe(1);
  });
});

// ─── AC-61ae9211 — the dedup ladder ───

describe('dedup ladder within a session (AC-61ae9211)', () => {
  test('same (focus,file) 3×: Tier-2 → Tier-1 → silence, recording dedup on repeats 2 and 3', () => {
    seed(SPEC_MULTI);
    const sid = 'sess-dedup';

    clearStamp();
    const first = post(edit('src/a.ts', 60, sid));
    expect(first).toContain('risk: 1 high-risk AC(s)'); // Tier-2 (multi-line)
    expect(first).toContain('breaks: F-ddd444');

    clearStamp();
    const second = post(edit('src/a.ts', 60, sid));
    expect(second).toBe('cladding impact: src/a.ts → F-ccc333 multi · 1 feature depends on this'); // Tier-1 degrade
    expect(second).not.toContain('risk:');

    clearStamp();
    const third = post(edit('src/a.ts', 60, sid));
    expect(third).toBe(''); // silence from the third repeat

    // dedup recorded on BOTH the degraded and the silenced repeat
    expect(skips('dedup')).toHaveLength(2);
    // exactly one card fired for this (focus,file), and it was Tier-2
    const firedForA = fired();
    expect(firedForA).toHaveLength(1);
    expect(firedForA[0].payload.tier).toBe(2);
  });

  test('a different file under the same focus is a fresh Tier-2', () => {
    seed(SPEC_MULTI);
    const sid = 'sess-freshfile';

    clearStamp();
    post(edit('src/a.ts', 60, sid)); // first fingerprint → Tier-2
    clearStamp();
    const other = post(edit('src/b.ts', 60, sid)); // different rel → fresh fingerprint

    expect(other).toContain('risk: 1 high-risk AC(s)'); // fresh Tier-2, not a degrade
    expect(fired()).toHaveLength(2);
    expect(fired().every((e) => e.payload.tier === 2)).toBe(true);
    expect(skips('dedup')).toHaveLength(0); // neither edit was a repeat
  });
});

// ─── AC-f4715e87 — the session push budget ───

describe('session push budget exhaustion (AC-f4715e87)', () => {
  test('over budget → no card, notice exactly once, ledger_exhausted each time, budget not spent by the notice', () => {
    seed(SPEC_A);
    const sid = 'sess-budget';
    writeLedger({sessionKey: `sid:${sid}`, windowStart: Date.now(), est_tokens_pushed: 2600, fingerprints: {}, notice_printed: false});

    clearStamp();
    const first = post(edit('src/foo.ts', 60, sid));
    expect(first).toBe('cladding: push budget exhausted this session'); // the one-time notice

    clearStamp();
    const second = post(edit('src/foo.ts', 60, sid));
    expect(second).toBe(''); // notice already printed → silence

    // both suppressions recorded as ledger_exhausted
    expect(skips('ledger_exhausted')).toHaveLength(2);
    // no Tier-2/Tier-1 card fired at all
    expect(fired()).toHaveLength(0);
    // the notice did NOT spend budget
    expect(readLedger().est_tokens_pushed).toBe(2600);
  });

  test('a fresh session (new session_id) resets the budget → cards fire again', () => {
    seed(SPEC_A);
    writeLedger({sessionKey: 'sid:old', windowStart: Date.now(), est_tokens_pushed: 2600, fingerprints: {}, notice_printed: true});

    clearStamp();
    const out = post(edit('src/foo.ts', 60, 'brand-new-session'));
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111'); // budget reset → a card
    expect(out).toContain('risk:'); // and it is a full Tier-2
    const f = fired();
    expect(f).toHaveLength(1);
    expect(f[0].payload.tier).toBe(2);
  });
});

// ─── ledger robustness (item 7) ───

describe('push ledger robustness', () => {
  test('a corrupt ledger json → fresh start, no throw, card still fires', () => {
    seed(SPEC_A);
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(ledgerPath(), 'not-json{{', 'utf8');
    clearStamp();
    let out = '';
    expect(() => {
      out = post(edit('src/foo.ts', 60, 'sess-corrupt'));
    }).not.toThrow();
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    expect(out).toContain('risk:'); // fresh ledger → full Tier-2
  });

  test('a 30-min window rollover (no session_id) resets budget AND fingerprints', () => {
    seed(SPEC_A);
    // Pre-seed an EXHAUSTED, already-seen window whose start is 31 minutes ago.
    const thirtyOneMinAgo = Date.now() - 31 * 60 * 1000;
    writeLedger({
      sessionKey: 'win',
      windowStart: thirtyOneMinAgo,
      est_tokens_pushed: 2600, // over budget in the old window
      fingerprints: {'post_tool_use|F-aaa111|src/foo.ts': 5}, // already silenced in the old window
      notice_printed: true,
    });
    clearStamp();
    const out = post(edit('src/foo.ts', 60)); // NO session_id → windowed key
    // A card at all proves budget reset; a full Tier-2 proves the fingerprint reset too
    // (an unreset fingerprint of 5 would have silenced it).
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    expect(out).toContain('risk:');
    expect(fired()).toHaveLength(1);
  });
});
