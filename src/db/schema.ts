import { sql } from 'drizzle-orm';
import { currencyOptions } from '@kiko/currency/currency';
import type { BondTerms } from '@kiko/bonds/nbu-register';
import type { TrendFilter } from '@kiko/statistics/trend-filter';
import type { SavedColumnMapping } from '@kiko/statement-import/column-mapping';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { type ReminderKind, type ReminderSchedule, reminderKinds } from '@kiko/reminders/schedule';

// The currency columns below are TS-enum-typed text columns (SQLite stores plain
// text; drizzle's `enum` is a compile-time constraint, no CHECK, so widening it
// needs no migration). Each derives its enum from `currencyOptions` in
// currency.ts so the persisted set can never drift from the app's supported
// currencies — the same single-source-of-truth rule the rate layer follows.

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', {
    enum: ['bank', 'cash', 'crypto', 'property', 'metals', 'debt'],
  }).notNull(),
  institution: text('institution'),
  // The bank this account REPRESENTS (`src/bank-sync/bank-catalog/`),
  // independent of `institution`
  // (which marks a LIVE sync connection). Set from the account-form's bank
  // picker at create time; import-only for 5 of the 6 catalog entries.
  // Deliberately NEVER read by `isSyncedAccount`/`isSyncedHolding`
  // (`src/holdings/deletable/`) or any registry lookup — those stay keyed
  // on `institution` alone, so tagging an account `bankId: 'privatbank'`
  // can never make it look connected. TS-only enum (no DB CHECK), matching
  // every other free-text catalog-id column in this table.
  bankId: text('bank_id'),
  icon: text('icon'),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
});

export type AccountRow = typeof accounts.$inferSelect;

export const holdings = sqliteTable('holdings', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  name: text('name').notNull(),
  type: text('type', {
    enum: [
      'card',
      'term_deposit',
      'bond',
      'cash',
      'crypto_asset',
      'jar',
      'property_item',
      'metal',
      'loan',
    ],
  }).notNull(),
  currency: text('currency', { enum: currencyOptions }).notNull(),
  icon: text('icon'),
  color: text('color'),
  balanceMinorUnits: integer('balance_minor_units').notNull().default(0),
  // The card balance THROUGH WHICH this Monobank card's statements were last
  // SUCCESSFULLY imported — the crash-safe marker the balance-diff skip compares
  // against, NOT `balanceMinorUnits`. `balanceMinorUnits` is the live display
  // balance, which `upsertHoldings` (src/monobank/sync.ts) overwrites from
  // /client-info at the START of every sync, BEFORE the per-card statement loop
  // runs. Comparing the skip against that display balance was a data-loss bug: a
  // run that committed a card's new balance up front and was then interrupted
  // (app background/kill) before importing that card's statements left display
  // balance == /client-info balance, so every later run skipped the card and its
  // transactions never imported (until the 24h full fetch). This marker advances
  // ONLY after a card's statements commit (see the per-card loop in
  // `runSyncInner`), so an interrupted run leaves it behind and the next run
  // re-imports the card. NULL for a never-synced-through holding: every
  // non-Monobank holding, and a Monobank card upgraded before this column
  // existed — its first post-upgrade sync fetches it once (NULL never matches a
  // balance, so the skip cannot fire), which also RECOVERS any card the old bug
  // had stranded, and then sets the marker.
  syncedBalanceMinorUnits: integer('synced_balance_minor_units'),
  // The instant (ms) this holding's balance was last SET, not moved — the
  // statement-import boundary. `transactionsRepo.importRows`'s own doc
  // comment (`transactions/repo/transactions.repo.ts`) is the ONE full
  // statement of exactly which writes set it.
  balanceSetAt: integer('balance_set_at'),
  metadata: text('metadata', { mode: 'json' }),
  sortOrder: integer('sort_order').notNull().default(0),
  closedAt: integer('closed_at'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
});

