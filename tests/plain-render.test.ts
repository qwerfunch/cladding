// Cladding · unit tests · plain-first finding render + English catalog (F-dd8dc994, F-9af291fa)
//
// Sibling home: tests/ui/softShell.test.ts pins the PRE-EXISTING softShell
// exports (featureLabel/haltMessage/gateLabel); this file is the AC-owning
// suite for the plain-first-render surface the same module grew —
// DETECTOR_PLAIN, plainLead/plainFinding, and the three surface templates. It
// complements (does not duplicate) the existing-pin fallout already covered in
// tests/cli/hook.test.ts, hook-interactive-profile.test.ts, clad.test.ts, and
// done.test.ts.
//
// 2026-07-06 pivot (F-9af291fa): cladding no longer ships or resolves a locale.
// The catalog carries exactly ONE clear English string per detector; the host
// agent, directed by the interpreter instruction, renders the user's own
// language by meaning. The former locale-resolution priority-chain suite is
// gone — there is no locale machinery left to test.
//
// AC map (spec/features/plain-first-finding-render-dd8dc994.yaml):
//   AC-746969b3 — DETECTOR_PLAIN catalog completeness (English, no MCP names)
//   AC-263adf79 — plain lead first, machine detail demoted to a tail, per site
//   AC-25f77cec — machine tails stay language-neutral; no locale detection/storage
//   AC-ad2a34e1 — machine contracts (raw finding shape, stop-block fingerprint)
//                 stay byte-compatible
//
// One clarification worth recording: the ORIGINAL implementation brief
// (scratchpad/uxlang/U2-brief.md item 3) specifies a `(details: DETECTOR)`
// tail for the PostToolUse drift line ONLY — the Stop block's tail (via
// plainFinding) is `(DETECTOR · path)`. Both are asserted below, each on its
// own site; neither uses the other's format.
//
// The check-block render site (src/cli/clad.ts printStageDetails) has no
// exported template of its own (unlike the other three) — its literal format
// is pinned here via a source-text assertion.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {allDetectors} from '../src/stages/detectors/index.js';
import {missingImplementation} from '../src/stages/detectors/missing-implementation.js';
import {runDone} from '../src/cli/done.js';
import {TOOL_NAMES} from '../src/serve/server.js';
import {
  DETECTOR_PLAIN,
  doneRefusalLead,
  driftNudge,
  plainFinding,
  plainLead,
  stopBlockMessage,
} from '../src/ui/softShell.js';

const ROOT = process.cwd();

// ─── Stop / PostToolUse integration fixtures (mirrors tests/cli/hook.test.ts's
// drift/arch/secret stub pattern; a fresh, MINIMAL fixture — spec.yaml only,
// no index.yaml — since neither render site under test reads the index). ────

type StageResult = {pass: boolean; exitCode: number; stderr?: string};
type StubFinding = {detector: string; severity: 'error' | 'warn' | 'info'; path?: string; message: string};
type StubDriftReport = StageResult & {findings: StubFinding[]; skippedDetectors?: string[]};

const STAGE_PASS: StageResult = {pass: true, exitCode: 0};
const DRIFT_CLEAN: StubDriftReport = {pass: true, exitCode: 0, findings: []};

const driftStub = vi.fn((): StubDriftReport => DRIFT_CLEAN);
const archStub = vi.fn((): StageResult => STAGE_PASS);
const secretStub = vi.fn((): StageResult => STAGE_PASS);

