# Crypto BTC sync (wallet + Binance) — design spec

Date: 2026-09-04
Status: draft, pending user approval
Scope owner: PFF coordinator
Source research: `docs/research/2026-09-04-crypto-exchange-sync.md`

## Problem

The app has no way to pull a live crypto balance into a holding — every
`crypto_asset` holding today is a manually-entered, manually-updated
number. Users who hold BTC in a wallet or on an exchange want that
holding to sync the way a Monobank card/jar already does.

## Decisions (fixed)

- **Scope: BTC only.** `holdings.currency` is a closed enum
  (`BTC | USD | EUR | UAH`); a Binance/Kraken-style account holds
  arbitrary assets (ETH, USDT, SOL…), which needs an asset-registry
  generalization of the currency model. BTC needs **zero** schema or
  currency-model change (`currencyScale.BTC = 8`, `fetchBTCPrice`
  already exists), so it ships first. Any other asset is explicitly
  out of scope for this milestone (see below).
- **A provider abstraction, not two bespoke integrations.** A
  `BalanceProvider` interface (`id`, `kind: 'exchange' | 'wallet'`,
  injected deps, `fetchBalances`) plus one generic `runBalanceSync`,
  mirroring how `SyncDeps`/`runSync` already factor Monobank. Every
  concrete provider (wallet today, Binance today, any exchange later)
  implements the interface; the sync/upsert/error-handling plumbing is
  written once.
- **First provider: a BTC public-address wallet.** The user pastes a
  public BTC address — no secret involved. The provider reads the
  address's balance in satoshis from a public block explorer API and
  maps it straight to a `BTC` holding at scale 8. Valuation reuses the
  existing CoinGecko BTC path (`fetchBTCPrice` / the `BTC→USD` rate
  already in `currency_rates`) unchanged.
- **Second provider: Binance, read-only, BTC balance only.** An
  API key with only the "Enable Reading" permission (no trade, no
  withdraw). Auth is `X-MBX-APIKEY` header + HMAC-SHA256 signature
  over the query string, computed in pure JS (no native pod — RN has
  no built-in HMAC). Calls `GET /api/v3/account`, filters
  `balances[]` to the `BTC` asset, sums `free + locked`. Every other
  asset in the response is ignored by this milestone.
- **Balance-snapshot upsert, not a transaction import.** Both
  providers give one live number, not a statement. Clone
  `holdingsRepo.upsertMonobank` into `holdingsRepo.upsertExchange` —
  same match-on-metadata-key shape, but only a balance write, no
  `addTransactions` call and no statement pagination.
- **Credential storage:** the Binance `{apiKey, secret}` pair is
  stored as a single JSON value in the iOS Keychain under
  `service: 'pff.binance.credentials'`, with biometric access control
  (`BIOMETRY_CURRENT_SET`) and `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Never
  written to SQLite, `metadata`, or logs. The wallet provider has no
  secret to store — only the public address, which lives in the
  holding's `metadata` like any other synced-holding key.
- **Enum growth:** `transactions.source` gains `'btc_wallet'` and
  `'binance'`; `accounts.institution` gains the same two values, so
  `isSyncedAccount`/the Connect flow recognize a crypto-synced
  account the same way they recognize `'monobank'`. (A wallet/Binance
  sync never inserts a `transactions` row today — see "Balance
  history" below — but the `source` enum still names the value that
  a future ledger or manual-entry marker would use, and keeping the
  two enums in lockstep with `institution` avoids a second migration
  later.)

## Explicitly out of scope (defer to a later milestone)

- The currency-model generalization needed for any non-BTC asset
  (ETH, USDT, SOL, …) — opening the closed `Currency` enum into an
  asset registry (code + scale + symbol + coingecko id), widening the
  `holdings.currency` / `currency_rates` columns, and a
  `fetchCryptoPrices(ids[])` multi-asset CoinGecko call.
- Multi-asset Binance (anything beyond the single BTC balance).
- Any other exchange (Kraken, OKX, Bybit, Coinbase) or any EVM wallet
  (`eth_getBalance`). The research doc's recommended sequence places
  these after this milestone; this spec does not design them.
- IP allowlisting for the Binance key (impractical on mobile's
  rotating egress IP — the research doc's conclusion stands: the
  read-only permission is the real guardrail, not an IP restriction).
- A per-currency/per-provider transaction ledger for crypto (see
  "Balance history" below — mirrors the multi-currency cash spec's
  decision to keep direct balances, no ledger).

## Provider abstraction

```ts
// src/crypto-sync/provider.ts
export type BalanceProviderId = 'btc_wallet' | 'binance';

