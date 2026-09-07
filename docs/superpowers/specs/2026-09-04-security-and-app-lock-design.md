# Security hardening + biometric app lock — design spec

Date: 2026-09-04
Status: proposed (from `docs/research/2026-09-04-security-pass.md` +
`docs/research/2026-09-04-biometric-app-lock.md`), pending implementation plan
Scope owner: Kiko coordinator

## Problem

Two research passes found the app currently ships with:

1. An **unencrypted, unbackup-excluded SQLite DB** holding every balance,
   the full Monobank transaction history, and IBAN + masked PAN
   (`holdings.metadata`), a Monobank token in the Keychain with no
   `accessible`/`accessControl` policy, no TLS pinning on the
   bank-data host, and no jailbreak-detection decision on record.
2. **No app lock**: `App.tsx` renders straight from `MigrationsGate`
   into the navigator with no FaceID/passcode gate and no app-switcher
   snapshot redaction, so anyone who picks up an unlocked phone sees
   full account data immediately.

Both problems share the same primitive — the Keychain — and the same
fix for the Monobank token doubles as input to the app-lock secret
model, so this spec covers both in one document.

## Decisions (fixed)

- **Encrypt the SQLite DB with SQLCipher** via op-sqlite's
  `encryptionKey` option. The key is a random value generated once and
  stored in the Keychain, device-only. A one-time plaintext→encrypted
  migration runs behind `MigrationsGate` before the schema migrator
  runs.
- **Harden the Monobank token**: `Keychain.setGenericPassword` gets
  `accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  This keeps the silent background auto-sync read working (no
  biometric prompt on that path) while making the token
  non-migratable off-device and readable only when the device is
  unlocked.
- **Exclude the DB file from iCloud/iTunes backup** via
  `NSURLIsExcludedFromBackupKey` on the op-sqlite database file URL,
  set once at app start (or migration time).
- **Add ATS certificate pinning** for `api.monobank.ua`: a current +
  backup SPKI pin in `Info.plist` `NSPinnedDomains`, plus a rotation
  note in this repo (who owns rotating the backup pin and when).
  CoinGecko (public price data, no secret) stays unpinned.
- **Add a `no-console` Biome lint rule** to mechanize the existing
  "no `console.*` in `src`" discipline, and a **"public-only" note on
  `.env`** (only ever put values here that are safe to ship inlined in
  the bundle — never a secret). **Jailbreak detection is recorded as
  accepted risk**, not implemented.
- **App lock, two layers**:
  1. `react-native-keychain` `accessControl` on secrets at rest (the
     Monobank token gets the `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
     `accessible` policy above; this layer is about *storage*, not UI).
  2. `@sbaiahmed1/react-native-biometrics` for a `LockGate` component
     — mounted inside `MigrationsGate`, wrapping the navigator — backed
     by a `useAppLock` hook. Cold launch is locked by default when the
     `settings.lockEnabled` pref is on; an `AppState` grace period
     (stored in `settings`) decides whether foregrounding re-locks;
     device-passcode fallback (`allowDeviceCredentials: true`); and a
     native `AppDelegate.swift` overlay redacts the app-switcher
     snapshot on `applicationWillResignActive` /
     `applicationDidBecomeActive`. `NSFaceIDUsageDescription` is added
     to `Info.plist`.

## Out of scope (YAGNI)

- Biometric gating of the silent background auto-sync token read (only
  `accessible`, no `accessControl`/prompt, on that path — see F3).
- A biometric gate on every screen/action; the lock is app-wide,
  cold-launch + foreground-grace only, not a per-screen re-auth model.
- Jailbreak/root detection (F6, accepted risk).
- Reconsidering whether to store the raw IBAN at all (flagged in the
  research as worth revisiting later; not this spec).
- Pinning CoinGecko (no secret in that call).
- A settings UI for managing/rotating the pinned certificates from
  inside the app (pin rotation is a code + release change, not a
  runtime setting).
- Multi-user / per-profile lock policies.

## Current code facts (confirmed)

