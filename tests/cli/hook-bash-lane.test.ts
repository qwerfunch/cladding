// Cladding · F-e7d59c88 — PostToolUse Bash lane (git-delta impact cards).
//
// Edits made THROUGH the shell (sed -i, heredoc, tee, git apply) bypass the
// Edit|Write|MultiEdit matcher entirely. This lane closes the CARD half of that
// hole: the git working-tree delta since the stored snapshot attributes the
// mutation to a watched source path and routes it through the SAME tiered push
// pipeline — advisory context only, NEVER a block decision.
//
// Drives runHookEvent as a FUNCTION (no host, no subprocess). drift/arch/secret
// are stubbed (the native lane in AC-4f2df3ee spawns runDrift); the Bash lane
// itself runs for real against a REAL git repo in a throwaway temp dir — the
// delta detection is the whole point, so it cannot be mocked away.
//
// Covers:
//   AC-d6c8d5ed  Bash mutation of a watched owned path → tiered card + lane:'bash';
//                most-recently-modified selection among several mutated paths
//   AC-ab85ee3e  debounce + read-only allowlist BEFORE any git spawn; ≤1 status/window
//   AC-14c2e2ea  non-git / git-fail / empty-delta → silence, no snapshot, no error
//   AC-4f2df3ee  a native edit refreshes the snapshot → no Bash re-attribution
//   AC-977e6445  never a block decision; F-35954d19 ledger rules apply unchanged

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

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

// F-aaa111 owns the given `modules` (+ a test_ref), F-bbb222 depends on it — so
// a mutation to any owned module has "1 feature depends on this · 1 test guards it" and fires a
// Tier-2 card (consequences present). Mirrors the fixture the native-lane suite
// (hook-telemetry) uses, with the module path parameterised.
function makeSpec(modules: string[]): string {
  return [
    'schema: "0.1"',
    'project: {name: t, language: typescript}',
    'features:',
    '  - id: F-aaa111',
    '    slug: alpha',
    '    title: alpha',
    '    status: done',
    `    modules: [${modules.join(', ')}]`,
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
}

// Distinct file contents so a rewrite is a real content change git reports as
// modified (a stat-only touch would be re-checked as clean by racy-git logic).
const V1 = 'export const x = 1;\n';
const V2 = 'export const x = 2; // simulated shell mutation of this source line\n';
const V3 = 'export const x = 3; // a second, larger simulated shell mutation here now\n';

let cwd: string;

function put(rel: string, content: string): void {
  const p = join(cwd, rel);
  mkdirSync(dirname(p), {recursive: true});
  writeFileSync(p, content, 'utf8');
}
function gitInit(): void {
  const g = (args: string[]) => execFileSync('git', args, {cwd, stdio: 'ignore'});
  g(['init', '-q']);
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 'Test']);
  g(['config', 'commit.gpgsign', 'false']);
}
function gitCommitAll(): void {
  execFileSync('git', ['add', '-A'], {cwd, stdio: 'ignore'});
  execFileSync('git', ['commit', '-q', '-m', 'init'], {cwd, stdio: 'ignore'});
}

const bashStamp = () => join(cwd, '.cladding', 'hook-bash-ts');
const driftStamp = () => join(cwd, '.cladding', 'hook-drift-ts');
const treeState = () => join(cwd, '.cladding', 'hook-tree-state.json');
const sidecar = () => JSON.parse(readFileSync(join(cwd, '.cladding', 'hook-skip-agg.json'), 'utf8')) as {
  not_write_tool: number;
  unwatched_path: number;
};

