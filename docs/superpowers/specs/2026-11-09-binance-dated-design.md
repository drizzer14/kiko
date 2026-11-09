# Dated balances for Binance, Monobank and the Bitcoin wallet (track 1.4-binance-dated)

A spec delta on `docs/superpowers/specs/2026-11-03-bybit-sync-design.md` (below: "the Bybit spec"),
section 3, "The past line while a balance is old" and "What the Binance and Monobank track can
reuse". A new file, because the Bybit spec is a closed track's record of 2,500+ lines; it gets one
pointer sentence. Code facts were read on base `next` 1dd814751 by symbol; the developer re-greps
each one on the actual base. Every count is a floor.

## 1. What binds

- User, 11-05, "Same fix after Bybit" (O85): Binance, Monobank and the wallet take Bybit's dated read.
- Q-j "C: By mark" (O88): a read lists the rows it overwrote, and the line skips them. Binance takes it.
- Q-k "A: No balance move" (O89): a delete or an edit of a row on the mark moves no balance.
- Q-l "A: C stands" (O89): 1.5, 1.5 is accepted when a typed move really arrived.
- Q-m "A: All three" (O91): Q-k holds on Binance, Monobank and the wallet, in this track.
- Monobank's below-zero line: "Design a fix in 1.4" (O88). Options in section 5; NO code before the
  user picks (plan task 3/3 is gated).
- STRICT SCOPE: no new text, no new screen, no migration unless the user picks one (section 3).

## 2. The code that is reused (no new mechanism)

One list decides everything: `datedBalances` in `src/holdings/holding-metadata/holding-metadata.ts`.
An entry `{ field, source }` makes, with no other edit:

| Effect | Where, by symbol |
|---|---|
| The read writes `BALANCE_READ_AT_FIELD` beside `syncedAt` | `runBalanceSyncInner` in `src/crypto-sync/sync/sync.ts`, by `datesBalanceOf(provider.metadataField)` |
| The read writes the mark `OVERWRITTEN_ROW_IDS_FIELD` | `overwrittenRowsPatch`, update branch of `upsertByMetadataKey`, `src/holdings/repo/holdings.repo.ts` |
| The line drops a source row after the read and a row on the mark | `rowsHeldByBalance` in `src/statistics/holding-value-at/holding-value-at.ts` |
| A delete or edit of a row on the mark moves no balance; the confirm names no move | `isOverwrittenRow` in `moveBalanceOfRowDatabaseTransaction` and `balanceChangesOf`, `src/transactions/repo/transactions.repo.ts` |
| A disconnect keeps the date and the mark | `strippedOnDisconnect` in `src/accounts/accounts.repo.ts` holds `SYNCED_AT_FIELD` alone |
| A restore keeps both | metadata is JSON; A128 of the Bybit spec proves ids and the mark survive |

Binance (`binanceAsset`, source `binance`) and the wallet (`walletAddress`, source `btc_wallet`) go
through `runBalanceSyncInner`, so an entry is enough for the write. Monobank (`monobankId`) does NOT:
`upsertMonobankMany` is called by the Monobank sync (`upsertAllHoldings`, `src/monobank/sync/sync.ts`)
with no date, so it needs its own write (section 5).

The wallet writes no row of its own source (`btc_wallet` is never a `transactions.source` value in
`src/`: grep `'btc_wallet'`), so on a wallet only the mark changes a value.

## 3. MAIN RISK: the holdings that shipped with no read date

Every Binance, Monobank and wallet holding in a user's database or `.kiko` file today has rows and no
`balanceReadAt`. Bybit's no-date rule (PLANNER CALL 87 of the Bybit spec) counts NO row of the source
when the date is null. It was safe there only because no Bybit holding had shipped.

Worlds, coin X, Binance. T is a read, F a fill of -0.2 X after T that a walk imported. "Line" is
before the row's day, then from it.

