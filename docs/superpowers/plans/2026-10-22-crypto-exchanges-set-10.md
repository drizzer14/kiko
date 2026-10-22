# Crypto exchanges 1.3-a, change set 10: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `crypto-exchanges-1.3-a task 10/15` (trades 1/2): the public `exchangeInfo` read on its own lane,
symbol discovery from the touched coins, the rotation of symbol reads with one call reserved for the round-robin,
and the generic `idCursorPager`. No trade row, no `myTrades` call, no run wiring: set 11 adds those.

**Architecture:** set 10 code has NO production caller. `runBinanceHistoryWalks` (`run-crypto-sync.ts`) is not
touched; set 11 wires the trades read there (spec section 11 row 11/15 lists `run-crypto-sync.ts`). Every new
export is consumed by a test in the same commit (knip's jest plugin takes test files as entries; a barrel export
gets a cross-folder test consumer, set 8 lesson). The candidate list is never stored: each run derives it from
`exchangeInfo` and the touched coins. Per-symbol progress, the rotation cursor and the balance snapshot stay in the
`trades` part of `sync_state.exchange_state` that set 4 already parses and patches (`tradesOf`, `TradeSymbol`,
`ExchangeTrades` in `walk-state.ts`; patch kinds `tradeSymbol`, `tradesRotation`, `tradesBalanceSnapshot` in
`exchange-state-patch.ts`). Set 10 writes no patch to the database; it builds patches as values for set 11.

**Tech stack:** React Native, op-sqlite + Drizzle, Jest (`fast-check` where the suites already use it), fnts
`maybe`/`Either`, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: section 11 row 10/15; section 5 table rows
"Spot trades", "Order fills", "Symbol list", "Measured weights" (`exchangeInfo` 20, `X-MBX-USED-WEIGHT-1M`),
"### Spot trades (R-Q11, R-Q13, C-NR2)" bullets "Symbol discovery", "Rotation", "Paging"; section 2 "Pager
interface", "Walk state in `sync_state`" (the `trades` part and its per-part parse), "History-behind caption" (K6:
set 15); section 7 "Scenario matrices" (T rows are set 11; set 10 adds TS, TR, TP rows in step 7/10); section 12
P1, P2, P3, P15. Rulings (`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`, main checkout): R-Q11,
R-Q13, C-NR2 ... C-NR7 (set 11 content; set 10 only keeps their inputs intact), R-Walk A, S8-Q*, S9-Q*.
Questions S10-Q1 ... S10-Q6 are at the end; the plan assumes each recommendation.

**Base:** branch `binance-set10` at main `33a2de39` (sets 1-9 merged). Every code fact names a symbol or anchor
text. **The developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Test names and comments carry no
  scenario id, no ruling id and no history text; the commit message carries them. Tests never read `src` text.
- G-2 A pin a behaviour change moves is updated in the same step (table "Pins this set changes"); never in a fix
  round. Retitle each changed test so its name states the new rule.
- G-3 Identifiers in full words; imports through `@kiko/<feature>` barrels; every new export has a consumer at its
  own commit (knip still flagging it: stop and report, never add an ignore). A barrel export with no production
  consumer gets a cross-folder test consumer in the same commit (set 8 lesson).
- G-4 No migration, no index, no `.kiko` change (`exchange_state` travels as text in the `sync_state` rows;
  `EXPORT_VERSION` and `VERSION_DECISIONS` unchanged), so no migration review and no EXPLAIN QUERY PLAN test. Stop
  and ask if one appears.
- G-5 Trades are not a walk: no `WALK_IDS` member, no `CAPTION_WALKS` member, no `NOT_IMPORTED_KINDS` member, no
  `walks.trades` entry. The caption rule K6 (never-read candidate symbol) is set 15's; set 10 does not touch
  `exchange/history-status/`.
- G-6 Safe tip: no production caller (see Architecture). Nothing the user sees changes; no request leaves the app
  that did not before. Guideline 2.5.19: no flag and no hidden UI; dormant code with no UI path is no hidden
  feature, and set 11 wires it in the next change set of the same release.
