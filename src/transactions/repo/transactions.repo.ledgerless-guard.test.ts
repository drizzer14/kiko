// A ledgerless holding (term_deposit, bond, property_item, metal, loan) is
// valued from its metadata, never from its ledger, so a plain transaction row
// on it would show in the Home list and the category breakdown yet never reach
// net worth, while still moving a stored balance nothing reads. The repo refuses it before it writes, and a refused write
// inside a multi-row operation must roll the whole operation back. Only a real
// engine shows what a rollback leaves behind.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { holdingTypes } from '@kiko/holdings/holding-type';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

import { transactionsRepo } from './transactions.repo';

const ledgerlessTypes = holdingTypes.filter((type) => isLedgerlessHoldingType(type));

const TIME = 1_700_000_000_000;

const run = (statement: string, ...parameters: (string | number)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const storedRowCount = (): number =>
  (mockDatabase.prepare('SELECT count(*) AS count FROM transactions').get() as { count: number })
    .count;

const balanceOf = (holdingId: string): number =>
  (
    mockDatabase
      .prepare('SELECT balance_minor_units AS value FROM holdings WHERE id = ?')
      .get(holdingId) as { value: number }
  ).value;

const seedHolding = (holdingId: string, type: string): void =>
  run(
    'INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES (?, ?, ?, ?, ?, ?)',
    holdingId,
    'account',
    holdingId,
    type,
    'UAH',
    100_000,
  );

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Home', 'bank')");
  seedHolding('card', 'card');
  seedHolding('cash', 'cash');
});

describe('the ledgerless types under test', () => {
  it('are not empty, so the describe.each below is never vacuous', () => {
    expect(ledgerlessTypes.length).toBeGreaterThan(0);
  });
});

describe.each(ledgerlessTypes)('a ledgerless %s target', (type) => {
  beforeEach(() => seedHolding('target', type));

  it('refuses recordManual and writes nothing', async () => {
    await expect(
      transactionsRepo.recordManual({ holdingId: 'target', amountMinorUnits: 500, time: TIME }),
    ).rejects.toThrow('transactions/ledgerless-holding');

    expect(storedRowCount()).toBe(0);
    expect(balanceOf('target')).toBe(100_000);
  });

  it('rolls the whole split back when a return lands on it', async () => {
    await expect(
      transactionsRepo.recordManualWithReturns({
        payment: { holdingId: 'card', amountMinorUnits: -500, time: TIME, category: 'groceries' },
        returns: [{ holdingId: 'target', amountMinorUnits: 200 }],
      }),
    ).rejects.toThrow('transactions/ledgerless-holding');

    expect(storedRowCount()).toBe(0);
    expect(balanceOf('card')).toBe(100_000);
    expect(balanceOf('target')).toBe(100_000);
  });

  it('refuses recordExchange paying out of it and writes nothing', async () => {
    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'target',
        valueOutMinorUnits: 500,
        destinationHoldingId: 'card',
        destinationType: 'card',
        valueInMinorUnits: 500,
        time: TIME,
      }),
    ).rejects.toThrow('transactions/ledgerless-holding');

    expect(storedRowCount()).toBe(0);
    expect(balanceOf('card')).toBe(100_000);
  });

  it('refuses a plain receive leg on it and rolls the source leg back', async () => {
    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'card',
        valueOutMinorUnits: 500,
        destinationHoldingId: 'target',
        // A caller that wrongly names a plain-receive type must still not land a row.
        destinationType: 'card',
        valueInMinorUnits: 500,
        time: TIME,
      }),
    ).rejects.toThrow('transactions/ledgerless-holding');

    expect(storedRowCount()).toBe(0);
    expect(balanceOf('card')).toBe(100_000);
  });

  it('refuses importRows into it and writes nothing', async () => {
    await expect(
      transactionsRepo.importRows({
        holdingId: 'target',
        rows: [
          {
            holdingId: 'target',
            amountMinorUnits: -2_000,
            time: TIME,
            source: 'import',
            externalId: 'import-key',
          },
        ],
        closingBalance: { minorUnits: 93_000, currency: 'UAH', asOfSeconds: TIME / 1000 },
      }),
    ).rejects.toThrow('statement-import/ledgerless-holding');

    expect(storedRowCount()).toBe(0);
    expect(balanceOf('target')).toBe(100_000);
  });
});

describe('a ledger-backed target (control)', () => {
  it('still takes recordManual and moves its balance', async () => {
    await transactionsRepo.recordManual({ holdingId: 'cash', amountMinorUnits: -500, time: TIME });

    expect(storedRowCount()).toBe(1);
    expect(balanceOf('cash')).toBe(99_500);
  });

  it('still takes a split whose return lands on another cash holding', async () => {
    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'card', amountMinorUnits: -500, time: TIME, category: 'groceries' },
      returns: [{ holdingId: 'cash', amountMinorUnits: 200 }],
    });

    expect(storedRowCount()).toBe(2);
    expect(balanceOf('card')).toBe(99_500);
    expect(balanceOf('cash')).toBe(100_200);
  });

  it('still takes importRows into a card', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        {
          holdingId: 'card',
          amountMinorUnits: -2_000,
          time: TIME,
          source: 'import',
          externalId: 'import-key',
        },
      ],
      closingBalance: { minorUnits: 93_000, currency: 'UAH', asOfSeconds: TIME / 1000 },
    });

    expect(imported).toBe(1);
    expect(balanceOf('card')).toBe(93_000);
  });
});
