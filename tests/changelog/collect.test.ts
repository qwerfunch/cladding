// Cladding · unit tests for src/changelog/collect.ts (F-904495a5)
//
// Exercised against REAL temp git repositories (init → baseline commit →
// tag v0 → mutate → commit) — the collector's contract is about what git
// history says, so mocking git would test the mock. Covers:
//   - flipped-to-done vs added-as-done vs modified-while-done classification
//   - capability grouping + the uncategorized bucket
//   - inventory count diff between the ref and the worktree
//   - unsharded feat/fix commit pickup (conventional subject, no F-id)
//   - invalid since ref → clear error (never a silently empty manifest)
//   - determinism: two runs serialize byte-identical JSON

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {collectChangelog, defaultSinceRef} from '../../src/changelog/collect.js';

function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {cwd: dir, encoding: 'utf8'});
}

function initRepo(dir: string): void {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function commitAll(dir: string, message: string): void {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

function shard(dir: string, file: string, id: string, slug: string, title: string, status: string): void {
  writeFileSync(
    join(dir, 'spec', 'features', file),
    [
      `id: ${id}`,
      `slug: ${slug}`,
      `title: "${title}"`,
      `status: ${status}`,
      'acceptance_criteria:',
      '  - id: AC-000001',
      '    ears: ubiquitous',
      `    text: "The system shall ${slug.replace(/-/g, ' ')}."`,
      '',
    ].join('\n'),
  );
}

function specYaml(dir: string, features: number): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    [
      'schema: "0.1"',
      'project:',
      '  name: probe',
      '  language: typescript',
      'inventory:',
      `  features: ${features}`,
      '  scenarios: 0',
      '  capabilities: 1',
      '  test_files: 0',
      '',
    ].join('\n'),
  );
}

