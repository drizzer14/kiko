# Crypto exchanges 1.3-a, change set 11: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `crypto-exchanges-1.3-a task 11/15` (trades 2/2): the `myTrades` reads on a `trades` lane, order
aggregation with the `orderId` + `fromId` re-read (P15b PASS), rows with the fee rules (R-Q13, C-NR2, C-NR5), the
trade walk wired last in `runBinanceHistoryWalks`, and the measured run report.

**Architecture:** one new walk file `src/crypto-sync/binance/binance.trade-history.ts` (`syncBinanceTradeHistory`),
modelled on `binance.dust-history.ts` (deps object, cooldown first, `placeWalletRows`, `addManyDedup`,
`historyListWriterOf`). It drives set 10's `readSpotSymbols`, `touchedCoinsOf`, `tradeCandidatesOf`,
`planTradeSymbolReads`, `runTradeSymbolReads`, `tradesPatchesOf` (`binance.trade-symbols.ts`) and `readIdCursor`
(`exchange/paging/id-cursor-pager.ts`). Per-symbol progress goes to the `trades` part of `exchange_state` through
the existing patch kinds (`tradeSymbol`, `tradesRotation`, `tradesBalanceSnapshot`). Trades stay no walk (no
`WALK_IDS`, `CAPTION_WALKS`, `NOT_IMPORTED_KINDS` member); the caption rule K6 is set 15's.

**Tech stack:** React Native, op-sqlite + Drizzle, Jest (`fast-check`), fnts `maybe`/`Either`, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: section 11 row 11/15; section 5 table rows
"Spot trades", "Order fills", "Symbol list", "Measured weights" (`myTrades` 20, with `orderId` 5 / 5) and the
per-run paragraph ("Set 11 measures a caught-up run and a backfill run"); section 5 "### Spot trades (R-Q11,
R-Q13, C-NR2)" (discovery, rotation, cursor, reserved call, snapshot rule, error policy G2-A, F2, paging, orders
and later fills, re-read bound, hold, rows, one side untracked, keys); section 6 "Mapping and statistics per
operation" (Spot trade rows); section 7 T1-T12b, T14 and TS/TR/TP; section 12 P1, P2, P2b, P3, P15, P15b.
Rulings (`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`, main checkout): R-Q11, R-Q13, C-NR2 ... C-NR7,
R-Walk A, S9-Q2 (zero-unit leg), PAY m2 B (dust own amount), S10-Q1 ... S10-Q6, G1-A/B/C, G2-A/B/C, FR-Q1.
Questions S11-Q1 ... S11-Q8 are at the end; the plan assumes each recommendation.

**Base:** branch `binance-set11` at main `3d0df6d4` (sets 1-10 merged). Every code fact names a symbol or anchor
text. **The developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Test names and comments carry no
  scenario id, ruling id or history text; the commit message carries them. Tests never read `src` text.
- G-2 A pin a behaviour change moves is updated in the same step (table "Pins this set changes"), retitled to
  state the new rule; never in a fix round.
- G-3 Full-word identifiers; imports through `@kiko/<feature>` barrels; every new export has a consumer at its own
  commit (knip still flagging it: stop and report, never an ignore).
- G-4 No migration, no new index, no `.kiko` change (`EXPORT_VERSION`, `VERSION_DECISIONS` unchanged), so no
  migration review. The new prefix query reads the existing `transactions_source_external` unique index; step 6/12
  pins it with an EXPLAIN QUERY PLAN test anyway. Stop and ask if a migration appears.
- G-5 Safe tip. Steps 3/12-8/12 add code with no production caller (dormant, as set 10). Step 9/12 wires it; from
  then trades import as rows on the Spot holdings. Main is not released before all 15 sets (spec "Release rule";
  U1: no device deploy until all Binance sets are done), and each step's tip passes on its own. Guideline 2.5.19:
  no flag, no `SHOW_*`/`HIDE_*` control, no hidden UI; the rows render with set 7's labels
  (`transactionRowDescription`: `operation = 'trade'` legs, `transactions.tradingFee` for `'trade-fee'`), and the
  demo `.kiko` already holds a trade pair, its fee row and an `asset:PEPE` trade (set 7), so a reviewer reaches
  each row kind. Notes for Review stay set 15's. No copy change (en or uk), no i18n key, no translator review.
