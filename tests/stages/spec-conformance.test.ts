// Cladding · unit tests for stages/spec-conformance.ts (stage_2.3)
//
// Impl-blind oracle-execution stage. Skips (exitCode 2) when no oracle suite
// is present under tests/oracle/, runs the detected test runner against THAT
// directory otherwise, and maps a real oracle failure to a blocking exit 1
// (so GREEN can fail on latent non-conformance). execaSync is mocked.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {runSpecConformance, ORACLE_DIR} = await import('../../src/stages/spec-conformance.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

function seedTs(dir: string): void {
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
}
function seedOracle(dir: string): void {
  const od = join(dir, ORACLE_DIR);
  mkdirSync(od, {recursive: true});
  writeFileSync(join(od, 'sheet.conformance.test.ts'), 'import {test} from "vitest"; test("x",()=>{});\n');
}

describe('runSpecConformance (stage_2.3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-spec-conf-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('no tests/oracle dir → skipped (exitCode=2), runner not invoked', () => {
    seedTs(dir);
    const r = runSpecConformance({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_2.3');
    expect(r.stderr).toContain('no spec-conformance oracles');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('oracle dir present but empty → skipped (no test files = nothing to run)', () => {
    seedTs(dir);
    mkdirSync(join(dir, ORACLE_DIR), {recursive: true});
    const r = runSpecConformance({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('oracle present + suite exits 0 → pass=true', () => {
    seedTs(dir);
    seedOracle(dir);
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(runSpecConformance({cwd: dir}).pass).toBe(true);
  });

  test('oracle-only run restores the prior full JUnit report byte-for-byte', () => {
    seedTs(dir);
    seedOracle(dir);
    const report = join(dir, '.cladding', 'test-report.junit.xml');
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(report, '<testsuites tests="2538"><testcase classname="tests/full.test.ts"/></testsuites>\n');
    const fixedTime = new Date('2026-07-15T00:00:00.000Z');
    utimesSync(report, fixedTime, fixedTime);
    const original = readFileSync(report);
    const originalMtime = statSync(report).mtimeMs;
    execaSyncMock.mockImplementationOnce(() => {
      writeFileSync(report, '<testsuites tests="36"><testcase classname="tests/oracle/x.test.ts"/></testsuites>\n');
      return {exitCode: 0, stdout: '', stderr: ''};
    });

    expect(runSpecConformance({cwd: dir}).pass).toBe(true);

    expect(readFileSync(report)).toEqual(original);
    expect(statSync(report).mtimeMs).toBe(originalMtime);
  });

  test('oracle-only run removes a conventional JUnit report that it alone created', () => {
    seedTs(dir);
    seedOracle(dir);
    const report = join(dir, '.cladding', 'test-report.junit.xml');
    execaSyncMock.mockImplementationOnce(() => {
      mkdirSync(join(dir, '.cladding'), {recursive: true});
      writeFileSync(report, '<testsuites tests="1"/>\n');
      return {exitCode: 0, stdout: '', stderr: ''};
    });

    expect(runSpecConformance({cwd: dir}).pass).toBe(true);

    expect(existsSync(report)).toBe(false);
  });

  test('oracle-only run preserves both an explicit report and a framework-default report', () => {
    seedTs(dir);
    seedOracle(dir);
    const configured = join(dir, 'reports', 'authoritative.xml');
    const conventional = join(dir, '.cladding', 'test-report.junit.xml');
    mkdirSync(join(dir, 'reports'), {recursive: true});
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(
      join(dir, '.cladding', 'config.yaml'),
      'gate:\n  test_report: reports/authoritative.xml\n',
    );
    writeFileSync(configured, '<testsuites tests="2540" name="configured"/>\n');
    writeFileSync(conventional, '<testsuites tests="2540" name="framework-default"/>\n');
    const configuredBefore = readFileSync(configured);
    const conventionalBefore = readFileSync(conventional);
    execaSyncMock.mockImplementationOnce(() => {
      writeFileSync(configured, '<testsuites tests="36"/>\n');
      writeFileSync(conventional, '<testsuites tests="36"/>\n');
      return {exitCode: 0, stdout: '', stderr: ''};
    });

    expect(runSpecConformance({cwd: dir}).pass).toBe(true);

    expect(readFileSync(configured)).toEqual(configuredBefore);
    expect(readFileSync(conventional)).toEqual(conventionalBefore);
  });

  test('oracle present + suite fails → blocking exit 1 with stderr (GREEN can fail)', () => {
    seedTs(dir);
    seedOracle(dir);
    execaSyncMock.mockReturnValueOnce({exitCode: 1, stdout: '', stderr: 'FAIL tests/oracle/x.test.ts'});
    const r = runSpecConformance({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('FAIL');
  });

  test('runner is pointed at the oracle dir ONLY (never the whole suite)', () => {
    seedTs(dir);
    seedOracle(dir);
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    runSpecConformance({cwd: dir});
    expect(execaSyncMock).toHaveBeenCalledWith(
      'npx',
      ['--offline', '--no-install', 'vitest', 'run', ORACLE_DIR],
      expect.any(Object),
    );
  });

  test('missing runner binary (ENOENT) → skipped, not a false failure', () => {
    seedTs(dir);
    seedOracle(dir);
    execaSyncMock.mockReturnValueOnce({code: 'ENOENT', exitCode: undefined});
    expect(runSpecConformance({cwd: dir}).exitCode).toBe(2);
  });

  test('unknown language (no manifest) → skipped, runner not invoked', () => {
    seedOracle(dir);
    const r = runSpecConformance({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(execaSyncMock).not.toHaveBeenCalled();
  });
});
