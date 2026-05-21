// Cladding · scenarios · ab-extended · case task-manager (v0.3.49, F-0144b9)
//
// Large-scale A/B evaluation case: a 30-feature React + Vite + TS +
// Tailwind task manager built progressively. Two groups (cladding +
// vanilla) develop the same 30 features against the same React stack;
// the only delta is cladding's governance layer.
//
// At 7 milestones (1, 5, 10, 15, 20, 25, 30 features) we snapshot both
// trees via the existing `captureSnapshot` + new performance meter, then
// at M30 we apply 4 drift-injection scenarios and 5 AI-query benchmarks.
// All measurements feed into a deterministic markdown report committed
// to `docs/ab-evaluation-extended/scenarios/task-manager/report.md`.
//
// As a side effect of UPDATE_AB_REPORTS=1, the test also writes the
// fully-curated M30 React projects to
// `docs/ab-evaluation-extended/scenarios/task-manager/{cladding,vanilla}/`
// so reviewers can `cd` in and run them.

import {afterEach, beforeEach, describe, test} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {existsSync, mkdirSync, rmSync} from 'node:fs';

import {
  TASK_MANAGER_FEATURES,
  MILESTONES,
  featuresAtMilestone,
} from './_feature-set.js';
import {curate} from './_curator.js';
import {capturePerfSnapshot, type PerfSnapshot} from './_perf-meter.js';
import {renderExtendedReport, writeOrAssertReport} from './_report-extended.js';

import {mkScenarioCwd} from '../_helpers.js';
import {
  captureDriftCatch,
  makeStaleReferenceDrift,
  makeArchitectureViolationDrift,
  makeHardcodedSecretDrift,
  makeUntestedAcDrift,
} from '../ab/_drift-injection.js';
import {answerAllQueries} from '../ab/_query-bench.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = HERE.replace(/\/tests\/scenarios\/ab-extended$/, '');
const REPORT_PATH = join(
  REPO_ROOT,
  'docs/ab-evaluation-extended/scenarios/task-manager/report.md',
);
const COMMITTED_CLADDING_DIR = join(
  REPO_ROOT,
  'docs/ab-evaluation-extended/scenarios/task-manager/cladding',
);
const COMMITTED_VANILLA_DIR = join(
  REPO_ROOT,
  'docs/ab-evaluation-extended/scenarios/task-manager/vanilla',
);

