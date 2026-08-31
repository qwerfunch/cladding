// Cladding · scenarios · ab · contract proofs (F-4db939)
//
// The two case suites are intentionally end-to-end and therefore broad. These
// focused proofs keep each original A/B-evaluation acceptance criterion bound
// to the complete contract it names, rather than to one lifecycle leaf.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

import {copyFixture, mkScenarioCwd, readUnderCwd, writeUnderCwd} from '../_helpers.js';
import {captureSnapshot, diffToRows, type AbSnapshot} from './_ab-metrics.js';
import {renderCaseReport, type OutcomeReportInput} from './_report.js';
import type {QueryAnswer} from './_query-bench.js';
import {
  applyFileSet,
  VANILLA_EXISTING_ADOPTION_SESSION,
  VANILLA_PAYMENT_SAAS_SESSION,
} from './_vanilla-sim.js';

function written(cwd: string, relPath: string): string {
  const body = readUnderCwd(cwd, relPath);
  expect(body, `${relPath} must be materialized by the vanilla session`).not.toBeNull();
  return body as string;
}

function contractSnapshot(group: 'A' | 'B', milestone: 'M1' | 'M2', n: number): AbSnapshot {
  return {
    group,
    milestone,
    cwd: `/tmp/${group.toLowerCase()}-${milestone.toLowerCase()}`,
    tieredArtifactCount: {tierA: n, tierB: n + 1, tierC: n + 2, tierD: n + 3},
    specCompleteness: {
      hasSpecYaml: true,
      hasArchitectureYaml: true,
      hasCapabilitiesYaml: true,
      features: n,
      acceptanceCriteria: n + 1,
      scenarios: n + 2,
      capabilities: n + 3,
      capabilitiesBound: n + 4,
    },
    layerCompliance: {layersDeclared: n + 5, forbiddenImportRules: n + 6},
    crossDocConsistency: {
      errors: n + 7,
      warnings: n + 8,
      infos: n + 9,
      errorSamples: [`error-${n}`],
    },
    documentation: {
      tieredDocs: {lines: n + 10, chars: n + 11, estTokens: n + 12},
      otherDocs: {lines: n + 13, chars: n + 14, estTokens: n + 15},
      tieredDocFiles: n + 16,
      otherDocFiles: n + 17,
    },
    codeStructure: {
      sourceFiles: n + 18,
      testFiles: n + 19,
      totalSourceLoc: n + 20,
      totalTestLoc: n + 21,
    },
    tokenConsumption: {lines: n + 22, chars: n + 23, estTokens: n + 24},
    testCoverage: {testFiles: n + 25, testCases: n + 26},
  };
}

function contractOutcome(): OutcomeReportInput {
  const result = (group: 'A' | 'B', scenarioId: 'DI-1' | 'DI-4', scenarioName: string) => ({
    scenarioId,
    scenarioName,
    group,
    beforeCounts: {errors: 0, warns: 0, infos: 0},
    afterCounts: {errors: 0, warns: group === 'A' ? 1 : 0, infos: 0},
    newFindings: group === 'A' ? [{detector: 'MISSING_IMPLEMENTATION', severity: 'warn' as const, message: 'stale'}] : [],
    caught: group === 'A',
    newDetectors: group === 'A' ? ['MISSING_IMPLEMENTATION'] : [],
  });
  return {
    driftResults: [
      result('A', 'DI-1', 'Stale module reference'),
      result('B', 'DI-1', 'Stale module reference'),
      result('A', 'DI-4', 'Unverified criterion'),
    ],
    queryResults: new Map<'A' | 'B', readonly QueryAnswer[]>([
      ['A', [{questionId: 'Q1', question: 'Where is the feature?', answered: true, filesOpened: 1, answer: 'F-contract'}]],
      ['B', [{questionId: 'Q1', question: 'Where is the feature?', answered: false, filesOpened: 0, answer: 'not found'}]],
    ]),
  };
}

