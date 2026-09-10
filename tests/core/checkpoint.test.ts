// Cladding · unit tests for core/checkpoint.ts (v0.3.20, F-x)
//
// Phase 1 contract:
//   - recordCheckpoint writes exactly one feature_checkpoint event and
//     returns a Checkpoint with git head + spec digest + timestamp
//   - computeSpecDigest is deterministic across runs and stable across
//     readdirSync ordering
//   - findLatestCheckpoint returns the most recent matching event in
//     reverse-order walk (older checkpoints stay readable but the
//     latest one is returned)
//   - recordRollback emits one feature_rolled_back event referencing
//     the supplied checkpoint
//
// Git interaction is exercised through the actual git binary because
// the project repo itself satisfies the rev-parse requirement; tests
// that need a no-git path run inside a tmpdir.

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  computeSpecDigest,
  findLatestCheckpoint,
  readGitHead,
  recordCheckpoint,
  recordRollback,
} from '../../src/core/checkpoint.js';
import {readEvents} from '../../src/events/log.js';

describe('core/checkpoint', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-checkpoint-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  describe('readGitHead', () => {
    test('outside a git repo returns null', () => {
      expect(readGitHead(dir)).toBe(null);
    });

    test('inside a fresh git repo returns the HEAD sha', () => {
      execFileSync('git', ['init', '-q'], {cwd: dir});
      execFileSync('git', ['config', 'user.email', 'test@example.com'], {cwd: dir});
      execFileSync('git', ['config', 'user.name', 'test'], {cwd: dir});
      writeFileSync(join(dir, 'README.md'), 'x\n');
      execFileSync('git', ['add', '.'], {cwd: dir});
      execFileSync('git', ['commit', '-q', '-m', 'initial'], {cwd: dir});
      const head = readGitHead(dir);
      expect(head).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('computeSpecDigest', () => {
    test('empty workspace produces a stable digest (no spec files)', () => {
      const d1 = computeSpecDigest(dir);
      const d2 = computeSpecDigest(dir);
      expect(d1).toBe(d2);
      expect(d1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('digest changes when spec.yaml content changes', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const d1 = computeSpecDigest(dir);
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: [{id: F-001}]\n');
      const d2 = computeSpecDigest(dir);
      expect(d1).not.toBe(d2);
    });

    test('digest includes sharded features/scenarios subdirectories', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const baseline = computeSpecDigest(dir);
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec', 'features', 'F-001.yaml'), 'id: F-001\ntitle: t\n');
      const withFeature = computeSpecDigest(dir);
      expect(withFeature).not.toBe(baseline);
    });
  });

  describe('recordCheckpoint', () => {
    test('[covers:F-c2c996/AC-005] checkpoint appends one event without changing tracked source or specification bytes', () => {
      const specPath = join(dir, 'spec.yaml');
      const sourcePath = join(dir, 'src', 'app.ts');
      mkdirSync(join(dir, 'src'), {recursive: true});
      writeFileSync(specPath, 'schema: "0.1"\nfeatures: []\n', 'utf8');
      writeFileSync(sourcePath, 'export const immutable = true;\n', 'utf8');
      const before = {spec: readFileSync(specPath, 'utf8'), source: readFileSync(sourcePath, 'utf8')};

      recordCheckpoint(dir, 'F-001');

      expect(readFileSync(specPath, 'utf8')).toBe(before.spec);
      expect(readFileSync(sourcePath, 'utf8')).toBe(before.source);
      expect(readEvents(dir).filter((event) => event.type === 'feature_checkpoint')).toHaveLength(1);
    });

    test('[covers:F-c2c996/AC-002] writes one feature_checkpoint event with the captured fields', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const cp = recordCheckpoint(dir, 'F-001');
      expect(cp.featureId).toBe('F-001');
      expect(cp.specDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(cp.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const events = readEvents(dir);
      const checkpointEvents = events.filter((e) => e.type === 'feature_checkpoint');
      expect(checkpointEvents).toHaveLength(1);
      expect(checkpointEvents[0].payload.feature).toBe('F-001');
      expect(checkpointEvents[0].payload.spec_digest).toBe(cp.specDigest);
    });

    test('[covers:F-c2c996/AC-003] two checkpoints for the same feature both persist (latest wins on lookup)', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const cp1 = recordCheckpoint(dir, 'F-001');
      // Tweak the spec so the second checkpoint has a different digest.
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: [{id: F-001}]\n');
      const cp2 = recordCheckpoint(dir, 'F-001');
      expect(cp1.specDigest).not.toBe(cp2.specDigest);
      const events = readEvents(dir);
      expect(events.filter((e) => e.type === 'feature_checkpoint')).toHaveLength(2);
    });
  });

  describe('findLatestCheckpoint', () => {
    test('returns null when no checkpoint event exists for the feature', () => {
      expect(findLatestCheckpoint(dir, 'F-001')).toBe(null);
    });

    test('returns the latest checkpoint when multiple exist', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const cp1 = recordCheckpoint(dir, 'F-001');
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: [{id: F-001}]\n');
      const cp2 = recordCheckpoint(dir, 'F-001');
      const latest = findLatestCheckpoint(dir, 'F-001');
      expect(latest?.specDigest).toBe(cp2.specDigest);
      expect(latest?.specDigest).not.toBe(cp1.specDigest);
    });

    test('ignores checkpoints for other features', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      recordCheckpoint(dir, 'F-001');
      recordCheckpoint(dir, 'F-002');
      const cp = findLatestCheckpoint(dir, 'F-001');
      expect(cp?.featureId).toBe('F-001');
    });
  });

  describe('recordRollback', () => {
    test('[covers:F-c2c996/AC-e4bf75ed] rollback appends one reasoned event against its prior checkpoint', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const checkpoint = recordCheckpoint(dir, 'F-001');
      recordRollback(dir, 'F-001', checkpoint, 'maintainer requested restore');

      const rollbacks = readEvents(dir).filter((event) => event.type === 'feature_rolled_back');
      expect(rollbacks).toHaveLength(1);
      expect(rollbacks[0].payload).toMatchObject({
        feature: 'F-001',
        to_git_head: checkpoint.gitHead,
        to_spec_digest: checkpoint.specDigest,
        to_checkpoint_at: checkpoint.timestamp,
        reason: 'maintainer requested restore',
      });
    });

    test('[covers:F-c2c996/AC-001][covers:F-c2c996/AC-004] writes one feature_rolled_back event referencing the checkpoint', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const cp = recordCheckpoint(dir, 'F-001');
      recordRollback(dir, 'F-001', cp, 'retry-threshold exhausted');
      const events = readEvents(dir);
      const rollbacks = events.filter((e) => e.type === 'feature_rolled_back');
      expect(rollbacks).toHaveLength(1);
      expect(rollbacks[0].payload.feature).toBe('F-001');
      expect(rollbacks[0].payload.to_spec_digest).toBe(cp.specDigest);
      expect(rollbacks[0].payload.reason).toBe('retry-threshold exhausted');
    });

    test('reason is null when omitted', () => {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nfeatures: []\n');
      const cp = recordCheckpoint(dir, 'F-001');
      recordRollback(dir, 'F-001', cp);
      const events = readEvents(dir);
      const rollback = events.find((e) => e.type === 'feature_rolled_back');
      expect(rollback?.payload.reason).toBe(null);
    });
  });
});
