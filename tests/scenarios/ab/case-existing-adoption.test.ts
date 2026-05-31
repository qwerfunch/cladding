// Cladding · scenarios · ab · case existing-adoption (v0.3.47, F-4db939)
//
// A/B evaluation case 2 — existing TypeScript project ("이 프로젝트
// 분석해서 환불 기능 추가").
//
// Group A (Cladding): copyFixture → runInit with adoption intent →
//                     hand-author refund feature shard at M2.
// Group B (Vanilla):  copyFixture → vanilla developer updates README
//                     (M1) and adds refund handler (M2). No cladding
//                     governance ever applied.
//
// Sample fixture is `tests/scenarios/_fixtures/sample-existing-ts/` —
// 8-source-file TypeScript service shared with the lifecycle suite.

import {afterEach, beforeEach, describe, test, vi} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import yaml from 'yaml';

vi.mock('../../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
const dispatchMock = vi.fn<(p: string) => Promise<string>>();
vi.mock('../../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts?: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {runInit} = await import('../../../src/cli/init.js');
const {mkScenarioCwd, copyFixture, writeUnderCwd, EXISTING_S2_RESPONSE} = await import('../_helpers.js');
const {captureSnapshot} = await import('./_ab-metrics.js');
const {VANILLA_EXISTING_ADOPTION_SESSION, applyFileSet} = await import('./_vanilla-sim.js');
const {renderCaseReport, writeOrAssertReport} = await import('./_report.js');
const {
  captureDriftCatch,
  claddingifyForDriftCatch,
  makeStaleReferenceDrift,
  makeArchitectureViolationDrift,
  makeHardcodedSecretDrift,
  makeUntestedAcDrift,
} = await import('./_drift-injection.js');
const {answerAllQueries} = await import('./_query-bench.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = HERE.replace(/\/tests\/scenarios\/ab$/, '');
const REPORT_PATH = join(REPO_ROOT, 'docs/ab-evaluation/case-existing-adoption.md');

describe('A/B · existing-adoption — cladding vs vanilla on a populated TS project', () => {
  let aCwd: ReturnType<typeof mkScenarioCwd>;
  let bCwd: ReturnType<typeof mkScenarioCwd>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    aCwd = mkScenarioCwd('clad-ab-existing-a-');
    bCwd = mkScenarioCwd('clad-ab-existing-b-');
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dispatchMock.mockReset();
  });

  afterEach(() => {
    aCwd.cleanup();
    bCwd.cleanup();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('M1+M2: both groups deliver — committed report stays deterministic', async () => {
    // Heavier than greenfield: copies the 8-source-file fixture into TWO
    // tmpdirs, runs A's init (LLM mock + observed-path onboarding), runs
    // B's vanilla session, then takes 4 snapshots that each loop the 25
    // detectors over the tree. ~6s in the full suite; bump beyond default.
    // Both groups start from the same fixture.
    copyFixture('sample-existing-ts', aCwd.path);
    copyFixture('sample-existing-ts', bCwd.path);

    // ── M1 ──────────────────────────────────────────────────────
    // A: cladding init with adoption intent — observed-path onboarding.
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
    await runInit({cwd: aCwd.path, intent: VANILLA_EXISTING_ADOPTION_SESSION.intent});

    // B: vanilla developer's first move on an unfamiliar codebase —
    // improve the README. (Files in m1Files overwrite the fixture
    // README with a more thorough version.)
    applyFileSet(bCwd.path, VANILLA_EXISTING_ADOPTION_SESSION.m1Files);

    const m1A = captureSnapshot('A', 'M1', aCwd.path);
    const m1B = captureSnapshot('B', 'M1', bCwd.path);

    // ── M2 ──────────────────────────────────────────────────────
    // A: author a refund feature shard + matching api/lib code.
    mkdirSync(join(aCwd.path, 'spec/features'), {recursive: true});
    writeUnderCwd(
      aCwd.path,
      'spec/features/refund-flow-4db939.yaml',
      [
        '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
        'id: F-4db939',
        'slug: refund-flow',
        'title: "환불 처리"',
        'status: done',
        'modules: ["src/api/refund.ts", "src/lib/refund.ts"]',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    ears: ubiquitous',
        '    text: "When a refund request lands, the system shall verify the original transaction and call the PG refund API."',
        '    test_refs: [tests/refund.test.ts]',
        '  - id: AC-002',
        '    ears: unwanted',
        '    text: "If the original transaction id is empty, the system shall reject the refund."',
        '    test_refs: [tests/refund.test.ts]',
        '',
      ].join('\n'),
    );
    writeUnderCwd(
      aCwd.path,
      'src/api/refund.ts',
      [
        '// sample-existing-ts · api · refund (cladding-managed, F-4db939)',
        'import {processRefund} from "../lib/refund.js";',
        '',
        'export async function refundHandler(transactionId: string): Promise<{status: "ok" | "fail"}> {',
        '  if (!transactionId) return {status: "fail"};',
        '  const r = await processRefund(transactionId);',
        '  return {status: r.ok ? "ok" : "fail"};',
        '}',
        '',
      ].join('\n'),
    );
    writeUnderCwd(
      aCwd.path,
      'src/lib/refund.ts',
      [
        '// sample-existing-ts · lib · refund (cladding-managed, F-4db939)',
        'export async function processRefund(transactionId: string): Promise<{ok: boolean}> {',
        '  if (!transactionId) return {ok: false};',
        '  return {ok: true};',
        '}',
        '',
      ].join('\n'),
    );
    writeUnderCwd(
      aCwd.path,
      'tests/refund.test.ts',
      [
        'import {test, expect} from "vitest";',
        'import {refundHandler} from "../src/api/refund.js";',
        '',
        'test("refundHandler approves a valid transaction id", async () => {',
        '  const r = await refundHandler("tx_001");',
        '  expect(r.status).toBe("ok");',
        '});',
        '',
        'test("refundHandler rejects an empty transaction id", async () => {',
        '  const r = await refundHandler("");',
        '  expect(r.status).toBe("fail");',
        '});',
        '',
      ].join('\n'),
    );
    // Bind F-4db939 to the 'api' capability via YAML round-trip
    // (robust to whichever LLM-vs-deterministic path emitted the file).
    const capsPath = join(aCwd.path, 'spec/capabilities.yaml');
    const capsBody = readFileSync(capsPath, 'utf8');
    const banner = capsBody.split('\n').filter((l) => l.startsWith('#')).join('\n');
    const parsedCaps = yaml.parse(capsBody) as {capabilities?: {id?: string; features?: string[]}[]} | null;
    if (parsedCaps?.capabilities) {
      const apiCap = parsedCaps.capabilities.find((c) => c?.id === 'api');
      if (apiCap) apiCap.features = ['F-4db939'];
    }
    writeFileSync(capsPath, `${banner}\n${yaml.stringify(parsedCaps)}`);

    // B: vanilla developer adds refund handler + lib + test.
    applyFileSet(bCwd.path, VANILLA_EXISTING_ADOPTION_SESSION.m2Files);

    const m2A = captureSnapshot('A', 'M2', aCwd.path);
    const m2B = captureSnapshot('B', 'M2', bCwd.path);

    // ── Outcome quality (F-ba2e05) ─────────────────────────────
    // Mature-cladding-user step: clear spec.yaml's inline F-001 +
    // canonicalize architecture.yaml. For existing-adoption the
    // observed layers are api / lib / util; rules: util ↛ {api, lib},
    // lib ↛ api (the standard layered-app constraint).
    claddingifyForDriftCatch(aCwd.path, {
      layers: [['api'], ['lib'], ['util']],
      forbiddenImports: [
        {from: 'util', to: 'api'},
        {from: 'util', to: 'lib'},
        {from: 'lib', to: 'api'},
      ],
    });

    // For existing-adoption, both trees have src/api/refund.ts at M2
    // (A authored it, B's vanilla session wrote it). The architecture
    // layer rule from EXISTING_S2_RESPONSE has util ↛ api,lib + lib ↛ api,
    // so the violation goes the other direction: util/log.ts imports lib/refund.
    const driftResults = [
      // DI-1 — stale module reference.
      captureDriftCatch(
        aCwd.path,
        'A',
        makeStaleReferenceDrift('src/api/refund.ts', 'src/api/refund_renamed.ts'),
      ),
      captureDriftCatch(
        bCwd.path,
        'B',
        makeStaleReferenceDrift('src/api/refund.ts', 'src/api/refund_renamed.ts'),
      ),
      // DI-2 — architecture violation: util ↛ lib (forbidden_imports includes "api","lib")
      captureDriftCatch(
        aCwd.path,
        'A',
        makeArchitectureViolationDrift('src/util/log.ts', '../lib/refund.js'),
      ),
      captureDriftCatch(
        bCwd.path,
        'B',
        makeArchitectureViolationDrift('src/util/log.ts', '../lib/refund.js'),
      ),
      // DI-3 — hardcoded secret (baseline both should catch).
      captureDriftCatch(aCwd.path, 'A', makeHardcodedSecretDrift('src/lib/refund.ts')),
      captureDriftCatch(bCwd.path, 'B', makeHardcodedSecretDrift('src/lib/refund.ts')),
      // DI-4 — untested AC, A only.
      captureDriftCatch(
        aCwd.path,
        'A',
        makeUntestedAcDrift('spec/features/refund-flow-4db939.yaml', 'AC-003', 'Refunds shall support partial refund amounts.'),
      ),
    ];

    // AI-Query benchmark.
    const queryResults = new Map<'A' | 'B', readonly ReturnType<typeof answerAllQueries>[number][]>([
      ['A', answerAllQueries(aCwd.path)],
      ['B', answerAllQueries(bCwd.path)],
    ]);

    const report = renderCaseReport({
      caseTitle: 'existing-adoption',
      intent: VANILLA_EXISTING_ADOPTION_SESSION.intent,
      description: [
        'Existing-adoption case: a populated 8-source-file TypeScript service',
        '(`sample-existing-ts`) + an intent to add a refund feature.',
        '',
        'Group A starts with `clad init --intent "..."` which observes the existing',
        'code (api / lib / util layout), produces the 4-tier governance scaffold',
        'around it, and then adds a hand-authored feature shard for the refund.',
        '',
        'Group B simulates a senior developer using vanilla Claude Code on the same',
        'codebase — improves the README, adds the refund handler + test directly.',
        'No spec, no architecture invariants — just code on the existing tree.',
      ].join('\n'),
      hypothesisFocus: [
        'H1 — Cladding produces tier-banner-bearing artifacts that vanilla skips on an existing tree.',
        'H2 — Cladding binds new features to capabilities; vanilla leaves no semantic trail.',
        'H3 — Architecture layers extracted from observed code become enforceable in cladding; vanilla leaves them implicit.',
        'H4 — Re-running detectors on the vanilla tree shows the structural gaps cladding would have caught from M1.',
        'H5 — Adoption overhead: cladding pays an upfront governance-token cost; vanilla pays it forever in lost traceability.',
      ],
      m1A,
      m1B,
      m2A,
      m2B,
      outcome: {driftResults, queryResults},
    });
    writeOrAssertReport(REPORT_PATH, report);
    // 60s: the heaviest scenario test — copies the fixture into TWO tmpdirs,
    // runs two inits, and takes 4 detector snapshots. 30s held locally but
    // still timed out on the 2-core CI runner under worker contention.
  }, 60_000);
});
