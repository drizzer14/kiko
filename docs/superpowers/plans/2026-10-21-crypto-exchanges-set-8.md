# Crypto exchanges 1.3-a, change set 8: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `crypto-exchanges-1.3-a task 8/15`: the Binance Convert walk (status first, then `walletType`,
30-day windows read forward from `HISTORY_FLOOR_MS`), the `notImported` list in `exchange_state` (kinds, parse,
union patch, disconnect), `notImportedCountsOf`, the not-imported line with its en + uk copy, and the adoption rule
that keeps an exchange row's markers (run-log gap `20261020T2124-kiko-binance-set7/1`, the entry criterion).

**Architecture:** the Convert walk is a Pay-shaped walk (one series, a span that halves on a full page) on its own
lane, built on the shared engine (`planWalkPasses`, `runWalkPlan`, `walkSpans`, `commitSettledSpan`,
`placeWalletRows`). A record a rule refuses for good becomes one `notImported` entry, written as a union beside the
span's marks; the account detail counts the entries per kind. Rows carry `operation = 'convert'` and the pair
markers, or `asset:<CODE>` for an untracked side; statistics stay on the stored markers.

**Tech stack:** React Native, op-sqlite + Drizzle, Jest with `node:sqlite` (`src/test-support/real-sqlite.ts`),
fnts `maybe`/`Either`, ts-pattern, i18next.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: section 11 row 8/15; section 5 stream
row "Convert", "Refused window and walk direction", "Measured weights", "### Convert"; section 2 "Walk state in
`sync_state`" and the `exchange/history-status/` row, "History-behind caption"; section 6 "Mapping and statistics
per operation" (Convert rows), "The `operation` column", "Untracked-counterpart codes", "Not-imported line";
section 7 rows C1-C10, N4-N7, K8; section 10 rows `accountDetail.notImported*`; section 12 P4. Rulings
(`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md`, main checkout): C-NR-A, C-NR-C, C-Convert-wallet,
R-Walk A, S7-Q1..S7-Q8, U1-U4. Set 8 questions S8-Q1..S8-Q8 go to the coordinator with this plan; the plan applies
each recommendation, marked "(DEFAULT, pending S8-Q<n>)".

**Base:** branch `binance-set8` at main `df5475f6` (sets 1-7 and the set 7 follow-up). Every code fact names a
symbol or anchor text. **The developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Test names and comments carry no
  scenario id, no ruling id and no history text; the commit message carries them. Tests never read `src` text.
- G-2 A pin a behaviour change moves is updated in the same step (table "Pins this set changes"); never in a fix
  round. Retitle each changed test so its name states the new rule.
- G-3 Identifiers in full words; imports through `@kiko/<feature>` barrels (the `exchange/` units import one
  another as `../<sibling>`); every new export has a consumer at its own commit (knip still flagging it: stop and
  report, never add an ignore).
- G-4 No migration in set 8 (so no migration review and no EXPLAIN QUERY PLAN test). Stop and ask if one appears.
- G-5 Status first (spec "### Convert"): `FAIL` -> no row, no entry; `PROCESS`, `ACCEPT_SUCCESS` -> owed point;
  `SUCCESS` -> the `walletType` check; any other word -> `convert-unrecognized`. `walletType` `FUNDING` ->
  Funding, `SPOT` -> Spot; missing, null or any other word -> `convert-unrecognized`, no leg.
- G-6 Walk: 30-day windows from `HISTORY_FLOOR_MS` read forward; empty windows never stop it; no new refusal code
  in `requestFailedOf` (probe 5); a -5026 start is narrowed by the depth search and never ends the walk; any other
  4xx keeps the window and its cursor.
  SUPERSEDED for Convert by S8-C1 (rulings.md, section Set 8 plan questions): a -5026 fails the run, no narrowing.
