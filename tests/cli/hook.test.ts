// Cladding · `clad hook <event>` protocol adapter (F-1d23a6)
//
// Drives runHookEvent as a FUNCTION — no host, no subprocess. The
// deterministic trio (drift / arch / secret) is stubbed per the
// gate-golden-matrix pattern so Stop/PostToolUse cases never spawn a
// toolchain; everything else runs against a throwaway fixture dir.

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
const {appendEvent, newEvent, readEvents} = await import('../../src/events/log.js');

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-hook-'));
  driftStub.mockImplementation(() => DRIFT_CLEAN);
  archStub.mockImplementation(() => STAGE_PASS);
  secretStub.mockImplementation(() => STAGE_PASS);
});

afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

/** Seeds a cladding project: spec.yaml (inventory) + generated index.yaml. */
function seedProject(): void {
  writeFileSync(
    join(cwd, 'spec.yaml'),
    [
      'schema: "0.1"',
      'project:',
      '  name: fixture',
      '',
      'inventory:',
      '  features: 3',
      '  scenarios: 2',
      '  capabilities: 0',
      '  test_files: 1',
      '  last_synced: "2026-06-10"',
      '',
    ].join('\n'),
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
}

describe('SessionStart — context card', () => {
  test('full card: index counts + in-progress list + last gate + stop-block + tools + policy line', () => {
    seedProject();
    appendEvent(
      cwd,
      newEvent('gate_run', {tier: 'pre-push', strict: true, worst: 0, anyFailed: false, head: 'abcdef1234567890'}),
    );
    writeFileSync(
      join(cwd, '.cladding', 'stop-block.json'),
      JSON.stringify({fingerprint: 'f'.repeat(64), count: 2, first: 'AC_DRIFT'}),
      'utf8',
    );
    const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
    expect(lines[0]).toBe('cladding: 3 features (1 done, 1 in progress) · 2 scenarios');
    expect(lines[1]).toBe('in progress: F-bbb222 beta');
    expect(lines[2]).toBe('last gate: pre-push strict=true → GREEN @ abcdef12');
    expect(lines[3]).toBe('unresolved stop-block: 2 finding(s) — An acceptance criterion is incomplete or out of sync with the spec');
    // context capability line precedes policy; no ai_hints → no prefer lines. Both lines are
    // plain English with NO MCP tool names / no "shard" / no "SSoT" (F-f46d5c61, AC-2c63b999).
    expect(lines[4]).toBe(
      'context: before a non-trivial change, cladding can slice what a feature needs, what depends on it, and which tests guard it — ask for it',
    );
    expect(lines[5]).toBe(
      "policy: the spec is the source of truth — features are created and completed through cladding's verified flow",
    );
    expect(lines).toHaveLength(6);
  });

  test('a RED gate_run renders as RED', () => {
    seedProject();
    appendEvent(cwd, newEvent('gate_run', {tier: 'pre-commit', strict: false, worst: 1, anyFailed: true, head: '1234abcd9999'}));
    expect(runHookEvent('SessionStart', {}, cwd)).toContain('last gate: pre-commit strict=false → RED @ 1234abcd');
  });

  test('prints nothing without spec.yaml', () => {
    expect(runHookEvent('SessionStart', {}, cwd)).toBe('');
  });
});

describe('UserPromptSubmit — one-line routing suggestion', () => {
  test("'add a login feature' → suggestion line naming run + the feature cycle", () => {
    const out = runHookEvent('UserPromptSubmit', {prompt: 'add a login feature'}, cwd);
    expect(out).toBe('cladding: this looks like run work — feature cycle: spec entry → implement → tests → clad done');
  });

  test("'explain how auth works' → empty (no suggestion, no noise)", () => {
    expect(runHookEvent('UserPromptSubmit', {prompt: 'explain how auth works'}, cwd)).toBe('');
  });

  // F-95a096 — a completion CLAIM gets the earn-path card, not an intent route.
  // "done" must be earned through the gate; the card points at `clad done`.
  const EARN_CARD =
    'cladding: completion is EARNED, not declared — run `clad done <F-id>`; ' +
    'the strict gate flips it to done only when the checks pass';

  test("'looks done, wrap it up' → earn-path card naming clad done", () => {
    expect(runHookEvent('UserPromptSubmit', {prompt: 'looks done, wrap it up'}, cwd)).toBe(EARN_CARD);
  });

  test('Korean completion claim (마무리하고 완료 처리해줘) → same card', () => {
    expect(runHookEvent('UserPromptSubmit', {prompt: '마무리하고 완료 처리해줘'}, cwd)).toBe(EARN_CARD);
  });

  test('the claim card wins over intent routing when both would match', () => {
    // 'mark the auth feature done' also smells like run work; the claim card
    // must take precedence (the early return) or the earn-path nudge is lost.
    expect(runHookEvent('UserPromptSubmit', {prompt: 'mark the auth feature done'}, cwd)).toBe(EARN_CARD);
  });

  test("negative control: 'add a finished-goods inventory feature' is NOT a claim", () => {
    const out = runHookEvent('UserPromptSubmit', {prompt: 'add a finished-goods inventory feature'}, cwd);
    expect(out).not.toContain('EARNED');
  });
});

describe('PreToolUse — structural guard on spec edits', () => {
  const SHARD = 'spec/features/x-abc123.yaml';

  test('Edit flipping status to done → block naming clad done', () => {
    const out = runHookEvent(
      'PreToolUse',
      {tool_name: 'Edit', tool_input: {file_path: SHARD, old_string: 'status: in_progress', new_string: 'status: done'}},
      cwd,
    );
    const doc = JSON.parse(out) as {decision: string; reason: string};
    expect(doc.decision).toBe('block');
    expect(doc.reason).toContain('clad done');
  });

  test('Edit where old_string already had status: done → allow (not a flip)', () => {
    const out = runHookEvent(
      'PreToolUse',
      {
        tool_name: 'Edit',
        tool_input: {file_path: SHARD, old_string: 'status: done\ntitle: a', new_string: 'status: done\ntitle: b'},
      },
      cwd,
    );
    expect(out).toBe('');
  });

  test('Write of a new shard carrying status: done absent on disk → block', () => {
    const out = runHookEvent(
      'PreToolUse',
      {
        tool_name: 'Write',
        tool_input: {file_path: join(cwd, 'spec/features/y-def456.yaml'), content: 'id: F-def456\nstatus: done\n'},
      },
      cwd,
    );
    expect((JSON.parse(out) as {decision: string}).decision).toBe('block');
  });

  test('Write rewriting a shard that ALREADY says done on disk → allow', () => {
    mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
    writeFileSync(join(cwd, 'spec/features/z-aaa999.yaml'), 'id: F-aaa999\nstatus: done\ntitle: old\n', 'utf8');
    const out = runHookEvent(
      'PreToolUse',
      {
        tool_name: 'Write',
        tool_input: {file_path: join(cwd, 'spec/features/z-aaa999.yaml'), content: 'id: F-aaa999\nstatus: done\ntitle: new\n'},
      },
      cwd,
    );
    expect(out).toBe('');
  });

  test('Write creating a sequential F-NNN filename → block with the hash-id reason', () => {
    const out = runHookEvent(
      'PreToolUse',
      {tool_name: 'Write', tool_input: {file_path: 'spec/features/F-001.yaml', content: 'id: F-001\nstatus: planned\n'}},
      cwd,
    );
    const doc = JSON.parse(out) as {decision: string; reason: string};
    expect(doc.decision).toBe('block');
    expect(doc.reason).toBe(
      'cladding assigns feature ids safely — ask it to create the spec entry instead of hand-writing the file',
    );
  });

  test('MultiEdit with one done-flipping entry → block', () => {
    const out = runHookEvent(
      'PreToolUse',
      {
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: SHARD,
          edits: [
            {old_string: 'title: a', new_string: 'title: b'},
            {old_string: 'status: in_progress', new_string: 'status: done'},
          ],
        },
      },
      cwd,
    );
    expect((JSON.parse(out) as {decision: string}).decision).toBe('block');
  });

  test('Edit touching only the title → allow (empty output)', () => {
    const out = runHookEvent(
      'PreToolUse',
      {tool_name: 'Edit', tool_input: {file_path: SHARD, old_string: 'title: a', new_string: 'title: b'}},
      cwd,
    );
    expect(out).toBe('');
  });

  test('done-flip in a NON-spec file → allow (guard is spec-scoped)', () => {
    const out = runHookEvent(
      'PreToolUse',
      {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts', old_string: 'a', new_string: 'status: done'}},
      cwd,
    );
    expect(out).toBe('');
  });
});

describe('Stop — deterministic trio with fingerprint-keyed demotion', () => {
  // The Stop gate only runs under cladding (F-c6a32fff): seed the master file.
  // Render is English by construction (F-9af291fa) — these string pins are
  // deterministic regardless of the developer's LANG.
  beforeEach(() => {
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
  });

  const TWO_FINDINGS: DriftReport = {
    pass: false,
    exitCode: 1,
    findings: [
      {detector: 'AC_DRIFT', severity: 'error', path: 'spec/features/x.yaml', message: 'AC mismatch'},
      {detector: 'MISSING_TESTS', severity: 'warn', path: 'spec/features/y.yaml', message: 'no tests declared'},
      {detector: 'ORPHAN_FEATURE', severity: 'info', path: 'spec/features/z.yaml', message: 'info never blocks'},
    ],
  };

  test('stop_hook_active: true → empty (never re-enter)', () => {
    expect(runHookEvent('Stop', {stop_hook_active: true}, cwd)).toBe('');
    expect(driftStub).not.toHaveBeenCalled();
  });

  test('fresh failure → block JSON + stop-block.json written + stop_blocked event', () => {
    driftStub.mockImplementation(() => TWO_FINDINGS);
    const out = runHookEvent('Stop', {stop_hook_active: false}, cwd);
    const doc = JSON.parse(out) as {decision: string; reason: string};
    expect(doc.decision).toBe('block');
    expect(doc.reason).toContain('cladding paused before finishing: 2 things');
    // Plain-first render (F-dd8dc994): plain lead leads, machine detail demoted
    // to the (detector · path) tail — which stays language-neutral.
    expect(doc.reason).toContain('(AC_DRIFT · spec/features/x.yaml)');
    expect(doc.reason).toContain('(MISSING_TESTS · spec/features/y.yaml)');
    const sb = JSON.parse(readFileSync(join(cwd, '.cladding', 'stop-block.json'), 'utf8')) as {
      fingerprint: string;
      count: number;
      first: string;
    };
    expect(sb.count).toBe(2);
    expect(sb.first).toBe('AC_DRIFT');
    expect(sb.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const blocked = readEvents(cwd).filter((e) => e.type === 'stop_blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].payload.count).toBe(2);
    expect(blocked[0].payload.fingerprint).toBe(sb.fingerprint);
  });

  test('identical second run → empty (demoted; no second stop_blocked event)', () => {
    driftStub.mockImplementation(() => TWO_FINDINGS);
    expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).not.toBe('');
    expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).toBe('');
    expect(readEvents(cwd).filter((e) => e.type === 'stop_blocked')).toHaveLength(1);
  });

  test('a DIFFERENT failure set re-blocks (fingerprint changed)', () => {
    driftStub.mockImplementation(() => TWO_FINDINGS);
    expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).not.toBe('');
    driftStub.mockImplementation(() => ({
      pass: false,
      exitCode: 1,
      findings: [{detector: 'HARNESS_INTEGRITY', severity: 'error', path: 'plugin.json', message: 'fresh breakage'}],
    }));
    const out = runHookEvent('Stop', {stop_hook_active: false}, cwd);
    expect((JSON.parse(out) as {decision: string}).decision).toBe('block');
  });

  test('clean run → empty and the persisted stop-block.json is removed', () => {
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'stop-block.json'), JSON.stringify({fingerprint: 'old', count: 1, first: 'X'}), 'utf8');
    expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).toBe('');
    expect(existsSync(join(cwd, '.cladding', 'stop-block.json'))).toBe(false);
  });

  test('arch/secret stage failures contribute as ARCH/SECRET findings', () => {
    archStub.mockImplementation(() => ({pass: false, exitCode: 1, stderr: 'layer breach: cli → detectors'}));
    const out = runHookEvent('Stop', {stop_hook_active: false}, cwd);
    const doc = JSON.parse(out) as {reason: string};
    expect(doc.reason).toContain('cladding paused before finishing: 1 thing');
    // A synthetic ARCH finding has no catalog row → the raw stderr is the lead,
    // with the (detector · path) tail (F-dd8dc994).
    expect(doc.reason).toContain('layer breach: cli → detectors (ARCH · stage)');
    const sb = JSON.parse(readFileSync(join(cwd, '.cladding', 'stop-block.json'), 'utf8')) as {first: string};
    expect(sb.first).toBe('ARCH');
  });
});

