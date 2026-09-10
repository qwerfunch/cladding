// Cladding · Spec 0.2 F9b · the D19 A–E simulation: work items, arms, executors, and oracle.
//
// D19 asks a question the envelope alone cannot answer: does the ANSWER change when the
// host changes its agent topology? This module is the apparatus that makes that testable.
//
//   • ONE hand-authored fixture workspace carries every seam the twelve ledger items need —
//     a shared module with a sibling owner, a prerequisite, a dependent, a bare criterion id
//     two features both claim, a live `[covers:]` binding, a JUnit with one failing BOUND
//     case and one passing UNBOUND case, a verified and an asserted receipt, and an event
//     log holding both agent pulls and hook pushes.
//   • FIVE arms build a packet from that one fixture: A is the shipped persona dispatch,
//     B one general agent's task envelope, C several general agents' envelopes, D the
//     restricted blind packet, E the legacy read set the packet replaces.
//   • TWELVE executors answer from a `FactView` that exposes ONLY what its own arm's packet
//     carries. An arm that lacks a fact pays for a counted read; it never borrows another
//     arm's knowledge.
//   • The oracle is hand-authored. Expected addresses and refusals are written down as
//     constants, and the stale closure and impact set are recomputed by a plain sorted
//     scan over the YAML shards — never by the compiler join, traversal, or reducer the
//     suite is comparing arms across.
//
// Two facts the D19 envelope deliberately does not carry are computed from the SAME fixture
// input in every arm, so no arm gains an advantage: per-receipt assurance (AB11) comes from
// the receipt files, and pull-versus-push adoption (AB12) from the event log. Adding an
// envelope section for either would be a production change AC-51a9a41e forbids.

import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';

import yaml from 'yaml';

import {reduceLegacyStageAdapter} from '../../../src/assurance/adapters.js';
import {assuranceProfile} from '../../../src/assurance/kernel.js';
import {
  currentProofViewsFromWorkspace,
  hasApplicableSchema02TestCriteria,
  workspaceProfileSnapshot,
} from '../../../src/assurance/workspace.js';
import {loadPersona} from '../../../src/agents/loader.js';
import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../../../src/graph/query.js';
import {
  buildCycleContextEnvelope,
  TASK_PROFILES,
  type ContextSection,
  type CycleContextEnvelope,
  type TaskProfile,
} from '../../../src/optimizer/envelope.js';
import {
  createTrustSnapshot,
  issuerKeyIdForSpki,
  parsePortableReceiptYaml,
  receiptSigningPayload,
  serializePortableReceipt,
  verifyPortableReceipt,
  type BlindReceipt,
  type TrustSnapshot,
} from '../../../src/proof/receipt.js';
import type {CurrentGateTestcaseLedger} from '../../../src/proof/testcase-ledger.js';
import type {CriterionProofView} from '../../../src/proof/view.js';
import {compileSpecWorkspace} from '../../../src/spec/compiler/compile.js';
import {editSpec, prepareSpecEdit, readSpecEditRevisions, type SpecEditOperation} from '../../../src/spec/edit.js';
import {loadSpec} from '../../../src/spec/load.js';
import {parseStrictStatement} from '../../../src/spec/statement-parser.js';
import {
  captureCurrentJUnitProof,
  clearTestRunCache,
  currentGateProofEvidence,
  currentGateTestcaseLedger,
  currentRunProofIdentity,
  primeTestRunCache,
} from '../../../src/stages/test-run-cache.js';

// ─── fixture identities ───

/** The target feature every item addresses; `done`, so its criteria are proof subjects. */
export const TARGET = 'F-aaaaaaaa';
/** The prerequisite the target depends on. */
export const PREREQUISITE = 'F-bbbbbbbb';
/** The dependent that depends on the target; it is never a prerequisite of it. */
export const DEPENDENT = 'F-cccccccc';
/** The sibling that co-owns `src/shared.ts` with the target. */
export const SIBLING = 'F-dddddddd';

/** The bare criterion id BOTH the target and the sibling declare. */
export const BARE_CRITERION = 'AC-0001';
/** The target's constraint criterion; its bound testcase fails in the fixture report. */
export const CONSTRAINT_CRITERION = 'AC-a1a1a1a1';
/** The target's receipt-bearing criterion; no testcase observes it. */
export const RECEIPT_CRITERION = 'AC-a2a2a2a2';

/** A path only the target declares. */
export const TARGET_ONLY_PATH = 'src/t-only.ts';
/** A path the target and the sibling both declare. */
export const SHARED_PATH = 'src/shared.ts';

/** Shard paths, keyed by feature; the arms discover these, they are not handed them. */
const SHARDS: Readonly<Record<string, string>> = Object.freeze({
  [TARGET]: 'spec/features/target-aaaaaaaa.yaml',
  [PREREQUISITE]: 'spec/features/prereq-bbbbbbbb.yaml',
  [DEPENDENT]: 'spec/features/dependent-cccccccc.yaml',
  [SIBLING]: 'spec/features/sibling-dddddddd.yaml',
});

/** Where the conventional gate report lands; the fixture never ships a stale one. */
const JUNIT_PATH = join('.cladding', 'test-report.junit.xml');

/** A body line the blind packet may never carry. */
export const BODY_MARKER = 'TOPOLOGY_IMPLEMENTATION_BODY_MARKER';

/** A prior implementation result the blind packet may never carry either. */
export const PRIOR_RESULT_MARKER = 'TOPOLOGY_PRIOR_RESULT_MARKER';

/** Hand-authored digests the fixture receipts bind, so verification is mechanism proof. */
const RECEIPT_DIGESTS = Object.freeze({
  subject: 'a'.repeat(64),
  evidence: 'b'.repeat(64),
  manifest: 'c'.repeat(64),
});

/** The gate report the fixture observes: one bound pass, one bound failure, one unbound pass. */
const JUNIT_REPORT = [
  '<testsuite>',
  `<testcase file="tests/target.test.ts" name="target &#62; [covers:${TARGET}/${BARE_CRITERION}] records one observation"/>`,
  `<testcase file="tests/target.test.ts" name="target &#62; [covers:${TARGET}/${CONSTRAINT_CRITERION}] names every owner"><failure/></testcase>`,
  '<testcase file="tests/unbound.test.ts" name="unbound &#62; an unrelated passing case"/>',
  '</testsuite>',
  '',
].join('\n');

/** The event ledger: three agent pulls and three hook pushes, in one append order. */
const EVENT_LOG = [
  {id: 'ev-1', timestamp: '2026-09-03T00:00:01.000Z', type: 'working_set_served', payload: {tool: 'clad_get_context', resolved: true, head: 'head-1'}},
  {id: 'ev-2', timestamp: '2026-09-03T00:00:02.000Z', type: 'impact_card_fired', payload: {file: SHARED_PATH, feature: TARGET, impacted: 1, tests: 1}},
  {id: 'ev-3', timestamp: '2026-09-03T00:00:03.000Z', type: 'working_set_served', payload: {tool: 'clad_get_context', resolved: true, head: 'head-2'}},
  {id: 'ev-4', timestamp: '2026-09-03T00:00:04.000Z', type: 'session_card_rendered', payload: {bytes: 512}},
  {id: 'ev-5', timestamp: '2026-09-03T00:00:05.000Z', type: 'working_set_served', payload: {tool: 'clad_get_context', resolved: true, head: 'head-3'}},
  {id: 'ev-6', timestamp: '2026-09-03T00:00:06.000Z', type: 'impact_card_fired', payload: {file: TARGET_ONLY_PATH, feature: TARGET, impacted: 0, tests: 1}},
];

/** One gate diagnostic the observe projection packs; its persona line is stripped first. */
export const GATE_DIAGNOSTIC = Object.freeze({
  id: 'stage_2.2',
  text: [
    'You are the Reviewer agent for the topology suite.',
    `${TARGET}/${CONSTRAINT_CRITERION}: bound testcase failed`,
    'coverage floor not met',
  ].join('\n'),
});

// ─── fixture construction ───

const roots: string[] = [];

/** Deletes every temporary workspace this module created. */
export function removeFixtureWorkspaces(): void {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
}

/** SHA-256 hex of one UTF-8 string. */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** One signed blind receipt plus the trust material that decides its assurance. */
interface ReceiptFixture {
  readonly verified: string;
  readonly asserted: string;
  readonly trust: TrustSnapshot;
}

/** Signs the two fixture receipts: one issuer inside the trust snapshot, one outside. */
function receiptFixture(): ReceiptFixture {
  const build = (issuer: string): {receipt: BlindReceipt; spkiDer: Buffer} => {
    const pair = generateKeyPairSync('ed25519');
    const spkiDer = pair.publicKey.export({format: 'der', type: 'spki'});
    const base: BlindReceipt = {
      receipt_schema: '1',
      issuer,
      issuer_key_id: issuerKeyIdForSpki(spkiDer),
      issuer_proof: 'AA',
      subject: `criterion:${TARGET}/${RECEIPT_CRITERION}`,
      subject_sha256: RECEIPT_DIGESTS.subject,
      observed_at: '2026-09-03T00:00:00.000Z',
      method: 'blind_capability',
      claim: 'independent_oracle',
      verdict: 'pass',
      evidence: {locator: 'tests/target.test.ts', sha256: RECEIPT_DIGESTS.evidence},
      capability_manifest_sha256: RECEIPT_DIGESTS.manifest,
    };
    return {
      receipt: {...base, issuer_proof: sign(null, receiptSigningPayload(base), pair.privateKey).toString('base64url')},
      spkiDer,
    };
  };
  const trusted = build('topology trusted issuer');
  const untrusted = build('topology untrusted issuer');
  return {
    verified: serializePortableReceipt(trusted.receipt),
    asserted: serializePortableReceipt(untrusted.receipt),
    trust: createTrustSnapshot([{issuer: trusted.receipt.issuer, issuerKeyId: trusted.receipt.issuer_key_id, spkiDer: trusted.spkiDer}]),
  };
}

