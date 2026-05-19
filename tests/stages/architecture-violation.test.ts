// Cladding · unit tests for stages/detectors/architecture-violation.ts
//
// Detector under test delegates to the toolchain's architecture
// validator (madge for TS, lint-imports for Python). Branches mirror
// HARDCODED_SECRET:
//   - no validator registered     → info  (compiler may enforce)
//   - validator exit 0            → silent
//   - validator non-zero exit     → error (with truncated output)
//   - validator binary absent     → info  (ENOENT)
//   - validator throws otherwise  → re-thrown
//
// Subprocess invocation is mocked with vi.mock('execa'). Real-binary
// coverage of the subprocess paths lives in the conformance fixtures
// (stage_1.5.pass / stage_1.5.fail) under conformance/runner.ts.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {architectureViolation} = await import(
  '../../src/stages/detectors/architecture-violation.js'
);
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('ARCHITECTURE_VIOLATION detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-arch-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('no toolchain gate → info finding (language with no validator)', () => {
    // Empty dir → toolchain unknown → no arch gate spec → info finding.
    // Real-world case: Rust / Go projects do not register an arch gate
    // because the compiler enforces acyclic imports.
    const findings = architectureViolation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('no architecture validator');
    expect(findings[0].message).toContain('acyclic imports');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('validator exits 0 → silent', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(architectureViolation.run({cwd: dir})).toEqual([]);
    expect(execaSyncMock).toHaveBeenCalledOnce();
  });

  test('validator non-zero exit → error finding (with tool output)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: 'Circular dependency: a -> b -> a',
      stderr: '',
    });
    const findings = architectureViolation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('reported architecture violations');
    expect(findings[0].message).toContain('Circular dependency');
  });

  test('validator ENOENT → info finding (binary not installed)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    const findings = architectureViolation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('not installed');
  });

  test('validator throws non-ENOENT → re-thrown', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => architectureViolation.run({cwd: dir})).toThrow('EACCES');
  });

  test('non-zero exit with only stderr → error message draws from stderr', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'rule violation via stderr',
    });
    const findings = architectureViolation.run({cwd: dir});
    expect(findings[0].message).toContain('rule violation via stderr');
  });

  test('non-zero exit with no output → exit-code fallback', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 3, stdout: '', stderr: ''});
    const findings = architectureViolation.run({cwd: dir});
    expect(findings[0].message).toContain('exit 3');
  });
});
