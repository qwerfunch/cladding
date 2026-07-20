// Cladding · enforcement advisory (F-f4e184f7)
//
// A project can run for months with authored-but-undone features while every
// commit stays green: the pre-commit tier is not --strict, and if no hook and no
// CI are wired, the gate runs only when someone types `clad check`. Nothing tells
// the user the feature cycle isn't being enforced. This computes a single
// non-blocking advisory for `clad check` to print — derived from cwd alone, never
// from the gate outcome, so it can only inform, never change pass/fail.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {enforcingHookInstalled} from '../init/git-hook.js';
import {loadSpec} from '../spec/load.js';

/** True when a CI workflow directory exists (the authoritative, unbypassable gate). */
function ciWorkflowPresent(cwd: string): boolean {
  return existsSync(join(cwd, '.github', 'workflows'));
}

// Statuses of a feature still moving through the cycle. This is the advisory's own
// "work in flight" notion (a UX cadence count), NOT the detectors' spec-first
// severity window (isSpecFirstWindow, F-c3747d7d) — kept separate on purpose.
const UNDONE_STATUSES: ReadonlySet<string> = new Set(['planned', 'in_progress']);

/**
 * A one-line advisory when the feature cycle has undone features but no local hook
 * and no CI enforce the checks — else `undefined`. Any ONE of {enforcing hook, CI
 * workflow, zero undone features, unreadable spec} suppresses it.
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
