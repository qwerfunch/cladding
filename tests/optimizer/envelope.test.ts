// Cladding · Spec 0.2 F9a · cycle context envelope projection, packing, and budget tests.
//
// Two workspaces answer two different questions. A small temp 0.2 fixture pins the
// projection RULES — which sections each profile owes, how an unknown write scope
// degrades impact, what a diagnostic looks like after the preamble and line budgets
// run, and what the blind-oracle packet may never contain. The live self corpus then
// pins the MEASUREMENTS on real data: the largest graph feature must pack under its
// implement ceiling by shedding optional fan-out rather than overflowing, and a small
// feature must project a spec-edit packet with nothing omitted at all.
//
// This suite is also the covered successor of the retired preamble/tail helper tests:
// F-041/AC-065 and F-041/AC-066 now describe packing rules of this envelope, and
// F-063/AC-161 asks for exactly this file.

import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../../src/graph/query.js';
import {buildContextSlice} from '../../src/optimizer/context-slice.js';
import {
  buildCycleContextEnvelope,
  TASK_PROFILES,
  type CycleContextEnvelope,
  type TaskProfile,
} from '../../src/optimizer/envelope.js';
import type {PriorAttempts} from '../../src/optimizer/prior-attempts.js';
import type {CriterionProofView} from '../../src/proof/view.js';

const temporary: string[] = [];

/** A body marker no blind-oracle packet may ever carry. */
const BODY_MARKER = 'IMPLEMENTATION_BODY_MARKER';

const PROFILES: readonly TaskProfile[] = ['spec-edit', 'implement', 'verify', 'observe', 'blind-oracle'];

const PRIOR_ATTEMPTS: PriorAttempts = {
  attempts: 2,
  last_failed_gate: 'stage_2.2',
  retry_count: 1,
  drift_history: [{detector: 'stage_2.2', message: 'coverage floor not met'}],
  rolled_back_at: 'abc1234',
  recovery_hint: 'recover: npm test (failed stage_2.2, 1 retries)',
  truncated_history: true,
};

/**
 * A schema 0.2 workspace with the seams every profile reads: a shared module with a
 * co-owner, a prerequisite, a dangling prerequisite, a capability edge, a scenario, a
 * criterion carrying a constraint ref, a live `[covers:]` binding, and one criterion
 * whose only proof reference is an unresolved evidence path.
 */
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-context-envelope-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'src', 'focus.ts'), [
    'export function focus(input: string): string {',
    `  const secret = '${BODY_MARKER}';`,
    '  return `${input}:${secret}`;',
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'shared.ts'), 'export const shared = true;\n');
  writeFileSync(join(root, 'src', 'other.ts'), 'export const other = true;\n');
  writeFileSync(join(root, 'src', 'prereq.ts'), 'export const prereq = true;\n');
  writeFileSync(join(root, 'tests', 'focus.test.ts'), [
    "import {describe, expect, test} from 'vitest';",
    '',
    "describe('focus', () => {",
    "  test('[covers:F-aaaaaaaa/AC-11111111] keeps the focus contract', () => {",
    '    expect(true).toBe(true);',
    '  });',
    '});',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"',
    'project:',
    '  name: context-envelope',
    '  language: typescript',
    '  purpose: Prove the cycle context envelope projects and measures one operation.',
    '  assurance_level: L2',
    '  scenario_policy: advisory',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
    'capabilities:',
    '  - id: governance',
    '    title: Governance',
    '    outcome: Keep context cost provable.',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'architecture.yaml'), [
    'layers:',
    '  - [spec]',
    '  - [cli]',
    'rules:',
    '  - id: AR-11111111',
    '    kind: forbidden_import',
    '    from: spec',
    '    to: cli',
    '    rationale: Keep the specification layer reusable outside the entry layer.',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'focus-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa',
    'title: Focus feature',
    'status: in_progress',
    'purpose: Give one operation exactly the facts it needs.',
    'modules: [src/focus.ts, src/shared.ts]',
    'depends_on: [F-bbbbbbbb, F-99999999]',
    'capability_refs: [governance]',
    'acceptance_criteria:',
    '  - id: AC-11111111',
    '    kind: behavior',
    '    statement: The system shall project one operation from the workspace.',
    '    constraint_refs: [AR-11111111, AR-99999999]',
    '  - id: AC-22222222',
    '    kind: constraint',
    '    statement: The system shall keep the shipped context wire unchanged.',
    '    rationale: The public slice is frozen for adopters.',
    '    evidence_refs: [docs/context-envelope.md, docs/measurement.md]',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'prereq-bbbbbbbb.yaml'), [
    'id: F-bbbbbbbb',
    'title: Prerequisite feature',
    'status: done',
    'purpose: Supply the prerequisite the focus feature builds on.',
    'modules: [src/prereq.ts]',
    'depends_on: []',
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-33333333',
    '    kind: behavior',
    '    statement: The system shall supply the prerequisite contract.',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'co-owner-cccccccc.yaml'), [
    'id: F-cccccccc',
    'title: Co-owner feature',
    'status: in_progress',
    'purpose: Share a module with the focus feature.',
    'modules: [src/shared.ts, src/other.ts]',
    'depends_on: [F-aaaaaaaa]',
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-44444444',
    '    kind: behavior',
    '    statement: The system shall share one module with a second owner.',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'empty-dddddddd.yaml'), [
    'id: F-dddddddd',
    'title: Criterion-free feature',
    'status: planned',
    'purpose: Hold a feature that has not been given a criterion yet.',
    'modules: []',
    'depends_on: []',
    'capability_refs: []',
    'acceptance_criteria: []',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'scenarios', 'journey-eeeeeeee.yaml'), [
    'id: S-eeeeeeee',
    'title: Context journey',
    'actor: host agent',
    'goal: receive one operation of context',
    'success: the packet carries every required fact and names every omission',
    'steps: [request, project, measure]',
    'feature_refs: [F-aaaaaaaa]',
    '',
  ].join('\n'));
  return root;
}

