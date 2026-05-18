// Cladding · spec loader — parse + validate + return typed Spec
//
// Public helper that detectors and stages reach for when they need
// structured spec data. Combines `parseSpec` and `assertSpec` so callers
// get a single throw point and a typed return.

import {join} from 'node:path';

import {parseSpec} from './parse.js';
import type {Spec} from './types.js';
import {assertSpec} from './validate.js';

/**
 * Reads, parses, and validates a cladding spec.yaml.
 *
 * @param cwd - Project root. Defaults to `.`.
 * @param specPath - Path relative to `cwd`. Defaults to `spec.yaml`.
 * @returns The validated, typed Spec object.
 * @throws Error when the file is missing, unparseable, or fails validation.
 * @see spec/parse.ts · spec/validate.ts
 */
export function loadSpec(cwd: string = '.', specPath: string = 'spec.yaml'): Spec {
  const path = join(cwd, specPath);
  const payload = parseSpec(path);
  assertSpec(payload);
  return payload;
}
