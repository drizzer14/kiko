// drizzle/migrations/0044-move-crypto-cash-holdings.test.ts
//
// Runs the ACTUAL shipped SQL (not a restated predicate) against a real,
// in-process SQLite engine (`node:sqlite`), through the REAL schema up to
// migration 0043 (`applyMigrationsThrough` — the same full accounts/
// holdings/transactions/price_points/category_overrides tables op-sqlite
// would run this against), not a hand-rolled subset — the strongest
// available evidence for a migration that reassigns real rows by id.
import { id } from '@kiko/db';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { cryptoCurrencyOptions } from '@kiko/currency/currency';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const migrationStatements = readFileSync(
  join(__dirname, '0044_move_crypto_cash_holdings.sql'),
  'utf8',
)
  .split(STATEMENT_BREAKPOINT)
  .map((statement) => statement.trim())
  .filter((statement) => statement !== '');

type AccountSeed = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
  sortOrder?: number;
  archivedAt?: number | null;
  createdAt?: number;
};

type HoldingSeed = {
  id: string;
  accountId: string;
  name: string;
  type: string;
  currency: string;
  balanceMinorUnits?: number;
  balanceSetAt?: number | null;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number;
  closedAt?: number | null;
  createdAt?: number;
};

type TransactionSeed = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description?: string;
  exchangeCounterpartHoldingId?: string | null;
  loanHoldingId?: string | null;
  source?: string;
};

const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0043_add_import_times_rezoned');
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
};

const runMigration = (database: DatabaseSync): void => {
  for (const statement of migrationStatements) {
    database.exec(statement);
  }
};

