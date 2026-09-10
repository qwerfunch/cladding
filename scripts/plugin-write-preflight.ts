// Cladding · F7-B4 · D10 plugin-build operation-plan preflight.

import {readFileSync} from 'node:fs';

import {resolveManagedWrite, type ManagedWriteTarget} from '../src/spec/compiler/artifact-registry.js';

interface PlannedPluginWrite extends ManagedWriteTarget {
  readonly bytes?: string;
}

/** Validates the complete build operation plan before its first filesystem mutation. */
function validatePluginWritePlan(plan: readonly PlannedPluginWrite[]): void {
  for (const operation of plan) {
    resolveManagedWrite({
      path: operation.path,
      operation: operation.operation,
      ...(operation.region === undefined ? {} : {region: operation.region}),
    });
  }
}

const input = readFileSync(0, 'utf8');
const parsed: unknown = JSON.parse(input);
if (!Array.isArray(parsed) || !parsed.every((entry) => entry !== null && typeof entry === 'object')) {
  throw new Error('plugin build operation plan must be an array');
}
validatePluginWritePlan(parsed as PlannedPluginWrite[]);
