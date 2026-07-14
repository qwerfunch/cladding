// Cladding · tests for `clad doctor --hosts` — host-smoke matrix (F-5283985e)
//
// Impl-blind test authoring (anti-self-cert): written from the 5 acceptance
// criteria + the exported signatures of src/cli/doctor-hosts.ts, never its
// bodies. The whole point of the feature is that host-support claims trace to a
// DATED, machine-produced artifact and the sentinel parser is regression-testable
// with ZERO live LLM calls — so every parser case below feeds a COMMITTED
// transcript fixture (tests/cli/fixtures/host-smoke/*), and every probe case
// injects the runner seams instead of spawning a real CLI.
//
//   AC-87ebd442 · consent → ≤3 canned prompts/host, record pass/fail/not-run + evidence
//   AC-8dfa9cc4 · absent binary OR no consent → not-run, NEVER pass; dated artifact
//   AC-57ab708c · newest-artifact matrix render; parser vs committed fixtures
//   AC-6cbe51fc · Cursor headless verification plus clad serve tools/list wiring evidence

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {
  type HostSmokeArtifact,
  type PromptResult,
  type PromptRunner,
  type SurfaceName,
  matrixGradesFence,
  parseHostOutput,
  parseServeToolsList,
  readNewestArtifact,
  renderHostMatrix,
  runDoctorHosts,
  runHostSmoke,
  tail,
} from '../../src/cli/doctor-hosts.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'host-smoke');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

const QUERIED_ID = 'F-5283985e';

/** Minimal valid spec so pickFeatureId resolves F-5283985e for the get-feature surface. */
const SPEC_YAML = `schema: "0.1"
project: {name: hostsmoke, language: typescript}
features:
  - id: ${QUERIED_ID}
    title: host smoke
    status: in_progress
    acceptance_criteria:
      - id: AC-001
        ears: ubiquitous
        text: t
`;

const ok = (stdout: string): PromptResult => ({stdout, stderr: '', timedOut: false, code: 0});

// ─── AC-57ab708c / AC-87ebd442 · the PURE sentinel parser vs committed fixtures ──

describe('parseHostOutput — zero-LLM sentinel matcher against committed transcripts (AC-57ab708c)', () => {
  test('list-features: a committed host listing with real F-ids passes', () => {
    const p = parseHostOutput('list-features', fixture('gemini-list-features.txt'));
    expect(p.result).toBe('pass');
    expect(p.sentinel).toMatch(/feature id/i);
  });

  test('get-feature: the QUERIED id echoed back passes (dynamic sentinel)', () => {
    const p = parseHostOutput('get-feature', fixture('get-feature-echo.txt'), QUERIED_ID);
    expect(p.result).toBe('pass');
    expect(p.sentinel).toContain(QUERIED_ID);
  });

  test('get-feature: a DIFFERENT F-id echoed fails — the generic pattern is not enough', () => {
    const text = fixture('get-feature-wrong-id.txt');
    // The generic feature-id pattern WOULD match (the text has an F-id)…
    expect(parseHostOutput('get-feature', text).result).toBe('pass');
    // …but with the queried id supplied, only that literal echo counts.
    expect(parseHostOutput('get-feature', text, QUERIED_ID).result).toBe('fail');
  });

  test('run-check: a drift verdict summary (RED / drift / finding) passes', () => {
    const p = parseHostOutput('run-check', fixture('run-check-drift.txt'));
    expect(p.result).toBe('pass');
  });

  test('a refusal transcript fails every prompt surface', () => {
    const refusal = fixture('refusal.txt');
    for (const surface of ['list-features', 'get-feature', 'run-check'] as SurfaceName[]) {
      expect(parseHostOutput(surface, refusal).result).toBe('fail');
    }
  });

  test('empty / whitespace output (timeout garbage) fails, never a silent pass', () => {
    expect(parseHostOutput('list-features', '').result).toBe('fail');
    expect(parseHostOutput('run-check', '   \n\t ').result).toBe('fail');
  });

  test('evidence is a whitespace-collapsed tail of at most 200 chars', () => {
    const big = `garbage prefix ${'x'.repeat(500)} F-5283985e`;
    const p = parseHostOutput('list-features', big);
    expect(p.evidence.length).toBeLessThanOrEqual(200);
    expect(p.evidence).not.toMatch(/\s{2,}/); // collapsed
  });

  test('tail collapses whitespace and keeps the trailing window', () => {
    expect(tail('a\n\n  b\t c')).toBe('a b c');
    expect(tail('abcdef', 3)).toBe('def');
    expect(tail('short', 200)).toBe('short');
  });
});

