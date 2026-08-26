// Cladding · impl-blind oracle for F-b0c2e724 — authored from the spec contract only.
//
// The author of this file had no access to src/init/gitignore-policy.ts (no Read,
// Grep, Glob). Every assertion below is derived from the written acceptance
// contract for F-b0c2e724 (committable gate config) and from git's own behaviour,
// which is exercised live via execSync in a throwaway repository.

import {execSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {
  CLADDING_IGNORE_BLOCK,
  gateConfigIgnoreStatus,
  hasCladdingIgnoreEntry,
} from '../../src/init/gitignore-policy.js';

/**
 * The contract states these accept text that may be null/undefined. Bind through
 * locally-widened aliases so the oracle exercises the documented inputs without
 * depending on the implementation's exact parameter annotations.
 */
const statusOf = gateConfigIgnoreStatus as (text?: string | null) => string;
const hasEntry = hasCladdingIgnoreEntry as (text?: string | null) => boolean;

const blockLines = (): string[] =>
  String(CLADDING_IGNORE_BLOCK)
    .split('\n')
    .map((line) => line.trim());

describe('F-b0c2e724 · CLADDING_IGNORE_BLOCK shape', () => {
  it('contains a `.cladding/*` line', () => {
    expect(blockLines()).toContain('.cladding/*');
  });

  it('contains `!.cladding/config.yaml` AFTER the `.cladding/*` line', () => {
    const lines = blockLines();
    const star = lines.indexOf('.cladding/*');
    const reinclude = lines.indexOf('!.cladding/config.yaml');
    expect(star).toBeGreaterThanOrEqual(0);
    expect(reinclude).toBeGreaterThanOrEqual(0);
    expect(reinclude).toBeGreaterThan(star);
  });

  it('does NOT contain a bare `.cladding/` directory-exclusion line', () => {
    expect(blockLines()).not.toContain('.cladding/');
    expect(blockLines()).not.toContain('.cladding');
  });
});

describe('F-b0c2e724 · gateConfigIgnoreStatus', () => {
  it('reports "absent" for null', () => {
    expect(statusOf(null)).toBe('absent');
  });

  it('reports "absent" for undefined', () => {
    expect(statusOf(undefined)).toBe('absent');
  });

  it('reports "commitable" when no cladding-related line is present', () => {
    const text = ['node_modules/', 'dist/', '*.log', '.DS_Store', ''].join('\n');
    expect(statusOf(text)).toBe('commitable');
  });

  it('reports "commitable" for `.cladding/*` followed later by `!.cladding/config.yaml`', () => {
    const text = ['node_modules/', '.cladding/*', '', '!.cladding/config.yaml', ''].join('\n');
    expect(statusOf(text)).toBe('commitable');
  });

  it('reports "blocked" for `.cladding/` alone', () => {
    const text = ['node_modules/', '.cladding/', ''].join('\n');
    expect(statusOf(text)).toBe('blocked');
  });

  it('reports "blocked" for `.cladding/` PLUS `!.cladding/config.yaml` (git cannot re-include under an excluded directory)', () => {
    const text = ['.cladding/', '!.cladding/config.yaml', ''].join('\n');
    expect(statusOf(text)).toBe('blocked');
  });

  it('reports "blocked" for bare `.cladding` alone', () => {
    const text = ['dist/', '.cladding', ''].join('\n');
    expect(statusOf(text)).toBe('blocked');
  });

  it('reports "blocked" for `.cladding/*` alone with no re-include', () => {
    const text = ['dist/', '.cladding/*', ''].join('\n');
    expect(statusOf(text)).toBe('blocked');
  });

  it('reports "commitable" when the only mention is a `#` comment', () => {
    const text = ['node_modules/', '# .cladding/', ''].join('\n');
    expect(statusOf(text)).toBe('commitable');
  });

  it('trims lines before classifying (indented `.cladding/` still blocks)', () => {
    const text = ['node_modules/', '   .cladding/   ', ''].join('\n');
    expect(statusOf(text)).toBe('blocked');
  });
});

describe('F-b0c2e724 · hasCladdingIgnoreEntry', () => {
  it('is true for a real `.cladding/` line', () => {
    expect(hasEntry(['dist/', '.cladding/', ''].join('\n'))).toBe(true);
  });

  it('is true for a real bare `.cladding` line', () => {
    expect(hasEntry(['dist/', '.cladding', ''].join('\n'))).toBe(true);
  });

  it('is true for a real `.cladding/*` line', () => {
    expect(hasEntry(['dist/', '.cladding/*', ''].join('\n'))).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(hasEntry('\t.cladding/  \n')).toBe(true);
    expect(hasEntry('   .cladding   \n')).toBe(true);
    expect(hasEntry('  .cladding/*\t\n')).toBe(true);
  });

  it('is false for empty text', () => {
    expect(hasEntry('')).toBe(false);
  });

  it('is false for unrelated lines', () => {
    expect(hasEntry(['node_modules/', 'dist/', '*.log', ''].join('\n'))).toBe(false);
  });

  it('is false when the mention is only inside a comment', () => {
    expect(hasEntry(['# .cladding/', '# ignore .cladding later?', ''].join('\n'))).toBe(false);
  });
});

describe('F-b0c2e724 · ground truth against git itself', () => {
  let repo: string;

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };

  /** Returns git check-ignore's exit status: 0 = ignored, 1 = not ignored. */
  const checkIgnoreStatus = (relPath: string): number => {
    try {
      execSync(`git check-ignore -- ${JSON.stringify(relPath)}`, {
        cwd: repo,
        env: gitEnv,
        stdio: 'pipe',
      });
      return 0;
    } catch (error) {
      const status = (error as {status?: number}).status;
      return typeof status === 'number' ? status : -1;
    }
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'clad-gitignore-oracle-'));
    execSync('git init -q', {cwd: repo, env: gitEnv, stdio: 'pipe'});
    mkdirSync(join(repo, '.cladding'), {recursive: true});
    writeFileSync(join(repo, '.cladding', 'config.yaml'), 'gate: {}\n', 'utf8');
    writeFileSync(join(repo, '.cladding', 'events.log.jsonl'), '{"e":1}\n', 'utf8');
  });

  afterAll(() => {
    if (repo) rmSync(repo, {recursive: true, force: true});
  });

  it('with CLADDING_IGNORE_BLOCK, git does NOT ignore .cladding/config.yaml', () => {
    writeFileSync(join(repo, '.gitignore'), String(CLADDING_IGNORE_BLOCK), 'utf8');
    expect(checkIgnoreStatus('.cladding/config.yaml')).not.toBe(0);
  });

  it('with CLADDING_IGNORE_BLOCK, git DOES ignore .cladding/events.log.jsonl', () => {
    writeFileSync(join(repo, '.gitignore'), String(CLADDING_IGNORE_BLOCK), 'utf8');
    expect(checkIgnoreStatus('.cladding/events.log.jsonl')).toBe(0);
  });

  it('with `.cladding/` + `!.cladding/config.yaml`, git STILL ignores config.yaml — the "blocked" verdict is truthful', () => {
    writeFileSync(join(repo, '.gitignore'), '.cladding/\n!.cladding/config.yaml\n', 'utf8');
    expect(checkIgnoreStatus('.cladding/config.yaml')).toBe(0);
    expect(statusOf('.cladding/\n!.cladding/config.yaml\n')).toBe('blocked');
  });
});
