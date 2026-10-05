// Deleting one leg of a movement deletes the whole movement: the other
// legs of an Exchange or Convert, every row of a split, and the contribution a
// deposit received. Only a real engine shows that every balance, every row and
// the deposit metadata come back to what they were before the movement was
// written, so each case compares the whole state with its state before.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { applyAllMigrations, applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const MIGRATION_0052_SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'drizzle', 'migrations', '0052_add_exchange_pair_id.sql'),
  'utf8',
);

const OPENED = Date.UTC(2026, 8, 1, 9);
const MOVED = Date.UTC(2026, 9, 1, 9);

const DEPOSIT_METADATA = {
  contributions: [{ amountMinorUnits: 500_000, date: OPENED }],
  annualRatePct: 10,
  termMonths: 12,
  recapitalization: true,
  compounding: 'monthly',
};

const NAMES: Record<string, string> = {
  uah: 'Hryvnia card',
  usd: 'Dollar card',
  cash: 'Cash',
  second: 'Second card',
  deposit: 'Deposit',
  bank: 'Monobank card',
};

type SqlParameter = string | number | null;

const run = (statement: string, ...parameters: SqlParameter[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const insertHolding = (
  id: string,
  type: string,
  currency: string,
  balanceMinorUnits: number,
  options: { accountId?: string; metadata?: unknown } = {},
): void => {
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    options.accountId ?? 'account',
    NAMES[id] ?? id,
    type,
    currency,
    balanceMinorUnits,
    foldMap(maybe(options.metadata), (metadata) => JSON.stringify(metadata)) ?? null,
  );
};

// The fixture: a UAH card of 1000.00, an empty USD card, an empty cash holding
// and second UAH card (the change returns of a split), a term deposit holding
// its opening contribution, and a live-synced Monobank card.
const seedFixture = (): void => {
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    "INSERT INTO accounts (id, name, kind, institution) VALUES ('synced', 'Monobank', 'bank', 'monobank')",
  );
  insertHolding('uah', 'card', 'UAH', 100_000);
  insertHolding('usd', 'card', 'USD', 0);
  insertHolding('cash', 'cash', 'UAH', 0);
  insertHolding('second', 'card', 'UAH', 0);
  insertHolding('deposit', 'term_deposit', 'UAH', 0, { metadata: DEPOSIT_METADATA });
  insertHolding('bank', 'card', 'UAH', 0, {
    accountId: 'synced',
    metadata: { monobankId: 'card-bank' },
  });
};

type RowSeed = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time?: number;
  source?: string;
  exchangeCounterpartHoldingId?: string;
  changeGroupId?: string;
};

const insertRow = (row: RowSeed): void => {
  run(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, exchange_counterpart_holding_id, change_group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.holdingId,
    row.amountMinorUnits,
    row.time ?? MOVED,
    row.source ?? 'manual',
    row.source === undefined || row.source === 'manual' ? null : row.id,
    row.exchangeCounterpartHoldingId ?? null,
    row.changeGroupId ?? null,
  );
};

const setBalance = (holdingId: string, balanceMinorUnits: number): void => {
  run('UPDATE holdings SET balance_minor_units = ? WHERE id = ?', balanceMinorUnits, holdingId);
};

const balancesOf = (): Record<string, number> =>
  Object.fromEntries(
    (
      mockDatabase.prepare('SELECT id, balance_minor_units AS value FROM holdings').all() as {
        id: string;
        value: number;
      }[]
    ).map((holding) => [holding.id, holding.value]),
  );

const rowIds = (): string[] =>
  (mockDatabase.prepare('SELECT id FROM transactions ORDER BY id').all() as { id: string }[]).map(
    (row) => row.id,
  );

const contributionsOf = (holdingId: string): { amountMinorUnits: number; date: number }[] =>
  JSON.parse(
    (
      mockDatabase.prepare('SELECT metadata FROM holdings WHERE id = ?').get(holdingId) as {
        metadata: string;
      }
    ).metadata,
  ).contributions;

