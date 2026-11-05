# Recurring charges design (1.4)

Track: 1.4-recurring. Base: 5256bf465, a merge of `next` 6be32bfcb. Sections 8.2, 9.1 and 9.6 are read on this tip; the older
file:line cites come from c9896e1f9. Read from code; the app was not run. Every file:line below holds on its base only:
re-grep the named symbol on the actual base before building on it. Counts of files, cases and call sites are floors; the
developer measures.

Status: APPROVED by the user on 2026-11-03 ("Approve as planned"), with Q5 and Q6 answered. No design question stays open.
Revised after a review of 3dab56c68; section 5.4 shows what changed. Revised again after a review of 35861c22b, for Q5, and after
a review of 41be4a687 with Q6's answer; section 8.2 shows what changed. Section 10.2 holds the measurement; section 12 is re-read
on the merged demo seed.

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
- Q5: "Name + amount chain": 100, 120, 144 stay together, and the store gains an amount. The user saw the consequence: one rise
  over 25 percent drops later charges and shows a false "No charge since". That is the user's accepted behavior (section 8.2).
  **A second consequence, found by the planner and told to the user through the coordinator:** two subscriptions under one name
  within 25 percent of each other, or at one price, sit in one chain. m(10, 5, 99) + m(10, 20, 119), detected monthly x10 twice: a
  mark at 99 joins them (119/99 = 1.20) into one x20, "Marked: monthly", no pair fits, and both detected series leave. A mark at 119
  selects the same piece and only sets its period, so the two can never separate. The same holds at equal price.
- Q6: "One per chain", relayed by the coordinator: a key holds a list of marks, each its own chain (section 8.2).
- Approval: "Approve as planned". The mark offers weekly, monthly, every 3 months, every 6 months and yearly.

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
a second reader of the same function and edits nothing there: no such comment exists on this base, and
`merchant-name.ts` stays untouched; no rule changes. `key` alone still decides the group.

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
mark closes each of them, for the charges in its amount chain, but the name holding a month: each month is its own key, so a mark
there links that one row and next month's row stays out (section 8.2).

## 6. The recurrence date

Text states what the past charges show. It is written so it cannot read as a promise ("Charged monthly"), no output
date has a local day later than today, and no date is ever stepped forward into any output; the only forward step is a boolean test against the
leave bound (section 7).

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
5.2's, on **all the charges of its amount chain** (section 8.2) after the twin fold, oldest first, never on the name's other
charges, with the marked period's row of section 5.1: the minimum count, `fits / pairs >= 0.75` and
`charges / (1 + sum of slots) >= 0.75`. The amount test is dropped, as in section 5.3's steps 2 and 6, since the chain already chose
its amounts. All charges, not the table's last 3: the line is a claim about the series.

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

A pure read of time since the last charge, stepping **back** from `now`, never forward from the charge. For a marked series the
last charge is the last of its chain, so a purchase or a new price outside the chain does not move it (section 8.2):

| Period | Stopped when the last charge is older than |
|---|---|
| Weekly | 14 + 3 days back from today |
| Monthly | 1 calendar month + 7 days back |
| Every 3 months (a mark only) | 3 calendar months + 14 days back |
| Every 6 months (a mark only) | 6 calendar months + 14 days back |
| Yearly | 12 calendar months + 14 days back |

Text: "No charge since 03.08.2026". It reads the series' own rows, never the merchant. On a marked series, before a re-mark, it can
read false while the subscription goes on at a price outside the chain: the user's accepted behavior (section 8.2).

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
detected series under the name, because a false match is about the name ("ATB is no subscription"), and amount or day keys
drift with each new row. It writes nothing on a transaction.

It is visible and reversible: the list ends with a "Hidden" section naming each hidden merchant with "Show again",
even when it has no rows now. No confirm is needed: no row changes and the undo is on the screen it returns to. **A hide stays per
key and never touches a mark.** It affects detected series only: on a key that holds marks (a detected series beside a marked one,
section 8.2), every marked chain stays, and "Show again" clears only the hide, so nothing the user marked is lost.

**Store: one nullable JSON column on `settings`**, `recurringMerchantChoices: Record<key, RecurringMerchantChoice>`, where `RecurringMerchantChoice` is
`{ name, hidden: true }` and, from task 4/4, `{ name, hidden?: true, marks?: RecurringMark[] }`, and each mark is
`{ currency, amountMinorUnits, period }`. One entry per key holds both: a hide flag for the detected series under that key, and
`marks`. Each is read and cleared on its own, and an entry with neither drops. `name` is the last write's spelling. It is a JSON map
as `reminderOfferDismissals` already is (`schema.ts:560`; read-modify-write inside one `write()`, as
`recordReminderOfferDismissal`, `src/settings/settings.repo.ts:25`). Task 3/4 carries the one migration; task 4/4 adds the `marks`
field and its parser arm, and no migration or column.

**Task 3/4 holds no marks text or type, and its parser need not keep a `marks` value.** It reads `name` and `hidden` and drops the
rest. No `marks` value can reach it: the column is new, only task 4/4 writes the field, and no build ships before all four sets
(section 15). Its readers test `choice.hidden === true`, never `map.has(key)`, so task 4/4's marks-only entry reads as not hidden
with no edit there.

**Keys are user text, so readers use a `Map`.** `reminderOfferDismissals` is keyed by `accounts.id`. This map is keyed by a merchant
name, and `normalizeTransactionName` only lowercases, so `constructor` and `__proto__` are real keys. On a plain object
`choices['constructor']` is a function, and assigning `__proto__` loses the entry. So nothing reads or assigns the plain object:
the one parser, `recurringMerchantChoicesOf`, returns a `ReadonlyMap<string, RecurringMerchantChoice>` from `Object.entries` of the stored value, and
a write stores `Object.fromEntries(map)`, which defines an own key where an assignment would not. A `Map` over `Object.hasOwn`: one
missed `hasOwn` is a silent wrong read, and a `Map` has no such read to miss. Worlds: the plan's "Marked flows".

| Option | Weighed | Result |
|---|---|---|
| Nullable settings column, one map | One migration; a restore carries it by column; one row, no chunking; one entry per key holds a hide flag and marks, each read and cleared on its own | **Chosen** |
| Two settings columns, hidden and marked | Two migrations or one wider one, for the two fields one entry holds, with the name stored twice | Rejected |
| New table | Same older-build result as a column (optional key, as 0054), and adds a `DataSnapshot` key, a read, a delete and an insert in the restore | No gain |
| Reuse `settings.dismissedTips` (no migration; shipped builds already carry it) | Holds retired tip ids on real devices, so a role would be read from a prefix; a column named for tips would hold merchants; no shown name | Rejected: the role would be derived from shape |

**When `merchantNameOf` changes.** The stored key is that function's output. After a change, a stored key may match
nothing, and the series shows again; the user hides it again, and the old line stays in "Hidden" under its stored name
to clear. Or it may match more: the extra series is hidden, and "Hidden" names it, so it stays reversible. A mark follows the
same two cases: a key that matches nothing shows under "Marked, No Charges" to remove; a key that matches more links the extra
rows in the mark's chain, in the open, on the series screen. No migration rewrites keys. Failure is visible and undoable, never a wrong amount. A
pin in this track lists sample names against their keys, so an edit of the function shows this consequence to its author.

### 8.2 Mark as recurring

The user's words: "1 + mark as recurring on transaction itself". Code facts below are at 5256bf465. A mark is one settings entry.
It writes nothing on a transaction, and it predicts nothing.

