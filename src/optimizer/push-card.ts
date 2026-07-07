// Cladding · optimizer · PostToolUse push card — F-35954d19
//
// The push half of clad_get_working_set: after an owned edit, render a tiered,
// budgeted card that NAMES what breaks and which tests to run — the moment the
// regression list is actionable. Pure + deterministic + zero I/O: given a
// (code-free) WorkingSet + the edited path, it emits text. The hook owns the
// ledger/dedup/budget side effects; this file only formats.
//
// Line 1 shares its human-first wording with formatImpactCard (F-f46d5c61):
// "N features depend on this", "N tests guard it", and the dependency-map
// disclosure come from the shared helpers below, so the Tier-1 one-liner and the
// legacy impact card read identically. The one enrichment the working set adds
// that the data-poor impact slice cannot is the focus TITLE next to the id — the
// slice only carries owner ids for a module query, so its module-query fallback
// stays id-only while this one-liner shows "F-xxx <title>".

import type {WorkingSet} from './working-set.js';

const TOP_N = 3;
const MAX_LINES = 5;
const MAX_CHARS = 600;

// ─── Human-first consequence wording (F-f46d5c61) ───
// Shared by the Tier-1/Tier-2 push cards here and the legacy formatImpactCard in
// the hook, so the phrasing is identical everywhere a card names a change's blast
// radius. Plain English on purpose — this is the text the coding agent reads and
// renders back to the user in their own language.

/** One-liner segment "· N features depend on this" (or '' when nothing depends). */
export function dependSegment(n: number): string {
  return n > 0 ? ` · ${n} feature${n === 1 ? '' : 's'} depend${n === 1 ? 's' : ''} on this` : '';
}

/** One-liner segment "· N tests guard it" (or '' when there is no regression set). */
export function guardSegment(n: number): string {
  return n > 0 ? ` · ${n} test${n === 1 ? '' : 's'} guard${n === 1 ? 's' : ''} it` : '';
}

/** Blank-ledger disclosure — empty consequences mean "unknown", not "verified safe". */
export const UNLEDGERED_NOTE = ' · dependency map not yet recorded';

/**
 * The single-line impact card reconstructed from the working set — byte-compatible
 * with formatImpactCard for the hook's module-path queries (owner id, co-owner
 * suffix, breaks/run counts, deps-unledgered disclosure). Serves both the Tier-1
 * emit (no consequences) and the dedup degrade of a Tier-2. '' when no owner.
 */
export function formatPushOneLiner(ws: WorkingSet, relPath: string): string {
  const primary = ws.must_edit.id;
  if (!primary) return '';
  // Name the focus feature the way a person means it: id + title (F-f46d5c61). The
  // working set carries must_edit.title, so this reads "F-xxx <title>" not a bare id.
  const focus = ws.must_edit.title ? `${primary} ${ws.must_edit.title}` : primary;
  const owners = ws.must_edit.co_owners ?? [];
  const co = owners.length > 1 ? ` (+${owners.length - 1} co-owner${owners.length > 2 ? 's' : ''})` : '';
  const impacted = ws.breaks_if_changed.impacted;
  const tests = ws.breaks_if_changed.regression_tests;
  // Blank-ledger disclosure: empty consequences must not read as "verified safe" when NO
  // depends_on edge exists project-wide (mirrors formatImpactCard's `=== 0` check).
  const unledgered = ws.breaks_if_changed.ledger?.depends_on_edges === 0 ? UNLEDGERED_NOTE : '';
  return `cladding impact: ${relPath} → ${focus}${co}${dependSegment(impacted.length)}${guardSegment(tests.length)}${unledgered}`;
}

/**
 * The Tier-2 card: the one-liner plus up to three impacted feature ids+titles, up
 * to three regression test paths, and the high-risk AC count (+ first id). No code
 * excerpts, no guidance. Bounded to 5 lines / 600 chars (AC-816f10c3). Empty detail
 * lines are omitted, so a consequence-free working set degrades to just the one-liner.
 */
export function formatWorkingSetCard(ws: WorkingSet, relPath: string): string {
  const line1 = formatPushOneLiner(ws, relPath);
  if (!line1) return '';
  const lines = [line1];

  const impacted = ws.breaks_if_changed.impacted;
  if (impacted.length > 0) {
    const top = impacted.slice(0, TOP_N).map((f) => `${f.id} ${f.title}`.trim());
    const more = impacted.length > TOP_N ? ` (+${impacted.length - TOP_N} more)` : '';
    lines.push(`breaks: ${top.join(', ')}${more}`);
  }

  const tests = ws.breaks_if_changed.regression_tests;
  if (tests.length > 0) {
    const top = tests.slice(0, TOP_N);
    const more = tests.length > TOP_N ? ` (+${tests.length - TOP_N} more)` : '';
    lines.push(`run: ${top.join(', ')}${more}`);
  }

  const highRisk = ws.verify.high_risk_acs;
  if (highRisk.length > 0) {
    lines.push(`risk: ${highRisk.length} high-risk AC(s), first ${highRisk[0].id}`);
  }

  let card = lines.slice(0, MAX_LINES).join('\n');
  if (card.length > MAX_CHARS) card = `${card.slice(0, MAX_CHARS - 1)}…`;
  return card;
}
