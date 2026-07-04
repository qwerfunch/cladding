// Cladding · scenarios · ab · drift injection (v0.3.47, F-ba2e05)
//
// Outcome-quality dimension #1 — deterministic drift events injected
// into both A (cladding-managed) and B (vanilla) tmpdirs at M2+. For
// each scenario we run the 25-detector suite BEFORE injection, apply
// the drift, run the suite AGAIN, then diff: any finding that emerged
// counts as "cladding caught it." Vanilla typically catches only the
// universal HARDCODED_SECRET; the rest are cladding-exclusive wins.
//
// Scenarios are deliberate, plausible drift events — not synthetic
// edge cases. DI-1 (file rename) and DI-2 (architecture violation)
// are the two most common refactoring sins; DI-3 (hardcoded secret)
// is a baseline both groups should catch; DI-4 (untested AC) is
// cladding-only by construction since vanilla has no ACs.

import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {allDetectors} from '../../../src/stages/detectors/index.js';
import type {DriftFinding} from '../../../src/stages/types.js';

// ──────────────────────────────────────────────────────────────────
// Mature-cladding-user setup
//
// The case tests at M2 call `claddingifyForDriftCatch(cwd, ...)` to
// upgrade the freshly-onboarded tmpdir to the canonical-architecture
// shape that mature cladding adopters would reach. spec.yaml's
// `features:` block is normalised to `features: []` (defensive — the
// v0.4.0 seed already emits this; left as a no-op on fresh inits, still
// useful for tmpdirs onboarded by older cladding versions). Architecture
// is rewritten in the canonical schema (string[][] layers + {from,to}[]
// forbidden_imports) that `ARCHITECTURE_FROM_SPEC` expects.
//
// The architecture rewrite remains a cladding-internal bug the framework
// surfaces honestly (LLM-emitted onboarding artifacts use a different
// schema than the spec validator + detector expect). The case tests work
// around it so the H6 measurement reflects post-cleanup steady state.
// ──────────────────────────────────────────────────────────────────

export interface CanonicalArchitecture {
  /** Tiered list of layer names — flattens to a Set via collectLayers in the detector. */
  readonly layers: readonly (readonly string[])[];
  /** Explicit pairs that must not import each other. */
  readonly forbiddenImports: readonly {readonly from: string; readonly to: string}[];
}

export function claddingifyForDriftCatch(cwd: string, arch: CanonicalArchitecture): void {
  // (1) Normalise spec.yaml's `features:` block to `features: []`. The
  //     v0.4.0 seed already emits this — this is a defensive no-op on
  //     fresh inits and a safe truncate-and-rewrite on tmpdirs onboarded
  //     by older cladding versions.
  const specPath = join(cwd, 'spec.yaml');
  if (existsSync(specPath)) {
    const body = readFileSync(specPath, 'utf8');
    const cleared = body.replace(/features:[\s\S]*$/, 'features: []\n');
    writeFileSync(specPath, cleared);
  }
  // (2) Rewrite spec/architecture.yaml in canonical schema —
  //     string[][] layers + {from,to}[] forbidden_imports. Cladding's
  //     own spec/architecture.yaml uses this shape.
  const archPath = join(cwd, 'spec/architecture.yaml');
  if (existsSync(archPath)) {
    const lines: string[] = [
      '# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify',
      '# Canonicalized for ARCHITECTURE_FROM_SPEC detector compatibility.',
      'layers:',
    ];
    for (const tier of arch.layers) {
      if (tier.length === 0) continue;
      lines.push(`  - - ${tier[0]}`);
      for (const item of tier.slice(1)) {
        lines.push(`    - ${item}`);
      }
    }
    lines.push('forbidden_imports:');
    for (const {from, to} of arch.forbiddenImports) {
      lines.push(`  - from: ${from}`);
      lines.push(`    to: ${to}`);
    }
    lines.push('');
    writeFileSync(archPath, lines.join('\n'));
  }
}

/** Toolchain detectors we always exclude — cladding-self gates that don't apply to a tmpdir fixture. */
const ALLOWLIST_DETECTORS = new Set(['META_INTEGRITY', 'HARDCODED_SECRET_TOOLCHAIN']);