describe('A/B evaluation contract proofs', () => {
  test('[covers:F-4db939/AC-001] captureSnapshot quantifies all eight metric dimensions in one populated tmpdir', () => {
    const scenario = mkScenarioCwd('clad-ab-contract-metrics-');
    try {
      writeUnderCwd(scenario.path, 'spec.yaml', '# Cladding · Tier A\nschema: "0.1"\nfeatures: []\n');
      writeUnderCwd(
        scenario.path,
        'spec/architecture.yaml',
        '# Cladding · Tier A\nlayers:\n  - name: api\n    forbidden_imports: [lib]\n  - name: lib\n    forbidden_imports: []\n',
      );
      writeUnderCwd(
        scenario.path,
        'spec/capabilities.yaml',
        '# Cladding · Tier A\ncapabilities:\n  - id: payments\n    features: [F-4db939]\n',
      );
      writeUnderCwd(
        scenario.path,
        'spec/features/refund-flow.yaml',
        '# Cladding · Tier A\nid: F-4db939\nacceptance_criteria:\n  - id: AC-001\n    text: Refunds work.\n',
      );
      writeUnderCwd(scenario.path, 'spec/scenarios/refund.yaml', 'slug: refund-flow\n');
      writeUnderCwd(scenario.path, 'spec/scenarios/README.md', '# Cladding · Tier D\n# Scenarios\n');
      writeUnderCwd(scenario.path, 'docs/project-context.md', '# Cladding · Tier B\n# Context\n');
      writeUnderCwd(scenario.path, 'docs/conventions.md', '# Cladding · Tier C\n# Conventions\n');
      writeUnderCwd(scenario.path, '.cladding/onboarding/state.yaml', '# Cladding · Tier A\nmode: greenfield\n');
      writeUnderCwd(scenario.path, 'README.md', '# Refund service\n');
      writeUnderCwd(scenario.path, 'src/api/refund.ts', 'export const refund = () => "ok";');
      writeUnderCwd(
        scenario.path,
        'tests/refund.test.ts',
        'test("refund works", () => {});\nit("refund is observable", () => {});',
      );

      const snapshot = captureSnapshot('A', 'M1', scenario.path);

      expect(snapshot.tieredArtifactCount).toEqual({tierA: 5, tierB: 1, tierC: 1, tierD: 1});
      expect(snapshot.specCompleteness).toMatchObject({
        hasSpecYaml: true,
        hasArchitectureYaml: true,
        hasCapabilitiesYaml: true,
        features: 1,
        acceptanceCriteria: 1,
        scenarios: 1,
        capabilities: 1,
        capabilitiesBound: 1,
      });
      expect(snapshot.layerCompliance).toEqual({layersDeclared: 2, forbiddenImportRules: 1});
      expect(snapshot.crossDocConsistency).toMatchObject({
        errors: expect.any(Number),
        warnings: expect.any(Number),
        infos: expect.any(Number),
        errorSamples: expect.any(Array),
      });
      expect(snapshot.documentation).toMatchObject({
        tieredDocFiles: 3,
        otherDocFiles: 1,
        tieredDocs: {lines: expect.any(Number), chars: expect.any(Number), estTokens: expect.any(Number)},
        otherDocs: {lines: expect.any(Number), chars: expect.any(Number), estTokens: expect.any(Number)},
      });
      expect(snapshot.codeStructure).toEqual({sourceFiles: 1, testFiles: 1, totalSourceLoc: 1, totalTestLoc: 2});
      expect(snapshot.tokenConsumption).toMatchObject({
        lines: expect.any(Number),
        chars: expect.any(Number),
        estTokens: expect.any(Number),
      });
      expect(snapshot.tokenConsumption.chars).toBeGreaterThan(0);
      expect(snapshot.testCoverage).toEqual({testFiles: 1, testCases: 2});

      expect(diffToRows(snapshot, snapshot).map((row) => row.label)).toEqual(
        expect.arrayContaining([
          'Tier A artifacts',
          'Spec features',
          'Architecture layers',
          'Detector errors',
          'Tiered doc files',
          'Source TS files',
          'Estimated tokens',
          'Test cases',
        ]),
      );
    } finally {
      scenario.cleanup();
    }
  });

  test('[covers:F-4db939/AC-002] both pre-curated vanilla sessions materialize their promised M1 and M2 artifacts', () => {
    const payment = mkScenarioCwd('clad-ab-contract-payment-');
    const existing = mkScenarioCwd('clad-ab-contract-existing-');
    try {
      applyFileSet(payment.path, VANILLA_PAYMENT_SAAS_SESSION.m1Files);
      applyFileSet(payment.path, VANILLA_PAYMENT_SAAS_SESSION.m2Files);

      expect([...VANILLA_PAYMENT_SAAS_SESSION.m1Files.keys(), ...VANILLA_PAYMENT_SAAS_SESSION.m2Files.keys()].sort()).toEqual([
        '.gitignore',
        'README.md',
        'package.json',
        'src/api/payment.ts',
        'src/api/refund.ts',
        'src/lib/pg-refund.ts',
        'src/lib/pg.ts',
        'src/util/log.ts',
        'tests/payment.test.ts',
        'tests/refund.test.ts',
        'tsconfig.json',
      ]);
      expect(JSON.parse(written(payment.path, 'package.json'))).toMatchObject({
        scripts: {test: 'vitest run'},
        dependencies: {zod: '^3.23.8'},
      });
      expect(written(payment.path, 'README.md')).toContain('## API');
      expect(written(payment.path, 'src/api/payment.ts')).toContain('export async function handlePayment');
      expect(written(payment.path, 'src/api/refund.ts')).toContain('export async function handleRefund');
      expect(written(payment.path, 'src/lib/pg.ts')).toContain('export async function chargeViaPg');
      expect(written(payment.path, 'src/lib/pg-refund.ts')).toContain('export async function refundViaPg');
      expect(written(payment.path, 'src/util/log.ts')).toContain('export function log');
      expect(written(payment.path, 'tests/payment.test.ts')).toContain("test('handlePayment rejects invalid amount'");
      expect(written(payment.path, 'tests/refund.test.ts')).toContain("test('handleRefund rejects empty transaction id'");

      copyFixture('sample-existing-ts', existing.path);
      applyFileSet(existing.path, VANILLA_EXISTING_ADOPTION_SESSION.m1Files);
      applyFileSet(existing.path, VANILLA_EXISTING_ADOPTION_SESSION.m2Files);

      expect([...VANILLA_EXISTING_ADOPTION_SESSION.m1Files.keys(), ...VANILLA_EXISTING_ADOPTION_SESSION.m2Files.keys()].sort()).toEqual([
        'README.md',
        'src/api/refund.ts',
        'src/lib/refund.ts',
        'tests/refund.test.ts',
      ]);
      expect(written(existing.path, 'README.md')).toContain('## Modules');
      expect(written(existing.path, 'src/api/refund.ts')).toContain('export async function handleRefund');
      expect(written(existing.path, 'src/lib/refund.ts')).toContain('export async function processRefund');
      expect(written(existing.path, 'tests/refund.test.ts')).toContain("test('handleRefund fails empty transaction id'");
      expect(written(existing.path, 'src/api/index.ts')).toContain('export {getLedger};');
    } finally {
      payment.cleanup();
      existing.cleanup();
    }
  });

  test('[covers:F-4db939/AC-003] both case files inventory and exercise M1 and M2 for Cladding and Vanilla', () => {
    const cases = [
      {
        file: 'tests/scenarios/ab/case-payment-saas.test.ts',
        session: 'VANILLA_PAYMENT_SAAS_SESSION',
        fixture: null,
        mockedResponse: 'GREENFIELD_S1_RESPONSE',
        capabilityBinding: "replace('features: [F-001]', 'features: [F-4db939]')",
      },
      {
        file: 'tests/scenarios/ab/case-existing-adoption.test.ts',
        session: 'VANILLA_EXISTING_ADOPTION_SESSION',
        fixture: 'sample-existing-ts',
        mockedResponse: 'EXISTING_S2_RESPONSE',
        capabilityBinding: "apiCap.features = ['F-4db939'];",
      },
    ] as const;

    for (const scenario of cases) {
      const body = readFileSync(join(process.cwd(), scenario.file), 'utf8');
      expect(body).toContain(`const {${scenario.session}, applyFileSet} = await import('./_vanilla-sim.js');`);
      expect(body).toContain(scenario.mockedResponse);
      expect(body).toContain(`await runInit({cwd: aCwd.path, intent: ${scenario.session}.intent});`);
      expect(body).toContain(`applyFileSet(bCwd.path, ${scenario.session}.m1Files);`);
      expect(body).toContain(`applyFileSet(bCwd.path, ${scenario.session}.m2Files);`);
      expect(body).toContain("const m1A = captureSnapshot('A', 'M1', aCwd.path);");
      expect(body).toContain("const m1B = captureSnapshot('B', 'M1', bCwd.path);");
      expect(body).toContain("const m2A = captureSnapshot('A', 'M2', aCwd.path);");
      expect(body).toContain("const m2B = captureSnapshot('B', 'M2', bCwd.path);");
      expect(body).toContain('writeOrAssertReport(REPORT_PATH, report);');
      expect(body).toContain('renderCaseReport({');
      expect(body).toContain("'spec/features/refund-flow-4db939.yaml'");
      expect(body).toContain(scenario.capabilityBinding);
      if (scenario.fixture) {
        expect(body).toContain(`copyFixture('${scenario.fixture}', aCwd.path);`);
        expect(body).toContain(`copyFixture('${scenario.fixture}', bCwd.path);`);
      }
    }
  });

  test('[covers:F-4db939/AC-004] report rendering is byte-deterministic with M1/M2 tables, detector blocks, and six findings', () => {
    const input = {
      caseTitle: 'contract-proof',
      fixture: 'contract fixture',
      intent: 'prove renderer structure',
      description: 'A fixed set of snapshots makes byte determinism observable.',
      hypothesisFocus: ['H1', 'H2'],
      m1A: contractSnapshot('A', 'M1', 1),
      m1B: contractSnapshot('B', 'M1', 2),
      m2A: contractSnapshot('A', 'M2', 3),
      m2B: contractSnapshot('B', 'M2', 4),
    };

    const first = renderCaseReport(input);
    const second = renderCaseReport(input);

    expect(second).toBe(first);
    expect(first).toContain('## M1 — Initial setup');
    expect(first).toContain('## M2 — First feature complete');
    expect(first).toContain('## Findings');
    expect((first.match(/^\| Metric \| A \(Cladding\) \| B \(Vanilla\) \| Δ \|$/gm) ?? [])).toHaveLength(2);
    expect(first).toContain('| Tier A artifacts | 1 | 2 | -1 |');
    expect(first).toContain('| Tier A artifacts | 3 | 4 | -1 |');
    expect((first.match(/^\*\*Detector outcomes\*\*/gm) ?? [])).toHaveLength(2);
    expect(first).toContain('A (Cladding) — errors: 8  warns: 9  infos: 10');
    expect(first).toContain('B (Vanilla)  — errors: 9  warns: 10  infos: 11');
    const findings = first.slice(first.indexOf('## Findings'), first.indexOf('## How to reproduce'));
    expect(findings.split('\n').filter((line) => line.startsWith('- **'))).toHaveLength(6);
  });

  test('[covers:F-ba2e05/AC-8f1f105a] outcome report renders case, fixture, group, milestone, scenario, query, and applicable-count identities', () => {
    const report = renderCaseReport({
      caseTitle: 'contract-outcome',
      fixture: 'fixture-contract',
      intent: 'render outcome identities',
      description: 'Deterministic outcome fixture.',
      hypothesisFocus: ['H6'],
      m1A: contractSnapshot('A', 'M1', 1),
      m1B: contractSnapshot('B', 'M1', 2),
      m2A: contractSnapshot('A', 'M2', 3),
      m2B: contractSnapshot('B', 'M2', 4),
      outcome: contractOutcome(),
    });

    expect(report).toContain('# A/B Evaluation: contract-outcome');
    expect(report).toContain('**Fixture:** `fixture-contract`');
    expect(report).toContain('## M1 — Initial setup');
    expect(report).toContain('## M2 — First feature complete');
    expect(report).toContain('A (Cladding)');
    expect(report).toContain('B (Vanilla)');
    expect(report).toContain('DI-1 Stale module reference');
    expect(report).toContain('DI-4 Unverified criterion');
    expect(report).toContain('| N/A | N/A |');
    expect(report).toContain('Q1 Where is the feature?');
    expect(report).toContain('Catch rate (applicable scenarios)');
    expect(report).toContain('Answerability (applicable queries)');
  });

  test('[covers:F-ba2e05/AC-6c42dfa6] historical M2 outcome is non-release when no later B5 signed receipt is supplied', () => {
    const report = renderCaseReport({
      caseTitle: 'contract-outcome',
      fixture: 'fixture-contract',
      intent: 'prove non-release status',
      description: 'No later receipt is supplied.',
      hypothesisFocus: ['H6'],
      m1A: contractSnapshot('A', 'M1', 1),
      m1B: contractSnapshot('B', 'M1', 2),
      m2A: contractSnapshot('A', 'M2', 3),
      m2B: contractSnapshot('B', 'M2', 4),
      outcome: contractOutcome(),
    });

    expect(report).toContain('historical M2 measurement, not a release claim; no later B5 signed receipt is recorded');
  });
});
