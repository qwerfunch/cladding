// Cladding · oracle · risk-weighted requirement policy (v0.5.x, Lever 1)
//
// SINGLE SOURCE OF TRUTH for "does this done AC need a spec-conformance
// oracle?". Both the SPEC_CONFORMANCE detector (gate-time enforcement) and
// `clad oracle --required` (host-facing worklist) resolve the requirement
// THROUGH HERE, so the gate and the CLI can never disagree about which ACs
// the project's policy demands an oracle for.
//
// WHY a policy and not the old boolean: v8 (36-feature A/B) showed exhaustive
// per-AC oracles add ~0 final quality on a capable model while costing ~30% of
// the run — the oracle is governance INSURANCE, not a dev-speed lever. So the
// requirement is now RISK-WEIGHTED: always demand an oracle for the highest-
// risk EARS category (`unwanted` = error/edge handling, where failures
// cluster), plus a deterministic SAMPLE of the rest. A project pays the full
// premium (`require_oracles: true` ⇒ exhaustive) only when it needs to.
//
// Three requirement levels, resolved by precedence:
//   1. `project.oracle_policy` present → RISK-WEIGHTED (this object wins).
//   2. else `project.require_oracles === true` → EXHAUSTIVE (legacy, =sample 1.0).
//   3. else → NO MANDATE (the default; detector stays inert on legacy specs).

import {createHash} from 'node:crypto';

import type {AcceptanceCriterion, Project, Spec} from '../spec/types.js';

/** EARS category demanded by an empty `oracle_policy` (highest-risk: error/edge). */
export const DEFAULT_ALWAYS_EARS = ['unwanted'] as const;

/** A project's oracle requirement, normalised for the resolver. */
export interface ResolvedOraclePolicy {
  /** Any mandate at all? When false the detector enforces only INTEGRITY. */
  readonly mandateActive: boolean;
  /** Legacy `require_oracles: true` — every done AC is required. */
  readonly exhaustive: boolean;
  /** EARS categories whose done ACs ALWAYS require an oracle. */
  readonly alwaysEars: ReadonlySet<string>;
  /** Deterministic fraction [0,1] of the remaining (non-always) ACs required. */
  readonly sample: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? 1 : n;
}

/**
 * Normalises `project.oracle_policy` / `project.require_oracles` into a single
 * resolved policy. `oracle_policy` takes precedence over the legacy boolean;
 * an empty `oracle_policy: {}` means "oracle the `unwanted` ACs, sample 0 of
 * the rest" — the minimal risk-weighted default.
 */
export function resolveOraclePolicy(project: Project): ResolvedOraclePolicy {
  if (project.oracle_policy) {
    const p = project.oracle_policy;
    return {
      mandateActive: true,
      exhaustive: false,
      alwaysEars: new Set(p.always_ears ?? DEFAULT_ALWAYS_EARS),
      sample: clamp01(p.sample ?? 0),
    };
  }
  if (project.require_oracles === true) {
    return {mandateActive: true, exhaustive: true, alwaysEars: new Set(), sample: 1};
  }
  return {mandateActive: false, exhaustive: false, alwaysEars: new Set(), sample: 0};
}

/**
 * Deterministic per-AC sampling: stable across runs (no `Math.random`, which
 * would make the gate non-reproducible) and stable across spec edits to OTHER
 * ACs (keyed only on this AC's identity). Returns true for `~sample` of keys.
 */
export function sampleHit(key: string, sample: number): boolean {
  if (sample <= 0) return false;
  if (sample >= 1) return true;
  const h = parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16);
  return h % 10000 < Math.round(sample * 10000);
}

/**
 * Does this `done` AC require a spec-conformance oracle under the policy?
 * `always_ears` membership OR a deterministic sample hit. Keyed on
 * `featureId.acId` so each AC's draw is independent and reproducible.
 */
export function oracleRequired(policy: ResolvedOraclePolicy, featureId: string, ac: AcceptanceCriterion): boolean {
  if (!policy.mandateActive) return false;
  if (policy.exhaustive) return true;
  if (ac.ears && policy.alwaysEars.has(ac.ears)) return true;
  return sampleHit(`${featureId}.${ac.id}`, policy.sample);
}

/** Why an AC is on the worklist — for the `clad oracle --required` printout. */
export type OracleRequirementReason = 'exhaustive' | 'always' | 'sample';

/** One policy-required done AC and whether it already carries an oracle. */
export interface OracleWorklistRow {
  readonly featureId: string;
  readonly acId: string;
  readonly reason: OracleRequirementReason;
  readonly ears?: string;
  readonly hasOracle: boolean;
}

/**
 * The host worklist: every `done` AC the policy REQUIRES an oracle for, with
 * the reason and whether it is already satisfied. Pure (no I/O) so the gate,
 * the CLI, and tests share one derivation. Empty when no mandate is active.
 */
export function requiredOracleWorklist(spec: Spec): OracleWorklistRow[] {
  const policy = resolveOraclePolicy(spec.project);
  const rows: OracleWorklistRow[] = [];
  if (!policy.mandateActive) return rows;
  for (const feature of spec.features) {
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      if (!oracleRequired(policy, feature.id, ac)) continue;
      const reason: OracleRequirementReason = policy.exhaustive
        ? 'exhaustive'
        : ac.ears && policy.alwaysEars.has(ac.ears)
          ? 'always'
          : 'sample';
      rows.push({
        featureId: feature.id,
        acId: ac.id,
        reason,
        ears: ac.ears,
        hasOracle: (ac.oracle_refs ?? []).length > 0,
      });
    }
  }
  return rows;
}
