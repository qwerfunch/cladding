// Cladding · scenarios · continuous existing-adoption lifecycle (F-4747ef).

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));

const dispatchMock = vi.fn<(prompt: string) => Promise<string>>();
vi.mock('../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts?: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {runInit} = await import('../../src/cli/init.js');
const {resolveOnboardingReview, runClarifyCommand} = await import('../../src/cli/clarify.js');
const {loadState} = await import('../../src/cli/scan/onboarding-state.js');
const {createFeature, linkCapability, linkScenario} = await import('../../src/spec/new.js');
const {loadSpec} = await import('../../src/spec/load.js');
const {EXISTING_S2_RESPONSE, copyFixture, mkScenarioCwd, writeUnderCwd} = await import('./_helpers.js');
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

interface AdoptionLifecycle {
  readonly transitions: readonly string[];
  readonly authoredBefore: Readonly<Record<string, string>>;
  readonly authoredAfterReview: Readonly<Record<string, string>>;
  readonly featureId: string;
}

function assertFeatureIsScenarioBound(cwd: string, featureId: string): void {
  const scenarios = loadSpec(cwd).scenarios ?? [];
  expect(scenarios.some((scenario) => scenario.features?.includes(featureId))).toBe(true);
}

async function runContinuousAdoptionLifecycle(cwd: string): Promise<AdoptionLifecycle> {
  const transitions: string[] = [];
  copyFixture('sample-existing-ts', cwd);
  transitions.push('fixture');
  expect(existsSync(join(cwd, 'src/api/index.ts'))).toBe(true);
  expect(existsSync(join(cwd, 'src/lib/payment.ts'))).toBe(true);
  expect(existsSync(join(cwd, 'src/util/log.ts'))).toBe(true);

  dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
  // The lifecycle below authors features in the schema 0.1 shape, so it
  // initializes the legacy workspace explicitly rather than the 0.2 default.
  const initialized = await runInit({cwd, intent: '이 프로젝트 분석해서 클래딩 적용', schema: '0.1'});
  transitions.push('init');
  expect(initialized.onboardingMode).toBe('existing-adoption');
  assertArtifactsPresent(cwd, {
    specYaml: true,
    architectureYaml: true,
    capabilitiesYaml: true,
    projectContextMd: true,
    conventionsMd: true,
    scenariosReadme: true,
    onboardingStateYaml: true,
    scenarioShards: 1,
  });
  assertTierBanner(cwd, 'spec.yaml', 'A');
  assertTierBanner(cwd, 'spec/architecture.yaml', 'B');
  assertTierBanner(cwd, 'spec/capabilities.yaml', 'B');
  assertTierBanner(cwd, 'docs/project-context.md', 'B');
  assertTierBanner(cwd, 'docs/conventions.md', 'C');
  assertTierBanner(cwd, '.cladding/onboarding/state.yaml', 'D');
  const architecture = readFileSync(join(cwd, 'spec/architecture.yaml'), 'utf8');
  expect(architecture).toContain('name: api');
  expect(architecture).toContain('name: lib');
  expect(architecture).toContain('name: util');
  assertScenarioFeatureReferences(cwd);

  const authoredPaths = [
    'docs/project-context.md',
    'spec/capabilities.yaml',
    'spec/architecture.yaml',
  ] as const;
  for (const path of authoredPaths) {
    writeFileSync(`${cwd}/${path}`, `${readFileSync(`${cwd}/${path}`, 'utf8')}\n# Maintainer-owned adoption note\n`);
  }
  const authoredBefore = Object.fromEntries(authoredPaths.map((path) => [path, readFileSync(`${cwd}/${path}`, 'utf8')]));

  // The current clarify core detects the authored collision and routes its
  // refinement to proposal files instead of overwriting those exact bytes.
  dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
  await runClarifyCommand(['멀티', '테넌트가', '필요합니다'], {cwd});
  transitions.push('clarify');
  const pendingReview = loadState(cwd)?.pendingReview ?? [];
  expect(pendingReview).toHaveLength(4);
  for (const path of authoredPaths) expect(readFileSync(`${cwd}/${path}`, 'utf8')).toBe(authoredBefore[path]);
  for (const path of pendingReview) {
    expect(existsSync(`${cwd}/.cladding/scan/${path.split('/').pop()}.proposal`)).toBe(true);
  }
  for (const path of authoredPaths) assertProposalDivert(cwd, path);
  assertScenarioFeatureReferences(cwd);

  const review = resolveOnboardingReview(pendingReview, {cwd});
  transitions.push('resolve-review');
  expect(review.ok).toBe(true);
  for (const path of pendingReview) {
    expect(existsSync(`${cwd}/.cladding/scan/${path.split('/').pop()}.proposal`)).toBe(false);
  }
  const authoredAfterReview = Object.fromEntries(
    authoredPaths.map((path) => [path, readFileSync(`${cwd}/${path}`, 'utf8')]),
  );
  for (const path of authoredPaths) {
    expect(authoredAfterReview[path]).not.toBe(authoredBefore[path]);
    expect(readFileSync(`${cwd}/${path}`, 'utf8')).toBe(authoredAfterReview[path]);
  }
  assertScenarioFeatureReferences(cwd);

  // Manual authoring remains limited to the implementation step.
  writeUnderCwd(cwd, 'src/api/refund.ts', 'export const refund = () => undefined;\n');
  const feature = createFeature({
    cwd,
    slug: 'refund-flow',
    title: 'Refund flow',
    modules: ['src/api/refund.ts'],
    acceptance_criteria: [{
      ears: 'event',
      condition: 'when a refund request arrives',
      action: 'verify the original payment',
      response: 'the payment gateway receives a refund request',
      text: 'When a refund request arrives, the system shall verify the original payment.',
    }],
  });
  transitions.push('create-feature');
  assertScenarioFeatureReferences(cwd);
  linkScenario({cwd, scenario: 'payment-flow', feature: feature.id});
  transitions.push('bind-scenario');
  assertScenarioFeatureReferences(cwd);
  assertFeatureIsScenarioBound(cwd, feature.id);
  const capabilitiesBeforeBinding = readFileSync(`${cwd}/spec/capabilities.yaml`, 'utf8');
  linkCapability({cwd, capability: 'api', feature: feature.id});
  transitions.push('bind-capability');
  const capabilitiesAfterBinding = readFileSync(`${cwd}/spec/capabilities.yaml`, 'utf8');
  expect(capabilitiesAfterBinding).not.toBe(capabilitiesBeforeBinding);
  expect(capabilitiesAfterBinding).toContain(feature.id);
  assertScenarioFeatureReferences(cwd);
  assertSpecCompleteness(cwd, {minCapabilities: 3, minScenarioShards: 1});
  assertCrossTierClean(cwd, ['META_INTEGRITY', 'HARDCODED_SECRET']);
  assertNoBudgetOverages(REPO_ROOT, cwd, 'Existing-adoption lifecycle final');

  return {transitions, authoredBefore, authoredAfterReview, featureId: feature.id};
}

describe('continuous existing-adoption lifecycle — populated TypeScript fixture', () => {
  let scenario: ReturnType<typeof mkScenarioCwd>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scenario = mkScenarioCwd('clad-existing-adopt-');
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    dispatchMock.mockReset();
  });

  afterEach(() => {
    scenario.cleanup();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('[covers:F-4747ef/AC-002] completes one continuous adoption lifecycle from the committed populated TypeScript fixture', async () => {
    const lifecycle = await runContinuousAdoptionLifecycle(scenario.path);

    expect(lifecycle.featureId).toMatch(/^F-/);
    expect(lifecycle.transitions).toEqual([
      'fixture', 'init', 'clarify', 'resolve-review', 'create-feature', 'bind-scenario', 'bind-capability',
    ]);
  });

  test('[covers:F-4747ef/AC-4e9c049b] preserves authored collision inputs byte-identically and exposes the proposal escape end-to-end during adoption', async () => {
    const lifecycle = await runContinuousAdoptionLifecycle(scenario.path);

    for (const [path, before] of Object.entries(lifecycle.authoredBefore)) {
      expect(before).toContain('Maintainer-owned adoption note');
      expect(lifecycle.authoredAfterReview[path]).not.toBe(before);
      const current = readFileSync(`${scenario.path}/${path}`, 'utf8');
      if (path === 'spec/capabilities.yaml') {
        expect(current).not.toBe(lifecycle.authoredAfterReview[path]);
        expect(current).toContain(lifecycle.featureId);
      } else {
        expect(current).toBe(lifecycle.authoredAfterReview[path]);
      }
    }
  });

  test('[covers:F-4747ef/AC-e9094179] retains structurally valid scenario-to-feature references after adoption, refinement, and binding transitions', async () => {
    await runContinuousAdoptionLifecycle(scenario.path);

    assertScenarioFeatureReferences(scenario.path);
  });
});
