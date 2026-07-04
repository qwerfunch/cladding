// Cladding · drift detector · HOST_CLAIM_DRIFT (F-5283985e)
//
// Host-support claims in the README must trace to dated machine evidence, not
// prose. The Cursor over-claim needed a manual honesty note once already (README
// "verification level" paragraph) — this detector makes the check structural.
//
// It compares TWO machine-readable fences:
//   1. README.md   — `<!-- clad:host-claims {"claude":"verified", ...} -->`
//                    (INTENT: the grade the project claims per host).
//   2. matrix.md   — `<!-- clad:matrix-grades {"claude":"not-run", ...} -->`
//                    (EVIDENCE: the newest committed smoke result per host,
//                    written by `clad doctor --hosts`).
//
// GENERIC / NO-OP BY DESIGN: the detector fires findings ONLY when BOTH fences
// exist. A project without the README claims fence, or without a generated
// docs/dogfood/matrix.md, gets NO findings (not even info) — so every downstream
// adopter that never opts into host-claim tracking stays a clean no-op. This is
// not spec-vs-code, so it does NOT route through withSpec.
//
// "EXCEEDS" (the warn trigger) — a README claim contradicts the matrix evidence
// when the claim asserts MORE than the evidence proves:
//   grade rank: fail/wiring-fail = 0  ·  wiring-ok/wiring-only = 1  ·  verified = 2
//   claim rank: wiring-only = 1  ·  verified = 2  ·  (not-run = no claim → skipped)
//   → warn iff claimRank > evidenceRank.
// `not-run` evidence is NEUTRAL: the matrix records ABSENCE (no live run yet),
// the README records INTENT. Absence contradicts nothing, so a `verified` claim
// against a `not-run` matrix does NOT warn — that is the honest initial state.
// A `fail` / `wiring-fail` in the matrix DOES contradict a positive claim, and a
// `verified` claim against `wiring-only`/`wiring-ok`-only evidence (the historic
// Cursor case) also warns. This is visible under `clad check --strict`.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'HOST_CLAIM_DRIFT';

const README_FENCE = /<!--\s*clad:host-claims\s*(\{[^}]*\})\s*-->/;
const MATRIX_FENCE = /<!--\s*clad:matrix-grades\s*(\{[^}]*\})\s*-->/;

/** Parse a JSON object fence into a host→grade map, or null on absence/parse error. */
function parseFence(text: string, re: RegExp): Record<string, string> | null {
  const m = text.match(re);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** Evidence strength of a matrix grade. `not-run` = null → NEUTRAL (no evidence). */
function evidenceRank(grade: string): number | null {
  switch (grade) {
    case 'fail':
    case 'wiring-fail':
      return 0;
    case 'wiring-ok':
    case 'wiring-only':
      return 1;
    case 'verified':
      return 2;
    default: // not-run, unknown → neutral
      return null;
  }
}

/** Assertion strength of a README claim. `not-run`/unknown = null → no claim. */
function claimRank(claim: string): number | null {
  switch (claim) {
    case 'wiring-only':
      return 1;
    case 'verified':
      return 2;
    default:
      return null;
  }
}

function detect(cwd: string): readonly DriftFinding[] {
  const readmePath = join(cwd, 'README.md');
  const matrixPath = join(cwd, 'docs', 'dogfood', 'matrix.md');
  // No-op unless BOTH surfaces are present (see docstring).
  if (!existsSync(readmePath) || !existsSync(matrixPath)) return [];

  const claims = parseFence(readFileSync(readmePath, 'utf8'), README_FENCE);
  const grades = parseFence(readFileSync(matrixPath, 'utf8'), MATRIX_FENCE);
  if (!claims || !grades) return [];

  const findings: DriftFinding[] = [];
  for (const [host, claim] of Object.entries(claims)) {
    const cRank = claimRank(claim);
    if (cRank === null) continue; // README makes no positive claim for this host
    const evidence = grades[host] ?? 'not-run';
    const eRank = evidenceRank(evidence);
    if (eRank === null) continue; // matrix records absence — neutral, no contradiction
    if (cRank > eRank) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        path: 'README.md',
        message:
          `README host-claims: '${host}' claims '${claim}' but the newest matrix evidence is ` +
          `'${evidence}' — the claim exceeds the evidence. Re-run \`clad doctor --hosts\` (with consent) ` +
          `or lower the README claim for '${host}'.`,
      });
    }
  }
  return findings;
}

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return detect(cwd);
}

export const hostClaimDrift: DriftDetector = {
  name: NAME,
  run,
};
