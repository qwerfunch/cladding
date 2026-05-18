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

import {allDetectors} from './detectors/index.js';
import type {
  CommandStageOptions,
  DriftDetector,
  DriftFinding,
  DriftReport,
} from './types.js';

const detectors: DriftDetector[] = [...allDetectors];

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

/**
 * Runs every registered detector and aggregates their findings into a report.
 *
 * Pass policy: `pass=true` exactly when no finding has severity `'error'`.
 * Warn- and info-level findings are surfaced in `findings` but never fail
 * the stage — they exist to give downstream tooling something to display.
 *
 * @param opts - Forwarded verbatim to each detector.
 * @returns The aggregated drift report.
 * @see iron-law.md stage_1.3 — "zero error-severity findings".
 */
export function runDrift(opts: CommandStageOptions = {}): DriftReport {
  const findings: DriftFinding[] = [];
  for (const detector of detectors) {
    findings.push(...detector.run(opts));
  }
  const pass = !findings.some((f) => f.severity === 'error');
  return {
    stage: 'stage_1.3',
    pass,
    exitCode: pass ? 0 : 1,
    findings,
  };
}

// CLI entry — `tsx stages/drift.ts` or `npm run stage:drift`.
const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const report = runDrift();
  console.log(JSON.stringify(report));
  process.exit(report.exitCode);
}
