# Kiko whole-app security audit — commit `e36213c`

Date: 2026-09-06 · Status: findings recorded, not implemented
Audited by: the kiko reviewer agent (read-only). No code was written.

## 1. Scope and method

**Commit audited:** `e36213c6321a0d63db7e4c923ff30493c45395db` ("feat: v1 transactions, net-worth widget, i18n, and native-iOS UI round"), branch `main`. Working tree clean at audit time. No file was written or modified; only read-only `git log`/`rev-parse`/`ls-files` were run.

**Documents read:** `docs/research/2026-09-04-security-pass.md`, `docs/security/README.md`, `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`, `docs/superpowers/specs/2026-09-05-net-worth-widget-design.md`, `CLAUDE.md`, `rules/semgrep-mobile.yml`, `.gitleaks.toml`, `.npmrc`, `biome.json`.

**Skills:** the `kiko-architecture`, `kiko-domain`, and `kiko-widget` skills are user-level skills, not part of the `kiko` plugin in this checkout (`harness/kiko/skills/` ships only `harness-workflow`, `retrospect`, `ops`, `design-system`). Architecture/domain/widget invariants were checked against the code and the design specs.

**Code read in full:** all of `src/db/**`, `src/monobank/**`, `src/crypto-sync/**`, `src/auth/**`, `src/widget/**`, `src/rates/*.ts` clients, the three credential-input components, `App.tsx`, `ios/Kiko/AppDelegate.swift`, `ios/Kiko/WidgetBridge.{swift,m}`, all four `ios/KikoWidget/*.swift`, both `Info.plist`s, both `.entitlements`, `ios/Podfile`, the `XCBuildConfiguration` blocks of `ios/Kiko.xcodeproj/project.pbxproj`, `babel.config.js`, `metro.config.js`, `.env`, `drizzle/migrations/0012`+`0013`.

**Commands run and their output:**

`npm run check:security` — exit 0, silent (pass):
```
> Kiko@0.0.1 check:security
> bash scripts/checks/security.sh
```

`npm run check:secrets` — exit 0, silent (pass):
```
> Kiko@0.0.1 check:secrets
> bash scripts/checks/secrets.sh
```

`bash scripts/checks/osv.sh` — FAILED (expected; matches the accepted-debt list):
```
Total 2 packages affected by 3 known vulnerabilities (0 Critical, 2 High, 1 Medium, 0 Low, 0 Unknown) from 1 ecosystem.
| https://osv.dev/GHSA-vcc3-ghjq-m6fr | 6.6  | npm | decode-uri-component | 0.2.2 | 0.5.0 |
| https://osv.dev/GHSA-5p2g-fcmc-qvqq | 8.7  | npm | image-size           | 1.2.1 | --    |
| https://osv.dev/GHSA-w3rx-r6r6-pgpr | 8.7  | npm | image-size           | 1.2.1 | --    |
```
**No NEW CVE.** All three are exactly the accepted debt recorded in `CLAUDE.md` ("Known dependency CVEs").

**Pin rotation runbook re-run** (`docs/security/README.md` step 1, executed verbatim against the live host):
```
cert1: subject=CN=monobank.ua notAfter=Mar 10 23:59:59 2027 GMT  SPKI=9C7Ylw+j3lXV/wphskz8+ZqUy1hG4/3dsBe3alQjmCA=
cert2: subject=C=US, O=Amazon, CN=Amazon RSA 2048 M01 notAfter=Aug 23 22:21:28 2030 GMT  SPKI=DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=
cert3: subject=C=US, O=Amazon, CN=Amazon Root CA 1 notAfter=Dec 31 01:00:00 2037 GMT  SPKI=++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=
```
Both pinned values in `ios/Kiko/Info.plist:50` and `:54` match the live chain exactly. **Pins are current as of 2026-09-06.**

---

## 2. Status of previous findings F1–F8

