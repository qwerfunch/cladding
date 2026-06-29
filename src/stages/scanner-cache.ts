// Cladding · gate-scoped external-scanner memo (F-5a49899e).
//
// HARDCODED_SECRET (secretlint) and ARCHITECTURE_VIOLATION (madge) shell out to
// an external tool — measured at ~4.4s and ~1.4s respectively, together ~97% of
// the drift stage. They run TWICE per gate: once inside the Drift stage
// (stage_1.3, which sweeps every detector) and again as their own dedicated
// stage (Secret stage_1.6 / Arch stage_1.5, thin adapters over the same
// detector). `secret.ts` even documents that the layering "avoids spawning the
// scanner twice" — but nothing enforced it, so a full gate paid ~5.8s of pure
// duplicate subprocess time.
//
// This is the missing enforcement: a GATE-scoped memo, mirroring the run-scoped
// spec cache (F-cd0415). `clad check` primes it around the stage loop and clears
// it in a finally; within that window the second invocation of an identical
// (cwd, cmd, args) scan is a cache hit, so the tool spawns once. Outside a primed
// window (a standalone detector call, the MCP read path) `memoizeScan` is a
// pass-through — behavior is byte-for-byte unchanged. A fresh Map per gate run
// means the long-lived MCP server never serves a stale scan across requests.

import type {DriftFinding} from './types.js';

let cache: Map<string, readonly DriftFinding[]> | null = null;

/**
 * Prime (true) or clear (false) the gate-scoped scanner cache. Callers MUST
 * clear in a `finally` — a primed cache outliving its gate run would serve a
 * stale scan. Priming installs a FRESH map, so each gate run is isolated.
 */
export function primeScannerCache(on: boolean): void {
  cache = on ? new Map() : null;
}

/**
 * Run `compute` (the external-tool invocation) memoized by `key` for the current
 * gate pass. With no cache primed, runs `compute` verbatim — no caching, no
 * behavior change. With a cache primed, an identical key returns the cached
 * findings instead of re-spawning the tool.
 */
export function memoizeScan(key: string, compute: () => readonly DriftFinding[]): readonly DriftFinding[] {
  if (!cache) return compute();
  const hit = cache.get(key);
  if (hit) return hit;
  const result = compute();
  cache.set(key, result);
  return result;
}