- G-6 Lanes: `trades` cap `LANE_CALL_CAPS.trades = 100` (spec start value), no narrowing calls; costs
  `COSTS.myTrades = { api: 20 }`, `COSTS.orderFills = { api: 5 }` (spec "Measured weights"), judged against
  `API_IP_BUDGET_1M`. A held order's re-read and a later-fill re-read share the lane. The cap changes only on the
  probe 9 numbers (S11-Q2). No P2P lane exists before set 12, so set 11 cannot raise its cap (R-Walk A moves to
  set 12, stated in the spec in step 10/12).
- G-7 Ids: `id` and `orderId` are safe integers (probe 8, P2b); the pager checks `id`; the walk checks `orderId`
  with `Number.isSafeInteger` and a failure is a page parse error. Never a rounded or text cursor.
- G-8 Amounts: per order, sum each field's TEXT exactly with `addDecimal` (`@kiko/currency/decimal`) over the
  fills, then convert once with `rowMinorUnits` (`exchange/walk/records.ts`). Never a float, never a per-fill
  rounding (a reduced-scale coin rounds once per order).
- G-9 Never rely on an unmeasured answer shape (set 10 lesson; probe 8 measured only the id types on BTCUSDT):
  the client reads every `myTrades` field strictly (a wrong type fails the page); step 4/12 quotes Binance's doc
  and the probe 9 output before code.
- G-10 Typed error per class (set 10 lesson 3); every sent request is recorded against its lane, a rejected one
  with `failedCallWeights` (FR-Q1); every property has a per-run thrower (set 10 lesson 5).
- G-11 Point skill and spec text at constants (`LANE_CALL_CAPS`, `COSTS`, `TRADE_MAIN_QUOTES`), never a copied list.
- G-12 Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.
  `bash scripts/checks/dup.sh <file>` alone on each new or grown test file. Writes to `src/` and `docs/` only with
  Edit/Write (no `sed -i`, heredoc or python one-off). After any `biome check --write`, run
  `node scripts/checks/import-order.js <file>` on that file (gap set9/3).
- G-13 Do not edit `binance.convert-history*.test.ts` or `binance.dust-history*.test.ts` (survivor-triage track).

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-22)

- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks the institution, not the connection): LEFT
  OPEN; the trade patches go through `patchExchangeState` and inherit the same gate, no worse.
- `20261021T1839-kiko-binance-set9/1` (unreadable state names never logged): LEFT OPEN; set 11 adds no state part.
- `20261021T1839-kiko-binance-set9/2` (repeated `row-precision-rounded`): LEFT OPEN, and set 11 adds to it: an
  order of a reduced-scale coin logs once per re-read (G-8 rounds once per order, not per fill). The review names
  the count on UA-1 (BTCUSDT only: BTC and USDT are not reduced, so 0).
- `20261021T1839-kiko-binance-set9/3` (`import-order.sh` multi-path): LEFT OPEN; G-12 routes around it.
- `20261015T1657-kiko-binance-backfill-fix/2` (no mechanized keyed-lookup index check for migrations): LEFT OPEN
  (migrations only); step 6/12 adds an EXPLAIN QUERY PLAN pin for the new non-migration prefix query.
- `20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`, `20261018T1637-kiko-harness-h9/2`
  (TIMEOUT-HEAVY fan-out): LEFT OPEN; `transactions.repo.ts` and `sync.ts` are widely imported, so step 12/12
  applies the gate rerun rule.
- `20261017T2005-kiko-harness-h8/6` (no live TIMEOUT-HEAVY rerun proof): LEFT OPEN unless this gate meets one.
- Every other open gap (harness, kill-guard, Duo, iPad, account-currency): LEFT OPEN, unrelated.

## Decisions this plan makes (assumed; S11-Q* confirm)

- Walk order: the trade read runs LAST in `runBinanceHistoryWalks`, after dust, in its own
  `logOnFailure('[binance sync] trade history failed', ...)` on the shared `run` (spec section 5 order; sets 12's
  P2P and fiat walks go before it). The "Last" comment moves from dust to trades.
- Balance texts (F2, S11-Q1 A): the Spot read in `binanceProvider.fetchBalances` returns
  `spotBalanceTexts: Record<ticker, '${free}/${locked}'>` (texts as Binance sent them, `binanceTickerOf` keys, every
  asset of the Spot body); `ProviderRead` and `BalanceSyncResult` carry it optional; `runBinanceSyncAndImport`
  passes it to `runBinanceHistoryWalks` and on to the trade read. The read is taken before every walk, so before
  the trade reads. No texts (a cooldown read returns `{ balances: [] }`): the trade read does not run.
