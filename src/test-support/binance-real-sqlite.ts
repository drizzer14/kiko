/**
 * The set-up and the reads the Binance history walk tests share when they run a walk over the
 * REAL repos on a real `node:sqlite` engine: one Binance account on a migrated database, the
 * transactions and holdings it holds, the entries its walk state lists, and the label a row shows.
 */
import { match } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import { createBinanceHistoryRun } from '@kiko/crypto-sync/binance';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { transactionRowDescription } from '@kiko/transactions/row-description';

import { applyAllMigrations } from './real-sqlite';
import { seedWalkMarks, type WalkMarkSeed, type WalkName } from './walk-marks';

export const BINANCE_ACCOUNT_ID = 'acc-1';

type StoredRow = {
  id: string;
  holding_id: string;
  external_id: string;
  amount_minor_units: number;
  holding_name: string;
  description: string;
  exchange_counterpart_holding_id: string | null;
  untracked_counterpart: string | null;
  comment: string | null;
  operation: string | null;
};

/** A migrated database with the Binance account, and each given walk's marks seeded. */
export const openBinanceDatabase = (
  marks: Partial<Record<WalkName, WalkMarkSeed>>,
): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');
  database
    .prepare(
      `INSERT INTO accounts (id, name, kind, institution)
         VALUES ('${BINANCE_ACCOUNT_ID}', 'Binance', 'crypto', 'binance')`,
    )
    .run();

  for (const [walkName, walkMarks] of Object.entries(marks)) {
    seedWalkMarks(database, BINANCE_ACCOUNT_ID, walkName as WalkName, walkMarks);
  }

  return database;
};

/** The request of a history walk: the account, and a run that waits for nothing. */
export const historyRequestOf = (now: number) => ({
  targetAccountId: BINANCE_ACCOUNT_ID,
  run: createBinanceHistoryRun({ now: () => now, sleep: async () => undefined }),
});

export const storedRowsOf = (database: DatabaseSync): StoredRow[] =>
  database
    .prepare(
      `SELECT transactions.id, holding_id, external_id, amount_minor_units,
              holdings.name AS holding_name, description, exchange_counterpart_holding_id,
              untracked_counterpart, comment, operation
         FROM transactions JOIN holdings ON holdings.id = transactions.holding_id
         ORDER BY external_id`,
    )
    .all() as StoredRow[];

export const holdingBalancesOf = (database: DatabaseSync): Record<string, number> =>
  Object.fromEntries(
    (
      database.prepare('SELECT name, balance_minor_units FROM holdings').all() as {
        name: string;
        balance_minor_units: number;
      }[]
    ).map((holding) => [holding.name, holding.balance_minor_units]),
  );

/** What the stored rows add up to on each holding; a Funding balance is not moved by a row. */
export const rowTotalsOf = (database: DatabaseSync): Record<string, number> =>
  Object.fromEntries(
    (
      database
        .prepare(
          `SELECT holdings.name AS name, SUM(amount_minor_units) AS total
             FROM transactions JOIN holdings ON holdings.id = transactions.holding_id
             GROUP BY holdings.name`,
        )
        .all() as { name: string; total: number }[]
    ).map((holding) => [holding.name, holding.total]),
  );

/** The entries of the account's not-imported list. */
export const notImportedOf = (database: DatabaseSync): string[] =>
  match(
    parseExchangeState(
      (
        database
          .prepare(
            `SELECT exchange_state FROM sync_state WHERE account_id = '${BINANCE_ACCOUNT_ID}'`,
          )
          .get() as { exchange_state: string }
      ).exchange_state,
    ),
  )
    .returnType<string[]>()
    .with({ kind: 'parsed' }, ({ notImported }) => notImported)
    .with({ kind: 'malformed' }, () => [])
    .exhaustive();

/** The label a transaction list shows for a stored row. */
export const rowLabelOf = (row: StoredRow): string =>
  transactionRowDescription({
    transaction: {
      holdingId: row.holding_id,
      description: row.description,
      amountMinorUnits: row.amount_minor_units,
      exchangeCounterpartHoldingId: row.exchange_counterpart_holding_id,
      untrackedCounterpart: row.untracked_counterpart,
      operation: null,
    },
    holdingName: row.holding_name,
    holdingNameById: new Map(),
    holdingCurrencyById: new Map(),
    t: i18n.t,
  });