vi.mock('../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => driftStub(...(a as []))}));
vi.mock('../src/stages/arch.js', () => ({runArch: (...a: unknown[]) => archStub(...(a as []))}));
vi.mock('../src/stages/secret.js', () => ({runSecret: (...a: unknown[]) => secretStub(...(a as []))}));

const {runHookEvent} = await import('../src/cli/hook.js');

// ─── AC-746969b3 — DETECTOR_PLAIN catalog completeness ─────────────────────

describe('DETECTOR_PLAIN catalog completeness (AC-746969b3)', () => {
  // Derived from the LIVE registry — never hardcode a detector list or count
  // here, so a 42nd detector fails THIS suite (missing row) instead of
  // shipping silently with no plain-language lead. 41 today; future-proof.
  const names = allDetectors.map((d) => d.name);

  test('the derivation is not vacuous: the live registry is non-empty with unique names', () => {
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every registered detector has a catalog row', () => {
    const missing = names.filter((n) => !(n in DETECTOR_PLAIN));
    expect(missing).toEqual([]);
  });

  test('the catalog carries no stale row for a detector that is no longer registered', () => {
    const extra = Object.keys(DETECTOR_PLAIN).filter((k) => !names.includes(k));
    expect(extra).toEqual([]);
  });

  test('every registered detector has a non-empty English lead', () => {
    for (const name of names) {
      const lead = DETECTOR_PLAIN[name].lead;
      expect(lead.trim().length, `${name}.lead`).toBeGreaterThan(0);
    }
  });

  test('no MCP tool name (or a clad_-shaped identifier) appears in any action string', () => {
    // Dynamic needles derived from the LIVE MCP registry (src/serve/server.ts
    // TOOL_NAMES) plus a broad clad_-shape regex — a future clad_* tool is
    // covered automatically, nothing to update here when one is added.
    const registryNeedles = TOOL_NAMES.flatMap((t) => [t, t.replace(/^clad_/, '')]);
    const mcpShapePattern = /\bclad_[a-z_]+/;
    for (const name of names) {
      const action = DETECTOR_PLAIN[name].action;
      if (!action) continue;
      expect(action, `${name}.action`).not.toMatch(mcpShapePattern);
      for (const needle of registryNeedles) {
        expect(action, `${name}.action should not name "${needle}"`).not.toContain(needle);
      }
    }
  });

  test('actions are CLI-friendly: at least one action names a `clad <verb>` command', () => {
    const actions = names.map((n) => DETECTOR_PLAIN[n].action).filter((a): a is string => Boolean(a));
    expect(actions.some((a) => a.includes('clad '))).toBe(true);
  });
});

// ─── AC-263adf79 — plain lead first, machine detail demoted to a tail ──────

describe('plainFinding render shape (AC-263adf79)', () => {
  const finding = {
    detector: 'MISSING_IMPLEMENTATION',
    path: 'src/auth/login.ts',
    message: "feature F-x declares module 'src/auth/login.ts' but the file does not exist",
  };

  test('the plain lead comes first; detector + path are a parenthetical tail', () => {
    const out = plainFinding(finding);
    const lead = DETECTOR_PLAIN.MISSING_IMPLEMENTATION.lead;
    expect(out).toBe(`${lead} (MISSING_IMPLEMENTATION · src/auth/login.ts)`);
    expect(out.indexOf(lead)).toBe(0);
    expect(out.indexOf('MISSING_IMPLEMENTATION')).toBeGreaterThan(lead.length);
    expect(out.indexOf('src/auth/login.ts')).toBeGreaterThan(out.indexOf('MISSING_IMPLEMENTATION'));
  });

  test('the raw machine message never leaks into the render when a catalog row exists', () => {
    expect(plainFinding(finding)).not.toContain(finding.message);
  });

  test('a finding with no catalog row falls back to its raw message as the lead — never swallowed', () => {
    const synthetic = {detector: 'ARCH', path: 'stage', message: 'layer breach: cli → detectors'};
    expect(plainFinding(synthetic)).toBe('layer breach: cli → detectors (ARCH · stage)');
  });

  test('a finding with no path omits the middle dot, keeping just the detector in the tail', () => {
    const noPath = {detector: 'HARNESS_INTEGRITY', message: 'raw'};
    expect(plainFinding(noPath)).toBe(`${DETECTOR_PLAIN.HARNESS_INTEGRITY.lead} (HARNESS_INTEGRITY)`);
  });
});

describe('plainLead fallback for a detector with no catalog row', () => {
  test('falls back to the supplied raw message', () => {
    expect(plainLead('NOT_A_REAL_DETECTOR', 'a raw message')).toBe('a raw message');
  });

  test('falls back to the detector id itself when no fallback message is given either', () => {
    expect(plainLead('NOT_A_REAL_DETECTOR')).toBe('NOT_A_REAL_DETECTOR');
  });

  test('a long fallback message is clipped to the render budget with an ellipsis', () => {
    const long = 'x'.repeat(300);
    const out = plainLead('NOT_A_REAL_DETECTOR', long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });

  test('a catalog hit ignores the fallback message entirely', () => {
    expect(plainLead('AC_DRIFT', 'ignored raw text')).toBe(DETECTOR_PLAIN.AC_DRIFT.lead);
  });
});

describe('surface templates — stopBlockMessage / driftNudge / doneRefusalLead', () => {
  test('stopBlockMessage: singular "1 thing" vs plural "N things"', () => {
    expect(stopBlockMessage(1, 'EX')).toBe(
      "cladding paused before finishing: 1 thing doesn't match the spec yet — e.g. EX. In-progress work? Stop once more to snooze.",
    );
    expect(stopBlockMessage(2, 'EX')).toBe(
      "cladding paused before finishing: 2 things don't match the spec yet — e.g. EX. In-progress work? Stop once more to snooze.",
    );
  });

  test('driftNudge: exact wrapper, "(details: DETECTOR)" tail, deferred note kept verbatim', () => {
    expect(driftNudge(3, 'lead text', 'AC_DRIFT', ' (+2 deferred to commit)')).toBe(
      'cladding drift: 3 error(s) — lead text (details: AC_DRIFT) (+2 deferred to commit)',
    );
  });

  test('doneRefusalLead: the English lead is non-empty and language-neutral thereafter', () => {
    const lead = doneRefusalLead();
    expect(lead.length).toBeGreaterThan(0);
    expect(lead).toBe('the completion check found problems above — fix them and re-run');
  });
});

describe('check-block render site — format pin (src/cli/clad.ts printStageDetails)', () => {
  // printStageDetails is private to clad.ts (not exported), and clad.test.ts's
  // heavy stage-runner mock only guards it against throwing — it does not
  // assert the render shape. This pins the literal template so the
  // `<lead> — <path> [<DETECTOR>]` order cannot silently regress.
  test('the block-line template calls plainLead(detector, message) and writes "… [${detector}]"', () => {
    const src = readFileSync(join(ROOT, 'src/cli/clad.ts'), 'utf8');
    const start = src.indexOf('function printStageDetails');
    expect(start).toBeGreaterThan(-1);
    const nextFn = src.indexOf('\nfunction ', start + 1);
    const body = src.slice(start, nextFn === -1 ? undefined : nextFn);
    expect(body).toContain('plainLead(f.detector, f.message)');
    expect(body).toMatch(/\$\{lead\}\$\{where\}\s*\[\$\{f\.detector\}\]/);
  });
});

describe('hook integration — Stop + PostToolUse render sites', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-plain-hook-'));
    // Stop/PostToolUse only engage under cladding (F-c6a32fff): seed the
    // master file. Render is English by construction now (F-9af291fa) — no
    // locale field. Kept minimal — no index.yaml, neither site reads it.
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
    driftStub.mockImplementation(() => DRIFT_CLEAN);
    archStub.mockImplementation(() => STAGE_PASS);
    secretStub.mockImplementation(() => STAGE_PASS);
  });

  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    vi.clearAllMocks();
  });

  describe('Stop — reason leads plain, tail is the real (DETECTOR · path) parenthetical', () => {
    test('a fresh MISSING_IMPLEMENTATION failure blocks with the plain lead before the machine tail', () => {
      driftStub.mockImplementation(() => ({
        pass: false,
        exitCode: 1,
        findings: [
          {
            detector: 'MISSING_IMPLEMENTATION',
            severity: 'error',
            path: 'src/auth/login.ts',
            message: "feature F-x declares module 'src/auth/login.ts' but the file does not exist",
          },
        ],
      }));
      const out = runHookEvent('Stop', {stop_hook_active: false}, cwd);
      const doc = JSON.parse(out) as {decision: string; reason: string};
      expect(doc.decision).toBe('block');
      const lead = DETECTOR_PLAIN.MISSING_IMPLEMENTATION.lead;
      expect(doc.reason).toContain(lead);
      expect(doc.reason.indexOf('(MISSING_IMPLEMENTATION · src/auth/login.ts)')).toBeGreaterThan(doc.reason.indexOf(lead));
    });

    test('the stop-block fingerprint hashes detector|path only — changing ONLY the message still demotes the repeat run', () => {
      driftStub.mockImplementation(() => ({
        pass: false,
        exitCode: 1,
        findings: [{detector: 'MISSING_IMPLEMENTATION', severity: 'error', path: 'src/auth/login.ts', message: 'message A'}],
      }));
      expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).not.toBe('');
      driftStub.mockImplementation(() => ({
        pass: false,
        exitCode: 1,
        findings: [
          {detector: 'MISSING_IMPLEMENTATION', severity: 'error', path: 'src/auth/login.ts', message: 'a completely different message B'},
        ],
      }));
      // Same detector + path, DIFFERENT message: if the fingerprint hashed the
      // message this would re-block. It must demote to '' — hook.ts::runStopGate
      // hashes `${f.detector}|${f.path}` only (AC-ad2a34e1).
      expect(runHookEvent('Stop', {stop_hook_active: false}, cwd)).toBe('');
    });
  });

  describe('PostToolUse — drift line leads plain, tail is "(details: DETECTOR)"', () => {
    test('an AC_DRIFT error surfaces the plain lead and the "(details: AC_DRIFT)" tail; the raw message never leaks', () => {
      driftStub.mockImplementation(() => ({
        pass: false,
        exitCode: 1,
        findings: [{detector: 'AC_DRIFT', severity: 'error', message: 'raw mechanism text, never shown'}],
      }));
      const out = runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts'}}, cwd);
      expect(out).toContain(DETECTOR_PLAIN.AC_DRIFT.lead);
      expect(out).toContain('(details: AC_DRIFT)');
      expect(out).not.toContain('raw mechanism text');
    });
  });
});

