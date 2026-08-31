// Cladding · drift detector · STALE_ATTESTATION (F-a5228c, detector #36)
//
// Catches "shipped code changed since its last attested verification". The
// attestation is COMMITTED CONTENT (spec/attestation.yaml — module
// tree-hashes stamped by a GREEN strict pre-push gate), so this works
// identically on a fresh clone, in CI, and across squash/rebase — the exact
// places the first (events-ledger) design was undefined (review E1+T3).
//
// Severity ladder (never a blanket RED):
//   file absent            → ONE info  — "verification state unknown"; the
//                            path to attested state is named. Adoptions and
//                            upgrades are not retro-failed.
//   entry missing/mismatch → warn per feature — blocks under --strict in
//                            tiers that cannot re-attest (pre-commit); the
//                            strict pre-push gate itself exempts solely-
//                            stale findings and re-attests (see clad.ts).

import {featureAttestation, featureAttestationV3Closure, readAttestation} from '../../spec/attestation.js';
import {assuranceClosureInputFromWorkspace, featureClosureSeals, type FeatureClosureSeals} from '../../assurance/workspace.js';
import {compileSpecWorkspace} from '../../spec/compiler/compile.js';
import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'STALE_ATTESTATION';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const done = (spec.features ?? []).filter((f) => f.status === 'done' && (spec.schema === '0.2' || (f.modules ?? []).length > 0));
  if (done.length === 0) return [];

  const attested = readAttestation(cwd);
  if (attested === null) {
    return [
      {
        detector: NAME,
        severity: 'info',
        path: 'spec/attestation.yaml',
        message:
          'no verification attestation — when this tree was last verified is unknown. ' +
          'Run `clad check --tier=pre-push --strict` GREEN once to attest (the gate writes spec/attestation.yaml).',
      },
    ];
  }

  const currentV3Seals = attested.v3 !== null && spec.schema === '0.2' ? currentV3ClosureSeals(cwd) : undefined;
  const findings: DriftFinding[] = [];
  for (const f of done) {
    // v3 precedence is feature-local.  A mixed transition keeps an untouched
    // sibling's v2 marker/module map authoritative until that feature earns a
    // valid v3 row of its own.
    const state = attested.v3?.has(f.id) === true
      ? (() => {
          const seals = currentV3Seals?.get(f.id);
          // An L1 v3 claim may legitimately carry a missing optional L2 proof
          // closure. Contract/runtime incompleteness can never mint a row at
          // the writer, so compare the sealed sentinel itself here instead of
          // retroactively turning a profile-aware L1 receipt stale.
          return seals
            ? featureAttestationV3Closure(attested, f.id, {
                contract_sha256: seals.contractSha256,
                subject_sha256: seals.subjectSha256,
                verification_sha256: seals.verificationSha256,
                runtime_dependency_sha256: seals.runtimeDependencySha256,
              })
            : {state: 'stale' as const};
        })()
      : featureAttestation(attested, cwd, f);
    if (state.state === 'fresh') continue;
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: 'spec/attestation.yaml',
      message:
        state.state === 'unattested'
          ? `${f.id} is done but has no attestation entry — its modules were never verified by an attested gate. Run \`clad check --tier=pre-push --strict\` to attest.`
          : 'module' in state && state.module
            ? `${f.id}'s module ${state.module} changed since the last attested verification — shipped code is running ahead of its verification. Run \`clad check --tier=pre-push --strict\` to re-verify and re-attest.`
            : `${f.id}'s modules changed since the last attested verification — shipped code is running ahead of its verification. Run \`clad check --tier=pre-push --strict\` to re-verify and re-attest.`,
    });
  }
  return findings;
}

/** Compiles only the D17 closure inputs; no stage, scheduler, or issuer runs here. */
function currentV3ClosureSeals(cwd: string): ReadonlyMap<string, FeatureClosureSeals> | undefined {
  try {
    const compilation = compileSpecWorkspace(cwd);
    if (compilation.schemaVersion !== '0.2') return undefined;
    const input = assuranceClosureInputFromWorkspace(cwd, compilation);
    return new Map((compilation.contract?.features ?? []).map((feature) => [feature.id, featureClosureSeals(input, feature.id)]));
  } catch {
    return undefined;
  }
}

export const staleAttestation: DriftDetector = {name: NAME, run};