// ─── AC-87ebd442 · consent → ≤3 canned prompts/host, recorded pass/fail ──────────

describe('runHostSmoke with consent — canned probing (AC-87ebd442)', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hosts-consent-'));
    home = mkdtempSync(join(tmpdir(), 'clad-hosts-home-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  });

  /** A runner that answers each surface from its committed fixture; records every call. */
  const cannedRunner = (
    calls: Array<{command: string; args: string[]}>,
    listOut = fixture('gemini-list-features.txt'),
  ): PromptRunner => {
    return (command, args, _ctx) => {
      calls.push({command, args: [...args]});
      const joined = args.join(' ');
      if (joined.includes('clad_list_features')) return ok(listOut);
      if (joined.includes('clad_get_feature')) return ok(fixture('get-feature-echo.txt'));
      if (joined.includes('clad_run_check')) return ok(fixture('run-check-drift.txt'));
      return ok('');
    };
  };

  test('exactly 3 one-shot prompts per host on PATH; all-pass → grade verified', () => {
    const calls: Array<{command: string; args: string[]}> = [];
    const artifact = runHostSmoke(dir, {
      consent: true,
      hasBinary: () => true,
      runPrompt: cannedRunner(calls),
      home,
      version: '0.8.0-test',
    });

    // ≤3 canned prompts per host CLI found on PATH.
    for (const command of ['claude', 'agy', 'codex', 'cursor-agent']) {
      expect(calls.filter((c) => c.command === command)).toHaveLength(3);
    }
    // All three surfaces passed their sentinel → verified.
    expect(artifact.hosts.claude.grade).toBe('verified');
    expect(artifact.hosts.antigravity.grade).toBe('verified');
    expect(artifact.hosts.codex.grade).toBe('verified');
    expect(artifact.hosts.cursor.grade).toBe('verified');
    // Every surface carries its recorded pass + evidence.
    const claudeSurfaces = artifact.hosts.claude.surfaces;
    expect(claudeSurfaces.map((s) => s.name)).toEqual(['list-features', 'get-feature', 'run-check']);
    expect(claudeSurfaces.every((s) => s.result === 'pass')).toBe(true);
    expect(claudeSurfaces.every((s) => s.evidence.length > 0)).toBe(true);
  });

  test('get-feature uses the queried-id echo end-to-end (wrong id → fail → grade fail)', () => {
    const runner: PromptRunner = (_command, args) => {
      const joined = args.join(' ');
      if (joined.includes('clad_list_features')) return ok(fixture('gemini-list-features.txt'));
      if (joined.includes('clad_get_feature')) return ok(fixture('get-feature-wrong-id.txt'));
      if (joined.includes('clad_run_check')) return ok(fixture('run-check-drift.txt'));
      return ok('');
    };
    const artifact = runHostSmoke(dir, {consent: true, hasBinary: () => true, runPrompt: runner, home});
    const getFeature = artifact.hosts.claude.surfaces.find((s) => s.name === 'get-feature');
    expect(getFeature?.result).toBe('fail');
    expect(artifact.hosts.claude.grade).toBe('fail');
  });

  test('a refused list-features surface is recorded fail (never pass) → grade fail', () => {
    const calls: Array<{command: string; args: string[]}> = [];
    const artifact = runHostSmoke(dir, {
      consent: true,
      hasBinary: () => true,
      runPrompt: cannedRunner(calls, fixture('refusal.txt')),
      home,
    });
    const list = artifact.hosts.antigravity.surfaces.find((s) => s.name === 'list-features');
    expect(list?.result).toBe('fail');
    expect(artifact.hosts.antigravity.grade).toBe('fail');
  });
});

// ─── AC-8dfa9cc4 · absence of evidence → not-run, NEVER pass; dated artifact ─────

describe('not-run honesty — absence never renders as a pass (AC-8dfa9cc4)', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hosts-notrun-'));
    home = mkdtempSync(join(tmpdir(), 'clad-hosts-home2-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  });

  test('no consent (binary present) → every prompt host not-run with the consent reason', () => {
    const artifact = runHostSmoke(dir, {consent: false, hasBinary: () => true, home, version: 'x'});
    for (const host of ['claude', 'antigravity', 'codex', 'cursor'] as const) {
      const rec = artifact.hosts[host];
      expect(rec.grade).toBe('not-run');
      expect(rec.reason).toMatch(/consent not given/i);
      expect(rec.surfaces.every((s) => s.result === 'not-run')).toBe(true);
      expect(rec.surfaces.some((s) => s.result === 'pass')).toBe(false);
    }
  });

  test('binary absent from PATH → not-run "binary not on PATH", even with consent', () => {
    const artifact = runHostSmoke(dir, {consent: true, hasBinary: () => false, home});
    for (const host of ['claude', 'antigravity', 'codex', 'cursor'] as const) {
      expect(artifact.hosts[host].grade).toBe('not-run');
      expect(artifact.hosts[host].reason).toMatch(/not on PATH/i);
    }
  });

  test('runDoctorHosts without consent: exit 0, dated artifact under .cladding/audit/, no host passes', () => {
    const exitCalls: number[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      exitCalls.push(c ?? 0);
      return undefined as never;
    }) as never);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const prev = process.env.CLAD_HOST_SMOKE;
    delete process.env.CLAD_HOST_SMOKE;
    try {
      runDoctorHosts({cwd: dir, home}); // no --yes, no env consent

      expect(exitCalls).toEqual([0]); // diagnostic surface, never a gate

      const auditDir = join(dir, '.cladding', 'audit');
      const artifacts = readdirSync(auditDir).filter((f) => f.startsWith('host-smoke-'));
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatch(/^host-smoke-\d{4}-\d{2}-\d{2}\.json$/); // dated name

      const written = JSON.parse(readFileSync(join(auditDir, artifacts[0]), 'utf8')) as HostSmokeArtifact;
      for (const rec of Object.values(written.hosts)) {
        expect(rec.grade).not.toBe('verified');
        expect(rec.grade).not.toBe('wiring-ok');
        expect(rec.surfaces.some((s) => s.result === 'pass')).toBe(false);
      }
      // The matrix is regenerated alongside the artifact.
      expect(() => readFileSync(join(dir, 'docs', 'dogfood', 'matrix.md'), 'utf8')).not.toThrow();
    } finally {
      if (prev !== undefined) process.env.CLAD_HOST_SMOKE = prev;
      exitSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });
});

// ─── AC-57ab708c · matrix render, idempotence, newest-artifact selection ─────────

function mkArtifact(over: Partial<HostSmokeArtifact> = {}): HostSmokeArtifact {
  return {
    version: '0.8.0-test',
    generatedAt: '2026-07-01T12:00:00.000Z',
    hosts: {
      claude: {
        grade: 'verified',
        surfaces: [
          {name: 'list-features', result: 'pass', sentinel: 'a real feature id', evidence: 'F-5283985e'},
          {name: 'get-feature', result: 'pass', sentinel: 'the queried id echoed', evidence: 'F-5283985e summary'},
          {name: 'run-check', result: 'pass', sentinel: 'a drift verdict', evidence: 'RED 2 findings'},
        ],
      },
      antigravity: {grade: 'not-run', surfaces: [], reason: 'consent not given (set CLAD_HOST_SMOKE=1)'},
      codex: {grade: 'not-run', surfaces: [], reason: 'binary not on PATH'},
      cursor: {
        grade: 'wiring-ok',
        surfaces: [{name: 'wiring', result: 'pass', sentinel: 'clad serve answers tools/list', evidence: 'tools/list → 4 tools'}],
      },
    },
    ...over,
  };
}

describe('renderHostMatrix — pure matrix generator (AC-57ab708c)', () => {
  test('emits host × surface × result × date × version + grades fence + wiring evidence legend', () => {
    const md = renderHostMatrix(mkArtifact());
    expect(md).toContain('# Host support matrix');
    expect(md).toContain('| Host | list-features | get-feature | run-check | wiring | Grade |');
    expect(md).toContain('Cladding version: `0.8.0-test`');
    expect(md).toContain('Generated: 2026-07-01T12:00:00.000Z');
    // Per-host rows carry the recorded result cells + grade.
    expect(md).toMatch(/\| claude \| pass \| pass \| pass \| — \| verified \|/);
    expect(md).toMatch(/\| cursor \| — \| — \| — \| pass \| wiring-ok \|/);
    // The machine-readable fence the detector reads.
    expect(md).toContain(matrixGradesFence(mkArtifact()));
    expect(md).toContain('Cursor additionally verifies');
  });

  test('matrixGradesFence is the four host grades as a parseable JSON comment', () => {
    const fence = matrixGradesFence(mkArtifact());
    const json = fence.replace('<!-- clad:matrix-grades ', '').replace(' -->', '');
    expect(JSON.parse(json)).toEqual({
      claude: 'verified',
      antigravity: 'not-run',
      codex: 'not-run',
      cursor: 'wiring-ok',
    });
  });

  test('idempotent: two renders of one artifact are byte-identical', () => {
    const a = mkArtifact();
    expect(renderHostMatrix(a)).toBe(renderHostMatrix(a));
  });
});

describe('newest-artifact selection + --matrix-only (AC-57ab708c)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hosts-matrix-'));
    const auditDir = join(dir, '.cladding', 'audit');
    mkdirSync(auditDir, {recursive: true});
    const older = mkArtifact({version: '0.7.0-old', generatedAt: '2026-06-01T00:00:00.000Z'});
    const newer = mkArtifact({version: '0.8.0-new', generatedAt: '2026-07-01T00:00:00.000Z'});
    writeFileSync(join(auditDir, 'host-smoke-2026-06-01.json'), JSON.stringify(older, null, 2));
    writeFileSync(join(auditDir, 'host-smoke-2026-07-01.json'), JSON.stringify(newer, null, 2));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('readNewestArtifact picks the newest of two committed artifacts', () => {
    const newest = readNewestArtifact(dir);
    expect(newest?.version).toBe('0.8.0-new');
    expect(newest?.generatedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  test('legacy Gemini artifacts load without relabeling old evidence as Antigravity', () => {
    const auditDir = join(dir, '.cladding', 'audit');
    const legacy = mkArtifact() as unknown as {version: string; generatedAt: string; hosts: Record<string, unknown>};
    legacy.hosts.gemini = legacy.hosts.antigravity;
    delete legacy.hosts.antigravity;
    legacy.generatedAt = '2026-08-01T00:00:00.000Z';
    writeFileSync(join(auditDir, 'host-smoke-2026-08-01.json'), JSON.stringify(legacy, null, 2));

    const newest = readNewestArtifact(dir);

    expect(newest?.hosts.antigravity.grade).toBe('not-run');
    expect(newest?.hosts.antigravity.reason).toMatch(/legacy artifact/i);
  });

  test('--matrix-only regenerates from the newest artifact and is idempotent', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const matrixPath = join(dir, 'docs', 'dogfood', 'matrix.md');
      runDoctorHosts({cwd: dir, matrixOnly: true});
      const first = readFileSync(matrixPath, 'utf8');
      runDoctorHosts({cwd: dir, matrixOnly: true});
      const second = readFileSync(matrixPath, 'utf8');
      expect(second).toBe(first); // byte-identical regeneration
      expect(first).toContain('0.8.0-new'); // rendered from the NEWEST artifact
      expect(first).not.toContain('0.7.0-old');
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });
});

