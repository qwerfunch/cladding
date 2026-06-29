// Cladding · detector regression audit (F-b91fce34) — sibling to conformance.
//
// "The thing that judges everything is itself unjudged." cladding gates on ~38
// drift detectors, yet nothing measures whether those detectors stay accurate
// across releases. This harness runs a curated adversarial corpus (audit/
// corpus.ts) — per detector, drift cases that MUST fire and clean/near-miss
// cases that MUST stay silent — and scores per-detector TP/FP/FN/TN.
//
// HONEST FRAMING (do not over-claim): these are COUNTS over a hand-curated
// corpus, a REGRESSION GUARD — not population precision/recall. A detector's
// "0 fp / 0 fn" means "no regression on the cases we wrote", not "statistically
// accurate in the wild". The committed baseline (audit/detector-baseline.json)
// locks the known-good counts; a PR that pushes a detector's fp or fn above
// baseline fails here, surfacing drift toward NOISE (fp) or BLINDNESS (fn).
//
// v1 SCOPE: pure detectors only. Shell-based detectors (HARDCODED_SECRET,
// ARCHITECTURE_VIOLATION, COVERAGE_DROP) are intentionally not covered yet.
//
// Exit codes: 0 = no regression vs baseline · 1 = a detector regressed (or a
// setup/lookup error) · run with --update-baseline to rewrite the baseline.

import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import {allDetectors} from '../src/stages/detectors/index.js';
import {corpus, type CorpusCase, type Expect} from './corpus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = join(HERE, 'detector-baseline.json');
export const OUT_OF_SCOPE = ['HARDCODED_SECRET', 'ARCHITECTURE_VIOLATION', 'COVERAGE_DROP'];

export type Verdict = 'TP' | 'FP' | 'FN' | 'TN';
export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}
export type Baseline = Record<string, {fp: number; fn: number}>;

const byName = new Map(allDetectors.map((d) => [d.name, d]));

/** Classify an outcome from what was expected and whether the detector fired. */
export function classify(expect: Expect, didFire: boolean): Verdict {
  if (expect === 'drift') return didFire ? 'TP' : 'FN';
  return didFire ? 'FP' : 'TN';
}

/** Did the named detector fire on this dir (respecting an optional severity floor)? */
function fired(c: CorpusCase, dir: string): boolean {
  const detector = byName.get(c.detector);
  if (!detector) throw new Error(`unknown detector '${c.detector}' in case ${c.id}`);
  const findings = detector.run({cwd: dir});
  return findings.some((f) => f.detector === c.detector && (c.severity ? f.severity === c.severity : true));
}

export interface CaseOutcome {
  readonly id: string;
  readonly detector: string;
  readonly expect: Expect;
  readonly verdict: Verdict;
}

/** Materialize one case in a temp dir, run its detector, classify, clean up. */
export function runCase(c: CorpusCase): CaseOutcome {
  const dir = mkdtempSync(join(tmpdir(), `clad-audit-${c.id.replace(/[^a-zA-Z0-9]/g, '_')}-`));
  try {
    c.setup(dir);
    return {id: c.id, detector: c.detector, expect: c.expect, verdict: classify(c.expect, fired(c, dir))};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

export function aggregate(outcomes: readonly Pick<CaseOutcome, 'detector' | 'verdict'>[]): Map<string, Counts> {
  const m = new Map<string, Counts>();
  for (const o of outcomes) {
    const c = m.get(o.detector) ?? {tp: 0, fp: 0, fn: 0, tn: 0};
    c[o.verdict.toLowerCase() as keyof Counts] += 1;
    m.set(o.detector, c);
  }
  return m;
}

/** Per-detector fp/fn that rose ABOVE the committed baseline (default 0/0). */
export function findRegressions(counts: Map<string, Counts>, baseline: Baseline): string[] {
  const out: string[] = [];
  for (const [name, c] of counts) {
    const base = baseline[name] ?? {fp: 0, fn: 0};
    if (c.fp > base.fp) out.push(`${name}: false-positives ${base.fp} → ${c.fp} (noise regression)`);
    if (c.fn > base.fn) out.push(`${name}: false-negatives ${base.fn} → ${c.fn} (blindness regression)`);
  }
  return out;
}

export function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  } catch {
    return {};
  }
}

/** The audit's machine-readable summary. */
export interface AuditReport {
  readonly audit: 'detector-regression';
  readonly framing: string;
  readonly v1_scope: string;
  readonly cases: number;
  readonly detectors: number;
  readonly per_detector: Record<string, Counts>;
  readonly mismatches: CaseOutcome[];
  readonly regressions: string[];
  readonly result: 'pass' | 'fail';
}

/** Run the whole corpus and build the report object (no I/O side effects). */
export function runAudit(): {
  outcomes: CaseOutcome[];
  counts: Map<string, Counts>;
  regressions: string[];
  report: AuditReport;
} {
  const outcomes = corpus.map(runCase);
  const counts = aggregate(outcomes);
  const regressions = findRegressions(counts, loadBaseline());
  const report: AuditReport = {
    audit: 'detector-regression',
    framing: 'curated-corpus TP/FP/FN counts (a regression guard) — NOT population precision/recall',
    v1_scope: `pure detectors only; out of scope: ${OUT_OF_SCOPE.join(', ')}`,
    cases: corpus.length,
    detectors: counts.size,
    per_detector: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    mismatches: outcomes.filter((o) => o.verdict === 'FP' || o.verdict === 'FN'),
    regressions,
    result: regressions.length === 0 ? 'pass' : 'fail',
  };
  return {outcomes, counts, regressions, report};
}

function main(): void {
  if (process.argv.includes('--update-baseline')) {
    const {counts} = runAudit();
    const next: Baseline = {};
    for (const [name, c] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) next[name] = {fp: c.fp, fn: c.fn};
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`detector-baseline.json updated for ${counts.size} detector(s).`);
    return;
  }
  const {regressions, report} = runAudit();
  console.log(JSON.stringify(report, null, 2));
  process.exit(regressions.length === 0 ? 0 : 1);
}

// Run only when invoked directly (not when imported by a test).
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile || process.argv[1] === thisFile.replace(/\.ts$/, '.js')) {
  main();
}
