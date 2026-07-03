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
import type {Architecture, ArchitectureLayerObject} from '../../spec/types.js';
import {resolveLanguageConfig} from '../toolchain/language-config.js';
import type {LanguageConfig} from '../toolchain/language-config.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'ARCHITECTURE_FROM_SPEC';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let arch: Architecture | undefined;
  let language: string | undefined;
  try {
    const spec = loadSpec(cwd);
    arch = spec.architecture;
    language = spec.project?.language;
  } catch {
    // Load-failure policy (see detectors/with-spec.ts): within-spec-validity
    // detector — no spec means no architecture to enforce; ABSENCE_OF_GOVERNANCE
    // + the info-emitting spec-vs-reality detectors surface the failure.
    return [];
  }
  if (!arch) return [];

  // Source root, file extension, and import syntax all flex by language so a
  // Kotlin project's layers under src/main/kotlin are inspected, not skipped.
  const cfg = resolveLanguageConfig(cwd, language);
  const findings: DriftFinding[] = [];
  const {layers, forbiddenImports} = normalizeArchitecture(arch);

  // Visible skip (F-803386ab): when the spec declares layer rules but the
  // language's mainRoot directory does not exist (e.g. a flat-layout Python
  // repo with packages at the repo root), every check below would anchor on
  // the missing <mainRoot>/ and silently no-op — leaving the user believing
  // the rules are enforced. Say so instead, once, at info severity.
  if ((layers.size > 0 || forbiddenImports.length > 0) && !existsSync(join(cwd, cfg.mainRoot))) {
    return [
      {
        detector: NAME,
        severity: 'info',
        path: `${cfg.mainRoot}/`,
        message: `architecture layers declared but ${cfg.mainRoot}/ not found — layer checks skipped (flat layout not yet supported)`,
      },
    ];
  }

  if (layers.size > 0) {
    checkUndeclaredDirectories(cwd, cfg, layers, findings);
    checkEmptyLayers(cwd, cfg, layers, findings);
  }
  if (forbiddenImports.length > 0) {
    checkForbiddenImports(cwd, cfg, forbiddenImports, findings);
  }
  return findings;
}

/**
 * Normalizes both architecture schemas into a uniform shape the detector
 * can consume. Handles:
 *
 *   1. **Canonical**: `layers: string[][]` + top-level `forbidden_imports: {from,to}[]`
 *      (cladding's own spec/architecture.yaml uses this form).
 *
 *   2. **Object form**: `layers: {name, modules, forbidden_imports[]}[]`
 *      (LLM onboarding emits this — each layer carries its own forbid list,
 *      meaning "this layer must not import from any of these layers").
 *
 * Both forms are valid since v0.3.49 (F-99c6e5). Mixed input is also tolerated:
 * if `layers` contains both tier arrays and layer objects, each is interpreted
 * by its runtime shape. Top-level `forbidden_imports` augments any object-form
 * rules derived from per-layer entries.
 */
export function normalizeArchitecture(arch: Architecture): {
  readonly layers: ReadonlySet<string>;
  readonly forbiddenImports: readonly {readonly from: string; readonly to: string}[];
} {
  const layers = new Set<string>();
  const fromObjectForm: {from: string; to: string}[] = [];

  for (const tier of arch.layers ?? []) {
    if (Array.isArray(tier)) {
      // Canonical: tier is a peer group of layer names.
      for (const name of tier) layers.add(name);
    } else {
      // Object form: single layer with its own forbid list.
      const layer = tier as ArchitectureLayerObject;
      if (typeof layer.name === 'string' && layer.name.length > 0) {
        layers.add(layer.name);
        for (const forbid of layer.forbidden_imports ?? []) {
          if (typeof forbid === 'string') fromObjectForm.push({from: layer.name, to: forbid});
        }
      }
    }
  }

  const canonicalRules = arch.forbidden_imports ?? [];
  return {
    layers,
    forbiddenImports: [...canonicalRules, ...fromObjectForm],
  };
}

