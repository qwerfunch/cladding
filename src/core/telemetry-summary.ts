// Cladding · core · telemetry-summary — aggregation library for events.log.jsonl
//
// Pure functions over the {@link Event} stream produced by
// `src/events/log.ts`. No IO — callers (currently `src/cli/doctor.ts`)
// read the log via {@link readEvents} and pass the slice down. Keeping
// the aggregation side-effect free means the same helpers can power a
// future MCP resource (e.g. `cladding://doctor/sentinel-miss`) without
// changes.
//
// The shapes returned here are the wire format for `clad doctor --json`,
// so changing a field is a breaking change. New fields are additive;
// optional fields stay optional.
//
// @see src/events/log.ts — Event schema + readEvents
// @see src/cli/doctor.ts — first consumer

import type {Event, EventType} from '../events/log.js';

/** One entry of the top-N missed-sentinel histogram. */
export interface MissedSentinelCount {
  /** Sentinel name as emitted by the dispatcher fallback site (e.g. `CAPABILITIES_YAML`). */
  readonly name: string;
  /** How many `sentinel_miss` events listed this name in `missed_sections`. */
  readonly count: number;
}

/** Aggregated view of every `sentinel_miss` event in the slice. */
export interface SentinelMissSummary {
  /** Total `sentinel_miss` events in the slice. */
  readonly total: number;
  /** Count keyed by `payload.phase`. Unknown phases land under `other`. */
  readonly byPhase: Readonly<Record<string, number>>;
  /** Count keyed by `payload.cause`. */
  readonly byCause: Readonly<Record<string, number>>;
  /** Count keyed by `payload.fallback`. */
  readonly byFallback: Readonly<Record<string, number>>;
  /**
   * Histogram of `payload.missed_sections` entries, sorted by count
   * desc then name asc. Capped at 5 to keep the human-readable
   * surface scannable; the raw events stay in `events.log.jsonl` for
   * deeper analysis.
   */
  readonly topMissedSections: readonly MissedSentinelCount[];
  /**
   * Up to 3 unique `payload.error` strings from `dispatcher_error`
   * events, most-recent first. Empty when no dispatcher errors were
   * observed. Truncation of individual error strings already happened
   * in the emitter; this helper only de-duplicates.
   */
  readonly recentErrors: readonly string[];
}

/** Overall event-stream stats, independent of `sentinel_miss`. */
export interface EventCounts {
  readonly total: number;
  /** Count keyed by `EventType`. Types absent from the slice are absent here. */
  readonly byType: Readonly<Partial<Record<EventType, number>>>;
}

const TOP_MISSED_LIMIT = 5;
const RECENT_ERRORS_LIMIT = 3;

/**
 * Reduces every `sentinel_miss` event in the slice into a
 * {@link SentinelMissSummary}. Non-`sentinel_miss` events are
 * ignored. Returns the zero-state when the slice has no
 * `sentinel_miss` entries so callers can pattern-match on
 * `summary.total === 0` rather than null-checking.
 */
export function summarizeSentinelMisses(events: readonly Event[]): SentinelMissSummary {
  const byPhase: Record<string, number> = {};
  const byCause: Record<string, number> = {};
  const byFallback: Record<string, number> = {};
  const sectionCounts: Map<string, number> = new Map();
  // Walk newest-first so the recent-errors slice has the freshest
  // values without a second sort pass.
  const recentErrors: string[] = [];
  const seenErrors = new Set<string>();
  let total = 0;

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'sentinel_miss') continue;
    total += 1;
    bumpKey(byPhase, asString(e.payload.phase));
    bumpKey(byCause, asString(e.payload.cause));
    bumpKey(byFallback, asString(e.payload.fallback));
    const missed = e.payload.missed_sections;
    if (Array.isArray(missed)) {
      for (const section of missed) {
        const name = asString(section);
        sectionCounts.set(name, (sectionCounts.get(name) ?? 0) + 1);
      }
    }
    const error = e.payload.error;
    if (typeof error === 'string' && error.length > 0 && !seenErrors.has(error) && recentErrors.length < RECENT_ERRORS_LIMIT) {
      seenErrors.add(error);
      recentErrors.push(error);
    }
  }

  const topMissedSections: MissedSentinelCount[] = [...sectionCounts.entries()]
    .map(([name, count]) => ({name, count}))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
    .slice(0, TOP_MISSED_LIMIT);

  return {total, byPhase, byCause, byFallback, topMissedSections, recentErrors};
}

/**
 * Reduces the whole event slice into per-type counts. Used by the
 * doctor verb's preamble line so adopters see total activity
 * (checkpoints, drift, sentinel-miss, …) before drilling into the
 * sentinel-miss breakdown.
 */
export function summarizeEvents(events: readonly Event[]): EventCounts {
  const byType: Partial<Record<EventType, number>> = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  return {total: events.length, byType};
}

function bumpKey(target: Record<string, number>, key: string): void {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
