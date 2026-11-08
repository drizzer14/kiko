# Table views and CSV export (1.4-tables)

Status: user rulings landed 2026-11-03 (section 12). Base: 57130e23c. Date: 2026-11-03.
Mock: https://claude.ai/artifact/Gdf4q6yqRGBq2mfwHCmznL (browser mock, example data only).

Line numbers are at the base commit. A builder re-greps them. "S" is
`src/screens/statistics/statistics.screen.tsx`. "Ruled" marks the user's ruling of section 12.

## 1. Intent

Kiko answers "how much money do I have now". The charts show the shape. The tables give the
exact monthly numbers behind the same data: where the money went (C1), what came in and what
stayed (C2), and how each account moved (C3). D1 lets the user take their own transactions out
of the app as a spreadsheet file.

Goals:
- C1 Category by month: categories in rows, months in columns, total and average.
- C2 Cash flow: income, expenses, net, savings rate, one column per month.
- C3 Net worth by month: accounts in rows, months in columns, change.
- D1 CSV export of the user's own transactions.

Non-goals (user ruling 2026-11-03): the holdings table, the transaction register, the merchants
table. Also: no target, budget or forecast. C2's savings rate looks backward only.

Anti-goals: a table total that differs from the chart for the same filter and range. A second
calculation of spending. A plain-text file that stays behind in the app's temp folder. A feature
hidden from a reviewer (Guideline 2.5.19).

## 2. Verified facts that change the source note

The source note (`memory/refs/table-views-ideas-2026-11-02.md`) was not researched. Checked at
the base:

| Source claim | Finding |
|---|---|
| "Landscape and the unfolded Duo show more" | iPhone is portrait only; iPad has all four orientations (`ios/Kiko/Info.plist:133-143`). No iPhone landscape in this track. Unlocking it would change the whole app. |
| Duo and wide windows | The Duo inner screen is 669 wide and is `single` mode, never "large" (`layout-mode.ts:8-25`). Panes cap content at `paneMaxWidth` 600 (`use-pane-screen.ts`), and `useContentCap` caps any `regular` window. Tables is `Screen uncapped` and a whole-window route shown in a layer over both panes, so it fills the window below the top-bar band (section 12, ruling 11). |
| C1 data: "Yes: category-breakdown, buckets" | Partly. Buckets are 1 or 7 days only (`buckets.ts:5-13`); no month helper exists in `src/`. |
| C2: "mostly, new calculation" | Correct. No income code exists; every builder skips `amountMinorUnits >= 0` (`category-breakdown.ts:180`). |
| C3: "Yes: net-worth-series, holding-value-at" | Partly. The series sums inside its reduce (`net-worth-series.ts:230-236`). No per-account series exists. |
| "A tap on a cell opens the transactions" | No such path exists. Section 8. |
| "CSV: help mentions import only" | Confirmed by code. The only `RNFS.writeFile` outside tests is `export-data.ts:56` (`.kiko`). All CSV code in `src` is import. |

Apple HIG, read 2026-11-03 through the JSON endpoint (lists-and-tables, layout, scroll-views,
typography, charts): the iOS section has no rule for wide tables or a frozen column. These rules
apply: "Use descriptive column headings in a multicolumn table"; "Determine layout based on size
classes, not device type or orientation"; a horizontal scroll view inside a vertical one is
allowed; "Keep text truncation to a minimum as font size increases"; "Avoid truncating text in
scrollable regions unless people can open a separate view". Apple's SwiftUI `Table` documents
horizontal scrolling for macOS only, so the frozen column is our own design, not a platform
pattern. It stays small and plain for that reason.

## 3. Which rate applies to each past month (the brief's question)

