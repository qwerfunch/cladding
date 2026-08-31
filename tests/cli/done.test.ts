// Cladding · unit tests for cli/done.ts (the gated done-transition)
//
// Authored from the behavioral contract ONLY (anti-self-cert: the test
// author did not read src/cli/done.ts). The invariant under test is that
// `clad done` makes `status: done` EARN itself:
//   - it flips the feature's shard to `done` BEFORE running the gate
//     (so done-aware detectors evaluate the feature as done),
//   - it KEEPS done only if the injected gate is GREEN (worst === 0),
//   - on a RED gate (worst !== 0) it REVERTS the shard byte-for-byte.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {findShardFile, runDone, setStatus} from '../../src/cli/done.js';
import {readEvents} from '../../src/events/log.js';
import {renderFeatureIndexYaml} from '../../src/spec/inventory.js';
import {commitSchema01CompatibilityMutation, markFeatureDoneForGate} from '../../src/spec/edit.js';

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
  writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
  const path = join(featuresDir, SHARD_NAME);
  writeFileSync(path, body);
  return path;
}

/** Test-only index materialization; production status writes are journaled. */
function writeFeatureIndexProjection(dir: string): boolean {
  const body = renderFeatureIndexYaml(dir);
  if (body === null) return false;
  writeFileSync(join(dir, 'spec', 'index.yaml'), body);
  return true;
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
    writeFeatureIndexProjection(dir); // index starts mirroring the shard (in_progress)
    expect(readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8')).toContain('status: in_progress');
    runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 0}), onIndex: writeFeatureIndexProjection});
    const indexAfter = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    expect(indexAfter).toContain('status: done');
    expect(indexAfter).not.toContain('status: in_progress');
    expect(readFileSync(path, 'utf8')).toContain('status: done'); // shard kept done
  });

  test('a reverted (red gate) flip re-syncs the index back to the original status', () => {
    writeShard(dir);
    writeFeatureIndexProjection(dir);
    runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 1}), onIndex: writeFeatureIndexProjection});
    const indexAfter = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    // Shard reverted to in_progress → index re-synced symmetrically (no inverse staleness).
    expect(indexAfter).toContain('status: in_progress');
    expect(indexAfter).not.toContain('status: done');
  });

  test('the index is refreshed before the gate runs so the status-aware detector sees a consistent index', () => {
    writeShard(dir);
    writeFeatureIndexProjection(dir);
    let indexSaidDoneAtGateTime = false;
    runDone(dir, FEATURE_ID, {
      checkStages: () => {
        indexSaidDoneAtGateTime = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8').includes('status: done');
        return {worst: 0};
      },
      onIndex: writeFeatureIndexProjection,
    });
    // Backfill runs PRE-gate → INVENTORY_DRIFT sees index==shard==done, never REDs the flip's own write.
    expect(indexSaidDoneAtGateTime).toBe(true);
  });

  test('[covers:F-7afbd4/AC-001] GREEN gate keeps done and writes status: done to disk', () => {
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

  test('an unresolved structural design impact blocks done before the gate runs', () => {
    const body = SHARD_BODY +
      'design_impact:\n' +
      '  classification: structural\n' +
      '  rationale: "new service boundary"\n' +
      '  status: review_required\n' +
      '  artifacts: ["spec/architecture.yaml"]\n';
    const path = writeShard(dir, body);
    const checkStages = vi.fn(() => ({worst: 0}));

    const result = runDone(dir, FEATURE_ID, {checkStages});

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('design impact still needs review');
    expect(checkStages).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe(body);
  });

  test('the locked provisional mark refuses review_required design impact without changing the feature', () => {
    const body = SHARD_BODY +
      'design_impact:\n' +
      '  classification: structural\n' +
      '  rationale: "new service boundary"\n' +
      '  status: review_required\n' +
      '  artifacts: ["spec/architecture.yaml"]\n';
    const path = writeShard(dir, body);

    expect(() => markFeatureDoneForGate(dir, FEATURE_ID)).toThrow('design impact still needs review');
    expect(readFileSync(path, 'utf8')).toBe(body);
  });

  test('[covers:F-7afbd4/AC-002] RED gate reverts the shard byte-for-byte', () => {
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

  test('a RED gate compensates only the target and rebuilds projections around a concurrent journaled edit', () => {
    const target = writeShard(dir);
    const targetOriginal = readFileSync(target, 'utf8');
    const other = join(dir, 'spec', 'features', 'other-3f4e5d.yaml');
    const otherBefore = 'id: F-3f4e5d\nslug: other\ntitle: Other\nstatus: in_progress\n';
    const otherAfter = `${otherBefore}owner_note: concurrent\n`;
    writeFileSync(other, otherBefore);

    const result = runDone(dir, FEATURE_ID, {
      checkStages: () => {
        commitSchema01CompatibilityMutation(dir, [{path: 'spec/features/other-3f4e5d.yaml', before: otherBefore, after: otherAfter}], [], {refreshDerived: true});
        return {worst: 1};
      },
    });

    expect(result.ok).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe(targetOriginal);
    expect(readFileSync(other, 'utf8')).toBe(otherAfter);
    const index = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    expect(index).toContain('F-2de1f8: {slug: api-keys, status: in_progress');
    expect(index).toContain('F-3f4e5d: {slug: other, status: in_progress');
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.json'))).toBe(false);
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.lock'))).toBe(false);
  });

  test('a throwing gate compensates the provisional done status before reporting failure', () => {
    const target = writeShard(dir);
    const original = readFileSync(target, 'utf8');
    const result = runDone(dir, FEATURE_ID, {checkStages: () => { throw new Error('gate crash'); }});
    expect(result).toMatchObject({ok: false, code: 1});
    expect(result.reason).toContain('gate threw');
    expect(readFileSync(target, 'utf8')).toBe(original);
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.json'))).toBe(false);
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.lock'))).toBe(false);
  });

  test('a target edit while provisionally done keeps its new fields while compensation restores its prior status', () => {
    const target = writeShard(dir);
    const result = runDone(dir, FEATURE_ID, {
      checkStages: () => {
        const provisional = readFileSync(target, 'utf8');
        const edited = provisional.replace('title: Issue and revoke API keys\n', 'title: Issue and revoke API keys\nowner_note: preserve me\n');
        commitSchema01CompatibilityMutation(dir, [{path: 'spec/features/api-keys-2de1f8.yaml', before: provisional, after: edited}], [], {refreshDerived: true});
        return {worst: 1};
      },
    });
    expect(result.ok).toBe(false);
    const after = readFileSync(target, 'utf8');
    expect(after).toContain('status: in_progress');
    expect(after).toContain('owner_note: preserve me');
  });

  test('a GREEN gate is stale when the target modules change, preserving the latest modules', () => {
    const target = writeShard(dir, SHARD_BODY + 'modules:\n  - module-a\n');
    let focusModules: readonly string[] | undefined;

    const result = runDone(dir, FEATURE_ID, {
      checkStages: (opts) => {
        focusModules = opts.focusModules;
        const provisional = readFileSync(target, 'utf8');
        const edited = provisional.replace('  - module-a\n', '  - module-b\n');
        commitSchema01CompatibilityMutation(
          dir,
          [{path: 'spec/features/api-keys-2de1f8.yaml', before: provisional, after: edited}],
          [],
          {refreshDerived: true},
        );
        return {worst: 0};
      },
    });

    expect(focusModules).toEqual(['module-a']);
    expect(result).toMatchObject({ok: false, code: 1});
    expect(result.reason).toContain('result is stale');
    const after = readFileSync(target, 'utf8');
    expect(after).toContain('status: in_progress');
    expect(after).toContain('  - module-b\n');
    expect(after).not.toContain('  - module-a\n');
    expect(readEvents(dir).filter((event) => event.type === 'done_attempted')).toMatchObject([
      {payload: {feature: FEATURE_ID, kept: false}},
    ]);
  });

  test('a GREEN gate compensates a concurrent review_required target update', () => {
    const target = writeShard(dir);
    const result = runDone(dir, FEATURE_ID, {
      checkStages: () => {
        const provisional = readFileSync(target, 'utf8');
        const edited = provisional +
          'design_impact:\n' +
          '  classification: structural\n' +
          '  rationale: "new service boundary"\n' +
          '  status: review_required\n' +
          '  artifacts: ["spec/architecture.yaml"]\n';
        commitSchema01CompatibilityMutation(
          dir,
          [{path: 'spec/features/api-keys-2de1f8.yaml', before: provisional, after: edited}],
          [],
          {refreshDerived: true},
        );
        return {worst: 0};
      },
    });

    expect(result).toMatchObject({ok: false, code: 1});
    expect(result.reason).toContain('result is stale');
    const after = readFileSync(target, 'utf8');
    expect(after).toContain('status: in_progress');
    expect(after).toContain('status: review_required');
  });

  test('a GREEN gate remains valid when an unrelated feature changes', () => {
    const target = writeShard(dir);
    const other = join(dir, 'spec', 'features', 'other-3f4e5d.yaml');
    const otherBefore = 'id: F-3f4e5d\nslug: other\ntitle: Other\nstatus: in_progress\n';
    const otherAfter = `${otherBefore}owner_note: concurrent\n`;
    writeFileSync(other, otherBefore);

    const result = runDone(dir, FEATURE_ID, {
      checkStages: () => {
        commitSchema01CompatibilityMutation(
          dir,
          [{path: 'spec/features/other-3f4e5d.yaml', before: otherBefore, after: otherAfter}],
          [],
          {refreshDerived: true},
        );
        return {worst: 0};
      },
    });

    expect(result).toMatchObject({ok: true, code: 0});
    expect(readFileSync(target, 'utf8')).toContain('status: done');
    expect(readFileSync(other, 'utf8')).toBe(otherAfter);
  });

  test('empty feature id → code 2', () => {
    const res = runDone(dir, '', {
      checkStages: () => ({worst: 0}),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(2);
    expect(res.reason).toContain('feature id required');
  });

  test('no matching feature → code 1 with "no feature in the spec"', () => {
    // spec/features/ does not exist at all.
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(1);
    expect(res.reason).toContain('no feature in the spec');
  });

  test('[covers:F-7afbd4/AC-003] flip precedes the gate — the gate sees status: done already on disk', () => {
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

  test('[covers:F-7afbd4/AC-004] checkStages is invoked with {tier: "pre-push", strict: true} + the feature modules', () => {
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

// ─── F-10cc42d1 · AC-611089cf — clad done refuses on an in-progress git op ───
//
// A `done` verdict is only ever earned on a settled tree: a gate run mid-merge
// hashes a half-merged tree. So when the injected probe names an operation,
// runDone must refuse BEFORE any write — no shard flip, no index re-sync, and
// (because the gate never runs) no attestation. The probe is injected exactly
// as runDoneCommand wires the real gitOperationInProgressName.

describe('runDone git-operation guard (F-10cc42d1 · AC-611089cf)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-gitop-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  for (const op of ['merge', 'rebase', 'cherry-pick'] as const) {
    test(`refuses done during a ${op}: not ok, non-zero exit, error names the ${op}, and NO writes happen`, () => {
      const path = writeShard(dir);
      const original = readFileSync(path, 'utf8');
      const checkStages = vi.fn(() => ({worst: 0})); // GREEN if it ran — it must NOT
      const onIndex = vi.fn();
      const res = runDone(dir, FEATURE_ID, {checkStages, onIndex, gitOpInProgress: () => op});

      // Refused with an explanatory, exit-worthy error that names the operation.
      expect(res.ok).toBe(false);
      expect(res.code).not.toBe(0);
      expect(res.reason).toContain(op);

      // The gate never ran (so attestation was never even attempted) and the
      // committed index was never touched.
      expect(checkStages).not.toHaveBeenCalled();
      expect(onIndex).not.toHaveBeenCalled();

      // The shard is byte-for-byte unchanged — status was NOT flipped to done.
      const after = readFileSync(path, 'utf8');
      expect(after).toBe(original);
      expect(after).toContain('status: in_progress');
      expect(after).not.toContain('status: done');
    });
  }

  test('[covers:F-10cc42d1/AC-611089cf] refuses done during a detected git operation before any shard, index, or gate write', () => {
    const path = writeShard(dir);
    const original = readFileSync(path, 'utf8');
    const checkStages = vi.fn(() => ({worst: 0}));
    const onIndex = vi.fn();

    const result = runDone(dir, FEATURE_ID, {
      checkStages,
      onIndex,
      gitOpInProgress: () => 'merge',
    });

    expect(result).toMatchObject({ok: false});
    expect(result.code).not.toBe(0);
    expect(result.reason).toContain('merge');
    expect(checkStages).not.toHaveBeenCalled();
    expect(onIndex).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('the refusal precedes the missing-shard lookup — an unknown id under a git op still refuses for the git op', () => {
    // No shard on disk at all. The git-op refusal is the FIRST gate, so the
    // reason is the operation, not "no feature shard".
    const res = runDone(dir, 'F-nomatch', {checkStages: () => ({worst: 0}), gitOpInProgress: () => 'merge'});
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('merge');
    expect(res.reason).not.toContain('no feature in the spec');
  });

  test('a null probe leaves the transition unguarded — the GREEN path still flips to done', () => {
    const path = writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 0}), gitOpInProgress: () => null});
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(readFileSync(path, 'utf8')).toContain('status: done');
  });

  test('an omitted probe behaves exactly as before — GREEN gate flips to done', () => {
    const path = writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 0})});
    expect(res.ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('status: done');
  });
});

// ─── F-b84c38 — done_attempted lands in the ledger on BOTH paths ───

describe('runDone ledger emission (F-b84c38)', () => {
  let dir: string;
  const FEATURE_ID = 'F-aaaaaa';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-ev-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'x-aaaaaa.yaml'),
      `id: ${FEATURE_ID}\nslug: x\ntitle: t\nstatus: in_progress\n`,
    );
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('records done_attempted blockers on GREEN and RED gates', () => {
    runDone(dir, FEATURE_ID, {
      checkStages: () => ({
        worst: 0,
        anyFailed: false,
        stages: [{stage: 'stage_1.3', status: 'pass'}],
      }),
    });
    writeFileSync(
      join(dir, 'spec', 'features', 'x-aaaaaa.yaml'),
      `id: ${FEATURE_ID}\nslug: x\ntitle: t\nstatus: in_progress\n`,
    );
    runDone(dir, FEATURE_ID, {
      checkStages: () => ({
        worst: 1,
        anyFailed: true,
        stages: [
          {
            stage: 'stage_1.3',
            status: 'fail',
            findings: [
              {detector: 'MISSING_TESTS', severity: 'error'},
              {detector: 'FYI', severity: 'info'},
            ],
          },
          {stage: 'stage_2.1', status: 'fail'},
        ],
      }),
    });

    const events = readEvents(dir).filter((event) => event.type === 'done_attempted');
    expect(events).toHaveLength(2);
    expect(events[0].payload).toMatchObject({feature: FEATURE_ID, worst: 0, kept: true, blockers: []});
    expect(events[1].payload).toMatchObject({
      feature: FEATURE_ID,
      worst: 1,
      kept: false,
      blockers: ['MISSING_TESTS', 'stage_2.1'],
    });
    expect((events[0].payload as {identity?: {author?: string}}).identity?.author).toBe('human');
    // The red attempt still reverts the shard; telemetry cannot alter policy.
    expect(readFileSync(join(dir, 'spec', 'features', 'x-aaaaaa.yaml'), 'utf8')).toContain('status: in_progress');
  });
});
