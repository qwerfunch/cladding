// Cladding · drift detector · META_INTEGRITY
//
// Detector #19 from the catalog (axis: environment, severity: error).
// Self-check of the spec subsystem itself — the bedrock everything
// else stands on:
//   - spec/schema.json parses as valid JSON
//   - spec/schema.json declares the four root-level fields the runtime
//     types in spec/types.ts depend on (schema · project · features +
//     optional scenarios/architecture)
//   - schema 0.1's `schema` version matches the compatibility mirror; a
//     schema 0.2 root instead reaches the compiler-validated loader view
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
// `spec/schema.json` is deliberately a schema-0.1 compatibility mirror. The
// schema-0.2 authority is `compileSpecWorkspaceWithLockHeld` through loadSpec.
const SUPPORTED_SCHEMA_VERSIONS = new Set(['0.1', '0.2']);

interface SchemaShape {
  required?: readonly string[];
  properties?: Record<string, unknown>;
}

function runMetaIntegrity(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const schemaPath = join(cwd, 'src', 'spec', 'schema.json');
  const findings: DriftFinding[] = [];

  // The schema.json-vs-types coherence check is a CLADDING-SELF guard: that
  // file ships only in the cladding SOURCE repo. In a user's cladding-managed
  // project it never exists (the schema is bundled in the installed `clad`), so
  // its ABSENCE means "not the cladding repo" → SKIP these checks silently
  // rather than emit a false ENOENT error in every user project. (Same
  // skip-when-absent pattern as the secret/arch scanners, commit 262d1e1.) A
  // PRESENT-but-invalid schema.json (real repo corruption) is still an error.
  // The spec.yaml schema-VERSION check below is independent and always runs.
  if (existsSync(schemaPath)) {
    let schema: SchemaShape | undefined;
    try {
      schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as SchemaShape;
    } catch (err) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message: `spec/schema.json unreadable or invalid JSON: ${(err as Error).message}`,
      });
    }
    if (schema) {
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
    }
  }

  try {
    const spec = loadSpec(cwd);
    if (!SUPPORTED_SCHEMA_VERSIONS.has(spec.schema)) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `spec.yaml schema='${spec.schema}' but supported version is` +
          ` one of '${[...SUPPORTED_SCHEMA_VERSIONS].join("', '")}'`,
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
