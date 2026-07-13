// Cladding · verdict gate-progress fingerprint (F-b0c8ba2c, PURE)
//
// `clad verdict` is a stateless poll: each turn it reduces the CURRENT gate
// outcome to one decision. But a loop that keeps iterating on an UNFIXABLE
// failure never stops (loop-engineering mistake #3, "no stop condition") — the
// verdict is ITERATE forever and the loop bills forever. To detect "stuck", the
// poll must compare THIS run's blocking findings to the PREVIOUS run's. That is
// the only new state.
//
// This module is the PURE half of that mechanism — no IO, no clock, no disk. It
// exposes two functions: `fingerprintFindings` (gate outcome → a message-free
// hash of its blocking findings) and `nextProgress` (a pure state transition
// over {fingerprint, repeat} that decides whether the loop is stuck). The
// handler (src/cli/verdict.ts) owns the disk read/write and hands the prior
// state in; the reducer (src/verdict/verdict.ts) takes `stuck` as an input. So
// the whole thing stays unit-testable in isolation and, critically, the GATE is
// never touched — verdict computes the fingerprint from the result it already
// receives (the `gate_run` event is deduped by (head,tier,strict,worst), so two
// identical stuck runs collapse to ONE event; "stuck" cannot be read from there).
//
// SOUNDNESS (AC-a2320103): the fingerprint hashes ONLY `detector|path`, sorted +
// deduped — message-free, line-free, temp-path-free. A fingerprint too NARROW
// (including volatile line/message) would make "identical" never match, so the
// class would never fire (the anti-self-cert dead-guard trap). Mirrors the
// Stop-hook's detector|path primitive (src/cli/hook.ts).

import {createHash} from 'node:crypto';

import {isBlocking} from '../stages/disposition.js';
import type {VerdictStage} from './verdict.js';

/**
 * A message-free, line-free fingerprint of a gate outcome's BLOCKING findings.
 *
 * Collects `detector|path` (path omitted → `detector|`) from every BLOCKING
 * stage's findings, sorts + dedups the set, joins, and sha256s it. Excludes the
 * finding's message, line, and any temporary path — cosmetic churn cannot mask a
 * genuine repeat, and a genuine repeat is never missed (AC-a2320103).
 *
 * Returns `''` (empty) when there are NO blocking findings — a green gate has no
 * fingerprint, so a passing run naturally clears any stuck streak (AC-5437c244).
 *
 * PURE — no IO. The handler persists the result; this only computes it.
 */
export function fingerprintFindings(stages: readonly VerdictStage[]): string {
  const keys = new Set<string>();
  for (const s of stages) {
    if (!isBlocking(s.status)) continue;
    for (const f of s.findings ?? []) {
      keys.add(`${f.detector}|${f.path ?? ''}`);
    }
  }
  if (keys.size === 0) return '';
  return createHash('sha256').update([...keys].sort().join('\n')).digest('hex');
}

/** Persisted per-poll progress state. Written by the handler to its own
 *  gitignored state file (`.cladding/verdict-progress.json`), never a tracked
 *  file — the poll-not-mutate lock holds. */
export interface ProgressState {
  readonly fingerprint: string;
  readonly repeat: number;
}

/**
 * PURE state transition over the poll's progress streak.
 *
 * - `currentFp` non-empty AND equal to `prior.fingerprint` → the loop tried and
 *   produced the SAME blocking findings: `repeat = (prior.repeat ?? 1) + 1`.
 * - otherwise (green, or the findings changed = progress, or no prior) →
 *   `repeat = 1`.
 * - `stuck = currentFp !== '' && repeat >= 2` — two identical consecutive runs.
 *
 * AC-d79df01a: no prior → repeat 1, not stuck (a first failure is never stuck).
 * AC-5437c244: an empty or a differing fingerprint → not stuck.
 *
 * @returns the NEW state to persist plus the `stuck` flag the reducer reads.
 */
export function nextProgress(
  currentFp: string,
  prior: {fingerprint?: string; repeat?: number} | undefined,
): {fingerprint: string; repeat: number; stuck: boolean} {
  const repeat = currentFp !== '' && currentFp === prior?.fingerprint ? (prior?.repeat ?? 1) + 1 : 1;
  const stuck = currentFp !== '' && repeat >= 2;
  return {fingerprint: currentFp, repeat, stuck};
}
