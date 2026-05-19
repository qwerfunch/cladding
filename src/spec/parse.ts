// Cladding · spec parser — YAML → in-memory object
//
// Pure parse step. Reads the file from disk and converts the YAML payload
// into a plain object. Validation against the JSON Schema happens in
// `spec/validate.ts` so callers can choose the granularity (parse-only
// for editors, parse+validate for CI).

import {readFileSync} from 'node:fs';

import {parse as parseYaml} from 'yaml';

/**
 * Reads and parses a spec.yaml file. Throws on read failure or invalid YAML.
 * Does NOT validate against the JSON Schema — wrap with `validateSpec` for
 * type-safe callers.
 *
 * @param path - Absolute or cwd-relative path to spec.yaml. Defaults to `./spec.yaml`.
 * @returns The parsed object (untyped — validate first for safety).
 * @see spec/validate.ts — schema validation step.
 */
export function parseSpec(path: string = './spec.yaml'): unknown {
  const text = readFileSync(path, 'utf8');
  return parseYaml(text);
}
