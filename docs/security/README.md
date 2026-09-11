# Kiko security posture

Companion to `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`
and its implementation plan
`docs/superpowers/plans/2026-09-05-security-and-app-lock-plan.md`. This file is
the operational record: what is pinned, how to rotate it, and which risks are
accepted rather than mitigated.

## Certificate pinning — contacted hosts

`ios/Kiko/Info.plist` → `NSAppTransportSecurity` → `NSPinnedDomains` pins every
host the app sends a credential to, with two CA SPKI-SHA256 pins each under
`NSPinnedCAIdentities` (primary = root CA, backup = current intermediate).
Pinning is scoped to secret-bearing hosts: a MITM on a public, unauthenticated
endpoint can misreport a number, but has no credential to steal, and pinning a
third-party public API the user cannot re-provision trades a real
availability risk for little.

| Host | Used by | Carries a secret | Pinned | Rationale |
|---|---|---|---|---|
| `api.monobank.ua` | `src/monobank/monobank.client.ts` (`X-Token` header) | yes — the personal bank token | **yes** | The token grants read access to every account and full statement history. |
| `api.binance.com` | `src/crypto-sync/binance/binance.client.ts` (`X-MBX-APIKEY` header) | yes — the read-only API key | **yes** | A MITM reads the API key and the full `/api/v3/account` balance response, and can replay the captured signed request inside the 5 s `recvWindow`. The HMAC secret itself never crosses the wire (`binance.hmac.ts` signs locally). |
| `api.coingecko.com` | `src/rates/coingecko.ts`, `src/rates/coingecko-history.ts` | no | no | Public BTC price quote, no auth header. Worst case an active MITM misreports the BTC price. |
| `blockstream.info` | `src/crypto-sync/btc-wallet/btc-wallet.client.ts` | no | no | Public Esplora explorer, no auth header. Worst case an active MITM forges `chain_stats` and misreports the BTC balance. See the accepted risk on address disclosure below. |
| `bank.gov.ua` | `src/rates/nbu-history.ts` | no | no | Public NBU historical fiat rates, no auth header. |

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

### What breaks if the pins go stale

Monobank: every Monobank request fails closed with a TLS error
(`useSync`/`useAutoSync` surface it as a failed sync; no data leaves the
device). Binance: the crypto sync's Binance provider fails the same way; the
BTC-wallet provider, CoinGecko price sync, and NBU history keep working. Fail
closed is the intended mode in both cases.

### Rotation runbook

Owner: the repository owner (single-user app). Cadence: on every release build,
and immediately if a sync starts failing with a TLS error.

