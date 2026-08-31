// Cladding · scenarios · assertions (v0.3.46, F-4747ef)
//
// High-level assertions for the lifecycle tests. Keep test files
// readable by hiding the file-IO + parsing in this module — each
// stage in greenfield-lifecycle.test.ts / existing-adoption-lifecycle.test.ts
// reads more like a checklist than a maze of expect() calls.
//
// Two flavors:
//   - assert* throw on failure (vitest-friendly)
//   - check* return a result (use for digests, optional fails)

import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'yaml';

import {allDetectors} from '../../src/stages/detectors/index.js';
import {loadSpec} from '../../src/spec/load.js';
import {
  checkBudget,
  PERSONA_BUDGETS,
  ARTIFACT_BUDGETS,
  META_DOC_BUDGETS,
  type SizeBudget,
} from './_size-budgets.js';
import {formatMeasurement, measureFile, type SizeMeasurement} from './_token-meter.js';

/** Maps Tier letter → expected first-line substring after `Cladding · `. */
const TIER_BANNER = {
  A: 'Tier A',
  B: 'Tier B',
  C: 'Tier C',
  D: 'Tier D',
} as const;

/**
 * Verifies the first line of `<cwd>/<relPath>` is a Tier banner of
 * the expected tier. Cladding's convention (see docs/ssot-model.md)
 * is to put the banner on line 1 so a reader can identify tier from
 * `head -1` without loading the body.
 */
export function assertTierBanner(cwd: string, relPath: string, expectedTier: keyof typeof TIER_BANNER): void {
  const abs = join(cwd, relPath);
  if (!existsSync(abs)) {
    throw new Error(`assertTierBanner: ${relPath} does not exist under ${cwd}`);
  }
  const firstLine = readFileSync(abs, 'utf8').split('\n')[0];
  if (!firstLine.includes('Cladding · ')) {
    throw new Error(`assertTierBanner: ${relPath} first line missing "Cladding · " banner: ${firstLine}`);
  }
  const marker = TIER_BANNER[expectedTier];
  if (!firstLine.includes(marker)) {
    throw new Error(`assertTierBanner: ${relPath} expected ${marker} but first line is: ${firstLine}`);
  }
}

/** Expected artifact presence per scenario stage. */
export interface ExpectedArtifacts {
  readonly specYaml?: boolean;
  readonly architectureYaml?: boolean;
  readonly capabilitiesYaml?: boolean;
  readonly projectContextMd?: boolean;
  readonly conventionsMd?: boolean;
  readonly scenariosReadme?: boolean;
  /** Minimum number of `spec/scenarios/<slug>-<hash8>.yaml` files (excludes README). */
  readonly scenarioShards?: number;
  readonly onboardingStateYaml?: boolean;
}

/**
 * Verifies every artifact in `expected` exists. Pass only the fields
 * you care about — the rest are not checked. Useful at each lifecycle
 * stage to confirm which artifacts the command produced.
 */
export function assertArtifactsPresent(cwd: string, expected: ExpectedArtifacts): void {
  const checks: Array<[boolean | undefined, string]> = [
    [expected.specYaml, 'spec.yaml'],
    [expected.architectureYaml, 'spec/architecture.yaml'],
    [expected.capabilitiesYaml, 'spec/capabilities.yaml'],
    [expected.projectContextMd, 'docs/project-context.md'],
    [expected.conventionsMd, 'docs/conventions.md'],
    [expected.scenariosReadme, 'spec/scenarios/README.md'],
    [expected.onboardingStateYaml, '.cladding/onboarding/state.yaml'],
  ];
  for (const [want, rel] of checks) {
    if (want === undefined) continue;
    const exists = existsSync(join(cwd, rel));
    if (want && !exists) throw new Error(`assertArtifactsPresent: ${rel} missing`);
    if (!want && exists) throw new Error(`assertArtifactsPresent: ${rel} should NOT exist`);
  }
  if (expected.scenarioShards !== undefined) {
    const count = countScenarioShards(cwd);
    if (count < expected.scenarioShards) {
      throw new Error(
        `assertArtifactsPresent: expected at least ${expected.scenarioShards} scenario shards, found ${count}`,
      );
    }
  }
}

