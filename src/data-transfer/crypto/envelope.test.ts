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
    // Through 0050_implicit_property_debt_accounts, which merges each kind's
    // live property/debt accounts into one: a file that carries the merged rows
    // is an ordinary set of accounts to an older build (one property account
    // named by the sentinel, holdings under it), and this build's restore applies
    // the same merge to an older file, so it needed no bump of its own.
    // Through 0051_monobank_accounts_bank_id, which gives a connected Monobank
    // account stored as `other` the id `monobank`: an older build reads either id as a
    // bank it lists or none (neither changes what a file carries), and this
    // build's restore applies the same rule to an older file, so it needed no
    // bump either.
    // Through 0052_add_exchange_pair_id, a column riding inside an existing row,
    // derived on restore: an older build restoring a file that carries it drops
    // the key, and its own database derives the pairs when it later upgrades to
    // 0052. This build's restore applies the 0052 rule to an older file, so it
    // needed no bump.
    // Through 0053_add_loan_holding_id_index, an index: it holds no data and
    // changes nothing a file carries, so it needed no bump.
    // Through 0054_add_deleted_import_keys, a new table the file carries as an
    // optional key (`deletedImportKeys`): an older build restoring such a file
    // drops the key and keeps today's rule for a re-imported deleted row, and
    // this build restores an older file with the table empty, so it needed no
    // bump (a bump would make an older build refuse every new file).
    // Through 0055_add_dismissed_tips, a column riding inside the settings row
    // (`dismissedTips`): an older build restoring a file that carries it drops
    // the key, and this build restores an older file without it as `[]` (the
    // schema default), so it needed no bump.
    migrationCount: 56,
  };

  it('has a version decision for every migration', () => {
    expect({ version: EXPORT_VERSION, migrationCount: migrationCount() }).toEqual(
      VERSION_DECISIONS,
    );
  });
});