const rowOf = (id: string) =>
  mockDatabase
    .prepare(
      'SELECT holding_id AS holdingId, amount_minor_units AS amount, exchange_counterpart_holding_id AS marker, exchange_pair_id AS pairId FROM transactions WHERE id = ?',
    )
    .get(id) as
    | { holdingId: string; amount: number; marker: string | null; pairId: string | null }
    | undefined;

const stateOf = () => ({
  balances: balancesOf(),
  rows: rowIds(),
  contributions: contributionsOf('deposit'),
});

const idOfRowOn = (holdingId: string): string =>
  (
    mockDatabase
      .prepare("SELECT id FROM transactions WHERE holding_id = ? AND source = 'manual'")
      .get(holdingId) as { id: string }
  ).id;

const exchangeUahToUsd = (): Promise<void> =>
  transactionsRepo.recordExchange({
    sourceHoldingId: 'uah',
    valueOutMinorUnits: 40_000,
    destinationHoldingId: 'usd',
    destinationType: 'card',
    valueInMinorUnits: 1_000,
    time: MOVED,
  });

const convertExpenseOfUah = async (
  counterpartHoldingId: string,
  counterpartType: 'card' | 'term_deposit',
  amountMinorUnits: number,
): Promise<string> => {
  await transactionsRepo.recordManual({
    holdingId: 'uah',
    amountMinorUnits: -40_000,
    time: MOVED,
    category: 'groceries',
  });
  const original = idOfRowOn('uah');

  await transactionsRepo.recordExchangeCounterpart({
    direction: 'record-destination',
    counterpartHoldingId,
    counterpartType,
    amountMinorUnits,
    existingTransactionId: original,
    existingHoldingId: 'uah',
    time: MOVED,
  });

  return original;
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  seedFixture();
});

describe('deleting a leg of a manual Exchange', () => {
  it.each([
    ['source', 'uah'],
    ['destination', 'usd'],
  ])('deletes both legs from the %s leg and brings both balances back', async (_leg, holdingId) => {
    const before = stateOf();

    await exchangeUahToUsd();
    await transactionsRepo.remove(idOfRowOn(holdingId));

    expect(stateOf()).toEqual(before);
  });

  it('names the other holding in the plan, from either leg', async () => {
    await exchangeUahToUsd();

    expect(await transactionsRepo.removePlan(idOfRowOn('uah'))).toEqual({
      split: false,
      exchange: { kind: 'deleted', names: ['Dollar card'] },
    });
    expect(await transactionsRepo.removePlan(idOfRowOn('usd'))).toEqual({
      split: false,
      exchange: { kind: 'deleted', names: ['Hryvnia card'] },
    });
  });

  it('reverses each leg by its own stored amount when the user edited one of them', async () => {
    const before = stateOf();

    await exchangeUahToUsd();
    await transactionsRepo.update({
      transactionId: idOfRowOn('usd'),
      amountMinorUnits: 1_200,
      time: MOVED,
    });
    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(stateOf()).toEqual(before);
  });

  it('leaves a destination balance alone when the leg is dated before a bank row anchored that holding', async () => {
    insertRow({
      id: 'sync-row',
      holdingId: 'usd',
      amountMinorUnits: 100,
      time: MOVED + 1_000,
      source: 'monobank',
    });
    setBalance('usd', 100);
    const before = stateOf();

    await exchangeUahToUsd();
    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(stateOf()).toEqual(before);
    expect(balancesOf().usd).toBe(100);
  });

  it('deletes a manual leg that sits on a synced holding, judged by that leg own source', async () => {
    insertHolding('synced-usd', 'card', 'USD', 100, {
      accountId: 'synced',
      metadata: { monobankId: 'card-usd' },
    });
    insertRow({
      id: 'synced-sync-row',
      holdingId: 'synced-usd',
      amountMinorUnits: 100,
      time: MOVED + 1_000,
      source: 'monobank',
    });
    const before = stateOf();

    await transactionsRepo.recordExchange({
      sourceHoldingId: 'uah',
      valueOutMinorUnits: 40_000,
      destinationHoldingId: 'synced-usd',
      destinationType: 'card',
      valueInMinorUnits: 1_000,
      time: MOVED,
    });
    await transactionsRepo.remove(idOfRowOn('synced-usd'));

    expect(stateOf()).toEqual(before);
  });

  it('shares one pair id between the two legs it writes', async () => {
    await exchangeUahToUsd();

    const source = rowOf(idOfRowOn('uah'));
    const destination = rowOf(idOfRowOn('usd'));

    expect(source?.pairId).not.toBeNull();
    expect(destination?.pairId).toBe(source?.pairId);
  });
});

