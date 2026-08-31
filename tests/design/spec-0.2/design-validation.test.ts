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

  test('marks the F7 scenario boundary validation-active without promoting F8-F11 work', () => {
    const manifest = loadValidationManifest(process.cwd());
    expect(manifest.decisions.map((decision) => decision.id)).toEqual(
      Array.from({length: 24}, (_, index) => `D${String(index + 1).padStart(2, '0')}`),
    );
    expect(report.checks.find((check) => check.id === 'design-ownership')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'target-runtime-implementation')?.status)
      .toBe('implementation_pending');
    expect(manifest.decisions.filter((decision) => decision.implementation === 'validation-active').map((decision) => decision.id))
      .toEqual(['D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13', 'D14', 'D17', 'D20', 'D21', 'D22', 'D23', 'D24']);
    expect(manifest.decisions.filter((decision) => !['D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13', 'D14', 'D17', 'D20', 'D21', 'D22', 'D23', 'D24'].includes(decision.id) && decision.implementation !== 'pending'))
      .toEqual([]);
    expect(report.checks.find((check) => check.id === 'compiler-registry-boundary')).toMatchObject({
      status: 'pass',
      evidence: expect.stringContaining('D09 scenario policy'),
    });
    expect(report.checks.find((check) => check.id === 'compiler-registry-boundary')?.evidence)
      .toContain('F8 public GraphIR cutover');
    expect(report.checks.find((check) => check.id === 'preregistered-case-ledger')?.evidence)
      .toContain('not complete runtime evidence');
    expect(manifest.integration_journeys.find((journey) => journey.id === 'J05')).toMatchObject({
      decisions: ['D09', 'D21'], status: 'simulated', scenario: 'scenario-policy-obligation',
    });
    expect(manifest.integration_journeys.filter((journey) => ['J04', 'J09'].includes(journey.id)).map((journey) => journey.status))
      .toEqual(['implementation_pending', 'implementation_pending']);
    expect(manifest.decisions.find((decision) => decision.id === 'D17')).toMatchObject({
      scenario: 'assurance-closure-slice-only', implementation: 'validation-active',
    });

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

  test('keeps the D01-D24 ledger canonical and rejects fabricated preregistered pass evidence', () => {
    const manifest = loadValidationManifest(process.cwd());
    const decisionIds = Array.from({length: 24}, (_, index) => `D${String(index + 1).padStart(2, '0')}`);
    expect(manifest.decisions.map((decision) => decision.id)).toEqual(decisionIds);
    expect(new Set(manifest.decisions.map((decision) => decision.id))).toHaveProperty('size', 24);
    expect(manifest.decisions.every((decision) =>
      decision.owner.length > 0 && decision.scenario.length > 0 &&
      ['pending', 'validation-active'].includes(decision.implementation),
    )).toBe(true);

    const ledger = report.checks.find((check) => check.id === 'preregistered-case-ledger');
    expect(ledger).toMatchObject({status: 'pass'});
    expect(ledger?.evidence).toContain('not complete runtime evidence');
    expect(report.checks.filter((check) => [
      'target-runtime-implementation',
      'integration-journey-runtime',
      'integration-journey-reference-host',
    ].includes(check.id))).toEqual([
      expect.objectContaining({id: 'integration-journey-runtime', status: 'implementation_pending'}),
      expect.objectContaining({id: 'integration-journey-reference-host', status: 'not_run'}),
      expect.objectContaining({id: 'target-runtime-implementation', status: 'implementation_pending'}),
    ]);
  });

  test('runs deterministic design scenarios without converting pending implementation into evidence', () => {
    const manifest = loadValidationManifest(process.cwd());
    expect(manifest.preregistered_cases).toHaveLength(37);
    expect(new Set(manifest.preregistered_cases.map((entry) => entry.id))).toHaveProperty('size', 37);
    expect(manifest.preregistered_cases.filter((entry) => entry.implementation === 'validation-active').map((entry) => entry.id))
      .toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'L01', 'L02', 'L03', 'L04', 'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'T01', 'T02', 'T03', 'T04', 'U01', 'U02', 'U03', 'U04', 'A01', 'A02', 'A03']);
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

  test('locks the 0.10 rebaseline without upgrading pending runtime evidence', () => {
    const model = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/model-and-migration.md'), 'utf8');
    const delivery = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/delivery.md'), 'utf8');
    const context = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/context-and-orchestration.md'), 'utf8');
    const mcp = readFileSync(join(process.cwd(), 'docs/design/spec-0.2/mcp.md'), 'utf8');
    const governance = readFileSync(join(process.cwd(), 'GOVERNANCE.md'), 'utf8');
    const manifest = loadValidationManifest(process.cwd());
    expect(model).toContain('spec/generated/index.yaml');
    expect(model).toContain('clad relocate-generated --apply');
    expect(model).toContain('Before F11, the F4/F7 engine treats old paths as the then-canonical transitional layout');
    expect(model).toContain('its final engine applies this state machine');
    expect(model).toContain('`relocation_required`');
    expect(model).toContain('recovery-only');
    expect(model).toContain('the self release attestation remains');
    expect(model).toContain('Only real human-signed Codex and Claude Code MCP11');
    expect(model).not.toContain('final release proves L4');
    expect(delivery).toContain('V0 and F1–F11 ship in 0.10.0');
    expect(delivery).toContain('Before F11, migration keeps old paths canonical so F7–F10 complete');
    expect(delivery).toContain('In the final F11 engine, 0.2+old is `relocation_required`');
    expect(delivery).toContain('does not retroactively block F7–F10 completion');
    expect(delivery).toContain('a stronger one-run feature completion');
    expect(delivery).toContain('node bin/clad check --profile release --strict');
    expect(delivery).toContain('Cladding persists L2 after migration');
    expect(context).toContain('It introduces `clad signoff`');
    expect(context).toContain('macOS Keychain, Windows Credential');
    expect(mcp).toContain('Codex and Claude Code each complete');
    expect(governance).toContain('Pre-F6/current shipped releases retain their existing gate command');
    expect(manifest.mcp_reference_hosts).toEqual(['codex', 'claude-code']);
    expect(manifest.host_ab).toEqual({host: 'codex', max_calls: 24, blocking: false});
    expect(report.checks.find((check) => check.id === 'mcp-reference-host-spec-02-e2e')?.status)
      .toBe('not_run');
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
