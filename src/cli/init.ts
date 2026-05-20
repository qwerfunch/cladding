// Cladding · `clad init` — workspace scaffolder
//
// One command, three side-effects on a fresh directory:
//   1. spec.yaml seed with one placeholder feature (F-001)
//   2. .cladding/ runtime dir (audit + events log live here)
//   3. .gitignore append (.cladding/ entry; appended only if missing)
//
// Idempotent by default — re-running on an initialised workspace is a
// no-op except for reporting. `--force` overwrites the seed spec.yaml
// (other artifacts stay safe). Language is auto-detected from the
// manifest chain (package.json / pyproject.toml / Cargo.toml / …);
// `unknown` falls back to typescript so the seed is always valid.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';

import {deterministicInterpret, scanRoot, type InterpretedScan} from './scan/index.js';
import {detectToolchain} from '../stages/toolchain/detect.js';

export interface InitOptions {
  readonly cwd?: string;
  readonly projectName?: string;
  readonly force?: boolean;
  /** Walks the existing codebase and writes docs/conventions.md + spec/architecture.yaml + scenario stubs. */
  readonly scan?: boolean;
  /** Forces the deterministic-only fallback even when an LLM dispatcher is available. */
  readonly noLlm?: boolean;
  /** Source-root override for the scanner, e.g. ["packages/a/src", "packages/b/src"]. */
  readonly roots?: readonly string[];
}

export interface InitResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
  readonly language: string;
  /** Files diverted to `.cladding/scan/*.proposal.*` because an authored copy already existed. */
  readonly proposals?: readonly string[];
}

function specSeed(projectName: string, language: string): string {
  return [
    `# ${projectName} — Cladding spec`,
    '# This file is your project SSoT. Edit features here, run `clad sync`',
    '# to validate, and `clad check` to exercise every Iron Law stage.',
    '# See https://github.com/qwerfunch/ironclad for the standard.',
    '',
    'schema: "0.1"',
    '',
    'project:',
    `  name: ${projectName}`,
    `  language: ${language}`,
    '',
    'features:',
    '  - id: F-001',
    '    title: "Your first feature"',
    '    status: planned',
    '    modules: []',
    '    acceptance_criteria:',
    '      - id: AC-001',
    '        ears: ubiquitous',
    '        text: "Replace this with what F-001 actually shall do."',
    '',
  ].join('\n');
}

function appendIfMissing(gitignorePath: string, marker: string, line: string): boolean {
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (existing.includes(marker)) return false;
  const ensureNewline = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, `${existing}${ensureNewline}\n# Cladding runtime state\n${line}\n`);
  return true;
}

/**
 * Scaffolds a cladding workspace at `cwd`. Idempotent; safe by default.
 *
 * @returns The list of created and skipped artifacts plus the detected language.
 */
export function runInit(opts: InitOptions = {}): InitResult {
  const cwd = opts.cwd ?? '.';
  const force = opts.force ?? false;
  const created: string[] = [];
  const skipped: string[] = [];

  // I13 (v0.3.27) — `detectToolchain` reads manifests (package.json
  // wins first), which mis-identifies polyglot repos that ship a
  // package.json for tooling but are written in Python / Go / Ruby /
  // Swift. When `--scan` runs we also know the file-extension
  // majority; prefer that signal over the manifest guess.
  const detected = detectToolchain(cwd).language;
  const manifestLanguage = detected === 'unknown' ? 'typescript' : detected;
  const scanResult = opts.scan ? scanRoot({cwd, roots: opts.roots}) : null;
  const language =
    scanResult && scanResult.stats.dominantLanguage !== 'unknown' && scanResult.stats.dominantLanguage !== 'other'
      ? scanResult.stats.dominantLanguage
      : manifestLanguage;
  const projectName = opts.projectName ?? basename(resolve(cwd));

  // 1. spec.yaml
  const specPath = join(cwd, 'spec.yaml');
  if (existsSync(specPath) && !force) {
    skipped.push('spec.yaml (exists; pass --force to overwrite)');
  } else {
    writeFileSync(specPath, specSeed(projectName, language));
    created.push('spec.yaml');
  }

  // 2. .cladding/ runtime dir
  const claddingDir = join(cwd, '.cladding');
  if (existsSync(claddingDir)) {
    skipped.push('.cladding/ (exists)');
  } else {
    mkdirSync(claddingDir, {recursive: true});
    created.push('.cladding/');
  }

  // 3. .gitignore append
  const gitignorePath = join(cwd, '.gitignore');
  const appended = appendIfMissing(gitignorePath, '.cladding/', '.cladding/');
  if (appended) {
    created.push('.gitignore (.cladding/ entry appended)');
  } else {
    skipped.push('.gitignore (.cladding/ entry already present)');
  }

  const proposals: string[] = [];

  // Phase 2 (v0.3.24, F-x) — Existing-project scan. When `--scan` is
  // set we walk `cwd` for code conventions, layers, and representative
  // modules, then write three artifacts (or divert them to
  // `.cladding/scan/*.proposal.*` if the authored copies already
  // exist). The v0.3.24 path uses the deterministic interpreter; the
  // LLM dispatcher injection lands in v0.3.25 so the scan-llm.ts
  // contract is in place but not yet routed to MCP sampling.
  if (opts.scan && scanResult) {
    const interp: InterpretedScan = deterministicInterpret(scanResult);
    const scan = scanResult;

    writeArtifact(
      cwd,
      'docs/conventions.md',
      interp.conventionsMd,
      created,
      proposals,
    );
    writeArtifact(
      cwd,
      'spec/architecture.yaml',
      interp.architectureYaml,
      created,
      proposals,
    );
    for (const s of scan.scenarios) {
      const flow = interp.scenarioFlows.get(s.slug) ?? `Flow through ${s.dir}/.`;
      const body =
        `id: S-${s.slug}\n` +
        `slug: ${s.slug}\n` +
        `title: "${s.slug} scenario"\n` +
        `flow: |\n  ${flow}\n` +
        'features: []\n';
      writeArtifact(cwd, `spec/scenarios/${s.slug}.yaml`, body, created, proposals);
    }
  }

  return {created, skipped, language, proposals: proposals.length ? proposals : undefined};
}

/**
 * Writes `relPath` under `cwd`. When the target already exists the
 * payload is diverted to `.cladding/scan/<basename>.proposal.<ext>`
 * instead of overwriting authored content. Either way the resulting
 * path lands in `created` or `proposals` so the CLI handler can
 * report it.
 */
function writeArtifact(
  cwd: string,
  relPath: string,
  body: string,
  created: string[],
  proposals: string[],
): void {
  const target = join(cwd, relPath);
  if (existsSync(target)) {
    const proposal = join(cwd, '.cladding', 'scan', `${basename(relPath)}.proposal`);
    mkdirSync(dirname(proposal), {recursive: true});
    writeFileSync(proposal, body);
    proposals.push(`${relPath} → ${relPath.startsWith('docs/') || relPath.startsWith('spec/') ? '.cladding/scan/' : ''}${basename(relPath)}.proposal`);
    return;
  }
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, body);
  created.push(relPath);
}