describe('deleting the source leg of an Exchange into a term deposit', () => {
  const exchangeIntoDeposit = (): Promise<void> =>
    transactionsRepo.recordExchange({
      sourceHoldingId: 'uah',
      valueOutMinorUnits: 40_000,
      destinationHoldingId: 'deposit',
      destinationType: 'term_deposit',
      valueInMinorUnits: 40_000,
      time: MOVED,
    });

  const setContributions = (contributions: unknown[]): void => {
    run(
      "UPDATE holdings SET metadata = json_set(metadata, '$.contributions', json(?)) WHERE id = 'deposit'",
      JSON.stringify(contributions),
    );
  };

  it('deletes the leg and removes the contribution dated at that instant', async () => {
    const before = stateOf();

    await exchangeIntoDeposit();
    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(stateOf()).toEqual(before);
  });

  it('says in the plan which deposit loses its contribution', async () => {
    await exchangeIntoDeposit();

    expect(await transactionsRepo.removePlan(idOfRowOn('uah'))).toEqual({
      split: false,
      deposit: { name: 'Deposit', matched: true },
    });
  });

  it('deletes only the leg and keeps the deposit when no contribution has that date', async () => {
    await exchangeIntoDeposit();
    const edited = [
      { amountMinorUnits: 500_000, date: OPENED },
      { amountMinorUnits: 40_000, date: MOVED + 1 },
    ];

    setContributions(edited);

    expect(await transactionsRepo.removePlan(idOfRowOn('uah'))).toEqual({
      split: false,
      deposit: { name: 'Deposit', matched: false },
    });

    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(balancesOf().uah).toBe(100_000);
    expect(contributionsOf('deposit')).toEqual(edited);
    expect(rowIds()).toEqual([]);
  });

  it('keeps the deposit when two contributions share the date', async () => {
    await exchangeIntoDeposit();
    const duplicated = [
      { amountMinorUnits: 500_000, date: OPENED },
      { amountMinorUnits: 40_000, date: MOVED },
      { amountMinorUnits: 40_000, date: MOVED },
    ];

    setContributions(duplicated);

    expect(await transactionsRepo.removePlan(idOfRowOn('uah'))).toEqual({
      split: false,
      deposit: { name: 'Deposit', matched: false },
    });

    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(contributionsOf('deposit')).toEqual(duplicated);
    expect(balancesOf().uah).toBe(100_000);
  });

  it('keeps the last contribution, because a deposit cannot have none', async () => {
    const only = [{ amountMinorUnits: 40_000, date: MOVED }];

    setContributions(only);
    setBalance('uah', 60_000);
    insertRow({
      id: 'deposit-source',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'deposit',
    });

    expect(await transactionsRepo.removePlan('deposit-source')).toEqual({
      split: false,
      deposit: { name: 'Deposit', matched: false },
    });

    await transactionsRepo.remove('deposit-source');

    expect(contributionsOf('deposit')).toEqual(only);
    expect(balancesOf().uah).toBe(100_000);
  });

  it('deletes the leg and leaves the deposit alone when its metadata cannot be read, as the confirm said', async () => {
    await exchangeIntoDeposit();
    run("UPDATE holdings SET metadata = '{}' WHERE id = 'deposit'");

    expect(await transactionsRepo.removePlan(idOfRowOn('uah'))).toEqual({
      split: false,
      deposit: { name: 'Deposit', matched: false },
    });

    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(rowIds()).toEqual([]);
    expect(balancesOf().uah).toBe(100_000);
    expect(
      (
        mockDatabase.prepare("SELECT metadata FROM holdings WHERE id = 'deposit'").get() as {
          metadata: string;
        }
      ).metadata,
    ).toBe('{}');
  });

  describe('converted again to a destination of its own', () => {
    const convertSourceLeg = async (): Promise<string> => {
      await exchangeIntoDeposit();
      const source = idOfRowOn('uah');

      await transactionsRepo.recordExchangeCounterpart({
        direction: 'record-destination',
        counterpartHoldingId: 'usd',
        counterpartType: 'card',
        amountMinorUnits: 1_000,
        existingTransactionId: source,
        existingHoldingId: 'uah',
        time: MOVED,
      });

      return source;
    };

    it('keeps the deposit marker on the source leg and gives the new leg the same pair id', async () => {
      const source = await convertSourceLeg();

      expect(rowOf(source)?.marker).toBe('deposit');
      expect(rowOf(idOfRowOn('usd'))?.pairId).toBe(rowOf(source)?.pairId);
    });

    it.each(['uah', 'usd'])(
      'deletes both legs and the contribution from the leg on %s',
      async (holdingId) => {
        const before = stateOf();

        await convertSourceLeg();
        await transactionsRepo.remove(idOfRowOn(holdingId));

        expect(stateOf()).toEqual(before);
      },
    );

    it('says in the plan of the new leg that the deposit loses its contribution', async () => {
      await convertSourceLeg();

      expect(await transactionsRepo.removePlan(idOfRowOn('usd'))).toEqual({
        split: false,
        exchange: { kind: 'deleted', names: ['Hryvnia card'] },
        deposit: { name: 'Deposit', matched: true },
      });
    });
  });
});

