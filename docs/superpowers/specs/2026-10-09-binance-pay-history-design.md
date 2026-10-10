# Binance history: Pay, own-wallet transfers, Simple Earn (BTC)

Date: 2026-10-09. Status: approved by the user 2026-10-09 (D1-D7). Rev 3. A green
VERIFY gate (a live probe) is needed before merge.
Base: main 073114fc. Branch: binance-pay-history.

## Problem

The user sent BTC to another Binance user by Binance ID, and received BTC the same
way. The Binance holdings' balances changed, because the balance sync is correct. No
transaction records either move. Today the history step (`syncBinanceTransactions`,
`src/crypto-sync/binance/binance.transactions.ts`) imports only on-chain BTC
deposits and withdrawals (`/sapi/v1/capital/deposit/hisrec`,
`/sapi/v1/capital/withdraw/history`, `coin=BTC`), and it attaches every row to Spot.

A transfer by Binance ID is a Binance Pay order. Moves between the user's own
wallets, and Simple Earn subscriptions, redemptions and rewards, also change BTC
balances without a row. Convert orders do too, but they are deferred (D7).

Evidence from the user report: the existing capital walk did NOT import the Pay
transfers. So they do not appear in capital history as settled records (Q5).

## Goal

Every Binance movement that changes one of the user's three BTC holdings (Spot
`'BTC'`, Funding `'BTC:funding'`, Earn `'BTC:earn'`) becomes a transaction row on
that holding.

- A movement between two of those holdings becomes two paired internal legs.
- A movement to or from something Kiko does not track (another person, or a
  futures, margin, or options wallet) becomes one leg.
- Every walk is idempotent and resumable, and never fails the balance sync.
- The only counterparty data stored is the Pay nickname (D4).

## User rulings (2026-10-09)

| # | Ruling |
|---|---|
| D1 | A: every BTC Pay order type |
| D2 | C: own-wallet transfers, Simple Earn (subscription, redemption, rewards), and Convert are all in this track. D7 later deferred Convert |
| D3 | A: NEW capital imports are placed by `walletType`. The probe counts old misplaced rows. If there are any, a follow-up moves them, with a review |
| D4 | B: a Pay row's description is the counterparty nickname, and nothing else of the counterparty is stored |
| D5 | A: a new nullable column `untracked_counterpart`. A row with it set is kept out of spending and gets a display label. The migration and its reviewer step are in task 3 |
| D6 | B: one row per Earn reward record. The records have no id, so the key is built from the record's own fields (section 6) |
| D7 | C: Convert is NOT imported for now. It is deferred because Convert history has no wallet field, so the holding a Convert moved cannot be known |

## Sources (official, checked 2026-10-09)

developers.binance.com returned an empty body from this sandbox (HTTP 202, bot
block). Each fact below was confirmed in Binance's official generated SDK
`binance/binance-connector-js` (master), which is built from the same OpenAPI spec as
the docs. Docs pages:

- https://developers.binance.com/docs/pay/rest-api/get-pay-trade-history
- https://developers.binance.com/docs/wallet/capital/withdraw-history
- https://developers.binance.com/docs/wallet/asset/query-user-universal-transfer
- https://developers.binance.com/docs/simple_earn/history/
- https://developers.binance.com/docs/convert/trade/Get-Convert-Trade-History

