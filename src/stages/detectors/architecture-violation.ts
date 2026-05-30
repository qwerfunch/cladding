// Cladding · drift detector · ARCHITECTURE_VIOLATION
//
// Detector #5 from the 19-detector catalog (axis: spec_vs_code,
// severity: error). Delegates to `toolchain.gates.arch`. For TypeScript
// projects that is `madge --circular`; for Python `lint-imports`
// (import-linter). Languages whose compilers already enforce acyclic
// imports (rust, go, java) do not register an arch gate — the detector
// emits a single `info` finding for them.

import {execaSync} from 'execa';

import {detectToolchain} from '../toolchain/detect.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {isMissingBinary} from '../util.js';

const NAME = 'ARCHITECTURE_VIOLATION';

/**
 * Runs the toolchain's architecture validator and converts its result.
 *
 * Exit 0 → no findings. Non-zero → one `error` finding summarizing the
 * tool's output (per-rule findings are a later brick). Tool absent
 * (ENOENT) or unsupported language → one `info` finding (not an error).
 *
 * @see iron-law.md stage_1.5 — architecture rule enforcement.
 * @see ironclad-design/08-drift-detectors.md — ARCHITECTURE_VIOLATION (#5).
 */
function runArchitectureViolation(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.arch;
  if (!spec) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message:
          `no architecture validator registered for language '${toolchain.language}'` +
          ' (compiler may already enforce acyclic imports)',
      },
    ];
  }
  const proc = execaSync(spec.cmd, [...spec.args], {cwd, reject: false});
  // execaSync(reject:false) RETURNS (does not throw) on a missing binary, so
  // ENOENT must be detected on the RESULT — a try/catch here would be dead code
  // and let a registered-but-uninstalled validator fall through to a FALSE
  // "architecture violations" error finding (a missing tool is a config gap).
  if (isMissingBinary(proc)) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `architecture validator '${spec.cmd}' not installed`,
      },
    ];
  }
  const exitCode = proc.exitCode ?? 1;
  if (exitCode === 0) return [];
  const stdout = (proc.stdout ?? '').toString().trim();
  const stderr = (proc.stderr ?? '').toString().trim();
  const detail = stdout || stderr || `exit ${exitCode}`;
  return [
    {
      detector: NAME,
      severity: 'error',
      message: `${spec.cmd} reported architecture violations: ${detail.slice(0, 300)}`,
    },
  ];
}

export const architectureViolation: DriftDetector = {
  name: NAME,
  run: runArchitectureViolation,
};
