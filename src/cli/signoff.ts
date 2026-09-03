// Cladding · Spec 0.2 F5/F9d · CLI adapter for asserted and verified signoff.

import {createInterface} from 'node:readline/promises';
import process from 'node:process';

import {
  recordAssertedSignoff,
  recordVerifiedSignoff,
  type AssertedSignoffRequest,
  type SignoffConfirmation,
  type VerifiedSignoffResult,
} from '../proof/signoff.js';

/** CLI options for the local signoff command. */
export interface SignoffCommandOptions extends Omit<AssertedSignoffRequest, 'cwd' | 'featureId'> {
  readonly cwd?: string;
  readonly json?: boolean;
  /** Requests the registered-issuer path; it never bypasses human confirmation. */
  readonly verified?: boolean;
  /** Registered issuer name; required with `--verified`. */
  readonly issuer?: string;
  /** Injected confirmation channel; the default is a real terminal prompt. */
  readonly confirm?: SignoffConfirmation;
  /** Injected TTY fact so a test can exercise both branches without a pty. */
  readonly interactive?: boolean;
}

/** Records assertion-only history; no command-line value can select verification. */
export function runSignoffCommand(featureId: string, options: SignoffCommandOptions): ReturnType<typeof recordAssertedSignoff> {
  if (!valid(options)) {
    const result = {ok: false, code: 'INVALID_OPERATION' as const, message: 'Invalid asserted signoff claim, result, or note length.'};
    return report(result, options);
  }
  return report(recordAssertedSignoff(request(featureId, options)), options);
}

/**
 * Runs the verified signoff path, prompting for human confirmation first.
 *
 * A non-interactive stdin is not an obstacle to route around: without a
 * terminal there is nobody to confirm, so the command records asserted history
 * and returns `HUMAN_REQUIRED`. That is the whole point of the flag — it
 * REQUESTS verification, it does not grant it.
 *
 * @param featureId - Feature the signoff is about.
 * @param options - Claim, issuer, and the injected confirmation seam.
 * @returns The stored receipt and verification, or HUMAN_REQUIRED.
 */
export async function runVerifiedSignoffCommand(
  featureId: string,
  options: SignoffCommandOptions,
): Promise<VerifiedSignoffResult> {
  if (!valid(options)) {
    return report<VerifiedSignoffResult>({ok: false, code: 'INVALID_OPERATION', message: 'Invalid asserted signoff claim, result, or note length.'}, options);
  }
  if (!options.issuer || options.issuer.trim().length === 0) {
    return report<VerifiedSignoffResult>({ok: false, code: 'INVALID_OPERATION', message: 'A verified signoff requires --issuer with a registered issuer name.'}, options);
  }
  const interactive = options.interactive ?? process.stdin.isTTY === true;
  const confirm = options.confirm ?? (interactive ? terminalConfirmation : undefined);
  if (!confirm) {
    // Record the asserted half exactly as the plain command would, so a
    // scripted run still leaves the human channel's history behind.
    const asserted = recordAssertedSignoff(request(featureId, options));
    return report<VerifiedSignoffResult>({
      ok: false, code: 'HUMAN_REQUIRED',
      message: 'A verified signoff needs an interactive terminal so a human can re-enter the feature id. Only asserted history was recorded.',
      ...(asserted.evidence ? {evidence: asserted.evidence} : {}),
    }, options);
  }
  return report(await recordVerifiedSignoff({
    ...request(featureId, options), issuer: options.issuer.trim(), confirm,
  }), options);
}

/** Reads the confirmation from the real terminal; nothing is defaulted for the user. */
const terminalConfirmation: SignoffConfirmation = async (prompt) => {
  const rl = createInterface({input: process.stdin, output: process.stderr});
  try { return await rl.question(prompt); } finally { rl.close(); }
};

function valid(options: SignoffCommandOptions): boolean {
  return ['audit', 'uat'].includes(options.claim)
    && (options.result === undefined || ['pass', 'fail'].includes(options.result))
    && (options.note === undefined || options.note.length <= 4096);
}

function request(featureId: string, options: SignoffCommandOptions): AssertedSignoffRequest {
  return {
    cwd: options.cwd ?? process.cwd(), featureId, claim: options.claim,
    ...(options.criterion ? {criterion: options.criterion} : {}),
    ...(options.result ? {result: options.result} : {}),
    ...(options.note ? {note: options.note} : {}),
  };
}

function report<T extends {readonly ok: boolean; readonly message: string}>(result: T, options: SignoffCommandOptions): T {
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}
