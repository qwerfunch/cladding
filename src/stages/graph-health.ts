// Cladding · live SSoT health for the graph viewer — F graph-live-health
//
// THE KILLER: the graph viewer's per-node conformance health, computed from
// cladding's OWN drift detectors. No generic graph tool can do this — it needs
// the spec-as-SSoT + detector engine. Each detector finding is mapped to a
// graph node (a module/test/doc path → that node, or an `F-id` in the message →
// the feature node) and aggregated to a worst-severity badge. `clad graph serve`
// serves this live (heals as you fix); the static export embeds a stamped snapshot.
//
// Lives in the STAGES layer (not graph/) because it imports the detectors:
// architecture.yaml forbids graph→stages, but stages→graph (down-flow) is fine.

import {dependencyCycle} from './detectors/dependency-cycle.js';
import {docReferenceIntegrity} from './detectors/doc-reference-integrity.js';
import {missingImplementation} from './detectors/missing-implementation.js';
import {missingTests} from './detectors/missing-tests.js';
import {referenceIntegrity} from './detectors/reference-integrity.js';
import {staleAttestation} from './detectors/stale-attestation.js';
import {staleTests} from './detectors/stale-tests.js';
import {statusDrift} from './detectors/status-drift.js';
import {unmappedArtifact} from './detectors/unmapped-artifact.js';
import {untestedAc} from './detectors/untested-ac.js';
import type {DriftDetector, DriftFinding} from './types.js';
import {nodeId} from '../graph/presentation.js';
import type {KnowledgeGraph} from '../graph/presentation.js';
import {featureIdRe} from '../spec/feature-id.js';
import {loadSpec, primeSpecCache} from '../spec/load.js';

/** Per-node conformance health: worst severity + which detectors fired. */
export interface NodeHealth {
  readonly severity: 'error' | 'warn';
  readonly count: number;
  readonly detectors: readonly string[];
}

// Detectors that map cleanly to a node + are cheap (no unit/coverage/conformance run).
const HEALTH_DETECTORS: readonly DriftDetector[] = [
  missingTests,
  untestedAc,
  missingImplementation,
  unmappedArtifact,
  referenceIntegrity,
  docReferenceIntegrity,
  dependencyCycle,
  statusDrift,
  staleTests,
  staleAttestation,
];

/** Resolves a finding to EVERY graph node it concerns (a path badges all its
 *  kind-twins — module:/test:/doc: nodes of one file; first-twin-only left the
 *  other twins looking healthy). Empty when nothing matches. */
function findingNodes(f: DriftFinding, ids: ReadonlySet<string>): string[] {
  if (f.path) {
    const p = f.path.split('#')[0].trim(); // test_refs carry `file#anchor`
    const twins = [nodeId.module(p), nodeId.test(p), nodeId.doc(p)].filter((cand) => ids.has(cand));
    if (twins.length > 0) return twins;
  }
  const m = featureIdRe().exec(f.message ?? '');
  if (m && ids.has(nodeId.feature(m[0]))) return [nodeId.feature(m[0])];
  return [];
}

/**
 * Runs the curated health detectors and returns a map of node id → worst-severity
 * health badge. Errors outrank warnings; `info` findings are ignored. A node with
 * no findings is absent from the map (so a healthy graph yields {} — the default
 * pretty view, no alarms).
 */
export function nodeHealth(graph: KnowledgeGraph, cwd: string = '.'): Record<string, NodeHealth> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const acc: Record<string, {severity: 'error' | 'warn'; count: number; detectors: Set<string>}> = {};
  // ONE spec parse for all detectors (the drift.ts run-scope pattern): each
  // withSpec detector otherwise re-parses the whole shard tree — measured
  // 611ms → 21ms for the loop on cladding-self. Best-effort: an unreadable
  // spec leaves the cache unprimed and each detector degrades on its own.
  try {
    primeSpecCache(cwd, loadSpec(cwd));
  } catch {
    /* unreadable spec → detectors handle it individually */
  }
  try {
    for (const detector of HEALTH_DETECTORS) {
      let findings: readonly DriftFinding[] = [];
      try {
        findings = detector.run({cwd});
      } catch {
        continue; // a detector that can't load the spec just contributes nothing
      }
      for (const f of findings) {
        if (f.severity !== 'error' && f.severity !== 'warn') continue;
        for (const id of findingNodes(f, ids)) {
          const cur = acc[id] ?? (acc[id] = {severity: 'warn', count: 0, detectors: new Set()});
          cur.count += 1;
          cur.detectors.add(f.detector);
          if (f.severity === 'error') cur.severity = 'error';
        }
      }
    }
  } finally {
    primeSpecCache(cwd, null);
  }
  const out: Record<string, NodeHealth> = {};
  for (const id of Object.keys(acc).sort()) {
    const v = acc[id];
    out[id] = {severity: v.severity, count: v.count, detectors: [...v.detectors].sort()};
  }
  return out;
}
