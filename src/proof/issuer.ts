// Cladding · Spec 0.2 F9d · file-backed Ed25519 issuer keys held outside the workspace.
//
// D20 requires that private signing material never live where a workspace edit
// (or an agent editing that workspace) can reach it. The public half is a
// reviewed, committed registry; the private half is a plain PKCS8 DER file in
// the user's home directory with owner-only permissions.
//
// This is deliberately NOT an OS secure store. A file key proves the mechanism
// — a real registered issuer, a real detached signature, a real offline
// verification — without pretending to prove custody: any process running as
// this user can read the file. The threat model is written down in D20 rather
// than implied by an API that looks stronger than it is.

import {createPrivateKey, generateKeyPairSync, sign, type KeyObject} from 'node:crypto';
import {chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import process from 'node:process';

import {issuerKeyIdForSpki, receiptSigningPayload, type PortableReceipt} from './receipt.js';

/** Exact suffix of a stored private key file; the stem is its issuer key id. */
export const ISSUER_KEY_SUFFIX = '.ed25519';

/** Owner-only directory mode required before a private key may be written. */
export const ISSUER_KEY_DIRECTORY_MODE = 0o700;

/** Owner-only file mode required for every stored private key. */
export const ISSUER_KEY_FILE_MODE = 0o600;

/** A signing key file was absent, unreadable, or not an Ed25519 private key. */
export class IssuerKeyError extends Error {}

/**
 * Resolves the private key store, which is never inside the workspace.
 *
 * `CLADDING_KEYS_DIR` exists so tests and sandboxed hosts can relocate the
 * store; it is read from an explicit environment record rather than a module
 * cache so a per-process override always applies.
 *
 * @param env - Environment record to read the override from.
 * @returns Absolute private key store directory.
 */
export function issuerKeyStoreDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLADDING_KEYS_DIR;
  if (override !== undefined && override.trim().length > 0) return resolve(override);
  return join(homedir(), '.cladding', 'keys');
}

/** Absolute path of one issuer's private key file. */
export function issuerPrivateKeyPath(issuerKeyId: string, env?: NodeJS.ProcessEnv): string {
  if (!/^[a-f0-9]{64}$/.test(issuerKeyId)) throw new IssuerKeyError('An issuer key id must be a lowercase SHA-256 digest.');
  return join(issuerKeyStoreDirectory(env), `${issuerKeyId}${ISSUER_KEY_SUFFIX}`);
}

/** A freshly generated issuer identity; only the public half may be committed. */
export interface GeneratedIssuerKey {
  readonly issuerKeyId: string;
  /** DER SubjectPublicKeyInfo bytes, the sole input to the key identity. */
  readonly spkiDer: Uint8Array;
  readonly privateKeyPath: string;
}

/**
 * Generates one Ed25519 issuer key and stores its private half owner-only.
 *
 * @param env - Environment record used to resolve the key store.
 * @returns The public SPKI bytes, derived key id, and stored private key path.
 * @throws IssuerKeyError when a key file already exists for the derived id.
 */
export function createIssuerKey(env?: NodeJS.ProcessEnv): GeneratedIssuerKey {
  const pair = generateKeyPairSync('ed25519');
  const spkiDer = new Uint8Array(pair.publicKey.export({format: 'der', type: 'spki'}));
  const issuerKeyId = issuerKeyIdForSpki(spkiDer);
  const directory = issuerKeyStoreDirectory(env);
  mkdirSync(directory, {recursive: true, mode: ISSUER_KEY_DIRECTORY_MODE});
  // `mkdir` applies the process umask to its mode, so the explicit chmod is
  // the only thing that actually guarantees an owner-only store.
  chmodSync(directory, ISSUER_KEY_DIRECTORY_MODE);
  const privateKeyPath = join(directory, `${issuerKeyId}${ISSUER_KEY_SUFFIX}`);
  if (existsSync(privateKeyPath)) throw new IssuerKeyError(`A private key already exists at ${privateKeyPath}.`);
  writeFileSync(privateKeyPath, pair.privateKey.export({format: 'der', type: 'pkcs8'}), {mode: ISSUER_KEY_FILE_MODE});
  chmodSync(privateKeyPath, ISSUER_KEY_FILE_MODE);
  return Object.freeze({issuerKeyId, spkiDer, privateKeyPath});
}

/** Whether a private key file for this issuer key id is present in the store. */
export function hasIssuerPrivateKey(issuerKeyId: string, env?: NodeJS.ProcessEnv): boolean {
  try {
    const path = issuerPrivateKeyPath(issuerKeyId, env);
    return existsSync(path) && lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Loads one issuer's private key from the store.
 *
 * @param issuerKeyId - Lowercase SHA-256 identity of the matching public SPKI.
 * @param env - Environment record used to resolve the key store.
 * @returns The parsed Ed25519 private key.
 * @throws IssuerKeyError when the key is absent, a symlink, or not Ed25519.
 */
export function loadIssuerPrivateKey(issuerKeyId: string, env?: NodeJS.ProcessEnv): KeyObject {
  const path = issuerPrivateKeyPath(issuerKeyId, env);
  if (!existsSync(path)) throw new IssuerKeyError(`No private key for issuer key ${issuerKeyId} in ${issuerKeyStoreDirectory(env)}.`);
  // A symlinked key file would let a workspace-writable path decide which
  // bytes sign a receipt, which is exactly what keeping the store outside the
  // workspace is meant to prevent.
  if (lstatSync(path).isSymbolicLink()) throw new IssuerKeyError(`The private key at ${path} may not be a symbolic link.`);
  let key: KeyObject;
  try { key = createPrivateKey({key: readFileSync(path), format: 'der', type: 'pkcs8'}); } catch (error) {
    throw new IssuerKeyError(`The private key at ${path} is not a PKCS8 DER key: ${(error as Error).message}`);
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new IssuerKeyError(`The private key at ${path} is not an Ed25519 key.`);
  return key;
}

/** Lists the issuer key ids the local store currently holds. */
export function storedIssuerKeyIds(env?: NodeJS.ProcessEnv): readonly string[] {
  const directory = issuerKeyStoreDirectory(env);
  if (!existsSync(directory)) return [];
  try {
    return Object.freeze(readdirSync(directory)
      .filter((name) => name.endsWith(ISSUER_KEY_SUFFIX))
      .map((name) => name.slice(0, -ISSUER_KEY_SUFFIX.length))
      .filter((id) => /^[a-f0-9]{64}$/.test(id))
      .sort());
  } catch {
    return [];
  }
}

/**
 * Signs one receipt body over the canonical F5 frame.
 *
 * The caller passes the complete receipt minus its signature, so the framing,
 * canonicalization, and domain separation stay owned by F5 rather than being
 * re-derived here.
 *
 * @param unsigned - Complete receipt claims without `issuer_proof`.
 * @param privateKey - Ed25519 private key matching the receipt's `issuer_key_id`.
 * @returns The same receipt with its unpadded base64url detached signature.
 */
export function signPortableReceipt<T extends PortableReceipt>(
  unsigned: Omit<T, 'issuer_proof'>,
  privateKey: KeyObject,
): T {
  // `receiptSigningPayload` omits `issuer_proof` itself; the placeholder only
  // satisfies the static shape and never reaches the signed bytes.
  const payload = receiptSigningPayload({...unsigned, issuer_proof: ''} as unknown as T);
  return {...unsigned, issuer_proof: sign(null, payload, privateKey).toString('base64url')} as T;
}
