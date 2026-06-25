// Cladding · drift detector · HARNESS_INTEGRITY
//
// Detector #17 from the catalog (axis: environment, severity: error).
// Verifies cladding's own metadata is self-consistent across three
// layers (v0.3.5+, F-080):
//
//   1. Detector count — the numerator of
//      `.claude-plugin/plugin.json current.detectors` must equal the
//      count of non-index .ts files under `src/stages/detectors/`.
//      (Original v0.2.4 invariant.)
//
//   2. Per-host manifest schema — every host plugin manifest
//      (Claude Code, Codex, Gemini CLI) must declare at least `name`
//      and `version`. Codex additionally requires `description`.
//      Missing required fields trip a per-host error finding.
//
//   3. Cross-manifest version drift — `package.json`,
//      `.claude-plugin/plugin.json`, `plugins/codex/.codex-plugin/
//      plugin.json`, `plugins/gemini-cli/gemini-extension.json`, and the
//      `.claude-plugin/marketplace.json` catalog entry (`plugins[].version`,
//      the version the Claude Code host reads to detect "update available")
//      must all carry the same `version` string. Any pair in
//      disagreement trips an error finding so a release can't ship
//      with a half-bumped manifest set or a stale marketplace catalog.
//
//   4. Stage list (v0.6.2) — the Claude Code manifest's
//      `stages-implemented` array must equal the engine's TIER_STAGES.all
//      (the stages `clad check` actually runs, declared in
//      src/cli/clad.ts). Hand-maintained, it silently drifted (13 listed
//      vs 15 run) and shipped UNDETECTED because nothing guarded it; this
//      check closes that self-honesty blind spot. `npm run build:plugin`
//      re-derives the array from the same source, so the fix is "rebuild".
//
// Filesystem/source-text based rather than importing `allDetectors` or
// `TIER_STAGES`, on purpose: importing a sibling/higher layer (the
// registry, or the cli layer) would create a dependency the
// ARCHITECTURE_VIOLATION detector would immediately flag. So the stage
// list is parsed from the cli SOURCE TEXT, never imported.
//
// @see spec/features/F-080.yaml — this extension.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {globSync} from 'tinyglobby';

import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'HARNESS_INTEGRITY';

interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  ironclad?: {
    current?: {
      detectors?: string;
      'stages-implemented'?: readonly string[];
    };
  };
}

interface PackageJson {
  name?: string;
  version?: string;
}

/** Root `.claude-plugin/marketplace.json` — the catalog the Claude Code host reads. */
interface MarketplaceManifest {
  plugins?: ReadonlyArray<{name?: string; version?: string}>;
}

interface HostManifestSpec {
  /** Human-readable host label used in finding messages. */
  readonly host: string;
  /** Path to the manifest relative to cwd. */
  readonly path: string;
  /** Fields whose absence triggers a per-host schema error. */
  readonly required: readonly (keyof PluginManifest)[];
}

const HOSTS: readonly HostManifestSpec[] = [
  {host: 'claude-code', path: 'plugins/claude-code/.claude-plugin/plugin.json', required: ['name', 'version']},
  {
    host: 'codex',
    path: 'plugins/codex/.codex-plugin/plugin.json',
    required: ['name', 'version', 'description'],
  },
  {
    host: 'gemini-cli',
    path: 'plugins/gemini-cli/gemini-extension.json',
    required: ['name', 'version'],
  },
];

function countDetectorFiles(cwd: string): number {
  const files = globSync(['src/stages/detectors/*.ts'], {cwd, dot: false});
  // Exclude the registry (index.ts) and shared helpers (with-spec.ts):
  // they live alongside detectors but are not themselves detectors, so
  // they must not inflate the count compared against plugin.json.
  return files.filter((f) => !/[/\\](index|with-spec)\.ts$/.test(f)).length;
}

function readJsonIfPresent<T>(absolutePath: string): T | null {
  if (!existsSync(absolutePath)) return null;
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Detector count check — the original v0.2.4 invariant. */
function checkDetectorCount(cwd: string, findings: DriftFinding[]): void {
  const manifestPath = join(cwd, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json');
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
  } catch (err) {
    findings.push({
      detector: NAME,
      severity: 'info',
      message: `plugin.json not loaded: ${(err as Error).message}`,
    });
    return;
  }
  const declared = manifest.ironclad?.current?.detectors;
  if (!declared) return;
  const match = declared.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    findings.push({
      detector: NAME,
      severity: 'warn',
      message: `plugin.json current.detectors='${declared}' is not in 'N/M' form`,
    });
    return;
  }
  const numerator = Number(match[1]);
  const actual = countDetectorFiles(cwd);
  if (numerator !== actual) {
    findings.push({
      detector: NAME,
      severity: 'error',
      message:
        `plugin.json current.detectors='${declared}' but stages/detectors/` +
        `contains ${actual} non-index .ts file(s)`,
    });
  }
}

/** Per-host schema check — missing required fields. */
function checkHostSchemas(cwd: string, findings: DriftFinding[]): void {
  for (const spec of HOSTS) {
    const abs = join(cwd, spec.path);
    if (!existsSync(abs)) continue; // host manifest absent → not a violation
    const manifest = readJsonIfPresent<PluginManifest>(abs);
    if (!manifest) {
      findings.push({
        detector: NAME,
        severity: 'warn',
        message: `${spec.host}: ${spec.path} could not be parsed as JSON`,
      });
      continue;
    }
    for (const field of spec.required) {
      if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
        findings.push({
          detector: NAME,
          severity: 'error',
          message: `${spec.host}: ${spec.path} is missing required field '${String(field)}'`,
        });
      }
    }
  }
}

