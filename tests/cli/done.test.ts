// Cladding · unit tests for cli/done.ts (the gated done-transition)
//
// Authored from the behavioral contract ONLY (anti-self-cert: the test
// author did not read src/cli/done.ts). The invariant under test is that
// `clad done` makes `status: done` EARN itself:
//   - it flips the feature's shard to `done` BEFORE running the gate
//     (so done-aware detectors evaluate the feature as done),
//   - it KEEPS done only if the injected gate is GREEN (worst === 0),
//   - on a RED gate (worst !== 0) it REVERTS the shard byte-for-byte.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {findShardFile, runDone, setStatus} from '../../src/cli/done.js';
import {readEvents} from '../../src/events/log.js';
import {writeFeatureIndex} from '../../src/spec/inventory.js';

// A realistic shard shape: a leading comment line, the id, a status, a
// title, and a couple of acceptance-criteria lines.
const SHARD_NAME = 'api-keys-2de1f8.yaml';
const FEATURE_ID = 'F-2de1f8';
const SHARD_BODY =
  '# api-keys feature shard (dogfood)\n' +
  'id: F-2de1f8\n' +
  'slug: api-keys\n' +
  'status: in_progress\n' +
  'title: Issue and revoke API keys\n' +
  'acceptance_criteria:\n' +
  '  - id: AC-001\n' +
  '    text: The system shall issue a scoped key.\n' +
  '  - id: AC-002\n' +
  '    text: The system shall revoke a key.\n';

function writeShard(dir: string, body = SHARD_BODY): string {
  const featuresDir = join(dir, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});
  const path = join(featuresDir, SHARD_NAME);
  writeFileSync(path, body);
  return path;
}

describe('findShardFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('finds the shard by id and returns its top-level status', () => {
    const path = writeShard(dir);
    const hit = findShardFile(dir, FEATURE_ID);
    expect(hit).not.toBeNull();
    expect(hit!.path).toBe(path);
    expect(hit!.status).toBe('in_progress');
  });

  test('returns null for an unknown id', () => {
    writeShard(dir);
    expect(findShardFile(dir, 'F-deadbe')).toBeNull();
  });

  test('returns null when spec/features/ is absent', () => {
    // No shard written → the directory does not exist.
    expect(findShardFile(dir, FEATURE_ID)).toBeNull();
  });
});

describe('setStatus', () => {
  test('replaces an existing top-level status line, leaving every other byte intact', () => {
    const body =
      '# leading comment\n' +
      'id: F-2de1f8\n' +
      'status: in_progress\n' +
      'title: keep me\n';
    const out = setStatus(body, 'done');
    expect(out).toContain('status: done');
    expect(out).not.toContain('status: in_progress');
    // Every other line survives untouched.
    expect(out).toContain('# leading comment');
    expect(out).toContain('id: F-2de1f8');
    expect(out).toContain('title: keep me');
    // Exactly one top-level status line.
    expect(out.match(/^status: /gm)?.length).toBe(1);
  });

  test('inserts status right after the id line when no status line exists', () => {
    const body = '# leading comment\nid: F-2de1f8\ntitle: keep me\n';
    const out = setStatus(body, 'done');
    expect(out).toContain('id: F-2de1f8\nstatus: done\n');
    expect(out).toContain('title: keep me');
    expect(out.match(/^status: /gm)?.length).toBe(1);
  });

  test('targets the TOP-LEVEL status only, not an indented one', () => {
    // An indented `status:` (e.g. nested under an AC) must not be the target;
    // only the column-0 status line is replaced.
    const body =
      'id: F-2de1f8\n' +
      'status: in_progress\n' +
      'acceptance_criteria:\n' +
      '  - id: AC-001\n' +
      '    status: open\n';
    const out = setStatus(body, 'done');
    expect(out).toContain('status: done');
    expect(out).not.toContain('status: in_progress');
    // The nested, indented status is preserved verbatim.
    expect(out).toContain('    status: open');
  });
});

