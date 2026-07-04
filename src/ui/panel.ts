// Cladding · Integrity Panel — coverage at a glance
//
// Per ironclad-design/10-territory-minimap.md (renamed in v0.1 to
// **Integrity Panel** so the vocabulary aligns with the ironclad spec's
// anchor term "Trinity of Integrity"; the legacy filename is kept
// for traceability). Surfaces "what's covered, what's drifting,
// what's untracked" as a single text grid. One row per feature, one
// column per Iron Law stage, plus a trailing `att` column for
// attestation freshness (spec/attestation.yaml vs current module
// tree-hashes, F-95a096). Each cell:
//
//   ✓  passed
//   ·  skipped (n/a or not run)
//   !  warn-level drift
//   ✗  error-level drift
//   -  unknown (no signal yet)
//
// The panel is intentionally low-resolution. Use it for the
// "where do I focus next" decision, not for forensic analysis.

import {failingAcs} from '../hitl/anti-self-cert.js';
import {readEvidence} from '../hitl/audit.js';
import {moduleTreeHash, readAttestation} from '../spec/attestation.js';
import type {Feature, FeatureStatus, Spec} from '../spec/types.js';
import {gateLabel} from './softShell.js';

const STAGES: readonly string[] = [
  'stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6',
  'stage_2.1', 'stage_2.2',
  'stage_3.1', 'stage_3.2', 'stage_3.3',
  'stage_4.1', 'stage_4.2',
];

export type CellGlyph = '✓' | '·' | '!' | '✗' | '-';

/**
 * One feature's row in the integrity matrix. `cells` carries one glyph per
 * {@link PanelModel.columns} entry, in the same order — the Iron Law stages
 * followed by the trailing `att` (attestation-freshness) pseudo-column.
 */
export interface PanelRow {
  readonly featureId: string;
  /** Business title (`f.title`, falling back to the id). */
  readonly title: string;
  readonly status: FeatureStatus;
  readonly cells: readonly CellGlyph[];
}

/**
 * The row model behind the ANSI panel — the single SSoT the terminal view,
 * `status --json`, and the audit bundle all consume (AC-e5f48ce5). Rows keep
 * the raw feature id (machine/forensic surface); the Soft Shell hiding of ids
 * is applied only by the ANSI/HTML VIEWS, not stored here.
 */
export interface PanelModel {
  /** Ordered column ids: the Iron Law stages then the trailing `att` column. */
  readonly columns: readonly string[];
  readonly rows: readonly PanelRow[];
}

/** Column order the model exposes: every stage, then attestation freshness. */
const COLUMNS: readonly string[] = [...STAGES, 'att'];

/** Options for {@link renderPanel}. */
export interface PanelOptions {
  /** When true, prefix each row with the internal `F-NNN`. Default: false. */
  readonly internal?: boolean;
}

function cellFor(feature: Feature, stage: string, cwd: string): CellGlyph {
  // L4 stages: derive from anti-self-cert guard over feature ACs.
  if (stage.startsWith('stage_4')) {
    const evidence = readEvidence(cwd);
    if (evidence.length === 0) return '·';
    const acIds = (feature.acceptance_criteria ?? []).map((a) => a.id);
    const failing = failingAcs(evidence).filter((r) => acIds.includes(r.acId));
    return failing.length > 0 ? '✗' : '✓';
  }
  // L1-L3 stages: in v0.1 we render '-' (we have no per-feature × per-stage
  // result store yet — that lands in L20 with events.log).
  return '-';
}

/** F-95a096 — attestation freshness per feature, one glyph:
 *   ✓  done feature whose module tree-hash matches spec/attestation.yaml
 *   !  done feature that is unstamped or whose modules changed since the stamp
 *   ·  n/a (not done, or no modules to attest)
 *   -  no attestation file yet (verification state unknown) */
function attestationGlyph(
  feature: Feature,
  attested: ReadonlyMap<string, string> | null,
  cwd: string,
): CellGlyph {
  const modules = feature.modules ?? [];
  if (feature.status !== 'done' || modules.length === 0) return '·';
  if (attested === null) return '-';
  const stamp = attested.get(feature.id);
  if (stamp === undefined) return '!';
  return stamp === moduleTreeHash(cwd, modules) ? '✓' : '!';
}

/**
 * Builds the feature × stage row model — the pure(-of-view) SSoT the ANSI
 * panel, `status --json`, and the audit bundle all render (AC-e5f48ce5). One
 * row per feature; each row's `cells` line up with {@link PanelModel.columns}
 * (every Iron Law stage, then the trailing `att` freshness column). Reads
 * evidence + attestation from disk under `cwd`, but emits no view formatting —
 * ids are kept raw and the Soft Shell hiding is the VIEW's job.
 */
export function buildPanelModel(spec: Spec, cwd: string = '.'): PanelModel {
  const attested = readAttestation(cwd);
  const rows: PanelRow[] = spec.features.map((f) => ({
    featureId: f.id,
    title: f.title || f.id,
    status: f.status,
    cells: [...STAGES.map((s) => cellFor(f, s, cwd)), attestationGlyph(f, attested, cwd)],
  }));
  return {columns: COLUMNS, rows};
}

/**
 * Renders a feature × stage grid as a multi-line string.
 *
 * The default Soft Shell view hides internal feature ids and uses
 * stage short-labels (`Type` / `Drift` / `UAT` …). Passing
 * `{internal: true}` reverts to the Iron Core view that exposes
 * `F-NNN` and `stage_X.Y` codes — useful for cross-referencing the
 * audit log during forensic work.
 *
 * The row data comes from {@link buildPanelModel}; this function only formats
 * that model, so the ANSI output stays byte-identical to the pre-split version.
 *
 * @see ironclad-design/03-ux-routing.md §1.2 — user-facing ID ban.
 */
export function renderPanel(
  spec: Spec,
  cwd: string = '.',
  opts: PanelOptions = {},
): string {
  const internal = opts.internal ?? false;
  const model = buildPanelModel(spec, cwd);
  const stageHeaders = [
    ...STAGES.map((s) => (internal ? s.replace('stage_', '') : abbreviateGate(s))),
    'att',
  ];
  const header = internal
    ? `feature      ${stageHeaders.join(' ')}`
    : `feature${' '.repeat(28)}${stageHeaders.join(' ')}`;
  const lines = model.rows.map((r) => {
    const cells = r.cells.join('   ');
    if (internal) return `${r.featureId.padEnd(12)} ${cells}  ${r.title}`;
    return `${r.title.padEnd(35).slice(0, 35)} ${cells}`;
  });
  return [header, ...lines].join('\n');
}

/**
 * 3-letter abbreviation of the gate's user-facing label, used as a
 * compact column header in the default panel view.
 */
function abbreviateGate(stageId: string): string {
  return gateLabel(stageId).slice(0, 3);
}
