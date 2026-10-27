# Crypto exchanges 1.3-a, change set 15: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Status:** APPROVED 2026-10-27. Every S15-Q* is ruled (see "Rulings" at the end).

**Goal:** land `crypto-exchanges-1.3-a task 15/15`: the backfill of the other coins over `[floor, multiCoinSince)`
for capital, Pay, Transfer and Earn (`scope: 'backfill'`, BTC skipped), the caption while one is owed under the
renamed key `accountDetail.exchangeHistoryPending`, the "Earlier history" line and the not-listed note on the holding
detail, the privacy policy Binance bullet (all four copies, verbatim from release 1.3), the doc test (c), the API
terms record, and the Notes for Review delta.

**Architecture:** the backfill is owed ground in each walk's existing `pending` list, tagged `scope: 'backfill'`
the way a range is tagged with a `series` today (S15-Q1 = A, recommended). A run converts a stored
`multiCoinSince` once into that range and rewrites `multiCoinSince` to the run's floor in the same write, so the
range `[floor, floor)` of every later run is empty and owes nothing. The existing round-robin of owed windows reads
it; a window of that scope drops the rows of BTC. `historyOwesRange` already counts every range, so the caption
shows while one is owed. The holding detail gets a list footer component. No migration, no index, no column.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: "### History-behind caption", "### Backfill of
new coins (R-Q8, sets 6 and 15)", "### \"Earlier history\" line and not-listed note (R-Q16, set 15)", the matrices
"Not-tracked and not-listed", "Backfill (set 15)", "Caption (set 15)", section 9 rows "Privacy policy, Binance data
(set 15)", "App Privacy label", "API terms gate", "Set 15 list for the signed history reads", "Notes for Review",
section 10 rows `accountDetail.exchangeHistoryPending`, `holdingDetail.earlierHistory`,
`holdingDetail.exchangeNotListed.binance` and the wallet-sentence note, section 11 row 15/15. Rulings:
`memory/refs/binance-multicoin-sdd-2026-10-21/rulings.md` (main checkout): "BINDS SET 15", "STEP 10 (1)-(3)", "Set 11
whole-branch review C1", "P2P PRIORITY", the SCOPE RULE. Release texts (read only, release-1.3 worktree):
`.superpowers/sdd/release-1.3/texts-1.3-draft.md` sections 2 and 3.

**Base:** `binance-set15` at 8a6f8b68 (= main, set 14 merged). Every code fact below names a symbol or anchor text,
never a line. **The developer re-greps every fact on the actual base before relying on it.** Every count here
(files, cases, call sites) is a floor; the developer measures.

## 1. Goal and scope (SCOPE RULE, user 2026-10-25)

| Item | Class | In set 15 |
|---|---|---|
| Backfill range per walk (capital, Pay, Transfer, Earn) from `multiCoinSince`, BTC skipped, one row per record (R-Q8) | (a) missing rows: UA-1's 41 USDT Pay orders and the 2026-01 USDT withdrawal are not imported today; planned set 15 work | yes |
| Malformed `multiCoinSince` beside `multiCoinSeen: true` repaired once; an empty or negative range owes nothing ("BINDS SET 15") | (b) a range that grows every run would keep the caption up for good; planned | yes |
| Caption while a backfill range is owed (K4) | (c) caption; planned | yes (pinned; the rule already counts any range) |
| Caption while a candidate trade symbol was never read (K6, K6b; set 10 and 11 plans defer it here) | (c) caption; planned | yes, per S15-Q2 |
| `accountDetail.exchangeHistoryPending` replaces `binanceHistoryPending` (`{{exchange}}`) | planned (spec 10); en text for Binance unchanged | yes |
| "Earlier history" line and the not-listed note (final text) on an exchange-synced holding | planned; (a)-adjacent: the user sees why a balance and its rows differ | yes |
| Privacy policy section 3 Binance bullet, all four copies, verbatim from release 1.3 section 3 | compliance (Guidelines 5.1.1/5.1.2; C1) | yes, per S15-Q3 |
| Doc test (c): every signed Binance path has a section 3 phrase | compliance (C1) | yes, per S15-Q8 |
| API terms gate: read and record Binance's API terms and market-data display terms (record only) | compliance (spec 9 gate before merge) | yes |
| Notes for Review: the set 15 lines, the set 14 picker path, the S13 G2-5 Statistics range | compliance (2.1, 2.5.19) | yes, as a delta to the release session (S15-Q4) |
| Demo `.kiko` | none: every set 15 surface needs a connected Binance account | no (byte-identical check, S15-Q5) |

BACKLOG (one line each, to `backlog-after-1.3.md` by the coordinator):
- S15-B1 (refactor): move `binance-history-status.ts` (`src/screens/account-detail/crypto-sync-section/`) into
  `src/crypto-sync/exchange/history-status/` and rename `isBinanceHistoryBehind`; row 15/15 names that folder, but no
  set 15 item needs the move.
- S15-B2 (restore into an older build): a pre-set-15 build reads a `scope: 'backfill'` range as a range for every coin,
  so its read re-reads BTC records; keys dedupe, so no duplicate, but a BTC row the user deleted comes back. Rare
  (a newer `.kiko` into an older build).
- S15-B3 (rare world): a walk whose `multiCoinSeen` is lost after the conversion records a new start at its plan
  cursor and owes a second backfill over ground already read; keys dedupe, the cost is calls only.
- Every set 12, 13 and 14 backlog item stays there unchanged; set 15 touches none of their paths.

## 2. Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Titles and comments carry no scenario id,
  ruling id or history; the commit message carries them. Tests never parse `src` text (Stryker rewrites it).
