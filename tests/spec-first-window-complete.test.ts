// Cladding · AC-certifying tests · spec-first-window-complete (F-c3747d7d)
//
// Authored implementation-blind by the U7 VERIFIER (Sonnet), per
// scratchpad/uxlang/U7-brief.md's contract — the U7 implementer did not write
// this file. Exercises the REAL detector functions (statusDrift,
// staleSpecification, missingImplementation) against tiny on-disk fixtures,
// mirroring the existing tests/stages/*.test.ts idiom (mkdtempSync + a
// spec.yaml stub + spec/features/*.yaml shards).
//
// AC map (spec/features/spec-first-window-complete-c3747d7d.yaml):
//   AC-2f8fb0b6 — the spec-first window (planned|in_progress, every declared
//                 module absent) collapses all three detectors to `info`;
//                 zero error|warn from that feature (the Stop-relevant fact —
//                 hook.ts:371 blocks on error OR warn).
//   AC-d8be9f4d — anti-regression: done/hollow-done/archived-lifecycle-mismatch
//                 branches keep their original error/warn severity.
//   AC-c6b06ec4 — the window predicate is defined exactly once and imported by
//                 every detector that consults it (mutation-probed, not just
//                 grepped).
//   AC-d574a481 — the STALE_SPECIFICATION / STATUS_DRIFT plain leads are
//                 accurate for every surviving shown (warn/error) sub-case.

import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {missingImplementation} from '../src/stages/detectors/missing-implementation.js';
import {staleSpecification} from '../src/stages/detectors/stale-specification.js';
import {statusDrift} from '../src/stages/detectors/status-drift.js';
import {DETECTOR_PLAIN, plainFinding} from '../src/ui/softShell.js';

const SPEC_HEADER = 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n';

function writeFeature(dir: string, filename: string, yaml: string): void {
  writeFileSync(join(dir, 'spec', 'features', filename), yaml, 'utf8');
}