| # | Endpoint | Weight | Window, depth | Paging | Item fields used | SDK file (`clients/...`) |
|---|---|---|---|---|---|---|
| S1 | `GET /sapi/v1/pay/transactions` | UID 3000 | max 90-day interval; last 18 months only | `limit` (default 100, max 100), no cursor | `orderType`, `transactionId`, `transactionTime`, `amount`, `currency`, `walletType`, `walletTypes`, `fundsDetail[].{currency,amount,walletAssetCost}`, `payerInfo.{name,binanceId}`, `receiverInfo.{name,binanceId}` | `pay/src/rest-api/modules/api.ts`, `pay/.../types/get-pay-trade-history-response*.ts` |
| S2 | `GET /sapi/v1/capital/withdraw/history`, `/capital/deposit/hisrec` | withdraw UID 18000, deposit IP 1 | < 90 days | offset | adds `transferType`, `walletType` (0 spot, 1 funding) | `wallet/.../types/withdraw-history-response-inner.ts`, `deposit-history-response-inner.ts` |
| S3 | `GET /api/v3/account` | (existing) | | | `uid` | `spot/.../types/get-account-response.ts` |
| S4 | `GET /sapi/v1/asset/transfer` | IP 1 | "last 6 months only"; window cap NOT documented; no times means the last 7 days | `current`, `size` (max not documented) | `type` (required param), `asset`, `amount`, `type`, `status`, `tranId`, `timestamp`. No `asset` param | `wallet/src/rest-api/modules/asset-api.ts`, `.../query-user-universal-transfer-history-response*.ts` |
| S5 | `GET /sapi/v1/simple-earn/{flexible,locked}/history/{subscriptionRecord,redemptionRecord,rewardsRecord}` (6 endpoints) | IP 150 each | max 30 days; depth NOT documented | `current` (from 1), `size` (max not documented), response `{rows,total}` | flexible sub: `amount, asset, time, purchaseId, productId, type, sourceAccount, amtFromSpot, amtFromFunding, status`. flexible redeem: `amount, asset, time, projectId, redeemId, destAccount, status`. flexible rewards: `asset, rewards, projectId, type, time` (no id). locked sub: `positionId, purchaseId, projectId, time, asset, amount, lockPeriod, type, sourceAccount, amtFromSpot, amtFromFunding, status`. locked redeem: `positionId, redeemId, time, asset, lockPeriod, amount, originalAmount, type, deliverDate, lossAmount, isComplete, rewardAsset, rewardAmt, extraRewardAsset, estExtraRewardAmt, status`. locked rewards: `positionId, time, asset, lockPeriod, amount, type` (no id). `asset` filter param exists | `simple-earn/src/rest-api/modules/flexible-locked-api.ts`, `.../types/get-{flexible,locked}-*-response-rows-inner.ts` |
| S1a | step 2/9 SDK facts (checked 2026-10-10) | | | | Pay `fundsDetail[].walletAssetCost` is a MAP `{ "<walletType>": "<amount>" }`, not an array; the client normalizes it to `{ walletType, amount }[]`. Flexible `rewardsRecord` `type` is optional (default ALL); the client always sends `type=ALL`, so there is one series. S4 and S5 page size max is 100 (docs) | `facts: .superpowers/sdd/binance-history/task1-sdk-facts.md` |
| S6 (deferred, D7) | `GET /sapi/v1/convert/tradeFlow` | UID 3000 | max 30 days; `startTime` and `endTime` required; depth NOT documented | `limit` (max not in SDK), response `{list, startTime, endTime, limit, moreData}` | `quoteId, orderId, orderStatus, fromAsset, fromAmount, toAsset, toAmount, createTime`. NO wallet field. Placing an order takes `walletType` `SPOT`/`FUNDING`/`EARN` | `convert/src/rest-api/modules/*.ts`, `.../types/get-convert-trade-history-response*.ts` |

Facts the walks rely on:

- **S1 `amount` sign.** The SDK field doc says "Positive means income; negative
  means expenditure."
- **S1 doc comment: which payer/receiver fields each order type and side gets.**

  | orderType | user is sender | user is receiver |
  |---|---|---|
  | C2C | payer: binanceId. receiver: name, plus binanceId/accountId/email/phone (what the user typed) | payer: name. receiver: binanceId |
  | CRYPTO_BOX | payer: binanceId. receiver: name ("Crypto Box") | payer: name. receiver: binanceId |
  | PAY | payer: binanceId. receiver: name | payer: name. receiver: binanceId, name |
  | PAY_REFUND, PAYOUT | payer: binanceId, name. receiver: name, accountId | payer: name. receiver: binanceId |
  | CRYPTO_BOX_RF | (none) | payer: name ("Crypto Box"). receiver: binanceId |
  | REMITTANCE | payer: binanceId. receiver: name, institutionName, cardNumber, digitalWalletId | (none) |
  | C2C_HOLDING, C2C_HOLDING_RF | not listed | not listed |

- **S4 type enum.** Types that touch a tracked wallet: `MAIN_FUNDING` and
  `FUNDING_MAIN` (Spot <-> Funding, both tracked). Untracked wallets: `MAIN_` /
  `_MAIN` and `FUNDING_` / `_FUNDING` with UMFUTURE, CMFUTURE, MARGIN, OPTION, and
  for MAIN also PORTFOLIO_MARGIN, which gives 18 types. The rest of the enum (for
  example UMFUTURE_MARGIN) never touches Spot or Funding and is not read.
- **S2/S4/S5 IP weight.** Unlike the Pay walk, these reads count
  against the IP weight. The SAPI per-minute IP ceiling and its header
  (`X-SAPI-USED-IP-WEIGHT-1M`) are not in the SDK. Both are unverified (Q15).

## Scope

In: four walks (capital, which exists, plus Pay, Transfer, and Earn). Capital
placement by `walletType` (D3). A new column for one-leg movements to something
untracked (D5). Same-currency transfer labels. The history-pending caption covers
every walk.

Out:
- Trades (unchanged).
- Futures, margin, and options wallets are not synced as holdings, so a move to
  them is one leg (D5).