| Table | Rule | Same as | Effect |
|---|---|---|---|
| C1, C2 | Today's rate for every month (`category-breakdown.ts:204`, `category-trend.ts:168`, `rateTable = buildRateTable(rates)` at S:312) | Donut, trend | A past month's foreign-currency cell moves when today's rate moves. |
| C3 | The rate of the column's day (`net-worth-series.ts:215-225`, nearest history row at or before the day, `rate-history.repo.ts:55`); a month before a pair's first stored row uses that pair's earliest row (`net-worth-series.ts:215-220`); the current month uses live rates | Net worth line | Past cells are stable once history covers them. A backfill that adds earlier rows moves a month that used the earliest row. A currency with no history uses today's rate (`net-worth-series.ts:92-107`). |

Consequences, stated in the caption of each table:
- C1, C2 caption: the amounts are in the base currency at today's rate.
- C3 caption: at the rate of each month's end, or the earliest stored rate for a month before a currency's history starts;
  with no rate history, at today's rate.
- C2 net does not equal the C3 change, for two reasons: FX and revaluation. This is correct, and
  the help text says so. A transaction-date rate for C1 and C2 would break the match with the
  charts, which the brief binds. Changing the charts too is out of scope for this track.

A row with no convertible rate drops silently in the charts (`category-breakdown.ts:188`). The
tables inherit that through the shared path. In practice only an unrated crypto drops, because
the live table seeds fiat (`net-worth-view.ts:29-51`).

## 4. Shared calculation (binding: no second calculation)

The rule functions are shared today, but their composition is not: the union of seven id sets and
the synthetic loan rows live only in the screen's memos (S:782-989, S:840-886).

Design:
1. Extract `src/statistics/spending-ledger/`: a pure builder plus one hook. Input: the same reads
   as S. Output: `excludedTransactionIds` and the breakdown rows with the `loan-interest:` and
   `loan-excess:` rows. S moves onto it with no change in behavior. The existing Statistics
   suites are the proof, unchanged. The hook and the builder both call one shared union function
   (`excludedIdsOf`), so an exclusion set cannot land in only one of them; a test pins that the hook's
   output equals the builder's.
2. C1 calls `buildCategoryBreakdown` once per month, with that month's rows
   (`category-breakdown.ts:152`). So a cell IS the donut of that month, by construction. It works
   in minor units, as the donut does. The trend builder is not used: it has no month grain and
   returns major units.
3. C2 expenses are the sum of the same per-month slices with no category filter.
4. C2 income is new code, placed beside the breakdown, and takes the same id set. Section 6.
5. C3 needs a split of `buildNetWorthSeries`: a per-holding per-bucket core, with the existing
   total as its sum. `tableAt` and `bondRecognitionsFor` stay in one place. The line's suites stay
   unchanged.
6. A new local-time calendar month helper goes in `src/dates`. It is DST-safe, as `buckets.ts:21`
   is. `bucketDays` cannot express calendar months.

Proof rows (each is a test):
- For any month M and account filter: the C1 row for category K equals the donut slice for K with
  the range set to M. A property test sweeps change returns, loan rows, exchange legs and transfers.
- The C1 total column for a period equals the donut for that range.
- Each C3 "all" cell equals `buildNetWorthSeries` at that day.
- Divergence to pin: the donut filters by range before change-return netting, and the trend filters
  inside (S:840-859, `category-trend.ts:158`). Partition by month gives the donut's result, because a
  change return and its payment share a time (`category-trend.ts:132`).

## 5. Where the tables live, and the period

Ruled (Decision 1): an own screen, "Tables", `src/screens/tables/`, pushed from a button in Statistics. The
charts view does not change, apart from the button. Orchestrator's call: the button is an in-page row above the
filter bar, not a header item, because Statistics also shows as the Home companion pane, and one in-page path is
visible in every pane (Guideline 2.5.19). One untagged `Box` holds the filter bar and the button, so the pinned children of `statistics-blocks` stay as they are. The designer sets its look. The route registers in BOTH the Statistics and
the Home stacks: on a wide window Statistics is Home's companion, and a name the stack does not register is unhandled
(`statistics.stack.tsx` comment). `check:screen-imports` forbids a cross-screen import, so all shared code moves out of S:

