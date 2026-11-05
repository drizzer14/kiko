---
name: kiko-domain
description: Invoke whenever you touch the domain model — the Account/Holding/Transaction schema, the Money value object, currency codes, or net worth calculation. Read before writing a Drizzle table, a repository, a form, or any code that handles an amount. For bonds, ISINs, the NBU register and bond coupons or yield, see kiko-bonds; for debt accounts, loan holdings, loan schedule math, loan payment links and the loan-payment matcher, see kiko-debts; for Binance and exchange legs, see kiko-exchange-sync.
---

# Kiko domain model

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Domain model" section). This skill summarizes the settled contract;
if the two ever disagree, the spec wins and this skill needs updating.

## The three levels

`Account -> Holding -> Transaction`, plus supporting tables. **The
enumerated `{ enum: [...] }` column values below (`kind`, `type`,
`currency`, `source`) drift — a kind gets added or removed in code
without this skill being updated in lockstep (this happened: `broker`
was once a valid `Account.kind`, was dropped while this skill still
listed it, and was later re-added in P5). Do not trust
an enum list copied into this prose as current. Read
`src/db/schema.ts` directly for the live `sqliteTable` column
definitions before relying on a specific member being present or
absent** — this skill states the shape and non-enum facts only:

- **Account** — a bank, cash stash, crypto wallet, standalone property
  holder, standalone precious-metals holder, or debt holder. `id`,
  `name`, `kind` (see `schema.ts`'s `accounts.kind` enum for the
  current member set — this includes `property`, `metals`,
  and `debt` alongside `bank`/`cash`/`crypto`; all three of the
  non-`bank`/`cash`/`crypto` kinds are manually-created-only kinds
  with no sync concept), `institution` (nullable, e.g. `monobank` —
  marks a LIVE sync connection), `bankId` (nullable, migration
  `0033`; see below), `icon`, `color`, `sortOrder`, `archivedAt`
  (nullable), `createdAt`, `currency` (`schema.ts` `accounts.currency`,
  migration `0062`). `accountCurrencyOf` derives it only for migrated and
  restored pre-0062 rows; a new account takes the cash pick
  (`createCashAccount`, which sets both the cash holding's and the
  account's currency), the user's raw pick on a non-cash create
  (`AccountFormDraft.accountCurrency`, passed as `saveFormAccount`'s
  `currency`), or the base read inside the write when that pick is untouched
  (`null` = base; the form never sends `pick ?? base`). An edit writes only
  `accounts.currency`, and only when the user changed it (`currencyPatch` in
  `src/screens/forms/account-form/account-form.screen.tsx`); holdings and
  amounts are untouched, for a cash account too.
  Never re-derive a stored account currency after creation: a base change
  or a new foreign holding never moves it (ruling 5,
  `src/accounts/accounts.repo.currency.test.ts`). `holdingTypesForAccountKind`
  (`src/holdings/holding-type/`) maps each account kind to its
  allowed `Holding.type` set — `property` maps to `property_item`,
  `metals` maps to `metal`, `debt` maps to `loan` — read that file
  rather than trusting a mapping copied here. `metal` is ALSO
  creatable under a `bank`-kind account, gated by that bank's own
  `sellsMetals` catalog flag (see `kiko-pricing`'s "Bank metal
  allow-list" section) — the only holding type creatable under two
  different account kinds by two different rules.

  **A `broker` account is manual holdings only**: no sync, no
  statement import, no Connect field — the user adds holdings by hand.
  Its allowed holding types come from `holdingTypesForAccountKind` in
  `src/holdings/holding-type/holding-type.ts` (read it there). Its broker identity comes
  from the broker catalog in `src/brokers/broker-catalog.ts`
  (`BrokerId`), picked in the account form via `BrokerTypeField`
  (`src/screens/forms/broker-type-field/`); required on create
  (`brokerRequiredError`); on edit it is shown disabled and never written.

  **`accounts.bankId` always holds the catalog id for the account's
  own kind**: a bank-catalog id for a `bank` account, a broker-catalog
  id for a `broker` account, never one kind's id on the other. Route
  every write through `catalogIdFor` in
  `src/screens/forms/account-form/account-form.screen.tsx`. A `crypto` account's `bankId`
  holds an `ExchangeCatalogId` (`src/crypto-sync/exchange-catalog/`) or NULL (saved with no
  pick, or a legacy connected account with only `institution`); `catalogIdFor` has a `crypto`
  arm for it, and readers go through `exchangeCatalogIdOf`, never `bankId` alone. It is set
  from `ExchangeTypeField` on the create form only (S14-Q3).

  **`bankId`** is the "which bank does this account represent" field
  set from the account-form's bank picker (`BankTypeField`,
  `src/screens/forms/bank-type-field/`), rendered in BOTH create and
  edit mode. The catalog's LAST entry is `other` (`OTHER_BANK_ID` in
  `src/bank-sync/bank-catalog/bank-catalog.ts`; i18n key
  `forms.account.otherBank` — cite the symbol and key, not the label): a
  STORED id that replaced the old NULL (migration 0049 and its restore
  mirror `withBankAccountsBankIdBackfilled`; migration 0051 then moved a
  bank account connected to Monobank, `institution = 'monobank'`, from
  `other` to `monobank`, and the same restore function does it for an older
  file). It is the target for the generic
  column-mapping import and states no capability (not connectable, no
  format, no metals): `isConnectableBank('other')` is false, so AccountDetail
  shows Other bank no Connect and no "Add a bank" (manual import only), and
  the picker row no live-sync glyph. An account already connected keeps its
  Sync / Disconnect section whatever its bank (`showsBankSync` in
  `account-detail.screen.tsx`), as any connected account stored as
  Other bank must (0051 corrects a Monobank one; the guard stays for any
  other provider's connection). A NEW bank or broker account must pick (Save
  blocked: `bankRequiredError`/`brokerRequiredError`, `missingCatalogPick`
  in `account-form.screen.tsx`). **An account's kind, bank and broker are
  set on create only**: the edit form shows the kind field
  (`AccountKindField`), the bank field (`BankTypeField`) and the broker
  field (`BrokerTypeField`) DISABLED (the `disabled` state of the shared
  `FieldTrigger`, so VoiceOver reads each as dimmed; no
  caption explains it), and an edit Save writes only the name, color and icon
  — never `kind`, `bankId` or `institution`. A wrong kind or bank therefore
  has no edit path; delete and recreate the account. The exchange picker
  (`ExchangeTypeField`) is rendered on a crypto CREATE form only (`!isEdit && kind === 'crypto'`),
  so an edit form has no exchange field at all; on create it takes the same `isPickLocked`
  state as the pickers below. In CREATE mode the
  kind and bank pickers lock too once the account row may exist (read the
  `isPickLocked` boolean in `account-form.screen.tsx` for its conditions,
  never a copy of them; a create form remounted from its own saved draft,
  e.g. after a fold, stays locked until `usePendingRowLock`
  (`src/screens/forms/account-form/use-pending-row-lock/`) gets a "no row"
  answer from `accountsRepo.exists`; a rejected read keeps it locked
  (user-confirmed 2026-10-10)). Every Connect
  creates the row with
  `accountsRepo.createIfAbsent` (one write that selects the row and returns
  early when it exists, so it writes no sort order and no second writer can
  fail on the key), and Save is one `accountsRepo.saveFormAccount` call (one
  write that selects the row and updates name, color, icon, bank and, when
  the pick is non-null, currency, or inserts it, with the sort order only on
  insert), never a decision from a copy of component state. A fold remounts
  the screen but the OLD instance's
  in-flight Connect still runs, so the draft (`AccountFormDraft`) keeps
  `pendingAccountId` and nothing about the row; the remounted form asks the
  write queue (`usePendingRowLock`) before it unlocks the kind and bank
  picks. A Connect field (`MonobankConnectField`, `BinanceCredentialsField`)
  never calls its connect callback once it is unmounted (`useIsMounted`),
  and stores nothing when it unmounts before the Keychain write: a token
  checked before a fold or a kind/bank switch is not stored, and the user
  taps Connect again. A pair stored during the write is reported through
  `onStoredWhileUnmounted`. `onConnect` and `onStoredWhileUnmounted` receive the
  `BinanceWriteToken` of that write, not the pair. The account form's
  `clearPairIfRowMissing(token)` calls `clearCredentialsIfWrittenBy`, which resets the pair only
  when that token is still the account's latest recorded write, so a later save (even of the same
  pair) is never deleted (`src/crypto-sync/binance/binance.credentials.ts`). Every write and
  clear of the pair goes through that file's per-account lock; the exchange helpers
  (`exchange/credentials`) are lock-free and have no other caller. The form clears
  when no row owns P, and account detail keeps the pair (user ruling 2026-10-10).
  Known limit after a fold: see kiko-architecture, "Form drafts". Re-picking the
  already-selected kind is a no-op (the bank/broker
  pick, custom icon and typed token stay); a switch to a different kind
  resets them. A wrongly picked bank
  stays (user decision 2026-10-05): the bank drives only the import parser
  pre-select, the saved-mapping key and the metals/trademark hints, never an
  amount. The same rule makes
  `other` with `institution = 'monobank'` a pre-0051 leftover that the 0051
  migration and its restore mirror correct exactly. Use `isSpecificBankId` where code means a
  real bank and `isBankId` where `other` is valid too. `accounts.bankId`
  can still be NULL on a legacy broker row; the
  picker's `onSelect` takes a `BankId`, never null. The live-sync Connect field (Monobank) stays
  create-only. Backed by the catalog at
  `src/bank-sync/bank-catalog/` — read that file for the current bank
  set (`BankId`/`bankCatalog`) rather than trusting a count or list
  copied here; it grows over time (P3 added PUMB, Oschadbank,
  Raiffeisen, and Ukrgasbank, each with no dedicated `statement-import`
  parser — `statementFormatId` is optional for exactly this reason). It
  is **identity-only, independent of `institution`**: only Monobank has
  a live API Connect today (`connectable: true` in the catalog), every
  other entry is import-only, scoping which `statement-import` parser
  applies when it has one. That parser is only ever a
  PREFERENCE, not a gate: "Import statement" is offered on every bank
  account regardless of `bankId`, and a file that doesn't match its
  dedicated format (or has none) falls through to the generic
  column-mapping import (`kiko-statement-import`'s "Column mapping"
  section) — a dedicated format still wins whenever it
  actually matches. `bankId` is deliberately **never read** by
  `isSyncedAccount`/`isSyncedHolding`
  (`src/holdings/deletable/`) or any provider-registry lookup — those
  stay keyed on `institution` alone, so tagging an account
  `bankId: 'privatbank'` can never make it look connected. This is the
  Guideline 2.5.19 invariant (see `guidelines-compliance-is-architecture-rule`
  in memory): never wire a picker selection into a connected-ness
  check.

## Bank catalog and provider registry

`src/bank-sync/bank-catalog/` is the identity catalog (`bankId` — see the
paragraph above; do not duplicate its `bankId`-vs-`institution` distinction
here). `src/bank-sync/provider-catalog/` and `src/bank-sync/registry/registry.ts`
are the separate LIVE-SYNC layer: `bankProviderRegistry` ties a
`BankProviderId` to its concrete `runSync`/`hasCredentials`/`disconnect`
functions (read `registry.ts:28-41`'s comment for the current rationale and
partiality contract) so that `syncJobsFor` and the account-detail screen never
hardcode a provider list — adding a new live-sync provider is one registry
entry, not a change to either caller. The registry is intentionally
`Partial`: a `BankProviderId` with no entry here is simply not yet
implemented, and callers must skip it rather than assume every id resolves.
`exchangeProviderRegistry` (`src/crypto-sync/exchange/registry/`) is the crypto twin of
`bankProviderRegistry`; `syncJobsFor` skips a crypto id the registry does not wire. For exchange
sync and Exchange/Convert legs see `kiko-exchange-sync`.

  **Implicit accounts: at most one LIVE `property` account and one LIVE
  `debt` account** (`archivedAt` NULL), enforced by the partial unique index
  `accounts_implicit_kind` (migration `0050`, declared in `src/db/schema.ts`).
  The unit is `src/holdings/implicit-account/`: `isImplicitAccountKind`,
  `isImplicitAccount` (kind + live), `accountDisplayName(account, t)`, and
  `accountsForFilter(accounts, holdings)` (the Home and Statistics account
  filter options: live accounts, minus an implicit one with no holding at all
  — a transaction always hangs off a holding, so none is left either).
  **A screen shows an implicit account's name through `accountDisplayName`,
  never through the raw stored `name`**: the stored `name` is the fixed English
  sentinel `IMPLICIT_ACCOUNT_STORED_NAME` (`Properties` / `Loans`) while the
  account is unrenamed (written by `0050` and by every implicit create), and
  `accountDisplayName` then shows the localized
  `accounts.implicitName.{property,debt}`; once the user renames the account
  (from the Edit item of the account's own `AccountDetail`, opened by tapping
  its section heading on the Accounts screen; the holding-detail header has
  no account button) the typed name is stored and shown as it is. The Accounts screen's
  Property and Debts section headings show that display name beside the
  account's compact squircle icon tile (`ImplicitAccountHeading`,
  `src/screens/accounts/implicit-account-heading/`, testIDs
  `accounts-property-heading` / `accounts-debts-heading`); the whole heading row is
  one button with a chevron that opens `AccountDetail { accountId, name:
  accountDisplayName(account, t), kind }`. `kind` is the hint that keeps the
  bell off the page's first render. The row's testIDs are
  `accounts-property-open` / `accounts-debts-open`; see kiko-design-system's
  "Section heading disclosure row". **An implicit account's `AccountDetail`
  takes no NEW reminders**:
  its title is `accountDisplayName`, it has no Reminders bell (Edit only) and
  never shows the reminder offer (the screen asks `useReminderOffer` for no
  trigger on a live implicit account), while import statement and bank/crypto
  sync stay hidden by their own kind gates and Add holding opens
  `HoldingForm { accountId }` (`holdingTypesForAccountKind` limits it to
  `property_item` / `loan`). Settings > Reminders' account page lists only the
  reminders SAVED on a live implicit account (no create row).
  `eligibleReminderKinds` is NOT narrowed for the implicit kinds: it also
  decides which saved reminders are scheduled
  (`isSchedulable`) and listed as active in Settings > Reminders, so a merged
  reminder keeps firing and stays manageable there. The account form
  stores the sentinel back when the name is the localized default left
  unchanged (`implicitAccountStoredName`). The kind decides whether an account
  is implicit, never its name. A new account's `icon` and `color` are NULL so
  the kind defaults show; the user can set both. An ARCHIVED property/debt
  account is a plain account outside the index, the merge, and
  `accountDisplayName`. A `.kiko` restore keeps a lone implicit account's
  name, icon and color and resets them to the defaults only on the kept
  account of a merge of 2+ (see kiko-architecture). **Create a property
  or loan holding only through `accountsRepo.createImplicitHolding(kind, input)`**:
  one `write()` that finds the live account of the kind (a SQL lookup with
  `LIMIT 1`), inserts it when none exists (sentinel name, NULL icon/color,
  `nextSortOrder`: a property account sorts before every debt account, a debt
  account appends after every account), then inserts the holding through
  `insertHoldingDatabaseTransaction`, so a rejected holding rolls the account
  insert back. A type the kind does not hold (`holdingTypesForAccountKind[kind]`)
  throws before any insert. `accountsRepo.create` throws for a property or debt kind. Read the unit and
  `0050`'s header comment for the merge rule (oldest `created_at` kept) rather
  than a copy here.
