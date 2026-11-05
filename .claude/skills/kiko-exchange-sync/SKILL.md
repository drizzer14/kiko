---
name: kiko-exchange-sync
description: Invoke whenever you touch src/crypto-sync/**, src/sync-state/**, src/statistics/exchange-exclusion/**, src/statistics/exchange-funding-match/**, src/transactions/exchange-description/**, src/holdings/exchange-convert/**, src/holdings/exchange-destination/**, src/holdings/exchange-prefill/**, src/screens/forms/exchange-fields/**, or work on exchange sync, Binance (the Spot, Funding and Earn balance reads and the capital, Pay, Transfer, Earn, Convert, P2P, fiat, trade and dust history walks), a wallet or coin holding, an Exchange or Convert leg, or `exchange_state` in sync-state. Read before writing a Binance client call, a history walk, a cursor, pending or re-scan mark, a coin-keyed holding or pair id, or the label of an exchange leg. For the bank provider registry see kiko-domain; for the sync pipeline and `.kiko` export see kiko-architecture; for the public Binance price fallback see kiko-pricing.
---

# Kiko exchange sync

The exchange-sync rules of the crypto-sync provider layer (Binance and the BTC wallet provider), its
sync-state walk marks, and the Exchange/Convert leg markers and labels. The bank provider registry
and its `exchangeProviderRegistry` twin sentence stay in kiko-domain ("Bank catalog and provider
registry"); the sync pipeline, the Monobank rules and `.kiko` export/import stay in
kiko-architecture.

## Binance exchange sync — every asset of three wallets, one holding per coin and wallet

`binanceProvider` (`src/crypto-sync/binance/binance.provider.ts`) reads
every asset of the three wallets (Spot, Funding, Earn; Simple Earn
Flexible + Locked COMBINED into one Earn read) and writes one holding per
(coin, wallet), keyed by `holdingKeyOf(code, wallet)`
(`binance.holding-keys.ts`; the wallets are fixed there as
`BINANCE_WALLETS`). BTC is the only coin with legacy keys. The
four reads, all signed by the one shared `signedRequest` helper in
`binance.client.ts` (HMAC-SHA256 over the same `timestamp=…&recvWindow=…`
query; read-only key is enough):

| Wallet | Client fn | Method + path | Amount per coin |
|---|---|---|---|
| Spot | `fetchAccount` | `GET /api/v3/account` | `free + locked` |
| Funding | `fetchFundingAsset` | `POST /sapi/v1/asset/get-funding-asset` | `free + locked + freeze + withdrawing` |
| Simple Earn Flexible | `fetchFlexiblePosition` | `GET /sapi/v1/simple-earn/flexible/position` | `totalAmount` |
| Simple Earn Locked | `fetchLockedPosition` | `GET /sapi/v1/simple-earn/locked/position` | `amount` |

Load-bearing rules, verified in `binance.provider.test.ts` rather than
restated here:

- **One holding per coin and wallet, one match key each.** The key is
  `<CODE>` (Spot), `<CODE>:funding`, `<CODE>:earn` (stored under
  `metadata.binanceAsset`, matched by `upsertByMetadataKey`). The BTC cases
  (`SPOT_KEY`, `FUNDING_KEY`, `EARN_KEY`) keep the legacy keys. Earn combines
  Simple Earn Flexible + Locked into ONE holding per coin.
- **Per coin and wallet.** Every balance goes through `exchangeMinorUnits`
  (`@kiko/crypto-sync/exchange/amounts`), never a float sum. A holding is keyed
  per coin and wallet (`holdingKeyOf`, `binance.holding-keys.ts`). A tracked
  coin is `isTrackedBinanceAsset` (`binance.tracked-coin.ts`): the curated
  crypto plus `BINANCE_FIAT_CODES`, the Kiko fiat codes Binance quotes. Read
  both files for the closed sets.
- **Names and the one-time rename.** A holding is named
  `'Binance <Wallet> · <CODE>'`. A BTC holding carries `renameFromDefaults`
  (`PREVIOUS_BTC_HOLDING_NAMES`, plural): `upsertByMetadataKey`
  (`holdings.repo.ts`) renames it ONCE per holding, only if its name is still
  one of those defaults. The mark `defaultNameRenameSettled`
  (`holding-metadata.ts`) is written on the first upsert that carries
  `renameFromDefaults`, rename or not, is carried by `withCarriedMetadataKeys`
  and kept through `.kiko`. A user-edited name is never overwritten.
- **Spot is strict; the others are error-tolerant per WALLET.** Spot's read
  failure fails the whole sync. No zero Spot BTC anchor is written: a Spot BTC
  below dust with no stored holding creates none, like every other coin (the
  appear rule), because an anchor would make an empty row for a coin the user
  never held; an existing Spot BTC holding stays, and one with a refused amount
  keeps its last balance. The balance-sync time is stamped in `exchange_state`
  (`balanceSyncedAt`, patch kind `balanceSyncedAt` in `binance.provider.ts`) and
  "Last sync" reads it, so an account with no tracked holding never shows "Never"
  after a good read. A malformed top level takes no patch, so such an account with
  no holding still shows "Never" (it also shows the paused-history caption). A Funding or Earn
  read that fails (`walletRead` returns null) omits every holding of that
  wallet (`appendWallet`), leaving each at its last-good balance, and logs
  one `logFailure`; a refused coin skips only itself (next rule).
- **A refused coin skips only itself.** An oversized or malformed tracked-coin
  amount omits that coin alone and logs `'[binance sync] a coin amount was
  refused'` with `{ wallet }` only. For the dust, stay and absent rules per
  coin read `appendWallet` in `binance.provider.ts`; do not restate them.
- **Coin lists.** `fetchBalances` returns `ProviderRead`
  (`{ balances, exchangeState?, spotBalanceTexts? }`; the last feeds the trade
  read, see `provider/provider.ts`). `runBinanceSyncAndImport`
  (`run-crypto-sync.ts`) writes the lists after the institution is set, under
  `logOnFailure('[binance sync] balance lists failed')`, before the walks. The
  not-tracked list is written only on a read where every wallet read. The
  oversized list is per wallet (`balanceByWallet`): a wallet that read
  replaces its own array, a failed wallet keeps it, a complete read replaces
  every array. One writer, `withOversizedBalance`
  (`exchange-state-patch.ts`, patch kind `oversizedBalance`): the invariant is
  `balance` == union of `balanceByWallet` plus the kept legacy tickers
  (`OversizedCoinLists`, `walk-state.ts`; an unreadable list names
  `oversizedCoins.balanceByWallet`). `BalanceSyncResult` (`sync.ts`) carries
  the `exchangeState` of the read. The public Binance price fallback is in
  `kiko-pricing` (`src/rates/binance-market/`).
- **The Simple Earn position reads MUST paginate, and Earn skips as a whole.**
  The flexible and locked position endpoints are paged (`current` from 1,
  `size` per page capped at 100, response `{ rows, total }`); reading page 1
  alone UNDER-COUNTS a user whose positions span more than one page (locked
  especially — each locked subscription is its own row). `fetchAllPositions`
  in `binance.client.ts` loops `current` until the gathered rows cover `total`
  (short-page and a hard 50-page cap are the backstops). Both Earn reads sit
  inside ONE wallet read guard, so a failure on EITHER read (or any page)
  skips the WHOLE Earn holding rather than writing a partial, silently
  under-counted total. The funding read is a full array — NOT paginated. The
  balance reads send no asset filter (Funding sends `{}`, Earn only
  `current` and `size`). No history read sends a coin or asset filter either: they
  read account-wide and the client tells a tracked coin from the rest by the row.
- **Amounts are integer minor units, never floats.** See "Per coin and
  wallet" above: `exchangeMinorUnits` converts each amount (see
  `kiko-domain`). A JSON number is expanded by `decimalFromJsonNumber`
  (`amountText`, `binance.provider.ts`), not refused; a non-finite,
  malformed or oversized amount is refused before it can reach the
  `notNull` column.

Confirm each Binance endpoint's path, params, and response shape against
the live API (or the official Binance Postman collection / SDK models)
during any change — the field names above (`totalAmount` for flexible,
`amount` for locked, funding's four fields) are the ones the parse keys on.

### Binance transaction history — the capital walk and the shared walk

The Binance BALANCE sync (`runBalanceSync`) still writes no transaction
rows — the generic balance sync gives a live number, not a ledger. A
SEPARATE step imports the ledger: `syncBinanceTransactions`
(`src/crypto-sync/binance/binance.transactions.ts`), which
`runCryptoSync`'s Binance arm runs AFTER the balance sync so the Spot
holding already exists. It is SUPPLEMENTARY — the arm runs it under
`logOnFailure('[binance sync] capital history failed', …)`
(`@kiko/diagnostics`, name and code only), so a 429 or a permission gap never
fails the balance sync. The Binance arm runs its history reads in
`runBinanceHistoryWalks` (`src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`: read
the order and the `logOnFailure` tags there). Each runs in its own `logOnFailure` and
all share one `run`; a rate limit met by an earlier read puts the shared cooldown on the later ones.
P2P is the first walk, so a rate limit P2P itself meets (429 cooldown) skips every later walk of
that run (see "Binance P2P").
The trade read runs as the LAST walk of `runBinanceHistoryWalks`, so an earlier rate limit
skips it. Read `binance.trade-history.ts` and `binance.history-client.ts` for its rules: one
text sum per order and one conversion; the imported-order prefix lookup
(`transactionsRepo.importedOrderPrefixesQuery`, chunked by `ORDER_PREFIX_CHUNK_SIZE` for
SQLite's expression depth); one weight-5 `fetchOrderFills` re-read per known order per run;
`heldOrderId`, set only when no other order's fill is inside the held order (S11-Q11, see
`trailingOf`); the `rowlessOrderIds` set (S11-Q13; cleared on disconnect, an id leaves when its
order writes a row); the strict `decimalText` reader; `fromId` is inclusive (the pager asks last
id + 1). The pair id `${accountId}:trade:${symbol}:${orderId}` has no `:<COIN>` because
(symbol, orderId) names one order, and every leg and fee key ends with the wallet key, which
holds the coin. Design rule: a "seen" mark must not depend on a written row. The trade-symbol
discovery and rotation (candidate rule, status filter, the rotation cursor stored as text in
`trades.rotation`, and the candidates still unread in `trades.unreadSymbols`, which the history
caption reads; per-symbol vs run-stopping errors) live in
`src/crypto-sync/binance/binance.trade-symbols.ts`; the id-cursor pager is
`src/crypto-sync/exchange/paging/id-cursor-pager.ts`. Read `TRADE_MAIN_QUOTES` and
`TRADING_SYMBOL_STATUSES` there, never a copied list. Convert reads `/sapi/v1/convert/tradeFlow`
(`binance.history-client.ts`) and places each row by `walletType` FUNDING or SPOT
(`binance.convert-history.ts`). `recordExchangeCounterpart` (Convert-mode) in `kiko-domain` is
the app's manual Convert.

Load-bearing rules, verified in `binance.transactions.test.ts` rather
than restated here:

- **Two signed reads.** `GET /sapi/v1/capital/deposit/hisrec` and
  `GET /sapi/v1/capital/withdraw/history`, both account-wide (no `coin` param), both fetched
  by `binance.history-client.ts` and signed through `signedRequestPage`
  (`binance.client.ts`), the same HMAC as the balance reads (read-only key).
  The history reads (`fetchDepositHistory`, `fetchWithdrawHistory`) live in
  `binance.history-client.ts`, not `binance.client.ts`, and return a
  `CapitalPage` (a `HistoryPage` plus `untracked`); only a malformed BODY throws
  `BinanceHistoryParseError`, so the window stops and the cursor stays. A row
  of a tracked coin (`isTrackedBinanceAsset` on `binanceTickerOf` of its coin)
  is read strictly, and a malformed one is `capital-row-unreadable`, a
  per-record stop: it is owed at its point (the span when it has no usable
  time) and the other rows of the span import (spec section 7, "Strict
  capital parse"). A row of any other string coin is counted, never parsed,
  and lists its ticker in `untrackedCoins.history` once settled
  (`isCapitalSettled(kind, status)` in `binance.history-client.ts`, the one settled rule of
  the client and the walk: read the statuses there). A SETTLED record with a blank or
  non-string coin is unreadable and owed, since it cannot be told from a tracked coin; a
  record that is NOT settled is counted whatever its coin and never listed.
  Each client call is ONE offset page of ONE window; the offset-paging
  lives in `binance.transactions.ts`, not the client. The walk shared by
  every Binance history walk lives in the shared exchange layer,
  `src/crypto-sync/exchange/walk/walk.ts` (read it for its exports:
  `planWalkPasses`, `runWalkPlan`, `walkSpans`, `buildWalkWindows`, the mark
  readers/writers, `BinanceWalkStop`); every history row amount goes through
  `rowMinorUnits(currency, text)` in `exchange/walk/records.ts`, which calls
  `exchangeMinorUnits(currency, text, 'row')` and throws `BinanceWalkStop` with
  the parser's code (exception: the trade read passes `'trade-row'`,
  `exchange/amounts/amounts.ts`: a fiat leg or fee rounds half away from zero once per
  order after the text sum, with the `row-precision-rounded` log; S11-Q10 is OVERNIGHT
  DEFAULT, pending user) (`AMOUNT_STOP_CODES`: `amount-malformed`, `amount-precision`,
  `amount-too-large`); `amount-too-large` also names the coin, and
  `commitSettledSpan` writes it to `oversizedCoins.history`
  (`historyListWriterOf(deps, accountId, coins)`, one writer for `oversizedCoins`
  and `untrackedCoins`; `commitSettledSpan` requires the writers it types, including
  `writeNotImported` from `notImportedWriterOf`) on every span read
  that meets the stop. The
  per-record commits live in the same file (`settleRecords`,
  `commitSettledSpan`). What a
  walk reads about one exchange is an `ExchangeWalkConfig`
  (`exchange/walk/walk-config.ts`; Binance's is `BINANCE_WALK_CONFIG` in
  `binance.walk-config.ts`). The other exchange units are `exchange/signing`,
  `exchange/credentials`, `exchange/budget` (`RunBudget`, `createExchangeRun`),
  `exchange/walk/depth.ts` (Binance's `BINANCE_DEPTH_CONFIG` is in
  `binance.depth-config.ts`) and `exchange/amounts` (`exchangeMinorUnits`);
  read each folder's barrel. `exchange/credentials` (`saveExchangeCredentials`,
  `clearExchangeCredentials`) takes no per-account lock: a caller serializes its own writes and
  clears (Binance does, with its write tokens, in `binance/binance.credentials.ts`); never call
  these two helpers from anywhere else (see the header of `exchange/credentials/credentials.ts`).
  The walk, records, paging and depth tests stay
  in `binance/` (they import Binance fixtures); `walk.series-ranges.test.ts`
  lives beside the walk. The
  capital caller is `binance.transactions.ts` (`WINDOW_MS`, `MAX_WINDOWS`,
  `MAX_PAGES_PER_WINDOW`), the Pay caller `binance.pay-history.ts`
  (`PAY_WINDOW_MS`, `MAX_WINDOWS`; see "Binance Pay" below). The Transfer
  caller is `binance.transfer-history.ts` (`syncBinanceTransferHistory`, run
  third in `run-crypto-sync.ts`; see "Binance Transfer" below); the paging
  helpers live in `exchange/paging/paging.ts` (`fetchAllByTotal`,
  `readSeriesSpan`) and the walk-state seam in `exchange/walk/exchange-state-deps.ts`
  (`ExchangeStateDeps`, `exchangeStateDepsOf`).
- **Dust is a read, not a walk** (`binance.dust-history.ts`): no WalkId, cursor,
  `captionWalksOf` table entry, forward-owes or not-imported kind. It reads the newest 100
  records every run. An entry is accepted only when `targetAsset` is BNB (`DUST_TARGET`); a repeated
  `fromAsset` refuses all its entries; an entry with a leg that rounds to 0 gives no row for
  either leg; an untracked coin is listed only when its BNB leg imports. A rate limit sets the
  cooldown and logs nothing. A dust row for a tracked coin with no Spot holding creates that
  holding at zero through `placeWalletRows` (amends R-Q6).
- **The history tracked rule, in every walk (`runBinanceHistoryWalks`).** A row whose ticker
  (`binanceTickerOf`, upper-cased once where the client reads it) is accepted by
  `isTrackedBinanceAsset` is read strictly: a malformed, too-precise or oversized amount stops
  the walk at that record and owes its point, so a tracked record is never skipped. Any other
  row is COUNTED for the pager, imported as no row, and its ticker joins
  `untrackedCoins.history` once it is settled, written after the window's rows and before its
  marks. A row whose ticker is blank or not text is unreadable and owed, never untracked.
  The rule is the balance rule's, not the curated list's. Capital reads this in
  `capitalItemOf`, Transfer and Earn in `trackedRowOf`, Pay in `readPayItem`
  (`binance.history-client.ts`); Transfer and Earn pages carry `untracked` rows
  (`TotalPage.untracked`) beside `rows` and `unreadable`. Convert reads the tracked rule in
  `settledOutcomeOf` (`binance.convert-history.ts`;
  `convertOutcomeOf` returns the untracked tickers),
  with no `trackedRowOf` and no `TotalPage.untracked`.
- **`multiCoinSince` and `multiCoinSeen` mark where the other coins start.** Each walk entry
  may hold `multiCoinSince` (the cursor the walk's first multi-coin run planned from: ground
  before it was read for BTC only) and `multiCoinSeen: true` (that run committed a forward
  window). `multiCoinPatchesOf` (`exchange/walk/walk.ts`) builds both, and only the first
  FORWARD cursor write of a run carries them (`multiCoinPatches`): a run with no forward commit
  writes neither. The start written is the EARLIER of the stored start and the plan cursor (a
  stored start with a lost seen mark is the exact start, and a later one would owe ground
  already read again); a null plan cursor with no stored start writes only the seen mark, since
  such a walk reads every coin from its floor. Once seen, nothing is written again. A plan
  cursor at or below the floor is recorded as is, which makes an empty range. A disconnect
  (the reset, `marksAfterDisconnect` in `exchange-state-patch.ts`) drops the start with the
  cursor it was recorded against and keeps the seen mark: the reset cursor is the floor, so
  every coin is read from it. The reader (`multiCoinSinceOf`,
  `exchange/walk-state/walk-state.ts`) never
  repairs a value: a malformed start reads as the stored cursor (absent if there is none), so
  it owes a range rather than none, and a seen mark that is not `true` is absent. The backfill
  of the other coins (`backfillGroundOf`, `exchange/walk/walk.ts`) turns `[floor, multiCoinSince)`
  into one owed range with `scope: 'backfill'` and stores the floor as the start in the SAME
  write, so a malformed start is converted once and an empty or negative range owes nothing: the
  range cannot grow each run. A window of that scope writes every row but BTC's (`rowsOfScope`,
  `binance.walk-wiring.ts`): the BTC rows are already stored, and one the user deleted must not
  come back. The scope also rides on a point window's span resume.
- **Passes per walk; a window length per walk.** The fiat walks read one
  window (`FIAT_WINDOW_MS`, `binance.fiat-history.ts`); capital (`WINDOW_MS`,
  `binance.transactions.ts`) and Pay (`PAY_WINDOW_MS`) read the longest
  windows under the limit; Transfer, Earn, Convert and P2P read 30-day
  windows (`TRANSFER_WINDOW_MS`, `EARN_WINDOW_MS`, `CONVERT_WINDOW_MS`,
  `P2P_WINDOW_MS`); Transfer reads them within a floor
  (`transferFloorMs`). Binance rejects a `startTime`/
  `endTime` span of 90 days or more and caps a page at 1000 rows
  (`HISTORY_PAGE_LIMIT` in `binance.history-client.ts`); every walk
  reads windows under 90 days. A run is the FORWARD pass (the cursor to
  now, moving the cursor) and the window RE-SCAN (a stored mark; never
  writes the forward cursor). Every walk runs it.
  `WalkPass` is `'forward' | 'pending' | 'rescan'` plus the points
  pass (read it in `exchange/walk/walk.ts`); a run reads the forward pass, the owed
  ranges (`pending`: a round-robin from the range cursor, then the backfill group in its own;
  see `planWalkPasses` and the round-robin item below), the re-scan,
  then the owed points last. The fiat orders walk reads ONE turn per run
  (`turnOf`, `FiatTurn`, `binance.fiat-history.ts`): the forward turn, or,
  on a behind run, the owed turn or the re-scan turn in turns
  (`behindRun`, `rescanTurn`); `keepHintsOfOtherPasses` keeps the stored
  hints of the passes a turn did not read, and `rescanStuck` holds the
  ranges the re-scan cannot clear.
  `binance.walk-wiring.ts` holds the wiring every Binance walk shares; read
  it there. The shared code is in `src/crypto-sync/exchange/walk/exchange-walk-plan.ts`
  and `src/crypto-sync/exchange/walk/exchange-span.ts`; `runBinanceWalkPlan` and
  `commitBinanceSpan` stay in `binance.walk-wiring.ts` as thin callers.
- **A failed read.** `isUnreadableWindowError` (`binance.walk-config.ts`):
  the pending and points passes read on past an unreadable owed window and
  the first such error is rethrown after; a rate limit, rejected key, clock
  skew or network failure stops the run with no further call.
  `recordFailedCall` (`binance.history-budget.ts`): every rejected page
  request is a recorded lane call, so a lane cap holds when requests fail.
  The re-scan halves a failing span down to a day before marking it, the
  owed pass owes only the failing day, and a failed owed read is owed per
  series.
- **One pacing gate per run.** `createBinanceHistoryRun`
  (`binance.history-budget.ts`) builds ONE `createRequestGate` (the helper
  Monobank uses, `src/monobank/`) plus the run budget; `runCryptoSync`'s
  Binance arm passes that `run` to `syncBinanceTransactions`, which waits on
  `run.gate` before EVERY history page, spacing them by
  `BINANCE_REQUEST_INTERVAL_MS` (a background import, not Monobank's 60s).
  The clock and `sleep` are inputs to `createBinanceHistoryRun`, not
  `BinanceTransactionSyncDeps` seams, and there is no `gate` seam (same
  rationale as Monobank).
- **The watermark: the walk's `cursor` in `sync_state.exchange_state`, NOT
  `sync_state.last_sync_at`.** `last_sync_at` already means the Monobank
  statement-window cursor for a Monobank account (the table's own doc
  comment in `db/schema.ts`), so the history walk does not reuse it. The
  watermark lives in the account's `exchange_state` JSON, in the entry of its
  walk (`walks.capital.cursor`): "every window ending at or before this
  instant is imported." `parseExchangeState` and `walk-values.ts`
  (`exchange/walk-state/`) are the reader, `syncStateRepo.patchExchangeState`
  (a list of patches in one write) the writer. A patch applies to the RAW
  stored JSON, never the re-serialized parse (the parse drops any field this
  build does not read, such as an unknown walk id or a `notImported` entry of a kind this
  build does not read (`walk-state.ts` reads `notImported`), and
  repairs malformed fields;
  `exchange-state-patch.ts`); a malformed top level makes a patch write
  nothing, only a disconnect replaces it. The plan comes from
  `planWalkPasses` (`exchange/walk/walk.ts`; read its input type for the
  cursor, re-scan cursor, point cursor, pending list, floor, window and
  `RESYNC_OVERLAP_MS`). The capital walk feeds it
  `planCursor = cursor ?? latestTransactionTime ?? null`, so a LEGACY holding
  (capital rows, no watermark yet) starts from its newest imported capital row
  and adopts the watermark at its first committed window; a first sync walks
  from the 2017 floor. `latestTransactionTime` reads only the rows whose
  external id starts with `<accountId>:deposit:` or `<accountId>:withdraw:`:
  a Pay, Transfer or Earn row on Spot never moves the capital forward pass, and
  an account with no capital row starts at the floor. The forward pass starts at
  `max(floor, cursor)`. The re-scan covers `[base, forward start)` with
  `base = max(floor, min(end - window, forward start - RESYNC_OVERLAP_MS))`,
  kept in its own mark (`rescan`, one per walk entry; read `WalkMarks` in
  `exchange/walk-state/walk-state.ts`); it stores the floor
  when finished, and a mark behind the base starts a new pass.
- **A balance sync never touches the walk state.** A balance sync's own
  upsert (`runBalanceSyncInner` -> `upsertExchangeMany`) writes a FRESH
  metadata object on every run, for every provider: `{ syncedAt }`, plus the read date for a
  provider whose balance is dated (`datesBalanceOf` in `holding-metadata.ts`). The update
  branch of the upsert also writes the overwritten-row list of a dated holding
  (`overwrittenRowsPatch`, `src/holdings/repo/holdings.repo.ts`). The walk
  marks are not in that metadata (they live in `sync_state.exchange_state`),
  so nothing there needs carrying except what `carriedMetadataKeys`
  (`holding-metadata.ts`) names: `STATEMENT_FROM_FIELD` (a reopened Monobank
  card's `statementFromMs`) and `DEFAULT_NAME_RENAME_FIELD`
  (`withCarriedMetadataKeys`), and a walk key an older build left in the
  metadata is dropped by the next upsert.
- **Per-record commits, crash-safe.** The walk goes oldest -> newest within a window and across
  the forward pass; the P2P owed ground reads its windows newest first (see "Binance P2P").
  Rows commit (`transactionsRepo.addManyDedup`) BEFORE the mark moves
  (`syncStateRepo.patchExchangeState`) — separate writes, so a crash between
  them re-imports idempotently rather than losing progress. A walk can also
  REMOVE a row: the fiat walks delete the row of a record read `Refunding` or
  `Refunded` (`SettledSpan.removed`, `commitSettledSpan`'s `remove`, the only
  delete of a synced row: `transactionsRepo.removeSyncedRows`, by key, no balance move),
  after the span's rows and before its not-imported entry and its marks, so a
  crash before the marks has the next run read the span again. In the forward
  pass the owed list and the cursor are one patch list, and in the re-scan the
  list and the re-scan mark are, one write after the rows. In the pending
  pass `advancePending` writes only the list (the read span out, its points
  in), and `markRangeRead` writes the range cursor as a separate write. A
  stop tied to one record with a time inside
  the span owes only that record's point; any other stop, or a record with
  no usable time, owes the whole span; every record the walk can trust
  imports either way. The forward pass leaves a span uncommitted on any
  stop, except in the lanes that pass `forwardOwes` (read each `*_FORWARD_OWES`
  constant, e.g. `CONVERT_FORWARD_OWES` in `binance.convert-history.ts`), where a stop tied to one
  record with a usable time owes that point and the span commits. `patchExchangeState` also
  gates the write on the account still being `institution = 'binance'`
  (read in the same write) and is a no-op otherwise — a walk holds the
  account's credentials for its whole run, so a disconnect can commit while
  a window write is still in flight; without the gate that late write would
  resurrect a forward watermark over the floor the disconnect just wrote
  (see below).
- **A per-lane call budget, refreshed from Binance's own headers.**
  `createBinanceRunBudget` (`binance.history-budget.ts`) caps each
  `BudgetLane` at its `LANE_CALL_CAPS` entry and charges `COSTS` per call.
  The UID reading is `X-SAPI-USED-UID-WEIGHT-1M` (parsed by
  `usedWeightsFromHeaders` in `binance.client.ts`, returned as
  `HistoryPage.usedUidWeight1m`) against `UID_WEIGHT_BUDGET_1M`; the IP
  reading is checked against `IP_BUDGET_1M`. Deposits are bounded by the IP
  reading, not by a call cap. The public price reads use the `market` lane
  (`LANE_CALL_CAPS`), cost `{ api: 2 }` per klines call (`COSTS.klines`,
  a `CallCost` on the `api` weight) and are held to `API_IP_BUDGET_1M`
  for `/api/*`, read by `usedApiWeightFromHeaders`. A window whose withdrawals cannot be FULLY
  paged within the remaining budget is not committed and not marked; the
  next run redoes it from the same, unmoved watermark.
  The budget keeps calls for later passes: `RESCAN_KEEP` and `POINT_KEEP`
  (`exchange/walk/walk.ts`) are the calls an owed range must leave for
  the re-scan and for the points, and `canAfford` takes the calls to keep.
  `syncBinanceTransactions` returns the `WalkResult` `{ imported, complete }`
  (`exchange/walk/walk.ts`) — `complete: false` means history remains
  behind and a later run (or sync press) resumes from the marks.
- **A thrown error under `src/crypto-sync` is a named class with a fixed
  message.** Semgrep `kiko-no-literal-sync-error` flags
  `throw new Error(<literal>)`, and `logFailure` logs only the error's name.
  Example: `BinanceHistoryParseError` in `binance.history-client.ts`.
- **A 429/418 sets a per-account cooldown and stops cleanly, without
  failing the balance sync.** `signedRequestPage` (`binance.client.ts`)
  throws `BinanceRateLimitError(status, retryAfterMs)` for a 429 or 418,
  checked BEFORE the body is read (`retryAfterMs` from `Retry-After`,
  seconds -> ms, defaulting to 60s on a missing/non-positive header). The
  cooldown (`binance.cooldown.ts`'s `setBinanceCooldownUntil` /
  `isBinanceCoolingDown`) is SHARED between the history walk and the
  balance sync — a 429/418 from EITHER path means the same UID is over its
  weight budget. The walk catches ONLY this error type, sets the cooldown
  to `now + retryAfterMs`, and returns `complete: false` without
  rethrowing — every EARLIER window's commit stays in place. Any OTHER
  error still rethrows (unchanged: the Binance arm's `logOnFailure`
  logs it and never fails the balance sync). The balance sync
  (`binanceProvider.fetchBalances`) checks the SAME cooldown before its
  first request and makes ZERO Binance requests while it is active
  (returning no balances — a quiet skip, never a thrown error, so a
  history-walk-caused cooldown can never fail the balance sync); a 429/418
  from the Spot balance request ITSELF also sets the cooldown and is
  surfaced as the localized `accountDetail.binanceRequestFailed` message
  (never the raw `BinanceRateLimitError` text) — Spot's failure still
  fails the whole balance sync, per its own strict rule above.
- **Disconnect resets the walk state, not the holdings.**
  `disconnectCryptoAccount`'s Binance path calls
  `accountsRepo.disconnectExchange(accountId, 'binance', HISTORY_FLOOR_MS)`,
  ONE write that resets `exchange_state` (`exchangeStateReset`,
  `exchange/walk-state/`) and then clears the institution, so a late walk patch
  finds the institution cleared; `clearCredentials` follows. In each walk
  entry a stored `cursor` or `rescan` becomes `HISTORY_FLOOR_MS`, a `pending`
  list `[]`, and the point cursor, range cursor and span hints are DROPPED (no
  mark = before the oldest point or range, no span to resume). Only the CAPITAL
  entry gets `{cursor: floor}` when it is stored but unreadable, because a
  missing capital cursor falls back to the legacy `latestTransactionTime`
  cursor, which a reconnected DIFFERENT Binance account would inherit as if
  it were its own already-imported history, silently skipping that account's
  own older
  records. `binanceAsset`/`walletAddress` are untouched, so a SAME-account
  reconnect still re-adopts the holding (`upsertByMetadataKey`'s
  match-by-key) and simply re-walks from the floor. Connecting a DIFFERENT
  Binance account afterward walks its own history from the floor instead
  of inheriting a stale, forward watermark. A malformed top level becomes
  `{capital: {cursor: floor}}`; another walk's unreadable entry is dropped
  (it starts at its floor). A failure in either half of
  `accountsRepo.disconnectExchange` rolls back both. A Binance or wallet connect (after its
  sync) and a successful disconnect also re-plan reminders: see kiko-architecture's "Re-plan
  after a write".
- **A BTC wallet re-sync fetches every OPEN holding's stored address.**
  `bitcoinWalletProvider` (`src/crypto-sync/btc-wallet/`) syncs the Connect
  address first, then each open holding's stored address (a closed holding's
  address is never sent to the explorer), one request at a time, all-or-nothing:
  the first failure throws and the orchestrator upserts nothing. A wallet
  whose stored addresses are all closed re-syncs nothing (an empty result,
  not an error); only a wallet that never stored an address throws.
- **The lagging-history caption.** `isBinanceHistoryBehind` /
  `walkCursorsOf` (`screens/account-detail/crypto-sync-section/binance-history-status.ts`)
  derive from the account's `sync_state` row (`CryptoSyncSection` reads it with
  its own `useLiveQuery` and shows no caption while it is loading):
  `walkCursorsOf` reads the forward cursors of `captionWalksOf(provider)`
  (`binance-history-status.ts`) off the parsed `exchange_state` (nulls when it is not
  readable; `walkCursorsOf(state, provider)` takes a required provider, with no default to
  Binance), `isBinanceHistoryBehind`
  compares them against `latestBalanceSyncAt(holdings, stateStamp)` (the later of the
  holdings' `syncedAt` and the `exchange_state` balance-sync stamp), true when
  any of those walks never caught up (`null` cursor) or is behind by more than a day,
  or when any walk owes a range (`historyOwesRange(state, lastBalanceSyncAt, provider)`: ground its
  cursor passed, read off the `pending` list of every one of the walks), or a point
  that has stayed owed for more than a day (`since`, below), or when a candidate trade
  symbol still waits for its first read (`historyOwesTrades`, the `tradesUnread` input, off
  `trades.unreadSymbols` in `exchange/walk-state/walk-state.ts`; S15-Q14: a symbol whose
  read failed is not counted, so one that fails every run never keeps the caption up), false
  before the account's
  own first balance sync. A fresh owed point never shows it: the record it names is read
  again on every sync. The fiat orders walk's own planned overlap day never shows it either
  (`isPlannedOverlapDay`): its forward turn stores the day, and the next sync's behind turn
  reads it, so a quiet account would show the caption on every other sync. The day is a range
  owed in every series, exactly `RESYNC_OVERLAP_MS` wide, ending at or before the walk's cursor
  (the turn stores it with the cursor already moved on, so its end is the earlier cursor); a
  day owed in one series (how a failed fiat read is owed), a range of any other width, a day
  ending after the cursor, and the same day of any other walk (they read it in the run that
  plans it) all show it. A point carries `since` (epoch ms, the wall clock of the run that
  first owed it; `WalkPlan.ranAt`, stamped by `advanceWalkMarks`, kept by `distinctGround`);
  the caption counts it when `lastBalanceSyncAt - since` is more than a day. A point with
  no `since` (stored before it) is quiet until a run owes it again, and a `since` that is
  no non-negative integer reads as none (`asPendingRange`), never as a malformed list. A
  malformed walk state PAUSES the history: `CryptoSyncSection`'s
  `historyPaused` (an exchange provider, `hasExchangeHistory`, and
  `walkState.kind === 'malformed'`) shows
  `accountDetail.exchangeHistoryPaused` INSTEAD of `exchangeHistoryPending`, and
  the repair is disconnect + reconnect (`resetExchangeStateDatabaseTransaction`
  replaces a malformed top level with a capital floor cursor). `CryptoSyncSection`
  renders the `accountDetail.exchangeHistoryPending` caption under the
  status line only when `hasExchangeHistory(connectedProvider)` is true, so a wallet
  account never evaluates or shows it.
- **The P2P read-failure caption** is separate from the lagging caption. `p2pReadFailed(state)`
  (`binance-history-status.ts`) is true when `walks.p2p.readFailedAt` is set, and false for a
  malformed state. `CryptoSyncSection` shows `accountDetail.exchangeP2pReadFailed` as one generic
  line, with no cause split (R2). It shows with the coin lines (`coinLinesShown`), so it never
  doubles the paused caption. The uk copy is reviewed by kiko-translator before a shipping deploy.
- **The not-imported line.** `crypto-sync-section.component.tsx` shows it only when the
  coin lines show, and keeps it during a sync. The counts come from
  `notImportedCountsOf(walkState)`, the copy from `notImportedKindCopyKeys`, and the kinds
  from `NOT_IMPORTED_KINDS` (`exchange/walk-state/walk-state.ts`): read the kinds there.
- **Settled records only, on the wallet Binance names.** Only a credited
  deposit and a completed withdrawal (`isCapitalSettled`) are
  imported. `walletOf` in `binance.transactions.ts` places each row by
  `walletType`: 0 or absent is Spot, 1 is Funding, any other value stops the
  walk (`capital-wallet-unknown`). The stop codes are the `BinanceWalkStop`
  codes (`exchange/walk/walk.ts`; the spec lists them): read them there.
  The wallet holding is found by `binanceKeyOf` (`binance.holding-keys.ts`) and,
  only for a row whose key is new, created at zero by
  `holdingsRepo.ensureExchangeHoldings` (insert-only); a row already stored keeps its
  holding, and one re-read while its wallet has no holding is left out of the write (it
  loses only the refresh of its own columns) instead of conjuring an empty holding. A new
  row whose wallet cannot be resolved even after creation stops `capital-holding-missing`.
  Earn gets no capital rows. The walks
  share this through `resolveWalletHoldings` (`exchange/walk/walk.ts`), which
  asks the exchange's walk config (`BINANCE_WALK_CONFIG`, `binance.walk-config.ts`) for
  the coin and default name of a missing key (`walletHoldingOf`, built from
  `partsOfHoldingKey` and `coinHoldingName`; no holding for a key that names none). Only
  the capital walk passes `createKeys` (`placeRows` in
  `binance.transactions.ts`): a wallet that only receives rows already stored
  elsewhere is not created as an empty holding. `placeWalletRows`
  (`exchange/walk/records.ts`), which places the rows of every walk except
  capital (Convert too, `binance.convert-history.ts`), passes none and so creates every
  missing wallet holding at zero, whatever its coin.
- **Pairing and untracked wallets.** A Convert pair id is
  `${accountId}:convert:<quoteId>` (one id over two coins, not built by `exchangePairIdOf`);
  a lone Convert leg carries `asset:<CODE>` (`untrackedAssetCode`), both in
  `binance.convert-history.ts`. Transfer and Earn legs share an
  `exchangePairId` (`binance.transfer-history.ts`, `binance.earn-history.ts`:
  read `pairId` there, built by `exchangePairIdOf` in `binance.holding-keys.ts`: BTC keeps
  the bare id, any other coin appends `:<COIN>`; capital and Pay build no shared pair id);
  each leg's `externalId` is the pair id plus the wallet,
  and `placeWalletRows` maps `counterpartWallet` to
  `exchangeCounterpartHoldingId`. A move to a wallet the app does not track
  carries `untrackedCounterpart` = `wallet:<TYPE>` (`UNTRACKED_WALLETS` in
  `src/transactions/untracked-counterpart/untracked-counterpart.ts`; migration
  `drizzle/migrations/0058_add_untracked_counterpart.sql`; the data-transfer
  decision is the 0058 `untrackedCounterpart` note on the snapshot version in
  `kiko-architecture`). The
  column holds a stored counterpart code, not only a wallet; the forms and parse rules are
  `parseUntrackedCounterpart` in that file. The demo seed rows carry a pair key, a counterpart
  key, `untrackedCounterpart`, `operation` and a comment (read
  `e2e/screenshot/seed/screenshot-seed.ts`). The label and the exclusion are in
  "Exchange/Convert legs" below (the `untrackedCounterpart` bullet); the name rule is in
  `kiko-translator`.
- **Idempotent via `(source, external_id)`.** Each row is
  `source: 'binance'` with `externalId`
  `` `${accountId}:deposit:<id>` `` / `` `${accountId}:withdraw:<id>` ``
  (the target account id, then Binance's own record id, falling back to the
  on-chain `txId`; `recordKey` in `binance.transactions.ts`), imported through
  `transactionsRepo.addManyDedup`. One on-chain transaction can carry two coins, so
  a non-BTC row keyed by the `txId` fallback appends `:<COIN>`; a BTC row keeps the
  bare `txId` every stored BTC row has, and an `id` is never changed. The
  account-id prefix is REQUIRED, not cosmetic: Binance record ids are only
  PER-ACCOUNT unique, so on the GLOBAL `(source, external_id)` index a bare
  `deposit:<id>` would let a second Binance connection's upsert refresh the
  first's row (see "Namespaced synced externalId" below). A re-sync refreshes
  rather than duplicates. The withdrawal `applyTime` is a UTC datetime STRING, NOT
  epoch ms — `parseWithdrawTime` pins it to UTC (a bare `Date.parse` would
  shift it by the device's local offset). Amounts convert through
  `rowMinorUnits(<coin>, …)` (see above); the withdrawal network fee is excluded from
  the ledger line. A capital row's description is the coin's ticker (`plannedRowOf`),
  so the name rule matches and the category-apply sheet
  appears; a stored description wins in `row-description.ts`. The other walks
  set theirs in their own files (`description` in `binance.transfer-history.ts`,
  `binance.earn-history.ts`, `binance.pay-history.ts`): read them there.

### Binance P2P

The P2P walk (`src/crypto-sync/binance/binance.p2p-history.ts`) differs from the other walks in
its order of reading and in how it fails.

- It runs FIRST in `runBinanceHistoryWalks`, before the capital walk, because its lane cap is its
  own share of the minute: running first reserves it (R1). Read the order in that function, never
  copy it.
- Each run reads the HEAD window first: `headFirstGroundOf`
  (`src/crypto-sync/exchange/walk/walk.ts`) makes the last `P2P_WINDOW_MS` before now the forward
  pass, moves `cursor` to the head start, and writes the ground from the old cursor (or the floor)
  to the head start as owed ground, in ONE write with `cursor` and `pending`. The owed ground is
  read NEWEST FIRST (`newestFirst` of `planWalkPasses`, P2P only, `newestWindowsFrom`).
- `rangeCursor` is reset to `BEFORE_EVERY_GROUND` only when
  `cursor === null || headStart - forwardStart > windowMs`. A gap of more than one window between
  runs counts as a jump on EVERY such run (R11), so a steady sync cadence of over 30 days restarts
  the rotation each run. Accepted debt; the fix would be a persisted once-mark (backlog).
- Failing-window rule (user Q1): a window whose page cannot be read must not block the windows
  after it. With G owed windows and R read per run, every other window is read within
  `ceil(G / R) + 1` runs. A budget-cut window's rest waits behind the older owed windows (R3). The
  bound is stated in the `walk.ts` docs and the spec; read it there.
- R4: P2P passes `readOnPastUnreadableForward` through `runBinanceWalkPlan` to `runWalkPlan`. An
  unreadable HEAD (forward) window does not end the run: the cursor stays at the head start, the
  owed ground is still read, and the run rejects at the end with the first error. Other walks are
  unchanged (off by default).
- `readFailedAt` mark on the `p2p` walk entry (`WalkMarks`,
  `src/crypto-sync/exchange/walk-state/walk-state.ts`; absent or malformed reads as none,
  unrepaired). It is written with the run time ONLY when the rejection comes after the walk marks
  were read (R7); a malformed state or a failed credentials read writes none. The next run that
  reads and resolves outside the cooldown writes `null`. A disconnect drops it with the other
  marks. A failed mark write never replaces the original error. The caption it drives is in "The
  P2P read-failure caption".

### Binance Transfer

The Transfer walk (`binance.transfer-history.ts`) imports the transfers of every tracked coin
between the user's own wallets on the same passes (see above), in 30-day windows
(`TRANSFER_WINDOW_MS`) within a 179-day floor (`transferFloorMs`). One window is one read per
transfer type (the series; `callsOf` counts them, `LANE_CALL_CAPS.transfer` in
`binance.history-budget.ts` caps the lane). A record imports only at `TRANSFER_SETTLED_STATUS`
(`binance.history-client.ts`, with the Earn constants). The legs of one move share a pair id from
`exchangePairIdOf` (`binance.holding-keys.ts`): the transfer id for BTC, and the id plus `:<COIN>`
for any other coin, since two coins can share one `tranId` and a delete follows the pair. A
record of an untracked coin lists its ticker only when it is settled; an unsettled one is counted
by its point and not listed, and a settled one with a blank asset is unreadable and owed. The
stop codes live in
`binance.transfer-history.ts`; the design is in the spec and plan named under "Binance Pay".
Convert differs: a settled SUCCESS record on an allowed wallet with a blank asset on either side
is refused for good as a `convert-unrecognized` not-imported entry, not owed; a 0 or negative
amount stays owed (`convert-amount-invalid`).
Read `settledOutcomeOf` in `binance.convert-history.ts`.

- **Transfer depth (Q3).** Binance refuses a `startTime` older than it keeps (HTTP 400, code
  -5026): the client throws `BinanceHistoryTooOldError` (the generic request-failed message), and
  `readSpan` never rejects the run for it. A span at or below the floor of now reads as empty
  (no call, nothing owed); any other span is read, in each type, from the floor of now or the
  start Binance serves that type, whichever is later, found by bisection
  (`exchange/walk/depth.ts`, `exchange/paging/paging.ts`) and
  remembered for that type (`createDepthMemories`: a memory per type, so a type that keeps less
  narrows only itself) with the clock it was served at. A search begins at the start another type
  is served from when one is known (`DepthGuard.hintMs`, `narrowFromHint`), which decides only
  which starts are asked first. The depth is assumed to move forward and never back, with no
  claim about its speed (spec probe item 17 is closed by measurement, see Transfer depth
  below; item 18, depth granularity, stays an open check). A read begins at
  `knownStartOf(memory, now)` (the start moved on by the elapsed time plus a margin), `now` read
  after the run gate, only while the start was served at most `DEPTH_EXTRAPOLATION_MAX_MS` ago;
  after that (`hasDepthLapsed`: a suspension) the start is found again by `narrowLapsedStart`
  between the start the memory holds and the one it would move on to. The margin doubles with
  each refusal up to `DEPTH_MARGIN_CAP_MS`; a refusal at the cap narrows upward from the refused
  start, and a new served start starts the margin over. The ground a read begins above (between
  the start the type was served from and the start the read begins at: its band) is read in the
  same span read, right after the type's own read (`readBand`, a narrowing call, paged and never
  halved): when Binance serves it, its rows join the type's rows and nothing is owed; when Binance
  refuses it (a depth that moves with the clock does), the weight readings or the lane's calls do
  not afford it, or its pages drift, it is owed in that type, as a range with a `series`
  (`SeriesSpan.owed`), not committed as read: the pending pass reads it in that type alone. A
  type stops at its `MAX_DEPTH_REFUSALS`-th refused read or its second lapse
  (76 requests at most for a span of 30 days), and a type the run's calls cannot narrow owes the
  span in itself alone; the other types commit and the cursor passes. The floor stays inside the
  depth probed. A span wholly below the depth costs the first type 2 calls (the refused read and
  the end) and each other type 1 (its end, asked before any read while another type was refused
  that end; a type holding a bound from an earlier span asks the end of the next one the same
  way). In the depth lane a type that narrows may spend the calls kept for the types after it,
  which are then owed in full without a request. The walk reads the owed ranges first
  (`runWalkPlan` `owedFirst`; `storePlannedList` stores the planned list before any pass) and
  keeps one read of the first forward window, of the re-scan and of the points for the later
  passes. A Transfer drift owes the span in the drifted type alone. The `exchangeHistoryPending`
  caption also shows while any walk owes a range, or a point owed for more than a day
  (`historyOwesRange`).
  A span read that narrows (a type is refused a start, finds its memory lapsed, asks the end of
  the span, or reads a band) draws its calls from the lane's narrowing calls first
  (`LANE_NARROWING_CALLS` in `binance.history-budget.ts`; `spanRunOf` in
  `exchange/paging/paging.ts`), and from the lane's cap (`LANE_CALL_CAPS`) after them; a span read
  that does not narrow draws the cap alone. Those two constants are the source of the call
  counts; the measured costs, the pacing times, the simulation tables that chose the narrowing
  calls and the first run's reach are in spec section 5 (read it there, do not copy a figure).
  The costs for a type that keeps less than 179 days are conditional (spec section 5, "Transfer
  depth, CLOSED BY MEASUREMENT"; spec item 17): the live probe of 2026-10-14 found every type
  keeping at least 179 days, so the walk reads from the floor and never narrows, and the
  speculative-read redesign stays in the backlog. A lapsed memory narrows only for a
  span the start it would move on to reaches into
  (`lapsedRangeOf`); a span above it is read from its own start. Every type asks its own band,
  whatever Binance answered for the band of another type (a depth in steps of a day can step
  between one type's band read and the next type's read). `canAfford` judges
  every narrowing call by the weight readings: a Transfer call weighs IP 1 and the gate allows 172
  requests a minute, so the walk adds at most 172 IP a minute. A band Binance refuses stays owed
  in its type and is read by a later run. Convert has no depth handling: a -5026 fails the run
  (as Pay); see `LANE_NARROWING_CALLS` in `binance.history-budget.ts`.

- **Transfer forward stops (O1; the Earn lane does the same with `EARN_FORWARD_OWES`).** A stop
  tied to ONE transfer with a usable time is owed at that transfer's own point and the forward
  pass goes past it
  (`TRANSFER_FORWARD_OWES`:
  `transfer-failed`, `-not-settled`, `-type-mismatch`, `-id-missing`,
  `-amount-invalid`, `-row-unreadable` with a `timestamp`, and the amount codes
  `AMOUNT_STOP_CODES`): the span's other
  transfers commit, the cursor moves on, the point stays owed until the
  transfer settles or the floor drops it. `commitSettledSpan` still stops the
  forward pass (R28) for any stop that owes more than a point: a row with no
  usable time (it owes the whole span), `transfer-page-drift`,
  `transfer-holding-missing`, a record outside the span. Pay and capital keep
  the A2 stop (every stop holds the cursor).

### Binance Earn

The Earn walk (`binance.earn-history.ts`) imports the Simple Earn history of every tracked
coin on the same shared walk (see above and "Binance Transfer"), in 30-day windows
(`EARN_WINDOW_MS`) from `EARN_FLOOR_MS`
(2022-01-01). One window is one read per record kind (`EARN_SERIES`: the flexible and locked
rewards first, then subscriptions and redemptions; `callsOf` counts them, `LANE_CALL_CAPS.earn`
caps the lane). It keeps the marks of `WalkMarks` (`exchange/walk-state/walk-state.ts`; read the
type for the list, never a copy) in its `earn` entry of `exchange_state`, among them the two
backfill marks `backfillCursor` and `backfillTurn`, reset by a disconnect
(`exchangeStateReset`). A test seeds or reads walk marks only through
`src/test-support/walk-marks.ts` (`walkStateFake`, `walkMarksOf`, `WalkMarkSeed`), never a raw
`exchange_state` literal; `binance-backfill-world.ts` is the shared world of the four backfill
walks, `binance-real-sqlite.ts` the real-database twin and `navigator-stack-probe.tsx` the stack
probe. An edit of one of these helpers is an edit of every pin on it. The stop codes live in
`binance.earn-history.ts`; the design is in the spec (section 6, the E matrix) and the plan.

- **A reward group is ONE record.** Binance gives a reward no id: the rows of a group
  (`rewardGroupsOf`: product, project or position, type, time, asset) are numbered from 0 by
  their minor units in the group's coin, ascending, so one member that cannot be trusted stops
  the whole group (a member left out would shift the numbers of the others and a later read
  would write a second row). Each coin is a group of its own. A BTC row keeps the key it always
  had (`...:<position>`); any other coin's key ends `:<position>:<COIN>`
  (`rewardGroupRowsOf`). A reward row the client could not read has no coin, so it blocks every
  reward group of its kind at that time, whatever its coin, with one point owed.
- **Settled status, per record kind (USER RULING 2026-10-13 (kept)).** A subscription
  settles on `SUCCESS` (`EARN_SUBSCRIPTION_SETTLED_STATUS`), a redemption on `PAID`
  (`EARN_REDEMPTION_SETTLED_STATUS`; a redemption is never `SUCCESS`); both constants, and the
  rule that a reward is always settled (it has no status), are in `binance.history-client.ts`.
  The same rule decides when a record of an untracked coin lists its ticker: only a settled
  one (a locked redemption `PAID` with `isComplete` false lists too, since an untracked record
  is never parsed). A settled record with a blank asset is unreadable and owed, never untracked,
  rewards included. `FAILED` is a final
  failure: ignored, nothing owed. Any other value (a pending status such as PURCHASING or
  CREATED, or an unknown one) is
  `earn-not-settled`, owed at its point, and so is a locked redemption whose `isComplete` is
  `false` (left out or `true`: no effect).
- **Placement.** Flexible `REALTIME` rewards go to the Earn holding, flexible `BONUS` and every
  locked reward to Spot. A flexible redemption goes to its `destAccount`. A locked redemption
  record has no destination field, so its `type` decides (USER RULING 2026-10-13 (kept)):
  `MATURE` ("redeem to Spot Wallet") goes to Spot; `NEW_TRANSFERRED`, `AHEAD`, any other type or
  none is `earn-redemption-type-unconfirmed`, owed at its point, no row (Q14: never an assumed
  wallet). A subscription imports from `sourceAccount` or the split only when its `type` is in
  its product's allowlist (`WALLET_FUNDED_SUBSCRIPTION_TYPES` in `binance.earn-history.ts`, one
  constant, per product; read the values there; USER RULING 2026-10-13 (kept; 24 extended));
  any other type or none is `earn-subscription-type-unconfirmed` the same way, because the money
  of a type outside the allowlist is not documented to come from the wallet `sourceAccount`
  names. A field
  the walk decides by (a split amount, those `type`s, `isComplete`) that is present with another
  JSON type is an unreadable row, never absent. These type points are permanent: Binance fixes a
  record's `type` when it creates it, so such a point never imports by itself; it waits for the
  user's answer or the probe (task 7/7) and stays owed meanwhile (the Earn floor never moves for
  it). Flexible `REWARDS` rewards and a reward that rounds to 0 satoshis stay stopped and owed
  (USER RULING 2026-10-13, Q25 = A: stays owed until the probe; decided after the probe).
- **Earn forward stops (USER RULING 2026-10-13 (kept).** The Earn forward pass
  follows the Transfer rule: a stop tied to one record with a usable time is owed at its own point
  and the cursor goes past it (`EARN_FORWARD_OWES`, one constant: emptying it restores R28 for
  every stop). A span stop (`earn-page-drift`, `earn-holding-missing`) and a row with no time keep
  R28.
- **Earn reads at the second (R36).** The Earn endpoints compare a record's whole-second `time`
  to each end of a read at the second, so a read of a span also returns a record in the second its
  start falls in. `settledEarnOf` hands `settleRecords` and `settleUnreadable` a `reach` (the span
  with its start floored to the second), used only to tell whether a record sits in the span: such
  a stuck record owes its own point, never the span, and the cursor is never held. The whole span
  owed for a stop with no point stays the real span. Earn only; the other walks read at the
  millisecond.

### Binance Pay

The Pay walk (`binance.pay-history.ts`) imports the Pay orders of every
tracked coin on the same passes as the capital walk (see above). Design: spec section 4
(`docs/superpowers/specs/2026-10-09-binance-pay-history-design.md`); plan
`docs/superpowers/plans/2026-10-10-binance-history.md`. Read the spec for the
stop codes and scenario rows.

- **The owed list.** Each walk keeps one list of owed ground
  (`pending` in its `exchange_state` entry, `walk-values.ts`): a range (no `kind`) or
  a point (`kind: 'point'`); the kind alone tells them apart. At most
  `MAX_PENDING_RANGES` ranges (`exchange/walk/walk.ts`; the two nearest
  merge); a point is never merged with, held by or dropped with a range;
  equal points are one, and keep the earliest `since` (the time of the run that
  first owed the point; see the lagging-history caption).
- **Canonical points.** `pointOf` (`exchange/walk/records.ts`) rounds the
  record's extent outward to whole milliseconds, one more on each side, so a
  request never sends a fraction; a record with no finite extent, or outside
  the read span, has no point. A withdrawal's extent reaches a second either
  way (`APPLY_TIME_PRECISION_MS`, `binance.transactions.ts`: `applyTime` may
  be cut or rounded to the second); never cut to the span.
- **The point-leave rule.** A point leaves only when a WINDOW read to its end
  holds all of it and returned a record whose own point equals it (a point
  window's progress across runs is the resume below), or by the floor.
  A read that returned nothing, only neighbours, or a span holding part of it
  keeps it. A range with no record leaves once read. A record is told by its
  point, not an id: a trusted twin at the same millisecond lets the point
  leave though the stuck record was never returned (a filter mismatch); spec
  VERIFY 14 is CLOSED (the filter field is `timestamp`; twins 0, mismatch 0),
  so the point does not need to carry the stuck record's identity.
- **Round-robin over points.** One point cursor per walk
  (`pointCursor`) holds the start of the point read last; it
  moves once a point read starts, finished or not. Each of P points is read
  within `ceil(P / L)` runs whose forward pass leaves a call (L >= 1, the
  points such a run reads). A malformed cursor is repaired at once and logged
  (`point-cursor-malformed`). The rotation is deterministic and bounded; a
  random or fail-closed-by-length rotation has no testable bound.
- **Round-robin over owed WINDOWS (R31) and span hints (R32).** One range
  cursor per walk (`rangeCursor`) holds the END of the window
  of a range read last; `planWalkPasses` builds the windows of all owed ranges
  first (oldest first), and the pending pass reads the windows that start AT OR
  AFTER the cursor first (`windowsFrom`), then wraps. This is the order for every walk but P2P: a
  walk that passes `newestFirst` (P2P only) builds the same windows newest first
  (`newestWindowsFrom`); read that function for its wrap rule. It rotates windows, not
  ranges: a range longer than a window whose first window is owed whole every
  run merges back and starts before the cursor, so a rotation over ranges
  reads that window every run and starves the ones behind it. `>=`, not `>`:
  the next window starts exactly at the cursor, and `>` skips every second
  window of a long range. The cursor moves once a window's read has started,
  finished or not. The windows owed for every coin and the windows owed to the
  backfill (`scope: 'backfill'`) are TWO groups, each a round-robin with its own
  cursor (`rangeCursor`, `backfillCursor`), and the backfill group comes after
  the other (S15-Q9). The run keeps the calls of one window for the backfill
  against the windows owed for every coin, and, when the budget fits one
  window alone, the first of those keeps none
  (S15-Q15). A budget of one window goes to the groups in turn
  (`backfillTurn`): the windows owed for every coin keep it while a read
  finishes its window, and the backfill gets it after a read that leaves its
  window owed (S15-Q16, S15-Q18: one window per turn, the turn given back after
  one backfill window). When the budget fits more than one window, every
  window owed for every coin holds the backfill's calls, the first included
  (S15-Q19). The bound of each group is stated in the `windowsFrom`
  doc (`exchange/walk/walk.ts`); read it there, never copy a formula. A pin of
  a group that a rule demotes proves the demoted group is still read (a
  starvation pin), not only the order. A malformed `rangeCursor` is repaired at
  once and logged (`range-cursor-malformed`); `backfillCursor` and `backfillTurn`
  have no repair: a malformed one reads as absent, and a disconnect drops them
  with the other run marks.
  One hints mark per walk (`spanHints`) holds, per pass (forward, pending, re-scan,
  point), the narrowest span a window was left at when `walkSpans` stopped
  before any span committed; a window whose start the hint HOLDS
  (`hint.start <= window.start < hint.end`, `holdsStart`) begins with what is
  left of it from its own start (never wider than the window), and it drops
  when a span of the window commits (for a point window it becomes a resume,
  below) or no window of the pass holds its start. A containment, not an equal
  start: the start of a re-scan window (`endTime - windowMs`) and the cut start
  of an owed range at a Pay or Transfer floor move with the clock every run, so
  an exact match would drop the hint every run and the halvings would restart
  forever. A point window takes only an exact start (its point never moves,
  and two points' windows overlap). A window that needs h halvings commits
  its first span within h + 1 runs of one read each, at any gap between runs
  (the properties run at 0, an hour and a day). A malformed value is
  ignored, stored over at once and logged (`span-hints-malformed`).
- **A committed span names the series it read.** `MarkAdvance.series`
  (`walk.ts`) is a REQUIRED key: a walk that sets `seriesOf` (Transfer, Earn)
  passes `series: window.series`; Capital and Pay pass `series: undefined`. An
  omitted series made a points-pass read cut owed ranges of every kind (Earn
  record loss).
- **A point window keeps its progress across runs (R34).** A point leaves
  the list only when its WHOLE window was read to its end, so a window left
  after some spans committed would start over every run. `walkSpans` reports a
  `resume` in the hint then (`BinanceSpanHint.resume`: `from` = the next
  span's start, `returned` = the points of the records the committed spans
  returned, `stuck` = the ground the untrusted ones owe, `series` = the series
  the window was read in, `scope` = the scope it was read in, so the ground it
  owes again stays the backfill's); `runWalkPlan` keeps it for the points list ONLY
  (the other passes keep progress in their cursor, list and re-scan mark; the
  parser drops a resume found in another list). The next run begins at `from`
  and folds `returned` and `stuck` into what it hands `onComplete`, so the
  point-leave rule above holds across runs. `hintsOfPlan` drops a resume made
  for other series than the window has now (`isHintOf`): it would skip ground.
  A malformed resume makes the whole value malformed (`span-hints-malformed`).
  A point window whose first span needs h halvings, one span a run, completes
  within 2h + 1 runs, while no later span comes back full (a later span that is
  too full halves again, one more run a halving).
- **STOP_ENDS_PASS and R28** (plan OVERNIGHT item 17).
  `STOP_ENDS_PASS` (`exchange/walk/walk.ts`) says a stop in the forward pass ends only that pass,
  so the run goes on to the owed ranges, the re-scan and the points;
  the cursor never passes a stuck record (but see the Transfer and Earn forward stops;
  Earn: `EARN_FORWARD_OWES`); a
  budget or rate limit ends every read.
- **R13.** Pay direction comes from the uid alone (`payDirection`): payer id =
  uid is out, receiver id = uid is in.
- **C1.** The Pay walk does not read the capital cursor (spec section 4).
- **Wallets.** Sends (R20, B5, B7): `walletType` 2 is Spot, 1 Funding, 5 Earn,
  any other stops `pay-wallet-unknown` (`walletOf`). Receives (R22, B6) are
  placed by DATE:
  before `PAY_RECEIPTS_TO_SPOT_FROM_MS` (2026-09-29T00:00Z) Funding, from
  then Spot. A receive's wallet fields describe the payer side, not where
  the receipt landed (user-confirmed 2026-10-13, 1 receipt checked).
- **Rows per coin.** A receive is one row in the order's own coin, when that
  coin is tracked (`sharesOfReceive`; its funds are the payer's and are never
  read). A send is one row per TRACKED coin its `fundsDetail` names, on that
  coin's wallet holding (`sharesOfSend`, `fundsToPlace`); an order in coin X paid
  with Y gets Y rows and no X row, and its `comment` names the order amount and
  code (`crossCoinNoteOf`). A funds coin that is not tracked has no row. The
  key of a BTC row of a BTC order is the one it always had; any other row
  appends `:<COIN>` (`rowKeyOf`).
- **Exact sums, one rounding.** The costs of a wallet add up as exact decimal
  text and round ONCE, never per cost (`costsOf`, `sharesFromCosts`): the
  wallets are taken in ascending `walletType`, each share is the step the
  rounded running sum takes at it, so the shares add up to the rounded total at
  any scale, and a share that rounds to 0 units has no row. Every cost and every
  funds entry is refused if negative (`addNonNegative`, `pay-amount-invalid`: a
  sign error, never dust), and the text of each entry is parsed on the costed
  path too, so an unparseable or over-precise entry stops there as well.
- **Dust.** An order whose own amount rounds to 0 units at its coin's scale
  imports no own-coin row, lists nothing and does not stop the walk; an amount
  that is no plain decimal still stops. This covers only the own-coin row: the
  funds rows of ANOTHER tracked coin beside a dust amount import as for any
  send, and funds of the own coin above dust stop `pay-split-mismatch` when all
  the funds are in the own coin, whatever their cost shape (`sharesOfCoin`,
  `ownUnitsOf`). A dust order with mixed-coin funds imports each coin's rows.
- **An untracked order is counted, never parsed, and its listing follows its
  direction.** `readPayItem` (`binance.history-client.ts`) reads an order
  strictly only when its own coin or a coin of its funds is tracked; any other
  order is in `untracked` with its tickers and the direction of its amount's
  sign (`directionOfAmount`: `in`, `out`, or none for zero or no number).
  `untrackedTickersOf` (`binance.pay-history.ts`) lists the own coin on a
  receive and, only for a send (the uid for an order read strictly, the sign for
  an untracked one), also the coins of its funds, since the funds of a receive
  are the payer's and the user never held them. An order with no direction
  lists its own coin only. For an untracked order only a funds ENTRY with a blank
  or non-text currency, or one that is no object, is unreadable (owed at its
  point, never listed); an absent or non-array `fundsDetail` is counted.
- **Announcement.** Binance's January 2027 Funding -> Spot auto-migration:
  https://www.binance.com/en/support/announcement/detail/01cbe42ead1e4f1a9382363754d2eb5a
  (source checked 2026-10-11). The 2026-09-29 Spot-from-date comes from a different
  announcement (spec), which needs its own check date.
- **Open probe items** (item 17, Transfer depth, is closed by measurement; range-end semantics
  per endpoint, the withdraw filter field and `applyTime` rounding, late Pay orders, the
  migration's transfer history shape): the spec's "VERIFY gate" and the plan's probe items list
  them.
- **Disconnect and carry** are the capital rules above: the balance sync
  carries the cursors, lists, point cursors, range cursors and span hints;
  disconnect resets them.
- **Delete notice.** A same-currency linked transfer's confirm uses
  `transactions.deleteLinked.transfer`, `.transferUnlinked` and
  `.transferUnlinkedPlain` (`src/transactions/remove-notice/remove-notice.ts`).

### Namespaced synced externalId (multi-account correctness)

The `(source, external_id)` unique index (`transactions_source_external`,
`src/db/schema.ts`) is GLOBAL — one keyspace shared across EVERY connection of
every provider. The multi-account plan lets a user connect more than one
Monobank and more than one Binance account, so a SYNCED row's `externalId` is
namespaced by its holding's account id: `` `${accountId}:${sourceId}` `` —
`` `${accountId}:${statementId}` `` for Monobank (`mapStatementItem`,
`src/monobank/`) and `` `${accountId}:deposit:<id>` `` /
`` `${accountId}:withdraw:<id>` `` for Binance
(`src/crypto-sync/binance/binance.transactions.ts`). Without the prefix, two
Binance connections — whose deposit/withdrawal record ids are only PER-ACCOUNT
sequences, NOT globally unique — could each emit the same `deposit:<id>`, and
the upsert would refresh the WRONG connection's row. Monobank statement ids are
globally unique, so its rows never collided, but they carry the same prefix for
one consistent shape. The write-time key and migration `0029`'s backfill produce
the IDENTICAL string (`account_id || ':' || external_id`, joining
`transactions.holding_id -> holdings.account_id`, idempotent behind a
`NOT LIKE account_id || ':%'` guard), so a re-sync of a pre-migration,
then-backfilled row matches in place — no duplicate insert. A `manual` row has a
null `externalId` and is never namespaced.

## Exchange/Convert legs: a structural marker, a resolved label

An Exchange/Convert leg is NOT identified by its description. Both legs
carry the counterpart holding's id in a dedicated column — read
`src/db/schema.ts` (`transactions.exchangeCounterpartHoldingId`, whose
comment records why it is a column rather than a reserved `category`
value or a shared `externalId`) and `src/transactions/`
(`recordExchange` / `recordExchangeCounterpart`, which write it on both
legs inside the one transaction; an exchange into a term deposit writes
the marker on its single debit leg). The legs of one Exchange or Convert also
share `transactions.exchangePairId`, written beside the marker, which is what a
delete follows to the other legs (the existing row of a Convert gets the pair id
always, and the marker only when it is manual or imported and carries none; see
kiko-domain's "Deleting a movement takes its other parts"). Three consequences hold together:

- The marker is what the spending view excludes on, in the
  exchange-exclusion module (`src/statistics/`): no other rule can see these
  rows — a null `mcc`, an empty description, and a cross-currency pair
  the matched-pair matcher rejects. The marker rule (`exchangeExcludedTransactionIds`) reads ONLY
  `exchangeCounterpartHoldingId` and `untrackedCounterpart` (`exchange-exclusion.ts`). A
  category rule can re-categorize a leg (user ruling B, 2026-10-25); spending still excludes it
  by its marker. A row with only `exchangePairId` (a synced bank debit a Convert marked) has no
  marker, and the pair rule beside it (`sameCurrencyMoveTransactionIds`, same file, run over the
  unfiltered ledger) takes it out of spending only when it and a row of its own pair id are equal
  and opposite in one currency on two holdings (user ruling 2026-10-31 Q1 = A; it restores the
  1.2.0 result). A synced debit a Convert sent into ANOTHER currency still counts as spending
  (user ruling M-1 = A, 2026-10-25), and so does a same-currency move whose amount differs; a
  rule may move either between slices with the total unchanged.
- A P2P / card / fiat-deposit purchase row carries no `exchangeCounterpartHoldingId`; its
  `untrackedCounterpart` code is its marker, so this rule leaves the row itself out. Its
  funding BANK debit is a separate row and leaves spending through the funding matcher
  (`src/statistics/exchange-funding-match/`). The matcher (`exchangeFundingMatches`) removes a
  bank debit only once its P2P order row is imported, so the P2P walk order (P2P first, head
  window first, newest first behind it) decides WHEN a P2P-paid debit leaves spending; until the
  order is read, the debit counts as spending.
- **The repository never writes a description for a leg.** The label is
  resolved at render time through `t`. `transactionRowDescription`
  (`src/transactions/row-description/`) applies the ordered steps its JSDoc lists in
  `row-description.ts`: read the order there, never from this skill. Pair legs take
  their label from `exchangeLegDescription` / `transferLegDescription`
  (`src/transactions/exchange-description/`); wallet names are proper nouns kept in code,
  not in i18n. Same-currency legs,
  including manual ones, read 'Transfer', not 'Exchange'. The caller supplies
  `holdingNameById` and `holdingCurrencyById`, both built from the holdings live
  query. A persisted sentence stayed English after a language switch and went
  stale after a rename; that is the bug the column exists to prevent.
  `ruleDescriptionOf` (`src/transactions/row-description/rule-description.ts`) is
  the second reader of a blank row's label, for category-rule matching.
- `transactions.untrackedCounterpart` (0058, nullable) holds a stored counterpart code for
  a leg whose other side the app does not track: a wallet, an asset, or a P2P, card or bank
  fiat. The forms and parse rules are `parseUntrackedCounterpart`
  (`src/transactions/untracked-counterpart/untracked-counterpart.ts`); an unknown code,
  such as an `asset:` code with a `:` in it, parses to nothing. The exchange-exclusion module
  also excludes these rows from spending (read
  `src/statistics/exchange-exclusion/`). The column is insert-only: it is not in
  `BANK_OWNED_TRANSACTION_COLUMNS` (`src/transactions/repo/transactions.repo.ts`).
- `transactions.operation` (0063, nullable) is the exchange operation code of a row. It is
  insert-only (not in `BANK_OWNED_TRANSACTION_COLUMNS`) and is not a rewrite guard field
  (`REWRITE_GUARD_FIELDS` in `src/categories/category-rules/plan-rule-rewrite.ts`). It is read
  only for the Trading fee label and is never a statistics input.
- **The 2-minute same-amount matcher sees only unmarked rows.**
  `rowsForTransferMatch` (`src/statistics/internal-transfers/internal-transfers.ts`)
  drops every row that carries `exchangePairId`, `exchangeCounterpartHoldingId` or
  `untrackedCounterpart` before `internalTransferTransactionIds` runs
  (called in `src/statistics/spending-ledger/spending-ledger.ts`). A row with any of the three
  is an exchange leg that the marker
  rule or the pair rule excludes (a cross-currency or unequal pair-id-only debit, which neither
  rule takes, counts as spending by the rulings above); left in the matcher's ledger it could be
  matched as the partner of an unmarked same-amount row (a Pay send) and drop real spending. The
  pair rule pairs only rows of one pair id, never by time, so it cannot consume an unmarked row.
- **`transactionRowDescription` is the ONE owner of a blank row's label.**
  Every surface that shows it calls it: both lists, `ExampleTransaction`,
  and the transaction form. On an edit, the form pre-fills a blank
  stored description with that label as the field VALUE (and previews it
  as the placeholder once cleared); Save stores `''` when the text still
  equals the pre-filled label, and the typed text otherwise — so an
  untouched leg keeps resolving at render time. A direct
  `defaultTransactionDescription(` call outside
  `src/transactions/row-description/` (or the helper's own folder)
  skips the exchange, transfer and untracked branches, and is denied by the
  `kiko-no-direct-default-transaction-description` Semgrep rule.
- A repository input therefore carries holding IDs, never holding
  display names, for an exchange.
- **Convert's counterpart never lands on a synced holding.** The
  counterpart picker (`resolveConvertView` in the transaction form)
  excludes every synced/syncable holding — a sync already owns that
  holding's balance, and the counterpart is a NEW manual leg `save`
  writes. `recordExchangeCounterpart` (`src/transactions/repo/`) enforces
  the same rule again, in depth, inside the write itself: it re-reads the
  counterpart's own holding+account INSIDE the transaction and throws
  rather than trust a caller-supplied flag, since the write is reachable
  directly, not only through the picker.

## Bybit balance sync — notes, set-aside coins, cooling

Status: set 4 of 1.4-bybit; the history walk of set 6 can extend this section. The code is in
`src/crypto-sync/bybit/`; read it there and copy no list from here.

- The provider (`bybit.provider.ts`) returns state patches. Patch kind `balanceNotes`
  (`src/crypto-sync/exchange/walk-state/exchange-state-patch.ts`, `withBalanceNotes`): a good read
  of a wallet replaces that wallet's entry whole. A failed FUND read keeps the entry and adds
  `refused` (key permission) or `notRead` (any other cause); only a later good read clears it.
- `balanceNotesOf` (`src/crypto-sync/exchange/history-status/history-status.ts`) returns entries
  as `{wallet, coin}`, so a note always names its wallet.
- A tracked UNIFIED coin with a loan, with `locked` above zero, or with a field that is not
  decimal text is set aside: its holding is never written and never zeroed
  (`bybit.balance-read.ts`).
- A Bybit balance read never writes the `oversizedBalance` patch; a coin that does not fit is
  `refused` in its note.
- Cooling (`fetchBalances` in `bybit.provider.ts`): an account with a stamped Bybit holding skips
  silently and keeps its balances; any other account fails with `bybitCoolingFailure`
  (`bybit.failure-text.ts`). A kept holding with no stamp does not count.
- A provider failure throws. `sync.ts` reads an empty answer as success, so an empty return can
  hide a failure.
- Past-line mark: a Bybit balance is dated by its last read (`balanceReadAt`), and a read lists
  the rows it overwrote (`overwrittenRowIds`). A row on that list moves no balance when the user
  edits or deletes it. Read `datedBalanceSourceOf`, `isOverwrittenRow` and `datesBalanceOf` in
  `src/holdings/holding-metadata/holding-metadata.ts`; copy no list from here.

## Crypto re-sync request

A re-sync of a connected crypto account carries no address: `resyncRequest`
(`src/crypto-sync/resync-request/`) builds the request for both the account-detail "Sync now" and
the Home pull-to-refresh fan-out; never build a second re-sync shape.

## Registry pointer

The provider registry (`bankProviderRegistry`, and `exchangeProviderRegistry` in
`src/crypto-sync/exchange/registry/`, the crypto twin that `syncJobsFor` skips when a crypto id is
unwired) is described in kiko-domain's "Bank catalog and provider registry"; read it there.