const insertAccount = (database: DatabaseSync, account: AccountSeed): void => {
  database
    .prepare(
      `INSERT INTO accounts (id, name, kind, institution, sort_order, archived_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      account.id,
      account.name,
      account.kind,
      account.institution ?? null,
      account.sortOrder ?? 0,
      account.archivedAt ?? null,
      account.createdAt ?? 1_700_000_000_000,
    );
};

const insertHolding = (database: DatabaseSync, holding: HoldingSeed): void => {
  database
    .prepare(
      `INSERT INTO holdings
        (id, account_id, name, type, currency, balance_minor_units, balance_set_at,
         icon, color, sort_order, closed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      holding.id,
      holding.accountId,
      holding.name,
      holding.type,
      holding.currency,
      holding.balanceMinorUnits ?? 0,
      holding.balanceSetAt ?? null,
      holding.icon ?? null,
      holding.color ?? null,
      holding.sortOrder ?? 0,
      holding.closedAt ?? null,
      holding.createdAt ?? 1_700_000_000_000,
    );
};

const insertTransaction = (database: DatabaseSync, transaction: TransactionSeed): void => {
  database
    .prepare(
      `INSERT INTO transactions
        (id, holding_id, amount_minor_units, time, description,
         exchange_counterpart_holding_id, loan_holding_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      transaction.id,
      transaction.holdingId,
      transaction.amountMinorUnits,
      transaction.time,
      transaction.description ?? '',
      transaction.exchangeCounterpartHoldingId ?? null,
      transaction.loanHoldingId ?? null,
      transaction.source ?? 'manual',
    );
};

const insertPricePoint = (
  database: DatabaseSync,
  pricePoint: { instrument: string; day: number; price: string; currency: string },
): void => {
  database
    .prepare(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES (?, ?, ?, ?, 'manual')`,
    )
    .run(pricePoint.instrument, pricePoint.day, pricePoint.price, pricePoint.currency);
};

const insertCategoryOverride = (
  database: DatabaseSync,
  override: { normalizedName: string; category: string; displayName: string },
): void => {
  database
    .prepare(
      `INSERT INTO category_overrides (normalized_name, category, display_name)
       VALUES (?, ?, ?)`,
    )
    .run(override.normalizedName, override.category, override.displayName);
};

const dumpTable = (database: DatabaseSync, table: string, orderBy: string): unknown[] =>
  database.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();

const foreignKeyCheck = (database: DatabaseSync): unknown[] =>
  database.prepare('PRAGMA foreign_key_check;').all();

const tempTableNames = (database: DatabaseSync): unknown[] =>
  database.prepare('SELECT name FROM sqlite_temp_master;').all();

/** Scenario A: one cash account holding a fiat, a USDT, and a BTC cash
 * holding, with 20 manual transactions on the USDT holding, an exchange pair
 * between the fiat and USDT legs, a loan-linked payment on the USDT
 * holding, a price point, and a category override — realistic enough that a
 * full byte-equal dump of every OTHER table proves nothing but the holding
 * and its new account moved. */
const seedScenarioA = (database: DatabaseSync): void => {
  insertAccount(database, { id: 'acc-wallet', name: 'Wallet', kind: 'cash', sortOrder: 3 });
  insertAccount(database, { id: 'acc-debt', name: 'Car loan', kind: 'debt' });
  insertHolding(database, {
    id: 'h-uah',
    accountId: 'acc-wallet',
    name: 'Cash',
    type: 'cash',
    currency: 'UAH',
  });
  insertHolding(database, {
    id: 'h-usdt',
    accountId: 'acc-wallet',
    name: 'Tether',
    type: 'cash',
    currency: 'USDT',
    balanceMinorUnits: 150_000_000,
    balanceSetAt: 1_700_000_100_000,
    icon: 'banknote',
    color: '#00FF00',
  });
  insertHolding(database, {
    id: 'h-btc',
    accountId: 'acc-wallet',
    name: 'Bitcoin',
    type: 'cash',
    currency: 'BTC',
  });
  insertHolding(database, {
    id: 'h-loan',
    accountId: 'acc-debt',
    name: 'Car loan',
    type: 'loan',
    currency: 'UAH',
  });

  for (let index = 0; index < 20; index += 1) {
    insertTransaction(database, {
      id: `tx-usdt-${index}`,
      holdingId: 'h-usdt',
      amountMinorUnits: -1000 - index,
      time: 1_700_000_000_000 + index * 1000,
      description: `USDT spend ${index}`,
    });
  }

  insertTransaction(database, {
    id: 'tx-exchange-uah-leg',
    holdingId: 'h-uah',
    amountMinorUnits: -500_000,
    time: 1_700_000_050_000,
    exchangeCounterpartHoldingId: 'h-usdt',
  });
  insertTransaction(database, {
    id: 'tx-exchange-usdt-leg',
    holdingId: 'h-usdt',
    amountMinorUnits: 18_000,
    time: 1_700_000_050_000,
    exchangeCounterpartHoldingId: 'h-uah',
  });
  insertTransaction(database, {
    id: 'tx-usdt-loan-payment',
    holdingId: 'h-usdt',
    amountMinorUnits: -20_000,
    time: 1_700_000_060_000,
    loanHoldingId: 'h-loan',
  });

  insertPricePoint(database, {
    instrument: 'holding:h-usdt',
    day: 1_700_000_000_000,
    price: '1',
    currency: 'USD',
  });
  insertCategoryOverride(database, {
    normalizedName: 'usdt spend 0',
    category: 'other',
    displayName: 'USDT spend 0',
  });
};

describe('migration 0044: moves a crypto cash holding into a crypto account', () => {
  describe('scenario A: no eligible crypto account exists', () => {
    it('creates crypto-from-<wallet id>, moves USDT and BTC onto it, and leaves everything else byte-equal', () => {
      const database = openTestDatabase();
      seedScenarioA(database);

      const transactionsBefore = dumpTable(database, 'transactions', 'id');
      const pricePointsBefore = dumpTable(database, 'price_points', 'instrument');
      const categoryOverridesBefore = dumpTable(database, 'category_overrides', 'normalized_name');
      const uahHoldingBefore = (
        dumpTable(database, 'holdings', 'id') as Record<string, unknown>[]
      ).find((holding) => holding.id === 'h-uah');

      runMigration(database);

      const accounts = dumpTable(database, 'accounts', 'id') as Record<string, unknown>[];
      const newAccount = accounts.find((account) => account.id === 'crypto-from-acc-wallet');
      expect(newAccount).toMatchObject({
        id: 'crypto-from-acc-wallet',
        name: 'Wallet',
        kind: 'crypto',
        institution: null,
        bank_id: null,
        sort_order: 3,
      });

      const holdings = dumpTable(database, 'holdings', 'id') as Record<string, unknown>[];
      const usdtHolding = holdings.find((holding) => holding.id === 'h-usdt');
      const btcHolding = holdings.find((holding) => holding.id === 'h-btc');
      const uahHolding = holdings.find((holding) => holding.id === 'h-uah');

      expect(usdtHolding).toMatchObject({
        account_id: 'crypto-from-acc-wallet',
        type: 'crypto_asset',
        currency: 'USDT',
        balance_minor_units: 150_000_000,
        balance_set_at: 1_700_000_100_000,
        icon: 'banknote',
        color: '#00FF00',
      });
      expect(btcHolding).toMatchObject({
        account_id: 'crypto-from-acc-wallet',
        type: 'crypto_asset',
      });
      expect(uahHolding).toEqual(uahHoldingBefore);

      expect(dumpTable(database, 'transactions', 'id')).toEqual(transactionsBefore);
      expect(dumpTable(database, 'price_points', 'instrument')).toEqual(pricePointsBefore);
      expect(dumpTable(database, 'category_overrides', 'normalized_name')).toEqual(
        categoryOverridesBefore,
      );
      expect(foreignKeyCheck(database)).toEqual([]);
    });
  });

  describe('scenario B: an eligible crypto account already exists', () => {
    it('reuses the first unsynced, non-archived crypto account and never picks Binance or an archived one', () => {
      const database = openTestDatabase();
      insertAccount(database, {
        id: 'acc-binance',
        name: 'Binance',
        kind: 'crypto',
        institution: 'binance',
        sortOrder: 0,
      });
      insertAccount(database, {
        id: 'acc-archived',
        name: 'Old wallet',
        kind: 'crypto',
        sortOrder: 1,
        archivedAt: 1_690_000_000_000,
      });
      insertAccount(database, { id: 'acc-cold', name: 'Cold', kind: 'crypto', sortOrder: 2 });
      insertAccount(database, { id: 'acc-wallet', name: 'Wallet', kind: 'cash', sortOrder: 3 });
      insertHolding(database, {
        id: 'h-usdt',
        accountId: 'acc-wallet',
        name: 'Tether',
        type: 'cash',
        currency: 'USDT',
      });
      insertHolding(database, {
        id: 'h-btc',
        accountId: 'acc-wallet',
        name: 'Bitcoin',
        type: 'cash',
        currency: 'BTC',
      });

      runMigration(database);

      const accounts = dumpTable(database, 'accounts', 'id') as Record<string, unknown>[];
      expect(accounts).toHaveLength(4);

      const holdings = dumpTable(database, 'holdings', 'id') as Record<string, unknown>[];
      expect(holdings.find((holding) => holding.id === 'h-usdt')).toMatchObject({
        account_id: 'acc-cold',
        type: 'crypto_asset',
      });
      expect(holdings.find((holding) => holding.id === 'h-btc')).toMatchObject({
        account_id: 'acc-cold',
        type: 'crypto_asset',
      });
    });
  });

  it('is idempotent: a second run changes nothing', () => {
    const database = openTestDatabase();
    seedScenarioA(database);

    runMigration(database);
    const accountsAfterFirstRun = dumpTable(database, 'accounts', 'id');
    const holdingsAfterFirstRun = dumpTable(database, 'holdings', 'id');
    const transactionsAfterFirstRun = dumpTable(database, 'transactions', 'id');

    runMigration(database);

    expect(dumpTable(database, 'accounts', 'id')).toEqual(accountsAfterFirstRun);
    expect(dumpTable(database, 'holdings', 'id')).toEqual(holdingsAfterFirstRun);
    expect(dumpTable(database, 'transactions', 'id')).toEqual(transactionsAfterFirstRun);
  });

  it('a crash before the UPDATE leaves the database exactly as it was, with no temp table left behind', () => {
    const database = openTestDatabase();
    seedScenarioA(database);

    const accountsBefore = dumpTable(database, 'accounts', 'id');
    const holdingsBefore = dumpTable(database, 'holdings', 'id');

    database.exec('BEGIN;');
    // The first three statements only: the two TEMP snapshots and the
    // additive account insert — simulating a crash before the holdings
    // UPDATE ever runs.
    for (const statement of migrationStatements.slice(0, 3)) {
      database.exec(statement);
    }
    database.exec('ROLLBACK;');

    expect(dumpTable(database, 'accounts', 'id')).toEqual(accountsBefore);
    expect(dumpTable(database, 'holdings', 'id')).toEqual(holdingsBefore);
    expect(tempTableNames(database)).toEqual([]);
  });

  it('pins the SQL migration currency list to the app-wide crypto set', () => {
    // Fails the day a crypto currency is added to `currency.ts`, forcing a
    // deliberate decision about this SQL's own hard-coded `IN (...)` list
    // rather than silently leaving a new crypto currency's cash holding
    // stranded.
    expect(['BTC', 'ETH', 'USDT']).toEqual(cryptoCurrencyOptions);
  });

  it('the deterministic crypto-from- id can never collide with a real account id', () => {
    // Every real account id comes from `id()` (`src/db/id.ts`), a v4 UUID:
    // its first block is 8 lowercase HEX digits (`0-9a-f` only). `r`, the
    // second character of "crypto-from-", is not a hex digit, so no v4 UUID
    // can ever start with "cr" — the deterministic id lives in a disjoint
    // namespace from every id `id()` can produce, on both the migration and
    // the restore-mirror path that share it.
    for (let index = 0; index < 1000; index += 1) {
      const generated = id();
      expect(generated).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(generated.startsWith('crypto-from-')).toBe(false);
    }
  });
});
