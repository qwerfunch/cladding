// Cladding · scenarios · greenfield-lifecycle (v0.3.46, F-4747ef)
//
// 6-stage end-to-end lifecycle test for the greenfield case (empty
// directory + user intent). At each stage the test verifies:
//   - the expected Tier A/B/C/D artifacts exist
//   - every artifact's first line carries the standard Tier banner
//   - cross-tier detectors (CAPABILITIES_FEATURE_MAPPING +
//     ARCHITECTURE_FROM_SPEC + REFERENCE_INTEGRITY) emit zero errors
//   - LLM prompts + generated artifacts stay within size budgets
//
// Mock-dispatcher pattern follows tests/cli/refine.test.ts: a vi.fn
// is registered at module load via vi.mock; each stage queues its own
// response with mockResolvedValueOnce.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));
const dispatchMock = vi.fn<(p: string) => Promise<string>>();
vi.mock('../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts?: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {runInit} = await import('../../src/cli/init.js');
const {runClarifyCommand} = await import('../../src/cli/clarify.js');
const {
  mkScenarioCwd,
  writeUnderCwd,
  GREENFIELD_S1_RESPONSE,
  GREENFIELD_S2_RESPONSE,
  GREENFIELD_S5_RESPONSE,
} = await import('./_helpers.js');
const {
  assertArtifactsPresent,
  assertCrossTierClean,
  assertProposalDivert,
  assertSpecCompleteness,
  assertTierBanner,
  assertNoBudgetOverages,
} = await import('./_assertions.js');

const REPO_ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\/tests\/scenarios$/, '');

