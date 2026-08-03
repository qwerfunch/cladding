// Cladding · report · deterministic PR review packet (F-f6cc5e5a)
//
// A reviewer, team-lead, or auditor opening a pull request wants ONE artifact
// that answers "what moved, who owns it, what must I re-run, and was it
// verified?" — without walking the spec tree. This module renders that packet
// from data the CLI composes: the changelog collector's spec-shard movement,
// each changed source file resolved to its owning feature(s) via the reverse
// index, the deduped regression set (union of test_refs across the impact
// slices), and the gate + attestation state.
//
// It RENDERS; it gates nothing. The gate stays in `clad check`.
//
// DETERMINISM (AC-cbf1c202): every collection is sorted, and the body carries
// NO wall-clock — the meta range + HEAD sha are the only variable inputs and
// they are stable for a fixed repository state, so two runs serialize
// byte-identically. That is the property that makes the packet auditable.
//
// HONEST UNDER-REPORTING (AC-7672ce5d): a changed source file that maps to no
// feature's `modules` is listed under Unowned changes, never silently dropped —
// the same contract as the changelog's unsharded commits.
//
// BLANK-LEDGER DISCLOSURE (AC-41572299): when the project declares zero
// depends_on edges, an empty blast radius means UNKNOWN, not safe — the
// regression section carries the disclosure rather than an implicit nothing.
//
// Layer: `report` is foundation-tier (spec/architecture.yaml) — pure, no git,
// no stage runners. The CLI verb (src/cli/report.ts) is the thin impure wrapper
// that gathers git/spec/detector state and feeds this renderer.

import type {ChangelogManifest, SpecEntryRevision} from '../changelog/collect.js';
import {testRefPath} from '../spec/reverse-index.js';

import {buildSpecEntryDeltas, type SpecEntryDelta} from './ac-delta.js';

/** A feature that owns a changed file — id + title, plus slug for shard lookup. */
export interface OwningFeature {
  readonly id: string;
  readonly title: string;
  readonly slug?: string;
}

/** One changed source file, resolved (or not) to the features that own it. */
export interface CodeChangeInput {
  readonly path: string;
  /** Owning features (via the reverse index's moduleOwners). Empty ⇒ unowned. */
  readonly owners: readonly OwningFeature[];
  /** The blast-radius regression set contributed by this file's impact slice. */
  readonly testRefs: readonly string[];
}

/** Gate + attestation snapshot the CLI reads (attestation.yaml + events.log). */
export interface GateStateInput {
  /** Count of done features attested to their module tree-hash; null ⇒ no attestation file. */
  readonly attestedCount: number | null;
  /** The last recorded gate_run payload; null ⇒ none in this working tree's ledger. */
  readonly lastGateRun: {
    readonly tier?: string;
    readonly strict?: boolean;
    readonly worst?: number;
    readonly anyFailed?: boolean;
  } | null;
}

/** Whether an acceptance criterion's declared test moved with the code. */
export type TestRefState = 'co-changed' | 'unchanged' | 'placeholder';

/** One declared test reference of one criterion, and how it fared in the range. */
export interface TestRefRow {
  readonly featureId: string;
  readonly acId: string;
  /** The reference as authored (anchor included) — what the reviewer must find. */
  readonly ref: string;
  readonly state: TestRefState;
}

/** Everything the pure model needs — the CLI composes it impurely. */
export interface ReportInputs {
  readonly specChanges: ChangelogManifest;
  readonly codeChanges: readonly CodeChangeInput[];
  /** True when the project declares zero depends_on edges (blank ledger). */
  readonly ledgerEmpty: boolean;
  readonly gate: GateStateInput;
  /** Every feature spec entry the range touched, at both revisions. */
  readonly specEntries?: readonly SpecEntryRevision[];
  /** Every path that changed in the range — the co-change oracle. */
  readonly changedPaths?: readonly string[];
}