- `src/db/client.ts` calls `open({ name: 'pff.db' })` with no
  `encryptionKey` — the DB is plaintext today. `write()` is the one
  sanctioned mutation path (wraps `rawDatabase.transaction`), unrelated
  to this spec's changes except that the encryption key must exist
  before this module's `open()` call runs.
- `src/monobank/token.ts` calls
  `Keychain.setGenericPassword('monobank', token, { service })` with no
  `accessible`/`accessControl` option — confirmed no hardening today.
- `src/db/schema.ts`'s `settings` table is a single row
  (`id`, `baseCurrency`, `lastSyncAt`) keyed at `id = 1`
  (`SETTINGS_ID`), managed by `src/repositories/settings.repo.ts`
  (`ensure`, `setBaseCurrency`, `setLastSyncAt`) — the pattern the new
  `lockEnabled`/`lockGraceSeconds` setters must mirror.
- `App.tsx`: `GestureHandlerRootView` → `SafeAreaProvider` →
  `MigrationsGate` → `AppRoot` → `NavigationContainer` →
  `RootNavigator`. `AppRoot` calls `settingsRepo.ensure()` and
  `useAutoSync()` before rendering the navigator — confirmed no lock
  gate exists today.
- `ios/Kiko/Info.plist` has ATS on with `NSAllowsArbitraryLoads: false`
  and no `NSPinnedDomains` block yet; no `NSFaceIDUsageDescription`.
- `ios/Kiko/AppDelegate.swift` is the stock RN 0.87 template — no
  snapshot-redaction overlay exists.
- `biome.json`'s `linter.rules` has no `no-console` rule configured
  today (only `suspicious.noExplicitAny`, `correctness.*`,
  `complexity.*`, `style.*`).

## DB encryption

- `src/db/keys/db-key.ts` (new): `getOrCreateDbKey()` — reads a
  Keychain entry (a dedicated `service`, e.g. `pff.db.key`); if absent,
  generates a random key (e.g. 256-bit, base64/hex encoded) and stores
  it with `accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` (device-only,
  not exportable via encrypted backup restore, consistent with the
  token's hardening).
- `src/db/client.ts`: `open({ name: 'pff.db', encryptionKey })` where
  `encryptionKey` is resolved via `getOrCreateDbKey()` before the
  module's top-level `open()` call runs. Because `getOrCreateDbKey` is
  async and `open()` today is synchronous top-level code, this
  requires restructuring `client.ts` to defer `open()` until the key is
  available (e.g. an async `initDatabase()` called by `MigrationsGate`
  before `runMigrations()`, or a lazily-initialized singleton) — this
  is the most invasive change in the spec and needs its own
  implementation plan step.
- **One-time plaintext→encrypted migration**: on first launch after
  this ships, an existing `pff.db` file has no `encryptionKey`. Detect
  this (e.g. attempt an unencrypted `open()` first, or track a
  `dbEncrypted` flag in a location outside the DB itself, e.g.
  `MMKV`/`UserDefaults`/a marker file, since the `settings` table lives
  inside the DB being migrated) and run op-sqlite's
  `ATTACH DATABASE ... KEY '...'` + `sqlcipher_export` (or equivalent
  op-sqlite migration API) to write an encrypted copy, then swap it in.
  Runs behind `MigrationsGate`, before `runMigrations()` (schema
  migrations apply to the now-encrypted DB). A fresh install never hits
  this path — it opens encrypted from the start.
- Backup exclusion: after `open()`, set
  `NSURLIsExcludedFromBackupKey` on the DB file's `NSURL` (a small
  native call, likely via a native module or an existing package that
  exposes it — check op-sqlite's own API first before adding a new
  dependency for this one flag).

## Token hardening

- `src/monobank/token.ts`: add
  `{ service, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY }`
  to `saveToken`'s `setGenericPassword` call. `readToken` needs no
  change — `getGenericPassword` honors whatever `accessible` policy the
  stored item has. This is a storage-at-rest policy only: no
  `accessControl`/biometric prompt is added here, so the existing
  silent background auto-sync (`useAutoSync`) keeps working unchanged.
