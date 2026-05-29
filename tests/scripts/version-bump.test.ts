// Cladding · unit tests for scripts/version-bump.mjs (F-090)
//
// Tests run the script in a synthetic project tree (tmpdir with the
// eight version-bearing files at exactly the same relative paths the
// real script expects). Verifies:
//   - all eight files updated atomically
//   - idempotent (running with current version is a no-op)
//   - invalid SemVer rejected
//   - missing anchor in a file raises a clear error

import {execFileSync, type ExecFileSyncOptions} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'version-bump.mjs');

function seedProject(dir: string, version: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    `{\n  "name": "probe",\n  "version": "${version}"\n}\n`,
  );
  mkdirSync(join(dir, 'plugins', 'claude-code', '.claude-plugin'), {recursive: true});
  writeFileSync(
    join(dir, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'),
    `{\n  "name": "probe",\n  "version": "${version}"\n}\n`,
  );
  mkdirSync(join(dir, 'plugins', 'codex', '.codex-plugin'), {recursive: true});
  writeFileSync(
    join(dir, 'plugins', 'codex', '.codex-plugin', 'plugin.json'),
    `{\n  "name": "probe",\n  "version": "${version}"\n}\n`,
  );
  mkdirSync(join(dir, 'plugins', 'gemini-cli'), {recursive: true});
  writeFileSync(
    join(dir, 'plugins', 'gemini-cli', 'gemini-extension.json'),
    `{\n  "name": "probe",\n  "version": "${version}"\n}\n`,
  );
  mkdirSync(join(dir, 'src', 'cli'), {recursive: true});
  writeFileSync(
    join(dir, 'src', 'cli', 'clad.ts'),
    `program.name('probe').description('x').version('${version}');\n`,
  );
  mkdirSync(join(dir, 'src', 'serve'), {recursive: true});
  writeFileSync(
    join(dir, 'src', 'serve', 'server.ts'),
    `const s = new McpServer({name: 'x', version: opts.version ?? '${version}'});\n`,
  );
  mkdirSync(join(dir, 'tests', 'cli'), {recursive: true});
  writeFileSync(
    join(dir, 'tests', 'cli', 'clad.test.ts'),
    `expect(program.version()).toBe('${version}');\n`,
  );
  // 8th site (v0.4.x): spec.yaml project.version — Tier A SSoT tracks the binary.
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject:\n  name: probe\n  version: "${version}"\n`,
  );
}

function runScript(
  cwd: string,
  args: readonly string[],
): {status: number | null; stdout: string; stderr: string} {
  try {
    const opts: ExecFileSyncOptions = {cwd, encoding: 'utf8'};
    const stdout = execFileSync('node', [SCRIPT_PATH, ...args], opts);
    return {status: 0, stdout: stdout.toString(), stderr: ''};
  } catch (err) {
    const e = err as {status: number | null; stdout?: Buffer; stderr?: Buffer};
    return {
      status: e.status,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

describe('version-bump.mjs (F-090, v0.3.15)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-version-bump-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('happy path — bumps all eight files atomically', () => {
    seedProject(dir, '0.3.14');
    const result = runScript(dir, ['0.3.15']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('8 files updated to 0.3.15');

    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain('"version": "0.3.15"');
    expect(readFileSync(join(dir, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8')).toContain('"version": "0.3.15"');
    expect(readFileSync(join(dir, 'plugins', 'codex', '.codex-plugin', 'plugin.json'), 'utf8')).toContain('"version": "0.3.15"');
    expect(readFileSync(join(dir, 'plugins', 'gemini-cli', 'gemini-extension.json'), 'utf8')).toContain('"version": "0.3.15"');
    expect(readFileSync(join(dir, 'src', 'cli', 'clad.ts'), 'utf8')).toContain(".version('0.3.15')");
    expect(readFileSync(join(dir, 'src', 'serve', 'server.ts'), 'utf8')).toContain("'0.3.15'");
    expect(readFileSync(join(dir, 'tests', 'cli', 'clad.test.ts'), 'utf8')).toContain("'0.3.15'");
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('  version: "0.3.15"');
  });

  test('idempotent — running with same version is a no-op', () => {
    seedProject(dir, '0.3.15');
    const result = runScript(dir, ['0.3.15']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('already');
  });

  test('rejects invalid SemVer', () => {
    seedProject(dir, '0.3.14');
    const result = runScript(dir, ['not-a-version']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SemVer');
  });

  test('rejects pre-release / build-metadata SemVer (only major.minor.patch)', () => {
    seedProject(dir, '0.3.14');
    const result = runScript(dir, ['0.3.15-rc1']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SemVer');
  });

  test('missing arg → usage message', () => {
    seedProject(dir, '0.3.14');
    const result = runScript(dir, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('usage');
  });

  test('missing anchor in a file → error with file path', () => {
    seedProject(dir, '0.3.14');
    // Corrupt one file's anchor.
    writeFileSync(join(dir, 'package.json'), '{"name": "probe"}\n');
    const result = runScript(dir, ['0.3.15']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('package.json');
    expect(result.stderr).toContain('anchor');
  });
});
