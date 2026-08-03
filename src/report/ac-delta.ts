// Cladding · report · how the contract itself moved across a range (F-5dfbac9c)
//
// Every drift detector compares code against the spec as it stands NOW. That
// makes one class of change structurally invisible: rewrite an acceptance
// criterion to match what you built, and code and spec agree, so nothing fires.
// The reversal is real, it is in git, and no reviewer will find it by hand —
// it takes a per-criterion diff of two revisions of the same spec entry.
//
// This module is that diff. Given each touched entry at both ends of the range
// it classifies every criterion as new / rewritten / removed / unchanged, and
// reports the entry's status transition alongside — because a criterion
// rewritten in the same motion that marks the feature done is the case that
// most deserves a second look.
//
// Pure: no I/O, no git, no clock. The CLI gathers the two revisions; this
// decides what changed. Rows sort by criterion id so the packet serializes
// byte-identically for a fixed repository state (AC-4faef94d).
//
// Layer: `report` is foundation-tier (spec/architecture.yaml) — it must never
// import stages/drive/cli/serve.

import type {SpecEntryRevision} from '../changelog/collect.js';
import type {AcceptanceCriterion} from '../spec/types.js';

/** How one acceptance criterion moved across the range. */
export type AcChangeKind = 'new' | 'rewritten' | 'removed' | 'unchanged';

/** One criterion's verdict, plus the EARS pattern shift when it changed. */
export interface AcDeltaRow {
  readonly id: string;
  readonly kind: AcChangeKind;
  /** EARS pattern at HEAD (at the ref, for a removed criterion). */
  readonly ears?: string;
  /** Set only when the EARS pattern itself changed — e.g. `state → unwanted`. */
  readonly earsShift?: string;
}

/** Every criterion of one spec entry, with the entry's status transition. */
export interface SpecEntryDelta {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly statusBefore: string | null;
  readonly statusAfter: string | null;
  readonly rows: readonly AcDeltaRow[];
  readonly counts: Readonly<Record<AcChangeKind, number>>;
}

/**
 * Collapses runs of whitespace and trims, so reflowing a criterion across
 * lines — or fixing a stray double space — never reads as a rewrite. This is
 * the "whitespace-only differences are ignored" half of AC-c32cbab2.
 */
function norm(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Field separator for the comparison key — a character that cannot occur inside
 * any authored field, so a statement ending where the next field begins can never
 * make two different contracts read alike. Written as an escape: a raw control
 * byte in source would make git treat the file as binary.
 */
const FIELD_SEPARATOR = '\u0000';

/**
 * The comparison key for a criterion: every field that states the obligation —
 * the pre-rendered statement, the EARS pattern, and the structured trigger /
 * action / outcome.
 *
 * `action` and `response` are not decoration. The impl-blind oracle renders
 * `action` as "system shall:" (src/oracle/payload.ts), and AC_DRIFT accepts a
 * criterion carrying only these fields as fully specified — so a criterion may
 * have no `text` at all and still state a complete requirement. Comparing only
 * text/ears/condition made this section blind to a rewrite of the obligation
 * itself, which is precisely the change it exists to surface.
 *
 * `notes` stays EXCLUDED — it is the free-prose field authors actually use, and
 * treating an expanded rationale as a contract rewrite would make the signal
 * fire on the one habit worth encouraging.
 */
function contractKey(ac: AcceptanceCriterion): string {
  return [
    norm(ac.text),
    norm(ac.ears),
    norm(ac.condition),
    norm(ac.action),
    norm(ac.response),
  ].join(FIELD_SEPARATOR);
}

function byId(acs: readonly AcceptanceCriterion[]): Map<string, AcceptanceCriterion> {
  const map = new Map<string, AcceptanceCriterion>();
  for (const ac of acs) if (ac.id && !map.has(ac.id)) map.set(ac.id, ac);
  return map;
}

/**
 * Classifies one spec entry's criteria across the range.
 *
 * The join key is the criterion id, which survives a rewrite: on the live
 * reversal that motivated this feature the text flipped polarity
 * (`shall run kill-server` → `shall never issue kill-server`) and the EARS
 * pattern went `state → unwanted` while the id held. That is exactly the case
 * a text-similarity join would miss and an id join catches.
 */
function deltaOf(entry: SpecEntryRevision): SpecEntryDelta {
  const base = byId(entry.baseAcs);
  const head = byId(entry.headAcs);
  const rows: AcDeltaRow[] = [];

  for (const [id, ac] of head) {
    const was = base.get(id);
    if (!was) {
      rows.push({id, kind: 'new', ...(ac.ears ? {ears: ac.ears} : {})});
      continue;
    }
    if (contractKey(ac) === contractKey(was)) {
      rows.push({id, kind: 'unchanged', ...(ac.ears ? {ears: ac.ears} : {})});
      continue;
    }
    const shifted = norm(ac.ears) !== norm(was.ears);
    rows.push({
      id,
      kind: 'rewritten',
      ...(ac.ears ? {ears: ac.ears} : {}),
      ...(shifted ? {earsShift: `${was.ears ?? '(none)'} → ${ac.ears ?? '(none)'}`} : {}),
    });
  }

  for (const [id, ac] of base) {
    if (!head.has(id)) rows.push({id, kind: 'removed', ...(ac.ears ? {ears: ac.ears} : {})});
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));

  const counts: Record<AcChangeKind, number> = {new: 0, rewritten: 0, removed: 0, unchanged: 0};
  for (const r of rows) counts[r.kind] += 1;

  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    statusBefore: entry.statusBefore,
    statusAfter: entry.statusAfter,
    rows,
    counts,
  };
}

/**
 * Builds the per-entry criterion deltas for a range, sorted by feature id.
 * Entries whose criteria are ALL unchanged are kept: a reviewer reading
 * "8 unchanged" learns something different from an entry that is simply absent.
 */
export function buildSpecEntryDeltas(
  entries: readonly SpecEntryRevision[],
): readonly SpecEntryDelta[] {
  return entries.map(deltaOf).sort((a, b) => a.id.localeCompare(b.id));
}