describe('deleting a leg of a Convert', () => {
  it('deletes the original expense with its new destination leg', async () => {
    const before = stateOf();

    await convertExpenseOfUah('usd', 'card', 1_000);
    await transactionsRepo.remove(idOfRowOn('usd'));

    expect(stateOf()).toEqual(before);
  });

  it('deletes the original income with its new source leg', async () => {
    const before = stateOf();

    await transactionsRepo.recordManual({
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      time: MOVED,
      category: 'salary',
    });
    const original = idOfRowOn('usd');

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-source',
      counterpartHoldingId: 'uah',
      counterpartType: 'card',
      amountMinorUnits: 40_000,
      existingTransactionId: original,
      existingHoldingId: 'usd',
      time: MOVED,
    });
    await transactionsRepo.remove(original);

    expect(stateOf()).toEqual(before);
  });

  it('writes the same pair id on the new leg and on the existing row', async () => {
    const original = await convertExpenseOfUah('usd', 'card', 1_000);

    expect(rowOf(original)?.pairId).not.toBeNull();
    expect(rowOf(idOfRowOn('usd'))?.pairId).toBe(rowOf(original)?.pairId);
  });

  it('writes the pair id on an existing bank row and, deleting the new leg, keeps the bank row', async () => {
    insertRow({ id: 'original', holdingId: 'bank', amountMinorUnits: -40_000, source: 'monobank' });

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'usd',
      counterpartType: 'card',
      amountMinorUnits: 1_000,
      existingTransactionId: 'original',
      existingHoldingId: 'bank',
      time: MOVED,
    });
    const newLeg = idOfRowOn('usd');

    expect(rowOf('original')?.pairId).toBe(rowOf(newLeg)?.pairId);
    expect(rowOf('original')?.marker).toBeNull();
    expect(await transactionsRepo.removePlan(newLeg)).toEqual({
      split: false,
      exchange: { kind: 'syncedKept', names: ['Monobank card'] },
    });

    await transactionsRepo.remove(newLeg);

    expect(rowIds()).toEqual(['original']);
    expect(rowOf('original')?.amount).toBe(-40_000);
    expect(balancesOf().usd).toBe(0);
  });

  it('names the legs that stay as well as the ones that go when a pair has a bank row and manual legs', async () => {
    insertRow({ id: 'original', holdingId: 'bank', amountMinorUnits: -40_000, source: 'monobank' });
    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'usd',
      counterpartType: 'card',
      amountMinorUnits: 1_000,
      existingTransactionId: 'original',
      existingHoldingId: 'bank',
      time: MOVED,
    });
    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-source',
      counterpartHoldingId: 'second',
      counterpartType: 'card',
      amountMinorUnits: 40_000,
      existingTransactionId: idOfRowOn('usd'),
      existingHoldingId: 'usd',
      time: MOVED,
    });
    const newestLeg = idOfRowOn('second');

    expect(await transactionsRepo.removePlan(newestLeg)).toEqual({
      split: false,
      exchange: { kind: 'deleted', names: ['Dollar card'], keptNames: ['Monobank card'] },
    });

    await transactionsRepo.remove(newestLeg);

    expect(rowIds()).toEqual(['original']);
    expect(balancesOf()).toMatchObject({ usd: 0, second: 0 });
  });

  it('marks an existing imported row as a leg and deletes it with the new leg', async () => {
    insertRow({ id: 'imported', holdingId: 'cash', amountMinorUnits: -40_000, source: 'import' });
    setBalance('cash', -40_000);

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'usd',
      counterpartType: 'card',
      amountMinorUnits: 1_000,
      existingTransactionId: 'imported',
      existingHoldingId: 'cash',
      time: MOVED,
    });

    expect(rowOf('imported')?.marker).toBe('usd');

    await transactionsRepo.remove(idOfRowOn('usd'));

    expect(rowIds()).toEqual([]);
    expect(balancesOf()).toMatchObject({ cash: 0, usd: 0 });
  });

  it('refuses to delete the bank row itself and changes nothing', async () => {
    insertRow({ id: 'original', holdingId: 'bank', amountMinorUnits: -40_000, source: 'monobank' });
    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'usd',
      counterpartType: 'card',
      amountMinorUnits: 1_000,
      existingTransactionId: 'original',
      existingHoldingId: 'bank',
      time: MOVED,
    });
    const before = stateOf();

    await expect(transactionsRepo.remove('original')).rejects.toThrow(/synced/);

    expect(stateOf()).toEqual(before);
  });

  it('deletes the expense and removes the deposit contribution when the Convert paid into a deposit', async () => {
    const before = stateOf();
    const original = await convertExpenseOfUah('deposit', 'term_deposit', 40_000);

    expect(rowOf(original)?.pairId).not.toBeNull();

    await transactionsRepo.remove(original);

    expect(stateOf()).toEqual(before);
  });

  it('puts a third leg in the same group when a leg is converted again, and deletes all three together', async () => {
    const before = stateOf();
    const original = await convertExpenseOfUah('usd', 'card', 1_000);
    const destination = idOfRowOn('usd');

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-source',
      counterpartHoldingId: 'second',
      counterpartType: 'card',
      amountMinorUnits: 40_000,
      existingTransactionId: destination,
      existingHoldingId: 'usd',
      time: MOVED,
    });

    const pairIds = [original, destination, idOfRowOn('second')].map((id) => rowOf(id)?.pairId);

    expect(rowIds()).toHaveLength(3);
    expect(new Set(pairIds).size).toBe(1);

    await transactionsRepo.remove(idOfRowOn('second'));

    expect(stateOf()).toEqual(before);
  });
});