- G-2 A pin this set moves is updated in the SAME step and retitled to the new rule, never in a fix round (set 14
  lesson 1). Known moves: none for the caption text (the en text for Binance is unchanged, so the three
  `HISTORY_CAPTION` literals in `crypto-sync-section.component.test.tsx`, `.balance-stamp.test.tsx` and
  `.not-imported.test.tsx` stay green); the walk-state comment "never repaired" (`ParsedWalkMarks` doc) and the
  `multiCoinSinceOf` doc change with step 3/8. Any other red pin is a stop and report (class (b)).
- G-3 `binanceHistoryPendingOverlap` (`legacy-walk-keys.ts`, `holdings.repo.walk-owned-metadata.test.ts`,
  `restore-walk-state.two-path.test.ts`) is a legacy METADATA key, not the caption: never rename it.
- G-4 Files over 1000 lines get no new test: `holding-detail.screen.test.tsx`, `walk-state.test.ts`; near it:
  `crypto-sync-section.component.test.tsx` (943), `binance.walks.multi-coin.properties.test.ts` (942). New tests go
  into the new files named below; `bash scripts/checks/dup.sh <file>` alone on each new test file.
- G-5 No migration, no index, no column: no migration review, no EXPLAIN QUERY PLAN test. `exchange_state` JSON gains
  the optional `scope` on an owed entry (and, per S15-Q2 A, one `trades` field): no `EXPORT_VERSION` bump, no
  `VERSION_DECISIONS` entry (no migration); the restore mirror copies `exchange_state` as text. Stop and ask if a
  migration appears.
- G-6 Full-word identifiers; `@kiko/<feature>` barrels; every new export has a consumer in its own commit (knip);
  `match().exhaustive()` over a closed set (scope, walk id, provider id), never an if-chain.
