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
LATER SEND IN THE CATEGORY CHART", "Set 11 plan questions". Questions S12-Q1 ... S12-Q15 and S12-Q18 are at the
end; the plan assumes each recommendation.

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
- G-6 Lanes (spec "Measured weights"): `p2p` cap 10, `fiatOrders` cap 3, `fiatPayments` cap 10, narrowing calls 0
  each; `COSTS.p2p = { uid: 900 }`, `COSTS.fiatOrders = { uid: 45_000 }`, `COSTS.fiatPayments = { ip: 1 }`. The P2P
  cap changes only on probe 10 numbers (S12-Q7).
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
  `p2p-unrecognized`) -> amount (C-P5, C-NR-B, P1-P1h) -> tracked rule on `asset` (`isTrackedBinanceAsset`;
  untracked: counted, ticker to `untrackedCoins.history`, no row).
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
  doc comment points at `.superpowers/sdd/binance-set12/fiat-doc-quote.md` and the spec section.
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
| P7b | walk, "reaches the first UA-1 order by run 15 and the newest by run 23 at the lane cap" | 226 calls; runs 15 / 23 |
| P8 | walk, "imports the buys of a window whose sale series is empty" | rows; no empty count |
| P8b | walk, "keeps the window and the cursor on any other refusal code and reads it again next run" | cursor unchanged |
| P9 | sqlite, "imports the 77 completed buys of the probe 3 orders and lists nothing" | 77 rows; `notImported` empty |
| P10 | walk, "keeps one entry when the re-scan reads a listed sale again" | count stays 1 |
| P11 | sqlite, "leaves the Funding UAH holding at zero after a P2P buy of UAH and its Convert" | UAH +x then -x = 0; USDT + |
| F1 | fiat, "credits a successful deposit to the Spot fiat holding with the bank total" | EUR +10_000; `bank:EUR:100.00` |
| F2 | fiat, "debits a successful withdrawal by its amount and its total fee" | EUR -(5_000 + fee); `bank:EUR:50.00` |
| F3 | fiat, "imports a completed card buy on the Spot coin holding" | BTC +100_000; `card:UAH:2600.00` |
| F3b | fiat, "debits a completed card sale and marks the fiat it was sold for" | BTC -; `card:<fiat>:<obtainAmount>` |
| F4 | fiat, "lists a fiat %s with status %s as not recognized" (orders: `Finished`, `Refunding`, `Refund Failed`, `Order Partial Credit Stopped`, an undocumented word; payments: an undocumented word) | one `fiat-unrecognized` each |
| F4b | fiat, "settles only the exact allowlisted word, so %s is not recognized" (`successful`, ` Successful`, `Successful `, `Order Partial credit Stopped`, `Refund  Failed`; payments `completed`, `Completed `) | one `fiat-unrecognized` each, no row (S12-Q13) |
| F5 | fiat, "reads every two-year window from the floor, empty ones too" | orders 16 calls / 8 runs to now (S12-Q6, S12-Q18), payments 10 / 1 |
| F6 | fiat, "settles %s, owes %s and lists every word the doc does not show as moving no money" | per step 2/14 |
| N5b | `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.not-imported.test.tsx`, "counts two P2P sales beside one Convert order, in the order of the kind list" | exact N5b text |

New rows (no P2P or fiat read ran before, so "was:" is "no read" unless a value is given):

