// Cladding · drift detector · REFERENCE_INTEGRITY
//
// Detector #18 from the catalog (axis: environment, severity: error).
// Validates that every internal ID reference inside spec.yaml resolves:
//   - features[].depends_on[]      → exists in features[].id
//   - features[].superseded_by     → exists in features[].id
//   - scenarios[].features[]       → exists in features[].id
// ADR ids (`adr_refs`) are scoped out until the ADR subsystem lands.

import type {Feature, Scenario, Spec} from '../../spec/types.js';
import {scanSourceReferences, type SourceReferenceIssue} from '../../graph/source-references.js';
import {compileSpecWorkspace} from '../../spec/compiler/compile.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

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
  try {
    const compilation = compileSpecWorkspace(cwd);
    const sourceFindings = sourceReferenceIssues(scanSourceReferences(cwd, compilation).issues);
    if (compilation.schemaVersion === '0.2') {
      const unknownReferences = compilation.diagnostics.filter((diagnostic) => diagnostic.code === 'UNKNOWN_REFERENCE');
      if (unknownReferences.length > 0 || compilation.contract) {
        return [
          ...unknownReferences.map((diagnostic) => ({
            detector: NAME,
            severity: 'error' as const,
            ...(diagnostic.source ? {path: diagnostic.source.path} : {}),
            message: `${diagnostic.message} — fix the reference or add the missing item.`,
          })),
          ...sourceFindings,
        ];
      }
    }
    return [...withSpec(cwd, NAME, detect), ...sourceFindings];
  } catch {
    // Keep the schema 0.1 load-failure policy below for an unreadable root.
  }
  return withSpec(cwd, NAME, detect);
}

function sourceReferenceIssues(issues: readonly SourceReferenceIssue[]): readonly DriftFinding[] {
  return issues.map((issue) => ({
    detector: NAME,
    severity: 'error' as const,
    path: issue.sourcePath,
    line: issue.location.line,
    message: sourceReferenceMessage(issue),
  }));
}

function sourceReferenceMessage(issue: SourceReferenceIssue): string {
  switch (issue.code) {
    case 'FEATURE_ONLY':
      return `source reference '${issue.raw}' names a feature without an acceptance criterion — add an AC target.`;
    case 'NONCANONICAL_FEATURE_PATH':
      return `source reference '${issue.raw}' uses a non-canonical feature path — use spec/features/<shard>.yaml.`;
    case 'UNKNOWN_FEATURE_SHARD':
      return `source reference '${issue.raw}' names an unknown feature shard — fix the path or add the shard.`;
    case 'UNKNOWN_CRITERION':
      return `source reference '${issue.raw}' names unknown criterion '${issue.normalizedTarget}'` +
        ` — fix the AC id or add it to '${issue.featurePath}'.`;
  }
}

function detect(spec: Spec): readonly DriftFinding[] {
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