- G-7 Guideline 2.5.19: no flag; the footer and the caption derive from stored data only.
- G-8 Commits pass the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`. `src/` and
  `docs/` writes with Edit/Write only, except the privacy site build (`node scripts/privacy-site.js build`, the
  tool's own write). After `biome check --write`, run `node scripts/checks/import-order.js <file>`.
- G-9 Jest lines: literal paths first, `--testPathIgnorePatterns=.stryker-tmp` last; `--maxWorkers=2`; never an empty
  path list. `make jest-affected` for the step's wider check; exit 3 means queue the verify.
- G-10 A hand mutant is never restored with git: Edit, run, quote the red count, Edit back, then
  `git diff --exit-code -- <file>` exits 0.
- G-11 Mutation gates are PAUSED by the user (2026-10-25) until lifted: verify + review only. The gate text stays.
- G-12 Walk-touching steps carry property tests at clock gaps 0, 1 h and 1 day that call the production caller (the
  caller `binance.walks.multi-coin.properties.test.ts` drives; the developer re-greps it), never a helper copy.

## 3. Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-27)

Set 15 closes none. Left open:
- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks `accounts.institution`, not the connection):
  open; the backfill writes through the same gate, no change.
- `20261021T1839-kiko-binance-set9/1`, `/2`: open; the backfill reads more records through the same row helper, so
  `/2`'s rounding warnings can grow while it runs (log only, no amount).
- `20261023T0356-kiko-binance-set12/1`, `/2`, `/3`: open (backlog file). A backfill range adds one entry to a walk's
  list; it never merges with another scope (step 2/8), so it cannot widen a merged cluster.
- TIMEOUT-HEAVY (`20261017T1639-kiko-binance-backfill-fix/7`, `20261018T1637-kiko-harness-h9/2`,
  `20261017T2005-kiko-harness-h8/6`): open; `walk.ts` and `walk-values.ts` are the widely covered files the gaps
  name. Gates paused (G-11); if lifted, the gate's own rerun rule applies.
- `20261015T1657-kiko-binance-backfill-fix/2` (migration index check): open; no migration.
- Every other gap (harness, kill-guard, Duo, iPad, loan, empty-selectors, account-currency): open, unrelated.

## 4. Decisions this plan makes (subject to the open questions)

- Owed entry: `BinancePendingRange` gains `scope?: 'backfill'` (`walk-values.ts`); `asPendingRange` reads it, and a
  stored `scope` of any other value makes the list malformed (repaired by `readPendingMark`, as an unknown series is).
  A point owed inside a backfill window carries the window's scope, so its later read also skips BTC.
- Engine (`walk.ts`), the same shape as `series`: `OwedWindow` gains `scope`; `planWalkPasses` copies a range's scope
  onto its windows and a point's onto its point window; `normalizePending` groups by (series, scope), so a backfill
  range never merges with ground owed for every coin; `withoutReadGround` (via `MarkAdvance.scope`): a read with no
  scope takes ground of both scopes, a backfill read takes only backfill ground. The re-scan and forward passes read
  every coin, so they take backfill ground too.
- Conversion (new `backfillGroundOf` in `walk.ts`, called by each of the four walks right after `readPendingMark`):
  `since = marks.multiCoinSince`; when `since > floorMs`, one write `[{ pending: [...pending, { start: floorMs, end:
  since, scope: 'backfill' }] }, { multiCoinSince: floorMs }]`; else no write and nothing owed. A malformed stored
  `since` already reads as the cursor (`multiCoinSinceOf`), so it converts once and is rewritten: repaired. Floors
  never move earlier, so a later run sees `[floor, floor)` (empty or negative) and owes nothing. `multiCoinPatchesOf`
  and its `minOf` rule are unchanged.
- BTC skip: a window with `scope: 'backfill'` writes no row whose coin is BTC; the other coins of the same record
  (a mixed Pay send) are written. The untracked-coin and not-imported lists are fed as on any read.
- Caption: `historyOwesRange` already counts a backfill range (it is a range in a `CAPTION_WALKS` list); set 15 pins
  it (K4, B5) and adds K6 per S15-Q2. The rendered key becomes `accountDetail.exchangeHistoryPending` with
  `exchange: providerDisplayName(connectedProvider, t)`, the paused caption's pattern.
- Footer: `ExchangeHistoryFooter` (`src/screens/holding-detail/exchange-history-footer/`, `holding`, `account` and
  `transactions` props; `null` unless `isSyncedHolding(holding, account)` and the account's provider has a
  `notListedKey` in the exchange registry) renders `holdingDetail.earlierHistory` with
  `holding.balanceMinorUnits - sum(amountMinorUnits of the holding's rows)` when not zero, then the note. The sum is
  over the rows the screen already reads (`transactionsRepo.listByHoldingQuery`), integer minor units, no new query.
  Mounted as the ledger `FlatList`'s `ListFooterComponent`, gated on `isReady`.

## 5. Scenario matrix (each row is a Jest case; titles exact)

"was:" shows today's result where set 15 reverses it.

| # | Case | Test file | Title | Now | was: |
|---|---|---|---|---|---|
| B1 | fresh connect, plan cursor null | `src/crypto-sync/binance/binance.walks.backfill.test.ts` (new) | "owes no backfill range on the %s walk when it never recorded a start" (it.each capital, Pay, Transfer, Earn) | no range | n/a |
| B2 | BTC record in a backfill window | same | "writes no row for a BTC record the %s backfill reads" | skipped | n/a |
| B2b | mixed Pay send in a backfill window | same | "writes the USDT rows of a Pay send the backfill reads and skips its BTC rows" | USDT only | n/a |
| B3 | USDT record read by the live pass and the backfill | same | "writes one row for a USDT record the forward pass and the %s backfill both read" | one row | n/a |
| B4 | UA-1 | `src/crypto-sync/binance/binance.walks.backfill.real-sqlite.test.ts` (new) | "imports the 41 USDT Pay orders over the next syncs and skips the 5 BTC orders"; "imports the USDT withdrawal on Spot through the capital backfill"; "finds no non-BTC record in the Transfer and Earn backfills"; "shows the caption until every backfill range is read" | as titled | USDT never imported |
| B5 | every backfill range read | same | "hides the caption once every backfill range is read" | hidden (K1) | n/a |
| R1 | malformed `multiCoinSince` beside `multiCoinSeen: true` | `src/crypto-sync/exchange/walk/walk.backfill.test.ts` (new) | "owes a malformed start once, up to the cursor, and stores the floor in its place" | one range, start repaired | read as the cursor every run, never repaired, range grows |
| R1p | same, over runs | `src/crypto-sync/binance/binance.walks.backfill.properties.test.ts` (new) | "owes one backfill range that never grows, over ten runs at a %s clock gap, from a malformed start" (0, 1 h, 1 day) | bounded | grows each run |
| R2 | start at the floor `[floor, floor)` | `walk.backfill.test.ts` | "owes nothing and writes nothing for a start at the floor" | nothing owed | n/a |
| R3 | start below the floor (negative) | same | "owes nothing and writes nothing for a start before the floor" | nothing owed | n/a |
| R4 | one write | same | "stores the backfill range and the floor start in one write" | one patch | n/a |
| R5 | next run | same | "owes no second range on the run after the start was converted" | none | n/a |
| S1 | parse | `src/crypto-sync/exchange/walk-state/walk-values.backfill-scope.test.ts` (new) | "reads a range owed to the backfill with its scope"; "reads a list holding a scope it does not know as malformed" | | n/a |
| S2 | merge | `walk.backfill.test.ts` | "never merges a backfill range with a range owed for every coin" | two entries | n/a |
| S3 | read-in | same | "takes backfill ground out by a read for every coin"; "keeps ground owed for every coin after a backfill read of it" | | n/a |
| S4 | point in a backfill window | same | "owes a point found in a backfill window to the backfill" | point has scope | n/a |
| S5 | Transfer series | same | "reads a backfill range in every Transfer series" | | n/a |
| P1 | property | `binance.walks.backfill.properties.test.ts` | "imports every non-BTC record before the start exactly once and adds no BTC row, at a %s clock gap" (0, 1 h, 1 day; production caller) | | n/a |
| K1 | nothing owed | `src/screens/account-detail/crypto-sync-section/binance-history-status.test.ts` (existing) | existing "is not behind when every walk lags the balance sync by only a few hours" | hidden | hidden |
| K2 | cursor null or a day behind | same (existing) | existing "is behind when any walk has never caught up ..." | shown | shown |
| K3 | Transfer owes a range | same (existing) | existing "is behind when the Transfer walk owes a range, though every cursor is current" | shown | shown |
| K4 | a backfill range owed | same | "is behind while the %s walk owes a backfill range, though every cursor is current" (capital, Pay, Transfer, Earn) | shown | hidden |
| K5 | only fresh owed points | same (existing it.each under `historyOwesRange`) | existing titles | hidden | hidden |
| K6 | candidate trade symbol never read | same | "is behind while a candidate trade symbol was never read" (S15-Q2 A) | shown | hidden (no rule) |
| K6b | every candidate read, one empty (`fromId` 0) | same | "is not behind once every candidate trade symbol was read, an empty read too" | hidden | hidden |
| K7 | malformed top level | `crypto-sync-section.component.test.tsx` (existing) | existing "shows the paused caption instead of the behind caption, never both" | paused copy | paused copy |
| K8 | only `notImported` | `crypto-sync-section.component.not-imported.test.tsx` (existing) | existing titles | hidden, line shown | same |
| KC1 | caption names the exchange | `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.history-caption.test.tsx` (new) | "names Binance in the pending caption"; "renders the pending caption in Ukrainian, naming Binance" | | fixed "Binance" text |
| N1 | UA-1 holding detail | `src/screens/holding-detail/holding-detail.exchange-history.test.tsx` (new) | "shows Earlier history with the balance less the rows on a connected Binance holding"; "shows the not-listed note under each Binance holding" | as titled | BTC only, no note |
| N1b | rows equal the balance | same | "shows no Earlier history when the rows sum to the balance, and still the note" | | n/a |
| N1c | manual, disconnected, wallet | same | "shows neither line on a %s holding" (manual, disconnected Binance, Bitcoin wallet per S15-Q6 A) | | n/a |
| N1d | exact sum | `src/screens/holding-detail/exchange-history-footer/exchange-history-footer.component.test.tsx` (new) | "sums the rows exactly at the coin's scale: %s"; "shows a negative earlier history when the rows exceed the balance" | | n/a |
| N1e | loading | same | "renders nothing while the screen's queries load" (screen file) | | n/a |
| D1 | doc test (c) | `src/crypto-sync/binance/binance.privacy-policy.test.ts` (new) | "names every Binance path the app calls in section 3 of %s" (the four policy files); "maps every listed path to one phrase" | | none |

## 6. UI (designer check per step; the USER confirms on device on the final tip)

- Holding detail of a connected Binance holding: under the ledger, a `caption` `textSecondary` line "Earlier history:
  {{amount}}" (amount through the money formatter the ledger uses, signed), then the not-listed note in the same
  style. No card, no NoticeBanner (nothing for the user to fix), no row, no statistics effect.
- Account detail, Binance: the pending caption text is unchanged in en; it now also shows while a backfill range is
  owed (K4) and per K6.
- Approved visuals touched: none of the kiko-design-system "Locked decisions" entries; the holding ledger layout above
  the list end is unchanged. Device confirm owed: the holding detail of a Binance holding (footer, long note, Dynamic
  Type large sizes), and the account detail caption.

## 7. i18n (en + uk; kiko-translator "Review new/changed keys before a shipping deploy")

- Renamed: `accountDetail.binanceHistoryPending` -> `accountDetail.exchangeHistoryPending` (spec 10 en and uk with
  `{{exchange}}`). Plan-time grep of `binanceHistoryPending` (excluding `binanceHistoryPendingOverlap`, G-3): consumer
  `crypto-sync-section.component.tsx`; catalogues `en.ts`, `uk.ts`; no help topic, no test pin of the key; skills
  `.claude/skills/kiko-architecture/SKILL.md` ("History-behind caption" paragraphs, three mentions) and the mirror in
  `harness/kiko/skills/` (scribe, step 8/8); release 1.3's uk review list (delta, step 7/8). All code and catalogue
  changes in step 1/8.
- New: `holdingDetail.earlierHistory`, `holdingDetail.exchangeNotListed.binance` (spec 10 text). The uk note text in
  the spec writes `ф’ючерсами` with U+2019: the catalogue writes U+02BC (`uk.catalog-rules.test.ts` fails the other);
  the scribe fixes the spec row in step 8/8.
- Removed: `accountDetail.binanceHistoryPending` (en + uk).
- Checks: `en.uk.parity.test.ts`, `en.casing-by-role.test.ts`, `en.final-stop-by-role.test.ts`, `uk.casing.test.ts`,
  `uk.catalog-rules.test.ts`; `npm run check:component-i18n-namespace`. Translator review of all three keys, recorded
  in the step report; the uk strings join release 1.3's uk review list.

## 8. Docs and compliance

- Privacy policy (one commit, step 6/8): `docs/privacy-policy.md` (uk) and `docs/privacy-policy.en.md`, section 3, the
  Binance bullet replaced by release 1.3 texts section 3 VERBATIM (en and uk), then `node scripts/privacy-site.js
  build` regenerates `docs/privacy-site/index.html` and `docs/privacy-site/en.html`. No re-draft. The effective date
  stays (re-dated at publish, release step). Set 15 adds no endpoint: the backfill reads the existing paths; send that
  as the "no delta" line the release draft asks for.
- Doc test (c) (S15-Q8 A): new `src/crypto-sync/binance/binance.endpoints.ts` exports the closed list of the paths the
  app calls (signed and public), and the request helpers (`signedRequest`, `signedRequestPage`, `publicRequestPage`
  in `binance.client.ts` / `binance.history-client.ts`; the developer re-greps the helper names) take a `path` typed
  as that list's union, so the compiler fails a call with an unlisted path. The test reads the list as a module and
  the four policy files as text (docs are not mutated), with the phrase map of release 1.3 section 3.
- API terms gate (record only, step 7/8): `kiko:researcher` reads Binance's separate API terms (the clauses on
  read-only third-party apps), the market-data display terms (attribution, display of price data in a third-party
  app) and the Prohibited Use Policy (the C2 note lists them as not read), and reports URL, date checked and clause
  numbers with quotes. A bot-checked page goes to the user (memory "agents cannot read bot-checked pages"). The scribe
  records them in kiko-compliance beside the C2 paragraph. A clause that forbids the price display is a STOP to the
  coordinator (removing the fallback is not record-only).
