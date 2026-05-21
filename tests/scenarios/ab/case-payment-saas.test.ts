// Cladding · scenarios · ab · case payment-saas (v0.3.47, F-4db939)
//
// A/B evaluation case 1 — greenfield "결제 SaaS for B2B" intent.
//
// Group A (Cladding): runInit + hand-authored feature shard at M2.
// Group B (Vanilla):  applies the smart-vanilla session file set
//                     directly (no spec, no scenarios, no
//                     capabilities — like vanilla Claude Code would
//                     produce).
//
// At M1 (initial setup) and M2 (first feature complete), each group's
// tmpdir is snapshotted; the metrics are rendered into
// `docs/ab-evaluation/case-payment-saas.md`. Existing markdown is
// compared to the generated content — drift fails the test.

import {afterEach, beforeEach, describe, test, vi} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {mkdirSync} from 'node:fs';

vi.mock('../../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
const dispatchMock = vi.fn<(p: string) => Promise<string>>();
vi.mock('../../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts?: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {runInit} = await import('../../../src/cli/init.js');
const {mkScenarioCwd, writeUnderCwd, GREENFIELD_S1_RESPONSE} = await import('../_helpers.js');
const {captureSnapshot} = await import('./_ab-metrics.js');
const {VANILLA_PAYMENT_SAAS_SESSION, applyFileSet} = await import('./_vanilla-sim.js');
const {renderCaseReport, writeOrAssertReport} = await import('./_report.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = HERE.replace(/\/tests\/scenarios\/ab$/, '');
const REPORT_PATH = join(REPO_ROOT, 'docs/ab-evaluation/case-payment-saas.md');

describe('A/B · payment-saas — cladding vs vanilla on greenfield intent', () => {
  let aCwd: ReturnType<typeof mkScenarioCwd>;
  let bCwd: ReturnType<typeof mkScenarioCwd>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    aCwd = mkScenarioCwd('clad-ab-paymentsaas-a-');
    bCwd = mkScenarioCwd('clad-ab-paymentsaas-b-');
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
    // ── M1 ──────────────────────────────────────────────────────
    // A: cladding init with intent — produces 4-tier seed.
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
    await runInit({cwd: aCwd.path, intent: VANILLA_PAYMENT_SAAS_SESSION.intent});

    // B: vanilla developer writes the initial skeleton.
    applyFileSet(bCwd.path, VANILLA_PAYMENT_SAAS_SESSION.m1Files);

    const m1A = captureSnapshot('A', 'M1', aCwd.path);
    const m1B = captureSnapshot('B', 'M1', bCwd.path);

    // ── M2 ──────────────────────────────────────────────────────
    // A: hand-author a refund feature shard + matching code/tests.
    // The shard binds to an existing layer (api) declared by the
    // greenfield architecture seed.
    mkdirSync(join(aCwd.path, 'spec/features'), {recursive: true});
    writeUnderCwd(
      aCwd.path,
      'spec/features/refund-flow-4db939.yaml',
      [
        '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
        'id: F-4db939',
        'slug: refund-flow',
        'title: "환불 처리"',
        'status: planned',
        'modules: ["src/api/refund.ts"]',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    ears: ubiquitous',
        '    text: "When a refund request lands, the system shall verify the original payment and call the PG refund API."',
        '  - id: AC-002',
        '    ears: unwanted',
        '    text: "If the original transaction id is empty, the system shall reject the refund with a 400."',
        '',
      ].join('\n'),
    );
    // A's executable refund code — minimal but real, matching the
    // architecture layer declared in GREENFIELD_S1_RESPONSE.
    writeUnderCwd(
      aCwd.path,
      'src/api/refund.ts',
      [
        '// payment-saas · api · refund (cladding-managed, F-4db939)',
        'export interface RefundResult {',
        '  readonly refundId: string;',
        '  readonly status: "success" | "failed";',
        '}',
        '',
        'export async function refund(transactionId: string): Promise<RefundResult> {',
        '  if (!transactionId) throw new Error("transactionId required");',
        '  return {refundId: `rf_${transactionId}`, status: "success"};',
        '}',
        '',
      ].join('\n'),
    );
    writeUnderCwd(
      aCwd.path,
      'tests/refund.test.ts',
      [
        'import {test, expect} from "vitest";',
        'import {refund} from "../src/api/refund.js";',
        '',
        'test("refund returns success for a valid transaction id", async () => {',
        '  const r = await refund("tx_001");',
        '  expect(r.status).toBe("success");',
        '});',
        '',
      ].join('\n'),
    );

    // B: vanilla developer adds refund handlers without any spec.
    applyFileSet(bCwd.path, VANILLA_PAYMENT_SAAS_SESSION.m2Files);

    const m2A = captureSnapshot('A', 'M2', aCwd.path);
    const m2B = captureSnapshot('B', 'M2', bCwd.path);

    // ── Render report ───────────────────────────────────────────
    const report = renderCaseReport({
      caseTitle: 'payment-saas',
      intent: VANILLA_PAYMENT_SAAS_SESSION.intent,
      description: [
        'Greenfield case: an empty tmpdir + a one-line intent.',
        '',
        'Group A starts with `clad init --intent "..."` which produces the 4-tier',
        'governance scaffold (spec.yaml, project-context.md, capabilities.yaml,',
        'architecture.yaml, conventions.md, scenarios/) before any code is written.',
        '',
        'Group B simulates a senior developer using vanilla Claude Code on the same',
        'intent — package.json + tsconfig + README + src/(api/lib/util) + tests/,',
        'no spec, no scenarios, no architecture invariants.',
      ].join('\n'),
      hypothesisFocus: [
        'H1 — Cladding produces more structured artifacts (tier-banner-bearing files).',
        'H2 — Cladding emits spec ↔ code traceability (features, ACs, scenarios, capabilities) that vanilla lacks.',
        'H3 — Cladding declares architecture layers + forbidden-import rules; vanilla relies on convention.',
        'H4 — Running the 23 toolchain-agnostic detectors on the vanilla tree surfaces gaps cladding would have closed.',
        'H5 — Vanilla pays fewer artifact-tokens but loses the structural signal.',
      ],
      m1A,
      m1B,
      m2A,
      m2B,
    });
    writeOrAssertReport(REPORT_PATH, report);
  }, 30_000);
});
