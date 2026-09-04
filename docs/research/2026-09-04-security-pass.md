# Security pass — audit and hardening plan

Date: 2026-09-04 · Status: research (not implemented)
App: bare RN 0.87.1 iOS, local-first, no own backend.

## Threat model
Single-user, local-first. The realistic adversary has physical or
backup access to the device (lost/stolen phone, an unencrypted
Finder/iTunes backup, a jailbroken device), plus network MITM. Attack
surface: the Keychain token, the on-device SQLite DB, and two outbound
TLS calls (Monobank, CoinGecko).

## Already good (do not regress)
- ATS on, arbitrary loads off (`ios/Kiko/Info.plist`).
- Token sent as `X-Token` header, never in a URL.
- No analytics / crash / Flipper SDKs; no `console.*` in `src`.
- Error messages are status-only (no token, no response body).
- Token input uses `secureTextEntry`; disconnect clears the token
  after the DB commit.
- `check:secrets` (gitleaks) + `check:security` (semgrep) guard commits.

## Findings

### F1 — SQLite DB is unencrypted (HIGH)
`src/db/client.ts` opens the DB with no `encryptionKey`. It holds every
balance, the full Monobank transaction history, and **IBAN + masked PAN**
in `holdings.metadata` (`src/monobank/sync.ts`). op-sqlite ships
SQLCipher; pass `encryptionKey` to `open()`. Key stored in the Keychain
(device-only). Needs a one-time plaintext→encrypted migration behind
`MigrationsGate`. Reconsider storing the raw IBAN at all. **Effort L.**

### F2 — DB is in iCloud/iTunes backups (HIGH, → MED after F1)
No `NSURLIsExcludedFromBackupKey` / file protection. The plaintext DB
leaves the device in every backup. Fix: exclude the DB file from
backup; once F1 lands, a leaked backup is useless without the key.
**Effort S.**

### F3 — Keychain token not device-only, no access control (MED)
`src/monobank/token.ts` uses no `accessible`/`accessControl`. The
long-lived Monobank token grants full read access to real bank data and
can migrate via encrypted backup restore. Fix: `accessible:
WHEN_UNLOCKED_THIS_DEVICE_ONLY` (keeps auto-sync working). Optional
biometric gate only on the manual reveal/reconnect path, never the
silent auto-sync read. **Effort S.**

### F4 — No TLS certificate pinning (MED)
`monobank.client.ts` / `coingecko.ts` use plain `fetch`, no
`NSPinnedDomains`. A malicious root CA (MDM/coerced profile) can MITM
the token. Fix: pin `api.monobank.ua` (the token-bearing host) with a
current + backup SPKI pin and a rotation runbook. **Effort M.**

### F5 — Build-time `@env` (LOW, clean today)
Only `PRICE_ENDPOINT` (public CoinGecko URL) is in `.env`.
`react-native-dotenv` inlines values into the bundle, so never put a
secret there. Keep the invariant; add a "public-only" note. **Effort S.**

### F6 — No jailbreak detection (LOW, accept)
Accepted risk for a personal app. F1 + F3 are the higher-leverage
mitigations. **Effort S (decision only).**

### F7 — Logging (LOW, clean)
Keep the no-`console` discipline; consider a `no-console` lint rule to
mechanize it (matches the project's "mechanize recurring findings"
convention). **Effort S.**

### F8 — Dependency CVEs (tracked debt)
The two `image-size` advisories are documented accepted debt in
CLAUDE.md; no action beyond the existing osv cadence.

## Priority order
1. F1 encrypt the DB (SQLCipher). **L**
2. F3 device-only token. **S**
3. F2 exclude DB from backups. **S**
4. F4 pin `api.monobank.ua`. **M**
5. F7/F5 `no-console` lint + `.env` note. **S**
6. F6 record jailbreak as accepted risk.

## References
- op-sqlite SQLCipher: https://op-engineering.github.io/op-sqlite/docs/api
- react-native-keychain ACCESSIBLE: https://oblador.github.io/react-native-keychain/docs/api/enums/ACCESSIBLE
- Exclude files from iCloud backup: https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup
- ATS NSPinnedDomains: https://developer.apple.com/news/?id=g9ejcf8y
- OWASP MASVS: https://mas.owasp.org/MASVS/
