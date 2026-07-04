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

import {featureAttestation, readAttestation} from '../../spec/attestation.js';
import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'STALE_ATTESTATION';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const done = (spec.features ?? []).filter((f) => f.status === 'done' && (f.modules ?? []).length > 0);
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

  const findings: DriftFinding[] = [];
  for (const f of done) {
    const state = featureAttestation(attested, cwd, f);
    if (state.state === 'fresh') continue;
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: 'spec/attestation.yaml',
      message:
        state.state === 'unattested'
          ? `${f.id} is done but has no attestation entry — its modules were never verified by an attested gate. Run \`clad check --tier=pre-push --strict\` to attest.`
          : state.module
            ? `${f.id}'s module ${state.module} changed since the last attested verification — shipped code is running ahead of its verification. Run \`clad check --tier=pre-push --strict\` to re-verify and re-attest.`
            : `${f.id}'s modules changed since the last attested verification — shipped code is running ahead of its verification. Run \`clad check --tier=pre-push --strict\` to re-verify and re-attest.`,
    });
  }
  return findings;
}

export const staleAttestation: DriftDetector = {name: NAME, run};
