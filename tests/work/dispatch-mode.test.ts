// Cladding · unit tests for enterWork dispatchMode + capability
// envelope wiring (0.4.11 PR-B).
//
// Verifies:
//   - default dispatchMode per Tier: Tier 1/2 = 'sub-agent',
//     Tier 3 = 'host-self-inject'
//   - explicit dispatchMode override always wins
//   - capabilityEnvelope shape matches the host (Claude/Cursor/Antigravity
//     get tools[], Codex gets sandboxMode + mcpServers, Gemini gets
//     allowedTools, generic gets {host: 'generic'})
//   - dispatch_drift detection in audit.ts: Tier 1 host with
//     'host-self-inject' surfaces in WorkComplianceReport.dispatchDrifts

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors} from '../../src/stages/drift.js';
import {auditWorkCompliance} from '../../src/work/audit.js';
import {enterWork} from '../../src/work/transaction.js';

function seedFeature(cwd: string, filename: string, body: string): void {
  const dir = join(cwd, 'spec', 'features');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, filename), body);
}

function seedSrcFeature(cwd: string, id = 'F-cc1234'): string {
  seedFeature(
    cwd,
    `feat-${id.slice(2)}.yaml`,
    [
      `id: ${id}`,
      `slug: feat-${id.slice(2)}`,
      'status: planned',
      'modules:',
      '  - src/feat.ts',
      'acceptance_criteria: []',
      '',
    ].join('\n'),
  );
  return id;
}

describe('enterWork — default dispatchMode per Tier', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-dispatch-mode-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('Tier 1 claude-code → sub-agent (default)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'claude-code'});
    expect(r.dispatchMode).toBe('sub-agent');
  });

  test('Tier 1 codex → sub-agent (default)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'codex'});
    expect(r.dispatchMode).toBe('sub-agent');
  });

  test('Tier 1 cursor → sub-agent (default)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'cursor'});
    expect(r.dispatchMode).toBe('sub-agent');
  });

  test('Tier 1 antigravity → sub-agent (default)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'antigravity'});
    expect(r.dispatchMode).toBe('sub-agent');
  });

  test('Tier 2 gemini → sub-agent (default, transitioning)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'gemini'});
    expect(r.dispatchMode).toBe('sub-agent');
  });

  test('Tier 3 generic → host-self-inject (default)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'generic'});
    expect(r.dispatchMode).toBe('host-self-inject');
  });

  test('explicit dispatchMode always wins (Tier 1 + host-self-inject override)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({
      featureId,
      cwd,
      hostOverride: 'claude-code',
      dispatchMode: 'host-self-inject',
    });
    expect(r.dispatchMode).toBe('host-self-inject');
  });

  test('explicit dispatchMode always wins (Tier 3 + sub-agent override)', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({
      featureId,
      cwd,
      hostOverride: 'generic',
      dispatchMode: 'sub-agent',
    });
    expect(r.dispatchMode).toBe('sub-agent');
  });
});

describe('enterWork — capabilityEnvelope', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-cap-envelope-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('Claude Code → tools[] with Read/Glob/Grep at minimum', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'claude-code'});
    expect(r.capabilityEnvelope.host).toBe('claude-code');
    if (r.capabilityEnvelope.host !== 'claude-code') throw new Error('discriminated union');
    expect(r.capabilityEnvelope.tools).toContain('Read');
  });

  test('Codex → mcpServers + sandboxMode', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'codex'});
    expect(r.capabilityEnvelope.host).toBe('codex');
    if (r.capabilityEnvelope.host !== 'codex') throw new Error('discriminated union');
    expect(r.capabilityEnvelope.mcpServers).toContain('cladding');
    expect(['read-only', 'workspace-write', 'danger-full-access']).toContain(
      r.capabilityEnvelope.sandboxMode,
    );
  });

  test('Gemini → allowedTools with Gemini-style names', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'gemini'});
    expect(r.capabilityEnvelope.host).toBe('gemini');
    if (r.capabilityEnvelope.host !== 'gemini') throw new Error('discriminated union');
    expect(r.capabilityEnvelope.allowedTools).toContain('ReadFile');
  });

  test('Generic → empty envelope', () => {
    const featureId = seedSrcFeature(cwd);
    const r = enterWork({featureId, cwd, hostOverride: 'generic'});
    expect(r.capabilityEnvelope).toEqual({host: 'generic'});
  });

  test('resumed work returns same envelope shape', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({featureId, cwd, hostOverride: 'claude-code'});
    const resumed = enterWork({featureId, cwd, hostOverride: 'claude-code'});
    expect(resumed.status).toBe('resumed');
    expect(resumed.capabilityEnvelope.host).toBe('claude-code');
    expect(resumed.dispatchMode).toBe('sub-agent');
  });
});

describe('audit.ts — dispatch_drift detection', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-dispatch-drift-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('Tier 1 + host-self-inject → dispatchDrifts surfaces 1 entry', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({
      featureId,
      cwd,
      hostOverride: 'claude-code',
      dispatchMode: 'host-self-inject',
    });
    const report = auditWorkCompliance({cwd});
    expect(report.dispatchDrifts).toHaveLength(1);
    expect(report.dispatchDrifts[0].host).toBe('claude-code');
    expect(report.dispatchDrifts[0].tier).toBe(1);
    expect(report.dispatchDrifts[0].dispatchMode).toBe('host-self-inject');
    expect(report.summary.dispatchDriftCount).toBe(1);
  });

  test('Tier 1 + sub-agent (default) → no drift', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({featureId, cwd, hostOverride: 'claude-code'});
    const report = auditWorkCompliance({cwd});
    expect(report.dispatchDrifts).toHaveLength(0);
    expect(report.summary.dispatchDriftCount).toBe(0);
  });

  test('Tier 3 + host-self-inject → no drift (expected mode for generic)', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({featureId, cwd, hostOverride: 'generic'});
    const report = auditWorkCompliance({cwd});
    expect(report.dispatchDrifts).toHaveLength(0);
  });

  test('Tier 2 + host-self-inject also flagged (Gemini still has @agent surface)', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({
      featureId,
      cwd,
      hostOverride: 'gemini',
      dispatchMode: 'host-self-inject',
    });
    const report = auditWorkCompliance({cwd});
    expect(report.dispatchDrifts).toHaveLength(1);
    expect(report.dispatchDrifts[0].tier).toBe(2);
  });

  test('reason string mentions host name and dispatch divergence', () => {
    const featureId = seedSrcFeature(cwd);
    enterWork({
      featureId,
      cwd,
      hostOverride: 'cursor',
      dispatchMode: 'host-self-inject',
    });
    const report = auditWorkCompliance({cwd});
    expect(report.dispatchDrifts[0].reason).toContain('cursor');
    expect(report.dispatchDrifts[0].reason).toContain('host-self-inject');
  });
});
