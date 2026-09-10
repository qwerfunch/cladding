// Cladding · code-compact tripwire suite (F-c58263b8)
//
// Pure compaction feature: no dead threshold-seam functions, one home for git
// ref resolution, one home for the ModuleReader alias, and two export-hygiene
// calls (one de-exported, one deliberately kept). This suite pins the STATIC
// facts of the compaction — a grep-shaped tripwire, not behavior coverage
// (behavior is already exercised by the pre-existing suites: tests/stages/
// {planned-backlog,hollow-governance,scenario-coverage,project-context-drift}.
// test.ts, tests/core/git-ops.test.ts, tests/changelog/collect.test.ts,
// tests/report/{report,report-cli}.test.ts, tests/cli/changelog-measure.test.ts,
// tests/optimizer/{measurement,infer-depends-on,code-excerpt}.test.ts,
// tests/events/log.test.ts). Those stay green with zero edits (AC-01797b10);
// this file exists so a FUTURE "cleanup" cannot silently reintroduce a dead
// seam, re-duplicate the git probe, or flip an adjudicated export decision
// without a red test forcing a conscious choice.

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// The removed seam's name, built at runtime from two literal halves so THIS
// file's own source text never spells it out — it would otherwise trip its
// own tripwire below (and every other reference to it in this file is phrased
// around that same constraint).
const SEAM_SYMBOL = ['resolve', 'Threshold'].join('');

