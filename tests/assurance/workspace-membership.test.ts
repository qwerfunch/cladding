// Cladding · Spec 0.2 F6 · portable sealed-file membership.

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {WORKSPACE_METADATA_FILES, withWorkspaceMembership, workspaceMembership} from '../../src/assurance/workspace-membership.js';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function git(root: string, ...args: readonly string[]): void {
  execFileSync('git', args, {cwd: root, stdio: 'ignore'});
}

function gitRoot(): string {
  const root = temporaryRoot('clad-membership-git-');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, '.gitignore'), 'ignored/\n*.local.json\n');
  writeFileSync(join(root, 'src', 'tracked.ts'), 'export const value = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F6 workspace membership', () => {
  test('[covers:F-71da4292/AC-10bf4679] seals tracked and untracked-not-ignored files while excluding what git ignores', () => {
    const root = gitRoot();
    mkdirSync(join(root, 'ignored'), {recursive: true});
    writeFileSync(join(root, 'src', 'untracked.ts'), 'export const added = 2;\n');
    writeFileSync(join(root, 'src', 'settings.local.json'), '{}\n');
    writeFileSync(join(root, 'ignored', 'package.json'), '{}\n');

    const membership = workspaceMembership(root);

    expect(membership.source).toBe('git');
    expect(membership.includes('src/tracked.ts')).toBe(true);
    expect(membership.includes('src/untracked.ts')).toBe(true);
    expect(membership.includes('src/settings.local.json')).toBe(false);
    expect(membership.includes('ignored/package.json')).toBe(false);
    expect(membership.includes('src/absent.ts')).toBe(false);
  });

  test('[covers:F-71da4292/AC-5ab01c62] excludes desktop metadata files even when git tracks them', () => {
    const root = gitRoot();
    for (const name of WORKSPACE_METADATA_FILES) writeFileSync(join(root, 'src', name), 'metadata\n');
    git(root, 'add', '-f', 'src');
    git(root, 'commit', '-q', '-m', 'metadata');

    const membership = workspaceMembership(root);

    expect(membership.source).toBe('git');
    for (const name of WORKSPACE_METADATA_FILES) expect(membership.includes(`src/${name}`)).toBe(false);
    expect(membership.includes('src/tracked.ts')).toBe(true);
    expect(workspaceMembership(root, {source: 'filesystem'}).includes('src/.DS_Store')).toBe(false);
  });

  test('[covers:F-71da4292/AC-87a4ff16] falls back to the filesystem walk outside a git repository, minus desktop metadata', () => {
    const root = temporaryRoot('clad-membership-plain-');
    mkdirSync(join(root, 'src'), {recursive: true});
    writeFileSync(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
    writeFileSync(join(root, 'src', '.DS_Store'), 'metadata\n');

    const membership = workspaceMembership(root);

    expect(membership.source).toBe('filesystem');
    expect(membership.includes('src/a.ts')).toBe(true);
    expect(membership.includes('src/anything-else.ts')).toBe(true);
    expect(membership.includes('src/.DS_Store')).toBe(false);
    expect(membership.includes('Thumbs.db')).toBe(false);
  });

  test('[covers:F-71da4292/AC-910947af] reuses one listing inside a gate evaluation and reads a fresh one for the next', () => {
    const root = gitRoot();

    const inScope = withWorkspaceMembership(() => {
      const first = workspaceMembership(root);
      writeFileSync(join(root, 'src', 'added.ts'), 'export const added = 3;\n');
      const second = workspaceMembership(root);
      // One evaluation may not observe two different workspaces.
      expect(second).toBe(first);
      // A nested evaluation shares the outer listing rather than re-reading it.
      expect(withWorkspaceMembership(() => workspaceMembership(root))).toBe(first);
      return second.includes('src/added.ts');
    });

    expect(inScope).toBe(false);
    expect(withWorkspaceMembership(() => workspaceMembership(root)).includes('src/added.ts')).toBe(true);
    expect(workspaceMembership(root).includes('src/added.ts')).toBe(true);
  });
});
