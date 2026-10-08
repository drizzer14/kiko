// drizzle/migrations/0042-uah-star-rates.test.ts
//
// Runs the ACTUAL shipped SQL (not a restated predicate) against a real,
// in-process SQLite engine (`node:sqlite`, built into the Node 22 runtime
// this project already requires — see `package.json`'s `engines`), split on
// the same `--> statement-breakpoint` token `run-migrations.ts` uses. Mirrors
// `0040-cleanup-stray-deposit-bond-balance.test.ts`'s own pattern — a real
// SQLite engine, not a hand-traced predicate, since op-sqlite itself is a
// native module unavailable under Jest.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const migrationStatements = readFileSync(join(__dirname, '0042_uah_star_rates.sql'), 'utf8')
  .split(STATEMENT_BREAKPOINT)
  .map((statement) => statement.trim())
  .filter((statement) => statement !== '');

type RateRow = { base: string; quote: string; rate: string; source: string; fetched_at: number };
type HistoryRow = {
  base: string;
  quote: string;
  day: number;
  rate: string;
  source: string;
};

const openTestDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  database.exec(`
    CREATE TABLE currency_rates (
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      rate TEXT NOT NULL,
      source TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (base, quote)
    );
    CREATE TABLE currency_rate_history (
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      day INTEGER NOT NULL,
      rate TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (base, quote, day)
    );
  `);

  return database;
};

const insertRate = (database: DatabaseSync, row: RateRow): void => {
  database
    .prepare(
      'INSERT INTO currency_rates (base, quote, rate, source, fetched_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(row.base, row.quote, row.rate, row.source, row.fetched_at);
};

const insertHistoryRow = (database: DatabaseSync, row: HistoryRow): void => {
  database
    .prepare(
      'INSERT INTO currency_rate_history (base, quote, day, rate, source) VALUES (?, ?, ?, ?, ?)',
    )
    .run(row.base, row.quote, row.day, row.rate, row.source);
};

const runMigration = (database: DatabaseSync): void => {
  for (const statement of migrationStatements) {
    database.exec(statement);
  }
};

const allRates = (database: DatabaseSync): RateRow[] =>
  database
    .prepare('SELECT base, quote, rate, source, fetched_at FROM currency_rates ORDER BY base')
    .all() as unknown as RateRow[];

const allHistoryRows = (database: DatabaseSync): HistoryRow[] =>
  database
    .prepare('SELECT base, quote, day, rate, source FROM currency_rate_history ORDER BY base, day')
    .all() as unknown as HistoryRow[];

describe('0042_uah_star_rates.sql — currency_rates', () => {
  it('keeps only a star row per currency, dropping every cross/inverse row, rate text unchanged', () => {
    const database = openTestDatabase();
    // A full old-shape pair set for {UAH, USD, EUR, BTC}: every star row
    // already present, plus every cross/inverse row a live pre-star sync
    // would also have written.
    insertRate(database, {
      base: 'USD',
      quote: 'UAH',
      rate: '40',
      source: 'monobank',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'EUR',
      quote: 'UAH',
      rate: '43',
      source: 'monobank',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'BTC',
      quote: 'UAH',
      rate: '2600000',
      source: 'coingecko',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'UAH',
      quote: 'USD',
      rate: '0.025',
      source: 'monobank',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'USD',
      quote: 'EUR',
      rate: '0.93',
      source: 'monobank',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'BTC',
      quote: 'USD',
      rate: '65000',
      source: 'coingecko',
      fetched_at: 1,
    });

    runMigration(database);

    expect(allRates(database)).toEqual([
      { base: 'BTC', quote: 'UAH', rate: '2600000', source: 'coingecko', fetched_at: 1 },
      { base: 'EUR', quote: 'UAH', rate: '43', source: 'monobank', fetched_at: 1 },
      { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetched_at: 1 },
    ]);
  });

  it('derives a star row from an inverse UAH:X row when X has none of its own', () => {
    const database = openTestDatabase();
    // A legacy device that only ever cached the inverse direction for GBP.
    insertRate(database, {
      base: 'UAH',
      quote: 'GBP',
      rate: '0.02',
      source: 'monobank',
      fetched_at: 5,
    });

    runMigration(database);

    const rows = allRates(database);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.base).toBe('GBP');
    expect(rows[0]?.quote).toBe('UAH');
    expect(Number(rows[0]?.rate)).toBeCloseTo(1 / 0.02, 10);
  });

  it('derives a star row from a legacy cross pair (X:Y * Y:UAH) once the pivot resolves', () => {
    const database = openTestDatabase();
    insertRate(database, {
      base: 'USD',
      quote: 'UAH',
      rate: '40',
      source: 'monobank',
      fetched_at: 1,
    });
    // GBP was only ever cached against USD, never directly against UAH.
    insertRate(database, {
      base: 'GBP',
      quote: 'USD',
      rate: '1.3',
      source: 'monobank',
      fetched_at: 1,
    });

    runMigration(database);

    const rows = allRates(database);
    const gbp = rows.find((row) => row.base === 'GBP');
    expect(gbp).toBeDefined();
    expect(gbp?.quote).toBe('UAH');
    expect(Number(gbp?.rate)).toBeCloseTo(1.3 * 40, 10);
  });

  it('never overwrites an existing X:UAH row with a derived value', () => {
    const database = openTestDatabase();
    insertRate(database, {
      base: 'USD',
      quote: 'UAH',
      rate: '40',
      source: 'monobank',
      fetched_at: 1,
    });
    // A stale inverse row that would derive a DIFFERENT USD:UAH value if it
    // were allowed to overwrite the real one.
    insertRate(database, { base: 'UAH', quote: 'USD', rate: '0.02', source: 'nbu', fetched_at: 1 });

    runMigration(database);

    const rows = allRates(database);
    expect(rows).toEqual([
      { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetched_at: 1 },
    ]);
  });

  it('is idempotent: a second run changes nothing further', () => {
    const database = openTestDatabase();
    insertRate(database, {
      base: 'USD',
      quote: 'UAH',
      rate: '40',
      source: 'monobank',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'UAH',
      quote: 'EUR',
      rate: '0.023',
      source: 'nbu',
      fetched_at: 1,
    });

    runMigration(database);
    const afterFirstRun = allRates(database);

    runMigration(database);

    expect(allRates(database)).toEqual(afterFirstRun);
  });

  it('leaves a star-only table untouched', () => {
    const database = openTestDatabase();
    insertRate(database, {
      base: 'USD',
      quote: 'UAH',
      rate: '40',
      source: 'monobank',
      fetched_at: 1,
    });
    insertRate(database, {
      base: 'BTC',
      quote: 'UAH',
      rate: '2600000',
      source: 'coingecko',
      fetched_at: 1,
    });

    runMigration(database);

    expect(allRates(database)).toEqual([
      { base: 'BTC', quote: 'UAH', rate: '2600000', source: 'coingecko', fetched_at: 1 },
      { base: 'USD', quote: 'UAH', rate: '40', source: 'monobank', fetched_at: 1 },
    ]);
  });
});