/**
 * A workspace whose declared source cannot be scanned, so at least one fact layer
 * reports itself incomplete instead of returning a confident empty answer.
 */
function degradedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-context-envelope-degraded-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  // A declared module whose bytes are not valid UTF-8 cannot be decoded, so the
  // source-reference layer must say so rather than report zero carriers.
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'blocked.ts'), Buffer.from([0xff, 0xfe, 0x80]));
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"',
    'project:',
    '  name: context-envelope-degraded',
    '  language: typescript',
    '  purpose: Surface an incomplete fact layer to the observe projection.',
    '  assurance_level: L2',
    '  scenario_policy: advisory',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'blocked-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa',
    'title: Blocked source feature',
    'status: in_progress',
    'purpose: Declare a source the scanner cannot read.',
    'modules: [src/blocked.ts]',
    'depends_on: []',
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-11111111',
    '    kind: behavior',
    '    statement: The system shall report an unreadable source layer as incomplete.',
    '',
  ].join('\n'));
  return root;
}

let selfWorkspaceCache: GraphIrV2Workspace | undefined;

/** The live self corpus, read once: a cold workspace read costs roughly 840 ms. */
function selfWorkspace(): GraphIrV2Workspace {
  selfWorkspaceCache ??= loadGraphIrV2Workspace(process.cwd());
  return selfWorkspaceCache;
}

/** Section ids in the order the envelope retained them. */
function sectionIds(envelope: CycleContextEnvelope): readonly string[] {
  return envelope.sections.map((section) => section.id);
}

/** One retained section body, by id. */
function body(envelope: CycleContextEnvelope, id: string): Record<string, unknown> {
  const section = envelope.sections.find((entry) => entry.id === id);
  expect(section, `section ${id} is retained`).toBeDefined();
  return section!.body as Record<string, unknown>;
}

