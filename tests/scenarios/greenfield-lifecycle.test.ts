// Cladding · scenarios · continuous greenfield lifecycle (F-4747ef).

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));

const dispatchMock = vi.fn<(prompt: string) => Promise<string>>();
vi.mock('../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts?: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {runInit} = await import('../../src/cli/init.js');
const {runClarifyCommand} = await import('../../src/cli/clarify.js');
const {createFeature, linkCapability, linkScenario} = await import('../../src/spec/new.js');
const {loadSpec} = await import('../../src/spec/load.js');
const {
  GREENFIELD_S1_RESPONSE,
  GREENFIELD_S2_RESPONSE,
  GREENFIELD_S5_RESPONSE,
  mkScenarioCwd,
  writeUnderCwd,
} = await import('./_helpers.js');
const {
  assertArtifactsPresent,
  assertCrossTierClean,
  assertNoBudgetOverages,
  assertProposalDivert,
  assertScenarioFeatureReferences,
  assertSpecCompleteness,
  assertTierBanner,
} = await import('./_assertions.js');

const REPO_ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\/tests\/scenarios$/, '');

interface GreenfieldLifecycle {
  readonly transitions: readonly string[];
  readonly featureId: string;
}

function assertFeatureIsScenarioBound(cwd: string, featureId: string): void {
  const scenarios = loadSpec(cwd).scenarios ?? [];
  expect(scenarios.some((scenario) => scenario.features?.includes(featureId))).toBe(true);
}

async function runContinuousGreenfieldLifecycle(cwd: string): Promise<GreenfieldLifecycle> {
  const transitions: string[] = [];

  dispatchMock.mockResolvedValueOnce(GREENFIELD_S1_RESPONSE);
  const initialized = await runInit({cwd, intent: '결제 SaaS for B2B'});
  transitions.push('init');
  expect(initialized.onboardingMode).toBe('greenfield');
  assertArtifactsPresent(cwd, {
    specYaml: true,
    architectureYaml: true,
    capabilitiesYaml: true,
    projectContextMd: true,
    conventionsMd: true,
    scenariosReadme: true,
    onboardingStateYaml: true,
    scenarioShards: 2,
  });
  assertTierBanner(cwd, 'spec.yaml', 'A');
  assertTierBanner(cwd, 'spec/architecture.yaml', 'B');
  assertTierBanner(cwd, 'spec/capabilities.yaml', 'B');
  assertTierBanner(cwd, 'docs/project-context.md', 'B');
  assertTierBanner(cwd, 'docs/conventions.md', 'C');
  assertTierBanner(cwd, '.cladding/onboarding/state.yaml', 'D');
  expect(initialized.clarifyingQuestions).toHaveLength(3);
  assertScenarioFeatureReferences(cwd);

  dispatchMock.mockResolvedValueOnce(GREENFIELD_S2_RESPONSE);
  await runClarifyCommand(['법인', '사업자만'], {cwd});
  transitions.push('clarify');
  assertScenarioFeatureReferences(cwd);

  // Manual code authoring is the implementation simulation; every governance
  // transition around it uses its public command or exported core surface.
  writeUnderCwd(cwd, 'src/api/main.ts', 'export const handler = () => ({});\n');
  writeUnderCwd(cwd, 'src/api/route.ts', 'export const route = () => true;\n');
  writeUnderCwd(cwd, 'src/ledger/store.ts', 'export const append = (value: unknown) => value;\n');
  writeUnderCwd(cwd, 'src/webhook/handler.ts', 'export const verify = () => true;\n');
  assertCrossTierClean(cwd, ['META_INTEGRITY']);

  dispatchMock.mockResolvedValueOnce(GREENFIELD_S5_RESPONSE);
  await runInit({cwd, scan: true});
  transitions.push('rescan');
  assertProposalDivert(cwd, 'docs/conventions.md');
  assertProposalDivert(cwd, 'spec/architecture.yaml');
  assertScenarioFeatureReferences(cwd);

  const feature = createFeature({
    cwd,
    slug: 'payment-request',
    title: 'Payment request',
    modules: ['src/api/main.ts'],
    acceptance_criteria: [{
      ears: 'event',
      condition: 'when an operator submits a payment request',
      action: 'validate the request',
      response: 'a payment request is accepted or rejected',
      text: 'When an operator submits a payment request, the system shall validate the request.',
    }],
  });
  transitions.push('create-feature');
  assertScenarioFeatureReferences(cwd);
  linkScenario({cwd, scenario: 'purchase-flow', feature: feature.id});
  transitions.push('bind-scenario');
  assertScenarioFeatureReferences(cwd);
  assertFeatureIsScenarioBound(cwd, feature.id);
  linkCapability({cwd, capability: 'payment-auth', feature: feature.id});
  transitions.push('bind-capability');
  assertScenarioFeatureReferences(cwd);
  assertSpecCompleteness(cwd, {minCapabilities: 3, minScenarioShards: 2});
  assertCrossTierClean(cwd, ['META_INTEGRITY']);
  assertNoBudgetOverages(REPO_ROOT, cwd, 'Greenfield lifecycle final');

  return {transitions, featureId: feature.id};
}

describe('continuous greenfield lifecycle — 결제 SaaS for B2B intent', () => {
  let scenario: ReturnType<typeof mkScenarioCwd>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scenario = mkScenarioCwd('clad-greenfield-lifecycle-');
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dispatchMock.mockReset();
  });

  afterEach(() => {
    scenario.cleanup();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('[covers:F-4747ef/AC-001] completes the declared greenfield lifecycle in one valid initialized workspace through public surfaces', async () => {
    const lifecycle = await runContinuousGreenfieldLifecycle(scenario.path);

    expect(lifecycle.featureId).toMatch(/^F-/);
    expect(lifecycle.transitions).toEqual([
      'init', 'clarify', 'rescan', 'create-feature', 'bind-scenario', 'bind-capability',
    ]);
  });

  test('[covers:F-4747ef/AC-7e3e3f37] exercises every declared greenfield onboarding and refinement transition in the same continuing workspace', async () => {
    const lifecycle = await runContinuousGreenfieldLifecycle(scenario.path);

    expect(lifecycle.transitions.slice(0, 3)).toEqual(['init', 'clarify', 'rescan']);
  });

  test('[covers:F-4747ef/AC-e5aababf] retains structurally valid scenario-to-feature references after every greenfield lifecycle transition', async () => {
    await runContinuousGreenfieldLifecycle(scenario.path);

    assertScenarioFeatureReferences(scenario.path);
  });
});
