// Cladding · stage_2.1 vacuous-test guard (F-b81d203e)
//
// THE gap exp-1/exp-2 confirmed: a `done` feature whose declared tests are ALL
// `it.skip` / assertion-free / 0-executed still makes the unit runner exit 0 →
// stage_2.1 `pass` → verdict `hasBehavioralProof` → `clad done` flips it to done.
// Neither the gate nor verdict catches it. This module is the per-feature check
// that closes it: given the test runner's machine-readable per-test results, a
// done feature whose declared `test_refs` files ALL failed to execute a passing
// test is VACUOUS — the unit stage (src/stages/unit.ts) escalates it to a
// blocking finding under --strict so the gate is not GREEN and done reverts.
//
// DEFENSIVE LOCK (AC-1a0b1b26, non-negotiable): this runs on cladding's own gate
// (Stop hook / clad done / CI) across ~245 done features every strict run. A
// false positive turns cladding's own strict gate RED. So every function here is
// total and CONSERVATIVE — it fires ONLY on a definitive all-vacuous case (every
// declared test file PRESENT in the json AND 0 executed-passing), and treats any
// ambiguity (a ref absent from the json, an unparseable document, a doc/helper
// ref the runner never scanned) as "can't determine" → no finding. A parse or
// spec-load failure must NEVER fail the gate.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {loadSpec} from '../spec/load.js';
import type {Spec} from '../spec/types.js';
import type {DriftFinding} from './types.js';

/** vitest `--reporter=json` shape (subset) — the same records finding-parser.ts reads. */
interface VitestJsonAssertion {
  readonly status?: string;
}
interface VitestJsonFile {
  readonly name?: string;
  readonly assertionResults?: readonly VitestJsonAssertion[];
}

/**
 * Parses a vitest `--reporter=json` document into a map of absolute test-file
 * path → count of assertions that actually EXECUTED and PASSED (status
 * `'passed'`; `skipped`/`todo`/`pending` do NOT count). Returns `null` when the
 * text is not the expected json shape — the lenient "can't determine" signal
 * the caller falls back on (AC-1a0b1b26). Keys are `path.resolve`d so a relative
 * `test_ref` and the json's absolute `name` compare on equal footing.
 *
 * @param jsonText - The contents of the temp file vitest's json reporter wrote.
 */
export function parseExecutedPassCounts(jsonText: string): Map<string, number> | null {
  const trimmed = jsonText.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const results = (parsed as {testResults?: readonly VitestJsonFile[]}).testResults;
  if (!Array.isArray(results)) return null;
  const counts = new Map<string, number>();
  for (const file of results) {
    if (typeof file.name !== 'string' || !file.name) continue;
    const key = resolve(file.name);
    let passed = counts.get(key) ?? 0;
    for (const a of file.assertionResults ?? []) {
      if (a.status === 'passed') passed += 1;
    }
    counts.set(key, passed);
  }
  return counts;
}

/** Strips a `#anchor` (the test fullName) from a `test_ref`, leaving the file path. */
function refFilePath(ref: string): string {
  const hash = ref.indexOf('#');
  return (hash === -1 ? ref : ref.slice(0, hash)).trim();
}

/**
 * Returns one `VACUOUS_TESTS` finding per DONE feature whose declared `test_refs`
 * are DEFINITIVELY vacuous. A feature is flagged ONLY when it declares at least
 * one test_ref AND every referenced file was found in `passCounts` with zero
 * executed-passing tests. It is NOT flagged when:
 *   - any referenced file executed ≥ 1 passing test (AC-d7a9568e — a real suite);
 *   - any referenced file is absent from `passCounts` (a doc/helper ref, a file
 *     the runner never scanned, an anchor/path mismatch) → "can't determine",
 *     the conservative lenient path (AC-1a0b1b26).
 * Planned/in-progress features are skipped (AC-4f3d74ee).
 *
 * @param spec - The loaded project spec (features + acceptance_criteria).
 * @param passCounts - Absolute-path → executed-pass count, from {@link parseExecutedPassCounts}.
 * @param cwd - The gate's working directory, to resolve relative test_refs.
 */
export function findVacuousDoneFeatures(
  spec: Spec,
  passCounts: Map<string, number>,
  cwd: string,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features ?? []) {
    if (feature.status !== 'done') continue;
    // Union of this feature's declared test_ref FILES (anchors stripped, deduped).
    const refs: string[] = [];
    const seen = new Set<string>();
    for (const ac of feature.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        const file = refFilePath(ref);
        if (file && !seen.has(file)) {
          seen.add(file);
          refs.push(file);
        }
      }
    }
    if (refs.length === 0) continue; // declares no tests → not this guard's concern
    let allMatched = true;
    let anyPassing = false;
    for (const ref of refs) {
      const count = passCounts.get(resolve(cwd, ref));
      if (count === undefined) {
        allMatched = false; // a ref the json never mentioned → can't determine
        break;
      }
      if (count > 0) {
        anyPassing = true; // a real, executed, passing test → not vacuous
        break;
      }
    }
    if (anyPassing || !allMatched) continue;
    // Definitively vacuous: every declared test file was present and executed
    // zero passing tests. Name the feature by its business TITLE (soft-shell:
    // no F-id in a user-facing line); path = the first ref, repo-relative.
    const title = feature.title || feature.id;
    findings.push({
      detector: 'VACUOUS_TESTS',
      severity: 'warn',
      path: refs[0],
      message:
        `Done feature "${title}" declares tests, but none of its test files executed a passing test ` +
        '(all skipped / todo / empty) — its behavioral proof never actually ran',
    });
  }
  return findings;
}

/**
 * Top-level guard entry the unit stage calls: read the vitest json the dual
 * reporter wrote, parse per-file executed-pass counts, load the spec, and return
 * the vacuous-done findings. TOTAL & SAFE — any failure (missing/empty/
 * unparseable file, unreadable spec) degrades to `[]`, so the guard can only
 * ADD a red on a definitive vacuous case, never fail the gate on a mishap
 * (AC-1a0b1b26).
 *
 * @param jsonFilePath - Temp file the vitest json reporter wrote for this run.
 * @param cwd - The gate's working directory (spec root + test_ref base).
 */
export function vacuousDoneFindings(jsonFilePath: string, cwd: string): DriftFinding[] {
  try {
    const counts = parseExecutedPassCounts(readFileSync(jsonFilePath, 'utf8'));
    if (!counts) return [];
    return findVacuousDoneFeatures(loadSpec(cwd), counts, cwd);
  } catch {
    return [];
  }
}
