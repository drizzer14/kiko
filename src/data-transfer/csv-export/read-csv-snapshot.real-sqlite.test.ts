// Rows of one time reach the transfer matcher in the order the app's own read gives them (the
// `transactions_time` index scan), not in id order. This file runs the CSV read and the Statistics
// read on a real `node:sqlite` engine (the shipped migrations): two debits compete for one credit,
// all three at one moment, and the type the CSV writes must equal what the ledger marks for the
// rows `listAllQuery` returns.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);

import Papa from 'papaparse';
import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildSpendingLedger } from '@kiko/statistics/spending-ledger';

import { buildCsvText } from './csv-rows';
import { readCsvSnapshot } from './read-csv-snapshot';

const TIME = new Date(2024, 0, 5, 12).getTime();
const DESCRIPTION_COLUMN = 6;
const TYPE_COLUMN = 8;

// Inserted out of id order, so the rowid order of the ties and the id order disagree.
const seedTies = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('bank', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('card', 'bank', 'Card', 'card', 'UAH');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('cash', 'bank', 'Cash', 'cash', 'UAH');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('savings', 'bank', 'Savings', 'card', 'UAH');
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
      VALUES ('b', 'cash', -10000, ${TIME}, 'b', 'manual');
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
      VALUES ('c', 'savings', 10000, ${TIME}, 'c', 'manual');
    INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
      VALUES ('a', 'card', -10000, ${TIME}, 'a', 'manual');
  `);
};

describe('the CSV type of rows that share one time', () => {
  beforeEach(seedTies);

  it('is what the ledger marks for the rows the app reads', async () => {
    const snapshot = await readCsvSnapshot();
    const { excludedTransactionIds } = buildSpendingLedger({
      transactions: await transactionsRepo.listAllQuery(),
      holdings: snapshot.holdings,
      accounts: snapshot.accounts,
      shownHoldings: snapshot.holdings,
    });
    const text = buildCsvText({
      snapshot,
      dialect: { delimiter: ',', decimal: '.' },
      t: i18n.getFixedT('en'),
    });
    const typeById = Object.fromEntries(
      Papa.parse<string[]>(text.replace('﻿', ''), { skipEmptyLines: true })
        .data.slice(1)
        .map((cells) => [cells[DESCRIPTION_COLUMN], cells[TYPE_COLUMN]]),
    );

    expect(excludedTransactionIds.size).toBe(2);
    expect(typeById).toEqual(
      Object.fromEntries(
        ['a', 'b', 'c'].map((id) => [id, excludedTransactionIds.has(id) ? 'Transfer' : 'Expense']),
      ),
    );
  });
});