describe('deleting a row of a split payment', () => {
  const splitPayment = (): Promise<void> =>
    transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'uah', amountMinorUnits: -50_000, time: MOVED, category: 'groceries' },
      returns: [
        { holdingId: 'cash', amountMinorUnits: 10_000 },
        { holdingId: 'second', amountMinorUnits: 5_000 },
      ],
    });

  it.each(['uah', 'cash'])('deletes the whole group from the row on %s', async (holdingId) => {
    const before = stateOf();

    await splitPayment();
    await transactionsRepo.remove(idOfRowOn(holdingId));

    expect(stateOf()).toEqual(before);
  });

  it('says in the plan that the whole split goes', async () => {
    await splitPayment();

    expect(await transactionsRepo.removePlan(idOfRowOn('cash'))).toEqual({ split: true });
  });

  it('keeps a member that is not manual and deletes the rest', async () => {
    await splitPayment();
    const group = (
      mockDatabase
        .prepare("SELECT change_group_id AS id FROM transactions WHERE holding_id = 'uah'")
        .get() as { id: string }
    ).id;

    insertRow({
      id: 'bank-member',
      holdingId: 'bank',
      amountMinorUnits: 100,
      source: 'monobank',
      changeGroupId: group,
    });
    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(rowIds()).toEqual(['bank-member']);
  });

  it('judges a member on a synced holding by the same boundary rule as any other', async () => {
    insertRow({
      id: 'bank-sync-row',
      holdingId: 'bank',
      amountMinorUnits: 700,
      time: MOVED + 1_000,
      source: 'monobank',
    });
    setBalance('bank', 700);
    const before = stateOf();

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'uah', amountMinorUnits: -50_000, time: MOVED, category: 'groceries' },
      returns: [{ holdingId: 'bank', amountMinorUnits: 50_000 }],
    });
    await transactionsRepo.remove(idOfRowOn('uah'));

    expect(stateOf()).toEqual(before);
    expect(balancesOf().bank).toBe(700);
  });
});

