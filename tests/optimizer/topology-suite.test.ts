// Cladding · Spec 0.2 F9b · the D19/D20 A–E topology invariance suite (J11).
//
// D20's enforcement boundary claims that no gate or verdict depends on a general persona id
// and that a host may use one or many general agents without losing a guarantee. That is an
// empirical claim, and this file is where it is either observed or falsified.
//
// The suite answers six separate questions and never lets one stand in for another:
//
//   1. INVARIANCE — the twelve preregistered ledger items, each with its fault control, run
//      through arms A, B, and C. Every arm's edit or refusal is applied to a FRESH copy of one
//      hand-authored fixture and reduced by the shipped completion profile. Addresses, verdict,
//      stale closure, and observed impact must be identical, and must equal a hand-authored
//      expected answer. An arm that agrees with the other two but not with the oracle is a
//      matched failure, not a pass.
//   2. LEAKAGE — the blind-oracle packet must carry no implementation body line, on the
//      fixture and on every one of the self-corpus features.
//   3. PERSONA REMOVAL — the whole matrix rerun with persona prompt bytes at zero must
//      produce byte-identical deterministic results.
//   4. NEGATIVE CONTROLS — a structural scan proving the kernels never reach for a persona id,
//      and eight fact ablations that each break exactly one executor.
//   5. PHYSICAL COST — a self-corpus census of arm A, arm B, and arm E bytes.
//   6. SCALE — the implement projection of a 5,000-feature hub reaching its byte fixed point.
//
// The measurement in (5) is a physical-input record. It is not evidence of efficiency when
// used, and it is not adoption evidence; no live host ran anything here.

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

import {afterAll, describe, expect, test} from 'vitest';
import yaml from 'yaml';

import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../../src/graph/query.js';
import {loadPersona} from '../../src/agents/loader.js';
import {buildCycleContextEnvelope, TASK_PROFILES, type CycleContextEnvelope, type TaskProfile} from '../../src/optimizer/envelope.js';
import {loadSpec} from '../../src/spec/load.js';
import {
  AB_EXPECTATIONS,
  AB_ITEMS,
  BODY_MARKER,
  CONSTRAINT_CRITERION,
  PRIOR_RESULT_MARKER,
  SIBLING,
  TARGET,
  blankSection,
  buildArmPackets,
  clearAppliedCache,
  createFixtureWorkspace,
  indexCorpus,
  leakCandidateLines,
  legacyReconstruction,
  observeWorkspace,
  personaBytes,
  removeFixtureWorkspaces,
  runArm,
  shippedDispatchPacket,
  stripCriterionRationale,
  type AbItem,
  type ArmId,
  type ArmResult,
  type CorpusIndex,
  type GateObservation,
  type RunMode,
} from './topology/ab-tasks.js';
import {syntheticCompilation, syntheticHub, syntheticWorkspace} from './topology/synthetic-graph.js';

const ARMS: readonly ArmId[] = ['A', 'B', 'C'];
const MODES: readonly RunMode[] = ['nominal', 'fault'];
const CWD = process.cwd();

/** Kernels D20 forbids from depending on a persona identity. */
const KERNEL_DIRECTORIES = ['src/assurance', 'src/proof', 'src/spec/compiler'];

/** Persona ids no kernel may reference as an identifier. */
const PERSONA_IDS = ['developer', 'reviewer', 'planner', 'orchestrator', 'observability', 'blind-author'];

/** The exact title AC-27ee0ea7 asks the design validator to resolve; keep it free of `#`. */
const J11_TITLE = 'J11 topology-invariant context is validation-active with a resolvable test reference';

let fixtureRoot: string | undefined;
let fixtureObservation: GateObservation | undefined;

/** The one fixture workspace and its one gate observation, built once for the whole file. */
function fixture(): {readonly root: string; readonly observation: GateObservation} {
  if (fixtureRoot === undefined) {
    fixtureRoot = createFixtureWorkspace();
    const observed = observeWorkspace(fixtureRoot);
    fixtureObservation = {ledger: observed.ledger, proofViews: observed.proofViews};
  }
  return {root: fixtureRoot, observation: fixtureObservation!};
}

let selfCache: GraphIrV2Workspace | undefined;

