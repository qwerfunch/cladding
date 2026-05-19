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
//      plugin.json`, and `plugins/gemini-cli/gemini-extension.json`
//      must all carry the same `version` string. Any pair in
//      disagreement trips an error finding so a release can't ship
//      with a half-bumped manifest set.
//
// Filesystem-based rather than importing `allDetectors`, on purpose:
// importing the registry would create a circular dependency the
// ARCHITECTURE_VIOLATION detector would immediately flag.
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
    };
  };
}

interface PackageJson {
  name?: string;
  version?: string;
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
  {host: 'claude-code', path: '.claude-plugin/plugin.json', required: ['name', 'version']},
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
  return files.filter((f) => !f.endsWith('/index.ts') && !f.endsWith('\\index.ts')).length;
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
  const manifestPath = join(cwd, '.claude-plugin', 'plugin.json');
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
}

function runHarnessIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const findings: DriftFinding[] = [];
  checkDetectorCount(cwd, findings);
  checkHostSchemas(cwd, findings);
  checkVersionConsistency(cwd, findings);
  return findings;
}

export const harnessIntegrity: DriftDetector = {
  name: NAME,
  run: runHarnessIntegrity,
};
