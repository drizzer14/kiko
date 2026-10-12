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
| OVERNIGHT 17 (R28) | User ruling 2026-10-12 (kept): a stop in the forward pass ends only the forward pass; the run goes on to the owed ranges, the re-scan and the points. The cursor still never passes the stuck record (A2) | sections 5, 7 |
| OVERNIGHT 18 | User ruling 2026-10-12, A (confirmed): the Transfer and Earn walks follow option A. The other rows of a span import; only the stuck record is owed, at its point | sections 5, 6 |
| OVERNIGHT 19 | User ruling 2026-10-12, A (confirmed): `LANE_CALL_CAPS.transfer` = 80 | section 2 |
| OVERNIGHT 20 | User ruling 2026-10-12, B: the "history is behind" caption shows ONLY while a walk cursor is null or more than a day behind; an owed point does not show it (was: the applied default also showed it for an owed point) | section 8 |
| OVERNIGHT 21 | User ruling 2026-10-12, B (the spec rule kept): a `FAILED` transfer stays owed at its point until the 6-month floor drops it. VERIFY 14 still records the exact status values, for the record; no rule waits on it | section 5, T11 |
| R30 | Orchestrator ruling (technical) 2026-10-12: on every walk a BTC row the client cannot parse (no finite time, an off-contract field) is a per-record stop, never a whole-run throw. It owes its canonical point when a usable time exists, else the span; the other rows of the span import. Codes: `capital-row-unreadable`, `pay-row-unreadable`, `transfer-row-unreadable`, `earn-row-unreadable`. A malformed envelope still throws for the whole read | sections 1, 3, 5, 6, 7; P10, C3, T12, E12, E23 |

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
  | Transfer | 80 (was 60; user ruling 2026-10-12, OVERNIGHT 19 = A: a caught-up run needs forward 20 + an owed range 20 + re-scan 20 + points) |
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
  `binanceEarnHistoryCursor` (and `binanceHistoryCursor` for the capital walk). A walk
  that re-scans its last window also keeps a re-scan mark next to its cursor
  (`binanceHistoryRescanCursor` for capital, `binancePayRescanCursor` for Pay,
  `binanceTransferRescanCursor`, `binanceEarnRescanCursor`), see sections 4 and 7. It also
  keeps a list of pending overlap ranges (`binanceHistoryPendingOverlap`,
  `binancePayPendingOverlap`, `binanceTransferPendingOverlap`, `binanceEarnPendingOverlap`)
  and a point cursor (`binanceHistoryPointCursor`, `binancePayPointCursor`,
  `binanceTransferPointCursor`, `binanceEarnPointCursor`), see section 4.
- All of them join the walk-owned keys of `holding-metadata.ts` (`binanceWalkCursorFields`,
  `binanceWalkPendingFields` and `binanceWalkPointCursorFields`). The balance upsert carries
  them and the disconnect resets the cursors to the floor, the lists to an empty list and drops
  the point cursors (no key: start at the oldest point), through the existing code paths.
- One generic `holdingsRepo.setBinanceWalkCursor(holdingId, key, ms)` (it also writes a point
  cursor) and `setBinanceWalkPending(holdingId, key, ranges)` for a list keep the existing
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
    cannot be shown to have held the point's record, so the point stays: the walk fails closed.
    That covers a window that returns nothing, one that returns only the neighbours of the stuck
    record (Binance filters on another field, or rounds the time), a window that holds only part
    of the point (a re-scan that starts inside the second), and a window that the budget cut
    before its last span (a window that came back too full is read in halves, and the point
    leaves only once both halves were read): none of them takes the point off, and no span
    alone does.
  - **Order of a run.** Forward pass first, then the owed ranges the window re-scan will not
    read this run, oldest first, as windows of their own (`WalkPass` `pending`), then the window
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
    second. The bounds are derived from the reads: each range is read once,
    oldest first, on the calls a run has beside the forward pass and the two the re-scan and
    the points keep (`ceil((ranges + 1) / (reads - 3)) + 1` runs), a dense day or window by the
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
    (fail-safe; the probe checks the sign). B7 is an overnight default and needs user
    confirmation (plan, OVERNIGHT 16).
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
    lands on the other wallet of the same account; the totals stay right.
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
  documented, Q10). The walk reads 20 types: the 18 untracked ones plus `MAIN_FUNDING` and
  `FUNDING_MAIN`, those two first. It runs on the shared walk (sections 3 and 4): forward
  pass, owed ranges, re-scan of the last 30 days, owed points, with per-record commits. A
  span read is one series per type (`size=100`). A first walk is about 7 windows x 20 types,
  which is 140 calls of IP 1, spread over runs by the 80-call cap (section 2).
- Filter: `asset === 'BTC'` (the client counts a row of another asset for the pager and
  parses only BTC rows strictly) and a settled `status` (`CONFIRMED` assumed, Q11).