describe('runDone', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  // ── F-37b4a8 — index status fidelity: clad done re-syncs the committed index ──

  test('a kept flip re-syncs the feature index to status: done', () => {
    const path = writeShard(dir);
    writeFeatureIndex(dir); // index starts mirroring the shard (in_progress)
    expect(readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8')).toContain('status: in_progress');
    runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 0}), onIndex: writeFeatureIndex});
    const indexAfter = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    expect(indexAfter).toContain('status: done');
    expect(indexAfter).not.toContain('status: in_progress');
    expect(readFileSync(path, 'utf8')).toContain('status: done'); // shard kept done
  });

  test('a reverted (red gate) flip re-syncs the index back to the original status', () => {
    writeShard(dir);
    writeFeatureIndex(dir);
    runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 1}), onIndex: writeFeatureIndex});
    const indexAfter = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    // Shard reverted to in_progress → index re-synced symmetrically (no inverse staleness).
    expect(indexAfter).toContain('status: in_progress');
    expect(indexAfter).not.toContain('status: done');
  });

  test('the index is refreshed before the gate runs so the status-aware detector sees a consistent index', () => {
    writeShard(dir);
    writeFeatureIndex(dir);
    let indexSaidDoneAtGateTime = false;
    runDone(dir, FEATURE_ID, {
      checkStages: () => {
        indexSaidDoneAtGateTime = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8').includes('status: done');
        return {worst: 0};
      },
      onIndex: writeFeatureIndex,
    });
    // Backfill runs PRE-gate → INVENTORY_DRIFT sees index==shard==done, never REDs the flip's own write.
    expect(indexSaidDoneAtGateTime).toBe(true);
  });

  test('GREEN gate keeps done and writes status: done to disk', () => {
    const path = writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
    });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.featureId).toBe(FEATURE_ID);
    expect(res.prevStatus).toBe('in_progress');
    expect(res.shardPath).toBe(path);
    expect(res.reason).toContain('GREEN');
    // The shard file on disk is now done.
    expect(readFileSync(path, 'utf8')).toContain('status: done');
  });

  test('RED gate reverts the shard byte-for-byte', () => {
    const path = writeShard(dir);
    const original = readFileSync(path, 'utf8');
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 1}),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(1);
    expect(res.prevStatus).toBe('in_progress');
    expect(res.reason).toContain('not GREEN');
    expect(res.reason).toContain('status left at');
    // Reverted to the EXACT original bytes — still in_progress, not done.
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(original);
    expect(after).toContain('status: in_progress');
    expect(after).not.toContain('status: done');
  });

  test('empty feature id → code 2', () => {
    const res = runDone(dir, '', {
      checkStages: () => ({worst: 0}),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(2);
    expect(res.reason).toContain('feature id required');
  });

  test('no matching shard → code 1 with "no feature shard"', () => {
    // spec/features/ does not exist at all.
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(1);
    expect(res.reason).toContain('no feature shard');
  });

  test('flip precedes the gate — the gate sees status: done already on disk', () => {
    const path = writeShard(dir);
    let sawDoneAtGateTime = false;
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => {
        // Read the shard at gate-call time and record whether the flip
        // already landed before the gate ran.
        sawDoneAtGateTime = readFileSync(path, 'utf8').includes('status: done');
        return {worst: 0};
      },
    });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    // The flip-then-gate ordering: the gate observed the feature as done.
    expect(sawDoneAtGateTime).toBe(true);
  });

  test('checkStages is invoked with {tier: "pre-push", strict: true} + the feature modules', () => {
    writeShard(dir);
    let captured: {strict?: boolean; tier?: string; focusModules?: readonly string[]} | undefined;
    runDone(dir, FEATURE_ID, {
      checkStages: (opts) => {
        captured = opts;
        return {worst: 0};
      },
    });
    // A modules-less shard forwards an empty scope → whole-repo (unchanged).
    expect(captured).toEqual({tier: 'pre-push', strict: true, focusModules: []});
  });

  test('forwards the focus feature modules to scope the gate', () => {
    writeShard(dir, SHARD_BODY + 'modules:\n  - worker/aggregator\n  - worker/ingest\n');
    let captured: {focusModules?: readonly string[]} | undefined;
    runDone(dir, FEATURE_ID, {
      checkStages: (opts) => {
        captured = opts;
        return {worst: 0};
      },
    });
    expect(captured?.focusModules).toEqual(['worker/aggregator', 'worker/ingest']);
  });
});

// ─── F-b84c38 — done_attempted lands in the ledger on BOTH paths ───

describe('runDone ledger emission (F-b84c38)', () => {
  let dir: string;
  const FEATURE_ID = 'F-aaaaaa';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-ev-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'features', 'x-aaaaaa.yaml'),
      `id: ${FEATURE_ID}\nslug: x\ntitle: t\nstatus: in_progress\n`,
    );
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('records done_attempted with kept:true on a GREEN gate', () => {
    runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 0, anyFailed: false})});
    const kept = readEvents(dir).filter((e) => e.type === 'done_attempted');
    expect(kept.length).toBe(1);
    expect(kept[0].payload).toMatchObject({feature: FEATURE_ID, worst: 0, kept: true});
    expect((kept[0].payload as {identity?: {author?: string}}).identity?.author).toBe('human');
  });

  test('records done_attempted with kept:false when the gate is RED and the flip reverts', () => {
    runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 1, anyFailed: true})});
    const ev = readEvents(dir).filter((e) => e.type === 'done_attempted');
    expect(ev.length).toBe(1);
    expect(ev[0].payload).toMatchObject({feature: FEATURE_ID, worst: 1, kept: false});
    // and the shard really reverted
    expect(readFileSync(join(dir, 'spec', 'features', 'x-aaaaaa.yaml'), 'utf8')).toContain('status: in_progress');
  });
});