- G-7 Lane `convert`: cap 20, no narrowing calls, cost `{ uid: 3_000 }` (20 x 3000 = 60000 <= 180000).
- G-8 Every Convert row (both legs, and a lone tracked leg) carries `operation = 'convert'`, insert-only
  (`addManyDedup`'s upsert never refreshes it, set 7). Description `''` (the label renders).
- G-9 `notImported` holds each entry once; only a disconnect clears it; an entry never shows the caption (K8).
- G-10 Copy: en + uk for every new key, kiko-translator casing ("P2P", "Convert" kept; uk items lowercase in the
  sentence); counts are bare numbers in parentheses, no plural keys. Translator review in G4.
- G-11 U1: no device deploy and no device step in this set.
- G-12 Guideline 2.5.19: no flag. The not-imported line, like the not-tracked line, needs a connected Binance
  account, which the demo `.kiko` cannot carry (its accounts keep `institution` null): the coordinator adds the
  line to the reviewer-notes draft (`memory/refs/resubmission-kit.md`), with no repo change. The new endpoint is on
  the same Binance host (no new SPKI pin); App Privacy data types are unchanged: the coordinator confirms in that
  kit's section D.
- G-13 The P2P cover rule (rulings.md 2026-10-21) is not set 8. It keys on the `p2p:` code
  (`parseUntrackedCounterpart`), never on `operation` (S7-Q5); the S8-Q2 adoption rule carries a `p2p:` code
  through an adoption too, so set 8 blocks nothing of it.
- G-14 Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.
  `bash scripts/checks/dup.sh <file>` alone on each new or grown test file.

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-21)

- `20261020T2124-kiko-binance-set7/1` (adoption drops `operation` and the markers): CLOSED by step 2/14
  (answered A, S8-Q2). The BATCH READY names the closing sha.
- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks the institution, not the connection): LEFT
  OPEN; the Convert walk writes through the same gated `patchExchangeState`, so it inherits the gap, no worse.
- `20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`,
  `20261018T1637-kiko-harness-h9/2` (TIMEOUT-HEAVY fan-out): LEFT OPEN; `records.ts`, `walk-state.ts`,
  `exchange-state-patch.ts` and `transactions.repo.ts` have a wide related-test fan-out; step 14/14 applies the
  gate rerun rule.
- `20261017T2005-kiko-harness-h8/6` (no live TIMEOUT-HEAVY rerun proof yet): LEFT OPEN, closed by the set 8 gate
  only if it meets a real TIMEOUT-HEAVY file (the BATCH READY says which).
- `20261015T1657-kiko-binance-backfill-fix/2`, `20261019T0912-kiko-account-currency/1` (migrations): not touched
  (no migration).
- New gap to file in step 14/14 (answered A, S8-Q7): no code logs `ParsedExchangeState.unreadable`.
- Every other open gap (harness, Duo, iPad, scrub, pickers, ops skill text): LEFT OPEN, unrelated.

## Scenario matrix (each row is a Jest case; "was:" shows the result before set 8 where it changes)

Convert records (step 7/14 unless noted). "was:" for every C row: not imported (Convert was deferred, D7).

| # | Record | Result now |
|---|---|---|
| C1 | SUCCESS, FUNDING, UAH -> USDT | Funding UAH -, Funding USDT +; one pair id; each leg names the other's holding |
| C1 | (cont.) | keys `${pairId}:UAH:funding`, `${pairId}:USDT:funding`; `operation` convert; excluded |
| C1b | SUCCESS, SPOT | Spot legs, keys `${pairId}:UAH`, `${pairId}:USDT` |
| C2 | PROCESS / ACCEPT_SUCCESS, any `walletType` | owed point; no row; no entry |
| C3 | SUCCESS, `walletType` missing, null, `SPOT_FUNDING`, `MAIN` | no leg; one `convert-unrecognized` entry |
| C3 | (cont., step 8/14) | cursor past it; a second run adds no entry (S8-Q8) |
| C4 | `orderStatus` `EXPIRED`, `''`, absent | one entry; `walletType` not read |
| C5 | FAIL, FUNDING | no row, no entry; point returned |
| C6 | SUCCESS, FUNDING, USDT -> PEPE | Funding USDT - alone, `asset:PEPE`, no pair id, key `${pairId}:USDT:funding` |
| C6 | (cont.) | PEPE on the not-tracked line |
| C6b | SUCCESS, PEPE -> SHIB | no row, no entry; both tickers on the not-tracked line |
| C6c | SUCCESS, USDT -> USDT | one `convert-unrecognized` entry, no row (answered A, S8-Q6) |
| C6d | SUCCESS, a tracked side's amount `0`, `-1`, `1e-3`, over-precise, absent | owes its point; others import |
| C8 | one conversion in 2026-01, every other window empty (step 8/14) | every window read once; imported as C1 |
| C9 | a start answered -5026 (step 8/14) | narrowed to the served start; nothing owed below; the walk goes on (SUPERSEDED by S8-C1: the run fails) |
| C9b | a window answered -1127 (step 8/14) | a failure: window and cursor stay; the next run reads it again |
| C9c | first walk, 113 windows, lane cap 20 (step 8/14) | the window 104 conversion imports at run 6 of 6 |
| C10 | FAIL, `walletType` missing or `MAIN` | no row, no entry (status first) |
| C11 | `moreData` true (step 8/14) | the span halves; 1 ms still `moreData` owes the span (`convert-page-stuck`) |
| C12 | no usable record id (S8-Q1), or no `createTime` | unreadable: owes its point, or the span when it has no time (S8-Q1: `quoteId` only) |