/** A diagnostic with one persona preamble line above sixty body lines. */
function personaDiagnostic(): {readonly id: string; readonly text: string} {
  return {
    id: 'stage_2.1',
    text: [
      'You are the Reviewer agent for cladding.',
      ...Array.from({length: 60}, (_, index) => `line-${index}`),
    ].join('\n'),
  };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('cycle context envelope — task projections', () => {
  test('[covers:F-1a87a6bd/AC-87b85505] projects the D19 required sections for every task profile', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    for (const task of PROFILES) {
      const envelope = buildCycleContextEnvelope(workspace, {task, feature: 'F-aaaaaaaa'}, {cwd: root});
      expect(envelope.task).toBe(task);
      expect(envelope.feature).toBe('F-aaaaaaaa');
      for (const required of TASK_PROFILES[task].required) {
        expect(sectionIds(envelope), `${task} retains ${required}`).toContain(required);
      }
      for (const section of envelope.sections) {
        const declared = TASK_PROFILES[task].required.includes(section.id);
        expect(section.required).toBe(declared);
        expect(section.priority === 0).toBe(declared);
      }
      expect(envelope.context_revision).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('[covers:F-1a87a6bd/AC-87b85505] resolves the spec-edit read set from the workspace, not from a guess', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(workspace, {task: 'spec-edit', feature: 'F-aaaaaaaa'}, {cwd: root});

    expect(body(envelope, 'intent')).toMatchObject({
      feature: 'F-aaaaaaaa',
      status: 'in_progress',
      purpose: 'Give one operation exactly the facts it needs.',
      project_purpose: 'Prove the cycle context envelope projects and measures one operation.',
    });
    expect((body(envelope, 'target-contract').criteria as {id: string}[]).map((entry) => entry.id))
      .toEqual(['AC-11111111', 'AC-22222222']);
    expect(body(envelope, 'referenced-constraints')).toMatchObject({
      referenced: 2,
      rules: [{id: 'AR-11111111', from: 'spec', to: 'cli'}],
      unresolved: ['AR-99999999'],
    });
    expect(body(envelope, 'affected-links')).toEqual({
      capabilities: [{id: 'governance', title: 'Governance', outcome: 'Keep context cost provable.'}],
      scenarios: [{id: 'S-eeeeeeee', title: 'Context journey', success: 'the packet carries every required fact and names every omission'}],
    });
    // The feature shard is the canonical input revision the projection read from.
    expect(Object.keys(envelope.input_revisions)).toEqual(['spec/features/focus-aaaaaaaa.yaml']);
    expect(envelope.input_revisions['spec/features/focus-aaaaaaaa.yaml']).toMatch(/^[0-9a-f]{64}$/);
  });

  test('[covers:F-1a87a6bd/AC-87b85505] carries prerequisites and required proof into the implement projection', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'implement', feature: 'F-aaaaaaaa', prior_attempts: PRIOR_ATTEMPTS},
      {cwd: root},
    );

    expect(body(envelope, 'prerequisites')).toEqual({
      prerequisites: [
        {id: 'F-99999999', state: 'unresolved'},
        {id: 'F-bbbbbbbb', title: 'Prerequisite feature', status: 'done'},
      ],
      complete: false,
    });
    const proof = body(envelope, 'required-proof').criteria as {criterion: string; state: string; proofs: unknown[]}[];
    expect(proof.map((entry) => [entry.criterion, entry.state])).toEqual([
      ['AC-11111111', 'declared'],
      ['AC-22222222', 'declared'],
    ]);
    // The live `[covers:]` carrier resolves to an anchor selector digest, while the
    // authored evidence path has no selector to digest at all.
    expect(proof[0]!.proofs).toEqual([
      {artifact: 'tests/focus.test.ts', relation: 'covers', state: 'resolved', selectors: [expect.stringMatching(/^[0-9a-f]{16}$/)]},
    ]);
    expect(proof[1]!.proofs).toEqual([
      {artifact: 'docs/context-envelope.md', relation: 'supports', state: 'unresolved', selectors: []},
      {artifact: 'docs/measurement.md', relation: 'supports', state: 'unresolved', selectors: []},
    ]);
    expect(body(envelope, 'current-failure')).toEqual({
      last_failed_gate: 'stage_2.2',
      rolled_back_at: 'abc1234',
      recovery_hint: 'recover: npm test (failed stage_2.2, 1 retries)',
    });
    expect(body(envelope, 'prior-attempts')).toEqual({
      attempts: 2,
      retry_count: 1,
      drift_history: [{detector: 'stage_2.2', message: 'coverage floor not met'}],
      truncated_history: true,
    });
    // The feature's own declared paths are a required contract fact; only the
    // co-owner fan-out is the lazily-available summary.
    expect(body(envelope, 'candidate-affected-paths')).toEqual({
      modules: [
        {path: 'src/focus.ts', owners: ['F-aaaaaaaa']},
        {path: 'src/shared.ts', owners: ['F-aaaaaaaa', 'F-cccccccc']},
      ],
    });
    expect(body(envelope, 'ownership-fan-out')).toEqual({
      fan_out: [{feature: 'F-cccccccc', paths: ['src/other.ts', 'src/shared.ts']}],
    });
  });

  test('[covers:F-1a87a6bd/AC-87b85505] projects observed results and evidence state for the verify profile', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);
    const proofViews: readonly CriterionProofView[] = [
      {
        criterion: 'F-aaaaaaaa/AC-11111111',
        test: {criterion: 'F-aaaaaaaa/AC-11111111', state: 'verified', matched: 1, pass: 1, fail: 0, skip: 0, error: 0},
        audit: 'unverified',
        uat: 'unverified',
        blind: 'unverified',
        assertedEvidence: 0,
      },
      {
        criterion: 'F-cccccccc/AC-44444444',
        test: {criterion: 'F-cccccccc/AC-44444444', state: 'unverified', matched: 0, pass: 0, fail: 0, skip: 0, error: 0},
        audit: 'unverified',
        uat: 'unverified',
        blind: 'unverified',
        assertedEvidence: 0,
      },
      // Supplied out of order, so the projection has to sort rather than echo.
      {
        criterion: 'F-aaaaaaaa/AC-00000000',
        test: {criterion: 'F-aaaaaaaa/AC-00000000', state: 'unverified', matched: 0, pass: 0, fail: 0, skip: 0, error: 0},
        audit: 'unverified',
        uat: 'unverified',
        blind: 'unverified',
        assertedEvidence: 0,
      },
    ];

    const envelope = buildCycleContextEnvelope(
      workspace,
      {
        task: 'verify',
        feature: 'F-aaaaaaaa',
        write_scope: {paths: ['src/shared.ts'], provenance: 'observed'},
        proof_views: proofViews,
        attestation: {digest: 'deadbeef', v3_features: ['F-bbbbbbbb']},
      },
      {cwd: root},
    );

    const observed = body(envelope, 'observed-results');
    expect(observed.state).toBe('observed');
    // Only this feature's rows travel; a sibling feature's row is not this contract.
    expect((observed.rows as {criterion: string}[]).map((row) => row.criterion))
      .toEqual(['F-aaaaaaaa/AC-00000000', 'F-aaaaaaaa/AC-11111111']);
    expect(body(envelope, 'changed-artifacts')).toEqual({
      ref: 'write_scope.paths',
      owners: [{path: 'src/shared.ts', owners: ['F-aaaaaaaa', 'F-cccccccc']}],
    });
    expect(body(envelope, 'evidence-state')).toMatchObject({
      declared_channels: {evidence: 2, graph: 1},
    });
    expect(body(envelope, 'freshness')).toMatchObject({
      criteria: 2,
      declared: 2,
      unbound: [],
      attestation: {state: 'supplied', v3_row: 'absent', digest: 'deadbeef'},
    });
  });

  test('[covers:F-1a87a6bd/AC-87b85505] reports observe-profile state as unobserved rather than empty', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(workspace, {task: 'observe', feature: 'F-aaaaaaaa'}, {cwd: root});

    expect(body(envelope, 'gate-results').state).toBe('unobserved');
    expect(body(envelope, 'attestation-digest').state).toBe('unknown');
    expect(body(envelope, 'unresolved-layers').layers).toEqual([]);
    expect(sectionIds(envelope)).not.toContain('diagnostics');
    // A feature that has never been given a criterion is reported as such, not as proven.
    const bare = buildCycleContextEnvelope(workspace, {task: 'observe', feature: 'F-dddddddd'}, {cwd: root});
    expect(body(bare, 'proof-freshness')).toMatchObject({criteria: 0, declared: 0, observed: 0, unbound: []});
  });

  test('[covers:F-1a87a6bd/AC-87b85505] names the fact layers that could not answer completely', () => {
    const root = degradedRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(workspace, {task: 'observe', feature: 'F-aaaaaaaa'}, {cwd: root});

    const layers = body(envelope, 'unresolved-layers').layers as {id: string; reasons: string[]}[];
    expect(layers.map((layer) => layer.id)).toContain('source-references');
    expect(layers.every((layer) => layer.reasons.length > 0)).toBe(true);
    expect(body(envelope, 'proof-freshness')).toMatchObject({criteria: 1, declared: 0, unbound: ['AC-11111111']});
  });
});