/** Recursively lists repo-relative `*.ts` file paths under `dir` (posix-joined), skipping dotdirs/node_modules/dist. */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const rel = `${dir}/${name}`;
    let stat;
    try {
      stat = statSync(join(ROOT, rel));
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkTs(rel, out);
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

describe('AC-de1bc6c5 · the four detector-local threshold-seam functions are inlined, no config knob added', () => {
  test('[covers:F-c58263b8/AC-de1bc6c5] the removed seam symbol appears in no file under src/ or tests/ (non-vacuous: scan visits >100 files)', () => {
    const files = [...walkTs('src'), ...walkTs('tests')];
    expect(files.length, 'sanity: the scan actually walked a non-trivial tree').toBeGreaterThan(100);
    const offenders = files.filter((f) => read(f).includes(SEAM_SYMBOL));
    expect(offenders, `no file may contain the removed seam symbol ('${SEAM_SYMBOL}')`).toEqual([]);
  });

  test('[covers:F-c58263b8/AC-de1bc6c5] the four DEFAULT_* constants are still exported and are now the direct comparand (the seam function is gone, the surface is not)', () => {
    const cases: ReadonlyArray<{file: string; constant: string}> = [
      {file: 'src/stages/detectors/planned-backlog.ts', constant: 'DEFAULT_MAX_PLANNED_AHEAD'},
      {file: 'src/stages/detectors/hollow-governance.ts', constant: 'DEFAULT_MIN_FEATURES_FOR_DESIGN'},
      {file: 'src/stages/detectors/scenario-coverage.ts', constant: 'DEFAULT_MIN_FEATURES_FOR_SCENARIOS'},
      {file: 'src/stages/detectors/project-context-drift.ts', constant: 'DEFAULT_MIN_FEATURES_FOR_CONTEXT'},
    ];
    for (const {file, constant} of cases) {
      const body = read(file);
      expect(body, `${file} still exports ${constant}`).toMatch(new RegExp(`export const ${constant}\\b`));
    }
  });

  test('[covers:F-c58263b8/AC-de1bc6c5] the "wire a config seam later" narrative comments are gone; no ai_hints.max_planned_ahead knob was added', () => {
    const files = [
      'src/stages/detectors/planned-backlog.ts',
      'src/stages/detectors/hollow-governance.ts',
      'src/stages/detectors/scenario-coverage.ts',
      'src/stages/detectors/project-context-drift.ts',
    ];
    const seamMention = new RegExp(`ai_hints override|plugs into ${SEAM_SYMBOL}|override seam later`);
    for (const file of files) {
      const body = read(file);
      expect(body, `${file} no longer narrates a future config seam`).not.toMatch(seamMention);
    }
    // The backlog explicitly decided against wiring this knob — a future
    // "helpful" compaction must not quietly add it back in as a side effect.
    expect(read('src/stages/detectors/planned-backlog.ts'), 'no max_planned_ahead config knob added').not.toContain('max_planned_ahead');
  });
});

describe('AC-65b3d185 · git ref resolution lives exactly once in src/core/git-ops.ts', () => {
  test('[covers:F-c58263b8/AC-65b3d185] git-ops.ts exports resolveRefToCommit(cwd, ref): string | null and refExists(cwd, ref): boolean', () => {
    const body = read('src/core/git-ops.ts');
    expect(body, 'resolveRefToCommit is the resolving probe').toMatch(/export function resolveRefToCommit\(cwd: string, ref: string\): string \| null/);
    expect(body, 'refExists is its boolean projection').toMatch(/export function refExists\(cwd: string, ref: string\): boolean/);
    expect(body, 'refExists is defined in terms of resolveRefToCommit, not a second probe').toMatch(/refExists[\s\S]{0,80}resolveRefToCommit\(cwd, ref\) !== null/);
  });

  test('[covers:F-c58263b8/AC-65b3d185] the rev-parse + --verify idiom appears in NO src file other than core/git-ops.ts', () => {
    const files = walkTs('src');
    const offenders = files.filter((f) => f !== 'src/core/git-ops.ts' && read(f).includes('rev-parse') && read(f).includes('--verify'));
    expect(offenders, 'only core/git-ops.ts may combine the rev-parse + --verify idiom').toEqual([]);
  });

  test('[covers:F-c58263b8/AC-65b3d185] the three prior duplicate call sites import the core probe instead of shelling out themselves', () => {
    const cases: ReadonlyArray<{file: string; symbol: string}> = [
      {file: 'src/changelog/collect.ts', symbol: 'refExists'},
      {file: 'src/cli/report.ts', symbol: 'refExists'},
      {file: 'src/cli/changelog.ts', symbol: 'resolveRefToCommit'},
    ];
    for (const {file, symbol} of cases) {
      const body = read(file);
      expect(body, `${file} imports ${symbol} from core/git-ops.js`).toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['"]\\.\\./core/git-ops\\.js['"]`),
      );
      expect(body, `${file} actually calls ${symbol}(`).toMatch(new RegExp(`${symbol}\\(`));
    }
  });
});

describe('AC-243ff1e1 · ModuleReader single home + export hygiene as adjudicated', () => {
  test('[covers:F-c58263b8/AC-243ff1e1] exactly one `type ModuleReader` definition exists under src/optimizer/, at infer-depends-on.ts', () => {
    const files = walkTs('src/optimizer');
    const defs = files.filter((f) => /\bexport type ModuleReader\s*=/.test(read(f)));
    expect(defs, 'ModuleReader is declared exactly once, at infer-depends-on.ts').toEqual(['src/optimizer/infer-depends-on.ts']);
  });

  test('[covers:F-c58263b8/AC-243ff1e1] measurement.ts imports ModuleReader instead of redeclaring it', () => {
    const body = read('src/optimizer/measurement.ts');
    expect(body, 'a type-only import of the single home').toMatch(/import type \{ModuleReader\} from '\.\/infer-depends-on\.js';/);
    expect(body, 'no local re-declaration remains').not.toMatch(/export type ModuleReader/);
  });

  test('[covers:F-c58263b8/AC-243ff1e1] log.ts no longer exports resolveActorIdentity (zero external importers; de-exported)', () => {
    const body = read('src/events/log.ts');
    expect(body, 'no longer part of the public surface').not.toMatch(/export function resolveActorIdentity/);
    expect(body, 'the function itself still exists for recordEvent\'s self-use').toMatch(/(?<!export )function resolveActorIdentity\(/);
  });

  test('code-excerpt.ts STILL exports withinCwd — adjudicated KEEP, pinned against a future silent flip', () => {
    // withinCwd was originally in scope for de-export, but
    // tests/optimizer/code-excerpt.test.ts pins its path-traversal contract
    // directly under that name — weakening a security-relevant unit contract
    // to buy export hygiene was adjudicated a bad trade. This test exists so a
    // future "cleanup" cannot silently re-flip that call without going red here.
    const body = read('src/optimizer/code-excerpt.ts');
    expect(body, 'withinCwd stays exported per the AC-243ff1e1 adjudication').toMatch(/export function withinCwd/);
  });

  test('the existing withinCwd contract test (the reason the export was kept) is still intact', () => {
    const body = read('tests/optimizer/code-excerpt.test.ts');
    expect(body, 'the test still imports withinCwd by name').toMatch(/import\s*\{[^}]*\bwithinCwd\b[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/optimizer\/code-excerpt\.js';/);
    expect(body, 'the test still exercises the path-traversal contract').toContain("withinCwd('../x', dir)).toBe(false)");
  });
});
