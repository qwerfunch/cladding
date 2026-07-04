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

import type {ChangelogManifest} from '../changelog/collect.js';

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

/** Everything the pure model needs — the CLI composes it impurely. */
export interface ReportInputs {
  readonly specChanges: ChangelogManifest;
  readonly codeChanges: readonly CodeChangeInput[];
  /** True when the project declares zero depends_on edges (blank ledger). */
  readonly ledgerEmpty: boolean;
  readonly gate: GateStateInput;
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
}

/** Stable identifiers stamped into the header — the range + HEAD for a fixed state. */
export interface ReportMeta {
  readonly sinceRef: string;
  /** Full HEAD sha (from `git rev-parse HEAD`); deterministic for a fixed state. */
  readonly head: string;
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

  return {
    specChanges: inputs.specChanges,
    codeChanges,
    unowned,
    regressionSet,
    ledgerEmpty: inputs.ledgerEmpty,
    gate: inputs.gate,
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
 * Renders the full four-section markdown packet. Deterministic: the only
 * variable inputs are `meta.sinceRef` + `meta.head`, both stable for a fixed
 * repository state — so two runs produce byte-identical output.
 */
export function renderReportMarkdown(model: ReportModel, meta: ReportMeta): string {
  const shortHead = meta.head.slice(0, 12);
  return [
    `# Review packet — ${meta.sinceRef}..${shortHead}`,
    '',
    renderSpecChanges(model.specChanges),
    '',
    renderCodeChanges(model),
    '',
    renderRegressionSet(model),
    '',
    renderGate(model.gate),
    '',
  ].join('\n');
}
