# Recurring charges design (1.4)

Track: 1.4-recurring. Base: 5256bf465, a merge of `next` 6be32bfcb. Sections 8.2, 9.1 and 9.6 are read on this tip; the older
file:line cites come from c9896e1f9. Read from code; the app was not run. Every file:line below holds on its base only:
re-grep the named symbol on the actual base before building on it. Counts of files, cases and call sites are floors; the
developer measures.

Status: DRAFT, waits for one user answer (Q5, section 16). The plan is written on its recommendation. Revised after a
review of 3dab56c68; section 5.4 shows what changed. Revised again after a review of 35861c22b; section 8.2 shows what changed.
Section 10.2 holds the measurement; section 12 is re-read on the merged demo seed.

Product purpose: Kiko answers "how much money do I have now". This view states what already repeated in
the user's own rows. It predicts nothing and plans nothing.

**User rulings.**
- Ruling 2026-11-03, binding on everything here: "A2 shows no upcoming charges, only the recurrence date + already occured
  transactions via links".
- Ruling relayed by the coordinator on 2026-11-03, for all 1.4 tracks: "For each feature, build the fundamentals first, then we
  can iterate fast on visuals and whatnot". The coordinator defines fundamentals as: the feature works end to end with correct
  data. Visual finish comes after, in fast rounds with the user on a device. Checks, verify, review and data correctness do not
  change. A feature still ships complete in the release, with nothing hidden. Section 15 names the point.

Answers of 2026-11-03, relayed by the coordinator; words in quotes are the user's:
- Q1, A: "Charged monthly, on day 15" + "Last charge 15.10.2026" (section 6).
- Q2: "1 + mark as recurring on transaction itself": detection, the reversible "Not a recurring charge", and a "Mark as
  recurring" action on the transaction (sections 8, 8.2, 9.6).
- Q3: "Settings row, in the same group as categories". The coordinator adds: the group card is Categories, Reminders,
  Transaction templates; not the row above Help (section 9.1).
- Q4, A: the demo seed changes so that five bills show: Netflix, Kyivstar, Kyivteploenergo, YASNO, Kyivvodokanal (section 12).

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
charge, and links to its past rows; a user control that hides a false match, visible and reversible; a "Mark as
recurring" control on a transaction, visible and reversible, for a series the rule misses; a Help topic; an empty state.

Out, not to be added: a next charge date, a due date, a reminder or notification, a projected amount, a
monthly or yearly total, any sum across a series, a budget, any new network call. A mark changes none of that: it names a
period for past rows and predicts nothing.

Open run-log gaps: none covers this work. This track closes none and leaves all open; nearest, left open:
`20261015T1657-kiko-binance-backfill-fix/2` (no mechanized index check; this track adds no index).

## 3. Binding: name grouping

"These names are one merchant" is `merchantNameOf` in `src/transactions/merchant-name/merchant-name.ts`,
defined by `1.4-category-automation` (its spec, section 4). This track imports it and never writes a second
definition, a copy or a wrapper with other rules. `key` is the group identity; a blank key never groups.

