// Cladding · drift detector · SPEC_CONFORMANCE
//
// Detector #34 (axis: spec ↔ test, severity: error). v0.5.x.
//
// The PRESENCE/INTEGRITY guard that backs stage_2.3 (runSpecConformance).
// stage_2.3 RUNS the impl-blind, spec-derived oracle suite under
// `tests/oracle/` against the real code — but it SKIPs (exitCode 2,
// non-blocking) when no oracles exist, so by itself it can never force a
// `done` feature to carry one. This detector closes that gap from the spec
// side, in two halves, both restricted to `status: done` features:
//
//   (1) INTEGRITY  (ALWAYS on): every oracle_ref a done AC DECLARES must
//       resolve to an existing file on disk (mirrors UNTESTED_AC /
//       REFERENCE_INTEGRITY). An unresolved ref → error. A declared ref
//       that resolves but does NOT live under `tests/oracle/` → warn,
//       because stage_2.3 only executes that directory, so an oracle
//       elsewhere would never actually run.
//
//   (2) MANDATORY (OPT-IN): only when `spec.project.require_oracles === true`,
//       a done AC that declares NO oracle_refs → error
//       ("done AC lacks a spec-conformance oracle"). When the flag is
//       falsy (the default), there is NO presence requirement — so the
//       detector is INERT on cladding's own repo (149 done features, zero
//       oracles today) and on every existing/legacy project. Adding it is
//       safe everywhere; a project opts into the presence rule explicitly.
//
// Status policy: status-aware in the `done` direction (parallel to
// UNTESTED_AC / MISSING_TESTS) — only `done` features are inspected.
// "Carries a spec-conformance oracle" is a done-state question; a
// planned/in_progress AC's intended oracle path need not exist yet.
//
// DEFERRED — PROVENANCE (Phase 2): the stronger guarantee that an oracle
// was authored IMPL-BLIND (author != implementer, read against the SPEC
// not the code) is NOT enforced here. It requires the `clad oracle`
// authoring manifest (who wrote which oracle, against which spec rev),
// which does not exist yet. This detector deliberately does NOT fake that
// signal — it asserts only that a declared oracle resolves on disk and,
// under require_oracles, that a done AC declares one. Provenance lands
// once the authoring manifest does.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import {ORACLE_DIR} from '../spec-conformance.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'SPEC_CONFORMANCE';

function runSpecConformanceDetector(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  // MANDATORY half is opt-in: only when the project flips it on. Mirror of
  // ai-hints-forbidden-pattern.ts's early-gate — here it gates the presence
  // rule, not the whole detector (INTEGRITY is always-on).
  const requireOracles = spec.project.require_oracles === true;

  for (const feature of spec.features) {
    if (feature.status !== 'done') continue;
    for (const ac of feature.acceptance_criteria ?? []) {
      const refs = ac.oracle_refs ?? [];

      // (2) MANDATORY (opt-in): a done AC with no declared oracle.
      if (requireOracles && refs.length === 0) {
        findings.push({
          detector: NAME,
          severity: 'error',
          message: `${feature.id}.${ac.id} done AC lacks a spec-conformance oracle (project.require_oracles is set; declare oracle_refs under ${ORACLE_DIR}/)`,
        });
      }

      // (1) INTEGRITY (always): every declared oracle_ref must resolve, and
      // SHOULD live under tests/oracle/ — the only dir stage_2.3 executes.
      for (const ref of refs) {
        if (!existsSync(join(cwd, ref))) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: ref,
            message: `${feature.id}.${ac.id} oracle_ref '${ref}' resolves to nothing on disk`,
          });
          continue;
        }
        if (!ref.startsWith(`${ORACLE_DIR}/`)) {
          findings.push({
            detector: NAME,
            severity: 'warn',
            path: ref,
            message: `${feature.id}.${ac.id} oracle_ref '${ref}' lives outside ${ORACLE_DIR}/ — stage_2.3 only runs ${ORACLE_DIR}/, so this oracle will not execute`,
          });
        }
      }
    }
  }
  return findings;
}

export const specConformance: DriftDetector = {
  name: NAME,
  run: runSpecConformanceDetector,
};
