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
  return findings;
}

export const absenceOfGovernance: DriftDetector = {
  name: NAME,
  run: runAbsenceOfGovernance,
};