/** The deterministic, fully-sorted review-packet model. */
export interface ReportModel {
  readonly specChanges: ChangelogManifest;
  /** Changed files WITH at least one owner, sorted by path. */
  readonly codeChanges: readonly CodeChangeInput[];
  /** Changed files with no owner, sorted by path (paths only). */
  readonly unowned: readonly string[];
  /** Deduped, sorted union of test_refs across every impact slice. */
  readonly regressionSet: readonly string[];
  readonly ledgerEmpty: boolean;
  readonly gate: GateStateInput;
  /** Per-entry acceptance-criterion movement, sorted by feature id. */
  readonly specEntryDeltas: readonly SpecEntryDelta[];
  /** Declared tests of the touched entries, with their co-change state. */
  readonly testRefRows: readonly TestRefRow[];
}

/** Stable identifiers stamped into the header — the range + HEAD for a fixed state. */
export interface ReportMeta {
  readonly sinceRef: string;
  /** Full HEAD sha (from `git rev-parse HEAD`); deterministic for a fixed state. */
  readonly head: string;
  /**
   * The commit the packet actually compared against — the merge base of
   * `sinceRef` and HEAD, or `sinceRef` itself when no merge base resolves.
   *
   * It is stamped because it can DIFFER from what the reader asked for: on a
   * branch that forked earlier, the named tag can sit several commits off the
   * fork point. An audit artifact that does not name the revision it audited
   * against cannot be reproduced by hand.
   */
  readonly baseSha?: string;
}

/** Human-readable label for a changelog change kind. */
const CHANGE_LABEL: Readonly<Record<string, string>> = {
  'added-as-done': 'added (done)',
  'flipped-to-done': 'marked done',
  'modified-while-done': 'modified',
  archived: 'archived',
};

/** The blank-ledger disclosure — an empty blast radius means unknown, not safe. */
const UNKNOWN_NOT_SAFE =
  'Note: the dependency ledger is empty (0 depends_on edges declared). An empty ' +
  'blast radius here means UNKNOWN, not safe — treat the regression set as a floor, ' +
  'not a ceiling: fall back to grep/imports and run the full suite.';