- Notes for Review (S15-Q4 A): the release session owns the Notes text (`texts-1.3-draft.md` section 2, final at
  freeze), so set 15 sends the delta lines to it through the coordinator and edits no Notes file: (1) the set 15 line
  in place of its `[set 15: ...]` tag: "an "Earlier history" line and a short "Not listed" note at the bottom of each
  Binance holding" (spec 9 wording); (2) the caption line also covers a backfill still loading; (3) the set 14 path
  "Accounts > Add account > Crypto > Exchange or wallet > Binance" confirmed against the built form (drop the
  `[before set 14 ...]` tag); (4) S13 G2-5: the Statistics range that shows the matched debits (33-110 days ago);
  (5) "no new endpoint" for the privacy phrase map; (6) the renamed caption key for the uk review list. The App
  Privacy label review line (spec 9: "recorded in `memory/refs/resubmission-kit.md` section D") goes to the
  coordinator's memory batch: stays "Data Not Collected", set 15 sends nothing new off the device.

## 9. Files (measured floor; the developer measures)

Mutable source files, at least 17 (18-19 with S15-Q2 A), cap 30: `walk-values.ts`, `walk.ts`, `walk-state.ts` (doc
and `multiCoinSinceOf` comment), `binance.transactions.ts`, `binance.pay-history.ts`, `binance.transfer-history.ts`,
`binance.earn-history.ts`, `binance-history-status.ts`, `crypto-sync-section.component.tsx`, `en.ts`, `uk.ts`,
`holding-detail.screen.tsx`, `exchange-history-footer.component.tsx` (new), `registry.ts`, `binance.endpoints.ts`
(new), `binance.client.ts`, `binance.history-client.ts`; with S15-Q2 A also `binance.trade-symbols.ts` and
`exchange-state-patch.ts`. The number that counts: `KIKO_MUTATION_BASE=<set 15 base sha> make mutable` (step 8/8).

