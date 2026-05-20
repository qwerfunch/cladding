// Cladding · events.log — append-only lifecycle event stream
//
// Distinct from .cladding/audit.log.jsonl (HITL evidence): events.log
// captures *state transitions* — when a stage starts/stops, when a
// feature activates, when a drift fires. Audit is "proof of work";
// events is "what happened, when". They live in the same directory
// but each has its own append-only file.

import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const EVENTS_DIR = '.cladding';
const EVENTS_FILE = 'events.log.jsonl';

/** Types of lifecycle events the harness records. */
export type EventType =
  | 'stage_started'
  | 'stage_completed'
  | 'feature_activated'
  | 'feature_completed'
  | 'evidence_recorded'
  | 'drift_detected'
  | 'feature_checkpoint'
  | 'feature_rolled_back';

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

/** Append a single event. Creates the directory if needed. */
export function appendEvent(cwd: string, event: Event): void {
  const path = eventsPath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
}

/** Read every event in append order. */
export function readEvents(cwd: string): readonly Event[] {
  const path = eventsPath(cwd);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  if (raw.length === 0) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Event);
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
