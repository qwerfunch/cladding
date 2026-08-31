// Cladding · unit tests for core/postmortem.ts (v0.3.22, F-x)
//
// Phase 3.3 contract:
//   - writePostMortem creates `.cladding/post-mortems/` if missing
//   - filename pattern is post-mortem-<F-id>-<sanitised-ts>.md
//   - markdown body contains: feature id, last failed gate, retry
//     count, checkpoint git head, recovery command
//   - successive rollbacks of the same feature produce distinct
//     files (no overwrite)
//   - no-git-head checkpoints fall back to the manual-restore line

import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import type {Checkpoint} from '../../src/core/checkpoint.js';
import {writePostMortem} from '../../src/core/postmortem.js';

function fakeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    featureId: 'F-001',
    gitHead: 'abc123def456abc123def456abc123def456abcd',
    specDigest: 'deadbeef'.repeat(8),
    timestamp: '2026-05-20T01:02:03.456Z',
    ...overrides,
  };
}

describe('core/postmortem', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-postmortem-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-5d3ed2/AC-002] creates .cladding/post-mortems/ when missing and returns the path', () => {
    expect(existsSync(join(dir, '.cladding', 'post-mortems'))).toBe(false);
    const path = writePostMortem(dir, {
      featureId: 'F-001',
      retryCount: 3,
      lastFailedGate: 'stage_1.1',
      checkpoint: fakeCheckpoint(),
      rolledBackAt: '2026-05-20T01:02:04.000Z',
    });
    expect(existsSync(join(dir, '.cladding', 'post-mortems'))).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain('post-mortem-F-001-2026-05-20T01-02-04-000Z.md');
  });

  test('markdown body captures feature id, gate, retry count, checkpoint head, recovery command', () => {
    const path = writePostMortem(dir, {
      featureId: 'F-200',
      retryCount: 3,
      lastFailedGate: 'stage_1.2',
      checkpoint: fakeCheckpoint({gitHead: 'abc123def456abc123def456abc123def456abcd'}),
      rolledBackAt: '2026-05-20T05:06:07.000Z',
    });
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('F-200');
    expect(body).toContain('stage_1.2');
    expect(body).toContain('3 (budget exhausted)');
    expect(body).toContain('abc123def456');
    expect(body).toContain('git checkout abc123def456abc123def456abc123def456abcd');
    // 0.6.0: the recovery line points at `clad run` (the removed `work` verb
    // is no longer recommended).
    expect(body).toContain('clad run');
    expect(body).not.toContain('clad work');
    expect(body).toContain('planner');
  });

  test('[covers:F-5d3ed2/AC-004] no-git-head checkpoint falls back to manual-restore guidance', () => {
    const path = writePostMortem(dir, {
      featureId: 'F-300',
      retryCount: 3,
      lastFailedGate: 'stage_1.5',
      checkpoint: fakeCheckpoint({gitHead: null}),
      rolledBackAt: '2026-05-20T09:10:11.000Z',
    });
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('no git head pinned');
    expect(body).toContain('restore spec.yaml manually from VCS history');
    expect(body).not.toMatch(/git checkout [a-f0-9]/);
  });

  test('[covers:F-5d3ed2/AC-003] two rollbacks of the same feature produce two distinct files', () => {
    writePostMortem(dir, {
      featureId: 'F-400',
      retryCount: 3,
      lastFailedGate: 'stage_1.1',
      checkpoint: fakeCheckpoint(),
      rolledBackAt: '2026-05-20T10:00:00.000Z',
    });
    writePostMortem(dir, {
      featureId: 'F-400',
      retryCount: 3,
      lastFailedGate: 'stage_1.2',
      checkpoint: fakeCheckpoint(),
      rolledBackAt: '2026-05-20T11:00:00.000Z',
    });
    const files = readdirSync(join(dir, '.cladding', 'post-mortems'));
    const f400 = files.filter((f) => f.startsWith('post-mortem-F-400-'));
    expect(f400).toHaveLength(2);
  });

  test('sanitises colon and period in the timestamp segment', () => {
    const path = writePostMortem(dir, {
      featureId: 'F-500',
      retryCount: 3,
      lastFailedGate: 'stage_1.5',
      checkpoint: fakeCheckpoint(),
      rolledBackAt: '2026-05-20T12:34:56.789Z',
    });
    // Both `:` and `.` must be replaced with `-`.
    expect(path).not.toContain(':');
    expect(path).toContain('2026-05-20T12-34-56-789Z');
  });

  test('unknown lastFailedGate string is preserved verbatim (sentinel)', () => {
    const path = writePostMortem(dir, {
      featureId: 'F-600',
      retryCount: 3,
      lastFailedGate: 'unknown',
      checkpoint: fakeCheckpoint(),
      rolledBackAt: '2026-05-20T13:00:00.000Z',
    });
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('Last failed gate: `unknown`');
  });
});
