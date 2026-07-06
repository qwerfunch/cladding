// Cladding · unit tests · plain-first finding render + 4-locale catalog (F-dd8dc994)
//
// Sibling home: tests/ui/softShell.test.ts pins the PRE-EXISTING softShell
// exports (featureLabel/haltMessage/gateLabel); this file is the AC-owning
// suite for the NEW plain-first-render surface the same module grew —
// DETECTOR_PLAIN, plainLead/plainFinding, the three surface templates, and
// resolveLocale. It complements (does not duplicate) the existing-pin fallout
// already covered in tests/cli/hook.test.ts, hook-interactive-profile.test.ts,
// clad.test.ts, and done.test.ts.
//
// AC map (spec/features/plain-first-finding-render-dd8dc994.yaml):
//   AC-746969b3 — DETECTOR_PLAIN catalog completeness (all locales, no MCP names)
//   AC-263adf79 — plain lead first, machine detail demoted to a tail, per site
//   AC-25f77cec — resolveLocale priority chain, never throws
//   AC-ad2a34e1 — machine contracts (raw finding shape, stop-block fingerprint)
//                 stay byte-compatible
//
// One clarification worth recording: the ORIGINAL implementation brief
// (scratchpad/uxlang/U2-brief.md item 3) specifies a `(details: DETECTOR)`
// tail for the PostToolUse drift line ONLY — the Stop block's tail (via
// plainFinding) is `(DETECTOR · path)`. Both are asserted below, each on its
// own site; neither uses the other's format. See U2-verify.md for the
// verification note against a later paraphrase that conflated the two.
//
// The check-block render site (src/cli/clad.ts printStageDetails) has no
// exported template of its own (unlike the other three) — its literal format
// is pinned here via a source-text assertion, and proven live against a real
// `clad check` subprocess in the external-validation transcript (U2-verify.md
// part C.3).

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
  resolveLocale,
  stopBlockMessage,
  type PlainLocale,
} from '../src/ui/softShell.js';

const LOCALES: readonly PlainLocale[] = ['en', 'ko', 'ja', 'zh'];
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

  test('every registered detector has a non-empty lead in all four shipped locales', () => {
    for (const name of names) {
      for (const locale of LOCALES) {
        const lead = DETECTOR_PLAIN[name][locale].lead;
        expect(lead.trim().length, `${name}.${locale}.lead`).toBeGreaterThan(0);
      }
    }
  });

  test('no MCP tool name (or a clad_-shaped identifier) appears in any action string, in any locale', () => {
    // Dynamic needles derived from the LIVE MCP registry (src/serve/server.ts
    // TOOL_NAMES) plus a broad clad_-shape regex — a future clad_* tool is
    // covered automatically, nothing to update here when one is added.
    const registryNeedles = TOOL_NAMES.flatMap((t) => [t, t.replace(/^clad_/, '')]);
    const mcpShapePattern = /\bclad_[a-z_]+/;
    for (const name of names) {
      for (const locale of LOCALES) {
        const action = DETECTOR_PLAIN[name][locale].action;
        if (!action) continue;
        expect(action, `${name}.${locale}.action`).not.toMatch(mcpShapePattern);
        for (const needle of registryNeedles) {
          expect(action, `${name}.${locale}.action should not name "${needle}"`).not.toContain(needle);
        }
      }
    }
  });

  test('actions are CLI-friendly: at least one English action names a `clad <verb>` command', () => {
    const enActions = names.map((n) => DETECTOR_PLAIN[n].en.action).filter((a): a is string => Boolean(a));
    expect(enActions.some((a) => a.includes('clad '))).toBe(true);
  });
});

// ─── AC-263adf79 — plain lead first, machine detail demoted to a tail ──────

describe('plainFinding render shape (AC-263adf79)', () => {
  const finding = {
    detector: 'MISSING_IMPLEMENTATION',
    path: 'src/auth/login.ts',
    message: "feature F-x declares module 'src/auth/login.ts' but the file does not exist",
  };

  test('en: the plain lead comes first; detector + path are a parenthetical tail', () => {
    const out = plainFinding(finding, 'en');
    const lead = DETECTOR_PLAIN.MISSING_IMPLEMENTATION.en.lead;
    expect(out).toBe(`${lead} (MISSING_IMPLEMENTATION · src/auth/login.ts)`);
    expect(out.indexOf(lead)).toBe(0);
    expect(out.indexOf('MISSING_IMPLEMENTATION')).toBeGreaterThan(lead.length);
    expect(out.indexOf('src/auth/login.ts')).toBeGreaterThan(out.indexOf('MISSING_IMPLEMENTATION'));
  });

  test('ko: same order, localized lead', () => {
    const out = plainFinding(finding, 'ko');
    const lead = DETECTOR_PLAIN.MISSING_IMPLEMENTATION.ko.lead;
    expect(out).toBe(`${lead} (MISSING_IMPLEMENTATION · src/auth/login.ts)`);
    expect(out.indexOf(lead)).toBe(0);
  });

  test('the raw machine message never leaks into the render when a catalog row exists', () => {
    expect(plainFinding(finding, 'en')).not.toContain(finding.message);
  });

  test('a finding with no catalog row falls back to its raw message as the lead — never swallowed', () => {
    const synthetic = {detector: 'ARCH', path: 'stage', message: 'layer breach: cli → detectors'};
    expect(plainFinding(synthetic, 'en')).toBe('layer breach: cli → detectors (ARCH · stage)');
  });

  test('a finding with no path omits the middle dot, keeping just the detector in the tail', () => {
    const noPath = {detector: 'HARNESS_INTEGRITY', message: 'raw'};
    expect(plainFinding(noPath, 'en')).toBe(`${DETECTOR_PLAIN.HARNESS_INTEGRITY.en.lead} (HARNESS_INTEGRITY)`);
  });
});

