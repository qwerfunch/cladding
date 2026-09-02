// Cladding · hook lanes × drift profile — runtime binding (F-6ed216f3)
//
// runDrift is stubbed (the gate-golden-matrix / hook.test.ts pattern) so these
// cases assert the ARGUMENTS each hook lane passes, without spawning a toolchain:
//
//   AC-b49435f8 — PostToolUse requests profile: 'interactive'; the Stop lane
//     passes NO interactive profile (strict + full suite).
//   AC-870a2ed8 — the PostToolUse lane renders the deferred subprocess detectors
//     (report.skippedDetectors) on the drift line instead of silently dropping
//     them — the caller-renders-what-was-skipped response clause.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

type StageResult = {pass: boolean; exitCode: number; stderr?: string};
type DriftFinding = {detector: string; severity: 'error' | 'warn' | 'info'; path?: string; message: string};
type DriftReport = StageResult & {findings: DriftFinding[]; skippedDetectors?: string[]};
type DriftOpts = {cwd?: string; strict?: boolean; profile?: string};

const STAGE_PASS: StageResult = {pass: true, exitCode: 0};
const DRIFT_CLEAN: DriftReport = {pass: true, exitCode: 0, findings: [], skippedDetectors: []};

const driftStub = vi.fn((_opts?: DriftOpts): DriftReport => DRIFT_CLEAN);
const archStub = vi.fn((): StageResult => STAGE_PASS);
const secretStub = vi.fn((): StageResult => STAGE_PASS);

vi.mock('../../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => driftStub(...(a as [DriftOpts]))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: (...a: unknown[]) => archStub(...(a as []))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: (...a: unknown[]) => secretStub(...(a as []))}));

const {runHookEvent} = await import('../../src/cli/hook.js');

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-hook-profile-'));
  // Both lanes only engage under cladding (F-c6a32fff): seed the master file.
  // Render is English by construction (F-9af291fa).
  writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
  driftStub.mockImplementation(() => DRIFT_CLEAN);
  archStub.mockImplementation(() => STAGE_PASS);
  secretStub.mockImplementation(() => STAGE_PASS);
});

afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

describe('PostToolUse requests the interactive profile (AC-b49435f8)', () => {
  test('[covers:F-6ed216f3/AC-b49435f8] a source edit runs drift with profile: interactive', () => {
    runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts'}}, cwd);
    expect(driftStub).toHaveBeenCalledTimes(1);
    expect(driftStub.mock.calls[0][0]).toMatchObject({profile: 'interactive'});
  });
});

describe('PostToolUse renders the deferred subprocess detectors (AC-870a2ed8)', () => {
  test('[covers:F-6ed216f3/AC-870a2ed8] the drift line names how many subprocess detectors were deferred to commit', () => {
    // The interactive report carries the skip list; the caller surfaces it as a
    // suffix on the error drift line, so coverage deferred to commit is visible,
    // not silently lost.
    driftStub.mockImplementation(
      (): DriftReport => ({
        pass: false,
        exitCode: 1,
        findings: [{detector: 'AC_DRIFT', severity: 'error', message: 'spec/code mismatch'}],
        skippedDetectors: ['ARCHITECTURE_VIOLATION', 'HARDCODED_SECRET'],
      }),
    );
    const out = runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts'}}, cwd);
    // Plain-first render (F-dd8dc994): the detector id moved to the `(details: …)`
    // tail; the deferred note is kept verbatim after it.
    expect(out).toContain('cladding drift: 1 error(s) —');
    expect(out).toContain('(details: AC_DRIFT)');
    expect(out).toContain('(+2 deferred to commit)');
  });

  test('a clean interactive report (empty skip suffix path) surfaces nothing extra', () => {
    // Guard the suffix logic: no error findings → no drift line → no deferred
    // annotation leaks out even though skippedDetectors is populated.
    driftStub.mockImplementation(
      (): DriftReport => ({pass: true, exitCode: 0, findings: [], skippedDetectors: ['ARCHITECTURE_VIOLATION']}),
    );
    const out = runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: 'src/foo.ts'}}, cwd);
    expect(out).not.toContain('deferred to commit');
  });
});

describe('Stop requests the full detector suite (AC-b49435f8)', () => {
  test('[covers:F-6ed216f3/AC-b49435f8] the Stop gate runs drift with no interactive profile (strict, full)', () => {
    runHookEvent('Stop', {stop_hook_active: false}, cwd);
    expect(driftStub).toHaveBeenCalledTimes(1);
    const arg = driftStub.mock.calls[0][0];
    expect(arg?.profile).toBeUndefined();
    expect(arg?.strict).toBe(true);
  });
});
