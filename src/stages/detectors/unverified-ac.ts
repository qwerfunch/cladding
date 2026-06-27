// Cladding · drift detector · UNVERIFIED_AC
//
// Sibling to UNTESTED_AC (which only checks a test_ref EXISTS on disk). When a
// JUnit XML report is available, this closes the traceability loop one step
// further: a done AC's referenced tests must have actually RUN and PASSED, not
// just exist. An empty file, a `test.skip`, or a failing test no longer slips
// through as "tested".
//
// Activation is opt-in and graceful: the detector reads the report at
// `.cladding/config.yaml::gate.test_report` (or a small set of conventional
// default paths). If no report is present it returns NOTHING — UNTESTED_AC's
// existence check remains the baseline, so projects that don't emit JUnit XML
// are unaffected.
//
// Severity policy (low false-positive by design):
//   - a test_ref whose tests FAILED / errored, or ran only SKIPPED → `error`
//     (the report definitively shows it did not pass)
//   - a test_ref ABSENT from a present report → `warn` (a partial/scoped run is
//     legitimate; --strict promotes it). Status policy: done features only.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import {parseJUnitReport, lookupTestRef, type JUnitReport} from '../junit-report.js';
import {readGateConfig} from '../toolchain/gate-config.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'UNVERIFIED_AC';
// Same non-file pseudo-refs UNTESTED_AC skips — they carry no observable test.
const SKIPPABLE_PREFIXES = ['self-dogfood:', 'fixture:', 'derived:'];
// Tried in order when `gate.test_report` is unset; first existing one wins.
const DEFAULT_REPORT_CANDIDATES = ['test-report.junit.xml', join('coverage', 'junit.xml'), join('.cladding', 'test-report.junit.xml')];

function isSkippable(ref: string): boolean {
  return SKIPPABLE_PREFIXES.some((p) => ref.startsWith(p));
}

/** Resolve the JUnit report path: explicit config first, then conventions. Null = none present. */
function resolveReportPath(cwd: string): string | null {
  const configured = readGateConfig(cwd).testReport;
  if (configured) return existsSync(join(cwd, configured)) ? join(cwd, configured) : null;
  for (const candidate of DEFAULT_REPORT_CANDIDATES) {
    if (existsSync(join(cwd, candidate))) return join(cwd, candidate);
  }
  return null;
}

function runUnverifiedAc(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const reportPath = resolveReportPath(cwd);
  if (!reportPath) return []; // graceful skip — no report to verify against
  let report: JUnitReport;
  try {
    report = parseJUnitReport(readFileSync(reportPath, 'utf8'));
  } catch {
    return []; // unreadable/garbled report → degrade, never throw (error-as-data)
  }
  return withSpec(cwd, NAME, (spec) => evaluateAcVerification(spec, report));
}

/**
 * Pure core: given a loaded spec and a parsed JUnit report, return findings for
 * every done AC test_ref that failed, ran only skipped, or is absent. Exported
 * for unit testing without filesystem spec loading.
 */
export function evaluateAcVerification(spec: Spec, report: JUnitReport): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        if (isSkippable(ref)) continue;
        const pathPart = ref.split('#', 1)[0];
        const status = lookupTestRef(report, pathPart);
        if (!status) {
          findings.push({
            detector: NAME,
            severity: 'warn',
            path: ref,
            message:
              `${feature.id}.${ac.id} test_ref '${ref}' has no observed result in the JUnit report — ` +
              `the referenced test did not run (a scoped/partial run is fine; under --strict this blocks).`,
          });
        } else if (status.fail > 0) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: ref,
            message: `${feature.id}.${ac.id} test_ref '${ref}' has FAILING tests in the JUnit report — a done AC must be backed by passing tests.`,
          });
        } else if (status.pass === 0 && status.skip > 0) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: ref,
            message: `${feature.id}.${ac.id} test_ref '${ref}' ran only SKIPPED tests in the JUnit report — no test actually verified this AC.`,
          });
        }
      }
    }
  }
  return findings;
}

export const unverifiedAc: DriftDetector = {
  name: NAME,
  run: runUnverifiedAc,
};