- Reads: the screen's `useLiveQuery` reads move to one hook in `src/statistics/`, used by S and Tables, with the same
  `{cached: true, paused: !isVisible}` (S:226). The whole `price_points` read moves with its documented override
  (`docs/harness/documented-exceptions.md`, "kiko-no-whole-price-points-read"); that entry is updated in the same commit.
  The values derived from those reads move with them: `isReady`, `baseCurrency`, `defaultCategoryKey`, `rateTable`,
  `categoryByKey` with its override, `filtered`, `earliestTime`, `earliestLotDay` and `spanStart`.
- Backfill: the effect S:527-638 moves to one hook, used by S. This is a pure move. Tables also needs it: S's reads pause
  under a pushed screen, so S alone would not start a pending run while Tables shows. Two mounted hooks must not run twice,
  so the run gets a single flight and a shared status (section 7).
- Filter options and picks: pure builders move out of S, so Tables copies no archive or prune rule: `buildCategoryOptions`,
  `buildAccountOptions`, `visibleCategorySelection`, `excludedCategoryKeysOf`.

A `SegmentedControl` at the top of Tables switches the tables, with three parts: Categories, Cash flow, Net worth (tabs-vs-chips
rule, `component-set-forms.md`: the selection changes the appearance). It appears when a second table exists. The selection is a
route param of the screen (`setParams`), so a fold or a resize across the columns width, which remounts the screen
(`pane-stack-view`, "A switch between one pane and two"), keeps it; a new push still opens on Categories. The period (user ruling
2026-11-08) is held in the session store `use-tables-period-selection` (`src/statistics/`), so it also survives Back: a new push
opens on the period last picked, until the app is closed, and on the default only before a first pick. A kept period that the options
no longer offer reads as the default.
`resetTabStackOnBlur` pops the screen on a tab change, as for any pushed screen. The uk labels ("Категорії", "Рух коштів", "Капітал")
must fit: `labelVariant: 'caption'` is the first step. Measure at large sizes; if they do not fit, the builder reports it. Do not shrink
the text silently.

Period, ruled (Decision 2): the screen has its own date filter, separate from the shared date filter, which it neither reads nor
changes. Whole calendar months. Reason: the shared filter defaults
to the last 30 days (`default-range.ts:13`), which gives 2 columns, and a day-grain range cuts months in two. A month column equals
the donut when the shared date filter is set to the same whole month. Ruled: whole months, with no free range picker.

User ruling 2026-11-07 (replaces the first ruling, default "Last 12 months" plus each calendar year with data):
the options are This quarter, Last quarter, the other started quarters of this year, First half, Second half
(from 1 July), This year and Last year. The default and the fallback is This year. "Last 12 months" and
older years are removed. The option list and its builder are in the period code under `src/screens/tables/`;
read them there.

Filters on Tables: accounts for all three tables, and categories for C1 only, both from the shared store
(`use-statistics-filter-selection.ts`), so a pick in Statistics holds on Tables. C2 and C3 hide the category filter. A category
pick never changes C2 or C3. No currency filter exists.

The current month is a partial column, marked in the caption. Average = total of complete months /
count of complete months. The first complete month is the month after the first transaction of the
selected accounts, when that month is in the period. An empty month inside that span counts as zero.

## 6. C2 definitions

- Expenses: the sum of the month's slices, as the donut.
- Income: rows with `amountMinorUnits > 0` that are in none of the excluded ids, are not change
  returns (`changeGroupId`, already netted from expenses, `category-breakdown.ts:106-133`) and are
  not `setsBalance` rows, converted at today's rate. Reward rows (Binance Earn,
  `binance.earn-history.ts:143`) count as income. A real credit whose only partner is a `setsBalance`
  row is income (Decision 10).
- Net = income - expenses. Savings rate = net / income, null at zero income (shown as a dash, never 0
  or infinity); it can be negative, and shows as a negative percent.
- The total column's rate is total net / total income; the average column's is the same over complete
  months.

