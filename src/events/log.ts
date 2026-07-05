// Cladding · events.log — append-only lifecycle event stream
//
// Distinct from .cladding/audit.log.jsonl (HITL evidence): events.log
// captures *state transitions* — when a stage starts/stops, when a
// feature activates, when a drift fires. Audit is "proof of work";
// events is "what happened, when". They live in the same directory
// but each has its own append-only file.

import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync} from 'node:fs';
import {userInfo} from 'node:os';
import {dirname, join} from 'node:path';

import type {Identity} from '../hitl/identity.js';

const EVENTS_DIR = '.cladding';
const EVENTS_FILE = 'events.log.jsonl';
const EVENTS_ROLL = 'events.log.1.jsonl';
/** Roll the live log past this size (F-b84c38 AC — bounded reads). */
const ROTATE_BYTES = 5 * 1024 * 1024;

/** Types of lifecycle events the harness records. */
export type EventType =
  | 'stage_started'
  | 'stage_completed'
  | 'feature_activated'
  | 'feature_completed'
  | 'evidence_recorded'
  | 'drift_detected'
  | 'feature_checkpoint'
  | 'feature_rolled_back'
  // v0.3.39 — sentinel-miss telemetry. Emitted when the LLM dispatcher
  // returns a reply that misses one of the labelled sentinels
  // (=== CONVENTIONS_MD === / === ARCHITECTURE_YAML === / === SCENARIO_FLOWS ===
  // / === CAPABILITIES_YAML === / === WHY === / === WHAT === / === PURPOSE ===)
  // and the scan or project-context refinement falls back to the deterministic
  // body. Standard payload:
  //   phase:           'scan_artifacts' | 'project_context'
  //   cause:           'blank_section'  | 'dispatcher_error'
  //   fallback:        'total'          | 'per_artifact'
  //   missed_sections: readonly string[]  // present iff cause === 'blank_section'
  //   error:           string              // present iff cause === 'dispatcher_error' (truncated)
  // Configured-no-LLM paths (dispatcher === null or ctx === null) do NOT emit;
  // they are deliberate offline/greenfield runs, not a miss.
  | 'sentinel_miss'
  // v0.6.0 (F-b84c38) — the supported per-feature cadence finally leaves a
  // trace. Each payload carries `identity` (git author or OS user) and `head`
  // (git HEAD sha) added by recordEvent; 23 hand-flipped dones proved the
  // ledger must say WHO, and the attestation/engagement work needs WHEN.
  | 'feature_created' // payload: feature, slug
  | 'scenario_created' // payload: scenario, slug
  | 'done_attempted' // payload: feature, worst, anyFailed, kept
  | 'gate_run' // payload: tier, strict, worst, anyFailed (deduped per HEAD)
  // v0.6.0 (F-1d23a6) — the Stop host hook blocked a session end on a FRESH
  // deterministic-trio failure (drift strict / arch / secret). Fingerprint-
  // keyed: an identical failure set demotes to allow without an event, so
  // this fires only on new breakage — the demotion itself persists as
  // .cladding/stop-block.json and resurfaces on the SessionStart card.
  | 'stop_blocked' // payload: count, fingerprint
  // v0.8.0 (F-6ba22c5c) — value-delivery telemetry. cladding's value surfaces
  // (PostToolUse impact card, SessionStart card, UserPromptSubmit suggestion, MCP
  // read serves) left ZERO trace, so the 0.7.1 "impact card fired 0%" bug was
  // invisible to the harness's own ledger. Each surface now records whether it
  // produced output. Payloads:
  //   impact_card_fired:        file, feature, impacted (n), tests (n), unledgered (bool),
  //                             tier (1|2 — Tier-2 is the rich impact card, F-35954d19),
  //                             lane ('bash' when the mutation was attributed via the Bash
  //                             git-delta lane, F-e7d59c88; ABSENT on native write-tool
  //                             edits — additive field per the F-6ba22c5c precedent)
  //   impact_card_skipped:      reason ∈ ImpactSkipReason (closed enum, one per degrade
  //                             branch of runPostToolUseDrift). The two high-frequency
  //                             reasons (not_write_tool, unwatched_path) are AGGREGATED
  //                             across a DRIFT_DEBOUNCE_MS window into ONE flushed event
  //                             carrying {aggregate:true, counts:{not_write_tool, unwatched_path}}
  //                             so per-call skips cannot rotate gate_run history out of the
  //                             5MB log; the rest emit per occurrence.
  //   session_card_rendered:    bytes
  //   prompt_suggestion_served: kind ('completion' | intent verb)
  //   working_set_served:       tool, query, resolved (bool), truncated?, sliceTokens?
  | 'impact_card_fired'
  | 'impact_card_skipped'
  | 'session_card_rendered'
  | 'prompt_suggestion_served'
  | 'working_set_served';

