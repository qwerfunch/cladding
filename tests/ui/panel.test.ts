// Cladding · unit tests for ui/panel.ts
//
// renderPanel produces a feature × stage text grid. Each row is one
// feature; each cell is one of '✓' '·' '!' '✗' '-'. L4 cells (4.1, 4.2)
// derive their glyph from the audit log via the anti-self-cert guard;
// L1–L3 cells render '-' in v0.1 (no per-feature × stage result store yet).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvidence} from '../../src/hitl/audit.js';
import {newEvidence} from '../../src/hitl/identity.js';
import type {Spec} from '../../src/spec/types.js';
import {buildPanelModel, renderPanel} from '../../src/ui/panel.js';
import {writeAttestation} from '../../src/spec/attestation.js';

function specWith(features: Spec['features']): Spec {
  return {
    schema: '0.1',
    project: {name: 'x', language: 'typescript'},
    features,
  };
}

describe('renderPanel', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-panel-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('renders one row per feature with a header', () => {
    const spec = specWith([
      {id: 'F-001', title: 'alpha', status: 'done'},
      {id: 'F-002', title: 'beta', status: 'done'},
    ]);
    const out = renderPanel(spec, dir);
    const lines = out.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 features
    expect(lines[0]).toContain('feature');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  test('L4 cells render · when audit log is empty', () => {
    const spec = specWith([{id: 'F-001', title: 't', status: 'done'}]);
    const out = renderPanel(spec, dir);
    // L4 stages (4.1, 4.2) are the last two columns
    expect(out).toContain('·');
  });

  test('L4 cells render ✓ when AC has human-pass evidence', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'human signed off',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    const spec = specWith([
      {
        id: 'F-001',
        title: 't',
        status: 'done',
        acceptance_criteria: [{id: 'AC-001'}],
      },
    ]);
    const out = renderPanel(spec, dir);
    expect(out).toContain('✓');
  });

  test('L4 cell renders ✗ when guard fails (tool-only evidence)', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'CI ran',
        identity: {author: 'tool', name: 'ci'},
      }),
    );
    const spec = specWith([
      {
        id: 'F-001',
        title: 't',
        status: 'done',
        acceptance_criteria: [{id: 'AC-001'}],
      },
    ]);
    const out = renderPanel(spec, dir);
    expect(out).toContain('✗');
  });

  test('internal mode shows F-NNN ids + stage codes', () => {
    const spec = specWith([{id: 'F-042', title: 'hidden', status: 'done'}]);
    const out = renderPanel(spec, dir, {internal: true});
    expect(out).toContain('F-042');
    // Stage code form (e.g. 1.1) appears in header, not abbreviated label
    expect(out).toContain('1.1');
  });

  test('default mode uses business title, hides F-NNN', () => {
    const spec = specWith([{id: 'F-042', title: 'public title', status: 'done'}]);
    const out = renderPanel(spec, dir, {internal: false});
    expect(out).toContain('public title');
    expect(out).not.toContain('F-042');
  });

  test('renderPanel with no opts defaults to non-internal view', () => {
    const spec = specWith([{id: 'F-042', title: 'just a title', status: 'done'}]);
    const out = renderPanel(spec); // default cwd, default opts
    expect(out).toContain('just a title');
    expect(out).not.toContain('F-042');
  });

  test('title fallback: missing title uses the feature id', () => {
    const spec = specWith([{id: 'F-099', title: '', status: 'done'}]);
    const out = renderPanel(spec, dir, {internal: false});
    expect(out).toContain('F-099');
  });
});

// ─── F-95a096 — attestation freshness column ───
//
// The trailing `att` cell answers "is this done feature's verification
// stamp current?" without running the gate: ✓ tree-hash matches the
// committed attestation, ! unstamped or modules changed since the stamp,
// · n/a, - no attestation file yet.

