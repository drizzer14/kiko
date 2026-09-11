# Kiko Pre-Submission Security Audit

## Method

This audit is a whole-app security review before App Store submission.
The worktree head is `82b9145` (clean tree). The audit was read-only and
verified against the current code with Read, Grep, and non-destructive
Bash (`git`, `grep`, `ls`). There were no network calls, no scanners, and
no edits. The auditor could not verify the live certificate-pin SPKI
values (no network was permitted) or the on-device backup and
file-protection behavior. Those items are marked as estimated. Part A
reconciles the prior findings S1–S11. Part B lists new findings. Part C
records what was verified clean.

## Part A — Reconciliation of prior findings S1–S11

The source is `docs/security/2026-09-06-security-pass-findings.md`.

| id | title | status | evidence |
|---|---|---|---|
| **S1** | `api.binance.com` unpinned | **FIXED** | `ios/Kiko/Info.plist:62-77` now pins `api.binance.com` (two SPKI CA identities) alongside `api.monobank.ua:46-61`. Host table in `docs/security/README.md:24`. |
| **S2** | Widget renders balances on locked device | **MOOT** | Widget removed. No `ios/KikoWidget/` directory; zero `NetWorthSnapshot`/`useNetWorthWidget`/`WidgetCenter`/`reloadAllTimelines` writers in `src`/`ios` (grep clean; only a stray i18n string remains). |
| **S3** | App Group snapshot plaintext and backed-up | **MOOT** | Same widget removal. The only App Group use now is the one-time migration bridge, which reads and wipes the old container; the kiko app writes no snapshot there. |
| **S4** | App lock never re-locks; dead `lock_grace_seconds` | **OPEN — accepted and documented** | Still cold-launch only: `src/auth/use-app-lock.ts:19-25,44-50`. Now formally accepted in `docs/security/README.md:142-166`, restated in the `kiko-domain` skill, and `lockGraceSeconds` pinned reader-less in `src/db/settings-columns.test.ts`. Not re-listed as new; see the Part C residual note. |
| **S5** | Token read eagerly into React state | **FIXED** | `monobank-token-field.component.tsx:41-57` calls `hasToken()` (existence only) and early-returns when connected; `src/monobank/token.ts:51-53` `hasToken` never decrypts the value. |
| **S6** | `readCredentials` re-writes secret every read | **FIXED** | `src/crypto-sync/binance/binance.credentials.ts:40,77-79` — the `hasRepairedAccessPolicy` latch gates the repair re-save to once per process. |
| **S7** | `NSAllowsLocalNetworking` in Release | **FIXED** | Absent from `ios/Kiko/Info.plist:31-36` (comment: injected Debug-only by a build phase; asserted by `scripts/checks/plist.sh`). |
| **S8** | Empty location usage string | **FIXED** | No `NSLocationWhenInUseUsageDescription` present in `ios/Kiko/Info.plist`. |
| **S9** | BTC address disclosed to `blockstream.info` | **OPEN — accepted and documented** | Unchanged behavior (`src/crypto-sync/btc-wallet/btc-wallet.client.ts:33`); now recorded in `docs/security/README.md:24,167-169`. |
| **S10** | `db-config.ts` comments contradict flags | **FIXED** | `src/db/db-config.ts:1-18,20-39` comments now say "ON in every shipping build"; `src/db/db-config.test.ts` asserts both flags `=== true`. |
| **S11** | Release signs with a development identity | **OPEN — INFO** | `ios/Kiko.xcodeproj/project.pbxproj` Release config still `CODE_SIGN_IDENTITY = "Apple Development"`. The widget target is gone, so its half of S11 is moot. This must become a distribution identity before upload. |

## Part B — New findings (most severe first)

### SEC1 — A dead, unwired code path can export all secrets in plaintext to the App Group

- **Claim:** `exportForNewApp` writes the fully decrypted database plus a
  plaintext JSON of the Monobank token and the Binance apiKey and secret
  to the shared container, with no file-protection class and no backup
  exclusion. The code stays in the kiko binary but is no longer
  reachable.
