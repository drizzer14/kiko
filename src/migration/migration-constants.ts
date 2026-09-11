/** The retired old app's App Group — the one-time migration bridge container. */
export const OLD_APP_GROUP_ID = 'group.com.dmytro.pff';

/** Decrypted DB the export build writes into the shared container. */
export const EXPORT_DB_FILE = 'migration-export.db';

/** Plaintext secrets (Monobank token + Binance credentials) in the shared container. */
export const SECRETS_FILE = 'migration-secrets.json';