- **Convert is deferred (D7).** Convert history (S6) has no wallet field, and an
  order can pay from Spot, Funding, or Earn, so the holding a Convert moved cannot
  be known. A later spec takes it up if Binance exposes the wallet. The S6 facts
  stay in the source table for that spec. Until then, a Convert's BTC balance
  change has no row.

Not possible (API limits, not design choices): Pay orders older than 18 months and
universal transfers older than 6 months are not returned. Those old rows are
missing. The balances stay correct.

## Design

### 1. Client (`binance.client.ts`; the history reads move to a new `binance.history-client.ts`)

- Each read is one page of one window. Each is signed through `signedRequestPage`,
  so it gets the same HMAC, the same `Cache-Control: no-store`, and the same
  `BinanceRateLimitError` on 429/418. Each read returns
  `{ rows, usedUidWeight1m, usedIpWeight1m }`.
- Reads: `fetchPayHistory` (S1), `fetchUniversalTransfers(type, ...)` (S4),
  `fetchEarnRecords(kind, ...)` for the 6 Earn endpoints (S5, `asset=BTC`). No
  Convert read (D7).
- A parse error or an unknown envelope throws an error with a fixed message (no
  URL, no body). For Pay: a `code` other than `"000000"`, or no `data` array (A1).
- Parsed types keep only the fields in the S-table. For Pay that means
  `payerInfo.{name,binanceId}` and `receiverInfo.{name,binanceId}`. Email, phone,
  accountId, country codes, card number, institution, and digital wallet id are
  never read into a type.
- `fetchAccount` also returns `uid` as a string (S3). It is used in memory for one
  run and never stored.
- No new host: `api.binance.com` is already pinned, and `check:plist` stays as is.

### 2. Shared run budget, pacing, and cooldown (`binance.history-budget.ts`, new)

`runBinanceSyncAndImport` builds, once per Binance arm, ONE request gate
(`createRequestGate`, `BINANCE_REQUEST_INTERVAL_MS`) and ONE `BinanceRunBudget`. It
passes both to every walk, the capital walk included. The capital walk's own
withdraw budget moves into this object, with the same numbers and the same rule.

- Each call names its cost: `{ uid: n }` or `{ ip: n }`. `canAfford(cost)` is true
  when all of these hold:
  - the walk's own per-run call cap is not spent;
  - the last-seen `X-SAPI-USED-UID-WEIGHT-1M` plus the cost is at most 180000
    (UID cost);
  - the last-seen `X-SAPI-USED-IP-WEIGHT-1M` plus the cost is at most
    `IP_BUDGET_1M` (IP cost; default 6000, half of the assumed 12000 ceiling, Q15).
- Every response refreshes both readings.
- Per-run call caps:

  | Walk | Cap |
  |---|---|
  | capital | withdraw 9 (unchanged), deposit unbounded |
  | Pay | 20 |
  | Transfer | 60 |
  | Earn | 30 (4500 IP) |

  Each walk has its own cap so that a long backfill in one walk cannot starve the
  others.
- Order: balance, then capital, Pay, Transfer, Earn. A walk that cannot
  afford its next call stops with `complete: false` and resumes from its watermark
  on a later run. Nothing sleeps until the next minute, because the history import
  is awaited before the sync result returns.
- Cooldown is shared, as today. Each walk is skipped while `isBinanceCoolingDown`.
  A 429/418 in any walk sets the cooldown, stops that walk, and so skips the walks
  after it.

### 3. Common walk shape (each walk is its own file)

- One watermark per walk. Each is a walk-owned key on the Spot holding's metadata:
  `binancePayHistoryCursor`, `binanceTransferHistoryCursor`,
  `binanceEarnHistoryCursor`.
- All of them join `walkOwnedMetadataKeys` (`holding-metadata.ts`). The balance
  upsert carries them and the disconnect resets them to the floor, through the
  existing code paths.
- One generic `holdingsRepo.setBinanceWalkCursor(holdingId, key, ms)` keeps the
  existing `institution = 'binance'` gate.
- Windows go oldest first. The rows of a window are written
  (`transactionsRepo.addManyDedup`) BEFORE its watermark advances. A crash between
  the two re-imports the window idempotently.
- On a re-sync the start is `min(cursor - RESYNC_OVERLAP_MS, end - WINDOW)`, the
  same formula as `resolveStartTime`.
- Each walk is wrapped in its own `logOnFailure` (`@kiko/diagnostics`, name and
  code only). A failure in one walk never fails the balance sync or another walk.
  A permission rejection does not set the cooldown.
- **"Stop the window"** means: do not commit the window, return
  `complete: false`, and log one fixed tag. Nothing is guessed and nothing is
  dropped without a trace. The caption shows that history is behind.
- **Missing target holding (P7).** The walk creates the wallet holding at zero
  balance through `upsertExchangeMany` with the same key, then places the row. An
  absent holding and a zero holding both add 0 to net worth, and the next good
  balance read overwrites the zero.