| # | Input | Result now | Test (file, title) | was: |
|---|---|---|---|---|
| PC1 | `fetchP2pOrders(BUY, span, page 1)` | signed GET, `tradeType`, `startTimestamp`, `endTimestamp`, `page`, `rows=100`; UID header read | `binance.history-client.p2p.test.ts`, "asks one page of one side and one window at 100 rows" | - |
| PC2 | body not the documented envelope; a decision field other than `orderNumber` / `createTime` of the wrong type; `data` null or absent while `total` is not 0 | `BinanceHistoryParseError`, whole page | same, "fails the whole page for %s" | - |
| PC2b | `data` null or absent with `total === 0` | an empty page (no row, no throw) | same, "reads a page with no data as empty only when its total is 0" | - |
| PC5 | `orderNumber` empty, not text or absent; `createTime` not a safe integer | that record unreadable (owed), the other records of the page read | same, "reads an order with %s as unreadable and keeps the rest of the page" | - |
| PC3 | a record with every documented field | the record holds no counterparty field | same, "reads no counterparty field into the record" | - |
| PC4 | HTTP 429 / 418; -5026; HTTP 500 | `BinanceRateLimitError`; `BinanceHistoryTooOldError`; request failure | same, "maps %s to %s" | - |
| FC1 | `fetchFiatOrders(0, span, page)`, `fetchFiatPayments(1, span, page)` | `transactionType`, `beginTime`, `endTime`, `page`, `rows` 500 / 100 | `binance.history-client.fiat.test.ts`, "asks one page of %s at %i rows" | - |
| FC2 | as PC2 and PC2b for both bodies (the same `data` / `total` envelope) | `BinanceHistoryParseError` | same, "fails the whole page for %s" | - |
| FC3 | as PC4 | as PC4 | same, "maps %s to %s" | - |
| BL1 | lanes at their caps | `p2p` 10, `fiatOrders` 3, `fiatPayments` 10; each UID lane at its cap within `UID_WEIGHT_BUDGET_1M` | `binance.history-budget.test.ts`, "keeps each new UID lane at its cap within the minute budget" | no lane |
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
| PW5 | property, gaps 0 / 1 h / 1 day | see step 11/14 | `binance.p2p-history.properties.test.ts` | - |
| FW1 | as PW1-PW3 for both fiat walks | as PW1-PW3 | fiat, describe "a fiat walk that stops" | - |
| FW2 | property, gaps 0 / 1 h / 1 day | see step 11/14 | `binance.fiat-history.properties.test.ts` | - |
| FQ1 | orders current, run 2 after a forward run, records 2 h and 30 d behind the cursor (S12-Q18) | a behind run re-scans `[t - 730 d, c]`, both imported, list empty, `complete` false | fiat, "re-scans the last two years on the run after a forward read, so a late record is imported" | forward `[c, t]`, neither read, the list grows |
| FQ2 | the run after FQ1 | forward `[c, t]`, `complete` true | fiat, "reads forward again on the run after the re-scan, and reports complete" | `complete` false |
| FQ3 | orders, first walk from the floor | cursor now at run 8 (calls `[2 x 8]`), run 8 complete, run 9 re-scan, run 10 forward and complete | fiat, "reads every two-year window from the floor, empty ones too" and "reads the owed days before it reaches now, then re-scans the last two years and reads forward" | now at run 5, never complete |
| FQ4 | orders, stored list unreadable (repaired to `{floor, cursor}`) | 4 behind runs read the owed windows, a 5th the re-scan, the 6th reads forward | fiat, "reads the repaired range over five re-scan runs, then reads forward" | never read |
| FQ5 | orders, forward ground one window or more, a range owed | forward run first; at exactly one window, forward and not complete; a millisecond under, a re-scan | fiat, "reads forward first and leaves the owed range for a later run", "reads forward at exactly one window behind, and is not complete while a range was owed", "re-scans at a millisecond under one window behind" | (same for the first; no turn) |
| FQ6 | fiat payments, current | forward and re-scan in one run, unchanged | fiat, "reads forward and re-scans the last two years in the same run" | (same) |
| FQ7 | orders, an owed point and no range | forward run; the point on the 3rd call, in a forward and in a re-scan run | fiat, "reads forward when the list holds no range, though a point is owed", "reads an owed point on the third call of a forward run and of a re-scan run" | the 3rd call never spent by a re-scan |
| FQ8 | orders, forward run that starts with the re-scan mark at the floor, absent, or part way | complete, complete, not complete | fiat, "reports a forward read that starts with the re-scan at %s as complete: %s" | complete never |
| FQ9 | a re-scan run (forward hint stored) and a forward run (re-scan hint stored) | the pass left out of the run drops its hint (`hintsOfPlan`); the forward read after it still reaches now | fiat, "drops the forward hint on a re-scan run, and the forward read after it still reaches now", "drops the re-scan hint on a forward run" | hints kept |
| RW1 | the arm run | the walks in spec order, the P2P and fiat walks after dust and before trades; each failure logged by its own tag | `src/crypto-sync/run-crypto-sync/run-crypto-sync.test.ts`, "runs the walks in order, capital, Pay, Transfer, Earn, Convert, the dust read, P2P, fiat orders, fiat payments, then the trade read, all on one run object" | dust then trades |
| RW2 | the P2P walk rejects with `BinanceHistoryParseError` (modelled on "still resolves with the balance result when the Convert walk fails, logging only its name") | logged under `[binance sync] p2p history failed` with name and code only; the balance result resolves | same file, "still resolves with the balance result when the P2P walk fails, logging only its name" | - |
| RW3 | RW2 (modelled on "runs the dust read even when the Convert walk failed: each logs its own failure") | the fiat order, fiat payment and trade reads still run; each logs its own failure | same file, "runs the fiat walks and the trade read even when the P2P walk failed: each logs its own failure" | - |
| RW4 | real SQLite: an account with a P2P page that cannot be read and a readable Convert record, two runs | both runs: the Convert row imports once, the P2P cursor stays, the failure logged each run | `binance.p2p-history.real-sqlite.test.ts`, "keeps importing the other walks while a P2P page cannot be read, and logs it on every run" | - |
| K-P | a `p2p`, `fiatOrders` or `fiatPayments` cursor null or a day behind | caption shown | `src/screens/account-detail/crypto-sync-section/binance-history-status.test.ts`, "shows the caption while the %s walk is behind" | hidden (not in `CAPTION_WALKS`) |
| MK1 | `p2pTotalCode`-style builder (G-8) on `4150`, `4145.85`, `4000.0`, `4150.001`, `abc` | `p2p:UAH:4150.00`, `...4145.85`, `...4000.00`, `amount-precision`, `amount-malformed`; each parses back | `src/transactions/untracked-counterpart/untracked-counterpart.test.ts`, "builds a %s code at the fiat scale from %s" | no builder |