| id | title | status | evidence |
|---|---|---|---|
| F1 | SQLite DB unencrypted | **FIXED** | `src/db/encrypted-database.ts:139` opens with `encryptionKey`; `src/db/db-config.ts:17` `DB_ENCRYPTION_ENABLED = true`; `package.json` `"op-sqlite": { "sqlcipher": true }`; build asserted at `encrypted-database.ts:59-65` |
| F2 | DB in iCloud/iTunes backups | **FIXED (for the DB)** | `ios/Kiko/AppDelegate.swift:99-113` sets `isExcludedFromBackup` on `kiko-encrypted.db`/`kiko.db`/`pff.db` × `""/-wal/-shm/-journal`, at launch (`:32`) and on every background (`:48`). Directory is correct: op-sqlite defaults to `NSLibraryDirectory` (`node_modules/@op-engineering/op-sqlite/ios/OPSQLite.mm:40-42`), matching `AppDelegate.swift:101`. **See S3** — the new widget snapshot re-opens this leak for derived data. |
| F3 | Keychain token not device-only | **FIXED** | `src/monobank/token.ts:22-25` `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, applied on `saveToken` (`:28`) and on the legacy-migration path (`:62`) |
| F4 | No TLS certificate pinning | **PARTIAL** | `ios/Kiko/Info.plist:40-58` pins `api.monobank.ua`, pins re-verified above. But a **second** secret-bearing host now exists and is unpinned — `api.binance.com`, `src/crypto-sync/binance/binance.client.ts:65-68`. **See S1.** |
| F5 | Build-time `@env` | **FIXED** | `.env:1-8` carries the public-only warning header; all five values are public URLs (`.env:11,14,17,20,23`); `CLAUDE.md` has the "`.env` is public-only" section |
| F6 | No jailbreak detection | **ACCEPTED (as designed)** | `docs/security/README.md:63-66` |
| F7 | Logging | **FIXED** | `biome.json:42` `"noConsole": "error"`; grep of all of `src/` + `App.tsx` returns zero non-test `console.*`; grep of `ios/Kiko` + `ios/KikoWidget` returns zero `NSLog`/`os_log`/`print(` |
| F8 | Dependency CVEs | **UNCHANGED, tracked** | osv output above matches `CLAUDE.md` exactly; no new advisory |

**Accepted-risk register re-verification (`docs/security/README.md:62-87`) — all four still hold true in code:**
- Legacy-service token migration applies the hardened policy: confirmed, `src/monobank/token.ts:62`.
- Migration ordering (export → store key → delete plaintext): confirmed, `src/db/encrypted-database.ts:95-113`, comment at `:85-94` matches the code.
- `randomblob()` key source: confirmed, `src/db/keys/db-key.ts:35-46`.
- Raw IBAN in `holdings.metadata`: confirmed still stored, `src/monobank/sync.ts:130`.

---

## 3. New findings

### S1 — `api.binance.com` carries an API key but is not pinned (MEDIUM)

**Files:** `ios/Kiko/Info.plist:40-58` (only `api.monobank.ua` under `NSPinnedDomains`); `src/crypto-sync/binance/binance.client.ts:65-68` (sends `X-MBX-APIKEY`); `docs/security/README.md:9-15` (states the rationale "the only host carrying the personal token").

**Issue.** When F4 shipped, Monobank was the only secret-bearing host, so the pinning decision was "pin Monobank, skip CoinGecko (no secret)". The Binance integration added a second host that carries a credential in a request header, and the pinning policy was not revisited. `Info.plist` still pins exactly one domain.

**Exploitation.** A malicious root CA — an MDM profile, a coerced or socially-engineered configuration profile, a jailbroken device with an injected trust anchor — MITMs `api.binance.com`. The attacker (a) reads the `X-MBX-APIKEY` value, (b) reads the full `/api/v3/account` response, i.e. every spot balance, and (c) can replay the captured signed request inside the 5-second `recvWindow` (`binance.client.ts:23`). The HMAC secret itself never crosses the wire (`binance.hmac.ts:11-12` signs locally; only the digest is appended), so the attacker cannot forge *new* signed requests from this alone — which is why this is MEDIUM and not HIGH. An **active** MITM can additionally forge a balance response and poison the user's net worth, since nothing validates the payload beyond its shape.

**Recommended fix.** Add `api.binance.com` to `NSPinnedDomains` with a primary (root CA) and backup (intermediate) SPKI pin computed by the same openssl runbook already in `docs/security/README.md`, and extend the runbook's rotation table to cover both hosts. Decide and record explicitly whether `blockstream.info` and the two public rate hosts stay unpinned. Update the README's "the only host carrying the personal token" sentence, which is now factually wrong.

**Effort:** M. **Mechanizable:** partially — see rule idea H3.

---

### S2 — The net-worth widget renders full financial data on a locked device, bypassing the app lock (HIGH)

**Files:** `ios/KikoWidget/NetWorthWidgetView.swift:1-121` (no `.privacySensitive()` and no `redacted(reason:)` anywhere in the file); `ios/KikoWidget/NetWorthWidget.swift:58-63` (`StaticConfiguration`, `.systemMedium`); `src/widget/use-net-worth-widget.ts:93-143` (writer has no app-lock awareness); `src/db/db-config.ts:37` (`APP_LOCK_ENABLED = true`).

**Issue.** `LockGate` (`App.tsx:60-62`) is the app's entire confidentiality boundary for balances. The widget extension is a separate process that reads a file the app already wrote and renders it unconditionally. Nothing in the SwiftUI view tree is marked privacy-sensitive, so WidgetKit never redacts it. `useNetWorthWidget` is mounted inside `AppRoot`, which sits *below* `LockGate`, so the app correctly does not *write* while locked — but the previously written snapshot stays on disk and keeps rendering.

**Exploitation.** The adversary picks up the locked phone. With iOS defaults, Today View / Search is reachable from the Lock Screen (`Settings > Face ID & Passcode > Allow Access When Locked > Today View and Search`, ON by default), and StandBy also surfaces widgets while the device is locked. A `systemMedium` widget placed there renders `snapshot.total.formatted` at 48pt (`NetWorthWidgetView.swift:55-59`) plus the complete per-currency breakdown (`:74-101`) with no authentication at all. A user who deliberately enabled App Lock has every reason to believe this data is gated; it is not.

Note also that the exposure is broader than "the total": the snapshot carries the **per-currency breakdown** (`src/widget/net-worth-snapshot.ts:17,32-36`) and a 30-day **trend series** (`:37`), i.e. a wealth history, not a single number.

**Recommended fix.** Three parts, all needed. (1) Mark the money-bearing subviews privacy-sensitive so WidgetKit redacts them on a locked device, leaving the "Net worth" label visible. (2) Make the snapshot lifecycle lock-aware: when `settings.lockEnabled` is turned on, have the app clear (or reduce to a placeholder) the App Group snapshot so the redaction is defence-in-depth rather than the only control; when it is turned off, rewrite it. (3) Decide explicitly, and record in `docs/security/README.md`, whether the breakdown and trend belong in the snapshot at all, or whether the widget should carry only the formatted total.

**Effort:** M. **Mechanizable:** yes — rule idea H1.

---

### S3 — The App Group snapshot is plaintext, backed up, and has no file-protection class (MEDIUM)

**Files:** `ios/Kiko/WidgetBridge.swift:44-51` (`try json.write(to: fileURL, atomically: true, encoding: .utf8)` — no `NSFileProtection` attribute, no `isExcludedFromBackup`); `ios/Kiko/AppDelegate.swift:99-113` (backup exclusion covers only the three `Library/` DB base names, not the App Group container); `ios/Kiko/Kiko.entitlements:5-8` and `ios/KikoWidget/KikoWidget.entitlements:5-8` (`group.com.dmytro.pff`).

**Issue.** F1 and F2 went to real lengths to ensure balances are SQLCipher-encrypted at rest and never enter a backup. The widget then writes a **cleartext JSON derivative of exactly that data** — total, per-currency breakdown, 30-day trend — to `net-worth-snapshot.json` in the App Group container, which iOS **does** include in iCloud/iTunes backups and which inherits the default `NSFileProtectionCompleteUntilFirstUserAuthentication` (readable on disk whenever the device has been unlocked once since boot).

**Exploitation.** Two paths in the stated threat model. (a) *Unencrypted backup*: the adversary restores or browses a Finder/iTunes backup and reads the user's net worth and currency composition in plain JSON — the exact outcome F2 was written to prevent, reintroduced through the back door. (b) *Jailbroken / forensically-imaged device*: the App Group container is readable after first unlock without any Keychain access, whereas the DB requires the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` key.

**Recommended fix.** Set `isExcludedFromBackup` on the snapshot file URL immediately after writing it, in the same way `AppDelegate.excludeDatabaseFilesFromBackup` does for the DB, and set an explicit file-protection class. `NSFileProtectionComplete` would be the strongest, but it makes the file unreadable while the device is locked, which the widget requires — so `CompleteUntilFirstUserAuthentication` is the correct explicit choice, set deliberately rather than inherited. Combine with S2: if the snapshot is cleared while the lock is enabled, both exposures shrink together. Consider trimming the payload to the minimum the widget actually renders.

**Effort:** S. **Mechanizable:** yes — rule idea H2.

---

### S4 — The app lock never re-locks; `lock_grace_seconds` is a dead schema column (MEDIUM)

**Files:** `src/auth/use-app-lock.ts:19-34` (doc comment: "Once unlocked, the app never re-locks for the life of the process"), `:43-49` (the only lock decision, guarded by `locked !== undefined`, so it runs exactly once); no `AppState` subscription anywhere in `src/auth/`. Dead column: `src/db/schema.ts:129` `lockGraceSeconds`, `drizzle/migrations/0011_add_lock_settings.sql:2`; no setter in `src/repositories/settings.repo.ts` (only `setLockEnabled` at `:25-27`) and no reader anywhere in `src/`.

**Issue.** The approved design spec (`docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md:198-203`) specified an `AppState` grace period: stamp on `background`/`inactive`, compare on `active`, re-lock past `lockGraceSeconds`. The shipped implementation locks only at cold launch. The schema column survives from the abandoned design with no setter and no reader — precisely the "removed feature leaves a live-but-unread column" pattern. Neither `docs/security/README.md` nor the spec records that the re-lock was dropped, so the written security posture overstates what ships.

**Exploitation.** The adversary obtains the phone while Kiko is backgrounded but its process is still resident — the common case, since iOS keeps a foreground-recent app alive for a long time and the user's own device passcode is the only other barrier. Unlocking the device and tapping Kiko resumes straight into the navigator with full balances and transaction history, no Face ID prompt. The lock only ever helps after iOS has killed the process. Note the app-switcher overlay (`AppDelegate.swift:72-86`) is well built and does hide the snapshot — but it protects the thumbnail, not the resumed app.

**Recommended fix.** Decide and then make the code and the docs agree. Either (a) implement the foreground re-lock the spec called for, driven by an `AppState` listener and the existing `lockGraceSeconds` column plus a settings setter and UI, or (b) formally accept "cold-launch-only lock" as the design, record it as an accepted risk in `docs/security/README.md` with its concrete limitation stated, and drop `lockGraceSeconds` from the schema in a new migration so no unread column lingers. Do not leave the current split state.

**Effort:** M (option a) / S (option b). **Mechanizable:** partially — rule idea H5.

---

### S5 — The Monobank token is eagerly read into React component state (LOW)

**File:** `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx:37-48`, with the connected-state early return at `:96-102`.

**Issue.** The effect calls `readToken()` and pushes the plaintext token into `useState` on every mount. Because hooks run before the `isConnected` early return at `:96`, this happens **even when the field is not rendered** — the token is pulled out of the Keychain and parked in the React tree for a screen that will never show it. The design spec flagged exactly this prefill for reconciliation (`2026-09-04-security-and-app-lock-design.md:236-242`); it was left as-is.

**Exploitation.** Low, and needs an already-compromised device: a jailbroken device or an attached debugger can read the JS heap / React state and recover the bank token, whereas otherwise it lives only in the Keychain under `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. It also lengthens the token's in-memory lifetime for no user-visible benefit, since `secureTextEntry` means the value is never displayed anyway.

**Recommended fix.** Do not prefill a stored secret into an editable field. Show a "token saved" indicator instead, and require re-entry to change it. At minimum, skip the read entirely when `isConnected` is true, and clear the state on unmount.

**Effort:** S. **Mechanizable:** yes — rule idea H4.

---

### S6 — `readCredentials` re-writes the Binance secret to the Keychain on every read (LOW)

**File:** `src/crypto-sync/binance/binance.credentials.ts:42-59`, specifically the unconditional `await saveCredentials(value)` at `:56`.

**Issue.** The doc comment at `:34-40` describes this as a migration off the old `BIOMETRY_CURRENT_SET` policy, but the call is unconditional — there is no check of the item's current accessibility, so every single read (i.e. every pull-to-refresh and every crypto sync) performs a full Keychain write of the API key and secret.

**Exploitation.** Not directly exploitable. The concern is failure-mode surface: a write that fails partway (device under memory pressure, Keychain contention) turns a routine read path into a path that can disturb stored credentials, and it repeatedly re-serialises the secret through JS for no reason. It also makes the "read" path non-idempotent, contrary to how `readToken` (`src/monobank/token.ts:31-34`) and `readDbKey` (`src/db/keys/db-key.ts:11-15`) behave.

**Recommended fix.** Perform the re-save once — gate it on a persisted "credentials migrated" marker, or on actually observing the legacy accessibility policy — rather than on every read. Keep reads pure.

**Effort:** S. **Mechanizable:** no (semantic).

---

### S7 — `NSAllowsLocalNetworking` is enabled in the shipped Release Info.plist (LOW)

**File:** `ios/Kiko/Info.plist:33-34`.

**Issue.** ATS is otherwise correctly configured (`NSAllowsArbitraryLoads` false at `:31-32`), but `NSAllowsLocalNetworking: true` exempts `.local`, loopback, and link-local addresses from ATS. This is a Metro-dev-server convenience. It ships in Release, where `AppDelegate.swift:125` loads the packaged `main.jsbundle` and no local host is ever contacted.

**Exploitation.** Narrow: it permits cleartext HTTP to a local-network host from the shipped binary. It does not itself cause such a connection — no app code targets a local host — so this is a hardening gap, not an active leak. On a hostile Wi-Fi with a spoofed `.local` responder it removes one layer that would otherwise fail closed.

**Recommended fix.** Remove the key from the shipped plist, or split it into a Debug-only plist / xcconfig-driven value so Release never carries it.

**Effort:** S. **Mechanizable:** yes — rule idea H6.

---

### S8 — Empty `NSLocationWhenInUseUsageDescription` for a capability the app never uses (LOW)

**File:** `ios/Kiko/Info.plist:62-63` — the key is present with an empty `<string></string>`.

**Issue.** The app requests no location anywhere (no location import or call in `src/` or `ios/`). Declaring the key advertises a capability the app does not use, and an **empty** purpose string is a well-known App Store review rejection trigger — directly relevant given App Store publishing is the next item on the project backlog.

**Recommended fix.** Delete the key. If some transitive pod genuinely needs it, supply a real, honest purpose string and record why in `docs/security/README.md`.

**Effort:** S. **Mechanizable:** yes — a plist assertion in `scripts/checks/` (no non-empty-purpose-string key that the app does not use).

---

### S9 — Every BTC sync discloses the wallet address to a third-party explorer over an unpinned connection (LOW, privacy)

**Files:** `src/crypto-sync/btc-wallet/btc-wallet.client.ts:33` (`${BTC_EXPLORER_ENDPOINT}/address/${encodeURIComponent(address)}`); `.env:17` (`https://blockstream.info/api`); `src/crypto-sync/btc-wallet/btc-wallet.provider.ts:36-51`.

**Issue.** Each sync sends the user's Bitcoin address to Blockstream, which learns `(address, source IP, timestamp)` and can build a timeline correlating a specific wallet with a specific network location. That is inherent to using a public explorer and is a reasonable engineering choice — but it is a genuine privacy consequence that appears nowhere in the accepted-risk register. The host is also unpinned, so an active MITM can forge `chain_stats` and misreport the balance (`btc-wallet.client.ts:37`); there is no secret to steal on this call.

The address itself is correctly handled everywhere else: format-validated before use (`bitcoin-address.ts:7-11`, applied at `btc-wallet.provider.ts:43-45` and again in the UI at `wallet-address-field.component.tsx:49`), URL-encoded at `btc-wallet.client.ts:33`, and deliberately kept out of the Keychain as public data (`btc-wallet.provider.ts:11-16`).

**Recommended fix.** Record this as an accepted risk in `docs/security/README.md`, naming the explorer and what it learns, so the decision is explicit. If the privacy cost is judged too high, the alternatives are a user-configurable explorer endpoint or a self-hosted Esplora instance — both larger changes than this finding warrants.

**Effort:** S (documentation). **Mechanizable:** no.

---

### S10 — `db-config.ts` doc comments contradict the shipped flag values (LOW)

**File:** `src/db/db-config.ts:1-17` and `:19-37`.

**Issue.** Both comments state "Default OFF" and instruct the reader "Do not turn it on for ordinary development builds", while the actual values are `DB_ENCRYPTION_ENABLED = true` (`:17`) and `APP_LOCK_ENABLED = true` (`:37`). The comments describe a supervised-migration-test stage that has since completed.

**Exploitation.** Not an attack, an accident — which is squarely in this threat model. A future agent or human reading "Default OFF … do not turn it on" as authoritative may "restore" the documented default and silently ship a build with an **unencrypted database** (the plaintext `kiko.db` path at `client.ts:56`) and **no app lock**. Given the harness deliberately drives changes from doc comments, this is a realistic regression path for the repo's two most important controls.

**Recommended fix.** Rewrite both comments to state that the flags are now ON in shipping builds, why they exist (the one-time supervised migration), and what breaks if they are flipped off. Ideally add a test asserting both are `true`, so flipping one fails CI rather than shipping.

**Effort:** S. **Mechanizable:** yes — a Jest assertion is the simplest form.

---

### S11 — Release configuration signs with a development identity (INFO)

**File:** `ios/Kiko.xcodeproj/project.pbxproj:429-430` (Release block for target `Kiko`: `CODE_SIGN_IDENTITY = "Apple Development"`).

Not a runtime vulnerability. Flagged because App Store publishing is the next backlog item and this will need to become a distribution identity; the widget target's Release block (`:641-668`) has no explicit `CODE_SIGN_IDENTITY` at all and will inherit. Verify signing and the App Group's provisioning across **both** targets before the first upload.

**Effort:** S. **Mechanizable:** no.

---

## 4. Confirmed good — do not regress

- **DB encryption end to end.** SQLCipher build asserted before use (`src/db/encrypted-database.ts:59-65`); raw 256-bit key, no PBKDF2 (`src/db/keys/db-key.ts:48-53`); key never `Math.random` (`:35-46`). **The key never appears in SQL text** — it is passed as a *bound parameter* to `ATTACH … KEY ?` (`encrypted-database.ts:80`), not string-interpolated. Preserve this exactly.
- **Crash-safe migration ordering** (`src/db/encrypted-database.ts:95-113`): export → persist key → close → scrub plaintext, with the reasoning documented at `:85-94` and the residual window accepted in `docs/security/README.md:74-81`. Both plaintext residues (`kiko.db`, `pff.db`) are scrubbed on every keyed launch (`:115-121`).
- **Keychain policies are consistent and deliberate.** All three secrets use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` with **no** `accessControl`: DB key (`db-key.ts:23-26`), Monobank token (`token.ts:22-25`), Binance pair (`binance.credentials.ts:24-27`). The comments explain why a biometric `accessControl` was deliberately removed (it prompted on every silent sync). Do not "harden" these back to `BIOMETRY_CURRENT_SET`.
- **Backup exclusion targets the right directory.** `AppDelegate.swift:101` uses `.libraryDirectory`, which matches op-sqlite's actual default (`OPSQLite.mm:40-42`), and covers `-wal`/`-shm`/`-journal` sidecars (`:103`), re-applied on every background (`:48`).
- **App-switcher redaction is correctly implemented natively**, with an opaque base under the blur to defeat the blur-rasterisation race (`AppDelegate.swift:55-86`). The reasoning in that comment is subtle and correct; do not simplify it to a blur-only cover or a JS overlay.
- **No secret ever reaches a URL.** Monobank token is an `X-Token` header (`monobank.client.ts:25`); Binance API key is an `X-MBX-APIKEY` header (`binance.client.ts:67`). The Binance **secret** never leaves the device — only the HMAC digest is appended as `signature` (`binance.hmac.ts:11-12`, `binance.client.ts:63-66`), which is the correct protocol usage.
- **HMAC signing is correct.** The signed string is byte-identical to the query actually sent (`binance.client.ts:63-66`), `recvWindow` is bounded at Binance's 5000 ms default (`:23`), and clock-skew errors surface via `msg` (`:30-36`) rather than being swallowed.
- **Error messages are status-only and never echo a secret or a body.** `monobank.client.ts:18`, `btc-wallet.client.ts:16`, `coingecko.ts:18`. The one exception is deliberate and safe: Binance's `msg` field (`binance.client.ts:33-35`), which carries diagnostics, not credentials.
- **Zero logging.** No `console.*` in `src/` (mechanized at `biome.json:42`), no `NSLog`/`os_log`/`print(` in `ios/Kiko` or `ios/KikoWidget`.
- **Secret inputs are correctly configured.** `secureTextEntry` + `autoCapitalize="none"` + `autoCorrect={false}` on the Monobank token (`monobank-token-field.component.tsx:124-126`) and on **both** Binance fields (`binance-credentials-field.component.tsx:100-102`, `:123-125`). The BTC address is deliberately plain with the reasoning recorded (`wallet-address-field.component.tsx:25-28`) — correct, it is public data. Clipboard is only ever *read* for paste, never written with a secret.
- **Credentials are verified before being stored** (`binance-credentials-field.component.tsx:57-71`: `fetchAccount` first, `saveCredentials` second), so an invalid pair never reaches the Keychain.
- **Disconnect ordering is correct in both providers**: DB commit first, then the non-transactional Keychain clear, so a failed write cannot orphan the credential (`src/crypto-sync/disconnect.ts:14-23` with the reasoning at `:6-13`).
- **No deep-link attack surface at all.** No `CFBundleURLTypes`, no `CFBundleURLSchemes`, no `associated-domains`, no `UIFileSharingEnabled`, no `LSSupportsOpeningDocumentsInPlace`, no `UIBackgroundModes` in either `Info.plist` or either `.entitlements`; no React Navigation `linking` config; no `widgetURL` in the widget. The only `Linking.openURL` calls target two hardcoded public constants (`monobank-token-field.component.tsx:57`, `binance-credentials-field.component.tsx:51`).
- **Release build settings are clean.** `SWIFT_OPTIMIZATION_LEVEL = "-Onone"`, `ENABLE_TESTABILITY`, `GCC_OPTIMIZATION_LEVEL = 0` and `SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG` appear only in Debug configurations (`project.pbxproj:419`, `:490`, `:495`, `:535`); the Release blocks (`:424-455`, `:641-668`) carry none of them, and `VALIDATE_PRODUCT = YES`.
- **Widget failure modes are correctly closed.** `SnapshotLoader.load()` returns `nil` on every failure — missing container, missing file, unreadable data, malformed JSON (`NetWorthSnapshot.swift:50-66`) — and the view falls back to a placeholder (`NetWorthWidgetView.swift:23-27`). The bridge does not validate its `json` input (`WidgetBridge.swift:47`), but the caller is the app's own JS in the same trust domain and the widget decodes strictly via `Codable`, so this is not exploitable. `WidgetBridge.swift:27-29` explicitly documents never logging the payload — keep that.
- **All rate/price clients are auth-free and carry no secret**: `coingecko.ts:30`, `monobank-rates.ts:6` (the public `/bank/currency`), `nbu-history.ts:12`, `coingecko-history.ts:10`.
- **IBAN and masked PAN are stored but never rendered.** `counterIban` is used only for internal-transfer classification (`src/statistics/transfer-exclusion.ts:35-43`); grep finds zero IBAN/PAN rendering in any `.tsx`.
- **No real secret in any test, fixture, or doc.** Every long string is a published documentation example: the BIP-173 canonical address `bc1qar0…mdq`, the BIP-350 canonical taproot address, and the Binance API-docs example secret at `binance.hmac.test.ts:13`. No build artifact, `.jsbundle`, `.ipa`, `.mobileprovision`, `.p12`, or `.cer` is tracked in git.
- **Monobank pins are current** (re-verified 2026-09-06 against the live chain, output in §1).

---

## 5. Accepted-risk register updates (`docs/security/README.md`)

**Stale — must be corrected:**

1. **`:9-15` and `:14`** — "pins the Monobank API host (**the only host carrying the personal token**)" and "CoinGecko is not pinned: that call carries no secret". Both sentences predate the Binance integration and are now wrong: `api.binance.com` carries a credential and is unpinned (S1). Replace with a complete table of all five contacted hosts — `api.monobank.ua`, `api.binance.com`, `api.coingecko.com`, `blockstream.info`, `bank.gov.ua` — each marked secret-bearing yes/no and pinned yes/no, with the rationale for each decision.
2. **`:36-38` rotation cadence** — record that the pins were re-verified on 2026-09-06 and are unchanged, and extend the runbook to cover the second host once S1 lands.

**Missing — must be added:**

3. **The widget App Group snapshot.** Net worth, per-currency breakdown, and a 30-day trend are written as cleartext JSON to a container that is included in backups and readable after first unlock, and are rendered without privacy redaction on a locked device (S2, S3). This is the single largest gap between the documented posture and shipped behaviour: the register currently reads as though the encrypted DB is the only store of balance data.
4. **The app lock is cold-launch only.** No foreground re-lock; `settings.lock_grace_seconds` exists in the schema but is never read or written (S4). Either implement the re-lock or record this limitation explicitly — the current register implies the spec's grace-period model shipped.
5. **BTC address disclosure to `blockstream.info`** on every sync, with the address→IP correlation that implies (S9).
6. **`NSAllowsLocalNetworking` is enabled in Release** (S7) — either remove it or record it as accepted with its rationale.

**Verified still accurate, no change needed:** jailbreak detection (`:63-66`), legacy-service token migration (`:67-71`), plaintext→encrypted migration residuals (`:72-81`), `randomblob()` key source (`:82-86`), raw IBAN in `holdings.metadata` (`:87-88`).

---

## 6. Priority order for the implementer

1. **S2** — Widget privacy redaction + lock-aware snapshot lifecycle. Highest severity; it silently voids the app-lock feature the user explicitly enables. (M)
2. **S3** — Backup-exclude and set an explicit file-protection class on the App Group snapshot. Small, and it closes the backup leak that F2 was written to prevent. Ship together with S2. (S)
3. **S1** — Pin `api.binance.com` and correct the pinning doc. (M)
4. **S4** — Decide the re-lock question, then make code and docs agree; drop or wire up `lock_grace_seconds`. (M or S)
5. **S10** — Fix the `db-config.ts` comments and add a flags-are-on assertion. Cheap insurance against a catastrophic accidental regression. (S)
6. **S5** — Stop prefilling the Monobank token into component state. (S)
7. **S7, S8** — `Info.plist` cleanup: drop `NSAllowsLocalNetworking` from Release, remove the empty location purpose string. Do these before the App Store submission. (S)
8. **S6** — Make `readCredentials` a pure read. (S)
9. **S9** — Record the explorer privacy trade-off in the register. (S)
10. **S11** — Sort out distribution signing across both targets before the first upload. (S)
11. **Register update (§5)** — fold items 1–6 into `docs/security/README.md` as the closing step, so the posture record matches the code again.

---

## 7. Harness rule ideas

Per the project's "mechanize recurring findings" convention:

- **H1 `kiko-widget-money-view-needs-privacysensitive`** (Semgrep, Swift, ERROR) — in `ios/KikoWidget/**`, flag a `Text(...)` bound to a decoded-snapshot field (`snapshot.total.*`, `item.formatted`, `item.minorUnits`) that is not inside a `.privacySensitive()` or `.redacted(reason:)` subtree. Directly mechanizes S2 and prevents a future widget family from regressing it.
- **H2 `kiko-appgroup-write-needs-protection`** (Semgrep, Swift, ERROR) — flag any `write(to:)` whose URL derives from `containerURL(forSecurityApplicationGroupIdentifier:)` unless the same function also sets `isExcludedFromBackup` and an explicit `NSFileProtection` value. Mechanizes S3 for every future shared-container write.
- **H3 `kiko-auth-header-host-must-be-pinned`** (Semgrep, TS, ERROR + a plist assertion in `scripts/checks/`) — flag a `fetch` whose `headers` object contains a credential-bearing key (`X-Token`, `X-MBX-APIKEY`, `Authorization`, `/api[-_]?key/i`); the paired shell assertion resolves the `@env` endpoint constant to a host and fails unless that host appears under `NSPinnedDomains` in `ios/Kiko/Info.plist`. This is the rule that would have caught S1 the day the Binance client landed, and it is the highest-leverage of the seven.
- **H4 `kiko-no-keychain-secret-into-usestate`** (Semgrep, TS, WARNING, override-eligible) — flag a `readToken()` / `readCredentials()` / `readDbKey()` result flowing into a `useState` setter. Mechanizes S5; WARNING rather than ERROR because a justified case may exist.
- **H5 `kiko-settings-column-must-have-a-reader`** (Jest test, not Semgrep) — assert every column on the `settings` table in `src/db/schema.ts` is referenced at least once outside `schema.ts` and the migration files. Would have caught `lockGraceSeconds` (S4) and directly implements the existing "grep migration columns when removing a feature" lesson.
- **H6 `kiko-release-plist-hardening`** (shell assertion in `scripts/checks/`, run in the medium tier) — assert on `ios/Kiko/Info.plist`: `NSAllowsArbitraryLoads` is false, `NSAllowsLocalNetworking` is absent, `NSPinnedDomains` contains every host registered as secret-bearing, and no `NS*UsageDescription` key has an empty string. Covers S7, S8, and reinforces S1.
- **H7 `kiko-security-flags-stay-on`** (Jest test) — assert `DB_ENCRYPTION_ENABLED === true` and `APP_LOCK_ENABLED === true`. One line, and it converts S10 from a silent catastrophic regression into a failing test.