function bash(command: string, sessionId = 'sid-1'): string {
  return runHookEvent('PostToolUse', {tool_name: 'Bash', session_id: sessionId, tool_input: {command}}, cwd);
}
function edit(file: string, chars = 60): string {
  return runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: file, new_string: 'x'.repeat(chars)}}, cwd);
}
function fired() {
  return readEvents(cwd).filter((e) => e.type === 'impact_card_fired');
}
function skips(reason?: string) {
  return readEvents(cwd).filter(
    (e) => e.type === 'impact_card_skipped' && (reason === undefined || e.payload.reason === reason),
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-vt-bashlane-'));
  driftStub.mockImplementation(() => DRIFT_CLEAN);
  archStub.mockImplementation(() => STAGE_PASS);
  secretStub.mockImplementation(() => STAGE_PASS);
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

// ─── AC-d6c8d5ed · a shell mutation fires the same tiered push card ───

describe('AC-d6c8d5ed · Bash-lane git-delta impact card', () => {
  test('a sed-style mutation of an owned watched path → tiered card + impact_card_fired lane:bash', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2); // the effect of `sed -i` — git now reports src/app.ts modified

    const out = bash("sed -i '' 's/1/2/' src/app.ts");
    expect(out).toContain('cladding impact: src/app.ts → F-aaa111');
    expect(out).toContain('1 feature depends on this'); // the tiered card's consequence segment (F-f46d5c61)

    const f = fired();
    expect(f).toHaveLength(1);
    expect(f[0].payload).toMatchObject({file: 'src/app.ts', feature: 'F-aaa111', lane: 'bash', tier: 2});
  });

  test('[covers:F-e7d59c88/AC-d6c8d5ed] two owned files mutated → the card names the MOST-RECENTLY-modified one', () => {
    put('spec.yaml', makeSpec(['src/app.ts', 'src/util.ts']));
    put('src/app.ts', V1);
    put('src/util.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2);
    put('src/util.ts', V2);
    // app older, util newer — util wins by mtime despite being iterated second
    // (proves mtime selection, not git's alphabetical status order).
    utimesSync(join(cwd, 'src/app.ts'), new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    utimesSync(join(cwd, 'src/util.ts'), new Date(1_600_000_100_000), new Date(1_600_000_100_000));

    const out = bash("sed -i '' 's/1/2/' src/app.ts src/util.ts");
    expect(out).toContain('cladding impact: src/util.ts → F-aaa111');
    expect(out).not.toContain('src/app.ts');
    expect(fired()[0].payload).toMatchObject({file: 'src/util.ts', lane: 'bash'});
  });
});

// ─── AC-ab85ee3e · debounce + read-only allowlist before any git spawn ───

describe('AC-ab85ee3e · fast-path ordering, allowlist, one status/window', () => {
  test('[covers:F-e7d59c88/AC-ab85ee3e] every documented read-only command avoids git, while repeated mutations make at most one delta check per debounce window', () => {
    put('spec.yaml', makeSpec(['src/app.ts', 'src/util.ts']));
    const readOnly = [
      'git status', 'git log -1', 'git diff', 'ls -la', 'cat README.md',
      'grep needle README.md', 'rg needle', 'find src', 'node --version', 'npm test',
    ];
    for (const command of readOnly) expect(bash(command), command).toBe('');
    expect(sidecar().not_write_tool).toBe(readOnly.length);
    expect(existsSync(bashStamp())).toBe(false);

    put('src/app.ts', V1);
    put('src/util.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2);
    expect(bash("sed -i '' 's/1/2/' src/app.ts")).toContain('cladding impact: src/app.ts');
    const firstStamp = readFileSync(bashStamp(), 'utf8');
    put('src/util.ts', V2);
    expect(bash("sed -i '' 's/1/2/' src/util.ts")).toBe('');
    expect(readFileSync(bashStamp(), 'utf8')).toBe(firstStamp);
  });

  test('read-only allowlisted commands → silence + not_write_tool sidecar increment + NO stamp (no spawn)', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    const cmds = ['git status', 'ls -la', 'cat x', 'npx vitest run', 'npm test'];
    for (const c of cmds) expect(bash(c)).toBe('');

    expect(sidecar().not_write_tool).toBe(cmds.length); // aggregated, not per-occurrence events
    expect(existsSync(bashStamp())).toBe(false); // structural no-spawn proof: never reached the stamp write
    expect(fired()).toHaveLength(0);
  });

  test('word-boundary: "catalog-tool build" (prefix cat) does NOT match → falls through to the delta path', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll(); // clean tree → the delta check finds nothing → silence

    const out = bash('catalog-tool build');
    expect(out).toBe('');
    expect(existsSync(bashStamp())).toBe(true); // fell through the allowlist → stamped before the spawn
  });

  test('metachar guard: "echo hi > src/app.ts" (echo allowlisted but > present) → delta path, card fires', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2); // the redirect's effect on disk

    const out = bash('echo hi > src/app.ts');
    expect(out).toContain('cladding impact: src/app.ts → F-aaa111');
    expect(fired()[0].payload).toMatchObject({lane: 'bash'});
  });

  test('one delta check per 20s window: a second Bash mutation is debounced → no second git status', () => {
    put('spec.yaml', makeSpec(['src/app.ts', 'src/util.ts']));
    put('src/app.ts', V1);
    put('src/util.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2);

    const first = bash("sed -i '' 's/1/2/' src/app.ts");
    expect(first).toContain('cladding impact: src/app.ts');
    const stampAfterFirst = readFileSync(bashStamp(), 'utf8');

    put('src/util.ts', V2); // a fresh mutation inside the same window
    const second = bash("sed -i '' 's/1/2/' src/util.ts");
    expect(second).toBe(''); // debounced before the allowlist and before any spawn
    expect(readFileSync(bashStamp(), 'utf8')).toBe(stampAfterFirst); // stamp untouched → the git status never ran
    expect(skips('debounced')).toHaveLength(1);
  });
});