- G-7 Lane `tradeSymbols`: cap 1, no narrowing calls, cost `COSTS.exchangeInfo = { api: 20 }` (spec "Measured
  weights": 20 per call; judged against `API_IP_BUDGET_1M`). The `trades` lane (cap 100) and the `myTrades` costs
  (20 / 5 / 5) are set 11's.
- G-8 Ids: a trade `id` and `orderId` are used only as JSON safe integers. Probe 3 recorded the `myTrades` key
  names only, not their JSON types (set 8 lesson 1): the pager refuses a page whose id is not a safe integer (fail
  visible), never a fallback or a rounded cursor. S10-Q4 asks for the type probe before set 11.
- G-9 No fallback for a case never seen live (set 8 lesson 2): an `exchangeInfo` read that fails gives no
  candidates this run; stored symbols are not read on a guess (S10-Q3).
- G-10 Point skill and spec text at constants (`TRADE_MAIN_QUOTES`, `TRADE_SYMBOL_STATUSES`, `LANE_CALL_CAPS`,
  `COSTS`), never at a copied list (set 8 lesson 9).
- G-11 U1: no device deploy and no device step. No copy change, no i18n key, no translator review.
- G-12 Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.
  `bash scripts/checks/dup.sh <file>` alone on each new or grown test file. Writes to `src/` and `docs/` only with
  Edit/Write (never `perl -0pi`, `sed -i`, a heredoc or a python one-off). After any `biome check --write`, run
  `node scripts/checks/import-order.js <file>` on that file (set 9 lesson 1; the `.sh` wrapper checks only its
  first argument, gap set9/3).
- G-13 Do not edit `binance.convert-history*.test.ts` or `binance.dust-history*.test.ts`: a survivor-triage change
  set owns them in another worktree.

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-22: 57 open)

- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks the institution, not the connection): LEFT
  OPEN; set 10 writes nothing. Set 11's trade patches inherit the gate, no worse.
- `20261021T1839-kiko-binance-set9/1` (unreadable state names never logged): LEFT OPEN; step 4/10 keeps the rule
  (a malformed `trades.rotation` is named in `unreadable`, no log line).
- `20261021T1839-kiko-binance-set9/2` (repeated `row-precision-rounded`): LEFT OPEN; set 10 parses no amount.
- `20261021T1839-kiko-binance-set9/3` (`import-order.sh` multi-path): LEFT OPEN; G-12 routes around it with the
  node checker per file.
- `20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`, `20261018T1637-kiko-harness-h9/2`
  (TIMEOUT-HEAVY fan-out): LEFT OPEN; `walk-state.ts` and `exchange-state-patch.ts` are widely imported, so step
  10/10 applies the gate rerun rule.
- `20261017T2005-kiko-harness-h8/6` (no live TIMEOUT-HEAVY rerun proof): LEFT OPEN; closed by this gate only if it
  meets a real TIMEOUT-HEAVY file (the BATCH READY says which).
- Every other open gap (harness, kill-guard, Duo, iPad, account-currency, migrations): LEFT OPEN, unrelated.

## Decisions this plan makes (assumed; S10-Q* confirm)

- Symbol list: not stored; derived per run. Per-symbol state: `trades.symbols[symbol]` (`fromId`, `heldOrderId`),
  existing. Rotation cursor: `trades.rotation`, changed to the TEXT of the last round-robin symbol whose read
  returned (S10-Q1 B); `''` = start at the first symbol. No migration: no production code ever wrote `trades`.
- Touched coins (spec "Symbol discovery"), from stored data only: the `binanceAsset` of every holding of the
  account (a tracked coin with a non-zero balance or an imported row has one; it stays at 0), the four coin lists
  (`untrackedCoins.balance`/`.history`, `oversizedCoins.balance`/`.history`), and the base and quote of every
  symbol with a stored numeric `fromId`. Candidates: every listed symbol whose status is in
  `TRADING_SYMBOL_STATUSES = ['TRADING', 'BREAK']`, or any status for a symbol with a stored numeric `fromId`
  (S10-Q2 A), whose base AND quote are both in touched coins union `TRADE_MAIN_QUOTES` (USDT, USDC, FDUSD, BTC, ETH,
  BNB, EUR, TRY), sorted ascending by symbol text, each once.