- Rate limit: a 418/429 on `exchangeInfo`, `myTrades` or an order re-read sets `setBinanceCooldownUntil(account,
  now + retryAfterMs)` after the progress is written (rotation, snapshot of finished coins, the symbol entry) and
  ends the read cleanly, as the dust read does. Every other run-stopping error writes the progress, then rethrows
  for the caller's log line.
- Symbol failures (S11-Q6 A): `BinanceWalkStop` joins `isSymbolFailure` (`binance.trade-symbols.ts`): an amount
  the parser refuses, a page with an unreadable row, an order whose fills mix `isBuyer`, an unsafe `orderId`
  each end that one symbol `failed` (G2-A). The walk logs each `symbolFailures` entry once with the fixed tag
  `[binance sync] trade symbol failed` (`logFailure`: name and code, never a symbol, id or amount), and writes an
  `amount-too-large` coin to `oversizedCoins.history` before any row (dust precedent).
- Reads: `GET /api/v3/myTrades?symbol&fromId&limit=1000` (signed, `trades` lane, `COSTS.myTrades`); the order
  re-read `GET /api/v3/myTrades?symbol&orderId&limit=1000`, plus `fromId` from page 2 on (`COSTS.orderFills`). Both
  through `readIdCursor` with `failedCallWeights` = no weights, `idOf` = the row's `id` as sent.
- Imported earlier: `transactionsRepo.importedOrderPrefixesQuery('binance', prefixes)` returns the prefixes
  `${pairId}:` that have a stored row (range `external_id >= '${pairId}:' AND external_id < '${pairId};'`), one
  query per page, read BEFORE the page writes.
- Per page (`onPage`), fills grouped by `orderId` in id order:
  - an order re-read this run: a fill with id at or below the re-read's last fill id is skipped; a higher id stops
    the symbol at that fill (`{ stopAt: id }`, no `heldOrderId`; T11b);
  - an order imported earlier: re-read whole (at most once per run); a re-read that ends `budget` stops the symbol
    at that order's first fill in the page and stores `heldOrderId` (T11);
  - any other order: written from the page's fills.
  Only fills below a stop fill are written. Rows first (`placeWalletRows` + `addManyDedup`), then the
  `tradeSymbol` patch with the page's cursor (crash: the page is read again; keys dedupe and the prefix lookup turns
  the order into a re-read).
- Page boundary (S11-Q3 A): an order cut by a page boundary is written from the fills seen; its next fill, in the
  next page of the same run or a later run, finds it by the key prefix and re-reads it whole (one `orderFills`
  call). Spec text "pages on before it is written" is aligned in step 10/12.
- Held symbol (priority `held`, `keep: 1`): re-read the held order first; `budget` again leaves it held; else write
  it, patch `{ fromId: stored, no heldOrderId }` (the key deleted), then the id cursor from the stop fill with the
  once-per-run rule.
- End of a symbol read: the entry is written `{ fromId: nextFromId }` (0 when the read found no trade), so a read
  symbol never stores null.
- Rows per order (Spot wallet, `holdingKeyOf(coin, 'spot')`): spent = sum `quoteQty` (buy) / `qty` (sell) plus
  every commission in the spent coin, negative; received = sum `qty` (buy) / `quoteQty` (sell) minus every
  commission in the received coin; one fee row per third commission coin, `-sum`. Time = the order's lowest-id
  fill `time`. `description: ''`. Legs `operation = 'trade'`, fee `'trade-fee'`.