/** Sort owners by id and dedupe (a file may list the same owner once). */
function normalizeOwners(owners: readonly OwningFeature[]): readonly OwningFeature[] {
  const byId = new Map<string, OwningFeature>();
  for (const o of owners) if (!byId.has(o.id)) byId.set(o.id, o);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Folds the CLI-gathered inputs into the deterministic model: partitions
 * changed files into owned / unowned, sorts everything, and computes the
 * deduped regression set. Pure — no I/O, no clock.
 */
/**
 * Resolves each declared test reference of the touched entries to one of three
 * states.
 *
 * The third state is load-bearing. `clad sync` writes `derived:<path>` refs into
 * spec entries as unconfirmed suggestions; rendering one as "declared but did
 * not change" would present a harness guess as a reviewed fact. The shared
 * normalizer (src/spec/reverse-index.ts) is what tells the two apart — the same
 * rule the citation index uses, so the packet and the index can never disagree.
 */
function buildTestRefRows(
  entries: readonly SpecEntryRevision[],
  changed: ReadonlySet<string>,
): readonly TestRefRow[] {
  const rows: TestRefRow[] = [];
  for (const entry of entries) {
    for (const ac of entry.headAcs) {
      for (const ref of ac.test_refs ?? []) {
        const path = testRefPath(ref);
        const state: TestRefState =
          path === null ? 'placeholder' : changed.has(path) ? 'co-changed' : 'unchanged';
        rows.push({featureId: entry.id, acId: ac.id, ref, state});
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.featureId.localeCompare(b.featureId) ||
      a.acId.localeCompare(b.acId) ||
      a.ref.localeCompare(b.ref),
  );
}

export function buildReportModel(inputs: ReportInputs): ReportModel {
  const withOwners = inputs.codeChanges.map((c) => ({...c, owners: normalizeOwners(c.owners)}));

  const codeChanges = withOwners
    .filter((c) => c.owners.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));

  const unowned = withOwners
    .filter((c) => c.owners.length === 0)
    .map((c) => c.path)
    .sort((a, b) => a.localeCompare(b));

  const regressionSet = [
    ...new Set(inputs.codeChanges.flatMap((c) => c.testRefs)),
  ].sort((a, b) => a.localeCompare(b));

  const specEntries = inputs.specEntries ?? [];
  const changed = new Set(inputs.changedPaths ?? []);

  return {
    specChanges: inputs.specChanges,
    codeChanges,
    unowned,
    regressionSet,
    ledgerEmpty: inputs.ledgerEmpty,
    gate: inputs.gate,
    specEntryDeltas: buildSpecEntryDeltas(specEntries),
    testRefRows: buildTestRefRows(specEntries, changed),
  };
}

/** Renders the "## Spec changes" section from the changelog manifest. */
function renderSpecChanges(manifest: ChangelogManifest): string {
  const features = manifest.groups
    .flatMap((g) => g.features)
    .sort((a, b) => a.id.localeCompare(b.id));
  const lines: string[] = ['## Spec changes'];
  if (features.length === 0 && manifest.unsharded_commits.length === 0) {
    lines.push('', '_No spec shards moved in this range._');
    return lines.join('\n');
  }
  if (features.length > 0) {
    lines.push('');
    for (const f of features) {
      const kind = CHANGE_LABEL[f.change] ?? f.change;
      lines.push(`- "${f.title}" — ${kind} (${f.id})`);
    }
  }
  if (manifest.unsharded_commits.length > 0) {
    lines.push('', '### Commits outside the spec');
    for (const c of manifest.unsharded_commits) {
      lines.push(`- ${c.hash} ${c.subject}`);
    }
  }
  return lines.join('\n');
}

/** Renders one owner as `"Title" (F-id)`. */
function ownerLabel(o: OwningFeature): string {
  return `"${o.title}" (${o.id})`;
}

/** Renders the "## Code changes → owning features" section (+ Unowned subsection). */
function renderCodeChanges(model: ReportModel): string {
  const lines: string[] = ['## Code changes → owning features'];
  if (model.codeChanges.length === 0) {
    lines.push('', '_No owned source files changed in this range._');
  } else {
    lines.push('');
    for (const c of model.codeChanges) {
      lines.push(`- ${c.path} → ${c.owners.map(ownerLabel).join(', ')}`);
    }
  }
  if (model.unowned.length > 0) {
    lines.push('', '### Unowned changes', '');
    lines.push('_Changed source files no feature declares in its `modules` — surfaced, never dropped._', '');
    for (const p of model.unowned) lines.push(`- ${p}`);
  }
  return lines.join('\n');
}

/** Renders the "## Regression set" section (the blast-radius output). */
function renderRegressionSet(model: ReportModel): string {
  const lines: string[] = ['## Regression set'];
  lines.push('', '_Deduped union of test_refs across the impact slices of the changed modules._', '');
  if (model.regressionSet.length === 0) {
    lines.push('_No test_refs resolved for the changed modules._');
  } else {
    for (const t of model.regressionSet) lines.push(`- ${t}`);
  }
  if (model.ledgerEmpty) {
    lines.push('', UNKNOWN_NOT_SAFE);
  }
  return lines.join('\n');
}

/** `planned → done`, or a bare status when the entry only existed at one end. */
function statusTransition(d: SpecEntryDelta): string {
  if (d.statusBefore === null) return `added as ${d.statusAfter ?? 'unknown'}`;
  if (d.statusAfter === null) return `was ${d.statusBefore}, now deleted`;
  return d.statusBefore === d.statusAfter
    ? d.statusAfter
    : `${d.statusBefore} → ${d.statusAfter}`;
}

/**
 * Renders the "## How the acceptance criteria moved" section — the answer to
 * "did the requirement change, or did the code?" that no drift detector can
 * give, because detectors only ever see the spec as it stands now.
 */
function renderSpecEntryDeltas(model: ReportModel): string {
  const lines: string[] = ['## How the acceptance criteria moved'];
  if (model.specEntryDeltas.length === 0) {
    lines.push('', '_No feature spec entry changed in this range._');
    return lines.join('\n');
  }
  lines.push(
    '',
    '_Each criterion compared against its own earlier revision, matched by id. A rewrite is invisible to every drift check if the code was changed to match it._',
  );
  for (const d of model.specEntryDeltas) {
    const c = d.counts;
    lines.push('', `### "${d.title}" (${d.id}) — ${statusTransition(d)}`, '');
    lines.push(
      `- new ${c.new} · rewritten ${c.rewritten} · removed ${c.removed} · unchanged ${c.unchanged}`,
    );
    for (const r of d.rows) {
      if (r.kind === 'unchanged') continue;
      const shift = r.earsShift ? ` — pattern ${r.earsShift}` : '';
      lines.push(`- ${r.kind.toUpperCase()} ${r.id}${shift}`);
    }
  }
  return lines.join('\n');
}

/**
 * Renders the "## Declared tests" section: for every criterion of a touched
 * entry, whether the test it names also moved in this range.
 *
 * It grades nothing. Whether a test genuinely verifies its criterion is not
 * mechanically decidable — three separate rules were measured against real
 * corpora and each misfired on legitimate code — so the packet shows what was
 * declared and leaves the judgement with the reviewer.
 */
function renderTestRefs(model: ReportModel): string {
  const lines: string[] = ['## Declared tests'];
  if (model.testRefRows.length === 0) {
    lines.push('', '_No touched entry declares a test._');
    return lines.join('\n');
  }
  lines.push(
    '',
    '_`changed` = the named file also moved in this range. `unchanged` = declared, untouched. `no file` = a placeholder the harness suggested, not a test that exists._',
    '',
  );
  let current = '';
  for (const row of model.testRefRows) {
    if (row.featureId !== current) {
      current = row.featureId;
      lines.push(`- ${row.featureId}`);
    }
    const label =
      row.state === 'co-changed' ? 'changed' : row.state === 'unchanged' ? 'unchanged' : 'no file';
    lines.push(`  - ${row.acId} · ${row.ref} — ${label}`);
  }
  return lines.join('\n');
}

/** Renders the "## Gate & attestation" section. */
function renderGate(gate: GateStateInput): string {
  const lines: string[] = ['## Gate & attestation', ''];
  if (gate.attestedCount === null) {
    lines.push('- Verification attestation: none on record — this tree\'s verification state is unknown.');
  } else {
    lines.push(`- Verification attestation: ${gate.attestedCount} done feature(s) attested to their module tree-hash.`);
  }
  if (gate.lastGateRun === null) {
    lines.push(
      '- Last recorded gate run: none in this working tree\'s ledger (`.cladding/` is git-ignored; fresh clones and CI start empty).',
    );
  } else {
    const g = gate.lastGateRun;
    const verdict = g.anyFailed === false ? 'PASSED' : g.anyFailed === true ? 'FAILED' : 'unknown';
    const parts = [
      g.tier ? `tier ${g.tier}` : 'tier unknown',
      `strict=${g.strict === true}`,
      `${verdict}`,
      typeof g.worst === 'number' ? `(worst exit ${g.worst})` : '',
    ].filter((s) => s.length > 0);
    lines.push(`- Last recorded gate run: ${parts.join(', ')}.`);
  }
  return lines.join('\n');
}

/**
 * Renders the full six-section markdown packet. Deterministic: the only
 * variable inputs are `meta.sinceRef` + `meta.head`, both stable for a fixed
 * repository state — so two runs produce byte-identical output.
 */
export function renderReportMarkdown(model: ReportModel, meta: ReportMeta): string {
  const shortHead = meta.head.slice(0, 12);
  // Name the revision actually compared against when it is not the ref the
  // reader named — otherwise reproducing the packet by hand silently uses a
  // different base.
  const base =
    meta.baseSha && !meta.baseSha.startsWith(meta.sinceRef) && meta.sinceRef !== meta.baseSha
      ? [`_Compared against ${meta.baseSha.slice(0, 12)} — the merge base of ${meta.sinceRef} and HEAD._`, '']
      : [];
  return [
    `# Review packet — ${meta.sinceRef}..${shortHead}`,
    '',
    ...base,
    renderSpecChanges(model.specChanges),
    '',
    renderSpecEntryDeltas(model),
    '',
    renderCodeChanges(model),
    '',
    renderTestRefs(model),
    '',
    renderRegressionSet(model),
    '',
    renderGate(model.gate),
    '',
  ].join('\n');
}