describe('changelog/collect', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-changelog-'));
    initRepo(dir);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});
    specYaml(dir, 2);
    writeFileSync(
      join(dir, 'spec', 'capabilities.yaml'),
      [
        'schema: "0.1"',
        'capabilities:',
        '  - id: cap-alpha',
        '    title: "Alpha capability"',
        '    features: [F-aaa001, F-ccc003]',
        '',
      ].join('\n'),
    );
    shard(dir, 'alpha-flow-aaa001.yaml', 'F-aaa001', 'alpha-flow', 'Alpha flow', 'in_progress');
    shard(dir, 'gamma-flow-ccc003.yaml', 'F-ccc003', 'gamma-flow', 'Gamma flow', 'done');
    writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 1;\n');
    commitAll(dir, 'baseline');
    git(dir, ['tag', 'v0']);
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  /** Applies the standard post-tag mutations most tests share. */
  function mutate(): void {
    // alpha: in_progress at v0 → done now (flipped-to-done, in cap-alpha).
    shard(dir, 'alpha-flow-aaa001.yaml', 'F-aaa001', 'alpha-flow', 'Alpha flow', 'done');
    // beta: born done after v0, no capability claims it (added-as-done, uncategorized).
    shard(dir, 'beta-flow-bbb002.yaml', 'F-bbb002', 'beta-flow', 'Beta flow', 'done');
    // gamma: done at v0, title edited while done (modified-while-done).
    shard(dir, 'gamma-flow-ccc003.yaml', 'F-ccc003', 'gamma-flow', 'Gamma flow v2', 'done');
    specYaml(dir, 3);
    commitAll(dir, 'spec: ship alpha + beta, touch gamma');
    writeFileSync(join(dir, 'src', 'thing.ts'), 'export const thing = 2;\n');
    commitAll(dir, 'feat: add a thing users can see');
    writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 3;\n');
    commitAll(dir, 'fix: tighten the base path (F-aaa001)');
    writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 4;\n');
    commitAll(dir, 'chore: invisible plumbing');
  }

  function allFeatures(manifest: ReturnType<typeof collectChangelog>) {
    return manifest.groups.flatMap((g) => g.features);
  }

  test('classifies a shard that flipped to done vs one added as done since the ref', () => {
    mutate();
    const manifest = collectChangelog(dir, 'v0');
    const byId = new Map(allFeatures(manifest).map((f) => [f.id, f]));
    expect(byId.get('F-aaa001')?.change).toBe('flipped-to-done');
    expect(byId.get('F-bbb002')?.change).toBe('added-as-done');
    expect(byId.get('F-aaa001')?.acceptance).toEqual(['The system shall alpha flow.']);
  });

  test('classifies a done shard modified while done', () => {
    mutate();
    const manifest = collectChangelog(dir, 'v0');
    const gamma = allFeatures(manifest).find((f) => f.id === 'F-ccc003');
    expect(gamma?.change).toBe('modified-while-done');
    expect(gamma?.title).toBe('Gamma flow v2');
  });

  test('groups classified features by capability and routes unmatched ones to uncategorized', () => {
    mutate();
    const manifest = collectChangelog(dir, 'v0');
    expect(manifest.groups.map((g) => g.capability)).toEqual(['cap-alpha', 'uncategorized']);
    const capAlpha = manifest.groups[0];
    expect(capAlpha.title).toBe('Alpha capability');
    expect(capAlpha.features.map((f) => f.id)).toEqual(['F-aaa001', 'F-ccc003']);
    const uncategorized = manifest.groups[1];
    expect(uncategorized.features.map((f) => f.id)).toEqual(['F-bbb002']);
  });

  test('diffs the inventory counts between the ref and the worktree', () => {
    mutate();
    const manifest = collectChangelog(dir, 'v0');
    expect(manifest.inventory.before.features).toBe(2);
    expect(manifest.inventory.after.features).toBe(3);
    expect(manifest.inventory.before.capabilities).toBe(1);
  });

  test('picks up unsharded feat/fix commits that name no feature id', () => {
    mutate();
    const manifest = collectChangelog(dir, 'v0');
    const subjects = manifest.unsharded_commits.map((c) => c.subject);
    expect(subjects).toEqual(['feat: add a thing users can see']);
    // the F-id-naming fix and the chore both stay out — sharded work and
    // invisible plumbing are not under-reporting.
    expect(subjects.join('\n')).not.toContain('F-aaa001');
    expect(subjects.join('\n')).not.toContain('chore');
  });

  test('a planned shard added since the ref is not changelog material', () => {
    shard(dir, 'delta-flow-ddd004.yaml', 'F-ddd004', 'delta-flow', 'Delta flow', 'planned');
    commitAll(dir, 'spec: sketch delta');
    const manifest = collectChangelog(dir, 'v0');
    expect(allFeatures(manifest).map((f) => f.id)).not.toContain('F-ddd004');
  });

  test('throws a clear error naming an invalid since ref instead of returning empty', () => {
    mutate();
    expect(() => collectChangelog(dir, 'no-such-ref')).toThrow(/no-such-ref/);
    expect(() => collectChangelog(dir, 'no-such-ref')).toThrow(/never a silently empty changelog/);
  });

  test('defaultSinceRef returns the latest tag and throws a clear error when no tag exists', () => {
    expect(defaultSinceRef(dir)).toBe('v0');
    const untagged = mkdtempSync(join(tmpdir(), 'clad-changelog-notag-'));
    try {
      initRepo(untagged);
      writeFileSync(join(untagged, 'a.txt'), 'a\n');
      commitAll(untagged, 'baseline');
      expect(() => defaultSinceRef(untagged)).toThrow(/no git tag/);
    } finally {
      rmSync(untagged, {recursive: true, force: true});
    }
  });

  test('is deterministic — two runs produce byte-identical JSON', () => {
    mutate();
    const first = JSON.stringify(collectChangelog(dir, 'v0'), null, 2);
    const second = JSON.stringify(collectChangelog(dir, 'v0'), null, 2);
    expect(second).toBe(first);
    // sorted ids within a group (construction order cannot leak in).
    const manifest = collectChangelog(dir, 'v0');
    for (const group of manifest.groups) {
      const ids = group.features.map((f) => f.id);
      expect(ids).toEqual([...ids].sort());
    }
  });
});