- **`file:line`:** `src/db/migration/export-for-new-app.ts:26-59` (writes
  `migration-export.db` and `migration-secrets.json`). The trigger
  `runExportWithProof` at `src/db/migration/export-self-check.ts:44-46`
  has zero callers (grep of `src`, `App.tsx`, `index.js`). The write goes
  through `WidgetBridge.writeTextFile`
  (`ios/Kiko/WidgetBridge.swift:80-92`), which uses
  `write(toFile:atomically:encoding:)` — no `NSFileProtection`, no
  `isExcludedFromBackup`.
- **Exposure:** In the current kiko app the path is unreachable, so there
  is no active leak. The risk is latent. A future dev-menu wiring, or a
  reuse of this helper, would drop every credential and a decrypted copy
  of the whole database as cleartext into a container that is included in
  iCloud and iTunes backups and readable after first unlock. This would
  undo the encryption controls. The old-app to new-app migration is
  complete, so this code has served its purpose.
- **Severity:** Low.
- **Proposed fix:** Remove `export-for-new-app.ts` and
  `export-self-check.ts` and the `writeTextFile`/`copyFile` write
  primitives from `WidgetBridge`, now that the migration is finished.
  Keep only the read and delete primitives the import still needs. If you
  keep any write, set an `NSFileProtectionComplete`-class attribute and
  `isExcludedFromBackup` on every shared-container write.

### SEC2 — The retired `group.com.dmytro.pff` App Group entitlement is still shipped

- **Claim:** The app still declares the old app's App Group, which keeps
  a shared container reachable by any process in that group.
- **`file:line`:** `ios/Kiko/Kiko.entitlements:8`
  (`group.com.dmytro.pff`), consumed only by the one-time bridge
  (`src/db/migration/migration-constants.ts:2`).
- **Exposure:** Minor. A retired `pff` app, or any target provisioned
  into that group, shares a container with kiko. The kiko app writes no
  data there and wipes the container after import, so there is nothing
  sensitive to read after the migration. But the group is attack surface
  that no longer earns its keep, and it broadens what a compromised
  sibling target could reach.
- **Severity:** Low.
- **Proposed fix:** After the migration is confirmed complete across the
  install base, drop `group.com.dmytro.pff` from the entitlement, and the
  import bridge with it. Leave only `group.com.dmytro-vasylkivskyi.kiko`.

### SEC3 — `VACUUM INTO` uses a string-interpolated path that cannot be parameterized

- **Claim:** The legacy-DB canonicalization interpolates a filesystem
  path directly into SQL.
- **`file:line`:** `src/db/migrate-legacy-db.ts:56` —
  `` legacy.executeSync(`VACUUM INTO '${kikoPath}'`) ``.
- **Exposure:** Not currently exploitable. `kikoPath` comes from
  op-sqlite's `getDbPath()`, never from user input. `VACUUM INTO` cannot
  bind a parameter, so the interpolation is unavoidable. The safety
  depends entirely on the path staying non-user-derived. This is flagged
  so that a future change that lets an external value influence the path
  is caught.
- **Severity:** Low (defensive).
- **Proposed fix:** Keep `kikoPath` sourced only from the SQLite driver's
  own path API. If the target ever becomes derived from external input,
  sanitize or allowlist it (reject quotes and path traversal) before
  interpolation.

## Part C — Verified / clean

The auditor checked these areas and found them safe in the current tree:

