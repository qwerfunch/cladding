// Cladding · drift detectors · catalog
//
// Pure export module — lists every detector cladding ships. Consumers
// (`stages/drift.ts`) read `allDetectors` and register them after their
// own state is initialized. Avoids the ESM circular-init pitfall a
// side-effect `registerDetector` call would create.

import {absenceOfGovernance} from './absence-of-governance.js';
import {acDrift} from './ac-drift.js';
import {aiHintsForbiddenPattern} from './ai-hints-forbidden-pattern.js';
import {acDuplicateWithinFeature} from './ac-duplicate-within-feature.js';
import {architectureFromSpec} from './architecture-from-spec.js';
import {architectureViolation} from './architecture-violation.js';
import {capabilitiesFeatureMapping} from './capabilities-feature-mapping.js';
import {conventionDrift} from './convention-drift.js';
import {coverageDrop} from './coverage-drop.js';
import {evidenceMismatch} from './evidence-mismatch.js';
import {fixtureReference} from './fixture-reference.js';
import {hardcodedSecret} from './hardcoded-secret.js';
import {harnessIntegrity} from './harness-integrity.js';
import {idCollision} from './id-collision.js';
import {metaIntegrity} from './meta-integrity.js';
import {slugConflict} from './slug-conflict.js';
import {missingImplementation} from './missing-implementation.js';
import {missingTests} from './missing-tests.js';
import {performanceDrift} from './performance-drift.js';
import {referenceIntegrity} from './reference-integrity.js';
import {staleEvidence} from './stale-evidence.js';
import {staleSpecification} from './stale-specification.js';
import {staleTests} from './stale-tests.js';
import {statusDrift} from './status-drift.js';
import {techStackMismatch} from './tech-stack-mismatch.js';
import {unmappedArtifact} from './unmapped-artifact.js';
import {untestedAc} from './untested-ac.js';
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
  staleTests,
  coverageDrop,
  performanceDrift,
  evidenceMismatch,
  staleEvidence,
  untestedAc,
  conventionDrift,
  fixtureReference,
  slugConflict,
  idCollision,
  acDuplicateWithinFeature,
  architectureFromSpec,
  capabilitiesFeatureMapping,
  absenceOfGovernance,
  aiHintsForbiddenPattern,
];