---

### step 1/8: the caption key `exchangeHistoryPending`

Class: planned (spec 10). No visible change in en.
Files: `src/i18n/locales/en.ts`, `uk.ts` (rename, `{{exchange}}`), `crypto-sync-section.component.tsx`,
`crypto-sync-section.component.history-caption.test.tsx` (new). 4 files.
- [ ] Tests first: KC1. The Binance text is the same before and after, so KC1 passes on the base (quote it as a
      guard); prove it load-bearing after the rename with a hand mutant (drop the `exchange` param: KC1 red, G-10).
- [ ] Code: rename; pass `exchange: providerDisplayName(connectedProvider, t)`.
- Check: KC1 green; the three `HISTORY_CAPTION` suites green unchanged; `grep -rn "binanceHistoryPending[^O]" src`
  empty; section 7 suites.
- Estimate source: set 4's paused-caption key rows (`kiko-binance-backfill-fix`); else "no similar row".

### step 2/8: owed ground with a backfill scope (engine and parse)

Class: planned; no walk owes a backfill range yet, so the tip is safe (no stored entry has a scope).
Files: `src/crypto-sync/exchange/walk-state/walk-values.ts`, `walk-values.backfill-scope.test.ts` (new),
`src/crypto-sync/exchange/walk/walk.ts`, `walk.backfill.test.ts` (new; S rows). 4 files.
- [ ] Red first: S1-S5. Quote the count.
- [ ] Code: section 4 "Owed entry" and "Engine".
- Check: new files green; `walk.series-ranges.test.ts`, `walk.owed-since.test.ts`, `walk.unreadable-window.test.ts`,
  `walk.multi-coin.test.ts`, `walk-state.test.ts` green unchanged; `make jest-affected`.
- Estimate source: set 12's series-range rows (`kiko-binance-set12`, `walk.series-ranges`).

### step 3/8: the four walks owe and read the backfill

Class: (a) + (b) ("BINDS SET 15"). The caption already shows while the range is owed, so the tip is safe.
Files: `walk.ts` (`backfillGroundOf`), `walk.backfill.test.ts` (R1-R5), `walk-state.ts` (doc of `ParsedWalkMarks` and
`multiCoinSinceOf`: a malformed start is repaired by the conversion), `binance.transactions.ts`,
`binance.pay-history.ts`, `binance.transfer-history.ts`, `binance.earn-history.ts`, `binance.walks.backfill.test.ts`
(new). 8 files; the real-SQLite and property files follow in the same step as their own commit if the developer
splits (about 10 files in the step).
- [ ] Red first: R1-R5, B1-B3 (it.each over the four walks), then B4, B5, R1p, P1 in
      `binance.walks.backfill.real-sqlite.test.ts` and `binance.walks.backfill.properties.test.ts` (new; production
      caller, clock gaps 0, 1 h, 1 day, G-12). Quote the count.
- [ ] Code: each walk calls `backfillGroundOf` after `readPendingMark` with its own floor (`HISTORY_FLOOR_MS`,
      `payFloorMs(now)`, `transferFloorMs(now)`, `EARN_FLOOR_MS`; re-grep), threads `window.scope` into its
      `advanceWalkMarks` call and its row write, and drops BTC rows in a backfill window.
- Check: new files green; every `binance.*-history*.test.ts`, `binance.transactions*.test.ts`,
  `binance.walks.*.test.ts` green, with the class (i) pins re-seeded per pin, seed-only (never through a shared seed
  helper); the 4 acceptance pins unchanged (tx:1592 seed-only per S15-Q11, with its upgrade-world twin in
  `binance.walks.backfill.test.ts`; the other 3 in their original upgrade-world seed, S15-Q13); the 4 lost-seen pins
  of `binance.walks.multi-coin.test.ts` moved per S15-Q12; `make jest-affected`; dup alone on each new test file.
