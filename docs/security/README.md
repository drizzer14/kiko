# Kiko security posture

Companion to `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`
and its implementation plan
`docs/superpowers/plans/2026-09-05-security-and-app-lock-plan.md`. This file is
the operational record: what is pinned, how to rotate it, and which risks are
accepted rather than mitigated.

## Certificate pinning — contacted hosts

`ios/Kiko/Info.plist` → `NSAppTransportSecurity` → `NSPinnedDomains` pins every
host the app sends a credential to, with two CA SPKI-SHA256 pins each under
`NSPinnedCAIdentities` (primary = root CA, backup = current intermediate; for
a Let's Encrypt host, both pins are roots — see `eodhd.com` below).
Pinning is scoped to secret-bearing hosts: a MITM on a public, unauthenticated
endpoint can misreport a number, but has no credential to steal, and pinning a
third-party public API the user cannot re-provision trades a real
availability risk for little.

| Host | Used by | Carries a secret | Pinned | Rationale |
|---|---|---|---|---|
| `api.monobank.ua` | `src/monobank/` (`X-Token` header) | yes — the personal bank token | **yes** | The token grants read access to every account and full statement history. |
| `api.binance.com` | `src/crypto-sync/binance/binance.client.ts` (`X-MBX-APIKEY` header) | yes — the read-only API key | **yes** | A MITM reads the API key and the full `/api/v3/account` balance response, and can replay the captured signed request inside the 5 s `recvWindow`. The HMAC secret itself never crosses the wire (`binance.hmac.ts` signs locally). |
| `eodhd.com` | `src/prices/eodhd/` (`api_token` query parameter) | yes — the user's own EODHD API key | **yes** | A MITM reads the key from the request URL and can spend the user's daily call quota or use their paid plan. Pins are two roots, never the intermediate (see "Why `eodhd.com` pins two roots"). |
| `api.coingecko.com` | `src/rates/` (`coingecko`, `coingecko-history`) | no | no | Public BTC price quote, no auth header. Worst case an active MITM misreports the BTC price. |
| `blockstream.info` | `src/crypto-sync/btc-wallet/btc-wallet.client.ts` | no | no | Public Esplora explorer, no auth header. Worst case an active MITM forges `chain_stats` and misreports the BTC balance. See the accepted risk on address disclosure below. |
| `bank.gov.ua` | `src/rates/` (`nbu-history`, `nbu-rates`), `src/prices/nbu-metals`, `src/bonds/nbu-register` | no | no | Public NBU historical AND current fiat rates, no auth header. `nbu-rates` is the unpinned live fallback `rates-refresh.ts` reaches for only when the cert-pinned Monobank fiat fetch fails. `nbu-metals` reads the SAME two endpoints for precious-metal (XAU/XAG/XPT/XPD) prices, refreshed only for currently held metals (`metal-refresh.ts`). `nbu-register` reads a THIRD endpoint on the same host, the public securities register, to refresh the `bond_register` cache at most once per local day (`bond-register.repo.ts`'s `refreshBondRegisterIfStale`). |

### Current chains (verified 2026-09-06)

`api.monobank.ua` — re-verified 2026-09-06 against the live host, **unchanged**:

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `CN=monobank.ua` | 2027-03-10 | `9C7Ylw+j3lXV/wphskz8+ZqUy1hG4/3dsBe3alQjmCA=` | no (renews) |
| intermediate | `C=US, O=Amazon, CN=Amazon RSA 2048 M01` | 2030-08-23 | `DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=` | yes — backup |
| root | `C=US, O=Amazon, CN=Amazon Root CA 1` | 2037-12-31 | `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=` | yes — primary |

`api.binance.com` — first pinned 2026-09-06:

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `C=KY, O=Binance Holdings Limited, CN=*.binance.com` | 2027-01-09 | `/Y6BOeqMgXS6wjqk6emFs+Y+HWkIXO2R8Dox5VO1YT0=` | no (renews) |
| intermediate | `C=US, O=DigiCert Inc, CN=GeoTrust TLS RSA CA G1` | 2027-11-02 | `SDG5orEv8iX6MNenIAxa8nQFNpROB/6+llsZdXHZNqs=` | yes — backup |
| root | `C=US, O=DigiCert Inc, CN=DigiCert Global Root G2` | 2038-01-15 | `i7WTqTvh0OioIruIfFR4kMPnBqrS2rdiVPl/s2uC/CY=` | yes — primary |

`eodhd.com` — first pinned; chain captured 2026-09-30 21:20 UTC (OpenSSL
3.6.3). The server sends the leaf, YR1, and ISRG Root YR cross-signed by
ISRG Root X1; it does not send ISRG Root X1 itself.

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `CN=eodhd.com` | 2026-11-23 | `B36J+dbVqICSRwTr96PX0cc1YE+artMWNPDlUPR85LQ=` | no (renews) |
| intermediate | `C=US, O=Let's Encrypt, CN=YR1` | 2028-09-02 | `LoMHBotttiDko50Gi13uXW71eIy7LAttI+rYT8wXF4w=` | no (rotates) |
| root | `C=US, O=ISRG, CN=Root YR` (sent cross-signed by ISRG Root X1; the cross-sign expires 2032-09-02) | — | `fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=` | yes — primary |
| root | `C=US, O=Internet Security Research Group, CN=ISRG Root X1` | 2035-06-04 | `C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=` | yes — backup |

Source of each pin: ISRG Root YR's SPKI is taken from the cross-signed
certificate the server sends (a cross-sign keeps the root's own key, so the
hash equals the self-signed Root YR's). The macOS system root store has no
Root YR. ISRG Root X1's SPKI is taken from the macOS system root store
(`/System/Library/Keychains/SystemRootCertificates.keychain`, SHA-256
fingerprint
`96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6`),
and `openssl verify` confirms that this X1 key signed the cross-signed Root
YR (its Authority Key Identifier
`79:B4:59:E6:7B:B6:E5:E4:01:73:80:08:88:C8:1A:58:F6:E9:9B:6E` equals X1's
Subject Key Identifier).

#### Why `eodhd.com` pins two roots

Let's Encrypt issues from a rotating set of short-lived intermediates (YR1
today, with siblings that it can switch between at any renewal, without
notice). A pin on YR1 would break the day the next leaf comes from a sibling
intermediate. Both pins are therefore roots: ISRG Root YR (primary, the root
that signs YR1) and ISRG Root X1 (backup, which cross-signs Root YR and
anchors the chain on a device that does not yet trust Root YR itself). A
Let's Encrypt intermediate change needs no app update; only a move away from
ISRG does.

Both pins assume the RSA hierarchy: they cover the chain YR1 ← Root YR ← X1.
An ECDSA re-key of `eodhd.com` would chain through a YE* intermediate to
ISRG Root YE and ISRG Root X2, which neither pin covers. That is a re-pin
trigger: every EODHD request fails closed until an app update ships the new
pins.

### What breaks if the pins go stale

Monobank: every Monobank request fails closed with a TLS error
(`useSync`/`useAutoSync` surface it as a failed sync; no data leaves the
device). Binance: the crypto sync's Binance provider fails the same way; the
BTC-wallet provider, CoinGecko price sync, and NBU history keep working.
EODHD: every share price request fails the same way and no new share price
is stored; the key never crosses an untrusted chain. Fail closed is the intended mode in
every case.

### Rotation runbook

Owner: the repository owner (single-user app). Cadence: on every release build,
and immediately if a sync starts failing with a TLS error.

1. Recompute every pinned host's chain:

   ```bash
   cd "$(mktemp -d)"
   for host in api.monobank.ua api.binance.com eodhd.com; do
     echo "== $host"
     openssl s_client -connect "$host:443" -servername "$host" -showcerts </dev/null 2>/dev/null > chain.pem
     awk 'BEGIN{n=0} /BEGIN CERT/{n++} {print > ("cert" n ".pem")}' chain.pem
     for i in 1 2 3; do
       [ -f "cert$i.pem" ] || continue
       echo "cert$i: $(openssl x509 -in cert$i.pem -noout -subject -enddate | tr '\n' ' ') SPKI=$(openssl x509 -in cert$i.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
     done
     rm -f cert*.pem chain.pem
   done
   ```

   `eodhd.com` does not send its backup root, ISRG Root X1. Read that pin from
   the macOS system root store instead:

   ```bash
   security find-certificate -c "ISRG Root X1" -p /System/Library/Keychains/SystemRootCertificates.keychain \
     | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
   ```

2. If a host's root SPKI still equals its primary pin, nothing to do for that
   host (an intermediate change alone is covered by the root pin; refresh the
   backup pin at the next convenient release). For `eodhd.com` both pins are
   roots, so an intermediate change (YR1 to a sibling) needs no pin change at
   all.
3. If a host moved to a different CA: replace BOTH of that host's pins with the
   new root (primary) and new intermediate (backup), update the table above,
   run `plutil -lint ios/Kiko/Info.plist` and `npm run check:plist`, rebuild,
   run the positive and negative device checks, ship. For a host that moved to
   (or stays on) a CA with rotating intermediates, such as Let's Encrypt, pin
   two roots instead, as for `eodhd.com`.
4. Positive check: on device, Monobank sync succeeds, a Binance sync
   succeeds, AND an EODHD share price refresh succeeds.
5. Negative check: temporarily corrupt one character in BOTH of a host's pins,
   rebuild, confirm that host's sync fails with a TLS error while the other
   hosts' still succeed, then revert.
6. Adding a new host that sends a credential (a header, or the `api_token`
   query parameter) means adding it here AND to
   `NSPinnedDomains`. `npm run check:plist` fails the build if you forget.
   A client that sends the key as the `api_token` query parameter must also
   send the `Cache-Control: no-store` request header, so NSURLCache never
   writes the key-bearing URL to `Cache.db`; `npm run check:plist` fails
   without it.

## Fixed since the 2026-09-06 audit

- **`NSAllowsLocalNetworking` no longer ships.** It is absent from
  `ios/Kiko/Info.plist` and re-injected into the built plist for Debug
  configurations only, by the "Inject Debug-only ATS local networking" build
  phase, so Metro still works in development while the Release binary carries no
  local-network ATS exemption. Asserted by `npm run check:plist`.
- **The empty `NSLocationWhenInUseUsageDescription` was deleted.** The app uses
  no location API and no pod requires one; an empty purpose string is an App
  Store review rejection trigger. Asserted by `npm run check:plist`.
- **The localized app names ship.** `ios/Kiko/en.lproj/InfoPlist.strings` and
  `ios/Kiko/uk.lproj/InfoPlist.strings` set `CFBundleDisplayName` (Kiko /
  Кіко) and sit in the Kiko target's Resources build phase. Asserted by
  `npm run check:plist`.
- **The disk-space required-reason API is declared.** Some dependencies link a
  disk-space API without a pod privacy manifest that covers it (the set is
  check 5's linked list in `scripts/checks/plist.sh`; read it there). So
  `ios/Kiko/PrivacyInfo.xcprivacy` declares `NSPrivacyAccessedAPICategoryDiskSpace`
  (`E174.1`) while any dependency on that list ships (else ITMS-91053). `npm run check:plist` asserts it
  and fails closed when it cannot tell.
- **The Monobank token input never prefills with the stored secret.**
  Connect takes the text typed this session (`MonobankConnectField`; grep it
  under `src/`), validates it, then writes the Keychain. The token is never
  read back into React state, and a failed connect clears nothing it did not
  store. Enforced by `kiko-no-keychain-secret-into-usestate` and
  `kiko-no-keychain-secret-through-then` in `rules/semgrep-mobile.yml`.
- **`readCredentials` re-saves a legacy-policy Binance credential pair at most
  once per process, not on every call.** `src/crypto-sync/binance/binance.credentials.ts`
  gates the repair write behind a module-level `hasRepairedAccessPolicy`
  latch, set only after the write succeeds; every read after the first
  repair is a pure Keychain read, matching `readToken` and `readDbKey`.
- **`db-config.ts`'s doc comment matches the shipped flag value.**
  `DB_ENCRYPTION_ENABLED` is documented as "ON in every shipping build, and
  it must stay on", matching its `true` value, and is asserted by
  `src/db/db-config.test.ts`. The app lock has no build-time switch; it is
  the live `settings.lockEnabled` toggle (see kiko-domain's "App lock /
  security settings" section).

## Accepted risks (not mitigated by design)

- **Jailbreak / root detection: not implemented.** Single-user personal app; a
  jailbroken device is the owner's own choice. Revisit if the threat model
  changes (multi-user, data sharing, wider distribution).
- **A Monobank token saved before the `accessible` hardening shipped** keeps its
  default Keychain policy until the user disconnects and re-saves it (or until a
  legacy-service migration re-saves it — `src/monobank/` now applies the
  hardened policy on that path). No forced migration for an already-current-service
  item.
- **Plaintext → encrypted database migration residuals.** The key is stored only
  after the export completes, and the plaintext files (`kiko.db` and the legacy
  `pff.db` backup) are deleted only after the key is stored
  (`src/db/encrypted-database.ts`). A crash between those steps leaves stale
  plaintext for one launch; the next launch scrubs it. Edge case: if the Keychain
  key persists but the encrypted file is deleted while a plaintext file survives
  (a pathological partial data-clear), the next launch opens a fresh encrypted DB
  and scrubs the plaintext — data written only to that plaintext file would be
  lost. iOS clears Keychain and files together on app delete, so this is not
  reachable through normal use.
- **SQLite `randomblob()` as the DB-key source** (`src/db/keys/db-key.ts`):
  ChaCha20 seeded from the OS CSPRNG. Hermes has no WebCrypto; swapping to
  `react-native-get-random-values` (`SecRandomCopyBytes`) is a one-function change
  if the platform CSPRNG is ever preferred (needs a new dependency + user approval).
- **Raw IBAN stored in `holdings.metadata`** — encrypted at rest now, but storing
  it at all is flagged by the research pass as worth revisiting. Out of scope here.
- **The app lock is cold-launch only; it never re-locks.**
  `src/auth/use-app-lock.ts` decides `isLocked` exactly once, when the settings
  row first loads, and there is no `AppState` subscription anywhere in
  `src/auth/`. **Concrete limitation:** if the phone is taken while Kiko is
  backgrounded but its process is still resident — the common case, since iOS
  keeps a foreground-recent app alive for a long time — unlocking the device and
  tapping Kiko resumes straight into the navigator with full balances and
  transaction history, with no Face ID prompt. The lock only helps once iOS has
  killed the process. The device passcode is the only barrier in that window.
  This is deliberate: the approved spec's `AppState` grace period
  (`docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md:198-203`)
  was built and then replaced, because a re-lock on every foreground made the
  app unusable for the quick balance checks it exists for. The app-switcher
  redaction overlay (`ios/Kiko/SceneDelegate.swift`, `showPrivacyOverlay`/
  `hidePrivacyOverlay`) still protects the thumbnail — it protects the
  snapshot, not the resumed app. Revisit only with a deliberate decision to
  resurrect the grace period.
- **`settings.lock_grace_seconds` is a legacy column with zero readers.** It
  survives from the abandoned grace-period design (migration
  `drizzle/migrations/0011_add_lock_settings.sql`), has no setter in
  `src/settings/settings.repo.ts` and no reader anywhere in `src/`. It is
  intentionally NOT dropped: a destructive migration on a live single-user
  database buys nothing here, and the column is harmless (`NOT NULL DEFAULT 30`).
  It is pinned as the sole documented exception in the
  `settings`-columns-have-a-reader test (`src/db/settings-columns.test.ts`), so
  neither a new dead column nor a silent re-wiring of this one can slip through.
- **Every BTC sync discloses the wallet address to `blockstream.info`.**
  `fetchAddressBalance` in `src/crypto-sync/btc-wallet/btc-wallet.client.ts` requests
  `${BTC_EXPLORER_ENDPOINT}/address/<address>` on every sync, so Blockstream
  learns `(address, source IP, timestamp)` and can correlate a specific wallet
  with a specific network location over time. Accepted: a public Esplora
  explorer is the only practical way to read an on-chain balance without running
  a node, and the address itself is public data by design (it is deliberately
  kept out of the Keychain — `btc-wallet.provider.ts:11-16`). The host is
  unpinned because the call carries no secret; an active MITM can forge
  `chain_stats` and misreport the balance, which is a correctness, not a
  confidentiality, risk. If the privacy cost is ever judged too high the
  alternatives are a user-configurable explorer endpoint or a self-hosted
  Esplora instance — both larger changes than this warrants today. The address
  is format-validated before use (`bitcoin-address.ts:7-11`) and URL-encoded at
  the call site, so it cannot be used to inject a path.

## App lock re-authentication

Turning `settings.lockEnabled` OFF also gates on `confirmOwner`
(`system.screen.tsx`, `handleToggleLock`): turning the lock ON stays
instant and prompt-free, unchanged, but turning it OFF re-confirms the
device owner first, so a still-unlocked app left unattended can't be
disarmed by anyone who picks it up. A cancelled or failed prompt leaves
the switch back on. A device with **no** device passcode proceeds with
no prompt at all — iOS itself demands the OLD passcode before it lets
the user remove one, so there is no owner authentication `confirmOwner`
could run there, and refusing the toggle would just strand the user
with no way to ever turn the lock off. This is the opposite of the data
export's own `noPasscode` handling below: turning the lock off
treats it like a fresh authentication, while a credential export treats
it as a refusal — the two call sites read the SAME `confirmOwner` result
differently, on purpose, because only one of them has an iOS-side
passcode prompt standing in for the missing check.

`confirmOwner` (`src/auth/confirm-owner/`) wraps `authenticate`
(`src/auth/biometrics.ts`), which now classifies every iOS rejection
correctly instead of folding it into a generic failure: a cancel/system-
cancel/fallback tap resolves as `cancelled`, and a biometry lockout as
`lockout` — the real native module REJECTS these, it never resolves
`{ success: false, errorCode }`, so the classification runs on the thrown
`code` (or the resolved shape, for defense in depth). A rejection that
would otherwise classify as a generic `failed` is disambiguated by a
follow-up `isSensorAvailable()` query: if the passcode was just removed,
that query now reports it, and `authenticate` resolves `passcodeNotSet`
instead of the generic failure. A secure device whose biometry is merely
unusable reports one of two distinct `passcodeOnly` reasons, each with
its own Settings hint string: `notEnrolled` (biometry was never set up)
or `biometryUnavailable` (denied Face ID permission, a temporary
lockout). Either way the Settings switch stays reachable through the
passcode fallback instead of greying out — and an ON switch never greys
out at all, regardless of sensor status, so a passcode removed while the
app is running, or a device with no usable sensor at all, can still
reach the toggle to turn the lock back off.

## Data export/import

`src/data-transfer/` (`export-data.ts`, `import-data.ts`, `crypto/envelope.ts`,
`secrets/`, `snapshot/`) builds and reads the `.kiko` export file. Every
export is an AES-256-GCM envelope: a fresh random key and a fresh random
12-byte nonce are generated per export (`crypto/generate-key.ts`,
`crypto/envelope.ts`), and the key is returned to the caller for the user to
save separately — it is never written into the file itself. Credentials
(Monobank tokens, Binance API key/secret) are included only when the user
opts in via `includeSecrets` (`secrets/read-secrets.ts`); the database
encryption key is never exported.

**Re-authentication now gates a credential export.** `export-data.screen.tsx`
calls `confirmOwner` (`src/auth/confirm-owner/`) before `exportData` ever runs
with `includeSecrets: true`, so a still-unlocked, still-running app can no
longer hand out every stored credential with no further check. A cancelled or
failed prompt shows no key card and no file; `includeSecrets: false` still
exports with no prompt at all, unchanged. A device with **no** device
passcode has no owner authentication to run at all, and is refused outright
(`auth.reauth.passcodeRequired`) rather than let through unauthenticated —
this is the one call site where "no passcode" is a REFUSAL, not a pass. See
"App lock re-authentication" above for the other call site, where the same
"no passcode" result means the opposite.

Open items, deferred (see `FINDINGS.md`):

- **SEC-5** — the export key is copied to the general system pasteboard, with
  no expiry and no local-only restriction.
- **SEC-4** — a restore can leave orphaned Keychain items behind (the
  accounts it replaces keep theirs). Deleting one account clears its own
  items (`accountsRepo.remove`, after the commit).

On import, the credentials block is validated before the database is replaced
(`secrets/is-export-secrets.ts`): a field present with the wrong shape refuses
the file, while a missing or empty array means no secrets, and a secret for an
account the file does not carry is dropped. A restore keeps this device's app
lock setting (`settings.lockEnabled`), its EODHD call count, and its
notifications start, whatever the file carries
(`KEPT_FROM_LIVE_ON_RESTORE`, `src/db/kept-from-live-on-restore.ts`), also
when the file has no settings row. A Keychain write that fails after the data
committed does not fail the import: the screen shows the success and names the
connections (Monobank, Binance, EODHD) to set up again. Failing to clear an
account's Keychain items after its delete is logged and never fails the
delete; a Binance connect on a new account that cannot create the row clears
the key pair it stored first.

## Next steps

- **Distribution signing (audit finding S11, INFO).** The `Kiko` target's
  Release block sets `CODE_SIGN_IDENTITY = "Apple Development"`; it must
  become a distribution identity before an App Store upload. (This finding
  used to also cover the `KikoWidget` extension target; the widget feature
  and that target have since been removed from the project.) Out of scope
  for the security pass — it is tracked and belongs to
  `docs/superpowers/plans/2026-09-04-app-store-publishing.md`; do that plan's
  signing steps.
