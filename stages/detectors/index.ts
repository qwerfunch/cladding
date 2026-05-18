// Cladding · drift detectors · catalog
//
// Pure export module — lists every detector cladding ships. Consumers
// (`stages/drift.ts`) read `allDetectors` and register them after their
// own state is initialized. Avoids the ESM circular-init pitfall a
// side-effect `registerDetector` call would create.

import {acDrift} from './ac-drift.js';
import {architectureViolation} from './architecture-violation.js';
import {hardcodedSecret} from './hardcoded-secret.js';
import {harnessIntegrity} from './harness-integrity.js';
import {metaIntegrity} from './meta-integrity.js';
import {missingImplementation} from './missing-implementation.js';
import {missingTests} from './missing-tests.js';
import {referenceIntegrity} from './reference-integrity.js';
import {staleSpecification} from './stale-specification.js';
import {statusDrift} from './status-drift.js';
import {techStackMismatch} from './tech-stack-mismatch.js';
import {unmappedArtifact} from './unmapped-artifact.js';
import type {DriftDetector} from '../types.js';

/** Every detector cladding registers by default, in stable order. */
export const allDetectors: readonly DriftDetector[] = [
  hardcodedSecret,
  architectureViolation,
  missingImplementation,
  unmappedArtifact,
  techStackMismatch,
  statusDrift,
  staleSpecification,
  referenceIntegrity,
  harnessIntegrity,
  metaIntegrity,
  acDrift,
  missingTests,
];
