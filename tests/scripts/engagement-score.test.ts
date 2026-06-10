// Cladding · engagement bench — corpus shape + scorer determinism (V6/V7)
//
// The corpus is a release artifact: 40 utterances whose bucket mix IS the
// methodology (≥8 negative controls keep the false-fire metric meaningful).
// The scorer is pure — these tests pin its artifact-deterministic rules so
// the bench cannot drift into judgment-call scoring.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {parse as parseYaml} from 'yaml';
import {describe, expect, test} from 'vitest';

import {scoreSession, summarize, type Expect} from '../../scripts/bench-engagement/score.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(HERE, '..', '..', 'scripts', 'bench-engagement', 'corpus.yaml');

interface CorpusEntry {
  readonly id: string;
  readonly bucket: 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
  readonly lang: 'en' | 'ko';
  readonly text: string;
  readonly expect: Expect;
}

function loadCorpus(): CorpusEntry[] {
  const doc = parseYaml(readFileSync(CORPUS_PATH, 'utf8')) as {utterances: CorpusEntry[]};
  return doc.utterances;
}

describe('engagement corpus (scripts/bench-engagement/corpus.yaml)', () => {
  test('parses, has exactly 40 entries, every bucket populated, ≥8 negative controls', () => {
    const corpus = loadCorpus();
    expect(corpus).toHaveLength(40);

    const byBucket = new Map<string, CorpusEntry[]>();
    for (const entry of corpus) {
      byBucket.set(entry.bucket, [...(byBucket.get(entry.bucket) ?? []), entry]);
    }
    expect([...byBucket.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // The planned bucket mix (a8 b6 c6 d6 e8 f6 = 40).
    expect(byBucket.get('a')).toHaveLength(8);
    expect(byBucket.get('b')).toHaveLength(6);
    expect(byBucket.get('c')).toHaveLength(6);
    expect(byBucket.get('d')).toHaveLength(6);
    expect(byBucket.get('f')).toHaveLength(6);
    expect(byBucket.get('e')!.length).toBeGreaterThanOrEqual(8);

    // Every entry is fully formed and ids are unique.
    const ids = new Set<string>();
    for (const entry of corpus) {
      expect(entry.id).toBeTruthy();
      expect(['en', 'ko']).toContain(entry.lang);
      expect(entry.text.length).toBeGreaterThan(0);
      expect(Object.keys(entry.expect).length).toBeGreaterThan(0);
      ids.add(entry.id);
    }
    expect(ids.size).toBe(40);

    // Bucket a is the bilingual probe: 4 EN / 4 KO.
    const a = byBucket.get('a')!;
    expect(a.filter((e) => e.lang === 'en')).toHaveLength(4);
    expect(a.filter((e) => e.lang === 'ko')).toHaveLength(4);

    // Negative controls must only declare the non-mutation expectation.
    for (const e of byBucket.get('e')!) {
      expect(e.expect).toEqual({no_spec_mutation: true});
    }
  });
});

describe('scoreSession — artifact-deterministic rules', () => {
  const featureCreated = {type: 'feature_created', payload: {feature: 'F-abc123'}};
  const gateRun = {type: 'gate_run', payload: {tier: 'pre-push', strict: true, worst: 0}};

  test('spec_authored passes only when BOTH the event and the shard diff exist', () => {
    const expectAuthored: Expect = {spec_authored: true};
    const shardDiff = ['spec/features/login-abc123.yaml', 'spec.yaml'];

    expect(scoreSession([featureCreated], shardDiff, expectAuthored).pass).toBe(true);
    // Event without the shard on disk → not authored (artifact missing).
    const noShard = scoreSession([featureCreated], ['src/login.ts'], expectAuthored);
    expect(noShard.pass).toBe(false);
    expect(noShard.reasons[0]).toContain('spec_authored');
    // Shard in diff without the lifecycle event → bypassed the harness.
    expect(scoreSession([], shardDiff, expectAuthored).pass).toBe(false);
  });

  test('gate_run passes iff a gate_run event landed in the ledger', () => {
    expect(scoreSession([gateRun], [], {gate_run: true}).pass).toBe(true);
    const missed = scoreSession([featureCreated], [], {gate_run: true});
    expect(missed.pass).toBe(false);
    expect(missed.reasons[0]).toContain('gate_run');
  });

  test('done_correct requires done_attempted with kept:true — a reverted or absent attempt fails', () => {
    const kept = {type: 'done_attempted', payload: {feature: 'F-abc123', kept: true}};
    const reverted = {type: 'done_attempted', payload: {feature: 'F-abc123', kept: false}};
    expect(scoreSession([kept], [], {done_correct: true}).pass).toBe(true);
    expect(scoreSession([reverted], [], {done_correct: true}).pass).toBe(false);
    expect(scoreSession([], [], {done_correct: true}).pass).toBe(false);
  });

  test('no_spec_mutation: false-fire detection on spec diffs AND on spec-mutating events', () => {
    const control: Expect = {no_spec_mutation: true};
    // Clean negative control: code-only diff, no spec events.
    expect(scoreSession([gateRun], ['src/util.ts'], control).pass).toBe(true);
    // A shard appeared → false fire.
    const fired = scoreSession([], ['spec/features/rogue-d00d00.yaml'], control);
    expect(fired.pass).toBe(false);
    expect(fired.reasons[0]).toContain('no_spec_mutation');
    // Master spec.yaml mutated → false fire.
    expect(scoreSession([], ['spec.yaml'], control).pass).toBe(false);
    // No diff but a scenario_created event → still a false fire.
    expect(scoreSession([{type: 'scenario_created'}], [], control).pass).toBe(false);
  });

  test('only declared expectations are checked', () => {
    // Nothing declared → vacuously passing score with no reasons.
    const r = scoreSession([], ['spec.yaml'], {});
    expect(r).toEqual({pass: true, reasons: []});
  });
});

describe('summarize — engagement / false-fire math', () => {
  test('engagement = pass-rate over a/b/c/d/f; falseFire = fail-rate on e', () => {
    const results = [
      {id: 'a1', bucket: 'a', pass: true},
      {id: 'a2', bucket: 'a', pass: false},
      {id: 'b1', bucket: 'b', pass: true},
      {id: 'c1', bucket: 'c', pass: true},
      {id: 'd1', bucket: 'd', pass: false},
      {id: 'f1', bucket: 'f', pass: true},
      {id: 'e1', bucket: 'e', pass: true},
      {id: 'e2', bucket: 'e', pass: false},
      {id: 'e3', bucket: 'e', pass: true},
      {id: 'e4', bucket: 'e', pass: true},
    ];
    const summary = summarize(results);
    expect(summary.engagement).toBeCloseTo(4 / 6, 10);
    expect(summary.falseFire).toBeCloseTo(1 / 4, 10);
  });

  test('empty denominators yield 0, not NaN', () => {
    expect(summarize([])).toEqual({engagement: 0, falseFire: 0});
    expect(summarize([{bucket: 'e', pass: true}])).toEqual({engagement: 0, falseFire: 0});
  });
});