/** The live self corpus, read once: a cold workspace read costs roughly 1.2 s. */
function selfWorkspace(): GraphIrV2Workspace {
  selfCache ??= loadGraphIrV2Workspace(CWD);
  return selfCache;
}

/** Every file under one directory, repository-relative and sorted. */
function filesUnder(directory: string, extension: string): readonly string[] {
  const walk = (current: string): string[] => readdirSync(current, {withFileTypes: true}).flatMap((entry) => {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.name.endsWith(extension) ? [relative(CWD, absolute).replaceAll('\\', '/')] : [];
  });
  return existsSync(directory) ? walk(directory).sort() : [];
}

/** Source text with comments removed, so an identifier scan sees code and not prose. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((line) => {
    const marker = line.indexOf('//');
    return marker < 0 ? line : line.slice(0, marker);
  }).join('\n');
}

/** The comparable half of one arm result; only these four facts must match across arms. */
function comparable(result: ArmResult): string {
  return JSON.stringify({
    addresses: result.addresses,
    refusal: result.refusal ?? null,
    verdict: result.applied.verdictDigest,
    stale: result.applied.staleClosure,
    impact: result.applied.impact,
    applied: result.applied.applied,
    code: result.applied.code ?? null,
  });
}

/** Runs one item through all three arms in one mode. */
function matrix(item: AbItem, mode: RunMode, personaRemoved = false): Readonly<Record<ArmId, ArmResult>> {
  const {root, observation} = fixture();
  return Object.fromEntries(ARMS.map((arm) => [arm, runArm(root, item, arm, mode, {observation, personaRemoved})])) as Record<ArmId, ArmResult>;
}

// ─── self-corpus census ───

/** One feature's measured physical input across the arms that can be measured offline. */
interface CensusRow {
  readonly feature: string;
  readonly aDeveloper: number;
  readonly aReviewer: number;
  readonly aJsonOnly: number;
  readonly aCycle: number;
  readonly bImplement: number;
  readonly bVerify: number;
  readonly bSpecEdit: number;
  readonly bObserve: number;
  readonly bBlind: number;
  /** The default no-retry cycle: the two packets a host sends when nothing is asked for twice. */
  readonly bCycle: number;
  /** The lazy follow-up — a whole second implement packet, this one carrying the fan-out. */
  readonly bFanOutFollowUp: number;
  /** The fan-out block itself, packed inside the follow-up or named in its omissions. */
  readonly fanOut: number;
  /** The same cycle when the fan-out is actually asked for: implement, follow-up, verify. */
  readonly bCycleWithFollowUp: number;
  readonly eLower: number;
  readonly eUpper: number;
}

let censusCache: readonly CensusRow[] | undefined;

/** Quantile by nearest-rank, so a reported p95 is an observed value and not an interpolation. */
function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1))] ?? 0;
}

