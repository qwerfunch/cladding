// Cladding · F7b · safe live-test census tests.

import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {currentSafeBindingCensus} from '../../src/proof/current-bindings.js';

const roots: string[] = [];
const criterion = 'F-aaaaaaaa/AC-bbbbbbbb';

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-current-binding-census-'));
  roots.push(cwd);
  return cwd;
}

afterEach(() => {
  for (const cwd of roots.splice(0)) rmSync(cwd, {recursive: true, force: true});
});

describe('F7b current live-binding census safety', () => {
  test('treats only a truly absent tests root as a proved-safe empty census', () => {
    expect(currentSafeBindingCensus(workspace(), new Set([criterion])))
      .toMatchObject({safe: true, bindings: []});
  });

  test('treats a malformed test source and a regular-file tests root as unsafe', () => {
    const malformed = workspace();
    mkdirSync(join(malformed, 'tests'), {recursive: true});
    writeFileSync(join(malformed, 'tests', 'broken.test.ts'), 'it(\'unterminated\'\n');
    expect(currentSafeBindingCensus(malformed, new Set([criterion]))).toMatchObject({safe: false, bindings: []});

    const regularFile = workspace();
    writeFileSync(join(regularFile, 'tests'), 'not a directory\n');
    expect(currentSafeBindingCensus(regularFile, new Set([criterion]))).toMatchObject({safe: false, bindings: []});
  });

  test('treats a dangling tests symlink as unsafe when the platform permits link creation', () => {
    const cwd = workspace();
    try {
      symlinkSync(join(cwd, 'missing-tests-target'), join(cwd, 'tests'), 'dir');
    } catch (error) {
      // Windows can deny symlink creation without Developer Mode or elevated
      // privileges. Make that unsupported test capability explicit instead of
      // treating the missing fixture as a successful safety assertion.
      expect(['EPERM', 'EACCES', 'ENOSYS']).toContain((error as {code?: unknown}).code);
      expect(process.platform).toBe('win32');
      return;
    }
    expect(currentSafeBindingCensus(cwd, new Set([criterion]))).toMatchObject({safe: false, bindings: []});
  });
});
