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
//   3. matrix.md metadata — generated timestamp + Cladding version. Evidence
//                    older than 30 days or recorded by an older engine is
//                    informational: visible debt, never a Phase-0 gate change.
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

import {getCurrentCladdingVersion} from '../../init/host-setup.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'HOST_CLAIM_DRIFT';

const README_FENCE = /<!--\s*clad:host-claims\s*(\{[^}]*\})\s*-->/;
const MATRIX_FENCE = /<!--\s*clad:matrix-grades\s*(\{[^}]*\})\s*-->/;
const MATRIX_VERSION = /^- Cladding version:\s*`([^`]+)`\s*$/m;
const MATRIX_GENERATED = /^- Generated:\s*(\S+)\s*$/m;
const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

function numericVersion(version: string): readonly [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]|$)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function olderVersion(recorded: string, current: string): boolean {
  const left = numericVersion(recorded);
  const right = numericVersion(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

function freshnessReasons(matrix: string, now: number): string[] {
  const reasons: string[] = [];
  const generatedAt = matrix.match(MATRIX_GENERATED)?.[1];
  const generatedTime = generatedAt === undefined ? Number.NaN : Date.parse(generatedAt);
  if (Number.isFinite(generatedTime) && now - generatedTime > MAX_EVIDENCE_AGE_MS) {
    reasons.push(`generated ${generatedAt}, more than 30 days ago`);
  }
  const recordedVersion = matrix.match(MATRIX_VERSION)?.[1];
  const currentVersion = getCurrentCladdingVersion();
  if (recordedVersion !== undefined && currentVersion !== null && olderVersion(recordedVersion, currentVersion)) {
    reasons.push(`generated by cladding v${recordedVersion}, before the current v${currentVersion}`);
  }
  return reasons;
}

function detect(cwd: string): readonly DriftFinding[] {
  const readmePath = join(cwd, 'README.md');
  const matrixPath = join(cwd, 'docs', 'dogfood', 'matrix.md');
  // No-op unless BOTH surfaces are present (see docstring).
  if (!existsSync(readmePath) || !existsSync(matrixPath)) return [];

  const readme = readFileSync(readmePath, 'utf8');
  const matrix = readFileSync(matrixPath, 'utf8');
  const claims = parseFence(readme, README_FENCE);
  const grades = parseFence(matrix, MATRIX_FENCE);
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
  const hasPositiveClaim = Object.values(claims).some((claim) => claimRank(claim) !== null);
  const stale = hasPositiveClaim ? freshnessReasons(matrix, Date.now()) : [];
  if (stale.length > 0) {
    findings.push({
      detector: NAME,
      severity: 'info',
      path: 'docs/dogfood/matrix.md',
      message:
        `Host support evidence needs a fresh receipt: ${stale.join('; ')}. ` +
        'Re-run `clad doctor --hosts` with consent; existing contradictory-claim warnings are unchanged.',
    });
  }
  return findings;
}

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return detect(cwd);
}

/**
 * Checks host-support claims against recorded grades and evidence freshness.
 *
 * @returns The stable detector registration consumed by the Drift stage.
 * @see spec/features/host-smoke-matrix-5283985e.yaml AC-922cd29d
 * @see spec/features/hook-health-observability-96fa5622.yaml AC-19d3a3d0
 * @since 0.9.4
 */
export const hostClaimDrift: DriftDetector = {
  name: NAME,
  run,
};
