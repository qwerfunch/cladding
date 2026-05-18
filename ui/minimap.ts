// Cladding · Territory Minimap — coverage at a glance
//
// Per ironclad-design/10-territory-minimap.md: surface "what's
// covered, what's drifting, what's untracked" as a single text grid.
// One row per feature, one column per Iron Law stage. Each cell:
//
//   ✓  passed
//   ·  skipped (n/a or not run)
//   !  warn-level drift
//   ✗  error-level drift
//   -  unknown (no signal yet)
//
// The minimap is intentionally low-resolution. Use it for the
// "where do I focus next" decision, not for forensic analysis.

import {failingAcs} from '../hitl/anti-self-cert.js';
import {readEvidence} from '../hitl/audit.js';
import type {Feature, Spec} from '../spec/types.js';

const STAGES: readonly string[] = [
  'stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6',
  'stage_2.1', 'stage_2.2',
  'stage_3.1', 'stage_3.2', 'stage_3.3',
  'stage_4.1', 'stage_4.2',
];

export type CellGlyph = '✓' | '·' | '!' | '✗' | '-';

interface RowOutcome {
  readonly featureId: string;
  readonly title: string;
  readonly cells: readonly CellGlyph[];
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

/** Renders a feature × stage grid as a multi-line string. */
export function renderMinimap(spec: Spec, cwd: string = '.'): string {
  const header = `feature      ${STAGES.map((s) => s.replace('stage_', '')).join(' ')}`;
  const rows: RowOutcome[] = spec.features.map((f) => ({
    featureId: f.id,
    title: f.title,
    cells: STAGES.map((s) => cellFor(f, s, cwd)),
  }));
  const lines = rows.map((r) => `${r.featureId.padEnd(12)} ${r.cells.join('   ')}  ${r.title}`);
  return [header, ...lines].join('\n');
}