Ruled (Decision 9): ship this rule; the user reads C2 on real data on the device, and then decides on a per-row mark. The exclusion rules were written for spending, and the same id set
applied to credits gives these wrong income values on the user's own data. None of them changes a chart:
  - A refund has no model. A plain credit counts as income, while the charts keep the gross expense. Income and
    expenses are both too high; net stays right.
  - An own transfer that no rule catches counts as income: from a bank that is not in Kiko, outside the 2-minute
    window, or a one-sided sync (`internal-transfers.ts:17`).
  - The description rule is sign-blind (`transfer-exclusion.ts:71-76`). So a credit with "депозит" or "облігац" in its
    description is out of income: correct for a returned deposit, wrong for an interest or coupon payout.
  - The MCC rule is sign-blind too (`transfer-exclusion.ts:41`). So a credit with MCC 6011, 6012 or 6540 is out of income.
  - Loan proceeds that arrive as a plain credit count as income, while the loan itself shows as debt in C3.
  - A bank credit from a Binance fiat withdrawal or a P2P sale counts as income. Funding matches only positive exchange rows
    (`exchange-funding-match.ts`, `fundingOf`), the marked Spot debit of a withdrawal never pairs (`rowsForTransferMatch`), and a
    P2P sale is refused, so it has no row (`binance.p2p-history.ts`, `'p2p-sale'`). The user's ruling did not list this value, so the
    coordinator tells the user before the device read.
  - Term-deposit accruals are derived values, not rows (`term-deposit.descriptor.ts:124-140`). So they are not income.
    They show in C3.

The help text states what income means and which values can be wrong. Task 4's device check is the user's read. If the user then
wants the mark, it is a per-row "not income" or "income" mark on the transaction form: a migration, a form field and one more change set.

Pre-existing finding (Decision 7): `setsBalance` is read nowhere in `src/statistics` or S. So a
NEGATIVE opening or balance-set row (`holdings.repo.ts:575-585`, `accounts.repo.ts:458`) counts as
spending in the donut today, on the day it is set. Ruled: an addition to the shared id set removes it from charts and tables
together, as its own commit in change set 1. It changes today's charts for such rows. The same commit filters marked rows in
`loanInterestEntries`: a marked negative row linked to a loan through the form (`setLoanPayment` has no mark check) would otherwise
still emit its derived `loan-interest:` and `loan-excess:` rows, which carry other ids.

Ruled (Decision 10): a `setsBalance` row also leaves the matchers that pair rows for spending and income:
`rowsForTransferMatch` (so `internalTransferTransactionIds`), `exchangeFundingMatches` and `sameCurrencyMoveTransactionIds`.
Each filter lives in the matcher's own function, so charts, tables and the funding caption on the transaction form all follow
one path. It changes today's charts, as its own commit, the first of change set 4:
  - A real debit that a balance-set credit cancelled counts as spending again: the donut goes up.
  - A real debit that lost its credit, or its funding match, to a balance-set debit now pairs: the donut goes down.
  - A real credit that a balance-set debit cancelled counts as income.
  - A balance-set debit loses its funding caption, and a real debit of the same amount can take it.
The net worth line's `reconcileBondFunding` reads no spending or income and stays as it is. So does the change-return netting
(`sumReturnsByGroup`): it reads a stored group id, and no writer gives a balance-set row one.

## 7. C3 definitions

- Rows: one per account. A row is the sum of the account's holdings, in the same order as the Accounts
  screen. A loan or a debit card balance is negative and nets in the row, because the line nets it
  (`loan.descriptor.ts:25-55`). The pie is different: it splits debts (`account-contribution.ts:58-66`).
- Columns: the value at the local end of each month. The last column is today, with live rates, which is
  the line's last point.
- Change = last column - the value at the end of the month before the first column.
- Closed holdings are zero at or after `closedAt` (`net-worth-series.ts:197`). Archived accounts are out
  entirely (S:354-372), as in the line. Exclusions do not apply: balances use none (S:774-778).
- The backfill already covers the table's period: `runBackfill` takes `spanStart`, the earliest data (S:401, S:552), and never
  reads the date filter. Task 5 pins this.