let receiptCache: ReceiptFixture | undefined;

/** The signed receipts, minted once; key generation is the slowest step in the fixture. */
function receipts(): ReceiptFixture {
  receiptCache ??= receiptFixture();
  return receiptCache;
}

/**
 * Writes one complete schema 0.2 fixture workspace to a fresh temporary directory.
 *
 * @returns Absolute path of the new workspace root.
 */
export function createFixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-topology-'));
  roots.push(root);
  const write = (path: string, lines: readonly string[]): void => {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), {recursive: true});
    writeFileSync(absolute, `${lines.join('\n')}\n`);
  };

  write('spec.yaml', [
    'schema: "0.2"',
    'project:',
    '  name: topology-suite',
    '  language: typescript',
    '  purpose: Prove that gates and verdicts never depend on the agent topology.',
    '  assurance_level: L2',
    '  scenario_policy: advisory',
  ]);
  write('spec/capabilities.yaml', [
    'capabilities:',
    '  - id: governance',
    '    title: Governance',
    '    outcome: Keep every completion judged by recorded evidence.',
    '  - id: observability',
    '    title: Observability',
    '    outcome: Keep the running cycle inspectable.',
  ]);
  write('spec/architecture.yaml', [
    'layers:',
    '  - [spec]',
    '  - [cli]',
    'rules:',
    '  - id: AR-11111111',
    '    kind: forbidden_import',
    '    from: spec',
    '    to: cli',
    '    rationale: Keep the specification layer reusable outside the entry layer.',
  ]);

  write(SHARDS[TARGET]!, [
    `id: ${TARGET}`,
    'title: Target feature',
    'status: done',
    'purpose: Give the topology suite one complete contract to address.',
    `modules: [${TARGET_ONLY_PATH}, ${SHARED_PATH}]`,
    `depends_on: [${PREREQUISITE}]`,
    'capability_refs: [governance]',
    'acceptance_criteria:',
    `  - id: ${BARE_CRITERION}`,
    '    kind: behavior',
    '    statement: When the suite runs a bound testcase, the system shall record one observation.',
    `  - id: ${CONSTRAINT_CRITERION}`,
    '    kind: constraint',
    '    statement: The system shall name every declared owner of a shared module.',
    '    rationale: A shared module has several owners, so an impact answer must name them.',
    '    constraint_refs: [AR-11111111]',
    `  - id: ${RECEIPT_CRITERION}`,
    '    kind: behavior',
    '    statement: When a receipt is verified, the system shall clear the independence obligation.',
  ]);
  write(SHARDS[PREREQUISITE]!, [
    `id: ${PREREQUISITE}`,
    'title: Prerequisite feature',
    'status: done',
    'purpose: Supply the contract the target feature builds on.',
    'modules: [src/p-only.ts]',
    'depends_on: []',
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-b1b1b1b1',
    '    kind: behavior',
    '    statement: The system shall supply the prerequisite contract.',
  ]);
  write(SHARDS[DEPENDENT]!, [
    `id: ${DEPENDENT}`,
    'title: Dependent feature',
    'status: in_progress',
    'purpose: Depend on the target so the graph direction is observable.',
    'modules: [src/d-only.ts]',
    `depends_on: [${TARGET}]`,
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-c1c1c1c1',
    '    kind: behavior',
    '    statement: The system shall depend on the target contract.',
  ]);
  write(SHARDS[SIBLING]!, [
    `id: ${SIBLING}`,
    'title: Sibling feature',
    'status: in_progress',
    'purpose: Co-own the shared module so an impact answer can overexpand.',
    `modules: [${SHARED_PATH}, src/s-only.ts]`,
    'depends_on: []',
    'capability_refs: []',
    'acceptance_criteria:',
    `  - id: ${BARE_CRITERION}`,
    '    kind: behavior',
    '    statement: When the sibling is edited, the system shall keep the bare identity ambiguous.',
    '  - id: AC-d1d1d1d1',
    '    kind: behavior',
    '    statement: The system shall keep the sibling contract separate.',
  ]);

  write(TARGET_ONLY_PATH, [
    'export function targetOnly(input: string): string {',
    `  const marker = '${BODY_MARKER}';`,
    '  return `${input}:${marker}`;',
    '}',
  ]);
  write(SHARED_PATH, [
    'export function shared(input: number): number {',
    `  const marker = '${BODY_MARKER}';`,
    '  return input + marker.length;',
    '}',
  ]);
  write('src/p-only.ts', ['export const prerequisite = true;']);
  write('src/d-only.ts', ['export const dependent = true;']);
  write('src/s-only.ts', ['export const sibling = true;']);

  write('tests/target.test.ts', [
    "import {describe, expect, test} from 'vitest';",
    '',
    "describe('target', () => {",
    `  test('[covers:${TARGET}/${BARE_CRITERION}] records one observation', () => {`,
    '    expect(true).toBe(true);',
    '  });',
    `  test('[covers:${TARGET}/${CONSTRAINT_CRITERION}] names every owner', () => {`,
    '    expect(true).toBe(true);',
    '  });',
    '});',
  ]);
  write('tests/unbound.test.ts', [
    "import {describe, expect, test} from 'vitest';",
    '',
    "describe('unbound', () => {",
    "  test('an unrelated passing case', () => {",
    '    expect(true).toBe(true);',
    '  });',
    '});',
  ]);

  const receiptFiles = receipts();
  write(`spec/evidence/${TARGET}/verified.yaml`, [receiptFiles.verified.trimEnd()]);
  write(`spec/evidence/${TARGET}/asserted.yaml`, [receiptFiles.asserted.trimEnd()]);
  write(join('.cladding', 'events.log.jsonl'), EVENT_LOG.map((event) => JSON.stringify(event)));
  return root;
}

/** Copies one fixture workspace so an arm's edit never touches the shared original. */
export function copyFixtureWorkspace(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-topology-copy-'));
  roots.push(root);
  cpSync(source, root, {recursive: true});
  rmSync(join(root, JUNIT_PATH), {force: true});
  return root;
}

// ─── independent oracle scans ───

/** One shard as a plain YAML record; no compiler, join, or traversal is involved. */
interface ShardRecord {
  readonly id: string;
  readonly shard: string;
  readonly status: string;
  readonly modules: readonly string[];
  readonly dependsOn: readonly string[];
  readonly capabilityRefs: readonly string[];
  readonly criteria: readonly string[];
}

/**
 * Reads every feature shard as a sorted record set.
 *
 * This is the independent oracle the validation protocol asks for: a plain YAML read and a
 * sorted scan, never the compiler relation the suite is comparing arms across.
 *
 * @param root - Workspace root to scan.
 * @returns Shard records sorted by feature id.
 */