describe('0042_uah_star_rates.sql — currency_rate_history', () => {
  it('keeps only a star row per currency per day', () => {
    const database = openTestDatabase();
    insertHistoryRow(database, { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' });
    insertHistoryRow(database, {
      base: 'BTC',
      quote: 'UAH',
      day: 1,
      rate: '2600000',
      source: 'coingecko',
    });
    insertHistoryRow(database, {
      base: 'BTC',
      quote: 'USD',
      day: 1,
      rate: '65000',
      source: 'coingecko',
    });
    insertHistoryRow(database, { base: 'UAH', quote: 'USD', day: 1, rate: '0.025', source: 'nbu' });

    runMigration(database);

    expect(allHistoryRows(database)).toEqual([
      { base: 'BTC', quote: 'UAH', day: 1, rate: '2600000', source: 'coingecko' },
      { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' },
    ]);
  });

  it('derives a legacy history day from BTC:USD + USD:UAH on the SAME day', () => {
    const database = openTestDatabase();
    insertHistoryRow(database, { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' });
    insertHistoryRow(database, {
      base: 'BTC',
      quote: 'USD',
      day: 1,
      rate: '65000',
      source: 'coingecko',
    });

    runMigration(database);

    const rows = allHistoryRows(database);
    const btcRow = rows.find((row) => row.base === 'BTC');
    expect(btcRow).toBeDefined();
    expect(btcRow?.day).toBe(1);
    expect(Number(btcRow?.rate)).toBeCloseTo(65_000 * 40, 6);
  });

  it('derivation stays scoped to the SAME day — a different day never pivots across', () => {
    const database = openTestDatabase();
    insertHistoryRow(database, { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' });
    insertHistoryRow(database, {
      base: 'BTC',
      quote: 'USD',
      day: 2,
      rate: '65000',
      source: 'coingecko',
    });

    runMigration(database);

    const rows = allHistoryRows(database);
    expect(rows.some((row) => row.base === 'BTC')).toBe(false);
  });

  it('is idempotent for history: a second run changes nothing further', () => {
    const database = openTestDatabase();
    insertHistoryRow(database, { base: 'USD', quote: 'UAH', day: 1, rate: '40', source: 'nbu' });
    insertHistoryRow(database, {
      base: 'BTC',
      quote: 'USD',
      day: 1,
      rate: '65000',
      source: 'coingecko',
    });

    runMigration(database);
    const afterFirstRun = allHistoryRows(database);

    runMigration(database);

    expect(allHistoryRows(database)).toEqual(afterFirstRun);
  });
});
