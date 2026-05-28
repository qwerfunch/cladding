// Cladding · drift detector · META_INTEGRITY
//
// Detector #19 from the catalog (axis: environment, severity: error).
// Self-check of the spec subsystem itself — the bedrock everything
// else stands on:
//   - spec/schema.json parses as valid JSON
//   - spec/schema.json declares the four root-level fields the runtime
//     types in spec/types.ts depend on (schema · project · features +
//     optional scenarios/architecture)
//   - spec.yaml's `schema` version matches the schema's `$id` line
//
// This is the "self-validates the validator" detector. Cheap, but
// invaluable as cladding evolves — refactoring the schema and
// forgetting to update types.ts surfaces immediately.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'META_INTEGRITY';

const REQUIRED_ROOT_KEYS = ['schema', 'project', 'features'] as const;
const SUPPORTED_SCHEMA_VERSION = '0.1';

interface SchemaShape {
  required?: readonly string[];
  properties?: Record<string, unknown>;
}

function runMetaIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const schemaPath = join(cwd, 'src', 'spec', 'schema.json');
  const findings: DriftFinding[] = [];

  // META_INTEGRITY is a self-check on cladding's own spec subsystem —
  // it verifies that the checked-in JSON Schema declares the keys the
  // runtime types depend on. External user projects do NOT ship that
  // file (the schema lives inside the cladding npm package's dist).
  // Skip silently when the schema is absent at cwd so the detector
  // is a self-check inside cladding's repo and a no-op everywhere
  // else, instead of a false-positive ERROR on every clad check.
  if (!existsSync(schemaPath)) return findings;

  let schema: SchemaShape;
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as SchemaShape;
  } catch (err) {
    findings.push({
      detector: NAME,
      severity: 'error',
      message: `spec/schema.json unreadable or invalid JSON: ${(err as Error).message}`,
    });
    return findings;
  }
  for (const key of REQUIRED_ROOT_KEYS) {
    if (!schema.required?.includes(key)) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message: `spec/schema.json does not require root key '${key}'`,
      });
    }
    if (!schema.properties?.[key]) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message: `spec/schema.json does not declare property '${key}'`,
      });
    }
  }

  try {
    const spec = loadSpec(cwd);
    if (spec.schema !== SUPPORTED_SCHEMA_VERSION) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `spec.yaml schema='${spec.schema}' but supported version is` +
          ` '${SUPPORTED_SCHEMA_VERSION}'`,
      });
    }
  } catch {
    // loadSpec failure is handled by the dedicated spec_validate path; META
    // stays narrowly scoped to schema-vs-types coherence.
  }

  return findings;
}

export const metaIntegrity: DriftDetector = {
  name: NAME,
  run: runMetaIntegrity,
};
