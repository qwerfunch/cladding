// Cladding · unit tests for ui/panel.ts
//
// renderPanel produces a feature × stage text grid. Each row is one
// feature; each cell is one of '✓' '·' '!' '✗' '-'. L4 cells (4.1, 4.2)
// derive their glyph from the audit log via the anti-self-cert guard;
// L1–L3 cells render '-' in v0.1 (no per-feature × stage result store yet).

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvidence} from '../../hitl/audit.js';
import {newEvidence} from '../../hitl/identity.js';
import type {Spec} from '../../spec/types.js';
import {renderPanel} from '../../ui/panel.js';

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