- A pre-existing token saved before this ships was stored with no
  `accessible` policy; it stays that way until the user reconnects
  (re-saves) — same risk class noted in the app-lock research
  ("pre-existing plaintext token not protected until re-saved"). No
  forced migration for this one; document it as a known gap.

## Certificate pinning

- `ios/Kiko/Info.plist`: add `NSPinnedDomains` under
  `NSAppTransportSecurity` for `api.monobank.ua` with two
  `NSPinnedCAIdentities` / SPKI-hash entries — the current leaf/
  intermediate pin and one backup pin (a different CA in the chain, or
  a pre-provisioned next-rotation key), per Apple's ATS pinning format.
- A short rotation runbook lives alongside the Info.plist change (a
  comment or a `docs/` note): who/when to refresh the pins before
  Monobank's certificate expires, and what breaks (all Monobank calls
  fail closed) if the pins go stale without a rotation.
- CoinGecko (`src/rates/coingecko.ts`, `@env`-sourced `PRICE_ENDPOINT`)
  is explicitly NOT pinned — no secret travels over that call.

## Lint / env / accepted risk

- `biome.json`: add a `no-console`-equivalent rule under
  `linter.rules.suspicious` (Biome's rule name — confirm exact key,
  likely `noConsole` or `noConsoleLog`) set to `"error"`, mechanizing
  the existing convention instead of relying on manual review.
