// Cladding · drift detector · REFERENCE_INTEGRITY
//
// Detector #18 from the catalog (axis: environment, severity: error).
// Validates that every internal ID reference inside spec.yaml resolves:
//   - features[].depends_on[]      → exists in features[].id
//   - features[].superseded_by     → exists in features[].id
//   - scenarios[].features[]       → exists in features[].id
// ADR ids (`adr_refs`) are scoped out until the ADR subsystem lands.

import {loadSpec} from '../../spec/load.js';
import type {Feature, Scenario} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'REFERENCE_INTEGRITY';

function refIssues(
  ids: ReadonlySet<string>,
  refs: readonly string[] | undefined,
  context: string,
): DriftFinding[] {
  if (!refs) return [];
  return refs
    .filter((id) => !ids.has(id))
    .map<DriftFinding>((id) => ({
      detector: NAME,
      severity: 'error',
      message: `${context} references unknown id '${id}'`,
    }));
}

function runReferenceIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `spec.yaml not loaded: ${(err as Error).message}`,
      },
    ];
  }
  const featureIds = new Set(spec.features.map((f: Feature) => f.id));
  const findings: DriftFinding[] = [];
  for (const f of spec.features) {
    findings.push(...refIssues(featureIds, f.depends_on, `feature ${f.id}.depends_on`));
    if (f.superseded_by && !featureIds.has(f.superseded_by)) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message: `feature ${f.id}.superseded_by references unknown id '${f.superseded_by}'`,
      });
    }
  }
  for (const s of spec.scenarios ?? []) {
    findings.push(
      ...refIssues(featureIds, (s as Scenario).features, `scenario ${(s as Scenario).id}.features`),
    );
  }
  return findings;
}

export const referenceIntegrity: DriftDetector = {
  name: NAME,
  run: runReferenceIntegrity,
};