- The hook of section 5 mounts in S and Tables over one module store. The store owns the covered span, the covered currency key,
  the restore on failure and the run status. A caller joins a run only on the same (span, currency key). A wider span or another
  currency key starts a new run, and the older run's settle is dropped, as `statistics.screen.test.tsx` pins today. A mount after a
  settled run starts no run. The store resets when no reader is left, deferred one `Promise.resolve().then(...)` with a
  `listeners.size === 0` re-check (kiko-architecture, "Shared UI state across screens"), and that reset also drops a late settle.
- While a run loads and the table has no values, Tables shows the design-system `LoadingState`, the same rule as the line, which
  shows its message only with no points. With values, the table shows them, as the line does. A failed backfill shows the fallback
  the caption states.

## 8. Tap on a cell (Decision 5)

No path exists today: Statistics has no tap into rows; `Home` takes no params and keeps its filters in
local state (`home.screen.tsx:300-301`); Home applies no exclusions and has no spending-only rule. So Home
cannot show rows that add up to a cell.

Ruled: a tap on a C1 cell, or on a C2 income or expense cell, opens a read-only list of the rows
behind the number, from the shared ledger, in native and base amounts, with a total equal to the cell. A
loan interest row shows its derived amount, and names the payment it came from. C2 net and rate cells and
all C3 cells do not open (no rows sum to them). This also answers the HIG line on truncation and gives the
exact value behind a rounded cell. With a held category pick, the All cell of C1 lists only the picked categories, so its
total equals the cell; C2's expense cell ignores the pick, as the C2 column does.

User ruling 2026-11-08, replacing "read-only" above: a tap on a row of the list closes it and opens
that transaction's form, as a row on Home does (a loan interest or fee row opens its payment, and a
synced row opens read-only). The form opens once the list has finished closing. If a form of that
transaction is already open under Tables, Tables closes and that form shows as it was, so no second
form holds the old values. A row has no touch-and-hold menu. The Tables help topic says it in one
sentence.

## 9. The table component (kiko:designer owns it)

`src/design-system/components/data-table/`. Its props are strings and display flags, plus two `ReactNode` props of the
caller's (`topContent`, `emptyContent`; see `data-table.props.d.ts`): column
headers and row text come from the caller, so `check:component-i18n-namespace` stays clean, and no money
logic sits in it. `SummaryTable` cannot be reused: it has no columns, header, fixed column or scroll. The
one horizontal scroller in the app (`raw-preview.component.tsx:55`) has no fixed column.

- Fixed first column, opaque `surface`, right edge `border` + `layout.hairline`. Header text `textSecondary`,
  row separators `border`. Negative values `negative`. Theme tokens only (`kiko-no-raw-color-literal`), so
  the light palette of `1.4-light-scheme` works with no edit. Do not assume a black background.
- Size from `onLayout`, never the window and never the device type (HIG size-class rule). Tables is `Screen uncapped`,
  so it is not held to the pane cap, and a horizontal scroll appears only when the columns overflow. When all columns fit, there is no scroll.
- Column widths come from measured text, so an amount is never cut, shrunk or wrapped: no
  `adjustsFontSizeToFit`. Row height comes from the taller of the fixed and scrolled parts, measured.
- First column: at most 40% of the width; labels wrap in full and never truncate.
- Dynamic Type: the app does not cap font scale (`maxFontSizeMultiplier` has zero hits). The table follows.
  Use `minHeight`, not `height`.
- Digits: `fontVariant: ['tabular-nums']`, a new path, because no code uses it today; `MoneyText`'s `style`
  Pick excludes it (`money-text.props.d.ts:37`). The designer adds it to the table's cell text.
- Column order (Decision 3), ruled: oldest to newest, as the charts read, with Total and Average (or
  Change) on the right. Opens scrolled so that the last 3 months show on a phone, with a part of the next
  column visible as the scroll hint. Sum columns have a `colors.sumTint` tint. The last row ("All") is bold.
