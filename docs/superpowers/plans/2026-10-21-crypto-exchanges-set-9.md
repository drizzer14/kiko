# Crypto exchanges 1.3-a, change set 9: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `crypto-exchanges-1.3-a task 9/15`: the Binance dust read. One `GET /sapi/v1/asset/dribblet` per
run, no params, on its own lane (cap 1, IP 1); each `userAssetDribbletDetails` entry becomes an Exchange pair on
Spot (`fromAsset -amount`, BNB `+transferedAmount`) with `operation = 'dust'`, or the BNB leg alone with
`asset:<fromAsset>` when the source coin is not tracked. Keys dedupe, so every run reads the newest 100 records again
and imports only the new ones. No dividend walk (C-Div).

**Architecture:** dust is NOT a walk. It has no `WalkId`, no cursor, no `walks.dust` entry, no caption entry, no
forward-owes list and no not-imported kind (spec section 2 "Dust has no walk entry"; section 5 Dust row "none (every
run; keys dedupe)"). It reuses the shared row placement (`placeWalletRows`), the amount parser (`rowMinorUnits`),
the history-list writer (`historyListWriterOf`) and the stop log (`logWalkStop`); it does not use `planWalkPasses`,
`runWalkPlan`, `walkSpans` or `commitSettledSpan` (they need a span and marks). A record or entry the rules cannot
import is logged and left out; the next run reads it again while it is among the newest 100.

**Tech stack:** React Native, op-sqlite + Drizzle, Jest with `node:sqlite` (`src/test-support/real-sqlite.ts`),
fnts `maybe`/`Either`, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: section 11 row 9/15; section 5 stream row
"Dust", "Measured weights" (`dribblet` IP 1), "### Dust"; section 2 "Walk state in `sync_state`" (the paragraph
"Dust has no walk entry"); section 4 "Appear"; section 6 "The `operation` column", "Untracked-counterpart codes",
"Mapping and statistics per operation" (Dust rows); section 7 rows D1-D3 and "New streams ... (dust: no cursor)";
section 9 "Demo `.kiko`" (dust pair already seeded, U3); section 12 P7. Rulings (`memory/refs/binance-multicoin-sdd-
2026-10-21/rulings.md`, main checkout): R-Q6, R-Map, C-Div, U1, U3, S7-Q3, S7-Q6, S8-Q2, PAY m2 B. Set 9 questions
S9-Q1 ... S9-Q10 are answered (rulings.md, section Set 9 plan questions); the spec section 1 records them.

**Base:** branch `binance-set9` at main `88040f05` (sets 1-8 merged). Every code fact names a symbol or anchor
text. **The developer re-greps every fact on the actual base before relying on it.**

## Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Test names and comments carry no
  scenario id, no ruling id and no history text; the commit message carries them. Tests never read `src` text.
- G-2 A pin a behaviour change moves is updated in the same step (table "Pins this set changes"); never in a fix
  round. Retitle each changed test so its name states the new rule.
- G-3 Identifiers in full words; imports through `@kiko/<feature>` barrels; every new export has a consumer at its
  own commit (knip still flagging it: stop and report, never add an ignore). A new barrel export with no production
  consumer yet needs a cross-folder test consumer in the same commit (set 8 lesson).
- G-4 No migration, no index, so no migration review and no EXPLAIN QUERY PLAN test. Stop and ask if one appears.
- G-5 Dust is not a walk: no `WALK_IDS` member, no `CAPTION_WALKS` member, no `exchange_state.walks` entry, no
  `NOT_IMPORTED_KINDS` member (S9-Q1 A), no backfill range, no `multiCoinSince` mark. A plan step
  that seems to need one: stop and ask.
