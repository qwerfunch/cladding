// Cladding · F-35954d19 AC-38141a9e — the additive-upgrade safety contract.
//
// When buildWorkingSet THROWS or returns a lookup MISS, the hook must fall back
// byte-identically to the shipped formatImpactCard path, and the six pre-existing
// gates (write tools, watched path, spec present, debounce, min edit chars, owner
// resolution) must stay unchanged. buildWorkingSet is MOCKED here so both failure
// modes are forced deterministically; every other module (buildImpactSlice, loadSpec,
// formatImpactCard) runs for real, so the expected legacy card is computed, not guessed.
//
// This mock forces working-set.js for the WHOLE file, which is why the fallback lives
// apart from the real-working-set hook tests (Tier-2/dedup/budget).

import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
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

// The push-lane entry point, reconfigured per test to throw or return a miss.
const wsStub = vi.fn();

vi.mock('../../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => driftStub(...(a as []))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: (...a: unknown[]) => archStub(...(a as []))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: (...a: unknown[]) => secretStub(...(a as []))}));
vi.mock('../../src/optimizer/working-set.js', () => ({buildWorkingSet: (...a: unknown[]) => wsStub(...(a as []))}));

const {runHookEvent, formatImpactCard} = await import('../../src/cli/hook.js');
const {readEvents} = await import('../../src/events/log.js');
const {buildImpactSlice} = await import('../../src/optimizer/reverse-slice.js');
const {loadSpec} = await import('../../src/spec/load.js');

const SPEC = [
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

let cwd: string;

function seed(): void {
  writeFileSync(join(cwd, 'spec.yaml'), SPEC, 'utf8');
}
function clearStamp(): void {
  rmSync(join(cwd, '.cladding', 'hook-drift-ts'), {force: true});
}
function freshStamp(): void {
  mkdirSync(join(cwd, '.cladding'), {recursive: true});
  writeFileSync(join(cwd, '.cladding', 'hook-drift-ts'), String(Date.now()), 'utf8');
}
function edit(file: string, n = 60): Record<string, unknown> {
  return {tool_name: 'Edit', tool_input: {file_path: file, new_string: 'x'.repeat(n)}};
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
function legacyExpectation(rel: string): string {
  const slice = buildImpactSlice(loadSpec(cwd), rel);
  if ('not_found' in slice) throw new Error('fixture should resolve the owner');
  return formatImpactCard(slice, rel);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-fallback-'));
  driftStub.mockImplementation(() => DRIFT_CLEAN);
  archStub.mockImplementation(() => STAGE_PASS);
  secretStub.mockImplementation(() => STAGE_PASS);
  // default: buildWorkingSet THROWS (the primary fallback trigger)
  wsStub.mockImplementation(() => {
    throw new Error('working set unavailable');
  });
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

// ─── byte-identical fallback on the two trigger modes ───

describe('fallback to the legacy card (AC-38141a9e)', () => {
  test("[covers:F-35954d19/AC-38141a9e] buildWorkingSet THROWS → output byte-identical to formatImpactCard; fired has no tier field", () => {
    seed();
    clearStamp();
    const out = post(edit('src/foo.ts'));
    expect(out).toBe(legacyExpectation('src/foo.ts'));
    expect(out).toContain('cladding impact: src/foo.ts → F-aaa111');
    const f = fired();
    expect(f).toHaveLength(1);
    // the shipped fallback path uses the pre-tier payload — no tier annotation
    expect(f[0].payload.tier).toBeUndefined();
  });

  test('buildWorkingSet returns a MISS → same byte-identical legacy card', () => {
    wsStub.mockImplementation(() => ({not_found: 'src/foo.ts', accepted_forms: [], discovery: 'd'}));
    seed();
    clearStamp();
    const out = post(edit('src/foo.ts'));
    expect(out).toBe(legacyExpectation('src/foo.ts'));
    expect(fired()).toHaveLength(1);
    expect(fired()[0].payload.tier).toBeUndefined();
  });
});

// ─── the six pre-existing gates remain unchanged ───

describe('the six gates are unchanged under the fallback (AC-38141a9e)', () => {
  test('gate 1 — non-write tool short-circuits to silence', () => {
    seed();
    expect(post({tool_name: 'Read', tool_input: {file_path: 'src/foo.ts'}})).toBe('');
    expect(fired()).toHaveLength(0);
  });

  test('gate 2 — unwatched path short-circuits to silence', () => {
    seed();
    expect(post({tool_name: 'Edit', tool_input: {file_path: 'docs/readme.md', new_string: 'x'.repeat(60)}})).toBe('');
    expect(fired()).toHaveLength(0);
  });

  test('gate 3 — no spec.yaml → silence, no .cladding/ writes', () => {
    // No seed() here — a spec-less cwd is not ours to gate.
    expect(post(edit('src/foo.ts'))).toBe('');
    expect(existsSync(join(cwd, '.cladding'))).toBe(false);
  });

  test('gate 4 — an edit inside the debounce window is skipped as debounced', () => {
    seed();
    freshStamp();
    expect(post(edit('src/foo.ts'))).toBe('');
    expect(skips('debounced')).toHaveLength(1);
  });

  test('gate 5 — an edit below the min char threshold is skipped as trivial', () => {
    seed();
    clearStamp();
    expect(post(edit('src/foo.ts', 10))).toBe('');
    expect(skips('trivial_edit')).toHaveLength(1);
  });

  test('gate 6 — a watched but unowned file falls through to owner_miss', () => {
    seed();
    clearStamp();
    expect(post(edit('src/orphan.ts'))).toBe(''); // ws throws → legacy slice also misses
    expect(skips('owner_miss')).toHaveLength(1);
    expect(fired()).toHaveLength(0);
  });
});
