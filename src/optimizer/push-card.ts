// Cladding · optimizer · PostToolUse push card — F-35954d19
//
// The push half of clad_get_working_set: after an owned edit, render a tiered,
// budgeted card that NAMES what breaks and which tests to run — the moment the
// regression list is actionable. Pure + deterministic + zero I/O: given a
// (code-free) WorkingSet + the edited path, it emits text. The hook owns the
// ledger/dedup/budget side effects; this file only formats.
//
// Line 1 is byte-compatible with formatImpactCard's MODULE-query wording (the
// hook always queries a file path, so the focus is a module owner — id only, no
// title). That parity is load-bearing: AC-f912fd40 requires the Tier-1 one-liner
// (zero consequences) to be byte-identical to today's shipped card.

import type {WorkingSet} from './working-set.js';

const TOP_N = 3;
const MAX_LINES = 5;
const MAX_CHARS = 600;

/**
 * The single-line impact card reconstructed from the working set — byte-compatible
 * with formatImpactCard for the hook's module-path queries (owner id, co-owner
 * suffix, breaks/run counts, deps-unledgered disclosure). Serves both the Tier-1
 * emit (no consequences) and the dedup degrade of a Tier-2. '' when no owner.
 */
export function formatPushOneLiner(ws: WorkingSet, relPath: string): string {
  const primary = ws.must_edit.id;
  if (!primary) return '';
  const owners = ws.must_edit.co_owners ?? [];
  const co = owners.length > 1 ? ` (+${owners.length - 1} co-owner${owners.length > 2 ? 's' : ''})` : '';
  const impacted = ws.breaks_if_changed.impacted;
  const tests = ws.breaks_if_changed.regression_tests;
  const breaks = impacted.length > 0 ? ` · breaks ${impacted.length} feature(s)` : '';
  const run = tests.length > 0 ? ` · run ${tests.length} test(s)` : '';
  // Blank-ledger disclosure: empty breaks/run must not read as "verified safe" when NO
  // depends_on edge exists project-wide (mirrors formatImpactCard's `=== 0` check).
  const unledgered = ws.breaks_if_changed.ledger?.depends_on_edges === 0 ? ' · deps unledgered' : '';
  return `cladding impact: ${relPath} → ${primary}${co}${breaks}${run}${unledgered}`;
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