// Convert is allowed on a split row, so one delete has to follow the split group
// and the pair id for as long as either finds another row: reading them one hop
// leaves the converted payment's other leg (or the returns) behind, and a part
// of a movement left behind is money created or lost.
describe('deleting a part of a split payment that was converted', () => {
  const NAMES_IN_PLAN = ['Hryvnia card', 'Dollar card'];

  const splitThenConvertPayment = async (): Promise<void> => {
    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'uah', amountMinorUnits: -50_000, time: MOVED, category: 'groceries' },
      returns: [
        { holdingId: 'cash', amountMinorUnits: 10_000 },
        { holdingId: 'second', amountMinorUnits: 5_000 },
      ],
    });
    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'usd',
      counterpartType: 'card',
      amountMinorUnits: 1_000,
      existingTransactionId: idOfRowOn('uah'),
      existingHoldingId: 'uah',
      time: MOVED,
    });
  };

  it.each(['uah', 'cash', 'second', 'usd'])(
    'deletes the payment, the returns and the converted leg from the row on %s',
    async (holdingId) => {
      const before = stateOf();

      await splitThenConvertPayment();
      await transactionsRepo.remove(idOfRowOn(holdingId));

      expect(stateOf()).toEqual(before);
    },
  );

  it('names the split and both exchange legs in the plan of a return', async () => {
    await splitThenConvertPayment();

    expect(await transactionsRepo.removePlan(idOfRowOn('cash'))).toEqual({
      split: true,
      exchange: { kind: 'deleted', names: expect.arrayContaining(NAMES_IN_PLAN) },
    });
  });

  it('names the split and the payment in the plan of the converted leg', async () => {
    await splitThenConvertPayment();

    expect(await transactionsRepo.removePlan(idOfRowOn('usd'))).toEqual({
      split: true,
      exchange: { kind: 'deleted', names: ['Hryvnia card'] },
    });
  });

  it('keeps a bank-owned member of the group and deletes every user-owned part', async () => {
    await splitThenConvertPayment();
    const group = (
      mockDatabase
        .prepare("SELECT change_group_id AS id FROM transactions WHERE holding_id = 'uah'")
        .get() as { id: string }
    ).id;

    insertRow({
      id: 'bank-member',
      holdingId: 'bank',
      amountMinorUnits: 100,
      source: 'monobank',
      changeGroupId: group,
    });
    await transactionsRepo.remove(idOfRowOn('usd'));

    expect(rowIds()).toEqual(['bank-member']);
  });

  describe('written by the backfill of a database that predates the pair id', () => {
    const migratedSplitConvert = (): void => {
      mockDatabase = new DatabaseSync(':memory:');
      applyMigrationsThrough(mockDatabase, '0051_monobank_accounts_bank_id');
      mockDatabase.exec('PRAGMA foreign_keys = ON');
      seedFixture();
      insertRow({
        id: 'legacy-payment',
        holdingId: 'uah',
        amountMinorUnits: -50_000,
        exchangeCounterpartHoldingId: 'usd',
        changeGroupId: 'legacy-group',
      });
      insertRow({
        id: 'legacy-return',
        holdingId: 'cash',
        amountMinorUnits: 10_000,
        changeGroupId: 'legacy-group',
      });
      insertRow({
        id: 'legacy-converted',
        holdingId: 'usd',
        amountMinorUnits: 1_000,
        exchangeCounterpartHoldingId: 'uah',
      });
      setBalance('uah', 50_000);
      setBalance('cash', 10_000);
      setBalance('usd', 1_000);

      for (const statement of MIGRATION_0052_SQL.split('--> statement-breakpoint')) {
        mockDatabase.exec(statement);
      }
    };

    it.each(['legacy-return', 'legacy-converted', 'legacy-payment'])(
      'deletes the whole movement from %s',
      async (rowId) => {
        migratedSplitConvert();

        expect(rowOf('legacy-converted')?.pairId).toBe(rowOf('legacy-payment')?.pairId);

        await transactionsRepo.remove(rowId);

        expect(rowIds()).toEqual([]);
        expect(balancesOf()).toMatchObject({ uah: 100_000, cash: 0, usd: 0 });
      },
    );
  });
});

