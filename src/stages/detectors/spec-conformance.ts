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
// was authored IMPL-BLIND is checked here at GATE TIME (opt-in, under
// require_oracles) by reading the `kind: 'oracle'` authoring-provenance
// records in the audit log. Three deterministic structural checks per
// declared oracle_ref: (i) a provenance record exists; (ii) the oracle
// author identity != the feature's implementer identity (lifting the
// drive-only reviewer barrier, agent.ts:91-95, into an all-paths gate
// check); (iii) the author's read-manifest does NOT intersect the
// feature's `modules` (the load-bearing impl-blindness invariant). A
// self-reported (host-protocol, `blind:false`) manifest is still checked
// against modules but flagged `info` so the honesty boundary stays visible.
// AUTHORING-time blindness itself is structural only on the `clad oracle`
// SDK path (cladding controls the prompt); the in-session/MCP path is a
// host protocol this detector audits after the fact. DEFERRED to v2: a
// spec-rev hash so oracle/spec drift is caught (no hash infra exists yet).

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {readEvidence} from '../../hitl/audit.js';
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
  // MANDATORY + PROVENANCE halves are opt-in: only when the project flips it
  // on. Mirror of ai-hints-forbidden-pattern.ts's early-gate. INTEGRITY is
  // always-on. The audit log is read ONCE, and only when opted in.
  const requireOracles = spec.project.require_oracles === true;
  const evidence = requireOracles ? readEvidence(cwd) : [];
  const oracleEv = evidence.filter((e) => e.kind === 'oracle');
  // The implementer identity per feature = the specialist dispatch the drive
  // loop records (agent.ts:97-105, stage 'agent:specialists').
  const implementerName = (featureId: string): string | undefined =>
    evidence.find((e) => e.featureId === featureId && e.stage === 'agent:specialists')?.identity.name;

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

        // (3) PROVENANCE (opt-in): the oracle must be authored impl-blind by a
        // non-implementer. Checked from the `kind:'oracle'` audit record.
        if (!requireOracles) continue;
        const prov = oracleEv.find((e) => e.featureId === feature.id && e.acId === ac.id && e.artifact === ref);
        if (!prov) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: ref,
            message: `${feature.id}.${ac.id} oracle '${ref}' has no authoring-provenance record — author it via 'clad oracle' (or clad_author_oracle) so impl-blindness can be verified`,
          });
          continue;
        }
        const implName = implementerName(feature.id);
        if (implName && prov.identity.name === implName) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: ref,
            message: `${feature.id}.${ac.id} oracle '${ref}' is NOT impl-blind: authored by the implementer ('${implName}')`,
          });
        } else if (!implName) {
          findings.push({
            detector: NAME,
            severity: 'info',
            message: `${feature.id}.${ac.id} oracle author≠implementer not verified — no implementer identity recorded (no clad drive history to compare)`,
          });
        }
        const overlap = (prov.readManifest ?? []).filter((m) => (feature.modules ?? []).includes(m));
        if (overlap.length > 0) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: ref,
            message: `${feature.id}.${ac.id} oracle '${ref}' is NOT impl-blind: author read implementation file(s) the feature owns (${overlap.join(', ')})`,
          });
        }
        if (prov.blind === false) {
          findings.push({
            detector: NAME,
            severity: 'info',
            message: `${feature.id}.${ac.id} oracle '${ref}' provenance is self-reported (host-protocol), not cladding-controlled — manifest checked, blindness unproven`,
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