describe('A/B-extended · task-manager — 30-feature React app at scale', () => {
  let aCwd: ReturnType<typeof mkScenarioCwd>;
  let bCwd: ReturnType<typeof mkScenarioCwd>;

  beforeEach(() => {
    aCwd = mkScenarioCwd('clad-ab-ext-tm-a-');
    bCwd = mkScenarioCwd('clad-ab-ext-tm-b-');
  });

  afterEach(() => {
    aCwd.cleanup();
    bCwd.cleanup();
  });

  test('30-feature task-manager — progression snapshots, drift catches at M30, AI queries pass', async () => {
    const snapshots: PerfSnapshot[] = [];

    // ── Milestone progression ────────────────────────────────────
    // For each milestone, curate the project state with features[0..N],
    // then snapshot both groups. This produces 7 snapshots × 2 groups
    // = 14 PerfSnapshots total.
    for (const milestone of MILESTONES) {
      const features = featuresAtMilestone(milestone);
      curate('cladding', aCwd.path, features);
      curate('vanilla', bCwd.path, features);
      snapshots.push(capturePerfSnapshot('A', milestone, aCwd.path));
      snapshots.push(capturePerfSnapshot('B', milestone, bCwd.path));
    }

    // At this point both tmpdirs contain the full M30 state.

    // ── Drift Injection at M30 (4 scenarios × 2 groups) ──────────
    const refundFeature = TASK_MANAGER_FEATURES.find((f) => f.slug === 'add-task')!;
    const refundShardPath = `spec/features/${refundFeature.slug}-${refundFeature.id.replace('F-', '')}.yaml`;

    const driftResults = [
      // DI-1 stale module — rename src/components/Header.tsx (a real module).
      captureDriftCatch(
        aCwd.path,
        'A',
        makeStaleReferenceDrift('src/components/Header.tsx', 'src/components/Header.RENAMED.tsx'),
      ),
      captureDriftCatch(
        bCwd.path,
        'B',
        makeStaleReferenceDrift('src/components/Header.tsx', 'src/components/Header.RENAMED.tsx'),
      ),
      // DI-2 architecture violation — lib must not import from components,
      // per the architecture.yaml forbidden_imports we curated.
      captureDriftCatch(
        aCwd.path,
        'A',
        makeArchitectureViolationDrift('src/lib/filter.ts', '../components/Header'),
      ),
      captureDriftCatch(
        bCwd.path,
        'B',
        makeArchitectureViolationDrift('src/lib/filter.ts', '../components/Header'),
      ),
      // DI-3 hardcoded secret baseline.
      captureDriftCatch(aCwd.path, 'A', makeHardcodedSecretDrift('src/lib/export-import.ts')),
      captureDriftCatch(bCwd.path, 'B', makeHardcodedSecretDrift('src/lib/export-import.ts')),
      // DI-4 untested AC on cladding only.
      captureDriftCatch(
        aCwd.path,
        'A',
        makeUntestedAcDrift(refundShardPath, 'AC-003', 'New AC added without a matching test_ref.'),
      ),
    ];

    // ── AI query benchmark at M30 ─────────────────────────────────
    // v0.3.52 (F-ae61c1): Q1/Q2 now parameterizable. task-manager has
    // no 'refund flow' — point them at 'add-task' instead so the
    // benchmark measures cladding's lookup efficiency for an actual
    // domain feature in this scenario.
    const queryOpts = {featureKeyword: 'add-task', featureLabel: 'add-task flow'};
    const queryResults = new Map<'A' | 'B', readonly ReturnType<typeof answerAllQueries>[number][]>([
      ['A', answerAllQueries(aCwd.path, queryOpts)],
      ['B', answerAllQueries(bCwd.path, queryOpts)],
    ]);

    // ── Render report + (optionally) commit projects ─────────────
    const report = renderExtendedReport({
      scenarioTitle: 'task-manager (React + Vite + TS + Tailwind)',
      scenarioSlug: 'task-manager',
      intent: 'Build a 30-feature task manager — todos, categories, tags, filters, dark mode, persistence',
      description: [
        'Two groups develop the same 30-feature React task manager. **Cladding** group gets full',
        'governance scaffold (spec.yaml, 30 sharded feature files, architecture.yaml,',
        'capabilities.yaml, project-context.md, conventions.md). **Vanilla** group ships the same',
        'React app source without governance.',
        '',
        'Both groups are runnable React + Vite + TS + Tailwind projects. The 30 features map to',
        'a real React component graph (App → TaskList / FilterBar / CategoryManager / ThemeToggle',
        '/ TaskDetailModal …) — not stubs. Run `npm install && npm run dev` in either group to',
        'see the same UI.',
      ].join('\n'),
      hypotheses: [
        'H9 — Cladding scales linearly with feature count; spec/code ratio stays bounded.',
        'H10 — AI agent file-lookup cost stays ≤1 file per query in cladding at N=30; vanilla grows O(N).',
        'H11 — Drift catch rate (75% cladding-exclusive in F-ba2e05) is preserved at N=30.',
        'H12 — Snapshot capture duration scales with tree size, not feature count — bounded.',
      ],
      snapshots,
      driftResults,
      queryResults,
    });

    // Always write/assert the report.
    writeOrAssertReport(REPORT_PATH, report);

    // Under UPDATE_AB_REPORTS=1, also overwrite the committed M30 React
    // projects so reviewers can cd in and run them. (Snapshot tests
    // pin file content via the report; the React project files are
    // committed but not byte-asserted — vite/tailwind/react versions
    // shift naturally over time.)
    if (process.env.UPDATE_AB_REPORTS === '1') {
      // Clean + recurate to ensure no stale files.
      for (const dir of [COMMITTED_CLADDING_DIR, COMMITTED_VANILLA_DIR]) {
        if (existsSync(dir)) rmSync(dir, {recursive: true, force: true});
        mkdirSync(dir, {recursive: true});
      }
      curate('cladding', COMMITTED_CLADDING_DIR);
      curate('vanilla', COMMITTED_VANILLA_DIR);
    }
  }, 120_000);
});
