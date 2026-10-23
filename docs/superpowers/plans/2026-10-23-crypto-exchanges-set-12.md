# Crypto exchanges 1.3-a, change set 12: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `crypto-exchanges-1.3-a task 12/15`: the set 11 survivor tests and the spec test-row doc test
first, then the P2P walk (status, side, role, amount; BUY TAKER rows; SELL, MAKER and refused orders into
`notImported`), the fiat orders and fiat payments walks (strict status allowlist, C-NR-E), their lanes, the run
wiring, and the measured P2P first-walk report.

**Architecture:** two new walk files, `src/crypto-sync/binance/binance.p2p-history.ts`
(`syncBinanceP2pHistory`) and `binance.fiat-history.ts` (`syncBinanceFiatOrderHistory`,
`syncBinanceFiatPaymentHistory`, one shared walk body). Model the series span and the `DepthGuard` safety net on
`binance.transfer-history.ts` (`readSeriesSpan`, `depthMemories`, `isRefusal: BinanceHistoryTooOldError`), and
the outcome / `notImported` / owed-point flow on `binance.convert-history.ts` (`ConvertOutcome`, `partsOf`,
`commitSettledSpan` with `notImportedWriterOf`, `CONVERT_FORWARD_OWES`, `planWalkPasses`, `runWalkPlan`,
`walkSpans`). The reads go in `binance.history-client.ts` through `fetchAllByTotal`-style `page`/`rows` paging
(`exchange/paging/paging.ts`). The walk ids `p2p`, `fiatOrders`, `fiatPayments` and all six
`NOT_IMPORTED_KINDS` already exist (`exchange/walk-state/walk-state.ts`, set 8); the copy keys exist
(`accountDetail.notImportedKind.*`). No P2P or fiat walk code exists on the base (grep of `src` for `c2c`,
`fiat/orders`, `fiat/payments`: none outside walk-state, labels, copy).

**Tech stack:** React Native, op-sqlite + Drizzle, Jest (`fast-check`), fnts `maybe`/`Either`, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: section 1 (C-P5, C-NR-A, C-NR-B, C-NR-D,
C-NR-E, C-NR1, C-NR3, C-P2P-stop, C-P2P-SELL-MAKER B, C-P2P-fiat-asset A, R-Walk A, R-Q6, R-Q15); section 5 stream
table rows P2P / Fiat orders / Fiat payments, "Refused window and walk direction", "Measured weights" (with the
fiat-orders budget cases and the first-walk table), "### P2P", "### Fiat orders (deposit, withdraw) and fiat
payments (card buy, sell)"; section 6 "Not-imported line", "Mapping and statistics per operation"; section 7
P1-P11, F1-F6, N5b; section 11 row 12/15; section 12 P5, P6. Rulings: `rulings.md` (main checkout,
`memory/refs/binance-multicoin-sdd-2026-10-21/`), "Probe 4 rulings", "Spec draft sets 8-12 rulings", "P2P BUY vs
LATER SEND IN THE CATEGORY CHART", "Set 11 plan questions". Questions S12-Q1 ... S12-Q15, S12-Q18, S12-Q21, S12-Q22,
S12-Q23, S12-Q24 and S12-Q27 ... S12-Q34 are at the end; the plan assumes each recommendation.

**Base:** branch `binance-set12` at main `79094ae8` (sets 1-11 merged). Every code fact names a symbol or anchor
text, never a line. **The developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Test titles and comments carry no
  scenario id, ruling id or history text; the commit message carries them. Tests never parse `src` text.
- G-2 A pin a behaviour change moves is updated in the same step (table "Pins this set changes"), retitled to
  state the new rule; never in a fix round.
- G-3 Full-word identifiers; imports through `@kiko/<feature>` barrels; every new export has a consumer at its own
  commit (knip flags it: stop and report, never an ignore).
- G-4 No migration, no index, no `.kiko` change (`EXPORT_VERSION`, `VERSION_DECISIONS` unchanged), so no migration
  review and no EXPLAIN QUERY PLAN test. Stop and ask if a migration or a new query appears.
- G-5 Safe tip. Steps 4/14-10/14 add code with no production caller; step 11/14 wires it. Main is not released
  before all 15 sets (U1). Guideline 2.5.19: no flag, no `SHOW_*`/`HIDE_*`, no hidden UI; the rows render with set
  7's labels (`p2p:` "P2P purchase", `card:`, `bank:`), the screenshot seed already holds `p2p:` and `bank:` rows
  (`e2e/screenshot/seed/screenshot-seed.ts`), and the not-imported line exists (set 8). No copy key, no i18n change,
  no translator review.
- G-6 Lanes (spec "Measured weights"): `p2p` cap 20 (S12-Q7: 10 until probe 10, 20 after it), `fiatOrders` cap 3,
  `fiatPayments` cap 10, narrowing calls 0 each; `COSTS.p2p = { uid: 900 }`, `COSTS.fiatOrders = { uid: 45_000 }`,
  `COSTS.fiatPayments = { ip: 1 }`. The two UID lanes share one minute: `LANE_CALL_CAPS.p2p x COSTS.p2p.uid +
  LANE_CALL_CAPS.fiatOrders x COSTS.fiatOrders.uid` stays within `UID_WEIGHT_BUDGET_1M` (BL1).
- G-7 Amounts: every amount text through `rowMinorUnits` (`exchange/walk/records.ts`, `'row'` mode: a digit past the
  scale stops `amount-precision`; never the trade read's rounding mode). `amount - takerCommission` is two exact
  minor-unit values subtracted as integers. Never `Number()` on an amount, never a float.
- G-8 Marker totals (C-NR1, S7-Q6): one builder in `src/transactions/untracked-counterpart/untracked-counterpart.ts`
  (beside `untrackedAssetCode`) normalizes Binance's total text to exactly the fiat's scale through
  `decimalToMinorUnits` (`@kiko/currency/decimal`): trailing zeros past the scale drop, missing ones pad, a non-zero
  digit past it is `amount-precision`. Its output must round-trip through `parseUntrackedCounterpart`.
- G-9 Strict reads (set 10 lesson): every field the walk uses is read with its documented type through
  `recordReader`; a page with a body that is not the documented envelope throws `BinanceHistoryParseError`. No
  counterparty field is read into a type (spec section 9): `counterPartNickName`, `advNo`, `payMethodName`,
  `additionalKycVerify`; nor fiat `method` / `paymentMethod`.
- G-10 Every sent request is recorded against its lane (`run.budget.record`), a rejected one too; every walk has a
  per-run thrower in its property suite (set 10 lesson 5).
- G-11 Point skill and spec text at constants (`LANE_CALL_CAPS`, `COSTS`, `WALK_IDS`, `NOT_IMPORTED_KINDS`, the
  status allowlist constants), never a copied list.
- G-12 Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.
  `bash scripts/checks/dup.sh <file>` alone on each new or grown test file (`binance.trade-history.test.ts` is
  already over 1000 lines: add no test there except the one line of step 1/14). Writes to `src/`, `__tests__/` and
  `docs/` only with Edit/Write. After any `biome check --write`, run `node scripts/checks/import-order.js <file>`.
- G-13 Jest lines: literal paths FIRST, `--testPathIgnorePatterns=.stryker-tmp` LAST (`=` form); never an empty
  path list, a glob, or the space form (set 11 lesson 1: those ran the full suite). Model:
  `npx jest src/crypto-sync/binance/binance.p2p-history.test.ts --testPathIgnorePatterns=.stryker-tmp`.
- G-14 A mutant is never restored with git (no checkout, restore or stash): hand-apply with Edit, run, quote the red
  count, Edit back, then `git diff --exit-code -- <file>` must exit 0.

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-23)

- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks the institution, not the connection): LEFT
  OPEN; the P2P and fiat patches go through `patchExchangeState` and inherit the same gate, no worse.
- `20261021T1839-kiko-binance-set9/1` (unreadable `notImported` names never logged): LEFT OPEN; set 12 is the first
  writer of the `p2p-*` and `fiat-unrecognized` kinds, and every entry it writes is a known kind, so it adds no
  unreadable name.
- `20261021T1839-kiko-binance-set9/2` (repeated `row-precision-rounded`): LEFT OPEN, not grown: P2P and fiat amounts
  use `'row'` mode, which stops instead of rounding (G-7).
- `20261021T1839-kiko-binance-set9/3` (`import-order.sh` multi-path): LEFT OPEN; G-12 runs the Node checker per file.
- `20261015T1657-kiko-binance-backfill-fix/2` (migration keyed-lookup index check): LEFT OPEN, no migration (G-4).
- `20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`, `20261018T1637-kiko-harness-h9/2`
  (TIMEOUT-HEAVY fan-out): LEFT OPEN; if `walk.ts`, `paging.ts` or `untracked-counterpart.ts` lines change, step
  14/14 applies the gate rerun rule.
- `20261017T2005-kiko-harness-h8/6` (no live TIMEOUT-HEAVY rerun proof): LEFT OPEN unless this gate meets one.
- Every other open gap (harness, kill-guard, Duo, iPad, account-currency): LEFT OPEN, unrelated.

## Decisions this plan makes (assumed; S12-Q* confirm)

- Run order (spec section 5): balance, capital, Pay, Transfer, Earn, Convert, dust, P2P, fiat orders, fiat
  payments, trades. Each in its own `logOnFailure('[binance sync] p2p history failed' | 'fiat order history
  failed' | 'fiat payment history failed', ...)` on the shared `run`; the trade read stays last.
- P2P read: `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory` with `tradeType`, `startTimestamp`,
  `endTimestamp`, `page`, `rows=100` (the parameter names of probes 4-5 and of Binance's connector docs; step 2/14
  quotes them). Series `['BUY', 'SELL']` in one `readSeriesSpan`; 30-day windows (`P2P_WINDOW_MS`) from
  `HISTORY_FLOOR_MS`; `DepthGuard` wired as the safety net (`isRefusal`: `BinanceHistoryTooOldError`).
- Fiat reads: `GET /sapi/v1/fiat/orders` and `/sapi/v1/fiat/payments` with `transactionType` 0/1, `beginTime`,
  `endTime`, `page`, `rows` (500 orders, 100 payments); 2-year windows (`FIAT_WINDOW_MS = 730 * DAY_MS`), same
  safety net.
- P2P decision per order (spec "### P2P", in that order; a `match`, never an if-chain): `orderStatus`
  (`COMPLETED` on; `CANCELLED`, `CANCELLED_BY_SYSTEM` none; `PENDING`, `TRADING`, `BUYER_PAYED`, `DISTRIBUTING`,
  `IN_APPEAL` owe the point, kept in `P2P_OPEN_STATUSES`; else `p2p-unrecognized`) -> `tradeType` (SELL ->
  `p2p-sale`; BUY on; else `p2p-unrecognized`) -> `advertisementRole` (MAKER -> `p2p-advertiser`; TAKER on; else
  `p2p-unrecognized`) -> amount fields present (C-P5, C-NR-B, P1-P1h) -> tracked rule on `asset`
  (`isTrackedBinanceAsset`; untracked: counted, ticker to `untrackedCoins.history`, no row) -> `fiat` and
  `totalPrice` present, and the fiat a text a code can carry (`p2p-unrecognized` if not, S12-Q34, P12) -> amount
  values (`p2p-amount`; a number text the parser refuses is a stop).
- P2P row: Funding (`holdingKeyOf(asset, 'funding')`, created at zero by `placeWalletRows`, R-Q6), `+amount`,
  `untrackedCounterpart` from the G-8 builder `p2p:<fiat>:<totalPrice>`, `comment = '<totalPrice> <fiat>'` (the
  text as Binance sent it), `operation = 'p2p'`, key `${accountId}:p2p:${orderNumber}:<walletKey>`. Entry
  `notImportedEntry(kind, orderNumber, createTime)`. An `orderNumber` that is not non-empty text, or a
  `createTime` that is not a safe integer: unreadable, owed and visible (the convert reader's rule,
  `readConvertRecord`). Any other decision field of the wrong type: `BinanceHistoryParseError` for the page, so
  the run fails the P2P walk, it is logged, and the next run reads the window again (S12-Q15). A page that throws
  on every run stays visible: the log line each run, the history caption once the `p2p` cursor lags more than a
  day (as S8-C1 for Convert), and the other walks of the run still run (PW6-PW8, RW2, RW3).
- Fiat orders: `Successful` row; `Processing` owes the point; `Failed` / `Refunded` none only if step 2/14 finds
  doc text that no money moved (S12-Q3: expected not found, so `fiat-unrecognized`); every other word
  `fiat-unrecognized`. Deposit `+amount`, withdraw `-(amount + totalFee)` (S12-Q11), on Spot (C-NR3), marker
  `bank:<fiatCurrency>:<indicatedAmount>`, `comment = '<indicatedAmount> <fiatCurrency>'`, `operation = 'fiat'`,
  key `${accountId}:fiat:${orderNo}:<walletKey>`. A `fiatCurrency` the tracked rule refuses: counted, listed.
