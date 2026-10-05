// drizzle/migrations/0052-add-exchange-pair-id.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's
// database stood before it, so the backfill is proven against real rows, not
// a restated predicate.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_SQL = readFileSync(join(__dirname, '0052_add_exchange_pair_id.sql'), 'utf8');

const EXCHANGED = Date.UTC(2026, 8, 12, 10);
const LATER = Date.UTC(2026, 8, 13, 10);

type TransactionSeed = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time?: number;
  source?: string;
  exchangeCounterpartHoldingId?: string;
  changeGroupId?: string;
};

const run = (
  database: DatabaseSync,
  statement: string,
  ...parameters: (string | number | null)[]
) => {
  database.prepare(statement).run(...parameters);
};

const insertHolding = (database: DatabaseSync, id: string, type = 'card'): void => {
  run(
    database,
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES (?, 'account', ?, ?, 'UAH', 0)`,
    id,
    id,
    type,
  );
};

const insertTransaction = (database: DatabaseSync, row: TransactionSeed): void => {
  run(
    database,
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, exchange_counterpart_holding_id, change_group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.holdingId,
    row.amountMinorUnits,
    row.time ?? EXCHANGED,
    row.source ?? 'manual',
    row.source === undefined || row.source === 'manual' ? null : row.id,
    row.exchangeCounterpartHoldingId ?? null,
    row.changeGroupId ?? null,
  );
};

const statements = (): string[] =>
  MIGRATION_SQL.split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

const applyMigration = (database: DatabaseSync): void => {
  for (const statement of statements()) {
    database.exec(statement);
  }
};

const pairIds = (database: DatabaseSync): Record<string, string | null> =>
  Object.fromEntries(
    (
      database.prepare('SELECT id, exchange_pair_id AS pairId FROM transactions').all() as {
        id: string;
        pairId: string | null;
      }[]
    ).map((row) => [row.id, row.pairId]),
  );

const databaseThrough0051 = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0051_monobank_accounts_bank_id');
  run(database, "INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  insertHolding(database, 'uah');
  insertHolding(database, 'usd');
  insertHolding(database, 'bank');
  insertHolding(database, 'deposit', 'term_deposit');

  return database;
};

describe('migration 0052: the stored exchange pair id', () => {
  it('adds a nullable text column and an index on it', () => {
    const database = databaseThrough0051();

    applyMigration(database);

    const column = (
      database
        .prepare(
          'SELECT name, type, "notnull", dflt_value FROM pragma_table_info(\'transactions\')',
        )
        .all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((candidate) => candidate.name === 'exchange_pair_id');
    const indexNames = (
      database.prepare("SELECT name FROM pragma_index_list('transactions')").all() as {
        name: string;
      }[]
    ).map((index) => index.name);

    expect(column).toEqual({
      name: 'exchange_pair_id',
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
    });
    expect(indexNames).toContain('transactions_exchange_pair_id');
  });

  it('pairs a manual exchange 1:1 under the smaller id of its two legs', () => {
    const database = databaseThrough0051();

    insertTransaction(database, {
      id: 'z-first-written',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(database, {
      id: 'a-second-written',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'uah',
    });

    applyMigration(database);

    expect(pairIds(database)).toEqual({
      'z-first-written': 'a-second-written',
      'a-second-written': 'a-second-written',
    });
  });

  it.each(['monobank', 'import'])(
    'pairs a Convert with its unmarked %s row of the same instant',
    (source) => {
      const database = databaseThrough0051();

      insertTransaction(database, {
        id: 'convert-leg',
        holdingId: 'usd',
        amountMinorUnits: 1_000,
        exchangeCounterpartHoldingId: 'bank',
      });
      insertTransaction(database, {
        id: 'original-row',
        holdingId: 'bank',
        amountMinorUnits: -40_000,
        source,
      });

      applyMigration(database);

      expect(pairIds(database)).toEqual({
        'convert-leg': 'convert-leg',
        'original-row': 'convert-leg',
      });
    },
  );

  it('leaves two exchanges between the same holdings in the same millisecond unpaired', () => {
    const database = databaseThrough0051();

    for (const suffix of ['one', 'two']) {
      insertTransaction(database, {
        id: `out-${suffix}`,
        holdingId: 'uah',
        amountMinorUnits: -40_000,
        exchangeCounterpartHoldingId: 'usd',
      });
      insertTransaction(database, {
        id: `in-${suffix}`,
        holdingId: 'usd',
        amountMinorUnits: 1_000,
        exchangeCounterpartHoldingId: 'uah',
      });
    }

    applyMigration(database);

    expect(Object.values(pairIds(database))).toEqual([null, null, null, null]);
  });

  it('leaves a re-dated leg, a leg of the same sign, and a zero amount unpaired', () => {
    const database = databaseThrough0051();

    insertTransaction(database, {
      id: 'redated-out',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(database, {
      id: 'redated-in',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      time: LATER,
      exchangeCounterpartHoldingId: 'uah',
    });
    insertTransaction(database, {
      id: 'same-sign-out',
      holdingId: 'uah',
      amountMinorUnits: 40_000,
      time: LATER + 1,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(database, {
      id: 'same-sign-in',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      time: LATER + 1,
      exchangeCounterpartHoldingId: 'uah',
    });
    insertTransaction(database, {
      id: 'zero-out',
      holdingId: 'uah',
      amountMinorUnits: 0,
      time: LATER + 2,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(database, {
      id: 'zero-in',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      time: LATER + 2,
      exchangeCounterpartHoldingId: 'uah',
    });

    applyMigration(database);

    expect(Object.values(pairIds(database))).toEqual([null, null, null, null, null, null]);
  });

  it('leaves an orphan leg, a dangling marker, and a deposit source leg unpaired', () => {
    const database = databaseThrough0051();

    insertTransaction(database, {
      id: 'orphan',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(database, {
      id: 'dangling',
      holdingId: 'usd',
      amountMinorUnits: -1_000,
      time: LATER,
      exchangeCounterpartHoldingId: 'deleted-holding',
    });
    insertTransaction(database, {
      id: 'deposit-source',
      holdingId: 'uah',
      amountMinorUnits: -50_000,
      time: LATER + 1,
      exchangeCounterpartHoldingId: 'deposit',
    });

    applyMigration(database);

    expect(Object.values(pairIds(database))).toEqual([null, null, null]);
  });

  it('leaves a split group out of every pair, whatever its marker', () => {
    const database = databaseThrough0051();

    insertTransaction(database, {
      id: 'split-payment',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
      changeGroupId: 'group',
    });
    insertTransaction(database, {
      id: 'split-return',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'uah',
      changeGroupId: 'group',
    });

    applyMigration(database);

    expect(Object.values(pairIds(database))).toEqual([null, null]);
  });

  it('leaves two legs that name one bank row unpaired, since neither is provably its other half', () => {
    const database = databaseThrough0051();

    insertTransaction(database, {
      id: 'first-convert-leg',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'bank',
    });
    insertTransaction(database, {
      id: 'second-convert-leg',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'bank',
    });
    insertTransaction(database, {
      id: 'bank-row',
      holdingId: 'bank',
      amountMinorUnits: -40_000,
      source: 'monobank',
    });

    applyMigration(database);

    expect(Object.values(pairIds(database))).toEqual([null, null, null]);
  });

  it('is idempotent: a second run of the backfill keeps every id, a stored one included', () => {
    const database = databaseThrough0051();

    insertTransaction(database, {
      id: 'out-leg',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });
    insertTransaction(database, {
      id: 'in-leg',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'uah',
    });
    applyMigration(database);
    run(database, "UPDATE transactions SET exchange_pair_id = 'chosen' WHERE id = 'in-leg'");

    for (const statement of statements().filter((candidate) =>
      candidate.includes('UPDATE `transactions`'),
    )) {
      database.exec(statement);
    }

    expect(pairIds(database)).toEqual({ 'out-leg': 'in-leg', 'in-leg': 'chosen' });
  });

  it('leaves a new row unpaired by default', () => {
    const database = databaseThrough0051();

    applyMigration(database);
    insertTransaction(database, { id: 'later', holdingId: 'uah', amountMinorUnits: -100 });

    expect(pairIds(database)).toEqual({ later: null });
  });
});
