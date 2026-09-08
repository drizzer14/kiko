import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['bank', 'cash', 'crypto'] }).notNull(),
  institution: text('institution'),
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
    enum: ['card', 'term_deposit', 'bond', 'cash', 'crypto_asset', 'jar'],
  }).notNull(),
  currency: text('currency', { enum: ['BTC', 'USD', 'EUR', 'UAH'] }).notNull(),
  icon: text('icon'),
  color: text('color'),
  balanceMinorUnits: integer('balance_minor_units').notNull().default(0),
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
    // immediately; `addManyDedup` (repositories/transactions.repo.ts) then
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
    comment: text('comment'),
    // 'btc_wallet' / 'binance' are named for enum parity with
    // `accounts.institution`; a balance sync writes no transaction rows today.
    source: text('source', { enum: ['manual', 'monobank', 'btc_wallet', 'binance'] }).notNull(),
    externalId: text('external_id'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    externalUnique: uniqueIndex('transactions_source_external').on(table.source, table.externalId),
  }),
);

export type TransactionRow = typeof transactions.$inferSelect;

export const currencyRates = sqliteTable(
  'currency_rates',
  {
    base: text('base', { enum: ['BTC', 'USD', 'EUR', 'UAH'] }).notNull(),
    quote: text('quote', { enum: ['BTC', 'USD', 'EUR', 'UAH'] }).notNull(),
    rate: text('rate').notNull(),
    source: text('source', { enum: ['monobank', 'coingecko'] }).notNull(),
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
    base: text('base', { enum: ['BTC', 'USD', 'EUR', 'UAH'] }).notNull(),
    quote: text('quote', { enum: ['BTC', 'USD', 'EUR', 'UAH'] }).notNull(),
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
  baseCurrency: text('base_currency', { enum: ['BTC', 'USD', 'EUR', 'UAH'] })
    .notNull()
    .default('UAH'),
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
  // The chosen appearance: 'system' follows the OS via unistyles `initialTheme`
  // plus a manual `Appearance` change-listener (Option B — adaptiveThemes was
  // removed), 'light'/'dark' pin the theme. Defaults to 'system' so a fresh
  // install follows iOS. Read by useSyncAppearanceWithSettings; written by
  // settingsRepo.setAppearance.
  appearance: text('appearance', { enum: ['system', 'light', 'dark'] })
    .notNull()
    .default('system'),
  // The DISPLAY "last synced" timestamp (epoch ms), updated on EVERY sync run
  // that imported at least one transaction — including a PARTIAL failure, where
  // some cards imported but one threw. Decoupled from `lastSyncAt`, which stays
  // the pure Monobank statement CURSOR (advanced only on a fully clean run). A
  // partial failure must not advance the cursor — the failed card's window has
  // to be re-covered — yet the user should still see that a sync just landed
  // rows, so the display stamp moves independently. NULLABLE: rows that existed
  // before this column read null, and the display falls back to `lastSyncAt`.
  lastSyncDisplayAt: integer('last_sync_display_at'),
  // The user's SAVED spending-trend category selection: a JSON array of stable
  // `categories.key` slugs that overrides the default "top 3 by expense" seed on
  // the Statistics trend chart. NULL means "no saved selection" — the chart falls
  // back to the live top-3-by-expense preset. Written by settingsRepo
  // .setTrendCategoryKeys (Save persists the current set; Reset clears to null).
  trendCategoryKeys: text('trend_category_keys', { mode: 'json' }).$type<string[]>(),
});

export type SettingsRow = typeof settings.$inferSelect;

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
