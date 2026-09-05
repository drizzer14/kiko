# Kiko security posture

Companion to `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`
and its implementation plan
`docs/superpowers/plans/2026-09-05-security-and-app-lock-plan.md`. This file is
the operational record: what is pinned, how to rotate it, and which risks are
accepted rather than mitigated.

## Certificate pinning — `api.monobank.ua`

`ios/Kiko/Info.plist` → `NSAppTransportSecurity` → `NSPinnedDomains` pins the
Monobank API host (the only host carrying the personal token) with two CA
SPKI-SHA256 pins under `NSPinnedCAIdentities`. CoinGecko is not pinned: that
call carries no secret.

### Current chain (verified 2026-09-05)

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `CN=monobank.ua` | 2027-03-10 | `9C7Ylw+j3lXV/wphskz8+ZqUy1hG4/3dsBe3alQjmCA=` | no (renews) |
| intermediate | `C=US, O=Amazon, CN=Amazon RSA 2048 M01` | 2030-08-23 | `DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=` | yes — backup |
| root | `C=US, O=Amazon, CN=Amazon Root CA 1` | 2037-12-31 | `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=` | yes — primary |

The served chain is Amazon-issued: the leaf `CN=monobank.ua` is issued by the
`Amazon RSA 2048 M01` intermediate, which chains to the `Amazon Root CA 1`
root. The primary pin is the root SPKI (survives leaf and intermediate
renewals); the backup pin is the current intermediate SPKI.

### What breaks if the pins go stale

Every Monobank request fails closed with a TLS error (`useSync`/`useAutoSync`
surface it as a failed sync; no data leaves the device). This is the intended
failure mode. Nothing else is affected. CoinGecko price sync keeps working.

### Rotation runbook

Owner: the repository owner (single-user app). Cadence: on every release build,
and immediately if a sync starts failing with a TLS error.

1. Recompute the chain with the Step-1 openssl commands from the plan:

   ```bash
   cd "$(mktemp -d)"
   openssl s_client -connect api.monobank.ua:443 -servername api.monobank.ua -showcerts </dev/null 2>/dev/null > chain.pem
   awk 'BEGIN{n=0} /BEGIN CERT/{n++} {print > ("cert" n ".pem")}' chain.pem
   for i in 1 2 3; do
     echo "cert$i: $(openssl x509 -in cert$i.pem -noout -subject) SPKI=$(openssl x509 -in cert$i.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
   done
   ```

2. If the root SPKI still equals the primary pin, nothing to do (an intermediate
   change alone is covered by the root pin; refresh the backup pin at the next
   convenient release).
3. If Monobank moved to a different CA: replace BOTH pins with the new root
   (primary) and new intermediate (backup), update the table above,
   `plutil -lint ios/Kiko/Info.plist`, rebuild, run the positive and negative
   device checks, ship.
4. Positive check: on device, Monobank sync succeeds.
5. Negative check: temporarily corrupt one character in BOTH pins, rebuild,
   confirm sync fails with a TLS error, then revert.

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