describe('deleting a row that is no part of a movement', () => {
  it('deletes only that row, with no plan', async () => {
    await transactionsRepo.recordManual({
      holdingId: 'uah',
      amountMinorUnits: -1_000,
      time: MOVED,
      category: 'groceries',
    });
    insertRow({ id: 'other', holdingId: 'cash', amountMinorUnits: 300 });
    const plain = idOfRowOn('uah');

    expect(await transactionsRepo.removePlan(plain)).toEqual({ split: false });

    await transactionsRepo.remove(plain);

    expect(rowIds()).toEqual(['other']);
    expect(balancesOf().uah).toBe(100_000);
  });

  it('deletes nothing and reports no plan for a missing id', async () => {
    await transactionsRepo.remove('missing');

    expect(await transactionsRepo.removePlan('missing')).toEqual({ split: false });
  });
});

describe('deleting after the movement is already gone', () => {
  it('does nothing when a leg is deleted a second time', async () => {
    await exchangeUahToUsd();
    const source = idOfRowOn('uah');
    const destination = idOfRowOn('usd');

    await transactionsRepo.remove(source);
    const after = stateOf();

    await transactionsRepo.remove(destination);
    await transactionsRepo.remove(source);

    expect(stateOf()).toEqual(after);
  });

  it('deletes just its own row when the partner was removed after the plan was read', async () => {
    await exchangeUahToUsd();
    const source = idOfRowOn('uah');

    await transactionsRepo.removePlan(source);
    run('DELETE FROM transactions WHERE id = ?', idOfRowOn('usd'));
    await transactionsRepo.remove(source);

    expect(rowIds()).toEqual([]);
    expect(balancesOf().uah).toBe(100_000);
  });
});

