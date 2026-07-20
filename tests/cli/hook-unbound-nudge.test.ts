// Cladding · F-f9891175 — PostToolUse nudge when sustained source edits are
// bound to no feature.
//
// Drives runHookEvent as a FUNCTION (no host, no subprocess). drift/arch/secret
// are stubbed so PostToolUse never spawns a toolchain; the impact-slice path runs
// for real against a throwaway fixture. An edit to a path in no feature's modules
// is an owner_miss; once such edits reach the threshold in a window, the card
// carries one non-blocking nudge.
//
// Covers:
//   AC-8542cc63  the nudge fires once the unbound-edit count crosses the threshold
//   AC-388518f4  no nudge for a Read, a bound edit, or a sub-threshold count
//   AC-5d379d4e  once per window — a further unbound edit does not repeat it
//   AC-228fdc15  never blocks; a sidecar failure leaves stdout byte-identical

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

type StageResult = {pass: boolean; exitCode: number; stderr?: string};
type DriftFinding = {detector: string; severity: 'error' | 'warn' | 'info'; path?: string; message: string};
type DriftReport = StageResult & {findings: DriftFinding[]};

const DRIFT_CLEAN: DriftReport = {pass: true, exitCode: 0, findings: []};
const driftStub = vi.fn((): DriftReport => DRIFT_CLEAN);
const archStub = vi.fn((): StageResult => ({pass: true, exitCode: 0}));
const secretStub = vi.fn((): StageResult => ({pass: true, exitCode: 0}));

vi.mock('../../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => driftStub(...(a as []))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: (...a: unknown[]) => archStub(...(a as []))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: (...a: unknown[]) => secretStub(...(a as []))}));

const {runHookEvent} = await import('../../src/cli/hook.js');

// F-aaa111 owns src/foo.ts; any OTHER src path (e.g. src/orphan.ts) is unbound.
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
  '',
].join('\n');

const NUDGE = "recent source edits aren't tracked by any feature";
const LONG = 'x'.repeat(60); // > MIN_EDIT_CHARS so the edit is not a trivial skip

let cwd: string;

function clearStamp(): void {
  rmSync(join(cwd, '.cladding', 'hook-drift-ts'), {force: true});
}
function post(input: unknown): string {
  return runHookEvent('PostToolUse', input, cwd);
}
/** An Edit to an UNBOUND path, debounce cleared so it is not rate-limited. */
function editUnbound(path = 'src/orphan.ts'): string {
  clearStamp();
  return post({tool_name: 'Edit', tool_input: {file_path: path, old_string: '', new_string: LONG}});
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-vt-nudge-'));
  writeFileSync(join(cwd, 'spec.yaml'), VALID_SPEC, 'utf8');
  driftStub.mockImplementation(() => DRIFT_CLEAN);
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

describe('AC-8542cc63 — the nudge fires once unbound edits cross the threshold', () => {
  test('third unbound edit carries the nudge; the first two are silent', () => {
    expect(editUnbound()).not.toContain(NUDGE); // 1
    expect(editUnbound()).not.toContain(NUDGE); // 2
    const third = editUnbound(); // 3 → threshold
    expect(third).toContain(NUDGE);
    expect(third).toContain('3 recent source edits');
    expect(third).toContain('start a feature for this work');
  });
});

describe('AC-388518f4 — no false nudge', () => {
  test('a Read never nudges', () => {
    for (let i = 0; i < 5; i++) {
      clearStamp();
      expect(post({tool_name: 'Read', tool_input: {file_path: 'src/orphan.ts'}})).not.toContain(NUDGE);
    }
  });

  test('edits to a BOUND file never nudge (they resolve to an owner)', () => {
    for (let i = 0; i < 5; i++) {
      clearStamp();
      const out = post({tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts', old_string: '', new_string: LONG}});
      expect(out).not.toContain(NUDGE);
    }
  });

  test('a single unbound edit (sub-threshold) is silent', () => {
    expect(editUnbound()).not.toContain(NUDGE);
  });
});

describe('AC-5d379d4e — once per window', () => {
  test('a further unbound edit after the nudge does not repeat it', () => {
    editUnbound();
    editUnbound();
    expect(editUnbound()).toContain(NUDGE); // fires on the 3rd
    expect(editUnbound()).not.toContain(NUDGE); // 4th — suppressed this window
    expect(editUnbound()).not.toContain(NUDGE); // 5th — still suppressed
  });
});

describe('AC-228fdc15 — never blocks; byte-identical on sidecar failure', () => {
  test('a sabotaged .cladding leaves the nudge silent (no throw, no block)', () => {
    // Make .cladding a FILE so every sidecar read/write throws.
    rmSync(join(cwd, '.cladding'), {recursive: true, force: true});
    writeFileSync(join(cwd, '.cladding'), 'x', 'utf8');
    let out = '';
    expect(() => {
      out = post({tool_name: 'Edit', tool_input: {file_path: 'src/orphan.ts', old_string: '', new_string: LONG}});
    }).not.toThrow();
    // Without a persistable counter the nudge can never accumulate → byte-identical '' (no block).
    expect(out).toBe('');
  });
});