/**
 * The closed set of reasons the PostToolUse impact card can be skipped —
 * ONE per degrade branch of `runPostToolUseDrift` (F-6ba22c5c AC-238a3658).
 * The enum makes silent (surface fired nothing) distinguishable from broken
 * (emission unwired) directly from the ledger. `no_spec` is a valid disposition
 * but is never emitted: a spec-less cwd gets no `.cladding/` writes (parity).
 * `dedup`/`ledger_exhausted` were added by the Tier-2 impact card
 * (F-35954d19): a repeated (focus,file) fingerprint and an exhausted per-session
 * push-token budget are suppressions of a card that WOULD have fired, not misses.
 */
export type ImpactSkipReason =
  | 'not_write_tool'
  | 'unwatched_path'
  | 'no_spec'
  | 'debounced'
  | 'trivial_edit'
  | 'owner_miss'
  | 'spec_unreadable'
  | 'dedup'
  | 'ledger_exhausted';

/** One JSONL line in events.log.jsonl. */
export interface Event {
  /** Stable id, e.g. `ev-yyyyMMddHHmmss-rand`. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  readonly type: EventType;
  /** Free-form context payload. Always JSON-serialisable. */
  readonly payload: Record<string, unknown>;
}

function eventsPath(cwd: string): string {
  return join(cwd, EVENTS_DIR, EVENTS_FILE);
}

/** Append a single event. Creates the directory if needed. Rolls the live log
 * to `events.log.1.jsonl` (single generation, newest kept live) past
 * ROTATE_BYTES so reads stay bounded. */
export function appendEvent(cwd: string, event: Event): void {
  const path = eventsPath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  try {
    if (existsSync(path) && statSync(path).size > ROTATE_BYTES) {
      renameSync(path, join(dir, EVENTS_ROLL)); // replaces any previous roll
    }
  } catch {
    // Rotation is best-effort; a failed roll must not lose the append.
  }
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
}

/** Parse one events-log file in append order; a missing or empty file → []. */
function readEventsFile(path: string): Event[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  if (raw.length === 0) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Event);
}

/** Read every event in the live log in append order. */
export function readEvents(cwd: string): readonly Event[] {
  return readEventsFile(eventsPath(cwd));
}

/**
 * Read the rolled generation (`events.log.1.jsonl` — the older half a size
 * rotation left behind) followed by the live log, in append order. Missing
 * files contribute nothing. `appendEvent` keeps a SINGLE rolled generation, so
 * at most two files are concatenated. The adoption reducer (F-0023ba22) reads
 * through this so a recent rotation can't drop completed cycles out of view
 * (AC-345af0b5).
 */
export function readEventsIncludingRolled(cwd: string): readonly Event[] {
  return [...readEventsFile(join(cwd, EVENTS_DIR, EVENTS_ROLL)), ...readEventsFile(eventsPath(cwd))];
}

/** Convenience constructor — fills id + timestamp. */
export function newEvent(type: EventType, payload: Record<string, unknown>): Event {
  return {
    id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type,
    payload,
  };
}

/** Actor identity for lifecycle events: git author when resolvable (the
 * stable handle a team recognizes), else the OS user. Never throws. */
function resolveActorIdentity(cwd: string): Identity {
  let name: string | undefined;
  try {
    name = execFileSync('git', ['config', 'user.name'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() || undefined;
  } catch {
    /* git absent or unconfigured */
  }
  if (!name) {
    try {
      name = userInfo().username;
    } catch {
      name = undefined;
    }
  }
  return {author: 'human', name, timestamp: new Date().toISOString()};
}

function gitHead(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return undefined;
  }
}

/** Latest event of a type, or null. Scans the (rotation-bounded) live log. */
export function latestEventOfType(cwd: string, type: EventType): Event | null {
  try {
    const events = readEvents(cwd);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === type) return events[i];
    }
  } catch {
    /* unreadable ledger = no precedent */
  }
  return null;
}

/**
 * Record a lifecycle event with actor identity + git HEAD stamped into the
 * payload (F-b84c38). BEST-EFFORT BY CONTRACT: the ledger observes the
 * harness; a telemetry failure must never break the calling command, so every
 * failure path degrades to a silent no-op.
 *
 * `gate_run` dedupe: when the latest gate_run already carries the identical
 * (head, tier, strict, worst) tuple, the append is skipped — repeated
 * identical runs on the same tree add no information, only log growth.
 */
export function recordEvent(cwd: string, type: EventType, payload: Record<string, unknown>): void {
  try {
    const head = gitHead(cwd);
    const identity = resolveActorIdentity(cwd);
    const full = {...payload, head, identity};
    if (type === 'gate_run') {
      const prev = latestEventOfType(cwd, 'gate_run');
      if (
        prev &&
        prev.payload.head === head &&
        prev.payload.tier === payload.tier &&
        prev.payload.strict === payload.strict &&
        prev.payload.worst === payload.worst
      ) {
        return;
      }
    }
    appendEvent(cwd, newEvent(type, full));
  } catch {
    // error-as-data at the boundary: the command outcome is unchanged.
  }
}