- The header row stays visible on vertical scroll. RN has no sticky support in a horizontal list, so this is
  the first probe of the change set. Tables is its own screen, so the table owns its vertical scroll, and the header
  row is child 1 of that scroll (`stickyHeaderIndices={[1]}`), under the caption and `topContent`, and follows the horizontal offset. Measure before you build. Gestures: native arbitration of a horizontal scroll in a vertical page; no swipe
  actions (`kiko-gestures`). Check the iPad split and the edge swipe on a device.
- VoiceOver: one element per cell, label "<row>, <month>", value = the FULL amount, never rounded; role `button`
  and a hint only where a tap opens rows. Header cells are hidden from it, as the HIG says for chart axes,
  since each cell's label carries the context. The table has a summary caption. Device check owed: RN has no
  grid role.

Amounts in cells (Decision 4), ruled: whole major units, no currency symbol, base currency named in the
caption. Reason: 2-3 month columns fit on a phone only that way. A "Total" or "All" figure is not the sum of the
shown cells when a return falls in another month than its payment: it lowers the total, not the payment month's cell
(help step 9 says so). Never K/M suffixes: they are hardcoded in `compact.ts:13-18` and hide the amount. Formatting uses
the shared money path with the digits option the builder adds, not a new formatter. For a base currency with
0 decimals, no change.

## 10. D1 CSV export

Confirmed: no CSV export exists. New Settings row and screen, beside the `.kiko` row (`settings.screen.tsx:199-206`).
Note: `1.4-small` also edits that file, in other lines; the coordinator merges in either order.

