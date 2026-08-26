import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {claddingMajorMinor, readCiVersionHealth} from '../../src/cli/ci-version.js';

describe('CI version health', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ci-version-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  function write(relativePath: string, body: string): void {
    const path = join(dir, relativePath);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, body, 'utf8');
  }

  test('finds unpinned and floating Cladding npx calls in yml and yaml workflows', () => {
    write('.github/workflows/z-unpinned.yml', 'steps:\n  - run: npx --yes cladding check --strict\n');
    write('.github/workflows/nested/a-floating.yaml', 'steps:\n  - run: npx cladding@latest doctor\n');
    write('.github/workflows/pinned.yml', 'steps:\n  - run: npx --yes cladding@0.9 check --strict\n');

    expect(readCiVersionHealth(dir)).toEqual({
      unpinnedWorkflows: [
        '.github/workflows/nested/a-floating.yaml',
        '.github/workflows/z-unpinned.yml',
      ],
    });
  });

  test('accepts numeric selectors and ignores comments or unrelated commands', () => {
    write(
      '.github/workflows/safe.yml',
      [
        '# run: npx --yes cladding check --strict',
        'steps:',
        '  - run: npx --yes cladding@0.9 check --strict',
        '  - run: npx cladding@0.9.3 doctor',
        '  - run: npx cladding@0.9.4-beta.1 check',
        '  - run: npx eslint .',
        '  - run: npm ci',
        '',
      ].join('\n'),
    );

    expect(readCiVersionHealth(dir).unpinnedWorkflows).toEqual([]);
    expect(claddingMajorMinor('0.9.3')).toBe('0.9');
    expect(claddingMajorMinor('10.12.0-beta.1+build.7')).toBe('10.12');
    expect(claddingMajorMinor(null)).toBeNull();
    expect(claddingMajorMinor('latest')).toBeNull();
  });
});