- Changed symbol: its base or quote coin's Spot balance text differs from `trades.balanceSnapshot[coin]`; a coin
  with no snapshot entry counts as changed. The balance text of a coin is the caller's input (set 11 passes the
  Spot `free` and `locked` texts as Binance sent them, joined as `${free}/${locked}`; a coin absent from the read is
  `'0/0'`). A free/locked move with no fill counts as changed: an extra read, never a missed one.
- Snapshot write: a coin's entry takes its current text only when every candidate symbol with that coin ended at
  a short page in this run; every other entry keeps its stored text, so a change is not forgotten while a symbol
  of that coin is still unread.
- Read order (spec): held (ascending), never read (no entry or null `fromId`, ascending), changed (ascending), then
  the round-robin over every candidate not yet read this run, from the first symbol `>` `rotation`, then wrapped.
  Each symbol at most once per run. Priority reads (held, never read, changed) run only while the lane affords
  their page AND one more call (`keep: 1`); the round-robin reads with `keep: 0`. So `L` (round-robin symbols
  started per run) is at least 1 in every run that affords one call after the priority reads stop, and each of `S`
  candidates starts a read within `ceil(S / L)` runs.
- Cursor move: after a round-robin read RETURNS (short page, lane end or a stop), `rotation` = that symbol; a read
  that throws (rate limit, failure) leaves `rotation` before it, so the next run starts with it (memory
  "round-robin rotates units read": the cursor never passes a unit that was not answered).
- `exchangeInfo`: one public read per run on lane `tradeSymbols`, no cache across runs (S10-Q3 A; size measured
  first, S10-Q5). 418/429 throw `BinanceRateLimitError` (the set 11 caller sets the account cooldown); any other
  non-OK answer rejects through `requestFailedOf`; a body without a `symbols` array throws
  `BinanceHistoryParseError`; an item without text `symbol`, `status`, `baseAsset`, `quoteAsset` is left out and
  counted in `unreadable`.
- Pager: no shared `Pager` type in set 10 (S10-Q6 A): `idCursorPager` stands alone in
  `exchange/paging/id-cursor-pager.ts`; the offset paging is not refactored.

## Scenario matrix (each row is a Jest case; "was:" for every row: no trades code existed)