| Point | Answer | The code fact it rests on |
|---|---|---|
| What a mark covers | **The user's answer to Q5.** The merchant key of the row's stored description, the holding's currency, and section 5.3 step 3's amount chain holding the stored amount. No day test. Past and later charges in the chain join by themselves; a charge outside it does not. Section 6's fit test, the last charge and section 7's stopped read only the chain | The series group is `[key, currency]` (section 4), and `merchantNameOf` cuts only a trailing number (spec of `1.4-category-automation`, section 4), so a name holding the month gives one row per key and a mark links that row alone |
| Which chain a stored amount selects | Inside one `[key, currency]` group: take the magnitudes of the group's charges after the twin fold, add every stored amount of that key and currency as one more amount, sort, and cut where the next exceeds the previous by more than 1.25, with step 3's own function. **Each piece holding a stored amount is a marked chain.** Its charges are the series. So there is no nearest and no tie: one amount is in exactly one piece, and pieces share no row. While a charge at the stored amount exists, this is simply the chain holding that charge. A stored amount sits in the cut like a charge, with or without its row, so it can bridge. A stored amount alone in its piece selects nothing: "Marked, No Charges". The cut reads a multiset, so no output depends on row order, and a new row between two others re-forms the chain by the data alone: 100, 115, 130 is one chain, and removing an unmarked 115 splits it again. Where the 115 is the marked row, its stored amount stays: 99 and 130 with a stored 115 whose row was deleted stay one series until the mark is removed, and 80, 120, 500 with a stored 100 whose row was edited to 500 read one x2 over 80 and 120 | Step 3 sorts and cuts, and adds nothing else (section 5.3), so one function serves both. A stored amount stays in the cut when its row goes, since a mark stores no row id and the row a user taps is often a `hold`, whose amount the settled re-fetch can change (section 4): a marked hold at 835 that settles at 838 keeps its chain. An exact-only match would turn that series into "Marked, No Charges" |
| The marked row edited or deleted | Nothing is written and the mark does not follow the row. The stored amount stays in the cut: its chain stands if other charges reach it; a row edited out of reach leaves the chain; with none in reach, "Marked, No Charges" | A mark writes nothing on a transaction, and a transaction's write touches no setting |
| Currency | **A mark covers one currency.** It stores the code of the marked row's holding beside the amount, from the holding, and reads only the group of that key and currency. So 400 UAH and 400 USD never compare, and a USD charge under a name marked in UAH stays as detection finds it. A holding moved to another currency leaves the mark's group: "Marked, No Charges" | Minor units have no meaning without a currency (kiko-domain, "Currencies"; `currencyScale`). A row has no currency of its own, it comes from its holding (section 4). The JSON holds an integer and a code, never a `Money` |
| Amount and sign | The absolute minor units of the debit, the stored row's, never the draft's. A mark is offered only on a debit, and section 4's charges are debits only, so a credit or refund is neither stored nor in a chain, whatever its amount, and it cancels nothing | Section 4, "Refunds"; `isRecurringCandidate` |
| The other chains under a marked name | Detection still runs on the whole group and its input does not change. **A detected series stands beside a marked one unless it shares a row with it; one that does leaves whole.** So Apple 399 stays detected beside a marked Apple 99. A detected x8 over 100 and 130, with 100 marked, leaves whole, and the 130 rows sit in no series: no second detection runs on what is left, and that is the accepted behavior below. Two detected series inside one chain join: m(10, 5, 99) + m(10, 20, 119), a mark at 99 gives one x20, "Marked: monthly", both detected leave, and a mark at 119 only sets the period, so they can never separate; the same at equal price (the head of this spec). **No row is in two shown series**: pieces share no row, and overlap removes the detected series (a property pin) | `seriesOfGroups` and its memo stay as they are (section 9.5), so a mark runs no detection |
| Period | A picker: weekly, monthly, every 3 months, every 6 months, yearly, as the user approved. The last two are a mark's own and detection never returns them | Section 5.1 names both as false misses. They touch only the stopped cutoff (section 7) and the text (section 6). `addMonths` (`interest.ts:41`) already steps any count of months |
| A mark on a merchant detection also finds | On its chain the mark wins: the user's period, on that chain's charges. Removing a mark clears only that mark, so the series return as detection finds them, unless the key is hidden: the hide stays until "Show again" | One map, one entry per key, which holds a hide flag and marks (section 8). Detection stores nothing (section 11), so nothing is lost |
| One mark per chain (**the user's answer to Q6: "One per chain"**) | A key holds a list of marks, each its own chain. A pick on a row inside a marked chain rewrites that chain's period in place, on every mark of its piece, and moves no stored amount. A pick on a row of another piece adds that chain's mark at the row's amount, and marks on other chains stay; so a re-mark at a new price adds a chain. A stored amount whose chain the row left stays, as stated above. Two stored amounts that a later row bridges land in one piece: one series, with the period of the lowest stored amount, a tie going to the earlier period in the picker's order, order-free; removing that series removes every mark in the piece | The user's answer. One mark per key would have dropped Apple 99's mark on marking Apple 399, with nothing shown |
| The form on a row of another chain | The field reads "Not marked". The value is the period of the marked chain whose amounts span the row's stored amount, and a fold cannot change the chain: it keeps at least one row per amount, and the chain reads only the amounts. A pick adds that chain's own mark; "Not marked" there writes nothing | Reading it takes the group's charges: section 9.6 |
| Text | Section 6, "A marked series". Stopped and quiet as any series, on section 7's table, on the chain. "Marked" shows only where the charges do not fit the period, the table gives no slot, or the period has no table row. The stored amount is never shown: a line shows an amount only as the last real charge's | `recurrenceLine` is a pure `.exhaustive()` match (plan), so `Recurrence` gains one kind |
| Mark and hide together | One map, one entry per key, which holds both, and neither touches the other. A hide affects detected series only: a marked chain stays when its key is hidden (section 8.1). Marking a hidden merchant keeps the hide, and the "Hidden" line stays until "Show again". A marked series offers "Remove mark" in place of "Not a recurring charge"; a detected series, also one beside a marked series, offers hide | Section 8's store. `recordReminderOfferDismissal` shows the read-modify-write inside one `write()` |
| Reversal | "Remove mark" on the series screen, on the "Marked, No Charges" row, and "Not marked" in the form's picker, each for that chain's marks: `removeRecurringMarks(key, marks)`, which compares inside its `write()`, clears only those marks, writes nothing on an entry holding none of them, and drops an entry left with neither marks nor a hide. "Show again" is `showRecurringMerchantAgain(key)`, which clears only the hide, by the same drop. So "Not marked" on a hidden key, whose field reads "Not marked", keeps the hide. A removed mark goes nowhere, and a new mark on any row restores it | As `selectLoanPayment`, where picking "None" on the field is the removal (`transaction-form.screen.tsx:966`). `SelectField` fires `onSelect` on the row already selected (`handleSelect`, `select-field.component.tsx:57-62,120`), so that tap does reach the handler |
| Which rows offer it | A row passes `isRecurringCandidate` plus the per-row matchers, and has no funding caption: an existing, debit, non-blank key, bank or cash account, not archived, not a later local day, no `setsBalance`, `changeGroupId`, exchange marker or `loanHoldingId`, not an MCC or wording transfer. A matched own transfer is the one rule the form cannot see, so **a mark never overrides an exclusion either**: the marked series is built from section 4's charges, and a mark with no such charge in its chain shows under "Marked, No Charges" with a text that fits every reason. **Accepted:** until the form's ledger read lands, a funded debit has no caption yet, so the field shows and then goes. A tap in that gap is safe: the mark overrides nothing, so the funded row stays out. With no other charge in reach, it shows under "Marked, No Charges" and is removed there; with other charges in the chain, it is a marked series of those rows, removed on its screen | `useExchangeFundingCaption` returns only the caption key and drops the ledger read's `isLoading`, so it has no settled state. Gating would change its return type, its suite and its caller, not one line. `isMccExcludedTransfer` (`transfer-exclusion.ts:31`) and `isDescriptionExcludedTransfer` (`:85`) read one row. `internalTransferTransactionIds` (`internal-transfers.ts:168`) pairs across the ledger. `useExchangeFundingCaption` already answers the funded case for this row, by section 4's own `excludedIds`, so a hand-category debit has no caption and is offered, as section 4 counts it |
| A bank-owned row | The field works there and is never `disabled` for that (section 9.6 has its one wait) | `isReadOnly` keys off `existing.source` (`transaction-form.screen.tsx:429`), and only bank-owned fields lock. The category, the loan link and Convert stay live on a synced row (`mode-and-actions.component.tsx`). `selectLoanPayment` writes at once with no source gate |
| The two form paths | One answer: both pass `transactionId`, so both are the same edit state. Home, Holding Detail and a series link differ in no flag. No non-test code under `src/screens/statistics` opens the form: the Statistics stack registers it for the form a transaction tapped in its Home opens, so that stack reaches it through Home | `readRouteEntry` (`transaction-form.screen.tsx:267`) gives `editingId`, and `existing` is the edit concept only (`:285`). The form is one component in four stacks (`home.stack.tsx:58`, `accounts.stack.tsx:96`, `statistics.stack.tsx:60`, `settings.stack.tsx:121`). Create, duplicate and template entries have `existing === undefined`, so they never show it. A series link returns to a screen whose series may have changed: section 9.3 |
| Unsaved edits | The mark reads the stored description and amount, never the draft, and writes at once. It does not touch Save or the draft | `selectLoanPayment` does the same, with `existing.id`; the funding caption reads "the stored row, not the draft" (`transaction-form.screen.tsx:450-452`) |
| Store | Section 8: one column, one migration in task 3/4, whose JSON shape needs no column for a mark. Task 4/4 adds only the `marks` field and its parser arm. `amountMinorUnits`, `currency` and `period` are required on each mark, since nothing has shipped: a mark with a missing, non-integer, zero or negative amount, or an unknown code or period, is dropped alone, and an entry left with neither a good mark nor a hide is dropped. The parser keeps one mark per currency and amount, and reads `marks` sorted by amount, then period in the picker's order, then currency, so a stored order changes nothing. Section 11's table has the new rows. `EXPORT_VERSION` stays 5 | `envelope.ts:13`; `settingsRowsToInsert` (`restore-snapshot.ts:978`) carries a column as it is; `currencyOptions` (`src/currency/currency/currency.ts`) is the closed set |
| Surface | A field, not a button or a new sheet: `RecurringMarkField` in `transaction-form/recurring-mark-field/`, one element in the screen between `ModeAndActions` and `CommentRow` (section 9.6) | `SelectField` is the shared control; `LoanPaymentField` is the same kind of immediate per-row choice. `CategoryOverrideSheet` is on this base at `:1604`, and `1.4-category-automation task 2/6` edits that sheet, its hook and their wiring, not the field list. Its tip 71de98891 has not started that set |
| Detection's input | **Unchanged.** The marked pass runs after the rule on the same charges | Section 9.5; so section 10.2's reference needs no re-run |

**The user's accepted behavior, Q5.** One rise over 25 percent cuts the chain. The charges after it are not in the marked series, so that series shows "No charge since" while the subscription goes on. The user saw this and chose it. It is intended, and no tolerance, chain merge or added rule covers it: 100 marked, then 130, reads "No charge since" and the 130 rows are not linked there. The user's own recovery is to mark a charge at the new price. Under Q6's answer, that adds a second series at the new price, active, and the old chain stays with its history and its true last charge, stopped, until the user removes its mark.

Worlds: the plan's "The marked matrix" holds each one with its rows and its result with no entry, and its "Marked flows" table holds the hide, link and user-text-key flows, each with its `was`. This section does not copy them.

Results the review of 35861c22b changed. `was` is that draft.

| World | was | now |
|---|---|---|
| Quarterly, 12 Jan, Apr, Jul, marked monthly | "Charged monthly, on day 12" | "Marked: monthly" |
| 20 Dec 2025 and 15 Jan 2026, marked yearly | "Charged yearly, on 15.01" | "Marked: yearly" |
| Twelve monthly charges, marked yearly | no line pinned, so "Charged yearly, on 03.10" | "Marked: yearly" |
| Hidden, then "Not marked" tapped in the form | the hide dropped, no notice | still hidden, nothing written |
| Apple 99 marked monthly beside detected 399, opened by link on the marked series, removed in the form, Back | whichever detected series holds the earliest charge | the neutral text |
| Marked yearly over a detected monthly, opened by link, removed in the form, Back | the monthly series, ignoring the period | the neutral text |
| Marked, last charge 30 months ago, the holding's only row | stopped, not quiet | stopped and quiet since that row |

Results the user's answer to Q5 changed. `was` is the draft written on assumed answer A, every charge under the name.

| World | was | now |
|---|---|---|
| Apple 99 and 399, both detected, marked monthly | one series x20, "Marked: monthly" | marked x10 and the detected 399 x10 |
| Apple x12 on day 14 with one-offs at 4,500, 1,200 and 7,000, marked at 99 | one x15, mixed, "Marked: monthly" | one x12, "on day 14": the one-offs stay out |
| The same, plus 1 Nov at 4,500 | last charge 1 Nov at 4,500 | last charge 14 Oct at 99 |
| Apple 99 ended 14 Jun, purchases 28 and 30 Oct at 4,500 and 7,000, marked at 99 | one x10, never stopped, last charge 30 Oct at 7,000 | one x8, stopped, not quiet, "No charge since 14.06.2026" |
| Apple x12 with purchases at 89, 109, 119, 399, 29, marked at 99 | one x27 | one x21, "Marked: monthly", last charge 5 Oct: those in the chain link, 399 and 29 do not |
| 100 x5 then 130 x3, marked | one x8, active | one x5, stopped: the user's accepted behavior |
| Monthly at 100, 300, 900, marked at 900 | one x3, "on day 15" | one x1, "Marked: monthly" |
| One key in UAH and USD, one row marked | two series | one series, in that row's currency |

Results the review of 41be4a687 changed, with Q6's answer. `was` is that draft.

| World | was | now |
|---|---|---|
| Hidden, then marked | marked; the "Hidden" line leaves | the marked series, and the "Hidden" line stays until "Show again" |
| Hidden, then marked, then removed | no entry: the detected series show, no "Hidden" line | the hide stays: the "Hidden" line and no series; "Show again" gives the detected series |
| Marked 99 beside a detected 399, then hide on the 399 | hidden, the mark gone; "Show again" gives two detected series | the marked 99 stays, the 399 leaves, a "Hidden" line; "Show again" gives the 399 beside the marked 99 |
| A row of 144 with 100 stored, a pick | one mark at 144, the 100 replaced | the 100's period rewritten; the store still holds 100 |
| Marked monthly over one detected monthly, opened by link, removed in the form, Back | that series, by the fallback | the neutral text: a marked route has no detected fallback |
| Marked 99 x2 beside a detected 399 x10, opened by link, "Not marked" in the form, Back | the detected 399, by the fallback | the neutral text, not 399 |
| 99 x10, one 119, a detected 399 x10, marked at 99, opened by link, a yearly pick on the 119 row, Back | the store moved to 119, the route's 99 missed, the detected 399 by the fallback | the marked x11, yearly: the store still holds 99, and the route's amount lies in the piece's span |
| 99 and 130, a stored 115 whose row was deleted | "the stored amount never joins what its own row did not join": no world pinned | one x2 until the mark is removed |
| 80, 120, 500, a stored 100 whose row was edited to 500 | the same | one x2 over 80 and 120 |

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
section: newest last charge, then key, then series id; the last two have no charge, so key order, and "Marked, No Charges" then
currency, then lowest stored amount, which is never shown. Never by amount otherwise: a section can mix currencies. A marked series
with charges sits in active or "No recent charge" like any other. A hidden key lists its "Hidden" line and no detected series. A key
with marks lists its marked series, its "Marked, No Charges" rows, and, unless hidden, each detected series sharing no row with a
marked series (section 8.2). A "Marked,
No Charges" row shows the name and the "Marked:" line of its period, with no amount, since no real charge stands behind one.

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
deleted through a link, or an older row imported, moves the earliest charge while the series still lists. An id hit
counts only for a series with the route's `merchantKey` and `currency`, since a rename can give another merchant the
earliest-charge id. So a miss on `seriesId`, or a hit on another merchant or currency, falls back to the one series with
the same merchant key, currency and period. With none, or with more than
one (two monthly Apple series: never guess), the screen shows `EmptyState` with a neutral text about the list, never
about the merchant: nothing on this path says a charge stopped repeating.

The lookup reads the series before the hide filter, so between the hide write and `goBack` the screen keeps its series
and never flashes that state (section 8; a pin). `goBack` runs only if the screen is still focused when the hide write
resolves, so a late write never closes a form the user opened or pops the list.

**With marks (task 4/4), the route gains an optional `markedAmountMinorUnits`, absent on a route opened on a detected series. It is
the series' lowest stored amount, a lookup key never shown.** A route that holds it finds the marked series of the route's key and
currency whose span, from the lowest to the highest of its charges and stored amounts, holds that amount. Pieces are disjoint, so at
most one span does. On a miss it shows the neutral text and never a detected series: that route's `seriesId` is the chain's earliest
charge and its period may be the user's, so either step would be a guess. A route without it finds the marked series of the route's
key and currency whose charges hold `seriesId`, then `seriesId` among the detected series left beside the marked ones, with the same key and currency, then the
fallback above among those detected series, then the neutral text. A key can hold several marked series, so the key and currency no
longer pick one. Remove mark on this screen holds the last resolved series until `goBack`, since that write takes the marked series
away; a pin, as the hide's.

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
| `holdingsRepo.allQuery()`, `accountsRepo.listQuery()`, `settingsRepo.recurringMerchantChoicesQuery()` (the one column, so a settings write elsewhere refreshes no detection; the hook does not read settings until task 3/4) | their own | `paused` |
| Series screen: `listWithContextByIdsQuery(ids)`, plus categories and settings for the row | `transactions`, `holdings`, `accounts`, `categories`, `settings` | `paused` |

`paused: !useIsScreenVisible()` on every read. Not `cached`: `cached` only makes a mount read the LRU, and a
whole-ledger read is never a display-readiness seed. The entry is written either way (`writeCache` in
`src/db/use-live-query.ts`), so leaving it off saves no memory. `write()` flushes once per commit, so a sync fires one re-read.
Detection runs only when `useDataReady` over all the reads is true, and `isLoading = !isReady`. It runs in a `useMemo` on rows, holdings, accounts and the **local day of `now`** (`startOfLocalDay`), not on `now`:
each Back refreshes `now` with no row change and must run nothing. Hidden keys are not in the memo: the list filters on
them after detection, so a hide runs no detection, and the hook hands the series screen the unfiltered result.

Marks keep that: task 4/4 splits `detectRecurringSeries` into `chargeGroupsOf` and `seriesOfGroups`, with the same input, output
and rule, and the first memo keeps the groups. A second memo, on groups, the detected series, the marked entries and the local day, runs
`markedSeriesOf`, a walk of the marked keys' groups only, and drops each detected series sharing a row with a marked one. A mark,
like a hide, fires `settings` alone, so on the list and series screens it runs no detection and no new ledger read; the form has its
own read (section 9.6). Those two are the pins; the walk's reach over the marked keys alone has none.

### 9.6 The mark field on the transaction form

`RecurringMarkField`, in `src/screens/forms/transaction-form/recurring-mark-field/`, renders `SelectField` with a "Not marked"
option and the five periods. Label "Mark as recurring"; sheet title "Mark as Recurring". A pick writes at once; a rejected write
shows the save alert through `alertOnCatch`, as `selectLoanPayment`'s does (`transaction-form.screen.tsx:953`). The current period shows as its value on the field. No new shared
component, theme tokens only, so no `kiko:designer` step. The device check confirms the look.

It is one element in `transaction-form.screen.tsx`, between `ModeAndActions` and `CommentRow` (`:1562-1586`), so the screen's
cognitive budget and `ModeAndActions`' props do not grow, and `converting` gates it at the call site. The child holds its own
read, `settingsRepo.recurringMerchantChoicesQuery()` on `['settings']`, enabled only for a row it offers on. The screen passes its
own `holdings` and `accounts` as props: they are section 9.5's two whole-table reads (`holdingsRepo.allQuery()`,
`accountsRepo.listQuery()`), so the field adds no read of either. The row's currency is that of the stored row's holding,
`existing.holdingId` in `holdings`, never the screen's `currency`: that one follows the draft's holding and falls back to `'UAH'`
(`holding?.currency ?? 'UAH'`). While either read loads the holding or account is not found, so the row is not offered and the field
is absent. The form's existing
whole-ledger read is `useExchangeFundingCaption`'s (`:452`, `use-exchange-funding-caption.ts:87`), and its caption key is passed in;
that hook returns only the key, so its rows cannot be reused. The form reads no settings today, and
`transaction-form.screen.test.tsx` mocks each repo it uses (`jest.mock` block from `@kiko/transactions/repo`) with a fallback of `[]`
per table (`:271`), so the suites that open a stored debit need one added repo mock (the plan's list; the developer measures).

**Which chain a row is in needs the group's charges.** A key is computed, so no SQL narrows to it, and step 3's cut reads every
charge of the group. So `useRowMark` adds `recurringLedgerQuery`, `enabled` (`use-live-query.ts`, the third argument) **only when the
entry holds a mark in the row's currency**. With none, the field reads "Not marked" and a pick adds a mark, with no ledger read, so a
row under an unmarked name costs what it did. With one, a second whole-ledger read runs while the form shows, and `chargeGroupsOf`
once on its result, with no rule, because a pick must know whether it rewrites a chain or adds one. Its cost is in section 10.3's
device check. was: no second ledger read on the form, ever. now: none under an unmarked name, and one under a name marked in that
currency. The matched-transfer row is still offered and left out rather than read for.

**The field's one wait.** `useRowMark` is ready when the settings read neither loads nor holds an `error` and, while the ledger read
is enabled, the same of that read. Until then, and through a pick's write (`isSubmitting` of `useSubmitOnce`), the field states no
value (`selected` null, an empty `placeholder`) and stays `disabled`, so no false "Not marked" shows: not on the first settings read,
and not right after a first pick under a name, when the landed entry enables the ledger read and its rows are still `[]`. A rejected
first read settles with `data` `[]` and `isLoading` false (`applySettled`, `use-live-query.ts`), so `isLoading` alone would read "Not
marked" and enabled. The `error` holds the field in the same state, with no failure text, since the live query already logs it; the
next good fire releases it. It counts only on an enabled read, since a read turned off keeps its last `error`. After a write resolves
and until its settings re-read lands, the field shows the last read's value, as any live read does; no pin. That is the only
`disabled` here, and it is not about a bank-owned row.

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

**Marks do not change this measurement.** The reference reads the same input through the same rule (section 9.5), and the amount
chain changes neither, so it is not re-run. The marked pass is outside it; its pin, in task 4/4, is section 9.5's: on the list and
series screens, a mark runs no detection and no new ledger read.

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
these on the user's real ledger, and it names one path: **opening a series** is a second whole-ledger read (not `cached`, 9.5) plus
detection, while the list's own read is paused beneath it. Returning with Back reads nothing new on an unchanged ledger and,
keyed on the local day, detects nothing.

**The device check records four numbers, on a release build on the user's ledger:** that ledger's row count; the time from
opening the list to the list showing; the time from opening a series to the series showing; and, from task 4/4, the time from
opening a transaction under a marked name to its mark field enabling (section 9.6). No pass line is set here, since no device figure
exists to set one from. The numbers go in the coordinator's report with the user's own read of whether it stalls.

### 10.4 Pins, and the fix if one fails

Counted work, never wall clock (`transactions.repo.category-rules.performance.test.ts` states the rule):
- `merchantNameOf` runs at most once per distinct description, over the 50,000-row `rules-performance-fixture`.
- Reads of a row's `time`, by instrumented rows, stay under a bound of the form `rows x (log2(rows) + K)`; the developer
  sets K from the first measured run, and it is never raised after.
- Sort comparisons of one detection stay under `rows x (log2(rows) + 6)`, and `daysBetween` calls under 37 per row
  (constants in `src/recurring/detection/detection.performance.test.ts`; never raised).
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
| 1.4 file into 1.4 | The map comes back from the file, hides, and marks with their currency, amount and period. It is the user's choice, not this device's, so not `KEPT_FROM_LIVE_ON_RESTORE` | `kept-from-live-on-restore.ts`; `settingsRowsToInsert` `restore-snapshot.ts:978-981` |
| 1.4, into 1.3, re-exported, into 1.4 | The map is lost; a false match shows again and a marked series leaves; the user hides or marks again. No row changed | |
| A marked key's rows absent after a restore | The mark stays and shows under "Marked, No Charges"; never an error | section 8.2 |
| A stored amount against a restore's rows | Same scale: the map exists only in a version 5 file, and the rescale runs only up to version 3 (`LAST_SCALE_2_USDT_VERSION`, `with-usdt-rescaled.ts`), which reads no settings column. A later change of a currency's scale must also rewrite this map | `UsdtRescaleTables` |

**`EXPORT_VERSION` stays 5.** A bump would make 1.3 refuse every 1.4 file over a map that is safely inert. The amount is inside the
JSON, so the note, the column and the version do not change for it. The note goes in `VERSION_DECISIONS`
(`src/data-transfer/crypto/envelope.test.ts:99`) with `migrationCount` plus one. The `settings` shape check reads no column, so a
malformed value in a file is read defensively: a non-object reads as no choice; an entry with a non-string name is dropped alone; a
`hidden` other than `true` reads as no hide; a mark with a missing or bad amount, an unknown currency or an unknown period is dropped
alone, and an entry left with neither a hide nor a mark is dropped (pin).

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
  leaves 23, ATB and Fora among them. So each monthly merchant but the five real bills moves: in months 1, 3 and 5 its one row moves
  ten days: a `dayOfMonth` under 15 adds ten, otherwise it subtracts ten (odd months only), at the same amount, and month 0 stays. Month totals and the default 30-day window
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
| `recurringCharges.emptyMessage` | Kiko looks through your transactions for charges that repeat, such as subscriptions and rent, and shows the ones that already happened. A monthly charge appears after its third payment; importing a statement can bring in earlier ones. You can also open a transaction and mark it as recurring. | Кіко шукає у ваших транзакціях платежі, що повторюються, як-от підписки й оренда, і показує ті, що вже відбулися. Щомісячний платіж зʼявиться після третього списання, а імпорт виписки може додати попередні. Також можна відкрити транзакцію й позначити її як регулярну. |
| `recurringCharges.monthlyOnDay` | Charged monthly, on day {{day}} | Списувалося щомісяця, {{day}} числа |
| `recurringCharges.monthlyAroundDay` | Charged monthly, around day {{day}} | Списувалося щомісяця, близько {{day}} числа |
| `recurringCharges.monthlyLastDay` | Charged monthly, on the last day | Списувалося щомісяця, в останній день |
| `recurringCharges.monthly` | Charged monthly | Списувалося щомісяця |
| `recurringCharges.weekly` | Charged weekly | Списувалося щотижня |
| `recurringCharges.weeklyOn.monday` ... `.sunday` | Charged weekly, on Mondays ... | Списувалося щотижня, у понеділок / у вівторок / у середу / у четвер / у пʼятницю / у суботу / у неділю |
| `recurringCharges.yearly` | Charged yearly | Списувалося щороку |
| `recurringCharges.yearlyOn` | Charged yearly, on {{date}} | Списувалося щороку, {{date}} |
| `recurringCharges.lastCharge` | Last charge {{date}} | Останнє списання {{date}} |
| `recurringCharges.noChargeSince` | No charge since {{date}} | Немає списань з {{date}} |
| `recurringCharges.holdingQuietSince` | {{holding}}: no newer transactions since {{date}} | «{{holding}}»: немає новіших транзакцій за {{date}} |
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
| `recurringCharges.markedEmptyMessage` | No transactions near the amount you marked count here now. Transfers, exchanges and loan payments are left out. | Зараз тут немає транзакцій, близьких до позначеної суми, які враховуються. Перекази, обміни й платежі за кредитом не враховуються. |
| `forms.transaction.markRecurring` | Mark as recurring | Позначити як регулярний |
| `forms.transaction.markRecurringSheetTitle` | Mark as Recurring | Позначити як регулярний |
| `forms.transaction.notMarkedRecurring` | Not marked | Не позначено |

`forms.transaction.markRecurringSheetTitle` and `recurringCharges.markedEmptyHeading` are
`TITLE_KEYS` members (read `src/i18n/locales/title-keys.ts`), so their wording is title case.

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
5. (task 4/4) If Kiko missed one, open one of its transactions and choose how often it's charged under "Mark as recurring". The mark covers charges close to that transaction's amount, so after a big price change, mark a newer charge too. You can remove a mark from the same field or from the charge.

What's New draft, per the release skill's format: "Recurring charges: see what repeats in your transactions and every past charge, and mark one Kiko missed." uk: "Регулярні платежі: дивіться, що повторюється у ваших транзакціях, і кожне минуле списання, а також позначайте те, що Кіко пропустив." Not committed: it lives in App Store Connect.

## 15. Binding constraints, order

| Constraint | Enforced by |
|---|---|
| No future date, no forecast, no total (the total: reversed by section 17.1) | A property pin: no date in the output has a local day later than today; the output type has no sum; stopped steps back only; review |
| One name definition | Import from `@kiko/transactions/merchant-name`; review. No local normalizing |
| One eligibility definition | `recurringExcludedIds` only calls the existing functions; one world per rule |
| Never sums across currencies | The group key holds the currency; no sum exists anywhere |
| Detection writes nothing | Pure function and a read-only query; only `hideRecurringMerchant`, `showRecurringMerchantAgain`, `markRecurringCharge`, `setRecurringChainPeriod` and `removeRecurringMarks` write, and only to `settings` |
| A mark overrides no exclusion | `markedSeriesOf` reads the same charge groups as detection; a world per kind |
| A mark predicts nothing | The marked series has the output type of any series: past dates and the period's text; the property pin covers marked worlds. The stored amount is on no line: a shown amount is the last real charge's |
| A stored amount never compares across currencies | A mark holds its currency and reads only that `[key, currency]` group; a world with the same digits in two currencies |
| No row is in two shown series | Amount pieces share no row; a detected series sharing a row with a marked one leaves whole; a property pin |
| A new exchange's rows stay out | The account kind allow-list; a crypto-account world |
| 2.5.19 | No condition on the row; a screen pin with no data |
| An older build damages nothing | Section 11, with a restore pin and a file-without-key pin |
| Purpose | No balance, net worth, category or statistic reads this; it changes none of them |

Sets, each merging into `next` alone, on the coordinator's call. Counts are floors, tests included. Q5 moves task 4/4 only: tasks 1/4
and 2/4 are unchanged, and task 3/4 keeps its files with one repo function renamed. The review of 41be4a687 adds one file to task 1/4,
moves task 3/4's stored shape but not its files, and adds no file to task 4/4.

1. **1.4-recurring task 1/4: detection and the list.** Goal: the Settings row, the list, the empty state, the recurrence text and stopped section, and a reviewer's demo file that shows the real bills as series and no shop. Rows do not open yet. Needs `1.4-category-automation task 2/6`. Floor 47 files (was 46).
2. **1.4-recurring task 2/4: the series screen and its links.** Goal: every past charge, each opening its form, on phone and two panes. Needs task 1/4. Floor 18 files.
3. **1.4-recurring task 3/4: hide a false match.** Goal: the control, "Hidden", the choice column and its restore paths. Needs task 2/4. The one migration of this track. Its JSON entry holds a name and a hide flag, and task 4/4 adds `marks` beside them with no migration. Floor 34 files plus the generated `.sql` and snapshot.
4. **1.4-recurring task 4/4: mark as recurring.** Goal: the field on the transaction form, the marked series on their amount chains, "Remove mark", "Marked, No Charges". Needs task 3/4, for its store and the series screen's button. No migration. Floor 41 files, 12 of them mutable (was 38 and 11).

**One release.** The four sets merge into `next` one at a time and `next` tolerates each middle state: every visible text ships with what it names (section 14), and no middle state writes anything but its own column. A release holds all four or none: tasks 1/4 and 2/4 alone have no hide, the remedy for the accepted yearly false match, and the user asked for the mark with the rest.

**Fundamentals done: the tip of task 4/4.** It is the required device call for this feature, under the ruling at the top. Detection, the reversible hide and the mark are all in the user's Q2 answer, and a false match has no removal before task 3/4. No set is visual-only: apart from review, drift and Ready steps, every step holds behavior, correct data or text the feature needs, so none moved. The device items of tasks 1/4 to 3/4 wait for that call, and visual finish follows it in fast rounds. **An optional look before the point, not the point:** at task 2/4's tip, a release build on the user's real ledger shows detection on their history and gives section 10.3's numbers early. The coordinator decides whether to offer it, and task 3/4 does not wait for it.

Conflict surface: `settings.screen.tsx` and its group-card pins (one row and divider in the card `1.4-small` made), `transaction-form.screen.tsx` (task 4/4, one element; section 9.6), `e2e/screenshot/seed/screenshot-seed.ts`, `e2e/screenshot/fixtures/README.md` and the demo `.kiko` files (`1.4-category-automation task 2/6` edits them too, and adds rows under merchants this track's pin reads), `settings.stack.tsx` and `types.d.ts` (one added route each with `1.4-category-automation`), `en.ts`, `uk.ts`, `title-keys.ts`, `help-topics.ts` (added lines), `schema.ts`, the migration files, `envelope.test.ts`, `settings-columns.test.ts` (task 3/4, by merge order). `1.4-light-scheme`: theme tokens and shared components only, so it applies by itself. `1.4-tables`: Statistics is not touched here. `1.4-bybit`: section 4, no edit.

## 16. User questions

Only decisions that change what gets built. Q1 to Q6 are answered: their answers head this spec. None is open. The misses Q2's choice
named stay misses of the rule, and a mark closes them all but the name holding a month, for the charges in its amount chain: a
quarterly or half-yearly charge; a monthly charge before its third payment; two subscriptions under one name at the same price on
the same day; a subscription under a name with many other purchases, when it has fewer than 6 charges, when its price changed, or
when most of those purchases cost exactly what it costs; a monthly charge that doubled on the same day in several months; a statement
row dated two or more days from its bank row. A price rise over 25 percent cuts the chain: section 8.2's accepted behavior.

**Q6's answer, "One per chain", in full.** A pick on another piece adds a series and the others stay. After a rise, the new price is active and the old chain stays with its history and its last real charge, stopped, until "Remove mark". That stopped line can read false before the re-mark, the accepted cost of Q5. Nothing the user marked is lost by a hide or by another mark. A row that later bridges two marks makes one series, with the lowest stored amount's period.

**Planner's calls, recorded, not questions.** None of these is a user ruling; the rulings are quoted at the top. Reasons in the sections named: every 3 and every 6 months only in the mark (8.2); a mark wins on its chain (8.2); a stored amount takes part in the cut, so a mark outlives its row (8.2); a detected series sharing a row with a marked one leaves whole, with no second detection (8.2); a mark's ledger read on the form only for a name marked in that currency (9.6); "Marked" text only where the charges do not fit the period, the table gives no slot, or the period has no table row (6); a marked series never leaves the list (7); one choice map for hides and marks (8); a field rather than a button, between `ModeAndActions` and `CommentRow` (9.6); the matched-transfer row is offered and left out, rather than a second ledger read on the form (8.2); the Settings row is last in its group (9.1); the three periods and their minimums (5.1); yearly from two charges, with an accepted false match (5.1, 5.4); a series crosses holdings, not currencies (4); pending and manual rows count, refunds neither count nor cancel (4); loan links out by marker (4); crypto and other non-cash accounts out by kind (4); two of the last three decides a moved day (6); numeric dates as everywhere in the app (6); the stale source read from rows, not `syncState` (7); stopped sinks and leaves at 24 months (7); no midnight timer (7); hide is per merchant key (8); a settings column rather than a table or `dismissedTips` (8); the last charge's amount shows beside its date (9.2); the whole-ledger read is not `cached`: a mount does not read the LRU (9.5); `EXPORT_VERSION` stays 5 (11).

**The orchestrator's calls after the spec review, recorded the same way, not user rulings:** a row is compared to today by local day, and a later local day is left out (4); the fold keeps the largest count of one source, and reaches one local day (4); a funded debit with a hand category stays in, as an accepted false match (4); quiet uses the stopped cutoff and dates from the holding's newest row (7); the quiet line names the holding (7); a stopped row shows its amount (9.2); the memo keys on the local day (9.5); on a detected route, a missed `seriesId` falls back to one matching series, else a neutral text (9.3); all four sets ship in one release (15); the uk past frame, which `kiko-translator` rules decide (13).

**The orchestrator's calls after the review of 41be4a687, recorded the same way, not user rulings; each changes the design:** a marked route finds the piece spanning its amount, else the neutral text, with no detected fallback (9.3); a pick inside a chain rewrites its period and moves no stored amount, and a re-mark at a new price adds a chain (8.2); one entry holds a hide flag and marks, a hide affects detected series only, and each reversal clears only its own part (8.1, 8.2); a stored amount can bridge what its row did not join (8.2); the parser dedupes marks and sorts them, with a period tie-break (8.2); the settings read also gates the field, and a rejected read holds it disabled with no value (9.6); the field takes the screen's holdings and accounts as props, and its currency from the stored row's holding (9.6). The consequence for two subscriptions inside one chain is the planner's, stated at the head of this spec and told to the user through the coordinator.

**Where the measured reference moved a call:** step 2's condition was called as "every pair fits". On that form a seasonal bill with one moved day went back to the reported fault (two stopped rows or one short stopped row, in 7 of 9 placements of the moved day). So it reads "passes as monthly, no two charges in a slot": all 9 give one series, and the sweep below 5.3 shows no new false match. Step 6 runs when nothing stands, not only when nothing was found. The fold, coverage exception and exact-cut calls hold as called.

## 17. Visual round 1 (2026-11-05)

The user's device reading of task 4/4, relayed by the coordinator: items 1 to 12 and 14 (HANDOFF "Item 1"). The answers to the round's questions A to L
are binding; words in quotes are the user's. A total states money already paid, never a forecast (A: "show total", "show
total of all recurring charges"; B, C: "Total = sum of all charges"; J: "All paid so far"). This section overrides sections
9.2, 9.3, 9.5, 13 and 15 where they differ. Detection, marks, the store, the routes and the help topic do not change.

### 17.1 What this reverses

| Rule | was: | now |
|---|---|---|
| A total (15, row 1; plan Global Constraints) | "no total", "the output type has no sum" | A display-only sum of past charges on both screens (17.4). Detection's output type still has no sum: the totals live outside `src/recurring/detection`. No forecast, no date after today |
| Sums across currencies (15, row 4) | "no sum exists anywhere" | A series sums only its own currency. List totals convert each series sum to the base currency (17.4); the detail total stays in the series currency. No raw sum of minor units across currencies: every base sum adds `Money` in the base currency |
| Purpose (15, last row) | "No balance, net worth, category or statistic reads this" | The list reads categories and rates for display. It still changes no balance, net worth, category or statistic |
| Recurrence line (13; Q1 "Charged monthly, on day 15") | "Charged monthly, on day 15" / «Списувалося щомісяця, 15 числа» | "Monthly, on day 15" / «Щомісяця, 15 числа»; every recurrence key drops "Charged" (17.8). The "Marked:" lines and "Last charge" keep their text |
| List sections (9.2) | active, "No Recent Charge", "Marked, No Charges", "Hidden" | one group per category (17.2), then "Marked, No Charges", then "Hidden". The "No Recent Charge" heading and its key go (17.3) |
| Row layout (9.2) | name; recurrence line; last-charge line; amount beside the lines | line 1: name, amount; line 2: recurrence line, last-charge line under the amount (17.2) |
| Series screen button (9.3) | in `ListFooterComponent`, variant `secondary` | the `Screen` footer, as other detail screens (17.5) |
| Transaction form, "Convert to exchange" (9.6 placement) | a `small` inline button in `ModeAndActions`, between the loan field and the mark field | the form's `Screen` footer (17.6) |
| Transaction form, Type and Amount (item 14) | Type full width under the Holding field, Amount full width under it | one row, as `DateTimeRow`; stacked at accessibility text sizes (17.6) |

### 17.2 The list

Order of items: the total of all; the category groups; "Marked, No Charges"; "Hidden". A `Divider` (`spacing={2}`, as the
Accounts screen puts before a section) stands before every group and section that follows another item (item 10: "Hidden"
gets it as the other groups do). With no series, the empty state as today and no total row.

- **A series' category** (F) is the stored `category` of its newest charge: the first id of `chargeIds` (newest first) found
  in the charges read (17.5). It resolves through `resolveCategoryKey` (`src/categories/category-display/`), so an unknown or
  deleted slug folds to the default category, as everywhere. A null or empty stored category, or a series none of whose rows
  is in the read, goes in the **Uncategorized group**: title and icon from `neutralCategory()` (existing key
  `categories.uncategorized`, symbol `creditcard`), color `resolveCategoryColor(null, <its group id>)`. Open point P1 (17.9).
- **Group order** (G): the Categories screen's order, `categoriesRepo.allQuery()` (`sortOrder`, then `key`); the
  Uncategorized group last. A group shows only when it holds a shown series.
- **Inside a group** (E, the planner's proposal, the smallest change): the active series by today's order
  (`newestChargeFirst`), then the group's stopped series in the same order. A stopped row keeps its "No charge since" or quiet
  line, which tells it apart; the "No Recent Charge" heading goes. Stopped series count in the totals ("their charges were
  paid"). Open point P2 (17.9).
- **Which series:** today's shown set: detected series not hidden, plus every marked series with charges (`itemsOf`).
  "Marked, No Charges" and "Hidden" stay their own sections with no totals (I).
- **Group heading** (items 2, 3): the Accounts section heading's composition, built from the shared parts:
  `EntityIconTile` (`compact`) with the category's icon and color, the title as `Text variant="heading"`, the group total as
  `MoneyText` opposite it, in a row of `justifyContent: 'space-between'`, `alignItems: 'center'`, the title box `flex: 1`,
  the total box `flexShrink: 0` (`implicit-account-heading.styles.ts`, `accounts.styles.ts` `sectionHeadingRow`/`rowAmount`).
  It is not pressable and has no chevron: nothing opens a category here. `ImplicitAccountHeading` and `AccountTotal` are not
  imported: both live in `src/screens/accounts/` (`check:screen-imports`), the first takes an `AccountRow` and the second
  carries a converted caption a base total does not have. So the list gets one local component,
  `recurring-group-heading`, of shared parts only (kiko-design-system: no shared component fits).
- **The total of all** (item 6): a row above the first group, `t('recurringCharges.paidSoFar')` as `Text variant="body"` and
  the total as `MoneyText`, laid out as the group heading's row.
- **Row** (items 4, 5): line 1 holds the name (`flex: 1`) and the last charge's amount (`flexShrink: 0`); line 2 holds the
  recurrence line (`flex: 1`) and `lastChargeLine` right-aligned under the amount, allowed to wrap (the quiet line is long).
  The amount stays the last real charge's, in its own currency.
- testIDs: `recurring-charges-total`, `recurring-charges-group-category-<key>`, `recurring-charges-group-uncategorized`,
  each total `recurring-charges-group-total-<group id>`, each divider `recurring-charges-divider-<item key>`. A user category
  keyed `uncategorized` cannot collide: the group id has a kind.

### 17.3 Removed key

`recurringCharges.stoppedHeading` goes with its heading, from `en.ts`, `uk.ts` and `title-keys.ts`, in the step that removes
the heading; its two test reads (`recurring-charges.screen.test.tsx`, `recurring-charges.screen.marked.test.tsx`) and the
`recurring-charges-heading-stopped` testID change in the same step. No help topic, skill or e2e file names it (grep at
14f997ad7; re-grep on the base). It has not shipped.

### 17.4 Totals and the conversion rule

- **A series' own sum:** the sum of `-amountMinorUnits` over its charge rows in the read, as `Money` in `series.currency`
  (each charge is a debit; `chargeIds` holds no folded twin and no refund, section 4). Every row of a series has its
  currency (the group key holds it); a row of another currency is skipped, never added.
- **List totals, base currency (D):** the rule `buildCategoryBreakdown` (`src/statistics/category-breakdown/`) applies to past
  rows: the CURRENT rate table, `buildRateTable(rates)` (`src/rates/net-worth-view/`, the fiat seed under the live
  `currency_rates` rows), `canConvert` as the guard, `convert` (`src/rates/conversion/`) for the value. One `convert` per
  series sum, not per row: the table is the same for every row, so the two differ only in rounding, and one conversion per
  series keeps a group total equal to the sum of what it holds. A group total adds its series' base `Money`; the total of all
  adds the group totals, so it equals the sum of the shown group totals. Charges are fiat cash rows (section 4's account-kind
  allow-list) and the seed covers every fiat currency, so `canConvert` fails only with no seed and no live row; such a series
  is left out of the base totals, as Statistics leaves the row out, and its own row still shows its amount. No price book:
  no charge is a priced holding.
- **Detail total (J, K):** "All paid so far" = the series' own sum over the rows the screen already lists (`charges`), in the
  series currency, no rates. Shown once the rows read has landed, beside the charge count.
- A total is display only: no write, no route and no form reads it.

### 17.5 Reads and their cost

The list screen adds one hook, `useRecurringGroups` (`src/recurring/use-recurring-groups/`), beside `useRecurringSeries`. The
series screen adds no read.

| Read | Tables | When it runs | Cost |
|---|---|---|---|
| `transactionsRepo.listWithContextByIdsQuery(ids)`, `ids` = every `chargeIds` of the hook's `series` and `markedSeries` (unfiltered by a hide), unique and sorted | `transactions`, `holdings`, `accounts` | mount; a write to those tables (the whole-ledger read re-runs on `transactions` anyway); a change of the id set (a mark write, a detection change). **Not on a hide**: a hide changes no `series` id, so the sql and params are equal and `useLiveQuery` reads nothing (its key is `sql::params`) | rows by primary key, one bound parameter (`json_each`), joined to holdings and accounts by key; N = the charges of all series. Not a whole-ledger read |
| `categoriesRepo.allQuery()` | `categories` | mount, a category write | the categories table |
| `ratesRepo.allQuery()` | `currency_rates` | mount, a rates refresh | about 107 fiat rows plus one per coin |
| `settingsRepo.getQuery()` (base currency, default category) | `settings` | mount, every settings write, a hide or a mark included | one row |

All four `paused: !useIsScreenVisible()`, not `cached` (9.5). A hide or mark still runs no detection and no whole-ledger read
(9.5, plan S13): it adds one one-row settings read, and a mark adds one by-ids read. The list's `isLoading` is the hook's or
the groups' loading; a re-keyed by-ids read shows the loading state until it lands, never a group built on rows of another
id set.

### 17.6 The series screen and the transaction form

- **Series screen (items 7, 8, 9, L):** the recurrence line loses "Charged" (17.8). The header gains a row:
  `t('recurringCharges.paidSoFar')` and the total as `MoneyText`. The button by kind ("Not a recurring charge", "Remove mark")
  moves from `ListFooterComponent` to `Screen`'s `footer` with `floatingFooter`, as `holding-detail.screen.tsx`
  (`holdingDetailFooterAction`), `category-form.screen.tsx` and the Edit template footer do; variant `secondaryTonal`, regular
  size, full width: the lone secondary footer action (kiko-design-system "Form Save and Cancel", the Edit template ruling of
  2026-10-11), never a primary. Its `loading`, `useSubmitOnce`, testIDs (`recurring-series-hide`,
  `recurring-series-remove-mark`) and the `removedSeries` hold across a Remove mark write stay as they are. Under a floating
  footer the list's bottom padding is `useFloatingFooterEnd()`, read in a child of `Screen` (as `LedgerList` in
  `holding-detail.screen.tsx`), so the last charge stops at the footer's top edge.
- **Mark field's empty value (item 11):** the loan payment field shows "None" in the placeholder tone:
  `PaymentHoldingField` passes `valueTone={selected ? 'textPrimary' : 'textSecondary'}` to `FieldTrigger`. `SelectField`
  sets `textPrimary` for any selected option, so "Not marked" reads as a value. `SelectField` gains an optional
  `emptyOption` prop: when the selected option equals it, `valueTone` is `textSecondary`; with no prop nothing changes.
  `RecurringMarkField` passes `emptyOption="none"`. The loan field's `NONE_ICON` is not copied: the mark field has no icons.
- **"Convert to exchange" (item 12):** leaves `ModeAndActions` (its `convertEligible` and `onPressConvert` props go) and becomes
  the transaction form's `Screen` footer: `editTemplateId`'s "Create transaction" when set, else this button when
  `convertView.eligible && !converting`, else none. `convertView.eligible` needs `isEditing` and a stored row, so the two
  never meet; a pin holds it. Variant `secondaryTonal`, regular size, full width, icon `arrow.left.arrow.right`, label
  unchanged: a footer button is regular (the Edit template footer).
- **Type and Amount in one row (item 14, USER: "Display 'Type' and 'Amount' in a single row of a transaction form"):** the
  income/expense branch of `FieldGroup` lays the Type field (`typeSelectField`, the `ModeSelectField` the screen builds) and
  the Amount `TextField` side by side, as `DateTimeRow` lays Date and Time: `Box direction="row" gap={3}`, each field in a
  `View` with `flex: 1`. The screen passes `typeSelectField` to `FieldGroup` instead of rendering it above. The exchange
  branch keeps Type full width above "Value Out", and convert has no Type (`visible={!converting}`). Open point P3.
  **Fallback:** at an accessibility text size (`useWindowDimensions().fontScale` at or above a named constant for iOS's
  first accessibility size, AX1; the developer reads the value on the device and names its source) the two stack full width
  in today's order. The Duo folded window (386pt wide in Device Hub, finding `20261018T0952-kiko-duo-adaptive/1`) leaves each
  field about 170pt at the content margin, which holds the Type trigger with its icon and an amount with its currency
  suffix; the device call checks it and the largest non-accessibility size. Reading order, refs (`amountFieldRef`, the
  scroll to the first invalid field) and testIDs do not change. Nothing else on the form moves.

### 17.7 Guideline 2.5.19 and compliance

No flag and no condition on any new element: the totals, headings and footer buttons show whenever their data exists, and
the empty state explains the screen with none. Nothing new is stored, sent or logged.

### 17.8 i18n

Draft rows; the user reviews them in both languages before the developer copies them (`.superpowers/sdd/1.4-recurring/texts-visual-1.md`).
These replace the matching rows of section 13.

| Key | en | uk |
|---|---|---|
| `recurringCharges.monthlyOnDay` | Monthly, on day {{day}} | Щомісяця, {{day}} числа |
| `recurringCharges.monthlyAroundDay` | Monthly, around day {{day}} | Щомісяця, близько {{day}} числа |
| `recurringCharges.monthlyLastDay` | Monthly, on the last day | Щомісяця, в останній день |
| `recurringCharges.monthly` | Monthly | Щомісяця |
| `recurringCharges.weekly` | Weekly | Щотижня |
| `recurringCharges.weeklyOn.monday` ... `.sunday` | Weekly, on Mondays ... | Щотижня, у понеділок / у вівторок / у середу / у четвер / у пʼятницю / у суботу / у неділю |
| `recurringCharges.yearly` | Yearly | Щороку |
| `recurringCharges.yearlyOn` | Yearly, on {{date}} | Щороку, {{date}} |
| `recurringCharges.paidSoFar` (new) | All paid so far | Усього сплачено |
| `recurringCharges.stoppedHeading` (removed) | was: No Recent Charge | was: Без нових списань |

Section 13's note on the uk past frame no longer holds: with "Charged" gone, the uk lines drop «Списувалося» as en drops the
verb. The Uncategorized group reads the existing `categories.uncategorized` through `neutralCategory()`; no key is added for it.

### 17.9 Open points for the user

- **P1, the group of a charge with no category.** The coordinator's answer F gives an "Uncategorized" group, last; kiko-domain
  says a null, empty or unknown category folds onto the default category, "never a separate 'uncategorized' bucket", and the
  series screen's rows already show such a charge as the default category. A: fold into the default category's group at its
  Categories place (one fold, the list and the series screen agree, no exception). B (written above, as answered): a separate
  "Uncategorized" group last for a null or empty category; the list then says "Uncategorized" where the series screen says
  "Other", and kiko-domain needs a documented exception. Switching to A drops one branch and one pin world.
- **P2, stopped series:** in their category group after the active ones (written above). The other way keeps a
  "No Recent Charge" section after the groups with its own category groups, so a category can show twice with two totals.
- **P3, Type and Amount in Exchange mode:** A (written above): the row in income/expense only, as the user's words name
  "Amount"; on a switch to Exchange the Type field widens to full width over "Value Out". B: Type pairs with "Value Out" in
  Exchange too, so it never moves; `ExchangeFields` (`src/screens/forms/exchange-fields/`) gains a leading slot, two more
  files. Recommendation A unless the reflow reads wrong on the device.
