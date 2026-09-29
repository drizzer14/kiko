// Every row here comes from the app's own write path on a real, fully migrated
// `node:sqlite` engine, so the count sees exactly the columns each path sets:
// the ones that tie a transfer's legs together, and the ones that tell a
// balance the user set from a transaction they entered.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { remindersRepo } from './reminders.repo';

const SINCE = new Date(2026, 8, 1).getTime();
const TIME = new Date(2026, 8, 20, 12, 0).getTime();

const run = (statement: string, ...parameters: string[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const entries = async (accountId = 'account'): Promise<number> =>
  (await remindersRepo.manualEntryDaysQuery(accountId, SINCE)).at(0)?.entries ?? 0;

const createdAtCount = (): number =>
  (
    mockDatabase.prepare('SELECT count(DISTINCT created_at) AS count FROM transactions').get() as {
      count: number;
    }
  ).count;

const enter = (holdingId: string, amountMinorUnits = -100): Promise<void> =>
  transactionsRepo.recordManual({ holdingId, amountMinorUnits, time: TIME, category: 'food' });

const exchange = (sourceHoldingId: string, destinationHoldingId: string, time = TIME) =>
  transactionsRepo.recordExchange({
    sourceHoldingId,
    valueOutMinorUnits: 100,
    destinationHoldingId,
    destinationType: 'cash',
    valueInMinorUnits: 100,
    time,
  });

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');

  // `created_at` is SQLite's own clock, read once per statement, in whole
  // seconds. It ticks a second per call here, so the rows of one write land
  // in different seconds, as they can on a device.
  let seconds = Math.floor(Date.now() / 1000);

  mockDatabase.function('unixepoch', () => {
    seconds += 1;

    return seconds;
  });
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Cash', 'cash')");
  run("INSERT INTO accounts (id, name, kind) VALUES ('other', 'Other', 'cash')");

  for (const [holdingId, accountId] of [
    ['wallet', 'account'],
    ['pocket', 'account'],
    ['elsewhere', 'other'],
  ]) {
    run(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES (?, ?, 'Cash', 'cash', 'UAH')",
      holdingId,
      accountId,
    );
  }
});

describe('remindersRepo.manualEntryDaysQuery on the real write paths', () => {
  it('counts each transaction the user enters', async () => {
    await enter('wallet');
    await enter('pocket');

    expect(await entries()).toBe(2);
  });

  it('counts an exchange between two holdings of the account once, though its legs are seconds apart', async () => {
    await exchange('wallet', 'pocket');

    expect(createdAtCount()).toBe(2);
    expect(await entries()).toBe(1);
  });

  it('counts two exchanges between the same holdings at different times, and an entry, as three', async () => {
    await exchange('wallet', 'pocket');
    await exchange('pocket', 'wallet', TIME + 60_000);
    await enter('wallet');

    expect(await entries()).toBe(3);
  });

  it('counts a payment and its change returns once', async () => {
    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'wallet', amountMinorUnits: -500, time: TIME, category: 'food' },
      returns: [{ holdingId: 'pocket', amountMinorUnits: 100 }],
    });

    expect(createdAtCount()).toBe(2);
    expect(await entries()).toBe(1);
  });

  it('counts an exchange with another account, which has no category, on each side', async () => {
    await exchange('wallet', 'elsewhere');

    expect(await entries()).toBe(1);
    expect(await entries('other')).toBe(1);
  });

  it('leaves out a new cash account opening balance', async () => {
    await accountsRepo.createCashAccount({
      name: 'Savings',
      currency: 'UAH',
      initialBalance: Money.of('UAH', 500_00),
    });
    const { id: accountId } = mockDatabase
      .prepare("SELECT id FROM accounts WHERE name = 'Savings'")
      .get() as { id: string };

    expect(await entries(accountId)).toBe(0);
  });

  it('leaves out a new holding opening balance and a balance edit, but not an entry', async () => {
    const holdingId = await holdingsRepo.create({
      accountId: 'account',
      name: 'Jar',
      type: 'cash',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 250_00),
    });

    await holdingsRepo.updateWithBalanceDelta(
      holdingId,
      { balance: Money.of('UAH', 300_00) },
      TIME,
    );

    expect(await entries()).toBe(0);

    await enter(holdingId);

    expect(await entries()).toBe(1);
  });
});
