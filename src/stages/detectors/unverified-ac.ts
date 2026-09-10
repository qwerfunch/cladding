// Cladding · drift detector · UNVERIFIED_AC
//
// Sibling to UNTESTED_AC (which only checks a test_ref EXISTS on disk). Schema
// 0.1 reads an opt-in JUnit report to close the traceability loop. Schema 0.2
// instead checks source/baseline integrity here; its current-run observation
// is reduced only after Unit by the assurance path.
//
// Schema 0.1 activation is opt-in and graceful: the detector reads the report
// at `.cladding/config.yaml::gate.test_report` (or a small set of conventional
// default paths). If no report is present it returns NOTHING — UNTESTED_AC's
// existence check remains the baseline, so projects that don't emit JUnit XML
// are unaffected.
//
// Severity policy (low false-positive by design):
//   - a test_ref whose tests FAILED / errored, or ran only SKIPPED → `error`
//     (the report definitively shows it did not pass)
//   - a test_ref ABSENT from a present report → `warn` (a partial/scoped run is
//     legitimate; --strict promotes it). Status policy: done features only.

import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {Spec} from '../../spec/types.js';
import {parseJUnitReport, lookupTestRef, isPathLike, type JUnitReport} from '../junit-report.js';
import {knownCriteriaFromCompilerView, harvestVitestJestBindings} from '../../proof/vitest-jest.js';
import {selectCriterionTestBindings} from '../../proof/legacy-bindings.js';
import {ProofPathSafetyError, safeProofDirectory, safeProofWorkspacePath} from '../../proof/fs-safety.js';
import {compileSpecWorkspace} from '../../spec/compiler/compile.js';
import {criterionBaselineMatchShape} from '../../spec/compiler/consumer-view.js';
import {resolveTestReportPath} from '../toolchain/gate-config.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'UNVERIFIED_AC';
// Same non-file pseudo-refs UNTESTED_AC skips — they carry no observable test.
const SKIPPABLE_PREFIXES = ['self-dogfood:', 'fixture:', 'derived:'];

function isSkippable(ref: string): boolean {
  return SKIPPABLE_PREFIXES.some((p) => ref.startsWith(p));
}

function runUnverifiedAc(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  try {
    const spec = loadSpec(cwd);
    if (spec.schema === '0.2') return evaluateSchema02AcVerification(cwd, spec);
    return legacyReportFindings(cwd, spec);
  } catch {
    // Keep schema 0.1's load-failure behavior: without a readable report this
    // remains a graceful skip, while a readable report still routes through
    // the shared `withSpec` diagnostic policy below.
    return legacyReportFindings(cwd);
  }
}

/** Resolves a workspace JUnit report only for the unchanged schema 0.1 path. */
function legacyReportFindings(cwd: string, loadedSpec?: Spec): readonly DriftFinding[] {
  const reportPath = resolveTestReportPath(cwd);
  if (!reportPath) return [];
  let report: JUnitReport;
  try {
    report = parseJUnitReport(readFileSync(reportPath, 'utf8'));
  } catch {
    return []; // Schema 0.1 still degrades on unreadable reports.
  }
  return loadedSpec ? evaluateAcVerification(loadedSpec, report)
    : withSpec(cwd, NAME, (spec) => evaluateAcVerification(spec, report));
}

/**
 * Pure core: given a loaded spec and a parsed JUnit report, return findings for
 * every done AC test_ref that failed, ran only skipped, or is absent. Exported
 * for unit testing without filesystem spec loading.
 */