describe('cycle context envelope — measurement and packing', () => {
  test('[covers:F-1a87a6bd/AC-a9150a5d] measures payload, resident, and total bytes at a byte fixed point', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'implement', feature: 'F-aaaaaaaa', resident_utf8_bytes: 4_096, cache: 'warm'},
      {cwd: root},
    );

    // The fixed point IS the contract: the number the envelope prints is its own
    // serialized length, budget and omission metadata included.
    expect(envelope.budget.payload_utf8_bytes).toBe(Buffer.byteLength(JSON.stringify(envelope), 'utf8'));
    expect(envelope.budget.resident_utf8_bytes).toBe(4_096);
    expect(envelope.budget.total_utf8_bytes).toBe(envelope.budget.payload_utf8_bytes + 4_096);
    expect(envelope.budget.cache).toBe('warm');
    expect(envelope.budget.estimator).toBe('characters/4');
    expect(envelope.budget.estimated_tokens).toEqual({
      payload: Math.ceil(envelope.budget.payload_utf8_bytes / 4),
      resident: 1_024,
      total: Math.ceil(envelope.budget.total_utf8_bytes / 4),
    });
  });

  test('[covers:F-1a87a6bd/AC-a9150a5d] defaults resident bytes to zero with an unknown cache state', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(workspace, {task: 'observe', feature: 'F-aaaaaaaa'}, {cwd: root});

    expect(envelope.budget.resident_utf8_bytes).toBe(0);
    expect(envelope.budget.cache).toBe('unknown');
    expect(envelope.budget.total_utf8_bytes).toBe(envelope.budget.payload_utf8_bytes);
  });

  test('[covers:F-1a87a6bd/AC-a9150a5d] refuses to print a byte total it never reached', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    expect(() => buildCycleContextEnvelope(
      workspace,
      {task: 'observe', feature: 'F-aaaaaaaa'},
      {cwd: root, max_measure_rounds: 1},
    )).toThrow(/did not reach a serialized byte fixed point/);
  });

  test('[covers:F-1a87a6bd/AC-a9150a5d] serializes identical inputs to identical bytes', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const first = buildCycleContextEnvelope(workspace, {task: 'verify', feature: 'F-aaaaaaaa'}, {cwd: root});
    const second = buildCycleContextEnvelope(workspace, {task: 'verify', feature: 'F-aaaaaaaa'}, {cwd: root});

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.context_revision).toBe(second.context_revision);
  });

  test('[covers:F-1a87a6bd/AC-d609cdef] reports required_overflow with the oversized section instead of truncating', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'implement', feature: 'F-aaaaaaaa'},
      {cwd: root, ceiling_bytes: 200},
    );

    expect(envelope.budget.required_overflow).toBe(true);
    // Every required section survives; only the report changes.
    expect(sectionIds(envelope)).toEqual([...TASK_PROFILES.implement.required]);
    // The named section is the largest required one, so a reader knows what to split.
    const largest = [...envelope.sections]
      .sort((left, right) => Buffer.byteLength(JSON.stringify(right), 'utf8') - Buffer.byteLength(JSON.stringify(left), 'utf8'))[0]!;
    expect(envelope.budget.omitted).toEqual([
      // Optional content leaves first; only then does the packet admit it is oversized.
      {section: 'ownership-fan-out', reason: 'budget', omitted_bytes: expect.any(Number)},
      {section: largest.id, reason: 'budget', omitted_bytes: envelope.budget.payload_utf8_bytes - 200},
    ]);
    expect(envelope.budget.payload_utf8_bytes).toBe(Buffer.byteLength(JSON.stringify(envelope), 'utf8'));
  });

  test('[covers:F-1a87a6bd/AC-fb5c7567] omits optional sections lowest-priority-first and aggregates each one', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);
    const request = {task: 'implement' as const, feature: 'F-aaaaaaaa', prior_attempts: PRIOR_ATTEMPTS};
    const full = buildCycleContextEnvelope(workspace, request, {cwd: root});
    expect(full.budget.omitted).toEqual([]);
    const fanOutBytes = Buffer.byteLength(
      JSON.stringify(full.sections.find((section) => section.id === 'ownership-fan-out')),
      'utf8',
    );

    const oneDrop = buildCycleContextEnvelope(workspace, request, {
      cwd: root, ceiling_bytes: full.budget.payload_utf8_bytes - 1,
    });
    const twoDrops = buildCycleContextEnvelope(workspace, request, {
      cwd: root, ceiling_bytes: full.budget.payload_utf8_bytes - fanOutBytes - 1,
    });

    expect(oneDrop.budget.omitted.map((entry) => entry.section)).toEqual(['ownership-fan-out']);
    expect(oneDrop.budget.omitted[0]!.omitted_bytes).toBe(fanOutBytes);
    expect(oneDrop.budget.required_overflow).toBe(false);
    // Priority 3 leaves before priority 2, and the priority 1 failure detail stays.
    expect(twoDrops.budget.omitted.map((entry) => entry.section))
      .toEqual(['ownership-fan-out', 'prior-attempts']);
    expect(sectionIds(twoDrops)).toContain('current-failure');
    // Required contract facts, the feature's own declared paths included, never leave.
    expect(sectionIds(twoDrops)).toEqual(expect.arrayContaining([...TASK_PROFILES.implement.required]));
    expect(twoDrops.budget.payload_utf8_bytes).toBeLessThanOrEqual(full.budget.payload_utf8_bytes - fanOutBytes - 1);
  });
});

