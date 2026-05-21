// Cladding · scenarios · ab · metrics (v0.3.47, F-4db939)
//
// Snapshot capture for A/B evaluation. Reads a tmpdir state and
// produces an 8-dimension metric set that quantifies cladding's
// value vs vanilla Claude Code on the same intent.
//
// Snapshots are pure data — no assertions. The report layer
// (_report.ts) consumes them to emit deterministic markdown.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

import yaml from 'yaml';

import {runAllDetectors} from '../_assertions.js';
import {
  formatMeasurement,
  measureFile,
  measureText,
  sumMeasurements,
  type SizeMeasurement,
} from '../_token-meter.js';

/** Per-tier artifact count. */
export interface TierCount {
  readonly tierA: number;
  readonly tierB: number;
  readonly tierC: number;
  readonly tierD: number;
}

/** Spec completeness — structured artifact inventory. */
export interface SpecMetrics {
  readonly hasSpecYaml: boolean;
  readonly hasArchitectureYaml: boolean;
  readonly hasCapabilitiesYaml: boolean;
  readonly features: number;
  readonly acceptanceCriteria: number;
  readonly scenarios: number;
  readonly capabilities: number;
  /** Capabilities with at least one bound feature. */
  readonly capabilitiesBound: number;
}

/** Architecture layer enforcement. */
export interface LayerMetrics {
  readonly layersDeclared: number;
  readonly forbiddenImportRules: number;
}

/** Detector finding summary. */
export interface DetectorMetrics {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  /** First 3 error messages (or empty). For human report. */
  readonly errorSamples: readonly string[];
}

/** Documentation size by category. */
export interface DocumentationMetrics {
  /** Sum across tier-banner-bearing doc files. */
  readonly tieredDocs: SizeMeasurement;
  /** Sum across non-tiered docs (README, etc.). */
  readonly otherDocs: SizeMeasurement;
  readonly tieredDocFiles: number;
  readonly otherDocFiles: number;
}

/** Code structure metrics under `src/`. */
export interface CodeMetrics {
  readonly sourceFiles: number;
  readonly testFiles: number;
  readonly totalSourceLoc: number;
  readonly totalTestLoc: number;
}

/** Test coverage proxy (no real test execution). */
export interface TestMetrics {
  readonly testFiles: number;
  readonly testCases: number;
}

/** Single snapshot. */
export interface AbSnapshot {
  readonly group: 'A' | 'B';
  readonly milestone: 'M1' | 'M2';
  readonly cwd: string;
  readonly tieredArtifactCount: TierCount;
  readonly specCompleteness: SpecMetrics;
  readonly layerCompliance: LayerMetrics;
  readonly crossDocConsistency: DetectorMetrics;
  readonly documentation: DocumentationMetrics;
  readonly codeStructure: CodeMetrics;
  readonly tokenConsumption: SizeMeasurement;
  readonly testCoverage: TestMetrics;
}

// ──────────────────────────────────────────────────────────────────
// Snapshot capture
// ──────────────────────────────────────────────────────────────────

export function captureSnapshot(group: 'A' | 'B', milestone: 'M1' | 'M2', cwd: string): AbSnapshot {
  return {
    group,
    milestone,
    cwd,
    tieredArtifactCount: countTieredArtifacts(cwd),
    specCompleteness: measureSpec(cwd),
    layerCompliance: measureLayers(cwd),
    crossDocConsistency: measureDetectors(cwd),
    documentation: measureDocs(cwd),
    codeStructure: measureCode(cwd),
    tokenConsumption: measureTokens(cwd),
    testCoverage: measureTests(cwd),
  };
}

// ──────────────────────────────────────────────────────────────────
// Tier counting (banner-driven)
// ──────────────────────────────────────────────────────────────────

