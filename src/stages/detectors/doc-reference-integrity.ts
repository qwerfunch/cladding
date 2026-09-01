// Cladding · drift detector · DOC_LINK_INTEGRITY
//
// Closes the doc axis of the knowledge graph: docs/*.md carry F-id references
// and relative .md links that no detector validated, so a renamed/archived
// feature silently rotted the prose and a moved doc left dead links. This is
// the "all documents connected, ALWAYS CURRENT" guarantee, made mechanical.
//
// Three checks (scoping in src/spec/doc-references.ts — fixture dirs excluded,
// code spans skipped, per-file `clad-doc-links: ignore` opt-out honoured):
//   • doc → doc  : a relative .md link resolving to no file → ERROR (unambiguous).
//   • doc → spec : an F-id in a scoped doc resolving to no feature → WARN
//                  (rides the warn/strict dial — advisory locally, blocks on push).
//   • unsafe path: an escape or external symlink spelling → ERROR without an
//                  outside-workspace filesystem probe.

import {scanDocumentFacts} from '../../spec/doc-references.js';
import type {Feature, Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'DOC_LINK_INTEGRITY';

function runDocLinkIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const featureIds = new Set((spec.features ?? []).map((f: Feature) => f.id));
  const findings: DriftFinding[] = [];
  for (const document of scanDocumentFacts(cwd).docs) {
    if (!document.readable) continue;
    const featureReferences = document.excluded
      ? document.explicit
      : [...document.explicit, ...document.organic];
    const seenTargets = new Set<string>();
    for (const link of document.links) {
      if (link.state === 'unresolved' && !seenTargets.has(link.target)) {
        seenTargets.add(link.target);
        findings.push({
          detector: NAME,
          severity: 'error',
          path: document.doc,
          message: `doc '${document.doc}' links to missing file '${link.target}'`,
        });
      }
    }
    for (const issue of document.issues) {
      findings.push({
        detector: NAME,
        severity: 'error',
        path: document.doc,
        message: `doc '${document.doc}' has unsafe local Markdown path '${issue.raw}' (${issue.reason})`,
      });
    }
    for (const fid of new Set(featureReferences.map((fact) => fact.featureId))) {
      if (!featureIds.has(fid)) {
        findings.push({
          detector: NAME,
          severity: 'warn',
          path: document.doc,
          message:
            `doc '${document.doc}' references unknown feature '${fid}' — archived/renamed? ` +
            'If it is an illustrative example, add a `clad-doc-links: ignore` marker to the doc.',
        });
      }
    }
  }
  return findings;
}

export const docReferenceIntegrity: DriftDetector = {
  name: NAME,
  run: runDocLinkIntegrity,
};