/** Measures every self-corpus feature once, for both byte criteria. */
function census(): readonly CensusRow[] {
  if (censusCache !== undefined) return censusCache;
  const workspace = selfWorkspace();
  const spec = loadSpec(CWD);
  const features = workspace.compilation.contract?.features ?? [];
  const developer = Buffer.byteLength(loadPersona('developer').body, 'utf8');
  const reviewer = Buffer.byteLength(loadPersona('reviewer').body, 'utf8');
  const index = indexCorpus(
    CWD,
    filesUnder(join(CWD, 'spec', 'features'), '.yaml'),
    filesUnder(join(CWD, 'tests'), '.ts'),
    existsSync(join(CWD, '.cladding', 'test-report.junit.xml')) ? '.cladding/test-report.junit.xml' : undefined,
    existsSync(join(CWD, 'spec', 'attestation.yaml')) ? 'spec/attestation.yaml' : undefined,
  );
  const rows = features.map((feature) => {
    const entry = spec.features.find((candidate) => candidate.id === feature.id);
    const dispatch = Buffer.byteLength(JSON.stringify({
      featureId: feature.id,
      featureShard: JSON.stringify(entry),
      guardrails: [],
      cwd: CWD,
    }), 'utf8');
    const payload = (task: TaskProfile): number =>
      buildCycleContextEnvelope(workspace, {task, feature: feature.id}, {cwd: CWD}).budget.payload_utf8_bytes;
    const implement = buildCycleContextEnvelope(workspace, {task: 'implement', feature: feature.id}, {cwd: CWD});
    // The lazy follow-up as a host would actually issue it: a second whole packet.
    const followUp = buildCycleContextEnvelope(
      workspace,
      {task: 'implement', feature: feature.id, include: ['ownership-fan-out']},
      {cwd: CWD},
    );
    const fanOutSection = followUp.sections.find((section) => section.id === 'ownership-fan-out');
    const verify = payload('verify');
    const reconstruction = legacyReconstruction(CWD, feature.id, index);
    return {
      feature: feature.id,
      aDeveloper: developer + dispatch,
      aReviewer: reviewer + dispatch,
      aJsonOnly: dispatch,
      aCycle: developer + reviewer + 2 * dispatch,
      bImplement: implement.budget.payload_utf8_bytes,
      bVerify: verify,
      bSpecEdit: payload('spec-edit'),
      bObserve: payload('observe'),
      bBlind: payload('blind-oracle'),
      bCycle: implement.budget.payload_utf8_bytes + verify,
      bFanOutFollowUp: followUp.budget.payload_utf8_bytes,
      // Shed rather than packed on a hub, and then the omission row states its size.
      fanOut: fanOutSection === undefined
        ? followUp.budget.omitted.find((omission) => omission.section === 'ownership-fan-out')?.omitted_bytes ?? 0
        : Buffer.byteLength(JSON.stringify(fanOutSection), 'utf8'),
      bCycleWithFollowUp: implement.budget.payload_utf8_bytes + followUp.budget.payload_utf8_bytes + verify,
      eLower: reconstruction.lowerBound,
      eUpper: reconstruction.upperBound,
    };
  });
  censusCache = rows;
  return rows;
}

afterAll(() => {
  clearAppliedCache();
  removeFixtureWorkspaces();
});

