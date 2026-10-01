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

const importedTimes = (): number[] =>
  (
    mockDatabase
      .prepare("SELECT time AS value FROM transactions WHERE source = 'import' ORDER BY time")
      .all() as { value: number }[]
  ).map((row) => row.value);

const statementRow = (externalId: string, amountMinorUnits: number, time: number) => ({
  holdingId: 'card',
  amountMinorUnits,
  time,
  source: 'import' as const,
  externalId,
});

const MINUTE_CLOCK_SPAN_MILLISECONDS = 59 * SECOND;

const minuteStatementRow = (externalId: string, amountMinorUnits: number, time: number) => ({
  ...statementRow(externalId, amountMinorUnits, time),
  timeSpanMilliseconds: MINUTE_CLOCK_SPAN_MILLISECONDS,
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

  it('goes to the nearest statement row, whatever the file order', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        statementRow('real-second-fare', -5_000, SYNCED_AT + 40 * SECOND),
        statementRow('synced-fare', -5_000, SYNCED_AT),
      ],
    });

    expect(imported).toBe(1);
    expect(importedTimes()).toEqual([SYNCED_AT + 40 * SECOND]);
    expect(balance()).toBe(95_000);
  });

  it('goes to the nearest statement row when an earlier unsynced one is in reach too', async () => {
    await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        statementRow('unsynced-earlier', -5_000, SYNCED_AT - 20 * SECOND),
        statementRow('synced-fare', -5_000, SYNCED_AT + 10 * SECOND),
      ],
    });

    expect(importedTimes()).toEqual([SYNCED_AT - 20 * SECOND]);
  });

  it('reads a minute clock as any second of that minute', async () => {
    run("UPDATE transactions SET time = ? WHERE id = 'synced'", SYNCED_AT + 40 * SECOND);

    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        minuteStatementRow('real-next-fare', -5_000, SYNCED_AT + 60 * SECOND),
        minuteStatementRow('synced-fare', -5_000, SYNCED_AT),
      ],
    });

    expect(imported).toBe(1);
    expect(importedTimes()).toEqual([SYNCED_AT + 60 * SECOND]);
    expect(balance()).toBe(95_000);
  });

  it('matches a minute clock up to 60 seconds past the end of its minute', async () => {
    run("UPDATE transactions SET time = ? WHERE id = 'synced'", SYNCED_AT + 119 * SECOND);

    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [minuteStatementRow('late-sync', -5_000, SYNCED_AT)],
    });

    expect(imported).toBe(0);
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