export function shardRecords(root: string): readonly ShardRecord[] {
  const directory = join(root, 'spec', 'features');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => {
      const shard = `spec/features/${name}`;
      const parsed = yaml.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>;
      const criteria = Array.isArray(parsed.acceptance_criteria) ? parsed.acceptance_criteria : [];
      return {
        id: String(parsed.id),
        shard,
        status: String(parsed.status),
        modules: (Array.isArray(parsed.modules) ? parsed.modules : []).map(String).sort(),
        dependsOn: (Array.isArray(parsed.depends_on) ? parsed.depends_on : []).map(String).sort(),
        capabilityRefs: (Array.isArray(parsed.capability_refs) ? parsed.capability_refs : []).map(String).sort(),
        criteria: criteria.map((entry) => String((entry as Record<string, unknown>).id)).sort(),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Feature ids a change to `paths` stales, by sorted-record scan.
 *
 * A feature is stale when its own shard changed or when it declares any changed path; nothing
 * here consults the assurance closure, which is the relation this oracle must stay independent of.
 *
 * @param records - Shard records from {@link shardRecords}.
 * @param paths - Repository-relative paths the edit changed.
 * @returns Sorted stale feature ids.
 */
export function staleClosure(records: readonly ShardRecord[], paths: readonly string[]): readonly string[] {
  const changed = new Set(paths);
  return records
    .filter((record) => changed.has(record.shard) || record.modules.some((path) => changed.has(path)))
    .map((record) => record.id)
    .sort();
}

/**
 * Feature ids other than `feature` that declare any of `paths`.
 *
 * @param records - Shard records from {@link shardRecords}.
 * @param feature - The acting feature, excluded from its own impact.
 * @param paths - Observed write paths.
 * @returns Sorted co-owner feature ids.
 */
export function coOwnerImpact(
  records: readonly ShardRecord[],
  feature: string,
  paths: readonly string[],
): readonly string[] {
  const written = new Set(paths);
  return records
    .filter((record) => record.id !== feature && record.modules.some((path) => written.has(path)))
    .map((record) => record.id)
    .sort();
}

/** Every repository-relative file path under one workspace, sorted. */
function fileManifest(root: string, directory: string = root): readonly string[] {
  return readdirSync(directory, {withFileTypes: true})
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return fileManifest(root, absolute);
      return [relative(root, absolute).replaceAll('\\', '/')];
    })
    .sort();
}

/** Paths whose bytes differ between two workspaces, sorted; the host's own diff. */
export function observedDiff(before: string, after: string): readonly string[] {
  const paths = new Set([...fileManifest(before), ...fileManifest(after)]);
  const bytesOf = (root: string, path: string): string | undefined => {
    try {
      return statSync(join(root, path)).isFile() ? readFileSync(join(root, path)).toString('base64') : undefined;
    } catch {
      return undefined;
    }
  };
  return [...paths]
    .filter((path) => !path.startsWith('.cladding/') && bytesOf(before, path) !== bytesOf(after, path))
    .sort();
}

// ─── shared observation and reduction ───

/** One complete observation of a workspace: gate evidence, proof views, and a verdict. */
export interface WorkspaceObservation {
  readonly inputSha256: string;
  readonly ledger: CurrentGateTestcaseLedger | undefined;
  /** Proof rows this gate run observed; the host hands them to a verify projection. */
  readonly proofViews: readonly CriterionProofView[];
  readonly verdictDigest: string;
  readonly proofRows: readonly {readonly criterion: string; readonly test: string}[];
}

/**
 * Observes one workspace through the shipped completion profile.
 *
 * Every arm's edit is reduced through this same path, so a verdict difference can only come
 * from a different edit. The gate report is deleted and rewritten inside the primed session
 * because the capture seam only accepts a report this run produced.
 *
 * @param root - Workspace root to observe.
 * @returns The sealed ledger, a comparable verdict digest, and the per-criterion proof rows.
 */
export function observeWorkspace(root: string): WorkspaceObservation {
  const compilation = compileSpecWorkspace(root);
  const profile = assuranceProfile('completion', 'L2');
  const scopeAddresses = [`feature:${TARGET}`];
  const snapshot = workspaceProfileSnapshot(root, compilation, {
    profile,
    scopeAddresses,
    hasExecutableTests: true,
    requiresHuman: false,
  });
  rmSync(join(root, JUNIT_PATH), {force: true});
  primeTestRunCache(root, snapshot.inputSha256);
  try {
    mkdirSync(join(root, '.cladding'), {recursive: true});
    writeFileSync(join(root, JUNIT_PATH), JUNIT_REPORT);
    captureCurrentJUnitProof(root, ['vitest', 'run']);
    const currentRun = currentGateProofEvidence(root, snapshot.inputSha256);
    const sealed = currentGateTestcaseLedger(root, snapshot.inputSha256);
    const proofViews = currentProofViewsFromWorkspace(
      root, compilation, snapshot.effectiveScopeAddresses, currentRun, snapshot.inputSha256,
    );
    const verdict = reduceLegacyStageAdapter({
      profile,
      configuredAssuranceLevel: 'L2',
      completeScope: snapshot.complete,
      scopeAddresses: snapshot.effectiveScopeAddresses,
      inputAddresses: compilation.nodes.map((node) => node.address).sort(),
      inputSha256: snapshot.inputSha256,
      hasExecutableTests: hasApplicableSchema02TestCriteria(compilation, snapshot.effectiveScopeAddresses),
      hasOracleProof: false,
      hasDeliverable: false,
      requiresQuality: false,
      requiresHuman: false,
      proofViews,
      criterionObservations: snapshot.criterionObservations,
      staticCriterionScope: snapshot.staticCriterionScope,
      migrationBaselineCandidates: snapshot.migrationBaselineCandidates,
      exactProofRequired: true,
      currentProofObservationIdentity: currentRunProofIdentity(currentRun),
      stages: profile.obligations.map((stage) => ({stage, status: 'pass' as const})),
      environmentClass: 'test',
    });
    return {
      inputSha256: snapshot.inputSha256,
      ledger: 'ledger' in sealed ? sealed.ledger : undefined,
      proofViews,
      verdictDigest: digest(JSON.stringify({
        input: verdict.input_sha256,
        state: verdict.state,
        profile_complete: verdict.profile_complete,
        achieved: verdict.achieved_assurance_level,
        independence: verdict.independence,
        results: [...verdict.results]
          .map((result) => ({obligation: result.obligation, subject: result.subject, state: result.state, blocking: result.blocking}))
          .sort((left, right) => `${left.obligation}${left.subject}`.localeCompare(`${right.obligation}${right.subject}`)),
      })),
      proofRows: [...proofViews]
        .map((view) => ({criterion: view.criterion, test: view.test.state}))
        .sort((left, right) => left.criterion.localeCompare(right.criterion)),
    };
  } finally {
    clearTestRunCache();
  }
}

// ─── arms ───

/** Arm identifiers whose answers D19 requires to be identical. */
export type ArmId = 'A' | 'B' | 'C';

/** Every arm the simulation builds a packet for, including the two comparators. */
export type SimulationArm = ArmId | 'D' | 'E';

/** One fixture read an arm paid for because its packet did not carry the fact. */
export interface CountedRead {
  readonly path: string;
  readonly bytes: number;
  readonly reason: string;
}

/** Facts an executor may ask for; each arm answers only from its own packet or a counted read. */
export interface FactView {
  readonly arm: ArmId;
  /** Serialized packet bytes plus every counted read and follow-up. */
  bytes(): number;
  /** Reads this arm paid for, in the order it made them. */
  reads(): readonly CountedRead[];
  /** The feature address this packet is about. */
  subject(): string;
  /** Criterion ids the packet carries for the subject. */
  criteria(): readonly string[];
  /** The authored WHY of one constraint criterion, when the packet carries it. */
  rationale(criterionId: string): string | undefined;
  /** How this operation's write set was learned; `unknown` is never empty. */
  writeScopeProvenance(): string;
  /** Resolves a criterion spelling; a bare id claimed by several features is ambiguous. */
  resolveCriterion(spelling: string): {readonly address: string} | {readonly ambiguous: readonly string[]};
  /** Feature ids other than the subject that declare any of `paths`. */
  coOwners(paths: readonly string[]): readonly string[];
  /** Prerequisite feature ids, in the contract's own direction. */
  prerequisites(): readonly string[];
  /** Canonical shard revisions the packet was built from. */
  revisions(): Readonly<Record<string, string>>;
  /** Shard path of one feature. */
  shardOf(feature: string): string | undefined;
  /** Capability ids the subject already links. */
  capabilityRefs(): readonly string[];
  /** Declared proof carriers per criterion. */
  bindings(): readonly {readonly criterion: string; readonly artifacts: readonly string[]}[];
  /** Observed testcase state per criterion. */
  observed(): readonly {readonly criterion: string; readonly state: string}[];
  /** Freshness facts for the subject. */
  freshness(): {readonly criteria: number; readonly declared: number; readonly observed: number; readonly unbound: readonly string[]};
  /** Gate rows the observe projection retained. */
  gateResults(): readonly string[];
  /** Receipt files under `spec/evidence/`, read from the fixture by every arm alike. */
  receiptFiles(): readonly {readonly path: string; readonly source: string}[];
  /** Event log lines, read from the fixture by every arm alike. */
  eventLines(): readonly string[];
}

/** Persona bytes each shipped dispatch carries; `planner` is a labelled spec-edit proxy. */
export const PERSONA_FOR_PROFILE: Readonly<Record<TaskProfile, string>> = Object.freeze({
  'spec-edit': 'planner',
  implement: 'developer',
  verify: 'reviewer',
  observe: 'observability',
  'blind-oracle': 'blind-author',
});

/** Task profiles whose arm A persona is a labelled proxy: the shipped loop has no such dispatch. */
export const PROXY_PERSONA_PROFILES: readonly TaskProfile[] = ['spec-edit', 'observe', 'blind-oracle'];

/** The shipped dispatch packet for one feature, exactly as `ctxFor` serializes it. */
export function shippedDispatchPacket(root: string, feature: string): string {
  const spec = loadSpec(root);
  const entry = spec.features.find((candidate) => candidate.id === feature);
  if (entry === undefined) throw new Error(`shipped dispatch packet needs a feature; ${feature} is absent`);
  return JSON.stringify({
    featureId: entry.id,
    featureShard: JSON.stringify(entry),
    guardrails: [],
    cwd: root,
  });
}

/** Persona prompt bytes, or zero when the persona-removal ablation is active. */
export function personaBytes(profile: TaskProfile, removed: boolean): number {
  return removed ? 0 : Buffer.byteLength(loadPersona(PERSONA_FOR_PROFILE[profile]).body, 'utf8');
}

/** One retained section body, or undefined when the packer dropped or never built it. */
function sectionBody(envelope: CycleContextEnvelope, id: string): Record<string, unknown> | undefined {
  const section: ContextSection | undefined = envelope.sections.find((entry) => entry.id === id);
  return section === undefined ? undefined : section.body as Record<string, unknown>;
}

/** How an arm was configured for one item; the fault control is data, never a code path. */
export interface ArmRequest {
  readonly arm: ArmId;
  readonly root: string;
  readonly profile: TaskProfile;
  /** The feature the packet is built for; the wrong-feature control points it elsewhere. */
  readonly feature: string;
  /** Predicted or observed write paths for this item. */
  readonly writePaths: readonly string[];
  /** Provenance of that write scope; arm C's verify packet always observes a real diff. */
  readonly provenance: 'predicted' | 'observed';
  /** Persona prompt bytes are dropped for the removal ablation. */
  readonly personaRemoved: boolean;
  /** Post-build transform that removes one fact, for the eight ablations. */
  readonly ablate?: (envelope: CycleContextEnvelope) => CycleContextEnvelope;
}

/** What this gate run observed, handed identically to every arm that can read it. */
export interface GateObservation {
  readonly ledger: CurrentGateTestcaseLedger | undefined;
  readonly proofViews: readonly CriterionProofView[];
}

/** The graph workspace one arm reads, with the sealed gate ledger joined in. */
function armWorkspace(root: string, observation: GateObservation | undefined): GraphIrV2Workspace {
  return loadGraphIrV2Workspace(root, observation?.ledger);
}

/** Blanks one whole section body, so an ablation removes a fact after packing. */
export function blankSection(sectionId: string): (envelope: CycleContextEnvelope) => CycleContextEnvelope {
  return (envelope) => ({
    ...envelope,
    sections: envelope.sections.map((section) => section.id === sectionId ? {...section, body: {}} : section),
  });
}

/** Removes the authored WHY from every criterion a section carries, leaving identity intact. */
export function stripCriterionRationale(sectionId: string): (envelope: CycleContextEnvelope) => CycleContextEnvelope {
  return (envelope) => ({
    ...envelope,
    sections: envelope.sections.map((section) => {
      if (section.id !== sectionId) return section;
      const body = section.body as {criteria?: Record<string, unknown>[]};
      if (!Array.isArray(body.criteria)) return section;
      return {
        ...section,
        body: {...body, criteria: body.criteria.map((entry) => {
          const copy = {...entry};
          delete copy.rationale;
          return copy;
        })},
      };
    }),
  });
}

/** The envelope-backed arms share one reader; A reconstructs the same facts from files. */
interface EnvelopePacket {
  readonly envelope: CycleContextEnvelope;
  readonly bytes: number;
}

/**
 * Builds one arm's packets.
 *
 * Arm B receives ONE envelope for the requested profile. Arm C receives a fresh envelope per
 * profile, each a pure function of its own inputs: no C packet reads a field another packet
 * produced, which is what lets a host split the work across separate agents.
 *
 * @param request - The arm, workspace, profile, write scope, and any ablation.
 * @param ledger - Sealed gate ledger from {@link observeWorkspace}.
 * @returns The packets and their exact serialized bytes.
 */
export function buildArmPackets(
  request: ArmRequest,
  observation: GateObservation | undefined,
): Readonly<Record<string, EnvelopePacket>> {
  const workspace = armWorkspace(request.root, observation);
  const profiles: readonly TaskProfile[] = request.arm === 'C'
    ? [...new Set<TaskProfile>(['spec-edit', 'implement', 'verify', 'observe', request.profile])]
    : [request.profile];
  const packets: Record<string, EnvelopePacket> = {};
  for (const profile of profiles) {
    const built = buildCycleContextEnvelope(workspace, {
      task: profile,
      feature: request.feature,
      write_scope: {paths: request.writePaths, provenance: profile === 'verify' ? 'observed' : request.provenance},
      ...(profile === 'observe' || profile === 'verify' ? {diagnostics: [GATE_DIAGNOSTIC]} : {}),
      ...(profile === 'verify' && observation !== undefined ? {proof_views: observation.proofViews} : {}),
    }, {cwd: request.root});
    packets[profile] = {
      envelope: request.ablate === undefined ? built : request.ablate(built),
      bytes: Buffer.byteLength(JSON.stringify(built), 'utf8') + personaBytes(profile, true),
    };
  }
  return packets;
}

/** Reads one fixture file and records the cost against the arm that needed it. */
function countedRead(root: string, path: string, reason: string, log: CountedRead[]): string {
  const source = readFileSync(join(root, path), 'utf8');
  log.push({path, bytes: Buffer.byteLength(source, 'utf8'), reason});
  return source;
}

/** Receipt and event reads every arm makes, because no envelope section carries either fact. */
function sharedFixtureReads(root: string, log: CountedRead[]): {
  receiptFiles(): readonly {readonly path: string; readonly source: string}[];
  eventLines(): readonly string[];
} {
  // Read on demand, not on construction: an item that never asks about independence or
  // adoption must not be billed for the files that answer them.
  let receipts: readonly {path: string; source: string}[] | undefined;
  let events: readonly string[] | undefined;
  return {
    receiptFiles: () => {
      receipts ??= readdirSync(join(root, 'spec', 'evidence', TARGET)).sort().map((name) => ({
        path: `spec/evidence/${TARGET}/${name}`,
        source: countedRead(root, `spec/evidence/${TARGET}/${name}`, 'the envelope carries no per-receipt assurance section', log),
      }));
      return receipts;
    },
    eventLines: () => {
      events ??= countedRead(root, join('.cladding', 'events.log.jsonl'), 'the envelope carries no adoption telemetry section', log)
        .split('\n').filter((line) => line.trim() !== '');
      return events;
    },
  };
}

/**
 * The arm A fact view: the shipped persona dispatch plus counted legacy reads.
 *
 * A's packet is one feature's JSON. Every fact outside that shard — ownership, direction,
 * declared bindings, observed results, freshness — costs a named file read, which is exactly
 * the reconstruction cost arm E measures in full.
 */
function shippedFactView(request: ArmRequest, packet: string, packetBytes: number): FactView {
  const dispatched = JSON.parse(packet) as {featureId: string; featureShard: string};
  const log: CountedRead[] = [];
  const shared = sharedFixtureReads(request.root, log);
  let records: readonly ShardRecord[] | undefined;
  const scan = (reason: string): readonly ShardRecord[] => {
    if (records === undefined) {
      for (const path of Object.values(SHARDS)) countedRead(request.root, path, reason, log);
      records = shardRecords(request.root);
    }
    return records;
  };
  const self = (): ShardRecord => {
    const record = scan('the dispatch packet carries one shard only').find((entry) => entry.id === request.feature);
    if (record === undefined) throw new Error(`arm A cannot read ${request.feature}`);
    return record;
  };
  let report: string | undefined;
  const gateReport = (): string => {
    report ??= countedRead(request.root, JUNIT_PATH, 'the dispatch packet carries no observed result', log);
    return report;
  };
  const bindingsFromTests = (): readonly {criterion: string; artifacts: readonly string[]}[] => {
    const files = ['tests/target.test.ts', 'tests/unbound.test.ts'];
    const found = new Map<string, Set<string>>();
    for (const file of files) {
      const source = countedRead(request.root, file, 'the dispatch packet carries no declared binding', log);
      for (const match of source.matchAll(/\[covers:(F-[^/]+)\/(AC-[^\]]+)]/g)) {
        if (match[1] !== request.feature) continue;
        const set = found.get(match[2]!) ?? new Set<string>();
        set.add(file);
        found.set(match[2]!, set);
      }
    }
    return self().criteria.map((criterion) => ({criterion, artifacts: [...(found.get(criterion) ?? [])].sort()}));
  };
  return {
    arm: request.arm,
    bytes: () => packetBytes + log.reduce((total, entry) => total + entry.bytes, 0),
    reads: () => [...log],
    subject: () => dispatched.featureId,
    criteria: () => self().criteria,
    rationale: (criterionId) => {
      const shard = scan('a rationale lives in the shard the packet serialized')
        .find((entry) => entry.id === dispatched.featureId);
      if (shard === undefined) return undefined;
      const parsed = yaml.parse(readFileSync(join(request.root, shard.shard), 'utf8')) as Record<string, unknown>;
      const criteria = (Array.isArray(parsed.acceptance_criteria) ? parsed.acceptance_criteria : []) as Record<string, unknown>[];
      const found = criteria.find((entry) => entry.id === criterionId);
      return typeof found?.rationale === 'string' ? found.rationale : undefined;
    },
    // The shipped dispatch carries no write scope: the acting agent knows only its own
    // intent, which is exactly what the envelope arms receive as `predicted`.
    writeScopeProvenance: () => request.provenance,
    resolveCriterion: (spelling) => {
      if (spelling.includes('/')) {
        const [featurePart, criterionPart] = spelling.split('/');
        return self().criteria.includes(criterionPart!)
          ? {address: `criterion:${spelling}`}
          : {ambiguous: featurePart === undefined ? [] : [featurePart]};
      }
      const claimants = scan('a bare identity needs every shard to disambiguate')
        .filter((record) => record.criteria.includes(spelling)).map((record) => record.id).sort();
      return claimants.length === 1 ? {address: `criterion:${claimants[0]}/${spelling}`} : {ambiguous: claimants};
    },
    coOwners: (paths) => coOwnerImpact(scan('ownership lives in every other shard'), request.feature, paths),
    prerequisites: () => self().dependsOn,
    revisions: () => Object.fromEntries(scan('a revision is the shard bytes').map((record) => [
      record.shard, digest(readFileSync(join(request.root, record.shard), 'utf8')),
    ])),
    shardOf: (feature) => scan('a shard path is not in the packet').find((record) => record.id === feature)?.shard,
    capabilityRefs: () => self().capabilityRefs,
    bindings: bindingsFromTests,
    observed: () => {
      const source = gateReport();
      return self().criteria.map((criterion) => {
        const matcher = new RegExp(`name="[^"]*\\[covers:${request.feature}/${criterion}][^"]*"(\\s*/>|>\\s*<failure)`);
        const match = matcher.exec(source);
        return {criterion, state: match === undefined || match === null ? 'unverified' : match[1]!.includes('failure') ? 'failed' : 'verified'};
      });
    },
    freshness: () => {
      const declared = bindingsFromTests();
      const observedRows = declared.filter((entry) => entry.artifacts.length > 0);
      return {
        criteria: self().criteria.length,
        declared: observedRows.length,
        observed: observedRows.length,
        unbound: declared.filter((entry) => entry.artifacts.length === 0).map((entry) => entry.criterion).sort(),
      };
    },
    gateResults: () => [GATE_DIAGNOSTIC.id],
    receiptFiles: () => shared.receiptFiles(),
    eventLines: () => shared.eventLines(),
  };
}

