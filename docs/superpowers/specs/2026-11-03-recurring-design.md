# Recurring charges design (1.4)

Track: 1.4-recurring. Base: c9896e1f9, a merge of `next` 052798862 into 859b4c596 that changed no `src/` path. Read from
code; the app was not run. Every file:line below holds on this base only: re-grep the named symbol on the actual base
before building on it. Counts of files, cases and call sites are floors; the developer measures.

Status: DRAFT, waits for the user's answers (section 16). The plan is written on the recommendations. Revised after a
review of 3dab56c68; section 5.4 shows what changed. Section 10.2 holds the measurement; section 12 is re-read on the merged
demo seed.

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
| 5 | Detect from synced rows | True for the fields, **shallow for the history.** A first Monobank sync reads back 31 days only, and nothing backfills further. A monthly series shows from its third charge. A 31-day window can already hold two monthly charges, so that is at least one month after connect; a yearly one, over a year | `DEFAULT_LOOKBACK_SECONDS` `src/monobank/sync/sync.ts:46`, `fromCursorSeconds` `:804` |
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

**Which set.** Checked in its plan at branch tip 2034e8d9f (the plan's text last changed at c2ec70313); the set numbering
did not change: `1.4-category-automation task 2/6: prefix offer in Apply` creates `merchant-name.ts`, with
`merchantNameOf`, `merchantSpellingOf`, `tidiedNameOf` and `smallestSpelling`. On that tip that track holds code commits of
its task 1/6 only; `src/transactions/merchant-name/` does not exist in its tree or at its commit.

**This track also uses** `merchantSpellingOf` and `smallestSpelling` for the shown name: one spelling per series,
order-free, "ATB" for `ATB 0212` and `ATB 0340`. Those two names are in that plan's interface, not in its spec
section 4: re-grep them. `mostUsedSpelling`, which an earlier tip of that plan held, is gone. That plan says of the
prefix spelling "used for nothing else" and marks `merchantSpellingOf` as `nameStartsWith` text only. This track is
a second reader of the same function, so its task 1/3 widens that one comment; no rule changes. `key` alone still
decides the group.

**Order, and what moves it.**
- `1.4-recurring task 1/3` needs that set merged into `next`. Its plan stacks its tasks (`S16`), so task 2/6's
  base is task 1/6's tip, and in practice `next` receives the back-fill and the Travel migrations first. This
  track needs nothing else from task 1/6, but it cannot avoid it unless the coordinator reorders.
- If task 2/6 moves later or renumbers, this track's order stays and task 1/3 waits for it.
- If the user's rulings on that spec drop B3: the function has no first caller there. Then the function's
  own steps (its name-table and function steps, with its spec table) move to `1.4-recurring task 1/3`, which
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
| A debit that funded an exchange purchase | Out, unless its category was set by hand | `exchangeFundingMatches(...).excludedIds` `exchange-funding-match.ts:263`, over the whole ledger, so a monthly P2P crypto buy is no subscription. `excludedIds` skips a `categorySetByHand` row (`:279-281`): "stays in spending as set". Such a row counts here too and a monthly buy then shows: **FM accepted**, one definition of the set, and the hide control removes it |
| A linked loan payment (`loanHoldingId` set) | Out | The loan has its own schedule and screen. The marker, not `loanPaymentExcludedTransactionIds`: that one needs loan metadata and answers a spending question (interest counts). `loan-excess:` and `loan-interest:` are synthetic entries, never stored, so they are never read here. An unlinked loan payment is an ordinary row and counts |
| Account kind not `bank` or `cash` | Out | An allow-list on the holding's account. It matters: a Binance deposit or withdrawal stores the ticker as its description (`binance.transactions.ts:273`), so "USDT" would read as a merchant. It also covers `1.4-bybit` with no per-exchange list: checked at its tip ef21601bd, its diff is documents only and adds no `accounts.kind` member, and a Bybit account is a `crypto` one, because the exchange picker renders only under `kind === 'crypto'` (`account-form.screen.tsx`, `ExchangeTypeField`) |
| Archived account (`archivedAt`) | Out | Statistics shows only non-archived accounts, `statistics.screen.tsx:354`. The matchers above still read its rows |
| A row whose local day is later than today | Out, and not activity (section 7) | A manual row can hold a future date, and it must never show as a charge. Compared by local day, so a row later today stays: a sync at 10:05 or a date-only import at noon is not delayed |
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
within a group, per signed amount, by source in the order synced, then manual, then import (source name breaks a
tie between two synced sources; time, then id, inside a source): a row folds into one kept row of **another
source** at most once, on the same local day first, then one local day apart. A row with no partner is a real
charge and stays. So:
- The charge count for one day and amount is the largest count of any one source: [monobank, import, import] is 2.
  A real charge is never dropped.
- One local day apart folds, since a bank date and local noon can differ by a day abroad. Two days apart does not:
  those are two charges in one slot, and such a series does not show (**FS accepted**, section 5.4).
- The holding is not compared, so a statement imported into a plain holding folds too. Two rows of one source are
  two real charges and stay.

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
clamps the 31st to February's end, and `daysBetween` (`:62`), which compares local calendar days across DST and
**clamps at zero** (`Math.max(0, ...)`, `:68`): `daysBetween(15 Nov, 5 Nov)` is 0, so a charge 10 days early would fit
if called one way. A deviation is therefore the larger of `daysBetween` in both orders; a world pins it.
`transactions.time` is epoch milliseconds (`schema.ts:141`). A charge's day is its device-local day, as on Home.
`dayKeyOf` (`price-book.ts:90`) gives the same day as a UTC-midnight key; it is not needed here. A user abroad
sees a late-evening charge on the neighbouring day; the tolerance holds it.

### 5.2 Testing a list of charges against a period

For each consecutive pair: `slots` is the whole number of periods nearest to the gap (0 when two charges sit
in one slot); `deviation` is the local days between the later charge and the earlier one stepped by `slots`.
A pair **fits** when `1 <= slots <= max` and `deviation <= tolerance`. Two charges **share a slot** when their pair's `slots` is
0. The list **passes** when all hold:
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
2. **One charge a slot, any amount**: the whole group has at least 6 charges, passes as monthly with the amount test
   dropped, and no two charges share a slot: one series. A seasonal bill; two large price changes. A real
   two-subscription name has two charges in a slot, so it goes on to the split.
3. **Otherwise split by amount**: sort by magnitude, cut where the next exceeds the previous by more than 1.25.
   Each piece that passes is a series. Apple 99 and Apple 399; a monthly and a yearly on one name.
4. A piece that fails is **cut by exact amount**, and each exact piece that passes is a series: a subscription at one
   price among look-alike purchases. What remains, if it has **two or more charges in one calendar month**, splits by
   day of month (cut at a gap over 3 days, with the month's end wrapping to its start), and each part passing as
   monthly is a series. Apple at close or equal amounts on different days. The two-in-a-month condition keeps a
   once-a-month visitor on a random day from being cut into a lucky part.
5. **Coverage**: series from steps 3-4 stand if together they cover at least half the group's charges. A daily shop
   with a few look-alike big baskets gives none; a subscription among rarer one-off purchases stays. Below half, a
   monthly series still stands if it has at least 6 charges, no two in a slot, and its largest amount within 1.25 of
   its smallest: Apple 99 among more frequent App Store purchases.
6. **Nothing stands**: the whole group passes as monthly with the amount test dropped and a minimum of 6 charges. A
   gas bill with one double charge.

**Proof on a reference run, not a pin.** At the rule of 3dab56c68 against this one, the sweep of merchants with no real recurrence, 3 years of random rows, covers 44 cells of visit rate and amount shape: 42 cells are unchanged, the worst staying 12 of 2,000 (0.60%, one visit in ten months, the accepted yearly match), and 2 cells move from 0 to 1 of 2,000 (0.05%, a five-price list at one and two visits a month). A daily shop with look-alike big baskets reads as recurring for 0 of 300, both times. A real monthly among 15 to 60 purchases on one name is found exactly in 41 of 2,000 before and 1,934 of 2,000 now; without step 4's exact cut, 88. So the exact cut stays.

Why amounts are never matched exactly in steps 1-3: they cannot be. A foreign charge billed in hryvnia moves every month and
the original currency is not stored (section 1, claim 7). Step 4's exact cut only rescues a piece that already failed.

### 5.4 Matrix

All worlds are pins (`now` 2026-11-03, Europe/Kyiv); the plan's matrix holds each world's exact rows and is the contract. `FM`
a false match if it went wrong, `FM accepted` a false match kept on purpose, `FS accepted` a false miss kept on purpose. A
one-off reference run, outside the track, passes every row; it is no pin on the app's code.

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
| A subscription with most one-offs at exactly its price, 12 charges among 15 rows | none | **FS accepted**: the price tells them apart no more than the day does |
| A subscription under 6 charges among more frequent purchases | none | **FS accepted**: too little to tell it from a lucky run |
| A twin two days from its bank date | none | **FS accepted**: two charges in a slot |
| A charge 10 days early (15 Aug, 15 Sep, 5 Oct) | none | `daysBetween` clamp, both orders |
| Not quiet: stopped, with a debit or a credit inside the window | monthly, stopped, "No charge since" | section 7 |
| A row later today | counted, last charge today | no delay |
| Any world with its rows shuffled | same result | order |
| Any world under `withDeviceZoneOffset` across a DST change | same result | local days |

Results this fix round changed, or worlds it added on a defect the review found. The "was" column is the rule at 3dab56c68,
each read from a reference run with that rule's switches.

| World | was | now |
|---|---|---|
| Seasonal bill: 130, 100, 105, 110, 100, 108, 400, 700, 900, 800, 500, 300 | two stopped monthly series, three rows unlinked | one monthly x12 (step 2) |
| Seasonal bill, one moved day | one stopped monthly x6, or two stopped, or none, by which month moved | one monthly x12 (step 2), in all 9 placements tried |
| Apple 99 x12 plus 15 more frequent purchases, none near 99 | none, coverage 12/27 | monthly x12 (step 5) |
| The same, purchases near 99 | monthly x14, two one-offs linked | monthly x12 (step 4) |
| The same, three purchases at exactly 99 | monthly x14 | monthly x14: the one-offs that land in its slots stay linked |
| Two large price changes: 100 x8, 130 x6, 170 x4 | three series, two stopped | one monthly x18 (step 2) |
| Hand-category funded debit, monthly | not stated; a monthly | monthly, **FM accepted**; without a hand category none |
| Sync dead since 20 Aug: Netflix 15 Aug, Spotify 18 Aug, coffee 20 Aug | "No charge since", both | stopped and quiet, both, dated 20.08 |
| Import-only ledger ends in May | "No charge since" | stopped and quiet, dated at the ledger's last row |
| Black card idle, white card active, one account | quiet read "on this account" | quiet names the black card; the white card's series active |
| A future-dated manual row | counted as a charge; made the last charge a future date | left out; last charge stays the newest past row |
| Fold [monobank, import, import] on one day and amount | count 1 or 2 by row order, so a real charge could drop | 2, by the largest count of one source |
| Date-only twin one local day apart | two charges in a slot, none | one monthly, the synced row kept |

## 6. The recurrence date

Text states what the past charges show. It is written so it cannot read as a promise ("Charged monthly"), no output
date has a local day later than today, and no code path steps a date forward from the last charge (section 7).

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
also stops rows. The ledger read already holds every row, so a series is **quiet** when it has stopped and the newest
row of either sign on its last charge's holding is older than the same back-step cutoff the series' period uses for
stopped: the holding holds no row in the whole window where a charge would show. A row later than today (section 4)
is not activity. The date is the holding's newest row, not the charge. So a sync dead since 20 Aug with Netflix on
15 Aug, Spotify on 18 Aug and a coffee on 20 Aug reads quiet on both series, dated 20.08; every import-only ledger
ends this way. A coffee last week keeps the card alive, and the line stays "No charge since".

The check is per holding, so the line names the holding: "`<holding name>`: no newer transactions since 20.08.2026".
A black card idle and a white card active in one account would make "this account" false. The name is
`holdings.name`, the stored text Home's row footer already shows as `holdingName`, which for a Monobank card is
its masked number.

`syncState` is not read: it knows nothing about an import-only or a manual account, and a Monobank disconnect keeps
the account, so the rows are the one signal that covers all sources. A quiet active series cannot exist: quiet needs
stopped.

**Stay, sink, leave.** Stopped series sink to their own section below the active ones, newest last charge first.
A series leaves the list 24 months after its last charge: a statement import of old years would otherwise fill the
list with dead subscriptions. The rows stay on Home. Not a setting.

**The day rolls while the screen is open.** `now` comes from `useVisibleRefreshedNow`
(`src/design-system/use-visible-refreshed-now/`), so it refreshes when the screen becomes visible, not at midnight.
Accepted: every line is a dated fact and stays true overnight; only the section a series sits in can be one day
late, until the next return to the screen. A midnight timer is not added for that. Detection reads `now` only
through its local day, so the memo keys on that day (section 9.5): each return refreshes `now`, and the same day
re-runs nothing.

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

A row in its own `Card`, testID `settings-card-recurring-charges`, **directly above `settings-card-help`**: it reads the user's own rows, as the categories, reminders and templates group above it edits them, and Help stays last. It stays out of that group: `1.4-small` (tip 8b2726960) pins that group's three rows and the exact five-card order in two tests of `settings.screen.test.tsx`, so this track's merge with it edits both to six cards (`system`, `data-transfer`, `base-currency`, `categories-reminders-templates`, `recurring-charges`, `help`). On this base the same anchor holds, above Help. Icon `entrySymbol.recurringCharges` = `repeat`
(SF Symbols 1, so it exists on iOS 18.2; the developer checks it against kiko-design-system's "SF Symbol
availability"). No condition on the row, no count on it.

### 9.2 List: `RecurringCharges`

`src/screens/settings/recurring-charges/`. A `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`
(kiko-design-system, custom list screen). Sections: active, "No recent charge", "Hidden". Order inside a section:
newest last charge, then key, then series id. Never by amount: a section can mix currencies.

A row (shared `Card`, `Text`, `MoneyText`): the name; the recurrence line; "Last charge 15.10.2026", or the stopped or
quiet line; beside either line, the last charge's amount in its own currency. A stopped row shows it too: two stopped
Apple rows must differ. The amount is a past fact, and the only way to tell two Apple series apart. It has no label
that reads as an expected price.

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

`seriesId` is the id of the series' earliest charge. The route also holds `merchantKey`, `currency` and `period`. A row
deleted through a link, or an older row imported, moves the earliest charge while the series still lists. So a miss on
`seriesId` falls back to the one series with the same merchant key, currency and period. With none, or with more than
one (two monthly Apple series: never guess), the screen shows `EmptyState` with a neutral text about the list, never
about the merchant: nothing on this path says a charge stopped repeating.

The lookup reads the series before the hide filter, so between the hide write and `goBack` the screen keeps its series
and never flashes that state (section 8; a pin).

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
Detection runs in a `useMemo` on rows, holdings, accounts and the **local day of `now`** (`startOfLocalDay`), not on `now`:
each Back refreshes `now` with no row change and must run nothing. Hidden keys are not in the memo: the list filters on
them after detection, so a hide runs no detection, and the hook hands the series screen the unfiltered result.

## 10. Cost

### 10.1 The read cannot be narrowed by rows

The matched-pair matcher needs credits, and the funding matcher needs crypto rows and blank rows, so the read is the whole
ledger with narrow columns. A partial index therefore does not help: the query has no predicate for it to serve. No index
and no migration for the read.

Prior shape: the category-automation spec, section 3.2.3, measured a narrow table at 100,000 rows. This one uses the real
column set. Statistics already reads every row and every column on a live query (`listAllQuery`,
`statistics.screen.tsx:266`), so a whole-ledger read is no new class of cost, and this one runs only while its screen shows.

### 10.2 Measurement

A one-off measurement run by `kiko:ops`, outside this track: it is no contract and never enters the tree (the contract is the
plan's matrix). It takes the column list and the indexes from `src/db/schema.ts`, uses the seed, word list and
25-rows-per-description ratio of `rules-performance-fixture`, plants 30 series, and at 10,000, 50,000 and 100,000 rows prints:
EXPLAIN QUERY PLAN and median time for each candidate read; wall time and counted work of a reference detection; the
second-read path of opening a series; the false-match sweeps. Two full runs, 5 runs per figure, median ms.

**What these figures are.** Node v22.20.0 with JIT, and the sqlite3 CLI 3.51.0 with no encryption, on a Mac. No exclusion
matchers. Load (1-minute average at each run's start): 29.98 for run 1 and 20.56 for run 2, falling from over 100 (15-minute
143.66 and 110.44). No queued job ran: the queue's status listed none at the start or the end of either run. So every wall time
is an upper reading for this Mac, and it says nothing about an iPhone. Counted work was the same in both runs.

Wall times, run 1 / run 2:

| Rows | Narrow read | Reference detection | Second-read path (includes starting the sqlite3 process) |
|---|---|---|---|
| 10,000 | 16.0 / 15.0 | 198.1 / 160.0 | 232.9 / 221.9 |
| 50,000 | 68.0 / 68.0 | 920.5 / 881.6 | 1246.5 / 1175.6 |
| 100,000 | 148.0 / 133.0 | 2113.3 / 1823.5 | 2697.1 / 2466.8 |

Counted work, the same in both runs:

| Rows | Name calls | Groups | Sort comparisons | Fit evaluations | Series found (30 planted) |
|---|---|---|---|---|---|
| 10,000 | 1157 | 957 | 47281 | 65143 | 30 |
| 50,000 | 5684 | 3884 | 465912 | 364516 | 37 |
| 100,000 | 11358 | 7558 | 1059513 | 739964 | 39 |

The other reads, at 100,000 rows, run 1 / run 2, with their plans at every size:

| Read | Plan | Median ms |
|---|---|---|
| Narrow, no order (the choice) | `SCAN transactions` | 148.0 / 133.0 |
| Narrow, time desc | `SCAN transactions USING INDEX transactions_time` | 268.0 / 262.0 |
| Every column, time desc (today's `listAllQuery`) | `SCAN transactions USING INDEX transactions_time` | 376.0 / 357.0 |
| Debit, non-blank only (the matcher could not run) | `SCAN transactions` | 115.0 / 113.0 |
| One series by id, 36 rows | `SEARCH transactions USING INDEX sqlite_autoindex_transactions_1 (id=?)`, `USE TEMP B-TREE FOR ORDER BY` | 1.0 / 0.0 |

**Series found: 37 of 30 planted at 50,000 rows, and 39 at 100,000.** Not proven what the extra series are, so they are not
called accepted. The script prints only the count, and its ledgers are deleted at its end. What the script does prove by
reading: each planted name is its own key, at one amount and one day, charged every month, so step 1 of section 5.3 makes it
one series and it can add no second one; so the extras (7 and 9; 0 at 10,000) come from the random rows, which hold no planted
recurrence. Which rule let them through, and whether they are yearly by chance from a low visit rate as the sweep below
suggests, is not proven. The candidates differ: a thin name of about two debits in three years, or a merged name, since
`merchantNameOf` cuts a trailing number of two or more digits and folds "Silpo 10" to "Silpo 100" into one busy key. Task 1/3
step 5 of the plan reports what the real detection finds on `rules-performance-fixture`, the same word list and ratio; that is a
first reading of such rows with names, not a proof about these extras.

**Cost, plainly.** Reference detection at 100,000 rows is 1823.5 to 2113.3 ms on a Mac under this load, in node with JIT.
In the app it runs in a `useMemo` on the JS thread (section 9.5), on Hermes, which has no JIT, with the exclusion matchers on
top. No device figure exists, and no multiplier from this Mac to an iPhone is claimed. How large a real ledger is, is unknown:
the repo holds no measured real figure, only the 50,000 rows the category-rules spec budgets for. So this measurement does not
show that the list opens without a stall on a real ledger. The device check in the plan records that, and the fix path in 10.4
stands.

**False-match sweeps, the same in both runs.** One visit a month on a random day, one price: 1 of 2,000 (0.05%). Merchants with
no real recurrence, 3 years of random rows, visit rates 0.1 to 30 a month: worst 12 of 2,000 (0.60%, 0.1 visits a month,
log-normal amounts), then 10 and 6 of 2,000 in the same rate's other shapes, 1 of 2,000 at 0.25 visits a month at one price, 0
elsewhere. A price list over the same rates: 1 of 2,000 at 5 prices at each of one and two visits a month, 0 elsewhere. A daily
shop with look-alike big baskets: 0 of 300. Recall, a real monthly among 15 to 60 purchases on one name: exactly the subscription
1,934 of 2,000, any series 2,000, more than one series 12. Reference world matrix: 0 of 50 failed.

### 10.3 Not measured

An iPhone; Hermes (no JIT); the encrypted file; op-sqlite row marshalling; the exclusion matchers on top of the reference
(they run in Statistics today and hold their own counted pins); the size of a real ledger. The device check in the plan covers
these on the user's real ledger, and it names one path: **opening a series** is a second uncached whole-ledger read plus
detection, while the list's own read is paused beneath it. Returning with Back reads nothing new on an unchanged ledger and,
keyed on the local day, detects nothing.

**The device check records three numbers, on a release build on the user's ledger:** that ledger's row count; the time from
opening the list to the list showing; the time from opening a series to the series showing. No pass line is set here, since no
device figure exists to set one from. The numbers go in the coordinator's report with the user's own read of whether it stalls.

### 10.4 Pins, and the fix if one fails

Counted work, never wall clock (`transactions.repo.category-rules.performance.test.ts` states the rule):
- `merchantNameOf` runs at most once per distinct description, over the 50,000-row `rules-performance-fixture`.
- Reads of a row's `time`, by instrumented rows, stay under a bound of the form `rows x (log2(rows) + K)`; the developer
  sets K from the first measured run, and it is never raised after.
- One statement per ledger fire; EXPLAIN QUERY PLAN of the narrow read is `SCAN transactions` with no temp b-tree.

If a count pin fails, the fix is in the algorithm (a memo, no second sort), never a weaker bound. If the device check's numbers
show a stall on the real ledger: read a time window on the existing `transactions_time` index with its own EXPLAIN QUERY PLAN pin, no
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
- The reviewer's demo file reaches the feature (kiko-compliance, "the demo dataset must reach every feature"). `next` rebuilt the
  demo set. A reference run on the merged `buildScreenshotDataset`, anchor 2026-11-03 09:00 UTC, finds 24 monthly x6 series in both
  languages (was 7 on the old seed): Silpo, ATB, Fora, Novus, Puzata Hata, Lviv Croissants, Aroma Kava, Salateira, Uklon, Bolt, Kyiv
  Metro, OKKO, Kyivteploenergo, YASNO, Kyivvodokanal, Kyivstar, Planeta Kino, Netflix, Multiplex, Rozetka, Epicentr, Avrora, Nova
  Poshta, Ukrposhta. All come from `buildMonthlyExpenses`, one row every 30 days at a fixed offset; its three every-second-month
  health rows do not show. So a reviewer would read shops, taxis and a cinema as subscriptions, and moving only the grocery store
  leaves 23, ATB and Fora among them. So each monthly merchant but the five real bills moves: in months 1, 3 and 5 its one row sits
  10 days nearer the middle of its 30-day month, at the same amount, and month 0 stays. Month totals and the default 30-day window
  do not change. A reference run with that edit applied in memory finds exactly Netflix, Kyivstar, Kyivteploenergo, YASNO and
  Kyivvodokanal, none stopped, on all 731 daily anchors from 2026-11-03 (en, shifts of 6 to 12 days); as merged it finds 24 on all of
  them. That reference has no exclusion matchers; the plan's pin runs the real detection. The series shown depend on the file's
  anchor: an unrefreshed file reads them all as stopped, which the upload-day refresh already prevents.
- Trademarks: no merchant name in a catalogue string; the app shows only the user's own text.
- Not a promise: no output date has a local day later than today (a property pin), and the Help topic says so.

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
| `recurringCharges.monthlyOnDay` | Charged monthly, on day {{day}} | Списувалося щомісяця, {{day}} числа |
| `recurringCharges.monthlyAroundDay` | Charged monthly, around day {{day}} | Списувалося щомісяця, близько {{day}} числа |
| `recurringCharges.monthlyLastDay` | Charged monthly, on the last day | Списувалося щомісяця, в останній день |
| `recurringCharges.monthly` | Charged monthly | Списувалося щомісяця |
| `recurringCharges.weekly` | Charged weekly | Списувалося щотижня |
| `recurringCharges.weeklyOn.monday` ... `.sunday` | Charged weekly, on Mondays ... | Списувалося щотижня, у понеділок / у вівторок / у середу / у четвер / у пʼятницю / у суботу / у неділю |
| `recurringCharges.yearlyOn` | Charged yearly, on {{date}} | Списувалося щороку, {{date}} |
| `recurringCharges.lastCharge` | Last charge {{date}} | Останнє списання {{date}} |
| `recurringCharges.noChargeSince` | No charge since {{date}} | Немає списань від {{date}} |
| `recurringCharges.holdingQuietSince` | {{holding}}: no newer transactions since {{date}} | {{holding}}: немає новіших транзакцій від {{date}} |
| `recurringCharges.stoppedHeading` | No Recent Charge | Без нових списань |
| `recurringCharges.chargeCount_*` | {{count}} charge / charges | `_one`, `_few`, `_other`: {{count}} списання; `_many`: {{count}} списань |
| `recurringCharges.listChangedTitle` | This list has changed | Цей список змінився |
| `recurringCharges.listChangedMessage` | Go back to see your recurring charges as they are now. | Поверніться назад, щоб побачити регулярні платежі в поточному вигляді. |
| `recurringCharges.notRecurring` | Not a recurring charge | Це не регулярний платіж |
| `recurringCharges.hiddenHeading` | Hidden | Приховані |
| `recurringCharges.showAgain` | Show again | Показати знову |

`recurringCharges.title` and the section headings join `title-keys.ts`. Removed or renamed keys: none; no key here has shipped.

The uk recurrence lines are a past frame, since «Списання щомісяця, 15 числа» has no tense and reads as a schedule, which defeats
Q1's reason. They are drafts: `kiko-translator` rules decide them in the step that adds them. `{{holding}}:` opens its line so uk needs
no case form of a stored name.

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
| No future date, no forecast, no total | A property pin: no date in the output has a local day later than today; the output type has no sum; stopped steps back only; review |
| One name definition | Import from `@kiko/transactions/merchant-name`; review. No local normalizing |
| One eligibility definition | `recurringExcludedIds` only calls the existing functions; one world per rule |
| Never sums across currencies | The group key holds the currency; no sum exists anywhere |
| Detection writes nothing | Pure function and a read-only query; only `hideRecurringMerchant` and `showRecurringMerchant` write, and only to `settings` |
| A new exchange's rows stay out | The account kind allow-list; a crypto-account world |
| 2.5.19 | No condition on the row; a screen pin with no data |
| An older build damages nothing | Section 11, with a restore pin and a file-without-key pin |
| Purpose | No balance, net worth, category or statistic reads this; it changes none of them |

Sets, each merging into `next` alone. Counts are floors, tests included.

1. **1.4-recurring task 1/3: detection and the list.** Goal: the Settings row, the list, the empty state, the recurrence text and stopped section, and a reviewer's demo file that shows the real bills as series and no shop. Rows do not open yet. Needs `1.4-category-automation task 2/6`. Floor 32 files.
2. **1.4-recurring task 2/3: the series screen and its links.** Goal: every past charge, each opening its form, on phone and two panes. Needs task 1/3. Floor 12 files.
3. **1.4-recurring task 3/3: hide a false match.** Goal: the control, "Hidden", the column and its restore paths. Needs task 2/3. One migration. Floor 18 files plus generated ones.

**One release.** The three sets merge into `next` one at a time and `next` tolerates each middle state: every visible text ships with what it names (section 14), and no middle state writes anything but its own column. A release holds all three or none: tasks 1/3 and 2/3 alone have no hide, the remedy for the accepted yearly false match.

Conflict surface: `settings.screen.tsx` and both its exact-order pins (one `Card`; `1.4-small` regroups around it), `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md` and the demo `.kiko` files (`1.4-category-automation task 2/6` edits them too, and adds rows under merchants this track's pin reads), `settings.stack.tsx` and `types.d.ts` (one added route each with `1.4-category-automation`), `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` (added lines), `schema.ts`, the migration files, `envelope.test.ts`, `settings-columns.test.ts` (task 3/3, by merge order). `1.4-light-scheme`: theme tokens and shared components only, so it applies by itself. `1.4-tables`: Statistics is not touched here. `1.4-bybit`: section 4, no edit.

## 16. User questions

Only decisions that change what gets built.

**Q1. What does the recurrence date read like?**
- A. A stated pattern plus the plain fact: "Charged monthly, on day 15" and "Last charge 15.10.2026"; in Ukrainian a past frame, «Списувалося щомісяця, 15 числа» (a draft). Tells what recurs at a glance; "around day 15" or no day when the days spread.
- B. Only the fact: "Monthly" and "Last charge 15.10.2026". No day to get wrong; the user reads the day from the list of past charges.
- C. The range: "Charged monthly, days 14-16". Most exact, longest, and noisy when one charge moved once.

Recommendation: **A**. It is the ruling's "recurrence date", in a past frame in both languages, so it cannot read as a promise.

**Q2. Can a user also mark something as recurring by hand?**
- A. No. Detected only, plus "Not a recurring charge" to hide a false match. Nothing more to store. A real charge the rule misses does not show, with no way to add it. The misses that remain: a quarterly or half-yearly charge; a monthly charge before its third payment; two subscriptions under one name at the same price on the same day; a name that holds the month ("Оренда за жовтень"); a subscription under a name with many other purchases, when it has fewer than 6 charges, when its price changed, or when most of those purchases cost exactly what it costs; a monthly charge that doubled on the same day in several months; a statement row dated two or more days from its bank row.
- B. Yes: a "Mark as recurring" on a transaction form. Closes those misses. A marked merchant has no detected period, so it needs a period picker or its own wording, a second stored list, and a form change that also touches `1.4-category-automation`'s sheet. One more set.

Recommendation: **A**, and see which misses real use finds.

**Q3. Where does the entry live?**
- A. A row in Settings, in its own card directly above Help. Always visible, also on a clean install; one stack; one tap deeper than the charts.
- B. A card on Statistics, with the routes in both stacks that show it. Nearer to spending, but on a clean install Statistics shows only its "add an account" state, so a reviewer would not see it, and a Settings row would be needed as well.

Recommendation: **A**.

**Planner's calls, recorded, not questions.** None of these is a user ruling; the only user ruling here is the one quoted at the top. Reasons in the sections named: the three periods and their minimums (5.1); yearly from two charges, with an accepted false match (5.1, 5.4); a series crosses holdings, not currencies (4); pending and manual rows count, refunds neither count nor cancel (4); loan links out by marker (4); crypto and other non-cash accounts out by kind (4); two of the last three decides a moved day (6); numeric dates as everywhere in the app (6); the stale source read from rows, not `syncState` (7); stopped sinks and leaves at 24 months (7); no midnight timer (7); hide is per merchant key (8); a settings column rather than a table or `dismissedTips` (8); the last charge's amount shows beside its date (9.2); not `cached` (9.5); `EXPORT_VERSION` stays 5 (11).

**The orchestrator's calls after the spec review, recorded the same way, not user rulings:** a row is compared to today by local day, and a later local day is left out (4); the fold keeps the largest count of one source, and reaches one local day (4); a funded debit with a hand category stays in, as an accepted false match (4); quiet uses the stopped cutoff and dates from the holding's newest row (7); the quiet line names the holding (7); a stopped row shows its amount (9.2); the row sits above Help (9.1); the memo keys on the local day (9.5); a missed `seriesId` falls back to one matching series, else a neutral text (9.3); the demo seed's grocery store changes (12, widened below); all three sets ship in one release (15); the uk past frame, which `kiko-translator` rules decide (13).

**Where the measured reference moved a call:** step 2's condition was called as "every pair fits". On that form a seasonal bill with one moved day went back to the reported fault (two stopped rows or one short stopped row, in 7 of 9 placements of the moved day). So it reads "passes as monthly, no two charges in a slot": all 9 give one series, and the sweep below 5.3 shows no new false match. Step 6 runs when nothing stands, not only when nothing was found. The fold, coverage exception and exact-cut calls hold as called.

**The planner's call after the merge of `next`, recorded the same way, not a user ruling:** the merged demo seed reads 24 series, so the seed edit covers each monthly merchant but five bills, as one row moved within its month, not the grocery store's several visits (12). Nothing here has been decided by the user; Q1 to Q3 are still open.