**Which set.** Checked in its plan at branch tip 71de98891 (the plan's text last changed at c2ec70313); the set numbering
did not change: `1.4-category-automation task 2/6: prefix offer in Apply` creates `merchant-name.ts`, with
`merchantNameOf`, `merchantSpellingOf`, `tidiedNameOf` and `smallestSpelling`. On that tip that track holds code commits of
its task 1/6 only; `src/transactions/merchant-name/` does not exist in its tree. The function's shape is still its spec's
section 4, `{ key, prefix }`, and `normalizeTransactionName` is unchanged, so the stored key's definition has not moved.

**This track also uses** `merchantSpellingOf` and `smallestSpelling` for the shown name: one spelling per series,
order-free, "ATB" for `ATB 0212` and `ATB 0340`. Those two names are in that plan's interface, not in its spec
section 4: re-grep them. `mostUsedSpelling`, which an earlier tip of that plan held, is gone. That plan says of the
prefix spelling "used for nothing else" and marks `merchantSpellingOf` as `nameStartsWith` text only. This track is
a second reader of the same function, so its task 1/4 widens that one comment; no rule changes. `key` alone still
decides the group.

**Order, and what moves it.**
- `1.4-recurring task 1/4` needs that set merged into `next`. Its plan stacks its tasks (`S16`), so task 2/6's
  base is task 1/6's tip, and in practice `next` receives the back-fill and the Travel migrations first. This
  track needs nothing else from task 1/6, but it cannot avoid it unless the coordinator reorders.
- If task 2/6 moves later or renumbers, this track's order stays and task 1/4 waits for it.
- If the user's rulings on that spec drop B3: the function has no first caller there. Then the function's
  own steps (its name-table and function steps, with its spec table) move to `1.4-recurring task 1/4`, which
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
| Archived account (`archivedAt`) | Out | Statistics filters on non-archived accounts, `accountsForFilter` (`implicit-account.ts:33`). The matchers above still read its rows |
| A row whose local day is later than today | Out, and not activity (section 7) | A manual row can hold a future date, and it must never show as a charge. Compared by local day, so a row later today stays: a sync at 10:05 or a date-only import at noon is not delayed |
| Holding not found | Out | As `ledgerRowsOf` `src/statistics/spending-ledger/spending-ledger.ts:104` |
| Closed holding | **In** | A closed card keeps its past spending (`shownRowsOf` `spending-ledger.ts:125`); this is what lets a series cross a card change |
| Pending (`hold`) | **In** | It shows in the ledger as a charge; the settled re-fetch refreshes the same row, `schema.ts:150-159`, so it never counts twice |
| Manual row | **In** | Rent typed by hand every month is a real series |
| Imported row | **In**, with its twin folded | Below |

**One eligibility definition.** A new `recurringExcludedIds` in `src/recurring/eligibility/` only composes the
functions above. It holds no MCC, wording or marker of its own, except the structural fields in the table.
`1.4-tables task 1/7`, merged, moved the same union out of the Statistics screen into `src/statistics/spending-ledger/`.
This track does not touch Statistics. The set is not identical (no loan
rule, wider exchange rule), so the two compositions stay two lists of calls, and kiko-domain's
"Spending-exclusion pipeline" gains a line: a new exclusion rule is added to both. Each rule has its own world
in the plan's pins, so a dropped call fails a test. A mark never overrides this table: a marked series is built from these
same charges (section 8.2).

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

Every row above is detection alone, with no mark stored; each stands unchanged. An `FS accepted` row stays a miss of the rule. A
mark closes each of them but the name holding a month: under the assumed Q5 each month is its own key, so a mark there links that
one row and next month's row stays out (sections 8.2 and 16).

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

**A marked series** uses the same table for the period the user picked only when its charges fit that period. The test is section
5.2's, on **all the series' charges** after the twin fold, oldest first, with the marked period's row of section 5.1: the minimum
count, `fits / pairs >= 0.75` and `charges / (1 + sum of slots) >= 0.75`. The amount test is dropped, as in section 5.3's steps 2 and
6, since a mark joins amounts on purpose. All charges, not the table's last 3: the line is a claim about the series.

When they fit and the table gives a day, weekday or date, the series reads as any other: "Charged monthly, on day 15". Otherwise,
when they do not fit or the table gives no slot, the line says only what the user said, which no row can contradict: "Marked:
monthly". So one charge, two charges, or a marked shop on random days read "Marked: monthly". 12 Jan, Apr, Jul marked monthly reads
"Marked: monthly": each pair fits at 3 slots, but `3 / 7` is under 0.75. 20 Dec 2025 and 15 Jan 2026 marked yearly reads "Marked:
yearly": the pair is 0 slots. Twelve monthly charges marked yearly read the same.

"Marked: every 3 months" and "Marked: every 6 months" always read so. Section 5.1 has no row for those periods, so section 5.2's rule
cannot run on them, and section 6's table has no line for them, so no test is needed. The last-charge line below carries the fact, as
everywhere. The word "Marked" appears only where the charges do not fit the period, the table gives no slot, or the period has no table row. It holds no date, so
section 7's property pin is untouched.

## 7. Stopped

A pure read of time since the last charge, stepping **back** from `now`, never forward from the charge:

| Period | Stopped when the last charge is older than |
|---|---|
| Weekly | 14 + 3 days back from today |
| Monthly | 1 calendar month + 7 days back |
| Every 3 months (a mark only) | 3 calendar months + 14 days back |
| Every 6 months (a mark only) | 6 calendar months + 14 days back |
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
list with dead subscriptions. The rows stay on Home. Not a setting. A marked series does not leave: it is the user's stored
choice, and the list is where it is removed.

**The day rolls while the screen is open.** `now` comes from `useVisibleRefreshedNow`
(`src/design-system/use-visible-refreshed-now/`), so it refreshes when the screen becomes visible, not at midnight.
Accepted: every line is a dated fact and stays true overnight; only the section a series sits in can be one day
late, until the next return to the screen. A midnight timer is not added for that. Detection reads `now` only
through its local day, so the memo keys on that day (section 9.5): each return refreshes `now`, and the same day
re-runs nothing.

## 8. Removing a false match, adding a miss

### 8.1 Hide

**Hide**, on the series screen: "Not a recurring charge". It hides that **merchant key**, every
series under the name, because a false match is about the name ("ATB is no subscription"), and amount or day keys
drift with each new row. It writes nothing on a transaction.

It is visible and reversible: the list ends with a "Hidden" section naming each hidden merchant with "Show again",
even when it has no rows now. No confirm is needed: nothing is lost and the undo is on the screen it returns to.

**Store: one nullable JSON column on `settings`**, `recurringMerchantChoices: Record<key, Choice>`, where `Choice` is
`{ kind: 'hidden', name }` or, from task 4/4, `{ kind: 'marked', name, period }`. It holds both hides and marks, one entry per
key, as `reminderOfferDismissals` already is a JSON map (`schema.ts:560`; read-modify-write inside one `write()`, as
`recordReminderOfferDismissal`, `src/settings/settings.repo.ts:25`). Task 3/4 carries the one migration; task 4/4 adds a kind
and no migration.

**Keys are user text, so readers use a `Map`.** `reminderOfferDismissals` is keyed by `accounts.id`. This map is keyed by a merchant
name, and `normalizeTransactionName` only lowercases, so `constructor` and `__proto__` are real keys. On a plain object
`choices['constructor']` is a function, and assigning `__proto__` loses the entry. So nothing reads or assigns the plain object:
the one parser, `recurringMerchantChoicesOf`, returns a `ReadonlyMap<string, Choice>` from `Object.entries` of the stored value, and
a write stores `Object.fromEntries(map)`, which defines an own key where an assignment would not. A `Map` over `Object.hasOwn`: one
missed `hasOwn` is a silent wrong read, and a `Map` has no such read to miss. Worlds in section 8.2.

| Option | Weighed | Result |
|---|---|---|
| Nullable settings column, one map | One migration; a restore carries it by column; one row, no chunking; a key can hold only one choice | **Chosen** |
| Two settings columns, hidden and marked | Two migrations or one wider one, and a key could be in both, so every reader needs a precedence rule | Rejected |
| New table | Same older-build result as a column (optional key, as 0054), and adds a `DataSnapshot` key, a read, a delete and an insert in the restore | No gain |
| Reuse `settings.dismissedTips` (no migration; shipped builds already carry it) | Holds retired tip ids on real devices, so a role would be read from a prefix; a column named for tips would hold merchants; no shown name | Rejected: the role would be derived from shape |

**When `merchantNameOf` changes.** The stored key is that function's output. After a change, a stored key may match
nothing, and the series shows again; the user hides it again, and the old line stays in "Hidden" under its stored name
to clear. Or it may match more: the extra series is hidden, and "Hidden" names it, so it stays reversible. A mark follows the
same two cases: a key that matches nothing shows under "Marked, No Charges" to remove; a key that matches more links the extra
rows, in the open, on the series screen. No migration rewrites keys. Failure is visible and undoable, never a wrong amount. A
pin in this track lists sample names against their keys, so an edit of the function shows this consequence to its author.

### 8.2 Mark as recurring

The user's words: "1 + mark as recurring on transaction itself". Code facts below are at 5256bf465. A mark is one settings entry.
It writes nothing on a transaction, and it predicts nothing.

| Point | Answer | The code fact it rests on |
|---|---|---|
| What a mark covers | **Assumed, Q5.** The merchant key of the row's stored description: every charge under that key, past and later, one series per currency. No day or amount test | The series group is `[key, currency]` (section 4), and `merchantNameOf` cuts only a trailing number (spec of `1.4-category-automation`, section 4), so a name holding the month gives one row per key and a mark links that row alone. A row has no stable series id to store other than the key |
| Period | A picker: weekly, monthly, every 3 months, every 6 months, yearly. The last two are a mark's own and detection never returns them | Section 5.1 names both as false misses. They touch only the stopped cutoff (section 7) and the text (section 6). `addMonths` (`interest.ts:41`) already steps any count of months |
| A mark on a merchant detection also finds | The mark wins: the user's period, and one series per currency from all its charges, so two amount-split Apple series merge while marked. Removing the mark leaves no entry, so the series return as detection finds them. A hide the mark replaced does not come back: hidden, then marked, then removed shows the detected series with no "Hidden" line, and the user hides it again | One map, one entry per key (section 8). Detection stores nothing (section 11), so nothing is lost. The form cannot tell which series a row is in without running detection, and it reads no detection result, so the result must not depend on that |
| Text | Section 6, "A marked series". Stopped and quiet as any series, on section 7's table. "Marked" shows only where the charges do not fit the period, the table gives no slot, or the period has no table row | `recurrenceLine` is a pure `.exhaustive()` match (plan), so `Recurrence` gains one kind |
| Mark and hide together | One map, one entry per key, so last action wins by construction. Marking a hidden merchant replaces the hide, and the "Hidden" line leaves. A marked series offers "Remove mark" in place of "Not a recurring charge"; after that, a detected series offers hide again | Section 8's store. `recordReminderOfferDismissal` shows the read-modify-write inside one `write()` |
| Reversal | "Remove mark" on the series screen, on the "Marked, No Charges" row, and "Not marked" in the form's picker. These clear only a `marked` entry, and "Show again" only a `hidden` one: one repo function, `clearRecurringMerchantChoice(key, kind)`, which compares the kind inside its `write()` and writes nothing when the entry holds the other kind or is absent. So "Not marked" on a hidden key, whose field reads "Not marked", keeps the hide. A removed mark goes nowhere, and a new mark on any row restores it | As `selectLoanPayment`, where picking "None" on the field is the removal (`transaction-form.screen.tsx:966`). `SelectField` fires `onSelect` on the row already selected (`handleSelect`, `select-field.component.tsx:57-62,120`), so that tap does reach the handler |
| Which rows offer it | A row passes `isRecurringCandidate` plus the per-row matchers, and has no funding caption: an existing, debit, non-blank key, bank or cash account, not archived, not a later local day, no `setsBalance`, `changeGroupId`, exchange marker or `loanHoldingId`, not an MCC or wording transfer. A matched own transfer is the one rule the form cannot see, so **a mark never overrides an exclusion either**: the marked series is built from section 4's charges, and a mark whose rows are all excluded shows under "Marked, No Charges" with a text that fits every reason. **Accepted:** until the form's ledger read lands, a funded debit has no caption yet, so the field shows and then goes. A tap in that gap is safe: the mark overrides nothing, so the funded row stays out. If every row under the key is excluded, it shows under "Marked, No Charges" and is removed there; with other eligible rows, it is a marked series of those rows, removed on its screen | `useExchangeFundingCaption` returns only the caption key and drops the ledger read's `isLoading`, so it has no settled state. Gating would change its return type, its suite and its caller, not one line. `isMccExcludedTransfer` (`transfer-exclusion.ts:31`) and `isDescriptionExcludedTransfer` (`:85`) read one row. `internalTransferTransactionIds` (`internal-transfers.ts:168`) pairs across the ledger. `useExchangeFundingCaption` already answers the funded case for this row, by section 4's own `excludedIds`, so a hand-category debit has no caption and is offered, as section 4 counts it |
| A bank-owned row | The field works there and is never `disabled` | `isReadOnly` keys off `existing.source` (`transaction-form.screen.tsx:429`), and only bank-owned fields lock. The category, the loan link and Convert stay live on a synced row (`mode-and-actions.component.tsx`). `selectLoanPayment` writes at once with no source gate |
| The two form paths | One answer: both pass `transactionId`, so both are the same edit state. Home, Holding Detail and a series link differ in no flag. No non-test code under `src/screens/statistics` opens the form: the Statistics stack registers it for the form a transaction tapped in its Home opens, so that stack reaches it through Home | `readRouteEntry` (`transaction-form.screen.tsx:267`) gives `editingId`, and `existing` is the edit concept only (`:285`). The form is one component in four stacks (`home.stack.tsx:58`, `accounts.stack.tsx:96`, `statistics.stack.tsx:60`, `settings.stack.tsx:121`). Create, duplicate and template entries have `existing === undefined`, so they never show it. A series link returns to a screen whose series may have changed: section 9.3 |
| Unsaved edits | The mark reads the stored description, never the draft, and writes at once. It does not touch Save or the draft | `selectLoanPayment` does the same, with `existing.id`; the funding caption reads "the stored row, not the draft" (`transaction-form.screen.tsx:450-452`) |
| Store | Section 8: one column, one migration in task 3/4. Section 11's table has the new rows. `EXPORT_VERSION` stays 5 | `envelope.ts:13`; `settingsRowsToInsert` (`restore-snapshot.ts:978`) carries a column as it is |
| Surface | A field, not a button or a new sheet: `RecurringMarkField` in `transaction-form/recurring-mark-field/`, one element in the screen between `ModeAndActions` and `CommentRow` (section 9.6) | `SelectField` is the shared control; `LoanPaymentField` is the same kind of immediate per-row choice. `CategoryOverrideSheet` is on this base at `:1604`, and `1.4-category-automation task 2/6` edits that sheet, its hook and their wiring, not the field list. Its tip 71de98891 has not started that set |
| Detection's input | **Unchanged.** The marked pass runs after the rule on the same charges | Section 9.5; so section 10.2's reference needs no re-run |

Worlds. `was` is the result before these answers, when a mark was out: the result with no entry, or with the hide alone in the two hidden rows, and "not reachable" where the path needs a mark.

| World | was | now |
|---|---|---|
| Quarterly, 4 charges, marked every 3 months | none | one series x4, "Marked: every 3 months" |
| Half-yearly, 3 charges, marked every 6 months | none | one series x3, "Marked: every 6 months" |
| One charge, marked monthly | none | one series x1, "Marked: monthly", last charge its date |
| Two charges, marked monthly | none | one series x2, "Marked: monthly" |
| Three charges on day 15, marked monthly | monthly, "on day 15" | the same text, marked |
| Two charges on 12 Mar, marked yearly | yearly, "on 12.03" | the same text, marked |
| One charge, marked yearly | none | one series x1, "Marked: yearly" |
| Daily shop, marked monthly | none | one series of all its rows, "Marked: monthly" |
| Apple 99 and 399, both detected, then marked monthly | two monthly | one series, all charges; remove the mark and two monthly return |
| Detected monthly, marked yearly | monthly | one yearly series, "Marked: yearly", stopped by the yearly cutoff |
| Quarterly, 12 Jan, Apr, Jul, marked monthly | none | one series x3, "Marked: monthly", stopped and quiet |
| 20 Dec 2025 and 15 Jan 2026, marked yearly | none | one series x2, "Marked: yearly" |
| Monthly with one skipped month, marked monthly | monthly, "on day 15" | one series x3, "on day 15", marked |
| Monthly fit with no honest day, 1 Aug, 5 Sep, 9 Oct, marked monthly | monthly, "Charged monthly" | one series x3, "Marked: monthly": the charges fit and the table gives no slot (section 6) |
| Four Mondays, marked weekly | none | one series x4, "Marked: weekly": section 5.1's weekly minimum is 5 |
| Five Mondays, marked weekly | weekly, "on Mondays" | one series x5, "on Mondays", marked |
| One key in UAH and USD, marked | none | two series, never summed |
| Name holding a month, one row marked | none | one series x1 for that one name; next month's name is its own key (Q5) |
| Marked, then its twin imported | none | the twin folds, each charge counted once |
| Marked, with a future-dated manual row | none | left out; no output day after today |
| Marked, last charge 30 months ago, the holding's only row | none | one series, stopped and quiet, and it stays |
| Marked, stale holding | monthly x4, stopped and quiet | stopped and quiet, as section 7 |
| Marked, 3 Sep and 3 Jun of six monthly rows linked to a loan | none: the four left give `4 / 6` | those rows are left out, the others link |
| Marked, its only row a matched own transfer | none | "Marked, No Charges" |
| Marked, each alone: rows only on an archived account, on a missing holding, only a future row, only credits | none | "Marked, No Charges" |
| Marked, all rows deleted | none | "Marked, No Charges" |
| Hidden, then marked | hidden | marked; no "Hidden" line |
| Marked, then removed, then hidden | hidden | hidden; one entry at every point |
| Series screen open by link, mark set in the form, Back | not reachable | that key's marked series |
| Series screen open by link to a marked series, mark removed in the form, Back | not reachable | the one detected series under the same key, currency and period; else the neutral text |
| A merchant named `constructor`, with no choice | monthly | monthly: no choice is read, and the field reads "Not marked" |
| A merchant named `__proto__`, one charge, marked, then reloaded | none | one marked series; the entry survives the write and the read |

Results the review of 35861c22b changed. `was` is that draft.

| World | was | now |
|---|---|---|
| Quarterly, 12 Jan, Apr, Jul, marked monthly | "Charged monthly, on day 12" | "Marked: monthly" |
| 20 Dec 2025 and 15 Jan 2026, marked yearly | "Charged yearly, on 15.01" | "Marked: yearly" |
| Twelve monthly charges, marked yearly | no line pinned, so "Charged yearly, on 03.10" | "Marked: yearly" |
| Hidden, then "Not marked" tapped in the form | the hide dropped, no notice | still hidden, nothing written |
| Hidden, then marked, then removed | "the detected series back unchanged", read as the hide returning | no entry: the detected series show, no "Hidden" line |
| Merged Apple 99 and 399 marked monthly, opened by link, removed in the form, Back | whichever detected series holds the earliest charge | the neutral text: two monthly series, never a guess |
| Marked yearly over a detected monthly, opened by link, removed in the form, Back | the monthly series, ignoring the period | the neutral text: no yearly series |
| Marked monthly over one detected monthly, opened by link, removed in the form, Back | that series | that series, by the fallback |
| Marked, last charge 30 months ago, the holding's only row | stopped, not quiet | stopped and quiet since that row |

## 9. Screens, entry and links

### 9.1 Entry: a Settings row, in the group card

| Place | For | Against |
|---|---|---|
| **Settings row** | Always rendered, so a reviewer on a clean install sees it (2.5.19). One stack; `TransactionForm` is already registered there (`settings.stack.tsx`). A pushed page lands in the detail pane | A tap deeper than Statistics |
| Statistics | Spending is its subject | **Fails 2.5.19 as a clean-install entry:** with no accounts Statistics returns only `EmptyState` (`hasNoAccounts`, `statistics.screen.tsx:552`). Its account and range filters do not apply here. Statistics is mounted in two stacks (Home's companion default, its own root), so both need the routes, and `1.4-tables` adds its button there |
| Home | Most seen | Filters are local state, `Home` takes no params; FAB and filter bar crowd it; nothing there is a list of lists |
| Settings > Categories | | A spending fact is not a category setting; `1.4-category-automation` already adds its card there |

**The user's words: "Settings row, in the same group as categories".** A fourth row in the existing card
`settings-card-categories-reminders-templates` (`settings.screen.tsx:222-253`), last in it, after Transaction templates:
testID `settings-row-recurring-charges`, a divider `settings-divider-templates-recurring-charges`, `groupedRowStyle` and
`groupedDividerStyle`, `selected={isShown('RecurringCharges')}`. Last, so the three rows `1.4-small` set keep their order.

was: its own `Card`, `settings-card-recurring-charges`, above `settings-card-help`, six cards in the order pins. now: no new
card and no new testID for a card.

Pins, read on the merged `settings.screen.test.tsx`:

| Pin | Effect |
|---|---|
| The two exact five-card orders (anchors `const cardOrder`, and `puts the categories-reminders-templates card straight after`) | Unchanged: still five cards. The card keeps its testID, which also names the row list; a rename would edit 8 sites for no user gain |
| `groups Categories, Reminders and Transaction templates into one card, in that order` | Its testID regex lists the rows and dividers by name, so it would stay green and miss the new row: widen the regex and the expected order, and the title, in one step |
| `styles the Categories-Reminders-Templates card like the Import/Export card` | The new row and divider join its two lists |
| `SettingsScreen — the selected row`, table `ROWS` | One new line: `RecurringCharges`, `GROUP_CARD`, the row, `false` (the row is marked, not the card) |

Icon `entrySymbol.recurringCharges` = `repeat`
(SF Symbols 1, so it exists on iOS 18.2; the developer checks it against kiko-design-system's "SF Symbol
availability"). No condition on the row, no count on it.

### 9.2 List: `RecurringCharges`

`src/screens/settings/recurring-charges/`. A `FlatList` with `LargeTitleHeading` and `useLargeTitleScroll`
(kiko-design-system, custom list screen). Sections: active, "No recent charge", "Marked, No Charges", "Hidden". Order inside a
section: newest last charge, then key, then series id; the last two have no charge, so key order. Never by amount: a section can
mix currencies. A marked series with charges sits in active or "No recent charge" like any other. A key with a choice lists its
choice and never its detected series.

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

**With marks (task 4/4), the route gains an optional `isMarked`, absent reading as false, and the lookup order is:** a marked key's series for the route's key and
currency, one by construction; then, only on a route opened on a detected series (`isMarked` false), `seriesId` among the detected
series; then the fallback above; then the neutral text. The marked check comes first since a detected series stays in the unfiltered
list under a marked key, so an old link would show it. The `seriesId` step is skipped on a route opened on a marked series, since that
id is the earliest charge of the whole key: it lands on whichever detected series holds that charge, ignoring the period, which would
be a guess. Remove mark on this screen holds
the last resolved series until `goBack`, since that write takes the marked series away; a pin, as the hide's.

**The button by kind:** a detected series offers "Not a recurring charge", a marked one "Remove mark". Both close back to the list.

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

Marks keep that: task 4/4 splits `detectRecurringSeries` into `chargeGroupsOf` and `seriesOfGroups`, with the same input, output
and rule, and the first memo keeps the groups. A second memo, on groups, the marked entries and the local day, runs
`markedSeriesOf`, a walk of the marked keys' groups only. A mark, like a hide, fires `settings` alone, so it runs no detection and
no ledger read. Those two are the pins; the walk's reach over the marked keys alone has none.

### 9.6 The mark field on the transaction form

`RecurringMarkField`, in `src/screens/forms/transaction-form/recurring-mark-field/`, renders `SelectField` with a "Not marked"
option and the five periods. Label "Mark as recurring"; sheet title "Mark as Recurring". A pick writes at once; a rejected write
shows the save alert through `alertOnCatch`, as `selectLoanPayment`'s does (`transaction-form.screen.tsx:953`). The current period shows as its value on the field. No new shared
component, theme tokens only, so no `kiko:designer` step. The device check confirms the look.

It is one element in `transaction-form.screen.tsx`, between `ModeAndActions` and `CommentRow` (`:1562-1586`), so the screen's
cognitive budget and `ModeAndActions`' props do not grow, and `converting` gates it at the call site. The child holds its own
read, `settingsRepo.recurringMerchantChoicesQuery()` on `['settings']`, enabled only for a row it offers on. So it adds no ledger
read: the form's existing whole-ledger read is `useExchangeFundingCaption`'s (`:452`, `use-exchange-funding-caption.ts:87`),
and its caption key is passed in. The form reads no settings today, and `transaction-form.screen.test.tsx` mocks each repo it
uses (`jest.mock` block from `@kiko/transactions/repo`) with a fallback of `[]` per table (`:271`), so the suites that open a
stored debit need one added repo mock (the plan's list; the developer measures).

**Merge with `1.4-category-automation`:** its task 2/6 edits `use-category-override.ts`, the sheet, and their props in the screen
at `CategoryOverrideSheet`. This set adds one import and one element above `CommentRow`, and its keys in the catalogues. No shared
line is expected; re-check at the merge, on whichever lands second.

## 10. Cost

### 10.1 The read cannot be narrowed by rows

The matched-pair matcher needs credits, and the funding matcher needs crypto rows and blank rows, so the read is the whole
ledger with narrow columns. A partial index therefore does not help: the query has no predicate for it to serve. No index
and no migration for the read.

Prior shape: the category-automation spec, section 3.2.3, measured a narrow table at 100,000 rows. This one uses the real
column set. Statistics already reads every row and every column on a live query (`listAllQuery`,
`use-statistics-sources.ts:89`), so a whole-ledger read is no new class of cost, and this one runs only while its screen shows.

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
`merchantNameOf` cuts a trailing number of two or more digits and folds "Silpo 10" to "Silpo 100" into one busy key. Task 1/4
step 5 of the plan reports what the real detection finds on `rules-performance-fixture`, the same word list and ratio; that is a
first reading of such rows with names, not a proof about these extras.

**Marks do not change this measurement.** The reference reads the same input through the same rule (section 9.5), so it is not
re-run. The marked pass is outside it; its pin, in task 4/4, is section 9.5's: a mark runs no detection and no ledger read.

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

Only the choice map is stored, hides and marks in one column. Detection stores nothing: no series table, nothing on a row.
Deleting or restoring rows just gives a new detection.

The migration number is not assigned; merge order decides (`1.4-category-automation` adds two migrations of its own).
`ALTER TABLE settings ADD recurring_merchant_choices text`, in task 3/4, and no migration in task 4/4. An earlier draft named the
column `recurring_hidden_merchants`; no build holds it.

| Path | Result | Evidence |
|---|---|---|
| v1.1.0 restores a 1.4 file | Refused whole by version, as every version 3+ file already is | `git show v1.1.0:src/data-transfer/crypto/envelope.ts`: `EXPORT_VERSION = 2`, reads 1-2 |
| v1.2.0 restores a 1.4 file | Refused whole by version, as every version 4+ file already is | same path at `v1.2.0`: `= 3`, reads 1-3 |
| `release-1.3` tip 918683db3 restores a 1.4 file | Restored; drops the key. 1.3 has no such screen, so neither a hide nor a mark has any effect there. No row differs | same path: `= 5`, reads 1-5; `VERSION_DECISIONS` notes for 0055 and 0060 state the drop |
| 1.3 file, or an in-place update from 1.3, into 1.4 | The key is absent, default NULL, no choice | as `restore-dismissed-tips.test.ts`; pin |
| 1.4 file into 1.4 | The map comes back from the file, hides and marks with their periods. It is the user's choice, not this device's, so not `KEPT_FROM_LIVE_ON_RESTORE` | `kept-from-live-on-restore.ts`; `settingsRowsToInsert` `restore-snapshot.ts:978-981` |
| 1.4, into 1.3, re-exported, into 1.4 | The map is lost; a false match shows again and a marked series leaves; the user hides or marks again. No row changed | |
| A marked key's rows absent after a restore | The entry stays and shows under "Marked, No Charges"; never an error | section 8.2 |

**`EXPORT_VERSION` stays 5.** A bump would make 1.3 refuse every 1.4 file over a map that is safely inert. The note goes in
`VERSION_DECISIONS` (`src/data-transfer/crypto/envelope.test.ts:99`) with `migrationCount` plus one. The `settings` shape check
reads no column, so a malformed value in a file is read defensively: a non-object reads as no choice, and an entry with an unknown
kind, an unknown period or a non-string name is dropped alone (pin).

No owed state: NULL means no choice and no one-time step runs. Suites whose database stops below the new migration
still fail by `no such column` when read through today's schema; the plan lists them.

## 12. Compliance

- No new network call, domain, SDK, permission or required-reason API. App Privacy stays "Data Not Collected"; the policy is
  unchanged.
- A merchant name in the choice map is a local value in the encrypted database and the encrypted `.kiko`. No name or IBAN is
  logged: a failure log is fixed text. `counterIban` is read only as the exclusion function reads it, never shown here.
- Guideline 2.5.19: no flag, no condition on the entry; a clean install shows the row and an empty state that says what the
  screen does. No demo or seed import from `src/`. Notes for Review name the feature and that it needs repeated rows, so a
  reviewer without data knows what the empty state means (2.3.1(a)). The mark field depends only on the row, so any plain debit in
  the demo file reaches it, and no stored mark is seeded.
- The reviewer's demo file reaches the feature (kiko-compliance, "the demo dataset must reach every feature"). `next` rebuilt the
  demo set. **Ruling Q4: five bills show.** Re-read at 5256bf465: `e2e/screenshot/seed/` and `build-demo-snapshot.ts` are
  unchanged since c9896e1f9, and a re-run of the reference gives the same figures below. A reference run on the merged `buildScreenshotDataset`, anchor 2026-11-03 09:00 UTC, finds 24 monthly x6 series in both
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
| `recurringCharges.emptyMessage` | Kiko looks through your transactions for charges that repeat, such as subscriptions and rent, and shows the ones that already happened. A monthly charge appears after its third payment; importing a statement can bring in earlier ones. Task 4/4 adds: You can also open a transaction and mark it as recurring. | Кіко шукає у ваших транзакціях платежі, що повторюються, як-от підписки й оренда, і показує ті, що вже відбулися. Щомісячний платіж зʼявиться після третього списання, а імпорт виписки може додати попередні. Task 4/4 adds: Також можна відкрити транзакцію й позначити її як регулярну. |
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
| `recurringCharges.marked.weekly` (task 4/4) | Marked: weekly | Позначено: щотижня |
| `recurringCharges.marked.monthly` | Marked: monthly | Позначено: щомісяця |
| `recurringCharges.marked.everyThreeMonths` | Marked: every 3 months | Позначено: раз на 3 місяці |
| `recurringCharges.marked.everySixMonths` | Marked: every 6 months | Позначено: раз на 6 місяців |
| `recurringCharges.marked.yearly` | Marked: yearly | Позначено: щороку |
| `recurringCharges.removeMark` | Remove mark | Зняти позначку |
| `recurringCharges.markedEmptyHeading` | Marked, No Charges | Позначені, без списань |
| `recurringCharges.markedEmptyMessage` | No transactions count here now. Transfers, exchanges and loan payments are left out. | Зараз тут немає транзакцій, які враховуються. Перекази, обміни й платежі за кредитом не враховуються. |
| `forms.transaction.markRecurring` | Mark as recurring | Позначити як регулярний |
| `forms.transaction.markRecurringSheetTitle` | Mark as Recurring | Позначити як регулярний |
| `forms.transaction.notMarkedRecurring` | Not marked | Не позначено |
| `forms.transaction.recurringPeriod.weekly` ... `.yearly` | Weekly, Monthly, Every 3 months, Every 6 months, Yearly | Щотижня, Щомісяця, Раз на 3 місяці, Раз на 6 місяців, Щороку |

`recurringCharges.title` and the section headings join `title-keys.ts`. Removed or renamed keys: none; no key here has shipped.
A sheet title and a field label are two keys, per kiko-translator's casing by role, though uk reads the same.

The uk recurrence lines are a past frame, since «Списання щомісяця, 15 числа» has no tense and reads as a schedule, which defeats
the reason for ruling Q1. They are drafts: `kiko-translator` rules decide them in the step that adds them. `{{holding}}:` opens its line so uk needs
no case form of a stored name.

## 14. Help and What's New

Help topic `viewRecurringCharges` in `src/help/help-topics.ts`, action `openRecurringCharges` (`HelpAction`, `help-topic.screen.tsx`), a
`TOPIC_TITLES` row with the uk noun form «Перегляд регулярних платежів». Steps, each shipping with the set that adds what it names:
1. (task 1/4) Open the "Settings" tab and tap "Recurring charges".
2. (task 1/4) Kiko finds charges that repeat in your transactions and shows the day they were charged and the last charge. It shows only what already happened, never a future charge.
3. (task 2/4) Tap a charge to see each of its past transactions, then tap one to open it.
4. (task 3/4) If a name doesn't really repeat, tap "Not a recurring charge". You can bring it back from "Hidden" at the end of the list.
5. (task 4/4) If Kiko missed one, open one of its transactions and choose how often it's charged under "Mark as recurring". You can remove the mark from the same field or from the charge.

What's New draft, per the release skill's format: "Recurring charges: see what repeats in your transactions and every past charge, and mark one Kiko missed." uk: "Регулярні платежі: дивіться, що повторюється у ваших транзакціях, і кожне минуле списання, а також позначайте те, що Кіко пропустив." Not committed: it lives in App Store Connect.

## 15. Binding constraints, order

| Constraint | Enforced by |
|---|---|
| No future date, no forecast, no total | A property pin: no date in the output has a local day later than today; the output type has no sum; stopped steps back only; review |
| One name definition | Import from `@kiko/transactions/merchant-name`; review. No local normalizing |
| One eligibility definition | `recurringExcludedIds` only calls the existing functions; one world per rule |
| Never sums across currencies | The group key holds the currency; no sum exists anywhere |
| Detection writes nothing | Pure function and a read-only query; only `hideRecurringMerchant`, `markRecurringMerchant` and `clearRecurringMerchantChoice` write, and only to `settings` |
| A mark overrides no exclusion | `markedSeriesOf` reads the same charge groups as detection; a world per kind |
| A mark predicts nothing | The marked series has the output type of any series: past dates and the period's text; the property pin covers marked worlds |
| A new exchange's rows stay out | The account kind allow-list; a crypto-account world |
| 2.5.19 | No condition on the row; a screen pin with no data |
| An older build damages nothing | Section 11, with a restore pin and a file-without-key pin |
| Purpose | No balance, net worth, category or statistic reads this; it changes none of them |

Sets, each merging into `next` alone. Counts are floors, tests included.

1. **1.4-recurring task 1/4: detection and the list.** Goal: the Settings row, the list, the empty state, the recurrence text and stopped section, and a reviewer's demo file that shows the real bills as series and no shop. Rows do not open yet. Needs `1.4-category-automation task 2/6`. Floor 46 files.
2. **1.4-recurring task 2/4: the series screen and its links.** Goal: every past charge, each opening its form, on phone and two panes. Needs task 1/4. Floor 18 files.
3. **1.4-recurring task 3/4: hide a false match.** Goal: the control, "Hidden", the choice column and its restore paths. Needs task 2/4. The one migration of this track. Q5 is answered before it starts. Floor 34 files plus the generated `.sql` and snapshot.
4. **1.4-recurring task 4/4: mark as recurring.** Goal: the field on the transaction form, the marked series, "Remove mark", "Marked, No Charges". Needs task 3/4, for its store and the series screen's button. No migration. Floor 38 files, 11 of them mutable.

**One release.** The four sets merge into `next` one at a time and `next` tolerates each middle state: every visible text ships with what it names (section 14), and no middle state writes anything but its own column. A release holds all four or none: tasks 1/4 and 2/4 alone have no hide, the remedy for the accepted yearly false match, and the user asked for the mark with the rest.

**Fundamentals done: the tip of task 4/4.** It is the required device call for this feature, under the ruling at the top. Detection, the reversible hide and the mark are all in the user's Q2 answer, and a false match has no removal before task 3/4. No set is visual-only: apart from review, drift and Ready steps, every step holds behavior, correct data or text the feature needs, so none moved. The device items of tasks 1/4 to 3/4 wait for that call, and visual finish follows it in fast rounds. **An optional look before the point, not the point:** at task 2/4's tip, a release build on the user's real ledger shows detection on their history and gives section 10.3's numbers early. The coordinator decides whether to offer it, and task 3/4 does not wait for it.

Conflict surface: `settings.screen.tsx` and its group-card pins (one row and divider in the card `1.4-small` made), `transaction-form.screen.tsx` (task 4/4, one element; section 9.6), `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md` and the demo `.kiko` files (`1.4-category-automation task 2/6` edits them too, and adds rows under merchants this track's pin reads), `settings.stack.tsx` and `types.d.ts` (one added route each with `1.4-category-automation`), `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` (added lines), `schema.ts`, the migration files, `envelope.test.ts`, `settings-columns.test.ts` (task 3/4, by merge order). `1.4-light-scheme`: theme tokens and shared components only, so it applies by itself. `1.4-tables`: Statistics is not touched here. `1.4-bybit`: section 4, no edit.

## 16. User questions

Only decisions that change what gets built. Q1 to Q4 are answered: their answers head this spec. The misses Q2's choice named
stay misses of the rule, and a mark closes them all but the name holding a month, under the assumed Q5: a quarterly or
half-yearly charge; a monthly charge before its third payment; two subscriptions under one name at the same price on the same
day; a subscription under a name with many other purchases, when it has fewer than 6 charges, when its price changed, or when
most of those purchases cost exactly what it costs; a monthly charge that doubled on the same day in several months; a statement
row dated two or more days from its bank row.

**Q5. What does a mark cover?** The action sits on one transaction. The docs assume A; section 8.2 is written on it. It must be answered before task 3/4 starts, since C changes that set's column shape.
- A. Every charge with that merchant name, in each currency, past and later. A new charge joins by itself. A one-off purchase under the name links too, and it sets "Last charge" and its amount. So a cancelled subscription never reads stopped while purchases at that name continue. Two Apple series read as one while marked, and a clean detected Apple x12 "on day 5" turns into a mixed series that reads "Marked: monthly" once purchases at the name break the fit. "Оренда за жовтень" still links one row, since each month is its own name.
- B. That name at about that amount. The design is section 5.3 step 3's chain, not a distance from the marked row: amounts sort, a cut falls where the next exceeds the previous by more than 1.25, and the piece holding the marked amount is the series. So 100, 120, 144 stays together. Apple 99 stays apart from App Store purchases and from Apple 399, unless amounts in between bridge them. A single price rise over 25 percent drops later charges out, so a live subscription reads "No charge since", and the store gains an amount.
- C. Only rows marked one by one, each into a series the user picks. Closes "Оренда за жовтень" and links no stray row. Nothing joins by itself, so the user marks every charge every month, and the store gains a list of row ids plus a series picker on the form.

Recommendation: **A**. It behaves as the rest of the screen does, where a new charge just appears; B's false "No charge since" and C's monthly chore both cost more than a stray link and its last-charge line, which the user sees on the series screen and undoes by removing the mark. The user's words "on transaction itself" name where the action sits, and could also mean C, so it is a question.

**Period note, the planner's call, which the user can overrule.** The mark's picker keeps every 3 months and every 6 months, which detection never returns. Dropped, a quarterly charge must be marked monthly, and reads "Marked: monthly" plus a stopped line within weeks of each charge. Dropping them also drops plan S16's `DetectedPeriod`, section 7's two rows and their catalogue keys.

**Planner's calls, recorded, not questions.** None of these is a user ruling; the rulings are quoted at the top. Reasons in the sections named: the mark's five periods, with every 3 and every 6 months only there (8.2); a mark wins over detection (8.2); "Marked" text only where the charges do not fit the period, the table gives no slot, or the period has no table row (6); a marked series never leaves the list (7); one choice map for hides and marks (8); a field rather than a button, between `ModeAndActions` and `CommentRow` (9.6); the matched-transfer row is offered and left out, rather than a second ledger read on the form (8.2); the Settings row is last in its group (9.1); the three periods and their minimums (5.1); yearly from two charges, with an accepted false match (5.1, 5.4); a series crosses holdings, not currencies (4); pending and manual rows count, refunds neither count nor cancel (4); loan links out by marker (4); crypto and other non-cash accounts out by kind (4); two of the last three decides a moved day (6); numeric dates as everywhere in the app (6); the stale source read from rows, not `syncState` (7); stopped sinks and leaves at 24 months (7); no midnight timer (7); hide is per merchant key (8); a settings column rather than a table or `dismissedTips` (8); the last charge's amount shows beside its date (9.2); not `cached` (9.5); `EXPORT_VERSION` stays 5 (11).

**The orchestrator's calls after the spec review, recorded the same way, not user rulings:** a row is compared to today by local day, and a later local day is left out (4); the fold keeps the largest count of one source, and reaches one local day (4); a funded debit with a hand category stays in, as an accepted false match (4); quiet uses the stopped cutoff and dates from the holding's newest row (7); the quiet line names the holding (7); a stopped row shows its amount (9.2); the memo keys on the local day (9.5); a missed `seriesId` falls back to one matching series, else a neutral text (9.3); all four sets ship in one release (15); the uk past frame, which `kiko-translator` rules decide (13).

**Where the measured reference moved a call:** step 2's condition was called as "every pair fits". On that form a seasonal bill with one moved day went back to the reported fault (two stopped rows or one short stopped row, in 7 of 9 placements of the moved day). So it reads "passes as monthly, no two charges in a slot": all 9 give one series, and the sweep below 5.3 shows no new false match. Step 6 runs when nothing stands, not only when nothing was found. The fold, coverage exception and exact-cut calls hold as called.