| # | World | Was (today) | A: own no-date rule (RECOMMENDED) | B: seed by migration | C: Bybit's rule as is |
|---|---|---|---|---|---|
| R1 | Shipped holding, connected, stored 1, rows +1 (a buy before T) | 0, 1 | 0, 1 | 0, 1 | 1, 1 until the next good read: the buy is gone from the past |
| R2 | R1, then the next good read after the update | 0, 1 | 0, 1, now dated | 0, 1 | 0, 1 |
| R3 | Shipped holding, disconnected (a kept snapshot), rows +1 then F, stored 1 | 0, 1.2, 1 | 0, 1.2, 1, for good (today's numbers) | `syncedAt` is stripped on disconnect, so the seed takes the newest row's time: 0, 1.2, 1 | 1, 1, 1 for good: the whole real past is gone |
| R4 | Shipped holding, connected, F imported after its last read, then the update, no read yet | 1.2, 1 | 1.2, 1 until the next good read, then 1, 1 and later 1, 0.8 | seed = `syncedAt`: 1, 1 at once | 1, 1 |
| R5 | A coin refused for good (`refused`), so no read ever writes it | as typed by rows | as today, for good | as today up to the seed, then held | flat |
| R6 | A walk makes a holding at 0 and a buy +1 arrives, no read (Bybit row 5) | -1, 0 | -1, 0 until a read (today's numbers) | no seed for a new holding: as C | 0, 0 |
| R7 | A `.kiko` file written by 1.3 or earlier, restored on this build | as the source device | as the source device; the first good read dates it | needs a restore mirror (the migration does not see a restored file) and its own test; without it, C | flat until a read |

| | A: own no-date rule | B: seed by migration | C: Bybit's rule as is |
|---|---|---|---|
| What | Each list entry carries its no-date rule. Bybit keeps "no source row counts"; Binance, Monobank and the wallet take "every source row counts" until their first dated read | A new migration writes `balanceReadAt` into each such holding (from `syncedAt`, else the newest source row's time), plus a `restoreDataSnapshot` mirror for old files | One entry each, nothing else |
| Worst value | Today's numbers on an undated holding, never worse | A seed time the app never read (O62: "no number the app does not hold as a fact"), and two writers of one field | The real past erased on every disconnected holding, for good |
| Migration, review | None | One migration (`kiko:reviewer` step), a restore mirror, `.kiko` tests | None |
| Size (floors) | 10 code lines, 80 test lines | 60 code lines, 300 test lines | 2 code lines |

Recommendation: A. It is the only option that never shows a value worse than today on any shipped
holding or restored file, needs no migration, and its one cost (R4: the old drift stays until the
next good read, which a connected account gets on its next sync) heals by itself. B fixes R4 a sync
earlier at the price of a migration, a restore mirror and an invented date. C breaks R1, R3 and R7.
PLANNER CALL D1: A, unless the coordinator or the user rules otherwise (questions-1.md, Q2).

Shape (a reading, the developer names it): the entry gets a field such as
`countsSourceRowsBeforeFirstRead: boolean` (`false` for Bybit, `true` for the others), and
`rowsHeldByBalance` reads it where it now writes `readAt !== null && transaction.time <= readAt`.
A new exported reader beside `datedBalanceSourceOf` returns the entry, so the valuer reads one list.

## 4. Binance and the wallet after this track

| # | World | Was | Now | Truth |
|---|---|---|---|---|
| W1 | Binance: read 1 at T, F imported by the same run's walk, no next read | 1.2, 1 | 1, 1 | 1, 0.8 |
| W2 | W1, then a good read of 0.8 | 1, 0.8 | 1, 0.8 | 1, 0.8 |
| W3 | Binance: Spot read, the Funding read fails (`walletRead` returns null), a Funding deposit +3 arrives after T, stored 5 | 2, 5 | 5, 5 until a good Funding read, then 5, 8 | 5, 8 |
| W4 | Binance, Q-j (Bybit row 15): read 0.1, disconnect, manual +0.5 (0.6), reconnect, read 0.1 | -0.4, 0.1 | 0.1, 0.1 | 0.1, 0.1 or 0.1, 0.6, 0.1 |
| W5 | W4, then delete the +0.5 (Q-k, Q-m) | Home -0.4; line -0.4, -0.4 | Home 0.1; line 0.1, 0.1; the confirm names no change | 0.1 |
| W6 | W4, then edit the +0.5 to +0.7 (Q-k) | Home 0.3 | Home 0.1; the list shows +0.7 | 0.1 |
| W7 | W4 with a really arrived +0.5, read 0.6 (Q-l) | 0.1, 0.6 | 0.6, 0.6 (ruled) | 0.1, 0.6 |
| W8 | Wallet: W4, W5, W6 with BTC | as W4 to W6 | as W4 to W6 | as W4 to W6 |
| W9 | Wallet, shipped and disconnected, manual rows typed after the disconnect | as typed | as typed: no read, no mark | as typed |
| W10 | Binance, the cooldown's silent skip (`fetchBalances` returns no balance) | no write | no write: date and mark stay | |
| W11 | Binance holding detail, "Earlier history", W1's world with rows +1 (before T) and F, stored 1 | 1 - 0.8 = 0.2 | 0: no line (see D2) | 0 |
| W12 | A Binance, wallet or Monobank holding with a mark in its metadata, deleted row on it (Bybit spec A135) | moves the balance | Binance, wallet: no move. Monobank: no move only after task 3/3 | |

PLANNER CALL D2 (the footer). `ExchangeHistoryFooter` shows `balance - sum(all rows)`, and its own
comment and kiko-domain ("so it and the Statistics series never disagree") say it equals the
series' opening. Once Binance is dated, the series' opening is `balance - sum(held rows)`, so the
two would disagree (W11). The footer reads the same held rows as the valuer (one exported function
from `@kiko/statistics/holding-value-at`; no second rule). No new text. Only Binance shows the line
(`showsEarlierHistory`, `exchangeProviderRegistry`). This is what "ExchangeHistoryFooter and A121
change under that track's own ruling" in the Bybit spec asked for.

PLANNER CALL D3 (no Statistics sentence). `statistics.bybitPastLimits` stays Bybit's (registry
`pastLimitsKey`). Binance and the wallet get no sentence: STRICT SCOPE, no new text. Their line only
gets closer to the read balance. Reported to the coordinator as a possible later text.

## 5. Monobank: the below-zero line (GATED, the user picks)

The world (Bybit row 15 on a Monobank card): read 100 UAH, disconnect, a manual +50 (150),
reconnect, the fast phase reads 100. The line shows 50 before the row's day, then 100. With a
manual +150 in place of the +50, it goes below zero: -50 on the past, until the user deletes the
row, which today moves the balance to -50 as well (Q-k's world). Kiko writes no date for a
Monobank read, so Bybit's entry as is would drop every `monobank` row (section 3, C).

Two facts that Bybit did not have:

- A Monobank card can hold `source: 'import'` rows (a bank account: `canImportStatement`). A
  statement row is the bank's own record, and `importRows` moves the balance only past THE BOUNDARY
  (`balanceBoundaryOf`): an older one moved nothing and is real history that the bank's balance
  holds. On the mark it would leave the line (the past before its day off by its amount): a world
  that is right today would break. So on Monobank the mark lists `manual` rows only. That needs a
  per-entry set of marked sources; Bybit, Binance and the wallet keep "every row not of the source"
  (Bybit spec A133 pins an import row on a Bybit mark).
- The fast phase writes every card's balance at the start of a run, and the statements follow under
  the 1-request-per-60-s gate, so a payment between the client-info read and its card's statement
  read is imported after the read and is not in the balance.

| Option | Line of the world above | A payment between the two reads (balance 1000, -100 after T) | Size (floors) | Recommended |
|---|---|---|---|---|
| A: date and mark. The fast phase writes `balanceReadAt` (taken after client-info answers), the entry joins the list with "every row counts until the first dated read" (section 3, A) and marked sources `manual` | 100, 100 | 1000, 1000 until the next run, then 1000, 900 | 25 code lines in `src/monobank/sync/sync.ts` and `holding-metadata.ts`; 250 test lines | Yes |
| B: mark only. The entry joins a list of marks but not of dates: every `monobank` row always counts | 100, 100 | 1100, 1000 until the next run (today's drift) | 20 code lines (the list splits into dates and marks); 200 test lines | |
| C: no change on Monobank | 50, 100; -50, 100 with +150; a delete moves Home to -50 | 1100, 1000 | none; Q-m stays two of three | |

Why A: one rule for all four providers (no divergent twin), the line ends at the number Home shows,
and Q-k and Q-l hold on Monobank as the user ruled for all three (Q-m).

## 6. Acceptance pins (D-ids, this track)

| Id | What | Where (file, title; the developer may reword a title, never the world) |
|---|---|---|
| D1 | The list: Binance and the wallet are dated, with their own no-date rule | `holding-metadata.test.ts`: "names the row source of %s" (Binance `binance`, wallet `btc_wallet`); `datesBalanceOf` "is true for %s"; "an undated %s counts every source row" via the new reader; Bybit's "counts none" unchanged |
| D2 | The valuer, section 3 rows R1, R3, R4, R6 and section 4 W1, W2, W4 | new `src/statistics/holding-value-at/holding-value-at.dated.test.ts`, one title per row number, per-pin seed |
| D3 | The whole path on real SQLite, Binance: W1 to W6, W10, R2, R4 | new `src/crypto-sync/binance/binance.past-line.real-sqlite.test.ts`, through `runBalanceSync`, `recordManual`, `transactionsRepo.update/remove`, `disconnectCryptoAccount`; seeds per pin (it may import `src/test-support/binance-real-sqlite.ts`, never edit it) |
| D4 | The same for the wallet: W8, W9 | new `src/crypto-sync/btc-wallet/btc-wallet.past-line.real-sqlite.test.ts` |
| D5 | A restored 1.3 file (R7): an undated Binance holding draws today's line; a dated one keeps date and mark | `src/data-transfer/snapshot/restore-past-line-mark.test.ts`, new titles |
| D6 | The footer equals the series' opening (W11) | `exchange-history-footer.component.test.tsx`: "shows the balance less the rows the line counts", "shows no line when a row after the read explains the gap"; the existing "Earlier history" titles stay green unless their world has a date (developer lists any that flip) |
| D7 | Monobank, after the user's pick (option A shown) | `src/monobank/sync/sync.test.ts`: "the fast phase writes the read time beside each card"; new `src/monobank/sync/monobank.past-line.real-sqlite.test.ts`: section 5 world, the payment between two reads, an import row stays off the mark and keeps counting, a manual row on the mark moves no balance |

### Existing pins that change on purpose (and why)

| Pin (Bybit spec id; file: title) | Was | Now | Ruling |
|---|---|---|---|
| A121; `holding-value-at.test.ts`: "a Binance holding counts every row against its balance, with a row after its stamp" | counts the row after `syncedAt` | unchanged as written (no `balanceReadAt` in its metadata: R1, rule A). A dated twin goes to D2 | D1 |
| A121; "a Binance holding at zero with no stamp opens below zero by its earlier buy" | -1, 0 | unchanged (R6, rule A) | D1 |
| A121; "a holding of any other source counts every row, whatever its metadata: %s" | wallet and Monobank rows | wallet row: unchanged (undated, no `btc_wallet` rows); Monobank row: unchanged until task 3/3 | D1 |
| A122; `bybit.provider.test.ts`: "has its key on the dated list, and the wallet and Binance keys are not on it" | not listed | Binance and wallet listed; Monobank per task 3/3 | O85, Q-m |
| A122; `holding-metadata.test.ts` `datesBalanceOf`: "is false for %s, which is not on the list" | binance, wallet, monobank | Monobank only, until task 3/3 | O85 |
| `holding-metadata.test.ts` `datedBalanceSourceOf`: "names no source for %s" | Binance key, wallet address | those two rows move to D1 | O85 |
| A135; `holding-metadata.test.ts` `isOverwrittenRow`: "is false for %s, which is not on the list" | binance, wallet, monobank | Monobank only, until task 3/3 | Q-m |
| A129, A135; `holdings.repo.past-line-mark.test.ts`: "%s makes no read of the rows and gets no new key" | Binance, wallet, Monobank | Monobank only; Binance and wallet get "a read marks every row that is not a %s row" | Q-j, Q-m |
| A135; `transactions.repo.past-line-mark.test.ts`: "$label moves by a delete as today…", "…by an edit as today…" | Binance, wallet, Monobank rows | Binance and wallet rows move to "moves no balance on a row on the mark"; the statement-count titles keep their counts (developer measures on the parent) | Q-k, Q-m |
| `sync.test.ts` (A122): "a provider that does not writes the stamp alone" | any non-Bybit provider stub | reseeded with a stub key still off the list, per pin (never the shared helper) | O85 |

Suites that assert a Binance or wallet holding's whole metadata after `runBalanceSync`
(`toEqual({ binanceAsset, syncedAt })`) gain `balanceReadAt`. Floor of candidates (grep of
`syncedAt` with `binanceAsset|walletAddress` in tests): `binance.provider.test.ts`,
`binance.provider.coin-lists.test.ts`, `btc-wallet.provider.test.ts`,
`binance.transactions.placement.test.ts`, `sync.test.ts`, `disconnect.real-sqlite.test.ts`,
`accounts.repo.disconnect-exchange.test.ts`, `holdings.repo.walk-owned-metadata.test.ts`. Each red
one is listed in the step report with the ruling; none is loosened.

1.2-upgrade worlds (harness-workflow): every seed of a Binance, wallet or Monobank holding with rows
and no `balanceReadAt` (for example `src/test-support/binance-backfill-world.ts`) is an undated
world. Under rule A it keeps today's line, so those suites stay green unchanged. Under B or C they
would not, and that choice re-opens this list.

## 7. Out of scope (backlog only)

- A queued Binance job marks a disconnected account connected (`sync.ts`, `updateAccount` with
  `institution: provider.id` in `runBalanceSyncInner`).
- "invalid key" on a rate-limited raw check.
- Binance's other-UID refusal (Bybit O93's twin), and a Statistics sentence for Binance (D3).
