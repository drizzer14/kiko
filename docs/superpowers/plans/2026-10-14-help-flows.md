# Help flows: implementation plan

> For the developer: work tests-first (superpowers:test-driven-development). Every code fact
> below names a symbol or anchor text, not a line number. Re-grep each one on the actual base
> before you rely on it; the base moves. Every quoted UI label is an `en.ts`/`uk.ts` value as of
> base `ad36c4cb`; the quoted-label test in task 2/2 re-checks all of them mechanically.

**Goal.** Group the Help page into sections and add a topic for each main flow, en and uk, with
`manageCategories` rewritten to match the category screen as it is today. The Divider before the
category rules belongs to another track; this track does not touch `src/screens/forms/category-form/`.

**Track:** `help-flows`. Worktree `/Users/drizzer14/orca/workspaces/pff-ios/help-flows`, branch
`help-flows`, base `main` `ad36c4cb`.

**Run-log gaps** (`run-log.mjs stats --gaps --repo kiko`): G1 to G8 are all open, all from
`20261013T2223-kiko-harness-h5`, and all are harness gaps (mutation whole-file rule, kind-ternary
sweep, medium.sh doc suites, comment-width mechanization, H5 deferred Minors, harness sync, queue
cutover, CLAUDE.md trim). This plan closes none of them and leaves all eight open. G5 rides the
next harness change set, and this track is not one.

---

## A. Main user flows today (inventory)

Labels are `en.ts` values; the key is in brackets. Tabs: Home, Accounts, Statistics, Settings
(`TabParamList`, `src/navigation/types/types.d.ts`).

