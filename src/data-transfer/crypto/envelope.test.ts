import { migrationCount } from '@kiko/test-support/real-sqlite';

import { decodeBase64ToBytes, encodeBytesToBase64 } from '../base64/base64';

import {
  decryptEnvelope,
  encryptEnvelope,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  isReadableExportVersion,
} from './envelope';
import { generateExportKey } from './generate-key';

describe('encryptEnvelope / decryptEnvelope', () => {
  it('round-trips arbitrary plaintext under the same key', () => {
    const key = generateExportKey();
    const plaintext = new TextEncoder().encode('{"hello":"world"}');

    const envelope = encryptEnvelope(plaintext, key);

    expect(envelope.version).toBe(EXPORT_VERSION);
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(decryptEnvelope(envelope, key)).toEqual(plaintext);
  });

  it('produces a different nonce (and different ciphertext) on every call, even for identical plaintext and key', () => {
    const key = generateExportKey();
    const plaintext = new TextEncoder().encode('same plaintext');

    const first = encryptEnvelope(plaintext, key);
    const second = encryptEnvelope(plaintext, key);

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects decryption with the wrong key', () => {
    const key = generateExportKey();
    const wrongKey = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);

    expect(() => decryptEnvelope(envelope, wrongKey)).toThrow('data-transfer/decrypt');
  });

  it('rejects a tampered ciphertext (a single flipped byte)', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);
    const tamperedBytes = decodeBase64ToBytes(envelope.ciphertext);
    tamperedBytes[0] ^= 0xff;
    const tamperedEnvelope = { ...envelope, ciphertext: encodeBytesToBase64(tamperedBytes) };

    expect(() => decryptEnvelope(tamperedEnvelope, key)).toThrow('data-transfer/decrypt');
  });

  it('rejects a tampered nonce', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);
    const tamperedBytes = decodeBase64ToBytes(envelope.nonce);
    tamperedBytes[0] ^= 0xff;
    const tamperedEnvelope = { ...envelope, nonce: encodeBytesToBase64(tamperedBytes) };

    expect(() => decryptEnvelope(tamperedEnvelope, key)).toThrow('data-transfer/decrypt');
  });

  it('rejects an envelope with the wrong format/version header', () => {
    const key = generateExportKey();
    const envelope = encryptEnvelope(new TextEncoder().encode('secret'), key);

    expect(() =>
      decryptEnvelope({ ...envelope, format: 'not-kiko-export' as typeof EXPORT_FORMAT }, key),
    ).toThrow('data-transfer/decrypt');
    expect(() => decryptEnvelope({ ...envelope, version: 99 }, key)).toThrow(
      'data-transfer/decrypt',
    );
  });

  it.each(Array.from({ length: EXPORT_VERSION }, (_, index) => index + 1))(
    'still reads a file an earlier build wrote as version %d',
    (version) => {
      const key = generateExportKey();
      const plaintext = new TextEncoder().encode('{"hello":"world"}');
      const envelope = encryptEnvelope(plaintext, key);

      expect(decryptEnvelope({ ...envelope, version }, key)).toEqual(plaintext);
      expect(isReadableExportVersion(version)).toBe(true);
    },
  );
});

// A file's `version` tells an older build that a newer build wrote it (which
// then refuses it) — needed when the schema grows a column or a one-time
// upgrade step the older build lacks (2: the import-time rezone, 1.2 reminders
// and quota; an older build restoring such a file would drop them and, after
// updating, run the rezone again on already-rezoned times). Every migration
// forces a decision here: bump EXPORT_VERSION and record the new journal
// length, or, when the migration changes nothing a file carries or means,
// record the new length alone with the reason beside it.
describe('the export version against the migration journal', () => {
  const VERSION_DECISIONS = {
    version: 2,
    // Through 0049_bank_accounts_other_bank, which gives a bank account's NULL
    // bank_id the value `other`: an older build restoring a file that carries it
    // reads it as no bank, and this build's restore derives it for an older
    // file, so it needed no bump of its own.
    migrationCount: 50,
  };

  it('has a version decision for every migration', () => {
    expect({ version: EXPORT_VERSION, migrationCount: migrationCount() }).toEqual(
      VERSION_DECISIONS,
    );
  });
});
