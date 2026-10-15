# Help device feedback (help-flows task 3/3)

Base: `help-flows` tip `ce4cb552`. If `main` (category-rules `034d15fb`) has been merged in
first, that merge commit is the base for this change set and for its mutation run.
Every code fact below names a symbol or an anchor text. Re-grep each one on the actual base
before you write code.

Inputs: `memory/refs/help-device-feedback-2026-10-14.md` (4 device findings, 2 uk rulings, held
Minors); `docs/superpowers/plans/2026-10-14-help-flows.md` sections B, C, F. Where the plan text
and the shipped text differ, the shipped text in `src/i18n/locales/en.ts` / `uk.ts` under `help.*`
wins.

Run-log gaps (`run-log.mjs stats --gaps --repo kiko`): every open gap is a harness item
(h5/1 to h5/6, h7/1). This plan closes none of them and leaves all of them open.

Read before coding: kiko-design-system ("Locked decisions", `Button` "Footer 'Add …' buttons
carry the entity's leading symbol", "SF Symbol availability"), kiko-translator ("Casing follows
one rule per UI role", "Ukrainian catalogue rules", "Review new/changed keys"), kiko-code-style
("fnts FIRST", `match` over literal sets), kiko-charts, and `rules/semgrep-prewrite.yml`
(`kiko-test-title-no-history`, `kiko-kind-ternary-prefers-match`,
`kiko-no-source-text-read-in-test`, `kiko-no-change-language-in-test-body`).

Each test is written first and shown red for the right reason before its fix.

## 1. Code facts

### 1.1 Header layer (finding 1)
- Versions (`package.json`): react-native 0.87.1, `@react-navigation/native` 7.3.17,
  `@react-navigation/native-stack` 7.18.9, `@react-navigation/elements` 2.9.39,
  `react-native-screens` 4.27.0.
- Every tab stack uses `screenOptions={largeTitleScreenOptions}`
  (`src/navigation/large-title-screen-options/large-title-screen-options.ts`): it sets
  `headerLargeTitle: true` on all tiers, plus `headerBlurEffect` and `headerLargeStyle` below
  iOS 26. This is a locked visual ("iOS < 26 fallback look").
- No shared header component exists. Titles come from `options.title` in
  `settings.stack.tsx`, `accounts.stack.tsx`, `home-stack`, `statistics.stack.tsx`,
  `swapped-form-options.ts` (`accountFormOptions`, `holdingFormOptions`), and from
  `navigation.setOptions({ title })` in the screens.
- Researcher findings (2026-10-15, via the coordinator):
  - HIG toolbars "Titles" says to keep a title under 15 characters and allows an empty title
    area.
  - UIKit has no public multi-line large title. The `__largeTitleTwoLineMode` KVC key is private
    API: never use it.
  - `largeSubtitle` (iOS 26) is not mapped by react-native-screens 4.27.0.
  - `headerTitleStyle` has no `numberOfLines`, and a custom `headerTitle` is clipped at 44pt and
    loses the title animation.
- Fix choice: researcher option (1), applied app-wide by help-flows task 4/4 (see "Long titles"
  in section 3). A title that fits keeps the native large title; a title that does not fit
  shows in full as a wrapping heading, the first scroll content. The native chrome is never
  wrapped.

Title census (characters, en / uk; a 34pt bold large title on a 393pt iPhone holds about 18 to 20):

| Screen | Title source | en | uk | Can crop |
|---|---|---|---|---|
| HelpTopic editTransaction | `help.topics.editTransaction.title` | 40 | 41 (new «Редагування, дублювання чи видалення транзакції» 47) | yes |
| HelpTopic connectCrypto | `help.topics.connectCrypto.title` | 35 | 40 | yes |
| HelpTopic restoreData, systemSettings, importStatement, categoryRules, setReminder, useTemplates, manageCategories, addTransaction, backupData, connectMonobank | `help.topics.*.title` | 16 to 28 | 18 to 29 | yes (uk) |
| OwnershipChangeForm | `forms.ownershipChange.title` | 17 | 23 | likely (uk) |
| ReminderForm (edit) | `reminders.form.editTitle` | 13 | 22 | likely (uk) |
| TransactionForm (edit) | `forms.transaction.editTitle` | 16 | 21 | borderline (uk) |
| ColumnMapping | `columnMapping.title` | 11 | 20 | borderline (uk) |
| AccountDetail | `setOptions({ title: accountName })` in `account-detail.screen.tsx` | user data | user data | yes, unbounded |
| HoldingDetail | `setOptions({ title: holdingName })` in `holding-detail.screen.tsx` | user data | user data | yes, unbounded |
| CategoryForm (existing) | `setOptions({ title: displayName })` in `category-form.screen.tsx` | user data | user data | yes, unbounded |

### 1.2 Help footer (findings 2 and 3)
- `HelpAction` and `topicsById` are in `src/help/help-topics.ts`. The footer `match(helpAction)`
  is in `src/screens/settings/help-topic/help-topic.screen.tsx`. Six arms pass
  `icon: undefined`.
- Entry symbols in code:
  - `genericEntitySymbol` and `accountKindSymbol` are in
    `src/holdings/entity-symbols/entity-symbols.ts`.
  - `REMINDERS_BELL_SYMBOL` (`'bell'`) is in `src/design-system/edit-bar-item/edit-bar-item.ts`.
  - The Settings rows are call-site literals in `settings.screen.tsx`: `"gearshape"`,
    `"bell"`, `"square.and.arrow.down"`, `"square.and.arrow.up"`.
  - The Statistics tab icon is the call-site literal `'chart.xyaxis.line'` in
    `root.navigator.tsx`.
- `SettingsStackParamList` (in `src/navigation/types/types.d.ts`) registers these routes:
  - `AccountForm` with `{ initialKind?, draft? }`. `createSeed` in `account-form.screen.tsx`
    seeds `kind` from `initialKind` with no `draft`.
  - `HoldingForm` with `HoldingFormParams`, which includes `{ implicitKind }`. The implicit
    property or debt account is found or created on Save by `accountsRepo.createImplicitHolding`
    (`createHolding` in `holding-form.screen.tsx`). The title is `forms.account.addTitle`
    (`holdingFormOptions`, `headerTitle`). This is the same screen that "Add account", kind
    Property, swaps to (`swapToHoldingForm`).
  - `TransactionForm`, `Categories`, `TransactionTemplates`, `Reminders`, `ExportData`,
    `ImportData`, `System`.
- Both forms `goBack()` after Save, so in the Settings stack Save and Back both return to the
  Help topic. `StatisticsTab: undefined` is in `TabParamList`. A tab switch resets the Settings
  stack (`resetTabStackOnBlur`), as "Add account" (`openAccountForm`) already does today.

### 1.3 Statistics (finding 4)
`statistics.screen.tsx` (the `StatisticsScreen` doc comment and its render) and `src/statistics/*`:

- Filter bar: `FilterMenu` (`statistics.filterAccounts`, "Accounts") scopes every chart.
  `DateRangeField` (the calendar) bounds `rangeFrom` / `rangeTo`. The line, the category donut
  and the trend read the range. "By Type" and "Account Contribution" are "now" snapshots and
  read no range.
- "Net Worth Over Time" (`NetWorthLine`): net worth in the base currency over the range. The
  dashed baseline is `startReference`, the value at the range start. The stroke and fill are
  green at or above it and red below it (locked).
- "By Type" (`buildTypeBreakdown`): the current value per holding type, largest first. Assets
  only: loans are excluded, and a holding in debit is dropped.
- "Account Contribution" (`buildAccountContribution`): the positive current value per account,
  with a percent in the legend. "Debts" (`buildDebtTotal`) shows under it only when it is
  non-zero.
- "Expenses by Category": the range's expenses by category (`buildCategoryBreakdown`), with the
  total in the centre (`centerTotal`).
  - Its own "Categories" filter (`statistics-category-filter`) applies to this chart only.
  - The legend lists categories at 5% or more (`CATEGORY_LEGEND_MIN_SHARE`). "Show all"
    (`components.expandToggle.showAll`) lists the rest.
- "Spending Trend by Category" (`buildCategoryTrend`): spend per category per period over the
  range.
  - `TrendFilterField` offers "Manual" or "Top" 1 to 5 by "Contribution" (total), "Frequency"
    (count) or "Rising" (least-squares slope). The default is top 3 by contribution
    (`DEFAULT_TREND_FILTER`).
  - The trigger label is interpolated (`trendFilter.button.*`), so a step cannot quote it.
- Not spending (both spending charts):
  - own-account transfers and cash-out (`transfer-exclusion`, `internal-transfers`,
    `exchange-exclusion`);
  - a linked loan payment's principal. Its interest counts under "Loan interest"
    (`loanInterestEntries`, `categories.loan_interest`).

### 1.4 uk text
- The only «Торкн…» in `uk.ts` is `columnMapping.rawPreview`, which is in `TITLE_KEYS`.
  `uk.catalog-rules.test.ts` walks `flattenCatalog(uk)`. The tap-verb pin is
  `it('asks for every tap with the verb "натиснути"')` in `src/help/help-topics.test.ts` and
  covers help steps only.
- The 17-title pin is `it.each([...])('titles the %s topic «%s» and labels its row the same')`.
  Nothing asserts that it covers every `HELP_TOPICS` id.

## 2. Footer actions (findings 2 and 3)

Rule: a topic about creating one thing of a fixed kind gets that thing's create form. A topic
about managing a list keeps the list. A topic that needs a specific account or transaction
keeps no button (Q3), unless a specific action now lands on the right screen.
Q3 is reversed for viewStatistics only.

| Topic | Action, was: | Action, now | Target (navigate args) | Label key (en / uk) | Symbol (source) |
|---|---|---|---|---|---|
| addAccount | addAccount | addAccount (keep) | `openAccountForm` → `AccountsTab` / `AccountForm` | `accounts.addAccount` | `genericEntitySymbol.account` (has it) |
| connectMonobank | addAccount | addBankAccount | `'AccountForm', { initialKind: 'bank' }` | NEW `help.actions.addBankAccount` "Add bank account" / «Додати банківський рахунок» | `accountKindSymbol.bank` |
| connectCrypto | addAccount | addCryptoAccount | `'AccountForm', { initialKind: 'crypto' }` | NEW `help.actions.addCryptoAccount` "Add crypto account" / «Додати крипторахунок» | `accountKindSymbol.crypto` |
| importStatement | null | null (keep: needs an account) | none | none | none |
| setReminder | openReminders | openReminders (keep: steps 1-3 start on an account) | `'Reminders'` | `help.actions.openReminders` | `REMINDERS_BELL_SYMBOL` |
| addHolding | null | null (keep: needs an account) | none | none | none |
| trackProperty | addAccount | addProperty | `'HoldingForm', { implicitKind: 'property' }` | NEW `help.actions.addProperty` "Add property" / «Додати майно» | `accountKindSymbol.property` |
| trackLoan | addAccount | addLoan | `'HoldingForm', { implicitKind: 'debt' }` | NEW `help.actions.addLoan` "Add loan" / «Додати кредит» | `accountKindSymbol.debt` |
| addTransaction | addTransaction | keep | `'TransactionForm', {}` | `home.addTransaction` | `genericEntitySymbol.transaction` (has it) |
| editTransaction | null | null (keep: needs a transaction) | none | none | none |
| useTemplates | openTemplates | keep (step 4 edits on the list) | `'TransactionTemplates'` | `help.actions.openTemplates` | `genericEntitySymbol.template` |
| manageCategories | openCategories | keep (list topic) | `'Categories'` | `help.actions.openCategories` | `genericEntitySymbol.category` |
| categoryRules | openCategories | keep (a rule needs a category) | `'Categories'` | `help.actions.openCategories` | `genericEntitySymbol.category` |
| viewStatistics | null | openStatistics | `'StatisticsTab'` | NEW `help.actions.openStatistics` "Open statistics" / «Відкрити статистику» | Statistics tab symbol |
| backupData | openExportData | keep | `'ExportData'` | `help.actions.openExportData` | Export Data row symbol |
| restoreData | openImportData | keep | `'ImportData'` | `help.actions.openImportData` | Import Data row symbol |
| systemSettings | openSystem | keep | `'System'` | `help.actions.openSystem` | System row symbol |

The new keys follow the `help.actions` comment in `en.ts`: sentence case, no final ".". The uk
keys stay in step with the en keys (parity test). The user reviews the 5 new keys before deploy
(kiko-translator "Review new/changed keys").

## 3. Change set: help-flows task 3/3

One change set, one commit per step. Each tip can ship on its own. It has about 12 mutable
`src` files, under the 30-file cap; confirm the count with `make mutable`.

### step 1/5: uk rulings and held Minors (text only)
Files: `src/i18n/locales/uk.ts`, `src/i18n/locales/uk.catalog-rules.test.ts`,
`src/help/help-topics.test.ts`.
- Test first:
  - In `uk.catalog-rules.test.ts`, add a rule: no string value matches
    `/торкн|тапн|тицн|клацн/i` across `flattenCatalog(uk)`. It is red on `columnMapping.rawPreview`.
  - In `help-topics.test.ts`, remove the help-only negative half of the tap-verb `it`. Keep the
    `натисн` count as the help-only positive pin, renamed to say what it checks.
  - In the 17-title `it.each`, set editTransaction to
    «Редагування, дублювання чи видалення транзакції» (red).
  - Add `it('covers every help topic')`: the table's ids equal `HELP_TOPICS.map(id)` in order.
    Hoist the table to a `const`.
  - Pin importStatement uk step 5 to contain «рядок із назвами», and categoryRules uk step 1 to
    contain «натисніть «Категорії», а потім потрібну категорію» (both red).
- Fix in `uk.ts`:
  - `columnMapping.rawPreview` = «Натисніть рядок із назвами стовпців».
  - `help.topics.editTransaction.title` and `rowLabel` = «Редагування, дублювання чи видалення
    транзакції».
  - importStatement step 5 = «рядок із назвами».
  - categoryRules step 1 = «Відкрийте вкладку «Налаштування», натисніть «Категорії», а потім
    потрібну категорію.»
- Held Nit: put the help-topics.test.ts `describe` titles in the present tense, and make the cut
  to the substring `it.each` that the held review note names. The coordinator supplies the
  review line (see Q8).
- Check: `npx jest src/i18n/locales src/help`, `npm run check:lint`, and
  `npm run check:full-word-identifiers` on the touched files.

### step 2/5: one source for entry symbols, and an icon on every footer
Files:
- new `src/navigation/entry-symbols/entry-symbols.ts` and `index.ts` (the owner is per
  kiko-architecture; re-check the folder rule);
- `src/screens/settings/settings/settings.screen.tsx`;
- `src/navigation/root-navigator/root.navigator.tsx`;
- `src/screens/settings/help-topic/help-topic.screen.tsx` and its test;
- `__tests__/symbol-deployment-target.test.tsx`, only if the guard needs the new map listed.

Steps:
- Test first in `help-topic.screen.test.tsx`: an `it.each` over every topic with an action
  asserts that the footer `Button`'s `icon` equals the table's symbol, read from the source map
  and never a retyped string. It is red on the six `undefined` arms.
- Add `entrySymbol = { system, reminders, importData, exportData, statistics }`, built from the
  current literals (reminders = `REMINDERS_BELL_SYMBOL`). `settings.screen.tsx` and the
  Statistics `tabBarIcon` read it, so the Help footer and its target's entry cannot drift
  ("Fix divergent twins").
- Fill each `icon` arm.

Check: the Settings and root navigator tests stay green; `npm run check:screen-imports` and
`npm run check:feature-imports`; the symbol guard is green (every symbol already exists on iOS
18.2).

### step 3/5: more specific footer actions
Files: `src/help/help-topics.ts`, `src/screens/settings/help-topic/help-topic.screen.tsx` and
its test, `src/help/help-topics.test.ts`, `src/i18n/locales/en.ts`, `uk.ts`.
- Test first:
  - Update the action `it.each` in `help-topics.test.ts` to the "now" column.
  - In the screen test, update the target `it.each` to each new topic's label and its exact
    `navigate` args from the table. One call is expected.
  - Narrow the no-action `describe.each` to `importStatement`, `addHolding` and
    `editTransaction`. Red before the fix.
- Fix:
  - `HelpAction` gains `addBankAccount | addCryptoAccount | addProperty | addLoan |
    openStatistics`, and each topic's `action` is set per the table.
  - The screen's `match` grows one arm per new action and stays `.exhaustive()`. To keep the
    component under its complexity budget, move the `match` to a module-level
    `footerActionFor(helpAction, t, navigation)`.
  - The new form actions navigate within the Settings stack. `openStatistics` navigates to
    `'StatisticsTab'` through the composite props.
  - Add the 5 keys to `en.ts` and `uk.ts`.
- The quoted-label check is unaffected (footer labels are not step text).
- Check: `npx jest src/help src/screens/settings src/i18n`; the en casing and final-stop
  tests; `npm run check:typecheck`.

### step 4/5: viewStatistics explains each chart
Files: `src/i18n/locales/en.ts`, `uk.ts`, `src/help/help-topics.ts` (`stepKeys`),
`src/help/help-topics.test.ts` (step count).
- Test first: set the step count `it.each` for viewStatistics to 8 (red). The existing
  quoted-label tests, the casing test, the final-stop test and the tap-verb test cover the new
  text.
- Draft text. The developer checks every claim against §1.3 code, quotes only catalogue strings,
  and lets the user review the uk text.
  1. en: Open the "Statistics" tab. "Accounts" at the top chooses the accounts that every chart
     counts. The calendar beside it chooses the dates for "Net Worth Over Time" and the two
     spending charts.
     uk: Відкрийте вкладку «Статистика». Фільтр «Рахунки» вгорі обирає рахунки для всіх
     графіків, а календар поруч — дати для графіків «Капітал з часом» і двох графіків витрат.
  2. en: "Net Worth Over Time" shows your net worth across those dates. The dashed line is its
     value on the first day: the line is green above it and red below it.
     uk: «Капітал з часом» показує ваш капітал за ці дати. Пунктирна лінія — його значення в
     перший день: вище за неї графік зелений, нижче — червоний.
  3. en: "By Type" shows what your assets are worth today by holding type, largest first. Loans
     are not part of it.
     uk: «За типом» показує, скільки сьогодні коштують ваші активи кожного типу, від
     найбільшого. Кредитів тут немає.
  4. en: "Account Contribution" shows each account's share of what you own today. "Debts" below
     it adds up what you owe.
     uk: «Внесок рахунків» показує частку кожного рахунку в тому, що ви маєте сьогодні.
     «Борги» під ним підсумовують те, що ви винні.
  5. en: "Expenses by Category" shows your spending over the chosen dates, with the total in the
     middle. "Categories" chooses which categories it counts. The list shows categories of 5% or
     more, and "Show all" shows the rest.
     uk: «Витрати за категоріями» показує ваші витрати за обрані дати, а в центрі — їх суму.
     Фільтр «Категорії» обирає, які категорії враховувати. Список показує категорії від 5%, а
     «Показати всі» — решту.
  6. en: "Spending Trend by Category" shows how much each category cost in each period. Tap the
     button above the chart to pick categories yourself ("Manual") or the top ones ("Top") by
     "Contribution", "Frequency", or "Rising".
     uk: «Тренд витрат за категоріями» показує, скільки коштувала кожна категорія в кожному
     періоді. Натисніть кнопку над графіком, щоб обрати категорії самостійно («Вручну») або
     найбільші («Топ») за «Внеском», «Частотою» чи «Зростанням».
  7. en: Transfers between your own accounts and wallets, currency exchanges, and cash
     withdrawals from your bank do not count as spending. In a linked loan payment, only the
     interest counts, under "Loan interest".
     uk: Перекази між власними рахунками й гаманцями, обміни валют і зняття готівки в банку не
     вважаються витратами. У пов’язаному платежі за кредитом ураховано лише відсотки — у
     категорії «Відсотки за кредитом».
  8. The current step 4 (base currency), unchanged in en and uk.
- Check: `npx jest src/help src/i18n`.

### Long titles: help-flows task 4/4 (own change set)

Long navigation titles are one app-wide problem (the Help topics, the edit forms, and the
user-named account, holding and category screens), so they have their own change set and plan:
help-flows task 4/4, Option 1. This change set (task 3/3) carries no title code.

**Option 1: measured fit, wrapping large-title heading, native chrome kept.**
- One navigator `screenLayout` on all four large-title stacks decides per screen, from the
  merged `options.title` (so `setOptions` titles are covered), whether the title fits one line
  of the native large title. The test is a hidden measuring `Text` with the same font (34pt
  bold, no font scaling) at the available width: it fits when its height is under 1.5 lines.
  A cautious JS width estimate decides on the first render; the layout measurement refines it.
  A measurement that gives nothing usable, or a width of nothing or less, counts as "fits".
- The title fits: the native large title, exactly as today.
- The title does not fit: the options are `headerLargeTitle: false`, `headerTransparent: true`,
  `headerShadowVisible: true` and `headerTitle: ''` at rest; `title` is unchanged. Switching the
  large title off alone would make native-stack's bar opaque (it ties `translucent` and the
  transparent background to the large title), and react-native-screens lays an opaque bar's
  content out below it. `headerTransparent` keeps the bar translucent with the transparent
  background, so the content lays out under the bar and rests at minus the header height, as
  under a large title; `headerShadowVisible` keeps the bar shadow `headerTransparent` would hide.
  The blur options stay those of the stack (`largeTitleScreenOptions`): below iOS 26 the bar is
  transparent at rest (`headerLargeStyle`) and blurred (`headerBlurEffect`) once content scrolls
  under it, the locked fallback look; iOS 26+ gets no extra option. The full title wraps as the
  first scroll content in `<Text variant="largeTitle">` (role header, theme tokens only),
  hidden from VoiceOver once it has scrolled under the bar. After it scrolls under the bar, the
  inline bar title shows the full title (UIKit truncates it in the middle). The bar changes only
  after the screen has rendered the heading (the heading reports it through the context); a
  screen that never renders it keeps its native bar. The back label of a screen pushed from a
  heading-mode screen reads "Back".