| # | Flow | Entry point | Real step sequence | Files |
|---|---|---|---|---|
| 1 | Add an account (any kind) | Accounts tab, footer "Add account" (`accounts.addAccount`). Also the no-accounts empty state on Home and Statistics | "Kind" (`forms.account.kind`) picker: "Bank", "Cash", "Crypto", "Property", "Precious metals", "Debt", "Broker" (`forms.account.<kind>`), then name, icon, "Color", then the fields for that kind. Cash needs "Currency" and "Initial value". Bank opens "Synchronization" with "Bank type". Broker opens "Broker". Save is in the nav bar. Property and Debt swap to the holding form (`swapToHoldingForm`) | `src/screens/accounts/accounts.screen.tsx`, `src/screens/forms/account-form/account-form.screen.tsx`, `src/screens/forms/account-kind-field/`, `src/screens/forms/bank-type-field/`, `src/screens/forms/broker-type-field/`, `src/navigation/open-account-form/` |
| 2 | Monobank sync | Account form for kind Bank: "Bank type" Monobank. Or, on an existing account, AccountDetail "Synchronization" and then "Add a bank" (`accountDetail.addBankAction`), which opens the sheet "Add a Bank" | "Open api.monobank.ua", paste "Token", tap "Connect Monobank". The status reads "Connected as {{name}}". AccountDetail then shows "Sync", "Disconnect" and "Last sync: {{time}}". Home: pull to refresh runs `syncAll` | `src/design-system/components/monobank-connect-field/`, `src/design-system/components/monobank-token-input/`, `src/screens/account-detail/bank-sync-section/`, `src/screens/account-detail/add-bank-sheet/`, `src/screens/account-detail/sync-disconnect-actions-row/`, `src/screens/home/use-refresh-control-signal.ts` |
| 3 | Other banks | "Bank type" shows the catalogue (`bankCatalog`, `src/bank-sync/bank-catalog/bank-catalog.ts`: monobank, privatbank, sensebank, procredit, ukrsib, alfa, pumb, oschadbank, raiffeisen, ukrgasbank) plus "Other bank". Subtitles: "Connect and import statements.", "Statement import only — no live connection.", "Import with column mapping" | Save, then import a statement (flow 5). The hint reads "You can import a statement for this bank after saving." | same as 1 |
| 4 | Crypto sync (Binance, Bitcoin wallet) | Account form for kind Crypto, or AccountDetail "Synchronization" | "Source" (`accountDetail.sourceLabel`): "Wallet" or "Binance". Binance: "Open Binance API management", "API key", "API secret", "Connect Binance". Wallet: BTC address, then "Connect wallet". Shows the Keychain disclosure | `src/design-system/components/crypto-sync-form/`, `src/design-system/components/binance-credentials-field/`, `src/design-system/components/wallet-address-field/`, `src/screens/account-detail/crypto-sync-section/` |
| 5 | Statement import | AccountDetail "Import statement" (`accountDetail.importStatement`), on every bank account that no sync owns | Choose a file, then the StatementImport preview ("Transactions", "Date range", "Currency", "Example transaction"), then "Import" in the footer, then the sheet "Import Complete" with "Done". If the file is unrecognized: "We don't recognize this file's format…". Afterwards, the reminder offer "Want a reminder to import your next statement?" | `src/screens/statement-import/statement-import.screen.tsx`, `src/screens/statement-import/statement-import-footer/`, `src/statement-import/use-import-result-sheet/`; skill kiko-statement-import "Entry points" |
| 6 | Column mapping | "Map columns manually" on StatementImport. A column-mapping-only bank opens it by itself (auto-`replace`, `ownsFile`) | Screen "Map Columns": "Tap the Row with the Column Names", then the sections "File Format", "Dates", "Amount Columns" ("One amount column" or "Debit and credit columns"), "Currency" ("Currency column" or "Currency for all rows"), "Additional Details", then "Result", then "Import". A saved mapping pre-fills: "Your saved column mapping is applied…" | `src/screens/column-mapping/column-mapping.screen.tsx`, `src/screens/column-mapping/column-mapping-form/`, `src/statement-import/column-mapping/saved-mapping.ts` |
| 7 | Holdings | AccountDetail "Add holding" (`accountDetail.addHolding`) | "Type" by account kind (`holdingTypes` map, `src/holdings/holding-type/holding-type.ts`): bank: card, term deposit, bond, jar, metal. Broker: bond, cash. Crypto: crypto asset. Cash: cash. Metals: metal. HoldingDetail footer (`holdingDetailSpecs`): card, cash, crypto asset and jar get "Add transaction" (none when synced). Term deposit gets "Add contribution". Metal gets "Add lot" ("Buy"/"Sell"). Property and loan get "Update value" or "Update outstanding". Bond gets none. A bond can use ISIN mode against the NBU register ("Not in the NBU register.") | `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/forms/holding-form/`, `src/screens/holding-detail/holding-detail.screen.tsx`, `src/screens/holding-detail/holding-detail-spec/holding-detail-spec.ts`, `src/screens/forms/lot-form/`, `src/screens/forms/contribution-form/`, `src/screens/forms/price-point-form/` |
| 8 | Prices | Automatic | Crypto prices come from CoinGecko. Metal prices come from NBU. Property gets a manual "Update value" (PricePointForm "Update Value") | skill kiko-pricing; `src/prices/`, `src/rates/` |
| 9 | Property | "Add account", kind "Property" (implicit account) | Holding form: category ("Real estate", "Vehicle", "Valuable", "Business share", "Loan given", "Other"), "Cost", "Ownership". Listed under "Properties" (`accounts.implicitName.property`). HoldingDetail: "Update value", "Share Changes" | `src/screens/forms/holding-form/property/`, `src/screens/accounts/implicit-account-heading/`, `src/screens/holding-detail/share-changes/` |
| 10 | Loans and debts | "Add account", kind "Debt" (implicit account) | "Add Loan": loan kind ("Mortgage", "Car loan", "Consumer loan", "From a person"), "Principal", "Annual rate", "Start date", "Term", "Schedule" ("Annuity", "Differentiated", "No schedule"), "Paid from". Listed under "Loans". HoldingDetail: "Upcoming Payments", "Linked Payments", "Update outstanding". The transaction form has a "Loan payment" field and shows "Linked automatically." | `src/screens/forms/holding-form/loan/`, `src/screens/holding-detail/upcoming-payments/`, `src/screens/forms/loan-payment-field/` |
| 11 | Add a transaction | Home FAB "+" (a11y "Add transaction", `home.addTransaction`), or HoldingDetail "Add transaction" | "Type" (`forms.transaction.type`): "Expense", "Income", "Exchange", "Split". Then holding, amount, "Description", "Category". Save is in the nav bar. A category the user picked by hand (or any category change on an edit) with a non-blank name opens the sheet "Apply Category to All" with "Apply" or "Just for this one" (`offersCategoryNameRule`, `resolveCategoryOverrideRequest`) | `src/screens/home/add-transaction-fab/`, `src/screens/forms/transaction-form/transaction-form.screen.tsx`, `src/screens/forms/transaction-form/category-rule/category-rule.ts`, `src/screens/forms/transaction-form/category-override-sheet/` |
| 12 | Edit, duplicate or delete a transaction | Home list or HoldingDetail list: tap a row, or touch and hold it (`CardContextMenu`) | Tap: edit, then Save. A synced or imported row says "This was synced, so only the category and loan link can be changed." Hold: "Edit", "Duplicate" (manual rows only: `onDuplicate={isSynced ? undefined : …}`, which opens `duplicateOfTransactionId`), "Delete". Home filters: "Accounts", "Categories", and the calendar date-range button | `src/screens/home/home.screen.tsx` (`handleRowDuplicate`), `src/screens/home/transaction-row/`, `src/screens/home/transaction-filter-bar/`, `src/design-system/components/card-context-menu/` |
| 13 | Transaction templates | Settings tab, "Transaction templates" (`settings.transactionTemplates`). Or the form toggle "Save as a new template" | List: "Add template". Tap a template to edit it, hold it to delete it. Use one: the form's entry tabs "Manual" / "Template", then "Select a template" | `src/screens/settings/transaction-templates/`, `src/screens/forms/transaction-form/entry-tabs/` |
| 14 | Categories | Settings tab, "Categories" (`settings.categories`) | List: footer "Add category". Tap a row to open CategoryForm (`navigate('CategoryForm', { categoryKey })`). Hold a row to delete it (not the default category). Category screen: name, icon, "Color". In edit mode it also shows "Rules" (`categoryPage.rulesHeading`), the rule cards, the footer "Add rule", and a header star ("Set as default") | `src/screens/settings/categories/categories.screen.tsx`, `src/screens/forms/category-form/category-form.screen.tsx`, `src/screens/forms/category-form/rule-card/` |
| 15 | Category rules | Category screen: "Add rule", or tap a rule card | Rule form: "Condition" ("Name is", "Name starts with", "Amount", "Time"), "Type", "Comparison", "Add condition", "A transaction must match every condition.", Save. If existing rows change: the sheet "Apply Rule" with "Apply to existing" or "New transactions only". Rules also win on sync and import (`ruleWonTransactionSet`, skill kiko-domain) | `src/screens/forms/category-rule-form/`, `src/screens/forms/category-rule-form/rule-rewrite-sheet/` |
| 16 | Statistics | Statistics tab | Cards: "Net Worth Over Time", "By Type", "Account Contribution", "Expenses by Category", "Spending Trend by Category" (the "Filters" sheet, button "All categories"). Filters: "Accounts", "Categories", date range | `src/screens/statistics/statistics.screen.tsx`, `src/screens/statistics/trend-filter-field/` |
| 17 | Reminders | AccountDetail header bell (to `AccountReminders`, accounts tracked by hand only, no bell on an implicit account). Settings tab, "Reminders". The post-import offer "Set up reminder" | Kinds: "Add transactions", "Statement import". Form: "Repeat" ("Daily", "Weekly", "Monthly", "Every N days"), "Time", Save. The row has a switch; hold it to delete | `src/screens/settings/account-reminders/`, `src/screens/settings/reminders/`, `src/screens/settings/reminder-row/`, `src/screens/forms/reminder-form/` |
| 18 | Backup export (.kiko) | Settings tab, "Export Data" (`settings.dataExport.rowLabel`) | "Include saved passwords & keys" (re-auth), "Export data", "Share file", "Copy key", plus the key warning | `src/screens/settings/export-data/` |
| 19 | Backup import | Settings tab, "Import Data" | "Choose file", "Encryption key" / "Paste key from clipboard", "Import data", the sheet "Replace All Data?" with "Replace data", then "Import complete — {{count}} accounts restored." | `src/screens/settings/import-data/` |
| 20 | App lock | Settings tab, "System", then "App lock" / "Require Face ID or passcode" | Turning it off asks for re-auth ("Turn off app lock"). The lock screen offers "Unlock" / "Use passcode" | `src/screens/settings/system/system.screen.tsx`, `src/screens/settings/system/app-lock-setting/` |
| 21 | Language | Settings tab, "System", "Language" | `LanguageSwitch` ("🇬🇧 English" / "🇺🇦 Українська") | `src/screens/settings/system/system.screen.tsx` |
| 22 | Base currency | Settings tab, "Base currency" | Fiat-only `CurrencyField` | `src/screens/settings/settings/settings.screen.tsx` |
| 23 | Help | Settings tab, "Help" | Topic rows, then the HelpTopic page (numbered steps and one footer action) | `src/screens/settings/help/`, `src/screens/settings/help-topic/`, `src/help/help-topics.ts` |