function tierFromFirstLine(absPath: string): 'A' | 'B' | 'C' | 'D' | null {
  if (!existsSync(absPath)) return null;
  let firstLine: string;
  try {
    firstLine = readFileSync(absPath, 'utf8').split('\n')[0];
  } catch {
    return null;
  }
  if (!firstLine.includes('Cladding · ')) return null;
  if (firstLine.includes('Tier A')) return 'A';
  if (firstLine.includes('Tier B')) return 'B';
  if (firstLine.includes('Tier C')) return 'C';
  if (firstLine.includes('Tier D')) return 'D';
  return null;
}

function countTieredArtifacts(cwd: string): TierCount {
  const candidates: string[] = [
    'spec.yaml',
    'spec/architecture.yaml',
    'spec/capabilities.yaml',
    'docs/project-context.md',
    'docs/conventions.md',
    'spec/scenarios/README.md',
    '.cladding/onboarding/state.yaml',
  ];
  // Also include scenario shards + feature shards (each is independently tiered).
  for (const rel of ['spec/scenarios', 'spec/features']) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    try {
      for (const name of readdirSync(abs)) {
        if (name.endsWith('.yaml')) candidates.push(`${rel}/${name}`);
      }
    } catch {
      // ignore
    }
  }
  let tierA = 0;
  let tierB = 0;
  let tierC = 0;
  let tierD = 0;
  for (const rel of candidates) {
    const tier = tierFromFirstLine(join(cwd, rel));
    if (tier === 'A') tierA++;
    else if (tier === 'B') tierB++;
    else if (tier === 'C') tierC++;
    else if (tier === 'D') tierD++;
  }
  return {tierA, tierB, tierC, tierD};
}

// ──────────────────────────────────────────────────────────────────
// Spec completeness
// ──────────────────────────────────────────────────────────────────

interface RawFeature {
  readonly id?: string;
  readonly modules?: readonly string[];
  readonly acceptance_criteria?: readonly unknown[];
}

interface RawCapability {
  readonly id?: string;
  readonly features?: readonly string[];
}