- G-6 Lane `dust`: cap 1, no narrowing calls, cost `{ ip: 1 }` (probe 2). One call per run at most.
- G-7 Rows: Spot on both legs (spec "### Dust"); `operation = 'dust'` on every leg, insert-only (as Convert);
  description `''`; source `'binance'`. Pair id `${accountId}:dust:${transId}:${fromAsset}`, with `transId` the
  RECORD's (`userAssetDribblets[].transId`, the id probe 2 keyed on), never the entry's. Leg key
  `${pairId}:${holdingKeyOf(code, 'spot')}` (as Convert's `${pairId}:${keyOf(leg)}`). A lone BNB leg keeps the
  pair-id-derived key and has no `exchangePairId` and no counterpart (as Convert's lone leg). The key is fixed once
  shipped: a change imports every re-read twice.
- G-8 Amounts: the source leg is `-amount`, the BNB leg `+transferedAmount`, each through `rowMinorUnits`;
  `serviceChargeAmount` is never read or subtracted (P7 default: `transferedAmount` is net, spec section 12).
- G-9 Holdings: a leg whose Spot holding does not exist creates it at zero through `placeWalletRows` (section 4
  "Appear": "on its first imported row") (S9-Q4 A, user: amends R-Q6). `placeWalletRows` needs no special
  code; `DUST_HOLDING_MISSING` stays only as its defensive `missingCode` (step 4).
- G-10 No copy change: no i18n key, no translator review (S9-Q1 A: no new kind).
- G-11 U1: no device deploy and no device step in this set.
- G-12 Guideline 2.5.19: no flag. Dust rows render with the set 7 labels; the demo `.kiko` already carries the dust
  pair XRP -> BNB (U3), so a reviewer sees a dust row without a connected account. Same Binance host, so no new SPKI
  pin; App Privacy data types unchanged (dust conversions are already named in section 9's privacy row, set 15
  text). The coordinator adds "dust conversions to BNB are imported" to the reviewer-notes draft
  (`memory/refs/resubmission-kit.md`), no repo change.
- G-13 Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.
  `bash scripts/checks/dup.sh <file>` alone on each new or grown test file. Writes to `src/` only with Edit/Write
  (never `perl -0pi`, `sed -i` or a heredoc; set 8 lesson 6).

## Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-21)

- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks the institution, not the connection): LEFT
  OPEN; the dust read writes the history lists through the same gated `patchExchangeState`, so it inherits it, no
  worse. Its rows go through `addManyDedup`, which has no such gate (same as every walk).
- `20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`, `20261018T1637-kiko-harness-h9/2`
  (TIMEOUT-HEAVY fan-out): LEFT OPEN; `binance.history-client.ts` and `run-crypto-sync.ts` have a wide related-test
  fan-out; step 9/9 applies the gate rerun rule.
- `20261017T2005-kiko-harness-h8/6` (no live TIMEOUT-HEAVY rerun proof): LEFT OPEN, closed by the set 9 gate only
  if it meets a real TIMEOUT-HEAVY file (the BATCH READY says which).
- `20261020T2124-kiko-binance-set7/1` (adoption drops the markers): still listed open, though set 8 step 2/14
  closed it; set 9 does not touch it. Coordinator note in the handback (close it in the run log with the set 8 sha).
- `20261015T1657-kiko-binance-backfill-fix/2`, `20261019T0912-kiko-account-currency/1` (migrations): not touched.
- Every other open gap (harness, Duo, iPad, scrub, pickers, account-currency, ops text): LEFT OPEN, unrelated.
- New gap to file in step 9/9 (S9-Q1 A): "a dust record the rules refuse is logged only; once it
  falls out of the newest 100 it is gone with no visible trace".

## P7: open fact, safe default, probe and fixture plan

P7 is PARTLY SETTLED: probe 2 saw 0 dust records (every 180-day window back to 2020-12-01 served, one -1021
retry failure); probe 7 (S9-Q3 A) measured the empty answer. No real dust record was ever observed. Safe
defaults, each pinned by a test:
- Newest 100 only; nothing older is read (spec scope; the set 15 not-listed note names the loss).
- `transferedAmount` is the net BNB the wallet received; `serviceChargeAmount` is never subtracted (D4).
- `transId` (record level) reads as a non-empty string or a JSON safe integer (`optionalIdentifier` in
  `binance.history-client.ts`); an integer past 2^53, a blank or a missing one makes the record unreadable (no row,
  logged), never a fallback key (set 8 lesson: no fallback for a case never seen live).
- `operateTime` (record level) is a finite number (epoch ms), else the record is unreadable.
- The response shape is the documented one (step 2/9 quotes it). The empty answer is measured (probe 7, S9-Q3 A):
  `{"userAssetDribblets":[]}` with `total` absent; `[]` is no dust, a missing or non-array list fails closed, and
  `total` is never read.

Fixture plan: `binance.dust-test-fixtures.ts` (new; excluded from mutation by its `-test-fixtures.ts` suffix) builds
records on the documented shape quoted in step 2/9, with values per test (two-coin record, untracked coin,
reduced-scale amounts, every malformed field). No live fixture exists; the BATCH READY says the dust read ships on
the documented shape only (the same status as the fiat walks, C-NR-E). Device verification with the user's key
on the final 1.3-a tip can confirm only the empty answer.

## Scenario matrix (each row is a Jest case; "was:" for every row: not imported, no dust read existed)

| # | Read / record | Result now |
|---|---|---|
| D1 | one record, entries TRX and DOGE (both tracked) -> BNB | two pairs on Spot: TRX -, BNB +; DOGE -, BNB + |
| D1 | (cont.) | pair ids `${accountId}:dust:${transId}:TRX` and `...:DOGE`; keys `${pairId}:TRX`, `${pairId}:BNB` |
| D1 | (cont.) | each leg names the other's holding; both excluded from statistics |
| D1b | D1 with no Spot TRX holding stored | "Binance Spot · TRX" created at zero, then the row (S9-Q4 A) |
| D2 | entry of an untracked coin (PEPE) | BNB + alone, `asset:PEPE`, no pair id, key `${pairId}:BNB` |
| D2 | (cont.) | PEPE on the not-tracked line |
| D3 | the same 100 records on the next run | no new row; `addManyDedup` returns 0; the lists unchanged |
| D4 | `transferedAmount` "0.000441", `serviceChargeAmount` "0.000009" | BNB leg +0.000441 exactly (net, never minus fee) |
| D5 | a tracked side's amount absent, malformed or negative | that entry: no row; logged once per code (S9-Q1 A) |
| D5 | (cont.) | the other entries and records import |
| D5b | an amount of 0 units: "0", or BNB "0.00000004" at scale 7 | that entry: no row, no log (S9-Q2 A) |
| D5c | an over-precise amount on a coin stored at full scale | `amount-precision` logged; that entry no row |
| D6 | record `transId` missing, `''` or past 2^53; no finite `operateTime` | no row of it; `dust-row-unreadable` logged |
| D7 | entry `fromAsset` blank, BNB, or twice in one record | those entries: no row; `dust-row-unreadable` logged |
| D8 | an amount past the safe integer | its coin joins the oversized list; that entry no row |
| D9 | a body with no list or a non-array list (S9-Q3 A) | `BinanceHistoryParseError`; logged `dust history failed`; nothing written |
| D10 | an empty list | nothing written, nothing logged |
| D11 | cooling down; no credentials; lane already spent | no request |
| D12 | the read answers a rate limit | cooldown set from `retryAfterMs`; clean stop, no log, nothing written |
| D13 | a holding the placement cannot find even after it creates a missing one (defensive `missingCode` only; a missing Spot holding is created at zero, D1b) | `dust-holding-missing` logged; no row of the read; next run reads again |
| D14 | newest-100 slides: run 2 drops the oldest and adds one new record | exactly the new record's rows import |
| R1 | run order | balance, capital, Pay, Transfer, Earn, Convert, dust, all on one run object |
| R2 | Convert fails | dust still runs; each logs its own failure by name only |

## Pins this set changes ("was:" values)

- P1: `src/crypto-sync/binance/binance.history-budget.test.ts` describe `LANE_CALL_CAPS` (its `toEqual`) and
  "holds the narrowing calls of each lane: only the Transfer lane has any".
- P2: `src/crypto-sync/run-crypto-sync/run-crypto-sync.test.ts`
  "runs the walks in order, capital, Pay, Transfer, Earn, Convert, all on one run object",
  "logs nothing and runs all five walks on a state that parses, an unreadable entry too",
  "does not run the Pay, the Transfer, the Earn or the Convert walk for a wallet request", and the `it.each` under
  "a walk state this build cannot read" (dust must not run on a malformed state either).

| Pin | Now | was: |
|---|---|---|
| P1 | `dust: 1` cap, `dust: 0` narrowing | no `dust` lane |
| P2 | order ends Convert, dust; five walks and the dust read | five walks |
| P2 | (cont.) no dust read for a wallet request or a malformed state | (cont.) no dust read existed |
| P3 | the `COSTS` `toEqual` pin in `binance.history-budget.test.ts` gains `dust: { ip: 1 }` | no `dust` cost |

## Files (measured floor; the developer measures the real list)

Planned: 14 files at least. Mutable source files (`mutable_source_files` in `scripts/checks/mutation.sh`;
`index.ts`, tests, `-test-fixtures.ts` excluded): 4 at least, cap 30:
`src/crypto-sync/binance/binance.history-budget.ts`, `src/crypto-sync/binance/binance.history-client.ts`,
`src/crypto-sync/binance/binance.dust-history.ts` (new), `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`.
Spec section 11 said about 5. The number that counts is `KIKO_MUTATION_BASE=<set base sha> make mutable`.

---

### step 1/9: the dust lane

Files: `src/crypto-sync/binance/binance.history-budget.ts`, `binance.history-budget.test.ts`.
- [ ] Tests first: P1; "allows one dust call and refuses the second"; "judges a dust call by the SAPI IP reading"
      (an IP reading of 6000 refuses it, 5999 allows it). Red count quoted.
- [ ] Code: `'dust'` in `BudgetLane`; `LANE_CALL_CAPS.dust = 1`; `LANE_NARROWING_CALLS.dust = 0`; both counters
      in `createBinanceRunBudget`; `COSTS.dust = { ip: 1 }`.
- [ ] Check: the suite green; `npx tsc --noEmit` clean. Commit `feat(binance): dust lane`.

### step 2/9: the dribblet read

Files: `src/crypto-sync/binance/binance.history-client.ts`, `binance.history-client.dust.test.ts` (new),
`binance.dust-test-fixtures.ts` (new).
- [ ] First: quote Binance's doc text for `GET /sapi/v1/asset/dribblet` in the commit body: parameters, the
      "last 100 records" and "after 2020/12/01" lines, the weight, the response example with every field and its
      JSON type (`total`, `userAssetDribblets`, `operateTime`, `transId`, `totalTransferedAmount`,
      `totalServiceChargeAmount`, `userAssetDribbletDetails[]`: `transId`, `amount`, `transferedAmount`,
      `serviceChargeAmount`, `operateTime`, `fromAsset`). A doc that contradicts G-7 (Spot), G-8 (net
      `transferedAmount`) or the record-level `transId`: stop and ask. S9-Q3: when the coordinator runs probe 7,
      its measured empty shape decides the empty rule.
- [ ] Tests first: "reads a record with two entries" (record `transId` as text from a safe integer and from a
      string, `operateTime`, entries `fromAsset` upper-cased once through `binanceTickerOf`, `amount`,
      `transferedAmount`); "never reads `serviceChargeAmount`" (absent from the parsed entry); D6 at the client:
      a record with an unusable `transId` or `operateTime` is in `unreadable`, the others parse; "reads an entry
      whose amounts are absent as undefined" (decided by the read, not the parser); D9 "fails the read for a body
      with no list" (`BinanceHistoryParseError`); D10; "sends no query parameter but the signature's"; weights
      from the headers.
- [ ] Code: `DustHistoryPage = HistoryPage<BinanceDustRecord>`; `BinanceDustRecord = { transId: string;
      operateTime: number; entries: BinanceDustEntry[] }`; `BinanceDustEntry = { fromAsset: string | undefined;
      amount: string | undefined; transferedAmount: string | undefined }` through `recordReader` (field names as
      Binance spells them; `transfered` is Binance's spelling); `fetchDustHistory(apiKey, secret, options)` via
      `signedRequestPage('GET', '/sapi/v1/asset/dribblet', {})`. Empty-answer rule (S9-Q3 A, probe 7): the
      body must be an object with a `userAssetDribblets` array; anything else throws `BinanceHistoryParseError`;
      `total` is never read.
- [ ] Check: suite green; `tsc` clean; `dup.sh` alone on the new test file. Commit
      `feat(binance): read the dust conversions`.

### step 3/9: a dust record's rows

Files: `src/crypto-sync/binance/binance.dust-history.ts` (new), `binance.dust-history.test.ts` (new).
- [ ] Tests first through `dustRowsOf({ accountId, record })`: D1 (pair ids, keys, counterparts, `operation`),
      D2, D4, D5 (each case), D5b, D5c, D7 (each case), D8 (the stop names the coin). "carries `operation` dust on
      each leg"; "description is empty". Red count quoted.
- [ ] Code: `dustRowsOf` returns, per entry, either planned rows (`PlannedDustRow`, the Convert planned-row shape
      with `operation: 'dust'`) with the untracked ticker, or a stop code; never throws past the record. A
      `match` over the tracked state of the two sides (never an if-chain): both tracked -> pair; one side
      tracked -> that leg alone with `untrackedAssetCode(<other ticker>)` (BNB is curated, so in practice the BNB
      leg); neither -> no row, the tickers listed. Amounts through
      `rowMinorUnits` (its `BinanceWalkStop` caught per entry: the code, and the ticker for `amount-too-large`);
      a result of `0` units -> no row, no code (S9-Q2 A); a negative result ->
      `dust-amount-invalid`; an absent amount on a tracked side -> `dust-row-unreadable`. Stop codes as named
      constants in the file: `DUST_ROW_UNREADABLE = 'dust-row-unreadable'`,
      `DUST_AMOUNT_INVALID = 'dust-amount-invalid'`, `DUST_HOLDING_MISSING = 'dust-holding-missing'`.
- [ ] Check: suite green; `tsc` clean; knip silent (the colocated test consumes `dustRowsOf`; no barrel export).
      Commit `feat(binance): map a dust conversion`.

### step 4/9: the dust read, end to end

Files: `binance.dust-history.ts`, `binance.dust-history.test.ts`, `binance.dust-history.real-sqlite.test.ts`
(new), `binance.dust-history.properties.test.ts` (new).
- [ ] Tests first (fake deps): D3, D9 (nothing written), D10, D11 (each case), D12, D13, "logs each stop code
      once per run", "writes the untracked list after the rows, the oversized list before them" (call order),
      "writes no walk mark and no not-imported entry" (no `walk` or `notImported` patch is ever sent), "reads
      once per run" (one fetch even with two records failing). Real sqlite: D1 lands on "Binance Spot · TRX",
      "Binance Spot · DOGE", "Binance Spot · BNB", excluded through `exchangeExcludedTransactionIds`; D1b; D2's
      lone leg excluded; D3 counts 0 the second run. Properties at run gaps 0 / 1 h / 1 day (`RUN_GAPS` as in
      `binance.earn-history.test.ts`), random record sets (up to 100, mixed tracked, untracked and malformed,
      reduced-scale amounts) over several runs with D14's sliding newest-100, through `syncBinanceDustHistory`
      itself: every importable entry imported exactly once (unique keys), no row for a refused one, the BNB legs
      sum exactly to the imported entries' `transferedAmount` in minor units.
- [ ] Code: `syncBinanceDustHistory({ targetAccountId, run }, overrides)`; deps `BinanceDustHistoryDeps`
      (`ExchangeStateDeps` + `now`, `fetchImpl`, `readCredentials`, `listHoldings`, `fetchDustHistory`,
      `ensureHoldings`, `addTransactions`), defaults as `defaultConvertHistoryDeps`. Order: cooldown check ->
      credentials -> `run.budget.canAfford('dust', COSTS.dust)` -> `run.gate.wait()` -> fetch ->
      `run.budget.record('dust', page)`; a `BinanceRateLimitError` sets the cooldown and returns (own try/catch;
      S9-Q5 A); every other error rejects. Then: oversized list write (if any) -> `placeWalletRows`
      (`missingCode: DUST_HOLDING_MISSING`, defensive only: a missing holding is created at zero; on its stop: log,
      return) -> `addTransactions` -> untracked list write.
      `logWalkStop` once per distinct code (unreadable rows of the page included). Returns `{ imported }`.
- [ ] Check: the three suites green; `dup.sh` alone on each new test file; the Convert and Pay suites untouched.
      Commit `feat(binance): dust read`.

### step 5/9: run the dust read

Files: `src/crypto-sync/binance/index.ts`, `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts`,
`run-crypto-sync.test.ts`.
- [ ] Tests first: P2; R1; R2 ("runs the dust read even when the Convert walk failed: each logs its own
      failure"); "still resolves with the balance result when the dust read fails, logging only its name".
- [ ] Code: barrel `export { syncBinanceDustHistory } from './binance.dust-history'`; `runBinanceHistoryWalks`
      runs it after Convert under `logOnFailure('[binance sync] dust history failed', ...)`; move the "Last, so a
      rate limit any earlier walk met ..." comment to it. `CAPTION_WALKS` unchanged (G-5).
- [ ] Check: suite green; `tsc`, knip clean. Commit `feat(binance): run the dust read after Convert`.

### step 6/9: spec alignment and the set 9 rulings

Files: `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`.
- [ ] Record S9-Q1 ... S9-Q6 in section 1 with their source line (rulings.md, section "Set 9 plan questions"; never
      a worktree path), each as answered. Align: section 5 "### Dust" (record-level `transId`, Spot, net amount,
      refused-entry rule, zero-rounding rule, empty shape); section 7 D1-D3 plus the new D rows that the answers
      settle; section 12 P7 (what the doc quote and probe 7, if run, settled); section 11 row 9/15 the measured
      file count. Point at constants (`LANE_CALL_CAPS`, the stop-code constants), never at a list of walks.
- [ ] Lines at or under the spec's width (count characters, not bytes); never write the phrase the
      `docs-known-limit` suite bans; `make doc-suites` green. Commit `docs(spec): set 9 rulings and dust facts`.

### step 7/9: reviews

Reviews run per task group, after the group's last step is committed (harness-workflow "Review cadence").
- [ ] G1 = steps 1/9-2/9: `kiko:reviewer`. Top question: "can a dust record be read into a wrong id, a wrong time or
      a wrong amount (the `transId` type, the net amount), or can the empty answer fail every run?"
- [ ] G2 = steps 3/9-5/9: `kiko:reviewer`. Top question: "can a dust conversion import twice, import on the wrong
      wallet or with the wrong sign, count as spending, or be skipped with no log line?"
- [ ] G3 = step 6/9: `kiko:reviewer` (docs only, scoped).
- [ ] One whole-branch `kiko:reviewer` pass at the set tip, before BATCH READY.

### step 8/9: skill text (kiko:retrospect, then kiko:scribe)

- [ ] `kiko-architecture`: the dust read (one call, lane, no walk entry, keys dedupe, the refused-entry rule) beside
      the walk order paragraph ("The Binance arm runs five walks, Convert last"): reword it to point at
      `runBinanceHistoryWalks` and say the dust read is not a walk; grep for every other "five walks" or walk-name
      list (set 8 lesson 9). `kiko-domain`: dust rows (pair per source coin, lone BNB leg, `dust`). Pointers, no code
      copies. The report names the drift-fix sha or "no drift found".

### step 9/9: gates and BATCH READY

- [ ] `bash scripts/job-queue.sh check-all <worktree> "crypto-exchanges-1.3-a task 9/15 check-all"` exit 0.
- [ ] `KIKO_MUTATION_BASE=<set 9 base sha> make mutable`: quote the file list, `mutable files: N (cap 30)` and the
      `timeout share (history)` line. Above 30: stop and split.
- [ ] Coordinator (not the developer): `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task 9/15
      deep" <base> <head>` (`KIKO_MUTATION_BASE=<set 9 base sha> make deep`), detached; agents wait for the exit
      code only. TIMEOUT-HEAVY (`docs/harness/checks.md`, "Clearing a TIMEOUT-HEAVY file"): when it is the only
      failure, the gate reruns the timed-out mutants alone and that report is the verdict; only if it still fails
      or is skipped, prove each timed-out mutant in plain jest (`npx jest <own tests> --runInBand`) or write it as
      equivalent. Never raise the timeout.
- [ ] `make verify` once at the set tip through the queue (`bash scripts/job-queue.sh verify <worktree>
      "crypto-exchanges-1.3-a task 9/15 verify"`, tree clean, HEAD unchanged until DONE), re-run until green.
- [ ] File the run-log gap of the "Run-log gaps" section (S9-Q1 A).
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer verdicts, the scribe
      sha, the S9-Q rulings applied, the P7 status (documented shape only, or probe 7's result), and the G-12
      reviewer-notes line for the coordinator.

## Review focus

1. A dust conversion imported twice: an id that changes between reads (a `transId` as integer one day, as text the
   next must give the same text), the newest-100 window sliding (D14), a run that crashes between rows and lists.
2. A row on the wrong side: BNB leg net vs gross (D4), the source leg's sign, Spot vs Funding.
3. A refused entry hiding a loss: D5-D7 must log; one bad entry must never block the record's other entries or the
   other records.
4. The empty answer: D9/D10 must not fail every run for an account that never converted dust (S9-Q3).
5. Statistics: no dust leg counts as spending (both legs carry a pair id or an `asset:` code).

## Pre-flight self-check (planner)

- No copy key, no screen change: nothing new is user-visible beyond rows with existing labels (G-10, G-12).
- G-1 every step; G-2 steps 1, 5; G-3 steps 2-5; G-4 none; G-5 steps 4, 5, 8; G-6 step 1; G-7 steps 3, 4; G-8 steps
  2, 3; G-9 step 4 (D1b); G-10 none; G-11 no device step; G-12 step 9; G-13 every commit, steps 2, 4.
