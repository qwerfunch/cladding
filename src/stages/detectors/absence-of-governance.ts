// Cladding · drift detector · ABSENCE_OF_GOVERNANCE
//
// Detector #26 (axis: scaffold, severity: graduated). v0.3.49 / F-99c6e5.
//
// Problem this solves: the other 25 detectors silently pass on a tree
// that has no cladding scaffold — spec-gated detectors return zero
// findings because they have nothing to evaluate (see the A/B
// evaluation framework, F-4db939 / F-ba2e05, for the controlled
// measurement of this "absence of signal" trap).
//
// This detector explicitly flags missing SSoT artifacts so that
// "no spec.yaml, no architecture, no capabilities" becomes a real,
// actionable signal instead of a null result. Severity is graduated:
//
//   - **spec.yaml absent** → error (the SSoT root is missing; cladding
//     cannot operate at all in this tree)
//   - **spec/architecture.yaml absent** → warn (architecture invariants
//     not enforced)
//   - **spec/capabilities.yaml absent** → warn (no capability ↔ feature
//     traceability)
//   - **docs/project-context.md absent** → warn (no intent narrative)
//   - **docs/conventions.md absent** → info (style guide optional)
//   - **spec/scenarios/ absent or empty** → info (scenarios are
//     domain-specific and may legitimately be empty)
//
// The detector intentionally never throws — even a fully empty
// directory just emits findings. Pair with `clad init --intent ...`
// to populate the scaffold.

import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {parseSpec} from '../../spec/parse.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'ABSENCE_OF_GOVERNANCE';

interface ArtifactCheck {
  readonly path: string;
  readonly severity: DriftFinding['severity'];
  /** Human-readable role of the artifact in cladding's governance model. */
  readonly purpose: string;
  /** When true, the path is treated as a directory; emptiness counts as absent. */
  readonly isDirectory?: boolean;
}

const CHECKS: readonly ArtifactCheck[] = [
  {
    path: 'spec.yaml',
    severity: 'error',
    purpose: 'SSoT root — every spec-gated detector needs it',
  },
  {
    path: 'spec/architecture.yaml',
    severity: 'warn',
    purpose: 'architecture invariants (layers + forbidden_imports)',
  },
  {
    path: 'spec/capabilities.yaml',
    severity: 'warn',
    purpose: 'capability ↔ feature traceability',
  },
  {
    path: 'docs/project-context.md',
    severity: 'warn',
    purpose: 'intent narrative + decision history',
  },
  {
    path: 'docs/conventions.md',
    severity: 'info',
    purpose: 'project style guide (recommended)',
  },
  {
    path: 'spec/scenarios',
    severity: 'info',
    purpose: 'user-journey scenarios (recommended)',
    isDirectory: true,
  },
];

function isAbsent(cwd: string, check: ArtifactCheck): boolean {
  const abs = join(cwd, check.path);
  if (!existsSync(abs)) return true;
  if (check.isDirectory) {
    try {
      // Empty directory or directory containing only the README index
      // is treated as absent — scenarios with no shards provide no signal.
      const entries = readdirSync(abs).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
      return entries.length === 0;
    } catch {
      return true;
    }
  }
  return false;
}

function runAbsenceOfGovernance(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const findings: DriftFinding[] = [];
  for (const check of CHECKS) {
    if (!isAbsent(cwd, check)) continue;
    findings.push({
      detector: NAME,
      severity: check.severity,
      path: check.path,
      message:
        `${check.path} is absent — cladding scaffold incomplete` +
        ` (${check.purpose}). Run \`clad init --intent "<your goal>"\` to populate it.`,
    });
  }
  // A spec.yaml that is PRESENT but unreadable is as ungoverned as an absent
  // one: every spec-gated detector then returns info/[] and the gate would pass
  // GREEN on a broken SSoT root (the P1 failure — "cladding applied but governs
  // nothing"). Surface it as the single authoritative BLOCKING signal so the
  // spec-vs-reality detectors can honestly stay non-blocking info (see
  // detectors/with-spec.ts). Scoped to the MASTER not parsing into a usable
  // mapping (malformed YAML / empty / non-object) — deliberately NOT schema
  // validation, which would risk false-failing a mid-authoring spec; `clad sync`
  // owns schema checking.
  const specPath = join(cwd, 'spec.yaml');
  if (existsSync(specPath)) {
    const broken = masterParseFailure(specPath);
    if (broken) {
      findings.push({
        detector: NAME,
        severity: 'error',
        path: 'spec.yaml',
        message:
          `spec.yaml is present but unreadable (${broken}) — cladding is governing` +
          ' nothing. Fix the SSoT root, then `clad sync` to validate.',
      });
    }
  }
  return findings;
}

/**
 * Returns a reason string when `spec.yaml` exists but does not parse into a
 * usable YAML mapping, or null when the master parses. parseSpec throws on
 * malformed YAML and returns `undefined` on an empty file — both mean the SSoT
 * root cannot govern.
 */
function masterParseFailure(specPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = parseSpec(specPath);
  } catch (err) {
    return `unparseable: ${(err as Error).message}`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'empty or not a YAML mapping';
  }
  return null;
}

export const absenceOfGovernance: DriftDetector = {
  name: NAME,
  run: runAbsenceOfGovernance,
};