- Fiat payments: `Completed` row; `Processing` owes; the rest as orders. Buy `+obtainAmount` of `cryptoCurrency`
  with `card:<fiatCurrency>:<sourceAmount>`; sell `-sourceAmount` with `card:<fiatCurrency>:<obtainAmount>`;
  `comment` the marker total and fiat as sent; `operation = 'card'`; Spot; key
  `${accountId}:fiatpay:${orderNo}:<walletKey>`.
- Each allowlist is a named constant (`P2P_OPEN_STATUSES`, `FIAT_ORDER_STATUSES`, `FIAT_PAYMENT_STATUSES`) whose
  doc comment states only why the words are not from Binance's docs, with no `.superpowers/` path and no step id
  (that folder is not committed, and a step id is history).
- Caption (S12-Q9 A): `p2p`, `fiatOrders`, `fiatPayments` join `CAPTION_WALKS`
  (`src/screens/account-detail/crypto-sync-section/binance-history-status.ts`).

## Scenario matrix (each row is a Jest case)

Spec rows P1-P11 (P1b-P1h, P2b-P2d, P3b-P3d, P7b, P8b), F1-F6 and N5b, as written in spec section 7 (their
"was:" column is the spec's). Each maps to the test below; titles are exact. Files are in
`src/crypto-sync/binance/` unless a path is given. `outcome` = `binance.p2p-history.outcome.test.ts` (the pure
decision `p2pOutcomeOf`), `walk` = `binance.p2p-history.test.ts`, `sqlite` = `binance.p2p-history.real-sqlite.test.ts`,
`fiat` = `binance.fiat-history.test.ts`. Exact minor units: USDT scale 8, UAH and EUR scale 2, BTC scale 8.

| Row | Test (file, title) | Exact values |
|---|---|---|
| P1 | outcome, "imports a completed taker buy at its taker amount, with the total Binance sent as the marker" | USDT +9_990_000_000; `p2p:UAH:4150.00`; comment `4150 UAH`; `p2p` |
| P1b | outcome, "imports the whole amount when the taker commission is zero" | +10_000_000_000 |
| P1c | outcome, "subtracts the commission from the amount in minor units when the taker amount is absent" | +9_990_000_000 |
| P1d | outcome, "refuses an order whose taker amount differs from amount minus commission" | `p2p-amount:<n>:<t>`, no row |
| P1e | outcome, "refuses an order with neither a taker amount nor a taker commission" | `p2p-amount` |
| P1f | outcome, "keeps the total Binance sent, never amount times unit price" | `p2p:UAH:4145.85` |
| P1g | outcome, "lets the taker amount stand when the commission is absent" | +9_990_000_000 |
| P1h | outcome, "refuses an order with neither a taker amount nor an amount" | `p2p-amount` |
| P2 | outcome, "lists a completed sale and writes no row" | `p2p-sale:<orderNumber>:<createTime>` |
| P2b | outcome, "lists a completed buy placed as an advertiser" | `p2p-advertiser` |
| P2c | outcome, "lists an order whose %s as not recognized" (role missing, role unknown, side unknown) | `p2p-unrecognized` |
| P2d | outcome, "lists a sale placed as an advertiser once, as a sale" | one `p2p-sale`, no `p2p-advertiser` |
| P3 | outcome, "writes and lists nothing for a %s order, even with a commission" | no row, no entry |
| P3b | walk, "owes the point of a buy in %s and imports it once a later read sees it completed" | owed, then one row |
| P3c | outcome, "lists an order status Kiko does not know as not recognized" | `p2p-unrecognized` |
| P3d | walk, "owes an open sale and lists it once it is completed" | no entry, then one `p2p-sale` |
| P4 | sqlite, "puts a buy of a fiat asset on the Funding fiat holding, created at zero" | UAH +400_000; `p2p:UAH:4000.00`; label "P2P purchase (UAH)" |
| P4b | walk, "counts an asset Kiko does not track, lists its ticker and writes no row" | `untrackedCoins.history` `['XYZ']` |
| P5 | walk, "stops at a total with a digit past the fiat scale and owes its point" | `amount-precision`, point owed |
| P6 | walk, "reads every empty window and imports an order behind eight of them" | 9 windows read, 1 row |
| P7 | walk, "narrows a start Binance refuses as too old and walks on forward" | owed nothing below; cursor forward |
| P7b | walk, "reaches the first UA-1 order by run 8 and the newest by run 12 at the lane cap" | 226 calls; runs 8 / 12 |
| P8 | walk, "imports the buys of a window whose sale series is empty" | rows; no empty count |
| P8b | walk, "keeps the window and the cursor on any other refusal code and reads it again next run" | cursor unchanged |
| P9 | sqlite, "imports the 77 completed buys of the probe 3 orders and lists nothing" | 77 rows; `notImported` empty |
| P10 | walk, "keeps one entry when the re-scan reads a listed sale again" | count stays 1 |
| P11 | sqlite, "leaves the Funding UAH holding at zero after a P2P buy of UAH and its Convert" | UAH +x then -x = 0; USDT + |
| P12 | outcome, "lists a buy with %s as not recognized, since no row or marker can be made" (a blank fiat, a fiat that holds the separator) | `p2p-unrecognized`, no row, no stop |
| P12b | walk, "lists a buy with %s as not recognized and owes no point" | one `p2p-unrecognized` entry; cursor at now; no pending point |
| F1 | fiat, "credits a successful deposit to the Spot fiat holding with the bank total" | EUR +10_000; `bank:EUR:100.00` |
| F2 | fiat, "debits a successful withdrawal by its amount and its total fee" | EUR -(5_000 + fee); `bank:EUR:50.00` |
| F3 | fiat, "imports a completed card buy on the Spot coin holding"; `binance.fiat-history.real-sqlite.test.ts`, "imports a completed card buy and sale on the Spot coin holding" (FR1) | BTC +100_000; `card:UAH:2600.00` |
| F3b | fiat, "debits a completed card sale and marks the fiat it was sold for" | BTC -; `card:<fiat>:<obtainAmount>` |
| F4 | fiat, "lists a fiat %s with status %s as not recognized" (orders: `Finished`, `Refunding`, `Refund Failed`, `Order Partial Credit Stopped`, an undocumented word; payments: an undocumented word) | one `fiat-unrecognized` each |
| F4b | fiat, "settles only the exact allowlisted word, so %s is not recognized" (`successful`, ` Successful`, `Successful `, `Order Partial credit Stopped`, `Refund  Failed`; payments `completed`, `Completed `) | one `fiat-unrecognized` each, no row (S12-Q13) |
| F5 | fiat, "reads every two-year window from the floor, empty ones too" | orders 12 calls / 6 runs to now (S12-Q6, S12-Q18, S12-Q21), payments 10 / 1 |
| F6 | fiat, "settles %s, owes %s and lists every word the doc does not show as moving no money" | per step 2/14 |
| N5b | `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.not-imported.test.tsx`, "counts two P2P sales beside one Convert order, in the order of the kind list" | exact N5b text |

New rows (no P2P or fiat read ran before, so "was:" is "no read" unless a value is given):

| # | Input | Result now | Test (file, title) | was: |
|---|---|---|---|---|
| PC1 | `fetchP2pOrders(BUY, span, page 1)` | signed GET, `tradeType`, `startTimestamp`, `endTimestamp`, `page`, `rows=100`; UID header read | `binance.history-client.p2p.test.ts`, "asks one page of one side and one window at 100 rows (%s, page %i)" | - |
| PC2 | body not the documented envelope; a decision field other than `orderNumber` / `createTime` of the wrong type; `data` null or absent while `total` is not 0 | `BinanceHistoryParseError`, whole page | same, "fails the whole page for %s" | - |
| PC2b | `data` null or absent with `total === 0` | an empty page (no row, no throw) | same, "reads %s as a window with no order" (the shapes with a total of 0; one with a total above 0 is PC2's "fails the whole page for %s") | - |
| PC5 | `orderNumber` empty, not text or absent; `createTime` not a safe integer | that record unreadable (owed), the other records of the page read | same, "reads an order with %s as unreadable, keeping its time and the rest of the page" (the `orderNumber` cases), "reads an order with %s as unreadable and keeps the rest of the page" (the `createTime` cases); each beside a readable order that reads | - |
| PC3 | a record with every documented field | the record holds no counterparty field | same, "reads no counterparty field into the record" | - |
| PC4 | HTTP 429 / 418; -5026; HTTP 500 | `BinanceRateLimitError`; `BinanceHistoryTooOldError`; request failure | same, "maps HTTP %i to BinanceRateLimitError with its retryAfterMs", "maps code -5026 on an HTTP 400 to BinanceHistoryTooOldError", "maps HTTP 500 to the request-failed error, not to a parse error or a refusal" | - |
| FC1 | `fetchFiatOrders(0, span, page)`, `fetchFiatPayments(1, span, page)` | `transactionType`, `beginTime`, `endTime`, `page`, `rows` 500 / 100 | `binance.history-client.fiat.test.ts`, "asks one page of ${kind.name} of type %s at ${kind.pageRows} rows (page %i)" | - |
| FC2 | as PC2 and PC2b for both bodies (the same `data` / `total` envelope) | `BinanceHistoryParseError` | same, "fails the whole page for %s" | - |
| FC3 | as PC4 | as PC4 | same, the three PC4 titles (the file shares them) | - |
| BL1 | lanes at their caps | `p2p` 20, `fiatOrders` 3, `fiatPayments` 10; each UID lane at its cap within `UID_WEIGHT_BUDGET_1M`, and the two together (20 x 900 + 3 x 45000 = 153000) | `binance.history-budget.test.ts`, "keeps each new UID lane at its cap within the minute budget", "keeps the P2P and fiat order lanes, which share one UID minute, within it when both spend their caps" | no lane |
| BL2 | 3 fiat-order calls recorded | a 4th refused | same, "refuses a fourth fiat order call in a run, though the weight alone would allow it" | - |
| BL3 | first fiat-order call, last header 135001 / 135000 | refused / allowed | same, "refuses the first fiat order call above a reading of 135000 and allows it at 135000" | - |
| PW1 | cooling down; no credentials; unreadable state | no request; `{ imported: 0 }` or a rejection (state) | walk, "a run that does not start" | - |
| PW2 | 429 on a window's SELL series | earlier windows committed; cooldown set; resolves | walk, "writes the windows read before the limit, sets the cooldown and resolves" | - |
| PW3 | `addTransactions` rejects | no mark for that window; rethrown | walk, "moves no mark past a window whose rows fail to write and rethrows" | - |
| PW4 | the lane room for 4 calls | 2 windows (both series each), no half window | walk, "reads both sides of a window or neither" | - |
| PW5b | an unreadable order (PC5) in a window | its point owed; the other orders of the window import; the cursor passes the window | walk, "owes the point of an order it cannot read and imports the rest of its window" | - |
| PW6 | a window whose page throws `BinanceHistoryParseError` on every run (modelled on `binance.convert-history.test.ts` "rejects the walk, moves no mark and writes no row when a window is answered -5026") | the walk rejects; no mark moves past the window, no row of it; the earlier windows stay committed | walk, "rejects the walk, moves no mark past the window and writes none of its rows when its page cannot be read" | - |
| PW7 | PW6 over three runs | each run rejects the same way and reads the window again; the `p2p` cursor stays before it | walk, "reads a window whose page cannot be read again on every run, never passing it" | - |
| PW8 | the `p2p` cursor of PW7 more than a day behind `latestSyncedAt` (modelled on `binance-history-status.test.ts` "is not behind at exactly a day, and is behind a millisecond past it") | the history caption shows | `src/screens/account-detail/crypto-sync-section/binance-history-status.test.ts`, "is behind while the P2P walk is held more than a day by a page it cannot read" | hidden (not in `CAPTION_WALKS`) |
| PW5 | property over the P2P walk through `syncBinanceP2pHistory`: 35 seeds at gaps 0 / 1 h / 1 day (105 worlds), 12 to 35 orders over 400 days, twelve categories (completed buys of USDT and of a fiat asset, a buy with no taker amount, a sale, an advertiser, an unknown role, an unknown side, no amount, a cancelled order, an unknown status, an untracked coin, an open order that is cancelled), 30% of the orders open until a run of 1 to 12; the first 14 runs spend a random part of the lane, throw in a window on some runs and answer 429s, then 26 quiet runs | each completed taker buy stored once at its exact minor units with its marker; each refusal exactly one entry of its kind; the untracked ticker listed once; no row or entry for an order that is open in the run; calls within the lane less the part spent; no call inside a cooldown; the cursor at the last clock; no owed ground left | `binance.p2p-history.properties.test.ts`, "the P2P walk over random orders, runs %i ms apart" > "imports each completed taker buy once at its exact amount, lists each refusal once, and ends current: seed %i" | - |
| FW1 | as PW1-PW3 for both fiat walks | as PW1-PW3 | fiat, describe "a fiat walk that stops" (the cases that do not start) and describe "a failure of the $name walk" | - |
| FW2 | property over the fiat orders and fiat payments walks (S12-Q22, S12-Q23, S12-Q24, S12-Q30, S12-Q32, S12-Q33): six clocks (standing; 1 ms, 1 h and 1 day apart; set back at run 4 by 5 h and by 5 days, to before the cursor), 30 seeds each (the plan's property rule is 30 to 40), and the payments seeds 1027, 334, 306, 558 and 642 (S12-Q32) and the seeds 5, 19, 26 (payments drifting, orders drifting and throwing) and 26, 89, 201 (payments throwing) (S12-Q33) by name at every clock, ten kinds of owed ground: none, a drifting page and a throwing page with the owed days anywhere from the history floor to the cursor, in the last 500 days and four to six in a row an hour to 3 days apart there, the same four to six in a row with 2 x (page rows + 1) rows of each type in the hour after the first (dense: a span past a stuck day holds more than a page, so a read of it halves; driven for 120 runs, the records drawn for 60, so no other world draws other numbers), ground Binance refuses as older than it serves (-5026) | every record Binance serves (late ones written 2 to 601 days behind, a new one on some runs) is imported within 4 x (2z + 1) runs of the run that first serves it, z the failing days inside the 2-year window (4 with none, 12 with one, 28 with three, 52 with six), each key once, and 1 x (2z + 1) on the payments walk (S12-Q32; 1 with none, 5 with two, 13 with six): the bound is r x F(z), r the runs between two reads of the re-scan (4 on orders, 1 on payments) and F(z) = 2z + 1 the reads of a first pass; a bound of 3 fails with none; a dense world adds the halving, `r x (F(z) + H)` with H = 2 x (ceil(log2(CLUSTER_GAP_MS / HOUR_MS)) + 1) the reads to halve a full page down to one that fits and to double back, with slack (S12-Q33; z = 4, 5, 6: 25, 27, 29 on payments, 100, 108, 116 on orders) | `binance.fiat-history.properties.test.ts`, "the $kindName walk over generated worlds, runs $label" > "with $stuck owed ground placed $place" > the case of a seed (its title is built by `casesOf`) | 274 of 432 worlds fail on the code of S12-Q22 (a standing or set-back clock: the late or new record is never re-scanned; a failing day in the window: the re-scan never passes it); 58 payment worlds fail on the code of S12-Q29 (a drifting page, seeds 5, 19, 26, 33, 40, 47, 61 and 82: the pass never reaches its end); 187 payment worlds (a drifting page, anywhere, in the window and in a cluster) fail the bound 1 x (2z + 1) on the code of S12-Q30, among them the 5 named seeds at all 6 clocks; 624 dense cases fail on the code of S12-Q32, 555 of the 30-seed cases (payments: 180 drifting and 15 throwing, orders: 180 drifting and 180 throwing) and 69 of the named ones; payments never end their first pass behind full pages, orders import none of the later records |
| FW3 | property over the fiat orders walk through `syncBinanceFiatOrderHistory` over statuses: 32 seeds at gaps 0 / 1 h / 1 day (96 worlds), 12 to 35 records from the history floor to the last clock, five categories (settled, a word the walk does not know or a spelling of `Successful` that is not exact, a coin Kiko does not track, `Processing` that settles later, `Processing` that is refused later); the first 14 runs spend a random part of the lane, throw an unreadable page in a window on some runs and answer 429s, then 46 quiet runs | each settled record stored once at its exact minor units (a withdrawal with its fee) and its marker; each refusal exactly one `fiat-unrecognized` entry; the untracked ticker listed once; no row or entry for a record that is `Processing` in the run; the cursor at most one run behind the last clock; no owed point; no owed range older than the overlap day of the last forward read | `binance.fiat-history.properties.test.ts`, "the $kindName walk over generated statuses, runs $gapMs ms apart" > "imports each settled record once at its exact amount, lists each refusal once, and ends current: seed %i" | - |
| FQ1 | orders current, run 2 after a forward run, records 2 h and 30 d behind the cursor (S12-Q18) | a behind run re-scans `[t - 730 d, c]`, both imported, list empty, `complete` false | fiat, "re-scans the last two years on the run after a forward read, so a late record is imported" | forward `[c, t]`, neither read, the list grows |
| FQ2 | the run after FQ1 | forward `[c, t]`, `complete` true | fiat, "reads forward again on the run after the re-scan, and reports complete" | `complete` false |
| FQ3 | orders, first walk from the floor | cursor now at run 6 (calls `[2 x 6]`); 2 calls on every run, complete from run 10: an owed day on runs 5, 8 and 10, the re-scan on runs 7 and 9, then on every run (runs 7 to 10 are behind runs with an empty forward window: the test clock stands, S12-Q23) | fiat, "reads every two-year window from the floor, empty ones too" and "alternates the owed days and the last two years behind once it reaches now, until both are read" | complete on run 14 (calls `[2,2,2,2,2,2,2,0,2,0,2,0,2,0]`, S12-Q22) |
| FQ4 | orders, stored list unreadable (repaired to `{floor, cursor}`) | the owed windows on runs 1, 4, 6 and 8, the forward read on run 2, the re-scan on runs 3, 5 and 7; complete from the 8th | fiat, "clears the repaired range over alternating owed and re-scan runs, then reports complete" | complete on run 14 (a forward run after each behind run, S12-Q22) |
| FQ10 | orders, a range that no read clears (a page that drifts; a page that throws) | the run after a behind run reads forward: a new order imports on run 2, the cursor advances on every forward run; the drift is logged (`fiat-page-drift`), the throw rejects the run (runs 1 and 5 of 6) | fiat, "reads forward after every behind run, so a new order imports on the second run" and "fails the run on a window whose page cannot be read, and reads forward on the next" | every run a behind run, no new order |
| FQ11 | orders, owed ground older than Binance serves (-5026) | read as empty by the `DepthGuard` narrowing, one series on each owed run (runs 1 and 5 of 6, the re-scan on run 3); the range leaves the list; nothing logged | fiat, "reads ground older than Binance serves as empty, one series on each owed run" | (not measured) |
| FQ12 | the `behindRun` and `rescanTurn` marks | `behindRun` true after a behind run and false after the forward run; `rescanTurn` true after an owed run, false after a re-scan run, kept by the forward run; each read as absent unless `true`; each round-trips through a walk patch; a disconnect drops both; a stored `behindRun` with no `rescanTurn` reads as a behind run whose next behind run reads the owed windows (the order of the build before it) | fiat, "stores that a behind run ran, and clears it on the forward run after", "reads forward when the last run read behind, though the list still holds a range", "alternates the owed range and the last two years on the behind runs, a forward run between", "reads a stored behind mark with no re-scan mark as a behind run, and reads the owed range after"; `walk-state.behind-run.test.ts`, "the %s mark of a walk" and "the turn marks of a walk" | no `rescanTurn` mark |
| FQ13 | orders, a range that no read clears and a record Binance writes late (S12-Q22) | the record, 30 days behind the cursor and served from run 2, is imported on the re-scan run (run 3 of 4) | fiat, "imports a record written late on the re-scan run, though the owed range is never cleared" | never imported |
| FQ14 | orders, no forward ground to read: the clock stands at the cursor, or is set back to before it (S12-Q23) | the run reads behind: the re-scan of `[t - 730 d, t]` on every run while nothing is owed, a late record served from run 3 imported on run 3, and the cursor stays where it is after a set-back; a run that follows a behind run reads behind too; `complete` is true when no range is left owed and the re-scan finished its pass, false when a range remains | fiat, "re-scans the last two years on every run while the clock stands, so a late record is imported", "re-scans when the clock is set back to before the cursor, and leaves the cursor where it is", "reads behind after a behind run too, as a forward turn with nothing to read gives way", "reports complete when the read leaves no range owed and the re-scan finished", "reports unfinished when a range is still owed after the read", "resumes the re-scan at its stored mark, and reports complete once the pass is finished" | a forward turn reads nothing and the walk never re-scans |
| FQ15 | orders, a re-scan read that fails: one owed day in the last two years, a page that drifts; a page that cannot be parsed (S12-Q24) | the day is marked stuck (`rescanStuck`, `fiat-rescan-stuck` logged); the re-scan reads before it and after it (runs 3 and 5), the owed run reads it on its own (runs 2 and 4); the records on both sides import and the day stays owed; the unreadable page does not fail the re-scan run (its owed run rejects as before) | fiat, "marks the owed range stuck on a page that drifts, and reads the ground around it", "marks the owed range stuck on a page that cannot be read, without failing the re-scan run" | the drift owes the whole window and the unreadable page fails the re-scan run on every pass: nothing past the day is re-scanned |
| FQ16 | orders, a stuck day that reads again; a failing span that holds no owed range; a failure that is no unreadable page; fiat payments | the owed run reads the stuck day on its own, the list loses it, the mark clears on the next run and the re-scan reads the whole window again; a point that fails halves the window down to a span of one millisecond, kept across runs by the span hint, marked stuck and owed on the 73rd run at a standing clock, the record before it imported on run 2 and the one after it on run 75; a network failure fails the run; the payment walk (a lane of 10) reads before, after and around the day in one run | fiat, "reads the stuck range on its own in the owed runs, and reads over it once it is clear", "halves a span that fails and holds no owed range, down to the millisecond that fails", "keeps a failure that is not an unreadable page, and fails the run on it", "reads around the owed range in the one run of the payment walk, which has the calls for it" | (not measured) |
| FQ17 | the `rescanStuck` mark | read as a list of ranges, absent when empty or unreadable; round-trips through a walk patch and an empty list clears it; a disconnect drops it | `src/crypto-sync/exchange/walk-state/walk-state.rescan-stuck.test.ts`, "the rescanStuck mark of a walk" | no mark |
| FQ18 | the engine, an owed range or point whose window throws the unreadable-page error (S12-Q27, S12-Q29): a plan of a forward window, three owed ranges, a re-scan window and two points | the run reads every other window (the owed ranges after it, the re-scan, the points), moves the round-robins past the unreadable window (`markRangeRead`, `markPointRead`) and rejects with the first such error; an unreadable window of the forward pass or the re-scan ends the run as before | `src/crypto-sync/exchange/walk/walk.unreadable-window.test.ts`: "goes on to the next owed window, the re-scan and the points past an unreadable owed range", "%s", "stops the run at an unreadable window of the %s pass, as before", "still lets the budget end the owed windows past an unreadable one" | the first unreadable owed window rejects the run: the owed ranges after it, the re-scan and the points are never read |
| FQ19 | the engine, any other failure in an owed window (a 429, a 418, an auth failure, a clock skew -1021, a network failure), and no test given | the run stops at once with no further call (more calls extend a ban) and rejects with it; with no `isUnreadableWindowError` given, an unreadable owed window stops the run too | same, "stops the run at once with no further call: %s", "stops the run at an unreadable window as well when no test is given" | (same: no window past the failure is read) |
| FQ20 | `isUnreadableWindowError` of Binance (S12-Q29), and every Binance walk | true for `BinanceHistoryParseError`, false for a 429, a 418, a rejected key, a clock skew, a network failure and a value that is no error; all eight walk entries (convert, transactions, P2P, transfer, pay, earn, fiat orders, fiat payments) run their plan with that one function | `binance.walk-config.test.ts`: "is true for the unreadable page of a window", "is false for %s", "is false for the non-error %p"; `binance.walks.unreadable-window.test.ts`: "runs its plan with the Binance test of an unreadable window" | (no test) |
| FQ21 | fiat orders and fiat payments, an owed day inside the 2-year window whose page always throws (S12-Q27) | payments imports a record 45 days behind on its first run, orders on its third (the re-scan turn); every run that reads the day rejects with the unreadable-page error, and the runs that do not read it resolve; a second owed range behind the unreadable one is read in the same run and its record imported, the unreadable one stays owed | `binance.fiat-history.owed-ground.test.ts`: "does not keep a late record of the 2-year window from being imported", "rejects with the unreadable-page error in every run that reads the owed day", "reads the owed range behind it and imports its record" | payments never imports the record and neither walk reads the range behind the unreadable one |
| FQ22 | fiat orders and fiat payments, a stuck range that reads again, owed ground that shares only its boundary millisecond with the range (S12-Q28) | the sliver the re-scan leaves between a read around the range and the range does not hold the range: the payments walk clears the owed range and the `rescanStuck` mark in 3 runs, the orders walk in 32 (measured: the lane reads one span a run and the re-scan reaches the range once in a few runs) | same, "clears the pending range and the stuck mark of fiat payments in 3 runs", "clears the pending range and the stuck mark of fiat orders" | the mark stays for ever and `fiat-rescan-stuck` is logged on every run |
| FQ23 | fiat payments over generated statuses, the three clocks of the suite (S12-Q28) | each settled record imported once at its exact amount, each refusal listed once, the walk ends current | `binance.fiat-history.properties.test.ts`: "the $kindName walk over generated statuses, runs $gapMs ms apart" > "imports each settled record once at its exact amount, lists each refusal once, and ends current: seed %i" | seeds 55 and 121 (1 h apart) and 55, 110, 121, 231, 253, 275 (1 day apart) fail |
| FQ24 | fiat payments and fiat orders, a re-scan over several runs with 2 drifting owed days in the 2-year window and a third behind it, the clock 1 ms apart per run, a record 39 days behind served from run 9 (S12-Q30) | the payments pass ends on run 2 (its 5th read, `2z + 1` for z = 2, 2 re-scan reads a run; run 4 before S12-Q32) and the mark is the history floor again; the record is imported within 5 runs of the run that serves it (1 x (2z + 1); 10 before S12-Q32) (orders: the pass ends on run 18, within 20); a re-scan hint that ends at or past the window end is dropped, a narrowing after a failed read is kept | `binance.fiat-history.owed-ground.test.ts`: "$name: a re-scan that goes on over several runs" > "imports a record served part way through it within the bound", "starts the pass again at the history floor once it has read to its end" | payments: the mark stays at the cursor plus 2 ms, one clock gap short of the pass's end, and the record is never imported (orders pass, unchanged) |
| FQ25 | fiat payments, a re-scan window with one failing day half a day after its start, the clock standing, 1 ms and 1 h apart per run (S12-Q32) | the first pass is 3 re-scan reads (`2z + 1` for z = 1: the read that fails and marks the day, the piece before it, the piece after it that runs to the window end), ends within 3 runs, and the next pass is 2 reads (`z + 1`) | `binance.fiat-history.owed-ground.test.ts`: "fiat payments: a re-scan window with one failing day, runs %i ms apart" > "reads the first pass in 3 reads and the next one in 2" | the piece after the day ended at the end of the doubled span it was read in: 4 re-scan reads in the first run, the pass ended on run 5 |
| FQ26 | fiat payments and fiat orders, two drifting days three days apart and 2 x (page rows + 1) rows in the hour after the first, the clock standing; and the same world from a re-scan mark two milliseconds short of the first day, a millisecond short of it, at its start and at its end (S12-Q33) | every record is imported (the full pages, one between the days and one after them), payments in 7 runs and orders in 30, the test reads 30 and 100; a window that starts at a stuck day or a millisecond short of it starts after the day | `binance.fiat-history.owed-ground.test.ts`: "$name: a full page of rows right after a stuck day" > "imports every record of the world", "imports every record of the world from a re-scan mark $name" | no record of the world imported in 30 and in 100 runs, the mark stays a millisecond short of the first day; a mutant that starts the skip at the day (not a millisecond short of it) or ends it before the day's end fails the matching row |
| FQ5 | orders, forward ground one window or more, a range owed | forward run first; at exactly one window, forward and not complete; a millisecond under, a re-scan | fiat, "reads forward first and leaves the owed range for a later run", "reads forward at exactly one window behind, and is not complete while a range was owed", "re-scans at a millisecond under one window behind" | (same for the first; no turn) |
| FQ6 | fiat payments, current | forward and re-scan in one run, unchanged | fiat, "reads forward and re-scans the last two years in the same run" | (same) |
| FQ7 | orders, an owed point and no range | forward run; the point on the 3rd call, in a forward and in a re-scan run | fiat, "reads forward when the list holds no range, though a point is owed", "reads an owed point on the third call of a forward run and of a re-scan run" | the 3rd call never spent by a re-scan |
| FQ8 | orders, forward run that starts with the re-scan mark at the floor, absent, or part way | complete, complete, not complete | fiat, "reports a forward read that starts with the re-scan at %s as complete: %s" | complete never |
| FQ9 | a re-scan run (forward hint stored), and a forward run and an owed run (re-scan hint stored) | a re-scan run drops the forward hint (`hintsOfPlan`) and the forward read after it still reaches now; a forward run and an owed run keep the re-scan hint, the hooks of the fiat walk keep it where the engine would drop it (S12-Q35) | fiat, "drops the forward hint on a re-scan run, and the forward read after it still reaches now", "keeps the re-scan hint on a forward run", "keeps the re-scan hint on a run that reads the owed windows" | the re-scan hint dropped on a forward run and on an owed run, so a re-scan that left a full page part way through its halving started it again (S12-Q35) |
| RW1 | the arm run | the walks in spec order, the P2P and fiat walks after dust and before trades; each failure logged by its own tag | `src/crypto-sync/run-crypto-sync/run-crypto-sync.test.ts`, "runs the walks in order, capital, Pay, Transfer, Earn, Convert, the dust read, P2P, fiat orders, fiat payments, then the trade read, all on one run object" | dust then trades |
| RW2 | the P2P walk rejects with `BinanceHistoryParseError` (modelled on "still resolves with the balance result when the Convert walk fails, logging only its name") | logged under `[binance sync] p2p history failed` with name and code only; the balance result resolves | same file, "still resolves with the balance result when the P2P walk fails, logging only its name" | - |
| RW3 | RW2 (modelled on "runs the dust read even when the Convert walk failed: each logs its own failure") | the fiat order, fiat payment and trade reads still run; each logs its own failure | same file, "runs the fiat walks and the trade read even when the P2P walk failed: each logs its own failure" | - |
| RW4 | real SQLite: an account with a P2P page that cannot be read and a readable Convert record, two runs | both runs: the Convert row imports once, the P2P cursor stays, the failure logged each run, the fiat reads and the trade read still run | `binance.run-arm.real-sqlite.test.ts` (the run through `runCryptoSync` with the Convert, P2P and fiat walks real; it holds the mocks of the other walks once, for RW4 and RW5), "keeps importing the other walks while a P2P page cannot be read, and logs it on every run" | - |
| RW5 | real SQLite, five runs through `runCryptoSync`: the fiat orders re-scan cannot read an owed day of the last two years (a page that drifts; a page that cannot be read), the fiat payments walk and the trade read after it | `fiat-rescan-stuck` logged once on each of the five runs, code only (no order number, no time), the day stays owed and marked, the records before and after it import; the run rejects only on the owed runs, and only for the page that cannot be read (runs 2 and 4); the fiat payments and the trade read run on every run | same file, "logs the day a re-scan cannot read on every run while it stays stuck when %s, and runs the fiat payments and the trade read after it" | the code logged it on the run that marked the day only: 1, 0, 0, 0, 0 (the re-scan runs 3 and 5 read around the day silently) |
| FR1 | real SQLite, the fiat walks through the real repos | a deposit, a withdrawal with its fee, a card buy and a card sale land on Spot holdings with their markers and labels; later runs add nothing; a later read of a key refreshes the amount and keeps the marker and the note; a word the walk does not know is listed once | `binance.fiat-history.real-sqlite.test.ts`, "credits a successful deposit to the Spot fiat holding with the bank total", "debits a successful withdrawal by its amount and its total fee", "imports a completed card buy and sale on the Spot coin holding", "adds nothing when later runs read the same records again", "refreshes the amount of a stored record on its key and keeps its marker and note", "lists a deposit whose status Kiko does not know once, with no row, over three runs" | no real-SQLite fiat test |
| K-P | a `p2p`, `fiatOrders` or `fiatPayments` cursor null or a day behind | caption shown | `src/screens/account-detail/crypto-sync-section/binance-history-status.test.ts`, "shows the caption while the %s walk is behind" | hidden (not in `CAPTION_WALKS`) |
| MK1 | `p2pTotalCode`-style builder (G-8) on `4150`, `4145.85`, `4000.0`, `4150.001`, `abc` | `p2p:UAH:4150.00`, `...4145.85`, `...4000.00`, `amount-precision`, `amount-malformed`; each parses back | `src/transactions/untracked-counterpart/untracked-counterpart.test.ts`, "builds a %s code at the fiat scale from %s %s", "stops at the total %p of a tracked fiat with %s" | no builder |

## Pins this set changes ("was:" values)

Floor; the developer greps `LANE_CALL_CAPS`, `LANE_NARROWING_CALLS`, `COSTS`, `Record<BudgetLane`,
`invocationCallOrder`, `walkRunCounts`, `CAPTION_WALKS` and `walkCursorsOf` in every test file.

| Pin | File, test | Now | was: |
|---|---|---|---|
| Q1 | `binance.history-budget.test.ts` "holds the per-run call cap of each lane" | adds `p2p: 20`, `fiatOrders: 3`, `fiatPayments: 10` | no lane |
| Q2 | same, "holds the narrowing calls of each lane: only the Transfer lane has any" | adds the three at 0 | no lane |
| Q3 | same, "holds the Binance ceilings and per-call costs of the old withdraw rule" | adds `p2p`, `fiatOrders`, `fiatPayments` costs | no cost |
| Q4 | `run-crypto-sync.test.ts` "runs the walks in order, capital, Pay, Transfer, Earn, Convert, then the dust read, then the trade read, all on one run object" | retitled per RW1 | trades right after dust |
| Q5 | `run-crypto-sync.test.ts` `walkRunCounts` ("a walk state this build cannot read") | the three new walks at 0 | seven reads |
| Q6 | `binance-history-status.test.ts` `walkCursorsOf(...)` `toEqual([...])` | eight cursors | five |
| Q7 | spec section 7 TC/TW cells (step 1/14) | full titles and full paths | file-only and partial paths |
| Q8 | `binance.fiat-history.test.ts` "reads every two-year window from the floor, empty ones too" (orders) | 6 runs to now: calls `[2 x 6]`, cursors F+730, F+1460, F+2190, F+2920 (twice), now (S12-Q18, S12-Q21) | 5 runs: cursors F+730 ... now |
| Q9 | same file, "reads two-year windows forward from the history floor, oldest first, both types of each" and "reads every empty window and imports a record behind four of them" | the orders branch reads the queries of its forward runs only (runs 1-4 and 6; `forwardRuns`) | the first 10 queries of 5 runs |
| Q10 | same file, "writes the windows read before the limit, sets the cooldown and resolves" | the limit hits any read that does not start at the cursor (the orders run 2 is a behind run) | the read of the second window |
| Q11 | same file, "alternates the owed days and the last two years behind once it reaches now, until both are read" (was: "..., a forward run between, until both are read") | 12 runs, 2 calls on each, complete from run 10 (S12-Q23) | 14 runs, calls `[2,2,2,2,2,2,2,0,2,0,2,0,2,0]`, complete on run 14 |
| Q12 | same file, "clears the repaired range over alternating owed and re-scan runs, then reports complete" | 10 runs: the owed windows on runs 1, 4, 6 and 8, the forward read on run 2, the re-scan on the others; complete from run 8 | 14 runs, a forward run after each behind run, complete on run 14 |
| Q13 | same file, "keeps the re-scan hint on a forward run" (S12-Q35) | the stored re-scan hint is the same after a forward run | "drops the re-scan hint on a forward run": the hint was `[]` after it |
| Q14 | `binance.history-budget.test.ts` "caps the %s lane at %i calls" (the `p2p` row) | cap 20 (S12-Q7) | cap 10 |
| Q15 | `binance.p2p-history.test.ts` "reads 30-day windows forward from the history floor, oldest first, both sides of each" | 20 queries, 10 windows | 10 queries, 5 windows |
| Q16 | same file, "reads every empty window and imports an order behind eight of them" | one run reads windows 0-8 and imports the order | two runs, the order on the second |
| Q17 | same file, "reaches the first UA-1 order by run 8 and the newest by run 12 at the lane cap" (was: "... by run 15 and the newest by run 23 ...") | 12 runs, queries within 20 | 23 runs, queries within 10 |
| Q18 | same file, "spends the whole lane on each of the first 11 runs and reports none of them finished" (was: "... first 22 runs ...") and "reads both sides of a window or neither" | 11 runs of 20 calls; rooms 20 / 4 / 3 / 2 / 1 / 0 read 10 / 2 / 1 / 1 / 0 / 0 windows; "keeps a read of both sides for the re-scan beside the owed ground it reads first" spends 15 of the 20 | 22 runs of 10 calls; rooms 10 to 0 read 5 windows or fewer; spends 5 of the 10 |

## Files (measured floor; the developer measures the real list)

Mutable source files (`mutable_source_files` in `scripts/checks/mutation.sh`; `index.ts`, tests and
`-test-fixtures.ts` excluded), at least 7, cap 30: `binance/binance.p2p-history.ts` (new),
`binance/binance.fiat-history.ts` (new), `binance/binance.history-client.ts`, `binance/binance.history-budget.ts`,
`run-crypto-sync/run-crypto-sync.ts`, `src/transactions/untracked-counterpart/untracked-counterpart.ts`,
`src/screens/account-detail/crypto-sync-section/binance-history-status.ts`, and (S12-Q21) `exchange/walk-state/walk-state.ts`
(the `behindRun` mark, and the `rescanTurn` mark of S12-Q22). Step 1/14 is test-only and adds no
mutable file. Spec row 12/15 says about 7. The number that counts is `KIKO_MUTATION_BASE=79094ae8 make mutable`
(step 14/14). Above 30: stop and split.

---

### step 1/14: the first test commit (set 11 survivors and the spec test-row doc test; test and doc only)

Source: `.superpowers/sdd/binance-set11/gate-triage.md`, "SET 12 FIRST TEST COMMIT CARRIES" (ids from that gate's
`reports/mutation/mutation.json`; mutated text in `gate-survivors.txt`). `th` = `binance.trade-history.ts`. No app
change; every suite green. Proof per group (G-14): hand-apply the mutant(s) of the group (the `+` line in
`gate-survivors.txt`), run the target file, quote the red count, Edit back, `git diff --exit-code` on the source.
The set 12 gate mutates only set 12's changed lines, so it does not re-prove these: the manual proof is the record.
Commit body: one line per id, "killed by <title>, red <n>".

Files: `binance.trade-history.real-sqlite.test.ts`, `binance.trade-history.rows.test.ts`,
`binance.history-client.my-trades.test.ts`, `binance.trade-history.test.ts` (one assertion only),
`binance.trade-history.state.test.ts` (new), `binance.trade-history.failures.test.ts` (new),
`binance.trade-history.seams.test.ts` (new), `binance.trade-test-fixtures.ts` (shared fakes moved or added if the
new files need them), `__tests__/spec-test-rows.test.ts` (new), the spec (TC/TW cells only).

PRIORITY (4 groups, 5 ids; the triage counts 83 among its 24 killable):
- [ ] 232 (`exchangeStateDepsOf('binance')` -> `('')`): real-sqlite, "stores the cursor of the symbol in the account
      sync state, so the next run reads on from it" (after fills 1-2, stored `trades.symbols.BTCUSDT.fromId === 3`;
      run 2's first `fetchMyTrades` asks `fromId` 3).
- [ ] 237 (default `ensureHoldings` -> no-op): real-sqlite, "creates the Spot holding of a bought coin the account
      has none of and writes the leg on it".
- [ ] 426 (`writeCursor(read, { fromId })` -> `{}`): state, "stores the cursor with the release of a held order
      when the lane has no room left for a page of fills" (state `{ fromId: 3, heldOrderId: A }`, fills
      `[1 A, 2 B, 3 A]`, `runAfterCalls` 98; expect `{ fromId: 3 }`, no `fetchMyTrades`).
- [ ] 81, 83 (`tracked.units === 0` -> false): rows, "writes no lone leg when the tracked coin of an order with an
      untracked coin rounds to nothing" (PEPEXRP, qty 1000, quoteQty 0.00004 -> rows `[]`, untracked `['PEPE']`).

KILLABLE (14 groups, 23 ids):
- [ ] 61, 63, 47 (th `marker === undefined`, colon ticker): failures, "stops the symbol with an unreadable row for
      an untracked ticker with a colon" (baseAsset `'A:B'`, code `trade-row-unreadable`).
- [ ] 48: failures, "stops with the holding-missing code when no Spot holding can be found" (ensureHoldings no-op,
      BTC touched by a stored cursor; assert `trade-holding-missing`).
- [ ] 4 (`PLAIN_DECIMAL_PATTERN` optional fraction): my-trades, "reads a whole-number text for %s" (`qty`,
      `quoteQty`, `commission` = `'12'`).
- [ ] 179 (`some` -> `every`): rows, "stops an order when one of its two fills is negative" (call
      `tradeOrderRowsOf` directly).
- [ ] 265, 267: failures, "fails only the symbol whose re-read answers no fill and reads the symbols after it".
- [ ] 460, 462, 463: failures, "keeps the oversized history list through a rate limit and a stop with no ticker"
      (seed `['DOGE']`).
- [ ] 416: add `expect(failureLogs()).toEqual([])` to the existing "stops at a fill that came after the re-read and
      reads the order again next run" (`binance.trade-history.test.ts`; no other growth of that file).
- [ ] 423: state, "drops a held order from the rowless set when its release writes rows".
- [ ] 279: state, "takes an order the cursor passed as imported without a prefix lookup".
- [ ] 337, 339: state, "writes no coin list patch for a page whose coins are all tracked".
- [ ] 526: state, "writes no cursor patch for a caught-up symbol that reads an empty page".
- [ ] 532, 534: state, "writes no state patch when the run changed no rotation or snapshot".
- [ ] 233 (default `now`): seams, "reads the clock when no now is passed" (spy `Date.now`, cooldown set -> no
      `fetchExchangeSymbols`).
- [ ] 239, 240, 478: seams, "passes the options and the fetch seam through to every read".

Doc test (k), `__tests__/spec-test-rows.test.ts`, title "each Test cell of the spec names an existing test file
and titles found in it":
- [ ] Parse every table of spec section 7 whose header's last cell is `Test`. In a cell: a backticked name ending
      `.test.ts` or `.test.tsx` is a file; a bare name resolves to `src/crypto-sync/binance/<name>`; a name starting
      `src/` resolves as is; any other name with `/` fails (S12-Q2 A). A cell that starts `same` and names no file
      takes the previous row's first file. Each `"..."` is a title and must equal the first-argument literal of an
      `it`, `test` or `describe` call (also `.each(...)(`) in the file named last before it in the cell, compared
      as the source text without its quotes. A row with no title fails (S12-Q1 A).
- [ ] Measured on the base: 24 rows (TC1-TC4, TW1-TW3, TW5-TW21; there is no TW4). 4 rows quote no title: TC1,
      TC4 (`same` only), TW15, TW16; TW20 also names `walk-state.rowless-orders.test.ts` with no title. Cells whose
      bare name is not in `binance/`: `disconnect.real-sqlite.test.ts`, `walk-state.rowless-orders.test.ts`;
      partial path: `run-crypto-sync/run-crypto-sync.test.ts`. In the same commit, Edit those cells to full `src/`
      paths and add one exact existing title to TC1, TC4, TW15, TW16 and to the TW20 walk-state file (G-2, pin Q7).
- [ ] Unit cases on in-memory table text: a `same` row, a bare name, a `src/` path, two files in one cell, a
      missing file, a missing title, a row with no title. The test reads files with `node:fs` only and holds no
      `@kiko/` text (`__tests__/harness-tests-do-not-depend-on-src.test.ts`).
- [ ] Load-bearing: Edit one quoted title in the spec, run, quote the red, Edit back. `make doc-suites` lists the
      new suite (it reads `docs/`); if not, report to the coordinator.
- [ ] Check: `npx jest <each touched test file, literal> __tests__/spec-test-rows.test.ts
      --testPathIgnorePatterns=.stryker-tmp` green; `dup.sh` alone on each new file; `make doc-suites` green.
      Commit `test(binance): kill the set 11 trade survivors and tie spec test rows to titles`.

### step 2/14: Binance doc quotes (orchestrator or researcher; no code)

Output `.superpowers/sdd/binance-set12/fiat-doc-quote.md`: for each source, the URL, the fetch date, the exact lines
(curl to the scratchpad, quote line by line; WebFetch paraphrases, set 11 lesson 3).
- [ ] Try in order (planner pre-check 2026-10-23: rows 1-4 answered 200; developers.binance.com answered empty to
      curl, a bot-checked page):
      1. `https://raw.githubusercontent.com/binance/binance-connector-java/master/clients/fiat/docs/GetFiatDepositWithdrawHistoryResponseDataInner.md`
         (has `status`: "Processing, Failed, Successful, Finished, Refunding, Refunded, Refund Failed, Order
         Partial Credit Stopped"; the field is `totalFee`, there is no `fee`);
      2. `.../clients/fiat/docs/GetFiatPaymentsHistoryResponseDataInner.md` (`status` with no values listed);
      3. `.../clients/c2c/docs/GetC2CTradeHistoryResponseDataInner.md` (`orderStatus`, `tradeType`,
         `advertisementRole` with no values listed) and `.../clients/c2c/docs/DefaultApi.md` (parameters
         `startTimestamp`, `endTimestamp`, 30-day span; it states "Weight(IP): 1" and "past 6 months", both
         contradicted by probes 3-5: UID 900, rows to about 2023-09; measured wins);
      4. `https://raw.githubusercontent.com/binance/binance-connector-js/master/clients/fiat/src/rest-api/types/get-fiat-deposit-withdraw-history-response-data-inner.ts`
         and `.../get-fiat-payments-history-response-data-inner.ts` (same text);
      5. `https://raw.githubusercontent.com/binance/binance-api-postman/master/collections/Binance%20Fiat%20API.json`
         and `.../Binance%20C2C%20API.json` (parameters only);
      6. `https://developers.binance.com/docs/fiat/rest-api/Get-Fiat-Deposit-Withdraw-History`,
         `.../Get-Fiat-Payments-History`, `https://developers.binance.com/docs/c2c/rest-api/Get-C2C-Trade-History`:
         bot-checked; the user pastes the page text if S12-Q4 asks for it.
- [ ] Record, per word: `Failed` and `Refunded` (orders and payments), `Successful`, `Completed`, `Processing`, the
      P2P five open words: the quoted text, or "no doc text found". A word is ignored only with text showing no
      money moved (C-NR-E); a bare list entry is not that (S12-Q3).
- [ ] Write the quote file; do not commit it (S12-Q14: `.superpowers/` is gitignored and main tracks none).

### step 3/14: probe 10 (user; read-only; gates only steps 12/14 and the P2P cap)

- [ ] Orchestrator writes `binance-p2p-probe-10.sh` beside probe 9 (`.superpowers/sdd/binance-set11/
      binance-trades-probe-9.sh` is the model: its guards, read-only key check, no secret in output, counts only):
      the P2P first walk forward from `HISTORY_FLOOR_MS` in 30-day windows x 2 series at the 350 ms gate, with no
      lane cap: calls, wall time, `X-SAPI-USED-UID-WEIGHT-1M` peaks, throttle waits, the window index of the oldest
      and newest order, and the runs at caps 10, 20, 40 (S12-Q8). Also one page each of fiat orders and payments
      (counts and status words only). Write the script in `.superpowers/sdd/binance-set12/`; do not commit it
      (S12-Q14). The user runs it; the output goes to `memory/refs/` (main checkout).
- [ ] Steps 4/14-11/14 do not wait for it (cap 10 stood until it reported; S12-Q7 then ruled cap 20).

### step 4/14: the P2P and fiat lanes

Files: `binance.history-budget.ts`, `binance.history-budget.test.ts`.
- [ ] Tests first: Q1, Q2, Q3; BL1, BL2, BL3. Red count quoted.
- [ ] Code: `'p2p' | 'fiatOrders' | 'fiatPayments'` in `BudgetLane`; caps, narrowing calls, both counters in
      `createBinanceRunBudget`; `COSTS.p2p`, `COSTS.fiatOrders`, `COSTS.fiatPayments` (G-6). Grep `Record<BudgetLane`.
- [ ] Verify on the base and write in the commit body: `readSeriesSpan` asks `canAfford(lane, cost, keep +
      series.length - 1)` before a window, so a two-series window needs 2 calls and a lane of 3 reads one window a
      run (S12-Q6); a fiat-orders run reads forward or behind, not both (S12-Q18), and a forward run follows a behind run (S12-Q21).
- [ ] Check: suite green; `tsc` clean. Commit `feat(binance): P2P and fiat lanes`.

### step 5/14: the fiat marker builder

Files: `untracked-counterpart.ts`, `untracked-counterpart.test.ts`, its barrel.
- [ ] Tests first: MK1 for `p2p`, `card`, `bank`; an unknown fiat code (S12-Q12): the total kept as sent after a
      plain-decimal check, and `parseUntrackedCounterpart` gives the fiat with no total. Red count quoted.
- [ ] Code: `fiatTotalCode(kind, fiat, totalText)` returning the code or the stop code (an `Either`), through
      `decimalToMinorUnits` at `currencyScale[fiat]`; the caller turns the stop into `BinanceWalkStop`.
- [ ] Check: suite green; `tsc`, knip clean (consumer: the test, then step 7/14). Commit
      `feat(transactions): build the fiat total codes`.

### step 6/14: the P2P read

Files: `binance.history-client.ts`, `binance.history-client.p2p.test.ts` (new).
- [ ] Tests first: PC1-PC4, PC2b, PC5. Red count quoted. Empty shape: a null or absent `data` reads as an empty
      page only when `total === 0`; any other `total` throws `BinanceHistoryParseError` (approved fix, its own
      commit; S12-Q15).
- [ ] Code: `BinanceP2pOrder` (`orderNumber`, `tradeType`, `asset`, `fiat`, `amount`, `totalPrice`, `orderStatus`,
      `createTime`, `takerCommission`, `takerAmount`, `advertisementRole`; optional texts stay `undefined` when
      absent, so C-P5 can tell absent from present), `fetchP2pOrders(apiKey, secret, side, span, page, options)`
      returning a total page with the UID header, `P2P_PAGE_ROWS = 100`.
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): read P2P order history`.

### step 7/14: the P2P decision per order

Files: `binance.p2p-history.ts` (new), `binance.p2p-history.outcome.test.ts` (new).
- [ ] Tests first: P1-P1h, P2-P2d, P3, P3c, and the row fields (holding key on Funding, key, marker, comment,
      `operation`, `exchangeExcludedTransactionIds` over the rows: none excluded except as the spec's Statistics
      column says). Exact minor units per the matrix. Red count quoted.
- [ ] Code: `p2pOutcomeOf({ accountId, order })` -> `{ kind: 'row' | 'refused' | 'owed' | 'none' | 'untracked' }`
      per the Decisions, one `match` per step, `P2P_OPEN_STATUSES` as a constant.
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): decide each P2P order`.

### step 8/14: the P2P walk

Files: `binance.p2p-history.ts`, `binance.p2p-history.test.ts` (new), `binance/index.ts`.
- [ ] Tests first: P3b, P3d, P4b, P5, P6, P7, P7b (fake walk over the UA-1 shape: 113 windows x 2 series, first
      order at window 75, newest at 113; count calls in the fake), P8, P8b, P10, PW1-PW4, PW5b, PW6, PW7. Red count quoted.
- [ ] Code: `syncBinanceP2pHistory({ targetAccountId, run }, overrides)` with `BinanceP2pHistoryDeps`; cooldown ->
      credentials -> `readWalkMarks(deps, accountId, 'p2p')` -> `planWalkPasses` (`P2P_WINDOW_MS`, `maxWindows` =
      the lane's windows a run) -> `runWalkPlan` with `canAfford: keep => run.budget.canAfford('p2p', COSTS.p2p,
      keep)` -> `walkSpans` -> `readSeriesSpan` (series BUY, SELL; depth guard) -> `commitSettledSpan` with
      `writeNotImported`, `forwardOwes` holding the P2P owed codes. A rate limit sets the cooldown and resolves.
- [ ] Check: suites green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): walk P2P order history`.

### step 9/14: the fiat reads

Files: `binance.history-client.ts`, `binance.history-client.fiat.test.ts` (new).
- [ ] Tests first: FC1-FC3; "keeps the status text as Binance sent it, spaces and case included" (`Refund Failed`,
      `Order Partial Credit Stopped`, ` Successful`: the read never trims or folds case, S12-Q13). Red count quoted.
- [ ] Code: `BinanceFiatOrder` (`orderNo`, `fiatCurrency`, `indicatedAmount`, `amount`, `totalFee`, `status`,
      `createTime`), `BinanceFiatPayment` (`orderNo`, `sourceAmount`, `fiatCurrency`, `obtainAmount`,
      `cryptoCurrency`, `status`, `createTime`); `fetchFiatOrders`, `fetchFiatPayments`; rows 500 / 100.
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): read fiat orders and payments`.

### step 10/14: the fiat walks

Files: `binance.fiat-history.ts` (new), `binance.fiat-history.test.ts` (new), `binance/index.ts`.
- [ ] Tests first: F1, F2, F3, F3b, F4, F4b (exact match, S12-Q13), F5, F6, FW1; per-record owed point for `Processing`; a `fiatCurrency` or
      `cryptoCurrency` the tracked rule refuses (listed, no row); an amount past the scale (`amount-precision`).
      Exact minor units. Red count quoted.
- [ ] Code: one walk body taking the walk id, lane, cost, window, series (`'0'`, `'1'`), the read and the outcome;
      `syncBinanceFiatOrderHistory` and `syncBinanceFiatPaymentHistory`; `FIAT_ORDER_STATUSES` and
      `FIAT_PAYMENT_STATUSES` per step 2/14.
- [ ] Check: suites green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): walk fiat orders and payments`.

### step 11/14: wiring, caption, real SQLite, properties, the not-imported line

Files: `run-crypto-sync.ts`, `run-crypto-sync.test.ts`, `binance-history-status.ts`, `binance-history-status.test.ts`,
`binance.p2p-history.real-sqlite.test.ts` (new), `binance.fiat-history.real-sqlite.test.ts` (new),
`binance.p2p-history.properties.test.ts` (new), `binance.fiat-history.properties.test.ts` (it holds the fiat
orders worlds of S12-Q22, FW2; this step adds the payments walk and the statuses to it),
`crypto-sync-section.component.not-imported.test.tsx`. Built (190f553f): the run through
`runCryptoSync` lives in `binance.run-arm.real-sqlite.test.ts` (RW4, RW5), so the mocks of the
walks it does not read are written once; the shared real-SQLite set-up, the seeded random and the
disturbances of the property runs are `src/test-support/binance-real-sqlite.ts`, `seeded-random.ts`
and `walk-disturbances.ts`; `fiat-rescan-stuck` is logged by every run that holds a stuck range
(`keepStuckMark`), not only the run that marks it (RW5).
- [ ] Tests first: RW1, RW2, RW3, RW4, PW8, Q4, Q5, Q6, K-P; real SQLite P4, P9 (the probe 3 shape: 77 COMPLETED BUY TAKER, 2
      CANCELLED, 1 CANCELLED_BY_SYSTEM), P11 (through `syncBinanceP2pHistory` then `syncBinanceConvertHistory`),
      F1-F3 through the real `transactionsRepo` (key upsert, markers insert-only, the run twice adds nothing); N5b.
- [ ] Properties through the production callers (memory "property suite must call production caller"), seeds
      30-40, the seed printed on failure, one describe per clock gap 0 / 1 h / 1 day (`RUN_GAPS`, as
      `binance.convert-history.properties.test.ts`). Generate: orders over random windows and both series, every
      status (open ones turning COMPLETED or CANCELLED between runs), SELL, MAKER, both-absent amounts, a fiat asset,
      an untracked asset, random lane room, a per-run thrower window, random 429s. Assert once no record changes and
      enough runs pass: each COMPLETED BUY TAKER tracked order stored once per key with the exact amount; each
      refused order exactly one entry of its kind; no entry for an open or cancelled order; no row for a refused
      one; the cursor reaches now; calls within the lane per run; a cooldown run sends nothing. Fiat: the same for
      both walks. Show load-bearing: break the status-first order (side before status) and the entry dedupe; quote
      the failing seed counts; Edit back.
- [ ] Code: `runBinanceHistoryWalks` runs P2P, fiat orders, fiat payments after dust and before trades; the trade
      read's "Last" comment stays; `CAPTION_WALKS` adds the three walks (S12-Q9).
- [ ] Check: suites green; `tsc`, knip clean; `dup.sh` alone on each new file. Commit
      `feat(binance): run the P2P and fiat walks after the dust read`.

### step 12/14: spec alignment and the set 12 rulings

Files: the spec.
- [ ] Record S12-Q1 ... S12-Q15 in section 1 with their source (`rulings.md`, "Set 12 plan questions"). Align:
      section 5 fiat block (`totalFee`; "Order Partial Credit Stopped" as Binance writes it; the quoted words from
      step 2/14 with URL and date), the fiat-orders runs (6 to reach now, S12-Q6, S12-Q18 and S12-Q21) in "Measured weights" and F5, the P2P report
      from probe 10 and the cap it supports (R-Walk A), the P2P cover-rule owner (S12-Q10), section 7 new rows
      PC/FC/BL/PW/FW/RW/K-P/MK1 with a `Test` column (the step 1/14 doc test then checks them), section 11 row
      12/15 the measured file count. Point at constants (G-11).
- [ ] Lines within the spec's width; no phrase the `docs-known-limit` suite bans; `make doc-suites` green. Commit
      `docs(spec): set 12 rulings, P2P and fiat`.

### step 13/14: reviews, retrospect, scribe

- [ ] G1 = steps 1/14-7/14: `kiko:reviewer`. Top question: "does each survivor test kill its mutant (the recorded
      red), and can a P2P order give a row its status, side, role or amount should refuse, or a refused one give no
      entry?"
