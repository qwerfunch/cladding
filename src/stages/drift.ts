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
  /**
   * Optional scope filter (0.4.2, foundation for work-transaction
   * scope-aware iron law). Each entry is a path prefix or exact path
   * (no glob — added in a later patch). When set, only findings whose
   * `path` matches one of the scopes are kept; project-level findings
   * with no `path` are always kept (HARNESS_INTEGRITY etc.).
   *
   * Example: `scope: ['src/work/']` keeps only findings under that
   * directory plus any project-level finding.
   *
   * @see src/spec/update.ts `getFeatureScope` — supplies the modules
   *      list a `work` transaction passes in.
   */
  readonly scope?: readonly string[];
}

/** Returns true when the given path is inside any of the scope entries. */
function pathInScope(path: string, scope: readonly string[]): boolean {
  for (const s of scope) {
    if (!s) continue;
    if (path === s) return true;
    const prefix = s.endsWith('/') ? s : `${s}/`;
    if (path.startsWith(prefix)) return true;
  }
  return false;
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
  const raw: DriftFinding[] = [];
  for (const detector of detectors) {
    raw.push(...detector.run(opts));
  }
  // Scope filter (0.4.2). Project-level findings (no `path`) bypass the
  // filter — they reflect cross-cutting invariants, not module work.
  const findings =
    opts.scope && opts.scope.length > 0
      ? raw.filter((f) => !f.path || pathInScope(f.path, opts.scope!))
      : raw;
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
// `clad check --strict` behaviour) and `--scope <path>[,<path>]` to
// restrict findings to one or more module prefixes (0.4.2 foundation
// for work-transaction scope-aware drift; full glob support lands in
// a later patch).
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const strict = process.argv.includes('--strict');
  const scopeIdx = process.argv.indexOf('--scope');
  const scope =
    scopeIdx >= 0 && scopeIdx + 1 < process.argv.length
      ? process.argv[scopeIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
  const report = runDrift({strict, scope});
  console.log(JSON.stringify(report));
  process.exit(report.exitCode);
}