function measureSpec(cwd: string): SpecMetrics {
  const hasSpecYaml = existsSync(join(cwd, 'spec.yaml'));
  const hasArchitectureYaml = existsSync(join(cwd, 'spec/architecture.yaml'));
  const hasCapabilitiesYaml = existsSync(join(cwd, 'spec/capabilities.yaml'));

  // Sharded feature count + AC count: walk spec/features/*.yaml.
  let features = 0;
  let acceptanceCriteria = 0;
  const featuresDir = join(cwd, 'spec/features');
  if (existsSync(featuresDir)) {
    try {
      for (const name of readdirSync(featuresDir)) {
        if (!name.endsWith('.yaml')) continue;
        features++;
        try {
          const body = readFileSync(join(featuresDir, name), 'utf8');
          const parsed = yaml.parse(body) as RawFeature | null;
          if (parsed && Array.isArray(parsed.acceptance_criteria)) {
            acceptanceCriteria += parsed.acceptance_criteria.length;
          }
        } catch {
          // ignore — best-effort metric
        }
      }
    } catch {
      // ignore
    }
  }
  // Plus inline features in spec.yaml's `features:` array (greenfield F-001 seed).
  if (hasSpecYaml) {
    try {
      const specBody = readFileSync(join(cwd, 'spec.yaml'), 'utf8');
      const parsed = yaml.parse(specBody) as {features?: readonly RawFeature[]} | null;
      if (parsed && Array.isArray(parsed.features)) {
        for (const f of parsed.features) {
          features++;
          if (Array.isArray(f?.acceptance_criteria)) acceptanceCriteria += f.acceptance_criteria.length;
        }
      }
    } catch {
      // ignore
    }
  }

  // Scenarios: count .yaml under spec/scenarios/.
  let scenarios = 0;
  const scenariosDir = join(cwd, 'spec/scenarios');
  if (existsSync(scenariosDir)) {
    try {
      scenarios = readdirSync(scenariosDir).filter((n) => n.endsWith('.yaml')).length;
    } catch {
      // ignore
    }
  }

  // Capabilities + bound count.
  let capabilities = 0;
  let capabilitiesBound = 0;
  if (hasCapabilitiesYaml) {
    try {
      const body = readFileSync(join(cwd, 'spec/capabilities.yaml'), 'utf8');
      const parsed = yaml.parse(body) as {capabilities?: readonly RawCapability[]} | null;
      if (parsed && Array.isArray(parsed.capabilities)) {
        capabilities = parsed.capabilities.length;
        for (const c of parsed.capabilities) {
          if (Array.isArray(c?.features) && c.features.length > 0) capabilitiesBound++;
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    hasSpecYaml,
    hasArchitectureYaml,
    hasCapabilitiesYaml,
    features,
    acceptanceCriteria,
    scenarios,
    capabilities,
    capabilitiesBound,
  };
}

// ──────────────────────────────────────────────────────────────────
// Layer compliance
// ──────────────────────────────────────────────────────────────────

interface RawArchitecture {
  readonly layers?: readonly {readonly name?: string; readonly forbidden_imports?: readonly string[]}[];
}

function measureLayers(cwd: string): LayerMetrics {
  const archAbs = join(cwd, 'spec/architecture.yaml');
  if (!existsSync(archAbs)) return {layersDeclared: 0, forbiddenImportRules: 0};
  try {
    const parsed = yaml.parse(readFileSync(archAbs, 'utf8')) as RawArchitecture | null;
    const layers = Array.isArray(parsed?.layers) ? parsed.layers : [];
    const layersDeclared = layers.length;
    let forbiddenImportRules = 0;
    for (const layer of layers) {
      if (Array.isArray(layer?.forbidden_imports)) forbiddenImportRules += layer.forbidden_imports.length;
    }
    return {layersDeclared, forbiddenImportRules};
  } catch {
    return {layersDeclared: 0, forbiddenImportRules: 0};
  }
}

// ──────────────────────────────────────────────────────────────────
// Detector findings
// ──────────────────────────────────────────────────────────────────

function measureDetectors(cwd: string): DetectorMetrics {
  const results = runAllDetectors(cwd);
  // META_INTEGRITY + HARDCODED_SECRET are cladding-self toolchain checks that
  // don't apply to tmpdir fixtures — same allowlist used by existing lifecycle
  // tests. Exclude them so the A/B numbers reflect SPEC↔CODE drift, not
  // toolchain noise.
  const allowlist = ['[META_INTEGRITY]', '[HARDCODED_SECRET]'];
  const filteredErrors = results.errors.filter((m) => !allowlist.some((tag) => m.includes(tag)));
  const filteredWarnings = results.warnings.filter((m) => !allowlist.some((tag) => m.includes(tag)));
  const filteredInfos = results.infos.filter((m) => !allowlist.some((tag) => m.includes(tag)));
  return {
    errors: filteredErrors.length,
    warnings: filteredWarnings.length,
    infos: filteredInfos.length,
    errorSamples: filteredErrors.slice(0, 3),
  };
}

// ──────────────────────────────────────────────────────────────────
// Documentation size
// ──────────────────────────────────────────────────────────────────

const TIERED_DOC_CANDIDATES = [
  'docs/project-context.md',
  'docs/conventions.md',
  'spec/scenarios/README.md',
];

function measureDocs(cwd: string): DocumentationMetrics {
  let tieredDocs: SizeMeasurement = {lines: 0, chars: 0, estTokens: 0};
  let tieredDocFiles = 0;
  for (const rel of TIERED_DOC_CANDIDATES) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    const tier = tierFromFirstLine(abs);
    if (!tier) continue;
    tieredDocFiles++;
    tieredDocs = sumMeasurements(tieredDocs, measureFile(abs));
  }

  let otherDocs: SizeMeasurement = {lines: 0, chars: 0, estTokens: 0};
  let otherDocFiles = 0;
  // README at root, anything under docs/ not in TIERED_DOC_CANDIDATES.
  const readmeAbs = join(cwd, 'README.md');
  if (existsSync(readmeAbs)) {
    otherDocFiles++;
    otherDocs = sumMeasurements(otherDocs, measureFile(readmeAbs));
  }
  const docsDir = join(cwd, 'docs');
  if (existsSync(docsDir)) {
    try {
      for (const name of readdirSync(docsDir)) {
        const rel = `docs/${name}`;
        if (TIERED_DOC_CANDIDATES.includes(rel)) continue;
        const abs = join(cwd, rel);
        if (!name.endsWith('.md')) continue;
        if (!statSync(abs).isFile()) continue;
        otherDocFiles++;
        otherDocs = sumMeasurements(otherDocs, measureFile(abs));
      }
    } catch {
      // ignore
    }
  }
  return {tieredDocs, otherDocs, tieredDocFiles, otherDocFiles};
}

// ──────────────────────────────────────────────────────────────────
// Code structure
// ──────────────────────────────────────────────────────────────────

function walkTsFiles(cwd: string, relRoot: string): readonly string[] {
  const abs = join(cwd, relRoot);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const queue = [abs];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const childAbs = join(dir, name);
      let s;
      try {
        s = statSync(childAbs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (name === 'node_modules' || name === '.cladding') continue;
        queue.push(childAbs);
      } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
        out.push(relative(cwd, childAbs));
      }
    }
  }
  return out;
}