- **Commit granularity: per record** (user ruling 2026-10-12, OVERNIGHT 18 = A). A record the
  walk cannot trust owes its own point and the other records of the span commit (pending pass
  and re-scan). The forward pass leaves the span uncommitted and ends, the cursor unmoved;
  the run then goes on (OVERNIGHT 17 = R28, user ruling 2026-10-12).
  Per-record codes: `transfer-not-settled` (any status but `CONFIRMED`; T5),
  `transfer-id-missing`, `transfer-amount-invalid`, `transfer-type-mismatch` (the row's
  `type` is not the type read), `transfer-row-unreadable` (R30: a row the client could not
  parse; T12).
- **A `FAILED` transfer stays owed** (user ruling 2026-10-12, OVERNIGHT 21 = B). Any status
  but `CONFIRMED`, a final failure included, is `transfer-not-settled`: the point stays on the
  list, read once a round, until the 6-month floor passes it. No row imports. The owed point
  does not show the caption (section 8). VERIFY 14 records the exact status values for the
  record; no rule waits on them (T11).
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
  FUNDING), `earn-reward-type-unknown`, `earn-row-unreadable` (R30: a row the client could not
  parse). An unreadable reward row owes its point for every reward group of its kind at that
  `time`: its group cannot be known, and a group numbered without it would number two ways. A
  stop not tied to one record (`earn-page-drift`, `earn-holding-missing`), an unreadable row
  with no finite `time`, or a record outside the span owes the span. The forward pass leaves
  the span uncommitted and ends, the cursor unmoved.
- Floor: 2022-01-01 UTC. That is before Simple Earn launched (assumption); the
  probe reports the earliest record (Q12). With the 30-call cap a first walk takes
  about 12 runs (58 windows x 6 calls / 30).
- **Subscription** (flexible or locked), with a settled status only (Q13):
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
record, for a holding with no cursor yet) still feeds the plan, but never the stored marks.

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
| P5a | Pay, in | `transactionTime` before 2026-09-29T00:00:00Z, whatever walletType, walletTypes (one wallet, two, or none), costs and funds say | Funding (R22, by date) | not imported |
| P5b | Pay, in | `transactionTime` at or after 2026-09-29T00:00:00Z, whatever the wallet fields say (including walletTypes [1,2]: no stop) | Spot (R22, by date) | not imported |
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
| T5 | status not settled | `transfer-not-settled`: owed at `[t - 1, t + 1]` in its type; forward pass: span uncommitted, cursor unmoved | stop the window |
| T6 | asset not BTC | ignored (counted for the pager) | ignored |
| T7 | Funding holding missing (T1) | P7, then T1 | same |
| T8 | pending pass or re-scan: one T5 record and one CONFIRMED record of another type in the span | the CONFIRMED one imports; the T5 one is owed at its point | nothing of the window |
| T9 | forward pass, the same span | nothing commits, the forward pass ends, the run goes on (OVERNIGHT 17) | stop the window |
| T10 | row `type` is not the type read | `transfer-type-mismatch`, owed at its point | n/a |
| T11 | status `FAILED` (user ruling 2026-10-12, OVERNIGHT 21 = B) | `transfer-not-settled`: owed at its point until the 6-month floor drops it; no row; no caption | same (the OVERNIGHT 21 recommendation to ignore it is not taken) |
| T12 | a row the client cannot parse (R30), beside a CONFIRMED row of another type, pending pass or re-scan | `transfer-row-unreadable`: owed at its point in the type read (no finite `timestamp`: the span, every type); the CONFIRMED row imports; the run goes on | the read threw, the run failed |

Earn:

| # | record | result | was: |
|---|---|---|---|
| E1 | flexible sub, amtFromSpot = amount | Spot -a, Earn +a, paired | same |
| E2 | locked sub, spot 0.3 + funding 0.2 = 0.5 | Spot -0.3, Funding -0.2, Earn +0.5, one pair id | same |
| E3 | sub, split sum is not amount | `earn-split-mismatch`, owed at its point | stop the window |
| E4 | sub, no split fields, sourceAccount FUNDING | Funding -a, Earn +a | same |
| E5 | flexible redeem, destAccount SPOT | Earn -a, Spot +a, paired | same |
| E6 | locked redeem, rewardAmt > 0 | principal legs only; reward comes from E7 | same |
| E7 | one flexible `REALTIME` reward record | Earn +rewards, 'Binance Earn', key ends `:<time>:0` | same |
| E8 | two rewards in one group, amounts 0.00000002 and 0.00000001 | two rows, `n` 0 = 0.00000001, `n` 1 = 0.00000002 | same |
| E9 | two identical reward records | two rows (`n` 0 and 1) | same |
| E10 | re-read returns the same group | same keys, no new rows | same |
| E11 | reward on a window boundary, returned by both windows | one row (same key) | same |
| E12 | reward with missing `time` or a non-finite amount | missing `time`: `earn-row-unreadable` (R30), the span owed, the other rows of the span import, the run goes on; non-finite amount: `earn-amount-invalid`, the group owed at its point | missing `time`: the run failed (5ad68db9); before: stop the window |
| E13 | gathered rows are not equal to `total` | `earn-page-drift`: the span owed as a range, the other kinds commit | stop the window |
| E14 | status not settled | `earn-not-settled`, owed at its point | stop the window |
| E15 | one flexible `BONUS` reward record | Spot +rewards, 'Binance Earn', no marker | same |
| E16 | one locked reward record (any `type`) | Spot +amount, 'Binance Earn', no marker | same |
| E17 | flexible reward with `type` `REWARDS` or an unknown value | `earn-reward-type-unknown`: no row, the group owed at its point; forward pass: cursor unmoved | stop the window |
| E18 | `BONUS` or locked reward, Spot holding missing | Spot created at 0 (P7), then the row | same |
| E19 | pending pass or re-scan: a subscription not settled and a `REALTIME` reward in one span | the reward imports; the subscription owed at its point | nothing of the window |
| E20 | two reward groups in one span, one of unknown `type` | the other group imports; the unknown one owed at one point | nothing of the window |
| E21 | `FAILED` subscription | ignored, nothing owed | same |
| E22 | one kind drifts in the re-scan | the other five kinds commit; the span owed as a range | nothing of the window |
| E23 | a row the client cannot parse with a finite `time` (R30), pending pass or re-scan | `earn-row-unreadable`: owed at its point in its kind; a reward row holds every reward group of its kind at that `time` on the same point; the other rows import; the run goes on | the read threw, the run failed |

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
12. Range end semantics, for each endpoint the walk reads (Pay transactions,
    capital deposit, capital withdraw, transfer, Earn): whether `startTime` is
    included and whether `endTime` is included. Read `[t, t]`, `[t - 1, t]`, and
    `[t, t + 1]` around a known record time `t`, and print which of them return the
    record.