describe('done refusal — plain lead prepended, machine tail preserved', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-plain-done-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'x-abc123.yaml'), 'id: F-abc123\nslug: x\nstatus: in_progress\ntitle: X\n', 'utf8');
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('a RED gate prepends the English plain lead and keeps the exact machine-tail pins', () => {
    const res = runDone(dir, 'F-abc123', {checkStages: () => ({worst: 1})});
    expect(res.ok).toBe(false);
    expect(res.reason.startsWith(doneRefusalLead())).toBe(true);
    expect(res.reason).toContain('not GREEN');
    expect(res.reason).toContain('status left at');
  });
});

// ─── AC-25f77cec — machine tails stay language-neutral, no locale machinery ─

describe('machine tails stay language-neutral (AC-25f77cec, 2026-07-06 pivot)', () => {
  test('the plainFinding tail is the language-neutral (DETECTOR · path) pin regardless of the lead', () => {
    const finding = {detector: 'MISSING_IMPLEMENTATION', path: 'src/x.ts', message: 'raw'};
    const out = plainFinding(finding);
    // The tail — everything from the opening paren on — carries only the
    // detector id and path, no natural-language wording that could vary.
    const tail = out.slice(out.indexOf('('));
    expect(tail).toBe('(MISSING_IMPLEMENTATION · src/x.ts)');
  });

  test('the driftNudge (details: …) tail is the raw detector id, not a translated phrase', () => {
    expect(driftNudge(1, 'LEAD', 'AC_DRIFT', '')).toContain('(details: AC_DRIFT)');
  });
});