export type HoldingRow = typeof holdings.$inferSelect;

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    holdingId: text('holding_id')
      .notNull()
      .references(() => holdings.id),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    time: integer('time').notNull(),
    description: text('description').notNull().default(''),
    category: text('category'),
    mcc: integer('mcc'),
    // Monobank's `hold` flag: the item is a PENDING authorization whose final
    // settled amount can still change (a restaurant tip, a fuel pre-auth). The
    // row is imported anyway, so a pending charge shows in the ledger
    // immediately; `addManyDedup` (transactions/transactions.repo.ts) then
    // upserts on (source, external_id), so the settled re-fetch REFRESHES the
    // amount and clears this flag — without ever touching `category`, which may
    // hold the user's own override. Null on manual rows and on rows synced
    // before this column existed.
    hold: integer('hold', { mode: 'boolean' }),
    // The counterparty's IBAN on a synced Monobank transfer (null for manual
    // rows, for non-transfer merchants, and for rows synced before this column
    // existed). Lets the category chart tell an OWN-account transfer (counter
    // IBAN ∈ the user's own cards) from a genuine P2P payment — see
    // statistics/transfer-exclusion.ts.
    counterIban: text('counter_iban'),
    // Set on BOTH legs of an Exchange/Convert to the OTHER leg's holding id
    // (and on the single debit leg of an exchange into a term deposit, which
    // writes a metadata contribution rather than a credit row). This is the
    // DURABLE structural marker that an exchange leg is an internal money
    // movement, not spending — see statistics/exchange-exclusion.ts. It is a
    // column and not a reserved `category` value because the category picker
    // and the override sheet both rewrite `category`, so a marker there could
    // be destroyed by ordinary user action; and not a shared id in
    // `externalId` because `(source, external_id)` is unique and both legs are
    // `source: 'manual'`. Storing the counterpart's ID (not its name) also
    // lets the display layer resolve the CURRENT name at render time through
    // `t`, so no English sentence is ever persisted and a rename follows.
    // DOCUMENTED RESIDUAL: a Convert marks its EXISTING row only when that row
    // is manual — a bank-owned (monobank) row is never mutated by this app, so
    // a synced debit converted into another currency still counts as spending.
    exchangeCounterpartHoldingId: text('exchange_counterpart_holding_id'),
    // Split-change grouping: a shared id across ONE manual payment row and the
    // N return rows that distribute its change into OTHER holdings, all written
    // atomically in one `write(...)` by `recordManualWithReturns`
    // (transactions/repo/transactions.repo.ts). Nullable — a plain
    // manual/exchange/synced row carries null and is unaffected. The spending
    // pie NETS a payment's linked returns into its category so the category is
    // not overstated by the change (statistics/category-breakdown). A column,
    // not a reserved `category` value, for the same reason the exchange marker
    // is: the category picker rewrites `category` and would destroy it.
    changeGroupId: text('change_group_id'),
    // The loan holding this payment counts against — null for an ordinary
    // transaction. A loan holding writes no ledger rows of its own
    // (`isLedgerlessHoldingType`), so every payment lives on the LINKED
    // bank holding's own row instead, tied back here. Set by the auto-matcher
    // (`transactionsRepo.setAutoLoanLinks`) or by the user
    // (`transactionsRepo.setLoanPayment`). Allowed on a synced (bank-owned)
    // row, EXACTLY LIKE `category`'s own override path — the link is
    // user/matcher state, not bank data, so `addManyDedup`'s upsert never
    // refreshes it. Cleared (along with `loanLinkSource`) in the SAME
    // transaction a linked loan holding is deleted, whether directly
    // (`holdingsRepo.remove`) or via its owning account
    // (`accountsRepo.remove`) — a dangling id is never left to rot; a
    // cleared link counts as normal spending again.
    loanHoldingId: text('loan_holding_id'),
    // How `loanHoldingId` was set: 'auto' (the matcher) or 'manual' (the
    // user), null when there is no link — kept in sync with `loanHoldingId`
    // (both null together, never one without the other). Drives the "Linked
    // automatically" + Undo affordance vs a plain manual link.
    loanLinkSource: text('loan_link_source', { enum: ['auto', 'manual'] }),
    // True once the user has explicitly rejected an auto-suggested link on
    // this row (`transactionsRepo.undoAutoLoanLink`), so the matcher never
    // re-proposes it — false-positive handling. Only a MANUAL action ever
    // moves this flag: a manual LINK clears it (a fresh pick always
    // overrides an earlier Undo), but a manual "None" SETS it — the user's
    // explicit "not a loan payment" must stick, or the very next sync would
    // just auto-link the row again. This deviates from the original design
    // note's literal text ("a manual None clears the flag"). `setAutoLoanLinks`
    // (the matcher's path) never touches this column either way; its own
    // WHERE clause just skips a rejected row.
    // NOT NULL default 0: every existing row (pre-migration and every
    // ordinary transaction) has never been rejected.
    loanLinkRejected: integer('loan_link_rejected', { mode: 'boolean' }).notNull().default(false),
    comment: text('comment'),
    // 'btc_wallet' / 'binance' double as `accounts.institution` values. The
    // BALANCE sync writes no transaction rows, but the Binance crypto sync now
    // imports BTC deposit/withdrawal history as `source: 'binance'` rows on the
    // Spot holding (see `crypto-sync/binance/binance.transactions.ts`);
    // 'btc_wallet' still writes none.
    // Guideline 5.6 remediation: 'privatbank', 'bunq', and 'starling' were
    // removed from this enum — those bank-CONNECT providers were deleted
    // entirely (src/bank-sync/provider/provider.ts), and no user release
    // ever shipped a transaction row with one of those sources, so no
    // migration was needed to narrow this TS-only enum (SQLite stores this
    // column as plain `text`, with no CHECK constraint).
    // 'import' (`docs/plans/statement-import.md`): a row parsed from a
    // user-picked statement file (Monobank CSV and later formats), fed
    // through the SAME `addManyDedup` upsert as every synced source. Shared
    // by every bank format in the registry — the FORMAT is recorded only via
    // `ParsedStatement.formatId`, not a per-bank source value. Like
    // 'monobank'/'binance', `isSyncedTransaction` refuses an individual-row
    // delete on it (`src/holdings/deletable/deletable.ts`), so a bad import
    // is undone by deleting its whole (always-plain) holding, not one row.
    source: text('source', {
      enum: ['manual', 'monobank', 'btc_wallet', 'binance', 'import'],
    }).notNull(),
    externalId: text('external_id'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    externalUnique: uniqueIndex('transactions_source_external').on(table.source, table.externalId),
    // Every `where(eq(transactions.holdingId, …))` (holding detail, per-card
    // sync cursor) hit a full table scan without this.
    holdingIdIndex: index('transactions_holding_id').on(table.holdingId),
    // Every `orderBy(desc(transactions.time))` (the ledger lists) did a full
    // sort without this.
    timeIndex: index('transactions_time').on(table.time),
  }),
);

