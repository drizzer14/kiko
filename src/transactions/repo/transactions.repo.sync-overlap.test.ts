// A disconnected bank keeps its synced rows, and a statement over the same
// period carries them again under its own keys. Only a real engine shows which
// statement rows the ledger already holds and what the balance does.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const SYNCED_AT = Date.UTC(2026, 8, 20, 9);
const SECOND = 1_000;

const run = (statement: string, ...parameters: (string | number)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const balance = (): number =>
  (
    mockDatabase
      .prepare("SELECT balance_minor_units AS value FROM holdings WHERE id = 'card'")
      .get() as { value: number }
  ).value;

const importedRowCount = (): number =>
  (
    mockDatabase
      .prepare("SELECT count(*) AS value FROM transactions WHERE source = 'import'")
      .get() as { value: number }
  ).value;

const statementRow = (externalId: string, amountMinorUnits: number, time: number) => ({
  holdingId: 'card',
  amountMinorUnits,
  time,
  source: 'import' as const,
  externalId,
});

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('card', 'account', 'Card', 'card', 'UAH', 100000)",
  );
  run(
    "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', 'card', -5000, ?, 'monobank', 'bank-id')",
    SYNCED_AT,
  );
});

describe('a statement row a synced row already holds', () => {
  it('is not inserted and does not move the balance', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [statementRow('later', -5_000, SYNCED_AT + 30 * SECOND)],
    });

    expect(imported).toBe(0);
    expect(importedRowCount()).toBe(0);
    expect(balance()).toBe(100_000);
  });

  it('matches a row dated up to 60 seconds before the synced row', async () => {
    await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [statementRow('earlier', -5_000, SYNCED_AT - 60 * SECOND)],
    });

    expect(importedRowCount()).toBe(0);
  });

  it('stands for one statement row only', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        statementRow('first', -5_000, SYNCED_AT + 10 * SECOND),
        statementRow('second', -5_000, SYNCED_AT + 20 * SECOND),
      ],
    });

    expect(imported).toBe(1);
    expect(balance()).toBe(95_000);
  });
});

describe('a statement row no synced row holds', () => {
  it('is inserted when it is dated more than 60 seconds from the synced row', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [statementRow('apart', -5_000, SYNCED_AT + 61 * SECOND)],
    });

    expect(imported).toBe(1);
    expect(balance()).toBe(95_000);
  });

  it('is inserted when its amount differs', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [statementRow('other-amount', -4_000, SYNCED_AT + 30 * SECOND)],
    });

    expect(imported).toBe(1);
    expect(balance()).toBe(96_000);
  });

  it('is inserted when the synced row is on another holding', async () => {
    run(
      "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('other', 'account', 'Other', 'card', 'UAH', 0)",
    );
    run("UPDATE transactions SET holding_id = 'other' WHERE id = 'synced'");

    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [statementRow('same-amount', -5_000, SYNCED_AT + 30 * SECOND)],
    });

    expect(imported).toBe(1);
    expect(balance()).toBe(95_000);
  });
});