State, line and caption (steps 3/14, 9/14, 10/14):

| # | State | Result now | was: |
|---|---|---|---|
| N4 | `notImported` empty | line hidden | n/a |
| N5 | one `convert-unrecognized` | en line, text in the copy table of step 10/14, count (1) | n/a |
| N5u | N5 in uk | uk line, count (1) | n/a |
| N6 | disconnect, reconnect, walk again | list cleared, line hidden; one entry again | n/a |
| N7a | `notImported` is `"x"`, `{}`, `null` | reads empty; name `notImported`; siblings intact | n/a |
| N7b | entries `bybit-x:1:2`, `5`, `''` beside a good one | each dropped, name `notImported.<index>` | n/a |
| K8 | every cursor current, only entries | caption hidden; line shown | n/a |
| K2c | Convert cursor null, the four others current | caption shown (answered A, S8-Q5) | hidden |

Adoption (step 2/14, answered A, S8-Q2):

| # | Sync input adopting a plain import twin | Adopted row | was: |
|---|---|---|---|
| A1 | Convert leg: pair id, counterpart, `convert` | carries the three and `operation` | nulls; counts as spending |
| A2 | lone leg: `asset:PEPE`, `convert` | carries `asset:PEPE` and `convert` | nulls; counts as spending |
| A3 | any marked input; the twin has the user's own pair | the twin's pair, marker, null `operation` | same |
| A4 | Monobank input, no markers | unchanged | same |

## Pins this set changes ("was:" values)

- P1: `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`
  "sweeps XRP dust into BNB on the two existing holdings, with no Dogecoin holding".
- P2: `src/crypto-sync/binance/binance.history-budget.test.ts` describe `LANE_CALL_CAPS` (its `toEqual`).
- P3: `src/screens/account-detail/crypto-sync-section/binance-history-status.test.ts` describe `walkCursorsOf`.
- P4: `crypto-sync-section.component.test.tsx` caption cases through its `walkCursors` helper.
- P5: `src/crypto-sync/run-crypto-sync/run-crypto-sync.test.ts`
  "runs the walks in order, capital, Pay, Transfer, Earn, all on one run object" and
  "logs nothing and runs all four walks on a state that parses, an unreadable entry too".
- P6: `src/crypto-sync/exchange/walk-state/walk-state.test.ts` `EMPTY_STATE`, and every full parsed-state
  literal `tsc` names.
- P7: `src/sync-state/sync-state.repo.test.ts`, the comment "The parse drops `notImported`".

| Pin | Now | was: |
|---|---|---|
| P1 | title "sweeps XRP dust into BNB on the two existing holdings"; no name check | `not.toContain('Dogecoin')` |
| P2 | `convert: 20` added | no `convert` |
| P3 | five cursors, `convert` last | four |
| P4 | the helper writes a `convert` cursor too | four walks |
| P5 | Convert after Earn; five walks | four |
| P6 | `notImported: []` added | no field |
| P7 | "drops an entry of a kind this build does not know" | drops the whole list |

## Files (measured floor; the developer measures the real list)

Planned: 39 files at least (the lists below; the parsed-state literals `tsc` names in step 3/14 add to it).
Mutable source files (`mutable_source_files` in `scripts/checks/mutation.sh`; `index.ts`, tests, `e2e/`,
`i18n/locales/` excluded): 12 at least, cap 30:
`src/transactions/repo/transactions.repo.ts`, `src/crypto-sync/exchange/walk-state/walk-state.ts`,
`src/crypto-sync/exchange/walk-state/exchange-state-patch.ts`, `src/crypto-sync/exchange/walk/records.ts`,
`src/transactions/untracked-counterpart/untracked-counterpart.ts`, `src/crypto-sync/binance/binance.history-client.ts`,
`src/crypto-sync/binance/binance.history-budget.ts`, `src/crypto-sync/binance/binance.convert-history.ts` (new),
`src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`, `src/crypto-sync/exchange/history-status/history-status.ts`,
`src/screens/account-detail/crypto-sync-section/binance-history-status.ts`,
`src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.tsx`.
Spec section 11 said about 10. The number that counts is `KIKO_MUTATION_BASE=<set base sha> make mutable`.

---

### step 1/14: deferred test Minors (test only, the set's first commit)