- **No secrets in `.env`, source, the database, or logs.** `.env` holds
  only public URLs with the public-only warning header (`.env:1-23`). No
  API key, token, or HMAC secret is hardcoded anywhere in `src`. All
  three secrets live in the Keychain under
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` with no `accessControl`: the DB key
  (`src/db/keys/db-key.ts:22-26`), the Monobank token
  (`src/monobank/token.ts:22-25`), and the Binance pair
  (`src/crypto-sync/binance/binance.credentials.ts:24-27`).
- **No secret in any URL.** The Monobank token is an `X-Token` header
  (`src/monobank/monobank.client.ts:114`). The Binance key is an
  `X-MBX-APIKEY` header, and only the HMAC digest is appended to the URL
  (`binance.client.ts:79-85`), so the secret never crosses the wire.
- **HMAC signing is correct** (`src/crypto-sync/binance/binance.hmac.ts:11-12`,
  `@noble/hashes`; the signed string is byte-identical to the query sent;
  `recvWindow` bounded at 5000 ms in `binance.client.ts:23`).
- **Zero PII in logs.** The only non-test `console.*` calls are
  diagnostic `console.warn` calls behind justified `noConsole` overrides.
  The payloads carry currency codes, counts, and provider ids only — no
  balance, IBAN, PAN, token, or credential (`src/monobank/sync.ts:358-378,1091`;
  `src/crypto-sync/binance/binance.provider.ts:209`;
  `src/crypto-sync/run-crypto-sync.ts:37`). There is no `NSLog`,
  `os_log`, or `print(` in `ios/Kiko`.
- **The SQL-injection surface is clean.** Every raw-SQL site uses
  Drizzle's `sql` tagged template with `${}` value binding, or
  interpolates only module constants (`MIGRATIONS_TABLE`, ATTACH
  aliases). The SQLCipher key is a bound parameter to `ATTACH … KEY ?`,
  never string-interpolated (`src/db/encrypted-database.ts:80`).
- **App-lock and biometrics correctness.** The cold-launch gate is
  decided once (`use-app-lock.ts`). The native biometrics module is
  `require`d lazily only inside `authenticate` and `isSensorAvailable`,
  so the OFF path never loads it (`src/auth/biometrics.ts:12-13`, with the
  flag-gate reasoning in `db-config.ts`). `NSFaceIDUsageDescription` is
  present (`Info.plist:80-81`). The flags are pinned ON by
  `db-config.test.ts`.
- **ATS.** `NSAllowsArbitraryLoads` is false (`Info.plist:37-38`).
  `NSAllowsLocalNetworking` is absent from Release. Both
  `api.monobank.ua` and `api.binance.com` are under `NSPinnedDomains`.
  The pin values were not verified against a live chain (no network).
- **The deep-link surface is nil.** There is no `CFBundleURLTypes`,
  `CFBundleURLSchemes`, or `associated-domains` in the plist or
  entitlements, and no React Navigation `linking` config. The only
  `Linking.openURL` calls target two hardcoded public `@env` constants
  (`monobank-token-field.component.tsx:65`,
  `binance-credentials-field.component.tsx:51`).
- **App Group exposure.** The kiko app never writes financial data to a
  shared container in shipping paths. The migration bridge only reads the
  old container and wipes it
  (`src/db/migration/import-from-old-app.ts:120-168`).
- **App-switcher redaction, backup exclusion, and migration
  crash-safety** are all intact
  (`ios/Kiko/AppDelegate.swift:42-125`).

## Coverage honesty

- **Verified by reading current source:** all items in Part A and Part C
  above — Keychain policies, ATS and pin presence, app-lock and
  biometrics logic, HMAC signing, SQL parameter binding, log payloads,
  deep-link absence, migration bridge wiring, entitlements, and pbxproj
  signing.
- **Estimated / not verified:** the live TLS pin correctness and rotation
  currency (no network was allowed — the openssl runbook could not run);
  the actual on-device iOS backup and file-protection behavior of App
  Group writes (reasoned from the write APIs, not observed at runtime).
  No dynamic or runtime testing was performed.
- **Top residual risk for submission (not new):** S4 — the lock is
  cold-launch only, so a resident backgrounded finance app resumes
  without Face ID. It is an accepted, documented decision, but it is the
  single largest gap between "app lock enabled" and the user expectation.
  It is worth an explicit product sign-off before the store release. S11
  (distribution signing) is a hard blocker for the upload itself.