| # | Input | Result now |
|---|---|---|
| TS1 | UA-1 touched (BTC, CGPT, UAH, USDT); listing BTCUSDT TRADING, BNBBTC TRADING, BTCUAH BREAK, ETHBTC TRADING, XYZBTC TRADING, CGPTUSDT HALT | candidates BNBBTC, BTCUAH, BTCUSDT, ETHBTC (XYZ untouched, HALT left out) |
| TS2 | each touched source alone: a holding at 0, each of the four coin lists, a stored `fromId` symbol's base | that coin's symbols are candidates |
| TS3 | a symbol with a stored numeric `fromId`, now HALT or END_TRADING and still listed | still a candidate (S10-Q2 A) |
| TS4 | a symbol with a stored `fromId` that the listing no longer has | no candidate; its stored entry untouched |
| TS5 | body not an object; `symbols` absent or not an array | `BinanceHistoryParseError`; no candidate |
| TS6 | an item with `symbol`, `status`, `baseAsset` or `quoteAsset` absent or not text | left out, counted in `unreadable`; the others read |
| TS7 | HTTP 429 / 418; HTTP 500 or a 4xx | `BinanceRateLimitError` with `retryAfterMs`; a request failure, rejects |
| TS8 | a second read in one run; an `/api/*` reading of 2981 | no request (lane cap 1; 2981 + 20 > 3000); 2980 allows it |
| TS9 | the request | `GET /api/v3/exchangeInfo`, no key header, no signature, `Cache-Control: no-store`; the lane records `X-MBX-USED-WEIGHT-1M` |
| TS10 | `baseAsset` `' btc '`; a symbol listed twice | ticker `BTC` (`binanceTickerOf`); the symbol once |
| TR1 | held B, never-read N, changed C, rest R | read order: held, never read, changed (each ascending), then the round-robin |
| TR2 | snapshot BTC `'1/0'`, Spot `'1/0'`; USDT absent from the snapshot | BTC symbols unchanged; USDT symbols changed |
| TR3 | rotation `'BTCUSDT'`, round-robin pool AAA, BTCUSDT, ETHBTC | ETHBTC first, then AAA; rotation `''` starts at AAA |
| TR4 | the lane affords 5 calls; 9 changed symbols | 4 priority calls, then at least 1 round-robin read |
| TR5 | a round-robin read returns; a later one throws a rate limit | `rotation` = the read that returned; the error propagates |
| TR6 | coin USDT in 3 candidates, 2 ended at a short page | USDT snapshot entry keeps its stored text; a coin with all ended takes the new text |
| TR7 | property: `S` 1..150, lane 1..100, every symbol changed every run, candidate churn between runs | each symbol starts a read within `ceil(S / L)` runs, `L >= 1` |
| TR8 | a held symbol whose order re-read would take the whole lane | its reads get `keep: 1`, so at most the lane cap - 1 calls |
| TP1 | never read; 2500 ids over pages of 1000 | 3 calls; every row once, ascending; `nextFromId` = last id + 1 |
| TP2 | first page empty | 1 call; `nextFromId` = the `fromId` asked (0 when never read) |
| TP3 | exactly 1000 rows, then an empty page | 2 calls; `nextFromId` = last id + 1 |
| TP4 | the lane refuses page 2 | no request; end `budget`; `nextFromId` after page 1 |
| TP5 | `onPage` answers a stop at id X | no further request; end `stopped`; `nextFromId` = X |
| TP6 | an id not a safe integer, not ascending, repeated, below `fromId`; more rows than the limit | `IdCursorPageError`; that page never reaches `onPage`; earlier pages stay committed |
| TP7 | the fetch rejects on page 2 | the error propagates; page 1 was committed through `onPage` |
| TP8 | every page | `gate.wait()` before it; `canAfford(lane, cost, keep)` before it; `record(lane, page)` after it |
| TP9 | property: random ascending id sets cut into random pages | every row reaches `onPage` once, ascending; the last `nextFromId` = max id + 1 |

## Pins this set changes ("was:" values)

Floor; the developer greps `rotation`, `LANE_CALL_CAPS`, `LANE_NARROWING_CALLS`, `COSTS` and `Record<BudgetLane`
in every test file and adds any pin found to the step that moves it.

| Pin | File, test | Now | was: |
|---|---|---|---|
| P1 | `binance.history-budget.test.ts` "holds the per-run call cap of each lane" (`toEqual`) | `tradeSymbols: 1` | no lane |
| P2 | same file "holds the narrowing calls of each lane: only the Transfer lane has any" (`toEqual`) | `tradeSymbols: 0` | no lane |
| P3 | same file "holds the Binance ceilings and per-call costs of the old withdraw rule" (`COSTS` `toEqual`) | `exchangeInfo: { api: 20 }` | no cost |
| P4 | `walk-state.test.ts` describe "the trades": stored `rotation: 3`, `EMPTY_TRADES`, "read the rotation as 0 and name it when it is %s, and keep the rest", "read a rotation or symbols left out as empty, and name nothing", "name each part it could not read, in a fixed order" | text cursor; empty `''`; a number is unreadable | number; empty 0; text unreadable |
| P5 | `exchange-state-patch.balance-synced-at.test.ts`, `exchange-state-patch.not-imported.test.ts` (`rotation: 3`) | `rotation: 'BTCUSDT'` | 3 |
| P6 | `sync-state.repo.test.ts` "writes a trade symbol, the rotation and the balance snapshot each alone", "starts the trades entry with an empty rotation and snapshot when none is stored", the disconnect case with `rotation: 2` | text; `''` | numbers; 0 |
| P7 | `exchange/walk/exchange-state-deps.test.ts` `{ kind: 'tradesRotation', value: 3 }` | a symbol text | 3 |