export type TransactionRow = typeof transactions.$inferSelect;

export const currencyRates = sqliteTable(
  'currency_rates',
  {
    base: text('base', { enum: currencyOptions }).notNull(),
    quote: text('quote', { enum: currencyOptions }).notNull(),
    rate: text('rate').notNull(),
    source: text('source', { enum: ['monobank', 'coingecko', 'nbu'] }).notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (table) => ({
    pairUnique: uniqueIndex('currency_rates_pair').on(table.base, table.quote),
  }),
);

export type CurrencyRateRow = typeof currencyRates.$inferSelect;

export const currencyRateHistory = sqliteTable(
  'currency_rate_history',
  {
    base: text('base', { enum: currencyOptions }).notNull(),
    quote: text('quote', { enum: currencyOptions }).notNull(),
    /**
     * The rate's day, as a normalized UTC-midnight epoch value in
     * MILLISECONDS (00:00:00.000 UTC of that calendar day). Same millisecond
     * epoch convention as `transactions.time`; one row per (base, quote, day).
     */
    day: integer('day').notNull(),
    rate: text('rate').notNull(),
    source: text('source', { enum: ['monobank', 'coingecko', 'nbu'] }).notNull(),
  },
  (table) => ({
    pairDayUnique: uniqueIndex('currency_rate_history_pair_day').on(
      table.base,
      table.quote,
      table.day,
    ),
  }),
);

export type CurrencyRateHistoryRow = typeof currencyRateHistory.$inferSelect;

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  baseCurrency: text('base_currency', { enum: currencyOptions }).notNull().default('UAH'),
  // SUPERSEDED (retained): the global Monobank statement CURSOR. De-globalized
  // to the per-connection `syncState` table (2026-09-11 multi-account plan);
  // migration 0028 backfills the connected account's row from it. The sync no
  // longer writes it and no `settings` setter remains. Deliberately NOT dropped
  // (migrations here are additive-only — same class as `appearance` /
  // `lockGraceSeconds`). NOTE: `settings-columns.test.ts` cannot flag it as
  // reader-less because `syncState` reuses the identical `lastSyncAt` identifier
  // app-wide; its live semantics now live on `syncState.lastSyncAt`.
  lastSyncAt: integer('last_sync_at'),
  // The category a null/empty transaction category folds into (the single
  // catch-all), and the category deleted rows reassign to. Seeded to `'other'`
  // (the canonical seeded catch-all category — see the seed migration), and
  // user-configurable from the Categories screen. A `categories.key` slug.
  defaultCategoryKey: text('default_category_key').notNull().default('other'),
  // App lock (Face ID / passcode gate). Off by default; asked for only on a
  // fresh app open. Once unlocked the process never re-locks.
  lockEnabled: integer('lock_enabled', { mode: 'boolean' }).notNull().default(false),
  // LEGACY, zero readers. The abandoned background-grace design (migration 0011
  // created it); the shipped lock is cold-launch-only and never re-locks.
  // Deliberately not dropped — a destructive migration on a live single-user DB
  // buys nothing and the column is harmless. Pinned as the sole documented
  // exception in `src/db/settings-columns.test.ts`; re-wiring it means removing
  // it there first. Accepted risk: docs/security/README.md.
  lockGraceSeconds: integer('lock_grace_seconds').notNull().default(30),
  // The chosen UI language. NULL means "follow the device language" (the real,
  // distinct unset state — unlike baseCurrency, which always has a value); 'en'
  // / 'uk' is an explicit user choice made from Settings. Read by
  // useSyncLanguageWithSettings; written by settingsRepo.setLanguage.
  language: text('language', { enum: ['en', 'uk'] }),
  // DEAD (retained): the removed light/dark color-scheme feature. The app is now
  // dark-only, so nothing reads or writes this column. Deliberately NOT dropped —
  // migrations here are additive-only, so a removed feature's harmless retained
  // column stays rather than adding a destructive drop migration (same class as
  // `lockGraceSeconds` above). Enforced reader-less by settings-columns.test.ts.
  appearance: text('appearance', { enum: ['system', 'light', 'dark'] })
    .notNull()
    .default('system'),
  // SUPERSEDED (retained): the global DISPLAY "last synced" timestamp. Moved to
  // per-connection `syncState.lastSyncDisplayAt` (2026-09-11 multi-account plan);
  // migration 0028 backfills it. The sync no longer writes it and account-detail
  // now reads `syncState`. Retained (additive-only migrations). The description
  // below still documents the live semantics, which now hold on `syncState`.
  // The DISPLAY "last synced" timestamp (epoch ms), updated on EVERY sync run
  // that reached Monobank with at least one card succeeding — including a
  // PARTIAL failure, where some cards imported but one threw. Decoupled from
  // `lastSyncAt`, which stays the pure Monobank statement CURSOR (advanced only
  // on a fully clean run). A partial failure must not advance the cursor — the
  // failed card's window has to be re-covered — yet the user should still see
  // that a sync just landed, so the display stamp moves independently. This is
  // NOT falsely current: the crash-safe marker (`syncedBalanceMinorUnits`) makes
  // a still-pending card re-fetch next run rather than being silently skipped.
  // NULLABLE: rows that existed before this column read null, and the display
  // falls back to `lastSyncAt`.
  lastSyncDisplayAt: integer('last_sync_display_at'),
  // SUPERSEDED (retained): the global last-FULL-fetch marker. Moved to
  // per-connection `syncState.lastFullSyncAt` (2026-09-11 multi-account plan);
  // migration 0028 backfills it. The sync no longer writes it. Retained
  // (additive-only migrations). The description below documents the live
  // semantics, which now hold on `syncState`.
  // The epoch-ms timestamp of the last FULL statement fetch (every card
  // fetched regardless of balance) — OR, on a first-ever full fetch that
  // FAILED, that attempt's own from-cursor instead (`resolveFullSyncAtToPersist`
  // in `monobank/sync/sync.ts`), so a delayed retry still derives the same
  // window rather than sliding forward with the clock. The steady-state sync
  // SKIPS a card whose /client-info balance is unchanged since the last sync
  // (a "balance-diff skip") to stay under Monobank's 1-req/60s-per-token
  // limit; this timestamp drives the periodic safety net that forces an
  // all-cards fetch, bounding the worst-case miss window for a net-zero
  // same-window transaction pair (a +X and a -X in one sync window that leave
  // the balance untouched, which the balance-diff skip would otherwise never
  // catch). It is ALSO the from-cursor of that forced full fetch: the sync
  // re-queries [lastFullSyncAt, now] so every window skipped since the last
  // full fetch is actually re-covered — using the recent incremental cursor
  // instead would re-query only the already-covered recent window and
  // recover nothing. NULL ⇒ never done (or even attempted) a full fetch,
  // which forces one.
  lastFullSyncAt: integer('last_full_sync_at'),
  // DEAD (retained): the previous spending-trend selection — a JSON array of
  // stable `categories.key` slugs. Superseded by `trendFilter` below, into which
  // migration 0025 copies any non-null value as `{ mode: 'manual', keys }`.
  // Nothing in `src/` reads or writes it any more; deliberately NOT dropped
  // (migrations here are additive-only — same class as `appearance` /
  // `lockGraceSeconds`). Enforced reader-less by settings-columns.test.ts.
  trendCategoryKeys: text('trend_category_keys', { mode: 'json' }).$type<string[]>(),
  // The user's SAVED spending-trend filter (see `TrendFilter`). A discriminated
  // union stored as JSON: `{ mode: 'manual', keys }` pins explicit categories
  // (empty = every category); `{ mode: 'top', amount, by }` re-selects the top N
  // by the chosen measure from live data on each render. NULL means "no saved
  // filter" — the chart falls back to `DEFAULT_TREND_FILTER` (top 3 by
  // contribution). Written by settingsRepo.setTrendFilter (Save persists; there
  // is no clear-to-null path from the UI, but the setter accepts null).
  trendFilter: text('trend_filter', { mode: 'json' }).$type<TrendFilter>(),
  // SUPERSEDED (retained): the global force-retry set. Moved to per-connection
  // `syncState.failedSyncMonobankIds` (2026-09-11 multi-account plan); migration
  // 0028 backfills it. The sync no longer writes it. Retained (additive-only
  // migrations). The description below documents the live semantics, which now
  // hold on `syncState`.
  // The Monobank account ids whose statement fetch FAILED on the last sync run.
  // The next run force-fetches only these (regardless of balance) so one flaky
  // card does not strand the whole account in daily full-fetch mode: without
  // this, a partial failure never graduates `lastFullSyncAt`, so once it ages
  // past the full-fetch interval EVERY sync becomes a slow N×60s full fetch and
  // the balance-diff skip never engages again. Pruned to ids still present in
  // client-info. NULL means the empty set (no card is currently force-retried).
  failedSyncMonobankIds: text('failed_sync_monobank_ids', { mode: 'json' }).$type<string[]>(),
  // The user's saved column-mapping imports
  // (`statement-import/column-mapping/saved-mapping.ts`): a map from
  // `mappingKeyFor(bankId, fingerprint)` (`bank:<bankId>` for a catalog bank,
  // else `header:<fingerprint>` for "Other") to the `SavedColumnMapping` last
  // confirmed for that key. NULL means nothing saved yet. Written (read-
  // modify-write) by `settingsRepo.saveStatementMapping`; looked up by
  // `findSavedMapping` to PRE-FILL the mapping form on a later import — the
  // user still taps Import, a saved mapping never applies itself silently.
  statementMappings: text('statement_mappings', { mode: 'json' }).$type<
    Record<string, SavedColumnMapping>
  >(),
  // One-shot flag: has this device already rewritten its stored statement-
  // import dedup keys from the pre-`␟`-separator format to the injective one
  // (`statement-import/mapping/upgrade-dedup-key.ts`'s `upgradeLegacyDedupKey`)?
  // Migration 0041 adds this column defaulting to `false` (unrun);
  // `MigrationsGate` flips it to `true` after the one-time rewrite, the same
  // shape every other one-shot migration-adjacent flag in this table uses.
  // `restoreDataSnapshot` treats an entirely absent key (a pre-0041 `.kiko`
  // export) as `false` too — see `restore-snapshot.ts`.
  dedupKeysUpgraded: integer('dedup_keys_upgraded', { mode: 'boolean' }).notNull().default(false),
  // The reminder offers the user dismissed, as a map from `accounts.id` to the
  // dismissed kinds, so a dismissed offer never comes back for that account.
  // NULL means nothing dismissed yet.
  reminderOfferDismissals: text('reminder_offer_dismissals', { mode: 'json' }).$type<
    Record<string, ReminderKind[]>
  >(),
});

