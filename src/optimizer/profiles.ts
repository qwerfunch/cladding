// Cladding · Token Optimizer · Headroom compression profiles
//
// F-6aebb9 / AC-0bbaf3 — maps each cladding "context kind" to a Headroom
// CompressConfig posture. Cladding's harness payload mixes three pressure
// sources (execution logs · large JSON tool outputs · source-code context),
// each of which wants a different compression aggression. Rather than tune
// Headroom at every call site, callers name the kind and this table picks
// the posture.
//
// The field names mirror Headroom's CompressConfig (see
// headroom/compress.py::CompressConfig) so the bridge can forward them
// verbatim — keep them snake_case for that reason.
//
// @see docs/headroom-integration.md §3 — per-data-type strategy.

/** The shape of context cladding hands to an LLM, used to pick a profile. */
export type ContextKind = 'logs' | 'json' | 'code' | 'spec' | 'history';

/**
 * A Headroom compression posture. Field names are snake_case to match
 * Headroom's `CompressConfig` dataclass — the bridge forwards this object
 * straight into `headroom.compress(config=...)`.
 */
export interface HeadroomProfileConfig {
  /** Compress user messages too (default off — they hold the active ask). */
  readonly compress_user_messages: boolean;
  /** Compress system messages (off to keep the persona prompt byte-stable). */
  readonly compress_system_messages: boolean;
  /** Leave the last N messages untouched (the live conversation). */
  readonly protect_recent: number;
  /** Detect analyze/review intent and protect code from compression. */
  readonly protect_analysis_context: boolean;
  /** Kompress keep-ratio; null lets the model decide (~aggressive). */
  readonly target_ratio: number | null;
  /** Minimum token count before a message is eligible for compression. */
  readonly min_tokens_to_compress: number;
}

/**
 * The profile table. See docs/headroom-integration.md §3 for the rationale
 * behind each posture.
 *
 * - `logs`    — repetitive, low-density → aggressive, protect only the tail.
 * - `json`    — tool outputs → let SmartCrusher dedup; no text ratio forced.
 * - `code`    — high-density → conservative, protect analysis context.
 * - `spec`    — feature shards + guardrails → keep prefix stable (cache hits).
 * - `history` — multi-turn → keep recent, drop stale turns.
 */
export const PROFILES: Readonly<Record<ContextKind, HeadroomProfileConfig>> = {
  logs: {
    compress_user_messages: true,
    compress_system_messages: true,
    protect_recent: 2,
    protect_analysis_context: false,
    target_ratio: 0.25,
    min_tokens_to_compress: 250,
  },
  json: {
    compress_user_messages: true,
    compress_system_messages: true,
    protect_recent: 4,
    protect_analysis_context: false,
    target_ratio: null,
    min_tokens_to_compress: 250,
  },
  code: {
    compress_user_messages: false,
    compress_system_messages: false,
    protect_recent: 4,
    protect_analysis_context: true,
    target_ratio: 0.6,
    min_tokens_to_compress: 500,
  },
  spec: {
    compress_user_messages: false,
    compress_system_messages: false,
    protect_recent: 6,
    protect_analysis_context: true,
    target_ratio: 0.7,
    min_tokens_to_compress: 500,
  },
  history: {
    compress_user_messages: true,
    compress_system_messages: false,
    protect_recent: 4,
    protect_analysis_context: true,
    target_ratio: 0.4,
    min_tokens_to_compress: 300,
  },
};
