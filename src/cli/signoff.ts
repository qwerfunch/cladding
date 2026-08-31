// Cladding · Spec 0.2 F5 · CLI adapter for asserted signoff.

import process from 'node:process';

import {recordAssertedSignoff, type AssertedSignoffRequest} from '../proof/signoff.js';

/** CLI options for the narrow local signoff history command. */
export interface SignoffCommandOptions extends Omit<AssertedSignoffRequest, 'cwd' | 'featureId'> {
  readonly cwd?: string;
  readonly json?: boolean;
}

/** Records assertion-only history; no command-line value can select verification. */
export function runSignoffCommand(featureId: string, options: SignoffCommandOptions): ReturnType<typeof recordAssertedSignoff> {
  if (!['audit', 'uat'].includes(options.claim) || (options.result !== undefined && !['pass', 'fail'].includes(options.result)) || (options.note !== undefined && options.note.length > 4096)) {
    const result = {ok: false, code: 'INVALID_OPERATION' as const, message: 'Invalid asserted signoff claim, result, or note length.'};
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stderr.write(`${result.message}\n`);
    process.exitCode = 1;
    return result;
  }
  const result = recordAssertedSignoff({
    cwd: options.cwd ?? process.cwd(), featureId, claim: options.claim,
    ...(options.criterion ? {criterion: options.criterion} : {}),
    ...(options.result ? {result: options.result} : {}),
    ...(options.note ? {note: options.note} : {}),
  });
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}
