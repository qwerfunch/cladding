// Cladding · unit tests for stages/type.ts (stage_1.1)
//
// Stage runner under test wraps the project's type checker (chosen by
// the polyglot toolchain manifest chain). Branches:
//   - explicit cmd/args override                    → use them
//   - manifest chain returns a registered gate      → use it
//   - manifest chain returns 'unknown' + no override → pass=false, exitCode=2
//                                                     (skipped, not failed)
//   - tool exit 0                                    → pass=true
//   - tool non-zero exit + stderr                   → pass=false, stderr attached
//   - tool non-zero exit + no stderr                → pass=false, no stderr field
//
// execaSync is mocked with vi.mock('execa'). Real-binary coverage of
// the subprocess paths is exercised by the conformance fixtures
// (stage_1.1.pass / stage_1.1.fail).

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runType} = await import('../../stages/type.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runType (stage_1.1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-type-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('unknown language + no override → skipped (exitCode=2)', () => {
    // Empty dir → no manifest → toolchain.language='unknown' → no gate spec
    const r = runType({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_1.1');
    expect(r.stderr).toContain('no type checker registered');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('package.json present + tool exits 0 → pass=true', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    const r = runType({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBeUndefined();
  });

  test('tool non-zero exit + stderr → pass=false with stderr attached', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'foo.ts(3,5): error TS2322: type mismatch',
    });
    const r = runType({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('TS2322');
  });

  test('tool non-zero exit + no stderr → pass=false, no stderr field', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 2, stdout: '', stderr: ''});
    const r = runType({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBeUndefined();
  });

  test('explicit cmd/args override → bypasses toolchain', () => {
    // Empty dir would normally skip, but the override forces the tool.
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    const r = runType({cwd: dir, cmd: 'mytsc', args: ['--check']});
    expect(r.pass).toBe(true);
    expect(execaSyncMock).toHaveBeenCalledWith('mytsc', ['--check'], expect.any(Object));
  });

  test('null exit code defaults to 1 (defensive)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: 'killed'});
    const r = runType({cwd: dir});
    expect(r.exitCode).toBe(1);
    expect(r.pass).toBe(false);
  });
});
