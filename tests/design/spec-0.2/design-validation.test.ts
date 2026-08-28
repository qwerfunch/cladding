// Cladding · Spec 0.2 deterministic design-validation contract (F-0a29d024).

import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {beforeAll, describe, expect, test} from 'vitest';

import {
  decisionOwnershipIssues,
  loadValidationManifest,
  measureUsage,
  stableJson,
  validateSpec02,
  type ValidationReport,
} from '../../../scripts/spec-0.2-validate.js';

describe('Spec 0.2 validation ledger', () => {
  let report: ValidationReport;

  beforeAll(async () => {
    report = await validateSpec02(process.cwd());
  });

  test('maps every D01-D24 decision exactly once and rejects fabricated pass evidence', () => {
    const manifest = loadValidationManifest(process.cwd());
    expect(manifest.decisions.map((decision) => decision.id)).toEqual(
      Array.from({length: 24}, (_, index) => `D${String(index + 1).padStart(2, '0')}`),
    );
    expect(report.checks.find((check) => check.id === 'design-ownership')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'target-runtime-implementation')?.status)
      .toBe('implementation_pending');
    expect(report.checks.find((check) => check.id === 'preregistered-case-ledger')?.evidence)
      .toContain('not 37 passing implementations');

    const designRoot = join(process.cwd(), 'docs/design/spec-0.2');
    const documents = new Map<string, string>([
      ['docs/design/spec-0.2.md', readFileSync(join(process.cwd(), 'docs/design/spec-0.2.md'), 'utf8')],
      ...readdirSync(designRoot).filter((name) => name.endsWith('.md')).map((name) => [
        `docs/design/spec-0.2/${name}`,
        readFileSync(join(designRoot, name), 'utf8'),
      ] as [string, string]),
    ]);
    expect(decisionOwnershipIssues(manifest, documents)).toEqual([]);

    const poisoned = new Map(documents);
    poisoned.set(
      'docs/design/spec-0.2/validation.md',
      `${poisoned.get('docs/design/spec-0.2/validation.md')}\n## D21 — duplicate owner\n`,
    );
    expect(decisionOwnershipIssues(manifest, poisoned)).toContain(
      'D21:docs/design/spec-0.2/validation.md has 1, expected 0',
    );

    const fenced = new Map(documents);
    fenced.set(
      'docs/design/spec-0.2/validation.md',
      `${fenced.get('docs/design/spec-0.2/validation.md')}\n\`\`\`md\n## D21 — example only\n\`\`\`\n`,
    );
    expect(decisionOwnershipIssues(manifest, fenced)).toEqual([]);
  });

  test('runs deterministic design scenarios without converting pending implementation into evidence', () => {
    const manifest = loadValidationManifest(process.cwd());
    expect(manifest.preregistered_cases).toHaveLength(37);
    expect(new Set(manifest.preregistered_cases.map((entry) => entry.id))).toHaveProperty('size', 37);
    expect(report.checks.find((check) => check.id === 'preregistered-case-ledger')).toMatchObject({
      status: 'pass',
    });
    expect(report.checks.find((check) => check.id === 'model-scenario-freshness')).toMatchObject({
      status: 'pass',
    });
    expect(report.checks.find((check) => check.id === 'model-assurance-cadence')).toMatchObject({
      status: 'pass',
      evidence: expect.stringContaining('standard-complete/Cladding-RED'),
    });
    expect(report.checks.filter((check) => check.status === 'implementation_pending').length)
      .toBeGreaterThan(0);
  });

  test('accounts for controlled bytes tokens cache and counterfactual waste honestly', () => {
    const value = '가나다abc';
    const uncontrolled = measureUsage('candidate', value, {
      comparator: {label: 'different-output', value: 'x', equivalentOutput: false},
    });
    const equivalent = measureUsage('candidate', value, {
      cache: 'cold',
      comparator: {label: 'same-output', value: 'x', equivalentOutput: true},
    });
    expect(uncontrolled).toMatchObject({
      utf8_bytes: Buffer.byteLength(value, 'utf8'),
      token_estimator: 'characters_div_4_ceiling',
      cache: 'unknown',
      avoidable_bytes: null,
      comparator: 'different-output',
    });
    expect(equivalent.avoidable_bytes).toBe(Buffer.byteLength(value, 'utf8') - 1);
    expect(report.measurements.every((measurement) => measurement.cache === 'unknown')).toBe(true);
    const claimedWaste = report.measurements.filter((measurement) => measurement.avoidable_bytes !== null);
    expect(claimedWaste).toEqual([
      expect.objectContaining({
        label: 'model-graph-undirected-depth',
        comparator: 'model-graph-directed-task',
      }),
    ]);
    expect(claimedWaste[0].avoidable_bytes).toBeGreaterThan(0);
  });

  test('emits byte-identical summaries with distinct result states', async () => {
    const second = await validateSpec02(process.cwd());
    expect(stableJson(second)).toBe(stableJson(report));
    const states = new Set(report.checks.map((check) => check.status));
    expect(states).toEqual(new Set(['pass', 'inconclusive', 'not_run', 'implementation_pending']));
  });

  test('keeps each routed design owner below the documented byte ceiling', () => {
    const manifest = loadValidationManifest(process.cwd());
    for (const path of new Set(manifest.decisions.map((decision) => decision.owner))) {
      const bytes = Buffer.byteLength(readFileSync(join(process.cwd(), path), 'utf8'), 'utf8');
      expect(bytes, path).toBeLessThanOrEqual(24 * 1024);
    }
    const routerBytes = Buffer.byteLength(
      readFileSync(join(process.cwd(), 'docs/design/spec-0.2.md'), 'utf8'),
      'utf8',
    );
    expect(routerBytes).toBeLessThanOrEqual(7.5 * 1024);
    expect(report.checks.find((check) => check.id === 'documentation-ratchets')).toMatchObject({
      status: 'pass',
    });
  });

  test('keeps bounded MCP and broader GraphIR benchmark claims distinct', () => {
    const graph = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/graph.md'), 'utf8');
    const context = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/context-and-orchestration.md'), 'utf8');
    const delivery = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/delivery.md'), 'utf8');
    const decisions = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/decision-log.md'), 'utf8');
    expect(graph).toContain('AB01–AB12 two-arm run is the bounded first experiment');
    expect(graph).toContain('40 tasks is the current optional scale candidate');
    expect(context).toContain('AB01–AB12 live A/B may support only a task-scoped efficiency claim');
    expect(delivery).not.toContain('40-task host A/B remain independent tail work');
    expect(decisions).toContain('Broader LLM GraphIR retrieval study');
  });

  test('keeps validation evidence measurements scoped and reproducible', () => {
    const evidence = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/evidence.md'), 'utf8');
    const designDir = join(process.cwd(), 'docs/design/spec-0.2');
    const completeBytes = Buffer.byteLength(
      readFileSync(join(process.cwd(), 'docs/design/spec-0.2.md'), 'utf8'),
      'utf8',
    ) + readdirSync(designDir)
      .filter((name) => name.endsWith('.md'))
      .reduce((sum, name) => sum + Buffer.byteLength(readFileSync(join(designDir, name), 'utf8'), 'utf8'), 0);
    const recordedComplete = /complete routed design set is ([\d,]+) bytes/.exec(evidence);
    expect(recordedComplete).not.toBeNull();
    expect(Number(recordedComplete![1].replaceAll(',', ''))).toBe(completeBytes);
    expect(evidence).toContain('Historical generic-MCP tool subset');
    expect(evidence).toContain(`${report.mcp.full_catalog_bytes.toLocaleString('en-US')} bytes`);
    expect(evidence).toContain('directed 375 bytes; undirected 610; avoidable 235');
    expect(evidence).toContain('every-edit 36 units; tiered 15');
  });
});
