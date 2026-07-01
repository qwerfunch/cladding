// Cladding · drift detector · INFERABLE_DEPENDS_ON (F-15999130)
//
// Closes the second half of the depends_on gap. F-2be3e3bb gave cladding a way to PRODUCE
// the feature→feature dependency edges (clad infer-deps, from the code import graph) — but
// the gap had two holes: "produced by nothing" AND "absence flagged by nothing". An optional
// field that nothing produces and nothing checks stays empty forever (doverunner-vapt: 0 edges
// across 174 features → every graph tool returns empty). This detector is the missing flag: it
// notices when a project's code imports cross feature boundaries but the spec never recorded
// the matching `depends_on`, and points the maintainer at `clad infer-deps`.
//
// DESIGN (deliberately non-hostile):
//   • severity INFO — never fails the gate, even under --strict (strict fails on error+warn,
//     not info). A real project that simply never hand-authored depends_on must not turn RED.
//   • a SINGLE aggregate finding — not one per feature. vapt would otherwise emit 157 findings;
//     instead it emits one: "N features have import-inferable depends_on not declared".
//   • silent when there is nothing to suggest (a fully-wired or import-less spec → no finding).
//   • safe-degrade: any error (unreadable files, schema issues) → no finding, never throws.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {inferDependsOn} from '../../optimizer/infer-depends-on.js';
import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'INFERABLE_DEPENDS_ON';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const cwd = opts.cwd ?? '.';
  try {
    const spec = loadSpec(cwd);
    const read = (p: string): string | null => {
      try {
        return readFileSync(join(cwd, p), 'utf8');
      } catch {
        return null;
      }
    };
    const result = inferDependsOn(spec, read);
    const featureCount = Object.keys(result.suggestions).length;
    if (featureCount === 0 || result.edges.length === 0) return [];
    return [
      {
        detector: NAME,
        severity: 'info',
        path: 'spec.yaml',
        message:
          `${featureCount} feature(s) import across feature boundaries but declare no matching depends_on ` +
          `(${result.edges.length} inferable edge(s)). The dependency graph that powers context/impact/` +
          `working-set is under-populated — run \`clad infer-deps\` to review + add the edges.`,
      },
    ];
  } catch {
    return []; // safe-degrade: never block, never throw
  }
}

export const inferableDependsOn: DriftDetector = {
  name: NAME,
  run,
};