describe('plainLead fallback for a detector with no catalog row', () => {
  test('falls back to the supplied raw message', () => {
    expect(plainLead('NOT_A_REAL_DETECTOR', 'en', 'a raw message')).toBe('a raw message');
  });

  test('falls back to the detector id itself when no fallback message is given either', () => {
    expect(plainLead('NOT_A_REAL_DETECTOR', 'en')).toBe('NOT_A_REAL_DETECTOR');
  });

  test('a long fallback message is clipped to the render budget with an ellipsis', () => {
    const long = 'x'.repeat(300);
    const out = plainLead('NOT_A_REAL_DETECTOR', 'en', long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });

  test('a catalog hit ignores the fallback message entirely', () => {
    expect(plainLead('AC_DRIFT', 'en', 'ignored raw text')).toBe(DETECTOR_PLAIN.AC_DRIFT.en.lead);
  });
});

describe('surface templates — stopBlockMessage / driftNudge / doneRefusalLead', () => {
  test('stopBlockMessage (en): singular "1 thing" vs plural "N things"', () => {
    expect(stopBlockMessage(1, 'EX', 'en')).toBe(
      "cladding paused before finishing: 1 thing doesn't match the spec yet — e.g. EX. In-progress work? Stop once more to snooze.",
    );
    expect(stopBlockMessage(2, 'EX', 'en')).toBe(
      "cladding paused before finishing: 2 things don't match the spec yet — e.g. EX. In-progress work? Stop once more to snooze.",
    );
  });

  test('stopBlockMessage: ko/ja/zh localize the wrapper sentence, not just the example', () => {
    const koOut = stopBlockMessage(1, 'EX', 'ko');
    const jaOut = stopBlockMessage(1, 'EX', 'ja');
    const zhOut = stopBlockMessage(1, 'EX', 'zh');
    expect(koOut).toContain('cladding이 마무리를');
    expect(jaOut).toContain('cladding が仕上げ');
    expect(zhOut).toContain('cladding 在收尾');
    for (const out of [koOut, jaOut, zhOut]) expect(out).toContain('EX');
  });

  test('driftNudge (en): exact wrapper, "(details: DETECTOR)" tail, deferred note kept verbatim', () => {
    expect(driftNudge(3, 'lead text', 'AC_DRIFT', ' (+2 deferred to commit)', 'en')).toBe(
      'cladding drift: 3 error(s) — lead text (details: AC_DRIFT) (+2 deferred to commit)',
    );
  });

  test('driftNudge: ko/ja/zh localize the wrapper sentence, keep the (details: …) tail literal', () => {
    const koOut = driftNudge(1, 'LEAD', 'X', '', 'ko');
    const jaOut = driftNudge(1, 'LEAD', 'X', '', 'ja');
    const zhOut = driftNudge(1, 'LEAD', 'X', '', 'zh');
    expect(koOut).toContain('cladding 드리프트');
    expect(jaOut).toContain('cladding ドリフト');
    expect(zhOut).toContain('cladding 偏移');
    for (const out of [koOut, jaOut, zhOut]) {
      expect(out).toContain('LEAD');
      expect(out).toContain('(details: X)');
    }
  });

  test('doneRefusalLead: all four shipped locales are non-empty and distinct', () => {
    const leads = LOCALES.map((l) => doneRefusalLead(l));
    expect(new Set(leads).size).toBe(4);
    for (const lead of leads) expect(lead.length).toBeGreaterThan(0);
  });
});

describe('check-block render site — format pin (src/cli/clad.ts printStageDetails)', () => {
  // printStageDetails is private to clad.ts (not exported), and clad.test.ts's
  // heavy stage-runner mock only guards it against throwing — it does not
  // assert the render shape. This pins the literal template so the
  // `<lead> — <path> [<DETECTOR>]` order cannot silently regress; the SAME
  // format is proven live against a real subprocess in the external
  // validation transcript (U2-verify.md, part C.3).
  test('the block-line template calls plainLead(detector, locale, message) and writes "… [${detector}]"', () => {
    const src = readFileSync(join(ROOT, 'src/cli/clad.ts'), 'utf8');
    const start = src.indexOf('function printStageDetails');
    expect(start).toBeGreaterThan(-1);
    const nextFn = src.indexOf('\nfunction ', start + 1);
    const body = src.slice(start, nextFn === -1 ? undefined : nextFn);
    expect(body).toContain('plainLead(f.detector, locale, f.message)');
    expect(body).toMatch(/\$\{lead\}\$\{where\}\s*\[\$\{f\.detector\}\]/);
  });
});

describe('hook integration — Stop + PostToolUse render sites', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-plain-hook-'));
    // Stop/PostToolUse only engage under cladding (F-c6a32fff): seed the
    // master file. `locale: en` pins the render regardless of the developer's
    // own LANG (mirrors hook.test.ts's fixture convention; kept minimal — no
    // index.yaml, neither site under test reads it).
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n  locale: en\n', 'utf8');
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
      const lead = DETECTOR_PLAIN.MISSING_IMPLEMENTATION.en.lead;
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
      expect(out).toContain(DETECTOR_PLAIN.AC_DRIFT.en.lead);
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
    expect(res.reason.startsWith(doneRefusalLead('en'))).toBe(true);
    expect(res.reason).toContain('not GREEN');
    expect(res.reason).toContain('status left at');
  });

  test('project.locale: ko relocalizes ONLY the lead; the machine tail stays the language-neutral pin', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n  locale: ko\n', 'utf8');
    const res = runDone(dir, 'F-abc123', {checkStages: () => ({worst: 1})});
    expect(res.reason.startsWith(doneRefusalLead('ko'))).toBe(true);
    expect(res.reason).toContain('not GREEN');
    expect(res.reason).toContain('status left at');
  });
});