describe('Spec 0.2 A–E topology invariance', () => {
  test('[covers:F-2bbecd83/AC-3ab6f8be] arms A and B and C answer the twelve ledger items identically and match the hand-authored oracle', () => {
    expect(AB_ITEMS).toHaveLength(12);
    const divergences: string[] = [];
    for (const item of AB_ITEMS) {
      for (const mode of MODES) {
        const results = matrix(item, mode);
        const distinct = new Set(ARMS.map((arm) => comparable(results[arm])));
        if (distinct.size !== 1) {
          divergences.push(`${item.id}/${mode}: ${[...distinct].join(' | ')}`);
          continue;
        }
        const expected = AB_EXPECTATIONS[item.id]![mode];
        expect(results.A.addresses, `${item.id}/${mode} addresses`).toEqual(expected.addresses);
        expect(results.A.refusal, `${item.id}/${mode} refusal`).toBe(expected.refusal);
      }
    }
    expect(divergences).toEqual([]);
  }, 60_000);

  test('[covers:F-2bbecd83/AC-3ab6f8be] the fault control of every ledger item is detected in every arm', () => {
    for (const item of AB_ITEMS) {
      const nominal = matrix(item, 'nominal');
      const fault = matrix(item, 'fault');
      for (const arm of ARMS) {
        expect(comparable(fault[arm]), `${item.id} ${arm} separates its fault control`).not.toBe(comparable(nominal[arm]));
      }
    }
  }, 60_000);

  test('[covers:F-2bbecd83/AC-3ab6f8be] every arm C packet is a pure function of its own inputs', () => {
    const {root, observation} = fixture();
    for (const item of AB_ITEMS) {
      const request = {
        arm: 'C' as const,
        root,
        profile: item.profile,
        feature: item.feature('nominal'),
        writePaths: item.writePaths('nominal'),
        provenance: item.profile === 'verify' ? 'observed' as const : 'predicted' as const,
        personaRemoved: false,
      };
      const first = buildArmPackets(request, observation);
      const second = buildArmPackets(request, observation);
      expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
      for (const profile of Object.keys(first)) {
        expect(JSON.stringify(second[profile]!.envelope), `${item.id} ${profile} rebuilds byte-identically`)
          .toBe(JSON.stringify(first[profile]!.envelope));
      }
    }
  }, 60_000);

  test('[covers:F-2bbecd83/AC-3600523a] removing every persona prompt changes no address, verdict, stale closure, or impact', () => {
    for (const item of AB_ITEMS) {
      for (const mode of MODES) {
        const withPrompts = matrix(item, mode, false);
        const without = matrix(item, mode, true);
        for (const arm of ARMS) {
          expect(comparable(without[arm]), `${item.id}/${mode} ${arm} is persona-independent`).toBe(comparable(withPrompts[arm]));
        }
        // The removal is real: arm A's measured input actually loses the prompt bytes.
        expect(without.A.bytes).toBeLessThan(withPrompts.A.bytes);
      }
    }
    for (const profile of Object.keys(TASK_PROFILES) as TaskProfile[]) {
      expect(personaBytes(profile, true)).toBe(0);
      expect(personaBytes(profile, false)).toBeGreaterThan(0);
    }
  }, 60_000);

  test('[covers:F-2bbecd83/AC-ed542c22] the blind packet leaks no implementation body line, on the fixture or the self corpus', () => {
    const {root} = fixture();
    const fixtureWorkspace = loadGraphIrV2Workspace(root);
    const fixtureBlind = JSON.stringify(buildCycleContextEnvelope(
      fixtureWorkspace,
      {task: 'blind-oracle', feature: TARGET, criterion: CONSTRAINT_CRITERION},
      {cwd: root},
    ));
    expect(fixtureBlind).not.toContain(BODY_MARKER);
    expect(fixtureBlind).not.toContain(PRIOR_RESULT_MARKER);

    const workspace = selfWorkspace();
    const features = workspace.compilation.contract?.features ?? [];
    const sources = new Map<string, readonly string[]>();
    const candidatesOf = (path: string): readonly string[] => {
      if (!sources.has(path)) {
        let lines: readonly string[] = [];
        try {
          lines = statSync(join(CWD, path)).isFile() ? leakCandidateLines(readFileSync(join(CWD, path), 'utf8')) : [];
        } catch {
          lines = [];
        }
        sources.set(path, lines);
      }
      return sources.get(path)!;
    };
    const leaks: string[] = [];
    let built = 0;
    let candidateLines = 0;
    for (const feature of features) {
      // Every feature must project. A declared DIRECTORY module has no declaration lines,
      // and the payload records that as an empty contribution rather than a thrown read,
      // so no feature is quietly excused from this sweep.
      const packet = JSON.stringify(buildCycleContextEnvelope(workspace, {task: 'blind-oracle', feature: feature.id}, {cwd: CWD}));
      built += 1;
      for (const path of feature.modules ?? []) {
        if (!path.startsWith('src/')) continue;
        for (const line of candidatesOf(path)) {
          candidateLines += 1;
          if (packet.includes(line)) leaks.push(`${feature.id} ${path}: ${line.slice(0, 60)}`);
        }
      }
    }
    const directoryModules = features
      .flatMap((feature) => (feature.modules ?? []).filter((path) => {
        if (path.endsWith('/')) return true;
        try {
          return statSync(join(CWD, path)).isDirectory();
        } catch {
          return false;
        }
      }))
      .sort();
    console.info(`topology · blind leakage · features ${features.length} · projected ${built} · body lines checked ${candidateLines} · leaks ${leaks.length} · directory modules ${directoryModules.length} (${[...new Set(directoryModules)].join(', ') || 'none'})`);
    expect(candidateLines, 'the leak scan actually had body lines to check').toBeGreaterThan(10_000);
    expect(built, 'every feature projects a blind packet').toBe(features.length);
    expect(leaks).toEqual([]);
    // The directory-module case is present in this corpus, so the sweep really covers it.
    expect(directoryModules.length).toBeGreaterThan(0);
  }, 120_000);

  test('[covers:F-2bbecd83/AC-a35b579b] no assurance, proof, or compiler kernel imports the persona loader or names a persona id', () => {
    const codeHits: string[] = [];
    const commentHits: string[] = [];
    const loaderHits: string[] = [];
    for (const directory of KERNEL_DIRECTORIES) {
      for (const path of filesUnder(join(CWD, directory), '.ts')) {
        const source = readFileSync(join(CWD, path), 'utf8');
        if (/agents\/loader/.test(source)) loaderHits.push(path);
        const code = codeOnly(source);
        for (const id of PERSONA_IDS) {
          const pattern = new RegExp(`\\b${id}\\b`);
          if (pattern.test(code)) codeHits.push(`${path}: ${id}`);
          else if (pattern.test(source)) commentHits.push(`${path}: ${id}`);
        }
      }
    }
    console.info(`topology · kernel persona scan · code hits ${codeHits.length} · comment-only mentions ${commentHits.length} (${commentHits.join('; ') || 'none'})`);
    expect(loaderHits).toEqual([]);
    expect(codeHits).toEqual([]);
  });

  test('[covers:F-2bbecd83/AC-9d189f9f] each of the eight fact ablations breaks exactly the executor that reads it', () => {
    const {root, observation} = fixture();
    const ablations: readonly {
      readonly fact: string;
      readonly item: string;
      readonly mode: RunMode;
      readonly apply: (envelope: CycleContextEnvelope) => CycleContextEnvelope;
    }[] = [
      {fact: 'purpose', item: 'AB01', mode: 'nominal', apply: blankSection('purpose')},
      {fact: 'criterion identity', item: 'AB02', mode: 'nominal', apply: blankSection('criteria')},
      {fact: 'constraint rationale', item: 'AB03', mode: 'nominal', apply: stripCriterionRationale('criteria')},
      {fact: 'selector', item: 'AB09', mode: 'nominal', apply: blankSection('declared-bindings')},
      {fact: 'provenance', item: 'AB03', mode: 'nominal', apply: blankSection('predicted-write-scope')},
      {fact: 'direction', item: 'AB04', mode: 'nominal', apply: blankSection('prerequisites')},
      {fact: 'impact', item: 'AB03', mode: 'fault', apply: blankSection('candidate-affected-paths')},
      {fact: 'freshness', item: 'AB10', mode: 'nominal', apply: blankSection('freshness')},
    ];
    expect(ablations).toHaveLength(8);
    const observedTable: string[] = [];
    for (const ablation of ablations) {
      const item = AB_ITEMS.find((candidate) => candidate.id === ablation.item)!;
      const intact = runArm(root, item, 'B', ablation.mode, {observation});
      const removed = runArm(root, item, 'B', ablation.mode, {observation, ablate: ablation.apply});
      observedTable.push(`${ablation.fact} → ${ablation.item}/${ablation.mode}: ${removed.refusal ?? 'answered'} (intact: ${intact.refusal ?? 'answered'})`);
      expect(comparable(removed), `removing ${ablation.fact} must change ${ablation.item}`).not.toBe(comparable(intact));
    }
    console.info(`topology · ablations\n  ${observedTable.join('\n  ')}`);
  }, 60_000);

  test('[covers:F-2bbecd83/AC-013fc518] the self corpus records arm A, arm B, and arm E bytes for every feature', () => {
    const rows = census();
    const workspace = selfWorkspace();
    expect(rows).toHaveLength((workspace.compilation.contract?.features ?? []).length);
    for (const row of rows) {
      expect(row.aJsonOnly, `${row.feature} arm A json-only`).toBeGreaterThan(0);
      expect(row.aDeveloper, `${row.feature} arm A persona-inclusive`).toBeGreaterThan(row.aJsonOnly);
      expect(row.bImplement, `${row.feature} arm B implement`).toBeGreaterThan(0);
      expect(row.bVerify, `${row.feature} arm B verify`).toBeGreaterThan(0);
      expect(row.bBlind, `${row.feature} arm B blind-oracle`).toBeGreaterThan(0);
      // Asking for the lazy section is never cheaper than not asking.
      expect(row.bFanOutFollowUp, `${row.feature} fan-out follow-up`).toBeGreaterThanOrEqual(row.bImplement);
      expect(row.eUpper, `${row.feature} arm E ceiling`).toBeGreaterThanOrEqual(row.eLower);
    }
    const column = (pick: (row: CensusRow) => number): string => {
      const values = rows.map(pick);
      return `p50 ${quantile(values, 0.5)} · p95 ${quantile(values, 0.95)} · max ${Math.max(...values)}`;
    };
    console.info([
      `topology · self-corpus physical input · ${rows.length} features`,
      `  A developer dispatch (persona + shard) ${column((row) => row.aDeveloper)}`,
      `  A reviewer dispatch  (persona + shard) ${column((row) => row.aReviewer)}`,
      `  A shard JSON only                      ${column((row) => row.aJsonOnly)}`,
      `  A two-dispatch cycle                   ${column((row) => row.aCycle)}`,
      `  B implement                            ${column((row) => row.bImplement)}`,
      `  B verify                               ${column((row) => row.bVerify)}`,
      `  B spec-edit                            ${column((row) => row.bSpecEdit)}`,
      `  B observe                              ${column((row) => row.bObserve)}`,
      `  B blind-oracle                         ${column((row) => row.bBlind)}`,
      `  B implement+verify cycle (default)     ${column((row) => row.bCycle)}`,
      `  B fan-out follow-up packet             ${column((row) => row.bFanOutFollowUp)}`,
      `  B ownership fan-out block itself       ${column((row) => row.fanOut)}`,
      `  B cycle including the fan-out follow-up ${column((row) => row.bCycleWithFollowUp)}`,
      `  E reconstruction floor (matched lines) ${column((row) => row.eLower)}`,
      `  E reconstruction ceiling (whole files) ${column((row) => row.eUpper)}`,
      `  features where the default B cycle exceeds A cycle    ${rows.filter((row) => row.bCycle > row.aCycle).length}`,
      `  features where the follow-up B cycle exceeds A cycle  ${rows.filter((row) => row.bCycleWithFollowUp > row.aCycle).length}`,
    ].join('\n'));
  }, 120_000);

  test('[covers:F-2bbecd83/AC-397aac78] the no-retry implement and verify cycle does not regress against the shipped two-dispatch path', () => {
    const rows = census();
    const aCycle = rows.map((row) => row.aCycle);
    const bCycle = rows.map((row) => row.bCycle);
    // The same cycle when the operation also asks for the lazy fan-out. Recorded, never
    // asserted: a host that issues a second query pays for a second packet, and that
    // cost belongs to the request, not to the no-retry path this criterion is about.
    const bFollowUp = rows.map((row) => row.bCycleWithFollowUp);
    console.info([
      'topology · no-retry cycle comparison (arm B implement+verify vs arm A developer+reviewer)',
      `  A p50 ${quantile(aCycle, 0.5)} · p95 ${quantile(aCycle, 0.95)} · max ${Math.max(...aCycle)}`,
      `  B default p50 ${quantile(bCycle, 0.5)} · p95 ${quantile(bCycle, 0.95)} · max ${Math.max(...bCycle)}`,
      `  B with fan-out follow-up p50 ${quantile(bFollowUp, 0.5)} · p95 ${quantile(bFollowUp, 0.95)} · max ${Math.max(...bFollowUp)}`,
      `  features where the follow-up cycle exceeds A ${rows.filter((row) => row.bCycleWithFollowUp > row.aCycle).length}`,
      `  A shard-JSON-only cycle p50 ${quantile(rows.map((row) => 2 * row.aJsonOnly), 0.5)} · p95 ${quantile(rows.map((row) => 2 * row.aJsonOnly), 0.95)}`,
    ].join('\n'));
    expect(quantile(bCycle, 0.5)).toBeLessThanOrEqual(quantile(aCycle, 0.5));
    expect(quantile(bCycle, 0.95)).toBeLessThanOrEqual(quantile(aCycle, 0.95));
  }, 120_000);

  test('[covers:F-2bbecd83/AC-0ddb51d3] a five-thousand-feature hub reaches its implement byte fixed point inside the round cap and 500 ms', () => {
    const compilation = syntheticCompilation(5_000);
    const workspace = syntheticWorkspace(compilation);
    const hub = syntheticHub(compilation);
    expect((compilation.contract?.features ?? []).length).toBe(5_000);
    expect(hub.coOwners).toBeGreaterThan(100);

    const started = performance.now();
    const envelope = buildCycleContextEnvelope(workspace, {
      task: 'implement',
      feature: hub.feature,
      write_scope: {paths: [...(compilation.contract?.features.find((feature) => feature.id === hub.feature)?.modules ?? [])], provenance: 'predicted'},
    }, {cwd: CWD});
    const elapsed = performance.now() - started;

    console.info(`topology · 5,000-feature hub ${hub.feature} (${hub.coOwners} co-owners) · ${envelope.budget.payload_utf8_bytes} B in ${elapsed.toFixed(1)} ms · omitted ${JSON.stringify(envelope.budget.omitted)}`);
    // The payload IS its own serialized length: that equality is the fixed point.
    expect(Buffer.byteLength(JSON.stringify(envelope), 'utf8')).toBe(envelope.budget.payload_utf8_bytes);
    expect(envelope.budget.payload_utf8_bytes).toBeLessThanOrEqual(TASK_PROFILES.implement.ceiling_bytes);
    expect(envelope.budget.required_overflow).toBe(false);
    // A synthetic feature has no shard on disk, so its revision is honestly unknown.
    expect(Object.values(envelope.input_revisions)).toEqual(['unknown']);
    expect(elapsed).toBeLessThan(500);
  }, 60_000);

  // The title below is a plain literal, never a template: the vitest/jest harvester binds
  // only string-literal carriers, so a computed title runs and passes without ever binding
  // its criterion. The last assertion keeps that literal from drifting from `J11_TITLE`.
  test('[covers:F-2bbecd83/AC-27ee0ea7] J11 topology-invariant context is validation-active with a resolvable test reference', () => {
    const manifest = yaml.parse(readFileSync(join(CWD, 'tests/design/spec-0.2/requirements.yaml'), 'utf8')) as {
      integration_journeys: readonly {id: string; status: string; test_ref?: string}[];
    };
    const j11 = manifest.integration_journeys.find((journey) => journey.id === 'J11');
    expect(j11?.status).toBe('validation-active');
    const reference = j11?.test_ref ?? '';
    const [file, title] = reference.split('#');
    expect(file, 'J11 names a test file').toBe('tests/optimizer/topology-suite.test.ts');
    expect(existsSync(join(CWD, file!))).toBe(true);
    const source = readFileSync(join(CWD, file!), 'utf8');
    expect(source).toContain(title!);
    expect(title).toBe(J11_TITLE);
    expect(source, 'the literal carrier title matches the resolved reference').toContain(
      `[covers:F-2bbecd83/AC-27ee0ea7] ${J11_TITLE}`,
    );
  });

  test('[covers:F-2bbecd83/AC-51a9a41e] the suite adds no production module and no default-path runtime cost', () => {
    const shard = yaml.parse(readFileSync(join(CWD, 'spec/features/spec-02-topology-suite-2bbecd83.yaml'), 'utf8')) as {
      modules: readonly string[];
    };
    expect(shard.modules.filter((path) => path.startsWith('src/'))).toEqual([]);
    const importers = filesUnder(join(CWD, 'src'), '.ts')
      .filter((path) => /tests\/optimizer\/topology|from '.*tests\//.test(readFileSync(join(CWD, path), 'utf8')));
    expect(importers, 'no production module reaches into the suite').toEqual([]);
    // The suite adds no default-path cost either: the one section its census showed to be
    // expensive and rarely read is declared lazy, so the shipped implement packet is
    // smaller than it was before this suite measured it, not larger.
    expect(TASK_PROFILES.implement.lazy).toContain('ownership-fan-out');
    expect(TASK_PROFILES.implement.optional).not.toContain('ownership-fan-out');
    // The working tree is recorded, not asserted: production edits this suite PROMPTED —
    // the lazy fan-out above and the directory-module read the leakage sweep exposed — are
    // exactly what a measurement suite is for, and a dirty-tree assertion would forbid them.
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src'], {cwd: CWD, encoding: 'utf8'}).trim();
    console.info(`topology · production tree state · ${dirty === '' ? 'src/ unchanged' : dirty.replaceAll('\n', ' | ')}`);
  });

  test('[covers:F-2bbecd83/AC-013fc518] the shipped dispatch and the fixture packet stay comparable inputs', () => {
    const {root} = fixture();
    const dispatch = shippedDispatchPacket(root, TARGET);
    expect(JSON.parse(dispatch)).toMatchObject({featureId: TARGET, guardrails: [], cwd: root});
    expect(() => shippedDispatchPacket(root, 'F-not-a-feature')).toThrow(/needs a feature/);
    expect(JSON.parse(shippedDispatchPacket(root, SIBLING)).featureId).toBe(SIBLING);
  });
});

/** Keeps the corpus index type referenced, so the helper contract stays checked here too. */
export type TopologyCorpusIndex = CorpusIndex;
