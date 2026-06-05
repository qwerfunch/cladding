// Cladding · Token Optimizer · Headroom compression seam
//
// F-6aebb9 — the single integration point between the cladding harness and
// the Headroom compression engine. Headroom's only serverless surface is its
// Python library (Rust core), so this seam reaches it through a one-shot
// subprocess bridge (scripts/headroom_bridge.py): spawn python, pipe messages
// in as JSON, read compressed messages out, let the process exit. No daemon,
// no port, no Cloud round-trip.
//
// Contract (the load-bearing invariant): compressContext() NEVER throws and
// NEVER blocks correctness. On disabled config, a too-small payload, an open
// circuit, or ANY bridge failure it returns the ORIGINAL messages. Compression
// is a pure cost optimization layered over the existing dispatch path — the
// harness must behave identically with Headroom absent.
//
// @see docs/headroom-integration.md — full design + rollout.
// @see spec/features/headroom-compression-seam-6aebb9.yaml — the contract.

import {spawn} from 'node:child_process';
import process from 'node:process';

import type {ContextKind, HeadroomProfileConfig} from './profiles.js';
import {PROFILES} from './profiles.js';

/** A chat message in OpenAI shape — Headroom's lingua franca. */
export interface OpenAIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_call_id?: string;
}

/** Mirrors Headroom's CompressResult (camelCased by the bridge). */
export interface CompressResult {
  readonly messages: OpenAIMessage[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly tokensSaved: number;
  readonly compressionRatio: number;
  readonly transformsApplied: string[];
  readonly ccrHashes: string[];
  /** false ⇒ the engine produced no savings (treated as a no-op). */
  readonly compressed: boolean;
}

/** Why the seam declined to use a compressed payload, when it did. */
export type FallbackReason =
  | 'disabled'
  | 'below_min_tokens'
  | 'circuit_open'
  | 'no_savings'
  | 'timeout'
  | 'bridge_error';

/**
 * The seam's decision wrapper. `messages` is ALWAYS usable — it is the
 * compressed payload when `applied`, otherwise the untouched original.
 * Callers send `outcome.messages` unconditionally.
 */
export interface CompressOutcome {
  readonly messages: OpenAIMessage[];
  readonly applied: boolean;
  readonly result?: CompressResult;
  readonly fallbackReason?: FallbackReason;
}

// --- Session-scoped circuit breaker -------------------------------------

let consecutiveFailures = 0;

/** Reset the breaker — test seam; production never calls this. */
export function resetCircuitForTesting(): void {
  consecutiveFailures = 0;
}

function maxFailures(): number {
  return Number(process.env.CLADDING_HEADROOM_MAX_FAILS ?? 3);
}

// --- Gates ---------------------------------------------------------------

/** Master switch — off unless CLADDING_HEADROOM is 'on' or 'simulate'. */
function enabled(): boolean {
  const mode = process.env.CLADDING_HEADROOM ?? 'off';
  return mode === 'on' || mode === 'simulate';
}

function minTokens(): number {
  return Number(process.env.CLADDING_HEADROOM_MIN_TOKENS ?? 1500);
}

/**
 * Cheap heuristic (~4 chars/token). Only used to decide whether a payload
 * is large enough to be worth the subprocess cold-start — never sent to the
 * model or used for billing, so approximation is fine.
 */
export function approxTokens(messages: readonly OpenAIMessage[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4);
}

// --- Public API ----------------------------------------------------------

/**
 * Compress the messages for one LLM call. Always returns usable messages.
 *
 * @param messages - The payload about to be sent to the model.
 * @param kind - Which {@link ContextKind} profile to apply (default 'spec').
 * @param model - Model id Headroom tokenizes against.
 * @returns A {@link CompressOutcome} whose `messages` are safe to send
 *   whether or not compression actually ran.
 */
export async function compressContext(
  messages: OpenAIMessage[],
  kind: ContextKind = 'spec',
  model = 'claude-sonnet-4-5-20250929',
): Promise<CompressOutcome> {
  if (!enabled()) return {messages, applied: false, fallbackReason: 'disabled'};
  if (consecutiveFailures >= maxFailures()) {
    return {messages, applied: false, fallbackReason: 'circuit_open'};
  }
  if (approxTokens(messages) < minTokens()) {
    return {messages, applied: false, fallbackReason: 'below_min_tokens'};
  }

  try {
    const result = await runBridge(messages, model, PROFILES[kind]);
    consecutiveFailures = 0;
    if (!result.compressed || result.tokensSaved <= 0) {
      return {messages, applied: false, result, fallbackReason: 'no_savings'};
    }
    return {messages: result.messages, applied: true, result};
  } catch (err) {
    consecutiveFailures += 1;
    const reason: FallbackReason =
      err instanceof Error && err.message === 'timeout' ? 'timeout' : 'bridge_error';
    // Passthrough — degraded cost, never broken correctness (AC-b9218d).
    return {messages, applied: false, fallbackReason: reason};
  }
}

// --- Transport: one-shot subprocess bridge -------------------------------

interface BridgeRequest {
  readonly messages: readonly OpenAIMessage[];
  readonly model: string;
  readonly config: HeadroomProfileConfig;
}

/**
 * Spawn the Python bridge, write the request to stdin, resolve with the
 * parsed CompressResult from stdout. Rejects on timeout, non-zero exit, or
 * unparseable output — the caller turns any rejection into passthrough.
 */
function runBridge(
  messages: readonly OpenAIMessage[],
  model: string,
  config: HeadroomProfileConfig,
): Promise<CompressResult> {
  const python = process.env.CLADDING_HEADROOM_PYTHON ?? 'python3';
  const bridge = process.env.CLADDING_HEADROOM_BRIDGE ?? 'scripts/headroom_bridge.py';
  const timeoutMs = Number(process.env.CLADDING_HEADROOM_TIMEOUT_MS ?? 5000);
  const request: BridgeRequest = {messages, model, config};

  return new Promise<CompressResult>((resolve, reject) => {
    const child = spawn(python, [bridge], {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('timeout')));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`bridge exit ${code}: ${stderr.trim().slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as CompressResult);
        } catch (e) {
          reject(new Error(`bad bridge output: ${(e as Error).message}`));
        }
      });
    });

    child.stdin.on('error', () => {
      /* EPIPE if the child died early — surfaced via 'error'/'close'. */
    });
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}