Files: `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`.
- [ ] "keeps each existing Binance holding's end balance": add `expect(cryptoHoldings).toHaveLength(10)` beside
      the `toEqual` of `balanceByCurrency` (a holding of a duplicate currency passes the `toEqual` today).
- [ ] P1: drop the `not.toContain('Dogecoin')` line; retitle as in the pins table.
- [ ] Check: `npx jest e2e/screenshot/fixtures/build-demo-snapshot.test.ts` green, same test count. No demo
      regeneration (data unchanged). Commit `test(demo): pin the crypto holding count, drop the name check`.

### step 2/14: the adoption keeps an exchange row's markers (answered A, S8-Q2)

Files: `src/transactions/repo/transactions.repo.ts`, `src/transactions/repo/transactions.repo.sync-adoption.test.ts`.
- [ ] Tests first (real sqlite, beside "adopts for a Binance row the same way"): A1 "carries the pair, the
      counterpart and the operation of an exchange leg onto a plain import row"; A2 "carries the untracked code and
      the operation of a lone leg"; A3 "keeps the pair the user made on the import row, with no operation"; A4
      stays green ("turns each import row into the sync row of its own purchase, keeping its own category"); plus
      "keeps the adopted leg out of spending" (through `exchangeExcludedTransactionIds`). Red: A1, A2 and the
      spending case (quote the count).
