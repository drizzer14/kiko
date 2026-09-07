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

/**
 * Master switch for the biometric app lock.
 *
 * **ON in every shipping build, and it must stay on.** The supervised on-device
 * step this flag gated is complete: the biometrics pod is installed and
 * `NSFaceIDUsageDescription` is in `ios/Kiko/Info.plist`.
 *
 * The flag still exists because the OFF path guarantees the lazy
 * `require('@sbaiahmed1/react-native-biometrics')` inside `authenticate()`
 * (`loadNativeBiometrics` in `src/auth/biometrics.ts`) never runs —
 * `@sbaiahmed1/react-native-biometrics` calls
 * `TurboModuleRegistry.getEnforcing('ReactNativeBiometrics')` at module load,
 * which crashes the app when the native module is unlinked. That makes the
 * OFF path the escape hatch for a build without the pod, nothing more.
 * Do NOT flip it to `false` to make something build. Turning it off makes
 * `useAppLock()` report `{ isReady: true, isLocked: false }` unconditionally, so
 * `LockGate` never prompts and the user's enabled app lock silently stops
 * existing — the widget writer folds the same flag in
 * (`src/widget/use-net-worth-widget.ts`), so the App Group snapshot would start
 * being written again too. Enforced by `src/db/db-config.test.ts`.
 */
export const APP_LOCK_ENABLED = true;
