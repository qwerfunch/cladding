// Cladding · unit tests for stages/detectors/planned-backlog.ts
//
// Why: the per-feature cadence is "one feature at a time" — spec a slice,
// build it, verify it, then move on. A backlog of features that are specced
// but have NO code yet means the spec raced ahead of the code, which the
// feature-cycle discipline exists to prevent.
//
// What this detector flags: a feature is STALLED when its status is
// 'planned' or 'in_progress' AND it has no code on disk (zero declared
// modules, OR every declared module path is absent). A feature with at
// least one module on disk is NOT stalled. Status done/blocked/archived
// are never counted. When the stalled count exceeds
// DEFAULT_MAX_PLANNED_AHEAD (5) the detector emits exactly one WARN — soft
// drift by default, blocking only under --strict.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  DEFAULT_MAX_PLANNED_AHEAD,
  plannedBacklog,
} from '../../src/stages/detectors/planned-backlog.js';
import {clearDetectors, registerDetector, runDrift} from '../../src/stages/drift.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

/** Write a single feature shard to spec/features/F-<n>.yaml. */
function writeShard(
  dir: string,
  n: number,
  fields: {status: string; modules?: string[]; acceptanceCriteria?: boolean},
): void {
  let yaml = `id: F-${String(n).padStart(3, '0')}\ntitle: t\nstatus: ${fields.status}\n`;
  if (fields.modules) {
    yaml += 'modules:\n' + fields.modules.map((m) => `  - ${m}`).join('\n') + '\n';
  }
  if (fields.acceptanceCriteria) {
    yaml += 'acceptance_criteria:\n  - id: AC-001\n    text: The system shall do X.\n';
  }
  writeFileSync(join(dir, 'spec', 'features', `F-${String(n).padStart(3, '0')}.yaml`), yaml);
}

/** Write N module-less shards of a given status, starting at id offset. */
function writeModuleless(dir: string, count: number, status: string, offset = 0): void {
  for (let i = 0; i < count; i++) {
    writeShard(dir, offset + i + 1, {status});
  }
}

/** Materialize a module file on disk so the feature counts as "has code". */
function writeModuleFile(dir: string, relPath: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, 'export const x = 1;\n');
}

describe('PLANNED_BACKLOG detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-planned-backlog-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('exposes the expected name and default threshold', () => {
    expect(plannedBacklog.name).toBe('PLANNED_BACKLOG');
    expect(DEFAULT_MAX_PLANNED_AHEAD).toBe(5);
  });

  test('5 stalled module-less planned shards → no finding (5 <= 5 boundary)', () => {
    writeModuleless(dir, 5, 'planned');
    expect(plannedBacklog.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-3788c2/AC-001] 6 stalled module-less planned shards → one warn naming the count', () => {
    writeModuleless(dir, 6, 'planned');
    const findings = plannedBacklog.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('6');
    expect(findings[0].message).toContain('NO code on disk');
    expect(findings[0].message).toContain('raced ahead of the code');
    expect(findings[0].message).toContain('docs/feature-cycle.md');
  });

  test('6 planned features each WITH an existing module → no finding (not stalled)', () => {
    for (let i = 0; i < 6; i++) {
      const rel = `src/feat${i}.ts`;
      writeModuleFile(dir, rel);
      writeShard(dir, i + 1, {status: 'planned', modules: [rel]});
    }
    expect(plannedBacklog.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-3788c2/AC-003] existing modules exclude both planned and in-progress features from the backlog', () => {
    for (let i = 0; i < 6; i++) {
      const rel = `src/live${i}.ts`;
      writeModuleFile(dir, rel);
      writeShard(dir, i + 1, {status: i % 2 === 0 ? 'planned' : 'in_progress', modules: [rel]});
    }
    expect(plannedBacklog.run({cwd: dir})).toEqual([]);
  });

  test('6 planned features whose declared module is missing → one warn (declared-but-missing = no code)', () => {
    for (let i = 0; i < 6; i++) {
      // module declared but never written to disk
      writeShard(dir, i + 1, {status: 'planned', modules: [`src/ghost${i}.ts`]});
    }
    const findings = plannedBacklog.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('6');
  });

  test('done features are never counted (6 done + 2 stalled planned → no finding)', () => {
    writeModuleless(dir, 6, 'done', 0); // F-001..F-006 done, module-less
    writeModuleless(dir, 2, 'planned', 6); // F-007..F-008 stalled planned
    // only the 2 planned count; 2 <= 5 → no finding
    expect(plannedBacklog.run({cwd: dir})).toEqual([]);
  });

  test('in_progress shards count toward the backlog (6 stalled in_progress → one warn)', () => {
    writeModuleless(dir, 6, 'in_progress');
    const findings = plannedBacklog.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('6');
  });

  test('mixed spec fires and the message names the stalled count, not the total', () => {
    // 6 stalled planned (module-less)
    writeModuleless(dir, 6, 'planned', 0); // F-001..F-006
    // 3 features WITH code (not stalled)
    for (let i = 0; i < 3; i++) {
      const rel = `src/live${i}.ts`;
      writeModuleFile(dir, rel);
      writeShard(dir, 7 + i, {status: 'planned', modules: [rel]}); // F-007..F-009
    }
    // 2 done (never counted)
    writeModuleless(dir, 2, 'done', 9); // F-010..F-011
    const findings = plannedBacklog.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('6');
    expect(findings[0].message).not.toContain('11');
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = plannedBacklog.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});

describe('PLANNED_BACKLOG strict promotion (integration)', () => {
  let dir: string;
  beforeEach(() => {
    clearDetectors();
    dir = mkdtempSync(join(tmpdir(), 'clad-planned-backlog-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeModuleless(dir, 6, 'planned'); // over threshold → one warn
    registerDetector(plannedBacklog);
  });
  afterEach(() => {
    clearDetectors();
    rmSync(dir, {recursive: true, force: true});
  });

  test('strict: warn backlog DOES fail the stage', () => {
    const report = runDrift({cwd: dir, strict: true});
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('default: warn backlog does NOT fail but is reported', () => {
    const report = runDrift({cwd: dir});
    expect(report.pass).toBe(true);
    expect(report.findings.some((f) => f.detector === 'PLANNED_BACKLOG')).toBe(true);
  });

  test('[covers:F-3788c2/AC-002] backlog is advisory by default and blocking only under strict mode', () => {
    const direct = plannedBacklog.run({cwd: dir});
    expect(direct).toHaveLength(1);
    expect(direct[0]?.severity).toBe('warn');

    const defaultReport = runDrift({cwd: dir});
    expect(defaultReport.pass).toBe(true);
    expect(defaultReport.findings.some((f) => f.detector === 'PLANNED_BACKLOG')).toBe(true);

    const strictReport = runDrift({cwd: dir, strict: true});
    expect(strictReport.pass).toBe(false);
    expect(strictReport.exitCode).toBe(1);
  });
});