P4-P7 exist only under S10-Q1 B; under A they stay and step 4/10 shrinks to the barrel exports.

## Files (measured floor; the developer measures the real list)

Planned: 22 files at least. Mutable source files (`mutable_source_files` in `scripts/checks/mutation.sh`;
`index.ts`, tests, `-test-fixtures.ts` excluded): 7 at least, cap 30:
`src/crypto-sync/binance/binance.history-budget.ts`, `src/crypto-sync/exchange/paging/id-cursor-pager.ts` (new),
`src/crypto-sync/binance/binance.client.ts`, `src/crypto-sync/binance/binance.history-client.ts`,
`src/crypto-sync/exchange/walk-state/walk-state.ts`, `src/crypto-sync/exchange/walk-state/exchange-state-patch.ts`,
`src/crypto-sync/binance/binance.trade-symbols.ts` (new). Spec section 11 said about 7. The number that counts is
`KIKO_MUTATION_BASE=<set base sha> make mutable`.

---

### step 1/10: the symbol-list lane

Files: `src/crypto-sync/binance/binance.history-budget.ts`, `binance.history-budget.test.ts`.
- [ ] Tests first: P1, P2, P3; "allows one symbol-list call and refuses the second"; "judges a symbol-list call by
      the /api/* reading" (TS8: 2980 allows, 2981 refuses). Red count quoted.
- [ ] Code: `'tradeSymbols'` in `BudgetLane`; `LANE_CALL_CAPS.tradeSymbols = 1`; `LANE_NARROWING_CALLS.tradeSymbols =
      0`; both counters in `createBinanceRunBudget`; `COSTS.exchangeInfo = { api: 20 }`. Grep `Record<BudgetLane` in
      every file (tests too) and add the key where the type check asks.
- [ ] Check: suite green; `npx tsc --noEmit` clean. Commit `feat(binance): symbol-list lane`.

### step 2/10: the id-cursor pager

Files: `src/crypto-sync/exchange/paging/id-cursor-pager.ts` (new), `src/crypto-sync/exchange/paging/index.ts`,
`src/crypto-sync/binance/binance.id-cursor-pager.test.ts` (new; imports through `@kiko/crypto-sync/exchange/paging`,
the cross-folder consumer of the barrel).
- [ ] Tests first: TP1-TP9 (TP9 a seeded property, the seed printed on failure). Red count quoted.
- [ ] Code: `readIdCursor<Row, Lane extends string, Cost, Weights>({ run, lane, cost, keep, fromId, limit,
      fetchPage, idOf, onPage })` -> `Promise<{ nextFromId: number; calls: number; end: 'short-page' | 'budget' |
      'stopped' }>`. `fetchPage(fromId)` -> `Promise<{ rows: Row[] } & Weights>`; `idOf(row)` -> `unknown` checked
      by the pager (`Number.isSafeInteger`, `>= fromId`, strictly ascending; else `IdCursorPageError`);
      `onPage({ rows, nextFromId })` -> `Promise<'next' | { stopAt: number }>` (the caller commits there, so a
      later failure loses no committed page). Before each page `run.budget.canAfford(lane, cost, keep)` (else end
      `budget`), `await run.gate.wait()`, fetch, `run.budget.record(lane, page)`. A page shorter than `limit` ends
      `short-page`. No halving, no time parameter (P1). Export `export * from './id-cursor-pager'` in the barrel.
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone on the new test file. Commit
      `feat(exchange): id-cursor pager`.

### step 3/10: the public exchangeInfo read

Files: `src/crypto-sync/binance/binance.client.ts`, `binance.history-client.ts`,
`binance.history-client.exchange-info.test.ts` (new).
- [ ] First: quote Binance's doc text for `GET /api/v3/exchangeInfo` in the commit body: the parameters (every
      filter it offers), the weight, the `symbols[]` fields and their JSON types (`symbol`, `status`, `baseAsset`,
      `quoteAsset`) and the status words. A doc weight other than 20, or a parameter that would leave out a
      TRADING or BREAK symbol: stop and ask. S10-Q5: the measured body size decides whether a filter parameter
      is sent.
- [ ] Tests first: TS5, TS6, TS7, TS9, TS10 at the client (fake `fetchImpl`). Red count quoted.
- [ ] Code: `publicRequestPage(path, params, options)` in `binance.client.ts` (no key header, no signature,
      `Cache-Control: no-store`; 418/429 -> `BinanceRateLimitError` with `retryAfterMsFromHeaders`; other non-OK ->
      `requestFailedOf`); `fetchExchangeSymbols(options)` in `binance.history-client.ts` returning
      `ExchangeSymbolsPage = { symbols: BinanceExchangeSymbol[]; unreadable: number; usedApiWeight1m }`,
      `BinanceExchangeSymbol = { symbol: string; status: string; baseAsset: string; quoteAsset: string }` through
      `recordReader` (tickers through `binanceTickerOf`, `symbol` kept as sent).
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone on the new test file. Commit
      `feat(binance): read the spot symbol list`.

### step 4/10: the trades part of the walk state

Files: `src/crypto-sync/exchange/walk-state/walk-state.ts`, `exchange-state-patch.ts`, `index.ts`, and the P4-P7
test files.
- [ ] Tests first: P4-P7 retitled to the text cursor ("reads the rotation as the start and names it when it is
      %s": a number, `null`, an object); "keeps a rotation that names a symbol no longer listed" (any text reads).
      Red count quoted.
- [ ] Code: `ExchangeTrades.rotation: string`; `tradesOf` reads it with a text reader, empty `''`; `emptyTrades`
      `rotation: ''`; `tradesRotation` patch `value: string`. Barrel: `type ExchangeTrades`, `type TradeSymbol`
      (consumer: `binance.trade-symbols.ts` in step 5/10; if step 5 is not in the same commit, the developer adds
      the barrel line in step 5's commit instead).
- [ ] Check: walk-state, patch, `sync-state.repo` and `exchange-state-deps` suites green; `tsc` clean. Commit
      `feat(exchange): trades rotation cursor by symbol`.

### step 5/10: symbol discovery

Files: `src/crypto-sync/binance/binance.trade-symbols.ts` (new), `binance.trade-symbols.test.ts` (new).
- [ ] Tests first: TS1, TS2, TS3, TS4, TS8 (through `readSpotSymbols` with a fake run), TS10, and "lists each
      candidate once, ascending". Red count quoted.
- [ ] Code: `TRADE_MAIN_QUOTES`, `TRADING_SYMBOL_STATUSES` as const tuples; `touchedCoinsOf({ holdingAssets, trades,
      untrackedCoins, oversizedCoins })` (`ParsedExchangeState` parts); `tradeCandidatesOf({ listing, touched,
      trades })` -> `TradeCandidate[]` (`{ symbol, baseAsset, quoteAsset }`);
      `readSpotSymbols(run, fetchExchangeSymbols)` -> `Promise<ExchangeSymbolsPage | undefined>` (`undefined` when the lane refuses: no request), with
      `canAfford('tradeSymbols', COSTS.exchangeInfo)` -> `gate.wait()` -> fetch -> `record`.
- [ ] Check: suite green; `tsc`, knip clean; `dup.sh` alone. Commit `feat(binance): discover the trade symbols`.

### step 6/10: the rotation

Files: `binance.trade-symbols.ts`, `binance.trade-symbols.test.ts`, `binance.trade-symbols.properties.test.ts` (new).
- [ ] Tests first: TR1-TR6, TR8; the property TR7 through `runTradeSymbolReads` itself (memory "property suite
      must call production caller"): random `S`, lane, held / never-read / changed sets, candidate churn between
      runs, a fake `readSymbol` that spends 1..3 calls; assert the `ceil(S / L)` bound per symbol, `L` counted
      per run. Show it load-bearing: break the reserved call (`keep: 0` for priority reads) and quote the failing
      seed count. The trades read takes no clock input (P1: no time parameter), so the property has no clock
      gap; say so in the commit body. Red count quoted.
- [ ] Code: `planTradeSymbolReads({ candidates, trades, balanceTexts })` -> `{ priority: string[]; roundRobin:
      string[] }`; `runTradeSymbolReads({ plan, canAfford: (keep) => boolean, readSymbol: (symbol, keep) =>
      Promise<{ ended: 'short-page' | 'budget' | 'stopped' }> })` -> `{ rotation: string | undefined; ended:
      Record<string, ...> }`; `tradesPatchesOf(...)` -> `ExchangeStatePatch[]` (a `tradesRotation` patch only when
      a round-robin read returned; one `tradesBalanceSnapshot` patch per the snapshot rule). Order and the
      reserved call through a `match` on the read class, never an if-chain.
- [ ] Check: suites green; `tsc`, knip clean; `dup.sh` alone on each new test file. Commit
      `feat(binance): rotate the trade symbol reads`.

### step 7/10: spec alignment and the set 10 rulings

Files: `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`.
- [ ] Record S10-Q1 ... S10-Q6 in section 1 with their source line (rulings.md, section "Set 10 plan questions";
      never a worktree path). Align: section 2 `trades.rotation` type and "Pager interface" (S10-Q6); section 5
      "Symbol discovery" (touched sources, stored-`fromId` rule, no fallback, the failure rules), "Rotation" (text
      cursor, cursor move rule, snapshot rule), "Symbol list" row; section 7 the TS, TR, TP rows; section 11 row
      10/15 the measured file count; section 12 P2 (and S10-Q4/Q5 results if run). Point at constants (G-10).
- [ ] Lines at or under the spec's width (count characters, not bytes); never write the phrase the
      `docs-known-limit` suite bans; `make doc-suites` green. Commit `docs(spec): set 10 rulings and trade symbols`.

### step 8/10: reviews

Reviews run per task group, after the group's last step is committed (harness-workflow "Review cadence").
- [ ] G1 = steps 1/10-3/10: `kiko:reviewer`. Top question: "can the pager skip, repeat or round a trade id, or move
      a cursor past a page it never committed; can the symbol-list read spend more than one call or fail open?"
- [ ] G2 = steps 4/10-6/10: `kiko:reviewer`. Top question: "can any candidate symbol go unread past `ceil(S / L)`
      runs (churn, a throw, a held symbol, a snapshot written too early), or can a stored rotation from any state
      break the read?"
- [ ] G3 = step 7/10: `kiko:reviewer` (docs only, scoped).
- [ ] One whole-branch `kiko:reviewer` pass at the set tip, before BATCH READY. No migration: no migration review.

### step 9/10: skill text (kiko:retrospect, then kiko:scribe)

- [ ] `kiko-architecture`: replace "TRADES are out of scope." with a pointer: the trade-symbol discovery and
      rotation (`binance.trade-symbols.ts`), the pager (`exchange/paging/id-cursor-pager.ts`), not yet run by
      `runBinanceHistoryWalks` (set 11). Name the constants, not lists. Grep the skills for "Pager", "rotation"
      and walk-name lists. Pointers, no code copies. The report names the drift-fix sha or "no drift found". A
      `harness/kiko` change bumps the plugin version.

### step 10/10: gates and BATCH READY

- [ ] `bash scripts/job-queue.sh check-all <worktree> "crypto-exchanges-1.3-a task 10/15 check-all"` exit 0.
- [ ] `KIKO_MUTATION_BASE=<set 10 base sha> make mutable`: quote the file list, `mutable files: N (cap 30)` and the
      `timeout share (history)` line. Above 30: stop and split.
- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task
      10/15 deep" <base> <head>` (`KIKO_MUTATION_BASE=<set 10 base sha> make deep`), detached; agents wait for the
      exit code only. TIMEOUT-HEAVY (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"): when it is the
      only failure, the gate reruns the timed-out mutants alone and that report is the verdict; only if it still
      fails or is skipped, prove each timed-out mutant in plain jest (`npx jest <own tests> --runInBand`) or write
      it as equivalent. Never raise the timeout.
- [ ] `make verify` once at the set tip through the queue (`bash scripts/job-queue.sh verify <worktree>
      "crypto-exchanges-1.3-a task 10/15 verify"`, tree clean, HEAD unchanged until DONE), re-run until green.
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer verdicts, the scribe
      sha, the S10-Q rulings applied, the S10-Q4/Q5 probe status, and "no production caller until set 11" (G-6).

## Review focus

1. A cursor that loses a trade: `nextFromId` past an uncommitted page, an id read as a float or a string, a page
   with a gap the pager trusts (TP6).
2. Starvation: a symbol that never reaches the round-robin (cursor compare `>` vs `>=` on text, a cursor naming a
   symbol no longer listed, priority reads that take the reserved call).
3. A snapshot that forgets a change: a coin's entry written while one of its symbols is still unread (TR6).
4. The symbol list failing open: a malformed listing read as "no symbols", or stored symbols read on a guess.
5. A symbol whose `myTrades` read fails every run blocks the round-robin behind it (cursor stays before it). Logged
   every run by set 11's `logOnFailure`; the reviewer says whether set 11 needs a per-symbol skip.

## Pre-flight self-check (planner)

- No copy key, no screen change, no request in production (G-6, G-11).
- G-1 every step; G-2 steps 1, 4; G-3 steps 2-6; G-4 none; G-5 steps 5, 6, 9; G-7 step 1; G-8 step 2; G-9 steps 3, 5;
  G-10 steps 7, 9; G-12 every commit; G-13 every step.

## Questions for the coordinator (S10-Q1 ... S10-Q6)

- S10-Q1 `trades.rotation` shape. A: keep `number` as an index into the sorted candidates (no pin change; a symbol
  removed before the index skips one symbol for a whole cycle, so the bound breaks under churn). B: the text of
  the last round-robin symbol read (`> cursor`, then wrap; bound holds under churn; pins P4-P7 change; no stored
  value exists). Recommend B: the bound must hold when the user touches a new coin.
- S10-Q2 a symbol with a stored `fromId` whose status left TRADING/BREAK (HALT, END_TRADING) but is still listed.
  A: stays a candidate (its last trades are still read). B: spec as written (dropped). Recommend A: a halted pair
  may hold trades made before the halt.
- S10-Q3 `exchangeInfo` failure or cache. A: one read per run, no cache; a failure reads no symbol that run (logged
  by set 11). B: a session cache (24 h). C: on failure, read the stored-`fromId` symbols. Recommend A: spec "once
  per run", fail visible, no fallback never seen live.
- S10-Q4 trade `id` / `orderId` JSON types (unrecorded by probe 3). A: a read-only probe 8 (user key, one
  `myTrades` call on BTCUSDT, types and safe-integer status only) before set 11 starts; set 10 refuses unsafe ids.
  B: no probe. Recommend A: Convert's `orderId` was past 2^53 (R-S8-6).
- S10-Q5 `exchangeInfo` body size (unmeasured; probe 3 asked one symbol per call). A: the coordinator measures one
  public `GET /api/v3/exchangeInfo` (no key) before step 3/10; the step sends a doc-quoted filter only if the body
  is large. B: no measure. Recommend A: "bounds are measured"; a large body on every pull costs mobile data.
- S10-Q6 the spec's shared `Pager` type. A: no shared type in set 10; `idCursorPager` stands alone and the spec
  text is aligned. B: add `Pager` and adapt the offset paging. Recommend A: no consumer needs the shared type, and
  the refactor widens a TIMEOUT-HEAVY fan-out.