/**
 * The arm B and C fact view: envelope sections only.
 *
 * A section the profile declares LAZY is absent from the default packet by design. When an
 * executor needs one the view issues exactly ONE follow-up — a second envelope built with
 * `include: [<section>]` — and charges that whole packet's payload bytes to the arm, because a
 * lazily-available summary is retrieved by asking again, not by reading further into a packet
 * that was already sent.
 *
 * No ledger item currently takes that path. AB03 reads co-ownership out of
 * `candidate-affected-paths`, which is a required section, and the other eleven answer from
 * required sections too; the fan-out expansion answers a question none of them asks. The rule
 * is here so that an item which does need it pays the honest price rather than a free read.
 */
function envelopeFactView(
  request: ArmRequest,
  packets: Readonly<Record<string, EnvelopePacket>>,
  observation: GateObservation | undefined,
): FactView {
  const log: CountedRead[] = [];
  const shared = sharedFixtureReads(request.root, log);
  let followUpBytes = 0;
  let followUps = 0;
  const base = packets[request.profile]!.envelope;
  const at = (profile: TaskProfile): CycleContextEnvelope => (packets[profile] ?? packets[request.profile]!).envelope;
  const withFollowUp = (profile: TaskProfile, sectionId: string): Record<string, unknown> | undefined => {
    const present = sectionBody(at(profile), sectionId);
    if (present !== undefined) return present;
    if (!TASK_PROFILES[profile].lazy.includes(sectionId)) return undefined;
    if (followUps >= 1) return undefined;
    followUps += 1;
    const reissued = buildCycleContextEnvelope(armWorkspace(request.root, observation), {
      task: profile,
      feature: request.feature,
      write_scope: {paths: request.writePaths, provenance: profile === 'verify' ? 'observed' : request.provenance},
      include: [sectionId],
    }, {cwd: request.root});
    // The whole second packet is the cost, not just the block it was asked for.
    followUpBytes += reissued.budget.payload_utf8_bytes;
    return sectionBody(reissued, sectionId);
  };
  const criteriaFrom = (): readonly {id: string; rationale?: string}[] => {
    const holder = sectionBody(at('implement'), 'criteria')
      ?? sectionBody(at('spec-edit'), 'target-contract')
      ?? sectionBody(at('verify'), 'contract')
      ?? {};
    return (holder.criteria as {id: string; rationale?: string}[] | undefined) ?? [];
  };
  const proofFacts = (): readonly {criterion: string; proofs: {artifact: string; state: string}[]}[] => {
    const holder = sectionBody(at('implement'), 'required-proof') ?? sectionBody(at('verify'), 'declared-bindings') ?? {};
    return (holder.criteria as {criterion: string; proofs: {artifact: string; state: string}[]}[] | undefined) ?? [];
  };
  return {
    arm: request.arm,
    bytes: () => packets[request.profile]!.bytes + followUpBytes + log.reduce((total, entry) => total + entry.bytes, 0),
    reads: () => [...log, ...(followUps > 0 ? [{path: 'envelope follow-up', bytes: followUpBytes, reason: 'the section is lazy and travels only when a request names it'}] : [])],
    subject: () => {
      // Read from the projected SECTION, never from the envelope header: an ablation that
      // removes the purpose fact must actually take the answer away.
      const purpose = sectionBody(at('implement'), 'purpose') ?? sectionBody(at('spec-edit'), 'intent') ?? sectionBody(at('verify'), 'contract') ?? {};
      return typeof purpose.feature === 'string' ? purpose.feature : '';
    },
    criteria: () => criteriaFrom().map((entry) => entry.id),
    rationale: (criterionId) => criteriaFrom().find((entry) => entry.id === criterionId)?.rationale,
    writeScopeProvenance: () => {
      const scope = sectionBody(at('implement'), 'predicted-write-scope')
        ?? sectionBody(at('verify'), 'observed-write-scope') ?? {};
      return typeof scope.provenance === 'string' ? scope.provenance : 'unknown';
    },
    resolveCriterion: (spelling) => {
      if (spelling.includes('/')) {
        const [featurePart, criterionPart] = spelling.split('/');
        return criteriaFrom().some((entry) => entry.id === criterionPart)
          ? {address: `criterion:${spelling}`}
          : {ambiguous: featurePart === undefined ? [] : [featurePart]};
      }
      // A packet is scoped to ONE feature, so it cannot see a second claimant and must
      // refuse a bare identity rather than resolve it against the only feature it holds.
      return {ambiguous: []};
    },
    coOwners: (paths) => {
      const modules = (withFollowUp('implement', 'candidate-affected-paths')?.modules
        ?? sectionBody(at('verify'), 'changed-artifacts')?.owners) as {path: string; owners: string[]}[] | undefined;
      const written = new Set(paths);
      return [...new Set((modules ?? [])
        .filter((entry) => written.has(entry.path))
        .flatMap((entry) => entry.owners)
        .filter((owner) => owner !== base.feature))].sort();
    },
    prerequisites: () => {
      const body = withFollowUp('implement', 'prerequisites') ?? {};
      return ((body.prerequisites as {id: string}[] | undefined) ?? []).map((entry) => entry.id).sort();
    },
    revisions: () => base.input_revisions,
    shardOf: (feature) => feature === base.feature ? Object.keys(base.input_revisions)[0] : undefined,
    capabilityRefs: () => {
      const links = sectionBody(at('spec-edit'), 'affected-links') ?? {};
      return ((links.capabilities as {id: string}[] | undefined) ?? []).map((entry) => entry.id).sort();
    },
    bindings: () => proofFacts().map((entry) => ({
      criterion: entry.criterion,
      artifacts: [...new Set(entry.proofs.map((proof) => proof.artifact))].sort(),
    })),
    observed: () => {
      const results = sectionBody(at('verify'), 'observed-results') ?? {};
      const rows = (results.rows as {criterion: string; test: {state: string}}[] | undefined) ?? [];
      return rows.map((row) => ({criterion: row.criterion.split('/')[1]!, state: row.test.state}));
    },
    freshness: () => {
      const body = sectionBody(at('verify'), 'freshness') ?? sectionBody(at('observe'), 'proof-freshness') ?? {};
      return {
        criteria: Number(body.criteria ?? 0),
        declared: Number(body.declared ?? 0),
        observed: Number(body.observed ?? 0),
        unbound: ((body.unbound as string[] | undefined) ?? []).slice().sort(),
      };
    },
    gateResults: () => {
      const body = sectionBody(at('observe'), 'gate-results') ?? {};
      return ((body.entries as {id: string}[] | undefined) ?? []).map((entry) => entry.id).sort();
    },
    receiptFiles: () => shared.receiptFiles(),
    eventLines: () => shared.eventLines(),
  };
}

