# Binance Pay history: import BTC transfers by Binance ID

Date: 2026-10-09. Status: DRAFT, needs the user decisions in "User decisions" and
a green VERIFY gate (live probe) before merge.
Base: main 073114fc. Branch: binance-pay-history.

## Problem

The user sent BTC to another Binance user by Binance ID, and received BTC the same
way. The Binance holdings' balances changed (the balance sync is correct), but no
transaction records either move. Today the Binance history step
(`syncBinanceTransactions`, `src/crypto-sync/binance/binance.transactions.ts`)
imports only on-chain BTC deposits and withdrawals
(`/sapi/v1/capital/deposit/hisrec`, `/sapi/v1/capital/withdraw/history`, `coin=BTC`)
and attaches every row to the Spot holding. A transfer by Binance ID is a Binance
Pay "C2C" order. It is recorded only in the Binance Pay history.

Evidence from the user report: the existing capital walk did NOT import these
transfers. So they do not appear in capital history as a settled record (see Q5).

## Goal

Every Binance Pay order that moves the user's BTC becomes one transaction row on the
holding of the wallet it moved. The step is idempotent and resumable. It never fails
the balance sync and never stores another person's contact data.

## Sources (official, checked 2026-10-09)

- S1. Binance Pay history, `GET /sapi/v1/pay/transactions`:
  https://developers.binance.com/docs/pay/rest-api/get-pay-trade-history
  The page did not load from this sandbox (empty body, bot block). Every field
  below was confirmed in Binance's official generated SDK, which is generated
  from the same OpenAPI spec as the docs page:
  https://github.com/binance/binance-connector-js/blob/master/clients/pay/src/rest-api/modules/api.ts
  and `clients/pay/src/rest-api/types/get-pay-trade-history-response*.ts`.
  - Signed, Weight(UID) 3000. Params `startTime`, `endTime` (ms), `limit`
    (default 100, max 100), `recvWindow`. No cursor and no offset.
  - No `startTime`/`endTime` means the last 90 days. The maximum interval is
    90 days. Only orders from the last 18 months can be queried.
  - Response `{ code, message, data: [...] }`. Item fields: `orderType` (PAY,
    PAY_REFUND, C2C, CRYPTO_BOX, CRYPTO_BOX_RF, C2C_HOLDING, C2C_HOLDING_RF, PAYOUT,
    REMITTANCE), `transactionId`, `transactionTime` (ms), `amount` (string, up to 8
    decimals), `currency`, `walletType` (1 funding, 2 spot, 3 fiat, 4 or 6 card,
    5 earn), `walletTypes` (array, "multiple values may appear for combined
    payments"), `fundsDetail[] { currency, amount, walletAssetCost: { "<walletType>":
    amount } }`, `payerInfo { name, type, binanceId }`, `receiverInfo { name, type,
    email, binanceId, accountId, countryCode, phoneNumber, mobileCode, extend {
    institutionName, cardNumber, digitalWalletId } }`.
  - The SDK field doc for `amount` says: "Positive means income; negative means
    expenditure."
  - Which fields `payerInfo`/`receiverInfo` carry, per order type and side (doc
    comment, verbatim in substance):

    | orderType | user is sender | user is receiver |
    |---|---|---|
    | C2C | payer: binanceId. receiver: name, plus binanceId/accountId/email/countryCode/phoneNumber/mobileCode (what the user typed) | payer: name. receiver: binanceId |
    | CRYPTO_BOX | payer: binanceId. receiver: name ("Crypto Box") | payer: name. receiver: binanceId |
    | PAY | payer: binanceId. receiver: name | payer: name. receiver: binanceId, name |
    | PAY_REFUND | payer: binanceId, name. receiver: name, accountId | payer: name. receiver: binanceId |
    | PAYOUT | payer: binanceId, name. receiver: name, accountId | payer: name. receiver: binanceId |
    | CRYPTO_BOX_RF | (none) | payer: name ("Crypto Box"). receiver: binanceId |
    | REMITTANCE | payer: binanceId. receiver: name, institutionName, cardNumber, digitalWalletId | (none) |
    | C2C_HOLDING, C2C_HOLDING_RF | not listed | not listed |

- S2. Withdraw history: https://developers.binance.com/docs/wallet/capital/withdraw-history
  (SDK: `clients/wallet/src/rest-api/types/withdraw-history-response-inner.ts`).
  Items carry `transferType` and `walletType` (0 spot, 1 funding). Weight(UID)
  18000. The meaning of the `transferType` values is not documented on the page.
  Deposit history items carry `transferType` and `walletType` too.
- S3. Spot account, `GET /api/v3/account`, carries `uid` (SDK
  `clients/spot/src/rest-api/types/get-account-response.ts`). `fetchAccount` already
  calls it, but `BinanceAccount` parses only `balances`.
- S4. Convert history `GET /sapi/v1/convert/tradeFlow` (weight 3000, 30-day
  window), own-wallet transfers `GET /sapi/v1/asset/transfer` (needs `type`, for
  example `MAIN_FUNDING`/`FUNDING_MAIN`), Simple Earn records. Used only for the
  deferral decision D2. Not verified in detail.

## Scope

In scope (subject to D1):

- The Binance Pay history, BTC only, every documented order type (D1-A). C2C send
  and receive are the must-have. C2C_HOLDING, C2C_HOLDING_RF, refunds, and the other
  types use the same endpoint, the same call, and the same mapping. Each one changes
  the BTC balance. If they are left out, the user gets the same unexplained balance
  change again.
- New capital deposit/withdraw imports placed by their `walletType` (D3-A).
- The history-pending caption and its copy cover Pay history too.

Out of scope (deferred, D2): own-wallet transfers (Spot <-> Funding <-> Earn),
Simple Earn subscribe/redeem, Convert, trades. Each one uses a different endpoint
with its own window and weight rules. Own-wallet moves need two paired legs that
the spending view sees as internal. That is a separate design.

Not possible: Pay orders older than 18 months. The API does not return them (S1).
The balance stays correct. Only those old ledger rows are missing. This limit comes
from Binance, not from a design choice.

No migration. The new watermark is a metadata JSON key, and rows use existing
columns.

## Design

### 1. Client: `fetchPayHistory` (`binance.client.ts`)

- `GET /sapi/v1/pay/transactions`, signed through `signedRequestPage` (the same
  HMAC, the same `Cache-Control: no-store`, and the same `BinanceRateLimitError` on
  429/418). It returns `{ rows, usedUidWeight1m }`, like `WithdrawHistoryPage`.
- Params: `startTime`, `endTime`, `limit=100`. It does NOT send `currency`
  (the endpoint has no such filter). The walk filters for BTC.
- Parse: `code` other than the success code (`"000000"`, assumption A1) or a
  missing `data` array throws an error with a fixed message (no URL, no body).
- `BinancePayOrder` keeps ONLY: `orderType`, `transactionId`, `transactionTime`,
  `amount`, `currency`, `walletType`, `walletTypes`, `fundsDetail` (currency,
  amount, walletAssetCost), `payerInfo.binanceId`, and `receiverInfo.binanceId`.
  Name, email, phone, accountId, country codes, card number, and institution are
  never read into the type (compliance, section 7).
- `fetchAccount` also returns `uid` as a string (S3) for the direction rule. It is
  read only for this step and never stored.
- No new host. `api.binance.com` is already pinned. `check:plist` stays as is.

### 2. Walk: `binance.pay-history.ts` (new, beside `binance.transactions.ts`)

`syncBinancePayHistory({ targetAccountId }, overrides)` returns
`{ imported, complete }`. It has the same deps-seam pattern as
`BinanceTransactionSyncDeps`.

- **Floor:** `max(HISTORY_FLOOR_MS, now - 18 calendar months + 1 day)`. Q6 checks
  how Binance treats an older `startTime`.
- **Windows:** contiguous 89-day windows (strictly under the 90-day cap), oldest
  first. A re-sync starts at `min(cursor - RESYNC_OVERLAP_MS, end - WINDOW_MS)`,
  the same formula as `resolveStartTime`. With an 18-month floor, a first walk is
  about 7 windows.
- **Paging inside a window (no cursor):** request `[start, end]`, limit 100. A
  full page means: set the next `endTime` to the smallest `transactionTime` in that
  page (do not rely on the response order, Q7), then request again. The overlap at
  that boundary is removed by the dedupe key. If a full page makes no progress
  (its smallest time equals the current `endTime`), stop: do not commit, and log
  `pay-page-stuck`. `MAX_PAGES_PER_WINDOW` is the backstop.
- **Budget:** at most `PAY_CALLS_PER_RUN_FALLBACK` (20, that is 60k of the 180k
  per-minute UID weight). The budget is tightened by `X-SAPI-USED-UID-WEIGHT-1M`
  with the same `canAfford` rule as the withdraw budget (weight
  `PAY_UID_WEIGHT = 3000`). The capital walk's 9 withdraw calls (162k) can already
  use most of the minute. That is why the header check is needed, not only the
  call count.
- **One pacing gate per Binance arm:** `runBinanceSyncAndImport` builds ONE
  `createRequestGate` and passes it into both history steps (a new optional `gate`
  param on each step, not a deps seam). Without it, the first Pay request can fire
  less than `BINANCE_REQUEST_INTERVAL_MS` after the last capital request.
- **Cooldown:** shared. The step is skipped while `isBinanceCoolingDown`. A
  429/418 sets the cooldown and stops with `complete: false`. Windows already
  committed stay in place.
- **Commit order:** the rows of a window are written first
  (`transactionsRepo.addManyDedup`), then the watermark. This is the same
  crash-safe order as the capital walk.
- **Watermark:** a new walk-owned key `binancePayHistoryCursor` on the Spot
  holding's metadata (Spot is the connection's anchor and is always written).
  Add it to `walkOwnedMetadataKeys` (`holding-metadata.ts`). Then the balance
  upsert carries it, and the disconnect resets it to the floor, both through the
  existing code paths. A new `holdingsRepo.setBinancePayHistoryCursor` has the same
  `institution = 'binance'` gate as `setBinanceHistoryCursor`.
- **Cross-source cap (safe default until Q5 is answered):** a Pay window is
  committed only if its end is at or before the capital walk's watermark
  (`binanceHistoryCursor`). If the capital walk is behind, the Pay walk stops
  (`complete: false`) and continues on a later run. Then the overlap guard in
  section 4 sees every capital row that could duplicate a Pay row.

### 3. Mapping one Pay order to rows

Filter: `currency === 'BTC'`. A non-BTC order with a BTC `fundsDetail` entry is
counted and logged as `pay-non-btc-funds` and not imported (Q8).

**Direction rule.** It does not depend on the sign. It uses up to three signals:

1. Shape (S1 table). A non-empty `payerInfo.binanceId` means outgoing. Otherwise,
   a non-empty `receiverInfo.binanceId` means incoming. Neither means no signal.
2. Own identity, when `uid` is known: `payerInfo.binanceId === uid` means
   outgoing, `receiverInfo.binanceId === uid` means incoming.
3. Sign (SDK field doc): a negative amount means outgoing, a positive amount means
   incoming.

The direction is the value that every available signal agrees on, and at least
one of signals 1 and 2 must be available. Any disagreement, or a zero amount, means
"ambiguous". An ambiguous order stops the window (no commit, `complete: false`,
logged as `pay-direction-ambiguous`). It is never imported with a guessed sign and
never dropped without a trace. The caption shows that history is behind.

Scenario matrix for direction (each row becomes a Jest case):

| # | orderType, side | payer.binanceId | receiver.binanceId | uid | amount | result |
|---|---|---|---|---|---|---|
| 1 | C2C send by Binance ID | own | counterparty | own | -0.001 | out, -100000 sat |
| 2 | C2C send by email/phone | own | absent | own | -0.001 | out |
| 3 | C2C receive | absent | own | own | +0.001 | in, +100000 sat |
| 4 | C2C receive, uid unknown | absent | own | null | +0.001 | in (shape + sign) |
| 5 | C2C send, uid unknown, sign positive | own | x | null | +0.001 | ambiguous, stop |
| 6 | shape out, uid says in | x | own | own | -0.001 | ambiguous, stop |
| 7 | no binanceId anywhere | absent | absent | own | -0.001 | ambiguous, stop (sign alone is not enough) |
| 8 | C2C_HOLDING send | own | x | own | -0.001 | out |
| 9 | C2C_HOLDING_RF (refund to sender) | absent | own | own | +0.001 | in |
| 10 | PAY to merchant | own | absent | own | -0.0005 | out |
| 11 | PAY_REFUND received | absent | own | own | +0.0005 | in |
| 12 | CRYPTO_BOX send / receive / RF | per S1 | per S1 | own | -/+ | out / in / in |
| 13 | unknown orderType, signals agree | own | absent | own | -0.001 | out (the rule does not depend on the type) |
| 14 | amount "0" | own | x | own | 0 | ambiguous, stop |

**Amount:** `abs(amount)` goes through `Money.fromMajor('BTC', ...)`, and the sign
comes from the direction. A non-finite amount or time is ambiguous.

**Holding placement** (Spot `'BTC'`, Funding `'BTC:funding'`, Earn `'BTC:earn'`):

| # | walletTypes / walletType | result | was: (capital rows today) |
|---|---|---|---|
| P1 | [2] or 2 | Spot | Spot |
| P2 | [1] or 1 | Funding | (Pay: not imported) |
| P3 | [5] or 5 | Earn | (Pay: not imported) |
| P4 | [1,2], walletAssetCost sums exactly to abs(amount) | one row per wallet, each with its own share | (Pay: not imported) |
| P5 | [1,2], sums do not match | stop window, `pay-split-mismatch` | (Pay: not imported) |
| P6 | 3, 4, 6 (fiat, card) | stop window, `pay-wallet-unplaced` (Q9) | (Pay: not imported) |
| P7 | target holding does not exist | create the wallet holding at zero balance through `upsertExchangeMany` with the same key, then place the row | (n/a) |
| C1 | capital deposit/withdraw, walletType 0 | Spot | Spot |
| C2 | capital deposit/withdraw, walletType 1 (D3-A) | Funding | Spot |

P7 explained: an absent holding and a zero holding both add 0 to net worth. The
next successful balance read overwrites the zero. Without P7, a Funding receipt
whose wallet is now empty could never be placed. Row C2 changes only NEW capital
imports. Rows that are already imported keep their holding, because the upsert
`set` has no `holdingId` (`BANK_OWNED_TRANSACTION_COLUMNS`).

### 4. Dedupe

- Key: `` `${accountId}:pay:${orderType}:${transactionId}:${walletType}` `` with
  `source: 'binance'`, through `addManyDedup`. The account-id prefix is required
  because the index is global ("Namespaced synced externalId"). `orderType` is in
  the key because uniqueness of `transactionId` across types is not documented
  (Q4). `walletType` is in the key so that the legs of a P4 split stay distinct.
- An empty `transactionId` is ambiguous (stop the window). It is not keyed by time.
- Cross-source overlap guard (safe default, removed if Q5 shows no overlap): before
  a Pay window is committed, a Pay row is skipped and counted as `pay-overlap-skip`
  when a committed capital row on the same holding has the same signed satoshis
  and a time within 10 minutes. The cap in section 2 makes sure those capital rows
  are already committed.

### 5. Wiring and failure isolation

`runBinanceSyncAndImport` (`run-crypto-sync.ts`) runs, in order: the balance sync,
then the capital walk, then the Pay walk. Each history step has its own
`logOnFailure` wrapper (`@kiko/diagnostics`, name and code only). So a Pay failure
(permission, malformed body) never fails the balance sync or the capital walk, and
the reverse also holds. A permission rejection does not set the cooldown.

### 6. Rows and display

- Row: `{ holdingId, amountMinorUnits, time: transactionTime, source: 'binance',
  externalId, description }`. No category (null), like the capital rows.
- `description`: per D4. The recommendation is the literal `'Binance Pay'`. It is a
  brand proper noun (kiko-translator: Binance is in `PROPER_NOUNS`, kept as
  written). It is stable and not localized, so the category-apply name rule can
  group the rows, the same reason the capital rows store `'BTC'`.
- Caption: `isBinanceHistoryBehind` also uses `binancePayHistoryCursor`. It is
  behind when EITHER cursor is null or more than a day behind. Before the account's
  first Pay walk, a missing Pay cursor counts as behind.

### 7. Privacy (kiko-compliance 5.1.1 / 5.1.5)

- No new data recipient. The request goes to the same host with the same key. The
  App Privacy answers do not change. The coordinator still checks
  `memory/refs/resubmission-kit.md` section D as part of review.
- The other person's name, email, phone, Binance ID, Pay ID, card number, and
  institution are not parsed into the type, not stored in any column, and not
  logged. The user's own `uid` is held in memory for one run and is not stored.
- Logs use only fixed tags and counts (`pay-direction-ambiguous` and the others).
  No order id and no amount.

### 8. i18n

- Changed: `accountDetail.binanceHistoryPending` (en + uk) now covers transfers.
  Proposed en: "Some Binance transaction history is not imported yet. Kiko will
  keep importing on each sync." Proposed uk: "Частину історії транзакцій Binance ще
  не імпортовано. Кіко продовжить імпорт під час наступних синхронізацій." Both
  copies go to translator review before deploy.
- No new key with D4-A or D4-C. D4-B adds none either (the nickname is data).

### 9. Tests (Jest)

- Fixtures are built from the S1 shapes: one per row of the direction matrix and
  of the placement matrix, plus a full 100-item page for paging.
- `binance.client.test.ts`: path, signed query, `limit=100`, no `currency` param,
  `{code,data}` parse, a non-success code throws a fixed message, PII fields absent
  from the parsed object, the weight header is parsed, 429 gives
  `BinanceRateLimitError`.
- `binance.pay-history.test.ts`: the direction matrix (rows 1-14), the placement
  matrix (P1-P7), paging by narrowed `endTime` including the stuck-page stop, the
  window walk from the 18-month floor, re-sync overlap, budget and header
  tightening, the cap at the capital watermark, the overlap guard, commit order
  (rows before cursor; a crash between them re-imports idempotently), the cooldown
  skip and set, and idempotent re-sync (no duplicates).
- `binance.transactions.test.ts`: C1/C2 placement, with "was:" cases for the old
  Spot-only behaviour.
- `holding-metadata` / `holdings.repo` tests: the new key is carried by the upsert
  and reset to the floor on disconnect. The cursor write is a no-op once the
  account is no longer Binance.
- `run-crypto-sync` test: a Pay failure is logged, and the balance result and the
  capital walk are unaffected. There is one shared gate.
- `binance-history-status` test: either cursor behind means the caption shows.

## VERIFY gate (before merge): live probe run by the user

A script the user runs in their own terminal (pattern:
`memory/refs/eodhd-verify.sh`). It is written to
`memory/refs/binance-pay-verify.sh`, which is gitignored and never shipped. The
planner or developer reads the whole script before it goes to the user.

- Reads the API key and secret with a hidden prompt. Signs with `openssl dgst
  -sha256 -hmac` from stdin. Passes the key header to curl through `--config -`.
  Masks every URL. Never prints the key, the raw body, or any payer/receiver field
  value.
- Prints counts and field names/types only:
  1. HTTP status / `code` of `/sapi/v1/pay/transactions` with the read-only key (Q1).
  2. Per orderType and side: how often the shape, uid, and sign signals agree or
     disagree (Q2, Q3).
  3. Duplicate `transactionId` count within one type and across types (Q4).
  4. Capital BTC history: counts by `transferType` and `walletType`. The number of
     Pay rows with a capital row of equal |amount| within 10 minutes (Q5, D3).
  5. The response to a `startTime` older than 18 months: the error code or the row
     count (Q6).
  6. Whether the items come in ascending or descending time order (Q7).
  7. The number of non-BTC orders with BTC `fundsDetail` entries (Q8).
  8. Counts by walletType and walletTypes, and how often walletAssetCost sums match
     (P4-P6, Q9).
- The anonymized output goes to `memory/refs/binance-pay-verify-output-<date>.txt`.
- Gate: the coordinator merges only when every Q below is answered or its safe
  default is confirmed. Any finding that changes a rule updates this spec first.

## Open questions (each has a safe default)

| # | Question | Safe default in the design | Probe item |
|---|---|---|---|
| Q1 | Is a read-only key enough for Pay history? | A failure is logged, no cooldown, the balance is unaffected, and the caption shows "behind" | 1 |
| Q2 | Is the amount signed as the SDK doc says? | Sign is only a cross-check. A disagreement stops the window | 2 |
| Q3 | Does the shape rule hold for every type (C2C_HOLDING* are not in the S1 table)? | Three signals must agree. Otherwise stop | 2 |
| Q4 | Is `transactionId` unique and stable (across types and across re-reads)? | `orderType` and `walletType` are part of the key | 3 |
| Q5 | Do Pay C2C transfers also appear in capital history (`transferType` 1)? User report suggests no | Cap at the capital watermark plus the 10-minute overlap guard. If the probe shows no overlap, drop both | 4 |
| Q6 | Is a `startTime` older than 18 months an error or an empty page? | The floor is now minus 18 months plus 1 day | 5 |
| Q7 | Response order | Paging uses the minimum time in the page, not the order | 6 |
| Q8 | Can BTC fund a non-BTC Pay order (`fundsDetail`)? | Counted and logged, not imported. If the probe shows any, the spec gets a rule before merge | 7 |
| Q9 | Do walletType 3/4/6 or combined payments occur for BTC? | Stop the window (visible), never guess a holding | 8 |
| A1 | Success `code` value is `"000000"` | Treat a missing `data` array as an error, and an unknown code as an error | 1 |

## User decisions (recommendation first)

- **D1. Which Pay order types?**
  A (recommended): every BTC Pay type. It is the same single call, and each type
  changes the balance. B: the C2C family only (C2C, C2C_HOLDING, C2C_HOLDING_RF).
  C: C2C only.
- **D2. Own-wallet transfers, Earn, Convert?**
  A (recommended): defer them to their own spec after this ships. B: add only
  Spot <-> Funding own-wallet transfers now, as paired internal legs. C: all three
  now.
- **D3. Capital deposit/withdraw placement (today everything goes to Spot).**
  A (recommended): place NEW capital imports by `walletType` (0 Spot, 1 Funding).
  The probe counts walletType=1 rows already imported. Only if that count is above
  0, a follow-up moves them (it needs a repo change or migration, plus a
  `kiko:reviewer` step). B: leave capital placement on Spot. C: move the existing
  rows now in this feature.
- **D4. Row description.**
  A (recommended): the literal `'Binance Pay'` (brand name, no PII, groups for the
  category rule). B: the counterparty nickname (`name`, which is another person's
  data, stored on the device). C: `'BTC'`, the same as the capital rows (Pay rows
  cannot be told apart from on-chain rows).

## Change sets (for the later plan)

Track `binance-pay`. Each task is small enough for its own `make deep` with
`KIKO_MUTATION_BASE` set to its own base commit. `make verify` runs once at the end.

- task 1/4: client `fetchPayHistory`, `uid` on `fetchAccount`, and their tests.
- task 2/4: `binance.pay-history.ts` walk, mapping, direction and placement,
  dedupe, and the tests.
- task 3/4: metadata key, repo cursor writer, wiring with the shared gate, C2
  placement, caption logic and copy (en + uk), and their tests.
- task 4/4: the probe script (memory/refs), the VERIFY gate, and the
  kiko-architecture "Binance transaction history" section (via scribe).