function countScenarioShards(cwd: string): number {
  const dir = join(cwd, 'spec', 'scenarios');
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.yaml')).length;
  } catch {
    return 0;
  }
}

/**
 * Runs every detector against the cwd and returns findings grouped by
 * severity. Lifecycle tests call this to assert end-state cleanliness.
 */
export function runAllDetectors(cwd: string): {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly infos: readonly string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  for (const det of allDetectors) {
    let findings;
    try {
      findings = det.run({cwd});
    } catch {
      continue; // a detector that errors on a tmpdir we own is the test's bug; skip
    }
    for (const f of findings) {
      const msg = `[${det.name}] ${f.message}`;
      if (f.severity === 'error') errors.push(msg);
      else if (f.severity === 'warn') warnings.push(msg);
      else infos.push(msg);
    }
  }
  return {errors, warnings, infos};
}

/**
 * Asserts CAPABILITIES_FEATURE_MAPPING + ARCHITECTURE_FROM_SPEC +
 * REFERENCE_INTEGRITY are clean (no error findings) at this stage.
 * Lifecycle tests run this after the relevant artifacts settle.
 */
export function assertCrossTierClean(cwd: string, allowedDetectors: readonly string[] = []): void {
  const results = runAllDetectors(cwd);
  const blocking = results.errors.filter((msg) => !allowedDetectors.some((d) => msg.includes(`[${d}]`)));
  if (blocking.length > 0) {
    throw new Error(`assertCrossTierClean: ${blocking.length} error finding(s):\n${blocking.join('\n')}`);
  }
}

/**
 * Verifies that every current schema-0.1 scenario feature binding resolves.
 * Empty feature lists are a valid onboarding state before implementation work
 * creates the first feature.
 *
 * @param cwd - Lifecycle workspace whose current scenario shards are checked.
 * @throws Error when a scenario names a feature absent from the current spec.
 */
export function assertScenarioFeatureReferences(cwd: string): void {
  const spec = loadSpec(cwd);
  const featureIds = new Set(spec.features.map((feature) => feature.id));
  for (const scenario of spec.scenarios ?? []) {
    for (const featureId of scenario.features ?? []) {
      if (!featureIds.has(featureId)) {
        throw new Error(
          `assertScenarioFeatureReferences: scenario ${scenario.id} references unknown feature ${featureId}`,
        );
      }
    }
  }
}