// ─── AC-ad2a34e1 — machine contracts stay byte-compatible ─────────────────

describe('contract stability — the raw finding shape stays machine, not plain (AC-ad2a34e1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-plain-contract-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('MISSING_IMPLEMENTATION emits the raw machine message on its finding object — this is what --json serializes; only the stdout print path substitutes the plain lead', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' +
        'project: {name: t, language: typescript}\n' +
        'features:\n' +
        '  - id: F-aaa111\n' +
        '    title: Alpha\n' +
        '    status: done\n' +
        '    modules: [src/nonexistent.ts]\n',
      'utf8',
    );
    const findings = missingImplementation.run({cwd: dir});
    const hit = findings.find((f) => f.path === 'src/nonexistent.ts');
    expect(hit).toBeDefined();
    // Raw shape untouched: detector / severity / path / message keys, exactly
    // as the detector produces them.
    expect(hit).toMatchObject({detector: 'MISSING_IMPLEMENTATION', severity: 'error', path: 'src/nonexistent.ts'});
    expect(hit!.message).toBe("feature F-aaa111 declares module 'src/nonexistent.ts' but the file does not exist");
    // The plain-render catalog lead is a DIFFERENT sentence — proves the
    // machine message was never swapped for the human lead at the source.
    expect(hit!.message).not.toBe(DETECTOR_PLAIN.MISSING_IMPLEMENTATION.lead);
    expect(hit!.message).not.toContain(DETECTOR_PLAIN.MISSING_IMPLEMENTATION.lead);
  });
});
