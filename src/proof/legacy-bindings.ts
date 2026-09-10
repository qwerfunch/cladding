// Cladding · Spec 0.2 F5 · node-level legacy test-binding fallback.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {isAbsolute} from 'node:path';

import {
  legacyExemptionMatches,
  reviewedCarryForwardMatches,
  type MigrationBaseline,
  type ReviewedTestBindingBaseline,
} from '../spec/compiler/migration-baseline.js';
import type {TestBinding} from './types.js';
import {ProofPathSafetyError, safeProofWorkspacePath} from './fs-safety.js';

/** A retained baseline reference never conflated with an observed live binding. */
export interface LegacyTestBinding {
  readonly criterion: string;
  readonly raw: string;
  readonly file: string;
  readonly selector?: string;
  /** Historic safety always hashes the complete referenced test file. */
  readonly sha256?: string;
  readonly state: 'available' | 'stale' | 'unsafe';
  readonly provenance: 'legacy_test_ref';
}

/** A review-selected historic input, distinct from live proof or a receipt. */
export interface ReviewedTestBinding {
  readonly criterion: string;
  readonly raw: string;
  readonly file: string;
  readonly selector?: string;
  /** The review-bound whole-file SHA-256, not a current receipt identity. */
  readonly sha256: string;
  readonly state: 'available' | 'stale' | 'unsafe';
  readonly provenance: 'reviewed_carry_forward';
}

/** The explicit winner for one criterion's test baseline. */
export interface CriterionBindingSelection {
  readonly criterion: string;
  readonly source: 'live' | 'reviewed' | 'legacy' | 'none';
  readonly live: readonly TestBinding[];
  readonly reviewed: readonly ReviewedTestBinding[];
  readonly legacy: readonly LegacyTestBinding[];
}

/**
 * Uses legacy baseline refs only for an unchanged exempt criterion. Any live
 * covers binding replaces the entire legacy source instead of unioning it.
 */
export function selectCriterionTestBindings(input: {
  readonly cwd: string;
  readonly baseline?: MigrationBaseline;
  readonly criterion: string;
  readonly currentCriterion?: object;
  readonly live: readonly TestBinding[];
}): CriterionBindingSelection {
  const live = input.live.filter((binding) => binding.criterion === input.criterion);
  if (live.length > 0) return {criterion: input.criterion, source: 'live', live: [...live], reviewed: [], legacy: []};
  const review = input.baseline?.reviewedCarryForwards?.find((entry) => entry.criterion === `criterion:${input.criterion}`);
  if (review && reviewedCarryForwardMatches(input.baseline, input.criterion, input.currentCriterion)) {
    const reviewed = review.bindings.map((binding) => resolveReviewedTestBinding(input.cwd, input.criterion, binding));
    return {criterion: input.criterion, source: 'reviewed', live: [], reviewed, legacy: []};
  }
  if (input.baseline?.schema !== 1 || input.baseline.sourceSchema !== '0.1') {
    return {criterion: input.criterion, source: 'none', live: [], reviewed: [], legacy: []};
  }
  if (!legacyExemptionMatches(input.baseline, `criterion:${input.criterion}`, input.currentCriterion)) {
    return {criterion: input.criterion, source: 'none', live: [], reviewed: [], legacy: []};
  }
  const baseline = input.baseline?.criteria.find((entry) => entry.address === `criterion:${input.criterion}`);
  if (!baseline) return {criterion: input.criterion, source: 'none', live: [], reviewed: [], legacy: []};
  const legacy = baseline.bindings
    .filter((binding) => binding.channel === 'test')
    .map((binding) => resolveLegacyTestBinding(input.cwd, input.criterion, binding.raw, binding.selector));
  return {criterion: input.criterion, source: legacy.length > 0 ? 'legacy' : 'none', live: [], reviewed: [], legacy};
}

/** Resolves a reviewed historic input and fails closed when its file bytes moved. */
export function resolveReviewedTestBinding(
  cwd: string,
  criterion: string,
  binding: ReviewedTestBindingBaseline,
): ReviewedTestBinding {
  const resolved = resolveLegacyTestBinding(cwd, criterion, binding.raw, binding.selector);
  const state = resolved.state === 'available'
    && resolved.file === binding.file
    && resolved.selector === binding.selector
    && resolved.sha256 === binding.sha256
    ? 'available'
    : resolved.state === 'unsafe' ? 'unsafe' : 'stale';
  return {
    criterion,
    raw: binding.raw,
    file: binding.file,
    ...(binding.selector === undefined ? {} : {selector: binding.selector}),
    sha256: binding.sha256,
    state,
    provenance: 'reviewed_carry_forward',
  };
}

/** Resolves one immutable historic ref without silently repairing a stale path. */
export function resolveLegacyTestBinding(cwd: string, criterion: string, raw: string, selector?: string): LegacyTestBinding {
  const [rawPath, fragment] = raw.split('#', 2);
  const effectiveSelector = selector ?? fragment;
  const file = normalizePath(rawPath);
  if (!file || isAbsolute(rawPath)) {
    return {criterion, raw, file, ...(effectiveSelector ? {selector: effectiveSelector} : {}), state: 'stale', provenance: 'legacy_test_ref'};
  }
  let absolute: string;
  try { absolute = safeProofWorkspacePath(cwd, file); } catch (error) {
    if (error instanceof ProofPathSafetyError) {
      return {criterion, raw, file, ...(effectiveSelector ? {selector: effectiveSelector} : {}), state: 'unsafe', provenance: 'legacy_test_ref'};
    }
    throw error;
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return {criterion, raw, file, ...(effectiveSelector ? {selector: effectiveSelector} : {}), state: 'stale', provenance: 'legacy_test_ref'};
  }
  return {
    criterion, raw, file, ...(effectiveSelector ? {selector: effectiveSelector} : {}),
    sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
    state: 'available', provenance: 'legacy_test_ref',
  };
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}
