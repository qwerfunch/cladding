// Cladding · unit tests for stages/unit.ts (stage_2.1)
//
// Polyglot unit-test stage. Same shape as stages/type.ts and
// stages/lint.ts: delegates to toolchain.gates.test, returns exitCode 2
// (skipped) when no runner is registered. execaSync is mocked.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runUnit} = await import('../../src/stages/unit.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runUnit (stage_2.1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-unit-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('unknown language + no override → skipped (exitCode=2)', () => {
    const r = runUnit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_2.1');
    expect(r.stderr).toContain('no unit test runner registered');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('package.json present + runner exits 0 → pass=true', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runUnit({cwd: dir}).pass).toBe(true);
  });

  test('runner non-zero + stderr → pass=false with stderr', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'FAIL  tests/a.test.ts',
    });
    const r = runUnit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('FAIL');
  });

  test('runner non-zero + no stderr → pass=false, no stderr field', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: ''});
    expect(runUnit({cwd: dir}).stderr).toBeUndefined();
  });

  test('explicit cmd/args override → bypasses toolchain', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runUnit({cwd: dir, cmd: 'mytest', args: ['run']});
    expect(execaSyncMock).toHaveBeenCalledWith('mytest', ['run'], expect.any(Object));
  });

  test('null exit defaults to 1', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: ''});
    expect(runUnit({cwd: dir}).exitCode).toBe(1);
  });

  test('[covers:F-b81d203e/AC-0e76a1b2] strict mode rejects a successful runner that definitively reports zero tests', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '# tests 0\n# pass 0', stderr: ''});
    const r = runUnit({cwd: dir, cmd: 'npm', args: ['test'], strict: true});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.findings?.[0]?.detector).toBe('VACUOUS_TESTS');
  });

  test('zero-test summary remains backward-compatible outside strict mode', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '# tests 0', stderr: ''});
    expect(runUnit({cwd: dir, cmd: 'npm', args: ['test']}).pass).toBe(true);
  });

  test('multiple workspace summaries do not false-fail when any tests executed', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '# tests 0\n# tests 3', stderr: ''});
    expect(runUnit({cwd: dir, cmd: 'npm', args: ['test'], strict: true}).pass).toBe(true);
  });
});
