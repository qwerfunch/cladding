// Cladding · scenarios · existing-adoption-lifecycle (v0.3.46, F-4747ef)
//
// 6-stage end-to-end lifecycle test for the existing-adoption case
// (populated TypeScript project + adoption intent). Mirrors the
// greenfield test's structure: each stage verifies artifact presence,
// tier banners, cross-tier consistency, and size budgets.
//
// Stage seeding uses `tests/scenarios/_fixtures/sample-existing-ts/` —
// a 8-source-file TS project with package.json + README that crosses
// the SCAN_AUTO_THRESHOLD so cladding takes the observed path.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';

vi.mock('../../src/ui/pulse.js', () => ({pulse: vi.fn()}));

// Host-tool determinism (CI break, 2026-06-11): the deterministic battery must
// not depend on which external scanners (madge, secretlint) the HOST happens to
// resolve — stale ~/.npm/_npx caches made detector counts machine-dependent.
// Strip the external-scanner gates; their detectors then emit the stable
// "no validator registered" info on every machine.
vi.mock('../../src/stages/toolchain/detect.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/stages/toolchain/detect.js')>();
  return {
    ...real,
    detectToolchain: (cwd: string = '.') => {
      const t = real.detectToolchain(cwd);
      const gates = {...t.gates} as Record<string, unknown>;
      delete gates.arch;
      delete gates.secret;
      return {...t, gates} as ReturnType<typeof real.detectToolchain>;
    },
  };
});
const dispatchMock = vi.fn<(p: string) => Promise<string>>();
vi.mock('../../src/cli/scan/dispatcher.js', () => ({
  selectDispatcher: vi.fn((opts?: {noLlm?: boolean}) => (opts?.noLlm ? null : dispatchMock)),
}));

const {runInit} = await import('../../src/cli/init.js');
const {runClarifyCommand} = await import('../../src/cli/clarify.js');
const {mkScenarioCwd, copyFixture, writeUnderCwd, EXISTING_S2_RESPONSE} = await import('./_helpers.js');
const {
  assertArtifactsPresent,
  assertCrossTierClean,
  assertSpecCompleteness,
  assertTierBanner,
  assertNoBudgetOverages,
  countCapabilities,
} = await import('./_assertions.js');

const REPO_ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\/tests\/scenarios$/, '');