export type SettingsRow = typeof settings.$inferSelect;

/**
 * Per-connection Monobank sync cursor. This DE-GLOBALIZES the former single-row
 * `settings` cursor (`last_sync_at`, `last_full_sync_at`, `last_sync_display_at`,
 * `failed_sync_monobank_ids`): those columns modelled ONE Monobank connection, so
 * a second connected Monobank account would have shared and corrupted the one
 * cursor. Each connected Monobank account now owns its own row here, keyed by its
 * `accounts.id`. The old `settings` columns are retained-but-dead — pinned as
 * reader-less in `src/db/settings-columns.test.ts`, same additive-only class
 * as `appearance` / `lockGraceSeconds`. Each column mirrors the
 * identically-named `settings` one; read the comments on those columns above
 * for the load-bearing semantics (balance-diff skip, robust
 * `lastFullSyncAt` graduation, the display stamp).
 */
export const syncState = sqliteTable('sync_state', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  lastSyncAt: integer('last_sync_at'),
  lastFullSyncAt: integer('last_full_sync_at'),
  lastSyncDisplayAt: integer('last_sync_display_at'),
  failedSyncMonobankIds: text('failed_sync_monobank_ids', { mode: 'json' }).$type<string[]>(),
});

export type SyncStateRow = typeof syncState.$inferSelect;