describe('PostToolUse — debounced drift nudge', () => {
  // Drift nudges only run under cladding (F-c6a32fff): seed the master file.
  // Render is English by construction (F-9af291fa).
  beforeEach(() => {
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
  });

  const ONE_ERROR: DriftReport = {
    pass: false,
    exitCode: 1,
    findings: [{detector: 'AC_DRIFT', severity: 'error', message: 'spec/code mismatch in foo'}],
  };
  const EDIT_SRC = {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts'}};

  test('error findings surface as one line; a second call inside the window is debounced empty', () => {
    driftStub.mockImplementation(() => ONE_ERROR);
    // Plain-first render (F-dd8dc994): the catalog lead leads; the detector id is
    // demoted to a `(details: …)` tail; the count is preserved.
    expect(runHookEvent('PostToolUse', EDIT_SRC, cwd)).toBe(
      'cladding drift: 1 error(s) — An acceptance criterion is incomplete or out of sync with the spec (details: AC_DRIFT)',
    );
    expect(runHookEvent('PostToolUse', EDIT_SRC, cwd)).toBe('');
    expect(driftStub).toHaveBeenCalledTimes(1);
  });

  test('clean drift → empty output (but the run happened)', () => {
    expect(runHookEvent('PostToolUse', EDIT_SRC, cwd)).toBe('');
    expect(driftStub).toHaveBeenCalledTimes(1);
  });

  test('non-source files and non-write tools never trigger a drift run', () => {
    expect(runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: 'docs/readme.md'}}, cwd)).toBe('');
    expect(runHookEvent('PostToolUse', {tool_name: 'Bash', tool_input: {command: 'ls'}}, cwd)).toBe('');
    expect(driftStub).not.toHaveBeenCalled();
  });

  test('impact card fires for a host-style ABSOLUTE file_path and shows the repo-relative path', () => {
    // v0.7.0 regression: hosts send tool_input.file_path absolute while the
    // module index keys are repo-relative — the card never rendered in real
    // usage (0/361 on cladding-self). Locks the relativization seam.
    writeFileSync(
      join(cwd, 'spec.yaml'),
      [
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
        '      - id: AC-001',
        '        ears: ubiquitous',
        '        text: t',
        '',
      ].join('\n'),
      'utf8',
    );
    const out = runHookEvent(
      'PostToolUse',
      {tool_name: 'Edit', tool_input: {file_path: join(cwd, 'src/foo.ts'), new_string: 'x'.repeat(50)}},
      cwd,
    );
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    // Human-first consequence wording + the focus title (F-f46d5c61).
    expect(out).toContain('F-aaa111 alpha'); // id + title, not a bare id
    expect(out).toContain('1 feature depends on this');
    expect(out).toContain('1 test guards it');
  });
});