## Pins this set changes ("was:" values)

Floor; the developer greps `LANE_CALL_CAPS`, `LANE_NARROWING_CALLS`, `COSTS`, `Record<BudgetLane`,
`invocationCallOrder`, `walkRunCounts`, `CAPTION_WALKS` and `walkCursorsOf` in every test file.

| Pin | File, test | Now | was: |
|---|---|---|---|
| Q1 | `binance.history-budget.test.ts` "holds the per-run call cap of each lane" | adds `p2p: 10`, `fiatOrders: 3`, `fiatPayments: 10` | no lane |
| Q2 | same, "holds the narrowing calls of each lane: only the Transfer lane has any" | adds the three at 0 | no lane |
| Q3 | same, "holds the Binance ceilings and per-call costs of the old withdraw rule" | adds `p2p`, `fiatOrders`, `fiatPayments` costs | no cost |
| Q4 | `run-crypto-sync.test.ts` "runs the walks in order, capital, Pay, Transfer, Earn, Convert, then the dust read, then the trade read, all on one run object" | retitled per RW1 | trades right after dust |
| Q5 | `run-crypto-sync.test.ts` `walkRunCounts` ("a walk state this build cannot read") | the three new walks at 0 | seven reads |
| Q6 | `binance-history-status.test.ts` `walkCursorsOf(...)` `toEqual([...])` | eight cursors | five |
| Q7 | spec section 7 TC/TW cells (step 1/14) | full titles and full paths | file-only and partial paths |
| Q8 | `binance.fiat-history.test.ts` "reads every two-year window from the floor, empty ones too" (orders) | 8 runs to now: calls `[2 x 8]`, cursors F+730, F+1460, F+2190, F+2920 (4 times), now (S12-Q18) | 5 runs: cursors F+730 ... now |
| Q9 | same file, "reads two-year windows forward from the history floor, oldest first, both types of each" and "reads every empty window and imports a record behind four of them" | the orders branch reads the queries of its forward runs only (runs 1-4 and 8; `forwardRuns`) | the first 10 queries of 5 runs |
| Q10 | same file, "writes the windows read before the limit, sets the cooldown and resolves" | the limit hits any read that does not start at the cursor (the orders run 2 is a behind run) | the read of the second window |

## Files (measured floor; the developer measures the real list)

Mutable source files (`mutable_source_files` in `scripts/checks/mutation.sh`; `index.ts`, tests and
`-test-fixtures.ts` excluded), at least 7, cap 30: `binance/binance.p2p-history.ts` (new),
`binance/binance.fiat-history.ts` (new), `binance/binance.history-client.ts`, `binance/binance.history-budget.ts`,
`run-crypto-sync/run-crypto-sync.ts`, `src/transactions/untracked-counterpart/untracked-counterpart.ts`,
`src/screens/account-detail/crypto-sync-section/binance-history-status.ts`. Step 1/14 is test-only and adds no
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
- [ ] Steps 4/14-11/14 do not wait for it (cap 10 stands until it reports).

### step 4/14: the P2P and fiat lanes

Files: `binance.history-budget.ts`, `binance.history-budget.test.ts`.
- [ ] Tests first: Q1, Q2, Q3; BL1, BL2, BL3. Red count quoted.
- [ ] Code: `'p2p' | 'fiatOrders' | 'fiatPayments'` in `BudgetLane`; caps, narrowing calls, both counters in
      `createBinanceRunBudget`; `COSTS.p2p`, `COSTS.fiatOrders`, `COSTS.fiatPayments` (G-6). Grep `Record<BudgetLane`.