describe('greenfield lifecycle — 결제 SaaS for B2B intent', () => {
  let scenario: ReturnType<typeof mkScenarioCwd>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scenario = mkScenarioCwd('clad-greenfield-lifecycle-');
    // Silence process.exit so runInit / runClarifyCommand can be called
    // in sequence without aborting the test process.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dispatchMock.mockReset();
  });

  afterEach(() => {
    scenario.cleanup();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('S1 init with intent → all 4 tiers produced with tier banners', async () => {
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
    const result = await runInit({cwd: scenario.path, intent: '결제 SaaS for B2B'});

    // Tier coverage check.
    assertArtifactsPresent(scenario.path, {
      specYaml: true,
      architectureYaml: true,
      capabilitiesYaml: true,
      projectContextMd: true,
      conventionsMd: true,
      scenariosReadme: true,
      scenarioShards: 2, // purchase-flow + refund-flow from S1 response
      onboardingStateYaml: true,
    });

    // Tier banner on each first line.
    assertTierBanner(scenario.path, 'spec.yaml', 'A');
    assertTierBanner(scenario.path, 'spec/architecture.yaml', 'B');
    assertTierBanner(scenario.path, 'spec/capabilities.yaml', 'B');
    assertTierBanner(scenario.path, 'docs/project-context.md', 'B');
    assertTierBanner(scenario.path, 'docs/conventions.md', 'C');
    assertTierBanner(scenario.path, '.cladding/onboarding/state.yaml', 'D');

    // onboarding state.yaml has 3 pending questions.
    expect(result.clarifyingQuestions?.length).toBe(3);
    expect(result.onboardingMode).toBe('greenfield');

    // v0.4.0 — no F-001 placeholder shard. Intent surfaces via
    // `spec.yaml::project.intent_summary` and `docs/project-context.md`.
    expect(
      (await import('node:fs')).existsSync(
        join(scenario.path, 'spec/features/F-001-first.yaml'),
      ),
    ).toBe(false);
    const projectContext = (await import('node:fs')).readFileSync(
      join(scenario.path, 'docs/project-context.md'),
      'utf8',
    );
    expect(projectContext).toContain('결제');
  });

  test('S1 → S2 refine: state advances, proposal divert fires, capabilities grow', async () => {
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
    await runInit({cwd: scenario.path, intent: '결제 SaaS for B2B'});

    dispatchMock.mockResolvedValueOnce(GREENFIELD_S2_RESPONSE);
    await runClarifyCommand(['법인', '사업자만'], {cwd: scenario.path});

    // First pending question marked answered.
    const stateBody = (await import('node:fs')).readFileSync(
      join(scenario.path, '.cladding/onboarding/state.yaml'),
      'utf8',
    );
    expect(stateBody).toContain('법인 사업자만');

    // Existing artifacts diverted to proposal (refine touches all four).
    assertProposalDivert(scenario.path, 'docs/project-context.md');
    assertProposalDivert(scenario.path, 'spec/capabilities.yaml');
    assertProposalDivert(scenario.path, 'spec/architecture.yaml');

    // Capabilities count grew (4 in S2 response vs 3 in S1).
    const proposalCapsBody = (await import('node:fs')).readFileSync(
      join(scenario.path, '.cladding/scan/capabilities.yaml.proposal'),
      'utf8',
    );
    expect(proposalCapsBody).toContain('compliance');
  });

  test('S2 → S3 simulate code → S4 strict check passes', async () => {
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
    await runInit({cwd: scenario.path, intent: '결제 SaaS for B2B'});

    // S3: write 3+ TS files matching the architecture's suggested layers.
    writeUnderCwd(
      scenario.path,
      'src/api/main.ts',
      '// Cladding · sample · api\nexport const handler = () => ({});\n',
    );
    writeUnderCwd(
      scenario.path,
      'src/ledger/store.ts',
      '// Cladding · sample · ledger\nexport const append = (e: unknown) => e;\n',
    );
    writeUnderCwd(
      scenario.path,
      'src/webhook/handler.ts',
      '// Cladding · sample · webhook\nexport const verify = (sig: string) => Boolean(sig);\n',
    );

    // S4: cross-tier consistency. capabilities-feature-mapping warns
    // about orphan capabilities (no features are mapped yet — early-stage
    // workspace with `features: []`); warnings don't block this assertion.
    // META_INTEGRITY expects cladding's own spec/schema.json which the
    // tmpdir doesn't carry — that detector is a cladding-self check,
    // not a consumer-project gate, so we let it through here.
    assertCrossTierClean(scenario.path, ['META_INTEGRITY']);
  });

  test('S5 re-scan diverts conventions + architecture to proposal', async () => {
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
    await runInit({cwd: scenario.path, intent: '결제 SaaS for B2B'});

    // Write enough files so the re-scan hits the SCAN_AUTO_THRESHOLD.
    writeUnderCwd(scenario.path, 'src/api/main.ts', '// api\nexport const x = 1;\n');
    writeUnderCwd(scenario.path, 'src/api/route.ts', '// api\nexport const y = 2;\n');
    writeUnderCwd(scenario.path, 'src/ledger/store.ts', '// ledger\nexport const z = 3;\n');
    writeUnderCwd(scenario.path, 'src/webhook/handler.ts', '// webhook\nexport const w = 4;\n');

    // S5: re-run init with --scan-true and a fresh LLM response.
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S5_RESPONSE);
    await runInit({cwd: scenario.path, scan: true});

    // Observed bodies diverted; live files preserve onboarding seed.
    assertProposalDivert(scenario.path, 'docs/conventions.md');
    assertProposalDivert(scenario.path, 'spec/architecture.yaml');
  });

  test('S6 final digest: all sizes within budget, spec is complete', async () => {
    dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
    await runInit({cwd: scenario.path, intent: '결제 SaaS for B2B'});

    dispatchMock.mockResolvedValueOnce(GREENFIELD_S2_RESPONSE);
    await runClarifyCommand(['법인', '사업자만'], {cwd: scenario.path});

    // Spec has the expected minimum content.
    assertSpecCompleteness(scenario.path, {
      minCapabilities: 3, // S2 emits 4; we keep the live file at S1 (3) due to proposal divert
      minScenarioShards: 2,
    });

    // No size budget overages — meta doc, personas, generated artifacts
    // all measured against the ratchet. Digest is printed regardless
    // so the user can audit even on pass.
    assertNoBudgetOverages(REPO_ROOT, scenario.path, 'Greenfield S6 final');
  });
});
