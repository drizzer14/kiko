/**
 * iOS reports no database key, yet an encrypted database file is on disk and no populated
 * plaintext kiko.db is there to migrate. A fresh key would not open that file, so launch stops
 * before the legacy migration runs: no key is generated or stored and no file is created or
 * deleted, only probed. A later launch retries.
 */
export class DatabaseKeyMissingError extends Error {
  constructor() {
    super('The database key is missing from the Keychain; the encrypted database was left as is');
    this.name = 'DatabaseKeyMissingError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, DatabaseKeyMissingError.prototype);
  }
}
