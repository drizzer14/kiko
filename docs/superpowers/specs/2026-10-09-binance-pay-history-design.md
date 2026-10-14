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

## Rulings of 2026-10-12

| # | Ruling | Where |
|---|---|---|
| OVERNIGHT 17 (R28) | User ruling 2026-10-12 (kept): a stop in the forward pass ends only the forward pass; the run goes on to the owed ranges, the re-scan and the points. The cursor still never passes the stuck record (A2) (Transfer: see O1) | sections 5, 7 |
| OVERNIGHT 18 | User ruling 2026-10-12, A (confirmed): the Transfer and Earn walks follow option A. The other rows of a span import; only the stuck record is owed, at its point | sections 5, 6 |
| OVERNIGHT 19 | User ruling 2026-10-12, A (confirmed): `LANE_CALL_CAPS.transfer` = 80 | section 2 |
| OVERNIGHT 20 | User ruling 2026-10-12, B: the "history is behind" caption shows while a walk cursor is null or more than a day behind, and (Coordinator ruling) while the Transfer walk owes a range, in one type or in every type; an owed point does not show it (was: the applied default also showed it for an owed point) | section 8 |
| OVERNIGHT 21 | User ruling 2026-10-12, B (the spec rule kept): a `FAILED` transfer stays owed at its point until the 6-month floor drops it. VERIFY 14 still records the exact status values, for the record; no rule waits on it | section 5, T11 |
| O1 | User ruling 2026-10-12, O1 = A, Transfer lane only: every stop tied to one transfer with a usable time is owed at that transfer's own point and the forward pass goes past it (`TRANSFER_FORWARD_OWES`); a stop with no usable time keeps R28; the Pay and capital lanes do not change | sections 5, 7; T5, T10 |
| R30 | Orchestrator ruling (technical) 2026-10-12: on every walk a BTC row the client cannot parse (no finite time, an off-contract field) is a per-record stop, never a whole-run throw. It owes its canonical point when a usable time exists, else the span; the other rows of the span import. Codes: `capital-row-unreadable`, `pay-row-unreadable`, `transfer-row-unreadable`, `earn-row-unreadable`. A malformed envelope still throws for the whole read | sections 1, 3, 5, 6, 7; P10, C3, T12, E12, E23 |
| R31 | Orchestrator ruling (technical) 2026-10-12, under the no-starvation rule: each walk reads the windows of its owed ranges in a round-robin from a range cursor (`binanceHistoryRangeCursor`, `binancePayRangeCursor`, `binanceTransferRangeCursor`), the end of the window it read last, moved once a read has started; each of `W` owed windows is read within `ceil(W / L)` runs that enter the pending pass. Code `range-cursor-malformed` | section 4; the Transfer lane's cap of 80 reads one window a run |
| R32 | Orchestrator ruling (technical) 2026-10-12, under the no-known-limit rule: a window that splits and stops before its first span commits leaves the span it was at as a hint, per walk and per pass (`binanceHistorySpanHints`, `binancePaySpanHints`, `binanceTransferSpanHints`); the next read of a window whose start the hint holds (`hint.start <= window.start < hint.end`, not only a window that starts exactly there) begins with what is left of it; a window that needs `h` halvings commits its first span within `h + 1` runs, whether or not the window's start moves with the clock. A POINT window that is left after some of its spans committed keeps a resume in the same hint (R34, see section 4). Code `span-hints-malformed` | section 4 |
| R33 | Orchestrator ruling (technical) 2026-10-12, under the no-starvation rule: the round-robin rotates the WINDOWS of the owed ranges, not the ranges; the windows that start at or after the cursor come first (`start >= cursor`, not `>`), then the rest; each of `W` owed windows is read within `ceil(W / L)` runs that enter the pending pass | section 4 |
| R34 | Orchestrator ruling (technical) 2026-10-12, under the no-known-limit rule: a point window keeps a resume across runs; its first span commits within `2h + 1` runs while no later span comes back full | section 4 |
| R35 | Orchestrator ruling (technical) 2026-10-12, under the no-known-limit rule: a split hint matches a window by containment (`hint.start <= window.start < hint.end`); a point window matches by exact start | section 4 |
| Q3 | User ruling 2026-10-13, A (after the probe): `transferFloorMs` is `now - 179 whole days`; Binance code -5026 (a `startTime` older than it keeps) is a typed `BinanceHistoryTooOldError` and the Transfer walk reads that span as empty, never owed and never a rejected run | section 5; VERIFY 14 |
| R36 | Orchestrator ruling (technical) 2026-10-13, under the no-known-limit rule and the user's standing approval (no change to which rows import or to any amount): the Earn endpoints compare a record's `time`, a whole second, to each end of a read at the second (live probe 2026-10-13: a read `[S, E]` returns a record at `T` exactly when `floor_s(S) <= T <= floor_s(E)`). So a read of a span returns a record in the second its start falls in, before the start; the Earn walk takes that record as inside the span (`reach = { start: floor_s(span.start), end: span.end }`, used only to tell whether a record sits in the span): a stuck one owes its own point `[T - 1, T + 1]`, never the span. The whole span owed for a stop with no point is still the real span. Without it a stuck record at `floor_s(span.start)` froze the forward pass every run. Earn only: Pay, capital and Transfer read at the millisecond | section 6; VERIFY 12; E29 |
| NODATA | User ruling 2026-10-13: the no-data items (VERIFY 15, the VERIFY 10 allowlist cases, Q14 maturity-paid, Q25) are documented open checks, accepted by the user, not merge blockers. Q3 floor A (179 days and code -5026) stands; R22 holds; the deposit end semantics stay an open check | sections 5, 6; VERIFY 10, 14, 15; Q14, Q25 |

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
- An unknown envelope throws an error with a fixed message (no URL, no body). For
  Pay: a `code` other than `"000000"`, or no `data` array (A1); for every read, a
  non-array list or a non-numeric `total`. A ROW the strict parse rejects (not an
  object, no string asset or currency, or a BTC row off contract) never throws: the
  page lists it under `unreadable`, with its own time field when that is usable, and
  the walk owes it (R30, 2026-10-12; was: the row threw for the whole read).
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
- Every response refreshes both readings. The withdraw history reports only a
  per-second UID header (`X-SAPI-USED-UID-WEIGHT-1S`, probe Q15), which is never read
  as the minute's weight: it gives no reading, and the lane's cap of 9 calls
  (9 x 18,000 = 162,000 of 180,000) is what bounds the run.
- Per-run call caps:

  | Walk | Cap |
  |---|---|
  | capital | withdraw 9 (unchanged), deposit unbounded |
  | Pay | 20 |
  | Transfer | 80 (was 60; user ruling 2026-10-12, OVERNIGHT 19 = A: a caught-up run needs forward 20 + an owed range 20 + re-scan 20 + points), and 397 narrowing calls beyond it, spent only by a span read that narrows or reads a band (user ruling C1 = A; section 5) |
  | Earn | 30 (4500 IP) |

  Each walk has its own cap so that a long backfill in one walk cannot starve the
  others.
- Narrowing calls (`LANE_NARROWING_CALLS`): only the Transfer lane has any (397); the others have
  none. `canAfford(lane, cost, keep, narrowing)` and `record(lane, page, narrowing)` take a
  `narrowing` call from the lane's narrowing calls while any are left, whatever is kept, and from
  its cap after that. A call that is not narrowing spends the cap alone, so a run that narrows
  nothing makes 80 Transfer calls at most and a run that narrows 80 + 397 = 477 at most. A
  narrowing call is judged by the weight readings above like any other (with the calls kept
  counted in the weight), and a rate limit or a cooldown ends the read as for any other call.
  The weight of the most calls a run makes: a Transfer call weighs IP 1 (S4). Every walk of a run
  shares one gate, 350 ms apart, so the run makes 172 requests a minute at most (60,000 / 350 =
  171.4, and one at the start of the minute) however many calls its lanes may make, and the 477
  calls of the longest Transfer run take 167 s or more. The Transfer calls weigh at most 172 IP a
  minute: 2.9% of `IP_BUDGET_1M` (6000) and 1.4% of the assumed ceiling of 12000. The worst
  minute for the IP weight is the Transfer walk's last minute beside the Earn walk that follows
  it: 30 Earn calls at 150 (4500) and 142 other requests at 1 (the same gate has room for 172 in
  all), plus the 20 of the account read, are 4,662 at most, under both. The UID weight of the
  minute is read by the Pay (3000) and withdraw (18,000) lanes; a Transfer call adds none, and if
  it did (1 a call) 172 of 180,000 would be added. The cap on the calls of a run does not change
  how many requests a minute Binance sees; it changes how long a run lasts.
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
  `binanceEarnHistoryCursor` (and `binanceHistoryCursor` for the capital walk). A walk
  that re-scans its last window also keeps a re-scan mark next to its cursor
  (`binanceHistoryRescanCursor` for capital, `binancePayRescanCursor` for Pay,
  `binanceTransferRescanCursor`, `binanceEarnRescanCursor`), see sections 4 and 7. It also
  keeps a list of pending overlap ranges (`binanceHistoryPendingOverlap`,
  `binancePayPendingOverlap`, `binanceTransferPendingOverlap`, `binanceEarnPendingOverlap`)
  and a point cursor (`binanceHistoryPointCursor`, `binancePayPointCursor`,
  `binanceTransferPointCursor`, `binanceEarnPointCursor`), a range cursor
  (`binanceHistoryRangeCursor`, `binancePayRangeCursor`, `binanceTransferRangeCursor`,
  `binanceEarnRangeCursor`) and its span hints (`binanceHistorySpanHints`,
  `binancePaySpanHints`, `binanceTransferSpanHints`, `binanceEarnSpanHints`), see
  section 4.
- All of them join the walk-owned keys of `holding-metadata.ts` (`binanceWalkCursorFields`,
  `binanceWalkPendingFields`, `binanceWalkPointCursorFields`, `binanceWalkRangeCursorFields`
  and `binanceWalkSpanHintFields`). The balance upsert carries them and the disconnect resets
  the cursors to the floor, the lists to an empty list and drops the point cursors, the range
  cursors and the span hints (no key: start at the oldest point or range, with no span to
  resume), through the existing code paths.
- One generic `holdingsRepo.setBinanceWalkCursor(holdingId, key, ms)` (it also writes a point
  or a range cursor), `setBinanceWalkPending(holdingId, key, ranges)` for a list and
  `setBinanceWalkSpanHints(holdingId, key, hints)` keep the existing
  `institution = 'binance'` gate.
