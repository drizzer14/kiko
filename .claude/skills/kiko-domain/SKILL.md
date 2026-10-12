---
name: kiko-domain
description: Invoke whenever you touch the domain model — the Account/Holding/Transaction schema, the Money value object, currency codes, or net worth calculation. Read before writing a Drizzle table, a repository, a form, or any code that handles an amount.
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
  (nullable), `createdAt`. `holdingTypesForAccountKind`
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
  `src/screens/forms/account-form/account-form.screen.tsx`.

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
  has no edit path; delete and recreate the account. In CREATE mode the
  kind and bank pickers lock too once a Connect starts the account row
  (`isPickLocked = isEdit || accountRowStarted`); a rejected insert unlocks
  them. Re-picking the already-selected kind is a no-op (the bank/broker
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
  Guideline 5.6 invariant (see `guidelines-compliance-is-architecture-rule`
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
  / "Редагувати кредит"). There is no "Add loan" footer
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
  being only per-account unique; see `kiko-architecture`'s "Namespaced
  synced externalId". A manual row's is null), `createdAt`.

  Re-syncing an existing `externalId` **refreshes** that row's
  bank-owned columns — the settled `amountMinorUnits` and `hold`
  among them — and **never** its `category` (the user's override, or
  a name rule's rewrite) or `comment`. Read `addManyDedup` in
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
stops reconciling with its own displayed Value. None of the three routes
through `transactionsRepo.recordManual` (which would apply the amount to
the balance a second time), and none persists a description or a
category — the label resolves at render time (see the exchange section
below and `transactionRowDescription`, `src/transactions/`). A null category folds
onto `settings.defaultCategoryKey`, so a downward correction counts as
spending like any other uncategorised manual row; that is a RULED
decision (the row is editable), not an oversight to be quietly patched.

A SYNC-owned balance is the exception and writes no ledger row: the
provider owns that number (`upsertByMetadataKey` in
`src/holdings/`), and the form hides the balance field for a synced
holding entirely.

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
`recordExchange`, and `recordExchangeCounterpart` (Convert-mode). A term_deposit exchange DESTINATION still
works: its receive path `contribution` writes metadata, not a row. The
transaction form's split change-return picker offers only
`isTransactionEligibleType` holdings, the same gate as the primary picker.

**A balance-set row is a STORED mark, not a date.** Every row whose amount
set the balance (an opening balance, a cash opening, a hand edit) carries
`transactions.setsBalance` (migration 0047) for good, whatever its date,
description or category has become. The mark no longer decides a balance move:
its edit (by the difference of the amounts) and its delete move the balance
like any row's. It only keeps a closing import from counting the row a second
time: `postClosingRowsWhere` never counts it in the post-closing sum, because a
closing balance replaces the balance the row set. `holdings.balanceSetRowId`
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
exact shape). The Accounts stack adds `returnTo`, so the Home stack, which has no import screen to
pop back to, cannot pass one. It is `holdingFormTarget` (`{ kind: 'account', accountId } | { kind:
'implicit', implicitKind }`) plus `holdingFormStart` (the `initialType`/`initialCurrency` a create
on a named account opens with, applied once on mount; the user can still change both) and
`holdingFormDraft`, all in `holding-form/holding-form-target/`. In implicit mode the form: queries no account
(`byIdQuery('')`); takes its offered types from
`creatableHoldingTypesForAccount(implicitKind, false, undefined)` (its
own call, with `implicitKind` as the account kind and no account row;
`['property_item']` / `['loan']`), and starts `type` on the first of them;
shows the shared `AccountKindField` (`src/screens/forms/account-kind-field/`,
which resolves its own label, sheet title, kinds, texts and glyphs, so a
form passes only `selected`, `onSelect`, `onSelectClosed` and `disabled`)
in the account form's own slot, under the divider; keeps the title "Add
Account" (the stack sets it statically for an `implicitKind` route too);
seeds name, icon and color from the draft ONCE (`useState` initial
values); and Save is `accountsRepo.createImplicitHolding(implicitKind, {
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
router, not a spy). `accounts.stack.tsx` gives a route that carries a
`draft` `animation: 'none'`, so the swap reads as one form whose fields
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
  per-currency: `BTC` uses 8 decimals (satoshis); `USD`, `EUR`, and
  `UAH` use 2 (cents).
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
  or float column. Convert to/from `Money` at the repository
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

A small closed set (`BTC` at scale 8, everything else at scale 2) —
read `schema.ts`'s `currency`/`baseCurrency` enum for the exact
current member list rather than trusting a count restated here. Map a
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

**A cash holding is fiat-only for every NEW write.** `src/holdings/holding-currency/`
owns the rule (`holdingCurrencyOptions` for a create picker,
`isCurrencyAllowedForHoldingType` for a write). Every path that can
create a cash holding rejects a crypto currency: the holding form and
cash-account form offer fiat only, and `holdingsRepo.create` and
`accountsRepo.createCashAccount` throw. Statement import and the syncs
never create a cash holding. `isCurrencyExpectedForHoldingType` is the currency a type is
CREATED in (a `crypto_asset` is expected in a cryptocurrency, though a write also accepts fiat); a
picker that needs a holding in a given currency uses it. `isCryptoHoldingType` is the type test the
create form uses to list cryptocurrencies first (`src/holdings/holding-currency/holding-currency.ts`).
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
capitalized-title era had already written. Because neither
`transactions.category` nor `category_overrides.category` is COLLATE
NOCASE, `categoriesRepo.delete`'s reassignment additionally compares
case-insensitively on both sides (`lower(column) = lower(key)`), so an
un-migrated row from an older build still gets folded onto the default
instead of being orphaned on a deleted slug.

## Spending-exclusion pipeline

An internal money movement (cash-out, own-account transfer, one leg of
a same-user transfer between holdings, an Exchange/Convert leg) is
excluded from the spending view — read
the transfer-exclusion module (`src/statistics/`, MCC/description based, backed by
`transactions.counterIban` and `settings.defaultCategoryKey`),
the internal-transfers module (`src/statistics/`, the matched-pair fallback), and
the exchange-exclusion module (`src/statistics/`, the exchange-marker rule)
directly rather than trusting a restated MCC list here; see
`kiko-architecture` for the same pointer.

Which rows each step reads (`src/screens/statistics/statistics.screen.tsx`):
the spending charts always draw every row of the holdings under the KEPT
accounts, open or closed (`transactionsWithCurrency`, filtered from
`filtered.netWorthHoldings`), so a closed card keeps its past spending.
The internal-transfer matcher runs over `ledgerWithCurrency` (every
holding, whatever the account filter or `closedAt`). The loan-payment
exclusion runs over the account-filtered rows.

A linked loan payment ("interest-only
spending") is excluded the same way, but REPLACED rather than simply
dropped: the loan-payments module (`src/statistics/loan-payments/`)
exports `loanPaymentExcludedTransactionIds(transactions, loanHoldings)`, which
drops a row from the pie/trend the same way every other exclusion
rule does, IF AND ONLY IF its `transactions.loanHoldingId` marker
points at a holding present in `loanHoldings` — a dangling link (its loan holding was
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
`statistics.screen.tsx` feeds these derived entries into BOTH
`buildCategoryBreakdown` and the category trend, alongside every real
row — not into the exclusion-RULE inputs themselves (a synthetic
entry carries no mcc/description/IBAN signal, so it plays no part in
detecting a transfer).

## Exchange/Convert legs: a structural marker, a resolved label

An Exchange/Convert leg is NOT identified by its description. Both legs
carry the counterpart holding's id in a dedicated column — read
`src/db/schema.ts` (`transactions.exchangeCounterpartHoldingId`, whose
comment records why it is a column rather than a reserved `category`
value or a shared `externalId`) and `src/transactions/`
(`recordExchange` / `recordExchangeCounterpart`, which write it on both
legs inside the one transaction; an exchange into a term deposit writes
the marker on its single debit leg). The legs of one Exchange or Convert also
share `transactions.exchangePairId`, written beside the marker, which is what a
delete follows to the other legs (the existing row of a Convert gets the pair id
always, and the marker only when it is manual or imported and carries none; see
"Deleting a movement takes its other parts"). Three consequences hold together:

- The marker is what the spending view excludes on, in the
  exchange-exclusion module (`src/statistics/`): no other rule can see these
  rows — a null `mcc`, an empty description, and a cross-currency pair
  the matched-pair matcher rejects.
- **The repository never writes a description for a leg.** The label is
  resolved at render time through `t`. `transactionRowDescription`
  (`src/transactions/row-description/`) applies this order: (1) a stored
  description wins; (2) a row with `exchangeCounterpartHoldingId` gets the
  paired leg's label from `exchangeLegDescription` / `transferLegDescription`
  (`src/transactions/exchange-description/`): 'Transfer to/from <name>' when
  both holdings have the same currency, 'Exchange to/from <name>' otherwise or
  when either currency is unknown; (3) a row with a known `untrackedCounterpart`
  code (`wallet:<TYPE>`, `src/transactions/untracked-counterpart/`; wallet
  names are proper nouns kept in code, not in i18n) gets 'Transfer to/from
  <wallet>'; (4) otherwise `defaultTransactionDescription`. Same-currency legs,
  including manual ones, read 'Transfer', not 'Exchange'. The caller supplies
  `holdingNameById` and `holdingCurrencyById`, both built from the holdings live
  query. A persisted sentence stayed English after a language switch and went
  stale after a rename; that is the bug the column exists to prevent.
- `transactions.untrackedCounterpart` (0056, nullable `wallet:<TYPE>`) marks a
  leg whose other side is an untracked wallet. The exchange-exclusion module
  also excludes these rows from spending (read
  `src/statistics/exchange-exclusion/`). The column is insert-only: it is not in
  `BANK_OWNED_TRANSACTION_COLUMNS` (`src/transactions/repo/transactions.repo.ts`).
- **`transactionRowDescription` is the ONE owner of a blank row's label.**
  Every surface that shows it calls it: both lists, `ExampleTransaction`,
  and the transaction form. On an edit, the form pre-fills a blank
  stored description with that label as the field VALUE (and previews it
  as the placeholder once cleared); Save stores `''` when the text still
  equals the pre-filled label, and the typed text otherwise — so an
  untouched leg keeps resolving at render time. A direct
  `defaultTransactionDescription(` call outside
  `src/transactions/row-description/` (or the helper's own folder)
  skips the exchange, transfer and untracked branches, and is denied by the
  `kiko-no-direct-default-transaction-description` Semgrep rule.
- A repository input therefore carries holding IDs, never holding
  display names, for an exchange.
- **Convert's counterpart never lands on a synced holding.** The
  counterpart picker (`resolveConvertView` in the transaction form)
  excludes every synced/syncable holding — a sync already owns that
  holding's balance, and the counterpart is a NEW manual leg `save`
  writes. `recordExchangeCounterpart` (`src/transactions/repo/`) enforces
  the same rule again, in depth, inside the write itself: it re-reads the
  counterpart's own holding+account INSIDE the transaction and throws
  rather than trust a caller-supplied flag, since the write is reachable
  directly, not only through the picker.

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
  `.transferUnlinkedPlain` for a pair whose legs share a currency (a Binance
  Pay transfer between wallets), the `exchange*` keys otherwise.
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
  delete lists the OTHER holdings' changes only (`RemoveHoldingsPlan.balanceChanges`).
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
else the schedule — see "Debts" below) — so **no debt-aware branch exists
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
SIGNED (net) sums of every holding, so the breakdown still adds up to
the headline exactly as it always did — a debt nets into its own
currency's cell there, unlike Statistics' assets-only pie. Accounts'
own "Debts" section (`accounts.screen.tsx`) computes its OWN section
total independently, via `guardedNetWorth` of the OPEN holdings of the
implicit debt account (it holds only `loan` holdings, so this total is
always <= 0; one card per loan); it does not call `buildDebtTotal`,
which sums across every account kind. The implicit property account
gets the SAME treatment: its own "Property" section (one card per open
holding), its own `guardedNetWorth`-summed section total over that
account's open holdings, rendered between the main grid and the Debts
section. A section with no open holding does not render. Read `kiko-charts` for the pie/line-specific rules.

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
never carry (see "Guideline 5.6 — no hidden features" in the root
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
owns the active date range for both Statistics and Home and returns
`{ dateFrom, dateTo, applyDateRange, clearDateRange }`. It keeps the user's
pick as a private `customRange`
(`{ from: Date | null; to: Date | null } | null` — `null` means "show the
default range"). The DEFAULT range comes from `defaultDateRange(now)` on
every render and is never stored: `dateFrom`/`dateTo` are plain `const`s
computed each render from `customRange ?? defaultDateRange(now)`, never
`useState`. A range stored once at mount would freeze at that `now`, so a
tab left mounted past midnight (both tabs stay mounted — kiko-architecture)
would stop including "today". `applyDateRange`/`clearDateRange` only write
`customRange`; `clearDateRange` resets it to `null`, back to the default,
never to a frozen "30 days as of Clear" snapshot. A screen must not hold
its own `dateFrom`/`dateTo` state: call the hook with its own `now`.
Statistics' own `now`
already refreshes on focus (`useFocusRefreshedNow`); Home's `now` is a
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

## Bonds — ISIN validation and the NBU register cache

`BondMeta` (`src/holdings/holding-metadata/holding-metadata.ts`)
already carries the full bond shape a Manual-mode form writes:
`quantity`, `faceValueMinorUnits`, `couponPct` (a plain `number`, not
a scaled decimal string — it is a percentage, never fed through the
BigInt decimal helper), `purchaseDate`, `purchasePriceMinorUnits`,
`maturityDate`, `bondKind` (`'government' | 'corporate'`), and
`couponFrequency` (`BondCouponFrequency` — `'monthly' | 'quarterly' |
'semiannually' | 'annually'`). `purchaseDate`/`maturityDate` are raw
epoch-ms instants (often mid-day, e.g. `Date.now()`), read through
`startOfLocalDay` wherever a day boundary matters
(`holding-descriptor/bond/bond.descriptor.ts`), NOT through
`dayKeyOf`'s "a local calendar date encoded as UTC midnight"
convention — do not conflate the two.

**`asBondMeta`'s parser contract: reject bad input, default missing
input.** `bondKind`, `couponFrequency`, `purchasePriceMinorUnits`, and
`isin` are each optional in a STORED record (a bond saved before that
field existed never wrote it). A genuinely ABSENT field (`undefined`)
keeps today's documented default (`bondKind` → `'government'`,
`couponFrequency` → `'annually'`, `purchasePriceMinorUnits` → the
nominal `quantity * faceValueMinorUnits`, `isin` → `undefined`) — a
stored pre-field row must still parse. A PRESENT field that fails its
own check (an unrecognized `bondKind`/`couponFrequency` string, a
non-number `purchasePriceMinorUnits` including `NaN`, a non-string
`isin`) instead rejects the WHOLE record (`asBondMeta` returns `null`),
the same as any other wrong-type field — silently defaulting corrupt
data would hide a real bug in whatever wrote it. The one exception is
`entryMode`, which only picks the mode the edit form opens in: an
unknown value is dropped and the record still parses (the
`PropertyMeta.ownershipInput` pattern). Every sibling parser in
this file (`asTermDepositMeta`, `asPropertyMeta`, `asMetalMeta`,
`asLoanMeta`) already rejects a present-but-invalid field the same way;
`asBondMeta` used to be the one exception that defaulted instead.

`src/bonds/isin/` validates an ISIN with no side effects:
`normalizeIsin` trims/uppercases; `validateIsin` checks the ISO 6166
shape (`^[A-Z]{2}[A-Z0-9]{9}[0-9]$`) and Luhn check digit, returning
`{ ok: true, isin }` or `{ ok: false, reason: 'format' | 'checkDigit'
}` — never throws on an expected validation failure, the standing
domain convention.

`src/bonds/nbu-register/` is the NBU securities-register client,
mirroring `nbu-metals.ts`'s pattern (fetch + `guard`-
based validation + a recorded JSON fixture, no network in tests) on
the SAME `bank.gov.ua` host — no new pinning (kiko-compliance: this
host stays keyless and unpinned; see `docs/security/README.md`'s host
table). `fetchNbuRegister(fetchImpl)` reads `GET
https://bank.gov.ua/depo_securities?json` and maps each record to
`BondTerms` (`{ isin, currency, faceValueMinorUnits, couponPct,
maturityDate, couponFrequency: BondCouponFrequency | null, name }`),
dropping a record with an unmodeled `val_code` currency or an
unparseable `pgs_date` rather than throwing. `nominal` ->
`faceValueMinorUnits` goes straight through `Money.fromMajor` — it is
an amount, not a scaled decimal-string price/quantity, so no
`decimalFromJsonNumber` boundary conversion is needed (the same
parity every other Money amount conversion follows). `pgs_date`
(`YYYY-MM-DD`) is parsed as a DEVICE-LOCAL midnight instant (`new
Date(year, month - 1, day)`), NOT through `parseDateTimeSeconds`'s
"read a bank wall clock as Kyiv time" convention — `BondTerms.maturityDate`
feeds straight into `BondMeta.maturityDate` above, and every consumer
of that field reads it through local getters, so a UTC parse would
silently shift the maturity date (and every coupon date derived from
it) back a day for a user west of UTC.
`couponFrequencyFromPayPeriod(days)` maps the register's `pay_period`
onto `BondCouponFrequency`, tolerating a ±5-day slack around each of
the four canonical periods (30/91/182/364); a period outside every
band resolves to `null` — the eventual ISIN-mode form falls back to
Manual mode with the known fields pre-filled rather than guessing.
`couponPeriodDays(frequency)` reads the same canonical periods back.

**Register payments and the coupon source (USER DECISION D4, 2026-09-26).**
`BondTerms.payments?: BondPayment[]` keeps the record's `payments[]`
(`pay_type` `1` → `'coupon'`, `2` → `'redemption'`, read as a string
OR a number; `pay_date` a device-local midnight like `maturityDate`;
`pay_val` the exact decimal string for ONE bond of the register's
`nominal` — a Eurobond pays fractions of a cent, so never minor
units). All-or-nothing, like `asLots`: one malformed payment drops the
whole list (`payments` absent), the same as a cache row written before
payments were parsed — no schema change, `terms` is JSON. `couponPct`
is the NEXT UNPAID coupon (a `pay_type` 1 dated after `now`'s local
day; one paid today counts as paid): `pay_val` x payments per year
(from `pay_period`: 182/183 → 2, 364/365 → 1, 91/92 → 4) / `nominal`
x 100, exact through `multiplyToDecimal` (`src/currency/decimal/`;
`77 * 2 / 1000 * 100` in float is `15.400000000000002`). `auk_proc`
is only the fallback when no future coupon (or no known frequency)
exists. A step-up bond (XS2895055981) therefore reads its CURRENT
step. `fetchNbuRegister(fetchImpl, now)` takes `now` from
`refreshBondRegisterIfStale`, so the cached coupon is as of the
refresh day.

**Step-up coupons: the coupon in force per payment date (USER DECISION
2026-09-27).** No schema change: the holding KEEPS the issuer's schedule
in its own metadata (`BondMeta.payments`, JSON), so its coupons never
depend on the ISIN still being in the `bond_register` cache or on when
the register last refreshed. A SAVED bond's `BondMeta.couponPct` still
stays as saved (nothing rewrites it); it is only the fallback.
- **The kept schedule.** `BondMeta.payments?: BondPayment[]` — the
  register's own `{ date, kind, amount }` list, coupons AND the
  redemption (the yield reads both): `amount` is the exact decimal per
  ONE bond of its face value (never per 1 unit of nominal, never minor
  units), `date` the register's device-local midnight. `BondPayment` is
  holdings-owned (`holding-metadata.ts`); `nbu-register.ts` imports it.
  `asBondMeta` parses it through `asBondPayments` — all-or-nothing, and a
  present-but-invalid list (a stored `null` included) rejects the whole
  record like every other present field. The key is TRI-STATE: absent = never captured (read the
  cache); a non-empty list = the schedule; `[]` = the user's own coupon
  replaced the schedule (read neither, so a matching cache cannot
  override an edited coupon).
- **Read order.** `holdingRegisterPayments(meta, currency, terms)`
  (`src/bonds/nbu-register/holding-register-payments.ts`): the kept
  schedule → the cache → null (the saved coupon). The cache step is
  `cachedRegisterPayments(bond, currency, terms)`, the one gate: the
  cached payments describe a bond only when `terms.isin === bond.isin`
  AND the currency and face value match the register's, and only if they
  parse back through `asBondPayments`; null for a Manual bond (no ISIN),
  another ISIN, a cache without payments, or no cache.
  `holdingRegisterCoupons(metadata, currency, terms)` keeps the
  `'coupon'` payments (`[]` otherwise). The yield, the ledger, and the
  expected profit all read this order.
- **Written at save** (`bondPaymentsOnSave`,
  `src/screens/forms/holding-form/bond/use-bond-fields/`): ISIN mode
  copies the matched register schedule (create or edit). A Manual create
  with an ISIN copies the matched register's schedule while its coupon %
  (and frequency, when the register maps one) is still the matched
  one; a coupon typed over it, or no matched register row, writes `[]`
  (this includes an ISIN typed while the register cache is still empty,
  e.g. a first launch offline: a step-up bond then books its typed flat
  coupon; switching the bond to ISIN mode in Edit copies the register
  schedule once the cache has it),
  so the typed coupon is booked (OVERNIGHT ruling 2026-09-27, needs user
  confirmation). A Manual create without an ISIN keeps none. An edit
  keeps the saved schedule, or captures the matched register's for a
  bond saved without one (a refresh can land while the form is open).
  An edited ISIN, face value or currency drops it (key absent: another
  bond, so the cache is read). An edited coupon % or frequency on an
  ISIN bond in Manual mode writes `[]`, so the edited coupon is what the
  ledger books; the form reaches this only for a bond seeded without a
  non-empty schedule, since a kept one makes both fields read-only
  (below). `useBondFields` compares the fields against the row it
  seeded (`savedBondRef`), but takes the schedule it keeps from the row
  as stored at the time of the write: the edit saves through
  `holdingsRepo.updateMetadataFromStored`, which re-reads the metadata
  inside its own write, because the form's own register refresh can
  backfill a schedule after the seed and then drop the ISIN from the
  cache (the seed-once write-back class, kiko-architecture).
- **Backfill of bonds saved before this** (`backfillBondPayments`,
  `src/bonds/bond-payments-backfill/`): runs inside the daily register
  refresh (`refreshBondRegisterIfStale`), after a non-empty fetch and
  BEFORE `replaceAll`, reading the fresh rows first and then the rows
  still cached, so an ISIN the fresh fetch dropped is still kept. ONE
  write for all bonds that re-reads every bond inside it (the
  kiko-architecture display-screen write rule: never a cached row) and
  writes only a bond whose `payments` key is still absent and whose
  ISIN/currency/face still match; every other metadata key is kept as
  stored (a bond without a price does not gain the nominal one). It
  reads the cache only for the ISINs still pending. Not a render-time
  effect: the refresh is the only place the fresh rows exist.
- **Ledger and expected profit.** `derivedEntries(holding, now, t,
  scheduledCoupons)` → `HoldingDescriptor.entries(…, scheduledCoupons)`
  and `bondExpectedProfitMinor(meta, currency, scheduledCoupons)`
  (`holding-descriptor/bond/`) build every coupon through one
  `bondCoupons`: the ledger DATES stay `bondCouponDates` (the
  statement's 15th, unchanged); each date's gross is the scheduled
  coupon closest to it (`couponPaymentOn(payments, date, frequency)`,
  `src/holdings/interest/` — the register lists it a few days off the
  15th; an equal-distance tie keeps the earlier; a closest coupon more
  than half a period away (months x 365 / 24 days) belongs to another
  date and gives undefined) x `quantity` through `multiplyToMinorUnits`,
  else the saved constant coupon. Corporate
  tax is withheld per coupon. `BondCouponPayment` is
  `Pick<BondPayment, 'date' | 'amount'>`: the ledger reads only a
  coupon's date and amount, so a caller can pass the kept `BondPayment`
  list as is. The holding detail screen passes
  `holdingRegisterCoupons(…, registerTerms)` from
  `useBondRegisterTerms`; the spec's `expectedProfit(holding,
  registerTerms)` does the same.
- **Shown coupon at read time.** `currentCouponPct(terms, now)`
  (`nbu-register.ts`) re-applies the next-unpaid rule to the cached
  payments against TODAY (nominal from `faceValueMinorUnits` via
  `shiftDecimal`), falling back to the cached `couponPct`. The
  ISIN-mode form's `useBondIsinMode` returns its matched terms with
  this coupon (`Date.now()`), so both the shown and the filled coupon
  move to a step on its date with no refresh (an offline phone).
  `currentCouponPct` takes a `Pick` of `BondTerms` (currency, face,
  coupon, frequency, payments), so a stored bond's kept schedule reads
  through the SAME function: `{ ...meta, currency }`.
- **Edit form coupon with a kept schedule (USER RULING (4) option (a),
  2026-09-27).** While an edit keeps a non-empty stored schedule
  (`keepsSavedSchedule(saved, next)` in `bond-payments-on-save.ts`: the
  seeded bond has `payments.length > 0`, and the form still holds its
  ISIN, face value, currency, coupon % and frequency — exactly when a
  Manual save returns `saved.meta.payments`), `useBondFields` returns
  `scheduledCouponPct` = `String(currentCouponPct({ ...meta, currency },
  Date.now()))` — the coupon in force today — and the Manual coupon %
  field shows it READ-ONLY (`TextField editable={false}`), with the
  coupon frequency `SelectField disabled` too (the frequency sets the
  payments per year the coupon is read with, and a changed frequency
  drops the schedule by the same rule). The typed `couponPct` state
  keeps the SAVED coupon, so an untouched Save writes the stored
  `couponPct` unchanged (4.5 for XS2895055981 after its step) with the
  schedule kept — the shown value is never written back. Without a
  schedule (`payments` absent, or `[]` = the user's own coupon) or once
  the ISIN, face value or currency changed (the schedule is then dropped
  by the identity rule), both fields stay editable and show the typed
  coupon. ISIN mode never shows an editable coupon: its summary shows the
  matched register terms' `currentCouponPct`. Pins
  (`use-bond-fields.test.ts`): XS2895055981 saved at 4.5 with its
  schedule, today 2027-01-20 → shown 4.5, 2027-08-15 → shown 6, in
  Manual AND ISIN mode; the untouched Save `toEqual`s the stored
  metadata.
- **Pins.** XS2895055981 cached on 2026-09-26: shown 4.5 on 2027-01-20,
  6 on 2027-08-15 (and on 2027-02-01, that coupon counted paid); 1,000
  bonds bought 2026-09-26 for 980.00 book coupons 22.50, then 4 x 30.00,
  expected profit 162.50 (the saved 4.5% alone gives 132.50).
  UA4000239115 unchanged: 15.18, ledger 75.90 per 1,000 bond with or
  without the register coupons. A Manual bond and an ISIN bond whose
  cache has no payments keep the saved coupon. The same XS bond with its
  schedule kept and its cache row gone (matured/delisted) still books
  22.50 + 4 x 30.00, expected profit 162.50; a `.kiko` restore keeps the
  schedule (metadata is restored verbatim). The App Store demo bond
  (invented ISIN UA4000999015, `e2e/screenshot/seed/`) keeps its
  schedule for the same reason: the first online refresh drops it. Its
  ISIN passes `validateIsin` (a seed test pins every dataset ISIN), so
  a reviewer can save an edit of it in Manual or ISIN mode, and sits
  far above the live NBU issue range (highest listed UA4000239123 on
  2026-09-27), so it never matches a real bond.
- **Limits.** A bond whose ISIN left the cache BEFORE any refresh ran
  the backfill (never captured) stays on its saved coupon — for a
  step-up bond, the step saved at create. A `.kiko` restore brings the
  `bond_register` cache back with the holdings, so a restored bond not
  yet backfilled reads the restored cache until the next refresh
  backfills it. The edit form's typed coupon state still seeds the SAVED
  coupon, and the register's coupon for the stored ISIN never replaces
  it (`seedStoredIsin`, below); a kept schedule shows its current coupon
  read-only instead (above). An ISIN-mode edit of a stored ISIN the
  register no longer lists shows no coupon at all (no summary without a
  match).

**Yield to maturity (USER DECISION D4).** `src/bonds/yield-to-maturity/`:
`yieldToMaturity(cashFlows, paidMinorUnits, lotDate)` is the effective
annual IRR (a decimal fraction, 0.154 = 15.4%), act/365 via
`daysBetween`, over the flows strictly after the lot's LOCAL day (a
flow on the lot day went to the seller); null for a lot without a price
(null/≤0), with nothing left, or whose rate is not finite (`expm1`
overflows past a log-rate of ~709 — a half-typed price against a coupon
days away; `Number.isFinite` once, so the form row and the detail both
read "no answer"). Solved by bisection in ln(1 + rate) —
monotone over all reals for positive flows, so always bracketed
(doubling, ≤64 expansions) and deterministic (tolerance 1e-12, ≤200
iterations); amounts stay integer minor units.
`portfolioYieldToMaturity(lots)` weights each priced lot's yield by the
amount paid; an unpriced lot has no weight. `bondYieldToMaturity(metadata,
currency, registerTerms)` reads the register's payments (scaled by
`quantity` through `multiplyToMinorUnits`) when the cache has them for
the bond's ISIN AND the holding's face value and currency match the
register's; otherwise it GENERATES the schedule: the ledger's own gross
coupon (face x coupon% / payments per year) on each date stepped back
from maturity by `couponPeriodDays` in DAYS (not calendar months — an
NBU bond pays exactly 182 days apart, so a bond entered by hand lands on
the register's dates), plus the nominal at maturity. A stored bond with
no `purchasePriceMinorUnits` (legacy, or Manual saved with a blank
price; `hasStoredBondPurchasePrice` in `holding-metadata.ts` tells it
from `asBondMeta`'s nominal default) has no yield. Pin: 98 x UA4000239115 at 1,076.72 on
2026-09-10 → 15.40% from the register AND from the generated schedule
(month-stepped `bondCouponDates` would give 15.41%). The holding
detail's bond breakdown shows it as its last row, "Yield to maturity"
(`holdingDetail.yieldToMaturity`, a `text` row, testID
`bond-yield-to-maturity`, 2 decimals through the shared
`yieldToMaturityText` in the same `src/bonds/yield-to-maturity/`
feature), reading the cached terms through `useBondRegisterTerms`
(`src/screens/holding-detail/use-bond-register-terms/`, disabled for a
holding without an ISIN).

The bond FORM shows the same row live (USER FINDING D7 — "coupon
maturity" meant the yield to maturity, the seller's 15.4%, not the
coupon): create and edit, ISIN and Manual. `useBondFields` returns
`yieldToMaturity` = `bondYieldToMaturity(buildBondMetadata(<the form
now>), currency, registerTerms)` — the SAME function the detail calls,
never a second implementation — so it follows every change of price,
quantity, dates and schedule (register payments in ISIN mode, the kept
or generated schedule in Manual). `buildBondMetadata` stands today in
for a missing date, so `hasYieldInputs` hides the row BEFORE the call
while the price, the purchase date or the maturity date is missing; a
solver with no answer hides it too (no placeholder). In ISIN mode with
no register match, `hasYieldTerms` hides it: the face, coupon and
maturity are still a previous match's, not the typed ISIN's — except an
edit's own stored ISIN (`isStoredIsin`), whose stored terms and schedule
are the bond's own, so the row shows the holding detail's value. The
yield is a `useMemo` over its inputs (`buildBondMetadata` is a
`useCallback` over the bond fields, and `useBondIsinMode` memoizes
`registerTerms` on the cached row), so a keystroke in Name or Notes
does not re-solve it. `BondFormBlock`
renders it right after the purchase date as a one-row `SummaryTable`
with a caption `textSecondary` value (the ISIN summary's own row
style), testID `bond-form-yield-to-maturity`. Pin: UA4000239115, 98 x
"1 076,72", bought 2026-09-10 → 15.40% in the form, from the register
and from the generated schedule.

`src/bonds/bond-register-repo/` caches the register in the
`bond_register` table (migration `0037`; `isin` primary key, `terms`
a JSON `BondTerms` column, `fetchedAt`). `bondRegisterRepo` exposes
`findByIsinQuery(isin)` and `fetchedAtQuery()` (both hand straight to
`useLiveQuery`; `fetchedAtQuery` is also awaited directly as a
one-shot read, the same dual-purpose pattern `ratesRepo` and
`pricePointsRepo` establish) and `replaceAll(rows)` — a REPLACE, not
an upsert: every existing row is deleted and the fresh set inserted in
ONE transaction, so a matured/delisted ISIN disappears from the cache
the same run it disappears from the live register.
`refreshBondRegisterIfStale({ now, fetchImpl })` gates the fetch at
most once per LOCAL calendar day, comparing the cache's single
write-time `fetchedAt` stamp against `now` through `dayKeyOf`
(`kiko-pricing`) — the same device-local-day convention `price_points`
uses, not a UTC day. `src/bonds/bond-register-repo/index.ts` is a
barrel (`export * from './bond-register.repo'`), added once the
ISIN-mode form became a real consumer — an unused barrel would have
been flagged by Knip.

### The ISIN-mode form

`BondMeta.isin?: string` (`holding-metadata.ts`) records the ISIN a
bond was saved with — from ISIN mode or typed into Manual mode's own
optional ISIN field, `undefined` for a bond without one. It does NOT
tell the two modes apart; `BondMeta.entryMode` does (below). Once saved, the holding's stored terms never depend
on the register again — nothing re-validates a stored ISIN or
rewrites its coupon against a later register state (the detail
screen's coupons, expected profit and yield to maturity READ the kept
schedule, else the cached payments, above; the only register-driven
write is the one-time schedule backfill, which never touches the
coupon).

`BondFormBlock`'s bond section has an "ISIN / Manual"
`BondEntryMode` mode, the design-system `SegmentedControl` (not
`ChipRow` — one control type per kind of mode choice),
rendered by `BondIsinSection`
(`src/screens/forms/holding-form/bond/bond-isin-section/`) — purely
presentational, the same `MetalSection`/`PropertySection` split.

**`useBondIsinMode`** (`src/screens/forms/holding-form/bond/use-bond-isin-mode/`)
owns ALL of the ISIN-mode state, the `useLiveQuery` lookup
(`bondRegisterRepo.findByIsinQuery`, keyed on the normalized ISIN when
`validateIsin` passes, else an empty string that matches no row), and
THREE SEPARATE effects — extracted out of `HoldingFormScreen`
specifically because a single MERGED effect
sharing one dependency array causes the cross-talk described below; the hook has its
own cognitive-complexity budget instead of borrowing the screen's, so
its effects stay genuinely separate with no lint-driven pressure to
recombine them:
- refreshes the register cache at most once per local day, fired
  once per bond-section open (create or edit); the
  fire-and-forget call is `either(() => refreshBondRegisterIfStale())`
  as a bare statement (the project's standing fire-and-forget idiom —
  `either` never rejects, so a network failure can never surface as a
  form error or an unhandled rejection);
- defaults `purchaseDate` to LOCAL MIDNIGHT (`startOfLocalDay`, not a
  raw `Date.now()`) the first time ISIN mode is entered — a raw
  `Date.now()` default would leave a LATER explicit pick composed with
  that moment's clock time instead of a clean day, because
  `DateField.handleDayPress` carries an existing value's own
  time-of-day onto a newly picked day (so a paired TimeField pick is
  never clobbered);
- applies a found ISIN's terms once PER MATCH while in ISIN mode,
  tracked by a REF (`lastAppliedIsinRef`, not the effect's own
  dependency array) rather than "since `bondMode` is still isin" — the
  register lookup itself is NOT gated on `bondMode` (a valid ISIN
  typed in Manual mode resolves just as readily), so a match resolved
  while the user is in Manual mode still applies the first time they
  later switch to ISIN — keying purely on
  `registerTerms?.isin` misses exactly this case, because the effect
  never runs again once `bondMode` stops changing. A merged effect
  applied on every unrelated change would silently overwrite a typed
  name or a changed currency, and would re-fire on every re-tap of
  "ISIN", putting the control into a loop back to Manual for an
  unmapped-frequency match — this is why the three effects must stay
  separate.

ISIN mode shows quantity (required) and purchasePrice always. The price
is REQUIRED in ISIN mode (USER DECISION D4 — the yield to maturity needs
the price actually paid): `bondFieldErrors`' `purchasePriceError`
(`forms.holding.purchasePriceRequiredError`, gated by
`purchasePriceRequired: bondMode === 'isin'`), its own scroll target
after quantity, and the placeholder `purchasePriceIsinPlaceholder`;
Manual mode keeps it optional. A blank price is NOT stored (the key is
left out, never written as the nominal): `asBondMeta` alone supplies the
nominal default for the purchase entry and expected profit, and the
yield shows none. Edit seeds a blank price field when the key is absent,
so an unchanged re-save stays unpriced.

The price is ENTERED PER BOND and STORED AS THE BATCH TOTAL (USER
FINDING D6, no migration): the field (`forms.holding.purchasePrice`,
"Purchase price per bond") takes the price of ONE bond, while
`purchasePriceMinorUnits` keeps its meaning — the total paid — for every
consumer (net worth, the purchase ledger entry, expected profit, yield
to maturity, funding reconcile, export/restore). `bond-purchase-price.ts`
(`src/screens/forms/holding-form/bond/use-bond-fields/`) owns both
conversions: `bondPurchaseTotal` stores quantity x price per bond
through `multiplyToMinorUnits` (exact BigInt product; the total is taken
from the quantity at Save, so a quantity typed after the price still
counts). It reads both fields through `parseAmount`, the SAME parser the
validation uses (`bond-reasons.ts`), then `decimalFromJsonNumber` (a
typed amount has far fewer than 15 significant digits, so the double
converts back exactly): a dangling separator ("1 076,") is the whole
amount, as in every other amount field, never a price the validation
passes and Save silently drops (98 x "1 076," → 10_544_800; an edit to
"1 100," keeps a price). `normalizeDecimal` rejected it and deleted the
stored price on an edit (review I1). `pricePerBondText` seeds the edit
field with `scaleMinorUnits(total, 1, quantity)` in one exact BigInt
step, rounded half away from zero to the minor unit; a quantity that is
not a whole, positive number of bonds seeds a blank price (the BigInt
division cannot take it). A bond is a whole unit, so the quantity field
rejects a fraction (`bond-reasons.ts`: `quantityWholeError`, "Enter a
whole number of bonds."; blank/zero keep `quantityError`) — the
number-pad has no separator, but a paste or a restored `.kiko` can bring
one. An edit of a restored non-whole quantity shows that error and
blocks Save; the stored metadata is not touched until the user types a
whole quantity. Pins: '2.5' blocks Save; a stored 3-bond total, changed
to 2.5 and back to 3, re-saves unchanged. While both the price and the
quantity text still equal what the edit seeded, Save writes the stored
total unchanged — 10 000.00 over 3 bonds seeds 3 333.33, which would
otherwise re-save as 9 999.99. Pins: 98 x "1 076,72" → 10_551_856;
that total seeds "1 076.72" (every seeded amount uses a dot). A bond the
user saved by typing one bond's price into the old "total paid" field
is stored wrong and code cannot tell; its edit shows an implausibly
small price per bond, fixed by hand. Metal lots and property keep a
total cost field.

ISIN mode hides face
value, coupon, maturity, kind, and frequency — a found ISIN fills all
of them: `bondKind` is always `'government'` (the register is
Minfin-only), `couponFrequency` only when the register's `pay_period`
maps onto a known band; an unmapped period instead switches the form to Manual ONCE, the first time
that match is applied, leaving every OTHER known field pre-filled,
rather than guessing a frequency. Re-tapping "ISIN" afterward for that
SAME match does stay in ISIN mode — but showing the register's
summary there with no visible frequency would silently let the form
carry the shared `couponFrequency` state's own untouched default into
Save, which is exactly the guess this rule forbids. So ISIN mode instead
shows its OWN coupon-frequency `SelectField` (`selected: null`) with NO
default whenever the
matched terms have `couponFrequency === null`
(`needsCouponFrequencyPick`), and Save is blocked until the user picks
one — never a frequency the user did not
pick or the register did not give. In
EDIT mode, a found ISIN whose currency differs from the (locked)
holding currency is never applied at all — `isinReasonKey` returns
`'forms.holding.isinCurrencyMismatchError'` instead, blocking Save
(the currency field is locked
`disabled={isEdit}`, so a silent apply used to store one currency's
terms under a holding balance denominated in another). Outside edit
mode a found ISIN's `currency` DOES overwrite the form's own state on
every new match — editable afterward, but re-applied whenever the ISIN
changes to a new found bond.

The register name fills the Name field only while the user has not
typed one (USER FINDING D5): `useBondIsinMode` takes the current
`name`; a match sets it only when it is blank or still equals the name
the hook itself filled last (`filledNameRef`), so ISIN B replaces ISIN
A's automatic name but never a typed one, in either mode, in create or
edit (an edit seeds the saved name, which the hook never filled).

An EDIT seeds its stored ISIN through the hook's `seedStoredIsin`: the
stored ISIN counts as already applied (`lastAppliedIsinRef`), so a
register resolve or a tap on ISIN never overwrites the saved name,
coupon, face value or frequency — without it, a step-up bond's register
coupon replaced the saved one, and a later Manual save read that as a
typed coupon and stored `payments: []`. The stored `couponFrequency`
also counts as the pick (`pickedCouponFrequency`), so an ISIN-mode edit
of an unmapped-frequency bond stays saveable. The pick clears only when
a NEW match applies (inside the apply effect), not on every change of
the matched ISIN. So stored values win over the register for the stored
ISIN: a Manual bond with a typed ISIN and typed terms (say maturity
2027-09-01 where the register says 2027-09-15), switched to ISIN mode
on edit, keeps its typed terms on Save and saves `entryMode: 'isin'` —
while the ISIN summary shows the register's maturity and coupon, so the
summary can disagree with what is booked (review M2, documented limit).

A CREATE defaults to `'isin'`. EDIT opens in the mode the bond was
saved from (USER FINDING D8): `BondMeta.entryMode?: 'isin' | 'manual'`
(`BondEntryMode`, `holding-metadata.ts` — the `PropertyMeta.ownershipInput`
pattern: optional, an unknown value is dropped by `asBondMeta`, the
record still parses; a `.kiko` restore copies it with the metadata).
`buildBondMetadata` writes the mode the bond is saved from on every
create and edit save — the unmapped-frequency auto-switch saves
`'manual'`. `useBondFields`'s own `seed`
(`src/screens/forms/holding-form/bond/use-bond-fields/`) calls the
hook's `setBondMode` with it; the stored ISIN is shown, still editable,
in either mode. A bond without `entryMode` (saved before it existed)
opens Manual — USER RULING: "Ignore old bonds, I'll just remake them";
there is no legacy detection code (no mode guess, no per-bond-price
check for a price typed into the old total field).

An ISIN-mode EDIT of its own stored ISIN that the register no longer
lists (matured/delisted, or offline with an empty cache) SAVES — USER
RULING: `useBondIsinMode` keeps the seeded `storedIsin`, and
`bondIsinReasonKey` returns no reason while nothing matched and
`isStoredIsin` holds: the ISIN field still holds the stored ISIN AND
the form still holds the stored face value, coupon %, coupon frequency,
maturity date and bond kind (`holdsStoredTerms` in `useBondFields`,
compared as values against the seeded `savedBondRef`). USER RULING:
nothing stored is overwritten — a change to any of those five (for
example typed in Manual, then back to ISIN; the kind is a Manual-only
chip, so an ISIN-mode save would store a kind the reopened bond no
longer shows) blocks the unlisted ISIN in ISIN mode again
with `isinNotInRegister`, and Switch to manual saves it honestly as
Manual; the yield row hides with it. `BondIsinSection` still shows the "not in the
register" / "not loaded" note with its Switch-to-manual button (the
note reads `foundTerms`, not the reason). Save writes the stored terms
unchanged (name, coupon, face, frequency, maturity, currency) with
`entryMode: 'isin'`, and `bondPaymentsOnSave` keeps the stored schedule
(no register payments to take, identity unchanged → `saved.meta.payments`).
The form's yield row reads that stored schedule too, the same value as
the holding detail. Once another ISIN's match fills the form, the
exemption ends (`storedIsin` clears in the apply effect): retyping the
stored ISIN is blocked again, since the form no longer holds its stored
terms. A CREATE with an unlisted ISIN, or an edit's DIFFERENT unlisted
ISIN, is still blocked until "Switch to manual".

Validation (`isinReasonKey`, returned by the hook, backed by a
module-level pure `bondIsinReasonKey`): required and blocking in ISIN
mode; optional but still check-digit-validated when non-empty in
Manual mode; `isinNotInRegister` once shape/check-digit both pass but
the cache has no match (a genuine not-found and an
offline-with-no-cache open the same way, since both leave the lookup's
result `null`; an edit's own stored ISIN is exempt, above); `isinCurrencyMismatchError` in edit mode per the currency-lock rule above.
A maturity-before-purchase reason (`bondReasonKey`, unrelated to the
ISIN reason above) still applies unchanged in ISIN mode — a
matured-still-registered bond (the live register still counts it)
can pass every ISIN check yet still fail this — but ISIN mode never
mounts the maturity `DateField`, so `BondFormBlock` shows that reason
on the purchase date `DateField` instead, and `useBondFields.scrollTargets`
scrolls there, the one date the user actually controls there.

The five Manual-only fields (face value, coupon %, maturity date, bond
kind, coupon frequency) are their own component,
`ManualBondFields` (`src/screens/forms/holding-form/bond/manual-bond-fields/`):
it takes `bondMode` as a prop and returns `null` outside Manual mode,
rather than the caller gating `{bondMode === 'manual' && (...)}`
around its JSX — see `kiko-code-style`'s `noExcessiveCognitiveComplexity`
entry for why a conditional NESTED inside the bond block's own
`{type === 'bond' && (...)}` gate needed a real extraction, not a
`match()` trick.

## Debts — the `debt` kind, `loan` type, and schedule math

`accounts.kind` gains `debt` (en "Debt", uk "Борг") and
`holdings.type` gains `loan`, TS-only enum widenings (no migration,
same as `property`/`metals`). `loan` is `isLedgerlessHoldingType`
(`src/holdings/holding-descriptor/holding-descriptors.ts`) — like `property_item`/`metal`, a loan
holding writes NO `Transaction` ledger rows of its own; every payment
lives on the LINKED bank holding instead (the `loanHoldingId`
column). `debt` maps to `loan` alone in `holdingTypesForAccountKind`,
and `loan` is excluded from every Exchange source/destination
predicate in `exchange-destination.ts` (a loan is never an Exchange
leg). Entity color: `entityColorsDark.red`, shared between the `debt`
kind and its sole `loan` type. Glyphs differ: the `debt` kind keeps
`minus.circle.fill` (persisted on existing account rows; changing it
needs a 0032-style migration), while the `loan` type is
`arrow.down.backward.circle.fill` (iOS 14), the mirror of a loan given's
`arrow.up.forward.circle.fill` — a saved loan holding stores a null icon,
so the new glyph needs no migration. That type glyph is now only the
fallback for a loan with no valid kind: a loan's default glyph follows its
kind (below). There is no "Add loan" footer
button any more (kiko-design-system's footer mapping).

A `debt` account's Type field IS its loan-kind picker (`LoanKindField`,
`src/screens/forms/holding-form/loan/loan-kind-field/`, testID
`loan-kind-field`): `loan` is that account kind's only holding type, so
`HoldingFormScreen`'s `typeSlotFor` renders this `SelectField` wrapper —
over `loanKinds` in the fixed order Mortgage/Car loan/Consumer loan/From a
person, one SF Symbol per kind (`loanKindSymbol`, `entity-symbols.ts`) — in
the generic `HoldingTypeField`'s slot. The stored holding type stays `loan`;
the pick writes `LoanMeta.kind` (`useLoanFields`' `kind`/`setKind`), and
`LoanSection` carries no kind field. Same "Type" label/sheet-title/placeholder
keys as the property field; editable in create and edit mode, never
disabled. A loan card's default glyph
follows its kind: `defaultHoldingSymbol` reads it leniently (`loanKindOf`),
and a loan with a missing/invalid kind shows the loan type's own glyph
(`holdingTypeSymbol.loan`); the form's untouched icon chip follows the
picked kind until the user picks an icon. A stored icon is never changed: a
loan saved with a NULL icon (what an untouched create writes) now follows its
kind on every card, a loan with a stored icon keeps it.

`LoanMeta` (`src/holdings/holding-metadata/holding-metadata.ts`):
`kind` (`'mortgage' | 'car_loan' | 'consumer_loan' | 'personal'` —
`personal` is money owed to a person, not a bank), `principalMinorUnits`,
`startDate`, `schedule` (`'annuity' | 'differentiated' | 'none'`), and
`annualRatePct?`/`termMonths?` — both OPTIONAL, since a `none`
(informal) loan carries no known rate/term; the create form is
expected to require them for `annuity`/`differentiated`, not
`asLoanMeta` itself, which accepts either shape. Three more OPTIONAL
fields — `paymentHoldingId?`, `lenderName?`, `lenderIban?` — are the
automatic loan-payment matcher's own inputs (below); `undefined` for
every loan saved before they existed, same convention. A loan the user
GAVE to someone (not owed BY them) is not a `loan` holding at all — it
stays the existing `property` category `loan_given`, which is
an ASSET, not a debt.

`src/holdings/loan-schedule/` is the amortization math, mirroring
`src/holdings/interest/`'s pattern (local-midnight `addMonths` due
dates, integer-minor-unit rounding, the last period absorbing drift)
rather than the BigInt decimal-string helpers — an interest RATE is a
plain percentage `number`, the same convention `TermDepositMeta.annualRatePct`/
`BondMeta.couponPct` already use, never the price/quantity/purity
decimal-string rule.

- `loanInstallments(meta)`: the full monthly amortization table for
  `annuity`/`differentiated` (empty for `none` — an informal debt has
  no schedule at all). `annuity` computes one constant payment per
  period via the standard formula and rounds it ONCE; every period but
  the last derives its principal as `roundedPayment - interest`.
  `differentiated` instead holds a constant PRINCIPAL per period
  (`round(principal / termMonths)`). Either way every non-last principal is
  capped at the remaining balance, so the balance never goes negative. A
  tiny loan paid off before its term keeps its row count
  (`installmentIndexOf` and the ledger count rows) and its trailing rows
  are zero-payment rows. The LAST principal is whatever balance remains, so
  the principals sum exactly to the loan principal and the schedule ends at
  exactly 0. Read `loanInstallments` and `isScheduledPayment` in
  `src/holdings/loan-schedule/loan-schedule.ts`; its test
  (`loan-schedule.test.ts`) pins the invariants.
  A fix to shared money math ships with a property test of the invariant AND
  a before/after sweep showing normal inputs unchanged. It never changes the
  row count of the schedule (indexes and the ledger count rows).
- `loanOutstandingMinorAt(meta, holdingId, book, instant)`: `none` reads the manual
  `holding:<id>` price-point series directly (the same mechanism
  Property's "Update value" uses), clamped to never go below 0.
  `annuity`/`differentiated` are computed AT READ TIME from the
  schedule: the LATEST manual correction point on the loan's own
  `holding:<id>` instrument (if any, at or before `instant`'s local
  day) anchors a fresh baseline value; only the scheduled PRINCIPAL
  due STRICTLY AFTER that correction's day (and at or before `instant`)
  is subtracted from it. With no correction ever recorded, the anchor
  is simply the loan's own principal at `startDate`. Either path
  clamps to 0 — an overpaid/over-corrected loan reads as paid off,
  never negative. The anchor itself is `loanAnchorAt(meta, holdingId,
  book, instant)` — `LoanAnchor`, `{ dayKey, valueMinorUnits,
  fromCorrection }` — shared with the loan ledger below, so both anchor
  on the exact same correction.
- `withinInstallmentTolerance(installmentPayment, paymentAbs, currency)` —
  whether a payment is within the larger of ±1 % or ±1.00 of an
  installment's scheduled payment; shared by the matcher and the ledger.
- `loanPaymentSplitsMinor(meta, payments, currency, plan?)` →
  `{ interestMinorUnits, excessMinorUnits }[]`, one per payment: the
  interest share plus the within-tolerance fee above the scheduled
  payment (a prepayment above the tolerance, a partial payment, and a
  `none` loan have no excess).
- `loanInterestPerPaymentMinor(meta, payments, plan?)` → one interest
  amount per payment, in the given order ("interest-only spending" — the
  derived-entry wiring itself is the "Spending-exclusion pipeline" section
  above): `none` always counts 0 interest
  (an informal debt has no schedule to derive interest from).
  Otherwise each payment maps to the installment whose `dueDate` is
  NEAREST to the payment's own local day (not necessarily the next
  unpaid one), and each installment's scheduled interest is counted
  ONCE across every payment mapped to it: earliest payment first, each
  counts what is left of that interest, capped at its own `|amount|`;
  the rest is principal. So an installment paid in two halves (9 and 10
  Feb) counts its interest on the first half only, and a partial
  payment never counts more interest than it actually paid. Always pass
  ALL of one loan's counted payments together — interest per payment
  one at a time counted a split installment's interest twice. A payment MORE THAN ONE PERIOD outside the
  schedule (before `addMonths(startDate, 0)`, after
  `addMonths(startDate, installments.length + 1)`) counts 0 instead of
  still mapping to the nearest boundary installment — both bounds are
  inclusive, only a payment strictly beyond one counts 0.
- `loanPlanOf(meta)` → `LoanPlan` (`{ installments, dueDayKeys }`): the
  table plus each row's day key, built ONCE per loan. `loanOutstandingMinorAt`
  and `loanInterestPerPaymentMinor` take it as an optional last argument
  (default: build it); every caller that repeats a read for the same loan
  (each linked payment, each net-worth bucket, each statistics
  transaction) builds it once and passes it. Rebuilding it per payment per
  bucket froze Statistics (a 30-year loan with 60 linked payments over 260
  weekly buckets took ~5-8 s; now ~16 ms — pinned by a budget test in
  `net-worth-series.test.ts`).

**The loan ledger — linked payments drive the outstanding everywhere
(user-approved).** `src/holdings/loan-ledger/` reads the loan's linked
payments from the `PriceBook` (`book.loanPayments`, kiko-pricing — one
live read of every linked payment across all loans, never a query per
holding). A payment COUNTS for an instant when it is a debit, in the
loan's own currency (the rule `loanPaymentExcludedTransactionIds`
applies), and its LOCAL day is on or before the instant's local day —
the local-day rule a ledger holding's running balance follows, so a
net-worth bucket sees the payer card's debit and the loan's drop
together.

- `loanLedgerOutstandingMinorAt(meta, loan, book, instant)` — the ONE
  outstanding every site reads (the descriptor below: card, detail
  Value, Home/Accounts totals, statistics, every net-worth bucket; the
  detail's upcoming-payments guard; the form's schedule-to-`none`
  edit). No counted payment: exactly `loanOutstandingMinorAt` (pinned —
  a loan with no linked payment values as it always did). Otherwise:
  the anchor minus the principal part (`|amount|` minus its
  `loanInterestPerPaymentMinor` share minus its within-tolerance excess) of each counted payment dated strictly
  after the anchor's day, clamped at 0; 0 before the start day. The
  anchor (`ledgerAnchorAt`) is the latest correction on or before the
  instant (`loanAnchorAt`); with none, an `annuity`/`differentiated`
  loan anchors on the SCHEDULE outstanding (`loanOutstandingMinorAt`)
  at the EARLIER of (a) the end of the local day before its FIRST
  linked payment and (b) the end of the local day before the due date
  of the installment that payment maps to (`installmentIndexOf`'s own
  nearest-due-date mapping, `loan-schedule.ts` — the same mapping
  `loanInterestPerPaymentMinor` attributes that payment's interest by),
  because auto-links only reach back as far as the bank sync window and
  a loan's earlier payments are often never linked. Reading from before
  the DUE date rather than before the payment itself is what keeps a
  payment landing a few days late (a real-world norm, not an edge case)
  from double-subtracting its own installment's principal — once by the
  schedule anchor, once by the link — which had permanently understated
  every loan with a late first link by one installment's principal. So
  the history never steps up at the first link: it follows the schedule
  up to that day, then drops by each linked payment's principal part. A
  `none` loan (no schedule), or a first link on or before the start day,
  keeps the principal at the start day. A payment on or before a
  correction's day is already inside that correction. The ledger (the `LoanPlan` plus
  every paying-down payment with its day key, interest part and excess) is built
  once per `PriceBook` and cached in a `WeakMap` keyed by the book, then
  by loan id + currency + the schedule terms (the loan form reads one
  book with the old AND the new terms, so the terms must be in the key).
- `loanLedgerSummary(meta, loan, book, now)` — the detail's breakdown:
  `principalMinorUnits`, `paidSoFarMinorUnits` (Σ `|amount|`),
  `interestPaidMinorUnits` (Σ `loanInterestPerPaymentMinor`; 0 for
  `none`), `principalRepaidMinorUnits` (Σ principal parts; fees are left out, and
  `paidSoFarMinorUnits` stays the bank total, so the rows are not an equation), and
  `outstandingMinorUnits` (the function above at `now`).

Known limit: with linked payments and no correction, the outstanding
before the first link is the schedule's, so a loan paid off faster or
slower than its schedule before the first link reads off by that
difference until the user records a correction ("Update
outstanding").

Known limit: a MANUAL loan link (not the automatic ±7-day matcher) more
than half an installment period late still maps to its nearest
installment by due date (`installmentIndexOf`'s nearest-due-date
mapping), the same mapping the anchor logic above reads from. When the
link is that late, "nearest by due date" lands on a LATER installment
than the one this payment actually paid down, so the anchor logic's
"before the due date" guard no longer lines up with the payment's real
target, and the principal for the installment in between is subtracted
twice. Automatic links are not affected: the matcher's own ±7-day
window is always well inside half a period, so it never picks the
wrong installment in the first place.

`holding-descriptor/loan/loan.descriptor.ts`'s valuation branch (`gross = net = -outstanding`,
`principalOrCost = -principal`, interest/tax always 0 — a loan never
accrues either AT VALUATION time) backs the net-worth assets-minus-debt
rule. The `loanHoldingId` link column + its repo
functions are covered in their own subsection below. Interest-only
spending is wired through the "Spending-exclusion pipeline" section's
loan-payments module, above. The transaction-form field (`LoanPaymentField`)
and the automatic payment-linking matcher are BOTH wired — see "The
automatic loan-payment matcher" subsection below for the matcher's own
rules and every call site.

### Loan form + detail

A loan is created through the implicit entry (see "`property_item` /
`metal` create-form sections"): Debt in the account form swaps in this
holding form with `implicitKind: 'debt'`, and Save creates the loan under
the one implicit debt account.

`src/screens/forms/holding-form/loan/loan-section/` (kind `SelectField`,
principal, start date, schedule SegmentedControl, rate/term AND the
matcher's own optional "Paid from"/lender-name/lender-IBAN fields all
hidden for `'none'`) and its own `use-loan-fields/` hook — a full `HoldingTypeForm`
(`src/screens/forms/holding-form/holding-type-form/`): state,
per-schedule `loanReasonKey` validation, edit-mode `seed`,
`createPayload`, and `saveEdit` — mirror `useBondIsinMode`'s
extraction, the same way every other holding type's own `use<Type>Fields`
hook does. Unlike `PropertySection`/`MetalSection`'s
create-only-lot fields, EVERY loan field stays editable in both create and
edit mode (mirrors term_deposit/bond) — there is no fixed-at-creation
"first lot" a loan's principal/dates/schedule freeze against. Its own leaf
component (`LoanFormBlock`,
`src/screens/forms/holding-form/loan/loan-form-block/`) renders from one
arm of `HoldingFormScreen`'s single `match(type)…exhaustive()` — the same
dispatch every holding type's own form block renders from;
collapsing what used to be five independent `{type === '…' && (...)}`
JSX gates into one match is itself what keeps the screen under its
cognitive-complexity budget (kiko-code-style). A `'none'`-schedule CREATE
additionally writes a first `manual` price point on the new holding's own
`holding:<id>` series, equal to the principal at the start date
(`buildLoanCreatePayload`,
`src/screens/forms/holding-form/loan/use-loan-fields/`) — mirroring
`PropertySection`'s own first-point convention, so
`loanOutstandingMinorAt`'s manual-series read never comes up empty before
the user records a real correction. An `'annuity'`/`'differentiated'`
CREATE writes none — its outstanding is computed at read time from
principal + schedule.

`holding-detail.screen.tsx`: `loan`'s `holdingDetailSpecs` entry
(`holding-detail-spec/`) gives `'updateValue'` too — it reuses
`PricePointForm` to write a correction onto the SAME `holding:<id>`
manual series every schedule reads a correction from (not just
`'none'`), with the footer button's own label swapped to "Update
outstanding" (`holdingDetail.updateOutstanding`) for that type, and
`PricePointFormScreen` itself overriding the stack's static "Update
Value" title to "Update Outstanding" once the holding loads as a loan.
Every loan (any schedule, `none` included) shows the ledger breakdown
table under the Value header — its spec entry's `breakdown` is
`{ kind: 'loan' }`, rendered by the screen's `loanBreakdownRows` through
the shared `SummaryTable`: Principal / Paid so far / Interest paid /
Principal repaid / Outstanding (`loanLedgerSummary`, above; testIDs
`loan-ledger-principal`, `-paid-so-far`, `-interest-paid`,
`-principal-repaid`, `-outstanding`). Its Outstanding row is the same
number as the Value header, the card, and net worth.
An `'annuity'`/`'differentiated'` loan additionally lists EVERY remaining
scheduled payment under an "Upcoming Payments" heading (the loan entry's
own `upcomingInstallments` — every `loanInstallments` row that
`isScheduledPayment` accepts and that is due on or after today's local day
(zero-payment rows after an early payoff are skipped), in schedule order; its first row is the next
installment). `UpcomingPayments`
(`src/screens/holding-detail/upcoming-payments/`, memoized) draws them as
ledger cards: one `UpcomingPaymentRow` (`upcoming-payment-row/`) per
installment, built on the shared `EntryCard` under an `EntryDateHeader`. The
title is `holdingDetail.loanPayment`, the amount is the payment read signed
and red like a Linked Payments row (display-only negation through
`MoneyText` with `context="transaction"`, the same call; the accessibility
label reads the signed amount; the principal / interest split stays
unsigned), and the footer is the `holdingDetail.scheduled` caption, then the
`holdingDetail.paymentSplit` caption. Read `upcoming-payment-row.component.tsx`
for the exact row testIDs. Only the first `UPCOMING_PAYMENT_PREVIEW_COUNT`
installments render (see `upcoming-payments.component.tsx`). A shared
`ExpandToggle` (testID `upcoming-payments-toggle`) shows only when more
exist, and reveals or re-hides the rest. A 30-year mortgage still has 360
installments in the list, but only the preview count mounts until expanded.
The screen memoizes the list on the local day, so it is not rebuilt on every
render. A `'none'` schedule and every other holding type render nothing
there. The list is also empty once `loanLedgerOutstandingMinorAt` reads 0
(`upcomingInstallments`' own `<= 0` guard) — a loan fully repaid by its
linked payments, or overpaid/over-corrected, lists nothing even while
`loanInstallments` still has future rows on the loan's ORIGINAL schedule.
Zero-payment rows are skipped too; the filter lives in
`src/screens/holding-detail/holding-detail-spec/holding-detail-spec.ts`.

A loan correction (the "Update outstanding" `PricePointForm` write
above) accepts **0**, unlike every other holding type's "Update
value" (`> 0`): a 0 point means repaid. `loanOutstandingMinorAt`
already clamps every read at 0, and a 0 write never deletes the
holding's earlier points — net worth reads 0 from that day forward
while an earlier day still reads its own, earlier correction.

**Loan EDIT reconciliation** — `holdingsRepo.updateLoan` writes the
metadata patch and a `LoanPricePointOp` in ONE transaction
(`buildLoanPricePointOp`,
`src/screens/forms/holding-form/loan/use-loan-fields/`, called from that
hook's own `saveEdit`), reconciling the loan's manual `holding:<id>`
series against what the metadata edit just changed:

- (a) a schedule change INTO `'none'` (from `'annuity'`/
  `'differentiated'`) preserves the OLD schedule's current outstanding
  as a manual point, so the debt never silently reads as 0 the instant
  the schedule is cleared — the outstanding every screen showed before
  the edit (`loanLedgerOutstandingMinorAt`: the linked payments' when
  any count, else the schedule's), so the value does not jump. Normally that point is dated TODAY. But
  `loanOutstandingMinorAt` reads 0 for any instant before the loan's
  own `startDate` (a future-start loan) — dating it today would then
  write a PERMANENT 0 that outlives the start date once it arrives.
  When today is still before the start day, the op instead writes the
  new metadata's own PRINCIPAL at the start day, mirroring the
  create-mode `'none'` first point.
- (b) a `'none'` loan's principal/start-date edit MOVES its start-day
  point — deletes the point at the OLD start day and writes the new
  principal at the NEW start day. Any later correction point stays
  untouched (an edge case: if the new start day lands on or after an
  existing correction's day, that correction is overwritten or
  shadowed — rare, and the ruling is written this way deliberately).
- (c) a `'none'` loan moving OUT to a schedule DELETES the point at its
  OLD start day (`{ kind: 'delete', day }`) — the first point its create
  wrote, holding the OLD principal. Left in place, `loanAnchorAt` reads
  it as a correction and the schedule counts down from the old principal
  (100,000 informal -> annuity 120,000 read 63,138.55 instead of
  83,138.55). Moving it to the new start day is NOT equivalent: a
  correction anchor (`fromCorrection: true`) skips the ledger's
  "schedule before the first link" anchor. Any later correction stays —
  it is still valid for a scheduled loan.
- (d) every other transition leaves the manual series untouched.

A fresh holding (`oldMeta === null`) has nothing to reconcile.

`termMonths` is capped at `MAX_TERM_MONTHS` (`src/holdings/term-limits/`,
600 months / 50 years — comfortably above any real mortgage/car-loan
term): an uncapped value would make `loanInstallments` build an
unbounded row count for a degenerate but technically-valid positive
integer. A term deposit's own `termMonths` is capped at the SAME
shared constant, for the identical reason on its compounding math;
there is no separate deposit-specific cap.

Both terms are ENTERED in months or years and STORED as `termMonths`:
the deposit and loan forms share one `TermField`
(`src/screens/forms/term-field/`) — a number field whose suffix follows
a Months/Years `ChipRow` (a unit choice that leaves the form the same,
like the metal Unit chips). `src/screens/forms/term-reasons/` is the ONE term
check both twins call: `termReasonKey(value, unit)` (a whole number
above 0, at most `termMaxFor(unit)` — 600 months or 50 years, each
with its own error key naming the unit), `termMonthsFromInput` (years
x 12) for the payload, and `termInputFromMonths` for the edit seed (a
whole number of years seeds Years, anything else Months). Switching the
unit keeps the typed number and revalidates it in the new unit.

### Loan-payment link column + repo

Migration 0038 adds three columns to `transactions`: `loanHoldingId`
(text, nullable — the linked loan holding), `loanLinkSource` (text enum
`'auto' | 'manual'`, nullable), and `loanLinkRejected` (integer boolean,
NOT NULL default `false`). The two link columns are kept in lockstep — never a
`loanLinkSource` with no `loanHoldingId` or vice versa.

**Two separate write paths, not one**: only a
MANUAL action may ever move `loanLinkRejected`.

- `transactionsRepo.setLoanPayment({ transactionId, loanHoldingId })` is the
  MANUAL path (the user's own picker). A manual LINK
  (`loanHoldingId` non-null) clears `loanLinkRejected`, un-rejecting a row
  the user had previously undone — a fresh manual pick always overrides an
  earlier Undo. A manual **"None"** (`loanHoldingId: null`) **SETS**
  `loanLinkRejected` — the user's explicit "not a loan payment"
  has to stick, or the very next sync would just auto-link the row again.
  A manual None clearing the flag instead would make "None" not stick.
  `loanHoldingId: null` also nulls `loanLinkSource`, keeping the two
  columns in lockstep. No `source`-column gate — exactly like `setCategory`,
  the link is user state, not a mutation of bank-owned ledger data, so it
  is allowed on a synced (`monobank`/`binance`/`import`) row too.
- `transactionsRepo.setAutoLoanLinks(links: { transactionId, loanHoldingId }[])`
  is the matcher's path: writes every link in ONE `db.transaction()` call, NEVER touches
  `loanLinkRejected`, and its own WHERE clause skips any row that is
  already linked (`loanHoldingId` non-null) or already rejected — so a
  stale candidate read, or a race with the user's own Undo/manual link,
  can never silently overwrite either.
- `transactionsRepo.undoAutoLoanLink(transactionId)` is the Undo
  affordance: clears both link columns and sets `loanLinkRejected`, scoped
  to `loanLinkSource = 'auto'` — calling it on a manual link is a no-op,
  not a rejection.

`transactionsRepo.addManyDedup`'s upsert (the shared `(source, external_id)`
conflict path both the Monobank sync and statement import share) never
refreshes any of the three loan-link columns on a re-sync — its
`onConflictDoUpdate` `set` names only the bank-owned columns, the same
exclusion `category`/`comment` already rely on (see that function's own
existing doc comment). Its `setWhere` is derived from that SAME `set`
column list (`BANK_OWNED_TRANSACTION_COLUMNS`), so the UPDATE — and the
`transactions` reactive-query fire it would otherwise trigger — is skipped
entirely when a re-fetched row is unchanged; the loan-link columns are
excluded from that comparison too, since they are never in `set` either.
A settled-amount re-fetch of an already-linked payment
therefore keeps its link untouched. Its underlying insert
(`upsertDedupRowsDatabaseTransaction`) is chunked through `chunkForTable` (below) — a whole
statement-import file or Monobank sync above a few thousand rows failed
`SQLITE_MAX_VARIABLE_NUMBER` before this.

`clearLoanLinksForHoldingsDatabaseTransaction(databaseTransaction, holdingIds)`
(a module export of `src/holdings/repo/holdings.repo.ts`, not private to the
holding delete) clears `loanHoldingId`/`loanLinkSource` on every OTHER
holding's transaction that still points at one of `holdingIds`, in the SAME
`write()` transaction as the delete itself (`UPDATE transactions SET
loan_holding_id = NULL, loan_link_source = NULL WHERE loan_holding_id IN
(...)`) — a no-op for every non-loan holding, since nothing ever points a
`loanHoldingId` at one. Both delete paths call it: `removeHoldingDatabaseTransaction` (one holding,
reached through `transactionsRepo.removeHolding`) AND `accountsRepo.remove` (every holding a deleted DEBT
account owned, since a loan lives on a manual `debt` account) — a loan
deleted either way never leaves a dangling link behind. A dangling link is
never left to rot: once cleared, the payment counts as normal spending
again, exactly like an unlinked transaction always has. `loanLinkRejected`
is deliberately left untouched by this cascade — it is not part of "the
link".

`restoreDataSnapshot` inserts every `transactions` row verbatim with no
per-row column handling for these three columns (unlike
`holdings.balanceSetAt`'s and `transactions.setsBalance`'s dedicated
legacy backfills), so a `.kiko` exported
before this migration — whose transaction rows carry no
`loanHoldingId`/`loanLinkSource`/`loanLinkRejected` keys at all — restores
unchanged and SQLite defaults the missing columns itself (null / null /
false), the same way `counterIban`/`changeGroupId` already do for an older
export. Chunking every insert by a fixed row count breaks once a
table's own column count grows: three new columns took `transactions`
from 15 to 18 columns, so
the OLD fixed 2000-rows-per-chunk constant bound 2000 x 18 = 36000
parameters — over SQLite's 32766-bound-parameter ceiling — and a `.kiko`
backup with >= 1821 transactions failed to restore. `chunkForTable`
(`src/db/chunk-for-table.ts`, shared with `upsertDedupRowsDatabaseTransaction` above) derives
the row count per chunk from the TARGET table's own column count
(`getTableColumns`, floor-divided into a safety margin under the ceiling)
instead of a fixed row constant, so a future column added to any of these
tables can never silently repeat this — the widest table just gets a
smaller chunk automatically.

### The automatic loan-payment matcher

`matchLoanPayments` (`src/loans/payment-matcher/`) is a pure, idempotent
function: `{ transactions, loans, now } -> { transactionId, loanHoldingId,
dueDate }[]`. `loans` takes plain holding rows (`Pick<HoldingRow, 'id' |
'currency' | 'metadata'>`) and parses `LoanMeta` internally, mirroring
`loan-payments.ts`'s own `LoanHolding` convention. A link is proposed only
when ALL of these hold, checked over the FULL candidate matrix (never a
sequential filter, so an ambiguity check never depends on which one runs
first):

1. **Amount**: within the LARGER of ±1% or ±1.00 (the loan's own currency)
   of the scheduled installment's own payment (`withinInstallmentTolerance`,
   `src/holdings/loan-schedule/`). The ledger books the part above the
   scheduled payment as a fee, not principal; the cap is decided by amount
   alone, for an auto or a manual link.
2. **Date**: the transaction's local day is 3 days before to 7 days after
   the installment's own `dueDate` — both bounds inclusive.
3. **A third signal**, at least one of: the transaction's `holdingId`
   equals the loan's own `paymentHoldingId`; its `counterIban` equals the
   loan's own `lenderIban` (both compared through `normalizeIban` — strips
   whitespace, uppercases, so a cosmetic difference between a typed IBAN and
   a bank feed's own `counterIban` never false-negatives); or its
   `description` contains (case-insensitive) one of a fixed keyword list
   (`кредит`, `погашення`, `іпотек`, `позик`, `loan`, `mortgage`,
   `repayment`) or the loan's own `lenderName` (only when
   `lenderName.trim().length >= 3` — shorter is too likely to appear inside
   an unrelated description by coincidence). Amount + date ALONE never links
   (a same-size monthly rent must not false-positive).
4. **Uniqueness**: exactly one candidate transaction per installment, and
   that transaction matches exactly one installment of one loan — two
   candidates for one installment, or one transaction matching two
   installments (same loan or different), links neither.

The candidate transaction itself must be a debit, not already linked
(`loanHoldingId` null), not previously rejected (`loanLinkRejected`
false), and not one leg of an Exchange/Convert (the structural
`exchangeCounterpartHoldingId` marker) — `transactionsRepo.
loanMatchCandidatesQuery({ minTime, currencies })` pre-filters all four in
SQL (P-NOWORK: never read a row the matcher can never link) plus bounds the
scan to `time >= minTime` and `currencies` (the caller derives `minTime`
as the earliest open loan's own `startDate` minus the match window's
own 3-day before-margin, and `currencies` as the open loans' own distinct
currencies — never a whole-table scan), and the pure function also
re-checks the four eligibility conditions itself, so it stays correct when
unit-tested directly. An informal (`'none'`-schedule) loan is never
matched: `loanInstallments` already returns `[]` for it, so it contributes
no candidate installment at all — no separate schedule check is needed.
A zero-payment row is never a matcher candidate
(`src/loans/payment-matcher/payment-matcher.ts`), because the matcher's 1.00
tolerance floor would otherwise match a debit of up to 1.00.
`now` bounds installments to `dueDate <= now + 3 days` (the window's own
before-margin) — a cheap UPPER bound only, never a lower one, so a freshly
created/edited loan backfills its WHOLE past history the first time this
runs.

**An installment already taken by a linked row never accepts a second
one.** `matchLoanPayments` takes an optional `linkedPayments` — every row
ALREADY linked (manual or auto alike) to one of `loans`, read separately
through `transactionsRepo.loanLinkedPaymentsQuery(loanHoldingIds)` — because
`loanMatchCandidatesQuery` itself EXCLUDES an already-linked row from its
own candidate read, so without this second list the installment that row
already paid would look unpaid again on the very next run, and a LATER
same-amount transaction (a same-size monthly rent, say, arriving with its
own valid third signal) could take its place — silently double-counting one
installment across two real payments. An installment counts as taken the
moment ANY `linkedPayments` row for that SAME loan still passes rules 1
(amount) and 2 (date) against it — the third signal is deliberately not
re-checked (the link already proved it once, and `linkedPayments` carries
no description/holdingId/counterIban to re-check it with anyway) — and a
taken installment is removed from consideration entirely before the
candidate matrix is built, so neither the real linked row (already excluded
from candidates) nor any other transaction can claim it. `linkedPayments`
defaults to none, so an existing caller/test that has no such list yet
keeps its prior behavior unchanged.

**A loan edit that changes what the matcher would now require clears that
loan's own AUTO links first.** `holdingsRepo.updateLoan`'s optional 4th
param `clearAutoLinks` (default `false`) clears ONLY this loan's
`loanLinkSource = 'auto'` rows (never a manual link, never a rejected row)
in the SAME transaction as the metadata patch. The loan form's own
`saveEdit` (`use-loan-fields.ts`, `loanEditInvalidatesAutoLinks`) passes
`true` when EITHER the amortization schedule itself changed — compared as
`loanInstallments(oldMeta)` vs `loanInstallments(newMeta)` (`dueDate` +
`paymentMinorUnits`, so a `principalMinorUnits`, `schedule`,
`annualRatePct`, `termMonths`, OR `startDate` edit is all caught the same
way, with no per-field list to drift out of sync with `loanInstallments`'s
own math) — OR one of rule 3's own "paid from"/lender signals changed
(`paymentHoldingId`, `lenderIban` compared normalized, `lenderName`): any of
these changes what `loanInstallments` or rule 3 would derive going forward,
so a stale AUTO link proved against the OLD terms would otherwise count as
"taken" (above) forever, even once it no longer corresponds to any real
installment of the new ones. A `'none'`-schedule loan has no installments at
all regardless of principal, so it never receives an AUTO link to begin
with — an edit to one never clears anything. Clearing it here, before the
fire-and-forget matcher re-run that follows every loan edit, lets that
re-run recompute cleanly.

`src/loans/use-loan-auto-link/` (`runLoanAutoLink`, a plain async
function, not a hook — so a non-component caller, e.g.
`import-statement.ts`, can call it directly): reads
`holdingsRepo.loanHoldingsQuery()` (every OPEN loan) FIRST and returns
before ever touching the transaction table when it is empty, or when every
loan holding's own metadata fails to parse (P-NOWORK — there is then no
installment, currency, or start date to bound the read with either);
otherwise reads `transactionsRepo.loanMatchCandidatesQuery` (bounded, above)
and `transactionsRepo.loanLinkedPaymentsQuery` (the taken-installment input,
above) together, runs `matchLoanPayments`, and writes any result through
`transactionsRepo.setAutoLoanLinks`. Never rejects — every failure is
caught and logged, the same "log instead of drop" contract
`refresh-market-data.ts` established for its own background refreshes, so
a failed auto-link never turns a successful sync/import/save into a shown
error. Called after: every sync completion path (`useSync`, `useSyncAll`,
`useAutoSync` — the same three sync surfaces (`useSyncAll`/`useAutoSync` reach
`refreshMarketData` through `settleJobsBesideMarketRefresh`; `grep -rn "refreshMarketData(" src` lists the direct callers)); `importParsedStatement` (ONE
insertion point covers both its callers — the dedicated `importStatement`
and the column-mapping screen's direct call); a `.kiko` backup restore
(`data-transfer/import-data.ts`, fire-and-forget, right after the same
gated market-data refresh a restore already triggers — a bulk restore
bypasses every OTHER call site above); and a loan CREATE or EDIT in
`holding-form.screen.tsx` (`runLoanAutoLinkIfLoan`, gated on `type ===
'loan'`, fire-and-forget on both paths — unlike `refreshMarketData`, which
never fires on an edit at all, a loan's principal/schedule/
paymentHoldingId/lenderName/lenderIban all stay editable, so an edit needs
a fresh run too).

`transactionsRepo.setAutoLoanLinks` additionally re-checks that each
link's target loan holding still exists, INSIDE its own write
transaction, before writing it — the matcher computes its candidates from
a snapshot read moments earlier, so a loan holding can be deleted in the
gap between that read and this write; a link whose loan fails that check
is simply skipped (no error), closing the one race
`clearLoanLinksForHoldingsDatabaseTransaction` cannot: that cascade only
clears a link that ALREADY exists at delete time, not one this call has
not written yet.

`paymentHoldingId`/`lenderName`/`lenderIban` are entered in the loan
form's own `LoanSection` (`PaymentHoldingField`'s "Paid from" picker plus
two plain text fields), hidden alongside rate/term for a `'none'`
schedule — the matcher never links against an informal debt at all, so
they would do nothing there. None are required. `PaymentHoldingField`
(`src/screens/forms/payment-holding-field/`) is the clearable
single-select holding-picker chrome `LoanPaymentField` (the transaction
form's own loan-payment field) also composes, for its own auto-link
caption + Undo on top.

`buildPaymentHoldingOptions` (`holding-form.screen.tsx`) unions the loan's
own CURRENTLY selected `paymentHoldingId` back into the "Paid from"
picker's options even once that holding has since closed or moved
currency — the same "a filter never hides an active selection" rule
`buildLoanOptions` (below) already follows on the transaction form's own
loan-payment field, or the picker would resolve no match for a link that
still exists in the metadata and silently show "None". `isLoanFieldVisible`
(`src/screens/forms/transaction-form/mode-and-actions/mode-and-actions.ts`) shows that field whenever the row already
carries `selectedLoanHoldingId`, regardless of the row's own amount
sign — a linked row later edited from debit to credit must still reach the
field where None/Undo live.

**The loan holding-detail screen's own "Linked Payments" section is the
only way to review an auto link** (a loan is ledgerless, so it carries no
ledger of its own transactions worth reviewing there instead): every
transaction linked (manual or auto) to that loan, newest first, via
`transactionsRepo.listLinkedToLoanQuery(loanHoldingId)` — one live query,
disabled outright for a non-loan holding. It reuses the same
`LedgerRowItem` (and its own loan-link marker) the main ledger FlatList
renders, as a plain `.map` rather than a second virtualized list (one
loan's own linked payments is always small); tapping a row opens the
transaction form, where None/Undo live. The section renders nothing at all
once there are none — no placeholder heading over an empty list.

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
