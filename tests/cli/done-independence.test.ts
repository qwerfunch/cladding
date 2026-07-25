// Cladding · unit tests for cli/done.ts — the independence label + policy (F-c566f590)
//
// Authored from the AC contract (AC-d5210389, AC-ad5ea48b) + the DoneDeps /
// DoneResult interfaces + the implementer's handoff report ONLY — the test
// author did not read runDone's body. Covers:
//   - the computed label lands on DoneResult AND the done_attempted event,
//     on BOTH the kept and the reverted path;
//   - policy 'require' + self-certified + GREEN gate => refused, shard
//     reverted byte-for-byte;
//   - policy 'label' (default) + self-certified + GREEN gate => completes
//     exactly as before the feature (label just annotated);
//   - a RED gate refusal takes precedence over the independence-policy
//     refusal even under 'require'.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runDone} from '../../src/cli/done.js';
import {doneSelfCertRefusalLead} from '../../src/ui/softShell.js';
import {readEvents} from '../../src/events/log.js';
import {newEvidence} from '../../src/hitl/identity.js';
import type {Evidence} from '../../src/hitl/identity.js';

const SHARD_NAME = 'independence-thing-c566aa.yaml';
const FEATURE_ID = 'F-c566aa';
const SHARD_BODY =
  '# independence-thing feature shard (test fixture)\n' +
  'id: F-c566aa\n' +
  'slug: independence-thing\n' +
  'status: in_progress\n' +
  'title: A thing that needs independence labeling\n' +
  'acceptance_criteria:\n' +
  '  - id: AC-001\n' +
  '    text: The system shall do a thing.\n';

function writeShard(dir: string, body = SHARD_BODY): string {
  const featuresDir = join(dir, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});
  const path = join(featuresDir, SHARD_NAME);
  writeFileSync(path, body);
  return path;
}

function humanEvidence(featureId: string): Evidence {
  return newEvidence({
    featureId,
    stage: 'stage_4.1',
    kind: 'pass',
    identity: {author: 'human'},
    content: 'human reviewed',
  });
}

describe('runDone × independence label (F-c566f590 · AC-d5210389)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-indep-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('omitted independence dep => DoneResult.independence is undefined (no behavior change)', () => {
    writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {checkStages: () => ({worst: 0})});
    expect(res.ok).toBe(true);
    expect(res.independence).toBeUndefined();
    const kept = readEvents(dir).filter((e) => e.type === 'done_attempted');
    expect((kept[0].payload as {independence?: unknown}).independence).toBeUndefined();
  });

  test('policy "label" + self-certified (zero evidence) + GREEN gate => kept done, labeled self-certified', () => {
    const path = writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'label', evidence: []},
    });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.independence).toBe('self-certified');
    expect(readFileSync(path, 'utf8')).toContain('status: done');

    const kept = readEvents(dir).filter((e) => e.type === 'done_attempted');
    expect(kept.length).toBe(1);
    expect(kept[0].payload).toMatchObject({feature: FEATURE_ID, kept: true, independence: 'self-certified'});
  });

  test('policy "label" + independent (human evidence) + GREEN gate => kept done, labeled independent', () => {
    const path = writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'label', evidence: [humanEvidence(FEATURE_ID)]},
    });
    expect(res.ok).toBe(true);
    expect(res.independence).toBe('independent');
    expect(readFileSync(path, 'utf8')).toContain('status: done');

    const kept = readEvents(dir).filter((e) => e.type === 'done_attempted');
    expect(kept[0].payload).toMatchObject({kept: true, independence: 'independent'});
  });

  test('evidence recorded for a DIFFERENT feature does not make this feature independent', () => {
    writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'label', evidence: [humanEvidence('F-other')]},
    });
    expect(res.independence).toBe('self-certified');
  });
});

describe('runDone × independence_policy: require (F-c566f590 · AC-ad5ea48b)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-done-indep-req-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('require + self-certified (zero evidence) + GREEN gate => refused, shard reverted BYTE-FOR-BYTE', () => {
    const path = writeShard(dir);
    const original = readFileSync(path, 'utf8');
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'require', evidence: []},
    });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(1);
    expect(res.reason).toContain(doneSelfCertRefusalLead());
    expect(res.reason).toContain('status left at');
    expect(res.independence).toBe('self-certified');

    const after = readFileSync(path, 'utf8');
    expect(after).toBe(original);
    expect(after).toContain('status: in_progress');
    expect(after).not.toContain('status: done');
  });

  test('require + self-certified (tool/llm-only evidence) + GREEN gate => still refused', () => {
    const path = writeShard(dir);
    const original = readFileSync(path, 'utf8');
    const evidence: Evidence[] = [
      newEvidence({featureId: FEATURE_ID, stage: 'stage_4.1', kind: 'pass', identity: {author: 'tool'}, content: 'ci'}),
      newEvidence({featureId: FEATURE_ID, stage: 'stage_4.1', kind: 'pass', identity: {author: 'llm'}, content: 'agent'}),
    ];
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'require', evidence},
    });
    expect(res.ok).toBe(false);
    expect(res.independence).toBe('self-certified');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('require + independent (human evidence) + GREEN gate => completes normally, NOT blocked', () => {
    const path = writeShard(dir);
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'require', evidence: [humanEvidence(FEATURE_ID)]},
    });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.independence).toBe('independent');
    expect(readFileSync(path, 'utf8')).toContain('status: done');
  });

  test('require + independent (blind:true evidence) + GREEN gate => completes normally, NOT blocked', () => {
    const path = writeShard(dir);
    const evidence: Evidence[] = [
      newEvidence({featureId: FEATURE_ID, stage: 'stage_2.3', kind: 'oracle', identity: {author: 'llm'}, content: 'blind oracle', blind: true}),
    ];
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'require', evidence},
    });
    expect(res.ok).toBe(true);
    expect(res.independence).toBe('independent');
    expect(readFileSync(path, 'utf8')).toContain('status: done');
  });

  test('a RED gate refusal takes precedence over the require-policy refusal (existing message wins)', () => {
    const path = writeShard(dir);
    const original = readFileSync(path, 'utf8');
    const res = runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 1}),
      independence: {policy: 'require', evidence: []}, // self-certified too, but gate-red must win
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(1);
    expect(res.reason).toContain('not GREEN');
    expect(res.reason).toContain('status left at');
    expect(res.reason).not.toContain(doneSelfCertRefusalLead());
    // Shard still reverted byte-for-byte (same outcome shape as any red-gate revert).
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('the done_attempted ledger payload.kept is the ACTUAL outcome: false on a require-revert even though worst===0', () => {
    writeShard(dir);
    runDone(dir, FEATURE_ID, {
      checkStages: () => ({worst: 0}),
      independence: {policy: 'require', evidence: []},
    });
    const events = readEvents(dir).filter((e) => e.type === 'done_attempted');
    expect(events.length).toBe(1);
    expect(events[0].payload).toMatchObject({feature: FEATURE_ID, worst: 0, kept: false, independence: 'self-certified'});
  });
});
