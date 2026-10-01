// The post-closing sum is SQL over the stored ledger, so only a real engine
// shows which stored rows it counts.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { kyivWallClockToUtcMilliseconds } from '@kiko/dates';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const kyiv = (day: number, hour: number): number =>
  kyivWallClockToUtcMilliseconds({ year: 2023, month: 6, day, hour, minute: 0, second: 0 }) ??
  Number.NaN;

const run = (statement: string, ...parameters: (string | number)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const balance = (): number =>
  (
    mockDatabase
      .prepare("SELECT balance_minor_units AS value FROM holdings WHERE id = 'card'")
      .get() as {
      value: number;
    }
  ).value;

const storedRowCount = (): number =>
  (mockDatabase.prepare('SELECT count(*) AS count FROM transactions').get() as { count: number })
    .count;

const realMidnightRow = {
  holdingId: 'card',
  amountMinorUnits: -5_000,
  time: kyiv(1, 0),
  source: 'import' as const,
  externalId: 'midnight-key',
  aliasExternalId: 'noon-key',
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Monobank', 'bank')");
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('card', 'account', 'Card', 'card', 'UAH', -5000)",
  );
  // An older build read the real 00:00:00 time as a date-only noon.
  run(
    "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('stored', 'card', -5000, ?, 'import', 'noon-key')",
    kyiv(1, 12),
  );
});

describe('transactionsRepo.importRows — a real 00:00:00 row stored at noon', () => {
  it('leaves it out of the post-closing net when its real time is before the closing as-of', async () => {
    await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        {
          holdingId: 'card',
          amountMinorUnits: -2_000,
          time: kyiv(1, 9),
          source: 'import',
          externalId: 'nine-key',
        },
        realMidnightRow,
      ],
      closingBalance: { minorUnits: 93_000, currency: 'UAH', asOfSeconds: kyiv(1, 9) / 1000 },
    });

    expect(balance()).toBe(93_000);
    expect(storedRowCount()).toBe(2);
  });

  it('still counts it when its real time is after the closing as-of', async () => {
    await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [realMidnightRow],
      closingBalance: { minorUnits: 100_000, currency: 'UAH', asOfSeconds: kyiv(1, 0) / 1000 - 1 },
    });

    expect(balance()).toBe(95_000);
    expect(storedRowCount()).toBe(1);
  });
});
