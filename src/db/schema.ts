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
    comment: text('comment'),
    source: text('source', { enum: ['manual', 'monobank'] }).notNull(),
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
});

export type CategoryRow = typeof categories.$inferSelect;