- A one-line comment/README note next to `.env` (or in this spec, or
  in `CLAUDE.md`'s dependency-hygiene-adjacent section) stating: only
  public, non-secret values belong in `.env` — `react-native-dotenv`
  inlines values into the JS bundle at build time, so anything placed
  there ships in plaintext to every device.
- Jailbreak detection: recorded here as an accepted risk for a
  single-user personal app, not implemented. Revisit only if the
  threat model changes (e.g. multi-user, or a data-sharing feature is
  added).

## App lock

- **New `src/auth/` module**:
  - `biometrics.ts` — thin wrapper over
    `@sbaiahmed1/react-native-biometrics`: `isSensorAvailable()`,
    `authenticate(prompt)` calling `authenticateWithOptions` with
    `allowDeviceCredentials: true`, mapping its error codes
    (`PASSCODE_NOT_SET`, `BIOMETRY_LOCKOUT`, `BIOMETRY_CURRENT_SET`
    invalidation) to a small result union the hook consumes.
  - `use-app-lock.ts` — `useAppLock(): { isLocked, unlock }`. Reads
    `settings.lockEnabled` / `settings.lockGraceSeconds` via the
    existing live-query pattern. Subscribes to `AppState`: on
    `background`/`inactive`, stamp `Date.now()`; on `active`, compare
    elapsed time to `lockGraceSeconds` and re-lock if exceeded (or
    `lockGraceSeconds === 0` means always re-lock). Cold launch starts
    locked whenever `lockEnabled` is true.

    > **Superseded (2026-09-06):** the `AppState` grace period described in this
    > bullet was built and then replaced. What ships locks only at cold launch and
    > never re-locks; `settings.lockGraceSeconds` has no reader. Accepted, with
    > its limitation stated, in `docs/security/README.md`. The
    > `setLockGraceSeconds` setter and the grace-period picker described further
    > down were not shipped either.
  - `lock-gate.component.tsx` — `LockGate`: while `isLocked`, renders a
    full-screen unlock prompt (biometric icon + "Unlock" affordance +
    passcode fallback messaging) instead of `children`; calls
    `unlock()` on mount and on retry tap.
- **`App.tsx`**: wrap `AppRoot`'s `NavigationContainer` subtree in
  `LockGate`, inside `MigrationsGate` (DB/settings must be ready first
  — `LockGate` reads `settings.lockEnabled`) and inside
  `GestureHandlerRootView`/`SafeAreaProvider` (so the unlock screen
  itself renders through the same providers).
- **`src/db/schema.ts`**: add `lockEnabled` (integer/boolean, default
  0) and `lockGraceSeconds` (integer, default e.g. 30) to the
  `settings` table; a new Drizzle migration.
- **`src/repositories/settings.repo.ts`**: add `setLockEnabled(bool)`
  and `setLockGraceSeconds(seconds)`, mirroring `setBaseCurrency`'s
  `write((tx) => tx.update(settings).set({...}).where(eq(settings.id, SETTINGS_ID)))`
  shape.
- **`src/screens/settings/settings.screen.tsx`**: add a lock toggle +
  grace-period picker (0/30/60/300s), following the existing
  base-currency setting's UI pattern. On enabling, check
  `isSensorAvailable()` first; if `PASSCODE_NOT_SET` or no hardware,
  disable the toggle with an explanatory hint instead of silently
  failing.
- **`ios/Kiko/Info.plist`**: add `NSFaceIDUsageDescription` with a short
  user-facing string ("Unlock Kiko with Face ID").
- **`ios/Kiko/AppDelegate.swift`**: add a snapshot-redaction overlay —
  a plain `UIView` (solid background, or the launch screen) added to
  the key window on `applicationWillResignActive`/
  `applicationDidEnterBackground` and removed on
  `applicationDidBecomeActive`, so the app-switcher snapshot never
  shows real account data. A pure-JS cover is explicitly rejected per
  the research (timing risk — it may not paint before the snapshot is
  taken).
- **`monobank-token-field.component.tsx`**: reconcile its eager
  `readToken()` prefill so it does not trigger a second, redundant
  Keychain read/prompt on top of the app-lock gate (check this file's
  current prefill behavior during implementation; the token read
  itself has no `accessControl` prompt per this spec's token
  decision, so today this is a double-*read*, not a double-*prompt* —
  confirm no regression either way).

## Edge cases

- `BIOMETRY_CURRENT_SET` invalidation (user added/removed a fingerprint
  or face) degrades to requiring the device passcode (via
  `allowDeviceCredentials`) — never a crash or a permanent lockout. If
  the invalidated item was the DB key or the token, this spec's items
  are `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (no biometric `accessControl`),
  so they are unaffected by biometry invalidation; only the `LockGate`
  UI layer is.
- `PASSCODE_NOT_SET` device: the lock toggle is disabled at the
  settings UI with a hint, not silently offered then broken at
  runtime.
- `BIOMETRY_LOCKOUT` (too many failed attempts): `LockGate` shows a
  "use passcode instead" affordance rather than retrying biometrics.
- A pre-existing plaintext Monobank token (saved before this ships)
  stays unprotected by `accessible` until the user reconnects — a
  documented, accepted gap, not a silent failure.
- Losing/rotating a backup TLS pin without updating the app: all
  Monobank calls fail closed (safer default than failing open); the
  rotation runbook exists specifically to prevent this.
- DB key present in Keychain but the DB file itself was deleted (e.g.
  app data cleared): `open()` with a key against a missing file just
  creates a fresh encrypted DB — no special-case needed, but the
  migration-detection logic (above) must not misfire in this case
  (nothing to migrate from).

## Testing (TDD)

Unit tests, written before the implementation:

- `db-key.ts`: `getOrCreateDbKey()` returns the same key on repeat
  calls (idempotent, no double-generation); generates a fresh key only
  when none exists.
- `token.ts`: `saveToken` is called with the expected `accessible`
  option (mock `Keychain.setGenericPassword`, assert call args).
- Plaintext→encrypted DB migration: given a pre-existing plaintext DB
  fixture, the migration produces a readable encrypted DB with
  identical row data, and a fresh install skips the migration path
  entirely (mock/fixture-driven, not a real op-sqlite file in CI if
  that is impractical — decide during planning).
- `settings.repo`: `setLockEnabled` / `setLockGraceSeconds` update the
  single settings row (mirrors the existing `setBaseCurrency` test
  pattern).
- `use-app-lock`: grace-period math — foregrounding before
  `lockGraceSeconds` elapsed stays unlocked; foregrounding after
  re-locks; `lockGraceSeconds === 0` always re-locks; cold launch with
  `lockEnabled: false` never locks.
- `biometrics.ts`: error-code mapping for `PASSCODE_NOT_SET`,
  `BIOMETRY_LOCKOUT`, and a successful authenticate resolve to the
  right result union member (mock the native module).
- `LockGate`: renders the unlock prompt when locked, renders children
  when unlocked, calls `unlock()` on mount.
- No integration/E2E test for the AppDelegate snapshot overlay or real
  Face ID hardware — out of reach for Jest/RNTL; verify manually on
  device (app-switcher screenshot check) before declaring done.

## Affected files (initial map)

- `src/db/client.ts` — `open()` restructured to accept/await the
  encryption key.
- `src/db/keys/db-key.ts` (new) + test.
- `src/db/migrations.gate.tsx` — run the plaintext→encrypted migration
  before `runMigrations()`.
- `src/db/run-migrations.ts` or a new sibling — the one-time DB
  migration logic.
- `src/monobank/token.ts` — `accessible` option on `saveToken`.
- `ios/Kiko/Info.plist` — `NSPinnedDomains`, `NSFaceIDUsageDescription`.
- `ios/Kiko/AppDelegate.swift` — snapshot-redaction overlay.
- `biome.json` — `no-console` rule.
- `src/db/schema.ts` — `lockEnabled`, `lockGraceSeconds` columns + new
  migration.
- `src/repositories/settings.repo.ts` — new setters.
- `src/auth/biometrics.ts`, `src/auth/use-app-lock.ts`,
  `src/auth/lock-gate.component.tsx` (all new) + tests.
- `App.tsx` — wrap with `LockGate`.
- `src/screens/settings/settings.screen.tsx` — lock toggle + grace UI.
- `src/monobank/monobank-token-field.component.tsx` — prefill
  reconciliation check.
- `package.json` (+ `pod install`) — new
  `@sbaiahmed1/react-native-biometrics` dependency.
- `.npmrc` `min-release-age-exclude` and/or a pinned ≥7-day-old
  version — see assumptions below.
- `knip.json` / `.depcheckrc.json` — likely a new ignore entry if the
  new native dep's usage pattern trips either tool the same way
  `react-native-screens`/`react-native-nitro-modules` do today (confirm
  during implementation, do not pre-emptively add an unverified
  exception).

## Assumptions to confirm

1. **Security and app lock are combined into one spec/effort here**
   because they share the Keychain-hardening work (the token's
   `accessible` policy and the DB key's storage policy are the same
   primitive). If the user prefers to plan/implement/review these as
   two separate efforts (e.g. two worktrees, two PRs), split this spec
   into two before writing an implementation plan.
2. **The new native dependency `@sbaiahmed1/react-native-biometrics`**
   needs: a `pod install` (native module, like the recent
   reanimated/gesture-handler/sortables additions), a check of whether
   it trips `knip`/`depcheck` false-positives the way
   `react-native-screens`/`react-native-nitro-modules`/
   `react-native-bottom-tabs` do today (add a documented ignore-list
   entry in `CLAUDE.md` only if verified, not preemptively), and a
   `.npmrc`-safe version pin — `min-release-age=7` will reject a
   version published in the last 7 days, so the exact version string
   used in `package.json` must be confirmed ≥7 days old at
   implementation time (or added to `min-release-age-exclude` with the
   same category of justification as the existing `Kiko`/
   `react-native` entries, if warranted).
3. **`BIOMETRY_CURRENT_SET` invalidation** (the user adds/removes a
   fingerprint or Face ID enrollment after the app already gated a
   secret on the old enrollment) is designed to **degrade to
   device-passcode re-entry**, never a crash or permanent lockout —
   this spec's token/DB-key items use `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
   (no biometric `accessControl`) specifically to sidestep this for
   secrets at rest; only the `LockGate` UI layer (which does use
   biometric auth) needs the passcode-fallback handling. Confirm this
   reasoning holds once `@sbaiahmed1/react-native-biometrics`'s actual
   error-code surface is inspected during implementation.