1. Recompute BOTH chains:

   ```bash
   cd "$(mktemp -d)"
   for host in api.monobank.ua api.binance.com; do
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

2. If a host's root SPKI still equals its primary pin, nothing to do for that
   host (an intermediate change alone is covered by the root pin; refresh the
   backup pin at the next convenient release).
3. If a host moved to a different CA: replace BOTH of that host's pins with the
   new root (primary) and new intermediate (backup), update the table above,
   run `plutil -lint ios/Kiko/Info.plist` and `npm run check:plist`, rebuild,
   run the positive and negative device checks, ship.
4. Positive check: on device, Monobank sync succeeds AND a Binance sync
   succeeds.
5. Negative check: temporarily corrupt one character in BOTH of a host's pins,
   rebuild, confirm that host's sync fails with a TLS error while the other
   host's still succeeds, then revert.
6. Adding a new host that sends a credential header means adding it here AND to
   `NSPinnedDomains`. `npm run check:plist` fails the build if you forget.

## Fixed since the 2026-09-06 audit

- **`NSAllowsLocalNetworking` no longer ships.** It is absent from
  `ios/Kiko/Info.plist` and re-injected into the built plist for Debug
  configurations only, by the "Inject Debug-only ATS local networking" build
  phase, so Metro still works in development while the Release binary carries no
  local-network ATS exemption. Asserted by `npm run check:plist`.
- **The empty `NSLocationWhenInUseUsageDescription` was deleted.** The app uses
  no location API and no pod requires one; an empty purpose string is an App
  Store review rejection trigger. Asserted by `npm run check:plist`.
- **The Monobank token field no longer prefills the input with the stored
  secret.** `src/screens/account-detail/monobank-token-field/monobank-token-field.component.tsx`
  reads only `hasToken()` (a boolean) to drive its "already saved" caption;
  the real token is never read back into React state, so it cannot park in
  the JS heap or a retained fiber. Changing a saved token means re-entering
  it. Enforced by `kiko-no-keychain-secret-into-usestate` and
  `kiko-no-keychain-secret-through-then` in `rules/semgrep-mobile.yml`.
- **`readCredentials` re-saves a legacy-policy Binance credential pair at most
  once per process, not on every call.** `src/crypto-sync/binance/binance.credentials.ts`
  gates the repair write behind a module-level `hasRepairedAccessPolicy`
  latch, set only after the write succeeds; every read after the first
  repair is a pure Keychain read, matching `readToken` and `readDbKey`.
- **`db-config.ts`'s doc comments now match the shipped flag values.**
  `DB_ENCRYPTION_ENABLED` and `APP_LOCK_ENABLED` are both documented as
  "ON in every shipping build, and it must stay on", matching their `true`
  values, and both are asserted by `src/db/db-config.test.ts`.

## Accepted risks (not mitigated by design)

- **Jailbreak / root detection: not implemented.** Single-user personal app; a
  jailbroken device is the owner's own choice. Revisit if the threat model
  changes (multi-user, data sharing, wider distribution).
- **A Monobank token saved before the `accessible` hardening shipped** keeps its
  default Keychain policy until the user disconnects and re-saves it (or until a
  legacy-service migration re-saves it — `src/monobank/token.ts` now applies the
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
  redaction overlay (`ios/Kiko/AppDelegate.swift:55-86`) still protects the
  thumbnail — it protects the snapshot, not the resumed app. Revisit only with
  a deliberate decision to resurrect the grace period.
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
  `src/crypto-sync/btc-wallet/btc-wallet.client.ts:33` requests
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
- **The widget's App Group snapshot is a cleartext derivative of encrypted
  data (S2/S3).** `ios/Kiko/WidgetBridge.swift` writes `net-worth-snapshot.json` into
  the `group.com.dmytro.pff` container so the `KikoWidget` extension — a
  separate process that can neither open the SQLCipher database nor run app
  JavaScript — has something to render. Four controls bound it, and the residual
  risk is stated after them:
  - **Minimised payload.** The snapshot (`src/widget/net-worth-snapshot.ts`)
    carries only what the widget actually draws: `baseCurrency`, the formatted
    total, and the per-currency breakdown. The 30-day trend series it used to
    carry was removed on 2026-09-06 — the widget stopped rendering a trend
    line, so it was a wealth history on disk with no reader. Do not add a
    field the SwiftUI view does not render.
  - **Redaction.** `ios/KikoWidget/NetWorthWidgetView.swift`'s private
    `moneyText(_:...)` helper is the single place the total and every
    breakdown row's amount get rendered (a 2026-09-07 user decision, security
    task 21): when `redactionReasons` reports `.privacy` (WidgetKit sets this
    while the surface draws on a locked device — Lock Screen Today View,
    StandBy) it renders the literal string `---`, marked `.unredacted()` so
    WidgetKit does not also draw its default redaction bar over it; otherwise
    it renders the real formatted value marked `.privacySensitive()` as
    defense in depth — if the environment check is ever bypassed, WidgetKit
    still redacts. The "Net worth" label and every currency code sit outside
    that helper and are always visible, locked or not.
  - **Lock-aware lifecycle.** When `settings.lockEnabled` is on,
    `src/widget/use-net-worth-widget.ts` calls `widgetBridge.clearSnapshot()`
    instead of writing, on every debounce tick and on every background
    transition, so there is no real snapshot on disk at all while the lock is
    enabled; the widget renders its placeholder. Turning the lock off rewrites
    it on the next tick.
  - **At-rest attributes.** Every write re-applies `isExcludedFromBackup` (so
    the file never enters an iCloud/iTunes backup — the leak F2 closed for the
    database) and an explicit
    `FileProtectionType.completeUntilFirstUserAuthentication`. Both must be
    re-applied after every write: `atomically: true` replaces the inode and
    drops them. `.complete` is not usable — it would make the file unreadable
    exactly when WidgetKit renders. If either attribute cannot be applied,
    `writeProtected` deletes the file it just wrote and rejects, so a failure
    leaves no snapshot rather than an unprotected one.

  **Residual risk, accepted.** With the app lock OFF (the default), the file
  exists in plain JSON and is readable after first unlock without any Keychain
  access, so a jailbroken or forensically-imaged device yields the net worth and
  currency composition, whereas the database would require the
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` key. That is the unavoidable cost of having a
  widget at all: the extension has no way to hold a key. A user who wants that
  closed enables the app lock. Separately, on a locked Lock Screen the currency
  codes and the number of breakdown rows stay visible next to the `---`
  placeholders (`USD ---`, `EUR ---`), so the currency composition of the net
  worth — not its amounts — is disclosed to anyone holding the device. Accepted
  because the user explicitly asked for the codes to stay visible (2026-09-07);
  hiding them would mean rendering the rows as anonymous placeholders.
  Enforced by `kiko-widget-money-view-needs-privacysensitive` and
  `kiko-appgroup-write-needs-protection` in `rules/semgrep-mobile.yml`.

## Next steps

- **Distribution signing across both targets (audit finding S11, INFO).** The
  `Kiko` target's Release block sets `CODE_SIGN_IDENTITY = "Apple Development"`,
  and the `KikoWidget` extension target's Release block sets no explicit
  identity at all and inherits. Both must become a distribution identity, with
  the App Group capability provisioned on both targets, before the first App
  Store upload. Out of scope for the security pass — it is tracked and belongs
  to `docs/superpowers/plans/2026-09-04-app-store-publishing.md`; do that plan's
  signing steps across **both** targets, not just the app.
