import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { bifold, eitherSync, isLeft } from 'fnts/either';

import { decodeBase64ToBytes, encodeBytesToBase64 } from '../base64/base64';

export const EXPORT_FORMAT = 'kiko-export';
export const EXPORT_VERSION = 1;

const GCM_NONCE_BYTES = 12;

export type ExportEnvelope = {
  version: typeof EXPORT_VERSION;
  format: typeof EXPORT_FORMAT;
  /** base64-encoded 12-byte GCM nonce, fresh on every encrypt. */
  nonce: string;
  /** base64-encoded AES-256-GCM output: ciphertext with the 16-byte tag appended. */
  ciphertext: string;
};

/** Encrypts `plaintext` under `key` (32 bytes) with a fresh random nonce. */
export const encryptEnvelope = (plaintext: Uint8Array, key: Uint8Array): ExportEnvelope => {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const ciphertext = gcm(key, nonce).encrypt(plaintext);

  return {
    version: EXPORT_VERSION,
    format: EXPORT_FORMAT,
    nonce: encodeBytesToBase64(nonce),
    ciphertext: encodeBytesToBase64(ciphertext),
  };
};

/**
 * Decrypts an envelope produced by `encryptEnvelope`. Throws a
 * `data-transfer/decrypt:`-prefixed Error on:
 *   - an unrecognized header (`format`/`version` mismatch),
 *   - the wrong key, or
 *   - a tampered nonce/ciphertext (`@noble/ciphers`' `gcm(...).decrypt()`
 *     verifies the 16-byte GCM tag BEFORE returning any plaintext — see its
 *     `aes-gcm: invalid tag` guard — so a bad key or a flipped byte never
 *     materializes unauthenticated bytes; this function only adds a clearer,
 *     app-level error message over that same fail-closed behavior).
 */
export const decryptEnvelope = (envelope: ExportEnvelope, key: Uint8Array): Uint8Array => {
  if (envelope.format !== EXPORT_FORMAT || envelope.version !== EXPORT_VERSION) {
    throw new Error('data-transfer/decrypt: unrecognized export file header');
  }

  const attempt = eitherSync<unknown, Uint8Array>(() => {
    const nonce = decodeBase64ToBytes(envelope.nonce);
    const ciphertext = decodeBase64ToBytes(envelope.ciphertext);

    return gcm(key, nonce).decrypt(ciphertext);
  });

  if (isLeft(attempt)) {
    throw new Error('data-transfer/decrypt: wrong key or corrupted file');
  }

  return bifold(attempt);
};
