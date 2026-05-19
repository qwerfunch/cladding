// Cladding · unit tests for stages/lint.ts (stage_1.2)
//
// Stage runner under test mirrors stage_1.1's polyglot pattern, but
// delegates to the linter gate instead of the type-check gate.
// Branches:
//   - explicit cmd/args override                    → use them
//   - manifest returns a registered lint gate       → use it
//   - manifest returns 'unknown' + no override      → pass=false, exitCode=2
//   - tool exit 0                                    → pass=true
//   - tool non-zero exit + stderr                   → pass=false, stderr attached
//
// execaSync is mocked with vi.mock('execa'); real-binary coverage of
// the subprocess paths lives in conformance fixtures
// (stage_1.2.pass / stage_1.2.fail).

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runLint} = await import('../../stages/lint.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('runLint (stage_1.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-lint-stage-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('unknown language + no override → skipped (exitCode=2)', () => {
    const r = runLint({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_1.2');
    expect(r.stderr).toContain('no linter registered');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('package.json present + tool exits 0 → pass=true', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    const r = runLint({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('tool non-zero exit + stderr → pass=false with stderr', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'foo.ts:3:5  error  no-unused-vars',
    });
    const r = runLint({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('no-unused-vars');
  });

  test('tool non-zero exit + no stderr → pass=false, no stderr field', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: ''});
    const r = runLint({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toBeUndefined();
  });

  test('explicit cmd/args override → bypasses toolchain', () => {
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    const r = runLint({cwd: dir, cmd: 'mylint', args: ['.']});
    expect(r.pass).toBe(true);
    expect(execaSyncMock).toHaveBeenCalledWith('mylint', ['.'], expect.any(Object));
  });

  test('null exit code defaults to 1', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: null, stdout: '', stderr: 'killed'});
    expect(runLint({cwd: dir}).exitCode).toBe(1);
  });
});
