// Cladding · drift detector · DEPENDENCY_CYCLE
//
// Catches a cycle in the `features[].depends_on` DAG. The audit found this gap:
// Feature selection advances only a feature whose dependencies are
// all `done`, so a cycle (A depends_on B depends_on A) leaves every member
// permanently un-ready — planning silently deadlocks and misreports it as
// a generic BLOCKED_FEATURE. REFERENCE_INTEGRITY validates that each `depends_on`
// id EXISTS, but never that the graph is ACYCLIC. This detector closes that.
//
// Within-spec-validity (see detectors/with-spec.ts): it checks a property
// INSIDE the loaded spec, so it returns [] on load failure — ABSENCE_OF_GOVERNANCE
// backstops a missing/unreadable spec. Only edges to features that actually exist
// are traversed (a dangling `depends_on` is REFERENCE_INTEGRITY's concern), so the
// two detectors do not double-report.
//
// error severity: a cycle is a hard structural defect that stalls autonomous
// progress; it must block the gate, not merely warn.

import {loadSpec} from '../../spec/load.js';
import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'DEPENDENCY_CYCLE';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec: Spec;
  try {
    spec = loadSpec(cwd);
  } catch {
    // Within-spec-validity: nothing to check without a loaded spec.
    return [];
  }
  return detect(spec);
}

function detect(spec: Spec): readonly DriftFinding[] {
  const ids = new Set(spec.features.map((f) => f.id));
  // Adjacency: feature id → the depends_on ids that resolve to a real feature.
  const deps = new Map<string, readonly string[]>();
  for (const f of spec.features) {
    deps.set(
      f.id,
      (f.depends_on ?? []).filter((d) => ids.has(d)),
    );
  }

  // DFS three-colour cycle detection. A GRAY node re-entered via a back-edge
  // closes a cycle; the recursion stack holds the path to render it.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of deps.keys()) colour.set(id, WHITE);

  const findings: DriftFinding[] = [];
  const reported = new Set<string>(); // canonical cycle key → dedupe
  const stack: string[] = [];

  function visit(id: string): void {
    colour.set(id, GRAY);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      const c = colour.get(dep);
      if (c === GRAY) {
        const start = stack.indexOf(dep);
        const cycle = stack.slice(start).concat(dep);
        const key = [...cycle].sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          findings.push({
            detector: NAME,
            severity: 'error',
            path: 'spec.yaml',
            message:
              `circular depends_on cycle: ${cycle.join(' → ')} — these features can never all ` +
              'become ready, so the work never starts. Break the cycle by removing one edge.',
          });
        }
      } else if (c === WHITE) {
        visit(dep);
      }
    }
    stack.pop();
    colour.set(id, BLACK);
  }

  for (const id of deps.keys()) {
    if (colour.get(id) === WHITE) visit(id);
  }
  return findings;
}

export const dependencyCycle: DriftDetector = {name: NAME, run};