/** <mainRoot>/ 의 1-depth 디렉토리 중 declaredLayers 에 없는 것 → warn */
function checkUndeclaredDirectories(
  cwd: string,
  cfg: LanguageConfig,
  declaredLayers: ReadonlySet<string>,
  findings: DriftFinding[],
): void {
  const root = cfg.mainRoot;
  const srcPath = join(cwd, root);
  if (!existsSync(srcPath)) return;
  for (const entry of readdirSync(srcPath)) {
    const abs = join(srcPath, entry);
    if (!statSync(abs).isDirectory()) continue;
    if (declaredLayers.has(entry)) continue;
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: `${root}/${entry}/`,
      message: `${root}/${entry}/ is not declared in spec/architecture.yaml layers — add it or remove the directory`,
    });
  }
}

/** declaredLayers 중 <mainRoot>/<layer>/ 가 실제 없는 것 → warn */
function checkEmptyLayers(
  cwd: string,
  cfg: LanguageConfig,
  declaredLayers: ReadonlySet<string>,
  findings: DriftFinding[],
): void {
  const root = cfg.mainRoot;
  const srcPath = join(cwd, root);
  if (!existsSync(srcPath)) return;
  for (const layer of declaredLayers) {
    const layerPath = join(srcPath, layer);
    if (existsSync(layerPath) && statSync(layerPath).isDirectory()) continue;
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: `${root}/${layer}/`,
      message: `spec/architecture.yaml declares layer '${layer}' but ${root}/${layer}/ does not exist — fix the spec or create the directory`,
    });
  }
}

/**
 * <mainRoot>/<from-layer>/**.<ext> 의 모든 import 가 <to-layer> 를
 * reference 하면 error. Import 매칭은 language-config 가 결정 — TS 는
 * relative path segment, JVM(Kotlin) 은 dotted package segment.
 */
function checkForbiddenImports(
  cwd: string,
  cfg: LanguageConfig,
  rules: readonly {from: string; to: string}[],
  findings: DriftFinding[],
): void {
  const root = cfg.mainRoot;
  const importRe = cfg.importMatcher;
  for (const rule of rules) {
    const fromDir = join(cwd, root, rule.from);
    if (!existsSync(fromDir)) continue;
    const files = globSync([`**/*.${cfg.ext}`], {cwd: fromDir, dot: false});
    for (const rel of files) {
      const abs = join(fromDir, rel);
      let body: string;
      try {
        body = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      let match: RegExpExecArray | null;
      importRe.lastIndex = 0;
      while ((match = importRe.exec(body)) !== null) {
        const importPath = match[1];
        if (!importsLayer(importPath, rule.to, cfg.importStyle)) continue;
        findings.push({
          detector: NAME,
          severity: 'error',
          path: `${root}/${rule.from}/${rel}`,
          message:
            `${root}/${rule.from}/${rel} imports from '${importPath}' which crosses into the '${rule.to}' layer — ` +
            `spec/architecture.yaml forbids imports from '${rule.from}' to '${rule.to}'`,
        });
      }
    }
  }
}

/**
 * Returns true when an import specifier reaches into `<layer>/`.
 *
 * - `relative` (TS/ES): only `./…` paths are considered (external-package
 *   imports never live under src/). Layer match = a `/`-segment equals the
 *   layer. Cladding uses kebab-case single-segment layer names that
 *   round-trip through `/`.
 * - `dotted` (JVM/Kotlin): `import a.b.C` has no leading-dot signal, so the
 *   package's `.`-segments are matched directly. A segment equal to the
 *   layer name means the import crosses into that layer.
 */
function importsLayer(
  importPath: string,
  layer: string,
  style: LanguageConfig['importStyle'],
): boolean {
  if (style === 'dotted') {
    return importPath.split('.').includes(layer);
  }
  if (!importPath.startsWith('.')) return false;
  const segments = importPath.split('/');
  return segments.includes(layer);
}

export const architectureFromSpec: DriftDetector = {name: NAME, run};
