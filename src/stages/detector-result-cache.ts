// Cladding · stages · detector-result cache — run-scoped, gate-seam-lifetimed
//
// WHY. In one `clad check --tier=pre-commit` run the drift stage (stage_1.3)
// runs EVERY detector — including ARCHITECTURE_VIOLATION (madge --circular,
// ~1.3s) and HARDCODED_SECRET (secretlint, ~3.8s) — and then stage_1.5 (arch)
// and stage_1.6 (secret) are thin adapters that spawn those SAME two tools a
// SECOND time. ~5s of an ~11s tier was duplicate subprocess work. The Stop
// hook (cli/hook.ts runStopGate) has the same shape and paid that tax on every
// turn. This module lets the drift stage publish the two findings sets it has
// already computed so the adapter stages fold the cached findings instead of
// re-spawning.
//
// LIFETIME (mirrors the run-scoped spec cache in spec/load.ts:51-70). The
// session is primed and cleared ONLY at gate-run seams — cli/clad.ts
// runCheckStages and cli/hook.ts runStopGate — and callers MUST clear in a
// `finally`. Detectors are synchronous by Iron Law, so a session primed around
// the synchronous stage loop and cleared in finally cannot serve stale findings
// mid-run. The MCP serve layer runs gates via a `bin/clad` subprocess
// (serve/server.ts spawnSync), so the session lives entirely inside one process
// run and never crosses a request boundary; but tests drive these functions
// in-process, so the finally-clear discipline is mandatory — a leaked session
// would hand one test's findings to the next.

import {resolve} from 'node:path';

import type {DriftFinding} from './types.js';

/** The active gate-run session, or null between runs. `cwd` is resolved so a
 *  relative-vs-absolute mismatch never yields a false hit. */
let session: {readonly cwd: string; readonly results: Map<string, readonly DriftFinding[]>} | null = null;

/**
 * Opens a fresh detector-result session for a gate run. Callers MUST pair this
 * with {@link clearDetectorResultCache} in a `finally` — a primed session that
 * outlives its run would serve one run's findings to the next.
 *
 * @param cwd - The gate run's working directory; resolved for hit comparison.
 */
export function primeDetectorResultCache(cwd: string): void {
  session = {cwd: resolve(cwd), results: new Map()};
}

/**
 * Publishes a detector's findings into the active session so a later adapter
 * stage can reuse them instead of re-spawning the tool. No-op when no session
 * is primed (the standalone / PostToolUse / MCP-drift paths) or when `cwd` does
 * not match the session's — a mismatched run silently falls back to the direct
 * detector call rather than serving foreign findings.
 *
 * @param name - Detector name (matches {@link DriftFinding.detector}).
 * @param cwd - The cwd the detector ran under.
 * @param findings - The detector's findings, stored verbatim.
 */
export function storeDetectorResult(name: string, cwd: string, findings: readonly DriftFinding[]): void {
  if (!session || session.cwd !== resolve(cwd)) return;
  session.results.set(name, findings);
}

/**
 * Reads a detector's cached findings for this session, or null on a miss.
 * Returns null when no session is primed, when `cwd` does not match the
 * session's, or when the named detector has not stored findings this run — every
 * null case means "run the detector directly" (byte-identical fallback). A
 * stored EMPTY array is a hit (the detector ran clean), never a miss.
 *
 * @param name - Detector name to look up.
 * @param cwd - The cwd the reader is running under.
 * @returns The cached findings, or null to signal a direct run.
 */
export function readDetectorResult(name: string, cwd: string): readonly DriftFinding[] | null {
  if (!session || session.cwd !== resolve(cwd)) return null;
  const cached = session.results.get(name);
  return cached ?? null;
}

/** Closes the active session (see the lifetime rule in the header). Idempotent —
 *  safe to call in a `finally` whether or not a session was primed. */
export function clearDetectorResultCache(): void {
  session = null;
}