/** Cross-manifest version drift — package.json + every host manifest must agree. */
function checkVersionConsistency(cwd: string, findings: DriftFinding[]): void {
  const pkg = readJsonIfPresent<PackageJson>(join(cwd, 'package.json'));
  if (!pkg?.version) return; // no package.json → not a cladding repo
  const baseline = pkg.version;
  for (const spec of HOSTS) {
    const abs = join(cwd, spec.path);
    if (!existsSync(abs)) continue;
    const manifest = readJsonIfPresent<PluginManifest>(abs);
    if (!manifest?.version) continue; // schema check covers missing fields
    if (manifest.version !== baseline) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `${spec.host}: ${spec.path} version='${manifest.version}' ` +
          `but package.json version='${baseline}' — bump them in lockstep`,
      });
    }
  }
  // Marketplace catalog entry (root .claude-plugin/marketplace.json) — the
  // version the Claude Code host reads to decide "update available". It is a
  // version-bump SITE but lives outside HOSTS (nested under plugins[].version),
  // so it is checked here explicitly; otherwise it silently lags and the catalog
  // advertises a stale release (the 0.4.0-vs-0.5.0 drift that prompted this).
  const marketAbs = join(cwd, '.claude-plugin', 'marketplace.json');
  if (existsSync(marketAbs)) {
    const market = readJsonIfPresent<MarketplaceManifest>(marketAbs);
    for (const entry of market?.plugins ?? []) {
      if (!entry?.version) continue;
      if (entry.version !== baseline) {
        findings.push({
          detector: NAME,
          severity: 'error',
          message:
            `marketplace: .claude-plugin/marketplace.json plugin '${entry.name ?? '?'}' ` +
            `version='${entry.version}' but package.json version='${baseline}' — ` +
            `the catalog advertises a stale version; bump it in lockstep`,
        });
      }
    }
  }

  // NOTE: spec.yaml project.version is kept in lockstep by `npm run
  // version-bump` (it is now a managed SITE — see scripts/version-bump.mjs).
  // A *detector*-level spec.yaml-vs-package.json check is intentionally NOT
  // added here: a general adopting project may legitimately version its
  // spec.yaml independently of package.json, so an error would be a
  // false-fail. If surfaced at all it belongs at `warn` with adopter-aware
  // fixtures (Phase 2), not as a hard gate.
}

/**
 * Extracts the stage ids of `TIER_STAGES.all` from the cli source TEXT.
 * Source-text (not import) on purpose — same anti-circular reason
 * `countDetectorFiles` globs files instead of importing the registry: a
 * detector importing the cli layer would trip ARCHITECTURE_VIOLATION.
 * Anchored to `TIER_STAGES` so a stray `all:` elsewhere can't match.
 * Returns [] when the block is absent/unparseable (→ caller skips, no false-fail).
 */
function parseTierAllStages(cliSource: string): string[] {
  const m = cliSource.match(/TIER_STAGES[\s\S]*?\ball:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

/** Stage-list check — plugin.json stages-implemented must equal TIER_STAGES.all. */
function checkStageList(cwd: string, findings: DriftFinding[]): void {
  const cliPath = join(cwd, 'src', 'cli', 'clad.ts');
  const manifestPath = join(cwd, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json');
  // Only meaningful inside cladding's OWN repo; an adopting project has neither
  // file, so skip silently (checkDetectorCount already reports a missing manifest).
  if (!existsSync(cliPath) || !existsSync(manifestPath)) return;
  const canonical = parseTierAllStages(readFileSync(cliPath, 'utf8'));
  if (canonical.length === 0) return; // unparseable source → don't false-fail
  const manifest = readJsonIfPresent<PluginManifest>(manifestPath);
  // Lives under ironclad.current (alongside the detector count), not at top level.
  const declared = manifest?.ironclad?.current?.['stages-implemented'];
  if (!Array.isArray(declared)) return; // opt-in metadata; absent → silent
  const want = new Set(canonical);
  const have = new Set(declared);
  const missing = canonical.filter((s) => !have.has(s));
  const unexpected = declared.filter((s) => !want.has(s));
  if (missing.length === 0 && unexpected.length === 0) return;
  const parts = [
    missing.length ? `missing [${missing.join(', ')}]` : '',
    unexpected.length ? `unexpected [${unexpected.join(', ')}]` : '',
  ]
    .filter(Boolean)
    .join('; ');
  findings.push({
    detector: NAME,
    severity: 'error',
    message:
      `plugins/claude-code/.claude-plugin/plugin.json stages-implemented disagrees ` +
      `with TIER_STAGES.all (src/cli/clad.ts): ${parts} — run \`npm run build:plugin\` to re-derive`,
  });
}

function runHarnessIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const findings: DriftFinding[] = [];
  checkDetectorCount(cwd, findings);
  checkStageList(cwd, findings);
  checkHostSchemas(cwd, findings);
  checkVersionConsistency(cwd, findings);
  return findings;
}

export const harnessIntegrity: DriftDetector = {
  name: NAME,
  run: runHarnessIntegrity,
};