- [ ] Code: `ImportTwin` selects `exchangePairId`, `exchangeCounterpartHoldingId`, `untrackedCounterpart`
      (`readImportTwinsDatabaseTransaction`); `adoptedValuesOf` spreads one unit of four columns: from the input
      when the twin carries none of the three markers, else nothing (the twin's stay). A const tuple names the
      three marker columns once. Rewrite the doc comment of `adoptImportTwinsDatabaseTransaction` ("every
      structural column ... stays") and the schema comment anchor "a marked import row the reconnect sync adopts"
      only if it now misleads.
- [ ] Check: the whole `transactions.repo.sync-adoption.test.ts` and `transactions.repo.category-rules.test.ts`
      green. Commit `fix(transactions): an adopted exchange row keeps its markers` (body: closes run-log gap
      `20261020T2124-kiko-binance-set7/1`).

### step 3/14: the not-imported list in the walk state

Files: `src/crypto-sync/exchange/walk-state/walk-state.ts`, `exchange-state-patch.ts`, `index.ts`,
`walk-state.not-imported.test.ts` (new), `exchange-state-patch.not-imported.test.ts` (new), `walk-state.test.ts`,
`src/sync-state/sync-state.repo.test.ts`, `src/crypto-sync/disconnect/disconnect.real-sqlite.test.ts`, every
full `ParsedExchangeState` literal `tsc` names (P6).
- [ ] Tests first. Parse: N7a, N7b, "counts a known entry", "keeps an entry once when the list holds it twice"
      (a read never double-counts), malformed top level unchanged. Patch: "adds entries as a union, no duplicates";
      "keeps a stored entry of a kind this build does not know" (raw patch, a newer build's entry survives);
      "drops a stored entry that is no text"; "starts a list that was not a list from the new entries"; "leaves
      every other field byte-identical" (one `it.each` case in `sync-state.repo.test.ts` beside the coin-list
      case). Disconnect, N6 first half: "clears the not-imported list" in `disconnect.real-sqlite.test.ts`
      (characterization: `exchangeStateReset` keeps walks only; green on first run, say so in the commit).
- [ ] Code in `walk-state.ts`: `NOT_IMPORTED_KINDS = ['p2p-sale', 'p2p-advertiser', 'p2p-amount',
      'p2p-unrecognized', 'convert-unrecognized', 'fiat-unrecognized'] as const`, `NotImportedKind`,
      `notImportedEntry(kind, recordId, timeMs)` -> `` `${kind}:${recordId}:${timeMs}` ``, `notImportedKindOf(entry)`
      (the text before the first `:`, when it is a kind; else `undefined`); `ExchangeState.notImported?: string[]`;
      `ParsedExchangeState` (parsed arm) gains `notImported: string[]` (known-kind entries, unique, stored order);
      unreadable names `notImported` (not a list) and `notImported.<index>` (answered A, S8-Q7: names only,
      no log line). In `exchange-state-patch.ts`: patch `{ kind: 'notImported'; entries: string[] }`, applied by
      `withNotImported` in `patchedState`; reword the two doc comments that say the parse drops `notImported`.
      Barrel: export `NOT_IMPORTED_KINDS`, `NotImportedKind`, `notImportedEntry`.
- [ ] Check: `npx tsc --noEmit` clean; every touched suite green. Commit
      `feat(exchange): not-imported list in the walk state`.

### step 4/14: the walk engine carries not-imported entries

Files: `src/crypto-sync/exchange/walk/records.ts`, `src/crypto-sync/exchange/walk/records.not-imported.test.ts`
(new).
- [ ] Tests first: "joins the entries of every part once"; "writes the entries after the rows and before the
      marks" (call order through fakes); "writes no entry for a forward span that stops"; "writes nothing when
      the span holds no entry". Red: the field is missing.
- [ ] Code (answered A, S8-Q3): `SettledSpan.notImported?: string[]`, unioned in `joinSettled` like
      `untracked`; `commitSettledSpan` takes optional `writeNotImported` and calls it once, after
      `writeUntracked`, before `advance`; `notImportedWriterOf(deps, accountId)` beside `historyListWriterOf`
      (one `{ kind: 'notImported' }` patch). Extend the `commitSettledSpan` doc comment by one sentence.
- [ ] Check: `records.not-imported.test.ts` and the Pay, Transfer, Earn and capital suites green (they pass no
      writer). Commit `feat(exchange): walks write not-imported entries beside their marks`.

### step 5/14: the `asset:` code builder

Files: `src/transactions/untracked-counterpart/untracked-counterpart.ts`, `untracked-counterpart.test.ts`.
- [ ] Tests first: `untrackedAssetCode('PEPE')` -> `'asset:PEPE'`; `''` and `'A:B'` -> `undefined`; round trip
      "every code it builds parses back to the same asset" (`parseUntrackedCounterpart`, an `it.each` over
      `PEPE`, `1000SATS`, `ETH`).
- [ ] Code: `untrackedAssetCode(ticker: string): string | undefined` under the parse rule S7-Q3 (non-empty, no
      `:`). No total, so no section 5 marker-total normalization applies to `asset:`. The consumer (step 7/14)
      lands later: the test through the barrel is the consumer at this commit (G-3). Commit
      `feat(transactions): build the asset counterpart code`.

### step 6/14: the Convert read and its lane

Files: `src/crypto-sync/binance/binance.history-client.ts`, `binance.history-client.convert.test.ts` (new),
`binance.history-budget.ts`, `binance.history-budget.test.ts`.
- [ ] First: quote Binance's doc text for `GET /sapi/v1/convert/tradeFlow` in the commit body (parameters,
      30-day limit, `limit` maximum, `moreData`, the `orderStatus` values, the JSON type of `orderId` and
      `quoteId`). S8-Q1: when the coordinator runs probe 6, its measured `orderId` type decides the key; until
      then build the DEFAULT (was the default, pending S8-Q1): id = `orderId` as a string or safe integer, else `quoteId`, else
      unreadable. (SUPERSEDED: S8-Q1 = A, probe 6; the id is the `quoteId` only, never `orderId`.)
      A doc that contradicts G-5's status words: stop and ask.
- [ ] Tests first: "reads a SUCCESS record with every field" (record fields `orderId`/`quoteId` -> `recordId`,
      `orderStatus`, `walletType`, `fromAsset`, `fromAmount`, `toAsset`, `toAmount`, `createTime`); "reads a
      missing or null `walletType` as undefined"; "reads a record whose assets or amounts are absent, status
      first" (optional text, so a FAIL record never sticks); "reads a record with no usable id as unreadable,
      keeping its time"; "reads `moreData`"; "fails the page for a body with no list" (`BinanceHistoryParseError`);
      "sends startTime, endTime and limit 1000"; weights from the headers. Budget: P2 and `canAfford` 20 calls.
- [ ] Code: `CONVERT_PAGE_LIMIT = 1000`; `ConvertHistoryPage = HistoryPage<BinanceConvertRecord> & { moreData:
      boolean }`; `fetchConvertHistory(apiKey, secret, { startTime, endTime }, options)` via `signedRequestPage`;
      upper-case the asset texts once. Budget: lane `convert` in `BudgetLane`, `LANE_CALL_CAPS` 20,
      `LANE_NARROWING_CALLS` 0, both counters in `createBinanceRunBudget`, `COSTS.convert = { uid: 3_000 }`.
- [ ] Check: both suites green; `tsc` clean. Commit `feat(binance): read the Convert trade flow`.

### step 7/14: a Convert record's rows or entry

Files: `src/crypto-sync/binance/binance.convert-history.ts` (new), `binance.convert-history.test.ts` (new),
`binance.convert-test-fixtures.ts` (new, if the record builder is shared by steps 7-8).
- [ ] Tests first: C1, C1b, C2, C3 (each word), C4, C5, C6, C6b, C6c, C6d, C10, C12 through `convertOutcomeOf`;
      "carries `operation` convert on each leg"; "pair id `${accountId}:convert:<id>` on both legs, none on a lone
      leg"; "entry `convert-unrecognized:<id>:<createTime>`"; uk/en irrelevant here.
- [ ] Code: `convertOutcomeOf({ accountId, record })` -> a `match` over `orderStatus` (never an if-chain):
      `{ kind: 'rows'; rows: PlannedConvertRow[]; untracked: string[] }` | `{ kind: 'refused'; entry: string }`
      | `{ kind: 'none' }`; a settled-but-unplaceable record throws `BinanceWalkStop` (`convert-not-settled`,
      `convert-row-unreadable`, `convert-amount-invalid`; amounts through `rowMinorUnits`, above zero). Wallet from
      `walletType` (`FUNDING` -> `'funding'`, `SPOT` -> `'spot'`), keys through `holdingKeyOf`; a lone leg uses
      `untrackedAssetCode`. `CONVERT_FORWARD_OWES = [convert-not-settled, convert-row-unreadable,
      convert-amount-invalid, ...AMOUNT_STOP_CODES]` (the point is owed, the cursor moves on, as Transfer).
- [ ] Check: the suite green; `tsc` clean. Commit `feat(binance): map a Convert record`.

### step 8/14: the Convert walk

Files: `binance.convert-history.ts`, `binance.convert-history.test.ts`, `binance.convert-history.real-sqlite.test.ts`
(new), `binance.convert-history.properties.test.ts` (new).
- [ ] Tests first (fake deps): C8 (every window read, fetch count = window count); C9 (fake refuses starts below
      a depth: the walk narrows, imports a record above it, owes nothing below; SUPERSEDED by S8-C1:
      the run fails); C9b; C9c (runs to window 104 =
      6); C11 (halving and `convert-page-stuck`); C3's second run; "reads nothing while cooling down"; "reads
      nothing without credentials"; "stops on a rate limit and sets the cooldown"; "writes no multi-coin marks"
      (spec section 7: Convert needs no backfill range). Real sqlite: C1 lands on "Binance Funding · UAH" and
      "Binance Funding · USDT" (created at zero), excluded from statistics; C6's lone leg excluded; N6 second half
      (disconnect, reconnect, walk again: one entry). Properties at run gaps 0 / 1 h / 1 day (`RUN_GAPS`), random
      record sets through `syncBinanceConvertHistory` itself: every importable record imported once (unique
      keys), each refused record one entry, no row for FAIL, the walk ends current.
- [ ] Code: `syncBinanceConvertHistory({ targetAccountId, run }, overrides)` shaped as `syncBinancePayHistory`
      without the uid read: `readWalkMarks(deps, accountId, 'convert')`, `planWalkPasses` (`floorMs:
      HISTORY_FLOOR_MS`, `windowMs: CONVERT_WINDOW_MS = 30 * DAY_MS`, `overlapMs: RESYNC_OVERLAP_MS`,
      `maxWindows: CONVERT_MAX_WINDOWS = 20`), `runWalkPlan` + `walkSpans`; `readSpan` splits on `moreData`
      (`halfOf`); (SUPERSEDED by S8-C1: a `BinanceHistoryTooOldError` fails the run, no narrowing)
      on `BinanceHistoryTooOldError` it calls `narrowRefusedStart` (`floorMs: HISTORY_FLOOR_MS`,
      `config: BINANCE_DEPTH_CONFIG`, a probe that spends the lane) and commits the span read from the served
      start; `commitSpan` uses `commitSettledSpan` with `forwardOwes: CONVERT_FORWARD_OWES`,
      `writeNotImported: notImportedWriterOf(...)`, `placeWalletRows` (`missingCode: 'convert-holding-missing'`),
      `restartMs: HISTORY_FLOOR_MS`. No `multiCoinPatches`.
- [ ] Check: the three suites green; `dup.sh` alone on each new test file. Commit
      `feat(binance): Convert history walk`.

### step 9/14: run the walk and caption it

Files: `src/crypto-sync/binance/index.ts`, `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`,
`run-crypto-sync.test.ts`, `src/screens/account-detail/crypto-sync-section/binance-history-status.ts`,
`binance-history-status.test.ts`, `crypto-sync-section.component.test.tsx` (P4 helper).
- [ ] Tests first: P5 (order capital, Pay, Transfer, Earn, Convert on one run object); "still resolves with the
      balance result when the Convert walk fails, logging only its name"; "runs the Convert walk even when the
      Earn walk failed". Caption (answered A, S8-Q5): P3, K2c; P4's helper writes a `convert` cursor.
- [ ] Code: export `syncBinanceConvertHistory`; `runBinanceHistoryWalks` runs it after Earn in its own
      `logOnFailure('[binance sync] convert history failed', ...)`; move the "Last, so ..." comment to it.
      `CAPTION_WALKS` gains `'convert'`; its doc comments name five walks.
- [ ] Check: suites green. Commit `feat(binance): run the Convert walk after Earn`.

### step 10/14: the not-imported line and its copy (answered A, S8-Q4)

Files: `src/crypto-sync/exchange/history-status/history-status.ts`, `index.ts`, `history-status.test.ts`;
`src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.tsx`,
`crypto-sync-section.component.test.tsx`; `src/i18n/locales/en.ts`, `uk.ts`.
- [ ] Copy under `accountDetail` (alphabetical with its neighbours; a nested `notImportedKind`):
      `notImported`:
      en "Not imported: {{items}}. Kiko does not import these {{exchange}} records yet."
      uk «Не імпортовано: {{items}}. Кіко поки не імпортує ці записи {{exchange}}.»
      Under `notImportedKind` (en / uk):
      | key | en | uk |
      |---|---|---|
      | `p2pSale` | P2P sales ({{count}}) | продажі P2P ({{count}}) |
      | `p2pAdvertiser` | P2P orders as advertiser ({{count}}) | замовлення P2P у ролі оголошувача ({{count}}) |
      | `p2pAmount` | P2P orders with unclear amounts ({{count}}) | замовлення P2P з неоднозначною сумою ({{count}}) |
      | `p2pUnrecognized` | P2P orders Kiko does not recognize ({{count}}) | замовлення P2P, яких Кіко не розпізнає |
      | (cont.) | | ({{count}}) |
      | `convertUnrecognized` | Convert orders Kiko does not recognize ({{count}}) | операції Convert, яких Кіко не |
      | (cont.) | | розпізнає ({{count}}) |
      | `fiatUnrecognized` | fiat operations Kiko does not recognize ({{count}}) | фіатні операції, яких Кіко не |
      | (cont.) | | розпізнає ({{count}}) |
      Each value is the spec section 10 text exactly (re-read it there; a "(cont.)" row continues the cell).
      Where a user sees each: the account detail of a connected Binance account, Synchronization section, under
      the oversized line. The en kind items start lowercase or with a kept proper noun mid-sentence; check the
      `en.casing-by-role` role for a caption fragment and record the role in the commit.
- [ ] Tests first: `notImportedCountsOf` (kind order of `NOT_IMPORTED_KINDS`, zero counts left out, malformed ->
      `[]`); component N4, N5, N5u, K8, "counts 2 as (2) in en and uk" (bare number), "keeps the line while a sync
      is in flight", "shows no line while the state row loads", "shows no line for a wallet account", "shows no
      line for a malformed state". Red counts quoted.
- [ ] Code: `notImportedCountsOf(state): { kind: NotImportedKind; count: number }[]`; in the component file a
      `notImportedKindCopyKeys: Record<NotImportedKind, ParseKeys>` and a `NotImportedLine` FC (as `CoinLines`,
      split out for the complexity budget) rendered after `CoinLines` under `coinLinesShown`; items joined with
      `', '`; `exchange` from `providerDisplayName(connectedProvider, t)`.
- [ ] Check: suites green; `en.uk.parity`, `en.casing-by-role`, `en.final-stop-by-role`, `uk.casing`,
      `uk.catalog-rules`, `title-keys.call-sites` green; `npm run check:component-i18n-namespace`. Commit
      `feat(account-detail): not-imported line`.

### step 11/14: spec alignment and the set 8 rulings

Files: `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`.
- [ ] Record S8-Q1 ... S8-Q8 as coordinator rulings in section 1 with their source line (rulings.md, section
      "Set 8 plan questions"; never a worktree path), each as answered, and align the text each touches: S8-Q1
      section 5 "### Convert" (the id rule); S8-Q2 section 6 (adoption keeps the exchange markers) and the
      kiko-statement-import pointer; S8-Q3 section 2 "Writer" (`notImported` beside the cursor write); S8-Q4
      section 6 "Not-imported line"; S8-Q5 section 2 "History-behind caption"; S8-Q6 section 5 "### Convert";
      S8-Q7 section 2 Parse; S8-Q8 row C3. Section 2 code block: `ParseKeys` for `TranslationKey`. Section 11 row
      8/15: the measured file count.
- [ ] Lines at or under the spec's width; never write the phrase the `docs-known-limit` suite bans; `make
      doc-suites` green. Commit `docs(spec): set 8 rulings and Convert walk facts`.

### step 12/14: reviews

Reviews run per task group, after the group's last step is committed (harness-workflow "Review cadence").
- [ ] G1 = steps 1/14-2/14: `kiko:reviewer`. Top question: "can an adopted exchange row lose a marker, or a
      user's own pair be overwritten, in any order of import, sync and delete?"
- [ ] G2 = steps 3/14-5/14: `kiko:reviewer`. Top question: "can a not-imported entry be lost, doubled, or
      survive a disconnect; can a newer build's entry or a sibling field be dropped by a patch?"
- [ ] G3 = steps 6/14-9/14: `kiko:reviewer`. Top question: "can a settled conversion be skipped silently, imported
      twice, placed on the wrong wallet, or hold the walk forever (S8-Q1 id, `moreData`, -5026)?"
- [ ] G4 = steps 10/14-11/14: `kiko:reviewer` plus the kiko-translator review of the seven keys (en + uk); the uk
      keys go to the coordinator for the user's list.
- [ ] One whole-branch `kiko:reviewer` pass at the set tip, before BATCH READY.

### step 13/14: skill text (kiko:retrospect, then kiko:scribe)

- [ ] `kiko-architecture`: the Convert walk (lane, window,
      status-first rule, depth safety net (SUPERSEDED by S8-C1: a Convert -5026 fails the run)), the
      `notImported` list (kinds, parse, union patch beside the marks, disconnect), the line. `kiko-domain`: Convert
      rows and markers; the adoption rule (S8-Q2) beside "The sync adopts its import twin" in
      `kiko-statement-import`. Pointers, no code copies. The report names the drift-fix sha or "no drift found".

### step 14/14: gates and BATCH READY

- [ ] `bash scripts/job-queue.sh check-all <worktree> "crypto-exchanges-1.3-a task 8/15 check-all"` exit 0.
- [ ] `KIKO_MUTATION_BASE=<set 8 base sha> make mutable`: quote the file list, `mutable files: N (cap 30)` and the
      `timeout share (history)` line. Above 30: stop and split.
- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task 8/15
      deep" <base> <head>` (`KIKO_MUTATION_BASE=<set 8 base sha> make deep`), detached; agents wait for the exit
      code only. TIMEOUT-HEAVY (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"): when it is the only
      failure, the gate reruns the timed-out mutants alone and that report is the verdict; only if it still fails
      or is skipped, prove each timed-out mutant in plain jest (`npx jest <own tests> --runInBand`) or write it
      as equivalent. Never raise the timeout.
- [ ] `make verify` once at the set tip through the queue (`bash scripts/job-queue.sh verify <worktree>
      "crypto-exchanges-1.3-a task 8/15 verify"`, tree clean, HEAD unchanged until DONE), re-run until green.
- [ ] File the S8-Q7 run-log gap (unlogged `unreadable` names) per harness-workflow "Run log".
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer and translator
      verdicts, the scribe sha, the S8-Q rulings applied, the closing sha of gap `20261020T2124-kiko-binance-set7/1`,
      and the G-12 reviewer-notes line for the coordinator.

## Review focus

1. A conversion that never imports and never shows: an id past 2^53 (S8-Q1), a `walletType` word on the allowlist
   by case only (`funding`), a record whose status is settled but whose amount text is off contract (C6d).
2. A refused record counted twice or lost: re-scan and pending passes re-read it (union), a crash between rows,
   entries and marks, a disconnect between the entry write and the marks write.
3. An adopted exchange leg that counts as spending, or a user's pair overwritten by a sync (A1-A3).
4. The caption and the line: an entry never raises the caption (K8); a Convert walk from 2017 raises it until
   current (K2c); the line in uk reads lowercase items inside the sentence.
5. A newer build's state: an unknown kind entry survives a patch by this build and is not counted (N7b).

## Pre-flight self-check (planner)

- Copy keys -> where seen: all seven keys render only in `NotImportedLine` (account detail, Synchronization, a
  connected Binance account); `convertUnrecognized` is reachable from set 8 data, the five P2P/fiat kinds from
  set 12 (S8-Q4).
- G-1 every step; G-2 pins table, steps 1, 3, 6, 9; G-3 steps 3-10; G-4 none (no migration); G-5 step 7; G-6 step
  8; G-7 step 6; G-8 steps 7, 2; G-9 steps 3, 4, 8, 10; G-10 steps 10, 12; G-11 no device step; G-12 step 14;
  G-13 step 2; G-14 every commit, steps 8, 14.
