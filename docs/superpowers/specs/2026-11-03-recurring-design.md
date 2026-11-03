# Recurring charges design (1.4)

Track: 1.4-recurring. Base: 57130e23c. Read from code; the app was not run. Every file:line below holds
on this base only: re-grep the named symbol on the actual base before building on it. Counts of files,
cases and call sites are floors; the developer measures.

Status: DRAFT, waits for the user's answers (section 16). The plan is written on the recommendations.

Product purpose: Kiko answers "how much money do I have now". This view states what already repeated in
the user's own rows. It predicts nothing and plans nothing.

User ruling 2026-11-03: "A2 shows no upcoming charges, only the recurrence date + already occured
transactions via links".

## 1. Claim check

Source row, `.claude/skills/kiko-competitors/competitor-facts.md:191`, read at d7cd40fa1: "Subscriptions and
recurring view, upcoming charges | Copilot, Cashew | Detect from synced and imported rows; local
notifications exist | M".

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Copilot has it | True as far as the file goes: "Subscription and recurring-charge view" | `competitor-facts.md:46` (READ, app not run) |
| 2 | Cashew has it | **Not as detection.** The file reads "Transaction types: upcoming, subscription, repeating", a type on a row. Nothing in it says Cashew detects | `competitor-facts.md:37` |
| 3 | Upcoming charges | **OUT by the ruling.** was: part of the row. now: no forecast, no next date, no projected total | ruling above |
| 4 | Local notifications exist | True, and irrelevant: `src/reminders/` is per account and kind. **OUT by the ruling**: no reminder here | `ReminderKind`, `schema.ts` `reminderOfferDismissals` |
| 5 | Detect from synced rows | True for the fields, **shallow for the history.** A first Monobank sync reads back 31 days only, and nothing backfills further. A monthly series shows from its third charge, so at least two months after connect; a yearly one, over a year | `DEFAULT_LOOKBACK_SECONDS` `src/monobank/sync/sync.ts:46`, `fromCursorSeconds` `:804` |
| 6 | Detect from imported rows | True, and the only deep source: a statement file reaches as far as the file does | `schema.ts:299` |
| 7 | Rows hold what detection needs | True for name, time and amount, with one gap: a row holds its amount in the holding's minor units only. The Monobank original amount and currency are not stored, so a foreign charge is not recognizable as foreign | `mapStatementItem` `sync.ts:248-258`; `schema.ts:140` |
| 8 | Nothing like this exists | True: no `recurring` in `src/i18n/locales/en.ts`; no merchant-level series code | grep |
| 9 | Size "M" | Not checked. Durations go to `kiko:estimator`; section 15 gives the sets and their file floors | |

## 2. Scope

In: a Settings entry; a list of detected series; for each series, what recurs, the recurrence date, the last
charge, and links to its past rows; a user control that hides a false match, visible and reversible; a Help
topic; an empty state.

Out, not to be added: a next charge date, a due date, a reminder or notification, a projected amount, a
monthly or yearly total, any sum across a series, a budget, any new network call. A "mark as recurring"
control is out on the recommendation (Q2).