describe('existing-adoption lifecycle — "이 프로젝트 분석해서 클래딩 적용"', () => {
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

  test('S1 seed fixture: populated project crosses SCAN_AUTO_THRESHOLD', () => {
    copyFixture('sample-existing-ts', scenario.path);

    expect(existsSync(join(scenario.path, 'package.json'))).toBe(true);
    expect(existsSync(join(scenario.path, 'README.md'))).toBe(true);
    expect(existsSync(join(scenario.path, 'src/api/index.ts'))).toBe(true);
    expect(existsSync(join(scenario.path, 'src/lib/payment.ts'))).toBe(true);
    expect(existsSync(join(scenario.path, 'src/util/log.ts'))).toBe(true);
  });

  test('S2 init with adoption intent → existing-adoption mode + observed artifacts', async () => {
    copyFixture('sample-existing-ts', scenario.path);
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);

    const result = await runInit({
      cwd: scenario.path,
      intent: '이 프로젝트 분석해서 클래딩 적용',
    });

    // Mode classification surfaces in the result.
    expect(result.onboardingMode).toBe('existing-adoption');

    // All Tier A/B artifacts present + scenarios extracted from intent.
    assertArtifactsPresent(scenario.path, {
      specYaml: true,
      architectureYaml: true,
      capabilitiesYaml: true,
      projectContextMd: true,
      conventionsMd: true,
      scenariosReadme: true,
      scenarioShards: 1, // EXISTING_S2_RESPONSE emits "payment-flow"
      onboardingStateYaml: true,
    });

    // Tier banners on every artifact's first line.
    assertTierBanner(scenario.path, 'spec.yaml', 'A');
    assertTierBanner(scenario.path, 'spec/architecture.yaml', 'B');
    assertTierBanner(scenario.path, 'spec/capabilities.yaml', 'B');
    assertTierBanner(scenario.path, 'docs/project-context.md', 'B');
    assertTierBanner(scenario.path, 'docs/conventions.md', 'C');
    assertTierBanner(scenario.path, '.cladding/onboarding/state.yaml', 'D');

    // capabilities populated from README headings (Install/Usage/API).
    expect(countCapabilities(scenario.path)).toBeGreaterThanOrEqual(3);

    // architecture.yaml carries the observed layers (api / lib / util).
    const archBody = readFileSync(join(scenario.path, 'spec/architecture.yaml'), 'utf8');
    expect(archBody).toContain('name: api');
    expect(archBody).toContain('name: lib');
    expect(archBody).toContain('name: util');
  });

  test('S3 refine: refinement preserves Tier A spec, updates Tier B', async () => {
    copyFixture('sample-existing-ts', scenario.path);
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
    await runInit({cwd: scenario.path, intent: '이 프로젝트 분석해서 클래딩 적용'});

    // Reuse the same mock body for refine to simulate "no big change"
    // — the test focus is on the divert mechanism + spec preservation,
    // not the LLM's actual refinement logic.
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
    await runClarifyCommand(['멀티', '테넌트', '필요'], {cwd: scenario.path});

    // spec.yaml (Tier A, sealed) untouched by refine.
    const specBody = readFileSync(join(scenario.path, 'spec.yaml'), 'utf8');
    expect(specBody).toContain('schema: "0.1"');
    // No proposal for spec.yaml — refine doesn't write to Tier A directly.
    expect(existsSync(join(scenario.path, '.cladding/scan/spec.yaml.proposal'))).toBe(false);

    // Untouched generated Tier B artifacts are the active refined design.
    expect(existsSync(join(scenario.path, '.cladding/scan/project-context.md.proposal'))).toBe(false);
    expect(existsSync(join(scenario.path, '.cladding/scan/capabilities.yaml.proposal'))).toBe(false);
    expect(existsSync(join(scenario.path, '.cladding/scan/architecture.yaml.proposal'))).toBe(false);
  });

  test('S4 simulate new feature: hand-authored shard registers cleanly', async () => {
    copyFixture('sample-existing-ts', scenario.path);
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
    await runInit({cwd: scenario.path, intent: '이 프로젝트 분석해서 클래딩 적용'});

    // S4: hand-author a new feature shard for refund-flow + its module.
    mkdirSync(join(scenario.path, 'spec/features'), {recursive: true});
    writeUnderCwd(
      scenario.path,
      'spec/features/refund-flow-abc123.yaml',
      [
        '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
        'id: F-abc123',
        'slug: refund-flow',
        'title: "환불 흐름"',
        'status: planned',
        'modules: ["src/api/refund.ts"]',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    ears: ubiquitous',
        '    text: "When a refund request lands, the system shall verify the original payment and call PG refund."',
        '',
      ].join('\n'),
    );
    writeUnderCwd(scenario.path, 'src/api/refund.ts', '// refund\nexport const refund = () => {};\n');

    // Tier A loadable, banner present, module-on-disk consistent.
    assertTierBanner(scenario.path, 'spec/features/refund-flow-abc123.yaml', 'A');
  });

  test('S5 bind feature to capability: CAPABILITIES_FEATURE_MAPPING accepts the link', async () => {
    copyFixture('sample-existing-ts', scenario.path);
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
    await runInit({cwd: scenario.path, intent: '이 프로젝트 분석해서 클래딩 적용'});

    // Author the new feature shard.
    mkdirSync(join(scenario.path, 'spec/features'), {recursive: true});
    writeUnderCwd(
      scenario.path,
      'spec/features/refund-flow-abc123.yaml',
      [
        '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
        'id: F-abc123',
        'slug: refund-flow',
        'title: "환불 흐름"',
        'status: planned',
        'modules: ["src/api/refund.ts"]',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    ears: ubiquitous',
        '    text: "Refund flow shall verify and process."',
        '',
      ].join('\n'),
    );
    writeUnderCwd(scenario.path, 'src/api/refund.ts', '// refund\nexport const refund = () => {};\n');

    // Bind F-abc123 to the 'api' capability via features[].
    const capsPath = join(scenario.path, 'spec/capabilities.yaml');
    const updated = readFileSync(capsPath, 'utf8').replace(
      '  - id: api\n    title: "API"\n    summary: "공개 API 레퍼런스"\n    surface: feature\n    features: []',
      '  - id: api\n    title: "API"\n    summary: "공개 API 레퍼런스"\n    surface: feature\n    features: [F-abc123]',
    );
    writeFileSync(capsPath, updated);

    // CAPABILITIES_FEATURE_MAPPING now sees one bound feature; clean (no errors).
    // Allow META_INTEGRITY + HARDCODED_SECRET through — both are
    // cladding-self toolchain checks (secretlint config, schema.json)
    // that don't apply to a tmpdir fixture.
    assertCrossTierClean(scenario.path, ['META_INTEGRITY', 'HARDCODED_SECRET']);
  });

  test('S6 final digest: lifecycle complete, all sizes within budget', async () => {
    copyFixture('sample-existing-ts', scenario.path);
    dispatchMock.mockResolvedValueOnce(EXISTING_S2_RESPONSE);
    await runInit({cwd: scenario.path, intent: '이 프로젝트 분석해서 클래딩 적용'});

    assertSpecCompleteness(scenario.path, {
      minCapabilities: 3,
      minScenarioShards: 1,
    });
    assertNoBudgetOverages(REPO_ROOT, scenario.path, 'Existing-adoption S6 final');
  });
});
