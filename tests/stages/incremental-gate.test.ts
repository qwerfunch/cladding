import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {detectToolchain} from '../../src/stages/toolchain/detect.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'incr-gate-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

const ts = () => writeFileSync(join(dir, 'package.json'), '{}');
const py = () => writeFileSync(join(dir, 'pyproject.toml'), '');

const after = (args: readonly string[], flag: string) =>
  args[args.indexOf(flag) + 1];

describe('incremental TS gate (F-bfe14aac)', () => {
  it('type gate uses incremental with cladding tsbuildinfo', () => {
    ts();
    const {gates} = detectToolchain(dir);
    expect(gates.type).toBeDefined();
    const {cmd, args} = gates.type!;
    expect(cmd).toBe('npx');
    expect(args.slice(0, 3)).toEqual(['--no-install', 'tsc', '--noEmit']);
    expect(args).toContain('--incremental');
    expect(args).toContain('--tsBuildInfoFile');
    expect(after(args, '--tsBuildInfoFile')).toBe(
      '.cladding/cache/tsc.tsbuildinfo',
    );
  });

  it('lint gate uses eslint cache under cladding', () => {
    ts();
    const {gates} = detectToolchain(dir);
    expect(gates.lint).toBeDefined();
    const {args} = gates.lint!;
    expect(args.slice(0, 3)).toEqual(['--no-install', 'eslint', '.']);
    expect(args).toContain('--cache');
    expect(args).toContain('--cache-location');
    expect(after(args, '--cache-location')).toBe('.cladding/cache/eslint');
  });

  it('all cache paths stay under .cladding/ (no project-root pollution)', () => {
    ts();
    const {gates} = detectToolchain(dir);
    const tsCache = after(gates.type!.args, '--tsBuildInfoFile');
    const lintCache = after(gates.lint!.args, '--cache-location');
    expect(tsCache.startsWith('.cladding/')).toBe(true);
    expect(lintCache.startsWith('.cladding/')).toBe(true);
  });

  it('test and coverage gates are unchanged', () => {
    ts();
    const {gates} = detectToolchain(dir);
    expect(gates.test).toBeDefined();
    expect(gates.coverage).toBeDefined();
    expect(gates.test!.args).toEqual(['--no-install', 'vitest', 'run']);
    expect(gates.coverage!.args).toEqual([
      '--no-install',
      'vitest',
      'run',
      '--coverage',
    ]);
  });

  it('non-TS (python) project is unaffected by incremental flags', () => {
    py();
    const {gates} = detectToolchain(dir);
    expect(gates.type?.args).not.toContain('--incremental');
    expect(gates.lint?.args).not.toContain('--cache');
  });
});