export function evaluateAcVerification(spec: Spec, report: JUnitReport): readonly DriftFinding[] {
  // Confident-or-degrade (F-d980359c): if no report key is path-shaped, the
  // emitter's classname convention (e.g. jest describe titles) can't be mapped
  // to file-path test_refs — flagging every ref "absent" would be a false-
  // positive flood, so degrade to a no-op and leave UNTESTED_AC as the baseline.
  if (![...report.keys()].some(isPathLike)) return [];
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

/**
 * Schema 0.2 Drift checks only static F5 source/baseline integrity. Current
 * testcase observations are owned by the post-Unit assurance reduction, so a
 * retained workspace JUnit report cannot affect this evaluator.
 */
export function evaluateSchema02AcVerification(
  cwd: string,
  spec: Spec,
  ignoredWorkspaceReport?: JUnitReport,
): readonly DriftFinding[] {
  void ignoredWorkspaceReport;
  if (spec.schema !== '0.2') return [];
  const compilation = compileSpecWorkspace(cwd);
  const known = knownCriteriaFromCompilerView(compilation.nodes);
  const scanned = testSourceFiles(cwd);
  if (scanned.error) return [{detector: NAME, severity: 'error', path: 'tests', message: scanned.error}];
  const files = scanned.files;
  const harvested = files.map((file) => harvestVitestJestBindings({
    file, source: readFileSync(join(cwd, file), 'utf8'), knownCriteria: known,
  }));
  const diagnostics: DriftFinding[] = harvested.flatMap((result) => result.diagnostics.map((diagnostic) => ({
    detector: NAME, severity: 'error' as const, path: diagnostic.file,
    message: `Unknown covers criterion ${diagnostic.criterion} at ${diagnostic.file}:${diagnostic.line}:${diagnostic.column}.`,
  })));
  const bindings = harvested.flatMap((result) => result.bindings);
  const doneCriteria = (compilation.contract?.features ?? [])
    .filter((feature) => feature.status === 'done')
    .flatMap((feature) => feature.acceptanceCriteria.map((criterion) => ({
      address: `${feature.id}/${criterion.id}`,
      criterion,
    })));
  for (const item of doneCriteria) {
    const selection = selectCriterionTestBindings({
      cwd, baseline: compilation.migrationBaseline, criterion: item.address,
      currentCriterion: criterionBaselineMatchShape(item.criterion, compilation.migrationBaseline, item.address),
      live: bindings,
    });
    if (selection.source === 'legacy' || selection.source === 'reviewed') {
      const historic = selection.source === 'reviewed' ? selection.reviewed : selection.legacy;
      const label = selection.source === 'reviewed' ? 'reviewed carry-forward test binding' : 'legacy test binding';
      for (const binding of historic) {
        if (binding.state === 'unsafe') {
          diagnostics.push({detector: NAME, severity: 'error', path: binding.file, message: `${item.address} ${label} is unsafe and was not followed.`});
          continue;
        }
        if (binding.state === 'stale') {
          diagnostics.push({
            detector: NAME,
            severity: selection.source === 'reviewed' ? 'error' : 'warn',
            path: binding.file,
            message: selection.source === 'reviewed'
              ? `${item.address} reviewed carry-forward test bytes no longer match the immutable migration review.`
              : `${item.address} legacy test binding is stale; its baseline was not rewritten.`,
          });
          continue;
        }
        if (!hasExactSelector(binding.selector)) {
          diagnostics.push({
            detector: NAME,
            // D11 permits a whole-file migration fallback precisely because an
            // honest selector cannot be reconstructed. Keep it visible without
            // making the accepted, hash-current baseline a strict gate RED.
            severity: 'info',
            path: binding.file,
            message: `${item.address} ${label} has no exact testcase selector and cannot supply current proof.`,
          });
        }
      }
    }
  }
  return diagnostics;
}

function hasExactSelector(selector: string | undefined): selector is string {
  return typeof selector === 'string' && selector.length > 0;
}

/** Finds native adapter sources without interpreting other test frameworks. */
function testSourceFiles(cwd: string): {readonly files: readonly string[]; readonly error?: string} {
  const rootRelative = 'tests';
  if (!existsSync(join(cwd, rootRelative))) return {files: []};
  let root: string;
  try { root = safeProofDirectory(cwd, rootRelative); } catch (error) {
    return {files: [], error: `Unsafe native proof source root: ${(error as Error).message}`};
  }
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const absolute = join(directory, entry.name);
      const repoPath = relative(cwd, absolute).replaceAll('\\', '/');
      safeProofWorkspacePath(cwd, repoPath);
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) throw new ProofPathSafetyError(`Proof source contains a symbolic link: ${repoPath}.`);
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name) || !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      found.push(repoPath);
    }
  };
  try { visit(root); return {files: found.sort()}; } catch (error) {
    return {files: [], error: `Unsafe native proof source: ${(error as Error).message}`};
  }
}

export const unverifiedAc: DriftDetector = {
  name: NAME,
  run: runUnverifiedAc,
};