describe('a legacy leg written before the pair id existed', () => {
  const migratedLegacyDatabase = (seedRows: () => void): void => {
    mockDatabase = new DatabaseSync(':memory:');
    applyMigrationsThrough(mockDatabase, '0051_monobank_accounts_bank_id');
    mockDatabase.exec('PRAGMA foreign_keys = ON');
    seedFixture();
    seedRows();

    for (const statement of MIGRATION_0052_SQL.split('--> statement-breakpoint')) {
      mockDatabase.exec(statement);
    }
  };

  it('deletes both legs of a manual pair the backfill paired', async () => {
    migratedLegacyDatabase(() => {
      insertRow({
        id: 'legacy-out',
        holdingId: 'uah',
        amountMinorUnits: -40_000,
        exchangeCounterpartHoldingId: 'usd',
      });
      insertRow({
        id: 'legacy-in',
        holdingId: 'usd',
        amountMinorUnits: 1_000,
        exchangeCounterpartHoldingId: 'uah',
      });
      setBalance('uah', 60_000);
      setBalance('usd', 1_000);
    });

    await transactionsRepo.remove('legacy-in');

    expect(rowIds()).toEqual([]);
    expect(balancesOf()).toMatchObject({ uah: 100_000, usd: 0 });
  });

  it('keeps the bank row of a Convert the backfill paired and deletes the manual leg', async () => {
    migratedLegacyDatabase(() => {
      insertRow({
        id: 'legacy-leg',
        holdingId: 'usd',
        amountMinorUnits: 1_000,
        exchangeCounterpartHoldingId: 'bank',
      });
      insertRow({
        id: 'legacy-bank',
        holdingId: 'bank',
        amountMinorUnits: -40_000,
        source: 'monobank',
      });
      setBalance('usd', 1_000);
    });

    expect(await transactionsRepo.removePlan('legacy-leg')).toEqual({
      split: false,
      exchange: { kind: 'syncedKept', names: ['Monobank card'] },
    });

    await transactionsRepo.remove('legacy-leg');

    expect(rowIds()).toEqual(['legacy-bank']);
    expect(balancesOf().usd).toBe(0);
  });

  it('deletes only the row of a leg the backfill could not pair, and names the other holding', async () => {
    migratedLegacyDatabase(() => {
      insertRow({
        id: 'redated-out',
        holdingId: 'uah',
        amountMinorUnits: -40_000,
        exchangeCounterpartHoldingId: 'usd',
      });
      insertRow({
        id: 'redated-in',
        holdingId: 'usd',
        amountMinorUnits: 1_000,
        time: MOVED + 1,
        exchangeCounterpartHoldingId: 'uah',
      });
      setBalance('uah', 60_000);
      setBalance('usd', 1_000);
    });

    expect(await transactionsRepo.removePlan('redated-out')).toEqual({
      split: false,
      exchange: { kind: 'missing', name: 'Dollar card' },
    });

    await transactionsRepo.remove('redated-out');

    expect(rowIds()).toEqual(['redated-in']);
    expect(balancesOf()).toMatchObject({ uah: 100_000, usd: 1_000 });
  });

  it('deletes only the row whose marker names a holding that is gone, and names no holding', async () => {
    migratedLegacyDatabase(() => {
      insertRow({
        id: 'dangling',
        holdingId: 'uah',
        amountMinorUnits: -40_000,
        exchangeCounterpartHoldingId: 'deleted-holding',
      });
      setBalance('uah', 60_000);
    });

    expect(await transactionsRepo.removePlan('dangling')).toEqual({
      split: false,
      exchange: { kind: 'missing', name: undefined },
    });

    await transactionsRepo.remove('dangling');

    expect(rowIds()).toEqual([]);
    expect(balancesOf().uah).toBe(100_000);
  });
});