- Estimate source: set 6 multi-coin walk rows (`kiko-binance-backfill-fix`, 20261019T0817).

### step 4/8: caption rows K4 and K6

Class: (c).
Files: `binance-history-status.ts`, `binance-history-status.test.ts` (K4, K6, K6b); with S15-Q2 A also
`binance.trade-symbols.ts` (`tradesPatchesOf` writes the never-read candidates), `exchange-state-patch.ts` (the patch
kind), `walk-state.ts` (the `trades` part parse), `walk-state.trades-unread.test.ts` (new),
`crypto-sync-section.component.tsx` (passes the flag). About 7 files.
- [ ] Red first: K6, K6b (K4 may pass at once: quote it as a guard). Quote the count.
- [ ] Code: per S15-Q2.
- Check: `binance-history-status*.test.ts`, `binance.trade-symbols*.test.ts`, `binance.trade-history*.test.ts`,
  `crypto-sync-section.component*.test.tsx` green.
- Estimate source: set 12 K-P caption rows (`kiko-binance-set12`).

### step 5/8: "Earlier history" and the not-listed note

Class: planned (R-Q16).
Files: `src/screens/holding-detail/exchange-history-footer/{exchange-history-footer.component.tsx,
exchange-history-footer.props.d.ts,exchange-history-footer.component.test.tsx,index.ts}` (new),
`holding-detail.screen.tsx` (`ListFooterComponent`), `holding-detail.exchange-history.test.tsx` (new),
`src/crypto-sync/exchange/registry/registry.ts` (+ its test: `notListedKey` on `binance` only), `en.ts`, `uk.ts`.
About 9 files: above 8 because knip needs the component's consumer in the same commit.
- [ ] Red first: N1, N1b-N1e. Quote the count.
- [ ] Code: section 4 "Footer"; the note text from spec 10 (uk with U+02BC).
- Check: new files green; `holding-detail.screen.test.tsx` green unchanged; registry test; section 7 suites;
  `npm run check:screen-imports`, `check:feature-imports`; the designer checks the footer.
- Estimate source: set 8's not-imported line rows (`kiko-binance-set8`).

### step 6/8: privacy policy and the doc test

Class: compliance. Blocked until the coordinator answers S15-Q3.
Files: `docs/privacy-policy.md`, `docs/privacy-policy.en.md`, `docs/privacy-site/index.html`, `docs/privacy-site/en.html`
(built), `src/crypto-sync/binance/binance.endpoints.ts` (new), `binance.client.ts`, `binance.history-client.ts`,
`binance.privacy-policy.test.ts` (new). 8 files, one commit.
- [ ] Red first: D1 against today's policy (Spot trades, Convert, dust, P2P, fiat, card are missing: red). Quote it.
- [ ] Code: the typed path list; the verbatim text; the site build.
- Check: D1 green; `binance.client.test.ts`, `binance.history-client*.test.ts` green unchanged; `npm run
  check:typecheck`; `node scripts/privacy-site.js build` leaves no diff after the commit; the developer greps
  `__tests__/markdown-prose-width.test.ts` for a `docs/` rule that covers the policy files.
- Estimate source: set 5's privacy fallback rows (`kiko-binance-backfill-fix`, 20261018T1121).

### step 7/8: translator review, terms record, Notes delta, demo check

Class: compliance.
- [ ] Translator review of the three keys (section 7); a uk change lands in en/uk and the spec row in one commit.
- [ ] `kiko:researcher` terms read (section 8), report to the coordinator; STOP on a display ban.
- [ ] Notes for Review delta lines and the App Privacy line (section 8) to the coordinator for the release session.
- [ ] Demo: `git diff --exit-code 8a6f8b68 -- e2e/screenshot/fixtures` exits 0; `build-demo-snapshot.test.ts`,
      `generate-demo-kiko.test.ts`, `screenshot-seed.test.ts` green unchanged (S15-Q5 A).
- Estimate source: set 14 step 5/7 (`kiko-binance-set14`).

### step 8/8: spec, reviews, retrospect, scribe, device confirm, gates, BATCH READY

- [ ] Spec aligned: row 15/15 (`binance-history-status.ts` stays in place, S15-B1; no demo regen; the endpoint list
      file), the backfill section (conversion rule, scope, BTC rows), the uk note apostrophe, the test titles of
      section 5, the S15 rulings into section 1; `__tests__/spec-test-rows.test.ts`, `docs-known-limit.test.ts`.
- [ ] `kiko:reviewer` G1 = steps 2/8-4/8. Top question: "can a backfill read write or change a BTC row, lose a non-BTC
      record before the start, or leave a range that never empties (caption up for good)?"
- [ ] `kiko:reviewer` G2 = steps 1/8, 5/8, 6/8, then the whole branch at the tip BEFORE BATCH READY. No migration:
      no migration review.
- [ ] `kiko:designer` on the footer; the USER confirms on device (section 6).
- [ ] `kiko:retrospect` over both skill locations and `harness/kiko/agents/` (kiko-architecture "History-behind
      caption" key name and the backfill scope, kiko-domain owed ground and the earlier-history residual,
      kiko-compliance terms record, policy phrases and the doc test, kiko-design-system holding detail footer), then
      `kiko:scribe` commits; a `harness/kiko` change bumps the plugin version. The report names the drift-fix sha or
      "no drift found".
- [ ] Orchestrator: `KIKO_MUTATION_BASE=<set 15 base sha> make mutable`: quote the list and `mutable files: N (cap
      30)`.
- [ ] Coordinator, ONLY if the user lifted the pause (G-11): `bash scripts/job-queue.sh gate <worktree>
      "crypto-exchanges-1.3-a task 15/15 deep" <base> <head>` (detached; await the exit code).
