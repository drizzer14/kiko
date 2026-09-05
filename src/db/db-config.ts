/**
 * Master switch for the SQLCipher database-encryption migration (cluster 2).
 *
 * Default OFF. When OFF, `initDatabase()` opens the LIVE PLAINTEXT `kiko.db`
 * exactly as the app did BEFORE the encryption migration shipped: it reuses
 * `migrateLegacyDatabase()` to canonicalize any surviving pre-rename `pff.db`
 * into `kiko.db`, then hands back that plaintext connection. No db key is ever
 * created or read, `assertSQLCipherBuild()` never runs, no SQLCipher build is
 * required, and no plaintext file is deleted. This keeps development redeploys
 * on a standard (non-SQLCipher) build safe and non-destructive.
 *
 * Flip this to `true` ONLY for the separate, supervised on-device migration
 * test — the app built with the SQLCipher pod, where the one-time plaintext ->
 * encrypted export in `encrypted-database.ts` is intended to run. Do not turn
 * it on for ordinary development builds.
 */
export const DB_ENCRYPTION_ENABLED = true;

/**
 * Master switch for the biometric app lock (cluster 3).
 *
 * Default OFF. While OFF, the whole app lock is inert: `useAppLock()` reports
 * `{ isReady: true, isLocked: false }` without ever reaching the native
 * biometrics module, and `unlock()` resolves `{ kind: 'success' }` without
 * importing `@sbaiahmed1/react-native-biometrics`. That matters because the
 * biometrics pod is NOT installed on a normal development build:
 * `@sbaiahmed1/react-native-biometrics` calls
 * `TurboModuleRegistry.getEnforcing('ReactNativeBiometrics')` at module load,
 * which throws (and crashes the app) when the native module is unlinked. Keeping
 * this flag OFF guarantees no runtime code path imports `src/auth/biometrics.ts`
 * (it is loaded lazily, gated on this flag), so an ordinary redeploy stays safe.
 *
 * Flip this to `true` ONLY in the separate, supervised on-device step AFTER the
 * biometrics pod has been installed (`pod install`). Do not turn it on for
 * ordinary development builds.
 */
export const APP_LOCK_ENABLED = true;