Checked and left out: archived accounts. The only user-visible text is the reminder caption, and
no archive action exists. Today's Help text does not mention them, and the plan adds none.

**manageCategories is stale (verified).** Step 3 ("open one of them, change its category, and tap
"Save"") and step 4 ("Choose "Apply"") describe the transaction form's name-rule sheet, not the
category screen. On the category screen, rules live under "Rules" with "Add rule"
(`category-form.screen.tsx`). The Apply sheet opens only when `offersCategoryNameRule` holds
(`categoryChanged && (isEditing || userPickedCategory)`) and the name is non-blank. Neither step
mentions the star (default) or delete.

## B. Groups and topics (en and uk)

Shape: `help.groups.<groupId>.title` (Title Case en, in `TITLE_KEYS`; uk sentence case), and
`help.topics.<topicId>.{title,rowLabel,steps}` as today. Steps are sentence case and end with
"." (the comment above `help` in `en.ts`). uk uses «» and writes "Кіко". The uk title equals the
uk row label, as the existing topics do.

**Group order:** Accounts, Holdings and Loans, Transactions, Categories, Statistics, Settings.

| Group id | en title | uk title | Topics, in order |
|---|---|---|---|
| `accounts` | Accounts | Рахунки | addAccount, connectMonobank, connectCrypto, importStatement, setReminder |
| `holdings` | Holdings and Loans | Активи й кредити | addHolding, trackProperty, trackLoan |
| `transactions` | Transactions | Транзакції | addTransaction, editTransaction, useTemplates |
| `categories` | Categories | Категорії | manageCategories, categoryRules |
| `statistics` | Statistics | Статистика | viewStatistics |
| `settings` | Settings | Налаштування | backupData, restoreData, systemSettings |

### Topics

Each block lists: en title / en row label / uk title (= uk row label), the footer action, and the
steps as en, then uk.

**addAccount**: unchanged (all five steps and both titles stay as they are). Action: `addAccount`.

**connectMonobank**: "Connect Monobank" / "Connect Monobank" / «Підключити Monobank». Action:
`addAccount`.
1. On the "Accounts" tab, tap "Add account" and choose "Bank". | На вкладці «Рахунки» натисніть «Додати рахунок» й оберіть «Банк».
2. Under "Bank type", choose Monobank. | У полі «Тип банку» оберіть Monobank.
3. Tap "Open api.monobank.ua", get your personal token, and paste it into "Token". | Натисніть «Відкрити api.monobank.ua», отримайте свій особистий токен і вставте його в поле «Токен».
4. Tap "Connect Monobank", then "Save". Kiko loads your cards and their transactions. | Натисніть «Підключити Monobank», потім «Зберегти». Кіко завантажить ваші картки та їхні транзакції.
5. To connect an account you already have, open it and tap "Add a bank" under "Synchronization". | Щоб підключити наявний рахунок, відкрийте його й натисніть «Додати банк» у розділі «Синхронізація».
6. To sync again, pull down the list on the "Home" tab, or tap "Sync" on the account page. | Щоб синхронізувати знову, потягніть список униз на вкладці «Головна» або натисніть «Синхронізувати» на сторінці рахунку.

**connectCrypto**: "Connect Binance or a Bitcoin Wallet" / "Connect Binance or a Bitcoin wallet" /
«Підключити Binance або гаманець Біткоїна». Action: `addAccount`.
1. On the "Accounts" tab, tap "Add account" and choose "Crypto". | На вкладці «Рахунки» натисніть «Додати рахунок» й оберіть «Крипто».
2. Under "Source", choose "Binance" or "Wallet". | У полі «Джерело» оберіть «Binance» або «Гаманець».
3. For Binance, tap "Open Binance API management" and create an API key there. Paste the "API key" and "API secret", then tap "Connect Binance". | Для Binance натисніть «Відкрити керування API Binance» і створіть там API-ключ. Вставте «API ключ» і «API секрет», потім натисніть «Підключити Binance».
4. For a Bitcoin wallet, paste its address and tap "Connect wallet". | Для гаманця Біткоїна вставте його адресу й натисніть «Підключити гаманець».
5. Tap "Save". Your keys stay only in this iPhone's Keychain and are never sent to Kiko. | Натисніть «Зберегти». Ключі зберігаються лише в Keychain цього iPhone і ніколи не надсилаються до Кіко.

**importStatement**: "Import a Bank Statement" / "Import a bank statement" / «Імпортувати
банківську виписку». Action: none (ruling Q3).
1. Download a statement from your bank as a CSV or XLSX file. | Завантажте виписку зі свого банку у файлі CSV або XLSX.
2. On the "Accounts" tab, open the bank account, tap "Import statement", and choose the file. | На вкладці «Рахунки» відкрийте банківський рахунок, натисніть «Імпортувати виписку» й оберіть файл.
3. Check the preview, then tap "Import". Transactions already in Kiko are skipped. | Перевірте попередній перегляд і натисніть «Імпортувати». Транзакції, які вже є в Кіко, буде пропущено.
4. If Kiko does not recognize the file, tap "Map columns manually". For some banks this step opens on its own. | Якщо Кіко не розпізнає файл, натисніть «Зіставити стовпці вручну». Для деяких банків цей крок відкривається сам.
5. Tap the row with the column names, then choose the date, amount, and currency columns. | Торкніться рядка з назвами стовпців, потім оберіть стовпці дати, суми й валюти.
6. Check "Result" and tap "Import". Next time, Kiko fills in the same columns for you. | Перевірте «Результат» і натисніть «Імпортувати». Наступного разу Кіко сам заповнить ці стовпці.

**setReminder**: "Set Up a Reminder" / "Set up a reminder" / «Налаштувати нагадування». Action:
`openReminders`.
1. Open an account you track by hand, then tap the bell at the top. | Відкрийте рахунок, який ви ведете вручну, і натисніть дзвіночок угорі.
2. Choose "Add transactions" or, for a bank account, "Statement import". | Оберіть «Додавання транзакцій» або, для банківського рахунку, «Імпорт виписки».
3. Choose how often it repeats and at what time, then tap "Save". | Оберіть, як часто повторювати й о котрій годині, потім натисніть «Зберегти».
4. To see every reminder, open the "Settings" tab and tap "Reminders". Use the switch to turn one on or off, or touch and hold it to delete it. | Щоб побачити всі нагадування, відкрийте вкладку «Налаштування» й натисніть «Нагадування». Перемикач вмикає чи вимикає нагадування, а щоб видалити його, утримуйте його.

**addHolding**: "Add a Holding" / "Add a holding" / «Додати актив». Action: none (ruling Q3).
1. On the "Accounts" tab, open an account and tap "Add holding". | На вкладці «Рахунки» відкрийте рахунок і натисніть «Додати актив».
2. Choose its "Type". A bank account can hold a card, a deposit, a bond, a jar, or a precious metal. | Оберіть «Тип». Банківський рахунок може містити картку, депозит, облігацію, банку чи дорогоцінний метал.
3. For a bond, enter its ISIN, and Kiko fills in the rest from the NBU register. | Для облігації введіть її ISIN, і Кіко заповнить решту з реєстру НБУ.
4. Tap "Save", then open the holding: "Add contribution" for a deposit, "Add lot" for a precious metal, or "Add transaction" for a card. | Натисніть «Зберегти», потім відкрийте актив: «Додати внесок» для депозиту, «Додати лот» для дорогоцінного металу або «Додати транзакцію» для картки.
5. Kiko updates crypto and precious metal prices on its own. | Кіко сам оновлює ціни криптовалют і дорогоцінних металів.

**trackProperty**: "Track Property" / "Track property" / «Облік майна». Action: `addAccount`.
1. On the "Accounts" tab, tap "Add account" and choose "Property". | На вкладці «Рахунки» натисніть «Додати рахунок» й оберіть «Майно».
2. Choose what it is, such as real estate, a vehicle, or money you lent, then enter its name and cost. | Оберіть, що це, наприклад нерухомість, авто чи гроші, які ви позичили, і введіть назву та вартість.
3. If you own only part of it, set your share under "Ownership". | Якщо вам належить лише частина, вкажіть її в полі «Частка власності».
4. Tap "Save". It shows under "Properties" on the "Accounts" tab. | Натисніть «Зберегти». Воно з’явиться в розділі «Майно» на вкладці «Рахунки».
5. To record a new value, open it and tap "Update value". | Щоб записати нову вартість, відкрийте його й натисніть «Оновити вартість».

**trackLoan**: "Track a Loan" / "Track a loan" / «Облік кредиту». Action: `addAccount`.
1. On the "Accounts" tab, tap "Add account" and choose "Debt". | На вкладці «Рахунки» натисніть «Додати рахунок» й оберіть «Борг».
2. Choose the loan kind, then enter the principal, the annual rate, the start date, and the term. | Оберіть вид кредиту, потім введіть тіло кредиту, річну ставку, дату початку й строк.
3. Choose a "Schedule" to see upcoming payments, and the account it is "Paid from". | Оберіть «Графік», щоб бачити майбутні платежі, і рахунок у полі «Оплачено з».
4. Tap "Save". It shows under "Loans" on the "Accounts" tab. | Натисніть «Зберегти». Він з’явиться в розділі «Кредити» на вкладці «Рахунки».
5. When you add a payment, link it under "Loan payment". Kiko also links matching payments on its own. | Додаючи платіж, пов’яжіть його в полі «Платіж за кредитом». Кіко також сам пов’язує відповідні платежі.
6. To correct what you still owe, open the loan and tap "Update outstanding". | Щоб виправити залишок боргу, відкрийте кредит і натисніть «Оновити залишок».

**addTransaction**: "Add a Transaction" / "Add a transaction" / «Додати транзакцію». Action:
`addTransaction` (new).
1. On the "Home" tab, tap "+", or open a holding and tap "Add transaction". | На вкладці «Головна» натисніть «+» або відкрийте актив і натисніть «Додати транзакцію».
2. Choose the "Type": "Expense", "Income", "Exchange", or "Split". | Оберіть «Тип»: «Витрата», «Дохід», «Обмін» або «Поділ».
3. Choose the holding, enter the amount and a description, and pick a category. | Оберіть актив, введіть суму й опис і виберіть категорію.
4. Tap "Save". If you picked the category yourself, choose "Apply" to use it for every transaction with that name, or "Just for this one". | Натисніть «Зберегти». Якщо ви обрали категорію самі, натисніть «Застосувати», щоб вона діяла для всіх транзакцій з такою назвою, або «Лише до цієї».

**editTransaction**: "Edit, Duplicate, or Delete a Transaction" / "Edit, duplicate, or delete a
transaction" / «Змінити, дублювати чи видалити транзакцію». Action: none (ruling Q3).
1. On the "Home" tab, find the transaction. "Accounts", "Categories", and the calendar narrow the list. | На вкладці «Головна» знайдіть транзакцію. «Рахунки», «Категорії» й календар звужують список.
2. Tap it, make your changes, and tap "Save". In a synced or imported transaction, you can change only the category and the loan link. | Торкніться її, внесіть зміни й натисніть «Зберегти». У синхронізованій чи імпортованій транзакції можна змінити лише категорію й зв’язок із кредитом.
3. Touch and hold a transaction you added yourself, then tap "Duplicate" for a copy dated now, or "Delete". | Утримуйте транзакцію, яку ви додали самі, і натисніть «Дублювати», щоб створити копію з поточною датою, або «Видалити».

**useTemplates**: "Use Transaction Templates" / "Use transaction templates" / «Шаблони
транзакцій». Action: `openTemplates` (new).
1. When you save a transaction, turn on "Save as a new template" and fill in "Template name". | Зберігаючи транзакцію, увімкніть «Зберегти як новий шаблон» і заповніть поле «Назва шаблону».
2. Or open the "Settings" tab, tap "Transaction templates", then "Add template". | Або відкрийте вкладку «Налаштування», натисніть «Шаблони транзакцій», потім «Додати шаблон».
3. To use one, tap "+" on the "Home" tab, choose "Template", pick a template, and tap "Save". | Щоб скористатися шаблоном, натисніть «+» на вкладці «Головна», оберіть «Шаблон», виберіть шаблон і натисніть «Зберегти».
4. In "Transaction templates", tap a template to edit it, or touch and hold it to delete it. | У розділі «Шаблони транзакцій» торкніться шаблону, щоб змінити його, або утримуйте, щоб видалити.

**manageCategories** (rewritten): titles unchanged ("Manage Categories" / "Manage categories" /
«Керування категоріями»). Action: `openCategories`.
1. Open the "Settings" tab, then tap "Categories". | Відкрийте вкладку «Налаштування», потім натисніть «Категорії». (unchanged)
2. Tap "Add category", enter a name, choose an icon and a color, and tap "Save". | Натисніть «Додати категорію», введіть назву, оберіть іконку й колір і натисніть «Зберегти».
3. Tap a category to change its name, icon, or color, and to see its rules. | Торкніться категорії, щоб змінити її назву, іконку чи колір і переглянути її правила.
4. Tap the star at the top to make it the default category. Transactions with no category count toward it. | Натисніть зірочку вгорі, щоб зробити категорію типовою. До неї зараховуються транзакції без категорії.
5. To delete a category, touch and hold it, then tap "Delete". Its rules are deleted too. | Щоб видалити категорію, утримуйте її й натисніть «Видалити». Її правила теж буде видалено.

**categoryRules**: "Set Categories Automatically" / "Set categories automatically" /
«Автоматичні категорії». Action: `openCategories`.
1. Open the "Settings" tab, tap "Categories", then tap a category. | Відкрийте вкладку «Налаштування», натисніть «Категорії», потім торкніться категорії.
2. Tap "Add rule" and set a condition on the name, the amount, or the time. Tap "Add condition" for more; a transaction must match them all. | Натисніть «Додати правило» й задайте умову за назвою, сумою чи часом. Щоб додати ще, натисніть «Додати умову»; транзакція має відповідати всім умовам.
3. Tap "Save". If existing transactions match, choose "Apply to existing" or "New transactions only". | Натисніть «Зберегти». Якщо підходять наявні транзакції, оберіть «Застосувати до наявних» або «Лише нові транзакції».
4. Rules also sort the transactions you import or sync later. | Правила також діють для транзакцій, які ви імпортуєте чи синхронізуєте пізніше.
5. When you change a transaction's category and choose "Apply", Kiko adds a rule for its name. | Коли ви змінюєте категорію транзакції й обираєте «Застосувати», Кіко додає правило для її назви.

**viewStatistics**: "Read Your Statistics" / "Read your statistics" / «Перегляд статистики».
Action: none (ruling Q3).
1. Open the "Statistics" tab to see your net worth over time, by type, and by account. | Відкрийте вкладку «Статистика», щоб побачити свій капітал з часом, за типом і за рахунками.
2. Scroll down for your expenses by category and how they change over time. | Нижче — ваші витрати за категоріями та те, як вони змінюються з часом.
3. Use "Accounts", "Categories", and the calendar to choose what the charts show. | Оберіть, що показують графіки, за допомогою «Рахунки», «Категорії» й календаря.
4. Totals are in your base currency. To change it, open the "Settings" tab and tap "Base currency". | Підсумки показано в основній валюті. Щоб змінити її, відкрийте вкладку «Налаштування» й натисніть «Основна валюта».

**backupData**: "Back Up Your Data" / "Back up your data" / «Резервна копія даних». Action:
`openExportData` (new).
1. Open the "Settings" tab, then tap "Export Data". | Відкрийте вкладку «Налаштування», потім натисніть «Експорт даних».
2. To keep syncing after a restore, turn on "Include saved passwords & keys". | Щоб синхронізація працювала й після відновлення, увімкніть «Включити збережені паролі й ключі».
3. Tap "Export data", then "Share file" to save the .kiko file. | Натисніть «Експортувати дані», потім «Поділитися файлом», щоб зберегти файл .kiko.
4. Tap "Copy key" and keep the key somewhere safe. It is shown only once, and the file cannot be opened without it. | Натисніть «Копіювати ключ» і збережіть ключ у надійному місці. Його показують лише раз, і без нього файл не відкрити.

**restoreData**: "Restore a Backup" / "Restore a backup" / «Відновити з резервної копії». Action:
`openImportData` (new).
1. Open the "Settings" tab, then tap "Import Data". | Відкрийте вкладку «Налаштування», потім натисніть «Імпорт даних».
2. Tap "Choose file" and pick your .kiko file. | Натисніть «Обрати файл» і виберіть свій файл .kiko.
3. Paste its key into "Encryption key", or tap "Paste key from clipboard". | Вставте ключ у поле «Ключ шифрування» або натисніть «Вставити ключ з буфера обміну».
4. Tap "Import data", then "Replace data". This replaces everything in Kiko and cannot be undone. | Натисніть «Імпортувати дані», потім «Замінити дані». Це замінить усі дані в Кіко, і скасувати це не можна.

**systemSettings**: "Language and App Lock" / "Change the language or lock the app" / «Мова й
блокування застосунку». Action: `openSystem` (new).
1. Open the "Settings" tab, then tap "System". | Відкрийте вкладку «Налаштування», потім натисніть «Системні».
2. Under "Language", choose your language. | У розділі «Мова» оберіть мову.
3. Turn on "Require Face ID or passcode" to lock Kiko. It then asks for Face ID or your device passcode when you open it. | Увімкніть «Блокування Face ID або паролем», щоб захистити Кіко. Тоді під час відкриття Кіко попросить Face ID або пароль пристрою.
4. To turn the lock off, Kiko first asks you to confirm it is you. | Щоб вимкнути блокування, Кіко спершу попросить підтвердити, що це ви.

**New action labels** (`help.actions.*`, sentence case buttons, no final "."):
`openTemplates` "Open templates" / «Відкрити шаблони»; `openReminders` "Open reminders" /
«Відкрити нагадування»; `openExportData` "Open data export" / «Відкрити експорт даних»;
`openImportData` "Open data import" / «Відкрити імпорт даних»; `openSystem` "Open system
settings" / «Відкрити системні налаштування». `addTransaction` reuses `home.addTransaction`
("Add transaction") with `genericEntitySymbol.transaction`, the same way `addAccount` reuses
`accounts.addAccount` with `genericEntitySymbol.account`. The `open*` actions carry no icon, like
`openCategories`.

**Facts the developer verifies on the base before writing the text** (each claim above depends on
one): Connect plus Save on the account form (connect-first); Monobank loads cards
(`MonobankConnectField`); a bond ISIN pre-fills from the NBU register; crypto and metal prices
refresh with no user action; Kiko links loan payments on its own ("Linked automatically."); the
default category is the fold target (`resolveCategoryKey`); rules win on sync and import
(`ruleWonTransactionSet`); delete on hold exists for categories, templates, reminders and manual
transactions; the lock asks on open (`auth.unlockPrompt`). If a claim does not hold, cut that
sentence and report it. Do not soften it into a guess.

## C. How the Help screen shows groups

**Pattern reused** (no new visual): a section is a `Box gap={3}` holding
`<Text variant="heading">` followed by the content. This is the CategoryForm "Rules" section and
the Reminders screen account group (`reminders.screen.tsx`). Each section's rows stay in one
`Card padding={0}` with the existing `rowStyle` / `dividerStyle` and `SettingsRow`, exactly as
today's single card (`help.screen.tsx`). The sections sit in the existing outer `Box gap={4}`, with
the privacy caption last. No divider goes between sections; the gap separates them, as on the
Settings root.

TestIDs: `help-group-<groupId>` (section `Box`), `help-card-<groupId>` (replaces
`help-card-topics`), `help-divider-<groupId>` (replaces `help-divider-topics`), and
`help-row-<topicId>` (unchanged).

**Data shape (`src/help/help-topics.ts`).**
- `HelpTopicId` gains the 15 new ids. `topicsById` gains their entries (`satisfies
  Record<HelpTopicId, HelpTopic>` stays).
- `HelpAction` becomes `'addAccount' | 'addTransaction' | 'openCategories' | 'openTemplates' |
  'openReminders' | 'openExportData' | 'openImportData' | 'openSystem'`. `HelpTopic.action` becomes
  `HelpAction | null` (null means no footer). Use `fnts` `maybe`/`foldMap` at the consumer, per
  kiko-code-style "fnts FIRST", never a nullable-map ternary.
- New `HelpGroupId` (`accounts | holdings | transactions | categories | statistics | settings`)
  and `groupsById: { id, titleKey, topicIds }` with `satisfies Record<HelpGroupId, HelpGroup>`.
- Exports: `HELP_GROUPS: readonly { id; titleKey; topics: readonly HelpTopic[] }[]`, derived from
  `groupsById` in insertion order. `HELP_TOPICS` stays (derived from `topicsById`, used by tests).
  `helpTopicById` is unchanged. `src/help/index.ts` re-exports `HELP_GROUPS` and `HelpGroupId`
  (check the barrel's current form).

**Consumers** (grep `@kiko/help` again on the base):
- `src/screens/settings/help/help.screen.tsx`: renders `HELP_GROUPS`.
- `src/screens/settings/help-topic/help-topic.screen.tsx`: `match(topic.action)` grows the new
  arms and the footer is omitted when the action is `null` (`Screen` `footer` is `undefined`, never a
  node that renders null; see kiko-statement-import "Screen layout").
- `src/navigation/settings-stack/settings.stack.tsx`: the `HelpTopic` title is unchanged.
- `src/navigation/types/types.d.ts`: `HelpTopicId` is unchanged.
- `src/i18n/locales/title-keys.ts`: add the 15 topic titles and the 6 group titles.
- `src/i18n/locales/title-keys.call-sites.test.ts`: the new dynamic heading site
  `t(group.titleKey)` in `help.screen.tsx`. Add it to `UNCHECKED_HEADING_SITES` with the reason
  "the help group's title, whose key help-topics.test.ts requires in TITLE_KEYS for every group",
  mirroring the `helpTopicById(...)` entry. The site id is the one the test prints; run it red
  first.
- The `en.ts` comment above `help`: extend it to name the group titles (Title Case, in
  `TITLE_KEYS`).

## D. Pins that change (grep run on base `ad36c4cb`)

| Pin (file, test title) | was | becomes |
|---|---|---|
| `src/help/help-topics.test.ts` "lists the add-account and manage-categories topics" (`toEqual(['addAccount', 'manageCategories'])`) | 2 ids | replaced by the full group to topic matrix pin (task 1/2: 2 groups; task 2/2: 6 groups, 17 topics) |
| `src/help/help-topics.test.ts` "gives the add-account topic five steps and the manage-categories topic four" | 5 / 4 | `it.each` table of every topic's step count (task 1/2: addAccount 5, manageCategories 4; task 2/2: manageCategories 5, …) |
| `src/help/help-topics.test.ts` "finds a topic by its id" (`action: 'openCategories'`, `'addAccount'`) | 2 actions | `it.each` action table over every topic, including `null` |
| `src/screens/settings/help/help.screen.test.tsx` "renders one row per topic in a single card group with a divider between rows" (`help-card-topics`, `help-divider-topics`, length `HELP_TOPICS.length - 1`) | one card | one card per group; dividers per group = its topics minus 1 |
| `help.screen.test.tsx` "puts the divider after the first row, never before it" (3 ordered ids) | single list | per group: heading, then row, divider, row… |
| `help.screen.test.tsx` "pads each row and insets the divider to match the Settings card" (`help-divider-topics`) | testID | `help-divider-<groupId>`; insets unchanged |
| `help.screen.test.tsx` "opens a topic page with its id when a row is pressed" (`help-row-manageCategories`) | — | unchanged |
| `src/screens/settings/help-topic/help-topic.screen.test.tsx` "renders exactly the four manage-categories steps, and names the real Apply button" (length 4, step 4 contains `"Apply"`) | 4 steps, Apply | task 2/2 only: 5 steps; step 2 quotes `categories.addCategory`, step 5 quotes `common.delete` (unchanged in task 1/2) |
| `help-topic.screen.test.tsx` "renders the add-account steps numbered, in order" (5) | — | unchanged |
| `src/navigation/settings-stack/settings.stack.test.tsx` "titles each Help topic page with its own topic title" (addAccount, manageCategories) | 2 | add an `it.each(HELP_TOPICS)` case: title = `i18n.t(titleKey)` (task 2/2) |

---

## Change sets

Mutation runs once per change set: `KIKO_MUTATION_BASE=<that task's base sha> make deep`,
detached, run by the coordinator. The BATCH READY names the base sha, the run id, and the file
count from `KIKO_MUTATION_BASE=<base sha> make mutable`. Every task tip must ship on its own.

### help-flows task 1/2: Grouped Help data shape and screen (existing two topics)

Base: `ad36c4cb`. Files: `src/help/help-topics.ts`, `src/help/help-topics.test.ts`,
`src/help/index.ts`, `src/screens/settings/help/help.screen.tsx`,
`src/screens/settings/help/help.screen.test.tsx`,
`src/screens/settings/help-topic/help-topic.screen.tsx`,
`src/screens/settings/help-topic/help-topic.screen.test.tsx`, `src/i18n/locales/en.ts`,
`src/i18n/locales/uk.ts`, `src/i18n/locales/title-keys.ts`,
`src/i18n/locales/title-keys.call-sites.test.ts`.

This tip ships safely: two groups ("Accounts" holds addAccount, "Categories" holds
manageCategories), no text changes beyond the two group titles, and `action: HelpAction | null`
with the null arm tested.

- step 1/5: Failing tests in `help-topics.test.ts`: (a) the matrix pin `HELP_GROUPS.map(g => [g.id,
  g.topics.map(t => t.id)])` toEqual the exact table; (b) every topic in exactly one group, and the
  groups' union equals `HELP_TOPICS`; (c) no group is empty; (d) each group's `titleKey` is in the en
  catalogue and in `TITLE_KEYS`; (e) every topic's `stepKeys` equals the catalogue's
  `help.topics.<id>.steps` keys, in order ("1".."n", no gap), so a step the registry forgets
  fails; (f) the action table via `it.each`. Check: red.
- step 2/5: Failing tests in `help.screen.test.tsx`: one `help-group-<id>` per group in order;
  each section shows `i18n.t(group.titleKey)` and then its `help-card-<id>`; the rows of a group sit
  inside its card with `topics.length - 1` dividers `help-divider-<id>`, never before the first row;
  padding and insets as today. In `help-topic.screen.test.tsx`: a topic whose action is `null`
  renders no `help-topic-action`. Put it behind a test-only registry seam only if one already
  exists; otherwise this case lands in task 2/2, where real `null` topics exist. Say which in the
  commit. Check: red.
- step 3/5: Implement the shape (section C), the two `help.groups.*.title` keys in en and uk, and
  the `TITLE_KEYS` additions. Implement `help.screen.tsx` grouping per section C, and the null-action
  footer in `help-topic.screen.tsx`. Check: `npx jest src/help src/screens/settings/help
  src/screens/settings/help-topic src/i18n src/navigation/settings-stack` is green.
- step 4/5: Run `title-keys.call-sites.test.ts` red, add the `UNCHECKED_HEADING_SITES` entry with
  the site id it prints. Check: green.
- step 5/5: `npm run check:typecheck`, `check:knip` (from the main checkout if knip fails under a
  worktree path; see memory "Mutation/Stryker/check:deep hub"), `check:screen-imports`,
  `check:feature-imports`, `check:component-i18n-namespace`. Check: all green. Commit.

### help-flows task 2/2: All flow topics, manageCategories rewrite, quoted-label check

Base: task 1/2 tip. Files: `src/help/help-topics.ts`, `src/help/help-topics.test.ts`,
`src/screens/settings/help-topic/help-topic.screen.tsx`,
`src/screens/settings/help-topic/help-topic.screen.test.tsx`,
`src/screens/settings/help/help.screen.test.tsx` (matrix only),
`src/navigation/settings-stack/settings.stack.test.tsx`, `src/i18n/locales/en.ts`,
`src/i18n/locales/uk.ts`, `src/i18n/locales/title-keys.ts`, and (ruling Q2 (a))
`src/i18n/locales/en.casing-by-role.test.ts`.

- step 1/6: (Ruling Q2 (a).) Failing cases in `en.casing-by-role.test.ts`: a sentence
  that quotes an exact Title-role value (`"Export Data"`) passes, and a quoted capitalized phrase
  that is no Title-role value (`"Export Stuff"`) still fails. Then let `sentenceCaseViolations`
  skip a `"…"` span whose text equals the en value of a `TITLE_KEYS` key. This is an exact-match
  allowance, not a loosening: any other mid-sentence capital still fails. Check: the new cases
  and the whole file are green.
- step 2/6: Failing tests in `help-topics.test.ts`. (a) The 6-group, 17-topic matrix pin (section
  B order). (b) The step-count table. (c) The action table: addAccount, connectMonobank,
  connectCrypto, trackProperty and trackLoan are `addAccount`; addTransaction is
  `addTransaction`; useTemplates is `openTemplates`; setReminder is `openReminders`;
  manageCategories and categoryRules are `openCategories`; backupData is `openExportData`;
  restoreData is `openImportData`; systemSettings is `openSystem`; importStatement, addHolding,
  editTransaction and viewStatistics are `null` (ruling Q3). (d) **The quoted-label pin:** every
  `"…"` span in every en help step equals some en catalogue value, and every `«…»` span in every
  uk help step equals some uk catalogue value. The one allowlisted literal is `+` (the Home FAB
  glyph); it reads the catalogues as data, never source text. Check: red.
- step 3/6: Failing tests in `help-topic.screen.test.tsx`: `it.each` over the action table. Each
  action navigates once with the exact args: `addTransaction` goes to `('TransactionForm', {})`,
  `openTemplates` to `('TransactionTemplates')`, `openReminders` to `('Reminders')`,
  `openExportData` to `('ExportData')`, `openImportData` to `('ImportData')`, `openSystem` to
  `('System')`. A `null` topic has no `help-topic-action`. Rewrite the manageCategories pin (5
  steps; step 2 quotes "Add category", step 5 quotes "Delete"). In `settings.stack.test.tsx`, add
  `it.each(HELP_TOPICS)` titles. Check: red.
- step 4/6: Add all en and uk strings from section B, the 15 topic titles and 4 new group titles to
  `TITLE_KEYS`, the new `help.actions.*` keys, and the `topicsById` / `groupsById` entries. Add
  the new `match` arms in `help-topic.screen.tsx`. Check: jest for `src/help`,
  `src/screens/settings`, `src/i18n` and `src/navigation` is green, including
  `en.uk.parity.test.ts`, `en.casing-by-role.test.ts`, `en.final-stop-by-role.test.ts`,
  `uk.casing.test.ts`, `uk.catalog-rules.test.ts` and `title-keys.call-sites.test.ts`.
- step 5/6: Verify every fact in "Facts the developer verifies" against the code. Cut any sentence
  that fails, update its step count pin, and list the cuts in the commit message. Check: tests
  green.
- step 6/6: Run `npm run check:all` project-wide. Check: green. Commit.

### Close-out (after task 2/2)

- `kiko:reviewer` on the whole branch. Top question: does each Help step match the real UI and
  the release build, and does the grouped screen follow the Settings card pattern? No migration
  is in scope, so no migration review step and no EXPLAIN QUERY PLAN test.
- `kiko:retrospect`, then `kiko:scribe`: update kiko-architecture "Help" (groups, `HELP_GROUPS`,
  nullable action) and kiko-translator (group titles in `TITLE_KEYS`, the quoted-label pin, the
  Q2 casing allowance). Flag this drift: kiko-pricing "`PricePointForm` — Update value" says
  `metal` takes `updateValue`, but `holdingDetailSpecs.metal.footerAction` is `'addLot'`.
- The user reviews the new en/uk keys before any deploy that ships them (kiko-translator "Review
  new/changed keys before a shipping deploy").
- `make verify` once on the final tip; run it until it is green.
- `KIKO_MUTATION_BASE=<task N/2 base sha> make deep` per change set (2 runs), each under the
  30-file cap.

## E. Compliance (kiko-compliance, Guideline 5.6)

Help text describes only what a release build shows a reviewer. Every flow above is unflagged
(the only `@env` imports in `src/` are endpoints and privacy URLs; no `SHOW_*`/`HIDE_*`). Help
names no archive action and no planned feature (kiko-pricing "Later"). The quoted-label pin (task
2/2 step 2/6) ties every quoted label to a shipped catalogue string. The demo `.kiko` already
covers every account kind, holding type, reminder kind and template mode, so a reviewer can follow
each topic. The trademark rule holds: Monobank and Binance appear by name only, with no logo and
no wording that implies partnership.

## F. Rulings (user-approved 2026-10-14)

Every question the planner raised is decided. Q1 (the category-screen divider) belongs to another
track and is not part of this plan.

- **Q2. Quoting Title Case row labels ("Export Data", "Import Data") inside a sentence-case
  step.** (a) The en casing test accepts a quoted span that exactly equals a Title-role catalogue
  value. The allowance is exact-match.
- **Q3. Topics whose first step needs a specific account or tab (importStatement, addHolding,
  editTransaction, viewStatistics).** (a) No footer button: the action is `null`.
- **Q4. Group order.** Accounts, Holdings and Loans, Transactions, Categories, Statistics,
  Settings.
- **Q5. Section header placement.** (a) The heading above each card (the CategoryForm "Rules" and
  Reminders pattern).
- **Q6. A single-topic group (Statistics).** Statistics is its own group.
- **Q7. addAccount text.** The five approved steps stay as they are.
- **Q8. uk titles.** The noun forms as written («Облік майна», «Облік кредиту», «Автоматичні
  категорії»), matching the existing «Керування категоріями».
