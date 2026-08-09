// Cladding · Stop outcome telemetry (F-1aab1bba, pure)
//
// Stop's refusal is useful only if the lifecycle ledger can later answer what
// it caught and whether a normal gate would have caught the same failure set.
// This module derives that evidence from existing event order. It owns no IO
// and no policy: hook/done/gate decisions remain in their existing callers.

import {createHash} from 'node:crypto';

import {isBlocking, type GateStatus} from '../stages/disposition.js';
import type {Event} from './log.js';

/** Minimal structured finding needed by the telemetry reducers. */
export interface TelemetryFinding {
  readonly detector: string;
  readonly path?: string;
  readonly severity?: 'error' | 'warn' | 'info';
}

/** Structural gate-stage input accepted from the CLI without importing it. */
export interface TelemetryStage {
  readonly stage: string;
  readonly status: GateStatus;
  readonly findings?: readonly TelemetryFinding[];
}

/** Stop failure input after the hook has normalized a missing path to `''`. */
export interface StopFailureTelemetry {
  readonly detector: string;
  readonly path: string;
}

/** Attribution attached to each Stop outcome event. */
export interface StopAttribution {
  /** Sorted, unique detector names in the current Stop failure set. */
  readonly detectors: readonly string[];
  /** Finding count whose detector was absent from the latest observed gate. */
  readonly introduced: number;
  /** Finding count whose detector was present in the latest observed gate. */
  readonly preexisting: number;
  /** Whether at least one path-bearing finding intersects the current dirty tree. */
  readonly dirty_hit: boolean;
}

/** Read-time Stop outcome counters exposed by `clad doctor`. */
export interface StopOutcomeSummary {
  /** Fresh fingerprints that caused Stop to block. */
  readonly blocked: number;
  /** Identical repeat fingerprints that demoted to an allowed exit. */
  readonly exitsRecorded: number;
  /** Blocked fingerprints reproduced by at least one later gate run. */
  readonly observedByLaterGate: number;
  /** Blocked fingerprints without a matching later gate in this event slice. */
  readonly notObservedByLaterGate: number;
}

/**
 * Returns sorted, unique blocker names for a gate outcome.
 *
 * Structured non-info findings retain their detector identity. A blocking
 * stage without structured findings falls back to its stable stage id so red
 * type/lint/smoke outcomes are never reported as blocker-free.
 *
 * @param stages - Gate stages after all strict/exemption reductions.
 * @returns Compact blocker names; empty for a green gate.
 * @see spec/features/stop-outcome-telemetry-1aab1bba.yaml AC-004
 */
export function blockingDetectorNames(stages: readonly TelemetryStage[]): readonly string[] {
  const names = new Set<string>();
  for (const stage of stages) {
    if (!isBlocking(stage.status)) continue;
    const findings = (stage.findings ?? []).filter((finding) => finding.severity !== 'info');
    if (findings.length === 0) {
      names.add(stage.stage);
      continue;
    }
    for (const finding of findings) names.add(finding.detector);
  }
  return [...names].sort();
}

/**
 * Computes the gate-side equivalent of Stop's persisted fingerprint.
 *
 * This intentionally does not replace the hook's deployed calculation. The
 * hook has a compatibility-sensitive sidecar contract; the gate mirrors its
 * normalized `detector|path` keys so old sidecars keep demoting byte-for-byte.
 * Only the deterministic Stop trio participates: strict Drift plus synthetic
 * ARCH/SECRET stage failures.
 *
 * @param stages - Gate stages after strict/exemption reductions.
 * @returns SHA-256 fingerprint, or `''` when the Stop trio is green/absent.
 * @see spec/features/stop-outcome-telemetry-1aab1bba.yaml AC-003
 */
export function gateStopFingerprint(stages: readonly TelemetryStage[]): string {
  const keys: string[] = [];
  const drift = stages.find((stage) => stage.stage === 'stage_1.3');
  if (drift && isBlocking(drift.status)) {
    for (const finding of drift.findings ?? []) {
      if (finding.severity === 'error' || finding.severity === 'warn') {
        keys.push(`${finding.detector}|${finding.path ?? ''}`);
      }
    }
  }
  if (stages.some((stage) => stage.stage === 'stage_1.5' && isBlocking(stage.status))) {
    keys.push('ARCH|stage');
  }
  if (stages.some((stage) => stage.stage === 'stage_1.6' && isBlocking(stage.status))) {
    keys.push('SECRET|stage');
  }
  if (keys.length === 0) return '';
  return createHash('sha256').update(keys.sort().join('\n')).digest('hex');
}

/**
 * Attributes a Stop failure set against the latest observed gate and dirty tree.
 *
 * `introduced` means "not named by the latest observed gate", not causal proof
 * that the current session created the problem. With no prior blocker names,
 * all current failures are conservatively counted as newly observed. The
 * independent `dirty_hit` bit records working-tree intersection without
 * conflating dirty state with causality.
 *
 * @param failures - Current Stop failures.
 * @param priorBlockers - Compact blocker names from the latest gate event.
 * @param dirtyPaths - Repo-relative paths reported dirty by Git.
 * @returns Additive attribution fields for the lifecycle event.
 * @see spec/features/stop-outcome-telemetry-1aab1bba.yaml AC-001
 */
export function attributeStopFailures(
  failures: readonly StopFailureTelemetry[],
  priorBlockers: readonly string[],
  dirtyPaths: readonly string[],
): StopAttribution {
  const prior = new Set(priorBlockers);
  const dirty = new Set(dirtyPaths);
  let introduced = 0;
  let preexisting = 0;
  let dirtyHit = false;
  for (const failure of failures) {
    if (prior.has(failure.detector)) preexisting++;
    else introduced++;
    if (failure.path.length > 0 && dirty.has(failure.path)) dirtyHit = true;
  }
  return {
    detectors: [...new Set(failures.map((failure) => failure.detector))].sort(),
    introduced,
    preexisting,
    dirty_hit: dirtyHit,
  };
}

/**
 * Correlates each Stop block only with gate events that occur later in order.
 *
 * Legacy or malformed payloads remain countable but cannot fabricate a match.
 * No state file is needed: event order plus the additive gate fingerprint is
 * the complete correlation source.
 *
 * @param events - Lifecycle events in append order.
 * @returns Stop block, recorded-exit, and later-gate counters.
 * @see spec/features/stop-outcome-telemetry-1aab1bba.yaml AC-003
 */
export function summarizeStopOutcomes(events: readonly Event[]): StopOutcomeSummary {
  let blocked = 0;
  let exitsRecorded = 0;
  let observedByLaterGate = 0;
  const laterGateFingerprints = new Set<string>();
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === 'gate_run') {
      const fingerprint = event.payload.stopFingerprint;
      if (typeof fingerprint === 'string' && fingerprint.length > 0) {
        laterGateFingerprints.add(fingerprint);
      }
      continue;
    }
    if (event.type === 'stop_exit_recorded') {
      exitsRecorded++;
      continue;
    }
    if (event.type !== 'stop_blocked') continue;
    blocked++;
    const fingerprint = typeof event.payload.fingerprint === 'string' ? event.payload.fingerprint : '';
    if (fingerprint.length > 0 && laterGateFingerprints.has(fingerprint)) observedByLaterGate++;
  }
  return {
    blocked,
    exitsRecorded,
    observedByLaterGate,
    notObservedByLaterGate: blocked - observedByLaterGate,
  };
}