// ─── AC-6cbe51fc · Cursor headless prompt + wiring evidence ─────────────────────

describe('parseServeToolsList — the clad serve tools/list probe (AC-6cbe51fc)', () => {
  test('a tools/list response containing clad_list_features → ok (wiring-ok)', () => {
    const r = parseServeToolsList(fixture('serve-tools-list-ok.jsonl'));
    expect(r.ok).toBe(true);
    expect(r.toolCount).toBe(4);
    expect(r.evidence).toContain('clad_list_features');
  });

  test('a tools/list without clad_list_features → not ok (wiring-fail)', () => {
    const r = parseServeToolsList(fixture('serve-tools-list-missing.jsonl'));
    expect(r.ok).toBe(false);
    expect(r.toolCount).toBe(2);
  });

  test('garbage (no JSON-RPC id:2 response) → not ok, zero tools, evidence carried', () => {
    const r = parseServeToolsList(fixture('serve-garbage.txt'), 'boot failure on stderr');
    expect(r.ok).toBe(false);
    expect(r.toolCount).toBe(0);
    expect(r.evidence.length).toBeGreaterThan(0);
  });
});

describe('Cursor is headlessly verified and carries separate wiring evidence (AC-6cbe51fc)', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hosts-cursor-'));
    home = mkdtempSync(join(tmpdir(), 'clad-hosts-chome-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    rmSync(home, {recursive: true, force: true});
  });

  const wireCursor = (): void => {
    mkdirSync(join(home, '.cursor'), {recursive: true});
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({mcpServers: {cladding: {command: 'clad', args: ['serve']}}}),
    );
  };

  const passingRunner: PromptRunner = (_command, args) => {
    const joined = args.join(' ');
    if (joined.includes('clad_list_features')) return ok(fixture('gemini-list-features.txt'));
    if (joined.includes('clad_get_feature')) return ok(fixture('get-feature-echo.txt'));
    if (joined.includes('clad_run_check')) return ok(fixture('run-check-drift.txt'));
    return ok('');
  };

  test('headless prompts pass and wired serve answers tools/list → verified', () => {
    wireCursor();
    const artifact = runHostSmoke(dir, {
      consent: true,
      hasBinary: () => true,
      runPrompt: passingRunner,
      home,
      probeServe: () => ({ok: true, toolCount: 4, evidence: 'tools/list → 4 tools'}),
    });
    expect(artifact.hosts.cursor.grade).toBe('verified');
    const wiring = artifact.hosts.cursor.surfaces.find((s) => s.name === 'wiring');
    expect(wiring?.result).toBe('pass');
    expect(artifact.hosts.cursor.surfaces.filter((s) => s.name !== 'wiring').every((s) => s.result === 'pass')).toBe(true);
  });

  test('headless prompts pass but configured serve does not answer → fail', () => {
    wireCursor();
    const artifact = runHostSmoke(dir, {
      consent: true,
      hasBinary: () => true,
      runPrompt: passingRunner,
      home,
      probeServe: () => ({ok: false, toolCount: 0, evidence: 'no tools/list response'}),
    });
    expect(artifact.hosts.cursor.grade).toBe('fail');
  });

  test('binary absent and not wired here → not-run, never a silent pass', () => {
    const artifact = runHostSmoke(dir, {consent: true, hasBinary: () => false, home});
    expect(artifact.hosts.cursor.grade).toBe('not-run');
    expect(artifact.hosts.cursor.reason).toMatch(/binary not on PATH/i);
  });

  test('the rendered matrix records Cursor prompt surfaces and wiring', () => {
    wireCursor();
    const artifact = runHostSmoke(dir, {
      consent: true,
      hasBinary: () => true,
      runPrompt: passingRunner,
      home,
      probeServe: () => ({ok: true, toolCount: 4, evidence: 'ok'}),
    });
    const md = renderHostMatrix(artifact);
    expect(md).toMatch(/\| cursor \| pass \| pass \| pass \| pass \| verified \|/);
  });
});