- **Paired internal legs (both holdings tracked):**
  - each leg's `exchangeCounterpartHoldingId` is the other leg's holding;
  - all legs share a deterministic `exchangePairId` of
    `` `${accountId}:<walk>:<source id>` ``;
  - `description` is `''`;
  - `exchange-exclusion` already keeps such rows out of spending.
  - `exchangeLegDescription` gains a same-currency branch, "Transfer to/from
    {{name}}", because an own-wallet move is not an exchange (section 9).
- **One leg to something untracked (D5-A):**
  - a new nullable column `transactions.untracked_counterpart` holds a stable code
    `wallet:<TYPE>` (UMFUTURE, CMFUTURE, MARGIN, OPTION, PORTFOLIO_MARGIN). The
    `wallet:` prefix leaves room for an `asset:<TICKER>` code if Convert is taken
    up later; no code writes `asset:` now;
  - `exchange-exclusion` also excludes a row whose code is set;
  - the label is resolved at render time: a `wallet:` code gives
    `transferTo/From` with a code-side map of Binance product names (proper
    nouns, not catalogue strings, kiko-translator `PROPER_NOUNS`). An unknown
    code renders the default income/expense label.

### 4. Pay walk (`binance.pay-history.ts`)

- Floor: `max(HISTORY_FLOOR_MS, now - 18 calendar months + 1 day)` (Q6). Windows of
  89 days.
- Paging with no cursor: a full page of 100 sets the next `endTime` to the smallest
  `transactionTime` in that page. Paging does not rely on the response order (Q7).
  The overlap is removed by the key. If a full page makes no progress, stop the
  window (`pay-page-stuck`).
- Filter: `currency === 'BTC'`. A non-BTC order with a BTC `fundsDetail` entry is
  counted and logged as `pay-non-btc-funds` and not imported (Q8).
- Cross-source cap (until Q5 is answered): a Pay window is committed only when its
  end is at or before `binanceHistoryCursor` (the capital walk). An overlap guard
  skips a Pay row, logged as `pay-overlap-skip`, when a committed capital row on
  the same holding has the same signed satoshis and a time within 10 minutes. If
  the probe shows no overlap, both are removed.
- **Direction.** It does not depend on the sign. There are three signals:
  1. Shape: a non-empty `payerInfo.binanceId` means outgoing. Otherwise a
     non-empty `receiverInfo.binanceId` means incoming.
  2. The user's own `uid` matches the payer or the receiver.
  3. The sign.

  Every available signal must agree, and signal 1 or 2 must be present. Otherwise
  stop the window (`pay-direction-ambiguous`).
- Amount: `abs(amount)` through `Money.fromMajor('BTC', ...)`, with the sign from
  the direction.
- Key: `` `${accountId}:pay:${orderType}:${transactionId}:${walletType}` ``. An
  empty `transactionId` stops the window.
- **Description (D4-B).** For outgoing, `receiverInfo.name`; for incoming,
  `payerInfo.name`. The value is trimmed and stored exactly as Binance gives it. If
  it is missing or blank, the literal `'Binance Pay'` is stored (a proper noun, not
  localized). Category: null.

### 5. Transfer walk (`binance.transfer-history.ts`)

- Floor: `now - 6 months + 1 day` (S4). Windows of 30 days (the cap is not
  documented, Q10). Per window, one request series per type in the 18-type list.
  Paging: `current` from 1 and `size=100`, until the gathered rows cover `total` or
  a short page. The window commits only once every type is complete. A first walk
  is about 7 windows x 18 types, which is 126 calls of IP 1, spread over runs by the
  60-call cap.
- Filter: `asset === 'BTC'` and a settled `status` (`CONFIRMED` assumed, Q11). Any
  other status stops the window, so a pending move is retried.
- `MAIN_FUNDING` gives Spot -x and Funding +x as paired legs. `FUNDING_MAIN` is the
  reverse.
- An untracked type gives one leg on Spot (`MAIN`) or Funding (`FUNDING`), with
  `untracked_counterpart = wallet:<other>`, negative when the tracked wallet is the
  source.
- Key: `` `${accountId}:xfer:${tranId}:${holdingKey}` `` (one per leg). Pair id:
  `` `${accountId}:xfer:${tranId}` ``.

### 6. Earn walk (`binance.earn-history.ts`)

- Six record kinds, each read with `asset=BTC`. Windows of 30 days (the S5 cap).
  Paging: `current`/`size=100` until the gathered rows cover `total`. If the
  gathered count is not equal to `total` after a short page (the data shifted
  while paging), stop the window (`earn-page-drift`).