// ─── AC-14c2e2ea · degrade to silence without snapshot or error ───

describe('AC-14c2e2ea · silence when git state is unavailable or the delta is empty', () => {
  test('[covers:F-e7d59c88/AC-14c2e2ea] unavailable git and a clean watched tree both stay silent without writing a snapshot', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    expect(bash("sed -i '' 's/1/2/' src/app.ts")).toBe('');
    expect(existsSync(treeState())).toBe(false);

    gitInit();
    gitCommitAll();
    expect(bash("sed -i '' 's/1/2/' src/app.ts")).toBe('');
    expect(existsSync(treeState())).toBe(false);
  });

  test('a non-git cwd (spec present) → silence, no throw, NO tree snapshot written', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V2); // no git init → git status fails

    let out = '';
    expect(() => {
      out = bash("sed -i '' 's/1/2/' src/app.ts");
    }).not.toThrow();
    expect(out).toBe('');
    expect(existsSync(treeState())).toBe(false);
  });

  test('a git repo with an EMPTY delta → silence, NO tree snapshot written', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll(); // clean tree, nothing mutated

    expect(bash("sed -i '' 's/1/2/' src/app.ts")).toBe('');
    expect(existsSync(treeState())).toBe(false);
  });

  test('a corrupt hook-tree-state.json → no throw; the next run still fires', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2);
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(treeState(), 'not-json{{', 'utf8');

    let out = '';
    expect(() => {
      out = bash("sed -i '' 's/1/2/' src/app.ts");
    }).not.toThrow();
    expect(out).toContain('cladding impact: src/app.ts → F-aaa111'); // corrupt snapshot treated as empty → delta still fires
  });
});

// ─── AC-4f2df3ee · a native edit refreshes the snapshot → no re-attribution ───

describe('AC-4f2df3ee · native-edit snapshot refresh blocks Bash re-attribution', () => {
  test('[covers:F-e7d59c88/AC-4f2df3ee] an Edit on src/app.ts records the snapshot; a following Bash does NOT re-fire it', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2); // git now reports src/app.ts modified

    rmSync(driftStamp(), {force: true}); // clear the native debounce so the Edit fires
    const editOut = edit('src/app.ts', 60);
    expect(editOut).toContain('cladding impact: src/app.ts → F-aaa111');
    expect(fired()).toHaveLength(1);

    const snap = JSON.parse(readFileSync(treeState(), 'utf8')) as {paths: Record<string, string>};
    expect(snap.paths['src/app.ts']).toBeDefined(); // the edit "seen" this path

    // A non-allowlisted Bash command that reaches the delta check: the path is
    // git-dirty but its snapshot signature matches → seen-unchanged → silence.
    const bashOut = bash('true');
    expect(bashOut).toBe('');
    expect(fired()).toHaveLength(1); // still one — the hand-tool edit was not double-attributed
  });
});

// ─── AC-977e6445 · advisory only; ledger rules apply unchanged ───

describe('AC-977e6445 · never a block decision + F-35954d19 ledger rules', () => {
  test('a Bash mutation renders stdout text, never a {"decision":"block"} JSON', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2);

    const out = bash("sed -i '' 's/1/2/' src/app.ts");
    expect(out).toContain('cladding impact:'); // advisory text
    expect(out).not.toMatch(/"decision"\s*:\s*"block"/);
    expect(out.trim().startsWith('{')).toBe(false); // not a JSON decision envelope
  });

  test('the same (focus,file) mutated via Bash across two windows dedups Tier-2 → Tier-1', () => {
    put('spec.yaml', makeSpec(['src/app.ts']));
    put('src/app.ts', V1);
    gitInit();
    gitCommitAll();
    put('src/app.ts', V2);

    const t2 = bash("sed -i '' 's/1/2/' src/app.ts", 'sid-dedup');
    expect(t2).toContain('cladding impact: src/app.ts → F-aaa111');
    expect(t2).toContain('\nbreaks: F-bbb222'); // Tier-2 detail line present

    rmSync(bashStamp(), {force: true}); // a new debounce window (ledger persists across it)
    put('src/app.ts', V3); // a fresh mutation so the delta is non-empty again
    const t1 = bash("sed -i '' 's/2/3/' src/app.ts", 'sid-dedup');
    expect(t1).toContain('cladding impact: src/app.ts → F-aaa111');
    expect(t1).not.toContain('\nbreaks:'); // degraded to the one-liner (one Tier-2 per (focus,file) is the dose)
    expect(t1.split('\n')).toHaveLength(1);
    expect(skips('dedup').length).toBeGreaterThanOrEqual(1);
  });
});