- The hook wraps screen content only, never the native chrome or the safe areas.

**Rulings (overnight defaults, the user may switch in the morning).**
- D1: the original title text stays and is fully readable. No shorter name is applied (the
  table below is the user's menu), and there is no shrink-to-fit Option 2.
- D2: the heading is the design-system `Text` variant `largeTitle` (34pt, weight 700, line
  height 41, no Dynamic Type), with no inline style values.
- Skip the device spike: no app launch is needed to build this. The first-frame flash, the
  16pt margin on wide phones, the back label on iOS 18 and the iOS 18 bar look are checked
  live by the user afterwards.

**Shorter names: the user's menu.** Estimates at 375pt (343pt of title width) with SF Pro Bold
at 34pt, about +-10%; the runtime measurement makes the real decision. No alternative is
applied by default. Each pick is a kiko-translator wording edit with a key review. uk help
titles keep the noun form, en titles stay Title Case, uk stays sentence case, and brand names
stay as written. An alternative that equals another title (setReminder, manageCategories,
viewStatistics) repeats the back-button label. The user ruled «Редагування» over «Зміна» for
editTransaction, so the «Зміна …» form-title alternatives may not suit; the other alternative
is the bare noun («Транзакція»).

Over 343pt (crops):

| Key | en | est. pt | uk | est. pt | Shorter alternative (user's pick) |
|---|---|---|---|---|---|
| help.topics.editTransaction.title | Edit, Duplicate, or Delete a Transaction | 648 | Редагування, дублювання чи видалення транзакції | 893 | en "Edit a Transaction" (305); uk «Дії з транзакцією» (287) |
| help.topics.connectCrypto.title | Connect Binance or a Bitcoin Wallet | 590 | Підключення Binance або гаманця Біткоїна | 759 | en "Connect Crypto" (257); uk «Binance і Біткоїн» (287) |
| help.topics.systemSettings.title | Language and App Lock | 399 | Мова й блокування застосунку | 541 | en "Language and Lock" (327); uk «Мова й блокування» (339, borderline) |
| help.topics.restoreData.title | Restore a Backup | 293 | Відновлення з резервної копії | 510 | uk «Відновлення копії» (315) |
| help.topics.setReminder.title | Set Up a Reminder | 305 | Налаштування нагадування | 492 | uk «Нагадування» (228; same as the Reminders title) |
| help.topics.importStatement.title | Import a Bank Statement | 413 | Імпорт банківської виписки | 491 | en "Import a Statement" (320); uk «Імпорт виписки» (274) |
| help.topics.categoryRules.title | Set Categories Automatically | 485 | Автоматичні категорії | 390 | en "Category Rules" (253); uk «Правила категорій» (327) |
| help.topics.manageCategories.title | Manage Categories | 322 | Керування категоріями | 419 | uk «Категорії» (162; same as the group title) |
| help.topics.connectMonobank.title | Connect Monobank | 319 | Підключення Monobank | 412 | uk «Monobank» (173) |
| help.topics.backupData.title | Back Up Your Data | 309 | Резервна копія даних | 375 | uk «Резервна копія» (262) |
| help.topics.addTransaction.title | Add a Transaction | 302 | Додавання транзакції | 373 | uk «Нова транзакція» (279) |
| help.topics.viewStatistics.title | Read Your Statistics | 342 (borderline) | Перегляд статистики | 371 | en "Your Statistics" (249); uk «Статистика» (199) |
| help.topics.useTemplates.title | Use Transaction Templates | 460 | Шаблони транзакцій | 347 | en "Templates" (177); uk «Шаблони» (154) |
| transactionTemplates.title | Transaction Templates | 387 | Шаблони транзакцій | 347 | en "Templates"; uk «Шаблони» |
| reminders.form.editTitle | Edit Reminder | 233 | Редагувати нагадування | 437 | uk «Зміна нагадування» (337, borderline) |
| forms.ownershipChange.title | Edit Share Change | 306 | Редагувати зміну частки | 434 | uk «Зміна частки» (233) |
| forms.transaction.editTitle | Edit Transaction | 276 | Редагувати транзакцію | 405 | uk «Зміна транзакції» (286) |
| ruleForm.editTitle | Edit Rule | 149 | Редагування правила | 383 | uk «Зміна правила» (258) |
| columnMapping.title | Map Columns | 225 | Зіставлення стовпців | 376 | uk «Вибір стовпців» (258) |
| forms.account.editTitle | Edit Account | 213 | Редагувати рахунок | 358 | uk «Зміна рахунку» (258) |
| forms.transaction.editTemplateTitle | Edit Template | 233 | Редагувати шаблон | 346 | uk «Зміна шаблону» (267) |
| help.topics.addAccount.title | Add an Account | 259 | Додавання рахунку | 345 | uk «Новий рахунок» (262) |

Borderline (300 to 343pt, within the error): forms.holding.editLoanTitle «Редагувати кредит»
333; forms.transaction.addTitle «Додати транзакцію» 326; statementImport.previewHeading 320/320;
reminders.form.createTitle «Нове нагадування» 320; help.topics.addHolding.title
«Додавання активу» 320; forms.holding.editTitle «Редагувати актив» 312; help.groups.holdings
"Holdings and Loans" 326 / «Активи й кредити» 304; forms.pricePoint.title «Оновити вартість»
302; forms.pricePoint.loanTitle "Update Outstanding" 327. Every other nav title is 300pt or
less.

### step 5/5: gates
- `npm run check:all` (project-wide, including `check:import-order`,
  `check:blank-line-separation` and `check:comment-line-width`).
- `make verify` once on the final tip, run until it is green.
- `KIKO_MUTATION_BASE=<this change set's base sha> make mutable` gives the file count for
  BATCH READY. The coordinator runs `KIKO_MUTATION_BASE=<base sha> make deep` detached for this
  change set only.
- Live device check by the user: the titles, the footer icons and actions, and the statistics
  text.

### Close-out (after code, owned by kiko:retrospect, then kiko:scribe)
- kiko-translator: uk help titles take the noun form, «Натисніть» is the tap verb app-wide
  (pinned in `uk.catalog-rules.test.ts`), and «Утримуйте» is used for a long press.
- kiko-design-system:
  - The Help footer symbol rule: every Help footer button carries its target entry's symbol from
    `entrySymbol` or the entity maps. This includes "Open …" buttons, which differs from the
    contract's text-only "Update value".
  - Correct the line "there is no 'Add loan' footer" (Help now has one, through the implicit
    create flow).
- The long-title close-out (the fitting-large-title pattern, the `largeTitle` token, the
  locked-decision entry) belongs to task 4/4.
- kiko-architecture: `entrySymbol`'s home.
- `docs/superpowers/plans/2026-10-14-help-flows.md` F: add the Q3 reversal for viewStatistics.

## 4. Overlap with category-rules (`034d15fb`)
That commit touches `category-form.screen.tsx`, its test, and `kiko-design-system/SKILL.md`.
This plan does not touch CategoryForm: task 4/4 covers its title through the navigator layer
and edits no screen file for it. Only the scribe step's `kiko-design-system/SKILL.md` edit overlaps. Merge `main` into help-flows
before the scribe step, and before code if it has already landed.

## 5. Compliance (kiko-compliance, Guideline 5.6)
- Every new action opens a screen a release build shows: no flag and no hidden route.
- The statistics text describes only shipped charts and filters, and each quoted label is a
  shipped catalogue string (quoted-label pin).
- No private API: `__largeTitleTwoLineMode` is excluded by name.
- The trademark rule is unchanged.

## 6. Questions (one recommendation each)
The long-title questions (Q1 to Q3: the bar title, the fixed titles outside Help, the
user-named titles) are answered by help-flows task 4/4: see "Long titles" in section 3.
- **Q4. Where the new form actions open.** Recommend the Settings stack, as "Add transaction"
  does today, so Save and Back return to the Help topic. "Add account" keeps its pinned
  Accounts-tab route.
- **Q5. Kind-specific glyph for "Add bank account" / "Add crypto account" / "Add property" /
  "Add loan".** Recommend `accountKindSymbol[kind]`, the glyph the kind sheet shows, over the
  generic `tray`.
- **Q6. useTemplates and manageCategories: "Add …" instead of "Open …"?** Recommend keeping
  "Open …". Both topics cover editing and deleting on the list, and a create form would land
  past it.
- **Q7. viewStatistics gets "Open statistics" (reverses Q3 for this topic only).** Recommend
  yes. It lands on the exact screen the steps describe. Leaving the tab resets the Settings
  stack, as "Add account" does today.
- **Q8. The held Nit "substring it.each cut".** Recommend the coordinator quote the review
  line into the developer brief. The plan does not guess which `it.each` it means.