/**
 * Categories are keyed by a STABLE slug (`key`), so renaming a category or
 * changing its icon never rewrites the `category` value stored on transaction
 * rows. Transactions keep the stable key; the display layer resolves
 * key -> `{ title, icon }`. `title` and `icon` are user-editable; `icon` is an
 * SF Symbol name rendered by the `Symbol` primitive.
 */
export const categories = sqliteTable('categories', {
  key: text('key').primaryKey(),
  title: text('title').notNull(),
  icon: text('icon').notNull(),
  // Nullable per-category color (#RRGGBB, an `entityColors` token). Null means
  // "no color picked" — the display/chart layer falls back to the stable per-key
  // palette hash (see resolveCategoryColor in statistics/category-breakdown.ts),
  // mirroring accounts/holdings' nullable `color`.
  color: text('color'),
  // The user-controlled display order of the categories list (drag-and-drop /
  // move-to-top/bottom on the Categories screen). Mirrors accounts/holdings'
  // `sortOrder`; backfilled from `rowid` on upgrade (0013) so the existing
  // display order is preserved. A new category appends at `max + 1`.
  sortOrder: integer('sort_order').notNull().default(0),
});

export type CategoryRow = typeof categories.$inferSelect;

/**
 * A name→category override rule. Editing any transaction's category upserts a
 * rule keyed by the JS-normalized name (see normalizeTransactionName), which
 * (1) rewrites every existing same-name transaction and (2) is re-applied to
 * every future synced insert with that name. `category` is a categories.key
 * (slug); `displayName` is the last-seen human name, shown to the user.
 */
