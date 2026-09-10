// Cladding · Spec 0.2 F4 · explicit implementation-cycle start adapter.

import process from 'node:process';

import {editSpec, readSpecEditRevisions, SpecEditError} from '../spec/edit.js';

/** Options accepted by the public cycle-start command. */
export interface BeginCommandOptions {
  /** Feature identifier selected for the implementation cycle. */
  readonly featureId: string;
  /** Workspace root retained for tests and embedding hosts. */
  readonly cwd?: string;
  /** Emits machine-readable internal fields for automation. */
  readonly json?: boolean;
}

/** Starts a schema 0.2 feature cycle through the F4 typed edit authority. */
export function runBeginCommand(options: BeginCommandOptions): {readonly ok: boolean} {
  const cwd = options.cwd ?? process.cwd();
  const operation = {kind: 'feature.begin' as const, featureId: options.featureId};
  try {
    const result = editSpec({cwd, operations: [operation], inputRevisions: readSpecEditRevisions(cwd, [operation])});
    const message = result.changed
      ? 'Implementation cycle started. The pre-cycle checkpoint and specification update were saved together.'
      : 'Implementation cycle is already active. No specification changes were needed.';
    if (options.json) process.stdout.write(`${JSON.stringify({ok: true, ...result}, null, 2)}\n`);
    else process.stdout.write(`${message}\n`);
    return {ok: true};
  } catch (error) {
    const message = error instanceof SpecEditError && error.code === 'BUSY'
      ? 'The specification is being updated by another task. Try starting the cycle again shortly.'
      : (error as Error).message;
    if (options.json) process.stdout.write(`${JSON.stringify({ok: false, error: message}, null, 2)}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return {ok: false};
  }
}
