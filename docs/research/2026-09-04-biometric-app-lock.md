# FaceID / passcode app lock — research

Date: 2026-09-04 · Status: research (not implemented)
App: bare RN 0.87.1 iOS (not Expo-managed).

## Current state
- Entry: `index.js` → `App.tsx` (`GestureHandlerRootView` →
  `SafeAreaProvider` → `MigrationsGate` → `AppRoot` →
  `NavigationContainer` → `RootNavigator`).
- No existing AppState / LocalAuthentication / lock code.
- `react-native-keychain@10` already installed; the one secret store is
  `src/monobank/token.ts` (no `accessControl` today).
- `settings` is a single-row Drizzle table — the home for a
  `lockEnabled` / `lockGraceSeconds` pref (mirror `setBaseCurrency`).
- Settings UI: `src/screens/settings/settings.screen.tsx`.
- `Info.plist` has no `NSFaceIDUsageDescription` yet.

## Library choice
Use TWO layers:
1. **`react-native-keychain` `accessControl`** (already installed) to
   biometric-gate the token AT REST — `BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE`
   + `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`, with `authenticationPrompt`.
2. **`@sbaiahmed1/react-native-biometrics`** (maintained fork) for the
   app-lock UI gate — `isSensorAvailable`, `authenticateWithOptions`
   with device-passcode fallback and lockout error codes.

Reject `expo-local-authentication` — it drags the Expo modules runtime
into a deliberately Expo-free app and would need new harness exceptions.

## Where to hook
- A `LockGate` wrapping `AppRoot`'s children, inside `MigrationsGate`
  (DB/settings ready), around `NavigationContainer`, backed by a
  `useAppLock` hook `{ isLocked, unlock() }`.
- Cold launch: locked by default when the pref is on; authenticate
  before revealing the navigator.
- Foreground: subscribe to `AppState`; timestamp on background/inactive;
  on active, re-lock if `elapsed > graceSeconds`.
- Grace period stored in `settings` (0 / 30 / 60 / 300 s).

## Background privacy
Redact the app-switcher snapshot: cover on `inactive` AND `background`.
Most reliable is a native overlay in `AppDelegate.swift`
(`applicationWillResignActive` / `applicationDidBecomeActive`); a JS
cover may not paint in time.

## Secret integration
Gate the token in `src/monobank/token.ts` (the single change point).
Reconcile the eager `readToken()` prefill in
`monobank-token-field.component.tsx` so it does not double-prompt.
Route future exchange API keys through the same module pattern.

## Fallbacks
`allowDeviceCredentials: true` for passcode fallback; check
`isSensorAvailable` for no-hardware/not-enrolled; on `PASSCODE_NOT_SET`
disable the feature with a hint; on `BIOMETRY_LOCKOUT` show a
use-passcode affordance.

## Files to touch
`package.json` (+ pod install), `Info.plist` (`NSFaceIDUsageDescription`),
`AppDelegate.swift` (overlay), `schema.ts` + migration (settings prefs),
`settings.repo.ts` (setters), new `src/auth/` (`biometrics.ts`,
`use-app-lock.ts`, `lock-gate.component.tsx`), `App.tsx` (wrap),
`token.ts` (accessControl), `monobank-token-field.component.tsx`
(defer prefill), `settings.screen.tsx` (toggle). Tests for the setters,
the grace/AppState logic, and the token options.

**Effort M** (S if cold-launch-only, no grace/snapshot polish).

## Risks
Double-prompt (app-lock + keychain read); `BIOMETRY_CURRENT_SET`
invalidation on biometric change (degrade to re-enter, not crash);
pre-existing plaintext token not protected until re-saved; snapshot
timing; `PASSCODE_NOT_SET` devices; `.npmrc` `min-release-age=7` blocks
a just-published lib version — pin ≥7-day-old.

## References
- react-native-keychain: https://oblador.github.io/react-native-keychain/
- @sbaiahmed1/react-native-biometrics: https://github.com/sbaiahmed1/react-native-biometrics
- Apple LocalAuthentication: https://developer.apple.com/documentation/localauthentication
- Snapshot redaction pattern: https://www.72technologies.com/blog/biometric-auth-react-native-face-id-keystore