export type ProviderBalance = {
  /** Always 'BTC' in this milestone; kept as a field, not hardcoded
   *  inline, so a later multi-asset provider only widens this type. */
  currency: 'BTC';
  balanceMinorUnits: number; // satoshis
  /** Provider-specific key used to match/upsert the target holding,
   *  e.g. the wallet address or a fixed 'binance-btc' constant. */
  metadataKey: string;
};

export interface BalanceProvider<Deps> {
  id: BalanceProviderId;
  kind: 'exchange' | 'wallet';
  fetchBalances(deps: Deps): Promise<ProviderBalance[]>;
}
```

`runBalanceSync(provider, deps, { targetAccountId })`:

1. Resolve/mark the target account (`institution: provider.id`),
   mirroring `ensureMonobankAccount` — same "one connection of this
   institution at a time" rule, scoped per `institution` value so a
   BTC wallet connection and a Binance connection can coexist as two
   different accounts, but two BTC-wallet connections cannot silently
   double-count.
2. `provider.fetchBalances(deps)`.
3. For each returned balance, `holdingsRepo.upsertExchange` with
   `{ accountId, currency: 'BTC', type: 'crypto_asset',
   balanceMinorUnits, metadata: { [provider.id + 'Key']:
   metadataKey } }` — actual metadata key name is
   `walletAddress` for the wallet provider and `binanceAsset`
   (fixed `'BTC'`) for Binance, matching the research doc's mapping
   section.
4. Update the account's last-synced timestamp the same way
   Monobank's `setLastSyncAt` does (reuse `settingsRepo`, or a
   provider-scoped variant if per-provider timestamps are needed —
   TBD at implementation time, not a design blocker).

No statement pagination, no rate limiting loop, no
`addTransactions` — the entire "walk 31-day windows, dedupe by
`externalId`" machinery in `monobank/sync.ts` does not apply; a
balance sync is a single request (wallet) or a single signed request
(Binance) per run.

## Provider 1: BTC public-address wallet

- New module `src/crypto-sync/btc-wallet/`:
  - `btc-wallet.client.ts`: `fetchAddressBalance(address, fetchImpl)`
    → satoshis, calling a public Esplora-compatible endpoint (e.g.
    Blockstream `GET /address/:address` →
    `chain_stats.funded_txo_sum - chain_stats.spent_txo_sum`). Same
    `guard`-based non-ok-throws pattern as `coingecko.ts` /
    `monobank.client.ts` for consistency.
  - `btc-wallet.provider.ts`: implements `BalanceProvider`; `id:
    'btc_wallet'`, `kind: 'wallet'`; `fetchBalances` reads the stored
    address (from the target holding's/account's `metadata`, not a
    secret store — a public address is not a secret) and returns one
    `ProviderBalance` with `metadataKey` = the address itself.
- No Keychain use for this provider. The address is entered once
  (paste into a text field, same shape as the Monobank token field
  but a plain, non-`secureTextEntry` input) and stored in
  `metadata.walletAddress` on the connected account or holding.
- Address validation: a basic BTC address format check
  (bech32 `bc1…` / base58 `1…`/`3…`) before the first fetch, to fail
  fast on an obvious typo rather than surfacing a raw 400 from the
  explorer API.

## Provider 2: Binance (read-only, BTC only)

- New module `src/crypto-sync/binance/`:
  - `binance.hmac.ts`: a pure-JS HMAC-SHA256 signer (no native pod —
    matches the research doc's explicit constraint). Signs the query
    string with the stored secret; returns the hex digest to append
    as `&signature=`.
  - `binance.credentials.ts`: mirrors `monobank/token.ts`'s
    `saveToken`/`readToken`/`clearToken` shape, but for a
    `{apiKey, secret}` struct, `service: 'pff.binance.credentials'`,
    with `accessControl: BIOMETRY_CURRENT_SET` and
    `securityLevel/accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` passed
    to `Keychain.setGenericPassword`.
  - `binance.client.ts`: `fetchAccount(apiKey, secret, fetchImpl)` →
    builds `timestamp` + `recvWindow`, signs, calls
    `GET /api/v3/account` with the `X-MBX-APIKEY` header, same
    `guard` non-ok-throw pattern, returns the parsed `balances[]`.
  - `binance.provider.ts`: implements `BalanceProvider`; `id:
    'binance'`, `kind: 'exchange'`; `fetchBalances` reads the stored
    credentials, calls `fetchAccount`, filters `balances` to
    `asset === 'BTC'`, sums `parseFloat(free) + parseFloat(locked)`,
    converts to satoshis via `Money.fromMajor('BTC', total).minorUnits`,
    returns one `ProviderBalance` with `metadataKey: 'BTC'`.
- Clock-skew handling: Binance rejects a signed request outside
  `recvWindow` of server time. `binance.client.ts` uses `Date.now()`
  by default but accepts an injected `now` (same seam as
  `SyncDeps.now`) so a clock-skew unit test can simulate a stale
  timestamp without a real clock.
- Error surfacing: an invalid/revoked key or a signature failure
  bubbles up the same way an invalid Monobank token does today (the
  `monobank-token-field` "Invalid token" status) — a
  `binance-credentials-field` component with the same
  idle/checking/success/invalid/saveError states, verifying the key
  via one `fetchAccount` call before saving.

## Data model

No schema change for the balance/currency columns — this is the
headline reason BTC ships first. Two enum widenings only:

| Column | Current enum | New values |
|---|---|---|
| `accounts.institution` | free text (`'monobank'` used by convention) | add `'btc_wallet'`, `'binance'` |
| `transactions.source` | `'manual' \| 'monobank'` | add `'btc_wallet'`, `'binance'` |

`accounts.institution` is already an untyped `text('institution')`
column (no DB-level enum, unlike `holdings.type`/`.currency`), so no
migration is needed there — only the TS-level places that branch on
the literal `'monobank'` string need the two new literals added
alongside it (`isSyncedAccount`, the Connect/Disconnect UI, the
account-detail sync section). `transactions.source` IS a real
Drizzle `text(..., { enum: [...] })` column, so its enum widening
needs a Drizzle migration (`ALTER TABLE` is a no-op for SQLite text
columns at the storage level, but the generated migration file and
the TS enum both need the two new literals — same shape as the
`crypto_asset`/`jar` additions already in history).

`holdings.metadata` (untyped JSON) gains two new shapes, alongside
the existing `{ monobankId }`:
- Wallet: `{ walletAddress: string }`.
- Binance: `{ binanceAsset: 'BTC' }` (fixed value; kept as a field
  rather than a bare marker so a later multi-asset Binance provider
  widens this type instead of replacing it).

## Repositories

- `src/repositories/holdings.repo.ts`: add `upsertExchange`, a
  Monobank-shaped clone of `upsertMonobank` —
  ```ts
  upsertExchange: ({ metadataKey, metadataField, ...rest }: ExchangeHolding) =>
    write(async (tx) => {
      // match on json_extract(metadata, '$.' || metadataField) = metadataKey,
      // same shape as upsertMonobank's monobankId match; update balance in
      // place on a hit, insert with a fresh sortOrder on a miss.
    }),
  ```
  Whether this is one generic `upsertExchange(metadataField, ...)` or
  two thin named wrappers (`upsertBtcWallet`, `upsertBinance`) that
  both call one shared internal helper is an implementation-time
  call, not a design blocker — either shape satisfies "clone
  `upsertMonobank`, match on a metadata key" from the research doc.
- `isSyncedHolding` (`src/holdings/deletable.ts`) widens its check
  from `'monobankId' in meta` to also recognize `'walletAddress'` and
  `'binanceAsset'`, so a wallet/Binance-synced holding is protected
  from manual delete/edit the same way a Monobank holding is.
- `isSyncedAccount` widens from `institution === 'monobank'` to
  `institution === 'monobank' || institution === 'btc_wallet' ||
  institution === 'binance'` (or a `Set`/array membership check —
  implementation detail).

## Sync entry points

- `src/crypto-sync/sync.ts`: `runBalanceSync(provider, overrides)`,
  the generic driver described above, parameterized by
  `BalanceProvider` the same way `runSync` in `monobank/sync.ts` is
  parameterized by `SyncDeps`.
- `src/screens/use-sync.ts` (or a new `use-crypto-sync.ts` beside it,
  matching how `use-auto-sync.ts` sits beside `use-sync.ts`) wires a
  manual "Sync now" action per connected crypto account, calling
  `runBalanceSync` with the concrete provider for that account's
  `institution`.
- Auto-sync: out of scope for this milestone's UI unless trivial to
  wire alongside the existing Monobank auto-sync hook — flag as an
  open question for the implementation plan rather than deciding here.

## Forms / UI

- Account-detail screen (`account-detail.screen.tsx`), for a `crypto`
  kind account: a "Synchronization" section mirroring
  `monobank-token-field.component.tsx`'s structure, but two
  variants:
  - **BTC wallet:** a plain (non-secure) text field for the address,
    a "Save" action that validates the address format and does one
    trial `fetchAddressBalance` call before persisting, and the same
    idle/checking/success/invalid/saveError status line.
  - **Binance:** two secure text fields (API key, secret), a link to
    Binance's API-key-management page (mirrors the
    `MONOBANK_API_URL` link), a "Save" action that does one trial
    `fetchAccount` call before persisting to the Keychain, same
    status shape.
  - Both variants collapse to just the section heading once
    connected, exactly like the Monobank field's `isConnected` branch.
- Which variant renders is picked by how the account was connected
  (a two-choice "Connect a wallet" vs "Connect Binance" entry point
  on the crypto account, analogous to there being exactly one bank
  connection flow today) — exact entry-point copy/flow is an
  implementation-time UI decision, not fixed here.

## Balance history

Neither provider gives a ledger — only a live snapshot, same as a
Monobank jar's `balanceMinorUnits`. No `transactions` rows are
written by a wallet/Binance sync (confirming the research doc's
"balance snapshot ≠ ledger" risk: no historical net-worth series from
these providers beyond whatever `currency_rate_history` already
captures for BTC's price). The `transactions.source` enum values
added above exist for enum-consistency with `institution`, not
because this milestone writes crypto-sourced transaction rows.

## Testing (TDD)

Unit tests, written before the implementation:

- `binance.hmac`: known-vector HMAC-SHA256 signature test (fixed
  key/message/expected-signature triple), so the pure-JS signer is
  verified independent of the network.
- `binance.client`: signs with the injected `now`/`recvWindow`,
  throws on a non-ok response (mirrors `monobank.client.test.ts`
  shape), a clock-skew scenario surfaces Binance's own error message
  rather than being swallowed.
- `binance.provider`: filters `balances[]` to `BTC` only, sums
  `free + locked`, converts to satoshis via `Money.fromMajor`,
  ignores every other asset in the payload.
- `btc-wallet.client`: parses `funded_txo_sum - spent_txo_sum` into
  satoshis, throws on a non-ok response.
- `btc-wallet.provider`: address format validation rejects an
  obviously malformed address before any fetch.
- `holdingsRepo.upsertExchange`: update-in-place on a metadata-key
  match, insert-with-fresh-sortOrder on no match — same two cases
  `upsertMonobank.test.ts` already covers, cloned for the new
  metadata field.
- `runBalanceSync`: resolves/marks the target account, calls the
  injected provider once, upserts the returned balances, rejects
  connecting a second account under an institution that already has
  one connected (mirrors `ensureMonobankAccount`'s "already
  connected" test).
- `isSyncedHolding` / `isSyncedAccount`: widened checks recognize
  `walletAddress` / `binanceAsset` / `'btc_wallet'` / `'binance'`
  alongside the existing Monobank cases.
- Credentials field components (wallet address field, Binance
  key/secret field): idle → checking → success/invalid/saveError
  transitions, mirroring `monobank-token-field.component.test.tsx`.

## Affected files (initial map)

- `src/db/schema.ts` — widen `transactions.source` enum
  (`'btc_wallet' | 'binance'`); a new Drizzle migration for that
  column.
- `src/crypto-sync/provider.ts` (new) — `BalanceProvider` interface,
  `ProviderBalance` type.
- `src/crypto-sync/sync.ts` (new) — `runBalanceSync`.
- `src/crypto-sync/btc-wallet/btc-wallet.client.ts`,
  `btc-wallet.provider.ts` (new) + tests.
- `src/crypto-sync/binance/binance.hmac.ts`,
  `binance.credentials.ts`, `binance.client.ts`,
  `binance.provider.ts` (new) + tests.
- `src/repositories/holdings.repo.ts` — `upsertExchange` (or the two
  named wrappers) + test.
- `src/holdings/deletable.ts` — widen `isSyncedHolding` /
  `isSyncedAccount`.
- `src/screens/account-detail/account-detail.screen.tsx` — crypto
  account sync section, provider-variant branching.
- `src/screens/account-detail/monobank-token-field.component.tsx` —
  used as the direct template for the two new field components
  (wallet-address field, Binance-key field), not modified itself.
- `src/screens/use-sync.ts` / a new `use-crypto-sync.ts` — manual
  sync action wiring.

## Assumptions to confirm

1. **BTC-only first; the currency-model generalization is deferred.**
   Any non-BTC asset (ETH, USDT, SOL, multi-asset Binance, any other
   exchange) is out of scope for this milestone and needs its own
   later spec once the asset-registry generalization is designed.
2. **Ship order: the wallet-address provider before Binance.** The
   wallet provider (no secret, lowest risk) lands first; Binance
   (a real secret in the Keychain, HMAC signing, clock-skew handling)
   lands second, as its own follow-up slice.
3. **Read-only-key security posture.** A Binance key scoped to
   "Enable Reading" only, stored in the Keychain with biometric
   access control, is the accepted security model — no IP allowlist
   (impractical on mobile), and the accepted worst case of a leaked
   read-only key is portfolio-visibility exposure, not fund loss.
   Confirm this posture is acceptable before implementation starts.