- [ ] G2 = steps 8/14-11/14: `kiko:reviewer`. Top question: "can any record be lost, imported twice, listed twice,
      or passed by a cursor while it is still open, across windows, series, re-scans, rate limits and crashes
      between rows and marks; and is each matrix row's test title real?" Brief it with the developers' deviations,
      the rulings, and the `__tests__/` invariant suites (`error-class-pins`, `full-word-identifiers`,
      `cited-paths`, `guard-tests-no-wall-clock`, `mutation-score-timeouts`, `spec-test-rows`).
- [ ] Whole-branch `kiko:reviewer` at the tip, step 12/14 included, BEFORE BATCH READY. No migration: no migration
      review.
- [ ] `kiko:retrospect` over both skill locations and `harness/kiko/agents/` (at least `kiko-architecture`'s
      Binance history paragraph: P2P and fiat walks, the run order; `kiko-domain` operation mapping), then
      `kiko:scribe` fixes and commits. Pointers, no copied lists. A `harness/kiko` change bumps the plugin version
      above 0.4.40. The report names the drift-fix sha or "no drift found".

### step 14/14: gates and BATCH READY

- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh check-all <worktree> "crypto-exchanges-1.3-a task
      12/15 check-all"` exit 0; agents wait for the result.
- [ ] Orchestrator, a count, not a queued job: `KIKO_MUTATION_BASE=79094ae8 make mutable`: quote the file list,
      `mutable files: N (cap 30)` and the timeout share line. Above 30: stop and split.
