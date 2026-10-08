/**
 * Master switch for the SQLCipher database encryption.
 *
 * **ON in every shipping build, and it must stay on.** The one-time supervised
 * plaintext -> SQLCipher migration this flag gated is complete: every device
 * running the app has already exported into `kiko-encrypted.db` and had its
 * plaintext files scrubbed (`src/db/encrypted-database.ts`).
 *
 * The flag still exists because the OFF path is a real, working code path, not
 * dead code — it is the escape hatch for a build made without the SQLCipher pod.
 * Do NOT flip it to `false` to make something build. Turning it off makes
 * `initDatabase()` open the LIVE PLAINTEXT `kiko.db` instead: `assertSQLCipherBuild()`
 * never runs, no db key is read, and every balance, transaction, IBAN and
 * masked PAN sits unencrypted on disk. It also strands the user's real data,
 * which lives in the encrypted file this path does not open. Enforced by
 * `src/db/db-config.test.ts`.
 */
export const DB_ENCRYPTION_ENABLED = true;
