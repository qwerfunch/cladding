// Cladding · scenarios · ab-extended · case dashboard (v0.3.52, F-ef2fd9)
//
// Second large-scale A/B scenario: a 30-feature React analytics
// dashboard. Validates that cladding's value (drift catch + AI-query
// efficiency + spec-rich governance) generalizes across domains. Same
// framework, same milestones, different React app.

import {afterEach, beforeEach, describe, test} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {existsSync, mkdirSync, rmSync} from 'node:fs';

import {
  DASHBOARD_FEATURES,
  MILESTONES,
  featuresAtMilestone,
} from './_feature-set-dashboard.js';
import {curate} from './_curator-dashboard.js';
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
  'docs/ab-evaluation-extended/scenarios/dashboard/report.md',
);
const COMMITTED_CLADDING_DIR = join(
  REPO_ROOT,
  'docs/ab-evaluation-extended/scenarios/dashboard/cladding',
);
const COMMITTED_VANILLA_DIR = join(
  REPO_ROOT,
  'docs/ab-evaluation-extended/scenarios/dashboard/vanilla',
);

describe('A/B-extended · dashboard — 30-feature analytics dashboard at scale', () => {
  let aCwd: ReturnType<typeof mkScenarioCwd>;
  let bCwd: ReturnType<typeof mkScenarioCwd>;

  beforeEach(() => {
    aCwd = mkScenarioCwd('clad-ab-ext-dash-a-');
    bCwd = mkScenarioCwd('clad-ab-ext-dash-b-');
  });

  afterEach(() => {
    aCwd.cleanup();
    bCwd.cleanup();
  });

  test('30-feature dashboard — progression + drift + AI queries', async () => {
    const snapshots: PerfSnapshot[] = [];

    for (const milestone of MILESTONES) {
      const features = featuresAtMilestone(milestone);
      curate('cladding', aCwd.path, features);
      curate('vanilla', bCwd.path, features);
      snapshots.push(capturePerfSnapshot('A', milestone, aCwd.path));
      snapshots.push(capturePerfSnapshot('B', milestone, bCwd.path));
    }

    // Pick a representative feature for drift-injection (metric-card has a single TSX module).
    const metricFeature = DASHBOARD_FEATURES.find((f) => f.slug === 'metric-card')!;
    const metricShard = `spec/features/${metricFeature.slug}-${metricFeature.id.replace('F-', '')}.yaml`;

    const driftResults = [
      // DI-1 — rename a real source file.
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
      // DI-2 — lib must not import from components per architecture.yaml.
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
      // DI-3 baseline.
      captureDriftCatch(aCwd.path, 'A', makeHardcodedSecretDrift('src/lib/export-config.ts')),
      captureDriftCatch(bCwd.path, 'B', makeHardcodedSecretDrift('src/lib/export-config.ts')),
      // DI-4 — A only (vanilla has no AC concept).
      captureDriftCatch(
        aCwd.path,
        'A',
        makeUntestedAcDrift(metricShard, 'AC-003', 'Untested AC added to verify MISSING_TESTS fires.'),
      ),
    ];

    const queryOpts = {featureKeyword: 'metric-card', featureLabel: 'metric card feature'};
    const queryResults = new Map<'A' | 'B', readonly ReturnType<typeof answerAllQueries>[number][]>([
      ['A', answerAllQueries(aCwd.path, queryOpts)],
      ['B', answerAllQueries(bCwd.path, queryOpts)],
    ]);

    const report = renderExtendedReport({
      scenarioTitle: 'dashboard (React + Vite + TS + Tailwind)',
      scenarioSlug: 'dashboard',
      intent: 'Build a 30-feature analytics dashboard — cards, charts, alerts, preferences',
      description: [
        'Scenario 2 of the A/B-extended evaluation. Same React + Vite + TS + Tailwind stack as',
        'task-manager, different domain — an analytics dashboard with metric cards, charts',
        '(line/bar/pie/area/sparkline as inline SVG), alerts, and preferences.',
        '',
        'The 30 features map to 5 capability groups: layout (8), cards (8), charts (5),',
        'data flow (5), preferences (4). Both groups ship the same React app source; only the',
        'cladding governance layer differs.',
      ].join('\n'),
      hypotheses: [
        'H9 — Cladding scales linearly across DOMAINS as well as across features (task-manager + dashboard both stay near 0.55 spec/code ratio).',
        'H10 — AI-query benchmark answers ≤1 file in cladding at N=30 regardless of domain.',
        'H11 — Drift catch rate (3/4 cladding-exclusive at task-manager M30) is preserved at dashboard M30.',
        'H12 — Snapshot capture duration stays bounded across both scenarios.',
      ],
      snapshots,
      driftResults,
      queryResults,
    });

    writeOrAssertReport(REPORT_PATH, report);

    if (process.env.UPDATE_AB_REPORTS === '1') {
      for (const dir of [COMMITTED_CLADDING_DIR, COMMITTED_VANILLA_DIR]) {
        if (existsSync(dir)) rmSync(dir, {recursive: true, force: true});
        mkdirSync(dir, {recursive: true});
      }
      curate('cladding', COMMITTED_CLADDING_DIR);
      curate('vanilla', COMMITTED_VANILLA_DIR);
    }
  }, 120_000);
});