- **Walks that read several series (Transfer: 20 types; Earn: 6 kinds).** They run on the same
  passes, per-record commits, owed points and round-robin as Pay and capital (section 4). A
  span read is one call per series (`readSeriesSpan`, `binance.history-paging.ts`), entered
  only when the run can afford all of its calls beside the calls it keeps; each series is paged
  by `fetchAllByTotal`: a full page with more behind it in a span that halves is answered with
  the half (every series is read again in it), a 1 ms span pages by `current` up to 50 pages,
  and a short page whose running count is not `total` (also `{ total: N > 0 }` with no rows), a
  count above `total`, or 50 pages short of `total` is a drift of that series, a stop that owes
  the span. The keeps count calls (`callsOf`): a re-scan read keeps the calls of one span read
  of every series, a point read the calls of its own series. A stuck record owes its point in
  its own series only: the stored point carries the series (`series`, on a point only), the
  read of it is one call, and it leaves only for a returned record of that series with exactly
  that point. Points of different series that start together are read as one window, the
  widest, in the union of their series. A stored point whose series the walk does not know
  makes the list malformed (`pending-malformed`, repaired as in section 4).
  A range may carry a `series` as well (Transfer, section 5): ground one series left unread, or
  left unread at the edge of its depth (a band Binance refused). It is owed in that series alone: its window is read in that
  series, one call a span, and leaves the list once a span read in that series (or in every
  series) has committed; a range with no series is owed in every series and a read in some
  series takes none of it. Ranges merge per series (touching ranges, and the two nearest past the
  limit of 12, of one series only), never across series. The forward pass goes past a range owed
  in one series (the span commits, the range is stored with the cursor's list), where a range
  owed in every series, a stop of the span as a whole, holds the cursor. A stored range with a
  series the walk does not know makes the list malformed.
- Windows go oldest first. The rows of a window are written
  (`transactionsRepo.addManyDedup`) BEFORE its watermark advances. A crash between
  the two re-imports the window idempotently.
- On a re-sync a run is three passes (`planWalkPasses`, `binance.history-walk.ts`): the
  forward pass from the cursor to the end, then the owed overlap ground of earlier runs that
  the re-scan will not read, then a re-scan of the last window behind the cursor, each on the
  budget that is left (section 4).
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

- Floor: `max(HISTORY_FLOOR_MS, now - 18 calendar months + 10 days)` (Q6). The
  10-day margin keeps the first request inside the window however Binance counts
  the 18 months; probe item 5 may narrow it. Windows of 89 days.
- Paging with no cursor and no response order (Q7): a window is requested whole. A
  full page (`gathered` of 100, counted over every coin) halves the span
  (`end = start + floor((end - start) / 2)`) and asks again. A page that is not full
  is the whole of its span: its rows commit, and the Pay cursor moves to the span's
  end. The next span starts at that end (the 1 ms boundary is read twice and removed
  by the key) and is twice as wide, up to the window's end. This does not depend on
  the order of the response or on which end of the range is open, and no request has
  `startTime` equal to `endTime`. A span of 1 ms that is still full stops the window
  (`pay-page-stuck`) in the forward pass; in the pending pass and the re-scan it commits the
  orders it shows and owes the whole span.
- Three passes per run (shared in `binance.history-walk.ts`, with the span loop `walkSpans`
  that halves a full span and commits the rest oldest first, so the Transfer and Earn walks
  inherit both). The forward pass goes first and always starts AT the cursor
  (`max(floor, cursor ?? floor)`), in windows of 89 days to now, and moves the Pay cursor. A
  backlog that needs more calls than one run's cap resumes on the next run from the cursor of
  its last committed span; the cursor never moves back and never passes now. The forward pass
  never restarts behind the cursor: a day there holding more orders than one run's calls reach
  would spend every run on that day, a span ending before the cursor does not move it, and the
  newer orders would never import (found in review: 900 Pay orders, or 4000 capital records, in
  the last day before the cursor, whether the cursor is inside the re-scan window or older). The
  Pay walk does not read the capital cursor (R13/C1, below): a Spot holding with no capital
  cursor runs the Pay walk like any other. Then the re-scan runs on the call budget the forward
  pass left. Its base is `max(floor, min(end - 89 days, forward start - overlap))`: the window
  start, or the overlap behind the cursor when that is earlier, because an order pending at the
  last sync can settle up to one overlap (1 day) before the cursor even when the walk was away
  for as long as the window (found in review: an absence of 88.5 days left a gap between the
  window start and the cursor). It covers `[base, forward start)`, which catches an order that
  settles late and the day behind the cursor. A
  re-scan that was first in line would spend a busy account's whole budget on ground it already
  holds, and the newest orders would never import (found in review: 900 orders in the last 88
  days, none of the newest imported in 10 runs). The re-scan keeps its place in a walk-owned
  metadata key (`binancePayRescanCursor`, on the Spot holding with the other cursors, carried
  over a balance sync, reset to the 2017 floor on disconnect). It commits span by span, moves
  only that key, and never touches the Pay cursor. The next run resumes it from the stored key
  until it reaches the forward start; then the key returns to the 2017 floor, which means "no
  pass in progress", and the next run starts a new pass at the base. A stored mark above the
  floor, at or after the base and before the forward start is resumed over `[mark, forward
  start)`. A mark behind the base is a pass the sliding window has outrun: it is dropped and a
  new pass starts at the base, however far behind the mark lies (the ground it left owes
  nothing but its overlap day, which the pending list below holds). A mark at the floor or at
  or after the forward start also starts a new pass. Re-scan rows go through the same keys, so
  a second identical run imports nothing.
- **Pending overlap days (review of fix rounds 5 and 6: chained absences, stale cursors, a
  stop inside a leftover overlap, an outrun mark).** A record pending at a sync can settle up
  to one overlap before the cursor that sync set, so the overlap day `[cursor - overlap,
  cursor)` behind every forward start must be read by some run AFTER that cursor was set, however
  long the app is away, and a lost day is a missing row in the user's own data. The re-scan of
  the same run may never get to it (the run can end first, and a window that slid past the day
  in a long absence does not reach it), so each walk (Pay and capital) keeps its own walk-owned
  list of owed ground next to its cursors: `binancePayPendingOverlap` (capital:
  `binanceHistoryPendingOverlap`), on the Spot holding, carried over a balance sync like the
  cursors, reset to an empty list on disconnect. Its value is a list of `{ start, end }` entries
  in milliseconds, oldest first. An entry is a **range** (no `kind`) or a **point** (`kind:
  'point'`): the kind is what tells them apart, never the length, so a short range (a sliver: what
  a long range leaves once a read took most of it) is a range, read once and gone, and a point
  is never taken for one, merged into one, held by one or dropped with one. Ranges never touch or
  overlap; a range (rather than a bare day start) keeps its progress, because a day too dense for
  one run's calls would otherwise be re-read from its start every run and never finish.
  - **Add.** Before the first forward span of a run moves the cursor, the run stores the list
    with the overlap day behind the forward start added (`planWalkPasses`'s `pendingRanges`),
    pending list first, cursor second: a crash after the first only leaves a range the next
    run reads again. No day is added for a cursor that is null or at the floor.
  - **Remove.** A range, or the part of one, leaves the list only when a committed span has read
    it: a re-scan span or a pending span takes `[span start, span end)` out of the list after its
    rows are durable (a span in a range's middle splits it). The floor passing a range drops it
    (the part of a range the floor crosses is cut to the floor); nothing else does. A point (see
    below) is the ground one record owes, and it leaves the list only when a window of the
    pending pass, the re-scan or the points that holds all of it was READ TO ITS END (every span
    of it committed) and returned a record whose own point is exactly this one (every returned
    record counts, the ones the walk can trust and the ones it cannot), or by the floor: one list
    write, after the window's last span. A point that a record of the window left owed again
    (the twin of a trusted record, still stuck) stays. A window that returns no such record
    cannot be shown to have held the point's record, so the point stays. That covers a window
    that returns nothing, one that returns only the neighbours of the stuck record (Binance
    filters on another field, or rounds the time), a window that holds only part of the point (a
    re-scan that starts inside the second), and a window that the budget cut before its last span
    (a window that came back too full is read in halves, and the point leaves only once both
    halves were read): none of them takes the point off, and no span alone does. The rule
    identifies a record by its point (its window and series), not by an id of its own, so it
    cannot tell a stuck record from a trusted twin at the same millisecond: with a trusted twin
    returned and the stuck record not returned (Binance filters on another field, so a read never
    returns the stuck record), the point LEAVES, and the stuck record is never returned either
    way. Without a twin the point stays. Probe VERIFY 14 decided the filter field (CLOSED: it is
    `timestamp`; twins 0, mismatch 0), so the point does not have to carry the stuck record's
    identity (its id), only its window.
  - **Order of a run.** Forward pass first, then the owed ranges the window re-scan will not
    read this run, in a round-robin (the next bullet), as windows of their own (`WalkPass`
    `pending`), then the window
    re-scan, then the owed points, each on the budget the earlier ones left. A stop in the
    forward pass (a record the walk cannot trust: the cursor never passes it) ends only the
    forward pass: the run goes on to the owed ranges, the re-scan and the points, so a record
    that settles in an owed day is imported however long the forward pass stays stopped. A
    window that does not finish (the budget cannot afford the next read, or Binance
    rate-limits) ends the pass it is in for the forward pass and the re-scan, whose marks only a
    commit moves, and not for an owed range or point, which goes on to the next one. No pass
    ends the run on its own; the budget does (a rate limit too: the account cooldown is part of
    the budget check, so every later read is refused). That a forward stop ends only the forward
    pass is a user ruling of 2026-10-12, R28 (see the ruling under "Filter" below). Ranges
    inside the re-scan's own range are read by the re-scan, and leave the list as its mark
    passes them.
  - **Per-record commits (pending pass and re-scan).** A read commits every record the walk can
    trust, and a record it cannot trust owes only its own ground: one stuck record never holds
    back the rest of a span, a range or the re-scan (`binance.history-records.ts`,
    `settleRecords`, `commitSettledSpan`). A stop that is tied to one record and has a time
    inside the span owes that record's point, the same whichever span read it and never cut to
    the span: its millisecond and one more on each side (`[t - 1, t + 1]` on Pay and for a
    capital deposit) or, for a capital withdrawal, whose `applyTime` has a precision of one
    second and may be cut or rounded to it, the second before it, the second after it and one
    millisecond on each side (`[T - 1000, T + 1000]`). The extra millisecond on each side makes
    the record sit strictly inside the point, so a read of the point returns it whichever end of
    a range Binance leaves out (the start, the end, or neither), and a record on the boundary two
    spans share owes one point, not two. Two points that are the same window are one point; two
    that start together and differ (a deposit 999 ms before a withdrawal's second, and that
    withdrawal) are two, each leaving the list only for a record that owes exactly it, and the
    run reads the wider window of the two, which holds the other. A good record at the same
    millisecond (the same second for a withdrawal) commits with the first read of the span that
    holds both. The per-record codes
    are `pay-id-missing`, `pay-direction-ambiguous`, `pay-amount-invalid`, `pay-split-mismatch`,
    `pay-funds-not-btc`, `pay-wallet-unknown`, `pay-btc-funded-other-coin`, `capital-id-missing`,
    `capital-amount-invalid`, `capital-wallet-unknown`, and (R30, 2026-10-12) `pay-row-unreadable`
    and `capital-row-unreadable` for a row the client could not parse. Any stop that is not tied
    to one record (`pay-holding-missing`, `capital-holding-missing`, `pay-page-stuck`), and a record
    with no usable time (`capital-time-invalid`, a Pay order of another coin with none, an
    unreadable row with none) or one
    outside the span, owes the whole span; a holding that cannot be placed commits no row of the
    span. **Write order.** The rows of the span are written first; then ONE list write takes the
    read span out of the list and puts the points (or the whole span) back; in the re-scan the
    mark moves after that write. A crash after the rows only has the next run read the span
    again, which imports nothing new (the keys are deterministic and the import is an upsert),
    and a crash after the list write and before the mark does the same for the re-scan.
    **Forward pass.** Any stop leaves its span uncommitted (nothing is written) and ends the
    forward pass, because the cursor must not pass a record the walk cannot trust; the other
    passes of the run still read.
  - **Re-scan stop.** A stop in the window re-scan does not block the rest of the window: the
    span commits its trusted rows, its stuck records are added to the list as points (or the
    span, for a stop that owes it), and the re-scan mark moves on, so the records after the stuck
    one are re-scanned in the same run, however far apart the runs are.
  - **Owed points.** A point costs at most one window a run (a full window is read in halves), and
    is read LAST, after the re-scan, on the calls that are left, so many of them never take the budget of the owed days or of the
    re-scan. They are read in a round-robin (`startingAfter`): each walk keeps one point cursor
    in a walk-owned key next to its pending list (`binancePayPointCursor`, capital:
    `binanceHistoryPointCursor`), the start of the point it read last. The next run reads the
    points that start after it first, oldest first, then wraps around to the rest. One window is
    read for each start (the wider of two points that start together). The cursor moves past a
    point once the read of it has STARTED (a read of its window returned a page, or the half to
    read instead), whether or not its window finished: a window that comes back full and runs
    out of calls is read in halves, and the point stays owed, but the round goes on to the next
    point, so one such point cannot hold the round at itself. It is written after the list write
    of any span of the point just read (a crash between the two has the next run read that point
    again). It is carried over a balance sync like the cursors and dropped on disconnect; a
    stored value that is no number is repaired at once: the cursor is stored as a start before
    every point (`Number.MIN_SAFE_INTEGER`), so the next run reads the oldest point and logs
    nothing, and the failure is logged once under one fixed code (`point-cursor-malformed`),
    never a throw. The window a run reads is cut at the end of the walk (the stored point is
    not), and a point the end has not reached is read once it has. In every run whose forward
    pass leaves a call, a run that has a point to read reads at least one (see the reserved
    call), so each of `P` points is read within `ceil(P / L)` such runs, where `L >= 1` is the
    fewest points such a run reads, however far apart the runs are and whatever the run's own
    time; a run whose forward pass (a catch-up over a long gap) spends every call of the lane
    reads no point, and is not counted. A point that is no longer stuck imports and leaves the
    list. A point leaves the list only as the Remove rule above says: a window read to its end
    that holds all of it and returned a record that owes exactly it, or the floor. A point is read whether
    or not a range or the re-scan holds it; a range never takes a point in.
  - **Owed windows, in a round-robin (R31, orchestrator ruling, technical, 2026-10-12).** Each
    walk keeps a range cursor in a walk-owned key (`binanceHistoryRangeCursor`,
    `binancePayRangeCursor`, `binanceTransferRangeCursor`, in `binanceWalkRangeCursorFields`): the
    end of the window of an owed range it read last. The pending pass builds the windows of all
    owed ranges (oldest first, each range cut into windows of the lane's window length), reads
    the windows that start AT OR AFTER the cursor first, then wraps around to the rest
    (`windowsFrom`; the points do the same by `startingAfter`, over their own starts), so a
    window that is owed whole in every run (a row with no time, a drift that lasts, a holding that
    is missing) cannot keep the windows behind it, of its own range or of another, from being
    read. It rotates windows, not ranges: a range longer than one window whose first window is
    owed whole merges back into one range that starts before the cursor every run. At or after,
    not after: the window that follows the one read starts exactly at its end, and a strict
    comparison would skip every other window of a long range. The cursor moves past a window once
    its read has STARTED, whether or not it finished. Each of `W` owed windows is read within
    `ceil(W / L)` runs that enter the pending pass, where `L >= 1` is the fewest windows such a
    run reads. A run that has the calls for one read of one window at a time (the Transfer lane's
    80 calls beside the forward window, the re-scan and the points) reads every window in `W`
    runs. The re-scan, the points, the keeps and the 12-range cap are as above. The key is carried
    over a balance sync and dropped on a disconnect (no key: start at the oldest window); a stored
    value that is no number is repaired at once to a start before every window
    (`Number.MIN_SAFE_INTEGER`) and logged once under one fixed code (`range-cursor-malformed`),
    never a throw.
  - **A split window is resumed in the next run (R32, orchestrator ruling, technical,
    2026-10-12).** A window whose read comes back too full is read in halves and commits nothing
    until a span fits; a run that ends before that used to leave the next run to start the whole
    chain again, and a chain longer than one run's calls (a dense Transfer type late in the list
    costs up to 20 calls for one halving) never progressed. When a window stops before the first
    span from its start commits, the run stores the narrowest span it asked, as a hint of the
    window's pass, per walk and per pass (forward, pending, re-scan, point), in one walk-owned
    key for each walk (`binanceHistorySpanHints`, `binancePaySpanHints`,
    `binanceTransferSpanHints`, in `binanceWalkSpanHintFields`; each holds one list of
    `{ start, end }` for each pass, one hint for each window start, so two chains stopped in one
    run, in two passes or in two windows of the pending pass, never overwrite each other). A later
    read of a window whose start the hint HOLDS (`hint.start <= window.start < hint.end`) begins
    with what is left of it, from the window's own start (`{ window.start, hint.end }`), never
    wider than the window; after it commits the walk goes on as always (the next span from the
    committed end, twice as wide). It is a containment, not an equal start, because the start of
    a window moves with the clock: a fresh re-scan pass starts a window before the end of the
    run, and Pay's and Transfer's floor trails the run and cuts an owed range to a start at
    millisecond precision, so no window of a later run starts where the hint did, and a hint
    that had to start exactly there would drop every run and the halvings would begin again
    every run. Of the hints that hold a window's start, the one that starts nearest to it is
    given, and it is replaced by the hint the read leaves. A point window starts at its point,
    which never moves, and the windows of two points overlap, so a point window takes only a
    hint that starts exactly where it starts (a resume too: it names the ground of its own
    window). The hint is dropped when a span of the window commits, or when no
    window of its pass holds its start any more (the cursor, the mark or the list moved); a stale
    hint can only narrow a read, never skip ground, because the window begins at its own start
    and a hint only ends the first span earlier. A window that needs `h` halvings, read in runs
    that each afford one read of it, commits its first span within `h + 1` runs, whatever the
    clock does to its start (pinned at runs 0, an hour and a day apart). The key is carried over a balance sync and dropped on a disconnect; a stored
    value that is not a record of lists of `{ start, end }` is ignored, stored over with no hint
    at once, and logged once under one fixed code (`span-hints-malformed`), never a throw.
    **A point window keeps its progress across runs (R34, orchestrator ruling, technical,
    2026-10-12).** A point leaves the list only when its whole window was read to its end, and a
    run that ends after the first span of a window committed used to drop the hint: the next run
    started the whole chain again, so a point whose chain of halvings costs more than any run's
    calls for it never completed. A POINT window (the points list of the hints only) that is left
    after some of its spans committed now stores a `resume` beside its span: `from`, where the
    next span starts (the span ends at the hint's `end`), `returned`, the points of the records
    the committed spans returned, trusted or not, `stuck`, the ground the records among them that
    could not be trusted owe, and `series`, the series the window was read in. A later run that
    reads the window begins at `from` and, once the window is read to its end, hands the point
    rule the points the earlier runs returned beside its own, less the ground any run left owed
    (a returned record owes the point, a stuck record holds it, as in one read of the whole
    window). A stale resume only narrows a read and never skips ground: it drops with its hint
    when the point leaves or no point window starts there, and when the window is read in other
    series than the resume was made for. The other passes keep no resume: their progress is in
    their cursor, their list and their re-scan mark. The resume is part of the same key and
    lifecycle (carried, dropped on a disconnect); a resume that is malformed (no `from` inside
    its span, a list that is no list of owed ground, a blank series) makes the whole stored value
    malformed (`span-hints-malformed`), and a resume found in a list of another pass is ignored.
    A point window whose first span needs `h` halvings, read one span a run, completes within
    `2h + 1` runs: `h` runs of halving, then the doubling spans (`nextSpanAfter`) that cover the
    rest of the window, at most `h + 1` of them. That holds only while no later span comes back
    full: a later span that is too full halves again (one more run a halving) and the bound grows
    by those halvings.
  - **Reserved calls.** Every read of the owed windows leaves the lane's last calls for the
    re-scan (`RESCAN_KEEP`, 1, when the plan has a re-scan) and for the points (`POINT_KEEP`, 1,
    when the plan has a point), so a list of ranges cannot spend a run on re-reading them whole;
    the re-scan keeps the one call of the points. `BinanceRunBudget.canAfford` takes the number
    of calls to keep. The forward pass keeps none (new records come first), the points keep
    none.
  - **Properties** (pinned by `binance.history-walk.properties.test.ts`, which drives the
    walk's own functions and the per-record commit run after run on four lanes, Pay (19 reads
    a run), capital withdrawals (9 reads), capital withdrawals whose `applyTime` is rounded to
    the second instead of cut (9 reads) and capital withdrawals mixed with deposits (9 reads),
    against records that can never be placed, each under all three readings of which end
    Binance leaves out of a range: both ends included, the start left out, the end left out; a
    withdrawal sits on the first or the last millisecond of its second as often as anywhere in
    it; the name of each test states its bound in runs. The properties tell a point by the
    window its record owes, never by its tag or its length): P1 every record of the owed ground
    other than the stuck ones, and every re-scan record, imports; P2 every stuck record is owed
    as the very point it owes (its extent and a millisecond on each side), and stays one (a
    point is never merged away, held by a range or dropped with one, and one that starts with
    another stays beside it; a record that sits where two spans meet is held by exactly one
    point); P3 each owed point costs at most one read a run; P4 the re-scan gets a read and a
    commit in every run whose forward pass leaves two calls; P5 the round-robin: every run whose
    forward pass leaves a call and that plans a point reads at least one, and each point is read
    within `ceil(P / L)` such runs (`L` the fewest points a run read, measured, never below 1),
    with runs an hour, a day and exactly 2^32 ms apart; P6 the cursor never passes a stuck
    record of the forward pass, whose stop ends only the forward pass; SL a range that holds no
    record, of any length (1 ms to 5 s, and one 500 ms behind the start of the re-scan), leaves
    once it is read, and no point appears for it. The families: K = 1 to 12
    stuck records at random points, one owed day each, and all inside ONE owed day (also a day
    that comes back full above 6 hours, with three stuck records exactly where its spans meet);
    N = 1 to 12 close pairs (1 and 2 ms apart; the same and the next second on capital); a good
    record at the same millisecond (second) as each of K = 1 to 12, 14 and 20 stuck ones; K
    stuck records inside the re-scan window (read whole, and full above 30 days with runs a day
    apart); many owed points (10, 20 and 30, on every lane), the newest placeable at run 5,
    which imports within `ceil(P / (reads - 2))` runs of that; 10 to 30 owed points with a
    re-scan that comes back full above 3 days, so one pass spans several runs and each run
    still reads a point; 14 owed days with points beside them, so that a list past 12 ranges
    merges two of them, and a stuck point that lies inside the hull two of them merge into; a
    forward pass that stops in every run with owed points and an owed day holding a record
    that settles at run 2; Binance filtering on another field (a read of a point returns the
    trusted records on its edges and never the stuck one, with the points found in an owed day
    and already in the list): every point stays; ranges of 1 ms to 5 s with no record in them;
    a point whose window comes back full on a run that has one call for the points, and 2 to 5
    such points: the round goes on; a forward pass that spends every call of the first runs (a
    gap of 3000 days), after which the points are read in the round-robin and a record that
    becomes placeable imports; and, on the mixed lane, a withdrawal and a deposit 999 ms before
    it whose points start together, beside a deposit at the very start of the withdrawal's
    second. Two more families pin the round-robin of the ranges and the hints on every lane,
    Transfer included: `R` = 1 to 12 owed days that are each owed whole again by every read, each
    read within `ceil(R / L)` runs (and two days whose reads never finish, read in turn); and a
    window that needs 1, 3 and 6 halvings, with the calls of one read a run (the dense Transfer
    type last of the 20, so one halving costs all 20 calls), in the forward pass, the re-scan, the
    pending pass (also two owed days at once) and the points, each committing its first span within
    `h + 1` runs, with a run in which the forward pass and the re-scan both stop in the middle of
    a chain. The bounds are derived from the reads: each range is read within `ceil(ranges / reads
    a run)` runs that enter the pending pass, a dense day or window by the
    reads its halving needs, and the points by the round-robin.
  - **Bound.** The list holds at most 12 ranges (entries with no `kind`, of any length), plus
    the points, which are not ranges and are never merged with a range or with each other,
    plus this run's own overlap day, which the re-scan reads in the same run. A
    merge never takes a point in: the points between two ranges that merge stay in the list
    beside their hull. Each range costs at least one call of a run's leftover budget, so a longer
    list could not be served in one run; past the limit the two nearest ranges merge into their
    hull, which reads the gap between them too and loses no ground. Touching ranges merge on
    every store, so frequent syncs do not grow it. A point costs one read a run and is stored
    once; the list holds one point for each stuck record the walk has found.
  - **Parse.** An entry with no `kind` is a range (so a list stored before the tag existed
    reads as ranges, which are read once and leave); `kind: 'point'` is a point; any other
    `kind` is malformed. A stored value that is not a list of `{ start, end }` entries with
    finite `start < end` says nothing about which days were owed, and an empty list would let the next
    write drop them. It is read as one owed range `[floor, cursor)` instead (the cursor the walk
    plans from; no range when the cursor is null or not after the floor), stored at once so the
    repaired list is what later runs read, under one fixed log code (`pending-malformed`), never
    a throw: a corrupt value must not fail a balance sync. The overlap day behind the forward
    start lies inside that range and merges into it.
  A range inside the re-scan's own range waits for the re-scan mark to reach it. A stuck record
  does not delay it (the re-scan owes the record's point and moves on); only the budget does, and
  the range is never dropped: it stays in the list until a committed span has read it.
- Filter: `currency === 'BTC'`. A non-BTC order paid with BTC funds BY THE USER stops the
  span that holds it (`pay-btc-funded-other-coin`, cursor unmoved) (Q8); one the user
  received (the user is the receiver and not the payer) is ignored, because the BTC left
  the payer's wallet, not the user's (B4). An order whose parties do not settle it (no
  ids, neither party the user, the user both) still stops. Until a rule
  exists the walk is blocked for that user rather than losing a BTC movement. User
  ruling (I5, after the probe, 2026-10-10): A2. The stop stays unchanged. Option A,
  importing the BTC part of such an order as an outgoing BTC row on the wallet that
  paid, is built only when a real BTC-funded non-BTC order is seen (the probe saw 0
  of 41 non-BTC orders paid with BTC). User ruling 2026-10-11: in the
  pending pass and the re-scan the other orders of the span still import and only that order
  stays unimported and owed at its own point (its `transactionTime`, read by the client; the
  whole span when the time is missing or outside the span); the forward pass keeps A2: the stop
  ends the forward pass, cursor unmoved. User ruling of 2026-10-12, R28 (kept; it touches the
  scope of A2 as ruling A did): after a stop in the forward pass the run goes on to the owed
  ground, the re-scan and the points, so a settled record in an owed day is imported however
  long the forward pass stays stopped. Were it reversed, the forward stop would end the run
  again (one branch in `runWalkPlan`).
- **No cross-source cap and no overlap guard (user ruling C1, 2026-10-10).** The
  probe found 0 of 5 Pay BTC rows that match a capital row (Q5), so both are removed:
  the Pay window end is `now` (a null capital cursor no longer blocks the Pay walk),
  and neither walk skips a row because of a row of the other walk. The log codes
  `pay-overlap-skip` and `capital-overlap-skip`, `binance.overlap-guard.ts` and the
  `listHoldingTransactions` seam are gone. No migration. The sample is small (5 Pay
  BTC rows, 2 withdrawals, 0 deposits); if a later account shows a Pay row that
  repeats a capital row, the rule comes back with a persisted pairing (a migration).
- **Direction (R13, 2026-10-10).** It comes from the user's own `uid` alone; the
  shape of the parties is no signal. The probe showed a real incoming C2C order names
  the counterparty as payer too (shape said outgoing on 4 of 4 receives; uid and sign
  said incoming). `payer.binanceId` equal to the uid is outgoing;
  `receiver.binanceId` equal to the uid is incoming. The sign of the amount must
  agree (Q2: it did on 5 of 5). The window stops (`pay-direction-ambiguous`) when the
  sign is zero or not a number, when the uid matches neither party or both, or when
  the sign disagrees with the uid. An unknown uid (the account read failed, or the
  account carries none) stops the window before any request
  (`pay-uid-unavailable`, cursors unmoved). The party ids are read for the direction rule
  and the B4 receiver check; they are never stored or logged.
- **Wallet ids (Q9).** The probe saw `walletType` 1 on 5 of 5 orders, even for the one
  `[1, 2]` split, and could not match `walletType` against the entries of `walletTypes`
  (the entries are probably sent as text). The client reads `walletType` and every
  `walletTypes` entry as a JSON integer or a digit string and gives numbers, so the walk
  compares wallets by value. Placement does not trust `walletType`; it reads
  `walletTypes`, with `walletType` used only when `walletTypes` is absent. `walletType` and a
  single `walletTypes` entry that name different wallets are not a stop: `walletTypes`
  wins. The cost check and the cost-based placement apply to OUTGOING orders only (R20/R22):
  - An outgoing order is placed by its costs (the subset rule, R20). The wallets with a
    cost above zero (the BTC `fundsDetail` entries' `walletAssetCost`, added per wallet) must
    be a non-empty set, contained in the named wallets, and the costs must add up to
    `abs(amount)` to the satoshi; the rows follow the costed wallets, one per wallet, each
    with its own key. Otherwise the span stops (`pay-split-mismatch`): a positive cost on
    a wallet the order does not name, costs that do not add up, and no cost above zero at
    all. A named wallet with no cost is left out,
    not a stop (`walletTypes` can list a wallet that was not charged; the totals are still
    the order amount). The equality rule that stopped it would never clear and becomes a
    loss once the floor passes the order (about 548 days).
  - **B5.** An outgoing order with no BTC `walletAssetCost` entry at all, and an explicit
    `walletTypes` naming exactly one wallet, is placed whole on that wallet when its BTC
    `fundsDetail` entries, added together, equal `abs(amount)` to the satoshi (B7, ruling of fix
    round 8: an order with an EMPTY `fundsDetail` stops, `pay-split-mismatch`: it carries nothing
    that shows the whole amount was BTC, and a send part-funded in another coin that lists no
    funds would be placed as BTC the user never spent). A cost-less BTC entry below the
    amount, with the rest paid in another coin, stops (`pay-split-mismatch`): placing it whole
    would invent BTC the user never spent. An order whose `fundsDetail` names no BTC entry but
    lists funds in another coin stops as `pay-funds-not-btc` (B4), before this rule. The stop
    stays for: `walletTypes` absent (`walletType` alone is not trusted), `walletTypes` with two
    wallets and no costs, and a cost list that is zero or does not add up. The sum is signed: if
    Binance signs the funds amounts of a send negative, no B5 order matches and every one stops
    (fail-safe; the probe checks the sign). B7 is a final user ruling (2026-10-11, recorded
    with B1-B6).
  - **B4.** The funds checks apply to OUTGOING orders only. `pay-funds-not-btc` (a BTC order
    whose `fundsDetail` names no BTC) stops a send; on a receive the funds are the payer's, in
    whatever coin, and say nothing of what the user received.
  - **A receive is placed by DATE (R22, replaces R21).** `transactionTime` before
    2026-09-29T00:00:00Z (UTC midnight; the time zone is not documented) is Funding
    (`BTC:funding`, key suffix `:1`); at or after it is Spot (`BTC`, suffix `:2`). Binance
    announced that Pay receipts are credited to Spot from 2026-09-29 (announcement
    01cbe42ead1e4f1a9382363754d2eb5a, 2026-09-23); before that they went to Funding. A
    receive does not read `walletType`, `walletTypes` or `walletAssetCost`, and a receive that
    lists two wallets no longer stops. The cost if the rule is wrong: a receive near the cutover,
    or an order type the announcement does not cover (a Crypto Box claim, a merchant refund),
    lands on the other wallet of the same account; the totals stay right. Confirmed by the user
    2026-10-13: a BTC Pay receipt dated after 2026-09-29 landed on Spot in the Binance app,
    although its walletType, walletTypes and cost key name wallet 1 (Funding); a receive's wallet
    fields describe the payer side (1 receipt checked).
- Amount: `abs(amount)` through `Money.fromMajor('BTC', ...)`, with the sign from
  the direction.
- Key: `` `${accountId}:pay:${orderType}:${transactionId}:${walletType}` ``. An
  empty `transactionId` stops the window.
- **Description (D4-B).** For outgoing, `receiverInfo.name`; for incoming,
  `payerInfo.name`. The value is trimmed and stored exactly as Binance gives it. If
  it is missing or blank, the literal `'Binance Pay'` is stored (a proper noun, not
  localized). Category: null.

### 5. Transfer walk (`binance.transfer-history.ts`)

- Floor: `now - 179 whole days` (`transferFloorMs`; USER RULING 2026-10-13, Q3 = A, after the
  probe: S4 documents "last 6 months", a `startTime` 180 days back is served, one 200 days back
  is refused with HTTP 400 code -5026, and 181-199 days is unknown; 6 calendar months + 1 day is
  180-183 days, so the old floor could ask for a refused start). Binance code -5026 is mapped by
  the client to a typed `BinanceHistoryTooOldError` (same message as the generic request-failed
  error, so a reader without a depth guard rejects with the same message); the Transfer walk
  answers it, so the lane is never rejected for it. Only ground Binance refuses counts as below
  what it keeps. The floor is read from the clock when a type is read (`now` moves on after a
  run is planned, and a type read in a later run meets a later floor): a span that ends at or
  before it lies below the floor and reads as empty (no call, nothing owed), and any other span
  is read from the floor or the start the type is known to be served from, whichever is later,
  so a type read some runs after its span was planned loses no ground that is above the floor of
  the run that reads it. The ground between the floor of the plan and the floor of the read is
  below the floor: the walk does not ask for it (a fresh connection does not either). A span that
  is not below the floor is never read as empty.
  - With no start known to be served, the start moves up toward the span's end by halving the
    refused part: a probe of one millisecond at the end of the span first (refused: the span lies
    below what Binance keeps and none of it is read), then halvings until a served start lies
    within one second (`DEPTH_RESOLUTION_MS`) of a refused one. The span is read from that start,
    and the run remembers it for that type, with the clock the request that served it was sent
    at (for the rest of the run, across the spans that follow). Each of the 20 types keeps a
    depth memory of its own: a type that keeps less than the others narrows only itself, writes
    nothing into another type's memory, and a span lies below a type only when that type's own
    end probe is refused, so the span commits with the rows of the other types.
  - The search for a type's start begins at the start another type is served from, when one is
    known and was served at most 120 s ago (the hint): that start is asked first, then the
    starts 1, 2, 4, 8 and 16 s below it while they are served, then the part between the last
    refused start and the last served one is halved; a refused hint turns the search toward the
    end of the span as above. The hint decides only which starts are asked first, so what a type
    is read from is what Binance answered for that type; a type that keeps what the first one
    does is found in 2 to 6 requests, where a search with no hint takes 23.
  - Binance's depth moves (measured: a start 180 days back is served, 200 days back is refused;
    assumed: the oldest start it serves moves forward and never back, with no claim about how
    fast: with the clock or in steps, probe item 18). The requests are paced 350 ms apart, so a
    remembered start is read from as `start + (now - servedAt) + margin` while it was served at
    most `DEPTH_EXTRAPOLATION_MAX_MS` (120 s) ago. `now` is read after the run gate let the
    request go (the gate may wait for hours), and the start stays below the end of the span. The
    margin (`DEPTH_MARGIN_MS`, 1 s) covers a request that reaches Binance later than the one that
    found the start. A refusal of a read from a remembered start doubles it (1, 2, 4 and 8 s;
    `DEPTH_MARGIN_CAP_MS` is the cap) and reads again, with no request beyond the read. A
    refusal at the cap, or with no start known to be served, narrows from the refused start
    toward the end of the span, as above, and the next served start starts the margin over.
  - A start served longer ago than `DEPTH_EXTRAPOLATION_MAX_MS` (a suspension of the app, a long
    wait of the run gate) is not moved on by the time that passed. The start is found again
    between the one the run holds and the one it would move on to: that one is asked first
    (refused: the depth stepped past it, and the span narrows from it toward its end as a refused
    start does), then the part between them is halved to the resolution, `1 + ceil(log2(elapsed
    / resolution))` requests (17 for 10 hours). A span that ends at or before the start the run
    holds, or whose end Binance refuses, reads as empty. The lapse is taken only for a span that
    the start the memory would move on to reaches into (`lapsedRangeOf`: that start lies above the
    span's start). A span that starts at or above it is read from its own start, with no
    narrowing: a read begins at the latest of the span's start, the floor and the moved-on start
    (`readStartOf`), which is the span's start, so every start the span holds is asked and no kept
    ground is skipped; a depth that stepped past the span's start meanwhile refuses the read, and
    the refusal is answered as any other (a wider margin, then a narrowing from the refused start).
    A run that narrows lasts for minutes (477 calls are 167 s of pacing), so the memories of its
    first types lapse while it reads the later ones; a lapse taken for every span would narrow
    every type again (10 to 15 requests a type) in each span of the run that lies days above the
    depth, where the memory cannot decide where the read begins.
  - The band of a read, under the assumption that the depth moves forward and never back: the
    ground below the start a read begins at is refused (within the resolution of 1 s; after a
    lapse that ends against the start the type held, the ground from that start belongs to the
    band below), or lies between the start the type was served from and the start the read
    begins at, `start + (now - servedAt) + margin`: if the depth stood still, Binance keeps it.
    That band is at most the time since the start was served (120 s, which includes the time the
    request that served it took) and the margin cap (8 s): 128 s. It is read in the same span
    read, right after the type's own read (`readBand`, `binance.history-paging.ts`), as one more
    request of the narrowing kind below, paged by `current` and never halved. When Binance
    serves it, its rows join the rows of the type and nothing is owed. When Binance refuses it
    (the depth moved past its start meanwhile: a depth that moves with the clock refuses it, a
    depth that stood still serves it), when the weight readings or the lane's calls do not
    afford the request, or when its pages drift, the band is owed. Every type asks its own band,
    whatever Binance answered for the band of another type: the types keep different depths, and a
    depth in steps of a day can step between the band read of one type and the read of the next,
    so a band owed with no request for another type's refusal would leave ground Binance keeps to
    the next step. An owed band is not committed as read and not
    read as empty: the span's commit stores it as a range owed in that type alone (a range with a
    `series`, section 3), the forward pass goes past it, and the pending pass reads it in that
    type alone from its own start, importing what Binance keeps of it or reading as empty what
    Binance refuses. A rate limit during the band read ends the span read with nothing
    committed, as for any request. Owed bands of one type that touch merge, and a band below the
    floor drops like any owed range. The band up to the end of the span is owed the same way,
    with no request, when the start a type's memory moved on to passes the end of the span. No
    claim is made about the speed of the depth.
  - The types of the span read keep their rows (they are read once). A type whose read cannot
    finish (the run's calls ran out while it narrowed, it reached its sixth refused read or its
    second lapse) owes the whole span, in that type alone, as a range with its `series`; the
    types after it are read on the calls the lane has left, and a type with none is owed the
    whole span with no request (a type that narrows may spend the calls kept for the types after
    it: reading one type to the end serves more ground than a request each for all of them). The
    forward cursor passes the span, because a range owed in one type is no stop of the span. A
    type whose pages drift owes the span in that type alone.
  - Bound: a narrowing costs a type at most 23 requests (the end of the span, 22 halvings of a
    span of 30 days), the one after a lapse at most 24 (the start the run would move on to, the
    end, 22 halvings). A type stops, with the span owed in it, at its sixth refused read
    (`MAX_DEPTH_REFUSALS`) or its second lapse (`MAX_DEPTH_LAPSES` = 1). A narrowing starts the
    margin over and it takes three refusals to reach the cap, so a type narrows twice after a
    refusal at most and once after a lapse: at most 6 refused reads + 2 * 23 + 24 = 76 requests
    on the depth for one type, and 52 where no suspension comes; the read of its band adds one
    request (a band of more rows than one page takes a request a page, up to `maxPages`). The 20 types each have their own count, so a span read has no
    bound of its own beyond the shared run budget: 20 * 77 requests in theory, 80 calls a run
    for the lane and 397 narrowing calls beyond them (below) in practice, each request spending
    one and passing the gate. The calls of a window: wholly
    below every type's depth, the first type 2 (the refused read and the end of the span) and
    each other type 1 (the end alone, asked before any read while another type was refused the
    end; a type that holds a bound from an earlier window asks the end of the next one the same
    way), 21 in all; a window that crosses the depth, the first type about 25 and each later type
    that keeps what the first does 4 to 6 (2 to 4 requests of the search from the hint, its read
    and its band; a read that reaches Binance late, so that its hint is refused, costs a type 23
    or more).
  - Narrowing calls (user ruling C1 = A: a larger Transfer call cap only while a type
    narrows its depth; normal runs keep 80). A span read is narrowing from the first moment one of
    its types is refused a start, finds its memory lapsed, asks the end of the span before its
    read (it holds a bound the span lies above, or another type was refused the end), or reads the
    band its read began above, until the read ends. Every call of a narrowing span read, the
    refused read, the probes, the band, and the reads and pages of the types after it (the reads
    the narrowing unblocks), is a narrowing call: it is drawn from the lane's 397 narrowing calls
    (`LANE_NARROWING_CALLS`) while any are left, and from the cap of 80 once they are spent. A
    call of a span read that is not narrowing (each type is served from its start, or from a
    start its memory holds, and has no band) is drawn from the cap alone. A run that narrows
    nothing therefore makes 80 calls at most, and a run that narrows 477 at most
    (`LANE_CALL_CAPS.transfer` + `LANE_NARROWING_CALLS.transfer`). The narrowing calls are not
    drawn from the cap, so the cap stays whole for the passes that follow a narrowing: the
    forward pass, the re-scan and the points keep the calls they keep today. A narrowing call is
    never made without `canAfford`: the weight readings (section 2), the cooldown and a rate limit
    end it as they end any call, and the types a refused call leaves are owed in themselves, never
    committed as read; a band the weight readings or the lane's calls do not afford is owed. A
    type that narrows keeps one call for its own read, so a run whose calls end inside a narrowing
    makes 476. Measured against a fake clock that the gate's sleeps and the request latency
    move, 420 cases: all 20 types, run gaps of 0, 1 hour and 1 day, a depth that moves with the
    clock or in steps of a day, and rows 1 hour to 10 days above the depth (and, in daily steps,
    two rows 1.2 s and 1.8 s above it): every type keeps 100 days; a middle type 90 and another
    75; the first type 90, or 110; the last type 90; a middle type 45, 40, 35 or 30 days, or one
    45 and another 30, or the last type 35 (their windows of 30 days are read a run's minutes
    after those of the 100-day types); a suspension of 10 or 30 hours in a gate wait of the first
    run; a run planned 3 days before it reads against a Binance that keeps 180 days. The rows
    lost in all 420 cases, by latency, by narrowing calls:

    | Narrowing calls | no latency | 0 to 300 ms | 0 to 3 s | 9 s spike every 7th request |
    |---|---|---|---|---|
    | 0 | 3,624 | 3,717 | 3,767 | 3,950 |
    | 80 | 614 | 621 | 1,004 | 1,128 |
    | 160 | 48 | 48 | 108 | 103 |
    | 200 | 0 | 0 | 42 | 10 |
    | 231 | 0 | 0 | 0 | 5 |
    | 232 | 0 | 0 | 0 | 0 |
    | 320 | 0 | 0 | 0 | 0 |
    | 397 | 0 | 0 | 0 | 0 |

    232 is the smallest value that loses no row in any case (231 loses 5 rows in 2 cases of the
    slowest network, a spike of 9 seconds on every seventh request, where the last type of the
    window that crosses the depth needs the last of the calls); 397 is the value kept (a user
    ruling; raising or lowering it is the user's call), 165 calls beyond it, and the run that
    narrows the most in these cases makes 359 requests. The run that
    narrows the most makes 477 requests, with 20 types that each keep a different depth (each
    finds its own, with no other to ask it from), at any latency. A first run that narrows takes
    the calls it makes at 350 ms each, or the latency of the request when that is longer: 220
    requests (77 s) against a Binance that keeps 100 days in every type at no latency, 219 (341
    s, 5.7 minutes) at 0 to 3 seconds, 477 (167 s) at no latency to 739 s (12 minutes) at 0 to 3
    seconds for the 20 different depths. With them every transfer each type keeps when the first
    run reads is imported within 2 runs (a run planned 3 days before it reads: within the first),
    nothing is owed after 15 except ground Binance refuses (a type whose depth lies inside the
    window the re-scan reads owes, after each run, the band its read met refused, which the next
    run settles), and the forward cursor passes the window that crosses the depth after 2; the
    pins allow 14.
  - The ground the depth passes while a type waits to be read is gone from Binance, so a type
    read in a later run loses it. A type owed in a run is read in a later one. The owed ranges
    are read before the forward pass, and the run keeps one read of the first forward window, of
    the re-scan and of the points for the passes after them, so the forward pass is never left
    with no call. A read that reaches Binance more than the margin cap (8 s) after the request
    that found its start is refused every time: every type owes the span in each run it is tried,
    in at most 52 requests a type, and the forward cursor passes the span (a window stays owed
    until the floor or the depth passes it; the Transfer walk shows it through the
    `binanceHistoryPending` caption, which also shows while the walk owes any range, in one type
    or in every type, and not for a point). The floor of a later run is `now - 179 days`, and a
    type is read from the floor of the run that reads it.
  - What stays owed: the band is owed only while Binance refuses it. A depth that moves with
    the clock passes the start of the band between the request that found it and the band read,
    so each type owes its band after that run (one refused request a type) and the pending pass
    reads it in a later run; a depth that stands still serves it in the same span read. The ground
    between the start a type's memory holds and the end of a span that lies below the start the
    memory moved on to is owed with no request. The ground a refused band begins in is below the
    depth, as any refused ground is. No row that Binance keeps when the first run reads is lost in
    the 420 cases measured, with 397 narrowing calls; the open item below states what is lost
    outside them.
  - What the first run reaches late: the types read the window that crosses the depth in turn.
    The first narrows (25 requests: 23 of the search, its read and its band); each later type
    spends 4 to 6 (2 to 4 requests of the search from the hint, its read, and its band, which a
    depth that moves with the clock refuses), after the 41 requests that settle the two windows
    below the depth (one for each type and window); a later type makes no refused read of the
    window. The last type's read of the window begins at request 159, 55 s into a run at no
    latency (350 ms a request). A depth that moves
    with the clock passes, meanwhile, the rows just above where it stood when the run was planned,
    and a type read later than the depth passed them does not import them: they are neither read
    nor owed. Measured (every type keeps 100 days, 20 types, rows 5 s to 400 s above the depth
    when the run was planned, three runs 1 hour apart; the latency of 0 to 300 ms and of 0 to 3 s
    over 8 seeds each, as the range of the seeds), the types that lose a row, by its distance
    above the depth:

    | Rows above the depth | 5 to 20 s | 40 s | 90 s | 180 s | 400 s |
    |---|---|---|---|---|---|
    | no latency | 20 of 20 | 10 of 20 | 0 | 0 | 0 |
    | 0 to 300 ms | 20 of 20 | 11 of 20 | 0 | 0 | 0 |
    | 0 to 3 s | 20 of 20 | 20 of 20 | 20 of 20 | 9 to 16 of 20 | 0 |

    A row 90 s or more above the depth when the run was planned is imported by every type at up
    to 300 ms of latency, 400 s or more by every type at up to 3 s.
  - OPEN ITEM (owner: the live probe of item 17, run by the user; documented and owned, not a
    closed limit). The three items below arise only when a Transfer type keeps less than 179 days:
    a type that keeps 179 days or more is read from the floor and never narrows. If the probe of
    item 17 shows a type that keeps less than 179 days, the speculative-read redesign is the next
    change set. Until then these items stand, as measured:
    - The rows just above a depth that moves with the clock, when the type is read late in the
      run (the table above), the worst case at each latency. With no latency: 20 of 20 types lose
      the row 5 to 20 s above the depth when the run was planned, 10 of 20 the row 40 s above it.
      At 0 to 300 ms: 20 of 20 lose the 5 to 20 s row, 11 of 20 the 40 s row. At 0 to 3 s: 20 of
      20 lose the 5 to 20 s, 40 s and 90 s rows, and 9 to 16 of 20 the 180 s row; the 400 s row is
      lost by none.
    - Types that keep a different depth each. When the 20 types each keep a different depth
      below 179 days (the scenario of the run that makes 477 requests), the first run spends all
      397 narrowing calls and leaves some types unread; the rows just above the depths of those
      types are lost when the runs are 1 hour or 1 day apart. Rows lost, by latency (the same at
      each), with a depth that moves with the clock at gaps of 1 hour and 1 day, and with a depth
      in steps of a day at a gap of 1 day (30 edge rows, 1.2 s to 2.5 s above the depth): 5, 20
      and 30 with 397 narrowing calls; 3, 12 and 18 with 450; 1, 4 and 6 with 500; none with 550.
      At no gap between runs, and with a depth in steps of a day at 1 hour, none is lost.
    - A type that keeps 30 days with a depth that moves with the clock owes one refused band
      after each run (see "What stays owed"), so the history-behind caption stays on; the owed
      ground is refused ground, which is never imported.
    The cap stays 397 (user ruling): the smallest value that loses no row in the 420 cases is
    232, and raising it to 550 for the 20 different depths, or lowering it, is the user's call.
  - Windows of 30 days (the cap is not documented, Q10). The walk reads 20 types: the 18 untracked ones plus `MAIN_FUNDING` and
  `FUNDING_MAIN`, those two first. It runs on the shared walk (sections 3 and 4): forward
  pass, owed ranges, re-scan of the last 30 days, owed points, with per-record commits. A
  span read is one series per type (`size=100`). A first walk is about 7 windows x 20 types,
  which is 140 calls of IP 1, spread over runs by the 80-call cap (section 2).
- Filter: `asset === 'BTC'` (the client counts a row of another asset for the pager and
  parses only BTC rows strictly) and a settled `status` (`CONFIRMED` assumed, Q11).
- **Commit granularity: per record** (user ruling 2026-10-12, OVERNIGHT 18 = A). A record the
  walk cannot trust owes its own point and the other records of the span commit (pending pass
  and re-scan). The forward pass leaves the span uncommitted and ends, the cursor unmoved;
  the run then goes on (OVERNIGHT 17 = R28, user ruling 2026-10-12); the Transfer lane goes
  past a stop of one record with a usable time (O1 = A, below).
  Per-record codes: `transfer-not-settled` (any status but `CONFIRMED` and `FAILED`; T5),
  `transfer-failed` (`FAILED`; T11),
  `transfer-id-missing`, `transfer-amount-invalid`, `transfer-type-mismatch` (the row's
  `type` is not the type read), `transfer-row-unreadable` (R30: a row the client could not
  parse; T12).
- **A `FAILED` transfer stays owed** (user ruling 2026-10-12, OVERNIGHT 21 = B). Any status
  but `CONFIRMED` is a stop, and a `FAILED` one is its own code, `transfer-failed`: the point
  stays on the list, read once a round, until the floor (179 days) passes it. No row imports. The
  owed point does not show the caption (section 8). VERIFY 14 records the exact status values
  for the record; no rule waits on them (T11).
- **A transfer with a usable time does not stop the forward pass** (Transfer lane only). Every stop tied to ONE
  transfer with a usable time is owed at that transfer's own point (the point the pending pass
  and the re-scan owe it) and goes past: `transfer-failed` (user ruling 2026-10-12, item 3 = A),
  `transfer-not-settled` (coordinator ruling on the user's standing approval, 2026-10-12: owed
  at its point, imports when it settles), and `transfer-type-mismatch`, `transfer-id-missing`,
  `transfer-amount-invalid` and `transfer-row-unreadable` with a `timestamp` (user ruling
  2026-10-12, O1 = A). The point goes into the list before the cursor
  moves, the other transfers of its span commit, the cursor passes it, and the newer transfers
  import in the same run; the point stays owed in every run until the transfer settles or the
  floor drops it, and a second identical run imports nothing it had not. A stop with no usable
  time (a row with no finite `timestamp`, which owes the whole span) and a stop of the span as a
  whole (`transfer-page-drift`, `transfer-holding-missing`, a record whose `timestamp` lies
  outside the span) keep the forward-pass rule above: the span stays uncommitted, the forward
  pass ends and the cursor never passes it (R28). The Pay and capital lanes do not change
  (Pay A2: every stop holds the cursor).
- **Owed after a stop.** A per-record stop owes `[timestamp - 1, timestamp + 1]` in the type
  it was read under (`timestamp` in ms; VERIFY 14 for the filter field and precision). A stop
  not tied to one record (`transfer-page-drift`, `transfer-holding-missing`), an unreadable row
  with no finite `timestamp`, or a record whose `timestamp` lies outside the span owes the
  span, in every type.
- `MAIN_FUNDING` gives Spot -x and Funding +x as paired legs. `FUNDING_MAIN` is the
  reverse.
- An untracked type gives one leg on Spot (`MAIN`) or Funding (`FUNDING`), with
  `untracked_counterpart = wallet:<other>`, negative when the tracked wallet is the
  source.
- Key: `` `${accountId}:xfer:${type}:${tranId}:${holdingKey}` `` (one per leg). Pair id:
  `` `${accountId}:xfer:${type}:${tranId}` ``. The type is in the key, so a `tranId` that
  two types share can never refresh the other's row (was: no type in the key).
- January 2027 Funding -> Spot auto-migration (announcement
  https://www.binance.com/en/support/announcement/detail/01cbe42ead1e4f1a9382363754d2eb5a,
  checked 2026-10-11): if the move is a `FUNDING_MAIN` row, T2 imports it with no change; if
  it is not in the transfer history, the Funding and Spot histories stop adding up to their
  balances. VERIFY 16; the import is decided before the migration starts.

### 6. Earn walk (`binance.earn-history.ts`)

- Six record kinds, each read with `asset=BTC`, are the six series of a span read on the
  shared walk (sections 3 and 4). Windows of 30 days (the S5 cap). Paging:
  `fetchAllByTotal` (section 3). A drift of one kind (`earn-page-drift`) owes the span; the
  other kinds of the span commit (pending pass and re-scan).
- **Commit granularity: per record** (user ruling 2026-10-12, OVERNIGHT 18 = A). A
  subscription or a redemption is a record; a reward group (below) is ONE record. A record the
  walk cannot trust owes `[time - 1, time + 1]` in its own kind (`time` in ms; VERIFY 15);
  per-record codes: `earn-not-settled`, `earn-split-mismatch`, `earn-amount-invalid`,
  `earn-id-missing`, `earn-account-unknown` (`sourceAccount` or `destAccount` neither SPOT nor
  FUNDING), `earn-subscription-type-unconfirmed` and `earn-redemption-type-unconfirmed`
  (USER RULING 2026-10-13 (kept) 24, below), `earn-reward-type-unknown`, `earn-row-unreadable` (R30: a row
  the client could not parse; a field the walk decides by, a split amount, a `type` or
  `isComplete`, that is present with another JSON type than text or a boolean makes the row
  unreadable, never absent). An unreadable reward row owes its point for every reward group of its kind at that
  `time`: its group cannot be known, and a group numbered without it would number two ways. A
  stop not tied to one record (`earn-page-drift`, `earn-holding-missing`), an unreadable row
  with no finite `time`, or a record outside the span owes the span. **USER RULING 2026-10-13 (kept), item 22: the forward pass follows the Transfer rule (O1).** A stop tied to
  one record with a usable time is owed at its own point (one point for a reward group) and the
  forward pass goes past it: the span's other records commit and the cursor moves on
  (`EARN_FORWARD_OWES`, one constant; emptying it restores R28 for every stop). A stop of the
  span as a whole (`earn-page-drift`, `earn-holding-missing`) and a row with no usable time keep
  the old rule: the span is left uncommitted, the forward pass ends, the cursor unmoved.
- Floor: 2022-01-01 UTC. That is before Simple Earn launched (assumption); the
  probe reports the earliest record (Q12). With the 30-call cap a first walk takes
  about 12 runs (58 windows x 6 calls / 30).
- **Subscription** (flexible or locked), with a settled status only (Q13: `SUCCESS` settles,
  `FAILED` is ignored and owes nothing, any other value, `PURCHASING` or unknown, is not settled
  and stops at its point; a redemption's `PAID` is not a subscription status and is not settled):
  - **USER RULING 2026-10-13 (kept; 24 extended): a subscription of either
    product imports from `sourceAccount` or the split only when its `type` is in its product's
    list (an allowlist, `WALLET_FUNDED_SUBSCRIPTION_TYPES`, one constant, per product: flexible
    `NORMAL` or `AUTO`, locked `NORMAL` only). Every other value, a locked `AUTO` included, and
    a missing `type` stops with `earn-subscription-type-unconfirmed`, owed at its point, no
    row. Binance documents the locked types `NORMAL`, `AUTO`, `ACTIVITY`, `TRIAL` (trial fund)
    and `RESTAKE`, and the flexible types `AUTO`, `NORMAL`, `CONVERT` ("Locked to Flexible"),
    `LOAN`, `AI` and `TRANSFER` ("Locked Savings to Flexible"); the money of `RESTAKE`,
    `TRIAL`, `CONVERT` and `TRANSFER`, and possibly `ACTIVITY`, `LOAN` and `AI`, is not
    documented to come from the wallet `sourceAccount` names, and a `RESTAKE` would count its
    principal twice. A locked `AUTO` is most likely the auto-renewal at maturity (a locked
    subscribe's `autoSubscribe` defaults to true), whose money is the matured principal, not a
    wallet, so it would count that principal twice as well. The
    point is permanent: Binance fixes a record's `type` when it creates the record, so a
    type-unconfirmed record never imports by itself; it waits for the user's answer or the
    probe (task 7/7) and stays owed meanwhile, so the Earn floor never moves for it. The
    locked `type` is read as text only (a number makes the row unreadable);**
  - one Earn +amount leg;
  - debit legs Spot -`amtFromSpot` and Funding -`amtFromFunding`, each only when
    it is above zero;
  - the sum must equal `amount` exactly, or the record stops
    (`earn-split-mismatch`, owed at its point);
  - when both split fields are absent, `sourceAccount` (SPOT or FUNDING) takes the
    whole amount;
  - pair id: `` `${accountId}:earn:sub:<flexible|locked>:${purchaseId}` ``;
  - each debit leg's counterpart is Earn; the Earn leg's counterpart is the larger
    debit leg's holding.
  - **Documented open checks (VERIFY 10; user ruling 2026-10-13, not a merge blocker)**
    (leftovers of re-review 3): each item is a data-correctness case the probe closes when it
    has data to answer it:
    - a locked auto-renewal that Binance records as `NORMAL` would still debit Spot (undetectable
      from the record);
    - a flexible `AUTO` is assumed Spot-funded (undocumented);
    - each locked auto-renewal leaves one permanent point, owed until OVERNIGHT 24 is answered or
      the probe settles it.
- **Redemption:** Earn -amount, and the destination +amount, paired. Settled status
  (Q13, checked 2026-10-13; USER RULING 2026-10-13 (kept)): `PAID` settles (a flexible
  redemption's documented values are `CREATED`, `PAID`, `FAILED`; a locked redemption's
  example is `PAID`), `FAILED` is ignored and owes nothing, any other value (`CREATED`,
  unknown) is not settled and stops at its point; a locked redemption whose `isComplete` is
  `false` is not settled either (left out or `true`: no effect). A redemption is never
  `SUCCESS`.
  - Flexible: the destination is `destAccount` (SPOT or FUNDING).
  - Locked: the record has no destination field, so the destination comes from `type`
    (USER RULING 2026-10-13 (kept)): `MATURE` ("redeem to Spot Wallet") -> Spot, and
    `amount` is assumed to be the principal returned. `NEW_TRANSFERRED` ("redeem to Flexible
    product"), `AHEAD` (early redemption; destination not documented), any other `type`, or
    none, stops with `earn-redemption-type-unconfirmed`, owed at its point, no row: Q14, no
    wallet is assumed.
  - `rewardAmt` is NOT imported here, because rewards come from the rewards records
    (Q14). Key: `redeemId`.
- **Rewards (D6-B): one row per reward record.**
  - Each record is income: +`rewards` (flexible) or +`amount` (locked). Rewards
    are not internal and carry no marker. Description: the literal
    `'Binance Earn'`.
  - **Placement (Q14, user ruling A, 2026-10-10).** A reward row has no wallet
    field, so the wallet comes from the kind and the `type`:
    flexible `REALTIME` -> Earn holding; flexible `BONUS` -> Spot holding;
    locked (any `type`) -> Spot holding. Any other or unknown flexible `type`
    (including `REWARDS`) stops its group with the fixed tag
    `earn-reward-type-unknown`, owed at the group's point: no row is guessed. The owed point
    alone does not show the caption (user ruling 2026-10-12, OVERNIGHT 20 = B); a stop in the
    forward pass holds the cursor, which does. A missing Spot holding is created at 0 (P7).
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
    windows, as long as Binance filters on `time` itself (VERIFY 15). A record exactly on a window boundary that comes back in both windows
    gets the same group and the same `n`, so the key dedupes it.
  - **Two identical records** (every field equal) get `n` = 0 and 1. They are kept
    as two rows, because Binance listed two credits and the Earn balance holds
    both. If a later re-read returns only one, the second row stays: the walk
    never deletes a synced row. The probe counts identical records (item 10). If
    it finds any, the coordinator asks the user before merge whether they are real
    double credits.
  - A missing or non-finite amount, or a blank project or position id, stops the
    group (owed at its point). A BTC row with no finite `time`, or any other row the
    client cannot parse, is `earn-row-unreadable` (R30, 2026-10-12): with no finite
    `time` it owes the span, and the other rows of the span import; the run never fails
    for it (was: the client's parse error failed the walk's run).
- Keys for subscriptions and redemptions:
  `` `${accountId}:earn:<kind>:<purchaseId|redeemId>:${holdingKey}` ``.

### 7. Capital walk change (D3-A)

New imports use `walletType` 0 for Spot and 1 for Funding. Rows already imported
keep their holding, because the upsert `set` has no `holdingId`
(`BANK_OWNED_TRANSACTION_COLUMNS`). The probe counts the imported rows with
walletType 1. If there are any, a follow-up task moves them, with a repo change or a
migration and a `kiko:reviewer` step.

Two passes, adaptive spans (R14, 2026-10-10). The capital walk runs on the shared
`planWalkPasses` / `runWalkPlan` of section 4, with its own re-scan mark
`binanceHistoryRescanCursor` (walk-owned like the cursors: carried over a balance sync, reset
to the 2017 floor on disconnect). It used to start every run at `now - 89 days`, so an account
with more withdrawals in 89 days than one run's 9 withdraw calls can page (about 9000)
never committed that window and its newest records never imported. Now the forward pass
goes first and the newest records import on run 1. The re-scan commits span by span too: a
span whose first page is full (1000 records) is not paged through; it is halved and asked
again, as in the Pay walk, so every committed span fits one call per endpoint and a heavy
window is finished over later runs from the re-scan mark. Only a span of 1 ms that is still
full is offset-paged until a short page. The legacy fallback cursor (the newest imported
capital record, a row whose external id starts with `<accountId>:deposit:` or
`<accountId>:withdraw:`, for a holding with no cursor yet) still feeds the plan, but never the
stored marks. A Pay, Transfer or Earn row on the same holding never counts, so it cannot move
the capital forward pass past ground the capital walk has not read.

Strict capital parse, one row at a time (R30, 2026-10-12). Capital rows parse
strictly, and a skipped row is never silent: `amount: null` used to import a 0-sat
row. An off-contract BODY (a non-array body) throws `BinanceHistoryParseError` for
the whole read. An off-contract ROW (a non-object row, a missing, null, or non-string
`amount`, a non-numeric `status`, a bad `insertTime` or `applyTime`, a non-integer
`walletType`) is `capital-row-unreadable`, a per-record stop: it owes its point
(`[t - 1, t + 1]` from a finite `insertTime`; `[T - 1000, T + 1000]` from an
`applyTime` that `parseWithdrawTime` reads), or the span when no time is usable, and
the other rows of the span import. In the forward pass it stops like any other record
(span uncommitted, cursor unmoved). Was: the row threw, the window stopped, and one
off-contract row stalled capital history until an app update.

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
  behind, and only then. An owed point (a record a walk could not import yet, its cursor
  past it) does not show the caption (user ruling 2026-10-12, OVERNIGHT 20 = B; was: the
  default applied in 5ad68db9 also showed it while any walk's list held a point).
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
| 3 | C2C receive, payer unnamed | absent | own | own | +0.001 | in; description = payer.name |
| 4 | C2C receive as the live probe saw it (R13) | counterparty | own | own | +0.001 | in; description = payer.name |
| 5 | uid unknown, any shape | own / absent | x / own | null | -/+ | stop |
| 6 | uid is the payer, sign positive | own | x | own | +0.001 | stop |
| 7 | uid is the receiver, sign negative | x | own | own | -0.001 | stop |
| 8 | no binanceId at all | absent | absent | own | -0.001 | stop |
| 9 | uid matches neither named party | x | y | own | -0.001 | stop |
| 10 | uid is both parties | own | own | own | -0.001 | stop |
| 11 | C2C_HOLDING send / C2C_HOLDING_RF, PAY, PAY_REFUND, CRYPTO_BOX(_RF), PAYOUT, REMITTANCE | per S1 | per S1 | own | -/+ | per uid |
| 12 | unknown orderType | own | absent | own | -0.001 | out |
| 13 | amount 0 or not finite | own | x | own | 0 | stop |
| 14 | name blank or missing | own | x | own | -0.001 | description 'Binance Pay' |

Placement (the "was:" column shows today's result):

| # | source | input | result | was: |
|---|---|---|---|---|
| P1 | Pay, out | walletType 2, walletTypes absent (or [2]), cost on wallet 2 summing to abs(amount) | Spot | not imported |
| P1a | Pay, out | walletType 1, walletTypes [2], cost on wallet 2 | Spot (`walletTypes` wins, no stop) | not imported |
| P2 | Pay, out | walletType 1 (also with walletTypes [1], the live probe shape; also digit strings), cost on wallet 1 | Funding | not imported |
| P2a | Pay, out | walletTypes [1], positive cost on wallet 2 (or on 1 and 2), or a cost entry on 1 that is zero | stop (`pay-split-mismatch`) | not imported |
| P3 | Pay, out | walletType 5, cost on wallet 5 | Earn | not imported |
| P4 | Pay, out | [1,2] (walletType 1, as the probe saw), walletAssetCost on wallets 1 and 2, sums to abs(amount) | one row per wallet | not imported |
| P4a | Pay, out | [1,2], cost above zero on one of them only (the other zero or absent), sums to abs(amount) | one row, on the costed wallet | not imported |
| P5 | Pay, out | costs do not sum to abs(amount) (any wallet count), a positive cost on a wallet not in walletTypes, a cost list that is all zero, or no cost entry with walletTypes absent or naming two wallets | stop (`pay-split-mismatch`) | not imported |
| P5a | Pay, in | `transactionTime` before 2026-09-29T00:00:00Z, whatever walletType, walletTypes (one wallet, two, or none), costs and funds say | Funding (R22, by date; confirmed by the user 2026-10-13: a BTC Pay receipt dated after 2026-09-29 landed on Spot in the Binance app, although its walletType, walletTypes and cost key name wallet 1 (Funding); a receive's wallet fields describe the payer side (1 receipt checked)) | not imported |
| P5b | Pay, in | `transactionTime` at or after 2026-09-29T00:00:00Z, whatever the wallet fields say (including walletTypes [1,2]: no stop) | Spot (R22, by date; confirmed by the user 2026-10-13: a BTC Pay receipt dated after 2026-09-29 landed on Spot in the Binance app, although its walletType, walletTypes and cost key name wallet 1 (Funding); a receive's wallet fields describe the payer side (1 receipt checked)) | not imported |
| P5c | Pay, out | no BTC walletAssetCost entry at all (BTC funds with an empty cost list), the BTC funds entries added together equal to abs(amount), and walletTypes naming exactly one wallet (B5) | that wallet, the whole amount | not imported |
| P5d | Pay, out | an empty `fundsDetail` (B7), whatever walletTypes says | stop (`pay-split-mismatch`) | not imported |
| P6 | Pay, out | 3, 4, 6 | stop (Q9) | not imported |
| P7 | any | target holding missing | create it at 0, then place | n/a |
| P8 | Pay, out | BTC order whose `fundsDetail` names no BTC (B4: a receive is imported, its funds are the payer's) | stop (`pay-funds-not-btc`) | n/a |
| P9 | Pay, out | non-BTC order paid with BTC funds by the user (B4: one the user received, the user the receiver and not the payer, is ignored; an order whose parties do not settle it stops) | stop (`pay-btc-funded-other-coin`), cursor unmoved | n/a |
| C1 | capital | walletType 0 | Spot | Spot |
| C2 | capital | walletType 1 | Funding | Spot |
| C3 | capital | a row the client cannot parse (R30), beside a good row, pending pass or re-scan | `capital-row-unreadable`: owed at its point (no usable time: the span); the good row imports; the run goes on | the read threw, the window stopped |
| P10 | Pay | a BTC order (or an item with no string `currency`) the client cannot parse (R30), beside a good order, pending pass or re-scan | `pay-row-unreadable`: owed at its point (no finite `transactionTime`: the span); the good order imports; the run goes on | the read threw, the run failed |

Transfer:

| # | type, status | result | was: |
|---|---|---|---|
| T1 | MAIN_FUNDING, CONFIRMED | Spot -x, Funding +x, paired, excluded from spending, labels "Transfer to/from" | same |
| T2 | FUNDING_MAIN | Funding -x, Spot +x, paired | same |
| T3 | MAIN_UMFUTURE | Spot -x, `wallet:UMFUTURE`, excluded | same |
| T4 | UMFUTURE_FUNDING | Funding +x, `wallet:UMFUTURE` | same |
| T5 | status not settled | `transfer-not-settled`: owed at `[t - 1, t + 1]` in its type; forward pass: owed at that point too, the span commits and the cursor passes it (coordinator ruling on the user's standing approval, 2026-10-12) | stop the window |
| T6 | asset not BTC | ignored (counted for the pager) | ignored |
| T7 | Funding holding missing (T1) | P7, then T1 | same |
| T8 | pending pass or re-scan: one T5 record and one CONFIRMED record of another type in the span | the CONFIRMED one imports; the T5 one is owed at its point | nothing of the window |
| T9 | forward pass, a span with a stop that owes no point (a row with no time, a type that drifted, a holding that is missing, a record outside the span) | nothing commits, the forward pass ends, the cursor stays, the run goes on (OVERNIGHT 17, R28) | stop the window |
| T10 | row `type` is not the type read | `transfer-type-mismatch`, owed at its point; forward pass: the cursor passes it (user ruling 2026-10-12, O1 = A) | n/a |
| T11 | status `FAILED` (user ruling 2026-10-12, OVERNIGHT 21 = B; the forward pass goes past it, item 3 = A) | `transfer-failed`: owed at its point until the floor (179 days) drops it; no row; no caption; forward pass: the point is stored, the span commits and the cursor passes it | same (the OVERNIGHT 21 recommendation to ignore it is not taken) |
| T12 | a row the client cannot parse (R30), beside a CONFIRMED row of another type, pending pass or re-scan | `transfer-row-unreadable`: owed at its point in the type read (no finite `timestamp`: the span, every type); the CONFIRMED row imports; the run goes on | the read threw, the run failed |

Earn:

| # | record | result | was: |
|---|---|---|---|
| E1 | flexible sub, amtFromSpot = amount | Spot -a, Earn +a, paired | same |
| E2 | locked sub, spot 0.3 + funding 0.2 = 0.5 | Spot -0.3, Funding -0.2, Earn +0.5, one pair id | same |
| E3 | sub, split sum is not amount | `earn-split-mismatch`, owed at its point | stop the window |
| E4 | sub, no split fields, sourceAccount FUNDING | Funding -a, Earn +a | same |
| E5 | flexible redeem, status `PAID`, destAccount SPOT | Earn -a, Spot +a, paired | same |
| E6 | locked redeem, status `PAID`, type `MATURE`, rewardAmt > 0 | principal legs only (Earn -a, Spot +a); reward comes from E7 | same |
| E7 | one flexible `REALTIME` reward record | Earn +rewards, 'Binance Earn', key ends `:<time>:0` | same |
| E8 | two rewards in one group, amounts 0.00000002 and 0.00000001 | two rows, `n` 0 = 0.00000001, `n` 1 = 0.00000002 | same |
| E9 | two identical reward records | two rows (`n` 0 and 1) | same |
| E10 | re-read returns the same group | same keys, no new rows | same |
| E11 | reward on a window boundary, returned by both windows | one row (same key) | same |
| E12 | reward with missing `time` or a non-finite amount | missing `time`: `earn-row-unreadable` (R30), the span owed, the other rows of the span import, the run goes on; non-finite amount: `earn-amount-invalid`, the group owed at its point | missing `time`: the run failed (5ad68db9); before: stop the window |
| E13 | gathered rows are not equal to `total` | `earn-page-drift`: the span owed as a range, the other kinds commit | stop the window |
| E14 | status not settled: a subscription not `SUCCESS` or `FAILED` (`PURCHASING`, `PAID`, unknown), a redemption not `PAID` or `FAILED` (`CREATED`, `SUCCESS`, unknown) | `earn-not-settled`, owed at its point (USER RULING 2026-10-13 (kept)) | stop the window |
| E15 | one flexible `BONUS` reward record | Spot +rewards, 'Binance Earn', no marker | same |
| E16 | one locked reward record (any `type`) | Spot +amount, 'Binance Earn', no marker | same |
| E17 | flexible reward with `type` `REWARDS` or an unknown value | `earn-reward-type-unknown`: no row, the group owed at its point; forward pass: the cursor goes past it (USER RULING 2026-10-13 (kept) 22; was: cursor unmoved) | stop the window |
| E18 | `BONUS` or locked reward, Spot holding missing | Spot created at 0 (P7), then the row | same |
| E19 | pending pass or re-scan: a subscription not settled and a `REALTIME` reward in one span | the reward imports; the subscription owed at its point | nothing of the window |
| E20 | two reward groups in one span, one of unknown `type` | the other group imports; the unknown one owed at one point | nothing of the window |
| E21 | `FAILED` subscription or redemption (either product) | ignored, nothing owed | same |
| E22 | one kind drifts in the re-scan | the other five kinds commit; the span owed as a range | nothing of the window |
| E23 | a row the client cannot parse with a finite `time` (R30), pending pass or re-scan | `earn-row-unreadable`: owed at its point in its kind; a reward row holds every reward group of its kind at that `time` on the same point; the other rows import; the run goes on | the read threw, the run failed |
| E24 | locked redemption of type `NEW_TRANSFERRED`, `AHEAD`, any other type, or none, status `PAID` | `earn-redemption-type-unconfirmed`: no row, owed at its point; the forward pass goes past it; the point is permanent: a record's `type` never changes, so it imports only after the user's answer or the probe, and stays owed (the Earn floor never moves for it); the retry pins model a changed answer (USER RULING 2026-10-13 (kept)) | not a case (every locked redemption went to Spot) |
| E25 | subscription of either product, status `SUCCESS`, of type `CONVERT`, `TRANSFER`, `LOAN`, `AI`, `ACTIVITY`, `TRIAL`, `RESTAKE`, a locked `AUTO`, any other value, or none | `earn-subscription-type-unconfirmed`: no row, owed at its point; only a flexible `NORMAL` or `AUTO` and a locked `NORMAL` write as E1/E2/E4; permanent like E24 (USER RULING 2026-10-13 (kept; 24 extended)) | not a case |
| E26 | locked redemption, status `PAID`, `isComplete` `false` | `earn-not-settled`, owed at its point; `isComplete` left out or `true` has no effect (USER RULING 2026-10-13 (kept)) | not a case |
| E27 | a split amount, a subscription `type` (either product), a locked redemption `type` or `isComplete` that is present with another JSON type (a number) | the row is unreadable (R30, `earn-row-unreadable`), never read as absent: absent would debit `sourceAccount` | read as absent |
| E28 | locked subscription of type `RESTAKE` or `TRIAL` (two cases each), forward window | owed at its own point, the cursor goes past it, the span's other records import, and the point stays owed in every later run (a `RESTAKE` Spot -a never happened; a `TRIAL` is money the user never held) | not a case |
| E29 | a stuck record at `T = floor_s(span.start)` below the span's start (a forward span that starts at the previous run's end, a re-scan or overlap start, a halving boundary, a point window `[t - 1, t + 1]` that also returns a neighbour at `t - 1000`), read at the second (R36) | owed at its own point `[T - 1, T + 1]`; no range; the cursor reaches the end of the span; a later record imports | the whole span owed as a range, the forward pass ends, the cursor never moves (a freeze) |

Convert: not imported (D7). No walk, no rows.

## Tests (Jest)

- Fixtures are built from the S-table shapes. There is one case per matrix row,
  plus these mechanics:
  - Pay: the adaptive window (an oldest-first page, a same-millisecond tie across
    a full page, a window that needs more calls than one run's cap, no request with
    `startTime` equal to `endTime`), and the stuck-page stop;
  - Pay: no request with a `startTime` before the Pay floor, in either pass, after a
    disconnect reset to 2017, or with an old cursor (Q6); a Pay walk on a Spot
    holding with no capital cursor; a Pay row beside a capital row of the same size
    (both stay);
  - capital: the forward pass first and the re-scan after it on a heavy account
    (12,000 withdrawals in 88 days: the newest import on run 1, the cursor reaches
    the end, the re-scan finishes over later runs, a second run imports 0), a span
    whose first page is full halved, a 1 ms span offset-paged, the re-scan mark
    written and reset;
  - Transfer and Earn: paging by `current`/`total`;
  - each walk: windows from its floor, and the re-sync overlap;
  - shared budget: UID and IP readings, per-walk caps, and a walk that stops when
    the budget runs out while the next walk still runs;
  - cooldown set and skip, and commit order;
  - idempotent re-sync;
  - the new metadata keys are carried and reset;
  - `run-crypto-sync`: one shared gate and budget, and a failure in each walk is
    isolated;
  - the caption with any walk cursor behind, and no caption for an owed point alone
    (user ruling 2026-10-12);
  - each walk: an unreadable row is owed at its point (or its span) and the other rows
    import; the run never throws for a row (R30);
  - `exchangeLegDescription` transfer and `wallet:` branches, and an unknown code;
  - `exchange-exclusion` with `untracked_counterpart`;
  - export back-compat.
- Client tests: path, params, signing, envelope parse, a fixed-message error for a bad
  envelope, a bad row listed under `unreadable` and never thrown (R30), PII fields absent
  from the parsed objects, header parse, and 429 handling.

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
10. Earn (the allowlist cases below are documented open checks, accepted by the user
    2026-10-13, not merge blockers): per kind, the `status` values, the `sourceAccount`/`destAccount`
    values, how often `amtFromSpot` + `amtFromFunding` = `amount`, the earliest
    record date, the largest `size`, the count of rewards `type` values per kind
    (before the merge, for Q14), and for locked redemptions how `amount` relates
    to `originalAmount`, `lossAmount`, and `rewardAmt`. Maturity-paid question
    (Q14 gap): whether locked reward rows exist that are paid at maturity to the
    redeem destination, for example by comparing locked reward rows to locked
    positions and redemptions with `redeemTo` FLEXIBLE. For rewards: the number of groups with more than one record, and
    the number of fully identical records (E9). Any identical record goes to the
    user before merge. Also (2026-10-13, for items 23 and 24, kept by the user ruling): the `status` values
    of flexible and locked redemptions, with the count of each, `CREATED` included, and of
    subscriptions; for locked redemptions the count of each `type` (`MATURE`, `NEW_TRANSFERRED`,
    `AHEAD`, any other) and of each `isComplete` value; for a position whose `redeemTo` is
    FLEXIBLE that has matured, which records appear (a `NEW_TRANSFERRED` locked redemption, a
    flexible subscription of type `CONVERT` or `TRANSFER` and its `sourceAccount`); for
    subscriptions of each product the count of each `type` and, per `type` (`RESTAKE`,
    `TRIAL`, `ACTIVITY`, `LOAN`, `AI`, `CONVERT`, `TRANSFER`, `NORMAL`, `AUTO`), the
    `sourceAccount` values, so the allowlist can be widened or kept; whether a `MATURE`
    redemption pairs with a `RESTAKE` subscription (the same principal counted twice); whether
    a `MATURE` redemption pairs with a locked `AUTO` subscription, and the `sourceAccount` of a
    locked `AUTO` (the allowlist is per product: a locked `AUTO` stops); whether a locked auto-renewal is ever
    recorded as `NORMAL` (it would still debit Spot: documented open check until VERIFY 10, user ruling 2026-10-13); whether a flexible `AUTO` is
    Spot-funded (assumed, undocumented); whether each locked auto-renewal leaves a permanent point
    (owed until OVERNIGHT 24 is answered or the probe settles it); where an
    `AHEAD` redemption's principal goes; the `REWARDS` flexible reward rows (count, wallet,
    overlap with `REALTIME` and `BONUS` rows; they stay stopped and owed:
    USER RULING 2026-10-13, Q25 = A: stays owed until the probe; decided after the probe; a documented open check, accepted by the
    user 2026-10-13); and the
    decimals of every reward amount (any value over 8 decimals or under 1e-8).
11. Every SAPI response: whether `X-SAPI-USED-IP-WEIGHT-1M` and
    `X-SAPI-USED-UID-WEIGHT-1M` are present.
12. ANSWERED (probe rev 2, 2026-10-13: Pay, withdraw and deposit in PART A; transfer and Earn in
    PART B). Transfer: `startTime` included, `endTime` EXCLUDED, millisecond precision
    (`[t, t]` and `[t - 1, t]` return nothing, `[t, t + 1]` and `[t - 1, t + 1]` return the row,
    `[t + 1, t + 2]` nothing); the walk's spans tile on a shared boundary, so a record there is
    read once. Earn (flexible subscription and redemption): the filter compares at the SECOND,
    `floor_s(S) <= T <= floor_s(E)` (`[t - 1 day, t - 1 ms]` returns nothing, `[t + 1 ms, t + 1
    day]` returns the row; R36). Pay: `startTime` and `endTime` both included; filter value = `transactionTime`
    (probe rev 2 PART A, 2026-10-13). Withdraw: both ends included, sample 1 record (probe rev 2
    PART A, 2026-10-13). Deposit: documented open check, accepted by the user 2026-10-13: no deposit
    on the probe account since 2017; the walk is property-tested under all three end readings.
    Original item: range end semantics, for each endpoint the walk reads (Pay transactions,
    capital deposit, capital withdraw, transfer, Earn): whether `startTime` is
    included and whether `endTime` is included. Read `[t, t]`, `[t - 1, t]`, and
    `[t, t + 1]` around a known record time `t`, and print which of them return the
    record.
13. ANSWERED (probe rev 2 PART A, 2026-10-13): the filter field is `applyTime`; the filter value minus
    `applyTime` = 0 ms (`completeTime` is 93 s earlier and is not the filter); both ends included;
    sample 1 record, status 6; the owed point `[T - 1000, T + 1000]` contains it, no code change.
    Original item: withdraw history: which field `startTime` and `endTime` filter on (`applyTime`,
    `completeTime`, or another), and whether `applyTime` is truncated or rounded to
    the second against that field. The owed point of a withdrawal
    (`[T - 1000, T + 1000]`) rests on this.
14. Universal transfer: which field `startTime` and `endTime` filter on (`timestamp`?),
    the precision of `timestamp`, the range ends (item 12) on a row of ANY asset, whether
    a `tranId` repeats across types, the status values (Q11; for the record only, no rule
    waits on them: a `FAILED` transfer stays owed, user ruling 2026-10-12), and the answer to a
    `startTime` older than 6 months (ANSWERED, probe rev 2 PART B, 2026-10-13: a `startTime`
    200 days back, and 400 days back, is HTTP 400 code -5026; 180 days is served; 31, 60 and
    90 days and the whole depth of one read are served too, so the 30-day cap is not enforced
    and the walk keeps 30; the floor is 179 days, user ruling Q3 = A). The owed point of a
    transfer rests on the first two;
    a wrong filter field keeps the point owed only while no trusted record sits at the same
    millisecond (with a twin the point leaves, and the stuck record is never returned either
    way), and the record starves once it can be placed. CLOSED by the debugger's sample (the
    filter field is `timestamp`; twins 0, mismatch 0): the point does not need the stuck
    record's identity.
    Two O1 cases follow from the same probe. (a) A forward `PENDING` transfer whose `timestamp`
    moves when it settles, or one under a filter mismatch, that settles after it leaves the
    30-day re-scan is never read. (b) A record Binance returns outside its requested span
    (a `FAILED` one included) freezes the Transfer forward pass until the floor: that stop is
    not in `TRANSFER_FORWARD_OWES`.
15. Simple Earn, per kind: which field `startTime` and `endTime` filter on (`time`?), its
    precision, the range ends (item 12), and whether every member of a reward group comes
    back in any read that returns one of them. The owed point and the reward key
    `<time>:<n>` rest on this. The probe account had no Earn row: one small flexible
    subscription and redemption of any coin first (Still needing the user). Documented open
    check, accepted by the user 2026-10-13, not a merge blocker; it closes when a read of a
    reward group returns every member of the group for one of them.
16. After the January 2027 Funding -> Spot auto-migration (not before the merge): on an
    account that held Funding BTC, the transfer rows of every type on the migration day.
    Before it, `kiko:researcher` reads Binance's migration notes for how the move is
    recorded (URL + date).
17. OPEN CHECK (Transfer depth per type): each of the 20 transfer types keeps a depth memory of
    its own (section 5), so the walk does not depend on one depth for all types. Probe B
    measured the depth for one type only (a `startTime` 180 days back served, 200 days back
    refused). A type that keeps less than the others narrows only itself and a type that keeps
    more is read down to what it keeps; a span lies below a type only when that type's own end
    probe is refused. The start another type is served from is where a search begins, never
    what it finds, so the walk is correct for any answer; the answer decides how many requests
    a crossing of the depth costs (a type that keeps what the first does is found in 2 to 6
    requests, any other in up to 29). Check: for each of the 20 types, the oldest `startTime`
    served, to the day. This check owns the open item of section 5 (the Transfer walk), which is
    documented and owned, not closed: a type that keeps 179 days or more is read from the floor
    and never narrows; if the check shows a type that keeps less, the rows just above its depth
    that a run reads late, and the rows lost when many types keep a different depth, are costs
    that stand until the speculative-read redesign, which is then the next change set. Owner:
    the user, with the live probe.
18. OPEN CHECK (Transfer depth granularity): whether the oldest `startTime` Binance serves
    moves continuously with the clock or in steps (for example a cutoff at the day). The code
    assumes only that it moves forward and never back (section 5), so a step is answered by
    narrowing, and the ground a read begins above (at most 128 s if the depth stood still) is
    owed in that type, not lost: the pending pass reads it and imports what Binance keeps. What
    stays unread is the resolution of a narrowing (1 s). Check: ask the same
    `startTime` near the depth every minute for two days and note when it changes from served
    to refused, and by how much the oldest served start jumps.
19. OPEN CHECK (Pay paid from the Earn wallet): does a Pay paid from the Earn wallet (Pay
    `walletType` 5, placed on the Earn holding) create a flexible redemption record that the
    Earn walk imports (a redemption debits Earn and credits its destination wallet)? If it
    does, the one payment debits Earn twice, once as the Pay row and once as the redemption
    leg. Unverified, no data. Check: pay a small amount from the Earn wallet, then read the
    Pay history and the Simple Earn flexible redemption history for it and compare the
    amounts and times. Owner: the user, with the live probe.

## Open questions (each has a safe default)

The probe ran on the user's own account on 2026-10-10. The sample is small: 46 Pay rows
(5 BTC, all C2C; 41 in one other ticker), 0 deposits, 2 withdrawals, 0 transfer rows, 0
Earn rows. An answer drawn from that sample says so; a question the sample cannot answer
keeps its rule.

| # | Question | Safe default | Answer (probe 2026-10-10) | Probe |
|---|---|---|---|---|
| Q1 | Is a read-only key enough for each new endpoint? | Logged, no cooldown, the balance is unaffected, and the caption shows "behind" | Yes. Pay, capital, 20 transfer types, 6 Earn kinds, and locked position all answered HTTP 200. As built | 1, 9, 10 |
| Q2 | Is the Pay sign as the SDK states? | Sign is a cross-check only | Yes: the sign agreed with the uid on 5 of 5 (in/in 4, out/out 1). It stays a required cross-check (R13) | 2 |
| Q3 | Does the shape rule hold for every type (C2C_HOLDING* are not listed)? | All signals must agree, or stop | No. On 4 of 4 C2C receives the shape said outgoing (the payer carries a Binance id) while the uid and the sign said incoming. R13: the direction comes from the uid alone, the sign must agree, the shape is dropped | 2 |
| Q4 | Is `transactionId` unique and stable? | orderType and walletType are in the key | Yes: 0 empty ids, 0 duplicates within or across orderType, 0 key collisions in 46 rows. As built | 3 |
| Q5 | Do Pay transfers also appear in capital history? | Cap plus the symmetric one-to-one 10-minute guard. Remove both if there is no overlap | No: 0 of 5 Pay BTC rows match a capital row (10 minutes, with the fee, or 24 hours). User ruling C1: guard and cap removed; no migration. Small sample | 4 |
| Q6 | Pay `startTime` older than 18 months? | The floor is 18 months plus 10 days | HTTP 400, code 403004, from about 548 days back (also when only the start is older). The floor of 18 months plus 10 days stays; no request may go below it | 5 |
| Q7 | Pay response order? | None relied on: the adaptive window | Descending on 5 pages, ascending on 0. No full page, so the `endTime` semantics were not exercised. The adaptive window stays, as it relies on neither | 6 |
| Q8 | Can BTC fund a non-BTC Pay order? | Stop `pay-btc-funded-other-coin`. If any are found, import the BTC part (I5, option A) | Not seen: 0 of 41 non-BTC orders paid with BTC; each of the 5 BTC orders has a BTC `fundsDetail` entry and none is mixed. User ruling A2: keep the stop; build option A when a real case is seen | 7 |
| Q9 | Pay walletType 3/4/6 or combined payments? | Stop | `walletType` 1 on 5 of 5; `walletTypes` [1] on 4 and [1,2] on 1; no 3, 4, or 6. `walletType` was 1 even for the [1,2] split, so placement uses `walletTypes` and `walletAssetCost` (sums matched `abs(amount)` on 5 of 5). `walletTypes` entries probably come as text: the client reads an integer or a digit string. `fundsDetail` entry: `amount` string, `currency` string, `walletAssetCost` object keyed by wallet id | 8 |
| Q10 | Universal transfer window cap and `size` max? | 30-day windows, size 100 | `size` 101 is rejected (-1102), 100 is the max. The 31, 60, 90 day, and whole-depth windows answered HTTP 200 with 0 rows, so the window cap is not proven. No data in the probe account for the rest; rule unchanged (30 days) | 9 |
| Q11 | Universal transfer settled status value? | Only `CONFIRMED`. Anything else, `FAILED` included, is owed at its point until the floor drops it (user ruling 2026-10-12) | No data in the probe account (0 transfer rows), rule unchanged | 9 |
| Q12 | Earn history depth? | Floor 2022-01-01. Older windows return empty | The samples before the 2022 floor returned total 0; there are no Earn rows at all. No data in the probe account, rule unchanged | 10 |
| Q13 | Earn settled status values? | Per kind (documented 2026-10-13; USER RULING 2026-10-13 (kept)): a subscription (flexible or locked) settles on `SUCCESS` (documented `PURCHASING`, `SUCCESS`, `FAILED`); a redemption settles on `PAID` (flexible documented `CREATED`, `PAID`, `FAILED`; locked: only `PAID` is an example). `FAILED` is a final failure, ignored; any other value is not settled and stops at its point. A locked redemption with `isComplete` `false` is not settled (was: only `SUCCESS` settled, so every redemption, whose status is `PAID`, stayed owed for good) | `size` max is 100. No Earn rows, so no status values. No data in the probe account, rule unchanged | 10 |
| Q14 | Where do Earn rewards land, and what does a locked redemption's `amount` mean? | ANSWERED, ruling A (user, 2026-10-10): flexible `REALTIME` -> Earn, flexible `BONUS` -> Spot, locked -> Spot, other flexible `type` stops (`earn-reward-type-unknown`); sources: the two FAQ URLs in section 6. Known gap: maturity-paid locked rewards. Redemption legs use `amount`. `rewardAmt` is not imported from redemptions | No data in the probe account (no reward rows, no locked positions), rule unchanged; ruling A stands and the maturity-paid gap stays open as a documented open check (user ruling 2026-10-13), closed when a locked reward paid at maturity is seen in the Binance app | 10 (reward `type` counts per kind; maturity-paid question) |
| Q15 | The SAPI IP ceiling and the IP header? | `IP_BUDGET_1M` 6000 and the per-walk caps, which hold even without the header | The header is not the same everywhere. Pay: `X-SAPI-USED-UID-WEIGHT-1M` (peak 21000 after 9 calls). Capital deposit, transfer, Earn: `X-SAPI-USED-IP-WEIGHT-1M`. Withdraw history: `X-SAPI-USED-UID-WEIGHT-1S`, per second, no minute reading (it gives none; the cap of 9 calls bounds it). Account: `X-MBX-USED-WEIGHT-1M`. The IP ceiling could not be measured, so `IP_BUDGET_1M` stays. Probe rev 2 PART A (2026-10-13): withdraw reports `X-SAPI-USED-UID-WEIGHT-1S` again; Pay `X-SAPI-USED-UID-WEIGHT-1M` peaked at 39000; the IP ceiling is still not measurable | 11 |
| Q16 | Are there fully identical reward records? | Each one is kept as its own row (E9) | No data in the probe account (no reward rows), rule unchanged | 10 |
| Q25 | Do flexible `REWARDS` rows and sub-satoshi rewards import? | A (user ruling 2026-10-13): they stay stopped and owed until the probe; a documented open check, not a merge blocker | No data in the probe account (no reward rows); closed when a flexible `REWARDS` row is seen: its count, wallet, and overlap with `REALTIME` and `BONUS` rows | 10 |
| A1 | The Pay success `code` is `"000000"` | A missing `data` array or an unknown code is an error | Yes: code `"000000"` and a `data` array on 7 of 7 Pay calls. As built | 1 |

## Still needing the user

- Open checks, documented and accepted (user ruling 2026-10-13), not merge blockers: VERIFY 15,
  the VERIFY 10 allowlist cases, Q14 maturity-paid, Q25, the deposit end semantics, and the
  Pay-from-Earn redemption check (item 19). If a
  probe finds identical reward records (Q16), confirm whether they are real double credits.
- Optional: check one BONUS or locked reward in the Binance app and say which
  wallet it landed in. Q14 itself is ruled (A, 2026-10-10).
- Before the second probe run (items 12-15): one small Spot -> Funding transfer of any
  coin, and one small Simple Earn flexible subscription and redemption of any coin, so the
  transfer and Earn reads have a row to answer with.
- Before January 2027: decide the import of the Funding -> Spot migration (item 16).
- Nothing is open from the OVERNIGHT list of the plan
  (`docs/superpowers/plans/2026-10-10-binance-history.md`): OVERNIGHT 17 (R28) and 18-21 are
  decided (user ruling 2026-10-12, "Rulings of 2026-10-12" above).

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
- task 5/7: the deferred task 4/7 minors and R30 for capital and Pay (first commit), the
  multi-series shared walk
  (`binance.history-paging.ts`, typed points, `callsOf`), the Transfer walk
  (`binance.transfer-history.ts`) and tests.
- task 6/7: Earn walk (`binance.earn-history.ts`), including per-record rewards
  with the group-ordinal key, and R30 for Earn rows. Also the caption logic
  (`isBinanceHistoryBehind` over all cursors, no owed-point condition) and copy (en + uk), moved here from the dropped Convert task.
  Tests.
- task 7/7: the probe script (memory/refs, user run) as the VERIFY gate, and the
  kiko-architecture "Binance transaction history" rewrite (via scribe). The
  rewrite records that Convert is deferred and why.

The probe (task 7/7) can run as soon as task 1/7 lands, because it needs no app
code. Run it early, so that Q answers reach tasks 4-6 before they are reviewed.