// ─── AC-25f77cec — locale resolution priority chain, never throws ─────────

describe('resolveLocale priority chain (AC-25f77cec)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-locale-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    vi.unstubAllEnvs();
  });

  function writeSpecLocale(locale: string): void {
    writeFileSync(join(dir, 'spec.yaml'), `schema: "0.1"\nproject:\n  name: fixture\n  locale: ${locale}\n`, 'utf8');
  }
  function writeSidecar(locale: string): void {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'user-locale'), `${locale}\n`, 'utf8');
  }

  test('the .cladding/user-locale sidecar wins over project.locale', () => {
    writeSpecLocale('en');
    writeSidecar('ja');
    vi.stubEnv('LANG', 'ko_KR.UTF-8');
    expect(resolveLocale(dir)).toBe('ja');
  });

  test('project.locale wins over LANG when there is no sidecar', () => {
    writeSpecLocale('zh');
    vi.stubEnv('LANG', 'ko_KR.UTF-8');
    expect(resolveLocale(dir)).toBe('zh');
  });

  test('LANG=ja_JP resolves to ja when neither sidecar nor project.locale is set', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
    vi.stubEnv('LANG', 'ja_JP.UTF-8');
    vi.stubEnv('LC_ALL', '');
    expect(resolveLocale(dir)).toBe('ja');
  });

  test('a garbage sidecar value falls through to project.locale', () => {
    writeSpecLocale('ko');
    writeSidecar('xx-not-a-locale');
    expect(resolveLocale(dir)).toBe('ko');
  });

  test('a garbage project.locale falls through to LANG', () => {
    writeSpecLocale('not-a-real-locale');
    vi.stubEnv('LANG', 'zh_CN.UTF-8');
    expect(resolveLocale(dir)).toBe('zh');
  });

  test('garbage sidecar AND garbage project.locale fall through together, past an empty LANG, to en', () => {
    writeSpecLocale('also-not-real');
    writeSidecar('still-not-real');
    vi.stubEnv('LANG', '');
    vi.stubEnv('LC_ALL', '');
    expect(resolveLocale(dir)).toBe('en');
  });

  test('a directory with no git, no spec.yaml, and no LANG resolves to en without throwing', () => {
    vi.stubEnv('LANG', '');
    vi.stubEnv('LC_ALL', '');
    expect(() => resolveLocale(dir)).not.toThrow();
    expect(resolveLocale(dir)).toBe('en');
  });

  test('an unparseable spec.yaml falls through safely instead of throwing', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'project: {locale: ko\n', 'utf8'); // unterminated flow mapping
    vi.stubEnv('LANG', '');
    vi.stubEnv('LC_ALL', '');
    expect(() => resolveLocale(dir)).not.toThrow();
    expect(resolveLocale(dir)).toBe('en');
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
    expect(hit!.message).not.toBe(DETECTOR_PLAIN.MISSING_IMPLEMENTATION.en.lead);
    expect(hit!.message).not.toContain(DETECTOR_PLAIN.MISSING_IMPLEMENTATION.en.lead);
  });
});
