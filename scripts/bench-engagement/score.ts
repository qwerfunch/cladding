// Cladding · engagement bench scorer (0.6, review findings V6/V7)
//
// Pure, artifact-deterministic scoring: a session "engaged the harness" iff
// the artifacts it left behind say so — lifecycle events in
// .cladding/events.log.jsonl plus the git diff name list. No transcript
// reading, no LLM judging, no judgment calls. The manual protocol that
// produces those artifacts lives in README.md next to this file.

import {readFileSync} from 'node:fs';
import process from 'node:process';

/** The slice of a .cladding/events.log.jsonl line the scorer consumes. */
export interface Event {
  readonly type: string;
  readonly payload?: Record<string, unknown>;
}

/** Per-utterance expectation, as declared in corpus.yaml. */
export interface Expect {
  readonly spec_authored?: boolean;
  readonly gate_run?: boolean;
  readonly done_correct?: boolean;
  readonly no_spec_mutation?: boolean;
}

/** Outcome of scoring one session against one corpus entry. */
export interface SessionScore {
  readonly pass: boolean;
  readonly reasons: string[];
}

/** A diff path that mutates the spec SSoT: the master file or any shard. */
function isSpecPath(path: string): boolean {
  return path === 'spec.yaml' || path.startsWith('spec/');
}

function isFeatureShard(path: string): boolean {
  return /^spec\/features\/[^/]+\.ya?ml$/.test(path);
}

/**
 * Scores one headless session from its artifacts.
 *
 * Rules (each only checked when the corpus entry declares the key):
 * - `spec_authored`   — a `feature_created` event exists AND a
 *                       `spec/features/*.yaml` shard appears in the diff.
 * - `gate_run`        — a `gate_run` event exists (every `clad check` tier
 *                       run lands one in the ledger).
 * - `done_correct`    — a `done_attempted` event with `kept: true` exists
 *                       (the flip→gate→keep-or-revert path ran and held).
 * - `no_spec_mutation` — no spec.yaml / spec/ path in the diff AND no
 *                       `feature_created` / `scenario_created` event.
 */
export function scoreSession(events: readonly Event[], gitDiffNames: readonly string[], expect: Expect): SessionScore {
  const reasons: string[] = [];
  const has = (type: string) => events.some((e) => e.type === type);

  if (expect.spec_authored !== undefined) {
    const eventSeen = has('feature_created');
    const shardInDiff = gitDiffNames.some(isFeatureShard);
    const actual = eventSeen && shardInDiff;
    if (actual !== expect.spec_authored) {
      reasons.push(
        `spec_authored: expected ${expect.spec_authored}, got ${actual} ` +
          `(feature_created event: ${eventSeen}, spec/features shard in diff: ${shardInDiff})`,
      );
    }
  }

  if (expect.gate_run !== undefined) {
    const actual = has('gate_run');
    if (actual !== expect.gate_run) {
      reasons.push(`gate_run: expected ${expect.gate_run}, got ${actual} (no gate_run event in the ledger)`);
    }
  }

  if (expect.done_correct !== undefined) {
    const actual = events.some((e) => e.type === 'done_attempted' && e.payload?.kept === true);
    if (actual !== expect.done_correct) {
      reasons.push(
        `done_correct: expected ${expect.done_correct}, got ${actual} ` +
          '(no done_attempted event with kept:true — done was hand-flipped or never attempted)',
      );
    }
  }

  if (expect.no_spec_mutation !== undefined) {
    const specDiff = gitDiffNames.filter(isSpecPath);
    const specEvents = events.filter((e) => e.type === 'feature_created' || e.type === 'scenario_created');
    const actual = specDiff.length === 0 && specEvents.length === 0;
    if (actual !== expect.no_spec_mutation) {
      reasons.push(
        `no_spec_mutation: expected ${expect.no_spec_mutation}, got ${actual} ` +
          `(spec paths in diff: [${specDiff.join(', ')}], spec-mutating events: ${specEvents.length})`,
      );
    }
  }

  return {pass: reasons.length === 0, reasons};
}

/** One already-scored corpus entry, as persisted by the bench runner. */
export interface UtteranceResult {
  readonly id?: string;
  readonly bucket: string;
  readonly pass: boolean;
}

/** Aggregate bench metrics. Rates are in [0, 1]; 0 when a denominator is empty. */
export interface Summary {
  /** Pass-rate over the engagement buckets a/b/c/d/f. */
  readonly engagement: number;
  /** Fail-rate on the negative-control bucket e (a fail = a false fire). */
  readonly falseFire: number;
}

const ENGAGEMENT_BUCKETS = new Set(['a', 'b', 'c', 'd', 'f']);

export function summarize(results: readonly UtteranceResult[]): Summary {
  const engaged = results.filter((r) => ENGAGEMENT_BUCKETS.has(r.bucket));
  const controls = results.filter((r) => r.bucket === 'e');
  const engagement = engaged.length === 0 ? 0 : engaged.filter((r) => r.pass).length / engaged.length;
  const falseFire = controls.length === 0 ? 0 : controls.filter((r) => !r.pass).length / controls.length;
  return {engagement, falseFire};
}

// CLI: `tsx scripts/bench-engagement/score.ts <results.json>` where the file
// is a JSON array of UtteranceResult. Prints the Summary as JSON.
const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: tsx scripts/bench-engagement/score.ts <results.json>');
    process.exit(2);
  }
  const results = JSON.parse(readFileSync(file, 'utf8')) as UtteranceResult[];
  console.log(JSON.stringify(summarize(results), null, 2));
}
