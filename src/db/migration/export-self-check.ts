import { open } from '@op-engineering/op-sqlite';

import { toSQLCipherRawKey } from '../keys/db-key';

import { exportForNewApp } from './export-for-new-app';

const FIXTURE_ENC = 'migration-selfcheck-enc.db';
const FIXTURE_PLAIN = 'migration-selfcheck-plain.db';
const FIXTURE_KEY = toSQLCipherRawKey('cd'.repeat(32));

/**
 * Proves the decrypt-direction `sqlcipher_export` works on THIS device's real
 * SQLCipher build before the irreversible real export runs. Throws on any
 * mismatch. Uses throwaway sandbox fixtures only — never the real DB, never a
 * secret. Returns silently on success.
 */
export const proveDecryptDirection = async (): Promise<void> => {
  const enc = open({ name: FIXTURE_ENC, encryptionKey: FIXTURE_KEY });
  await enc.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  await enc.execute("INSERT INTO t (id, v) VALUES (1, 'alpha'), (2, 'beta')");

  const plainPath = enc.getDbPath().replace(/[^/]+$/, FIXTURE_PLAIN);
  await enc.execute('ATTACH DATABASE ? AS plaintext_out KEY ?', [plainPath, '']);
  await enc.execute("SELECT sqlcipher_export('plaintext_out')");
  await enc.execute('DETACH DATABASE plaintext_out');
  enc.close();
  enc.delete();

  // Reopen the exported copy with NO key — proves it is genuinely decrypted.
  const plain = open({ name: FIXTURE_PLAIN });
  const rows = plain.executeSync('SELECT id, v FROM t ORDER BY id').rows;
  plain.close();
  plain.delete();

  const ok = rows.length === 2 && rows[0]?.v === 'alpha' && rows[1]?.v === 'beta';

  if (!ok) {
    throw new Error('Decrypt-direction self-check FAILED: refusing to export real data.');
  }
};

/** The sole dev-menu trigger: prove, then export the real data exactly once. */
export const runExportWithProof = async (): Promise<void> => {
  await proveDecryptDirection();
  await exportForNewApp();
};
