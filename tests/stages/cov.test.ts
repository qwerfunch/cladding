// Cladding · unit tests for stages/cov.ts (stage_2.2)
//
// Polyglot coverage stage. Mirrors stages/unit.ts: delegates to
// toolchain.gates.coverage. Threshold enforcement is project-owned;
// cladding only relays the runner's exit signal.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runCov} = await import('../../stages/cov.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runCov (stage_2.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-cov-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('unknown language + no override → skipped (exitCode=2)', () => {
    const r = runCov({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_2.2');
    expect(r.stderr).toContain('no coverage runner registered');
  });

  test('package.json present + runner exits 0 → pass=true', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runCov({cwd: dir}).pass).toBe(true);
  });

  test('runner non-zero + stderr → pass=false with stderr', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'coverage below threshold',
    });
    const r = runCov({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('coverage below threshold');
  });

  test('runner non-zero + no stderr → no stderr field', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: ''});
    expect(runCov({cwd: dir}).stderr).toBeUndefined();
  });

  test('explicit override bypasses toolchain', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runCov({cwd: dir, cmd: 'mycov', args: ['--report']});
    expect(execaSyncMock).toHaveBeenCalledWith('mycov', ['--report'], expect.any(Object));
  });

  test('null exit defaults to 1', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: ''});
    expect(runCov({cwd: dir}).exitCode).toBe(1);
  });
});