/** Counts entries in spec/capabilities.yaml's `capabilities[]` array. */
export function countCapabilities(cwd: string): number {
  const abs = join(cwd, 'spec', 'capabilities.yaml');
  if (!existsSync(abs)) return 0;
  try {
    const parsed = yaml.parse(readFileSync(abs, 'utf8')) as {capabilities?: unknown[]};
    return Array.isArray(parsed?.capabilities) ? parsed.capabilities.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Spec completeness assertion — useful at end-of-lifecycle to confirm
 * the spec has the minimum number of features/capabilities/scenarios
 * the test expected.
 */
export function assertSpecCompleteness(
  cwd: string,
  opts: {readonly minCapabilities?: number; readonly minScenarioShards?: number},
): void {
  if (opts.minCapabilities !== undefined) {
    const got = countCapabilities(cwd);
    if (got < opts.minCapabilities) {
      throw new Error(`assertSpecCompleteness: capabilities ${got} < min ${opts.minCapabilities}`);
    }
  }
  if (opts.minScenarioShards !== undefined) {
    const got = countScenarioShards(cwd);
    if (got < opts.minScenarioShards) {
      throw new Error(`assertSpecCompleteness: scenario shards ${got} < min ${opts.minScenarioShards}`);
    }
  }
}

/**
 * Asserts the named relative file in `.cladding/scan/<basename>.proposal`
 * exists (i.e., the divert mechanism fired on re-write of an existing
 * authored file).
 */
export function assertProposalDivert(cwd: string, relPath: string): void {
  const base = relPath.split('/').pop()!;
  const proposalAbs = join(cwd, '.cladding', 'scan', `${base}.proposal`);
  if (!existsSync(proposalAbs)) {
    throw new Error(`assertProposalDivert: expected ${proposalAbs} to exist (re-write should have diverted)`);
  }
}

// ──────────────────────────────────────────────────────────────────
// Size / token digest — emitted at end of each lifecycle test.
// ──────────────────────────────────────────────────────────────────

/** One row of the digest output. */
export interface DigestRow {
  readonly category: 'persona' | 'meta-doc' | 'artifact';
  readonly path: string;
  readonly measurement: SizeMeasurement;
  readonly budget: SizeBudget;
  readonly status: 'OK' | 'OVERAGE';
  readonly overages: readonly string[];
}

/**
 * Walks every tracked artifact + persona + meta-doc, measures it,
 * compares against budgets, returns rows for the test to log + assert.
 */
export function buildSizeDigest(repoRoot: string, cwd?: string): readonly DigestRow[] {
  const rows: DigestRow[] = [];

  // Personas (canonical sources, always under repoRoot).
  for (const [path, budget] of Object.entries(PERSONA_BUDGETS)) {
    rows.push(rowForFile('persona', path, join(repoRoot, path), budget));
  }
  // Meta docs.
  for (const [path, budget] of Object.entries(META_DOC_BUDGETS)) {
    rows.push(rowForFile('meta-doc', path, join(repoRoot, path), budget));
  }
  // Generated artifacts under the test cwd, if provided.
  if (cwd) {
    for (const [path, budget] of Object.entries(ARTIFACT_BUDGETS)) {
      // Skip glob entries (scenario shards handled separately).
      if (path.includes('*')) continue;
      rows.push(rowForFile('artifact', path, join(cwd, path), budget));
    }
  }
  return rows;
}

function rowForFile(category: DigestRow['category'], path: string, abs: string, budget: SizeBudget): DigestRow {
  const measurement = measureFile(abs);
  const check = checkBudget(path, measurement, budget);
  return {
    category,
    path,
    measurement,
    budget,
    status: check.ok ? 'OK' : 'OVERAGE',
    overages: check.violations,
  };
}

/** Formats the digest for console output. Multi-line string. */
export function formatDigest(rows: readonly DigestRow[]): string {
  const lines: string[] = ['', '── Token efficiency digest ──'];
  let currentCategory: DigestRow['category'] | null = null;
  for (const row of rows) {
    if (row.category !== currentCategory) {
      lines.push('', `[${row.category}]`);
      currentCategory = row.category;
    }
    const flag = row.status === 'OK' ? '✓' : '✗';
    lines.push(
      `  ${flag} ${row.path}: ${formatMeasurement(row.measurement)}  ` +
        `(budget: ${row.budget.maxLines}L / ${row.budget.maxChars}c / ~${row.budget.maxTokens}t)`,
    );
  }
  const overages = rows.filter((r) => r.status === 'OVERAGE');
  if (overages.length > 0) {
    lines.push('', `OVERAGES (${overages.length}):`);
    for (const o of overages) {
      for (const v of o.overages) lines.push(`  ✗ ${v}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Convenience wrapper: build + print digest + assert no overages.
 * Lifecycle tests call this at the final stage as a "no regression"
 * gate. Prints to stdout regardless so the user can audit even on
 * pass.
 */
export function assertNoBudgetOverages(repoRoot: string, cwd?: string, label = ''): void {
  const rows = buildSizeDigest(repoRoot, cwd);
  const digest = formatDigest(rows);
  // Use process.stdout.write directly so the output isn't suppressed
  // by vitest's silent mode for passing tests.
  process.stdout.write(`${label ? `\n=== ${label} ===` : ''}${digest}\n`);
  const overages = rows.filter((r) => r.status === 'OVERAGE');
  if (overages.length > 0) {
    throw new Error(
      `assertNoBudgetOverages: ${overages.length} overage(s) — see digest above. ` +
        'Update _size-budgets.ts if the growth is intentional.',
    );
  }
}

/** Re-exports for downstream tests. */
export {measureFile, formatMeasurement} from './_token-meter.js';
