// Cladding · feature-cycle advisory (F-f4e184f7 enforcement + F-be5306eb cold-start)
//
// Non-blocking, cwd-derived advisories that tell the user the feature cycle isn't
// being driven. Two graduated cases:
//   1. COLD-START (F-be5306eb): the project has source code but zero feature specs
//      — code is running ahead of the spec; the cycle never started.
//   2. ENFORCEMENT (F-f4e184f7): features are in flight but no hook/CI enforce the
//      gate, so the checks run only when asked.
// Both are derived from cwd alone (never the gate outcome), so they can only
// inform — never change pass/fail.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {walk} from './scan/walker.js';
import {enforcingHookInstalled} from '../init/git-hook.js';
import {loadSpec} from '../spec/load.js';

/** True when a CI workflow directory exists (the authoritative, unbypassable gate). */
function ciWorkflowPresent(cwd: string): boolean {
  return existsSync(join(cwd, '.github', 'workflows'));
}

/** True when at least one source file exists (vendor dirs / dotfiles ignored, early exit). */
function hasSourceCode(cwd: string): boolean {
  try {
    return walk({root: cwd, maxFiles: 1}).length > 0;
  } catch {
    return false;
  }
}

// Statuses of a feature still moving through the cycle. This is the advisory's own
// "work in flight" notion (a UX cadence count), NOT the detectors' spec-first
// severity window (isSpecFirstWindow, F-c3747d7d) — kept separate on purpose.
const UNDONE_STATUSES: ReadonlySet<string> = new Set(['planned', 'in_progress']);

/**
 * Cold-start advisory (F-be5306eb): the project has source code but zero feature
 * specs, so the feature cycle never started — else `undefined`. Either suppressor
 * (a feature already exists, or no source code yet) silences it.
 */
export function coldStartAdvisory(cwd = '.'): string | undefined {
  try {
    if ((loadSpec(cwd).features ?? []).length > 0) return undefined; // cycle already started
  } catch {
    return undefined; // no / invalid spec → onboarding not done; not this check's place
  }
  if (!hasSourceCode(cwd)) return undefined; // clean greenfield — nothing to nag
  return (
    "This project has source code but no feature specs yet — the feature cycle hasn't started. " +
    "Author your first feature's spec (its acceptance criteria and the files it covers) so the code " +
    'is governed by the spec, not running ahead of it.'
  );
}

/**
 * Enforcement advisory (F-f4e184f7): undone features but no local hook and no CI
 * enforce the checks — else `undefined`. Any ONE of {enforcing hook, CI workflow,
 * zero undone features, unreadable spec} suppresses it.
 */
export function enforcementAdvisory(cwd = '.'): string | undefined {
  let undone: number;
  try {
    const spec = loadSpec(cwd);
    undone = (spec.features ?? []).filter((f) => UNDONE_STATUSES.has(f.status)).length;
  } catch {
    return undefined; // no / invalid spec → not this check's place to speak
  }
  if (undone === 0) return undefined;
  if (enforcingHookInstalled(cwd) || ciWorkflowPresent(cwd)) return undefined;
  return (
    `${undone} feature${undone === 1 ? '' : 's'} not yet done, and nothing enforces the checks ` +
    '(no pre-push hook, no CI) — the gate runs only when you ask. ' +
    'Wire it with `clad init --with-hook`, or add a CI workflow.'
  );
}

/**
 * Graduated feature-cycle advisory: the cold-start signal when the cycle is
 * un-started, otherwise the enforcement signal. One source for clad check to print.
 */
export function featureCycleAdvisory(cwd = '.'): string | undefined {
  return coldStartAdvisory(cwd) ?? enforcementAdvisory(cwd);
}