- **Holding** — a balance-bearing thing under an account (a card, a
  jar, a term deposit, a crypto asset). `id`, `accountId` (FK),
  `name`, `type` (see `schema.ts`'s `holdings.type` enum), `currency`
  (see `schema.ts`'s `holdings.currency` enum), `icon`, `color`,
  `balanceMinorUnits` (integer), `metadata` (JSON: masked PAN, IBAN,
  deposit rate, maturity, Monobank account/jar id), `sortOrder`,
  `closedAt` (nullable), `createdAt`. A MANUAL holding the user sold or
  gave away is Closed, not deleted (the card context menu's `closeAction`
  -> `CloseHoldingSheet` -> `holdingsRepo.closeMany`; both live in
  `src/design-system/components/close-holding-sheet/`, whose barrel exports
  only `useCloseHoldingAction`); it keeps its lots, prices, and ledger.
  A synced holding gets no `closeAction` (`closeActionFor` returns
  undefined); every manual holding gets one, and the user has no reopen.
  A Monobank card or jar the SYNC closed (Monobank stopped returning it)
  carries `metadata.syncClosedFromMs` and reopens when it returns: a card
  or a jar imports its gap from that mark (both are statement sources); a
  holding the user closed by hand never does
  (kiko-architecture "Sync-closed holdings reopen"). A
  loan is never called a holding there: `closeHoldingCopy(type)` picks
  the `accountDetail.closeLoan*` keys (menu label, confirm title,
  message, error title) for a type whose descriptor `side` is `'debt'`
  and the `accountDetail.closeHolding*` ones otherwise. The menu entry is
  neutral (only Delete is red); the confirm button is red
  (`ConfirmSheet destructive`). The add flow of an account whose every
  holding type is a debt (`holdsOnlyDebts(kind)`, the same descriptor
  `side`; today the `debt` kind) says loan too: the holding form's
  create title `forms.holding.addLoanTitle` ("Add Loan" / "Додати
  кредит") and its edit title `forms.holding.editLoanTitle` ("Edit Loan"
  / "Редагувати кредит"). Account detail has no "Add loan" footer; the Help topic
  footer has one (`HelpAction` `addLoan`, kiko-design-system D10).
  Holding detail passes the flag in
  the HoldingForm route (`debtAccount`) on edit, so the title is right
  on the first frame; the form reads the account row when the route has
  no flag (account detail's Add holding, the statement-import and
  column-mapping entry points). `forms.holding.addLoanTitle` is the title of an account-mode create
  into a debt-only account (`headerTitle`, `holding-form.screen.tsx`). An
  implicit create keeps the account form's `forms.account.addTitle`
  ("Add Account") for both kinds (see "`property_item` / `metal` create-form sections").
  `holdsOnlyDebts(undefined)` is false: an account row still loading
  names a holding.
- **Transaction** — a movement against a holding. `id`, `holdingId`
  (FK), `amountMinorUnits` (signed integer), `time` (unix
  milliseconds), `description`, `category` (nullable), `mcc`
  (nullable), `hold` (nullable boolean — Monobank's pending-
  authorization flag, whose settled amount can still change; null on
  a manual row), `comment` (nullable), `source` (see `schema.ts`'s
  `transactions.source` enum), `externalId` (nullable; the key a
  re-imported synced item is upserted on, unique per `(source,
  external_id)`. For a SYNCED row it is NAMESPACED by the holding's
  account id — `${accountId}:${sourceId}` — so the global index cannot
  collide across two connections of one provider, Binance record ids
  being only per-account unique; see `kiko-exchange-sync`'s "Namespaced
  synced externalId". A manual row's is null), `createdAt`.

  Re-syncing an existing `externalId` **refreshes** that row's
  bank-owned columns — the settled `amountMinorUnits` and `hold`
  among them — and **never** its `comment`; its `category` is written
  only for an unflagged (`category_set_by_hand = 0`) row no `REWRITE_GUARD_FIELDS` field marks
  (`src/categories/category-rules/plan-rule-rewrite.ts`; an exchange leg is refreshed when its
  amount changed and a rule wins) whose amount changed and a
  category rule wins
  (`ruleWonTransactionSet`, `src/transactions/repo/transactions.repo.ts`). Read `addManyDedup` in
  `src/transactions/` for the exact refreshable
  set, and `transactions.hold` in `src/db/schema.ts` for why a
  pending item is imported at its provisional amount at all, rather
  than trusting a column list restated here.
- **CurrencyRate** — cache of the latest known conversion rate.
  `base`, `quote`, `rate` (a scaled integer or text — never a raw
  float, to avoid drift), `source` (see `schema.ts`'s
  `currencyRates.source` enum), `fetchedAt`. A sibling table,
  `currencyRateHistory`, additionally keeps one row per
  (base, quote, day) for the historical net-worth chart — read
  `schema.ts` directly, this skill does not restate its columns.
- **Settings** — single row: `baseCurrency`, `lastSyncAt`
  (nullable), plus feature settings — read `src/db/schema.ts` for the
  live column set rather than trusting a list here. One is `trendFilter`,
  the Statistics trend chart's saved filter: a JSON `TrendFilter` union
  (`{ mode:'manual', keys } | { mode:'top', amount, by } | null`, see
  `src/statistics/`). It SUPERSEDES the retained-dead
  `trendCategoryKeys` column (migration 0025 copies any saved keys across
  as a manual filter; the old column is pinned reader-less in
  `src/db/settings-columns.test.ts`). `quoteQuota` is a retained-dead nullable JSON column (the
  removed EODHD share-price quota; migration 0046); nothing reads or
  writes it, and a restore takes it from the file like the other
  reader-less columns pinned in `src/db/settings-columns.test.ts`. The Monobank token is never stored
  here — see `kiko-architecture` for the Keychain rule (its Monobank sync
  section also carries the credit-limit known limit).

A manual balance adjustment always writes a `manual` Transaction, so
a holding's balance history stays derivable from its transactions.
This is not a convention a caller is trusted to remember — three
repository functions enforce it, and every balance a USER sets goes
through one of them:

- **An edit**: `holdingsRepo.updateWithBalanceDelta`
  (`src/holdings/`) writes the patch AND, when
  `balanceMinorUnits` differs from the stored value, the DIFFERENCE as
  a `manual` row — one `db.transaction()`, delta computed from the row
  re-read inside it (never a render snapshot), no row at all for a zero
  delta. The holding form's edit save calls this (a bond edit, which
  writes no balance, calls `updateMetadataFromStored` instead), never
  `holdingsRepo.update`, whose bare `set(patch)` stays for the
  non-balance writers (icon/color/metadata, the sync's own writes,
  reorder) and must never be handed a `balanceMinorUnits`.
- **A new holding's opening balance**: `holdingsRepo.create`
  (`src/holdings/`) seeds the same kind of row for
  a non-zero `balanceMinorUnits`, in the transaction that inserts the
  holding. Zero seeds nothing.
- **A new cash account's opening balance**: `accountsRepo.createCashAccount`
  (`src/accounts/accounts.repo.ts`) does the same for its first
  holding, in the transaction that inserts the account and that
  holding.

Why it matters concretely: `createHoldingValuer`
(`src/statistics/holding-value-at/holding-value-at.ts`) back-derives a
holding's opening balance as `currentBalance - sum(allTransactions)`, so a
balance written
without its ledger row retroactively shifts the ENTIRE historical
net-worth series by that amount, and the holding-detail transaction list
stops reconciling with its own displayed Value. An exchange holding's "Earlier history" line
(`exchange-history-footer.component.tsx`) shows the same residual, `balance - sum(rows)`,
so it and the Statistics series never disagree; a backfill still owed leaves it nonzero
until the ground is read. None of the three routes
through `transactionsRepo.recordManual` (which would apply the amount to
the balance a second time), and none persists a description or a
category — the label resolves at render time (see kiko-exchange-sync's
"Exchange/Convert legs" and `transactionRowDescription`, `src/transactions/`). A null category folds
onto `settings.defaultCategoryKey`, so a downward correction counts as
spending like any other uncategorised manual row; that is a RULED
decision (the row is editable), not an oversight to be quietly patched.

A SYNC-owned balance is the exception and writes no ledger row: the
provider owns that number (`upsertByMetadataKey` in
`src/holdings/`), and the form hides the balance field for a synced
holding entirely.

A manual create carries `ManualTransaction.categorySetByHand` (true when the
user picked the category by hand), stored in `transactions.category_set_by_hand`;
`recordManual` returns the new row id and `recordManualWithReturns` the payment
row id; rules and rewrites never touch a flagged row.
The flag on save (a hand pick or a seed with a category saves true; a pre-select
saves false (and opens no name-rule sheet); an edit never pre-selects; "Apply" on create passes the created row
id): see `src/screens/forms/transaction-form/use-category-pick/` and decisions 13
and 17 of `docs/superpowers/specs/2026-10-11-category-rules-design.md`.

**Every transaction updates its balance (user rule 2026-10-05).** A manual
write (`recordManual`, each exchange or change-return leg), its edit (`update`,
by the difference of the amounts) and EVERY delete (`remove`, a cascaded part, a
holding's partner) move the stored balance by the row's full amount, in its own
holding's currency, whatever the row's date, source or mark: a back-dated row,
an imported row, an opening-balance or hand-edit row (`setsBalance`) included.
There is no manual boundary and no re-date guard. A delete moves the balance
only: `balanceSetAt` stays and no bank figure is stored, so deleting every row
of an import ends on the statement's opening balance. Only an IMPORT still
judges its rows against the boundary, the later of `holdings.balanceSetAt` and
its newest sync-source row (`balanceBoundaryOf`, `movesBalance`,
`src/transactions/balance-boundary/`, read by `readAnchoredHoldingDatabaseTransaction`
in `importRows` and its preview alone), and a closing balance sets the bank's
figure outright. A bank-owned (synced) row is never deleted. Re-importing the
same file brings a deleted row back with its amount: a deleted import row's
stored key is kept per holding (`deleted_import_keys`, migration 0054), and a
row matching one counts at full amount on the net-delta path whatever its date,
while a row the holding never had and dated on or before the boundary still
counts 0 (kiko-statement-import has the full rule). Every key of a holding goes in
the same write that moves its balance anchor (a closing balance that applies, a
hand-set balance with a non-zero delta, the bank figure of a sync): the sync
clears the keys but never reads them and never revives a row. The delete confirm states each holding's change
(`transactions.deleteLinked.balanceChange`, see "Deleting a movement takes its
other parts"). A sync write is outside the rule: the Monobank balance is the
bank's own figure on every sync, and a sync REOPEN of a closed card writes no
row and moves no balance. So is a sync ADOPTING its statement-import twin after
a reconnect (`addManyDedup`): it turns the import row into the sync's row in
place, writes no `holdings` row and moves no balance, and the ledger keeps one
row per purchase.

*A closing balance never absorbs a manual row (user ruling 2026-10-06, "Manual
rows stay on top"):* a back-dated MANUAL row dated on or before a closing
balance's as-of moves the balance when written, and importing a statement with
that closing (`asOf >= boundary`) keeps it on top of the bank figure, as it
keeps a row of any source dated after the as-of (`postClosingRowsWhere`:
`time > asOf` or `source = 'manual'`, never a `setsBalance` row). Example: closing 10,000 as of Oct 1 and
a manual -1,000 dated Sep 20 give 9,000; the same statement again keeps 9,000, a
newer closing keeps the row on top, and deleting the row gives 10,000. The
preview line says "plus entries not in this statement" whenever the result
differs from the bank figure. KNOWN LIMIT: a manual row that duplicates a bank
row of the statement counts twice (in the bank figure and on top of it) until
the user deletes it; the delete then lands exactly on the bank figure (a first
closing import over a holding the user logged by hand shows it).

**A manual write refuses a ledgerless holding.** `recordManualTransaction`
(`transactions.repo.ts`) reads the holding first and, before any write,
throws an Error with the message transactions/ledgerless-holding when its
type is `isLedgerlessHoldingType`. The whole split or exchange write rolls
back. It covers `recordManual`, `recordManualWithReturns`, the plain legs of
`recordExchange`, and `recordExchangeCounterpart` (Convert-mode). Convert-mode eligibility and
direction live in `src/holdings/exchange-convert/` (`canConvertToExchange`,
`exchangeConvertDirection`), and the counterpart's seed amount in `src/holdings/exchange-prefill/`
(`seedCounterpartMinorUnits`); read them there. A term_deposit exchange DESTINATION still
works: its receive path `contribution` writes metadata, not a row. The
transaction form's split change-return picker offers only
`isTransactionEligibleType` holdings, the same gate as the primary picker.

**A balance-set row is a STORED mark, not a date.** Every row whose amount
set the balance (an opening balance, a cash opening, a hand edit) carries
`transactions.setsBalance` (migration 0047) for good, whatever its date,
description or category has become. The mark no longer decides a balance move:
its edit (by the difference of the amounts) and its delete move the balance
like any row's. It keeps a closing import from counting the row a second
time: `postClosingRowsWhere` never counts it in the post-closing sum, because a
closing balance replaces the balance the row set. It also keeps the row out of
spending (kiko-domain "Spending-exclusion pipeline", Decision 7). `holdings.balanceSetRowId`
(same migration) points at the current set's row (`holdingsRepo.create`,
`accountsRepo.createCashAccount`, `holdingsRepo.updateWithBalanceDelta`) and
`importRows`'s closing write sets it to NULL; no balance rule reads it now, and
a stale id matches nothing.

Data written before the mark gets it from migration 0047 and, for an older
`.kiko` file, from `restoreDataSnapshot` (the same rule): per holding, the
row shaped like a balance-set row (`isBalanceSetShapedRow`: manual, empty
description, null category, no exchange or change-return marker) AND dated
exactly at `holdings.balanceSetAt` is marked and becomes the holding's
`balanceSetRowId`; on a same-millisecond tie, the smallest id. A pre-0047
row that was already re-dated, described, or categorised, and an older
set's row a newer set or a closing import superseded, gets no mark and
stays an ordinary row.

**The transaction form's Date calendar caps at today.** The form passes
`maxDate` (see kiko-design-system, `DateField`) so a later day cannot be
picked: a future-dated row makes Home and the Statistics line disagree until
that day arrives. Only the day is capped, so a later time today is allowed.
Hydration never clamps: a stored future-dated row keeps its stored date
unless the user picks a new one.

## Statement import moves the target holding's balance too

A file-based statement import (`transactionsRepo.importRows`,
`src/transactions/repo/transactions.repo.ts`, called from
`importStatement`, `src/statement-import/import-statement/`) is a
FOURTH balance writer, alongside the three above — it does NOT write
an extra ledger row (like a manual adjustment does): the imported rows
THEMSELVES already explain the balance move, the same way a Monobank
sync's own upsert does. Everything (the row upsert AND the balance
write) happens in ONE db transaction, so a partial failure can never
leave the ledger and the balance disagreeing. This was a real, shipped
production bug (App Store build 25): `importStatement` used to call
only `transactionsRepo.addManyDedup`, which upserts `transactions` and
never touches `holdings` — an import-only holding (created purely to
receive a statement, opening balance 0, never touched by anything
else) stayed at `balanceMinorUnits: 0` forever, so the Home headline
and that holding's own card showed 0 even though its transaction list
showed the real imported rows.

`importRows`'s own doc comment (`transactions.repo.ts`) is the ONE
full statement of the exact rule — the boundary, `holdings.balanceSetAt`,
the closing-balance override, the synced-account refusal (any holding of
an account `isSyncedAccount` owns, a hand-added one included), the ±60 s
(or same-local-day, for a date-only row) match against a disconnected
bank's synced rows, and why no migration
repairs pre-fix data — read it there rather than trusting a restated
summary here.

**The import screens preview the balance before the import runs.**
`transactionsRepo.previewImportBalance` runs the SAME reads
(`readImportPlanDatabaseTransaction`, refusals included), the same new-row
partition and the same `resolveImportBalance` as `importRows`, but writes
nothing, so the figure shown is the figure the import then stores (parity, pinned
against real SQLite). `previewParsedStatementBalance`
(`src/statement-import/import-statement/`) wraps it for a parsed statement and
THROWS (the "preview-pending" error) until BOTH one-shot rewrites have
settled (`settings.dedupKeysUpgraded` and `settings.importTimesRezoned`), because
the preview does not run the rewrites the import runs first and its keys and
times could differ; the hook `useImportBalancePreview` logs the refusal and
shows no line. The result is `ImportBalancePreview` (`kind: 'set' | 'change' |
'stays'`, read the type in `transactions.repo.ts`); `ImportBalanceLine`
(`kiko-design-system`) renders it on both import screens. Rule: the preview
reads through `readImportPlanDatabaseTransaction`, never a copy of the balance
rule.

## `property_item` / `metal` create-form sections

**The implicit entry: the account form swaps screens, not fields.** A
property or loan is never created as an account. In the account form's
CREATE mode, picking Property or Debt calls
`navigation.replace('HoldingForm', { implicitKind, draft })`
(`swapToHoldingForm`, run from `AccountKindField`'s `onSelectClosed` after the sheet has closed; `handleSelectKind` does not switch `kind` for an implicit kind, it only stores `pickedImplicitKind` so the kind field shows the pick in the tap's own frame while the fields, icon and color stay put; the form passes `closesWithoutAnimation={isImplicitAccountKind}`, so that sheet closes with no fade and `onSelectClosed` (hence the `replace`) follows at once, while every other kind keeps the fade; `account-form.screen.tsx`), where `draft` is the
`FormDraft` (`{ name, icon, color }`, `src/navigation/types/`) typed so
far: `icon` is the user's own pick only (the form's `iconIsDirty` flag,
reset by every switch to a different kind), null otherwise, so the holding form keeps
following its own type default; `color` is null until picked. The
`HoldingForm` route is `HoldingFormParams` (`src/navigation/types/types.d.ts`; read it for the
exact shape: its `draft?` is `FormDraft | HoldingFormDraft`, and the `AccountForm` route's is
`FormDraft | AccountFormDraft`). The Accounts stack adds `returnTo`, so the Home stack, which has no
import screen to pop back to, cannot pass one. It is `holdingFormTarget` (`{ kind: 'account',
accountId } | { kind: 'implicit', implicitKind }`) plus `holdingFormStart` (the
`initialType`/`initialCurrency` a create on a named account opens with, applied once on mount; the
user can still change both) and `holdingFormDraft` (reads the draft, empty when absent), all in
`holding-form/holding-form-target/`; the form's own saved draft is read apart by `isSavedDraft`, see
"Form drafts" below. In implicit mode the form: queries no account
(`byIdQuery('')`); takes its offered types from
`creatableHoldingTypesForAccount(implicitKind, false, undefined)` (its
own call, with `implicitKind` as the account kind and no account row;
`['property_item']` / `['loan']`), and starts `type` on the first of them;
shows the shared `AccountKindField` (`src/screens/forms/account-kind-field/`,
which resolves its own label, sheet title, kinds, texts and glyphs, so a
form passes only `selected`, `onSelect`, `onSelectClosed` and `disabled`)
in the account form's own slot, under the divider; keeps the title "Add
Account" (the stack sets it statically for an `implicitKind` route too);
seeds name, icon and color from the swap draft ONCE (`useState` initial
values; a saved draft, `saved: true`, wins over the swap seed and over a
stored row on an edit, and `useDraftParam` reads it once at mount); and Save is
`accountsRepo.createImplicitHolding(implicitKind, {
name, type, currency, color, icon, ...active.createPayload() })` (one
write: it finds or creates the implicit account and stores the icon with
the holding, never in a second write), then `refreshMarketData`,
`runLoanAutoLinkIfLoan`, and `goBack()`. Picking Bank, Cash, Crypto,
Metals, or Broker there calls `navigation.replace('AccountForm', {
initialKind, draft })`, which seeds the account form once (a carried icon
counts as a pick); picking the other implicit kind calls
`navigation.setParams({ implicitKind })`, and the type effect re-snaps
the form in place. A pick that leaves for the account form is shown on the
kind field in the tap's own frame (`leavingKind` state, the same
picked-kind pattern as the account form's `pickedImplicitKind`) and its
sheet closes with no fade (`closesWithoutAnimation={isLeavingKind}`, so
`onSelectClosed` and the `replace` follow at once); the other implicit kind
keeps the fade. Both `replace` calls run from the field's
`onSelectClosed` (`SelectField`'s optional prop: runs once, with the
pick, after the sheet has FINISHED closing, via `BottomSheet`'s
`onClosed`), never on the pick itself: replacing mid-close would unmount
the screen that owns the sheet's Modal. `setParams` is immediate. `replace`, never `navigate`: Back from either form
leaves to the Accounts root instead of landing on a stale sibling
(`accounts.stack.swap.navigator.test.tsx` proves it on the real
router, not a spy). The Accounts and Home stacks give a route that carries a
swap `draft` `animation: 'none'` (`carriesDraft` in
`src/navigation/swapped-form-options/swapped-form-options.ts`;
a form's own saved draft, `saved: true`, is no swap and keeps the default
animation), so the swap reads as one form whose fields
change. native-stack pops a screen with the animation it carries then
(react-native-screens `RNSScreenStack` reads `fromVC.screenView.stackAnimation`), so
the same option would make Back unanimated: both routes carry a
`transitionEnd` listener that sets `animation: 'default'` once the swapped
form has appeared (never a layout effect on mount: it can reach the native
screen in the same mount batch and animate the swap), so Back (header button
and edge swipe) animates like any other screen.
`debtAccount` stays an EDIT-only route flag (holding detail passes it).

A `property` account's Type field IS its category picker
(`PropertyTypeField`, `src/screens/forms/holding-form/property/property-type-field/`):
`property_item` is that account kind's only holding type
(`holdingTypesForAccountKind`), so `HoldingFormScreen` renders this
`SelectField` wrapper — over `propertyCategories` from
`src/holdings/holding-metadata`, in the fixed display order Real
estate/Vehicle/Valuable/Business share/Loan given/Other, distinct from
`propertyCategories`' own declaration order — in the generic
`HoldingTypeField`'s slot instead, for every OTHER account kind's
holding form untouched. Editable in both create and edit mode (never
disabled, unlike the generic Type field), reusing the SAME "Type"
label/sheet-title/placeholder catalog keys. Editing an existing
holding pre-selects the stored category via `propertyCategoryOf`
(`holding-metadata.ts`), a LENIENT reader that falls back to `'other'`
for a missing/unrecognized value — independent of the strict
all-or-nothing `asPropertyMeta` parse `usePropertyFields`'s `seed`
still uses for the holding's `lots`.
`src/screens/forms/holding-form/property/property-section/` is now
just the Cost field (create-only); `PropertyFormBlock` mounts it only
in create mode. One lot
plus one manual price point equal to that cost is what
`usePropertyFields`'s own `createPayload`
(`src/screens/forms/holding-form/property/use-property-fields/`)
builds from it on save, via `holdingsRepo.create`'s
`firstPricePoint` param — see `kiko-pricing`'s "Creating and clearing
a priced holding's price series" section for the create/remove
symmetry.

**Ownership field.** `OwnershipField`
(`src/screens/forms/ownership-field/`; its entry logic `ownershipEntryOf`/`enteredShare`
lives apart in `src/screens/forms/property-ownership/property-ownership.ts`,
and `ownership-change-form` imports both) renders
in `PropertyFormBlock` on create AND edit for every category but
`loan_given` (`ownershipApplies`); an edited loan given shows no
block at all. A `SegmentedControl` Percent | Fraction (it changes
which fields show) sits under an "Ownership" `FieldLabel`; Percent is
one "Share" field with a `%` suffix (up to 2 decimals), Fraction is a
"Share" and an "Out of" field stacked (whole numbers). The value is
checked by `parsePercentShare`/`parseFractionShare`
(`src/holdings/ownership/`); `0`, above 100%, or `n > d` blocks Save
with `ownershipError`. Create defaults to 100% and writes NO
`ownership`/`ownershipInput` key at 100%; any other share writes one
change dated the lot day (the first day the holding has value; before
its first change a property reads whole) plus `ownershipInput` (the
picked mode). Edit
pre-fills the stored mode and the share in effect today
(`ownershipAt`); an "Effective from" `DateField` (default today)
appears only once the typed share differs, and Save records it through
`withOwnershipChange` (a same-day change is replaced, a change equal to
the share already in effect is dropped), keeping earlier changes. A
percent that shows the same rounded value as the share in effect
(`33.33` for 1/3) counts as unchanged (`enteredShare`,
`property-ownership.ts`), so re-saving never records 3333/10000. A
category switch keeps the stored list, even to `loan_given`, which
hides the field and ignores the list. This form never edits or
deletes a past change; the holding detail does.

**Share changes are editable.** The holding detail lists every stored
change newest first in a "Share Changes" section (`ShareChanges`,
`src/screens/holding-detail/share-changes/`, fed by
`propertyShareChanges`, `property-item.descriptor.ts`): the day
(`formatDate(day, { timeZone: 'UTC' })`) and the share through the
same `ownershipShareDetailText` as the "Your share" row. It is hidden
with no stored change and for `loan_given`. Each row is a `Card` in
`CardContextMenu` (long press, `liftOnHold`) with Edit and Delete —
no swipe. Edit opens `OwnershipChangeForm` (`{ holdingId, day }`,
`src/screens/forms/ownership-change-form/`): the same `OwnershipField`
with the "Effective from" `DateField` always shown, pre-filled with
that change's share (in the stored `ownershipInput`) and day. Save
calls `holdingsRepo.editOwnershipChange(holdingId, fromDay, change,
input)` → `withEditedOwnershipChange` (the old change leaves first,
then `withOwnershipChange`: moving onto a day that has a change
replaces it; a change equal to the share already in effect is
dropped). Delete goes through the menu's named `ConfirmSheet` to
`holdingsRepo.removeOwnershipChange(holdingId, day)` →
`withoutOwnershipChange` (the list is made canonical again, so a later
change that now repeats the share before it is dropped; the last
change removed leaves NO `ownership`/`ownershipInput` key — the whole
asset). Both repo methods take the day key, not a row, and re-read the
list inside one `write` (`rewriteOwnership`, `holdings.repo.ts`) — the
kiko-architecture "write started from a cached display screen" rule —
so a stale cached row can never put back a change another write
removed. `ownershipMetadata` (`src/holdings/ownership/`) is the one
builder of the ownership keys for the form and the repo.

**Dated series need pinned tests.** A model of dated changes (the
ownership series, and every future dated series) always has a pinned
test that an edit effective on day X leaves every bucket before X
unchanged. A value that switches source when data first arrives (a
linked loan's linked payments vs its schedule) always has a pinned test
that it does not step at the switch.
`src/screens/forms/holding-form/metal/metal-section/metal-section.component.tsx`
is the `metal` create-form section: a
physical-form `ChipRow`, a unit `ChipRow`, a Purity `TextField`
typed and shown as a fineness per mille (pre-filled `999.9`, suffix
`‰`, valid above 0 and up to 1000; `MetalMeta.purity` still stores the
0..1 ratio — `useMetalFields` shifts the point three places each way
with `shiftDecimal` + `trimDecimal`, so `999.9` <-> `"0.9999"` and
`1000` -> `"1"` exactly, never through a float), and the first-lot Quantity/Total-cost fields
(create-only — see `MetalSectionProps.showFirstLot`'s own doc
comment). Unlike `property_item`, `metal`'s create payload writes NO
`firstPricePoint` — its price comes from the shared
`metal:<XAU|XAG|XPT|XPD>` instrument, not a per-holding one (see
`kiko-pricing`'s "Creating and clearing a priced holding's price
series" section, and `useMetalFields`'s own comment
(`src/screens/forms/holding-form/metal/use-metal-fields/`)
on the metal CREATE payload). The metal/form/unit/purity fields stay
user-editable in EDIT mode (metadata patch), mirroring
`property_item`'s category-editable pattern.

The metal itself is picked in the Type slot, not in `MetalSection`:
`MetalTypeField` (`src/screens/forms/holding-form/metal/metal-type-field/`)
is a `SelectField` whose rows are the account's other creatable types
followed by Gold/Silver/Platinum/Palladium (no generic "Metal" row); a
picked metal sets type `metal` plus `MetalMeta.metal`. `HoldingFormScreen`'s
`typeSlotFor` renders it on a `metals` account, on a CREATE under a bank
whose creatable types include `metal` (the sellsMetals allow-list — see
kiko-pricing), and on the EDIT of a `metal` holding (metals only — the
type is locked, the metal stays editable). The edit of any other type,
even on a bank that sells metals, keeps the disabled generic
`HoldingTypeField`.

## Sync-only holding types are not manually creatable

Some `Holding.type` members are owned exclusively by the Monobank sync
pipeline (`src/monobank/sync/`, which creates those rows
programmatically) and must never appear as an option on the manual
create form — a bank's create form offers only the remaining,
non-sync types. Per Layer 2, this rule's exact type membership is not
restated here: read `src/holdings/holding-type/holding-type.ts`
(`syncOnlyHoldingTypes`, `isSyncOnlyHoldingType`,
`creatableHoldingTypesForAccount`) for the current sync-only set
and the derived creatable-per-account-kind set, and cross-check
against `sync.ts` for which types it actually writes.

The creatable set additionally depends on whether THAT PARTICULAR
account is live-synced, not just its kind:
`creatableHoldingTypesForAccount(kind, isSynced)` takes both — read
that file directly for the exact filter. `jar` is excluded
UNCONDITIONALLY, synced or not (it's a Monobank-API-specific
sub-account concept with no equivalent in a bank statement, so an
import-only account has nothing to name a manual "jar" after); `card`
is excluded ONLY when `isSynced` is true — an import-only bank account
(`isSynced` false, one of the 5 statement-import-only banks) CAN
manually create a `card` holding, since there is no sync pipeline
already owning one for it. Do not assume "sync-only type" means
"excluded regardless of `isSynced`" — `jar` and `card` behave
differently for exactly this reason.

Which holding types record their buy/sell history through the
dedicated Lot form (`src/screens/forms/lot-form/`, reached from
holding-detail's `addLot` footer action, and from a lot row's
long-press Edit) rather than a fixed one-time
lot or a sync is decided by each type's own `footerAction(synced,
holding)` in `holdingDetailSpecs` (`holding-detail-spec/`): a type is
lot-form eligible when that function can return `'addLot'` (read the `FooterAction` union there). `metal`
is eligible. See
`kiko-pricing`'s "Recording a lot: LotForm and the sell cost rule"
section for the form itself.

## Entity glyphs: one source of truth

The default SF Symbol/color for an `Account.kind` has one source of
truth: `accountKindSymbol`/`defaultAccountColor`
(`src/holdings/entity-symbols/`, `entity-colors/`). For a
`Holding.type`, each type's own descriptor
(`src/holdings/holding-descriptor/`) carries its `symbol`/
`defaultColor` — the descriptor IS the source; `holdingTypeSymbol`/
`defaultHoldingColor` are thin `recordByType` facades derived from it,
never a second place to set a type's icon/color. Every reader — the
account card, the account-detail header, the Kind select, the holding
card, the holding-detail header, the holding-form icon-chip fallback,
the Type select — calls one of these four functions; never add a
second kind/type -> glyph map in a screen module.

An account row's displayed icon + color come from one helper,
`accountIdentity` (`src/holdings/account-identity/`): the stored icon
or `accountKindSymbol[kind]`, and the color through
`resolveEntityColor` with `defaultAccountColor[kind]`. Every screen
that shows a stored account row's icon or color calls it; never rebuild the
`icon ?? accountKindSymbol[kind]` pair in a screen. There are two
exceptions: the account form edits a draft, not a stored row; and the
Charts contribution builder
(`src/statistics/account-contribution/account-contribution.ts`) calls
`resolveEntityColor` directly for the color only, because its input
has no icon.

A `property_item`'s default glyph follows its CATEGORY, not its type:
`propertyCategorySymbol` (same folder) maps each `PropertyCategory` to its
own SF Symbol, and `defaultHoldingSymbol(holding)` — the category glyph
for a `property_item` (read leniently via `propertyCategoryOf`, so
garbled metadata still gets the Other glyph), else `holdingTypeSymbol`
— is the glyph a holding shows. A holding's icon + color come from one
helper, `holdingIdentity` (`src/holdings/holding-identity/`), the twin of
`accountIdentity`: `icon ?? defaultHoldingSymbol(holding)` and the color
through `resolveEntityColor` with `defaultHoldingColor[type]`. A holding
picker option comes from `toHoldingOption(holding, accountNameById)`
(`src/screens/forms/holding-select-option/`). A screen never rebuilds the
pair, because copies of the rule drift apart (a colour divergence came
from such copies). Users: the holding card, the holding-detail header, the
holding form, the transaction form, the statement-import target options.
The holding form's untouched icon chip follows the picked category live,
and `PropertyTypeField` shows the same glyphs on its rows. A `loan` follows
its KIND the same way (`loanKindSymbol`: mortgage `house.circle.fill`, car
loan `car.fill`, consumer loan `cart.fill`, personal `person.fill` — the
mortgage is not `house.fill`, the Properties account's glyph), falling back
to `holdingTypeSymbol.loan` when the kind is missing or invalid. The only
remaining `holdingTypeSymbol[...]` reader is `defaultHoldingSymbol`
itself; the generic `HoldingTypeField` takes the whole record as its
`icons`. A past
`holding-icon.ts` plus a screen-exported `KIND_ICON` drifted from
this file, so the icon a user picked in a select differed from the
card glyph.

The icon pickers offer those defaults. A default is not a member of the
curated Kiko Entities pool (`@kiko/design-system/components/icon-pools`), so
`src/holdings/entity-icon-pool/` composes the pools the account and holding
forms open: `accountIconPool` (every `accountKindSymbol` value) and
`holdingIconPool` (every `holdingTypeSymbol`, `loanKindSymbol` and
`propertyCategorySymbol` value), each followed by the Kiko Entities pool,
deduplicated with the defaults first, so a user who picked a custom icon can
pick the entity's own glyph back. The defaults are read from the maps, never
copied, and it lives in `holdings` because the design system must not import
the maps; the screen passes the pool to `HoldingIdentityField`. A new default
glyph must be an SF Symbol that exists on the iOS 18.2 deployment target
(`receipt`, iOS 18.2, is the newest in use); there is no per-symbol fallback.
`__tests__/symbol-deployment-target.test.tsx` fails a default that is newer
(see kiko-design-system's "SF Symbol availability"). The category pool already
holds every category default.

## The `Money` value object

`Money` is the one place amounts are OOP (see `kiko-code-style` for
why this is the deliberate exception to functional-first). It holds
`{ currency, minorUnits }` and is immutable.

- `minorUnits` is always an integer. **Never a float.** Scale is
  per-currency: read it from `currencyScale` in
  `src/currency/currency/currency.ts`, never restate a currency's scale.
- `formatMoney` renders a crypto amount from `splitMinorUnits` (an exact
  integer split, no float division) and trims trailing zeros down to at
  least 2 decimals; fiat keeps its fixed scale. Every new digit-producing
  display or edit text (for example `majorAmountText`) uses
  `splitMinorUnits`, never `/ 10 ** scale` or `toFixed`.
  `splitMinorUnits` rounds a non-integer stored value first (a test pins
  it).
- The value object itself — construction, arithmetic, and the
  currency-mismatch guard — lives in `src/currency/`. Read it
  directly for the current method set rather than trusting a list
  restated here; it drifts (this skill once claimed `Money` had
  `convert`/`format`/comparison methods it does not have).
- Converting a `Money` to a different currency is not a `Money`
  method — that owns a separate concern and lives in `src/rates`.
  Read that directory for the current conversion entry point.
- Formatting a `Money` for display is not a `Money` method either —
  that owns a separate concern and lives in
  `src/currency/`. Read it for the current formatting entry
  point.
- Any table column holding an amount is an integer minor-units
  column (`balanceMinorUnits`, `amountMinorUnits`), never a decimal
  or float column. Exception: `funding_match_rows` `amount`, `fee`, `tax`
  are TEXT, because rule 51 compares `normalizeDecimal` text and no scale
  is known per coin (O70). Convert to/from `Money` at the repository
  boundary — a raw `row.balanceMinorUnits` read for a VALUE goes
  through `holdingsRepo.balanceOf(row): Money`, never a direct
  member read outside a repository (mechanized, Class B:
  `kiko-balance-through-repo` in `rules/semgrep-mobile.yml`); a WRITE
  input takes `Money` and converts inside the repo, throwing on a
  currency mismatch — `holdingsRepo.create`'s optional
  `openingBalance`, `updateWithBalanceDelta`'s patch `balance`,
  `setSyncedBalance`'s `balance`, and `accountsRepo.createCashAccount`'s
  `initialBalance`. The sync upserts (`upsertMonobank(Many)` /
  `upsertExchange(Many)`) are the one exception: they write a raw
  provider-given balance straight through every run, never a typed
  opening balance, so their own input keeps a plain
  `balanceMinorUnits: number`.

## Currencies

A small closed set — read `schema.ts`'s `currency`/`baseCurrency` enum
for the exact current member list and `currencyScale`
(`src/currency/currency/currency.ts`) for each scale rather than
trusting a count restated here. Crypto (`isCrypto`) shares one display
rule, see `formatMoney`. Map a
currency code to its scale with `ts-pattern`'s exhaustive `match` — a
currency literal type, not a free string, so adding a currency is a
compile error everywhere the mapping is missing.

Monobank statement currencies arrive as ISO 4217 numeric codes
(`980` = UAH, `840` = USD, `978` = EUR); map them to our currency
literal with `ts-pattern` at the sync boundary, never store the raw
numeric code.

**One source of truth for the currency-code set: `currencyOptions` in
`src/currency/`.** The Drizzle column enums in
`src/db/schema.ts` were once a HIDDEN second, hard-coded copy of this
set (a real drift risk — the same class of bug the `Account.kind`
"broker" incident above documents); they now DERIVE from
`currencyOptions` instead. When you add, remove, or rename a currency
code, change `currency.ts` only, then verify (do not re-hardcode) that
`schema.ts`'s currency-bearing column enums, `rates-refresh.ts`'s
`allCurrencies`, and `monobank-rates.ts`'s `fiatCurrencies` all still
derive from `currencyOptions` rather than carrying their own literal
list. A Drizzle `text({ enum: [...] })` is a TS-only compile-time
hint, not a DB constraint, so changing the set needs no migration.

**The crypto members come from the coin registry**: `curatedCoins` and
`coinScale` in `src/currency/coins/coins.ts` (ids, names, scales; read the
file, never restate its members). It imports nothing from `currency.ts`.

**A restore rejects an unknown currency.** `assert-known-currencies.ts`
(`src/data-transfer/snapshot/`) fails with its `unknown-currency` error
(read the file for the exact code) on any currency outside
`currencyScale`: every `{ enum: currencyOptions }` column, the JSON
currency fields (matchers, drafts) and `bond_register` terms. Test
membership with `Object.hasOwn`, never `in` (an inherited
name such as `constructor` passes `in`). A new currency-bearing column
or JSON field joins that check in the same commit.

**A cash holding is fiat-only for every NEW write.** `src/holdings/holding-currency/`
owns the rule (`isCurrencyExpectedForHoldingType` feeds the create
picker's groups via `currencyPickerGroups`, `isCurrencyAllowedForHoldingType`
guards a write). Every path that can
create a cash holding rejects a crypto currency: the holding form and
cash-account form offer fiat only, and `holdingsRepo.create` and
`accountsRepo.createCashAccount` throw. Statement import and the syncs
never create a cash holding. `isCurrencyExpectedForHoldingType` is the currency a type is
CREATED in: a `crypto_asset` in a cryptocurrency, every other type in a fiat one, though a
write tolerates more (a `crypto_asset` accepts fiat; only `cash` is fiat-only). It is the
holding picker's first group (`currencyPickerGroups`, which adds a fiat group after the crypto
one for a `crypto_asset`), and the "create payment holding" type filter reads the same
function, so the two cannot drift. `isCryptoHoldingType` is the type test the
create picker uses to lead with the cryptocurrency group
(`src/holdings/holding-currency/holding-currency.ts`).
An ALREADY-stored crypto cash holding (a
1.0-era BTC/ETH/USDT `cash` holding) is migration `0044`'s job, not this
rule's — `0044_move_crypto_cash_holdings.sql`'s doc comment is the full
statement of the matching rule, including the archived-source carve-out.
`restore-snapshot.ts`'s `withCryptoCashHoldingsMoved` applies the
IDENTICAL rule to a `.kiko` restore, sharing the SAME deterministic id so
both paths agree on the same account for the same source; a restore of an
already-migrated export is a no-op because every matching holding is
already `crypto_asset`. See `kiko-architecture`'s migration bullets for
the crash-safe order.

KNOWN LIMIT (migration 0044): the holding it moves is a MANUAL
`crypto_asset`, so `cryptoAssetDescriptor`'s `exchange.createSource` and
`createDestination` are both `false` — it can be picked as neither leg of
a freshly CREATED Exchange, and it has no Split leg at all. To record a
new purchase into it, log the outflow as a plain manual expense elsewhere
and use Convert on that transaction instead.

## Category color resolution

A category's display color is never read as a raw
`category.color ?? undefined` at the call site — every renderer
(chart legend, chart slice, filter chip, transaction-row icon)
resolves it through `resolveCategoryColor(storedColor, key)`
(`src/statistics/`), which falls back to a stable
per-key palette hash when no color is stored. The raw-fallback pattern
renders gray for an uncolored category while a chip for that same
category shows a palette hue — a past transaction-row icon regressed
this way.

The ten categories `0002_seed_categories.sql` seeds do NOT rely on that
hash fallback in practice: migration `0017_default_category_colors`
(`drizzle/migrations/`) gives each seeded key an explicit, distinct
`categories.color` — one `theme.colors.entityColors` member per key,
guarded `WHERE color IS NULL` so it never overwrites a color the user
already picked, and safe to re-run. It exists because the hash, run
over those exact ten keys against the 8-entry `chartSeries` palette,
collapses to five hues (four categories rendered an identical blue
donut wedge before the seed). The per-key hash fallback above is real
and still exercised — a user-created category with no chosen color
still falls through to it — but for the seeded ten it is a fallback
that normally never fires.

The `key` handed to it is never a raw stored value. A stored category
resolves through `resolveCategoryKey` / `resolveCategoryDisplay`
(`src/categories/`): lowercased, with a null, empty,
or unknown-to-the-categories-table slug folding onto the **default**
key (`settings.defaultCategoryKey`, read at the call site — never a
separate "uncategorized" bucket). One fold, one place: the spending
breakdown's `groupKey`, the spending TREND's own `groupKey`
(`src/statistics/category-trend/`), Home's `categoryKeyForRow`, and
every color lookup all go through it, so a category can never render
under two keys — and therefore two hues — at once. The trend's
`groupKey` used to fold with a bare `category?.toLowerCase() ||
defaultKey` instead — it caught a null/empty category but not an
UNRESOLVABLE one (a slug no longer in the categories table, e.g. a
deleted seeded category sync keeps re-writing), so a deleted category
rendered as two same-titled, differently-keyed lines on the trend chart
while the donut correctly folded it into one. The same shape recurred at
`holding-detail.screen.tsx`'s ledger-row icon color (the title/icon
resolved through `resolveCategoryDisplay`, correctly folded, but the
color's own fallback key was re-derived from the raw, unfolded category).
A Semgrep rule (`kiko-no-bare-lowercase-category-fold`,
`rules/semgrep-prewrite.yml`) now bans a bare `<category>?.toLowerCase()
|| <default>` fold anywhere under `src/**` (widened from
`src/statistics/**` once the second site turned up outside it) — use
`resolveCategoryKey` instead.

Writers hold up the other end: a category value is persisted only as
the lowercase `categories.key` slug. `categoryForMcc`
(`src/monobank/`) emits the slug, not a display title,
and migration `0014_lowercase_categories` lowercased the legacy rows a
capitalized-title era had already written. Neither
`transactions.category` nor `category_rules.category` is COLLATE NOCASE;
`categoriesRepo.delete`'s reassignment compares case-insensitively on both
sides (`lower(column) = lower(key)`), so an un-migrated transaction row from
an older build is folded onto the default instead of orphaned on a deleted
slug; the category's rules are deleted in the same write, and the moved rows
lose the by-hand flag.

**Rule validation.** `src/categories/category-rules/validate-rule.ts`
owns it; a `neverMatches` result carries `conflict: 'time' | 'other'`
(read the `RuleValidation` type in `category-rules.d.ts`), and only the
time conflict gets the midnight hint. The editor's matcher option lists
come from `src/categories/category-rules/matcher-options.ts`. The
editor's amount draft converts through `Money.fromMajor` exactly; a
draft with too many decimals for the currency is refused.

**Rule IBAN spelling.** `IBAN_PATTERN` and `ibanKeyOf` live in `src/transactions/iban/iban.ts`
(barrel `@kiko/transactions/iban`). The parser stores the key form (no whitespace, uppercase), so
the stored, compared and displayed forms are one.

**Rule on a deleted account.** A rule on an account id that no row holds stays stored and never
matches (`src/categories/category-rules/prepare-rules.ts`); the card reads "Deleted account"
(`src/screens/forms/category-form/rule-summary/rule-summary.ts`); a restore keeps the id. The form
seeds an unknown id as none, so Save asks for a pick
(`src/screens/forms/category-rule-form/rule-draft/rule-draft.ts`). An account deleted while the
form is open: `clearStaleAccounts` (same file, used in `category-rule-form.screen.tsx`) clears
it, so Save asks for a pick.

**Review list.** `planReviewGroups` (`src/categories/category-rules/plan-review-groups.ts`),
`reviewCandidateRowsQuery`, `name-tally.ts` and the `CategoryReview` route
(`src/navigation/settings-stack/settings.stack.tsx`) build and show it.

A review line may carry a suggestion from the user's history. `reviewEvidenceQuery`
(`src/categories/category-rules-repo/category-rules.repo.ts`) is the fourth read; `addVotes` and
`suggestionOf` in `plan-review-groups.ts` turn its rows into votes. Only real categories vote,
and votes count under the merchant key. The thresholds (`SUGGESTION_MIN_AGREEING_ROWS`,
`SUGGESTION_MIN_SHARE`) live in that file and are not exported: read them there. Nothing is
written until the user taps the chip.

## Spending-exclusion pipeline

An internal money movement (cash-out, own-account transfer, one leg of
a same-user transfer between holdings, an Exchange/Convert leg) is
excluded from the spending view — read
the transfer-exclusion module (`src/statistics/`, MCC/description based, backed by
`transactions.counterIban` and `settings.defaultCategoryKey`),
the internal-transfers module (`src/statistics/`, the matched-pair fallback), and
the exchange-exclusion module (`src/statistics/`, the exchange-marker rule), and
the exchange-funding module (`src/statistics/exchange-funding-match/`, which pairs a
purchase row with its funding bank debit)
directly rather than trusting a restated MCC list here; see
`kiko-architecture` for the same pointer.

A NEW exclusion rule also goes in `recurringExcludedIds`
(`src/recurring/eligibility/eligibility.ts`), so a recurring series never counts the row.

### Recurring detection

`src/recurring/` holds the recurring-charge detection: read `detection.ts` and `eligibility.ts`
there for the rules and thresholds; none is restated here. Eligibility reuses `ledgerRowsOf`,
`ownIbansOf` and `accountKindByHoldingIdOf` from the spending-ledger barrel.

A mark is the user's "mark as recurring" on a transaction (spec 8.2). Read
`src/recurring/marked-series/marked-series.ts` (the chain and series rules),
`src/recurring/recurring-periods/recurring-periods.ts` (the periods and their order) and
`src/settings/recurring-merchant-choices.ts` (the one map). The rules, in words:
- A mark stores the absolute stored amount and the currency of the marked row's holding, under the
  merchant key. It covers one currency: the same amount in another currency never compares.
- A mark's chain is the amount chain that holds its stored amount, cut by the same 1.25 step as
  detection. The chain's charges are the series, with the mark's period; the stored amount joins
  the cut like a charge, so it can bridge two charges. Pieces share no row, and a detected series
  that shares a row with a marked one leaves whole.
- The amount chain reads only amounts, so a twin fold cannot change which chain a row is in.
- The accepted false stop: a subscription that goes on at a price outside the chain shows "No
  charge since" until the user re-marks. This is the user's ruling, not a defect.
- One choice map holds every key's hide flag and its list of marks, one entry per key; removing
  a mark clears only that mark, and "Show again" clears only the hide.

Which rows each step reads (`src/statistics/spending-ledger/`, one hook and one pure builder
that the Statistics screen calls; `useStatisticsSources` in
`src/statistics/statistics-sources/` supplies the reads, and the account filter's scope is in
`src/statistics/statistics-filter-scope/`; read the hook and the builder there for the row
names): the spending charts always draw every row of the holdings
under the KEPT accounts, open or closed, so a closed card keeps its past spending.
The internal-transfer matcher runs over the unfiltered ledger (every
holding, whatever the account filter or `closedAt`). The funding matcher
(`exchangeFundingMatches`) reads the same unfiltered ledger plus an
account-kind-by-holding map (a holding with no account counts as a bank side), so the
account filter never brings a funding debit back. The nearest-first pass alone can strand an
exchange row, so the matcher adds an augmenting-path pass (`addAugmentingPairs` in
`exchange-funding-match.ts`) and its test file holds a maximum-matching floor test
(`maximumMatchingSize`): a change to the matcher keeps both. The transaction form reads its
`excludedIds` through `useExchangeFundingCaption`
(`src/statistics/exchange-funding-match/use-exchange-funding-caption/`). The loan-payment
exclusion runs over the account-filtered rows.

A linked loan payment ("interest-only
spending") is excluded the same way, but REPLACED rather than simply
dropped: the loan-payments module (`src/statistics/loan-payments/`)
exports `loanPaymentExcludedTransactionIds(transactions, loanHoldings)`
(transactions carry `time`; `loanHoldings` are full `LoanHolding` rows
with `metadata`), which
drops a row from the pie/trend the same way every other exclusion
rule does, IF AND ONLY IF its `transactions.loanHoldingId` marker
points at a holding present in `loanHoldings`, in the same currency, AND
the payment is on or after the loan's start day
(`isOnOrAfterLoanStartDay`). A pre-start linked payment is ordinary
spending (user ruling Q7 = A); a loan whose metadata cannot be read stays
excluded; the interest mapping inherits the rule. A dangling link (its loan holding was
deleted — `transactionsRepo.removeHolding`/`accountsRepo.remove` already clear
the marker transactionally the moment that happens) is NOT
excluded, so it counts as ordinary spending under its own category,
exactly like an unlinked row. The same module's
`loanInterestEntries({ transactions, loanHoldings })` derives up to
TWO synthetic entries per excluded row, both from `loanPaymentSplitsMinor`:
`loan-interest:<txId>` — category the seeded `loan_interest` key
(`drizzle/migrations/0039_seed_loan_interest_category.sql`), amount
the NEGATIVE interest portion only (never the principal) — and
`loan-excess:<txId>`, the within-tolerance fee (|p| − S_k when
S_k < |p| ≤ S_k + T_k, T_k = max(1 %, 1.00 in the loan currency)),
under the payment row's own category (null folds to the default). Each
maps
the payment to the installment whose due date is nearest to its own
local day and capping at the payment's own amount; an installment paid
in parts counts its interest once, on the earliest parts
(`loanInterestPerPaymentMinor`, `src/holdings/loan-schedule/`, allocated
per loan over all of that loan's linked payments).
The spending ledger (`src/statistics/spending-ledger/`) builds these derived entries
over the account-filtered rows, and the Statistics screen feeds them into BOTH
`buildCategoryBreakdown` and the category trend, alongside every real
row — not into the exclusion-RULE inputs themselves (a synthetic
entry carries no mcc/description/IBAN signal, so it plays no part in
detecting a transfer).

Decision 7: a negative balance-set row (`setsBalance`) leaves spending, because its amount states
a balance, not money spent. `balanceSetIdsOf` in
`src/statistics/spending-ledger/spending-ledger.ts` is the eighth exclusion key, built over every
holding's rows whatever the account filter. `loanInterestEntries`
(`src/statistics/loan-payments/loan-payments.ts`) also drops a marked row before it splits, so a
marked row linked to a loan emits no entry and the loan's other payments split as if it did not
exist. A positive marked row is in the set but was never in the donut.

Where the Statistics code lives (read each folder, not a name list here):
`src/statistics/spending-ledger/` (the ledger hook and pure builder),
`src/statistics/statistics-sources/` (the screen's reads),
`src/statistics/statistics-filter-scope/` (the account and category filter scope, including the
kept selection unioned back in), and `src/statistics/use-rate-history-backfill/` (the rate-history
backfill the screen only calls).

## Deleting a movement takes its other parts

A transaction can be one part of a movement: the legs of an Exchange or Convert
(`transactions.exchangePairId`, the shared pair id), the rows of a split payment
(`changeGroupId`), and the leg that paid a term deposit (its contribution is
metadata, tied to the leg by the leg's marker and date). Deleting any part takes
the others with it, each reversing its full amount on its own holding, in ONE
transaction: `transactionsRepo.remove` (read its doc comment for the exact rule).
Rules:

- **The closure is followed to a fixpoint.** A Convert is allowed on a split row,
  so a split group and a pair id can each lead to a row carrying the other.
  `readMovementRowsDatabaseTransaction` reads rows sharing a group or pair id
  until a pass finds nothing new; following either id one hop leaves a part
  behind and creates or loses money. The plan and the delete use the same set.
- **A bank-owned (synced) partner is kept**, never deleted
  (`isDeletableTransaction`); a Convert gives a synced existing row only the pair
  id, which is how the delete knows its partner is the bank's. A bank-owned row
  can still carry a marker: a marked import row the reconnect sync adopted
  (`adoptImportTwinsDatabaseTransaction`). The delete that keeps it clears its
  `exchangeCounterpartHoldingId` in the same write (`removeRowsDatabaseTransaction`'s
  `kept`, for a leg delete and the holding/account cascade alike) ONLY when the leg
  the marker names goes with that delete (`markerLegIsGone`): the marker's holding
  is among the deleted holdings (a deposit source leg whose deposit is deleted
  included), or a removed row of the same pair sat on it. A marker that names
  anything else stays, because its leg stays: a deposit source leg Converted again
  keeps `deposit` while the dollar leg joins the pair, so deleting that dollar leg
  (or the dollar card) leaves the row excluded from spending, the deposit still
  holding the contribution. On a leg delete, a marker reached only through a split group names no
  removed leg and stays too; in a holding/account cascade a split-only kept row
  whose marker names a deleted holding is cleared. The delete keeps the pair id and moves no balance: a
  marker left naming a gone leg would keep a real purchase out of spending
  (`exchangeExcludedTransactionIds`) for good, and one cleared while its leg stays
  would count the purchase twice. The confirm text does not change.
- **A re-Convert keeps the deposit marker.** `markExistingLegTransaction` sets
  the counterpart marker only when the row has none, so a deposit source leg
  keeps the marker that takes its contribution out. The marker therefore may name
  a holding no leg of the pair sits on (the deposit), which is why a delete never
  clears a kept row's marker just because the row has one.
- **A same-currency pair says "transfer".** `missingPartSentence` and
  `exchangeSentence` (`src/transactions/remove-notice/remove-notice.ts`) pick
  `transactions.deleteLinked.transfer`, `.transferUnlinked` and
  `.transferUnlinkedPlain` for a pair whose legs share a currency (a manual
  same-currency exchange between two holdings), the `exchange*` keys otherwise.
  A Binance row is never the one deleted here: a synced row is not deletable.
- **An unreadable deposit is not an error.** `removeDepositContributionDatabaseTransaction`
  returns false when the metadata cannot be read or no single contribution
  matches: the leg deletes and the deposit stays, as the confirm said
  (`depositKept`).
- **The confirm text is a plan read before the delete**
  (`transactionsRepo.removePlan` -> `removeNotice`, `src/transactions/remove-notice/`);
  the delete re-reads inside its own transaction and the plan never decides. The
  plan names: the exchange parts that go (`names`), a bank-owned part of the same
  pair that stays (`keptNames`, `exchangeAlsoKept`) or a pair whose every other
  part is the bank's (`syncedKept`), the split, the deposit contribution, and
  each holding's balance change (`balanceChanges`, one
  `transactions.deleteLinked.balanceChange` line per holding, signed in the
  holding's currency by `formatMoney`; no line for a holding whose parts net to
  nothing or for a bank-owned part that stays). A pair the row is no member of
  (the row has no pair id, or its own is a different one) is reached only
  through its split: `viaSplitPairOf` (`transactions.repo.ts`)
  names it as `splitExchanges`, with the ruled `splitExchange*` sentences (one per
  holding, a leg the bank owns or none can be found for included), never as "the
  other part of this exchange"; a "could not be found" holding the row's own
  `exchange` sentence already names is not named again there; with a split, the exchange sentences that say
  "only this part is deleted" take the same split wording. A holding or account
  delete lists the OTHER holdings' changes only (`RemoveHoldingsPlan.balanceChanges`,
  and `templatesChanged`, the templates whose holding reference the delete clears,
  rendered by `removeHoldingsNoticeOf` with `holdings.deleteLinked.templates`).
- **A confirm opened twice shows the latest plan.** The `CardContextMenu`
  `deleteMessage` is async and a superseded result is dropped (see
  `kiko-design-system`).
- **Holdings and accounts follow the same ids.** Deleting a holding or an account
  also deletes the movements its rows were part of: see "A holding is deleted
  only after its cascade". Its plan is `transactionsRepo.removeHoldingsPlan`,
  rendered by `removeHoldingsNotice` / `removeHoldingsNoticeOf`.
- **Legacy pairs are backfilled only where provable.** Migration 0052 pairs a leg
  1:1 or leaves it null; a null pair id deletes that one row only.

## App lock / security settings

`settings.lockEnabled` is LIVE (a `.kiko` restore never changes it) — wired through `src/auth/use-app-lock.ts`
and the `AppLockSetting` component
(`src/screens/settings/system/app-lock-setting/`). `settings.lockGraceSeconds`
is LEGACY/DEAD: it defaults to 30 and has no reader anywhere in `src/`
(a grace-period-after-backgrounding design was built, then replaced
with a cold-launch-only lock; the column was intentionally left in
place rather than dropped via a migration). Treat it as legacy — do
not re-wire it without a deliberate decision to resurrect the grace
period, and re-check `src/db/schema.ts` before relying on this
description if the lock design changes again.
The shipped lock is **cold-launch only**: `useAppLock` decides once and never
re-locks, so a resident backgrounded process resumes without a prompt. That is
an accepted, recorded risk — see `docs/security/README.md`. `lockGraceSeconds`
is one of the documented reader-less `settings` columns pinned by
`src/db/settings-columns.test.ts`'s `DOCUMENTED_READERLESS_COLUMNS` list —
the other is `appearance` (the removed light/dark color-scheme feature; the
app is now dark-only, see `kiko-design-system`'s "Dark-only theme"); wiring
either back up means removing it from that test's list, which is the
deliberate decision gate. Read the list itself for the exact current set
rather than assuming only these two.

## Dates

`src/dates/calendar-month.ts` holds the local calendar-month helpers (read its exports there).
`DAY_MS` from `@kiko/dates` is the one day-length source, in app code
AND tests. Never declare a local day-length constant; only `src/dates/`
may. Semgrep `kiko-no-local-day-length-constant`
(`rules/semgrep-prewrite.yml`) denies it — read the rule for the
spellings it catches.

Interest and schedule math (`src/holdings/` — deposit
maturity, period boundaries, coupon dates, accrual day counts) is
built entirely with **local-midnight instants**, not UTC. Read the
`daysBetween` comment in that module for why: a raw
`floor((end-start)/DAY_MS)` under- or over-counts by a day across a
Kyiv DST transition, so every boundary (`atDay`, `midCredit`,
`addMonths`) is deliberately constructed from local Y/M/D fields and
diffed via `Date.UTC(y,m,d)` on each side, making the local calendar
day the unit that's compared rather than a raw millisecond delta.
`addMonths` clamps the result's day-of-month to the target month's
length (no January-31 + 1 month rolling into March) while preserving
whatever time-of-day the input carried — it does not force the result
to local midnight, so a non-midnight input keeps its hour/minute/
second/millisecond across the step.

A bi-weekly (opening-day-anchored semi-monthly) deposit's capitalization
tag is carried by the CREDIT INSTANT that produced it, never re-derived
from the instant's own calendar month afterward — a collapsed mid-month
credit (the opening day's `+1` boundary landing past the month's own
length) moves onto the SAME instant as that month's own plain "1st"
credit, and it keeps its capitalizing tag when it moves; re-deriving the
tag from the moved instant's own month cannot tell the two apart and
silently drops a capitalization every time the collapse happens. The
period ending AT maturity always capitalizes too, even when maturity
happens to coincide with what would otherwise be a plain,
non-capitalizing credit (an opening day of 1) — read `biweeklyCredits`/
`depositPeriods` in `src/holdings/interest/interest.ts` for the exact
mechanism.

Tests for these helpers use two input styles side by side in
`src/holdings/`'s interest test, and both stay valid because `addMonths` preserves
the input's time-of-day rather than forcing local midnight: the file's
own `local(year, monthIndex, day)` helper for anything that crosses a
DST boundary, and `Date.UTC(...)` where the comment at the call site
says the instant is a winter (no-DST) boundary. A `Date.UTC` instant
is not local midnight on any machine whose system timezone offset
isn't zero (this repo's dev machine is Kyiv, UTC+2/+3) — build a new
test with `local(...)` unless it is specifically exercising a winter
instant the way the existing `Date.UTC` cases do.

`formatDate`/`formatDayMonth` (`src/dates/format.ts`) take an optional
`options?: { timeZone?: 'UTC' }` param: pass it when the caller's own
instant is a UTC-midnight value standing for a LOCAL calendar date
(e.g. `price_points.day` — see `kiko-pricing`'s `dayKeyOf` convention)
— reading such a value with the default LOCAL `Date` getters can land
on the previous calendar day in a negative-UTC-offset timezone. Every
other date formatter in that file stays local-timezone by default;
only pass this option for a value that is already a normalized UTC
calendar day, not for an ordinary wall-clock timestamp.

The recap-OFF first-accrual-day convention (what day a deposit starts
earning when the recap toggle is off) is unresolved — it needs a real
bank statement to confirm against, not a guess; do not implement or
assume a specific convention for it without one.

When you introduce a new epoch-ms-from-string parse of an external
feed's calendar date (e.g. `YYYY-MM-DD`), grep every consumer's own
get-date convention before picking UTC vs. local for the parse.
`BondMeta.maturityDate` was first parsed from the NBU register's
`pgs_date` as UTC midnight, but every consumer reads it through
device-local getters — silently shifting maturity (and every derived
coupon date) back a day west of UTC.

The whole Jest suite runs on Europe/Kyiv: `jest.config.js` sets
`process.env.TZ = 'Europe/Kyiv'` at load time, before the workers
fork, and inside Stryker's in-band test-runner process. It overrides
the host zone. `__tests__/jest-time-zone.test.ts` fails if the pin
breaks (it expects UTC+2 in January and UTC+3 in July). A test can
therefore assert Kyiv wall-clock times and Kyiv DST transitions
(spring-forward on the last Sunday of March, fall-back on the last
Sunday of October) directly, with no guard of its own.

Never set `process.env.TZ` inside a test file (`beforeAll`, a
`withTimeZone` helper, or mid-test). Jest gives each test sandbox its
own copy of `process.env`, so the assignment never reaches Node's TZ
setter and `Date` stays on Kyiv, so a flip that names a non-Kyiv zone
does not test the zone it names. A test that needs another zone's
behavior must inject the offset or zone into the code under test
explicitly (for example `formatDate`'s `{ timeZone: 'UTC' }` on an
instant whose UTC and Kyiv days differ). Code that takes no zone input
is tested under Kyiv only; do not add a production parameter just to
inject one. Exception: to PROVE a result is zone-independent, wrap the run
in `withDeviceZoneOffset` (`src/test-support/device-zone-offset.ts`; read
its header for exactly what it retargets — only the multi-argument local
`Date` constructor). Semgrep `kiko-no-process-env-time-zone-in-test` (ERROR)
denies the assignment in every test path.

The pin does not make a test zone-correct. Many holdings, prices,
rates, and statistics suites build fixtures with `Date.UTC(...)`
midnights and pass them to local-day code. They pass only because
Kyiv is east of UTC, and they fail on a west-of-UTC clock. Build new
fixtures with the local `Date` constructor (`new Date(y, m - 1, d,
...)`), not `Date.UTC`, unless the value is a normalized UTC calendar
day (see `dayKeyOf`).

Known debt: some suites still feed `Date.UTC` midnight fixtures to
local-day code; list them with `grep -rl 'Date.UTC' src --include='*.test.ts*'`.
They pass under the Kyiv pin only because UTC midnight is 02:00/03:00
Kyiv on the same calendar day; a zone west of UTC would shift each
fixture a day back.

Never build a test fixture as the real clock plus or minus a fixed day
span (`Date.now() + DAY_MS`, `now - 2 * DAY` where `now = Date.now()`).
A local day is 23 or 25 hours across a DST change, and a late-night run
crosses a second midnight (`Date.now() + DAY_MS + 1 h` after 23:00), so
the fixture lands on the wrong local day and the test fails only at
some hours. Step local calendar days instead with the shared
`localDaysFrom(time, days)` helper (`@kiko/test-support/local-days-from`;
wrap it in `startOfLocalDay` for a local midnight), or offset from a
pinned instant (a fixed constant, `jest.setSystemTime`, or
`jest.useFakeTimers({ now })`).
Wrapping the sum in `startOfLocalDay` does not fix it: the sum itself
can land two local days ahead. Semgrep
`kiko-no-fixed-day-offset-on-real-clock-in-test`
(`rules/semgrep-prewrite.yml`) enforces this in every `*.test.ts(x)` and
`src/test-support/**`. It reads the clock as `Date.now()`,
`new Date().getTime()`, or a `const`/`let` bound to `Date.now()`, also
behind other offsets (`Date.now() + HOUR + DAY_MS`,
`Date.now() + HOUR + MINUTE + DAY_MS`; behind one offset only for a
`const`/`let` clock). It reads a span
as a day span by its text: "day" as a whole camelCase or snake_case
part (`DAY`, `DAY_MS`, `dayMs`, `msPerDay`, `days`), `86_400_000`,
`24 * 60 * 60`, or `60 * 60 * 24`. A word that only contains "day"
(`startOfToday`, `holiday`, `Monday`) is not a day span. A date-valued
`…Day` name is a point, not a span: `startOfDay(now)`,
`startOfLocalDay(now)`, `endOfLocalDay(now)`, `startOfUtcDay(now)`,
`lastDay`, `firstDay`, `nextDay`, and `previousDay` (a
`startOf`/`endOf`/`Local`/`Utc`/`last`/`first`/`next`/`previous` word
right before `Day`), so
`Date.now() - startOfLocalDay(now)` is an elapsed time and is not
flagged. `graceDays`, `msPerDay`, and `twoDays` are still spans. A day
COUNT is not a day step either: `Math.floor((Date.now() - openedAt) /
DAY_MS) - graceDays` is not flagged, because the rule matches a sum
whose left side starts with the clock (`Date.now() + HOUR + MINUTE`),
not a clock sum nested anywhere inside a larger expression.

Known limits, not flagged:

- An offset from a value derived from the clock
  (`TRANSACTIONS[0].time - 10 * DAY`).
- A sub-day offset (`now - 60 * 1000` right after midnight).
- A clock read assigned later, not at the declaration
  (`let now; beforeEach(() => { now = Date.now(); })`, then
  `now + DAY_MS`). The rule sees only `const`/`let now = Date.now()`.

Flagged even though pinned: a pin in a `beforeEach` (the exemption sees
a pin earlier in the same block only), so bind the pinned instant to a
constant and offset from that.

The same DST rule holds in app code: never add a fixed day span to the
time you pass to `startOfLocalDay` or `endOfLocalDay`. The default date
range once built its start as `startOfLocalDay(now - 30 * DAY_MS)`; 30
fixed 24-hour steps across a DST change land one local day off. Step
local calendar fields instead: `new Date(y, m, d - 30)` is already the
local midnight 30 calendar days back (`defaultDateRange` in
`src/dates/default-range.ts`); a time of day kept from the input needs
`startOfLocalDay(...)` of that stepped date. Semgrep
`kiko-no-fixed-day-offset-into-local-day` (`rules/semgrep-prewrite.yml`)
denies it in app and test code alike: a `DAY`, `DAY_MS`, `…_DAY_MS` or
`…_DAYS_MS` (`ONE_DAY_MS`, `THIRTY_DAYS_MS`), `…_PER_DAY`
(`MS_PER_DAY`, `MILLISECONDS_PER_DAY`), `dayMs`, `…DayMs` or `…DaysMs`
(`oneDayMs`, `ninetyDaysMs`), `msPerDay`, `86_400_000`,
`24 * 60 * 60`, or `60 * 60 * 24` span (`1000 * 60 * 60 * 24`
included) added or subtracted anywhere inside the argument
(`startOfLocalDay(time - 2 * DAY + HOUR)` fires). A sub-day offset
(`startOfLocalDay(now - HOUR)`) and a point in time named with "day"
(`startOfLocalDay(dayStart + HOUR)`) are not flagged: a span name ends
in a day-span suffix, never a bare "day" part. Known
limit, not flagged: a span applied after the call returns
(`startOfLocalDay(time) - DAY`) shifts a local midnight by a fixed
24 hours, the same DST class, and has its own follow-up.

## Net worth

**Net worth = Σ asset values − Σ debt outstanding**, in the base
currency — it is not assets-only. It is the sum of every non-archived holding's value
(`holdingValue`/`holdingValueBreakdown`, `src/holdings/holding-value/`),
each converted to the user's selected base currency (stored in
`Settings.baseCurrency`). A `loan` holding's own value is NEGATIVE —
minus its outstanding balance (`loanLedgerOutstandingMinorAt`,
`src/holdings/loan-ledger/`: from its linked payments when any count,
else the schedule — see kiko-debts) — so **no debt-aware branch exists
anywhere in the summation path**: `netWorth`/`guardedNetWorth`
(`src/rates/conversion/`, `src/rates/net-worth-view/`) and
`buildNetWorthSeries` (`src/statistics/net-worth-series/`) simply add
up every holding's own (possibly negative) value, exactly as they did
before loans existed. A shared property counts only the owned part:
its own value is already the whole value times the ownership share of
that instant (kiko-pricing "Ownership share"), so a history bucket
before a share change uses the old share and one on or after it the
new one, again with no branch in the summation path. A credit-card negative balance already worked
the same way (a plain negative `balanceMinorUnits`) and still does —
a loan is just the second holding shape whose value can be negative.
The headline can now render negative; `MoneyText` already renders a
negative `Money` with a minus sign through `formatMoney`, so no
special-casing was needed there either (see `kiko-charts` for the pie
chart and net-worth line's own rules). An archived account's or
closed holding's balance is excluded. The headline total
(`guardedNetWorth`) and the per-currency breakdown shown beneath it
(`guardedBreakdown`) share one `canConvert` filter in `src/rates/`,
which is `true` exactly when BOTH the holding's currency and the base
currency resolve a finite, positive UAH price through the same
`rateBetween` pivot (`kiko-pricing`'s "`RateTable` is a currency ->
UAH-price map" paragraph) — never a direct stored cross-pair lookup —
so a currency with no resolvable rate is dropped from both — never
included in the breakdown after being excluded from the total. See
`kiko-pricing`'s "Currency-rate fallback chain" section for how a rate
is resolved (Monobank → NBU → bundled fiat seed); today CRYPTO is the
only currency class that can still hit this silent-drop path (no
offline seed, so an unrated crypto holding is excluded until a live
CoinGecko price lands) — every fiat currency is covered by the bundled
seed and effectively never drops.

Home hides a breakdown currency whose total is exactly 0 minor units
(`.filter((money) => !money.isZero())` after `guardedBreakdown` in
`home.screen.tsx`). The headline still counts it. A negative total and a
tiny non-zero total stay and show their real digits. If every currency is
zero, the breakdown is empty and the headline is unchanged.
`guardedBreakdown` itself and account detail are not filtered.

An account's total, on its card (`AccountTotal`), on the
Property/Debts section heading (implicit accounts) and in the
account-detail headline
(`src/screens/account-detail/account-detail.screen.tsx`; before the
row loads it falls back to `account?.currency ?? baseCurrency`, hidden
by the loading gate), is `accountTotal(holdings, account.currency,
baseCurrency, rates, now, book)`
(`src/rates/net-worth-view/account-total.ts`): `total` is
`guardedNetWorth` in the ACCOUNT's currency, and `inBase` is
`guardedNetWorth` in the base currency (not a re-conversion of
`total`, so no double rounding through the UAH pivot); `inBase` is
`null` when the account is in the base currency or
`canConvert(account, base)` is false. The caption
(`ConvertedCaption`, card, section heading and detail alike) renders only for a
non-null `inBase`.

`buildTypeBreakdown` (`src/statistics/type-breakdown/`, the by-type
bar) is ASSETS ONLY, the same per-HOLDING rule the account pie follows
(below): `loan` is excluded outright, and a non-loan holding in debit
(e.g. a credit card) is dropped BEFORE the per-type sum rather than
netted into it, so it can never reduce a positive holding of the same
type. Debt has its own total (see below).

**The account pie (`buildAccountContribution`,
`src/statistics/account-contribution/`) is ASSETS ONLY:** an account's slice sums only its POSITIVE
holding values; a negative holding (a `loan`'s own value, or a
non-loan holding in debit, e.g. a credit card) never reduces it and
never nets against a positive one in the same account. An account
with nothing positive to show gets no slice at all, rather than a
negative one. **The "Debts" total (`buildDebtTotal`, same file) is
where that debt goes instead**, and — per spec §5.2, "Credit-card
negative balances count as debt too" — it sums EVERY holding whose
own value is negative, not loans only: a `loan`'s already-negative
outstanding, and a non-loan holding in debit, are summed the same way,
by sign alone, no type check. `buildDebtTotal` is called ONLY on
Statistics (`statistics.screen.tsx`, rendered under the account pie).
Home has no separate debts line: its `guardedNetWorth`
headline and its `guardedBreakdown` per-currency breakdown both stay
SIGNED (net) sums of every holding, so the breakdown rows still sum to
the headline (a currency netting to exactly 0 is hidden by Home's
filter and adds 0) — a debt nets into its own
currency's cell there, unlike Statistics' assets-only pie. Accounts'
own "Debts" section (`accounts.screen.tsx`) computes its OWN section
total independently: `accountTotal` (via `useSectionTotals`) over the
OPEN holdings of the implicit debt account, in THAT account's
currency, rendered by `AccountTotal` with a base `ConvertedCaption`
(testIDs `debts-total-converted`, `property-total-converted`). It is
the same figure and caption as the account's detail headline (spec D6
parity, pinned by `src/test-support/implicit-total-parity.ts`); it
does not use `guardedNetWorth` as Home does. The debt account holds
only `loan` holdings, so its total and caption are <= 0 (one card per
loan); it does not call `buildDebtTotal`, which sums across every
account kind. The implicit property account gets the SAME treatment:
its own "Property" section (one card per open holding) with the same
`accountTotal` figure and caption, rendered between the main grid and
the Debts section. A section renders only for a live implicit account
row with at least one open holding; with none it does not render.
Read `kiko-charts` for the pie/line-specific rules.

### Bond funding recognition (net-worth series only)

`reconcileBondFunding` (`src/statistics/reconcile-bond-funding/`) aligns the
DAY a bond's held cost starts counting, INSIDE `buildNetWorthSeries` only, to
the day the real funding money left another holding, and returns that day.
Only the day is reconciled: the series still values the bond at its typed
`purchasePriceMinorUnits` (the value its card and Home show, so the line's
"now" point matches them), and a gap between the debit and the typed price
(a fee, НКД, a rounded price) stays as a step on that day. The real
holding's own `purchaseDate`/`purchasePriceMinorUnits` never change
(coupons, maturity, and the redemption ledger still read those);
`buildNetWorthSeries` writes the reconciled day onto a throwaway copy's
`purchaseDate`. It matches a DEBIT (negative
amount) in the bond's own currency whose amount is within 5% of the typed
price (`AMOUNT_TOLERANCE_FRACTION`) AND whose local day is within
`FUNDING_WINDOW_DAYS` (7) of the typed `purchaseDate`'s local day — both
axes are needed: the transaction store carries no reliable structured bond
marker, so amount alone would false-match an unrelated same-week debit, and
day alone would false-match an unrelated same-price one. Among candidates
within both bands, the nearest DAY wins, tie-broken by the closest amount;
none match → falls back to the typed day (a legacy, FX-funded, or
genuinely manual bond — no regression).

Each candidate carries a key (`holdingId:index`), and `buildNetWorthSeries`
(`bondRecognitionsFor`) shares ONE `claimed: Set<string>` across every bond
in the run, so two bonds priced the same week never both claim the SAME
debit — the reducer filters an already-claimed candidate out, and adds the
winner's key before returning. Because the match is a greedy per-bond
nearest-day pick, not a global optimum, WHICH bond claims a shared candidate
is order-dependent — bonds are reconciled in a FIXED order (typed
`purchaseDate`, then `id`) so the result is deterministic regardless of the
holdings array's own (user-controlled sort) order. A bond that loses the
claim falls back to its own typed day, same as a genuinely unmatched
bond.

### Statistics series performance

`buildNetWorthSeries` values every holding at every bucket, so anything
loop-invariant per holding (not per bucket) must be computed ONCE, outside
the per-bucket loop, not re-derived at every point. `createHoldingValuer`
(`src/statistics/holding-value-at/`) is the ONLY holding-valuation entry
point now — there is no separate single-call holding-value-at function anymore, it
was deleted from production (its old body survives only as a local,
un-exported `referenceHoldingValueAt` oracle inside
`holding-value-at.test.ts`, the same "kept only as the parity oracle"
pattern `internal-transfers.test.ts` uses for the algorithm IT replaced).
Every call site — including a single-instant read like
`holdingsRepo.updateWithBalanceDelta`'s own regression test — calls
`createHoldingValuer(holding, transactions)(t)` instead; for a one-off read
this pays the same per-holding setup cost that single-call function used to pay
per call, which is negligible for a single call.

`buildNetWorthSeries` also decides whether a holding's value counts at
bucket `t` at all: the net-worth LINE is built from `filtered.netWorthHoldings`
(every holding under an account the filter keeps, OPEN or CLOSED), and
`createHoldingValuer`'s result is zeroed for any bucket `t >=
holding.closedAt` (a raw instant compare, not a local-day one — see that
builder's own doc comment for why a same-day compare broke the rightmost
"now" point). Every OTHER "now" snapshot (the headline, the by-type bar,
the account pie, the Debts total) reads `filtered.visibleHoldings` instead
— open holdings only, under a non-archived account — so a closed holding
contributes to the LINE's past but never to a current snapshot.
Invariant: the LAST net-worth bucket always equals
`guardedNetWorth(open holdings, now)` — the number Home shows. Pinned by
`net-worth-series.test.ts` ("ends on the net worth Home shows for a bond,
a lot holding, and a closed holding").

`reconcile-bond-funding.ts`'s candidate-building pass was rewritten from a
`.flatMap`/`.map`/`.filter` chain to a plain nested loop for the same
reason (its own per-bucket cost, not this one — see that file's own doc
comment), preserving the exact same holdings-then-transaction-index order
the chain produced. `home.screen.tsx`'s `withinBounds`/`dateRangeBounds`
follow the same principle: `dateRangeBounds(dateFrom, dateTo)` resolves the
local-day bounds ONCE per filter run, and the `.filter` callback itself
(`withinBounds`) does only a plain numeric comparison — no Date
construction per transaction row. The tests remain the main guard for
this shape (loop-invariant Date math inside a hot per-row callback):
`holding-value-at.test.ts`'s parity test against
`referenceHoldingValueAt`, plus its DETERMINISTIC work-count guard, are
what would catch a regression back to per-bucket Date recomputation.

Under `src/statistics/**` (tests excluded), never build a Date per row
inside a per-bucket iteration. The Semgrep rule
`kiko-no-per-bucket-date-in-statistics` (`rules/semgrep-prewrite.yml`,
ERROR) fires on `new Date(...)`, `Date.parse(...)`, `startOfLocalDay`,
or `endOfLocalDay` inside an array-method callback
(`filter`/`map`/`flatMap`/`reduce`/`reduceRight`/`forEach`/`some`/
`every`/`find*`/`sort`/`toSorted`) that itself sits inside a `for` or
`while` loop, or inside another array callback (expression or block body):

```ts
// Wrong: startOfLocalDay runs buckets × rows times.
buckets.map((bucket) => rows.filter((row) => startOfLocalDay(row.time) <= bucket).length);

// Correct: build each row's day key once, then compare plain numbers.
const days = rows.map((row) => startOfLocalDay(row.time));
buckets.map((bucket) => days.filter((day) => day <= bucket).length);
```

The rule catches this NESTED shape only, and only when the inner pass
iterates a plain identifier (`rows`): a collection that stays the same for
every outer item. A one-off per-row pass
(`rows.map((row) => startOfLocalDay(row.time))`), a per-bucket Date
(`buckets.map((bucket) => new Date(bucket))`), a day key hoisted above a
`.filter`, and a linear nested traversal stay silent. A linear traversal
is an inner pass over the outer item's own member or over a chained
collection, such as
`holdings.flatMap((holding) => holding.rows.map((row) => startOfLocalDay(row.time)))`
or `(byId.get(holding.id) ?? []).filter(…).map(…)`: each row is visited
once. That is why it does not repeat the false positive of its removed
predecessor, `kiko-no-date-math-in-array-callback`, which flagged every
Date inside an array callback and so could not tell a hot per-bucket call
site from a one-off pass built once per series call (the pre-rewrite
`reconcile-bond-funding.ts` chain stays silent under this rule). Not
flagged, review items: a Date built in a helper the inner callback calls,
a `do ... while` loop, a nested iteration written as two plain loops, and
an inner pass over a member or chained collection that IS loop-invariant
(`rows.filter(…).map(…)` or `this.rows.map(…)` inside a per-bucket
callback). Known false positive: a plain identifier bound per outer item
(`const rows = holding.rows;` inside the loop, then `rows.map(…)`) fires
even though the traversal is linear. Iterate the member directly
(`holding.rows.map(…)`).

**Speed guards count real work, never wall-clock time — and never a
production test hook.** Both `holding-value-at.test.ts`
(`createHoldingValuer` vs `referenceHoldingValueAt`) and
`internal-transfers.test.ts` (`internalTransferTransactionIds` vs
`referenceInternalTransferTransactionIds`) used to assert a RELATIVE
`performance.now()` ratio ("the optimized side runs at least 20x faster
than the reference over the same input") instead of a fixed millisecond
budget, reasoning that a wall-clock SLA is only ever as tight as the
slowest machine it tolerates. That reasoning was correct about an
ABSOLUTE budget, but the relative-ratio version is still a wall-clock
measurement, and wall-clock measurements are flaky under Jest for a
second reason: Stryker's coverage instrumentation and general machine
load slow the two timed sides of one comparison by DIFFERENT amounts (the
instrumented/hot side is not slowed proportionally to the reference
side), so the ratio itself drifts — this broke the internal-transfers
guard's `20x` threshold under a Stryker dry run even though nothing about
the algorithm had regressed.

The counting must happen from OUTSIDE production, with **zero counting
code in `holding-value-at.ts` or `internal-transfers.ts`** — an injected
counter parameter or debug flag on the production function is a
test-only hook living in shipping code, which the App Store build must
never carry (see "Guideline 2.5.19 — no hidden features" in the root
`CLAUDE.md`: test/demo machinery must be ABSENT from the build, not
merely dormant). The test instead feeds each function input ROWS whose
own `time` (and, for holding-value-at, `amountMinorUnits`) fields are
getters that increment a counter local to the test on every read. A
function's real per-unit-of-work cost then shows up automatically as a
property read on the exact row object production was handed — no
parameter, no branch, no `if (workCounter)` guard anywhere in the
production file.

This only works because each production function actually reads its OWN
current-work unit fresh off the input row it was handed, rather than a
copy taken once up front — `internal-transfers.ts`'s `CreditCandidate`
used to copy `time`/`holdingId` out of each transaction at bucket-build
time, which meant the per-debit window search never touched the original
row again and a regression in that search (scanning past the window
edge) was invisible to any read-based count. The bucket now holds a
REFERENCE to its own input transaction instead
(`{ index, transaction, consumed }`), so `lowerBoundByTime` and
`findMatchingCredit`'s window scan read `.time`/`.holdingId` through that
reference on every candidate they actually visit, making the visited-candidate
count observable from outside again. `holding-value-at.ts` needed no such
change: its returned closure never touches the original transaction rows at
all after the one-time setup pass (it works over precomputed prefix sums), so
a regression back to a per-bucket re-filter/re-reduce over the original rows
is already externally visible as new reads at bucket-query time.

Each guard then asserts two things on the READ COUNT, never on elapsed
time: (1) near-linear growth — doubling the row count keeps the count
under 3x, checked at two doubling steps; (2) the count stays far below
what the quadratic reference implementation reads the same way (under 5%
of it). For internal-transfers, BOTH the growth check and the ratio
check catch a scan-from-index-0/never-break regression — the ratio
check's own bound is measured at 45-46% against the quadratic
reference on that regression, far over its 5% threshold. For
holding-value-at, only the RATIO check catches a per-bucket full
rescan; the growth check cannot, because holding-value-at's bucket
count is held FIXED while only the transaction count scales, so a
per-bucket-times-N regression still looks linear in N.
`internal-transfers.test.ts` additionally keeps a LOCAL,
self-contained mutant variant (never calling into the exported function)
whose one window-exceeded line never breaks, proving the growth bound
actually fails on a provably worse scan rather than passing regardless of
what the code does.

Any NEW speed guard in this codebase must follow the same shape: count
real work by instrumenting the INPUT the test itself constructs (a getter,
or a `Proxy`, on a row/argument passed into the real function), never by
adding a counter parameter, a debug flag, or any other hook to the
production function — and never `performance.now()`/`Date.now()` deltas.

#### The "no custom range = derive the default from now" pattern

The hook `useDateRangeSelection(now)`
(`src/design-system/use-date-range-selection/use-date-range-selection.ts`)
owns the ONE date range shared by Home and Statistics and returns
`{ dateFrom, dateTo, applyDateRange, clearDateRange }`. The pick
(`customRange`, `{ from: Date | null; to: Date | null } | null` — `null`
means "show the default range") and the default live in ONE module store
read with `useSyncExternalStore`, never per-screen `useState`, so a pick
or a Clear in one screen shows in the other (the Duo two-pane layout shows
both). The shared default comes from a forward-only clock: each reader
publishes its `now` in `useLayoutEffect` (never a write during render),
and the store notifies only on a new local day, a pick or a Clear, so
Home's fresh `Date.now()` every render does not loop. A reader mounted
after a day crossing renders `defaultDateRange(now)` when the shared
default is older than its own day (a pure render rule, no stale frame). A
range stored once at mount would freeze at that `now`, so a tab left
mounted past midnight (both tabs stay mounted — kiko-architecture) would
stop including "today". `clearDateRange` resets the pick to `null`, back
to the default, never to a frozen "30 days as of Clear" snapshot. The
store resets when no reader is mounted after the commit, deferred ONE
`Promise` microtask with a `listeners.size === 0` re-check, because a
fold/unfold that swaps every reader unmounts and remounts in one commit
and must keep the pick; use `Promise.resolve().then(...)`, never
`queueMicrotask` (jest modern fake timers replace it). A screen must not
hold its own `dateFrom`/`dateTo` state: call the hook with its own `now`.
Statistics' own `now`
already refreshes on visibility (`useVisibleRefreshedNow(isVisible)`,
`src/design-system/use-visible-refreshed-now/`; a pane default is never focused); Home's `now` is a
plain `Date.now()` read fresh every render. Deriving `dateFrom`/`dateTo`
this way still needs care downstream: a memo that depends on them should
key on their NUMERIC bounds (`dateRangeBounds(...)`'s own `{from, to}`
output), not the `Date` objects themselves — two `Date` instances never
compare equal by reference even when they hold the same instant, so keying
a memo on the raw objects made it (and everything downstream of it)
recompute on every render, not just a day change (see Home's own
`filteredTransactions` memo).

## Price series and priced holdings

See `kiko-pricing` for `price_points`, `PriceBook`, priced-holding
valuation (`property_item`/`metal`), the create-time `firstPricePoint`
and remove-time series cleanup, and `PricePointForm` / "Update value".
A property's price points and lots are the WHOLE asset; its owned value
is the whole value times the ownership share of that day (kiko-pricing
"Ownership share").

## A holding is deleted only after its cascade

Deleting a holding also deletes the movements its rows were one part of (the
other legs of an Exchange or Convert, the rest of a split, the legs that paid
into a deleted deposit), each taking its full amount back from its own
holding (the deleted holding's own rows need no reversal: the holding goes). A
bank-owned partner is kept, never deleted, and loses its exchange marker only when the leg that marker names goes too (see "A bank-owned (synced) partner is kept"). `transactionsRepo.removeHolding` runs `cascadeLinkedRowsDatabaseTransaction`
and then `removeHoldingDatabaseTransaction` in one transaction;
`accountsRepo.remove` runs the same cascade for every holding of the account
(closed ones included). The cascade's plan is
`transactionsRepo.removeHoldingsPlan`; its text is `removeHoldingsNoticeOf`
(`holdings.deleteLinked.*` keys). A deleted deposit also takes the legs that paid
into it; a partner on a holding that is deleted too is never counted twice.
`removeHoldingDatabaseTransaction` alone deletes the holding and its own rows
but leaves the other legs behind, so the money of a movement exists on one side
only. Only `transactions.repo.ts` and `holdings.repo.ts` (its owner) call it
(`kiko-holding-delete-needs-cascade`, `rules/semgrep-prewrite.yml`): every other
caller deletes through `transactionsRepo.removeHolding`.

A holding delete and an account delete also clear the transaction templates'
references to the deleted holdings in the same write, on the same two paths as the
loan-link clear (`removeHoldingDatabaseTransaction`, `accountsRepo.remove`; see the
`clearLoanLinksForHoldingsDatabaseTransaction` paragraph in kiko-debts):
`transactionTemplatesRepo.clearHoldingsDatabaseTransaction`. A category delete
(`categoriesRepo`) clears the template's category through
`clearCategoryDatabaseTransaction` to EMPTY, never to the default category; the field
stays in the template.

## Transaction templates

`src/transaction-templates/{draft,template-name,repo}` own a saved, reusable
transaction draft; `transactionTemplatesRepo` is its repo and `TemplateNameTakenError`
its error. User rules: no loan link, no comment, no date; the amount is optional; the
name is unique case-insensitively, with Unicode folding done in JS. A save from the
transaction form rides `alongside(databaseTransaction)` on `transactionsRepo.recordManual`
/ `recordExchange` / `recordManualWithReturns` / `update` (runs last inside the same
write); the transactions feature never imports templates on that save path.
A template stores a category ONLY when the user picked it by hand (`userPickedCategory`);
otherwise it stores none, and each use gets the CURRENT category-rule pre-select (user
ruling 2026-10-12). On Duplicate and Edit, the source category counts as a hand pick, so
the template keeps it. The save path reads `userPickedCategory ? effectiveCategory : null`,
never `selectedCategory` (settled only on blur). Pin it with a red test that presses Save
WITHOUT a blur.
The form's template units live in `src/screens/forms/transaction-form/` (list them with
`ls`); the Template list screen is `src/screens/settings/transaction-templates/`.

## Adding a holding type

Every per-type decision lives in one descriptor per layer, each keyed by
`HoldingType` through an exhaustive `Record`/`satisfies` or a
`match(...).exhaustive()` — a new type is a compile error at every site
below until it is added there too. A stored row of a REMOVED holding
type is tolerated, not a crash: read sites use
`holdingDescriptorOrUndefined`/`isHoldingType` (generic icon, no Edit,
never an exchange source or destination — see
`src/holdings/exchange-destination/exchange-destination.ts`); strict
`holdingDescriptor(` stays only where the type comes from the
`holdingTypes` tuple or the form's own selection. Seven steps, in order:

1. Add the type to the `holdings.type` enum in `src/db/schema.ts` and to
   the `holdingTypes` tuple (`src/holdings/holding-type/holding-type.ts`)
   — the `satisfies readonly HoldingRow['type'][]` ties the two together.
   Also decide which `AccountRow['kind']` entries in that file's own
   `holdingTypesForAccountKind` may hold it: that map is keyed by account
   kind, not by holding type, so tsc gives no error for a type left out
   of every kind's list — it would simply never be manually creatable
   anywhere. `holding-type.test.ts` asserts the map's own invariants
   (every listed type is a real one, no kind offers an empty list) but
   does not assert every `HoldingType` appears somewhere; add that
   coverage yourself if the new type should be widely creatable.
2. Add a `HoldingDescriptor` (`src/holdings/holding-descriptor/holding-descriptor.d.ts`)
   in its own `src/holdings/holding-descriptor/<type>/` folder — named for
   the type but not always identical to the enum value (`property_item`'s
   descriptor folder is `property-item/`, hyphenated) — and register it in
   `holdingDescriptors` (`holding-descriptors.ts`) — the
   `satisfies Record<HoldingType, HoldingDescriptor>` there is the first
   compile error a missed type produces. Build a PriceBook-valued type
   (property_item/metal-shaped: its `breakdown` reads a stored price
   point) through `pricedDescriptor(spec, rest)`
   (`holding-descriptor/priced-parts/`), which ties the descriptor's
   `priced` spec and its `breakdown` to the SAME spec by construction.
   Build a plain stored-balance type (card/cash/crypto_asset/jar-shaped:
   value is simply `balanceMinorUnits`, no lots, no lifecycle entries)
   as another entry in `holding-descriptor/balance/balance.descriptors.ts`,
   through that file's own private `balanceDescriptor` helper — that
   helper is not exported, so a new balance-shaped type is added to that
   ONE shared file rather than getting its own `<type>/` folder the way
   every other (ledgered-with-history or ledgerless) type does.
3. Add the form: a `use<Type>Fields` hook, a `<type>-section` presentational
   component, and a `<type>-form-block` leaf component, all under a new
   `src/screens/forms/holding-form/<type>/` folder — again not always the
   literal enum value (`property_item`'s form folder is `property/`, no
   `-item` suffix; mirror an existing type, e.g. `term-deposit/` or
   `bond/`, for the folder shape). Wire the
   hook into `HoldingFormScreen`'s own `forms: Record<HoldingType,
   HoldingTypeForm>` record and add a `.with('<type>', () => <...
   FormBlock .../>)` arm to its `match(type)...exhaustive()` form-block
   dispatch (`holding-form.screen.tsx`) — both are compile errors for a
   missed type. A ledgered type with no history of its own (a
   balance-shaped type) can usually reuse the shared `useBalanceFields`/
   `BalanceFormBlock` instead of writing new ones — see how
   `card`/`cash`/`crypto_asset`/`jar` share one hook instance. Every OTHER
   (ledgerless) type's own `createPayload` must write
   `balanceMinorUnits: 0` unconditionally — its value derives entirely
   from its own lots/schedule, never a typed opening balance. Only
   `useBalanceFields.createPayload` reads its own live opening-balance
   field. The screen writes through each type's
   `createPayload()`/`saveEdit`; there is no async pre-save check seam.
4. Add en/uk label keys (`src/i18n/`) for `holding-form.screen.tsx`'s
   own `typeLabels: Record<HoldingType, string>` — usually a new
   `forms.holding.<type>` key, but `cash` reuses the account kind's own
   `forms.account.cash` key instead (a `forms.holding.*` /
   `forms.account.*` label key, not the enum value itself — see
   `typeLabels`'s own literal object for the current per-type mapping).
   A new type also needs a `forms.holding.namePlaceholders.<key>` en/uk key
   and an entry in `holding-form.screen.tsx`'s
   `namePlaceholders: Record<HoldingType, string>` (a missing entry is a
   compile error). Also add the type's arm to
   `holdingTypeName` (`src/holdings/holding-type-label/`), the shared
   display-name source for the statistics bar chart and `HoldingCard`.
   `holding-form.screen.tsx`'s `typeLabels` is still a second copy of the
   same map (a known duplication, codebase review G2) until it is built
   from `holdingTypeName`, so a new type needs both sites.
   The user reviews new/changed translation keys before any deploy that
   ships them (see `kiko-translator`).
5. Add an entry to `holdingDetailSpecs`
   (`src/screens/holding-detail/holding-detail-spec/`): its footer add
   action, its value-breakdown display, and its next-loan-installment
   panel (`upcomingInstallments`; `noInstallments` for every type but a scheduled loan). The
   breakdown is one of `{ kind: 'interest', principalLabelKey, expectedProfit }`
   (the deposit/bond principal-or-cost/gross/interest/tax table), `{ kind:
   'priced' }` (the cost/value/gain table a priced type shows — see
   `kiko-pricing`'s "Priced holdings" section), or `null` to hide the
   breakdown entirely. The `satisfies Record<HoldingType, HoldingDetailSpec>`
   there is the fourth compile error a missed type produces.
6. Fill in the new descriptor's own `exchange` row (`receivePath`,
   `source`, `createSource`, `createDestination` — `HoldingDescriptor`'s
   own field, not a separate registry) so `exchange-destination.ts`'s
   predicates classify the type correctly as an Exchange/Convert leg (or
   exclude it, the way `loan` is excluded entirely).
7. Run `npm run check:typecheck`. Between the four `Record<HoldingType,
   ...>` checks above (descriptors, the form record, `typeLabels`, and
   detail specs) and the form-block's own `match(type).exhaustive()`
   dispatch (`holding-form.screen.tsx`) — the detail screen's OWN
   footer-button `match` dispatches on the already-bounded `FooterAction`
   value, not on `type`, so it never needs a new arm — tsc lists every
   remaining site the new type still needs. The enum/tuple step (1) and the
   account-kind mapping caveat within it are the only steps it cannot
   catch for you. One more site tsc does NOT flag: `isFiatOnlyHoldingType`
   (`src/holdings/holding-currency/holding-currency.ts`) — add the type
   when it must never hold a cryptocurrency. The type's display name lives
   in `holdingTypeName` (`src/holdings/holding-type-label/holding-type-label.ts`),
   an exhaustive `match` that tsc flags, so a new type needs its arm there;
   the statistics bar chart and `HoldingCard` both read it.

## Form drafts

A fold or unfold remounts the form. Each form keeps its fields in its own route's `draft` param
(`FormDraft | HoldingFormDraft`, `FormDraft | AccountFormDraft`; `saved: true` marks the form's
own draft), and the mount reads it back once. Read the draft types, not a copy of their fields:
`src/screens/forms/holding-form/holding-form-draft/holding-form-draft.d.ts` and the
`AccountFormDraft` type in `src/navigation/types/types.d.ts`. A draft holds what the form edits;
what an edit reads from the stored row and does not edit (a metal's lots, a property's share
changes) is read again from the database, so a draft cannot save an old copy over a newer one.
What the form edits but a draft holds as its own copy (deposit contribution rows) can be stale.
Never put a secret in a draft (see kiko-architecture "Fold and unfold").
The category form and the category-rule editor keep drafts too (`CategoryFormDraft`,
`CategoryRuleFormDraft` in `src/navigation/types/types.d.ts`; read the types, not a copy); see
kiko-architecture "Fold and unfold".

The transaction form's draft is `TransactionFormDraft` (`src/navigation/types/types.d.ts`; read
the type, not a copy of its fields). It also keeps the entry state main added (the save-as-template
switch and name, the tab, the picked template), so a fold keeps them. A picked template with a null
holding means the holding was cleared on purpose, so hydration
(`src/screens/forms/transaction-form/hydration/hydration.ts`, `clearsHolding`) must not seat the
default holding over it; the other writer of draft references is `resolveDraftReferences`
(`template-references/template-references.ts`). Template entries (`templateId`, `editTemplateId`,
`newTemplate`) never open from a draft: coordinator ruling B, 2026-10-17, same as main, so a fold or
unfold there loses unsaved edits. A restored form shows its holding field per `revealsHoldingField`
(`route-entry/route-entry.ts`), recomputed at mount, not stored. Known residuals after a remount,
both hiding the field: a re-pick of the page's own holding, and a template with no holding after
one with a holding; the write target stays correct.
