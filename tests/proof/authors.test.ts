// Cladding · Spec 0.2 F9d · implementation-author mapping tests.

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {implementationAuthorMapping, isIndependentIssuer} from '../../src/proof/authors.js';
import type {Evidence} from '../../src/hitl/identity.js';

const temporary: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f9d-authors-'));
  temporary.push(root);
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\n');
  return root;
}

function gitRepository(author: string): string {
  const root = scratch();
  const git = (...args: string[]): void => { execFileSync('git', args, {cwd: root, stdio: 'ignore'}); };
  git('init', '-q');
  git('config', 'user.email', 'author@example.test');
  git('config', 'user.name', author);
  git('add', 'src/alpha.ts');
  git('-c', `user.name=${author}`, 'commit', '-q', '-m', 'add alpha');
  return root;
}

function evidence(artifact: string, name: string): Evidence {
  return {
    id: '01JHT0000000000000000000AA', featureId: 'F-aaaaaaaa', stage: 'stage_3.1',
    identity: {author: 'human', name, timestamp: '2026-09-03T00:00:00.000Z'},
    kind: 'note', assurance: 'asserted', content: 'edited alpha', artifact,
  };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec 0.2 implementation author mapping', () => {
  test('[covers:F-f4cfd533/AC-af5978d3] prefers audit-log mutation identity over the git author of the same root', () => {
    const root = gitRepository('Git Author');
    const mapping = implementationAuthorMapping(root, ['src/alpha.ts'], [evidence('src/alpha.ts', 'Audited Human')]);
    expect(mapping.records).toEqual([{root: 'src/alpha.ts', assurance: 'asserted', author: 'human', name: 'Audited Human'}]);
    expect(mapping.complete).toBe(true);
    expect(mapping.names).toEqual(['Audited Human']);
  });

  test('[covers:F-f4cfd533/AC-af5978d3] falls back to the git author of the root as an asserted record', () => {
    const root = gitRepository('Git Author');
    const mapping = implementationAuthorMapping(root, ['src/alpha.ts'], []);
    expect(mapping.records).toEqual([{root: 'src/alpha.ts', assurance: 'asserted', author: 'git', name: 'Git Author'}]);
    expect(mapping.complete).toBe(true);
    // Git metadata is self-reported, so the record stays asserted no matter
    // how confident the name looks.
    expect(mapping.records.every((record) => record.assurance === 'asserted')).toBe(true);
  });

  test('[covers:F-f4cfd533/AC-de5fe055] records the unknown sentinel for an unattributable root', () => {
    const bare = scratch();
    const mapping = implementationAuthorMapping(bare, ['src/alpha.ts'], []);
    expect(mapping.records).toEqual([{root: 'src/alpha.ts', assurance: 'asserted', author: 'unknown', name: ''}]);
    expect(mapping.complete).toBe(false);
    expect(mapping.names).toEqual([]);
    const repository = gitRepository('Git Author');
    const mixed = implementationAuthorMapping(repository, ['src/alpha.ts', 'src/untracked.ts'], []);
    expect(mixed.complete).toBe(false);
    expect(mixed.records).toContainEqual({root: 'src/untracked.ts', assurance: 'asserted', author: 'unknown', name: ''});
  });

  test('[covers:F-f4cfd533/AC-af5978d3] hashes the sorted unique records deterministically and names the author set', () => {
    const root = gitRepository('Git Author');
    const first = implementationAuthorMapping(root, ['src/alpha.ts'], [evidence('src/alpha.ts', 'Audited Human')]);
    const second = implementationAuthorMapping(root, ['./src/alpha.ts', 'src/alpha.ts'], [evidence('./src/alpha.ts', 'Audited Human')]);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    // The authored spelling stays the record identity, so a second spelling of
    // the same file is a second root rather than a silent merge.
    expect(second.records).toHaveLength(2);
    expect(implementationAuthorMapping(root, ['src/alpha.ts'], [evidence('src/alpha.ts', 'Audited Human')]).sha256).toBe(first.sha256);
    expect(isIndependentIssuer(first, 'audited human')).toBe(false);
    expect(isIndependentIssuer(first, 'Independent Reviewer')).toBe(true);
    expect(isIndependentIssuer(first, '   ')).toBe(false);
  });
});