- [ ] Coordinator: `bash scripts/job-queue.sh verify <worktree> "crypto-exchanges-1.3-a task 15/15 verify"` once at the
      tip, tree clean, rerun until green. No agent runs `make verify`.
- [ ] BATCH READY names the base sha, the `make mutable` count, the demo byte-identical result, the reviewer verdicts,
      the scribe sha, the device confirm, the S15 rulings, the translator review and the terms record.
- Estimate source: set 14 step 7/7 (`kiko-binance-set14`).

## Review focus

1. Scope rules: a backfill read that takes ground owed for every coin out of the list; a merged hull across scopes.
2. Conversion: the range written without the floor start (or the other way) in two writes; a start at or before the
   floor owing a range; a malformed start owing more than once.
3. BTC: any BTC row written, changed or re-keyed by a backfill window, a point's later read included.
4. Footer: a sum that is not exact integer minor units; shown on a manual, disconnected or wallet holding; shown
   while loading.
5. Policy: a re-drafted sentence (must be verbatim); an html copy out of step with its md.

## Open questions (coordinator)

S15-Q1. How is the backfill stored?
- A (RECOMMENDED): a `scope: 'backfill'` entry in the walk's `pending` list, converted once from `multiCoinSince`,
  which is rewritten to the floor in the same write. Consequence: reuses the round-robin, the merge limit and the
  caption as they are; the malformed start is repaired by the conversion itself; S15-B2 and S15-B3 residuals.
- B: keep `multiCoinSince` and add a `backfillCursor` per walk that the backfill moves. Consequence: a second read
  path beside the owed list, new caption and disconnect fields, more engine code.
- C: derive `[floor, multiCoinSince)` every run and mark it done with a new `backfillDone` field. Consequence: no
  progress kept between runs, so a long range re-reads from the floor each run until done.

S15-Q2. K6 (a candidate trade symbol never read): the account detail cannot list candidates (they need the live
`exchangeInfo`).
- A (RECOMMENDED): `tradesPatchesOf` stores the never-read candidates of the run (`trades.unreadSymbols`), the caption
  reads it. Consequence: one new `trades` field, about 3 more files; K6 exact.
- B: the caption counts stored symbols with a null `fromId` only. Consequence: no new field, but a candidate with no
  entry (the usual never-read case) never shows the caption.
- C: BACKLOG K6. Consequence: no caption while the first trade reads run; trades still arrive (speed only).

S15-Q3. The privacy text is release 1.3 revision 2, uk translator review and the user's OK pending.
- A (RECOMMENDED): commit revision 2 verbatim now in step 6/8; a later change from the review is recommitted
  verbatim by whoever holds the branch. Consequence: the doc test lands with the text; nothing ships before publish.
- B: hold step 6/8 until the release session sends the final text. Consequence: set 15 cannot reach BATCH READY until
  then.

S15-Q4. Notes for Review: spec says "appended to the reviewer kit" (`resubmission-kit.md`); release 1.3 owns the text.
- A (RECOMMENDED): send the delta lines (section 8) to the release session; edit no Notes file. Consequence: one
  owner, the final text is written at freeze; the kit is a 1.0 memory file only the coordinator writes.
- B: edit `memory/refs/resubmission-kit.md` section B. Consequence: two Notes texts that can drift; a memory write by
  a track.

S15-Q5. Demo `.kiko`.
- A (RECOMMENDED): no demo change, byte-identical check. Consequence: the footer and caption are reachable only with a
  connected Binance account, as the Notes already say.
- B: add demo state that shows the footer. Consequence: needs a connected-looking demo account, which S14-Q2 (USER)
  ruled out.

S15-Q6. Footer on a Bitcoin wallet holding.
- A (RECOMMENDED): exchange only (`notListedKey` on `binance`). Consequence: matches the spec ("exchange-synced"); the
  wallet shows neither line.
- B: "Earlier history" on the wallet too, no note. Consequence: a new copy question and a wallet case outside spec.

S15-Q7. API terms read.
- A (RECOMMENDED): `kiko:researcher` reads the API terms, market-data terms and Prohibited Use Policy; a bot-checked
  page goes to the user. Consequence: the gate closes in step 7/8.
- B: the user reads and pastes the clauses. Consequence: a user step on the merge path.

S15-Q8. Doc test (c): how the test knows every path the app calls.
- A (RECOMMENDED): a closed path list in `binance.endpoints.ts`, the request helpers typed to it. Consequence: the
  compiler fails an unlisted path; 3 source files change.
- B: a fetch spy over each client function. Consequence: about 20 calls to set up; a new client function is missed
  until someone adds it to the spy.
- C: scan the src text for path literals. Consequence: forbidden (Stryker rewrites src text; memory rule).

## Rulings

COORDINATOR (pff-ios-8a, 2026-10-27, standing user approval for Binance edge cases; recorded in `rulings.md`
"## Set 15 plan questions"): S15-Q1 = A, S15-Q2 = A, S15-Q3 = A (commit revision 2 verbatim; the user's OK of the
final privacy text is still required before publish and stays on the release user list), S15-Q4 = A, S15-Q5 = A
(follows user S14-Q2), S15-Q6 = A (spec: exchange-synced only), S15-Q7 = A (a display ban or a bot-checked page is a
STOP to the coordinator), S15-Q8 = A. Backlog S15-B1, S15-B2, S15-B3 approved. Every "per S15-Qn" above reads as
option A.

