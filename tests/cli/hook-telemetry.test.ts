// Cladding · F-6ba22c5c — value-delivery telemetry emitted by the host hook.
//
// Drives runHookEvent as a FUNCTION (no host, no subprocess). drift/arch/secret
// are stubbed per the gate-golden-matrix pattern so PostToolUse never spawns a
// toolchain; the impact-slice + telemetry paths run for real against a throwaway
// fixture dir.
//
// Covers:
//   AC-373257b2  event↔output bijection (one impact_card_fired per printed card,
//                accurate payload; SessionStart / UserPromptSubmit emission)
//   AC-8fc6bea0  the two high-frequency reasons aggregate into ≤1 event/window
//   AC-e9d041de  observer-only: a telemetry failure leaves stdout unchanged;
//                a spec-less cwd gets no .cladding/ writes
//   accounting   every PostToolUse input is accounted for exactly once
//   regression   an absolute host path resolves (fired) or records owner_miss

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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

const {runHookEvent} = await import('../../src/cli/hook.js');
const {readEvents} = await import('../../src/events/log.js');
const {summarizeValueDelivery} = await import('../../src/events/session-report.js');

// A valid spec: F-aaa111 owns src/foo.ts (+ a test_ref), F-bbb222 depends on it
// so an edit to src/foo.ts has "1 feature depends on this · 1 test guards it" and fires a card.
const VALID_SPEC = [
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
  '        ears: ubiquitous',
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

// Parses as YAML but fails schema validation (no schema/project) → loadSpec throws.
const INVALID_SPEC = 'unrelated: true\n';

let cwd: string;

function stamp(): string {
  return join(cwd, '.cladding', 'hook-drift-ts');
}
function clearStamp(): void {
  rmSync(stamp(), {force: true});
}
// F-35954d19: the session push governor dedups a repeated (focus,file) card. The
// accounting corpus intentionally re-fires the SAME owned file, so clear the ledger
// between fired edits to isolate the per-edit firing (analogous to clearStamp for debounce).
function clearPushLedger(): void {
  rmSync(join(cwd, '.cladding', 'hook-push-ledger.json'), {force: true});
}
function freshStamp(): void {
  mkdirSync(join(cwd, '.cladding'), {recursive: true});
  writeFileSync(stamp(), String(Date.now()), 'utf8');
}
function post(input: unknown): string {
  return runHookEvent('PostToolUse', input, cwd);
}
function skips(reason?: string) {
  return readEvents(cwd).filter(
    (e) => e.type === 'impact_card_skipped' && (reason === undefined || e.payload.reason === reason),
  );
}
function sidecar(): {windowStart?: number; not_write_tool: number; unwatched_path: number} {
  return JSON.parse(readFileSync(join(cwd, '.cladding', 'hook-skip-agg.json'), 'utf8'));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-vt-hook-'));
  driftStub.mockImplementation(() => DRIFT_CLEAN);
  archStub.mockImplementation(() => STAGE_PASS);
  secretStub.mockImplementation(() => STAGE_PASS);
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

// ─── accounting completeness — the key property (AC-2 / AC-373257b2) ───

describe('PostToolUse telemetry — accounting completeness', () => {
  // Category → one PostToolUse input. The corpus below spans EVERY emitting
  // degrade branch of runPostToolUseDrift plus the fired path.
  const notWrite = () => ({tool_name: 'Read', tool_input: {file_path: 'src/foo.ts'}});
  const unwatched = () => ({tool_name: 'Edit', tool_input: {file_path: 'docs/readme.md', new_string: 'x'}});
  const sourceEdit = (file: string, n: number) => ({tool_name: 'Edit', tool_input: {file_path: file, new_string: 'x'.repeat(n)}});

  test('≥200 inputs across all 7 branches → fired + per-occ skips + aggregate counts == total, 0 unaccounted', () => {
    writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8');
    const N = {not_write: 40, unwatched: 35, debounced: 30, trivial: 30, owner_miss: 30, fired: 20, spec_unreadable: 15};
    const total = Object.values(N).reduce((a, b) => a + b, 0);
    expect(total).toBe(200);

    let cardsPrinted = 0;

    // 1) high-frequency aggregated reasons (return before the debounce gate)
    for (let i = 0; i < N.not_write; i++) expect(post(notWrite())).toBe('');
    for (let i = 0; i < N.unwatched; i++) expect(post(unwatched())).toBe('');
    // 2) debounced — a fresh stamp forces the in-window skip
    for (let i = 0; i < N.debounced; i++) {
      freshStamp();
      expect(post(sourceEdit('src/foo.ts', 60))).toBe('');
    }
    // 3) trivial — under MIN_EDIT_CHARS (40); clear the stamp so it passes debounce
    for (let i = 0; i < N.trivial; i++) {
      clearStamp();
      expect(post(sourceEdit('src/foo.ts', 10))).toBe('');
    }
    // 4) owner_miss — a watched source path owned by no feature
    for (let i = 0; i < N.owner_miss; i++) {
      clearStamp();
      expect(post(sourceEdit('src/orphan.ts', 60))).toBe('');
    }
    // 5) fired — an owned module, substantive edit; the FIRST fired flushes the
    //    accumulated aggregate window into one event (pending → 0)
    for (let i = 0; i < N.fired; i++) {
      clearStamp();
      clearPushLedger();
      const out = post(sourceEdit('src/foo.ts', 60));
      expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
      cardsPrinted++;
    }
    // 6) spec_unreadable — corrupt the spec so loadSpec throws (still under cladding)
    writeFileSync(join(cwd, 'spec.yaml'), INVALID_SPEC, 'utf8');
    for (let i = 0; i < N.spec_unreadable; i++) {
      clearStamp();
      expect(post(sourceEdit('src/foo.ts', 60))).toBe('');
    }

    const events = readEvents(cwd);
    const firedEvents = events.filter((e) => e.type === 'impact_card_fired').length;
    const perOccSkips = events.filter((e) => e.type === 'impact_card_skipped' && e.payload.aggregate !== true).length;
    const aggEventCounts = events
      .filter((e) => e.type === 'impact_card_skipped' && e.payload.aggregate === true)
      .reduce((sum, e) => {
        const c = e.payload.counts as {not_write_tool?: number; unwatched_path?: number};
        return sum + (c.not_write_tool ?? 0) + (c.unwatched_path ?? 0);
      }, 0);
    const pending = existsSync(join(cwd, '.cladding', 'hook-skip-agg.json'))
      ? sidecar().not_write_tool + sidecar().unwatched_path
      : 0;

    // Every one of the 200 inputs is accounted for exactly once, nothing lost.
    expect(firedEvents).toBe(N.fired);
    expect(perOccSkips).toBe(N.debounced + N.trivial + N.owner_miss + N.spec_unreadable); // 105
    expect(pending).toBe(0); // the last fired flushed the aggregate window
    expect(firedEvents + perOccSkips + aggEventCounts + pending).toBe(total);

    // one impact_card_fired per printed card
    expect(firedEvents).toBe(cardsPrinted);

    // per-reason histogram reflects the corpus exactly
    const s = summarizeValueDelivery(events);
    expect(s.byReason).toEqual({
      not_write_tool: N.not_write,
      unwatched_path: N.unwatched,
      debounced: N.debounced,
      trivial_edit: N.trivial,
      owner_miss: N.owner_miss,
      spec_unreadable: N.spec_unreadable,
    });
    // eligible = fired + substantive skips (excludes not_write_tool / unwatched_path)
    expect(s.eligible).toBe(N.fired + N.debounced + N.trivial + N.owner_miss + N.spec_unreadable);
    expect(s.firedPct).toBe(Math.round((N.fired / s.eligible) * 1000) / 1000);
  });

  test('impact_card_fired payload mirrors the printed card (file, feature, impacted, tests, unledgered)', () => {
    writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8');
    clearStamp();
    const out = post(sourceEdit('src/foo.ts', 60));
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    expect(out).toContain('1 feature depends on this');
    expect(out).toContain('1 test guards it');
    const fired = readEvents(cwd).filter((e) => e.type === 'impact_card_fired');
    expect(fired).toHaveLength(1);
    expect(fired[0].payload).toMatchObject({file: 'src/foo.ts', feature: 'F-aaa111', impacted: 1, tests: 1, unledgered: false});
  });
});

// ─── regression re-enactment — absolute host paths (the 0.7.0 bug class) ───

describe('PostToolUse telemetry — absolute host paths', () => {
  const abs = (rel: string) => join(cwd, rel);
  const edit = (file: string) => ({tool_name: 'Edit', tool_input: {file_path: file, new_string: 'x'.repeat(60)}});

  test('an ABSOLUTE owned path resolves → fires a card + impact_card_fired (0.7.0 0/361 seam)', () => {
    writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8');
    clearStamp();
    const out = post(edit(abs('src/foo.ts')));
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    expect(readEvents(cwd).filter((e) => e.type === 'impact_card_fired')).toHaveLength(1);
  });

  test('an ABSOLUTE path owned by no feature → owner_miss (now ledger-visible, not a silent 0%)', () => {
    writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8');
    clearStamp();
    expect(post(edit(abs('src/orphan.ts')))).toBe('');
    const misses = skips('owner_miss');
    expect(misses).toHaveLength(1);
    expect(readEvents(cwd).some((e) => e.type === 'impact_card_fired')).toBe(false);
  });
});

// ─── aggregation windows (AC-8fc6bea0) ───

describe('PostToolUse telemetry — high-frequency skip aggregation', () => {
  const bash = () => ({tool_name: 'Bash', tool_input: {command: 'ls'}});
  const readmeEdit = () => ({tool_name: 'Edit', tool_input: {file_path: 'docs/readme.md', new_string: 'x'}});

  beforeEach(() => writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8'));

  test('two unwatched_path + one not_write_tool in one window → sidecar counts, NO per-occurrence events', () => {
    expect(post(readmeEdit())).toBe('');
    expect(post(readmeEdit())).toBe('');
    expect(post(bash())).toBe('');
    // accumulated in the sidecar, not emitted per call
    expect(sidecar()).toMatchObject({not_write_tool: 1, unwatched_path: 2});
    expect(skips()).toHaveLength(0);
  });

  test('window rollover → exactly ONE aggregate impact_card_skipped carrying the accumulated counts', () => {
    post(readmeEdit());
    post(readmeEdit());
    post(bash()); // sidecar: {not_write_tool:1, unwatched_path:2}
    // backdate the window past DRIFT_DEBOUNCE_MS so the next skip flushes it
    const agg = sidecar();
    writeFileSync(join(cwd, '.cladding', 'hook-skip-agg.json'), JSON.stringify({...agg, windowStart: 0}), 'utf8');

    post(readmeEdit()); // rollover: flush prev window, then start a fresh one at +1
    const emitted = skips();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.aggregate).toBe(true);
    expect(emitted[0].payload.counts).toEqual({not_write_tool: 1, unwatched_path: 2});
    // the fresh window carries only the post-rollover skip
    expect(sidecar()).toMatchObject({not_write_tool: 0, unwatched_path: 1});
  });

  test('a fired card flushes the pending aggregate window (≤1 event per window)', () => {
    post(readmeEdit());
    post(bash()); // sidecar: {not_write_tool:1, unwatched_path:1}
    clearStamp();
    const out = post({tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts', new_string: 'x'.repeat(60)}});
    expect(out).toContain('cladding impact:');
    // exactly one aggregate skip event (the flush on fire) + one fired event
    const emitted = skips();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.counts).toEqual({not_write_tool: 1, unwatched_path: 1});
    expect(sidecar()).toMatchObject({not_write_tool: 0, unwatched_path: 0});
  });

  test('a corrupt sidecar json → fresh window, never throws', () => {
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'hook-skip-agg.json'), 'not-json{{', 'utf8');
    expect(() => post(readmeEdit())).not.toThrow();
    expect(sidecar()).toMatchObject({not_write_tool: 0, unwatched_path: 1});
    expect(skips()).toHaveLength(0); // fresh window, nothing to flush
  });
});

// ─── SessionStart / UserPromptSubmit emission (AC-373257b2) ───

describe('SessionStart / UserPromptSubmit telemetry', () => {
  function seedProject(): void {
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n\ninventory:\n  features: 2\n  scenarios: 0\n', 'utf8');
    mkdirSync(join(cwd, 'spec'), {recursive: true});
    writeFileSync(
      join(cwd, 'spec', 'index.yaml'),
      'features:\n  F-aaa111: {slug: alpha, status: done, modules: 1}\n  F-bbb222: {slug: beta, status: in_progress, modules: 1}\n',
      'utf8',
    );
  }

  test('a non-empty SessionStart card → session_card_rendered with bytes == the card length', () => {
    seedProject();
    const out = runHookEvent('SessionStart', {}, cwd);
    expect(out.length).toBeGreaterThan(0);
    const rendered = readEvents(cwd).filter((e) => e.type === 'session_card_rendered');
    expect(rendered).toHaveLength(1);
    expect(rendered[0].payload.bytes).toBe(Buffer.byteLength(out, 'utf8'));
    expect(rendered[0].payload.bytes as number).toBeGreaterThan(0);
  });

  test('an empty SessionStart card (no spec) → no event, no .cladding/', () => {
    expect(runHookEvent('SessionStart', {}, cwd)).toBe('');
    expect(existsSync(join(cwd, '.cladding'))).toBe(false);
  });

  test('UserPromptSubmit kind bijection: completion claim → kind=completion; build request → kind=run', () => {
    runHookEvent('UserPromptSubmit', {prompt: 'looks done, wrap it up'}, cwd);
    runHookEvent('UserPromptSubmit', {prompt: 'add a login feature'}, cwd);
    const kinds = readEvents(cwd)
      .filter((e) => e.type === 'prompt_suggestion_served')
      .map((e) => e.payload.kind);
    expect(kinds).toEqual(['completion', 'run']);
  });

  test('an unclassifiable prompt → no suggestion, no event', () => {
    expect(runHookEvent('UserPromptSubmit', {prompt: 'explain how auth works'}, cwd)).toBe('');
    expect(readEvents(cwd).filter((e) => e.type === 'prompt_suggestion_served')).toHaveLength(0);
  });
});

// ─── observer-only (AC-e9d041de) + spec-less parity ───

describe('telemetry is observer-only', () => {
  const firedInput = {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts', new_string: 'x'.repeat(60)}};

  test('an unwritable ledger leaves the impact card byte-identical + never throws', () => {
    // Baseline: card in a normal writable project.
    const clean = mkdtempSync(join(tmpdir(), 'clad-vt-clean-'));
    writeFileSync(join(clean, 'spec.yaml'), VALID_SPEC, 'utf8');
    const expected = runHookEvent('PostToolUse', firedInput, clean);
    rmSync(clean, {recursive: true, force: true});

    // Sabotage: make `.cladding` a FILE so every append/mkdir under it throws
    // (deterministic regardless of uid — a chmod is a no-op under root).
    writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8');
    writeFileSync(join(cwd, '.cladding'), 'i am a file, not a dir', 'utf8');

    let out = '';
    expect(() => {
      out = runHookEvent('PostToolUse', firedInput, cwd);
    }).not.toThrow();
    expect(out).toBe(expected); // stdout unchanged by the telemetry failure
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    // and nothing was persisted (the sabotaged .cladding is still just a file)
    expect(readFileSync(join(cwd, '.cladding'), 'utf8')).toBe('i am a file, not a dir');
  });

  test('a spec-less cwd gets no telemetry + no .cladding/ (no_spec never emits)', () => {
    // PostToolUse on a source edit with NO spec.yaml → silence, no writes.
    expect(runHookEvent('PostToolUse', firedInput, cwd)).toBe('');
    expect(existsSync(join(cwd, '.cladding'))).toBe(false);
    expect(readEvents(cwd)).toHaveLength(0);
  });
});