describe('fallback safety — a spec-less cwd is not ours to gate (F-c6a32fff)', () => {
  // v0.7.0 regression, reproduced with the shipped bundle: in a non-cladding
  // repo (or a monorepo SUBDIR — the hook cwd is process.cwd()) the Stop hook
  // falsely BLOCKED with ABSENCE_OF_GOVERNANCE and wrote .cladding/ state into
  // a tree that never adopted cladding. These run UNSTUBBED-equivalent: the
  // guard must fire before runDrift, so the stubs must never be called.
  test('Stop in a spec-less cwd → silence, no drift run, no .cladding/ writes', () => {
    expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).toBe('');
    expect(driftStub).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.cladding'))).toBe(false);
  });

  test('PostToolUse in a spec-less cwd → silence, no drift run, no stamp write', () => {
    const out = runHookEvent(
      'PostToolUse',
      {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts', new_string: 'x'.repeat(50)}},
      cwd,
    );
    expect(out).toBe('');
    expect(driftStub).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.cladding'))).toBe(false);
  });

  test('SessionStart over an unparseable spec with no other count source → honest counts-unavailable line', () => {
    writeFileSync(join(cwd, 'spec.yaml'), 'features:\n  - id: F-x\n   badly: indented\n', 'utf8');
    const out = runHookEvent('SessionStart', {}, cwd);
    expect(out).toContain('spec.yaml present but unparseable — counts unavailable');
    expect(out).not.toContain('0 features');
  });

  test('SessionStart over an unparseable spec WITH a healthy index → real counts, no false alarm', () => {
    writeFileSync(join(cwd, 'spec.yaml'), 'features:\n  - id: F-x\n   badly: indented\n', 'utf8');
    mkdirSync(join(cwd, 'spec'), {recursive: true});
    writeFileSync(
      join(cwd, 'spec', 'index.yaml'),
      '# Cladding · Tier C\nfeatures:\n  F-aaa111: {slug: alpha, status: done, modules: 1}\n',
      'utf8',
    );
    const out = runHookEvent('SessionStart', {}, cwd);
    expect(out).toContain('cladding: 1 features (1 done, 0 in progress)');
    expect(out).not.toContain('unparseable');
  });
});

describe('protocol resilience', () => {
  test('unknown events and malformed inputs degrade to silence, never throw', () => {
    expect(runHookEvent('SubagentStop', {}, cwd)).toBe('');
    expect(runHookEvent('PreToolUse', null, cwd)).toBe('');
    expect(runHookEvent('PreToolUse', {tool_name: 'Edit', tool_input: 'not-an-object'}, cwd)).toBe('');
    expect(runHookEvent('UserPromptSubmit', {prompt: 42}, cwd)).toBe('');
  });
});