export const categoryOverrides = sqliteTable('category_overrides', {
  normalizedName: text('normalized_name').primaryKey(),
  category: text('category').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});

export type CategoryOverrideRow = typeof categoryOverrides.$inferSelect;

/**
 * One priced point for a share/metal/holding on a given day. Keyed the
 * same way `currencyRateHistory` keys a rate: one row per (instrument, day),
 * carried forward across a gap by the reader (`src/prices/price-book/`), not
 * backfilled here.
 */
export const pricePoints = sqliteTable(
  'price_points',
  {
    /**
     * The priced thing's key — `share:<symbol>`, `metal:<metal>`, or
     * `holding:<holdingId>` (see `src/prices/instrument/instrument.ts`).
     * Free-text, not an FK: it may point at a symbol/metal with no matching
     * row anywhere, or at a holding that has since been deleted.
     */
    instrument: text('instrument').notNull(),
    /**
     * The price's day, as a normalized UTC-midnight epoch value in
     * MILLISECONDS (00:00:00.000 UTC of that calendar day) — same convention
     * as `currencyRateHistory.day`. One row per (instrument, day).
     */
    day: integer('day').notNull(),
    price: text('price').notNull(),
    currency: text('currency', { enum: currencyOptions }).notNull(),
    source: text('source', { enum: ['manual', 'nbu', 'eodhd'] }).notNull(),
  },
  (table) => ({
    instrumentDayUnique: uniqueIndex('price_points_instrument_day').on(table.instrument, table.day),
  }),
);

