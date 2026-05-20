// Cladding · drift detector · ARCHITECTURE_FROM_SPEC (v0.3.13, F-088)
//
// Resurrects spec/architecture.yaml from dead code into a working
// invariant. Until v0.3.13 this file was type-loaded but no detector
// consumed it — the ARCHITECTURE_VIOLATION detector ran toolchain
// gates (madge / import-linter) instead, which is a different
// invariant.
//
// What this detector enforces, drawn from spec.architecture:
//
//   1. **Forbidden-import compliance (error)** — for each
//      `{from, to}` rule in `architecture.forbidden_imports`, no file
//      under `src/<from>/` may `import ... from '<...>/<to>/...'`.
//      Detected by regex-grepping import statements (no AST parser,
//      no toolchain dependency — keeps cladding's polyglot stance).
//
//   2. **Undeclared directory (warn)** — any directory directly
//      under `src/` that is not listed in any of `layers` rows.
//      Warns the maintainer that the spec.architecture is out of
//      sync with the on-disk layout (new dir added without updating
//      the spec).
//
//   3. **Empty layer (warn)** — any layer name listed in
//      `architecture.layers` that has no matching `src/<layer>/`
//      directory. Warns of a typo or a layer that was renamed in
//      code but not in spec.
//
// The detector is intentionally a **soft validator**: if
// `spec/architecture.yaml` is missing or empty, every check skips
// silently. Cladding-adopting projects opt in by writing the spec.
//
// @see spec/features/F-088.yaml — this feature.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

import {globSync} from 'tinyglobby';

import {loadSpec} from '../../spec/load.js';
import type {Architecture} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'ARCHITECTURE_FROM_SPEC';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let arch: Architecture | undefined;
  try {
    arch = loadSpec(cwd).architecture;
  } catch {
    return [];
  }
  if (!arch) return [];

  const findings: DriftFinding[] = [];
  const declaredLayers = collectLayers(arch);

  if (declaredLayers.size > 0) {
    checkUndeclaredDirectories(cwd, declaredLayers, findings);
    checkEmptyLayers(cwd, declaredLayers, findings);
  }
  if (arch.forbidden_imports && arch.forbidden_imports.length > 0) {
    checkForbiddenImports(cwd, arch.forbidden_imports, findings);
  }
  return findings;
}

/**
 * Flattens the nested `layers` shape (`string[][]`) into a single Set
 * of declared layer names. cladding's own spec uses the nested form
 * to express ordered tiers, but the detector treats every entry as a
 * peer for membership checks.
 */
function collectLayers(arch: Architecture): ReadonlySet<string> {
  const set = new Set<string>();
  for (const tier of arch.layers ?? []) {
    for (const name of tier) set.add(name);
  }
  return set;
}

/** src/ 의 1-depth 디렉토리 중 declaredLayers 에 없는 것 → warn */
function checkUndeclaredDirectories(
  cwd: string,
  declaredLayers: ReadonlySet<string>,
  findings: DriftFinding[],
): void {
  const srcPath = join(cwd, 'src');
  if (!existsSync(srcPath)) return;
  for (const entry of readdirSync(srcPath)) {
    const abs = join(srcPath, entry);
    if (!statSync(abs).isDirectory()) continue;
    if (declaredLayers.has(entry)) continue;
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: `src/${entry}/`,
      message: `src/${entry}/ is not declared in spec/architecture.yaml layers — add it or remove the directory`,
    });
  }
}

/** declaredLayers 중 src/<layer>/ 가 실제 없는 것 → warn */
function checkEmptyLayers(
  cwd: string,
  declaredLayers: ReadonlySet<string>,
  findings: DriftFinding[],
): void {
  const srcPath = join(cwd, 'src');
  if (!existsSync(srcPath)) return;
  for (const layer of declaredLayers) {
    const layerPath = join(srcPath, layer);
    if (existsSync(layerPath) && statSync(layerPath).isDirectory()) continue;
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: `src/${layer}/`,
      message: `spec/architecture.yaml declares layer '${layer}' but src/${layer}/ does not exist — fix the spec or create the directory`,
    });
  }
}

// import statement matcher — captures the from-string for both
// `import X from '...'` and `import('...')` forms.
const IMPORT_RE = /(?:import\s+(?:[\s\S]*?\sfrom\s+)?|import\s*\()['"]([^'"]+)['"]\)?/g;

/**
 * src/<from-layer>/**.ts 의 모든 import 가 src/<to-layer>/* 를
 * reference 하면 error. Relative path 의 layer segment 매칭으로 충분.
 */
function checkForbiddenImports(
  cwd: string,
  rules: readonly {from: string; to: string}[],
  findings: DriftFinding[],
): void {
  for (const rule of rules) {
    const fromDir = join(cwd, 'src', rule.from);
    if (!existsSync(fromDir)) continue;
    const files = globSync(['**/*.ts'], {cwd: fromDir, dot: false});
    for (const rel of files) {
      const abs = join(fromDir, rel);
      let body: string;
      try {
        body = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      let match: RegExpExecArray | null;
      IMPORT_RE.lastIndex = 0;
      while ((match = IMPORT_RE.exec(body)) !== null) {
        const importPath = match[1];
        if (!importsLayer(importPath, rule.to)) continue;
        findings.push({
          detector: NAME,
          severity: 'error',
          path: `src/${rule.from}/${rel}`,
          message:
            `src/${rule.from}/${rel} imports from '${importPath}' which crosses into the '${rule.to}' layer — ` +
            `spec/architecture.yaml forbids imports from '${rule.from}' to '${rule.to}'`,
        });
      }
    }
  }
}

/**
 * Returns true when the relative import path resolves to a file
 * under `<layer>/`. Looks at the *path segments* of the relative
 * specifier, which is enough because cladding uses kebab-case
 * single-segment layer names that round-trip through `/`.
 *
 * External-package imports (no leading `.`) are excluded — they
 * never live under src/ and can never trigger a layer rule.
 */
function importsLayer(importPath: string, layer: string): boolean {
  if (!importPath.startsWith('.')) return false;
  const segments = importPath.split('/');
  return segments.includes(layer);
}

export const architectureFromSpec: DriftDetector = {name: NAME, run};