- Floor: 2022-01-01 UTC. That is before Simple Earn launched (assumption); the
  probe reports the earliest record (Q12). With the 30-call cap a first walk takes
  about 10 runs.
- **Subscription** (flexible or locked), with a settled status only (Q13):
  - one Earn +amount leg;
  - debit legs Spot -`amtFromSpot` and Funding -`amtFromFunding`, each only when
    it is above zero;
  - the sum must equal `amount` exactly, or the window stops
    (`earn-split-mismatch`);
  - when both split fields are absent, `sourceAccount` (SPOT or FUNDING) takes the
    whole amount;
  - pair id: `` `${accountId}:earn:sub:<flexible|locked>:${purchaseId}` ``;
  - each debit leg's counterpart is Earn; the Earn leg's counterpart is the larger
    debit leg's holding.
- **Redemption:** Earn -amount, and `destAccount` (SPOT or FUNDING) +amount,
  paired. For locked, `amount` is assumed to be the principal returned.
  `rewardAmt` is NOT imported here, because rewards come from the rewards records
  (Q14). Key: `redeemId`.
- **Rewards (D6-B): one row per reward record.**
  - Each record is income: +`rewards` (flexible) or +`amount` (locked). Rewards
    are not internal and carry no marker. Description: the literal
    `'Binance Earn'`.
  - **Placement (Q14, user ruling A, 2026-10-10).** A reward row has no wallet
    field, so the wallet comes from the kind and the `type`:
    flexible `REALTIME` -> Earn holding; flexible `BONUS` -> Spot holding;
    locked (any `type`) -> Spot holding. Any other or unknown flexible `type`
    (including `REWARDS`) stops the window with the fixed tag
    `earn-reward-type-unknown`: no row is guessed, and the caption shows the walk
    behind. A missing Spot holding is created at 0 (P7).
  - **Known gap.** A locked product that pays its rewards at maturity to the
    redeem destination (Spot, or the same-coin Flexible product = Earn, per
    `redeemTo`) cannot be told apart from the locked reward row, so such a reward
    is placed on Spot. The probe asks whether such rows exist (item 10).
  - Sources (checked 2026-10-10): Binance FAQ, Simple Earn Flexible
    (https://www.binance.com/en/support/faq/get-started-with-binance-simple-earn-flexible-products-3bd1a6eba20a445da1e94bf6cfa52e80):
    REALTIME accrues in the Earn account, BONUS goes to Spot. Binance FAQ, Simple
    Earn Locked
    (https://www.binance.com/en/support/faq/get-started-with-binance-simple-earn-locked-products-af607a50de614350ae57be3e6f616699):
    locked rewards go to Spot daily, with the maturity-paid exception.
  - The records have no id. The group of a record is (kind, `projectId` for
    flexible or `positionId` for locked, `type`, `time`). Within one fetched
    window, the records of one group are sorted by amount in satoshis, ascending,
    and numbered from 0. Key:
    `` `${accountId}:earn:reward:<flexible|locked>:<projectId|positionId>:<type>:<time>:<n>` ``.
  - The key is stable across re-reads as long as Binance returns the same set of
    records for that group. `time` is in the group, so a group never spans two
    windows. A record exactly on a window boundary that comes back in both windows
    gets the same group and the same `n`, so the key dedupes it.
  - **Two identical records** (every field equal) get `n` = 0 and 1. They are kept
    as two rows, because Binance listed two credits and the Earn balance holds
    both. If a later re-read returns only one, the second row stays: the walk
    never deletes a synced row. The probe counts identical records (item 10). If
    it finds any, the coordinator asks the user before merge whether they are real
    double credits.
  - A required field (`time`, the amount, the project or position id) that is
    missing or not finite stops the window.
- Keys for subscriptions and redemptions:
  `` `${accountId}:earn:<kind>:<purchaseId|redeemId>:${holdingKey}` ``.

### 7. Capital walk change (D3-A)

New imports use `walletType` 0 for Spot and 1 for Funding. Rows already imported
keep their holding, because the upsert `set` has no `holdingId`
(`BANK_OWNED_TRANSACTION_COLUMNS`). The probe counts the imported rows with
walletType 1. If there are any, a follow-up task moves them, with a repo change or a
migration and a `kiko:reviewer` step.

### 8. Labels, caption, and i18n (en + uk, translator review before deploy)

- New `transactions.transferTo` / `transactions.transferFrom`: "Transfer to
  {{name}}" / "Transfer from {{name}}". Proposed uk: "Переказ на {{name}}" /
  "Переказ з {{name}}".
- `exchangeLegDescription` chooses transfer or exchange by comparing the two
  holdings' currencies (same currency means transfer). The `wallet:` code branch
  is in section 3.
- Changed `accountDetail.binanceHistoryPending` copy. en: "Some Binance
  transaction history is not imported yet. Kiko will keep importing on each sync."
  uk: "Частину історії транзакцій Binance ще не імпортовано. Кіко продовжить
  імпорт під час наступних синхронізацій."
- `isBinanceHistoryBehind` is true when ANY walk cursor is null or more than a day
  behind.
- The stored literals `'Binance Pay'` and `'Binance Earn'` are data, not catalogue
  strings. They are proper nouns, so they are not translated.

### 9. Privacy (kiko-compliance 5.1.1 / 5.1.5)

- No new data recipient, host, or SDK. The new endpoints use the same pinned host
  and the same key.
- **App Privacy stays "Data Not Collected."** The nickname is read from Binance by
  the device, stored only in the on-device database (SQLCipher), and never sent to
  the developer or any third party.
- The `.kiko` export carries it. The export snapshot selects every transaction
  column, and the file is the user's own encrypted backup
  (`src/data-transfer/crypto/envelope.ts`). The user accepted storing the nickname
  (D4-B).
- The coordinator still checks `memory/refs/resubmission-kit.md` section D during
  review.
- Of the counterparty, only `name` is stored, in `description`. `binanceId` is read
  into memory for the direction rule and then dropped. Email, phone, accountId,
  card number, and institution are never parsed.
- Logs use only fixed tags and counts. No order id, amount, or name is logged.

### 10. Migration (D5-A)

- One migration: `ALTER TABLE transactions ADD untracked_counterpart text`
  (nullable, no index, no backfill). Plus `schema.ts`.
- A `kiko:reviewer` step before BATCH READY. No new index, so no EXPLAIN QUERY PLAN
  test.
- `import-data.back-compat.test.ts` gains a case: an older export without the
  column imports with null.

## Scenario matrices (each row becomes a Jest case)

Pay direction:

| # | case | payer.binanceId | receiver.binanceId | uid | amount | result |
|---|---|---|---|---|---|---|
| 1 | C2C send by Binance ID | own | counterparty | own | -0.001 | out -100000 sat; description = receiver.name |
| 2 | C2C send by email/phone | own | absent | own | -0.001 | out |
| 3 | C2C receive | absent | own | own | +0.001 | in; description = payer.name |
| 4 | C2C receive, uid unknown | absent | own | null | +0.001 | in |
| 5 | send, uid unknown, positive sign | own | x | null | +0.001 | stop |
| 6 | shape out, uid in | x | own | own | -0.001 | stop |
| 7 | no binanceId at all | absent | absent | own | -0.001 | stop |
| 8 | C2C_HOLDING send / C2C_HOLDING_RF | own / absent | x / own | own | - / + | out / in |
| 9 | PAY, PAY_REFUND, CRYPTO_BOX(_RF), PAYOUT, REMITTANCE | per S1 | per S1 | own | -/+ | per shape |
| 10 | unknown orderType, signals agree | own | absent | own | -0.001 | out |
| 11 | amount 0 or not finite | own | x | own | 0 | stop |
| 12 | name blank or missing | own | x | own | -0.001 | description 'Binance Pay' |

Placement (the "was:" column shows today's result):

| # | source | input | result | was: |
|---|---|---|---|---|
| P1 | Pay | walletType 2 | Spot | not imported |
| P2 | Pay | walletType 1 | Funding | not imported |
| P3 | Pay | walletType 5 | Earn | not imported |
| P4 | Pay | [1,2], walletAssetCost sums to abs(amount) | one row per wallet | not imported |
| P5 | Pay | [1,2], sums do not match | stop | not imported |
| P6 | Pay | 3, 4, 6 | stop (Q9) | not imported |
| P7 | any | target holding missing | create it at 0, then place | n/a |
| C1 | capital | walletType 0 | Spot | Spot |
| C2 | capital | walletType 1 | Funding | Spot |

Transfer:

| # | type, status | result |
|---|---|---|
| T1 | MAIN_FUNDING, CONFIRMED | Spot -x, Funding +x, paired, excluded from spending, labels "Transfer to/from" |
| T2 | FUNDING_MAIN | Funding -x, Spot +x, paired |
| T3 | MAIN_UMFUTURE | Spot -x, `wallet:UMFUTURE`, excluded |
| T4 | UMFUTURE_FUNDING | Funding +x, `wallet:UMFUTURE` |
| T5 | status not settled | stop |
| T6 | asset not BTC | ignored |
| T7 | Funding holding missing (T1) | P7, then T1 |

Earn:

| # | record | result |
|---|---|---|
| E1 | flexible sub, amtFromSpot = amount | Spot -a, Earn +a, paired |
| E2 | locked sub, spot 0.3 + funding 0.2 = 0.5 | Spot -0.3, Funding -0.2, Earn +0.5, one pair id |
| E3 | sub, split sum is not amount | stop |
| E4 | sub, no split fields, sourceAccount FUNDING | Funding -a, Earn +a |
| E5 | flexible redeem, destAccount SPOT | Earn -a, Spot +a, paired |
| E6 | locked redeem, rewardAmt > 0 | principal legs only; reward comes from E7 |
| E7 | one flexible `REALTIME` reward record | Earn +rewards, 'Binance Earn', key ends `:<time>:0` |
| E8 | two rewards in one group, amounts 0.00000002 and 0.00000001 | two rows, `n` 0 = 0.00000001, `n` 1 = 0.00000002 |
| E9 | two identical reward records | two rows (`n` 0 and 1) |
| E10 | re-read returns the same group | same keys, no new rows |
| E11 | reward on a window boundary, returned by both windows | one row (same key) |
| E12 | reward with missing `time` or a non-finite amount | stop |
| E13 | gathered rows are not equal to `total` | stop (`earn-page-drift`) |
| E14 | status not settled | stop |
| E15 | one flexible `BONUS` reward record | Spot +rewards, 'Binance Earn', no marker |
| E16 | one locked reward record (any `type`) | Spot +amount, 'Binance Earn', no marker |
| E17 | flexible reward with `type` `REWARDS` or an unknown value | stop (`earn-reward-type-unknown`), no row, cursor unmoved |
| E18 | `BONUS` or locked reward, Spot holding missing | Spot created at 0 (P7), then the row |

Convert: not imported (D7). No walk, no rows.

## Tests (Jest)

- Fixtures are built from the S-table shapes. There is one case per matrix row,
  plus these mechanics:
  - Pay: paging by narrowed `endTime`, and the stuck-page stop;
  - Transfer and Earn: paging by `current`/`total`;
  - each walk: windows from its floor, and the re-sync overlap;
  - shared budget: UID and IP readings, per-walk caps, and a walk that stops when
    the budget runs out while the next walk still runs;
  - cooldown set and skip, and commit order;
  - idempotent re-sync, and the Pay cap and overlap guard;
  - the new metadata keys are carried and reset;
  - `run-crypto-sync`: one shared gate and budget, and a failure in each walk is
    isolated;
  - the caption with any walk behind;
  - `exchangeLegDescription` transfer and `wallet:` branches, and an unknown code;
  - `exchange-exclusion` with `untracked_counterpart`;
  - export back-compat.
- Client tests: path, params, signing, envelope parse, a fixed-message error, PII
  fields absent from the parsed objects, header parse, and 429 handling.

## VERIFY gate (before merge): live probe run by the user

The script is `memory/refs/binance-history-verify.sh`, which is gitignored and
never shipped. It follows the `memory/refs/eodhd-verify.sh` pattern:

- hidden prompt for the key and secret;
- `openssl` HMAC from stdin, and curl `--config -`;
- masked URLs;
- counts, field names, and types only, never a raw body, id, amount, or name.

The planner or developer reads the whole script before it goes to the user. The
output goes to `memory/refs/binance-history-verify-output-<date>.txt`. The
coordinator merges only when every Q is answered or its safe default is confirmed.
A finding that changes a rule updates this spec first.

Probe items:

1. Pay: HTTP status / `code` with the read-only key.
2. Pay: per orderType and side, how often the shape, uid, and sign signals agree.
3. Pay: duplicate `transactionId` count within a type and across types.
4. Capital BTC: counts by `transferType` and `walletType`. The number of Pay rows
   matching a capital row (equal |amount|, within 10 minutes). The number of
   imported walletType=1 rows (for D3).
5. Pay: the result of a `startTime` older than 18 months.
6. Pay: ascending or descending order.
7. Pay: non-BTC orders with a BTC `fundsDetail` entry.
8. Pay: counts by walletType and walletTypes, and how often walletAssetCost sums
   match.
9. Transfer: per type, the BTC row count, the `status` values, the result of a
   window over 30 days, and the largest accepted `size`.
10. Earn: per kind, the `status` values, the `sourceAccount`/`destAccount`
    values, how often `amtFromSpot` + `amtFromFunding` = `amount`, the earliest
    record date, the largest `size`, the count of rewards `type` values per kind
    (before the merge, for Q14), and for locked redemptions how `amount` relates
    to `originalAmount`, `lossAmount`, and `rewardAmt`. Maturity-paid question
    (Q14 gap): whether locked reward rows exist that are paid at maturity to the
    redeem destination, for example by comparing locked reward rows to locked
    positions and redemptions with `redeemTo` FLEXIBLE. For rewards: the number of groups with more than one record, and
    the number of fully identical records (E9). Any identical record goes to the
    user before merge.
11. Every SAPI response: whether `X-SAPI-USED-IP-WEIGHT-1M` and
    `X-SAPI-USED-UID-WEIGHT-1M` are present.

## Open questions (each has a safe default)

| # | Question | Safe default | Probe |
|---|---|---|---|
| Q1 | Is a read-only key enough for each new endpoint? | Logged, no cooldown, the balance is unaffected, and the caption shows "behind" | 1, 9, 10 |
| Q2 | Is the Pay sign as the SDK states? | Sign is a cross-check only | 2 |
| Q3 | Does the shape rule hold for every type (C2C_HOLDING* are not listed)? | All signals must agree, or stop | 2 |
| Q4 | Is `transactionId` unique and stable? | orderType and walletType are in the key | 3 |
| Q5 | Do Pay transfers also appear in capital history? | Cap plus the 10-minute guard. Remove both if there is no overlap | 4 |
| Q6 | Pay `startTime` older than 18 months? | The floor is 18 months plus 1 day | 5 |
| Q7 | Pay response order? | Page by the minimum time | 6 |
| Q8 | Can BTC fund a non-BTC Pay order? | Logged, not imported. If any are found, the spec gets a rule before merge | 7 |
| Q9 | Pay walletType 3/4/6 or combined payments? | Stop | 8 |
| Q10 | Universal transfer window cap and `size` max? | 30-day windows, size 100 | 9 |
| Q11 | Universal transfer settled status value? | Only `CONFIRMED`. Anything else stops | 9 |
| Q12 | Earn history depth? | Floor 2022-01-01. Older windows return empty | 10 |
| Q13 | Earn settled status values? | Only `SUCCESS`. A pending status stops, a final failure is ignored | 10 |
| Q14 | Where do Earn rewards land, and what does a locked redemption's `amount` mean? | ANSWERED, ruling A (user, 2026-10-10): flexible `REALTIME` -> Earn, flexible `BONUS` -> Spot, locked -> Spot, other flexible `type` stops (`earn-reward-type-unknown`); sources: the two FAQ URLs in section 6. Known gap: maturity-paid locked rewards. Redemption legs use `amount`. `rewardAmt` is not imported from redemptions | 10 (reward `type` counts per kind; maturity-paid question) |
| Q15 | The SAPI IP ceiling and the IP header? | `IP_BUDGET_1M` 6000 and the per-walk caps, which hold even without the header | 11 |
| Q16 | Are there fully identical reward records? | Each one is kept as its own row (E9) | 10 |
| A1 | The Pay success `code` is `"000000"` | A missing `data` array or an unknown code is an error | 1 |

## Still needing the user

- Run the probe script (task 7/7) and send back its output.
- Before merge: if probe item 10 finds identical reward records (Q16), confirm
  whether they are real double credits.
- Optional: check one BONUS or locked reward in the Binance app and say which
  wallet it landed in. Q14 itself is ruled (A, 2026-10-10).

## Change sets (7 tasks, track `binance-history`)

Each task touches at most 12 source files, which is far under the 30-file cap.
Before each `make deep`, `KIKO_MUTATION_BASE=<task base sha> make mutable` gives
the exact count. Each task gets its own `make deep` with its own base. `make verify`
runs once at the end.

- task 1/7: client reads (`binance.client.ts`, new `binance.history-client.ts`):
  Pay, universal transfer, and the 6 Earn reads. `uid` on `fetchAccount`. Tests.
- task 2/7: `binance.history-budget.ts` (shared gate, UID/IP budget, caps), the
  capital walk moved onto it, C2 placement by walletType, generic
  `setBinanceWalkCursor`, the three new walk-owned keys, `run-crypto-sync` wiring
  of the shared objects, and tests.
- task 3/7: migration `untracked_counterpart`, `schema.ts`, `exchange-exclusion`,
  the `exchangeLegDescription` transfer and `wallet:` branches, the
  `transferTo/From` keys (en + uk), the export back-compat test, and a
  `kiko:reviewer` step before BATCH READY (no index, so no EXPLAIN QUERY PLAN
  test).
- task 4/7: Pay walk (`binance.pay-history.ts`): direction, placement, the
  nickname description, the cap and guard, and tests.
- task 5/7: Transfer walk (`binance.transfer-history.ts`) and tests.
- task 6/7: Earn walk (`binance.earn-history.ts`), including per-record rewards
  with the group-ordinal key. Also the caption logic (`isBinanceHistoryBehind`
  over all cursors) and copy (en + uk), moved here from the dropped Convert task.
  Tests.
- task 7/7: the probe script (memory/refs, user run) as the VERIFY gate, and the
  kiko-architecture "Binance transaction history" rewrite (via scribe). The
  rewrite records that Convert is deferred and why.

The probe (task 7/7) can run as soon as task 1/7 lands, because it needs no app
code. Run it early, so that Q answers reach tasks 4-6 before they are reviewed.