function measureCode(cwd: string): CodeMetrics {
  const srcFiles = walkTsFiles(cwd, 'src');
  const testFiles = walkTsFiles(cwd, 'tests');
  let totalSourceLoc = 0;
  for (const rel of srcFiles) {
    totalSourceLoc += measureFile(join(cwd, rel)).lines;
  }
  let totalTestLoc = 0;
  for (const rel of testFiles) {
    totalTestLoc += measureFile(join(cwd, rel)).lines;
  }
  return {
    sourceFiles: srcFiles.length,
    testFiles: testFiles.length,
    totalSourceLoc,
    totalTestLoc,
  };
}

// ──────────────────────────────────────────────────────────────────
// Token consumption (cumulative artifact + code body)
// ──────────────────────────────────────────────────────────────────

function measureTokens(cwd: string): SizeMeasurement {
  let total: SizeMeasurement = {lines: 0, chars: 0, estTokens: 0};
  // Cladding artifacts
  for (const rel of [
    'spec.yaml',
    'spec/architecture.yaml',
    'spec/capabilities.yaml',
    'docs/project-context.md',
    'docs/conventions.md',
    'spec/scenarios/README.md',
    '.cladding/onboarding/state.yaml',
    'README.md',
  ]) {
    total = sumMeasurements(total, measureFile(join(cwd, rel)));
  }
  // Scenario shards
  const scenariosDir = join(cwd, 'spec/scenarios');
  if (existsSync(scenariosDir)) {
    try {
      for (const name of readdirSync(scenariosDir)) {
        if (!name.endsWith('.yaml')) continue;
        total = sumMeasurements(total, measureFile(join(scenariosDir, name)));
      }
    } catch {
      // ignore
    }
  }
  // Feature shards
  const featuresDir = join(cwd, 'spec/features');
  if (existsSync(featuresDir)) {
    try {
      for (const name of readdirSync(featuresDir)) {
        if (!name.endsWith('.yaml')) continue;
        total = sumMeasurements(total, measureFile(join(featuresDir, name)));
      }
    } catch {
      // ignore
    }
  }
  // Code under src/ + tests/
  for (const rel of [...walkTsFiles(cwd, 'src'), ...walkTsFiles(cwd, 'tests')]) {
    total = sumMeasurements(total, measureFile(join(cwd, rel)));
  }
  return total;
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

function measureTests(cwd: string): TestMetrics {
  const testFiles = walkTsFiles(cwd, 'tests');
  let testCases = 0;
  for (const rel of testFiles) {
    let body: string;
    try {
      body = readFileSync(join(cwd, rel), 'utf8');
    } catch {
      continue;
    }
    // Naive regex — matches top-level test( and it( with opening paren.
    const matches = body.match(/(^|\s)(test|it)\(/g);
    if (matches) testCases += matches.length;
  }
  return {testFiles: testFiles.length, testCases};
}

// ──────────────────────────────────────────────────────────────────
// Diffing — A vs B
// ──────────────────────────────────────────────────────────────────

export interface MetricRow {
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly delta: string;
  /** True when A > B in a "more structure" direction (informational). */
  readonly favorsA: boolean;
}

export function diffToRows(a: AbSnapshot, b: AbSnapshot): readonly MetricRow[] {
  const numRow = (label: string, av: number, bv: number, favorAGreater = true): MetricRow => ({
    label,
    a: String(av),
    b: String(bv),
    delta: `${av - bv >= 0 ? '+' : ''}${av - bv}`,
    favorsA: favorAGreater ? av > bv : av < bv,
  });
  return [
    numRow('Tier A artifacts', a.tieredArtifactCount.tierA, b.tieredArtifactCount.tierA),
    numRow('Tier B artifacts', a.tieredArtifactCount.tierB, b.tieredArtifactCount.tierB),
    numRow('Tier C artifacts', a.tieredArtifactCount.tierC, b.tieredArtifactCount.tierC),
    numRow('Tier D artifacts', a.tieredArtifactCount.tierD, b.tieredArtifactCount.tierD),
    numRow('Spec features', a.specCompleteness.features, b.specCompleteness.features),
    numRow('Acceptance criteria', a.specCompleteness.acceptanceCriteria, b.specCompleteness.acceptanceCriteria),
    numRow('Scenario shards', a.specCompleteness.scenarios, b.specCompleteness.scenarios),
    numRow('Capabilities declared', a.specCompleteness.capabilities, b.specCompleteness.capabilities),
    numRow('Capabilities bound to features', a.specCompleteness.capabilitiesBound, b.specCompleteness.capabilitiesBound),
    numRow('Architecture layers', a.layerCompliance.layersDeclared, b.layerCompliance.layersDeclared),
    numRow('Forbidden-import rules', a.layerCompliance.forbiddenImportRules, b.layerCompliance.forbiddenImportRules),
    numRow('Detector errors', a.crossDocConsistency.errors, b.crossDocConsistency.errors, false),
    numRow('Detector warnings', a.crossDocConsistency.warnings, b.crossDocConsistency.warnings),
    numRow('Detector infos', a.crossDocConsistency.infos, b.crossDocConsistency.infos),
    numRow('Tiered doc files', a.documentation.tieredDocFiles, b.documentation.tieredDocFiles),
    numRow('Tiered docs (lines)', a.documentation.tieredDocs.lines, b.documentation.tieredDocs.lines),
    numRow('Other doc files', a.documentation.otherDocFiles, b.documentation.otherDocFiles, false),
    numRow('Source TS files', a.codeStructure.sourceFiles, b.codeStructure.sourceFiles, false),
    numRow('Source LoC', a.codeStructure.totalSourceLoc, b.codeStructure.totalSourceLoc, false),
    numRow('Test files', a.codeStructure.testFiles, b.codeStructure.testFiles),
    numRow('Test LoC', a.codeStructure.totalTestLoc, b.codeStructure.totalTestLoc),
    numRow('Test cases', a.testCoverage.testCases, b.testCoverage.testCases),
    numRow('Total chars (artifacts + code)', a.tokenConsumption.chars, b.tokenConsumption.chars),
    numRow('Estimated tokens', a.tokenConsumption.estTokens, b.tokenConsumption.estTokens),
  ];
}

export {formatMeasurement, measureText};
