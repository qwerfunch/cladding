// Cladding · drift detector · DOC_LINK_INTEGRITY
//
// Closes the doc axis of the knowledge graph: docs/*.md carry F-id references
// and relative .md links that no detector validated, so a renamed/archived
// feature silently rotted the prose and a moved doc left dead links. This is
// the "all documents connected, ALWAYS CURRENT" guarantee, made mechanical.
//
// Two checks (scoping in src/spec/doc-references.ts — fixture dirs excluded,
// code spans skipped, per-file `clad-doc-links: ignore` opt-out honoured):
//   • doc → doc  : a relative .md link resolving to no file → ERROR (unambiguous).
//   • doc → spec : an F-id in a scoped doc resolving to no feature → WARN
//                  (rides the warn/strict dial — advisory locally, blocks on push).

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {extractDocReferences} from '../../spec/doc-references.js';
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
  for (const doc of extractDocReferences(cwd).docs) {
    for (const link of doc.doc_links) {
      if (!existsSync(join(cwd, link))) {
        findings.push({
          detector: NAME,
          severity: 'error',
          path: doc.doc,
          message: `doc '${doc.doc}' links to missing file '${link}'`,
        });
      }
    }
    for (const fid of doc.features) {
      if (!featureIds.has(fid)) {
        findings.push({
          detector: NAME,
          severity: 'warn',
          path: doc.doc,
          message:
            `doc '${doc.doc}' references unknown feature '${fid}' — archived/renamed? ` +
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