- [ ] Verify on the base and write in the commit body: `readSeriesSpan` asks `canAfford(lane, cost, keep +
      series.length - 1)` before a window, so a two-series window needs 2 calls and a lane of 3 reads one window a
      run (S12-Q6); a fiat-orders run reads forward or behind, not both (S12-Q18).
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
`binance.p2p-history.properties.test.ts` (new), `binance.fiat-history.properties.test.ts` (new),
`crypto-sync-section.component.not-imported.test.tsx`.
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
      step 2/14 with URL and date), the fiat-orders runs (8 to reach now, S12-Q6 and S12-Q18) in "Measured weights" and F5, the P2P report
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

## Questions for the coordinator (S12-Q1 ... S12-Q15, S12-Q18)

Status (coordinator, 2026-10-23): Q1, Q2, Q4-Q9, Q12-Q15 = A, FINAL coordinator rulings; Q3, Q10, Q11 = A,
OVERNIGHT DEFAULT, pending user; Q18 = C, FINAL coordinator ruling.

- S12-Q1 (A, FINAL coordinator ruling) a TC/TW row that quotes no title (TC1, TC4, TW15, TW16). A: the doc test fails such a row; step 1/14 adds
  one exact existing title to each. B: a file-only row passes when the file exists. Recommend A: a file alone ties a
  row to nothing (set 11 lesson 7), and four cells are cheap to fix.
- S12-Q2 (A, FINAL coordinator ruling) file resolution in the doc test. A: strict (bare name = `src/crypto-sync/binance/`, else a full `src/`
  path), and step 1/14 fixes the three cells that break it. B: find a bare name anywhere under `src/` (unique match).
  Recommend A: the table states the `binance/` default, and a search can match the wrong twin file.
- S12-Q3 (A, OVERNIGHT DEFAULT, pending user) `Failed` and `Refunded` (orders and payments). The planner found no Binance text that says no money moved;
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
  The cap stays 3; the run COUNT is reversed by S12-Q18 (8 runs to reach now, F5 pins 8; was: 5).
- S12-Q7 (A, FINAL coordinator ruling) the P2P lane cap (R-Walk A). A: 10 until probe 10 reports; then the largest cap whose per-run UID peak and
  wall time the probe shows fit, recorded with the numbers. B: raise now from arithmetic (180000 / 900). Recommend
  A: "a cap changes only with a measured reason".
- S12-Q8 (A, FINAL coordinator ruling) the measured P2P first-walk report. A: probe 10 (step 3/14, user, read-only) plus P7b computing calls and
  runs from the walk itself. B: P7b only. Recommend A: the spec asks for a measured report, and P7b uses probe 4's
  window index, not a fresh count.
- S12-Q9 (A, FINAL coordinator ruling) `CAPTION_WALKS`. A: `p2p`, `fiatOrders`, `fiatPayments` join it in set 12 (spec section 5: "The caption
  shows until each walk is current"; S8-Q5 did the same for Convert); a user sees the caption for about 23 syncs.
  B: set 15. Recommend A: the caption is the honest state while P2P history is still arriving.
- S12-Q10 (A, OVERNIGHT DEFAULT, pending user) the P2P cover rule (user, 2026-10-21: an outgoing USDT row covered by an earlier P2P BUY of that coin is
  not counted in Expenses by category). No set owns it in the spec. A: set 13, which adds the read-time statistics
  rules for P2P rows (`src/statistics/exchange-funding-match/`, the same `parseUntrackedCounterpart` input, M1-M14);
  its plan brings the user questions (partial cover, order, a send larger than the cover, Pay vs withdrawal). B:
  set 12. C: a follow-up after set 15. Recommend A: set 12 writes the rows the rule reads, set 13 owns statistics
  over them, and no build ships before set 15 (U1), so nothing reaches the user without it.
- S12-Q11 (A, OVERNIGHT DEFAULT, pending user) fiat withdraw debit. The documented fee field is `totalFee` (the spec says `fee`). A: `-(amount +
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
  run later; the first walk reaches now on run 8, not 5: F5, Q8, FQ1-FQ9). Payments (a lane of 10) read both in
  one run, unchanged. Edge case: a range that no read can clear (owed ground older than Binance serves) keeps
  every run a behind run; probe 5 saw no such refusal, so none is expected.
