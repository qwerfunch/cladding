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
import {basename, join, resolve} from 'node:path';

import {detectToolchain} from '../stages/toolchain/detect.js';

export interface InitOptions {
  readonly cwd?: string;
  readonly projectName?: string;
  readonly force?: boolean;
}

export interface InitResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
  readonly language: string;
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

  const detected = detectToolchain(cwd).language;
  const language = detected === 'unknown' ? 'typescript' : detected;
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

  return {created, skipped, language};
}
