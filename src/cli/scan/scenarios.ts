// Cladding · scan · scenario stub proposal (deprecated body)
//
// v0.3.30 (audit 2026-05-20 follow-up) deprecates dir-derived
// scenarios. The ironclad-design definition is `scenario =
// user journey` — business intent, not architecture layer.
// Architecture is what the code *is* (observable); scenarios are
// what the user *wants* (declared). Cladding's scan walks the
// observable side; the declared side enters through
// `clad_create_feature` requests.
//
// The function is kept (always returns `[]`) so type and call
// sites stay stable through the v0.3.30 transition. `init.ts`
// writes `spec/scenarios/README.md` explaining the policy
// instead of producing one YAML per layer.
//
// Feature + scenario both grow miniature-map style: empty at
// adoption time, registered as the user requests features.
//
// @see ironclad-design/07-ssot-init.md §3 B
// @see .cladding/audit/scan-real-world-2026-05-20.md (5차 audit)

import type {ScenarioStub, SourceFile} from './types.js';

/**
 * Returns an empty list. Architecture layers are *not* scenarios —
 * scenarios encode user journeys (intent), which only enter the
 * spec when a user requests a feature.
 *
 * @param _filesByLayer Reserved for future analyses that compute
 *   journey metadata from observed code (router declarations, etc.);
 *   currently unused so the deprecation transition stays stable.
 * @returns Always `[]`.
 */
export function proposeScenarios(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _filesByLayer: ReadonlyMap<string, SourceFile[]>,
): readonly ScenarioStub[] {
  return [];
}
