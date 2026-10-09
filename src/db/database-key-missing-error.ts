/**
 * The Keychain holds no database key, yet an encrypted database file is on disk
 * and there is no plaintext data to migrate. A fresh key would not open that
 * file, so launch stops here with nothing generated, stored, or deleted — the
 * key can come back on a later launch (for example once the Keychain unlocks).
 */
export class DatabaseKeyMissingError extends Error {
  constructor() {
    super(
      'The database key is missing from the Keychain; the encrypted database was left untouched',
    );
    this.name = 'DatabaseKeyMissingError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, DatabaseKeyMissingError.prototype);
  }
}
