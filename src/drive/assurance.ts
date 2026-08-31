// Cladding · drive · F6 observer projection for the interactive loop.
//
// The drive loop's three L1 runners decide whether to retry. This module is
// deliberately observer-only: it reduces the results through F6 so the event
// stream carries the same current input seal and registered adapter identities
// as other gate surfaces, without changing the loop's established halt policy.

import {reduceLegacyStageAdapter} from '../assurance/adapters.js';
import {assuranceProfile, legacyStageProjection, type AssuranceVerdict} from '../assurance/kernel.js';
import {obligationDescriptor} from '../assurance/registry.js';
import {workspaceClosureSeals} from '../assurance/workspace.js';
import {compileSpecWorkspace} from '../spec/compiler/compile.js';
import type {Feature} from '../spec/types.js';
import type {StageResult} from '../stages/types.js';

/** One truth-preserving projection of a drive L1 runner result. */
export interface DriveGateStatus {
  readonly stage: 'stage_1.1' | 'stage_1.2' | 'stage_1.5';
  readonly status: 'pass' | 'fail' | 'skip';
  readonly adapter: {readonly id: string; readonly version: string};
}

/** Compact reducer-owned assurance data persisted for one drive iteration. */
export interface DriveAssuranceSummary {
  readonly profile: AssuranceVerdict['profile'];
  readonly assurance_level: AssuranceVerdict['assurance_level'];
  readonly state: AssuranceVerdict['state'];
  readonly profile_complete: AssuranceVerdict['profile_complete'];
  readonly obligation_sha256: AssuranceVerdict['obligation_sha256'];
}

/** Reducer-owned observer data emitted for one drive iteration. */
export interface DriveGateObservation {
  readonly inputSha256: string;
  readonly gates: readonly DriveGateStatus[];
  readonly assurance: DriveAssuranceSummary;
}

/**
 * Reduces the three L1 drive runners with the compiler's current closure seal.
 *
 * @param cwd - Workspace whose post-mutation state the runners observed.
 * @param feature - Feature selected for this iteration.
 * @param gates - The already-run type, lint, and architecture results.
 * @returns Observer data suitable for a lifecycle event; it has no gate authority.
 * @see spec/features/F-048.yaml AC-f7e0aea5
 */
export function reduceDriveGateObservation(
  cwd: string,
  feature: Feature,
  gates: readonly [
    readonly ['stage_1.1', StageResult],
    readonly ['stage_1.2', StageResult],
    readonly ['stage_1.5', StageResult],
  ],
): DriveGateObservation {
  const compilation = compileSpecWorkspace(cwd);
  const closure = workspaceClosureSeals(cwd, compilation);
  const stages = gates.map(([stage, result]) => ({
    stage,
    status: result.pass ? 'pass' as const : result.exitCode === 2 ? 'skip' as const : 'fail' as const,
  }));
  const verdict = reduceLegacyStageAdapter({
    profile: assuranceProfile('feedback', 'L1'),
    configuredAssuranceLevel: 'L1',
    completeScope: compilation.schemaVersion === '0.1' || compilation.contract !== undefined,
    scopeAddresses: [`feature:${feature.id}`],
    inputAddresses: compilation.nodes.map((node) => node.address).sort(),
    inputSha256: closure.inputSha256,
    hasExecutableTests: compilation.edges.some((edge) => edge.channel === 'test'),
    hasOracleProof: false,
    hasDeliverable: false,
    requiresQuality: false,
    requiresHuman: false,
    stages,
    environmentClass: 'drive',
  });
  const projected = new Map(legacyStageProjection(verdict).map((entry) => [entry.stage, entry.status]));
  const observed = gates.map(([stage]) => {
    const descriptor = obligationDescriptor(stage)!;
    const status = projected.get(stage);
    return {
      stage,
      status: status === 'pass' ? 'pass' as const : status === 'fail' ? 'fail' as const : 'skip' as const,
      adapter: descriptor.adapter,
    };
  });
  return {
    inputSha256: closure.inputSha256,
    gates: observed,
    assurance: {
      profile: verdict.profile,
      assurance_level: verdict.assurance_level,
      state: verdict.state,
      profile_complete: verdict.profile_complete,
      obligation_sha256: verdict.obligation_sha256,
    },
  };
}