Open run-log gaps: none covers this work. This track closes none and leaves all open; nearest, left open:
`20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check; this track adds no index).

## 3. Binding: name grouping

"These names are one merchant" is `merchantNameOf` in `src/transactions/merchant-name/merchant-name.ts`,
defined by `1.4-category-automation` (its spec, section 4). This track imports it and never writes a second
definition, a copy or a wrapper with other rules. `key` is the group identity; a blank key never groups.

**Which set.** Checked in its plan at branch tip f8ef8f8f4, which moved past the 486659692 of the brief while
this spec was written; the numbering did not change: `1.4-category-automation task 2/6: prefix offer in Apply`
creates `merchant-name.ts`, with `merchantNameOf`, `merchantSpellingOf` and `mostUsedSpelling`. On that tip the
file does not exist in any tree yet: both specs and plans are documents only.

**This track also uses** `merchantSpellingOf` and `mostUsedSpelling` for the shown name (one spelling per
series). Those two names are in that plan's interface, not in its spec section 4: re-grep them.

**Order, and what moves it.**
- `1.4-recurring task 1/3` needs that set merged into `next`. Its plan stacks its tasks (`S16`), so task 2/6's
  base is task 1/6's tip, and in practice `next` receives the back-fill and the Travel migrations first. This
  track needs nothing else from task 1/6, but it cannot avoid it unless the coordinator reorders.
- If task 2/6 moves later or renumbers, this track's order stays and task 1/3 waits for it.
- If the user's rulings on that spec drop B3: the function has no first caller there. Then the function's
  own steps (its `step 1/11` and `step 2/11`, with its spec table) move to `1.4-recurring task 1/3`, which
  becomes the first caller, and category automation imports it from there. One function, moved, never copied.
- The rule "a shared function ships with its first caller" (Knip) is met by task 2/6 itself.

## 4. Which rows qualify

Detection reads rows and writes none. A row is a **charge** when all of these hold.

| Row | In or out | Reason and mechanism |
|---|---|---|
| Debit (`amountMinorUnits < 0`) | In | A refund or income is no charge |
| Blank stored description | Out | No name to group; a blank label is language-dependent |
| `setsBalance` | Out | A balance set, not a payment, `schema.ts:278` |
| `changeGroupId` set | Out | The row is gross of its returned change, `schema.ts:204` |
| An exchange leg: any of `exchangeCounterpartHoldingId`, `exchangePairId`, `untrackedCounterpart` | Out | `rowsForTransferMatch` `src/statistics/internal-transfers/internal-transfers.ts:135` keeps exactly the unmarked rows; used as it is. Wider than spending on purpose: a synced debit a Convert sent to another currency still counts as spending (`sameCurrencyMoveTransactionIds` comment), but it is not a subscription |
| Cash-out, own card transfer | Out | `isMccExcludedTransfer` `transfer-exclusion.ts:31` with `ownIbans` from `ibanOf`. A 4829 to a third party stays: that is rent |
| Internal wording ("Поповнення депозиту") | Out | `isDescriptionExcludedTransfer` `transfer-exclusion.ts:85` |
| A matched own transfer | Out | `internalTransferTransactionIds`, over the unmarked ledger of both signs |
| A debit that funded an exchange purchase | Out | `exchangeFundingMatches(...).excludedIds` `exchange-funding-match.ts:263`, over the whole ledger, so a monthly P2P crypto buy is no subscription |
| A linked loan payment (`loanHoldingId` set) | Out | The loan has its own schedule and screen. The marker, not `loanPaymentExcludedTransactionIds`: that one needs loan metadata and answers a spending question (interest counts). `loan-excess:` and `loan-interest:` are synthetic entries, never stored, so they are never read here. An unlinked loan payment is an ordinary row and counts |
| Account kind not `bank` or `cash` | Out | An allow-list on the holding's account. It matters: a Binance deposit or withdrawal stores the ticker as its description (`binance.transactions.ts:273`), so "USDT" would read as a merchant. It also covers `1.4-bybit` with no per-exchange list |
| Archived account (`archivedAt`) | Out | Statistics shows only non-archived accounts, `statistics.screen.tsx:343`. The matchers above still read its rows |
| Holding not found | Out | As `ledgerWithCurrency` `statistics.screen.tsx:752` |
| Closed holding | **In** | A closed card keeps its past spending (`statistics.screen.tsx` `transactionsWithCurrency`); this is what lets a series cross a card change |
| Pending (`hold`) | **In** | It shows in the ledger as a charge; the settled re-fetch refreshes the same row, `schema.ts:150-159`, so it never counts twice |
| Manual row | **In** | Rent typed by hand every month is a real series |
| Imported row | **In**, with its twin folded | Below |

**One eligibility definition.** A new `recurringExcludedIds` in `src/recurring/eligibility/` only composes the
functions above. It holds no MCC, wording or marker of its own, except the structural fields in the table.
`1.4-tables task 1/7` moves the same union out of the Statistics screen into `src/statistics/spending-ledger/`.
This track does not touch Statistics, so neither waits for the other. The set is not identical (no loan
rule, wider exchange rule), so the two compositions stay two lists of calls, and kiko-domain's
"Spending-exclusion pipeline" gains a line: a new exclusion rule is added to both. Each rule has its own world
in the plan's pins, so a dropped call fails a test.

**Twin fold, the same charge counts once.** Adoption pairs a sync input with an import row of the same holding
and signed amount within a short window, and states its residual: a date-only file (stored at local noon) stays
doubled (`pairSyncInputsWithImportRows` comment, `src/transactions/sync-adoption/sync-adoption.ts:82-88`). So
within a group: rows with the same local day and the same signed amount and **different `source`** are one
charge, kept in this order: synced, then manual, then import. The holding is not compared, so a statement
imported into a plain holding folds too. Two rows of one source are two real charges and stay.

**Refunds.** Not charges, and they cancel nothing. A refunded month still reads as charged, and its row stays
linked. Netting would need a sum, which this feature does not have.

**A series crosses holdings, never currencies.** A row has no currency of its own; it comes from its holding.
The group key is `[merchantNameOf(description).key, holding.currency]`. A card change within a currency keeps
the series. A move from a UAH card to a USD card starts a second series: a false split, accepted, because no
amount here may mix currencies.

## 5. The detection rule

`detectRecurringSeries(input, now)`: pure, with an injected `now`, no clock, no order dependence (input is
sorted by time, then id).

### 5.1 Periods

| Period | Why it exists | Min charges | Day tolerance | Slots a gap may span |
|---|---|---|---|---|
| Monthly | The main case: subscriptions, rent, bills | 3 | 4 local days | 3 |
| Yearly | Domains, insurance, annual plans. Min 2, because a Monobank connection only reaches 31 days back (section 1): at min 3 a yearly series would need two years of rows | 2 | 5 local days | 1 |
| Weekly | Real but rare, and the easiest to confuse with a habit, so the strictest amount rule | 5 | 1 local day | 3 |

Not periods: quarterly and half-yearly (a false miss, one table row to add later), and any 30-day count.
Monthly and yearly steps use calendar months through `addMonths` (`src/holdings/interest/interest.ts:41`), which
clamps the 31st to February's end, and `daysBetween` (`:62`), which compares local calendar days across DST.
`transactions.time` is epoch milliseconds (`schema.ts:141`). A charge's day is its device-local day, as on Home.
`dayKeyOf` (`price-book.ts:90`) gives the same day as a UTC-midnight key; it is not needed here. A user abroad
sees a late-evening charge on the neighbouring day; the tolerance holds it.

### 5.2 Testing a list of charges against a period

For each consecutive pair: `slots` is the whole number of periods nearest to the gap (0 when two charges sit
in one slot); `deviation` is the local days between the later charge and the earlier one stepped by `slots`.
A pair **fits** when `1 <= slots <= max` and `deviation <= tolerance`. The list **passes** when all hold:
- at least the minimum count of charges
- `fits / pairs >= 0.75`: one moved day or one double charge in a long series is tolerated; with 3 or 4 charges,
  every pair must fit
- `charges / (1 + sum of slots) >= 0.75`: a skipped month passes, a sparse visitor does not
- amounts steady: a **jump** is a consecutive pair whose larger amount exceeds the smaller by the step (monthly
  and yearly 1.25, weekly 1.10). Monthly allows `1 + floor(charges / 24)` jumps, a price change or two. Weekly and
  yearly allow none

### 5.3 Per group, in this order

Twin fold first, then:
1. **The whole group passes** (weekly, then monthly, then yearly): one series. Rent, Netflix at a moved day, a
   price change, a foreign charge whose hryvnia amount drifts, a skipped month.
2. **Otherwise split by amount**: sort by magnitude, cut where the next exceeds the previous by more than 1.25.
   Each piece that passes is a series. Apple 99 and Apple 399; a monthly and a yearly on one name.
3. A piece that fails, and that has **two or more charges in one calendar month**, splits by day of month
   (cut at a gap over 3 days, with the month's end wrapping to its start). Each part passing as monthly is a
   series. Apple at close or equal amounts on different days. The two-in-a-month condition keeps a once-a-month
   visitor on a random day from being cut into a lucky part.
4. **Coverage**: when steps 2-3 found series, they stand only if they cover at least half the group's charges.
   A daily shop with a few look-alike big baskets gives none. A subscription among rarer one-off purchases stays.
5. **A bill with no steady amount**: when steps 2-3 found nothing, the whole group passes as monthly with the
   amount test dropped and a minimum of 6 charges. A gas bill.

Why amounts are never matched exactly: they cannot be. A foreign charge billed in hryvnia moves every month
and the original currency is not stored (section 1, claim 7).

### 5.4 Matrix

All worlds are pins (`now` 2026-11-03, Europe/Kyiv). `FM` a false match if it went wrong, `FM accepted` a false
match kept on purpose, `FS accepted` a false miss kept on purpose. A smoke run of the reference (section 10) on
these worlds passes every row; it is not a pin on the app's code.

| World | Expected | Guards |
|---|---|---|
| Daily grocery shop | none | FM |
| Weekly shop with moving amount | none | FM |
| One visit a month on a random day, one price | none | FM (step 3's condition) |
| Monthly rent, 1st to 3rd, third-party transfer | monthly, "around day 2" | miss |
| Netflix, day moved 15th to 18th | one monthly, "on day 18" after two charges on it | moved day |
| Netflix, day moved a week once | one monthly | moved day |
| Apple twice, different amounts and days | two monthly | merchant gap test |
| Apple twice, close amounts, different days | two monthly | step 3 |
| Apple twice, same amount, different days | two monthly | step 3 |
| Apple twice, same amount, same day | none | **FS accepted**: indistinguishable from a double charge |
| Apple monthly and yearly | monthly and yearly | step 2 |
| Yearly domain renewal, two charges | yearly; stopped if over a year ago | min 2 |
| Yearly renewal moved by days | yearly | tolerance |
| Two visits a year apart at one price | yearly | **FM accepted**: the hide control removes it (section 8) |
| Weekly charge with a 2-week holiday gap | one weekly | slots |
| Monthly, a skipped month | one monthly | occupancy |
| Price change of 50 percent | one monthly | one jump |
| Two price changes in two years | one monthly | jump allowance |
| Stopped subscription | monthly, stopped, "No charge since" | section 7 |
| Foreign charge billed in hryvnia | one monthly | drifting amount |
| The 31st against February | monthly, "on the last day" | clamp |
| User changes card, same currency | one monthly across two holdings | crossing |
| Same name in two currencies | two monthly, never summed | currency |
| Imported row with its synced twin | one monthly, each charge counted once | twin fold |
| Two charges only | none | minimum |
| Subscription among rarer one-off purchases | monthly | coverage |
| Utility bill with widely moving amount | monthly | step 5 |
| Exchange leg, balance row, split change, linked loan, crypto account, each monthly | none | section 4 |
| Cash-out MCC, own IBAN transfer, deposit wording, matched pair, funded exchange, each monthly | none | section 4, one world per rule |
| Name holding a month ("Оренда за жовтень") | none | **FS accepted**: each name is its own key; `merchantNameOf` cuts only a trailing number |
| Any world with its rows shuffled | same result | order |
| Any world under `withDeviceZoneOffset` across a DST change | same result | local days |

## 6. The recurrence date

Text states what the past charges show. It is written so it cannot read as a promise ("Charged monthly"), the
output holds no date later than `now`, and no code path steps a date forward from the last charge (section 7).

| Period | Rule, over which charges | en draft |
|---|---|---|
| Monthly | Last 3 charges. All 3 on their month's last day | Charged monthly, on the last day |
| | else a day that 2 of the 3 share | Charged monthly, on day 15 |
| | else, when they spread over at most 6 days, the middle one | Charged monthly, around day 15 |
| | else no day is honest | Charged monthly |
| Weekly | Last 4. A weekday 3 of the 4 share | Charged weekly, on Mondays |
| | else | Charged weekly |
| Yearly | The latest charge's day and month, `formatDayMonth` | Charged yearly, on 12.03 |

**When the day moves: two of the last three, not the latest and not all history.** The latest alone would flip
on one weekend shift and flip back. All history would keep saying the old day for months. Two of three ignores
one shift and follows a real move within two charges. The second line always carries the plain fact: the date
of the last charge.

Dates use `formatDate` ("DD.MM.YYYY") and `formatDayMonth`: the app's one explicit format (`src/dates/format.ts`).
There is no month-name helper, so "3 August" of the brief reads "03.08.2026". "Day 15" avoids an English ordinal,
which would need ordinal plural rules no catalogue here uses.

A weekday in `uk` needs the accusative («у пʼятницю»), which `Intl` does not give: seven catalogue keys.

## 7. Stopped

A pure read of time since the last charge, stepping **back** from `now`, never forward from the charge:

| Period | Stopped when the last charge is older than |
|---|---|
| Weekly | 14 + 3 days back from today |
| Monthly | 1 calendar month + 7 days back |
| Yearly | 12 calendar months + 14 days back |

Text: "No charge since 03.08.2026". A fact about the rows, never about the merchant.

**A stale source is told apart, by the rows themselves.** A disconnected bank, a failed sync or an old statement
also stops rows. The ledger read already holds every row, so `accountQuiet` is: no row of either sign on the
last charge's holding is newer than that charge. Then the stopped line reads "No newer transactions on this
account since 03.08.2026". `syncState` is not read: it knows nothing about an import-only or a manual account,
and a Monobank disconnect keeps the account, so the rows are the one signal that covers all sources. A quiet active
series adds nothing: it has not stopped.

**Stay, sink, leave.** Stopped series sink to their own section below the active ones, newest last charge first.
A series leaves the list 24 months after its last charge: a statement import of old years would otherwise fill the
list with dead subscriptions. The rows stay on Home. Not a setting.

**The day rolls while the screen is open.** `now` comes from `useVisibleRefreshedNow`
(`src/design-system/use-visible-refreshed-now/`), so it refreshes when the screen becomes visible, not at midnight.
Accepted: every line is a dated fact and stays true overnight; only the section a series sits in can be one day
late, until the next return to the screen. A midnight timer is not added for that.

## 8. Detected, and removing a false match

Detected only (Q2). **Hide**, on the series screen: "Not a recurring charge". It hides that **merchant key**, every
series under the name, because a false match is about the name ("ATB is no subscription"), and amount or day keys
drift with each new row. It writes nothing on a transaction.

It is visible and reversible: the list ends with a "Hidden" section naming each hidden merchant with "Show again",
even when it has no rows now. No confirm is needed: nothing is lost and the undo is on the screen it returns to.

**Store: one nullable JSON column on `settings`**, `recurringHiddenMerchants: Record<key, shownName>`, as
`reminderOfferDismissals` already is (`schema.ts`; read-modify-write inside one `write()`, as
`recordReminderOfferDismissal` in `src/settings/settings.repo.ts`).

| Option | Weighed | Result |
|---|---|---|
| Nullable settings column | One migration; a restore carries it by column; one row, no chunking | **Chosen** |
| New table | Same older-build result as a column (optional key, as 0054), and adds a `DataSnapshot` key, a read, a delete and an insert in the restore | No gain |
| Reuse `settings.dismissedTips` (no migration; shipped builds already carry it) | Holds retired tip ids on real devices, so a role would be read from a prefix; a column named for tips would hold merchants; no shown name | Rejected: the role would be derived from shape |

**When `merchantNameOf` changes.** The stored key is that function's output. After a change, a stored key may match
nothing, and the series shows again; the user hides it again, and the old line stays in "Hidden" under its stored name
to clear. Or it may match more: the extra series is hidden, and "Hidden" names it, so it stays reversible. No migration
rewrites keys. Failure is visible and undoable, never a wrong amount. A pin in this track lists sample names against
their keys, so an edit of the function shows this consequence to its author.

## 9. Screens, entry and links

### 9.1 Entry: a Settings row (Q3)

| Place | For | Against |
|---|---|---|
| **Settings row** | Always rendered, so a reviewer on a clean install sees it (2.5.19). One stack; `TransactionForm` is already registered there (`settings.stack.tsx`). A pushed page lands in the detail pane | A tap deeper than Statistics. `1.4-small` is regrouping this screen's cards: one added `Card` to merge |
| Statistics | Spending is its subject | **Fails 2.5.19 as a clean-install entry:** with no accounts Statistics returns only `EmptyState` (`hasNoAccounts`, `statistics.screen.tsx:1271`). Its account and range filters do not apply here. Statistics is mounted in two stacks (Home's companion default, its own root), so both need the routes, and `1.4-tables` adds its button there |
| Home | Most seen | Filters are local state, `Home` takes no params; FAB and filter bar crowd it; nothing there is a list of lists |
| Settings > Categories | | A spending fact is not a category setting; `1.4-category-automation` already adds its card there |

A row in its own `Card`, testID `settings-card-recurring-charges`, icon `entrySymbol.recurringCharges` = `repeat`
(SF Symbols 1, so it exists on iOS 18.2; the developer checks it against kiko-design-system's "SF Symbol
availability"). No condition on the row, no count on it.

### 9.2 List: `RecurringCharges`

`src/screens/settings/recurring-charges/`. A `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`
(kiko-design-system, custom list screen). Sections: active, "No recent charge", "Hidden". Order inside a section:
newest last charge, then key, then series id. Never by amount: a section can mix currencies.

A row (shared `Card`, `Text`, `MoneyText`): the name; the recurrence line; "Last charge 15.10.2026" with that charge's
amount in its own currency, or the stopped line. The amount is a past fact, and the only way to tell two Apple
series apart. It sits beside the date and has no label that reads as an expected price.

Loading gates on `isLoading` through `useDataReady`, never on an empty list. Empty state: section 13. With rows and no
series, the same empty state, since it explains why.

### 9.3 Series and links: `RecurringSeries { seriesId, name }`

`src/screens/settings/recurring-series/`. Header: recurrence line, the last-charge or stopped line, charge count.
Below: **every past charge of the series, newest first, each a link.** Rows use the shared `TransactionCard` with
`transactionRowDescription`, `resolveCategoryDisplay` and the account and category footer, with the date in the trailing
slot. A settings screen may not import `src/screens/home/transaction-row` (`check:screen-imports`). The row's fold-away
twin is not listed; it is still on Home.

Each opens `TransactionForm { transactionId }` through `useOpenInPane`, the same route as Home
(`home.screen.tsx:509`) and Holding Detail (`holding-detail.screen.tsx:1124`). The form takes it from the route and
resolves editable or read-only by the row's `source`. The Settings stack registers it already, today only for templates;
the plan adds a navigator pin for this path. Home is not used: `Home` takes no params and its filters are local state,
which `1.4-tables` reports too.

`seriesId` is the id of the series' earliest charge. If it is gone from a fresh read (a row deleted, or an older row
imported) the screen shows `EmptyState` rather than the wrong series.

### 9.4 iPad and Duo

By the pane rule (kiko-architecture, "Pane navigation"): Settings list in the companion pane; `RecurringCharges`
replaces the detail page; a series opens one step deeper there, the form one step deeper again; Back walks them. The
menu row is marked through `isShown('RecurringCharges')`, as the others. On a Duo inner screen (`single` mode) it is one
stack. A fold remounts screens and params survive. A tab blur pops the stack as every tab does. Neither screen can be a
default, so the focus-hook rule does not apply; they use `useIsScreenVisible` anyway.

### 9.5 Live reads

`useRecurringSeries()` in `src/recurring/use-recurring-series/`, so both screens share it across the screen boundary.

| Read | Tables | Options |
|---|---|---|
| `transactionsRepo.recurringLedgerQuery()`, narrow columns, whole ledger, no order | `transactions` | `paused`, **not `cached`** |
| `holdingsRepo.allQuery()`, `accountsRepo.listQuery()`, `settingsRepo.getQuery()` | their own | `paused` |
| Series screen: `listWithContextByIdsQuery(ids)`, plus categories and settings for the row | `transactions`, `holdings`, `accounts`, `categories`, `settings` | `paused` |

`paused: !useIsScreenVisible()` on every read. Not `cached`: a second LRU copy of a whole ledger for a screen opened
rarely, and the hide control acts on its result. `write()` flushes once per commit, so a sync fires one re-read.
Detection runs in a `useMemo` on rows, holdings, accounts, hidden keys and `now`.

## 10. Cost

### 10.1 The read cannot be narrowed by rows

The matched-pair matcher needs credits, and the funding matcher needs crypto rows and blank rows, so the read is the whole
ledger with narrow columns. A partial index therefore does not help: the query has no predicate for it to serve. No index
and no migration for the read.

Prior shape: the category-automation spec, section 3.2.3, measured a narrow table at 100,000 rows. This one uses the real
column set. Statistics already reads every row and every column on a live query (`listAllQuery`,
`statistics.screen.tsx:266`), so a whole-ledger read is no new class of cost, and this one runs only while its screen shows.

### 10.2 Measurement

RESULT PENDING. Script: `measure-recurring.mjs` in the track's scratchpad, run by `kiko:ops`; it takes the column list and
the indexes from `src/db/schema.ts`, uses the seed, word list and 25-rows-per-description ratio of
`rules-performance-fixture`, plants 30 series, and at 10,000, 50,000 and 100,000 rows prints: EXPLAIN QUERY PLAN and
median time for each candidate read (narrow, narrow ordered, every column, debit-only, by id); wall time and counted work of
the reference detection (rows read, name calls, sort comparisons, fit evaluations); a false-match sweep over merchants with
no real recurrence.

| Rows | Narrow read | Reference detection | Name calls | Fit evaluations |
|---|---|---|---|---|
| 10,000 | RESULT PENDING | RESULT PENDING | RESULT PENDING | RESULT PENDING |
| 50,000 | RESULT PENDING | RESULT PENDING | RESULT PENDING | RESULT PENDING |
| 100,000 | RESULT PENDING | RESULT PENDING | RESULT PENDING | RESULT PENDING |

False-match sweep: RESULT PENDING.

### 10.3 Not measured

An iPhone; Hermes (no JIT); the encrypted file; op-sqlite row marshalling; the exclusion matchers on top of the reference
(they run in Statistics today and hold their own counted pins). The device check in the plan covers these by eye on the
user's real ledger.

### 10.4 Pins, and the fix if one fails

Counted work, never wall clock (`transactions.repo.category-rules.performance.test.ts` states the rule):
- `merchantNameOf` runs at most once per distinct description, over the 50,000-row `rules-performance-fixture`.
- Reads of a row's `time`, by instrumented rows, stay under a bound of the form `rows x (log2(rows) + K)`; the developer
  sets K from the first measured run, and it is never raised after.
- One statement per ledger fire; EXPLAIN QUERY PLAN of the narrow read is `SCAN transactions` with no temp b-tree.

If a count pin fails, the fix is in the algorithm (a memo, no second sort), never a weaker bound. If the device check shows a
stall on the real ledger: read a time window on the existing `transactions_time` index with its own EXPLAIN QUERY PLAN pin, no
migration. That changes which old links show, so it comes back to the user first. A new index, if it ever comes to that, gets
its own migration, an EXPLAIN QUERY PLAN test and a `kiko:reviewer` step.

## 11. Storage, restore, older builds

Only the hide list is stored. Detection stores nothing: no series table, no mark on a row. Deleting or restoring rows
just gives a new detection.

The migration number is not assigned; merge order decides (`1.4-category-automation` adds two migrations of its own).
`ALTER TABLE settings ADD recurring_hidden_merchants text`.

| Path | Result | Evidence |
|---|---|---|
| v1.1.0 restores a 1.4 file | Refused whole by version, as every version 3+ file already is | `git show v1.1.0:src/data-transfer/crypto/envelope.ts`: `EXPORT_VERSION = 2`, reads 1-2 |
| v1.2.0 restores a 1.4 file | Refused whole by version, as every version 4+ file already is | same path at `v1.2.0`: `= 3`, reads 1-3 |
| `release-1.3` tip 918683db3 restores a 1.4 file | Restored; drops the key; nothing is hidden there, so a false match shows | same path: `= 5`, reads 1-5; `VERSION_DECISIONS` notes for 0055 and 0060 state the drop |
| 1.3 file, or an in-place update from 1.3, into 1.4 | The key is absent, default NULL, nothing hidden | as `restore-dismissed-tips.test.ts`; pin |
| 1.4 file into 1.4 | The list comes back from the file. It is the user's choice, not this device's, so not `KEPT_FROM_LIVE_ON_RESTORE` | `kept-from-live-on-restore.ts`; `settingsRowsToInsert` `restore-snapshot.ts:978-981` |
| 1.4, into 1.3, re-exported, into 1.4 | The list is lost; series show again; the user hides them again. No row changed | |

**`EXPORT_VERSION` stays 5.** A bump would make 1.3 refuse every 1.4 file over a list that is safely inert. The note goes in
`VERSION_DECISIONS` (`src/data-transfer/crypto/envelope.test.ts:99`) with `migrationCount` plus one. The `settings` shape check
reads no column, so a malformed value in a file is read defensively (a non-object reads as nothing hidden; pin).

No owed state: NULL means nothing hidden and no one-time step runs. Suites whose database stops below the new migration
still fail by `no such column` when read through today's schema; the plan lists them.

## 12. Compliance

- No new network call, domain, SDK, permission or required-reason API. App Privacy stays "Data Not Collected"; the policy is
  unchanged.
- A merchant name in the hide list is a local value in the encrypted database and the encrypted `.kiko`. No name or IBAN is
  logged: a failure log is fixed text. `counterIban` is read only as the exclusion function reads it, never shown here.
- Guideline 2.5.19: no flag, no condition on the entry; a clean install shows the row and an empty state that says what the
  screen does. No demo or seed import from `src/`. Notes for Review name the feature and that it needs repeated rows, so a
  reviewer without data knows what the empty state means (2.3.1(a)).
- Trademarks: no merchant name in a catalogue string; the app shows only the user's own text.
- Not a promise: no future date in any output (a property pin), and the Help topic says so.

## 13. i18n

Both catalogues together; the parity test holds. Texts are drafts: kiko-translator's casing and full-stop rules decide, and the
user reviews new keys before a deploy. A plural goes through `count` with `_one/_few/_many/_other` in both, uk `_other` being the
fractional form. A uk apostrophe is U+02BC. uk says «Кіко» and «натиснути». A screen or section title key joins `title-keys.ts`.

| Key | en | uk |
|---|---|---|
| `settings.recurringCharges` | Recurring charges | Регулярні платежі |
| `recurringCharges.title` | Recurring Charges | Регулярні платежі |
| `recurringCharges.emptyTitle` | No recurring charges yet | Регулярних платежів ще немає |
| `recurringCharges.emptyMessage` | Kiko looks through your transactions for charges that repeat, such as subscriptions and rent, and shows the ones that already happened. A monthly charge appears after its third payment; importing a statement can bring in earlier ones. | Кіко шукає у ваших транзакціях платежі, що повторюються, як-от підписки й оренда, і показує ті, що вже відбулися. Щомісячний платіж зʼявиться після третього списання, а імпорт виписки може додати попередні. |
| `recurringCharges.monthlyOnDay` | Charged monthly, on day {{day}} | Списання щомісяця, {{day}} числа |
| `recurringCharges.monthlyAroundDay` | Charged monthly, around day {{day}} | Списання щомісяця, близько {{day}} числа |
| `recurringCharges.monthlyLastDay` | Charged monthly, on the last day | Списання щомісяця, в останній день |
| `recurringCharges.monthly` | Charged monthly | Списання щомісяця |
| `recurringCharges.weekly` | Charged weekly | Списання щотижня |
| `recurringCharges.weeklyOn.monday` ... `.sunday` | Charged weekly, on Mondays ... | Списання щотижня, у понеділок / у вівторок / у середу / у четвер / у пʼятницю / у суботу / у неділю |
| `recurringCharges.yearlyOn` | Charged yearly, on {{date}} | Списання щороку, {{date}} |
| `recurringCharges.lastCharge` | Last charge {{date}} | Останнє списання {{date}} |
| `recurringCharges.noChargeSince` | No charge since {{date}} | Немає списань від {{date}} |
| `recurringCharges.accountQuietSince` | No newer transactions on this account since {{date}} | На цьому рахунку немає новіших транзакцій від {{date}} |
| `recurringCharges.stoppedHeading` | No Recent Charge | Без нових списань |
| `recurringCharges.chargeCount_*` | {{count}} charge / charges | `_one`, `_few`, `_other`: {{count}} списання; `_many`: {{count}} списань |
| `recurringCharges.seriesGoneTitle` | This charge no longer repeats | Цей платіж більше не повторюється |
| `recurringCharges.seriesGoneMessage` | Its transactions changed, so Kiko no longer finds a pattern in them. | Його транзакції змінилися, тож Кіко більше не бачить у них закономірності. |
| `recurringCharges.notRecurring` | Not a recurring charge | Це не регулярний платіж |
| `recurringCharges.hiddenHeading` | Hidden | Приховані |
| `recurringCharges.showAgain` | Show again | Показати знову |

`recurringCharges.title` and the section headings join `title-keys.ts`. Removed or renamed keys: none.

## 14. Help and What's New

Help topic `viewRecurringCharges` in `src/help/help-topics.ts`, action `openRecurringCharges` (`HelpAction`, `help-topic.screen.tsx`), a
`TOPIC_TITLES` row with the uk noun form «Перегляд регулярних платежів». Steps, each shipping with the set that adds what it names:
1. (task 1/3) Open the "Settings" tab and tap "Recurring charges".
2. (task 1/3) Kiko finds charges that repeat in your transactions and shows the day they were charged and the last charge. It shows only what already happened, never a future charge.
3. (task 2/3) Tap a charge to see each of its past transactions, then tap one to open it.
4. (task 3/3) If a name doesn't really repeat, tap "Not a recurring charge". You can bring it back from "Hidden" at the end of the list.

What's New draft, per the release skill's format: "Recurring charges: see what repeats in your transactions and every past charge." uk: "Регулярні платежі: дивіться, що повторюється у ваших транзакціях, і кожне минуле списання." Not committed: it lives in App Store Connect.

## 15. Binding constraints, order

| Constraint | Enforced by |
|---|---|
| No future date, no forecast, no total | A property pin: every date in the output `<= now`; the output type has no sum; stopped steps back only; review |
| One name definition | Import from `@kiko/transactions/merchant-name`; review. No local normalizing |
| One eligibility definition | `recurringExcludedIds` only calls the existing functions; one world per rule |
| Never sums across currencies | The group key holds the currency; no sum exists anywhere |
| Detection writes nothing | Pure function and a read-only query; only `hideRecurringMerchant` and `showRecurringMerchant` write, and only to `settings` |
| A new exchange's rows stay out | The account kind allow-list; a crypto-account world |
| 2.5.19 | No condition on the row; a screen pin with no data |
| An older build damages nothing | Section 11, with a restore pin and a file-without-key pin |
| Purpose | No balance, net worth, category or statistic reads this; it changes none of them |

Sets, each merging into `next` alone. Counts are floors, tests included.

1. **1.4-recurring task 1/3: detection and the list.** Goal: the Settings row, the list, the empty state, the recurrence text and stopped section. Rows do not open yet. Needs `1.4-category-automation task 2/6`. Floor 26 files.
2. **1.4-recurring task 2/3: the series screen and its links.** Goal: every past charge, each opening its form, on phone and two panes. Needs task 1/3. Floor 12 files.
3. **1.4-recurring task 3/3: hide a false match.** Goal: the control, "Hidden", the column and its restore paths. Needs task 2/3. One migration. Floor 18 files plus generated ones.

Conflict surface: `settings.screen.tsx` (one `Card`; `1.4-small` regroups around it), `settings.stack.tsx` and `types.d.ts` (one added route each with `1.4-category-automation`), `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` (added lines), `schema.ts`, the migration files, `envelope.test.ts`, `settings-columns.test.ts` (task 3/3, by merge order). `1.4-light-scheme`: theme tokens and shared components only, so it applies by itself. `1.4-tables`: Statistics is not touched here. `1.4-bybit`: section 4.

## 16. User questions

Only decisions that change what gets built.

**Q1. What does the recurrence date read like?**
- A. A stated pattern plus the plain fact: "Charged monthly, on day 15" and "Last charge 15.10.2026". Tells what recurs at a glance; "around day 15" or no day when the days spread.
- B. Only the fact: "Monthly" and "Last charge 15.10.2026". No day to get wrong; the user reads the day from the list of past charges.
- C. The range: "Charged monthly, days 14-16". Most exact, longest, and noisy when one charge moved once.

Recommendation: **A**. It is the ruling's "recurrence date", with a past-tense frame that cannot read as a promise.

**Q2. Can a user also mark something as recurring by hand?**
- A. No. Detected only, plus "Not a recurring charge" to hide a false match. Nothing more to store. A real charge the rule misses (section 5.4, accepted misses) simply does not show.
- B. Yes: a "Mark as recurring" on a transaction form. Closes those misses. A marked merchant has no detected period, so it needs a period picker or its own wording, a second stored list, and a form change that also touches `1.4-category-automation`'s sheet. One more set.

Recommendation: **A**, and see which misses real use finds.

**Q3. Where does the entry live?**
- A. A row in Settings. Always visible, also on a clean install; one stack; one tap deeper than the charts.
- B. A card on Statistics, with the routes in both stacks that show it. Nearer to spending, but on a clean install Statistics shows only its "add an account" state, so a reviewer would not see it, and a Settings row would be needed as well.

Recommendation: **A**.

**Planner's calls, recorded, not questions** (reasons in the sections named): the three periods and their minimums (5.1); yearly from two charges, with an accepted false match (5.1, 5.4); a series crosses holdings, not currencies (4); pending and manual rows count, refunds neither count nor cancel (4); loan links out by marker (4); crypto and other non-cash accounts out by kind (4); the twin fold keys on day, amount and source (4); two of the last three decides a moved day (6); numeric dates as everywhere in the app (6); the stale source read from rows, not `syncState` (7); stopped sinks and leaves at 24 months (7); no midnight timer (7); hide is per merchant key (8); a settings column rather than a table or `dismissedTips` (8); the last charge's amount shows beside its date (9.2); not `cached` (9.5); `EXPORT_VERSION` stays 5 (11).