- Markers: both coins tracked: a pair (`exchangePairId = pairId`, each leg's `counterpartWallet` the other). One
  coin untracked: the tracked leg alone, `untrackedCounterpart = asset:<CODE>`, no `exchangePairId`. Fee row of a
  tracked third coin: `exchangePairId = pairId`; `counterpartWallet` = the received leg's wallet when the received
  coin is tracked, else `untrackedCounterpart = asset:<received>` (C-NR5). An untracked third coin: no fee row,
  ticker to `untrackedCoins.history` (T4). Both legs untracked (S11-Q4 A): no leg, both tickers listed, a tracked
  third-coin fee row in the C-NR5 form. A leg that rounds to 0 units (S11-Q5 A): neither leg; a non-zero fee row
  still imports; no stop.
- Keys (memory "exchange ids are per coin key"): pair id `${accountId}:trade:${symbol}:${orderId}`. Binance's
  `orderId` is unique per symbol and the symbol names both coins, so the pair id is already per order and per coin
  pair; no `:<COIN>` suffix. Legs `${pairId}:${walletKey}`, fee `${pairId}:fee:${walletKey}`; the wallet key holds
  the coin, so each row key is per coin. The property asserts each key once and one currency per row key.
- Per-symbol calls (S11-Q12 A, 2026-10-23): the walk result is `{ imported }`. `callsBySymbol` and `countedRunOf`
  were deleted (no production reader); the tests count `trades` calls in their fakes.

## Scenario matrix (each row is a Jest case)

Spec T rows (was: not imported; exact parity in minor units; statistics through `exchangeExcludedTransactionIds`):
T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T11b, T12, T12b, T14 as written in spec section 7. New rows (no trades
code ran before, so "was:" is "no trade read" unless a value is given):

| # | Input | Result now | was: |
|---|---|---|---|
| TC1 | `fetchMyTrades('BTCUSDT', 0)` | signed `GET /api/v3/myTrades` `symbol`, `fromId=0`, `limit=1000`; `usedApiWeight1m` from `X-MBX-USED-WEIGHT-1M` | - |
| TC2 | `fetchOrderFills('BTCUSDT', 7, 0)` then `(.., 7, 1201)` | page 1 `orderId=7`, `limit=1000`, no `fromId`; page 2 adds `fromId=1201` | - |
| TC3 | body not an array; a row with `qty`, `quoteQty`, `commission` not text, `commissionAsset` not text, `isBuyer` not boolean, `time` or `orderId` not a safe integer | `BinanceHistoryParseError` (whole page) | - |
| TC4 | HTTP 429 / 418; code -1121; HTTP 500 | `BinanceRateLimitError`; `BinanceInvalidSymbolError`; request failure | - |
| TW1 | the arm run | trade read after dust, same `run`, with the Spot texts; malformed state: not run | dust last |
| TW2 | cooling down; no credentials; no Spot texts; `exchangeInfo` lane refused | no request, `{ imported: 0 }` | - |
| TW3 | 429 on the 3rd symbol's page 2 | page 1 rows and its cursor written; rotation and snapshot patches written; cooldown set to `now + retryAfterMs`; resolves | - |
| TW4 | 429 on `exchangeInfo` | cooldown set; no `myTrades` call | - |
| TW5 | symbol A throws -1121, B a parse error, C an amount past the safe integer | A, B, C `failed`, one log line each (fixed tag); C's coin in `oversizedCoins.history` before any row; D read | - |
| TW6 | `addTransactions` rejects on a page | no cursor patch for that page; the progress before it written; the error rethrown | - |
| TW7 | an order cut by a page boundary (3 fills page 1, 2 fills page 2) | written from 3 fills, then re-read once by `orderId` and rewritten from 5 | - |
| TW8 | commission in BNB on fills 1-2, in the received coin on fill 3 | BNB fee row `-sum(1,2)`; received leg net of fill 3's commission | - |
| TW9 | both legs untracked, BNB fee | no leg; both tickers listed; BNB fee row `asset:<received>`, `exchangePairId`, `trade-fee` | - |
| TW10 | a leg that rounds to 0 units; with a BNB fee | neither leg; BNB fee row imports; no stop | - |
| TW11 | an order re-read of 2500 fills | 3 `orderFills` calls (`floor(f / 1000) + 1`), 15 weight | - |
| TW12 | a held symbol on a lane of 100 | at most 99 `trades` calls for it (counted in the test's fake, S11-Q12) | - |
| TW13 | a never-read symbol with no trade | entry `{ fromId: 0 }` | - |
| TW14 | Spot body `{asset:' usdt ', free:'1.0', locked:'0'}` | `spotBalanceTexts.USDT = '1.0/0'` | no texts |
| TW15 | the prefix query | EXPLAIN QUERY PLAN uses `transactions_source_external` with a range on `external_id`; `...:12:` does not match `...:123:` | - |
| TW16 | property, clock gaps 0 / 1 h / 1 day between runs: random symbols, orders and fills, fills added to open orders between runs, random lane cap and page limit, a per-run thrower symbol, random 429s | once no new fill arrives and enough runs pass: every order of every non-failing symbol stored once per key with the exact aggregate; no fill lost or counted twice; no `heldOrderId` left; one currency per row key; at gap 0 a 429 skips the next run (cooldown) | - |
| TW17 | `/api/*` weight at the caps | `LANE_CALL_CAPS.trades x COSTS.myTrades.api + COSTS.exchangeInfo.api <= API_IP_BUDGET_1M` | - |

## Pins this set changes ("was:" values)

Floor; the developer greps `LANE_CALL_CAPS`, `LANE_NARROWING_CALLS`, `COSTS`, `Record<BudgetLane`,
`invocationCallOrder`, `walkRunCounts`, `fetchBalances` result `toEqual`, and `syncedHoldings` in every test file.

| Pin | File, test | Now | was: |
|---|---|---|---|
| P1 | `binance.history-budget.test.ts` "holds the per-run call cap of each lane" | `trades: 100` | no lane |
| P2 | same, "holds the narrowing calls of each lane: only the Transfer lane has any" | `trades: 0` | no lane |
| P3 | same, "holds the Binance ceilings and per-call costs of the old withdraw rule" | `myTrades { api: 20 }`, `orderFills { api: 5 }` | no cost |
| P4 | `run-crypto-sync.test.ts` "runs the walks in order, capital, Pay, Transfer, Earn, Convert, then the dust read, ..." | retitled "... the dust read, then the trade read ..."; trades last, with `spotBalanceTexts` | dust last |
| P5 | `run-crypto-sync.test.ts` `walkRunCounts` ("a walk state this build cannot read") | includes the trade read (0) | six reads |
| P6 | `binance.provider*.test.ts` exact `fetchBalances` results | add `spotBalanceTexts` | absent |
| P7 | `sync.test.ts` `toEqual({ syncedHoldings: 1, exchangeState })` | passes `spotBalanceTexts` through | absent |

## Files (measured floor; the developer measures the real list)

Planned: about 20 files with tests. Mutable source files (`mutable_source_files` in `scripts/checks/mutation.sh`;
`index.ts`, tests, `-test-fixtures.ts` excluded), estimate 9 at least, cap 30:
`binance/binance.trade-history.ts` (new), `binance/binance.history-client.ts`, `binance/binance.history-budget.ts`,
`binance/binance.trade-symbols.ts`, `binance/binance.provider.ts`, `crypto-sync/provider/` (the `ProviderRead`
file, type only), `crypto-sync/sync/sync.ts`, `run-crypto-sync/run-crypto-sync.ts`,
`src/transactions/repo/transactions.repo.ts`. Spec row 11/15 said about 6. No split needed; above 30: stop and
split. The number that counts is `KIKO_MUTATION_BASE=3d0df6d4 make mutable`.

---

### step 1/12: the set 10 survivors in the trade symbols (may move to the survivor track if the coordinator says so)

Files: `src/crypto-sync/binance/binance.trade-symbols.test.ts` (test only).
- [ ] Test "lists the candidates ascending whatever order the listing sends them in": a listing in descending
      order and one interleaved (for example ETHBTC, AAAUSDT, BTCUSDT, BNBBTC), expecting ascending. Prove it
      load-bearing: hand-apply each `bySymbol` survivor (`Number(false) - Number(left.symbol < right.symbol)` and
      `Number(left.symbol > right.symbol) - Number(true)`), quote the red count for each, restore.
- [ ] Classify, one line each in the commit body: `bySymbol` `>=` / `<=` equivalent (`Map` keys are unique, the
      comparator never sees equal names); `priorityClassOf` `.otherwise(() => 'rest' as const)` -> `undefined`
      equivalent (S11-Q8: `planTradeSymbolReads` keeps only the three priority classes, so no reader tells `'rest'`
      from `undefined`); `NO_WEIGHTS` -> `{}` equivalent (a record reads a missing weight as `undefined`);
      `checkedIdsOf` `typeof id !== 'number'` -> `false` equivalent (`Number.isSafeInteger` refuses a non-number).
- [ ] Check: suite green; `dup.sh` alone. Commit `test(binance): pin the candidate sort in both directions`.

### step 2/12: prerequisites (coordinator; no code)

- [ ] Probe 9 output present (S11-Q2): `myTrades` field types on BTCUSDT (`qty`, `quoteQty`, `commission`,
      `commissionAsset`, `isBuyer`, `time`, `price`), one `orderId` page and one `orderId` + `fromId` page with
      `limit=1000`, and the backfill and caught-up passes (calls, wall time at 350 ms, `X-MBX-USED-WEIGHT-1M`
      peaks). A type other than the doc's, or a refused `limit`: stop and ask before step 4/12.

### step 3/12: the trades lane

Files: `binance.history-budget.ts`, `binance.history-budget.test.ts`.
- [ ] Tests first: P1, P2, P3; TW17; "allows 100 trade calls and refuses the 101st"; "judges an order re-read by
      its own weight" (`keep` with 5). Red count quoted.
- [ ] Code: `'trades'` in `BudgetLane`, `LANE_CALL_CAPS.trades = 100`, `LANE_NARROWING_CALLS.trades = 0`, both
      counters in `createBinanceRunBudget`, `COSTS.myTrades`, `COSTS.orderFills`. Grep `Record<BudgetLane`.
- [ ] Check: suite green; `tsc` clean. Commit `feat(binance): trades lane`.

### step 4/12: the myTrades reads

Files: `binance.history-client.ts`, `binance.history-client.my-trades.test.ts` (new).
- [ ] First: quote Binance's doc for `GET /api/v3/myTrades` (parameters, `limit` max, weight with and without
      `orderId`, every response field and its JSON type) and the probe 9 numbers in the commit body.
- [ ] Tests first: TC1-TC4 (fake `fetchImpl`). Red count quoted.
- [ ] Code: `BinanceMyTrade = { id: unknown; orderId: number; qty: string; quoteQty: string; commission: string;
      commissionAsset: string; isBuyer: boolean; time: number }` read through `recordReader` (`id` left to the
      pager, `commissionAsset` through `tickerText`); a page with any unreadable row throws
      `BinanceHistoryParseError` (a skipped fill would be lost behind the cursor). `fetchMyTrades(apiKey, secret,
      symbol, fromId, options)` and `fetchOrderFills(apiKey, secret, symbol, orderId, fromId, options)` return
      `{ rows } & BinancePageWeights` with `usedApiWeight1m`; `TRADE_PAGE_LIMIT = 1000`.
- [ ] Check: suite green; `tsc`, knip clean (consumer: the test); `dup.sh` alone. Commit
      `feat(binance): read spot trades and order fills`.

### step 5/12: the Spot balance texts

Files: the `ProviderRead` file under `src/crypto-sync/provider/`, `binance.provider.ts`, `sync/sync.ts`, P6/P7 test
files, `binance.provider.test.ts`.
- [ ] Tests first: TW14; "returns no texts when the account is cooling down"; P6, P7. Red count quoted.
- [ ] Code: `spotBalanceTexts?: Readonly<Record<string, string>>` on `ProviderRead` and through `BalanceSyncResult`;
      built in `fetchBalances` from `spotAccount.balances` (text fields only; an entry with a non-text field is
      left out, so its coin reads `0/0` and counts as changed).
- [ ] Check: suites green; `tsc` clean. Commit `feat(binance): keep the spot balance texts for the trade read`.

### step 6/12: the imported-order lookup

Files: `src/transactions/repo/transactions.repo.ts`, `transactions.repo.order-prefixes.real-sqlite.test.ts` (new;
real SQLite, as `binance.dust-history.real-sqlite.test.ts` sets it up).
- [ ] Tests first: TW15 (EXPLAIN QUERY PLAN text quoted in the commit body); a row of another source, a prefix
      that is a prefix of another order's id, an empty list (no query). Red count quoted.
- [ ] Code: `importedOrderPrefixesQuery(source, prefixes)` -> `Promise<Set<string>>`, Drizzle `gte`/`lt` on
      `externalId` with `;` as the upper bound, never `LIKE`.
- [ ] Check: suite green; `tsc`, knip clean. Commit `feat(transactions): find the orders imported earlier`.

### step 7/12: the rows of an order

Files: `binance.trade-history.ts` (new), `binance.trade-history.rows.test.ts` (new).
- [ ] Tests first: T1-T6, T8, T9, T14 at the row builder, each with exact minor units, keys, markers, `operation`,
      and `exchangeExcludedTransactionIds` over the rows (the Statistics column); TW8, TW9, TW10; mixed `isBuyer`
      -> `BinanceHistoryParseError`; a negative text -> `BinanceWalkStop`. Red count quoted.
- [ ] Code: `tradeOrderRowsOf({ accountId, symbol, baseAsset, quoteAsset, orderId, fills })` -> `{ rows:
      PlannedTradeRow[]; untracked: string[] }`, per the Decisions (G-8 sums; a `match` on tracked / untracked per
      side, never an if-chain).
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): rows of a spot order`.

### step 8/12: the trade walk

Files: `binance.trade-history.ts`, `binance.trade-symbols.ts` (`isSymbolFailure` + `BinanceWalkStop`),
`binance.trade-symbols.test.ts` (TR9 gains `BinanceWalkStop`), `binance.trade-history.test.ts` (new),
`binance/index.ts`.
- [ ] Tests first: T7, T10, T11, T11b, T12, T12b (two runs each, fake deps with an in-memory store that upserts by
      `(source, externalId)` and answers the prefix query); TW2-TW7, TW11-TW13; TR8 end to end. Red count quoted.
- [ ] Code: `syncBinanceTradeHistory({ targetAccountId, run, spotBalanceTexts }, overrides)` with
      `BinanceTradeHistoryDeps` (`ExchangeStateDeps`, `now`, `fetchImpl`, `readCredentials`, `listHoldings`,
      `fetchExchangeSymbols`, `fetchMyTrades`, `fetchOrderFills`, `importedOrderPrefixes`, `ensureHoldings`,
      `addTransactions`); cooldown -> credentials -> state (`parseExchangeState`) -> `readSpotSymbols` ->
      `touchedCoinsOf` (holding codes through `partsOfHoldingKey`) -> `tradeCandidatesOf` ->
      `planTradeSymbolReads` -> `runTradeSymbolReads` (`canAfford: keep => run.budget.canAfford('trades',
      COSTS.myTrades, keep)`) -> `tradesPatchesOf` -> log `symbolFailures` -> cooldown or rethrow `failure`.
      Export it through the barrel.
- [ ] Check: suites green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): import spot trades by order`.