describe('cycle context envelope — write scope, diagnostics, and blind isolation', () => {
  test('[covers:F-1a87a6bd/AC-06ad5c92] treats an unknown write scope as incomplete impact, never as empty impact', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(workspace, {task: 'verify', feature: 'F-aaaaaaaa'}, {cwd: root});

    expect(envelope.write_scope).toEqual({paths: [], provenance: 'unknown'});
    const impact = body(envelope, 'impact-closure');
    expect(impact).toMatchObject({
      seeds: ['F-aaaaaaaa'],
      seeded_from: 'feature',
      dependents: ['F-cccccccc'],
      impact_complete: false,
    });
    expect(impact.reasons).toEqual([
      'write scope provenance is unknown, so this closure is a floor and not the blast radius',
      'no write path resolved to an owning feature, so the feature itself seeded the walk',
      'the walk stopped at depth 1 with more frontier to visit',
    ]);
    expect(body(envelope, 'observed-write-scope')).toEqual({ref: 'write_scope', provenance: 'unknown', paths: 0});
  });

  test('[covers:F-1a87a6bd/AC-06ad5c92] carries an observed write scope and seeds impact from its paths', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'verify', feature: 'F-cccccccc', write_scope: {paths: ['src/other.ts'], provenance: 'observed'}},
      {cwd: root},
    );

    expect(envelope.write_scope).toEqual({paths: ['src/other.ts'], provenance: 'observed'});
    expect(body(envelope, 'impact-closure')).toEqual({
      seeds: ['F-cccccccc'],
      seeded_from: 'write_scope.paths',
      depth: 1,
      dependents: [],
      completeness: 'complete',
      impact_complete: true,
    });
  });

  test('[covers:F-1a87a6bd/AC-06ad5c92] marks a predicted write scope as complete before an edit', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'implement', feature: 'F-aaaaaaaa', write_scope: {paths: ['src/shared.ts', 'src/focus.ts'], provenance: 'predicted'}},
      {cwd: root},
    );

    // Paths sort, so the same predicted set always serializes the same way.
    expect(envelope.write_scope.paths).toEqual(['src/focus.ts', 'src/shared.ts']);
    expect(body(envelope, 'predicted-write-scope'))
      .toEqual({ref: 'write_scope', provenance: 'predicted', paths: 2, complete: true});
  });

  test('[covers:F-1a87a6bd/AC-249b7630][covers:F-041/AC-066] keeps a long diagnostic head and tail with an exact elision count', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'observe', feature: 'F-aaaaaaaa', diagnostics: [personaDiagnostic()]},
      {cwd: root},
    );

    const entries = body(envelope, 'diagnostics').entries as {id: string; text: string}[];
    const lines = entries[0]!.text.split('\n');
    expect(lines.slice(0, 5)).toEqual(['line-0', 'line-1', 'line-2', 'line-3', 'line-4']);
    expect(lines[5]).toBe('… [25 line(s) elided]');
    expect(lines.slice(6)).toEqual(Array.from({length: 30}, (_, index) => `line-${index + 30}`));
    expect(envelope.budget.omitted).toContainEqual({
      section: 'diagnostics#stage_2.1', reason: 'elided', omitted_lines: 25,
    });
    expect(body(envelope, 'gate-results')).toEqual({state: 'observed', entries: [{id: 'stage_2.1', lines: 60}]});
  });

  test('[covers:F-041/AC-065] strips persona preamble lines before the diagnostic is measured', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {
        task: 'verify',
        feature: 'F-aaaaaaaa',
        diagnostics: [
          personaDiagnostic(),
          {id: 'stage_1.2', text: '# Reviewer\n\n\n\nYour job is to read the diff.\nlint: 0 findings'},
          {id: 'stage_1.1', text: 'tsc: 0 errors'},
        ],
      },
      {cwd: root},
    );

    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('You are the Reviewer agent');
    expect(serialized).not.toContain('Your job is to');
    const entries = body(envelope, 'diagnostics').entries as {id: string; text: string}[];
    // The stripped heading leaves no blank run behind, and the surviving line stays.
    expect(entries.find((entry) => entry.id === 'stage_1.2')!.text).toBe('lint: 0 findings');
    expect(envelope.budget.omitted).toContainEqual({
      section: 'diagnostics#stage_1.2', reason: 'preamble', omitted_lines: 5,
    });
    expect(envelope.budget.omitted).toContainEqual({
      section: 'diagnostics#stage_2.1', reason: 'preamble', omitted_lines: 1,
    });
    // A clean diagnostic is not charged an omission it never suffered.
    expect(entries.find((entry) => entry.id === 'stage_1.1')!.text).toBe('tsc: 0 errors');
    expect(envelope.budget.omitted.filter((entry) => entry.section === 'diagnostics#stage_1.1')).toEqual([]);
  });

  test('[covers:F-1a87a6bd/AC-90ad1c33] excludes implementation bodies and prior results from a blind-oracle packet', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'blind-oracle', feature: 'F-aaaaaaaa', criterion: 'AC-11111111', prior_attempts: PRIOR_ATTEMPTS},
      {cwd: root},
    );

    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(BODY_MARKER);
    expect(serialized).not.toContain('stage_2.2');
    expect(sectionIds(envelope)).toEqual([...TASK_PROFILES['blind-oracle'].required]);
    expect(body(envelope, 'criterion')).toMatchObject({
      id: 'AC-11111111',
      statement: 'The system shall project one operation from the workspace.',
    });
    expect(body(envelope, 'public-signatures').signatures).toEqual([
      'src/focus.ts: export function focus(input: string): string',
      'src/shared.ts: export const shared',
    ]);
    expect(body(envelope, 'target-test-path')).toEqual({path: 'tests/focus.test.ts', provenance: 'declared'});
    expect(body(envelope, 'subject-revisions')).toEqual({
      ref: ['context_revision', 'input_revisions'],
      subject_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test('[covers:F-1a87a6bd/AC-90ad1c33] falls back to the oracle directory when no carrier declares a target', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const envelope = buildCycleContextEnvelope(
      workspace,
      {task: 'blind-oracle', feature: 'F-cccccccc'},
      {cwd: root},
    );

    expect(body(envelope, 'target-test-path')).toEqual({path: 'tests/oracle/', provenance: 'convention'});
    expect(body(envelope, 'criterion')).toMatchObject({id: 'AC-44444444'});
  });

  test('[covers:F-063/AC-161] refuses the projections it cannot honestly make', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    expect(() => buildCycleContextEnvelope(workspace, {task: 'implement', feature: 'F-nope'}, {cwd: root}))
      .toThrow(/requires a schema 0.2 feature contract/);
    expect(() => buildCycleContextEnvelope(workspace, {task: 'blind-oracle', feature: 'F-dddddddd'}, {cwd: root}))
      .toThrow(/declares no criterion/);
    // A shard the caller cannot read is named as an unknown revision, not dropped.
    const detached = buildCycleContextEnvelope(
      workspace,
      {task: 'spec-edit', feature: 'focus'},
      {cwd: join(root, 'src')},
    );
    expect(detached.input_revisions).toEqual({'spec/features/focus-aaaaaaaa.yaml': 'unknown'});
    expect(detached.feature).toBe('F-aaaaaaaa');
  });
});