- [ ] Coordinator: `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task 12/15 deep" 79094ae8
      <head>` (`KIKO_MUTATION_BASE=79094ae8 make deep`), detached; agents await the exit code. TIMEOUT-HEAVY
      (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"): the gate's own rerun is the verdict; never raise
      the timeout.
- [ ] Coordinator: `make verify` once at the set tip through the queue (`bash scripts/job-queue.sh verify <worktree>
      "crypto-exchanges-1.3-a task 12/15 verify"`), tree clean, re-run until green.
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer verdicts, the scribe
      sha, the S12-Q rulings, the doc-quote file, the probe 10 report, and the step 1/14 kill records.

## Review focus

1. Order of the P2P checks: a SELL or MAKER that is still open listed early; a cancelled order with a commission
   imported; an unknown word on a later step treated as the earlier step's.
2. Amount: `takerAmount` present but `amount - takerCommission` compared at the wrong scale; an absent field read as
   `''` or `'0'` (C-P5 needs absent vs present).
3. Marker: a total recomputed from `amount x unitPrice`; a total normalized with `Number()`; a code that does not
   parse back.
4. Lanes: a window read on one series only; a P2P or fiat call not recorded; the fiat-orders UID check against a
   header another endpoint wrote.
5. Re-reads: the re-scan listing a refused order twice, or importing an order that is also listed.

## Pre-flight self-check (planner)

- No copy key, no screen change beyond `CAPTION_WALKS` (G-5). No migration (G-4).
- G-1 every step; G-2 steps 1, 4, 11; G-3 steps 4-11; G-6 step 4; G-7 steps 7, 10; G-8 step 5; G-9 steps 6, 9;
  G-10 steps 6, 8, 9, 10, 11; G-11 steps 12, 13; G-12 and G-13 every commit; G-14 steps 1, 11.

## Questions for the coordinator (S12-Q1 ... S12-Q15, S12-Q18, S12-Q21 ... S12-Q24, S12-Q27 ... S12-Q35)

Status (coordinator, 2026-10-23): Q1, Q2, Q4-Q9, Q12-Q15 = A, FINAL coordinator rulings (Q7 = cap 20 after probe
10); Q3, Q10, Q11 = A, USER CONFIRMED 2026-10-23; Q18 = C, Q21 = A (N = 1), Q22 = B, Q23 = B, Q24 = B, Q27 = the fix, Q28 = the
fix as the entry builds it, Q29 = A, Q30 = the fix, Q32 = the fix and Q33 = the fix, FINAL coordinator rulings;
Q34 = refuse and Q35 = A + B fiat-only, OVERNIGHT DEFAULT, pending user.

- S12-Q1 (A, FINAL coordinator ruling) a TC/TW row that quotes no title (TC1, TC4, TW15, TW16). A: the doc test fails such a row; step 1/14 adds
  one exact existing title to each. B: a file-only row passes when the file exists. Recommend A: a file alone ties a
  row to nothing (set 11 lesson 7), and four cells are cheap to fix.
- S12-Q2 (A, FINAL coordinator ruling) file resolution in the doc test. A: strict (bare name = `src/crypto-sync/binance/`, else a full `src/`
  path), and step 1/14 fixes the three cells that break it. B: find a bare name anywhere under `src/` (unique match).
  Recommend A: the table states the `binance/` default, and a search can match the wrong twin file.
- S12-Q3 (A, USER CONFIRMED 2026-10-23) `Failed` and `Refunded` (orders and payments). The planner found no Binance text that says no money moved;
  the orders doc only lists the words, the payments doc lists none. A: both stay `fiat-unrecognized` (owed and
  visible) unless step 2/14 finds such text. B: take the bare list as enough and ignore them. Recommend A: C-NR-E's
  rule as written; a refunded deposit may have moved money twice, and a wrong ignore is a silent loss.
- S12-Q4 (A, FINAL coordinator ruling) fiat payment statuses: no raw source lists them. A: keep the spec allowlist (`Completed` row, `Processing`
  owed, every other word `fiat-unrecognized`); the user pastes the developers.binance.com text into the quote file
  when convenient. B: refuse every payment until a quote exists. Recommend A: a wrong word only shows as a visible
  entry, never as a wrong row, and probe 3 saw no payment on the account.
- S12-Q5 (A, FINAL coordinator ruling) P2P `orderStatus` has no documented values in the raw docs. A: keep the spec's five open words; any other
  word is `p2p-unrecognized` (C-NR-A, binding). B: an unknown word owes its point every run (never final, invisible:
  owed points show no caption, K5). Recommend A: binding, visible; probe 10 lists the words the account really has.
- S12-Q6 (A, FINAL coordinator ruling) fiat-orders runs. `readSeriesSpan` needs room for both series before a window, so a lane of 3 reads one
  window (2 calls) a run: 5 runs for 10 calls, not the spec's 4, and the 3rd call is never spent. A: keep cap 3, the
  spec says 5 runs, F5 pins 5; BL2/BL3 pin the budget cases at `canAfford`. B: cap 4 (2 windows a run, 3 runs;
  4 x 45000 = 180000 only fits an empty minute). Recommend A: a cap changes only with a measured reason.
  The cap stays 3; the run COUNT is reversed by S12-Q18 and S12-Q21 (6 runs to reach now, F5 pins 6; was: 5).
- S12-Q7 (A, FINAL coordinator ruling) the P2P lane cap (R-Walk A). A: 10 until probe 10 reports; then the largest cap whose per-run UID peak and
  wall time the probe shows fit, recorded with the numbers. B: raise now from arithmetic (180000 / 900). Recommend
  A: "a cap changes only with a measured reason". Ruled after probe 10 (2026-10-23, 10:34 UTC): cap 20, a first
  walk of 12 runs (23 at cap 10), the longest run 17.4 s, a UID peak of 18000 in a minute; with the fiat orders
  lane (3 x 45000 = 135000) the two come to 153000, within the 180000 they share, pinned by BL1. Cap 40 was
  rejected: a 34 s run, 9000 of UID room left, and the fiat orders pushed to later runs.
- S12-Q8 (A, FINAL coordinator ruling) the measured P2P first-walk report. A: probe 10 (step 3/14, user, read-only) plus P7b computing calls and
  runs from the walk itself. B: P7b only. Recommend A: the spec asks for a measured report, and P7b uses probe 4's
  window index, not a fresh count.
- S12-Q9 (A, FINAL coordinator ruling) `CAPTION_WALKS`. A: `p2p`, `fiatOrders`, `fiatPayments` join it in set 12 (spec section 5: "The caption
  shows until each walk is current"; S8-Q5 did the same for Convert); a user sees the caption for about 12 syncs (23 at cap 10).
  B: set 15. Recommend A: the caption is the honest state while P2P history is still arriving.
- S12-Q10 (A, USER CONFIRMED 2026-10-23) the P2P cover rule (user, 2026-10-21: an outgoing USDT row covered by an earlier P2P BUY of that coin is
  not counted in Expenses by category). No set owns it in the spec. A: set 13, which adds the read-time statistics
  rules for P2P rows (`src/statistics/exchange-funding-match/`, the same `parseUntrackedCounterpart` input, M1-M14);
  its plan brings the user questions (partial cover, order, a send larger than the cover, Pay vs withdrawal). B:
  set 12. C: a follow-up after set 15. Recommend A: set 12 writes the rows the rule reads, set 13 owns statistics
  over them, and no build ships before set 15 (U1), so nothing reaches the user without it.
- S12-Q11 (A, USER CONFIRMED 2026-10-23) fiat withdraw debit. The documented fee field is `totalFee` (the spec says `fee`). A: `-(amount +
  totalFee)`, the spec text aligned; P6 stays open for a real row at device verification. B: `-indicatedAmount`.
  Recommend A: the spec's rule with the documented field; B has no source.
- S12-Q12 (A, FINAL coordinator ruling) a P2P `fiat` or fiat-payment `fiatCurrency` that is not a Kiko currency. A: the crypto row imports; the
  marker keeps the total as sent after a plain-decimal check (no scale to normalize to); the label renders and set
  13's matcher skips it (S7-Q3). B: refuse it into `p2p-unrecognized` / `fiat-unrecognized`. Recommend A: the
  crypto amount is exact and the fiat only feeds a label and a matcher that already skips it.
- S12-Q13 (A, FINAL coordinator ruling) the other documented fiat order words. A: `Finished`, `Refunding`, `Refund
  Failed` and `Order Partial Credit Stopped` stay `fiat-unrecognized` (owed and visible). The allowlist matches the
  status text exactly, spaces and case included (no trim, no case fold), pinned by FC "keeps the status text as
  Binance sent it, spaces and case included" (step 9/14) and F4 / F4b (step 10/14). A later set imports a word only
  with a real row or doc text. B: map `Finished` to settled. A is the ruling: no source says what `Finished` moved.
- S12-Q14 (A, FINAL coordinator ruling) `.superpowers/` files. A: they are never committed (gitignored; main tracks
  none; bb4207f2 untracked the two set 12 files); steps 2/14 and 3/14 write their files and do not commit them.
- S12-Q15 (A, FINAL coordinator ruling) a P2P record or page the reader cannot read. A: an order with no non-empty
  text `orderNumber`, or no safe-integer `createTime`, is unreadable (owed, visible; PC5, PW5b); any other decision
  field of the wrong type throws `BinanceHistoryParseError` for the page, so the run fails the P2P walk and the next
  run retries it (PC2, PW6, PW7). Condition: a page that throws on every run stays visible, never silent: logged
  each run (RW2, RW4), the history caption once the `p2p` cursor lags more than a day, as S8-C1 does for Convert
  (PW8), and the other walks of the run still run (RW3, RW4). A null or absent `data` is an empty page only when
  `total === 0`, else the page throws (PC2, PC2b; the developer's approved fix, its own commit). B: skip the
  record. A is the ruling: a skipped record behind a moving cursor is a silent loss.
- S12-Q18 (C, FINAL coordinator ruling) the fiat-orders window re-scan. A lane of 3 spends the whole run on the
  forward window, so the re-scan and every owed range were refused on every run: a record Binance writes late was
  never imported, the list of owed days only grew, and the lane broke the rule that every walk runs the window
  re-scan. A: leave it (a silent loss). B: fold the overlap day into the forward read (a change in the shared
  `planWalkPasses`, the TIMEOUT-HEAVY mutation file; reads one day back only, and a both-series range stays
  unread). C: alternate runs in `binance.fiat-history.ts` `runSync` only: a behind run (the owed days first, then
  the last two years) when the stored list holds a range and the forward ground is under one window, else a
  forward run; a run drops the other pass's span hints (`hintsOfPlan`; a forward hint is kept while the forward
  runs go on, and a read that commits nothing stores no overlap day). `complete` is true for a forward run that
  started with no range owed and the re-scan not part way through a pass. C is the ruling: it keeps the re-scan
  every walk runs, reads every owed range, changes no shared code, and costs latency only (the newest orders one
  run later; the first walk reaches now on run 6, not 5: F5, Q8, FQ1-FQ9). Payments (a lane of 10) read both in
  one run, unchanged.
- S12-Q21 (A with N = 1, FINAL coordinator ruling) a range that no read clears kept every fiat-orders run a behind
  run, so the newest orders never imported. A: after a behind run the next run reads forward (the walk stores
  `behindRun` in its `exchange_state` entry; no migration; a disconnect drops it with the other run marks). B:
  accept it. C: a forward run after N behind runs. A with N = 1 is the ruling: it needs one boolean, and the
  list still clears one window per owed run (S12-Q22 puts the re-scan between them). Measured (FQ10, FQ11): a page that
  drifts (`fiat-page-drift` logged each run) and a page that throws (the run rejects) both leave the range in the
  list and let the forward run import a new order on run 2; ground older than Binance serves is read as empty by
  the `DepthGuard` narrowing (-5026, C-NR-D), one series on each owed run, and leaves the list with nothing
  logged. The first walk reaches now on run 6 (F5, Q8); S12-Q22 moves the run it reports complete on (FQ3).
- S12-Q22 (B, FINAL coordinator ruling) a behind run read the owed windows first and the re-scan only when none
  was left, so a range that no read clears (a page that drifts or throws on every run) kept the re-scan out and
  a record Binance writes late (up to two years back) was never imported. B: the behind runs take turns on the
  owed windows and the re-scan, a forward run still follows every behind run (S12-Q21), and the list still
  clears one window per owed run. The turn is three states: forward, behind on the owed windows, behind on the
  re-scan. A mark that holds one of three states cannot say which behind run follows a forward run, so the walk
  stores two booleans in its `exchange_state` entry, `behindRun` (the last run read behind) and `rescanTurn` (the
  next behind run reads the re-scan); the forward run keeps `rescanTurn`, an owed run sets it, a re-scan run
  clears it, and a turn with nothing to read gives way to the other (FQ12). A `behindRun` stored by S12-Q21
  with no `rescanTurn` reads as a behind run whose next behind run reads the owed windows, the order of the
  build before, so no stored state changes meaning; no migration. Measured (FQ3, FQ4, FQ13, FW2): the first
  walk still reaches now on run 6 and reports complete on run 14, 20 calls (was run 12, 18); a repaired list
  clears in 7 behind runs, 14 runs (was 10). One property suite (FW2) drives the orders walk through
  `syncBinanceFiatOrderHistory` over seeds, clock gaps (1 ms, 1 h, 1 day) and four kinds of owed ground older
  than the re-scan, with late records and a new record on some runs, and asserts that every record Binance
  serves is imported within 4 runs of the run that first serves it, each key once. The bound: the runs of a
  world with owed ground left go forward, owed, forward, re-scan, so a record served just after a re-scan
  waits for the next one, the fourth run counting its own; with the owed ground gone the re-scan comes every
  second run. 3 fails (a drifting and a throwing page, a refused range). 150 seeds a world pass.
- S12-Q23 (B, FINAL coordinator ruling) a forward turn with nothing to read forward. A forward read of no ground
  stores no overlap day, so a run whose clock stands at the cursor (a gap of 0) or was set back to before it (the
  cursor in the future) read nothing, no range was ever owed to make the next run read behind, and the walk never
  re-scanned: a record Binance writes late was never imported. B: such a turn reads behind instead (`turnOf`; the
  owed windows and the re-scan take turns), after a behind run too, because with no forward ground there is no
  newer order for a forward run to keep out. `complete` for it: true when the run ended with no range owed and the
  re-scan not part way through a pass (a forward run is still complete only when it started so, FQ8). Measured
  (FQ3, FQ4, FQ14, FW2): the first walk reaches now on run 6 and reports complete on run 10 (was 14), 20 calls; a
  repaired list clears on run 8 (was 14); a standing clock re-scans on every run once nothing is owed.
- S12-Q24 (B, FINAL coordinator ruling) a re-scan read that fails. A page that drifted owed the whole window in its
  type and a page that could not be parsed failed the run, on every pass, so nothing past a stuck stretch inside
  the 2-year window was ever re-scanned (FW2: a failing day anywhere in the last two years). B: halve the re-scan
  span after a failed read, so the stuck part stays isolated and the rest of the window is read, and keep the
  halved state across runs in the walk's marks (no migration; a disconnect drops it). The halving is Convert's
  (`moreData`): the read answers `{ kind: 'split', half }` and `walkSpans` reads the half; the span hint keeps
  the narrowing across runs, and the re-scan keeps the width it reached after a commit (`keepsWidth`). No shared
  engine code changes. Halving alone cannot pass a day that fails for all of it (measured on 288 worlds, 6
  clocks, 4 kinds, 12 seeds: 60 stayed red, the pass crept up to the day one millisecond at a time and never
  over it), so the re-scan also reads around the ground the walk already holds as owed: the first owed range a
  failed span holds is marked stuck (`rescanStuck`, FQ17), the re-scan reads the span before it and the span
  after it and owes what is in it, and the owed runs read the stuck range on their own, so a range that reads
  again leaves the list and the mark. A failed span that holds no owed range is halved, down to a span of one millisecond that is owed and
  marked itself (FQ16). `fiat-rescan-stuck` is logged once on each run that holds a stuck range (RW5; built as one line for
  each range marked, changed in step 11/14), an unreadable page no longer
  rejects a re-scan run (any other failure does), and the payment walk shares the code. Measured (FQ15, FQ16,
  FQ17, FW2): a day that fails in the window costs the first pass 2 reads and a later one 1 more than the
  window alone; the bound of FW2 is 4 x (2z + 1) runs, z the failing days in the window, because the re-scan is
  read on every fourth run while owed ground is left and the first pass takes 2z + 1 reads, the longest wait seen
  is 11 runs with one day and 19 with two; 5400 worlds (150 seeds a world) pass.
- S12-Q27 (the fix, FINAL coordinator ruling) an owed window whose page cannot be read. `readPass` awaited the
  window with no catch and the fiat `readSpan` catches `BinanceHistoryParseError` in the re-scan alone, so an
  owed range or point that throws it left `runWalkPlan`: the re-scan and the points never ran and the round-robin
  never moved on, a late record of the 2-year window of the payment walk was never imported, and a readable owed
  range behind an unreadable one starved on both fiat walks (FQ18, FQ21; FW2: 60 payment worlds with a throwing
  day anywhere failed). The pass reads on: the window is owed and started, the round-robin moves past it, the
  re-scan and the points are read, and the run rejects with the first such error after the points.
- S12-Q28 (the fix, FINAL coordinator ruling: a strict overlap in `heldStuck`, the halves stay a millisecond short
  of the range, because a half that shares the boundary millisecond re-reads the failing one) a stuck range that never clears. The re-scan reads
  up to a millisecond short of a stuck range and from the millisecond after it, so owed ground that reaches past
  the range leaves a sliver that shares only the boundary millisecond with it (`{t, t + 1}`); the sliver touched
  the range, so the range stayed held in `rescanStuck` for ever (`heldStuck`) and `fiat-rescan-stuck` was logged
  on every run (FQ22; FW2: 8 payment status worlds failed, seeds 55 and 121 at 1 h, 55, 110, 121, 231, 253 and
  275 at 1 day). Built: `heldStuck` holds a range only for owed ground that overlaps it by more than the boundary
  millisecond, so the sliver is an owed range of its own that the owed runs read. The ruling named another means,
  halves that share the boundary millisecond with the range and a strict overlap for the stuck lookup; measured
  on this base it fails the pins of the halving (FQ15, FQ16, the point that fails at the end of its stuck range:
  the half after it holds the failing millisecond, is marked again and again, and the stuck range is never read
  around) and 461 of 1200 cases of the fiat suites, and is not built.
- S12-Q29 (A, FINAL coordinator ruling) the engine fix for every walk. `runWalkPlan` takes the test of the
  failure (`isUnreadableWindowError`, none by default, so every failure stops the run as before); only an owed
  range or point whose window throws a failure it names is read past, a 429, a 418, an auth failure, a clock skew
  or a network failure stops the run at once with no further call (FQ19). The engine imports no exchange class:
  Binance passes `isUnreadableWindowError` of `binance.walk-config.ts` (true for `BinanceHistoryParseError`)
  from all eight walk entries (FQ20).
- S12-Q30 (the fix, FINAL coordinator ruling) a stale re-scan hint end that stalls the 2-year pass of the payments
  walk. `keepsWidth` kept the end of the hint of a re-scan window that stopped on the budget; the next run clipped
  its first span to the lesser of that end and the window end, and the window end is the cursor, which moves with
  the clock, so the span ended one clock gap short of the pass's end, committed, and `rescanCursorAfter` wrote no
  restart. With one re-scan read a run the pass never reached its end and never restarted at the floor (FQ24; FW2:
  58 payment worlds with a drifting page failed, seeds 5, 19, 26, 33, 40, 47, 61 and 82 at every non-zero clock).
  Only payments is in this shape: orders drop the re-scan hint on every turn that is not a re-scan turn, and the
  other walks have no `keepsWidth`. Built: `keepsWidth` takes the window and keeps the width only when the hint
  ends before the window end; at or past it the hint is null, the rule `leftAt` applies. FW2 now drives the
  payments walk too, with the bound 2 x (2z + 1) (the re-scan is read on every run), and two more kinds of owed
  ground, four to six drifting or throwing days an hour to 3 days apart in the window, so the pieces between
  them are short. Measured worst case, runs from the first that could read the record: 1, 4, 8, 10 for z = 0 ... 3
  against 2, 6, 10, 14; 18, 18, 25 for z = 4 ... 6 (clustered, drift) against 18, 22, 26; the bound holds and z = 4
  meets it.
- S12-Q32 (the fix, COORDINATOR ruling) the piece after a stuck range of the fiat re-scan ends where a doubled span
  did. Root cause (kiko:debugger, one cause for all 30 failures of the 150-seed sweep, seed 642 at z = 6 included,
  which was a slow pass and not a stall): `aroundStuck` ended the piece after a stuck range at `span.end`, the end
  of a span `nextSpanAfter` had doubled, so the piece was a sliver and the payments re-scan (one read a run, the
  hint kept) doubled up from it: up to about log2(730 d / 1 ms) reads per failing day. Orders drop the hint every
  turn and are unchanged (8100 + 2700 cases at 150 seeds and more, 0 failures). Built (`binance.fiat-history.ts`
  only): the piece after the range is `{ start: stuck.end + 1, end: window.end }`; the piece before it is as it
  was. The bound is derived from the code and written in the test with its parts named: `importRuns(z) = r x F(z)`,
  `r` the runs between two reads of the re-scan (payments 1: `RESCAN_KEEP` and a lane cap that does not
  alternate turns; orders 4: `RESCAN_EVERY_RUNS`), `F(z) = 2z + 1` the reads of a first pass (z failing reads and
  z + 1 reads of the pieces between them; a record waits at most the rest of one pass and its place in the next,
  which together are no more than a first pass). Payments is 1 x (2z + 1), orders keep 4 x (2z + 1); the
  measured-worst-case comment of S12-Q30 is replaced by this derivation. FW2 now runs 30 seeds (the plan's property
  rule is 30 to 40), the file takes 116 s on one run at a load of about 5, and the 5 seeds of the failing worlds
  (1027, 334, 306, 558, 642) are named cases for the payments walk at all six clocks (FQ25 is the deterministic
  shape; the `PASS_ENDS_AT_RUN` of FQ24 for payments goes from 4 to 2, written as ceil(F(2) / 2 re-scan reads a
  run) - 1, red on the old line and green on the fix). 150-seed sweep (uncommitted), payments, six clocks, worlds
  none, drift and throw, anywhere, in the window and in a cluster (6300 cases): 0 failures, 0 records never
  imported; worst case per z, against the bound, 1/1, 2/3, 3/5, 4/7, 6/9, 8/11, 10/13 for z = 0 ... 6 (the runs from
  the first that could read the record). Orders, the same worlds and seeds (6300 cases, code unchanged): 0 failures,
  0 never imported; 4/4, 11/12, 19/20, 25/28, 33/36, 41/44, 49/52.
- S12-Q33 (the fix, COORDINATOR ruling) the dense full-page worlds of FW2. A world with a span past a stuck range
  that holds more rows of each type than one page (a drifting or throwing cluster of 4 to 6 days with 2 x (page rows
  + 1) rows in the hour after the first day) made both walks stall: orders imported none of the later records
  (the re-scan mark stayed behind the first stuck day) and payments never ended their first pass and left about 200
  to 280 records unimported (drifting; with a throwing page 5 of 48 cases failed, z = 5). The code before S12-Q32
  fails the same worlds, so S12-Q32 does not cause it. Two causes (kiko:debugger, one scratch prototype that fixed
  all the failing cases): (1) `aroundStuck` splits a window whose span starts at the stuck range to
  `{ stuck.end + 1, window.end }` with no commit, so the hint the piece leaves starts past the window start and
  `holdsStart` of the walk refuses it: every run starts the halving of the full page again and the pass never ends;
  (2) orders only: `planOfTurn` empties the re-scan windows of a forward and an owed turn and `hintsOfPlan` of the
  walk then deletes the stored re-scan hint, so what a re-scan left part way through the halving is lost between
  two re-scan turns. Built (`binance.fiat-history.ts` only, no engine change; S12-Q35): A, `startingAfterStuck`,
  run after the plan is built: the first re-scan window starts after a known stuck range that holds its start or
  ends 1 ms short of it (`range.start - 1 <= start <= range.end` gives `range.end + 1`, repeated over the sorted
  ranges), unless that reaches the window end, so a window that holds only owed ground still ends the pass by its
  commit. B, `keepRescanHint`, wraps the hints hook of `roundRobinHooksOf` so the stored re-scan hint is kept on a
  turn that is not the re-scan. The dense worlds join FW2 (the place "in a cluster, behind full pages", drifting
  and throwing), driven for 120 runs while the records are drawn for 60 (`GENERATED_RUNS`, so the 3270 cases that
  existed before draw the same numbers and pass unchanged, the 30 named cases of S12-Q32 included). The bound is
  written in the test with named parts: `importRuns(z) = r x (F(z) + H)`, `F(z) = 2z + 1`, `H = 2 x
  (ceil(log2(CLUSTER_GAP_MS / HOUR_MS)) + 1)` (the reads to halve a full page down to one that fits and to
  double back, with slack), `r` = 1 on payments and 4 on orders; a world that is not dense keeps `r x F(z)`. The
  named seeds are payments drifting 5, 19, 26, payments throwing 26, 89, 201, and orders drifting and throwing 5,
  19, 26. The deterministic shape is FQ26 (payments in 30 runs, orders in 100, a full page after a stuck day, and
  the boundaries of the skip), the kept hint is FQ9. Sweep (uncommitted), worlds 0-9, 30 seeds, six clocks, both
  kinds (3600 cases; the sweep harness does not model the world Binance refuses as too old, which the file
  does): 0 failures, 0 records never imported; worst case per z against the bound, dense: payments
  17/25, 20/27, 19/29, orders 69/100, 81/108, 85/116 for z = 4, 5, 6; the other worlds are unchanged from S12-Q32
  (payments 1/1, 2/3, 3/5, 4/7, 6/9, 7/11, 9/13; orders 4/4, 11/12, 19/20, 25/28, 33/36, 41/44, 49/52, z = 0 ... 6).
  The file runs 3894 cases (4 min on one run at a load of about 5; it was 116 s before the dense worlds).
- S12-Q34 (refuse, OVERNIGHT DEFAULT, pending user) a completed taker buy whose `fiat` text no code can carry (empty,
  or holding `:`). A: refused as `p2p-unrecognized` (one visible entry, the cursor moves on), as an order with no
  `fiat` field is (P12, P12b, and the `uncarriableFiat` category of the P2P properties). B: owe the point, as
  before: the walk threw `amount-malformed` on every run, the point stayed owed with nothing shown, and each run
  spent lane calls to read the window again. A is the default: the text is Binance's own and a re-read cannot
  change it, so owing it only hides the order. Order of the decision: the fiat is read after the coin (an order of
  a coin Kiko does not track reads no fiat), and before the amount values.
- S12-Q35 (A + B fiat-only, OVERNIGHT DEFAULT, pending user) where the two fixes of S12-Q33 live. A + B: both in
  `binance.fiat-history.ts`, around the engine's plan and hooks, with no change to the engine the other Binance
  walks share (they have no stuck-range split and no alternating turn, so neither cause is theirs). The other way is
  to build them in the engine, where every walk would read the same rule. A + B is the default: the shape is the
  fiat walks' (the stuck range and the turns are theirs), and a change to the engine would move the pins of every
  other walk for a stall they cannot meet.