### step 9/12: wiring, real SQLite, property

Files: `run-crypto-sync.ts`, `run-crypto-sync.test.ts`, `binance.trade-history.real-sqlite.test.ts` (new),
`binance.trade-history.properties.test.ts` (new).
- [ ] Tests first: TW1, P4, P5; real SQLite: T7, T11b, T12b through the real `transactionsRepo` (amount refreshed
      under the same key, markers kept insert-only, one fee row); TW16 through `syncBinanceTradeHistory` itself
      (memory "property suite must call production caller"), seeds 30-40, the seed printed on failure, one run
      per clock gap 0 / 1 h / 1 day. Show it load-bearing: break the once-per-run skip (re-read every fill) and the
      prefix lookup (always "new"); quote the failing seed counts; restore. Red count quoted.
- [ ] Code: `runBinanceHistoryWalks(targetAccountId, run, spotBalanceTexts)`; the trade read last.
- [ ] Check: suites green; `tsc`, knip clean; `dup.sh` alone on each new test file. Commit
      `feat(binance): run the trade read after the other walks`.

### step 10/12: spec alignment and the set 11 rulings

Files: `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`.
- [ ] Record S11-Q1 ... S11-Q8 in section 1 with their source (rulings.md, section "Set 11 plan questions").
      Align: section 5 "Spot trades" (page boundary per S11-Q3, symbol failures, both-untracked and zero-unit rows,
      F2 source, rate limit), the per-run paragraph with the probe 9 report (backfill and caught-up calls, wall
      time, weight peaks) and the trades cap it supports; "R-Walk A" P2P cap moved to set 12; section 7 TC/TW rows;
      section 11 row 10/15 "~7" -> measured 7 and row 11/15 the measured file count. Point at constants (G-11).
