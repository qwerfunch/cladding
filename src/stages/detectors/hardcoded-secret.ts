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

import {resolve} from 'node:path';

import {execaSync} from 'execa';

import {detectToolchain} from '../toolchain/detect.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {classifyScannerExit, isMissingBinary} from '../util.js';
import {memoizeScan} from '../scanner-cache.js';

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
  // Gate-scoped memo (F-5a49899e): the Drift stage AND the Secret stage both
  // reach this detector in one gate run — without memoization secretlint spawns
  // twice (~4.4s each). Keyed by (cwd, cmd, args); a pass-through when no gate
  // cache is primed (standalone / MCP), so behavior outside a gate is unchanged.
  return memoizeScan(`secret:${resolve(cwd)}:${spec.cmd}:${spec.args.join(' ')}`, () => {
    const proc = execaSync(spec.cmd, [...spec.args], {cwd, reject: false});
    // execaSync(reject:false) RETURNS (does not throw) on a missing binary, so
    // ENOENT must be detected on the RESULT — a try/catch here would be dead code
    // and let a registered-but-uninstalled scanner fall through to a FALSE
    // "reported secrets" error finding (a missing tool is a config gap, not a hit).
    if (isMissingBinary(proc)) {
      return [{detector: NAME, severity: 'info', message: `secret scanner '${spec.cmd}' not installed`}];
    }
    // The scanner RAN but exited non-zero. A real secret hit blocks (error); a
    // config/setup gap (e.g. no `.secretlintrc`) skips (info) — secretlint exits
    // non-zero with "config is not found", which must NOT be reported as a secret.
    return classifyScannerExit(
      proc,
      NAME,
      (detail) => `${spec.cmd} reported secrets: ${detail}`,
      (detail) => `${spec.cmd} could not scan (config/setup gap, not a secret): ${detail}`,
    );
  });
}

export const hardcodedSecret: DriftDetector = {
  name: NAME,
  run: runHardcodedSecret,
};