// HARDCODED_SECRET (without _TOOLCHAIN suffix) is the actual detector —
// we DO want to include it in DI-3's measurement since that's the
// baseline we expect both to catch. Only META_INTEGRITY is filtered
// out as a noise-baseline.
const PASSTHROUGH_DETECTORS = new Set(['META_INTEGRITY']);

export interface StructuredFinding {
  readonly detector: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
  readonly path?: string;
}

function fingerprint(f: StructuredFinding): string {
  return `${f.detector}|${f.severity}|${f.path ?? ''}|${f.message}`;
}

/** Runs all 25 detectors and returns their findings as a flat list. */
export function snapshotFindings(cwd: string): readonly StructuredFinding[] {
  const out: StructuredFinding[] = [];
  for (const det of allDetectors) {
    if (PASSTHROUGH_DETECTORS.has(det.name)) continue;
    let findings: readonly DriftFinding[];
    try {
      findings = det.run({cwd});
    } catch {
      continue;
    }
    for (const f of findings) {
      out.push({
        detector: det.name,
        severity: f.severity,
        message: f.message,
        path: f.path,
      });
    }
  }
  return out;
}

export interface DriftCatchResult {
  readonly scenarioId: 'DI-1' | 'DI-2' | 'DI-3' | 'DI-4';
  readonly scenarioName: string;
  readonly group: 'A' | 'B';
  readonly beforeCounts: {readonly errors: number; readonly warns: number; readonly infos: number};
  readonly afterCounts: {readonly errors: number; readonly warns: number; readonly infos: number};
  readonly newFindings: readonly StructuredFinding[];
  /** True when at least one new error/warn-level finding emerged. */
  readonly caught: boolean;
  /** Truncated detector names that fired new findings (for the report). */
  readonly newDetectors: readonly string[];
}

export interface DriftScenario {
  readonly id: DriftCatchResult['scenarioId'];
  readonly name: string;
  /** Mutates the tmpdir. Should be idempotent or only called once per tmpdir. */
  readonly apply: (cwd: string) => void;
}

/** Runs detectors, applies the drift, runs detectors again, returns the diff. */
export function captureDriftCatch(
  cwd: string,
  group: 'A' | 'B',
  scenario: DriftScenario,
): DriftCatchResult {
  const before = snapshotFindings(cwd);
  scenario.apply(cwd);
  const after = snapshotFindings(cwd);

  const beforeFp = new Set(before.map(fingerprint));
  const newFindings = after.filter((f) => !beforeFp.has(fingerprint(f)));

  const newActionable = newFindings.filter((f) => f.severity === 'error' || f.severity === 'warn');
  const newDetectors = [...new Set(newFindings.filter((f) => !ALLOWLIST_DETECTORS.has(f.detector)).map((f) => f.detector))];

  const count = (arr: readonly StructuredFinding[], sev: StructuredFinding['severity']) =>
    arr.filter((f) => f.severity === sev && !ALLOWLIST_DETECTORS.has(f.detector)).length;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    group,
    beforeCounts: {
      errors: count(before, 'error'),
      warns: count(before, 'warn'),
      infos: count(before, 'info'),
    },
    afterCounts: {
      errors: count(after, 'error'),
      warns: count(after, 'warn'),
      infos: count(after, 'info'),
    },
    newFindings: newFindings.filter((f) => !ALLOWLIST_DETECTORS.has(f.detector)),
    caught: newActionable.length > 0,
    newDetectors,
  };
}

// ──────────────────────────────────────────────────────────────────
// DI-1 — Stale module reference (rename file without updating spec)
//
// The most common refactoring sin: rename a source file but forget to
// update the spec/features/*.yaml `modules:` list pointing to it.
// Cladding's MISSING_IMPLEMENTATION detector catches this immediately;
// vanilla has no spec to check against → silent.
// ──────────────────────────────────────────────────────────────────

