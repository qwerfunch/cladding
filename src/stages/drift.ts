// Cladding · stage_1.3 Drift — core
//
// Reference implementation of Ironclad iron-law.md stage_1.3.
//   pass criteria: zero error-severity findings across registered detectors
//   determinism: deterministic
//   llm cost: 0
//
// This file is the *shape* of the drift stage: a plug-in registry plus the
// aggregator. Individual detectors (SECRETS_PRESENT, ARCH_DRIFT, AC_DRIFT, …)
// land in follow-up bricks and register via `registerDetector`. With an empty
// registry the stage trivially passes — by design, so this brick is
// self-dogfoodable in isolation.

import process from 'node:process';

import {loadSpec, primeSpecCache} from '../spec/load.js';

import {storeDetectorResult} from './detector-result-cache.js';
import {architectureViolation} from './detectors/architecture-violation.js';
import {hardcodedSecret} from './detectors/hardcoded-secret.js';
import {allDetectors} from './detectors/index.js';
import type {
  CommandStageOptions,
  DriftDetector,
  DriftFinding,
  DriftReport,
} from './types.js';

const detectors: DriftDetector[] = [...allDetectors];

// The two detectors whose findings stage_1.5 (arch) and stage_1.6 (secret)
// re-consume. When a gate run has primed the detector-result cache, runDrift
// publishes just these two findings sets so those adapter stages fold them
// instead of re-spawning madge + secretlint (F-e53596dd). Keyed off the
// detectors' own `name` so a rename stays in sync across the three sites.
const CACHED_DETECTOR_NAMES: ReadonlySet<string> = new Set([
  architectureViolation.name,
  hardcodedSecret.name,
]);

/**
 * Registers a drift detector into the module-level registry.
 *
 * Idempotent on `detector.name` — re-registering the same name replaces the
 * prior entry so repeated test setup and hot-reload don't double-fire. Order
 * of first registration is preserved.
 *
 * @param detector - The detector to register.
 * @see iron-law.md stage_1.3 — detector plug-in contract.
 */
export function registerDetector(detector: DriftDetector): void {
  const existingIndex = detectors.findIndex((d) => d.name === detector.name);
  if (existingIndex === -1) {
    detectors.push(detector);
    return;
  }
  detectors[existingIndex] = detector;
}

/** Clears the detector registry. Test affordance; not used at runtime. */
export function clearDetectors(): void {
  detectors.length = 0;
}

/** Returns the current detector names, in registration order. */
export function registeredDetectors(): readonly string[] {
  return detectors.map((d) => d.name);
}

/** Per-invocation runDrift options. Extends the shared stage opts. */
export interface DriftOptions extends CommandStageOptions {
  /**
   * When true, promote warn-severity findings to fail the stage. The
   * default (false) leaves warns as informational. CI / pre-publish
   * gates set this to catch slow-burning drift the default policy lets
   * through.
   * @see stages/detectors/README.md — "Opt-in strict mode".
   */
  readonly strict?: boolean;
}

/**
 * Runs every registered detector and aggregates their findings into a report.
 *
 * Pass policy: by default, `pass=true` exactly when no finding has severity
 * `'error'`. When `opts.strict` is true, any finding of severity `'error'`
 * **or** `'warn'` fails the stage — the strict policy is the opt-in CI
 * gate for catching drift the default policy considers informational.
 *
 * Warn- and info-level findings are always surfaced in `findings` for
 * downstream tooling regardless of strict mode.
 *
 * @param opts - Forwarded verbatim to each detector, plus `strict`.
 * @returns The aggregated drift report.
 * @see iron-law.md stage_1.3 — "zero error-severity findings".
 * @see stages/detectors/README.md — severity matrix + strict mode.
 */
export function runDrift(opts: DriftOptions = {}): DriftReport {
  const findings: DriftFinding[] = [];
  // F-cd0415 — one spec load for the whole pass. Detectors are synchronous
  // (Iron Law), so priming around this loop and clearing in finally cannot
  // serve stale spec; a load failure primes nothing and every detector keeps
  // its own established load-failure behavior (withSpec info / silent).
  const cwd = opts.cwd ?? '.';
  try {
    primeSpecCache(cwd, loadSpec(cwd));
  } catch {
    primeSpecCache(cwd, null);
  }
  try {
    for (const detector of detectors) {
      const detectorFindings = detector.run(opts);
      findings.push(...detectorFindings);
      // Publish the arch/secret findings for stage_1.5/1.6 to reuse. No-op
      // unless a gate-run session is primed (storeDetectorResult guards on it),
      // so standalone / PostToolUse / MCP-drift runs are unchanged (F-e53596dd).
      if (CACHED_DETECTOR_NAMES.has(detector.name)) {
        storeDetectorResult(detector.name, cwd, detectorFindings);
      }
    }
  } finally {
    primeSpecCache(cwd, null);
  }
  const failingSeverities: ReadonlySet<DriftFinding['severity']> = opts.strict
    ? new Set<DriftFinding['severity']>(['error', 'warn'])
    : new Set<DriftFinding['severity']>(['error']);
  const pass = !findings.some((f) => failingSeverities.has(f.severity));
  return {
    stage: 'stage_1.3',
    pass,
    exitCode: pass ? 0 : 1,
    findings,
  };
}

// CLI entry — `tsx stages/drift.ts` or `npm run stage:drift`. Supports
// `--strict` to promote warn findings to fail-grade (matches the
// `clad check --strict` behaviour).
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const strict = process.argv.includes('--strict');
  const report = runDrift({strict});
  console.log(JSON.stringify(report));
  process.exit(report.exitCode);
}