Step 3/8 red pins (debugger 2026-10-27: 48 old pins red, all 1.2-upgrade seeds, no defect in them; 44 re-seeded,
4 acceptance):
- S15-Q9 = A (COORDINATOR): the pending pass reads every owed window that is NOT backfill first (today's
  oldest-first order among them), then the backfill windows from the budget left; no amount or row change. An
  acceptance pin that says a recent record arrives, or arrives within N runs, is never moved or retitled to fit the
  backfill. Stop: an acceptance pin that still fails only on `complete` or the run count while backfill is owed goes
  to the coordinator.
- S15-Q10 = fix now (ORCHESTRATOR, SCOPE RULE (b) own regression; CONFIRMED by the coordinator): a stored
  `multiCoinSince` beside a lost seen mark was converted twice; `backfillGroundOf` hands the converted marks to
  `multiCoinPatchesOf`; a lost-seen pin over the 4 walks.
- Re-seed of the 44 class (i) pins APPROVED as SEED ONLY (add `multiCoinSeen: true`; titles and assertions
  unchanged); the reviewer checks that each changed pin diff is seed-only.
- S15-Q11 = A (COORDINATOR): the acceptance pin `binance.transactions.test.ts` "reaches now and imports every
  record once, with a dense day just behind the cursor" failed only on the run count (7 vs <= 6) in its 1.2-upgrade
  seed (the backfill adds runs; every record arrives). It gets the seed-only change (bound 6 and every assertion
  unchanged) PLUS a new upgrade-world acceptance pin in `binance.walks.backfill.test.ts`: every dense-day record
  imported within 6 runs, the backfill complete within the measured 7. The reviewer names WHY the other 3 acceptance
  pins went green; no named cause is a finding for the coordinator before the merge.
- S15-Q12 = A (COORDINATOR; revises STEP 10 (1) of 2026-10-19, which was not a user answer): a stored start beside a
  lost seen mark is kept as the END of the owed backfill range; `multiCoinSince` = the floor; the start is never
  raised. The 4 pins `binance.walks.multi-coin.test.ts` "keeps the earlier range start of a walk whose seen mark was
  lost" move and are retitled "keeps the earlier stored start of a walk whose seen mark was lost as the end of its
  backfill range". The scribe marks STEP 10 (1) as superseded in `rulings.md` and the spec.
- S15-Q13 = B (COORDINATOR): the acceptance pins tx:1759, tx:1844 and pay:1345 were green only because the class (i)
  re-seed edited the shared seed helpers `stateOf` / `storedState`. They go back to their ORIGINAL upgrade-world seed
  and pass UNCHANGED through the S15-Q9 order; the other pins on those helpers get the seen mark per pin
  (seed-only, one line). An acceptance pin's world is part of the pin, so a shared helper is no place to change it.
  If one fails in its original world: STOP to the coordinator.

Step 4/8:
- S15-Q14 = A (COORDINATOR): a candidate trade symbol whose read ENDED `failed` in the run is NOT listed in
  `trades.unreadSymbols` (it fails every run and would hold the caption up forever); the symbols a budget or a
  rate-limit stop leaves unread (`budget`, `stopped`, or not started) are waiting and ARE listed. `BinanceWalkStop`
  (`walk.ts`) is a row the walk will not trust, a per-symbol failure, not a budget or rate-limit stop. Each run
  replaces the list; a disconnect drops the `trades` with it.
- S15-Q15 = B (COORDINATOR; review steps 2-3 finding #1, step 4b): since S15-Q9 the backfill is read only after every
  other owed window, so 8 or more all-coin windows refused each run (an error `isUnreadableWindowError` accepts)
  starve it. While a backfill window is owed, `runWalkPlan` keeps the calls of its first window (`backfillKeep`)
  from the windows owed for every coin, except the first of those (a budget of one window, as the Transfer walk has
  beside a FAILED point, stays with the ground owed for every coin: the existing round-robin pin of
  `binance.transfer-history.test.ts`; the backfill then waits while that ground stays owed); the plan order and every amount and row are unchanged. A backfill window read
  after one of those leaves the range cursor where that window set it. The 3 acceptance pins (tx:1743/1827, pay:1333)
  pass UNCHANGED in their upgrade world.

Step 4c:
- S15-Q16 = A (COORDINATOR; the step 4b residual): a backfill window refused every run stayed first among the
  backfill windows and held back every one behind it. The backfill is a round-robin of its own: a new walk mark
  `backfillCursor` (the end of the backfill window the last run started; absent or malformed reads as none, no repair,
  a disconnect drops it) orders the backfill windows, so a window that was tried goes behind the others, and a
  backfill read never moves the range cursor of the windows owed for every coin. Only the order changes; no amount
  or row.

Step 4d:
- S15-Q17 = A (COORDINATOR; review G1 of steps 4/4b/4c): the first window owed for every coin kept no calls for the
  backfill, so in the Transfer walk with a FAILED point (budget of one window) the backfill never read and its USDT
  records before the start were lost, the caption up for good. When the pending budget fits only one window (the
  first window of each group would not both be entered), that read goes to the two groups in turn: a new walk mark
  `backfillTurn` (true = the backfill's turn; malformed or absent = the windows owed for every coin, no repair;
  written by raw patch; a disconnect drops it) is given to the backfill after a read of a window owed for every
  coin that left its window owed, and taken back after a read of the backfill. Developer deviation, flagged: a
  read of a window owed for every coin that FINISHES its window keeps the turn, because strict alternation fails
  the unchanged pin `binance.transfer-history.test.ts` "imports a transfer in a later window of the range within
  ceil(windows / reads a run) runs" (4 reads of the ground for every coin are needed in 5 runs). Only the order
  changes; no amount or row.