export type PricePointRow = typeof pricePoints.$inferSelect;

/**
 * NBU securities-register cache — one row per bond ISIN,
 * refreshed WHOLESALE (never patched field-by-field) at most once per
 * local day by `refreshBondRegisterIfStale`
 * (`src/bonds/bond-register-repo/`). `terms` stores the register's
 * resolved `BondTerms` shape as JSON (`src/bonds/nbu-register/`) since the
 * ISIN-mode bond form reads the whole object at once; `fetchedAt` is the
 * one write-time stamp shared by every row in a given refresh, which is
 * what makes `bondRegisterRepo.fetchedAtQuery()`'s `MAX(fetched_at)` read
 * the same value any single row's own `fetchedAt` would.
 */
export const bondRegister = sqliteTable('bond_register', {
  isin: text('isin').primaryKey(),
  terms: text('terms', { mode: 'json' }).notNull().$type<BondTerms>(),
  fetchedAt: integer('fetched_at').notNull(),
});

export type BondRegisterRow = typeof bondRegister.$inferSelect;

/**
 * One user-configured local reminder per `(account, kind)`. `schedule` is the
 * whole `ReminderSchedule` as JSON, since the planner reads it at once.
 * `activeSince` is when the reminder last started counting: data older than it
 * never skips an occurrence. `lastEngagedAt` is the latest tap on one of its
 * notifications, which resets the ignored-fire count. `pausedAt` with
 * `pauseReason` is either a user pause or the automatic back-off pause.
 */
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    kind: text('kind', { enum: reminderKinds }).notNull(),
    schedule: text('schedule', { mode: 'json' }).$type<ReminderSchedule>().notNull(),
    pausedAt: integer('paused_at'),
    pauseReason: text('pause_reason', { enum: ['user', 'backoff'] }),
    activeSince: integer('active_since').notNull(),
    lastEngagedAt: integer('last_engaged_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    accountKind: uniqueIndex('reminders_account_kind').on(table.accountId, table.kind),
  }),
);

export type ReminderRow = typeof reminders.$inferSelect;
