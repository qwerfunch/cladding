// Cladding · drift detector · HARDCODED_SECRET
//
// First registered detector. Implementation of detector #11 from the
// 19-detector catalog (axis: code_vs_test, severity: error).
//
// Strategy: delegate to the project's secret scanner (`toolchain.gates.secret`).
// For TypeScript projects that is `secretlint` (Node-native, no system install);
// for everything else it is `gitleaks` (Go binary). When neither is available,
// emit a single `info` finding rather than failing the run — a missing
// scanner is a configuration gap, not a security finding.

import {execaSync} from 'execa';

import {detectToolchain} from '../toolchain/detect.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {isMissingBinary} from '../util.js';

const NAME = 'HARDCODED_SECRET';

/**
 * Runs the toolchain's secret scanner and converts its exit signal into
 * drift findings. Exit 0 → no findings. Non-zero with a usable stderr →
 * one `error` finding summarizing the tool's output. Tool absent (ENOENT)
 * → one `info` finding noting the gap (does not fail the stage).
 *
 * Refining individual hits into per-line `error` findings (path, line) is
 * a follow-up brick — this brick proves the registry contract end-to-end.
 *
 * @see iron-law.md stage_1.3 — detector contract.
 * @see ironclad-design/08-drift-detectors.md — HARDCODED_SECRET (#11).
 */
function runHardcodedSecret(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.secret;
  if (!spec) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `no secret scanner registered for language '${toolchain.language}'`,
      },
    ];
  }
  const proc = execaSync(spec.cmd, [...spec.args], {cwd, reject: false});
  // execaSync(reject:false) RETURNS (does not throw) on a missing binary, so
  // ENOENT must be detected on the RESULT — a try/catch here would be dead code
  // and let a registered-but-uninstalled scanner fall through to a FALSE
  // "reported secrets" error finding (a missing tool is a config gap, not a hit).
  if (isMissingBinary(proc)) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `secret scanner '${spec.cmd}' not installed`,
      },
    ];
  }
  const exitCode = proc.exitCode ?? 1;
  if (exitCode === 0) return [];
  const stderr = (proc.stderr ?? '').toString().trim();
  const stdout = (proc.stdout ?? '').toString().trim();
  const detail = stderr || stdout || `exit ${exitCode}`;
  return [
    {
      detector: NAME,
      severity: 'error',
      message: `${spec.cmd} reported secrets: ${detail.slice(0, 200)}`,
    },
  ];
}

export const hardcodedSecret: DriftDetector = {
  name: NAME,
  run: runHardcodedSecret,
};