describe('F-c3747d7d — spec-first window complete across all drift detectors', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-spec-first-window-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  // ─── AC-2f8fb0b6 — the window collapses all three detectors to info ───────

  describe('AC-2f8fb0b6 — spec-first window: all three detectors emit info', () => {
    test('[covers:F-c3747d7d/AC-2f8fb0b6] in_progress + every declared module absent → STATUS_DRIFT info, STALE_SPECIFICATION info, MISSING_IMPLEMENTATION info ×N; zero error|warn', () => {
      writeFeature(dir, 'F-001.yaml', 'id: F-001\ntitle: t\nstatus: in_progress\nmodules:\n  - src/a.ts\n  - src/b.ts\n');

      const sd = statusDrift.run({cwd: dir});
      const ss = staleSpecification.run({cwd: dir});
      const mi = missingImplementation.run({cwd: dir});

      expect(sd).toHaveLength(1);
      expect(sd[0].severity).toBe('info');
      expect(sd[0].message).toContain('F-001');

      expect(ss).toHaveLength(1);
      expect(ss[0].severity).toBe('info');
      expect(ss[0].message).toContain('F-001');

      expect(mi).toHaveLength(2); // one per missing module
      expect(mi.every((f) => f.severity === 'info')).toBe(true);

      // The Stop-relevant fact (hook.ts:371 blocks on error OR warn; drift.ts's
      // --strict promotes warn, never info, to fail-grade): across all three
      // detectors combined, this feature produces NOTHING that can block.
      const all = [...sd, ...ss, ...mi];
      expect(all.filter((f) => f.severity === 'error' || f.severity === 'warn')).toEqual([]);
    });

    test('planned + every declared module absent → STALE_SPECIFICATION info + MISSING_IMPLEMENTATION info (STATUS_DRIFT is in_progress-only by design, silent on planned — not a gap)', () => {
      writeFeature(dir, 'F-002.yaml', 'id: F-002\ntitle: t\nstatus: planned\nmodules:\n  - src/c.ts\n');

      const sd = statusDrift.run({cwd: dir});
      const ss = staleSpecification.run({cwd: dir});
      const mi = missingImplementation.run({cwd: dir});

      // status-drift.ts's stale-start branch guards on `status === 'in_progress'`
      // specifically (planned was already silent pre-U7 — STALE_SPECIFICATION
      // owns the planned case). Asserting the silence here so a future edit that
      // widens STATUS_DRIFT to `planned` cannot pass unnoticed.
      expect(sd).toEqual([]);

      expect(ss).toHaveLength(1);
      expect(ss[0].severity).toBe('info');

      expect(mi).toHaveLength(1);
      expect(mi[0].severity).toBe('info');

      const all = [...sd, ...ss, ...mi];
      expect(all.filter((f) => f.severity === 'error' || f.severity === 'warn')).toEqual([]);
    });

    test('in_progress with modules declared but NONE on disk and NO acceptance_criteria either — still info, not the STATUS_DRIFT hollow-done error (hollow check is done-only)', () => {
      writeFeature(dir, 'F-003.yaml', 'id: F-003\ntitle: t\nstatus: in_progress\nmodules:\n  - src/d.ts\n');
      const sd = statusDrift.run({cwd: dir});
      expect(sd).toHaveLength(1);
      expect(sd[0].severity).toBe('info');
    });
  });

  // ─── AC-d8be9f4d — anti-regression: surgical demotion only ────────────────

  describe('AC-d8be9f4d — outside the window, severities are unchanged (surgical demotion)', () => {
    test('done + missing module → STATUS_DRIFT error (unchanged)', () => {
      writeFeature(dir, 'F-010.yaml', 'id: F-010\ntitle: t\nstatus: done\nmodules:\n  - src/gone.ts\n');
      const findings = statusDrift.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
    });

    test('hollow done (status=done, 0 modules, 0 acceptance_criteria) → STATUS_DRIFT error (unchanged)', () => {
      writeFeature(dir, 'F-011.yaml', 'id: F-011\ntitle: t\nstatus: done\n');
      const findings = statusDrift.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('hollow completion');
    });

    test('archived_at set but status != archived → STALE_SPECIFICATION warn + propose-archive (unchanged)', () => {
      writeFeature(dir, 'F-012.yaml', 'id: F-012\ntitle: t\nstatus: done\narchived_at: "2024-01-01T00:00:00Z"\n');
      const findings = staleSpecification.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warn');
      expect(findings[0].suggestion?.action).toBe('propose-archive');
    });

    test('superseded_by set but archived_at missing → STALE_SPECIFICATION warn + propose-archive (unchanged)', () => {
      writeFeature(dir, 'F-013.yaml', 'id: F-013\ntitle: t\nstatus: done\nsuperseded_by: F-014\n');
      const findings = staleSpecification.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warn');
      expect(findings[0].suggestion?.action).toBe('propose-archive');
    });

    test('archived with a surviving module still on disk → STALE_SPECIFICATION warn, no suggestion (unchanged)', () => {
      mkdirSync(join(dir, 'src'), {recursive: true});
      writeFileSync(join(dir, 'src', 'survivor.ts'), 'export const s = 1;\n');
      writeFeature(
        dir,
        'F-015.yaml',
        'id: F-015\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [src/survivor.ts]\n',
      );
      const findings = staleSpecification.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warn');
      expect(findings[0].suggestion).toBeUndefined();
    });

    test('archived feature with a missing module → MISSING_IMPLEMENTATION error (unchanged — archived keeps its only guard)', () => {
      writeFeature(dir, 'F-016.yaml', 'id: F-016\ntitle: t\nstatus: archived\nmodules: [src/legacy-gone.ts]\n');
      const findings = missingImplementation.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
    });

    test('[covers:F-c3747d7d/AC-d8be9f4d] outside the spec-first window STATUS_DRIFT stays error and STALE_SPECIFICATION stays warn', () => {
      writeFeature(dir, 'F-020.yaml', 'id: F-020\ntitle: t\nstatus: done\nmodules: [src/missing-020.ts]\n');
      writeFeature(dir, 'F-021.yaml', 'id: F-021\ntitle: t\nstatus: done\n');
      writeFeature(dir, 'F-022.yaml', 'id: F-022\ntitle: t\nstatus: done\narchived_at: "2024-01-01T00:00:00Z"\n');
      writeFeature(dir, 'F-023.yaml', 'id: F-023\ntitle: t\nstatus: done\nsuperseded_by: F-999\n');
      mkdirSync(join(dir, 'src'), {recursive: true});
      writeFileSync(join(dir, 'src', 'survivor-024.ts'), 'export const s = 1;\n');
      writeFeature(
        dir,
        'F-024.yaml',
        'id: F-024\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [src/survivor-024.ts]\n',
      );

      const status = statusDrift.run({cwd: dir});
      const stale = staleSpecification.run({cwd: dir});
      expect(status.some((f) => f.severity === 'error')).toBe(true);
      expect(stale.filter((f) => f.detector === 'STALE_SPECIFICATION')).toHaveLength(3);
      expect(stale.every((f) => f.severity === 'warn')).toBe(true);
    });
  });

  // ─── AC-c6b06ec4 — single-source predicate ────────────────────────────────

  describe('AC-c6b06ec4 — the window predicate is defined exactly once and consulted by reference, not by copy', () => {
    const SRC_ROOT = join(process.cwd(), 'src');

    function walkTsFiles(root: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(root)) {
        const abs = join(root, entry);
        const st = statSync(abs);
        if (st.isDirectory()) out.push(...walkTsFiles(abs));
        else if (extname(entry) === '.ts') out.push(abs);
      }
      return out;
    }

    test('[covers:F-c3747d7d/AC-c6b06ec4] isSpecFirstWindow is DEFINED in exactly one file (spec-first-window.ts) and IMPORTED by exactly the three window detectors', () => {
      const files = walkTsFiles(SRC_ROOT);
      const definitionSites = files.filter((f) => /function isSpecFirstWindow\s*\(/.test(readFileSync(f, 'utf8')));
      expect(definitionSites).toEqual([join(SRC_ROOT, 'stages', 'detectors', 'spec-first-window.ts')]);

      const importSites = files.filter((f) =>
        /import\s*\{\s*isSpecFirstWindow\s*\}\s*from\s*['"]\.\/spec-first-window\.js['"]/.test(
          readFileSync(f, 'utf8'),
        ),
      );
      const importerNames = importSites.map((f) => f.slice(SRC_ROOT.length + 1)).sort();
      expect(importerNames).toEqual([
        'stages/detectors/missing-implementation.ts',
        'stages/detectors/stale-specification.ts',
        'stages/detectors/status-drift.ts',
      ]);
    });

    test('the raw planned||in_progress window literal appears ONLY in the shared module — with one documented, out-of-scope exception (PLANNED_BACKLOG: an aggregate cadence count across the whole spec, not per-feature severity grading; predates F-c3747d7d and is not one of this shard'+"'"+'s three declared detectors)', () => {
      const files = walkTsFiles(SRC_ROOT);
      const literalPattern = /status\s*(?:===|!==)\s*['"]planned['"][^;\n]*(?:===|!==)\s*['"]in_progress['"]/;
      const hits = files
        .filter((f) => literalPattern.test(readFileSync(f, 'utf8')))
        .map((f) => f.slice(SRC_ROOT.length + 1))
        .sort();
      expect(hits).toEqual(['stages/detectors/planned-backlog.ts', 'stages/detectors/spec-first-window.ts']);
    });

    test('MUTATION PROBE: forcing the shared predicate to always return false demotes ALL THREE detectors off `info` in lockstep — proving none holds a hidden second copy', async () => {
      vi.resetModules();
      vi.doMock('../src/stages/detectors/spec-first-window.js', () => ({isSpecFirstWindow: () => false}));
      try {
        const {statusDrift: mutatedStatusDrift} = await import('../src/stages/detectors/status-drift.js');
        const {staleSpecification: mutatedStaleSpec} = await import(
          '../src/stages/detectors/stale-specification.js'
        );
        const {missingImplementation: mutatedMissingImpl} = await import(
          '../src/stages/detectors/missing-implementation.js'
        );

        writeFeature(dir, 'F-050.yaml', 'id: F-050\ntitle: t\nstatus: in_progress\nmodules:\n  - src/x.ts\n  - src/y.ts\n');

        const sd = mutatedStatusDrift.run({cwd: dir});
        const ss = mutatedStaleSpec.run({cwd: dir});
        const mi = mutatedMissingImpl.run({cwd: dir});

        // With the shared predicate neutralized to always-false, every detector's
        // behavior must visibly change from its pre-mutation (info-graded) shape —
        // that visible change IS the proof each one consults the LIVE shared
        // binding rather than a hidden independent copy (a hidden copy would keep
        // reproducing the old behavior untouched by this mutation).
        //
        // status-drift.ts: the firing condition is `status === 'in_progress' &&
        // all-missing` (a literal, NOT routed through isSpecFirstWindow) — only the
        // SEVERITY is chosen via the ternary `isSpecFirstWindow(...) ? info : warn`.
        // So it still fires, but flips info → warn.
        expect(sd).toHaveLength(1);
        expect(sd[0].severity).toBe('warn');

        // stale-specification.ts: isSpecFirstWindow(...) is folded INTO the firing
        // condition itself (`isSpecFirstWindow(f.status) && modules>0 && all-missing`),
        // not a separate severity selector — so neutralizing it to always-false
        // makes the whole branch not fire at all. Zero findings (not "still 1, at
        // warn") is the correct post-mutation shape for THIS detector's actual
        // structure, and it is just as valid a proof: the output changed (1 info →
        // 0) in lockstep with the same one-line mutation.
        expect(ss).toEqual([]);

        // missing-implementation.ts: the per-module loop is unconditional; only
        // missingModuleFinding()'s severity depends on isSpecFirstWindow. Still
        // fires once per missing module, now all at error.
        expect(mi).toHaveLength(2);
        expect(mi.every((f) => f.severity === 'error')).toBe(true);

        // The headline claim: ONE mutation to ONE shared module measurably moved
        // ALL THREE detectors off their info grade simultaneously (warn / absent /
        // error respectively) — only possible because none of them holds its own
        // independent copy of the window logic (AC-c6b06ec4).
      } finally {
        vi.doUnmock('../src/stages/detectors/spec-first-window.js');
        vi.resetModules();
      }
    });
  });

  // ─── AC-d574a481 — plain-lead accuracy ────────────────────────────────────

  describe('AC-d574a481 — plain leads are accurate for every surviving shown sub-case', () => {
    test('STALE_SPECIFICATION lead no longer contains the over-specific "archived but still marked active" example, and does not name "archived" at all (the property that made the old lead wrong for 2 of its 3 surviving sub-cases)', () => {
      const lead = DETECTOR_PLAIN.STALE_SPECIFICATION.lead;
      expect(lead).not.toContain('archived but still marked active');
      expect(lead).not.toMatch(/archived/i);
      // Pin the actual replacement copy (documents the regression, not just the
      // absence of the old string).
      expect(lead).toBe("A feature's lifecycle labels don't match its actual state");
    });

    test('the STALE_SPECIFICATION lead is not contradicted by any of the three real surviving warn sub-cases', () => {
      // sub-case 1: archived_at set, status != archived (no "archived" status at all)
      writeFeature(dir, 'F-030.yaml', 'id: F-030\ntitle: t\nstatus: done\narchived_at: "2024-01-01T00:00:00Z"\n');
      // sub-case 2: superseded_by without archived_at (nothing "archived" in sight)
      writeFeature(dir, 'F-031.yaml', 'id: F-031\ntitle: t\nstatus: done\nsuperseded_by: F-999\n');
      // sub-case 3: status IS archived, with a surviving module (the opposite of
      // the old lead's "still marked active")
      mkdirSync(join(dir, 'src'), {recursive: true});
      writeFileSync(join(dir, 'src', 'survivor-032.ts'), 'export const s = 1;\n');
      writeFeature(
        dir,
        'F-032.yaml',
        'id: F-032\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [src/survivor-032.ts]\n',
      );

      const findings = staleSpecification.run({cwd: dir});
      const warns = findings.filter((f) => f.severity === 'warn');
      expect(warns).toHaveLength(3);

      // The generic lead ("lifecycle labels don't match actual state") makes no
      // claim about archived_at, status='active', or any specific mechanism, so
      // it cannot be falsified by any of these three concrete triggers — unlike
      // the old lead, which was literally false for sub-cases 2 and 3.
      const lead = DETECTOR_PLAIN.STALE_SPECIFICATION.lead;
      expect(lead).not.toMatch(/archived/i);
      expect(lead).not.toMatch(/still marked active/i);
    });

    test('[covers:F-c3747d7d/AC-d574a481] STATUS_DRIFT and every STALE_SPECIFICATION sub-case retain accurate human-facing leads', () => {
      expect(DETECTOR_PLAIN.STATUS_DRIFT.lead).toBe(
        'A feature is marked done but its files or checks do not back that up',
      );

      writeFeature(dir, 'F-040.yaml', 'id: F-040\ntitle: t\nstatus: done\nmodules: [src/missing-040.ts]\n');
      const findings = statusDrift.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(DETECTOR_PLAIN.STALE_SPECIFICATION.lead).toBe("A feature's lifecycle labels don't match its actual state");
      expect(DETECTOR_PLAIN.STALE_SPECIFICATION.lead).not.toMatch(/archived|active/i);
      expect(plainFinding(findings[0]!)).toContain(DETECTOR_PLAIN.STATUS_DRIFT.lead);

      writeFeature(dir, 'F-041.yaml', 'id: F-041\ntitle: t\nstatus: done\narchived_at: "2024-01-01T00:00:00Z"\n');
      writeFeature(dir, 'F-042.yaml', 'id: F-042\ntitle: t\nstatus: done\nsuperseded_by: F-041\n');
      mkdirSync(join(dir, 'src'), {recursive: true});
      writeFileSync(join(dir, 'src', 'survivor-043.ts'), 'export const s = 1;\n');
      writeFeature(
        dir,
        'F-043.yaml',
        'id: F-043\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [src/survivor-043.ts]\n',
      );
      const stale = staleSpecification.run({cwd: dir});
      expect(stale).toHaveLength(3);
      for (const finding of stale) {
        expect(finding.severity).toBe('warn');
        expect(plainFinding(finding)).toContain(DETECTOR_PLAIN.STALE_SPECIFICATION.lead);
      }
      // The lead's claim (done, but files/checks don't back it up) is exactly
      // what this fixture constructs — no other STATUS_DRIFT branch is shown on
      // a human surface post-U7 (the in_progress stale-start branch is info now).
    });

    test('every registered-detector plain lead stays present for STATUS_DRIFT and STALE_SPECIFICATION (no accidental row deletion)', () => {
      expect(DETECTOR_PLAIN.STATUS_DRIFT?.lead.length).toBeGreaterThan(0);
      expect(DETECTOR_PLAIN.STALE_SPECIFICATION?.lead.length).toBeGreaterThan(0);
    });
  });
});
