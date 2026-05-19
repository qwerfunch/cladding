// Cladding · spec validator — JSON Schema check via `jsonschema`
//
// Validation is *separate* from parsing so consumers can fail-fast in
// CI but still load partial specs in editor / authoring contexts.
// `jsonschema` is a pure-JS, ESM-friendly draft-07 validator with no
// interop quirks (chosen over ajv for that reason alone).

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Validator} from 'jsonschema';

import type {Spec} from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, 'schema.json');
const schema: object = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;

const validator = new Validator();

/** Outcome of a validation run. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates a parsed spec object against the JSON Schema.
 *
 * @param payload - The result of `parseSpec` (or any candidate object).
 * @returns `{valid, errors}` — `errors` is empty when `valid` is `true`.
 *          Treat the input as a {@link Spec} only when `valid` is `true`.
 */
export function validateSpec(payload: unknown): ValidationResult {
  const result = validator.validate(payload, schema);
  if (result.valid) return {valid: true, errors: []};
  const errors = result.errors.map((e) => `${e.property}: ${e.message}`);
  return {valid: false, errors};
}

/** Asserts the payload is a valid {@link Spec}; throws with details otherwise. */
export function assertSpec(payload: unknown): asserts payload is Spec {
  const result = validateSpec(payload);
  if (!result.valid) {
    throw new Error(`spec.yaml invalid:\n  ${result.errors.join('\n  ')}`);
  }
}