export function makeStaleReferenceDrift(fromRel: string, toRel: string): DriftScenario {
  return {
    id: 'DI-1',
    name: `Stale module reference (rename ${fromRel} → ${toRel} without spec update)`,
    apply: (cwd: string) => {
      const fromAbs = join(cwd, fromRel);
      const toAbs = join(cwd, toRel);
      if (existsSync(fromAbs)) renameSync(fromAbs, toAbs);
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// DI-2 — Architecture violation (add forbidden import)
//
// Add an import statement that violates an architecture layer rule.
// Cladding's ARCHITECTURE_FROM_SPEC catches this (if architecture.yaml
// declares forbidden_imports); vanilla has no rule → silent.
//
// We append the import line to the top of an existing file (after
// any banner comments). If the file doesn't exist we create a stub.
// ──────────────────────────────────────────────────────────────────

export function makeArchitectureViolationDrift(
  fileRel: string,
  forbiddenImport: string,
): DriftScenario {
  return {
    id: 'DI-2',
    name: `Architecture violation (${fileRel} imports ${forbiddenImport})`,
    apply: (cwd: string) => {
      const abs = join(cwd, fileRel);
      const importLine = `import {forbidden} from "${forbiddenImport}";\n`;
      if (!existsSync(abs)) {
        writeFileSync(abs, `// drift-injected stub\n${importLine}export const noop = () => undefined;\n`);
        return;
      }
      const body = readFileSync(abs, 'utf8');
      // Insert after the first run of comment lines so we don't break
      // module-system inference.
      const lines = body.split('\n');
      let insertAt = 0;
      while (insertAt < lines.length && (lines[insertAt].startsWith('//') || lines[insertAt].trim() === '')) {
        insertAt++;
      }
      lines.splice(insertAt, 0, importLine.trimEnd());
      writeFileSync(abs, lines.join('\n'));
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// DI-3 — Hardcoded secret (baseline — both groups should catch)
//
// Sanity baseline: an obvious secret string. Cladding's
// HARDCODED_SECRET detector is spec-independent (toolchain-only); it
// fires on both A and B. This honestly demonstrates that not every
// drift is cladding-exclusive — some bugs the universal toolchain
// catches regardless of governance.
// ──────────────────────────────────────────────────────────────────

const SECRET_LITERAL = '"sk_live_drift_test_REPLACE_ME_xx0123456789abcdefghij"';

export function makeHardcodedSecretDrift(fileRel: string): DriftScenario {
  return {
    id: 'DI-3',
    name: `Hardcoded secret (add API key constant to ${fileRel})`,
    apply: (cwd: string) => {
      const abs = join(cwd, fileRel);
      const driftLine = `\nconst LEAKED_API_KEY = ${SECRET_LITERAL};\nexport {LEAKED_API_KEY};\n`;
      if (!existsSync(abs)) {
        writeFileSync(abs, `// drift-injected\n${driftLine}`);
        return;
      }
      const body = readFileSync(abs, 'utf8');
      writeFileSync(abs, `${body}${driftLine}`);
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// DI-4 — Untested AC (cladding-exclusive by construction)
//
// Add a new acceptance criterion to a feature shard WITHOUT adding a
// corresponding test. Cladding's UNTESTED_AC catches this (when ACs
// are present); vanilla has no AC concept → can't catch.
//
// For Group B this scenario is N/A — vanilla has no spec/features/*.yaml
// to add the AC to. The case test should not apply DI-4 to B's tmpdir;
// the report renders N/A in that row.
// ──────────────────────────────────────────────────────────────────

export function makeUntestedAcDrift(featureShardRel: string, acId: string, acText: string): DriftScenario {
  return {
    id: 'DI-4',
    name: `Untested AC (add ${acId} to ${featureShardRel} without test)`,
    apply: (cwd: string) => {
      const abs = join(cwd, featureShardRel);
      if (!existsSync(abs)) return; // N/A for vanilla — silent no-op
      const body = readFileSync(abs, 'utf8');
      const newAc = [
        `  - id: ${acId}`,
        '    ears: ubiquitous',
        `    text: "${acText}"`,
        '',
      ].join('\n');
      writeFileSync(abs, body.trimEnd() + '\n' + newAc);
    },
  };
}