- [ ] Lines within the spec's width; no phrase the `docs-known-limit` suite bans; `make doc-suites` green. Commit
      `docs(spec): set 11 rulings and trades`.

### step 11/12: reviews, retrospect, scribe

- [ ] G1 = steps 1/12-6/12: `kiko:reviewer`. Top question: "can a request leave without being recorded against its
      lane, can a field of an unmeasured type pass, or can the prefix lookup match another order?"
- [ ] G2 = steps 7/12-9/12: `kiko:reviewer`. Top question: "can any fill be lost, counted twice, or written behind
      a cursor that passed it (page boundary, crash between rows and cursor, re-read once per run, hold), and does
      every row sum match the spec rows exactly?"
- [ ] Whole-branch `kiko:reviewer` at the tip, step 10/12 included. No migration: no migration review.
- [ ] `kiko:retrospect` over both skill locations and `harness/kiko/agents/` (at least `kiko-architecture` "Trade
      READS are not yet run by `runBinanceHistoryWalks` (set 11)"; `kiko-domain` operation mapping), then
      `kiko:scribe` fixes and commits. Pointers, no copied lists. A `harness/kiko` change bumps the plugin version.
      The report names the drift-fix sha or "no drift found".

### step 12/12: gates and BATCH READY

- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh check-all <worktree> "crypto-exchanges-1.3-a task
      11/15 check-all"` exit 0; agents wait for the result.
- [ ] Orchestrator, only after CHARGER BACK (a count, not a queued job): `KIKO_MUTATION_BASE=3d0df6d4 make mutable`:
      quote the file list, `mutable files: N (cap 30)` and the timeout share line. Above 30: stop and split.
- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task 11/15
      deep" 3d0df6d4 <head>` (`KIKO_MUTATION_BASE=3d0df6d4 make deep`), detached; agents wait for the exit code.
      TIMEOUT-HEAVY (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"): the gate's own rerun is the
      verdict; only if it still fails, prove each timed-out mutant in plain jest or write it as equivalent. Never
      raise the timeout.
- [ ] Coordinator (not the developer): `make verify` once at the set tip through the queue (`bash
      scripts/job-queue.sh verify <worktree> "crypto-exchanges-1.3-a task 11/15 verify"`), tree clean, re-run until
      green; agents wait for the result.
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer verdicts, the scribe
      sha, the S11-Q rulings, the probe 9 report, and the survivor classification of step 1/12.

## Review focus

1. A lost fill: an order written from a partial page whose later fill is skipped as "already read"; a stop fill
   written; a cursor patch written before its rows.
2. A double count: a fill in both a re-read and a page write; a fee row under two keys; a leg key without the coin.
3. Fee rules: commission in two coins over one order's fills; spent-coin fee added, received-coin fee subtracted.
4. Lane: a re-read page or a rejected page not recorded; a held symbol taking the reserved call.
5. A symbol that fails every run: logged every run (one line per run), passed by the rotation, rows of other
   symbols unaffected.

## Pre-flight self-check (planner)

- No copy key, no screen change (G-5). No migration (G-4).
- G-1 every step; G-2 steps 3, 5, 9; G-3 steps 4-9; G-5 step 9; G-6 step 3; G-7 steps 4, 7; G-8 step 7; G-9 steps 2,
  4; G-10 steps 4, 8, 9; G-11 steps 10, 11; G-12 every commit; G-13 every step.

## Questions for the coordinator (S11-Q1 ... S11-Q8)

- S11-Q1 balance texts for the rotation (F2). A: the Spot read of the balance sync returns them
  (`spotBalanceTexts` through `ProviderRead` / `BalanceSyncResult`). B: the trade read makes its own
  `/api/v3/account` call (weight 20) just before the trade reads. Recommend A: no extra request, and the read
  already runs before every walk.
- S11-Q2 the measured run report and the field types. A: a read-only probe 9 run by the user (probe 3-8 guards):
  `myTrades` field types on BTCUSDT, one `orderId` and one `orderId` + `fromId` page with `limit=1000`, then a
  backfill pass (every candidate from `fromId` 0) and a caught-up pass at the 350 ms gate: calls, wall time,
  weight peaks; the cap stays 100 unless the numbers say otherwise. B: a simulator run with the user's key. C: defer
  to the device check after set 15. Recommend A: the spec asks for the report in set 11, and the fields are unmeasured.
- S11-Q3 an order cut by a page boundary. A: write it from the fills seen; its next fill finds it by key prefix and
  re-reads it (one weight-5 call); the spec text is aligned. B: carry its fills across pages unwritten (the pager
  could not commit its cursor per page). Recommend A: no fill ever sits behind a stored cursor unwritten.
- S11-Q4 both legs untracked, fee in a tracked third coin (PEPE/FLOKI, fee BNB). A: the BNB fee row in the C-NR5
  form (`asset:<received>`, pair id, `trade-fee`), both tickers listed. B: no row. Recommend A: BNB really left the
  wallet; same rule as C-NR5.
- S11-Q5 a leg that rounds to 0 units at its coin scale. A: neither leg, a non-zero fee row still imports, no stop
  (S9-Q2, PAY m2 B). B: the symbol fails. Recommend A: the precedent rule, and a failure would stop every later
  order of that symbol.
- S11-Q6 a row the rules refuse (amount malformed, too precise, too large, negative; mixed `isBuyer`; an unreadable
  row in a page). A: per-symbol failure (`BinanceWalkStop` joins `isSymbolFailure`; `failed`, logged, retried next
  cycle; the too-large coin listed). B: stop the run. Recommend A: G2-A splits by "names one symbol".
- S11-Q7 home of the survivor step. A: step 1/12 here. B: the survivor-triage track. Recommend A: test-only, in a
  file this set opens anyway, and it touches no file that track owns.
- S11-Q8 the `priorityClassOf` `.otherwise(() => 'rest' as const)` -> `undefined` survivor. A: equivalent, one line
  in the commit body. B: refactor to remove the arm. Recommend A: no reader tells `'rest'` from `undefined`.
