// Cladding · drift detectors · catalog
//
// Pure export module — lists every detector cladding ships. Consumers
// (`stages/drift.ts`) read `allDetectors` and register them after their
// own state is initialized. Avoids the ESM circular-init pitfall a
// side-effect `registerDetector` call would create.

import {architectureViolation} from './architecture-violation.js';
import {hardcodedSecret} from './hardcoded-secret.js';
import type {DriftDetector} from '../types.js';

/** Every detector cladding registers by default, in stable order. */
export const allDetectors: readonly DriftDetector[] = [
  hardcodedSecret,
  architectureViolation,
];
