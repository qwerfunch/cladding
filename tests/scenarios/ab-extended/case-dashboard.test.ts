// Cladding · scenarios · ab-extended · case dashboard (v0.3.52, F-ef2fd9)
//
// Second large-scale A/B scenario: a 30-feature React analytics
// dashboard. Validates that cladding's value (drift catch + AI-query
// efficiency + spec-rich governance) generalizes across domains. Same
// framework, same milestones, different React app.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

// Host-tool determinism (CI break, 2026-06-11): the deterministic battery must
// not depend on which external scanners (madge, secretlint) the HOST happens to
// resolve — stale ~/.npm/_npx caches made detector counts machine-dependent.
// Strip the external-scanner gates; their detectors then emit the stable
// "no validator registered" info on every machine.
vi.mock('../../../src/stages/toolchain/detect.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/stages/toolchain/detect.js')>();
  return {
    ...real,
    detectToolchain: (cwd: string = '.') => {
      const t = real.detectToolchain(cwd);
      const gates = {...t.gates} as Record<string, unknown>;
      delete gates.arch;
      delete gates.secret;
      return {...t, gates} as ReturnType<typeof real.detectToolchain>;
    },
  };
});
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';

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

  test("30-feature dashboard — progression + drift + AI queries", async () => {
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

  test('[covers:F-ef2fd9/AC-002] dashboard feature records have 30 deterministic ids across five categories', () => {
    expect(DASHBOARD_FEATURES).toHaveLength(30);
    expect(new Set(DASHBOARD_FEATURES.map((feature) => feature.category))).toEqual(
      new Set(['layout', 'cards', 'charts', 'data', 'preferences']),
    );
    for (const feature of DASHBOARD_FEATURES) {
      const expectedId = `F-${createHash('sha256').update(`dashboard:${feature.slug}`).digest('hex').slice(0, 6)}`;
      expect(feature.id).toBe(expectedId);
    }
  });

  test('[covers:F-ef2fd9/AC-003] dashboard curator writes a complete React project for both groups', () => {
    curate('cladding', aCwd.path);
    curate('vanilla', bCwd.path);
    for (const cwd of [aCwd.path, bCwd.path]) {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(pkg.dependencies.react).toMatch(/^\^19\./);
      expect(pkg.devDependencies.vite).toMatch(/^\^6\./);
      expect(existsSync(join(cwd, 'src', 'components', 'MetricCard.tsx'))).toBe(true);
      expect(existsSync(join(cwd, 'src', 'components', 'charts', 'LineChart.tsx'))).toBe(true);
    }
  });

  test('[covers:F-ef2fd9/AC-004] dashboard keeps the shared seven-milestone case shape and metric-card query', () => {
    expect(MILESTONES).toEqual([1, 5, 10, 15, 20, 25, 30]);
    curate('cladding', aCwd.path, featuresAtMilestone(30));
    const answers = answerAllQueries(aCwd.path, {featureKeyword: 'metric-card', featureLabel: 'metric card feature'});
    expect(answers.slice(0, 2).map((answer) => answer.question)).toEqual([
      'Which feature implements the metric card feature?',
      'How many acceptance criteria does the metric card feature have?',
    ]);
    expect(answers.slice(0, 2).every((answer) => answer.answered)).toBe(true);
  });

  test('[covers:F-ef2fd9/AC-005] M30 dashboard curation emits complete projects for both groups', () => {
    curate('cladding', aCwd.path);
    curate('vanilla', bCwd.path);
    for (const cwd of [aCwd.path, bCwd.path]) {
      expect(existsSync(join(cwd, 'package.json'))).toBe(true);
      expect(existsSync(join(cwd, 'src', 'App.tsx'))).toBe(true);
      expect(existsSync(join(cwd, 'tests', 'app-shell.test.tsx'))).toBe(true);
    }
  });

  test('[covers:F-f334fa/AC-002] dashboard curation emits exactly three user-journey scenario shards', () => {
    curate('cladding', aCwd.path);
    const scenarios = readdirSync(join(aCwd.path, 'spec', 'scenarios')).filter((name) => name.endsWith('.yaml'));
    expect(scenarios).toHaveLength(3);
    for (const scenario of scenarios) expect(readFileSync(join(aCwd.path, 'spec', 'scenarios', scenario), 'utf8')).toContain('features: [F-');
  });
});