describe('attestation column (F-95a096)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-panel-att-'));
    mkdirSync(join(dir, 'src'), {recursive: true});
    mkdirSync(join(dir, 'spec'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  /** The att glyph is the last cell: internal row = id + 14 cells + title. */
  function attCell(out: string, featureId: string): string {
    const line = out.split('\n').find((l) => l.startsWith(featureId));
    expect(line, `row for ${featureId}`).toBeDefined();
    return line!.split(/\s+/)[14];
  }

  test('header gains the att column in both views', () => {
    const spec = specWith([{id: 'F-001', title: 't', status: 'done'}]);
    expect(renderPanel(spec, dir, {internal: true}).split('\n')[0]).toContain('att');
    expect(renderPanel(spec, dir).split('\n')[0]).toContain('att');
  });

  test('✓ when the stamped tree-hash matches the modules on disk', () => {
    writeFileSync(join(dir, 'src', 'm.ts'), 'export const a = 1;\n');
    const spec = specWith([
      {id: 'F-aaa11111', title: 't', status: 'done', modules: ['src/m.ts']},
    ]);
    writeAttestation(dir, spec);
    expect(attCell(renderPanel(spec, dir, {internal: true}), 'F-aaa11111')).toBe('✓');
  });

  test('! when the module changed after the stamp (stale)', () => {
    writeFileSync(join(dir, 'src', 'm.ts'), 'export const a = 1;\n');
    const spec = specWith([
      {id: 'F-aaa11111', title: 't', status: 'done', modules: ['src/m.ts']},
    ]);
    writeAttestation(dir, spec);
    writeFileSync(join(dir, 'src', 'm.ts'), 'export const a = 2;\n');
    expect(attCell(renderPanel(spec, dir, {internal: true}), 'F-aaa11111')).toBe('!');
  });

  test('! when the attestation file exists but the feature is unstamped', () => {
    writeFileSync(join(dir, 'src', 'm.ts'), 'x\n');
    writeFileSync(join(dir, 'src', 'n.ts'), 'y\n');
    const stamped = {id: 'F-aaa11111', title: 'a', status: 'done' as const, modules: ['src/m.ts']};
    writeAttestation(dir, specWith([stamped]));
    const spec = specWith([
      stamped,
      {id: 'F-bbb22222', title: 'b', status: 'done', modules: ['src/n.ts']},
    ]);
    const out = renderPanel(spec, dir, {internal: true});
    expect(attCell(out, 'F-aaa11111')).toBe('✓');
    expect(attCell(out, 'F-bbb22222')).toBe('!');
  });

  test('- when no attestation file exists (state unknown, not a failure)', () => {
    writeFileSync(join(dir, 'src', 'm.ts'), 'x\n');
    const spec = specWith([
      {id: 'F-aaa11111', title: 't', status: 'done', modules: ['src/m.ts']},
    ]);
    expect(attCell(renderPanel(spec, dir, {internal: true}), 'F-aaa11111')).toBe('-');
  });

  test('· for features that are not done or have no modules (n/a)', () => {
    writeFileSync(join(dir, 'src', 'm.ts'), 'x\n');
    const done = {id: 'F-aaa11111', title: 'a', status: 'done' as const, modules: ['src/m.ts']};
    writeAttestation(dir, specWith([done]));
    const spec = specWith([
      done,
      {id: 'F-ccc33333', title: 'c', status: 'in_progress', modules: ['src/m.ts']},
      {id: 'F-ddd44444', title: 'd', status: 'done'}, // no modules
    ]);
    const out = renderPanel(spec, dir, {internal: true});
    expect(attCell(out, 'F-ccc33333')).toBe('·');
    expect(attCell(out, 'F-ddd44444')).toBe('·');
  });
});

// ─── F-e940fffe / AC-e5f48ce5 — the split-out row model + ANSI byte-identity ───
//
// buildPanelModel is the single SSoT behind the terminal view, `status --json`,
// and the audit bundle. These tests pin (a) the model shape — columns then
// per-row {featureId, title, status, cells} alignment — and (b) the ANSI output
// of renderPanel byte-for-byte via goldens on a FIXED fixture (no attestation
// file, no evidence, controlled statuses), so the model split can never drift
// the terminal rendering.

