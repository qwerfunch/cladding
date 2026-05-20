// Cladding · scan · scenario stub proposal
//
// v0.3.29 keeps this module alive but its output is queued for
// deprecation. The 5차 audit (2026-05-20) flagged dir-derived
// scenarios as misaligned with the ironclad-design definition
// (scenario = user journey, not architecture layer). v0.3.30
// will replace the body with an empty list + scenarios/README
// guidance — the *real* scenario is auto-registered when a user
// requests a feature through `clad_create_feature`.

import type {ScenarioStub, SourceFile} from './types.js';

/**
 * One stub per non-_root layer. v0.3.29 keeps the legacy shape
 * intact so downstream tests stay stable; v0.3.30 will swap the
 * body for `[]` after the scan scenario discussion lands.
 */
export function proposeScenarios(
  filesByLayer: ReadonlyMap<string, SourceFile[]>,
): readonly ScenarioStub[] {
  const out: ScenarioStub[] = [];
  for (const [name, files] of filesByLayer) {
    if (name === '_root') continue;
    out.push({slug: `${name}-flow`, dir: name, moduleCount: files.length});
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}
