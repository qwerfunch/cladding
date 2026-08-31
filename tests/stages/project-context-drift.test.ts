// Cladding · unit tests for stages/detectors/project-context-drift.ts
//
// Detector under test closes the CONTEXT-TIER Vacuous Green: once a project
// has GROWN past a feature threshold (DEFAULT_MIN_FEATURES_FOR_CONTEXT = 8),
// a PRESENT-but-UNREFINED docs/project-context.md (still bearing init-template
// placeholder markers) is drift. It is status-BLIND — every feature counts
// toward the threshold regardless of lifecycle status.
//
//   • features < 8                       → [] (size guard dominates)
//   • features ≥ 8, doc MISSING          → [] (ABSENCE_OF_GOVERNANCE owns absence)
//   • features ≥ 8, doc has a marker     → one WARN (path docs/project-context.md)
//   • features ≥ 8, doc is real prose    → []
//   • spec.yaml not loaded               → one info finding (shared withSpec seam)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  DEFAULT_MIN_FEATURES_FOR_CONTEXT,
  projectContextDrift,
} from '../../src/stages/detectors/project-context-drift.js';
import {clearDetectors, registerDetector, runDrift} from '../../src/stages/drift.js';

const SPEC_HEADER = 'schema: "0.1"\n' + 'project: {name: x, language: typescript}\n';

/** A line bearing the v0.3.x re-run-LLM marker (most common unrefined state). */
const MARKER_RERUN = '_Refine by hand or re-run with LLM available._';

/** The greenfield seed marker (motivation prompt left un-filled). */
const MARKER_GREENFIELD =
  '_Motivation. ... What gap or pain led to this project being started?_';

/** Real prose for a refined doc — contains NONE of the placeholder markers. */
const REFINED_PROSE =
  '# Foo\n\n## Why\n\nThis exists to make X measurably better for team Y.\n';

/** Render N minimal inline feature entries (status-blind: all 'planned'). */
function inlineFeatures(n: number): string {
  let yaml = 'features:\n';
  for (let i = 1; i <= n; i++) {
    yaml += `  - id: F-${String(i).padStart(3, '0')}\n    title: t\n    status: planned\n`;
  }
  return yaml;
}

/** Write spec.yaml with N inline features into `dir`. */
function writeSpec(dir: string, featureCount: number): void {
  writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER + inlineFeatures(featureCount));
}

/** Write docs/project-context.md with the given body into `dir`. */
function writeContextDoc(dir: string, body: string): void {
  mkdirSync(join(dir, 'docs'), {recursive: true});
  writeFileSync(join(dir, 'docs', 'project-context.md'), body);
}

describe('PROJECT_CONTEXT_DRIFT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-pctx-drift-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('exposes the expected name and default threshold', () => {
    expect(projectContextDrift.name).toBe('PROJECT_CONTEXT_DRIFT');
    expect(DEFAULT_MIN_FEATURES_FOR_CONTEXT).toBe(8);
  });

  test('8 features + re-run-LLM marker → 1 warn (message has count + "unrefined", path set)', () => {
    writeSpec(dir, 8);
    writeContextDoc(dir, `# Project\n\n## Why\n\n${MARKER_RERUN}\n`);
    const findings = projectContextDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('docs/project-context.md');
    expect(findings[0].message).toContain('8');
    expect(findings[0].message).toContain('unrefined');
  });

  test('8 features + greenfield motivation marker → 1 warn', () => {
    writeSpec(dir, 8);
    writeContextDoc(dir, `# Project\n\n## Motivation\n\n${MARKER_GREENFIELD}\n`);
    const findings = projectContextDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('docs/project-context.md');
  });

  test('[covers:F-fe0f7a96/AC-7ffc85fa] an unrefined project context tells the user to run clad clarify', () => {
    writeSpec(dir, 8);
    writeContextDoc(dir, `# Project\n\n## Why\n\n${MARKER_RERUN}\n`);
    expect(projectContextDrift.run({cwd: dir})[0]?.message).toContain('clad clarify');
  });

  test('8 features + REFINED prose (no markers) → no finding', () => {
    writeSpec(dir, 8);
    writeContextDoc(dir, REFINED_PROSE);
    expect(projectContextDrift.run({cwd: dir})).toEqual([]);
  });

  test('below threshold: 7 features + unrefined doc → no finding (size guard dominates)', () => {
    writeSpec(dir, 7);
    writeContextDoc(dir, `# Project\n\n${MARKER_RERUN}\n`);
    expect(projectContextDrift.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-78b50d/AC-002] a below-threshold or refined project context is not flagged', () => {
    writeSpec(dir, 7);
    writeContextDoc(dir, `# Project\n\n${MARKER_RERUN}\n`);
    expect(projectContextDrift.run({cwd: dir})).toEqual([]);

    writeSpec(dir, 8);
    writeContextDoc(dir, REFINED_PROSE);
    expect(projectContextDrift.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-78b50d/AC-003] 8 features + NO docs/project-context.md → no finding (absence not flagged here)', () => {
    writeSpec(dir, 8);
    // deliberately do NOT write docs/project-context.md — absence is
    // ABSENCE_OF_GOVERNANCE's concern, not this detector's.
    expect(projectContextDrift.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding', () => {
    // no spec.yaml written into the temp dir at all
    const findings = projectContextDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});

describe('PROJECT_CONTEXT_DRIFT strict promotion (integration)', () => {
  let dir: string;
  beforeEach(() => {
    clearDetectors();
    dir = mkdtempSync(join(tmpdir(), 'clad-pctx-drift-'));
    writeSpec(dir, 8); // at threshold → eligible
    writeContextDoc(dir, `# Project\n\n## Why\n\n${MARKER_RERUN}\n`); // unrefined
    registerDetector(projectContextDrift);
  });
  afterEach(() => {
    clearDetectors();
    rmSync(dir, {recursive: true, force: true});
  });

  test('strict: an unrefined project-context.md DOES fail the stage', () => {
    const report = runDrift({cwd: dir, strict: true});
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('[covers:F-78b50d/AC-001] default: an unrefined project-context.md does NOT fail but is reported', () => {
    const report = runDrift({cwd: dir});
    expect(report.pass).toBe(true);
    expect(report.findings.some((f) => f.detector === 'PROJECT_CONTEXT_DRIFT')).toBe(true);
  });
});