describe('buildPanelModel — row model SSoT (AC-e5f48ce5)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-panel-model-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  /** Fixed fixture: statuses controlled, no attestation, no evidence. */
  function goldenSpec(): Spec {
    return specWith([
      {id: 'F-aaaa1111', title: 'alpha feature', status: 'done', modules: ['src/a.ts']},
      {id: 'F-bbbb2222', title: 'beta feature with a very long title that overflows', status: 'in_progress'},
      {id: 'F-cccc3333', title: 'gamma feature', status: 'planned'},
    ]);
  }

  const STAGE_COLUMNS = [
    'stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6',
    'stage_2.1', 'stage_2.2',
    'stage_3.1', 'stage_3.2', 'stage_3.3',
    'stage_4.1', 'stage_4.2',
  ];

  test('columns are the 13 Iron Law stages then the trailing att column', () => {
    const model = buildPanelModel(goldenSpec(), dir);
    expect(model.columns).toEqual([...STAGE_COLUMNS, 'att']);
  });

  test('one row per feature with {featureId, title, status, cells} aligned to columns', () => {
    const spec = goldenSpec();
    const model = buildPanelModel(spec, dir);
    expect(model.rows).toHaveLength(spec.features.length);
    for (const [i, row] of model.rows.entries()) {
      expect(row.featureId).toBe(spec.features[i].id);
      expect(row.title).toBe(spec.features[i].title);
      expect(row.status).toBe(spec.features[i].status);
      expect(row.cells).toHaveLength(model.columns.length);
    }
    // Controlled state: no evidence → L4 '·'; no attestation file → done+modules
    // 'att' is '-', not-done 'att' is '·'; L1–L3 have no signal store → '-'.
    expect(model.rows[0].cells).toEqual(['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '·', '·', '-']);
    expect(model.rows[1].cells).toEqual(['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '·', '·', '·']);
  });

  test('row title falls back to the feature id when the title is empty', () => {
    const model = buildPanelModel(specWith([{id: 'F-0099aaaa', title: '', status: 'done'}]), dir);
    expect(model.rows[0].title).toBe('F-0099aaaa');
  });

  test('renderPanel derives from the model: each row line carries the model cells verbatim', () => {
    const spec = goldenSpec();
    const model = buildPanelModel(spec, dir);
    const out = renderPanel(spec, dir, {internal: true});
    for (const row of model.rows) {
      const line = out.split('\n').find((l) => l.startsWith(row.featureId));
      expect(line, `row for ${row.featureId}`).toBeDefined();
      expect(line).toContain(row.cells.join('   '));
    }
  });

  test('GOLDEN · default (Soft Shell) ANSI view is byte-identical to the pinned snapshot', () => {
    const golden = [
      'feature                            Typ Lin Dri Com Arc Sec Uni Cov Smo Per Vis Aud UAT att',
      'alpha feature                       -   -   -   -   -   -   -   -   -   -   -   ·   ·   -',
      'beta feature with a very long title -   -   -   -   -   -   -   -   -   -   -   ·   ·   ·',
      'gamma feature                       -   -   -   -   -   -   -   -   -   -   -   ·   ·   ·',
    ].join('\n');
    expect(renderPanel(goldenSpec(), dir)).toBe(golden);
  });

  test('GOLDEN · internal (Iron Core) ANSI view is byte-identical to the pinned snapshot', () => {
    const golden = [
      'feature      1.1 1.2 1.3 1.4 1.5 1.6 2.1 2.2 3.1 3.2 3.3 4.1 4.2 att',
      'F-aaaa1111   -   -   -   -   -   -   -   -   -   -   -   ·   ·   -  alpha feature',
      'F-bbbb2222   -   -   -   -   -   -   -   -   -   -   -   ·   ·   ·  beta feature with a very long title that overflows',
      'F-cccc3333   -   -   -   -   -   -   -   -   -   -   -   ·   ·   ·  gamma feature',
    ].join('\n');
    expect(renderPanel(goldenSpec(), dir, {internal: true})).toBe(golden);
  });
});
