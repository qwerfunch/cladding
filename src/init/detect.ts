// F-90d054 — deterministic project context detection for the enrichment marker.
//
// Walks the target directory to classify it as greenfield/brownfield and to
// collect facts the host AI uses as ground truth when filling the enrichment
// scope. Synchronous, fast, no network, no LLM.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface DetectedContext {
  readonly project_type: 'greenfield' | 'brownfield';
  readonly source_files: number;
  readonly test_files: number;
  readonly primary_language: string;
  readonly package_manager:
    | 'npm'
    | 'pnpm'
    | 'yarn'
    | 'bun'
    | 'cargo'
    | 'poetry'
    | 'pip'
    | 'go'
    | 'unknown';
  readonly has_readme: boolean;
  readonly has_existing_tests: boolean;
  readonly observed_layers: readonly string[];
  readonly detected_at: string;
}

const BROWNFIELD_FILE_THRESHOLD = 3;
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.rb',
  '.cs',
  '.php',
  '.swift',
]);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cladding',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.cache',
  '.turbo',
]);

function looksLikeTest(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/') ||
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.endsWith('_test.go') ||
    lower.endsWith('_test.py')
  );
}

interface Scan {
  source: number;
  tests: number;
  layers: Set<string>;
  languages: Map<string, number>;
}

function walk(root: string, current: string, scan: Scan, depth = 0): void {
  if (depth > 12) return;
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.') && name !== '.cladding') {
      // hidden dirs other than `.cladding` are off-limits anyway
      continue;
    }
    if (SKIP_DIRS.has(name)) continue;
    const full = join(current, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(root, full, scan, depth + 1);
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      const rel = relative(root, full);
      if (looksLikeTest(rel)) {
        scan.tests += 1;
      } else {
        scan.source += 1;
      }
      scan.languages.set(ext, (scan.languages.get(ext) ?? 0) + 1);
      // Top two path segments form an "observed layer" (e.g. src/api).
      const parts = rel.split('/');
      if (parts.length >= 2) {
        scan.layers.add(`${parts[0]}/${parts[1]}`);
      } else if (parts.length === 1) {
        scan.layers.add(parts[0]);
      }
    }
  }
}

function primaryLanguageOf(languages: Map<string, number>): string {
  if (languages.size === 0) return 'unknown';
  let best: [string, number] = ['unknown', -1];
  for (const [ext, count] of languages) {
    if (count > best[1]) best = [ext, count];
  }
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.rb': 'ruby',
    '.cs': 'csharp',
    '.php': 'php',
    '.swift': 'swift',
  };
  return map[best[0]] ?? 'unknown';
}

function detectPackageManager(cwd: string): DetectedContext['package_manager'] {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo';
  if (existsSync(join(cwd, 'pyproject.toml'))) return 'poetry';
  if (existsSync(join(cwd, 'requirements.txt'))) return 'pip';
  if (existsSync(join(cwd, 'go.mod'))) return 'go';
  if (existsSync(join(cwd, 'package.json'))) return 'npm';
  return 'unknown';
}

function readmeExists(cwd: string): boolean {
  for (const name of ['README.md', 'README.rst', 'README.txt', 'readme.md']) {
    if (existsSync(join(cwd, name))) return true;
  }
  return false;
}

export function detectContext(cwd: string): DetectedContext {
  const scan: Scan = {
    source: 0,
    tests: 0,
    layers: new Set(),
    languages: new Map(),
  };
  walk(cwd, cwd, scan);
  const project_type: DetectedContext['project_type'] =
    scan.source >= BROWNFIELD_FILE_THRESHOLD ? 'brownfield' : 'greenfield';
  const layers = [...scan.layers].sort().slice(0, 10);
  return {
    project_type,
    source_files: scan.source,
    test_files: scan.tests,
    primary_language: primaryLanguageOf(scan.languages),
    package_manager: detectPackageManager(cwd),
    has_readme: readmeExists(cwd),
    has_existing_tests: scan.tests > 0,
    observed_layers: layers,
    detected_at: new Date().toISOString(),
  };
}