describe('cycle context envelope — self corpus and the frozen context wire', () => {
  test('[covers:F-1a87a6bd/AC-fb5c7567] packs the largest graph feature under its implement ceiling by shedding fan-out', () => {
    const envelope = buildCycleContextEnvelope(selfWorkspace(), {task: 'implement', feature: 'F-208eaa79'});

    expect(envelope.budget.payload_utf8_bytes).toBeLessThanOrEqual(TASK_PROFILES.implement.ceiling_bytes);
    expect(envelope.budget.required_overflow).toBe(false);
    expect(envelope.budget.omitted.length).toBeGreaterThan(0);
    expect(envelope.budget.omitted.map((entry) => entry.section)).toContain('ownership-fan-out');
    // The hub sheds the co-owner fan-out and still hands over its own 56 paths.
    expect((body(envelope, 'candidate-affected-paths').modules as unknown[]).length).toBe(56);
    for (const required of TASK_PROFILES.implement.required) {
      expect(sectionIds(envelope)).toContain(required);
    }
    expect(envelope.budget.payload_utf8_bytes).toBe(Buffer.byteLength(JSON.stringify(envelope), 'utf8'));
  });

  test('[covers:F-1a87a6bd/AC-87b85505] projects a small feature spec-edit packet with nothing omitted', () => {
    const envelope = buildCycleContextEnvelope(selfWorkspace(), {task: 'spec-edit', feature: 'F-001'});

    expect(envelope.budget.payload_utf8_bytes).toBeLessThanOrEqual(TASK_PROFILES['spec-edit'].ceiling_bytes);
    expect(envelope.budget.omitted).toEqual([]);
    expect(envelope.budget.required_overflow).toBe(false);
    expect(sectionIds(envelope)).toEqual([...TASK_PROFILES['spec-edit'].required]);
  });

  test('[covers:F-1a87a6bd/AC-a9150a5d] reaches the same bytes twice on the live corpus', () => {
    const first = buildCycleContextEnvelope(selfWorkspace(), {task: 'observe', feature: 'F-001'});
    const second = buildCycleContextEnvelope(selfWorkspace(), {task: 'observe', feature: 'F-001'});

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.budget.payload_utf8_bytes).toBe(Buffer.byteLength(JSON.stringify(second), 'utf8'));
  });

  test('[covers:F-1a87a6bd/AC-abd6e2d4] leaves clad_get_context at schema_version 1 with its shipped payload', () => {
    const root = fixtureRoot();
    const workspace = loadGraphIrV2Workspace(root);

    const slice = buildContextSlice(workspace.spec, 'F-cccccccc');
    const server = readFileSync(join(process.cwd(), 'src', 'serve', 'server.ts'), 'utf8');

    // The shipped slice is frozen: this literal is its exact serialization, so any
    // envelope field leaking into it would fail here rather than at an adopter.
    expect(JSON.stringify(slice)).toBe(JSON.stringify({
      focus: workspace.spec.features.find((feature) => feature.id === 'F-cccccccc'),
      ancestors: [
        {id: 'F-aaaaaaaa', title: 'Focus feature', status: 'in_progress'},
        {id: 'F-bbbbbbbb', title: 'Prerequisite feature', status: 'done'},
      ],
      scenarios: [{id: 'S-eeeeeeee', title: 'Context journey'}],
      preferred_patterns: [],
      test_refs: [],
    }));
    expect(server).toContain('const PAYLOAD_SCHEMA_VERSION = 1;');
    expect(server).toContain("import {buildContextSlice} from '../optimizer/context-slice.js';");
    expect(server).not.toContain('optimizer/envelope');
  });
});
