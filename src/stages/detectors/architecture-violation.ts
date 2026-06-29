// Cladding · drift detector · ARCHITECTURE_VIOLATION
//
// Detector #5 from the 19-detector catalog (axis: spec_vs_code,
// severity: error). Delegates to `toolchain.gates.arch`. For TypeScript
// projects that is `madge --circular`; for Python `lint-imports`
// (import-linter). Languages whose compilers already enforce acyclic
// imports (rust, go, java) do not register an arch gate — the detector
// emits a single `info` finding for them.

import {resolve} from 'node:path';

import {execaSync} from 'execa';

import {detectToolchain} from '../toolchain/detect.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {classifyScannerExit, isMissingBinary} from '../util.js';
import {memoizeScan} from '../scanner-cache.js';

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
  // Gate-scoped memo (F-5a49899e): the Drift stage AND the Arch stage both reach
  // this detector in one gate run — without memoization madge spawns twice
  // (~1.4s each). Keyed by (cwd, cmd, args); a pass-through when no gate cache is
  // primed, so behavior outside a gate is unchanged.
  return memoizeScan(`arch:${resolve(cwd)}:${spec.cmd}:${spec.args.join(' ')}`, () => {
    const proc = execaSync(spec.cmd, [...spec.args], {cwd, reject: false});
    // execaSync(reject:false) RETURNS (does not throw) on a missing binary, so
    // ENOENT must be detected on the RESULT — a try/catch here would be dead code
    // and let a registered-but-uninstalled validator fall through to a FALSE
    // "architecture violations" error finding (a missing tool is a config gap).
    if (isMissingBinary(proc)) {
      return [{detector: NAME, severity: 'info', message: `architecture validator '${spec.cmd}' not installed`}];
    }
    // The validator RAN but exited non-zero. A real cycle/boundary violation blocks
    // (error); a config/setup gap (validator present but unconfigured) skips (info).
    return classifyScannerExit(
      proc,
      NAME,
      (detail) => `${spec.cmd} reported architecture violations: ${detail}`,
      (detail) => `${spec.cmd} could not validate (config/setup gap, not a violation): ${detail}`,
    );
  });
}

export const architectureViolation: DriftDetector = {
  name: NAME,
  run: runArchitectureViolation,
};
