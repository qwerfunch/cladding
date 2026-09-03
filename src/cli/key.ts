// Cladding · Spec 0.2 F9d · CLI adapter for the issuer key store and trust registry.
//
// `clad key create` is the one command that makes a workspace able to hold
// verified human evidence at all. It splits the two halves deliberately: the
// private key goes to the out-of-workspace store, and the public key enters
// `spec/trust/issuers.yaml` through the same F4 spec transaction every other
// managed write uses — never a bare filesystem write into `spec/`.

import process from 'node:process';

import {createIssuerKey, hasIssuerPrivateKey, issuerKeyStoreDirectory} from '../proof/issuer.js';
import {TRUST_REGISTRY_PATH, readTrustRegistry, trustRegistryAddition, type TrustRegistryListing} from '../proof/trust.js';
import {commitSpecTransactionFiles, requiredRootSchema, withSpecWorkspaceLock} from '../spec/transaction.js';

/** Options shared by the key subcommands. */
export interface KeyCommandOptions {
  readonly cwd?: string;
  readonly json?: boolean;
}

/** Stable result of one key subcommand. */
export interface KeyCommandResult {
  readonly ok: boolean;
  readonly code: 'OK' | 'INVALID_OPERATION' | 'INVALID_WORKSPACE' | 'BUSY';
  readonly message: string;
  readonly issuer?: string;
  readonly issuerKeyId?: string;
  readonly privateKeyPath?: string;
  readonly registryPath?: string;
  readonly issuers?: readonly TrustRegistryListing[];
}

/**
 * Registers one new issuer: private key outside the workspace, public key committed.
 *
 * Re-registering an existing issuer is refused rather than rotated. A rotation
 * has to decide what happens to receipts the old key already signed, and F9d
 * does not answer that question; refusing keeps the registry honest until it
 * does.
 *
 * @param issuer - Issuer name recorded in the committed registry.
 * @param options - Workspace root and output shape.
 * @returns The derived key id, private key path, and registry path.
 */
export function runKeyCreateCommand(issuer: string, options: KeyCommandOptions = {}): KeyCommandResult {
  const cwd = options.cwd ?? process.cwd();
  if (typeof issuer !== 'string' || issuer.trim().length === 0 || issuer.trim().length > 128) {
    return emit({ok: false, code: 'INVALID_OPERATION', message: 'An issuer name must be between 1 and 128 characters.'}, options);
  }
  const name = issuer.trim();
  try {
    return emit(withSpecWorkspaceLock<KeyCommandResult>(cwd, () => {
      if (requiredRootSchema(cwd) !== '0.2') {
        return {ok: false, code: 'INVALID_WORKSPACE', message: 'A registered issuer requires a schema 0.2 workspace.'};
      }
      if (readTrustRegistry(cwd).some((entry) => entry.issuer === name)) {
        return {ok: false, code: 'INVALID_OPERATION', message: `Issuer ${name} is already registered in ${TRUST_REGISTRY_PATH}. Registering the same issuer twice is refused; there is no rotation path yet.`};
      }
      // The private key is written first: a registry entry with no local
      // signing key is a recoverable state, while a key file whose public half
      // never landed would be invisible.
      const created = createIssuerKey();
      const addition = trustRegistryAddition(cwd, {issuer: name, spkiDer: created.spkiDer});
      commitSpecTransactionFiles(cwd, [{path: TRUST_REGISTRY_PATH, before: addition.before, after: addition.after}]);
      return {
        ok: true, code: 'OK',
        message: `Registered issuer ${name}. The private key stays at ${created.privateKeyPath} and only the public key entered ${TRUST_REGISTRY_PATH}.`,
        issuer: name,
        issuerKeyId: created.issuerKeyId,
        privateKeyPath: created.privateKeyPath,
        registryPath: TRUST_REGISTRY_PATH,
      };
    }), options);
  } catch (error) {
    const message = (error as Error).message;
    return emit({ok: false, code: message.includes('BUSY') ? 'BUSY' : 'INVALID_OPERATION', message}, options);
  }
}

/** Lists registered issuers and whether this machine holds each signing key. */
export function runKeyListCommand(options: KeyCommandOptions = {}): KeyCommandResult {
  const cwd = options.cwd ?? process.cwd();
  try {
    const issuers = readTrustRegistry(cwd).map((entry) => ({...entry, signingKeyPresent: hasIssuerPrivateKey(entry.issuer_key_id)}));
    return emit({
      ok: true, code: 'OK',
      message: issuers.length === 0
        ? `No issuers are registered in ${TRUST_REGISTRY_PATH}; verified signoff is unavailable until one is.`
        : `${issuers.length} registered issuer${issuers.length === 1 ? '' : 's'}; private keys are read from ${issuerKeyStoreDirectory()}.`,
      registryPath: TRUST_REGISTRY_PATH,
      issuers,
    }, options);
  } catch (error) {
    return emit({ok: false, code: 'INVALID_OPERATION', message: (error as Error).message}, options);
  }
}

function emit(result: KeyCommandResult, options: KeyCommandOptions): KeyCommandResult {
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    for (const entry of result.issuers ?? []) {
      process.stdout.write(`  ${entry.issuer}  ${entry.issuer_key_id}  ${entry.signingKeyPresent ? 'signing key present' : 'no local signing key'}\n`);
    }
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}