- Scope (orchestrator's call): all transactions of all non-archived accounts, one file. Not a backup: the copy says so.
  Transactions excluded from Statistics stay in the file, with a `type` column. No date filter in this release.
  Holdings, balances and prices are out. Reason: narrowest reading of "own data" that a spreadsheet can use.
- Columns: `date`, `account`, `holding`, `amount`, `currency`, `category`, `description`, `comment`, `type`,
  `pending`, `source`. Header text in the app language. `type` is derived: expense, income, transfer, exchange,
  loan, balance.
- Left out: `counterIban`, `externalId`, every id, `iban`, `maskedPan`, `monobankId`, `lenderIban`, and all secrets.
  A Monobank holding name can hold the card mask by default (`sync.ts:291`); it stays, because the user sees that name
  in the app, and the warning mentions it. Binance Pay descriptions can name another person
  (`privacy-policy.en.md:70-71`); the warning mentions it.
- Amounts: signed decimal in the holding's currency, from `shiftDecimal` (`decimal.ts:91`), never `toMajor`, which
  returns a float (`1e-8`). No base-currency column: it would need a rate choice and would age.
- Dates: `YYYY-MM-DD HH:MM:SS` in device-local time, as the app shows it. Builder's call: no time-zone column.
- Encoding: UTF-8 with BOM, CRLF, RFC 4180 quotes. Papa strips the BOM on our own import (`papaparse.js:158`).
- Delimiter and decimal (Decision 6), ruled: follow the app language: uk `;` and `,`; en `,` and `.`. Excel
  behavior is from memory, not verified. A device or desktop check is owed in the change set.
- Formula safety: one pure cell function adds `'` before a text cell that starts with `=`, `+`, `-`, `@`, tab or
  CR. Never on `amount`: the prefix gives NaN in `parseAmountCell` (`amount.ts:67-82`). A matrix test pins it. Bank
  text is third-party input, and no rule covers this today.
- Re-import: `detectFormat` returns undefined for this file, so it goes through column mapping, which supports both
  delimiters, both decimals and this date format (`apply-column-mapping.ts:33-47`). Markers and transfers do not
  survive, and the `'` stays literal. The round trip is not a goal.
- Share path: reuse `Share.share` with `shareAnchorOf` and `toFileShareUrl` (a private const today; the task exports it); `useSubmitOnce`; `alertOnCatch`. No new
  dependency, permission or `NS*` key. `react-native-fs` is already linked, and the manifest already declares the
  needed reasons (not verified in native code).
- Temp file: write to `RNFS.TemporaryDirectoryPath`; delete when the share settles, even if the screen has unmounted since;
  delete leftover CSVs at app launch (`AppRoot` in `App.tsx`), which covers the app dying with the sheet open when the screen is
  never reopened; and when the screen opens, only with no share in flight, because a Duo fold remounts the screen while the sheet still
  shares the file. So the "re-share" button of the `.kiko` screen does not carry over. Precedent:
  `read-statement-file.ts:173-178`. Device check owed: `Share.share` resolves on dismissal per a code comment only.
  `.kiko` leaves its file behind today (`export-data.ts:54`): ciphertext, so this goes to the backlog.
- Warning and gate (Decision 8), ruled: the screen states that the file is not encrypted, and what it holds.
  The Share button then calls `confirmOwner` (Face ID or passcode), as `.kiko` does for secrets
  (`export-data.screen.tsx:57-81`). `noPasscode` proceeds with the warning, unlike `.kiko`, which refuses secrets there: with no passcode, the phone itself shows the same
data to anyone, and the secrets are the reason for that refusal.

### Privacy effect (the brief's question): the policy text MUST change

| Place | Now | Effect of D1 |
|---|---|---|
| `docs/privacy-policy.en.md:42-43` | "When you export your data, Kiko writes an encrypted file (AES-256-GCM)" | Wrong: not every export is encrypted. |
| `docs/privacy-policy.en.md:47` | "Keep the file and its key safe." | Incomplete: no key for a CSV. |
| `docs/privacy-policy.md:47-52` (uk) | Same statement | Same edit. |
| `docs/privacy-site/en.html:63`, `index.html:63` | Same | Regenerate with `npm run privacy:site -- build`. |
| `docs/security/README.md:255` | "Every export is an AES-256-GCM envelope" | Wrong: that holds for the `.kiko` export only. Name the `.kiko` file and state that the CSV is plain text. |
| `src/i18n/locales/en.ts:85`, `uk.ts:68` | `dataExport.description` "to an encrypted file" | Stays true for `.kiko`; the CSV screen has its own copy. |

Also true after D1: `:10` and `:27` ("stored only on your device"), since Kiko uploads nothing and the user chooses
where to share; the temp file is deleted. A draft goes in the change set: "Kiko has two exports. A backup is an
encrypted file (AES-256-GCM) with a key that is shown only to you. A CSV file is plain text, and anyone with the file
can read it." The effective date moves to the publish day of the release, and the site publishes with it, not before.

App Privacy stays "Data Not Collected": a share the user starts, no network, no new recipient (`kiko-compliance` :136-146;
`resubmission-kit.md:29-33`). `PrivacyInfo.xcprivacy` does not change. Encryption questions do not change: no new crypto.
The compliance skill has no rule on plain-text export: the scribe adds one.

## 11. Common rules

- i18n: every string in en and uk (`kiko-translator`). A new `tables` namespace at the screen level; the button in S stays under
  `statistics`. New `calendar.monthShort`
  keys, 3 letters (uk "вер", "лис"), with the year in the first column and in January. No `Intl`: dates are hand-assembled on
  purpose (`dates/format.ts:1-4`). The uk forms get a translator review.
- Help: `viewStatistics` (pinned step count 8, `help-topics.test.ts:165`) and `backupData` change; the same step greps the
  catalogue keys and pins. Help states the rate rule, C2's limits and that CSV is not a backup.
- Guideline 2.5.19: no flag. All of it shows in a release build. Demo `.kiko` files have transactions, so a reviewer sees data.
- Performance: Tables reads the same queries as S, through the shared hook. Compute only the selected table, inside a memo. What S does
  while Tables shows depends on the window:
  - One pane: S stays mounted under Tables, paused, and keeps its rows.
  - Statistics tab with two panes: Tables shows in a layer over both panes, and S stays mounted
    in its pane, not hidden: both panes keep their frames, the layer covers them and they are paused
    (`visibleKeys` holds only Tables), with its scroll kept. The opener (a form or Home) stays a route below.
  - Home tab with two panes: S is the companion's default and stays the stand-in, same key, never remounted
    (`realizeStaticDefault` is skipped for a whole-window route). No second S mounts, so no mount reads run; only Tables reads.
    The opener (form or Home) stays a route below.
    Back returns S as it was.
  Measure these on the device. Unknown: cell count and per-account memory. Measure on the device with the real data.
- Tests: `kiko-testing`; acceptance pins in section 4; AX and long uk labels in the component's render tests; device check per the
  ops checklist for phone, Duo and iPad, at the largest AX size.
- Mutation gates are paused (user 2026-10-25): verify + review only.

## 12. User rulings (2026-11-03, relayed by the coordinator)

| # | Decision | Ruling |
|---|---|---|
| 1 | Where the tables live | Own screen |
| 2 | Which months | Own date filter; whole months, with no free range picker; options and default replaced by the ruling of 2026-11-07 (section 5) |
| 3 | Column order | Oldest to newest |
| 4 | Amounts in cells | Whole units, currency in the caption |
| 5 | Tap on a cell | Opens the rows behind the number, in Categories and Cash flow |
| 6 | CSV delimiter and decimal | Follows the app language |
| 7 | Negative balance-set rows count as spending today | Remove from charts and tables together |
| 8 | CSV gate | A warning, then Face ID or passcode; on a device with no passcode, a warning, then allow |
| 9 | What counts as income (section 6) | Every credit that no exclusion rule catches; the user reads C2 on a device, then decides on a mark |
| 10 | Balance-set rows (`setsBalance`) in the matchers (section 6) | They leave the matchers too, in task 4 or earlier, one pin per pairing |

Rulings of 2026-11-04 (user, relayed by the coordinator):

| # | Decision | Ruling |
|---|---|---|
| 11 | Tables on a wide window | User on the Duo preview: "make "Tables" screen appear as a separate screen, and not a sub-screen of "STatistiscs" so that Duo displays is on full width. Access to "Tables" can be left where it is now, just move the button above statistics filters and double-check its visuals against iOS guidelines". Built as a whole-window route (`PaneConfig.wholeWindowRoutes`) shown in a layer over both panes; the tab bar stays, Back returns to the two panes. User ruling (relayed by the coordinator, 2026-11-04): "A: It stays (Recommended)": with a form or Home open beside Statistics, the Monthly tables press keeps it open (`openFrom` keeps all routes), and Back returns to it as it was. Implementation note, not a user ruling: the layer root has a shown header with an empty title that takes the page's bar appearance options (not the large title) only while a page is in the layer, and no header at rest, because a hidden root header hides the shared bar when a swipe starts (fault A); its native effect is a device point, not yet seen. Back after fold and unfold is open, with no found cause |
| 12 | Tables title | "A: Small title (Recommended)": a normal small title in an opaque bar, content below it, Tables only |
| 13 | Button size | "As it is now": 44 pt, full width (`size="compact"`) |
| 14 | Button chevron | "Remove it (Recommended)" |

## 13. Left to the builder

The sticky header technique; the file names under
`src/statistics`; the period control's component (`SelectField` or the filter bar's own button); the account order source.

## 14. Change sets

Named "1.4-tables task N/7". The numbers below are the plan's.

1. Shared ledger, reads hook, filter builders and backfill hook moved out of S; month helper; net worth core split. Decision 7's commit. No visible change except 7.
2. `DataTable` component (kiko:designer), with render tests and the sticky header probe.
3. Tables screen, route in both stacks, button in Statistics, C1, period, caption, help, en and uk.
4. Decision 10's commit first (step 1/6: balance-set rows leave the matchers, a chart change). Then C2: income, net, rate, the control's first two parts, help.
5. C3: per-account values, the control's third part, backfill single flight, help.
6. Tap on a cell (Decision 5).
7. D1: CSV writer, screen, share, cleanup, privacy text, compliance rule. Its own change set, and it does not depend on 1-6.

Change sets 2-5 show the feature only from 3 on. Sets 3-5 may merge in order into `next` independently, since each adds one complete,
visible table: the control's part appears only with its table, per the rule on text that names a later feature.