13. Withdraw history: which field `startTime` and `endTime` filter on (`applyTime`,
    `completeTime`, or another), and whether `applyTime` is truncated or rounded to
    the second against that field. The owed point of a withdrawal
    (`[T - 1000, T + 1000]`) rests on this.
14. Universal transfer: which field `startTime` and `endTime` filter on (`timestamp`?),
    the precision of `timestamp`, the range ends (item 12) on a row of ANY asset, whether
    a `tranId` repeats across types, the status values (Q11; for the record only, no rule
    waits on them: a `FAILED` transfer stays owed, user ruling 2026-10-12), and the answer to a
    `startTime` older than 6 months. The owed point of a transfer rests on the first two;
    a wrong filter field keeps the point owed (fail closed), and the record starves once it
    can be placed. The probe account had no transfer row: one small Spot -> Funding
    transfer of any coin first (Still needing the user).
15. Simple Earn, per kind: which field `startTime` and `endTime` filter on (`time`?), its
    precision, the range ends (item 12), and whether every member of a reward group comes
    back in any read that returns one of them. The owed point and the reward key
    `<time>:<n>` rest on this. The probe account had no Earn row: one small flexible
    subscription and redemption of any coin first (Still needing the user).
16. After the January 2027 Funding -> Spot auto-migration (not before the merge): on an
    account that held Funding BTC, the transfer rows of every type on the migration day.
    Before it, `kiko:researcher` reads Binance's migration notes for how the move is
    recorded (URL + date).

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
| Q13 | Earn settled status values? | Only `SUCCESS`. A pending status stops, a final failure is ignored | `size` max is 100. No Earn rows, so no status values. No data in the probe account, rule unchanged | 10 |
| Q14 | Where do Earn rewards land, and what does a locked redemption's `amount` mean? | ANSWERED, ruling A (user, 2026-10-10): flexible `REALTIME` -> Earn, flexible `BONUS` -> Spot, locked -> Spot, other flexible `type` stops (`earn-reward-type-unknown`); sources: the two FAQ URLs in section 6. Known gap: maturity-paid locked rewards. Redemption legs use `amount`. `rewardAmt` is not imported from redemptions | No data in the probe account (no reward rows, no locked positions), rule unchanged; ruling A stands and the maturity-paid gap stays open | 10 (reward `type` counts per kind; maturity-paid question) |
| Q15 | The SAPI IP ceiling and the IP header? | `IP_BUDGET_1M` 6000 and the per-walk caps, which hold even without the header | The header is not the same everywhere. Pay: `X-SAPI-USED-UID-WEIGHT-1M` (peak 21000 after 9 calls). Capital deposit, transfer, Earn: `X-SAPI-USED-IP-WEIGHT-1M`. Withdraw history: `X-SAPI-USED-UID-WEIGHT-1S`, per second, no minute reading (it gives none; the cap of 9 calls bounds it). Account: `X-MBX-USED-WEIGHT-1M`. The IP ceiling could not be measured, so `IP_BUDGET_1M` stays | 11 |
| Q16 | Are there fully identical reward records? | Each one is kept as its own row (E9) | No data in the probe account (no reward rows), rule unchanged | 10 |
| A1 | The Pay success `code` is `"000000"` | A missing `data` array or an unknown code is an error | Yes: code `"000000"` and a `data` array on 7 of 7 Pay calls. As built | 1 |

## Still needing the user

- Run the probe script (task 7/7) and send back its output.
- Before merge: if probe item 10 finds identical reward records (Q16), confirm
  whether they are real double credits.
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