/**
 * Builds the fact view one arm answers from.
 *
 * @param request - Arm configuration for this item.
 * @param ledger - Sealed gate ledger so observed proof reaches the envelope arms.
 * @returns The arm's packets and the view that reads only them.
 */
export function armFactView(
  request: ArmRequest,
  observation: GateObservation | undefined,
): {readonly packets: Readonly<Record<string, EnvelopePacket>>; readonly view: FactView} {
  if (request.arm === 'A') {
    const packet = shippedDispatchPacket(request.root, request.feature);
    const bytes = Buffer.byteLength(packet, 'utf8') + personaBytes(request.profile, request.personaRemoved);
    return {packets: {}, view: shippedFactView(request, packet, bytes)};
  }
  const packets = buildArmPackets(request, observation);
  return {packets, view: envelopeFactView(request, packets, observation)};
}

// ─── work items ───

/** The two runs each ledger item makes: the nominal task and its preregistered fault. */
export type RunMode = 'nominal' | 'fault';

/** What an arm proposes after reading its packet. */
export interface AbOutcome {
  /** Contract addresses the answer names, sorted. */
  readonly addresses: readonly string[];
  /** A stable refusal code; a refusal is a valid, comparable result. */
  readonly refusal?: string;
  /** Typed spec operations to apply, when the item edits the contract. */
  readonly operations?: readonly SpecEditOperation[];
  /** Source files to rewrite, when the item implements instead of editing the spec. */
  readonly writes?: readonly {readonly path: string; readonly content: string}[];
  /** Whether the operation must be prepared against the pre-concurrent revision. */
  readonly staleBase?: boolean;
  /** Task-specific comparable facts the oracle pins. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** One preregistered ledger item. */
export interface AbItem {
  readonly id: string;
  readonly profile: TaskProfile;
  readonly objective: string;
  readonly faultControl: string;
  /** Feature the packet addresses in each mode; the wrong-feature control redirects it. */
  feature(mode: RunMode): string;
  /** Write paths this item predicts or observes in each mode. */
  writePaths(mode: RunMode): readonly string[];
  /** Answers from the arm's packet alone. */
  run(view: FactView, mode: RunMode): AbOutcome;
}

/** Bare criterion identities the packet-scoped arms must refuse. */
const AMBIGUOUS = 'AMBIGUOUS_BARE_CRITERION';

/** Sorted address list helper, so every arm's answer is comparable by value. */
function addresses(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/** The twelve preregistered items, in `host_ab_tasks` order. */
export const AB_ITEMS: readonly AbItem[] = Object.freeze([
  {
    id: 'AB01', profile: 'implement', objective: 'locate-feature-contract', faultControl: 'wrong-feature',
    feature: (mode) => mode === 'nominal' ? TARGET : SIBLING,
    writePaths: () => [TARGET_ONLY_PATH],
    run: (view, mode) => {
      const subject = view.subject();
      if (subject !== TARGET) return {addresses: [], refusal: 'WRONG_FEATURE', detail: {packetSubject: subject, requested: TARGET}};
      return {
        addresses: addresses([`feature:${TARGET}`, ...view.criteria().map((id) => `criterion:${TARGET}/${id}`)]),
        detail: {packetSubject: subject, requested: TARGET, mode},
      };
    },
  },
  {
    id: 'AB02', profile: 'implement', objective: 'locate-composite-criterion', faultControl: 'bare-id-collision',
    feature: () => TARGET,
    writePaths: () => [TARGET_ONLY_PATH],
    run: (view, mode) => {
      const spelling = mode === 'nominal' ? `${TARGET}/${BARE_CRITERION}` : BARE_CRITERION;
      const resolved = view.resolveCriterion(spelling);
      if ('ambiguous' in resolved) return {addresses: [], refusal: AMBIGUOUS, detail: {spelling}};
      return {addresses: [resolved.address], detail: {spelling}};
    },
  },
  {
    id: 'AB03', profile: 'implement', objective: 'predict-shared-module-impact', faultControl: 'sibling-overexpansion',
    feature: () => TARGET,
    writePaths: (mode) => mode === 'nominal' ? [TARGET_ONLY_PATH] : [SHARED_PATH],
    run: (view, mode) => {
      const paths = mode === 'nominal' ? [TARGET_ONLY_PATH] : [SHARED_PATH];
      // The constraint criterion is the rule this answer acts under, and the write-scope
      // provenance says whether the answer is a closure at all; without either the impact
      // set would be an unattributed guess, so the executor refuses instead.
      const why = view.rationale(CONSTRAINT_CRITERION);
      const provenance = view.writeScopeProvenance();
      if (why === undefined) return {addresses: [], refusal: 'NO_CONSTRAINT_RATIONALE', detail: {paths}};
      if (provenance === 'unknown') return {addresses: [], refusal: 'UNKNOWN_WRITE_SCOPE', detail: {paths}};
      const impacted = view.coOwners(paths);
      return {
        addresses: addresses(impacted.map((id) => `feature:${id}`)),
        detail: {paths, impacted, provenance, why},
      };
    },
  },
  {
    id: 'AB04', profile: 'implement', objective: 'retrieve-prerequisite-closure', faultControl: 'reverse-direction',
    feature: () => TARGET,
    writePaths: () => [TARGET_ONLY_PATH],
    run: (view, mode) => {
      const prerequisites = view.prerequisites();
      const asked = mode === 'nominal' ? PREREQUISITE : DEPENDENT;
      const present = prerequisites.includes(asked);
      if (!present) return {addresses: addresses(prerequisites.map((id) => `feature:${id}`)), refusal: 'NOT_A_PREREQUISITE', detail: {asked, prerequisites}};
      return {addresses: addresses(prerequisites.map((id) => `feature:${id}`)), detail: {asked, prerequisites}};
    },
  },
  {
    id: 'AB05', profile: 'spec-edit', objective: 'set-feature-purpose', faultControl: 'stale-revision',
    feature: () => TARGET,
    writePaths: () => [SHARDS[TARGET]!],
    run: (view, mode) => ({
      addresses: [`feature:${view.subject()}`],
      operations: [{kind: 'feature.set_purpose', featureId: view.subject(), purpose: 'Give the topology suite one revised contract to address.'}],
      staleBase: mode === 'fault',
      detail: {shard: view.shardOf(view.subject()), revisions: Object.keys(view.revisions()).sort()},
    }),
  },
  {
    id: 'AB06', profile: 'spec-edit', objective: 'upsert-atomic-criterion', faultControl: 'multiple-modal',
    feature: () => TARGET,
    writePaths: () => [SHARDS[TARGET]!],
    run: (view, mode) => {
      const statement = mode === 'nominal'
        ? 'When the topology suite compares arms, the system shall report one identical verdict.'
        : 'When the topology suite compares arms, the system shall report one verdict and shall record one address.';
      const parsed = parseStrictStatement(statement);
      if (parsed.status !== 'valid') {
        return {addresses: [], refusal: 'INVALID_STATEMENT', detail: {issues: parsed.issues.map((issue) => issue.code).sort()}};
      }
      return {
        addresses: [`criterion:${view.subject()}/AC-e1e1e1e1`],
        operations: [{kind: 'criterion.upsert', featureId: view.subject(), criterion: {id: 'AC-e1e1e1e1', kind: 'behavior', statement}}],
        detail: {issues: []},
      };
    },
  },
  {
    id: 'AB07', profile: 'spec-edit', objective: 'link-capability', faultControl: 'shared-catalog-write',
    feature: () => TARGET,
    writePaths: () => [SHARDS[TARGET]!],
    run: (view, mode) => {
      const linked = [...view.capabilityRefs(), 'observability'].sort();
      if (mode === 'fault') {
        // The catalog is shared: minting a capability there to express a per-feature link
        // would write a document no single feature owns. The link belongs on the shard.
        return {addresses: [`feature:${view.subject()}`], refusal: 'SHARED_CATALOG_WRITE', detail: {linked}};
      }
      return {
        addresses: [`feature:${view.subject()}`],
        operations: [{kind: 'feature.set_links', featureId: view.subject(), capabilityRefs: linked}],
        detail: {linked},
      };
    },
  },
  {
    id: 'AB08', profile: 'spec-edit', objective: 'edit-disjoint-shards', faultControl: 'same-shard-race',
    feature: () => TARGET,
    writePaths: (mode) => mode === 'nominal' ? [SHARDS[TARGET]!, SHARDS[SIBLING]!] : [SHARDS[TARGET]!],
    run: (view, mode) => {
      const second = mode === 'nominal' ? SIBLING : TARGET;
      return {
        addresses: addresses([`feature:${view.subject()}`, `feature:${second}`]),
        operations: [
          {kind: 'feature.set_title', featureId: view.subject(), title: 'Target feature revised'},
          {kind: 'feature.set_title', featureId: second, title: 'Second writer revised'},
        ],
        staleBase: mode === 'fault',
        detail: {second, sameShard: second === view.subject()},
      };
    },
  },
  {
    id: 'AB09', profile: 'verify', objective: 'run-scoped-proof', faultControl: 'unrelated-pass',
    feature: () => TARGET,
    writePaths: () => [SHARED_PATH],
    run: (view, mode) => {
      const observed = view.observed();
      const bound = new Map(view.bindings().map((entry) => [entry.criterion, entry.artifacts]));
      const criterion = mode === 'nominal' ? BARE_CRITERION : RECEIPT_CRITERION;
      const artifacts = bound.get(criterion) ?? [];
      const row = observed.find((entry) => entry.criterion === criterion);
      const proved = artifacts.length > 0 && row?.state === 'verified';
      if (!proved) {
        return {addresses: [`criterion:${TARGET}/${criterion}`], refusal: 'NO_BOUND_PASS', detail: {criterion, artifacts, state: row?.state ?? 'unverified'}};
      }
      return {addresses: [`criterion:${TARGET}/${criterion}`], detail: {criterion, artifacts, state: row?.state ?? 'unverified'}};
    },
  },
  {
    id: 'AB10', profile: 'verify', objective: 'explain-current-failure', faultControl: 'stale-observation',
    feature: () => TARGET,
    writePaths: () => [SHARED_PATH],
    run: (view, mode) => {
      const row = view.observed().find((entry) => entry.criterion === CONSTRAINT_CRITERION);
      // A report only explains a failure while the packet also says the observation is
      // current; freshness is the fact that separates a cause from history.
      const fresh = mode === 'nominal' && view.freshness().observed > 0;
      if (!fresh) {
        // A report whose proof-input revision is not this run's is history, not a cause.
        return {addresses: [`criterion:${TARGET}/${CONSTRAINT_CRITERION}`], refusal: 'STALE_OBSERVATION', detail: {state: row?.state ?? 'unverified', explains: false}};
      }
      return {addresses: [`criterion:${TARGET}/${CONSTRAINT_CRITERION}`], detail: {state: row?.state ?? 'unverified', explains: row?.state === 'failed'}};
    },
  },
  {
    id: 'AB11', profile: 'verify', objective: 'obtain-independent-proof', faultControl: 'asserted-blindness',
    feature: () => TARGET,
    writePaths: () => [SHARED_PATH],
    run: (view, mode) => {
      const trust = receipts().trust;
      const files = mode === 'nominal' ? view.receiptFiles() : view.receiptFiles().filter((file) => file.path.endsWith('asserted.yaml'));
      const assurances = files.map((file) => verifyPortableReceipt(parsePortableReceiptYaml(file.source), trust, {
        subjectSha256: RECEIPT_DIGESTS.subject,
        evidenceSha256: RECEIPT_DIGESTS.evidence,
        capabilityManifestSha256: RECEIPT_DIGESTS.manifest,
      }).assurance).sort();
      const independent = assurances.includes('verified');
      return {
        addresses: [`criterion:${TARGET}/${RECEIPT_CRITERION}`],
        ...(independent ? {} : {refusal: 'SELF_CERTIFIED'}),
        detail: {assurances, independence: independent ? 'independent' : 'self-certified'},
      };
    },
  },
  {
    id: 'AB12', profile: 'observe', objective: 'inspect-cycle-and-adoption', faultControl: 'push-as-pull',
    feature: () => TARGET,
    writePaths: () => [],
    run: (view, mode) => {
      const PUSH = new Set(['impact_card_fired', 'impact_card_skipped', 'session_card_rendered', 'prompt_suggestion_served']);
      const parsed = view.eventLines().map((line) => JSON.parse(line) as {type: string; payload?: Record<string, unknown>});
      // The fault control hands the executor a PUSH-ONLY ledger: cladding spoke on every
      // surface and no agent ever pulled. A reducer that let a hook card stand in for a pull
      // would report adoption from it, so zero pulls has to remain zero.
      const events = mode === 'fault' ? parsed.filter((event) => PUSH.has(event.type)) : parsed;
      let pulls = 0;
      let pushes = 0;
      for (const event of events) {
        if (event.type === 'working_set_served' && event.payload?.resolved === true) pulls += 1;
        else if (PUSH.has(event.type)) pushes += 1;
      }
      return {
        addresses: [`feature:${TARGET}`],
        ...(pulls > 0 ? {} : {refusal: 'PUSH_IS_NOT_PULL'}),
        detail: {pulls, pushes, gate: view.gateResults()},
      };
    },
  },
]);

/** Hand-authored expected answers; nothing here is computed by the code under comparison. */
export const AB_EXPECTATIONS: Readonly<Record<string, Readonly<Record<RunMode, {readonly addresses: readonly string[]; readonly refusal?: string}>>>> = Object.freeze({
  AB01: {
    nominal: {addresses: [`criterion:${TARGET}/${BARE_CRITERION}`, `criterion:${TARGET}/${CONSTRAINT_CRITERION}`, `criterion:${TARGET}/${RECEIPT_CRITERION}`, `feature:${TARGET}`]},
    fault: {addresses: [], refusal: 'WRONG_FEATURE'},
  },
  AB02: {
    nominal: {addresses: [`criterion:${TARGET}/${BARE_CRITERION}`]},
    fault: {addresses: [], refusal: AMBIGUOUS},
  },
  AB03: {
    nominal: {addresses: []},
    fault: {addresses: [`feature:${SIBLING}`]},
  },
  AB04: {
    nominal: {addresses: [`feature:${PREREQUISITE}`]},
    fault: {addresses: [`feature:${PREREQUISITE}`], refusal: 'NOT_A_PREREQUISITE'},
  },
  AB05: {
    nominal: {addresses: [`feature:${TARGET}`]},
    fault: {addresses: [`feature:${TARGET}`]},
  },
  AB06: {
    nominal: {addresses: [`criterion:${TARGET}/AC-e1e1e1e1`]},
    fault: {addresses: [], refusal: 'INVALID_STATEMENT'},
  },
  AB07: {
    nominal: {addresses: [`feature:${TARGET}`]},
    fault: {addresses: [`feature:${TARGET}`], refusal: 'SHARED_CATALOG_WRITE'},
  },
  AB08: {
    nominal: {addresses: [`feature:${TARGET}`, `feature:${SIBLING}`].sort()},
    fault: {addresses: [`feature:${TARGET}`]},
  },
  AB09: {
    nominal: {addresses: [`criterion:${TARGET}/${BARE_CRITERION}`]},
    fault: {addresses: [`criterion:${TARGET}/${RECEIPT_CRITERION}`], refusal: 'NO_BOUND_PASS'},
  },
  AB10: {
    nominal: {addresses: [`criterion:${TARGET}/${CONSTRAINT_CRITERION}`]},
    fault: {addresses: [`criterion:${TARGET}/${CONSTRAINT_CRITERION}`], refusal: 'STALE_OBSERVATION'},
  },
  AB11: {
    nominal: {addresses: [`criterion:${TARGET}/${RECEIPT_CRITERION}`]},
    fault: {addresses: [`criterion:${TARGET}/${RECEIPT_CRITERION}`], refusal: 'SELF_CERTIFIED'},
  },
  AB12: {
    nominal: {addresses: [`feature:${TARGET}`]},
    fault: {addresses: [`feature:${TARGET}`], refusal: 'PUSH_IS_NOT_PULL'},
  },
});

// ─── apply, then reduce ───

/** What applying one arm's answer to a fresh workspace copy produced. */
export interface AppliedOutcome {
  readonly applied: boolean;
  readonly code?: string;
  readonly changedPaths: readonly string[];
  readonly verdictDigest: string;
  readonly staleClosure: readonly string[];
  readonly impact: readonly string[];
}

/** The complete comparable result of one arm running one item in one mode. */
export interface ArmResult {
  readonly addresses: readonly string[];
  readonly refusal?: string;
  readonly applied: AppliedOutcome;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly bytes: number;
}

const appliedCache = new Map<string, AppliedOutcome>();

/**
 * Applies one arm's answer to a FRESH copy of the fixture and reduces the result.
 *
 * The outcome is memoized on the exact edit, so two arms that produced the same edit share
 * one reduction while two arms that diverged can never share one: the memo key IS the arm's
 * own proposal.
 *
 * @param source - The pristine fixture root.
 * @param feature - The acting feature.
 * @param outcome - What the arm proposed.
 * @param writePaths - The item's declared write scope, so a prediction task still has an impact set.
 * @returns The applied paths, the reduced verdict digest, and the independent closures.
 */
export function applyAndReduce(
  source: string,
  feature: string,
  outcome: AbOutcome,
  writePaths: readonly string[],
): AppliedOutcome {
  const key = JSON.stringify({
    feature,
    writePaths: [...writePaths].sort(),
    refusal: outcome.refusal ?? null,
    operations: outcome.operations ?? null,
    writes: outcome.writes ?? null,
    staleBase: outcome.staleBase ?? false,
  });
  const cached = appliedCache.get(key);
  if (cached !== undefined) return cached;

  const root = copyFixtureWorkspace(source);
  let applied = false;
  let code: string | undefined;
  if (outcome.refusal !== undefined) {
    code = outcome.refusal;
  } else if (outcome.operations !== undefined) {
    const first = outcome.operations.slice(0, 1);
    const rest = outcome.operations.slice(1);
    // Every arm's base revision is read BEFORE any writer runs, which is what makes a stale
    // base a property of the proposal rather than of the order the harness happened to use.
    const firstRevisions = readSpecEditRevisions(root, first);
    const restRevisions = rest.length === 0 ? undefined : readSpecEditRevisions(root, rest);
    prepareSpecEdit(root, first);
    try {
      if (rest.length === 0 && outcome.staleBase === true) {
        // A concurrent writer lands on the same shard first, so the arm's own edit arrives
        // against a revision that no longer exists and must be refused without writing.
        const concurrent: readonly SpecEditOperation[] = [{kind: 'feature.set_title', featureId: feature, title: 'Concurrent writer title'}];
        editSpec({cwd: root, operations: concurrent, inputRevisions: readSpecEditRevisions(root, concurrent)});
      }
      editSpec({cwd: root, operations: first, inputRevisions: firstRevisions});
      if (rest.length > 0) {
        // The second writer prepared against the pre-first-edit revisions. Disjoint shards
        // still commit; the same shard is refused as stale without any further write.
        editSpec({cwd: root, operations: rest, inputRevisions: restRevisions!});
      }
      applied = true;
    } catch (error) {
      code = (error as {code?: string}).code ?? 'ERROR';
    }
  } else if (outcome.writes !== undefined) {
    for (const write of outcome.writes) writeFileSync(join(root, write.path), write.content);
    applied = true;
  } else {
    applied = true;
  }

  const changedPaths = observedDiff(source, root);
  const records = shardRecords(root);
  // The impact set is seeded from what the host OBSERVED: the diff when the item edited
  // something, plus its declared write scope so a prediction item still has one.
  const observedScope = [...new Set([...changedPaths, ...writePaths])].sort();
  const result: AppliedOutcome = Object.freeze({
    applied,
    ...(code === undefined ? {} : {code}),
    changedPaths,
    verdictDigest: observeWorkspace(root).verdictDigest,
    staleClosure: staleClosure(records, changedPaths),
    impact: coOwnerImpact(records, feature, observedScope),
  });
  appliedCache.set(key, result);
  return result;
}

/** Clears the apply/reduce memo; a new fixture generation must not reuse an old verdict. */
export function clearAppliedCache(): void {
  appliedCache.clear();
}

/**
 * Runs one item, in one mode, through one arm, end to end.
 *
 * @param source - The pristine fixture root.
 * @param item - The ledger item.
 * @param arm - Which topology answers.
 * @param mode - Nominal task or its preregistered fault.
 * @param options - Persona removal and section ablation.
 * @returns The comparable answer, applied outcome, and the arm's byte cost.
 */
export function runArm(
  source: string,
  item: AbItem,
  arm: ArmId,
  mode: RunMode,
  options: {
    readonly personaRemoved?: boolean;
    readonly ablate?: (envelope: CycleContextEnvelope) => CycleContextEnvelope;
    readonly observation?: GateObservation;
  } = {},
): ArmResult {
  const request: ArmRequest = {
    arm,
    root: source,
    profile: item.profile,
    feature: item.feature(mode),
    writePaths: item.writePaths(mode),
    provenance: item.profile === 'verify' ? 'observed' : 'predicted',
    personaRemoved: options.personaRemoved ?? false,
    ...(options.ablate === undefined ? {} : {ablate: options.ablate}),
  };
  const {view} = armFactView(request, options.observation);
  const outcome = item.run(view, mode);
  return {
    addresses: outcome.addresses,
    ...(outcome.refusal === undefined ? {} : {refusal: outcome.refusal}),
    applied: applyAndReduce(source, request.feature, outcome, request.writePaths),
    ...(outcome.detail === undefined ? {} : {detail: outcome.detail}),
    bytes: view.bytes(),
  };
}

// ─── arm D and arm E comparators ───

/**
 * A leak candidate is a module line an implementation author wrote that the blind profile's
 * declaration-only extractor would never emit.
 *
 * `exportDecls` keeps only lines starting with `export …`, truncated at the first `{` or `=`.
 * Three classes of line are therefore excluded, because each would false-positive rather than
 * prove a leak:
 *
 *   • the `export …` header itself and the CONTINUATION lines of a multi-line header — a
 *     wrapped parameter such as `cwd: string,` is a substring of some other module's
 *     single-line declaration, so matching it says nothing about a body;
 *   • declaration lines shaped like a parameter or field (`name: Type`), for the same reason;
 *   • blanks, comments, imports, short punctuation runs and closers, since a serialized JSON
 *     packet contains braces, parentheses and semicolons by construction.
 *
 * What remains is executable body: assignments, calls, control flow, and returns.
 *
 * @param source - Full UTF-8 text of one module.
 * @returns Trimmed candidate body lines.
 */
export function leakCandidateLines(source: string): readonly string[] {
  const DECLARATION = /^export\s+(?:async\s+)?(?:abstract\s+)?(?:function|const|let|class|interface|type|enum)\b/;
  const FIELD_OR_PARAMETER = /^(?:readonly\s+)?[A-Za-z_$][\w$]*\??\s*:/;
  const candidates: string[] = [];
  let insideHeader = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const headerClosed = /[{=;]/.test(line);
    if (insideHeader) {
      insideHeader = !headerClosed;
      continue;
    }
    if (DECLARATION.test(line)) {
      insideHeader = !headerClosed;
      continue;
    }
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')
      || line.startsWith('import ') || line.startsWith('export ')
      || line.startsWith('}') || line.startsWith(')') || line.startsWith(']')
      || FIELD_OR_PARAMETER.test(line)
      || line.length < 12
      || (line.match(/\w+/g) ?? []).length < 2) continue;
    candidates.push(line);
  }
  return candidates;
}

/** The legacy read set arm E must open to reconstruct one implement projection's facts. */
export interface LegacyReconstruction {
  /** Section → the files an agent must open to obtain it. */
  readonly map: Readonly<Record<string, readonly string[]>>;
  /** Bytes of only the lines that carry the fact — the grep-style floor. */
  readonly lowerBound: number;
  /** Bytes of every file opened whole — the read-the-file ceiling. */
  readonly upperBound: number;
}

/** Lines of one file that mention any needle, as a grep would return them. */
function matchedBytes(source: string, needles: readonly string[]): number {
  let total = 0;
  for (const line of source.split(/\r?\n/)) {
    if (needles.some((needle) => line.includes(needle))) total += Buffer.byteLength(`${line}\n`, 'utf8');
  }
  return total;
}

/**
 * Measures the arm E reconstruction range for one feature of a workspace.
 *
 * @param root - Workspace root.
 * @param feature - Feature whose projection is being reconstructed.
 * @param index - Pre-scanned corpus index, so a corpus census scans the tree once.
 * @returns The section-to-file map and the matched-line/whole-file byte range.
 */
export function legacyReconstruction(
  root: string,
  feature: string,
  index: CorpusIndex,
): LegacyReconstruction {
  const record = index.shardByFeature.get(feature);
  const files = new Set<string>();
  const map: Record<string, readonly string[]> = {};
  const add = (section: string, paths: readonly string[]): void => {
    map[section] = [...paths].sort();
    for (const path of paths) files.add(path);
  };
  const shard = record?.shard;
  add('purpose, criteria, constraints', shard === undefined ? [] : [shard]);
  add('prerequisites', (record?.dependsOn ?? []).flatMap((id) => {
    const prerequisite = index.shardByFeature.get(id)?.shard;
    return prerequisite === undefined ? [] : [prerequisite];
  }));
  add('candidate paths and ownership fan-out', [...new Set((record?.modules ?? [])
    .flatMap((path) => index.ownersByPath.get(path) ?? [])
    .flatMap((owner) => {
      const peer = index.shardByFeature.get(owner)?.shard;
      return peer === undefined ? [] : [peer];
    }))]);
  add('declared bindings', index.testFilesByFeature.get(feature) ?? []);
  add('observed results', index.reportPath === undefined ? [] : [index.reportPath]);
  add('freshness and attestation', index.attestationPath === undefined ? [] : [index.attestationPath]);

  let lowerBound = 0;
  let upperBound = 0;
  const needles = [feature, ...(record?.modules ?? []), ...(record?.dependsOn ?? [])];
  for (const path of files) {
    const source = index.sourceOf(join(root, path));
    if (source === undefined) continue;
    const matched = matchedBytes(source, needles);
    lowerBound += matched;
    // The attestation ledger is addressed by ROW, not by document: the reconstruction map
    // names "the feature's `spec/attestation.yaml` row", so its ceiling is that row and not
    // the half-megabyte ledger every feature would otherwise appear to open.
    upperBound += path === index.attestationPath ? matched : Buffer.byteLength(source, 'utf8');
  }
  return {map, lowerBound, upperBound};
}

/** One scan of a corpus, shared by every reconstruction measurement over it. */
export interface CorpusIndex {
  readonly shardByFeature: ReadonlyMap<string, {readonly shard: string; readonly modules: readonly string[]; readonly dependsOn: readonly string[]}>;
  readonly ownersByPath: ReadonlyMap<string, readonly string[]>;
  readonly testFilesByFeature: ReadonlyMap<string, readonly string[]>;
  readonly reportPath: string | undefined;
  readonly attestationPath: string | undefined;
  sourceOf(absolute: string): string | undefined;
}

/**
 * Indexes one corpus once: shard paths, module ownership, and `[covers:]` carriers.
 *
 * The `[covers:]` sweep is ONE pass over the test tree that builds feature → files, never a
 * grep per feature; on the self corpus the difference is three orders of magnitude of I/O.
 *
 * @param root - Workspace root.
 * @param shardPaths - Repository-relative feature shard paths.
 * @param testFiles - Repository-relative test files to sweep for carriers.
 * @param reportPath - Gate report path, when the workspace has one.
 * @param attestationPath - Attestation ledger path, when the workspace has one.
 * @returns A reusable index with a memoizing file reader.
 */
export function indexCorpus(
  root: string,
  shardPaths: readonly string[],
  testFiles: readonly string[],
  reportPath: string | undefined,
  attestationPath: string | undefined,
): CorpusIndex {
  const cache = new Map<string, string | undefined>();
  const sourceOf = (absolute: string): string | undefined => {
    if (!cache.has(absolute)) {
      try {
        cache.set(absolute, readFileSync(absolute, 'utf8'));
      } catch {
        cache.set(absolute, undefined);
      }
    }
    return cache.get(absolute);
  };
  const shardByFeature = new Map<string, {shard: string; modules: readonly string[]; dependsOn: readonly string[]}>();
  const ownersByPath = new Map<string, string[]>();
  for (const shard of shardPaths) {
    const source = sourceOf(join(root, shard));
    if (source === undefined) continue;
    const parsed = yaml.parse(source) as Record<string, unknown>;
    const id = typeof parsed?.id === 'string' ? parsed.id : undefined;
    if (id === undefined) continue;
    const modules = (Array.isArray(parsed.modules) ? parsed.modules : []).map(String);
    shardByFeature.set(id, {shard, modules, dependsOn: (Array.isArray(parsed.depends_on) ? parsed.depends_on : []).map(String)});
    for (const path of modules) {
      const owners = ownersByPath.get(path) ?? [];
      owners.push(id);
      ownersByPath.set(path, owners);
    }
  }
  const testFilesByFeature = new Map<string, string[]>();
  for (const file of testFiles) {
    const source = sourceOf(join(root, file));
    if (source === undefined) continue;
    for (const match of source.matchAll(/\[covers:(F-[0-9a-zA-Z-]+)\//g)) {
      const list = testFilesByFeature.get(match[1]!) ?? [];
      if (!list.includes(file)) list.push(file);
      testFilesByFeature.set(match[1]!, list);
    }
  }
  return {
    shardByFeature,
    ownersByPath: new Map([...ownersByPath].map(([path, owners]) => [path, [...new Set(owners)].sort()])),
    testFilesByFeature: new Map([...testFilesByFeature].map(([feature, files]) => [feature, [...files].sort()])),
    reportPath,
    attestationPath,
    sourceOf,
  };
}
