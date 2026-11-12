// A balance read of a Bybit holding writes the ids of the rows that the new balance overwrote, in
// the same write as the balance. This file runs the repo's own upsert on a real migrated engine:
// the stored rows, the stored metadata and the statements the upsert sends are all read back.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import type { SyncedMetadataField } from '../holding-metadata';

import { holdingsRepo } from './holdings.repo';

const ACCOUNT_ID = 'acc-1';
const HOLDING_ID = 'h-1';
const BYBIT_KEY = 'BTC:unified';
const READ_AT = 2_000;
const BALANCE_MINOR_UNITS = 250;
const LEDGER_SIZE = 100_000;

type Parameter = string | number;

type Source = 'manual' | 'import' | 'monobank' | 'bybit' | 'binance' | 'btc_wallet';

const run = (statement: string, ...parameters: Parameter[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const seedHolding = (id: string, metadata: object): void => {
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
     VALUES (?, ?, 'Coin', 'crypto_asset', 'BTC', 100, ?)`,
    id,
    ACCOUNT_ID,
    JSON.stringify(metadata),
  );
};

const seedRow = (id: string, source: Source, holdingId = HOLDING_ID): void => {
  run(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
     VALUES (?, ?, 10, 1000, ?, ?)`,
    id,
    holdingId,
    source,
    `${source}:${id}`,
  );
};

const holdingBy = (field: SyncedMetadataField, key: string) =>
  mockDatabase
    .prepare(
      `SELECT balance_minor_units AS balance, metadata FROM holdings
       WHERE json_extract(metadata, ?) = ?`,
    )
    .get(`$.${field}`, key) as { balance: number; metadata: string };

const metadataBy = (field: SyncedMetadataField, key: string): unknown =>
  JSON.parse(holdingBy(field, key).metadata);

const bybitRead = () =>
  holdingsRepo.upsertExchangeMany([
    {
      accountId: ACCOUNT_ID,
      name: 'Bybit BTC',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: BALANCE_MINOR_UNITS,
      metadata: { syncedAt: READ_AT, balanceReadAt: READ_AT },
      metadataField: 'bybitAsset',
      metadataKey: BYBIT_KEY,
    },
  ]);

const upsertOf = (field: SyncedMetadataField, key: string) =>
  field === 'monobankId'
    ? holdingsRepo.upsertMonobankMany([
        {
          accountId: ACCOUNT_ID,
          name: 'Card',
          type: 'card',
          currency: 'UAH',
          balanceMinorUnits: BALANCE_MINOR_UNITS,
          metadata: { syncedAt: READ_AT },
          monobankId: key,
        },
      ])
    : holdingsRepo.upsertExchangeMany([
        {
          accountId: ACCOUNT_ID,
          name: 'Coin',
          type: 'crypto_asset',
          currency: 'BTC',
          balanceMinorUnits: BALANCE_MINOR_UNITS,
          metadata: { syncedAt: READ_AT, balanceReadAt: READ_AT },
          metadataField: field,
          metadataKey: key,
        },
      ]);

// The statements that a call sends to the open engine and that name the ledger table.
const statementsOnLedgerDuring = async (work: () => Promise<unknown>): Promise<string[]> => {
  const prepare = jest.spyOn(mockDatabase, 'prepare');

  await work();

  return prepare.mock.calls
    .map(([statement]) => statement)
    .filter((statement) => statement.includes('"transactions"'));
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  run("INSERT INTO accounts (id, name, kind) VALUES (?, 'Exchange', 'crypto')", ACCOUNT_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('holdingsRepo.upsertExchangeMany on a Bybit holding', () => {
  it('a read marks every row that is not a Bybit row, and no Bybit row', async () => {
    seedHolding(HOLDING_ID, { bybitAsset: BYBIT_KEY, syncedAt: 1_000, balanceReadAt: 1_000 });
    seedHolding('h-other', { bybitAsset: 'ETH:unified' });
    seedRow('row-c', 'manual');
    seedRow('row-a', 'import');
    seedRow('row-b', 'monobank');
    seedRow('row-d', 'bybit');
    seedRow('row-e', 'bybit');
    seedRow('row-other', 'manual', 'h-other');

    await bybitRead();

    expect(metadataBy('bybitAsset', BYBIT_KEY)).toEqual({
      bybitAsset: BYBIT_KEY,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-a', 'row-b', 'row-c'],
    });
    expect(holdingBy('bybitAsset', BYBIT_KEY).balance).toBe(BALANCE_MINOR_UNITS);
  });

  it('a second read adds a row typed since the first and drops a row that is gone', async () => {
    seedHolding(HOLDING_ID, {
      bybitAsset: BYBIT_KEY,
      balanceReadAt: 1_000,
      overwrittenRowIds: ['row-gone', 'row-kept'],
    });
    seedRow('row-kept', 'manual');
    seedRow('row-new', 'manual');

    await bybitRead();

    expect(metadataBy('bybitAsset', BYBIT_KEY)).toEqual({
      bybitAsset: BYBIT_KEY,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-kept', 'row-new'],
    });
  });

  it("Bybit's first read marks every row that is not a bybit row and writes no kept list", async () => {
    seedHolding(HOLDING_ID, { bybitAsset: BYBIT_KEY, syncedAt: 1_000 });
    seedRow('row-typed', 'manual');
    seedRow('row-import', 'import');
    seedRow('row-fill', 'bybit');

    await bybitRead();

    expect(metadataBy('bybitAsset', BYBIT_KEY)).toEqual({
      bybitAsset: BYBIT_KEY,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-import', 'row-typed'],
    });
  });

  it('a read of a holding that stores a kept list never reads it: its rows are marked, no list stays', async () => {
    seedHolding(HOLDING_ID, {
      bybitAsset: BYBIT_KEY,
      balanceReadAt: 1_000,
      keptRowIds: ['row-typed'],
    });
    seedRow('row-typed', 'manual');

    await bybitRead();

    expect(metadataBy('bybitAsset', BYBIT_KEY)).toEqual({
      bybitAsset: BYBIT_KEY,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-typed'],
    });
  });

  it('a read with no such row writes no key, and the old list does not stay', async () => {
    seedHolding(HOLDING_ID, {
      bybitAsset: BYBIT_KEY,
      balanceReadAt: 1_000,
      overwrittenRowIds: ['row-gone'],
    });
    seedRow('row-walk', 'bybit');

    await bybitRead();

    expect(metadataBy('bybitAsset', BYBIT_KEY)).toEqual({
      bybitAsset: BYBIT_KEY,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
    });
  });

  it('a new holding gets no key, whatever rows other holdings hold', async () => {
    seedHolding('h-other', { bybitAsset: 'ETH:unified' });
    seedRow('row-other', 'manual', 'h-other');

    await bybitRead();

    expect(metadataBy('bybitAsset', BYBIT_KEY)).toEqual({
      bybitAsset: BYBIT_KEY,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
    });
  });

  it('a read of an existing holding sends one statement on the ledger table', async () => {
    seedHolding(HOLDING_ID, { bybitAsset: BYBIT_KEY, balanceReadAt: 1_000 });
    seedRow('row-typed', 'manual');

    expect(await statementsOnLedgerDuring(bybitRead)).toHaveLength(1);
  });

  it('a holding of 100,000 typed rows takes all of them in one list', async () => {
    seedHolding(HOLDING_ID, { bybitAsset: BYBIT_KEY, balanceReadAt: 1_000 });
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
       WITH RECURSIVE counter(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < ${LEDGER_SIZE}
       )
       SELECT printf('row-%06d', value), ?, 10, 1000, 'manual' FROM counter`,
      HOLDING_ID,
    );

    await bybitRead();

    const { overwrittenRowIds } = metadataBy('bybitAsset', BYBIT_KEY) as {
      overwrittenRowIds: string[];
    };

    expect(overwrittenRowIds).toHaveLength(LEDGER_SIZE);
    expect(overwrittenRowIds.at(0)).toBe('row-000001');
    expect(overwrittenRowIds.at(-1)).toBe('row-100000');
  });
});

describe('holdingsRepo.upsertExchangeMany on a Binance or a wallet holding', () => {
  const DATED = [
    ['Binance', 'binanceAsset', 'BTC', 'binance'],
    ['wallet', 'walletAddress', 'bc1q', 'btc_wallet'],
  ] as const;

  const seedDated = (field: SyncedMetadataField, key: string): void => {
    seedHolding(HOLDING_ID, { [field]: key, syncedAt: 1_000, balanceReadAt: 1_000 });
  };

  it.each(DATED)('a read marks every row that is not a %s row', async (_, field, key, source) => {
    seedDated(field, key);
    seedHolding('h-other', { [field]: `${key}-other` });
    seedRow('row-c', 'manual');
    seedRow('row-a', 'import');
    seedRow('row-b', 'monobank');
    seedRow('row-d', source);
    seedRow('row-other', 'manual', 'h-other');

    await upsertOf(field, key);

    expect(metadataBy(field, key)).toEqual({
      [field]: key,
      syncedAt: READ_AT,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-a', 'row-b', 'row-c'],
    });
    expect(holdingBy(field, key).balance).toBe(BALANCE_MINOR_UNITS);
  });

  it.each(DATED)(
    'the first dated read of a shipped %s holding writes the date and keeps the ids of its typed rows, with no mark',
    async (_, field, key) => {
      seedHolding(HOLDING_ID, { [field]: key, syncedAt: 1_000 });
      seedRow('row-typed', 'manual');

      expect(await statementsOnLedgerDuring(() => upsertOf(field, key))).toHaveLength(1);
      expect(metadataBy(field, key)).toEqual({
        [field]: key,
        syncedAt: READ_AT,
        balanceReadAt: READ_AT,
        keptRowIds: ['row-typed'],
      });
      expect(holdingBy(field, key).balance).toBe(BALANCE_MINOR_UNITS);
    },
  );

  it.each(DATED)(
    'a later read of a %s holding marks only the rows off its kept list and prunes a gone id',
    async (_, field, key, source) => {
      seedHolding(HOLDING_ID, {
        [field]: key,
        syncedAt: 1_000,
        balanceReadAt: 1_000,
        keptRowIds: ['row-gone', 'row-old'],
      });
      seedRow('row-old', 'manual');
      seedRow('row-new', 'manual');
      seedRow('row-import', 'import');
      seedRow('row-source', source);

      await upsertOf(field, key);

      expect(metadataBy(field, key)).toEqual({
        [field]: key,
        syncedAt: READ_AT,
        balanceReadAt: READ_AT,
        overwrittenRowIds: ['row-import', 'row-new'],
        keptRowIds: ['row-old'],
      });
    },
  );

  it.each(DATED)(
    'a read of an existing %s holding sends one statement on the ledger table',
    async (_, field, key) => {
      seedDated(field, key);
      seedRow('row-typed', 'manual');

      expect(await statementsOnLedgerDuring(() => upsertOf(field, key))).toHaveLength(1);
    },
  );

  it.each(DATED)(
    'a read of an existing %s holding sends four statements in all, the read of the ledger one of them',
    async (_, field, key) => {
      seedDated(field, key);
      seedRow('row-typed', 'manual');

      const prepare = jest.spyOn(mockDatabase, 'prepare');

      await upsertOf(field, key);

      expect(prepare).toHaveBeenCalledTimes(4);
    },
  );

  it.each(DATED)(
    'a %s holding of 100,000 typed rows takes all of them in one list',
    async (_, field, key) => {
      seedDated(field, key);
      run(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
         WITH RECURSIVE counter(value) AS (
           SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < ${LEDGER_SIZE}
         )
         SELECT printf('row-%06d', value), ?, 10, 1000, 'manual' FROM counter`,
        HOLDING_ID,
      );

      await upsertOf(field, key);

      const { overwrittenRowIds } = metadataBy(field, key) as { overwrittenRowIds: string[] };

      expect(overwrittenRowIds).toHaveLength(LEDGER_SIZE);
      expect(overwrittenRowIds.at(0)).toBe('row-000001');
      expect(overwrittenRowIds.at(-1)).toBe('row-100000');
    },
  );
});

describe('holdingsRepo.upsertMonobankMany on a Monobank card', () => {
  const CARD_KEY = 'card-1';

  const cardRead = () =>
    holdingsRepo.upsertMonobankMany([
      {
        accountId: ACCOUNT_ID,
        name: 'Card',
        type: 'card',
        currency: 'UAH',
        balanceMinorUnits: BALANCE_MINOR_UNITS,
        metadata: { balanceReadAt: READ_AT },
        monobankId: CARD_KEY,
      },
    ]);

  it('a read marks the manual rows alone, and neither an import row nor a card payment', async () => {
    seedHolding(HOLDING_ID, { monobankId: CARD_KEY, balanceReadAt: 1_000 });
    seedRow('row-typed-b', 'manual');
    seedRow('row-typed-a', 'manual');
    seedRow('row-import', 'import');
    seedRow('row-payment', 'monobank');

    await cardRead();

    expect(metadataBy('monobankId', CARD_KEY)).toEqual({
      monobankId: CARD_KEY,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-typed-a', 'row-typed-b'],
    });
    expect(holdingBy('monobankId', CARD_KEY).balance).toBe(BALANCE_MINOR_UNITS);
  });

  it('the first dated read of a shipped card keeps the ids of its manual rows with no mark, in one statement on the ledger', async () => {
    seedHolding(HOLDING_ID, { monobankId: CARD_KEY });
    seedRow('row-typed', 'manual');
    seedRow('row-import', 'import');
    seedRow('row-payment', 'monobank');

    expect(await statementsOnLedgerDuring(cardRead)).toHaveLength(1);
    expect(metadataBy('monobankId', CARD_KEY)).toEqual({
      monobankId: CARD_KEY,
      balanceReadAt: READ_AT,
      keptRowIds: ['row-typed'],
    });
  });

  it('a later read marks only the manual rows off its kept list and prunes a gone id', async () => {
    seedHolding(HOLDING_ID, {
      monobankId: CARD_KEY,
      balanceReadAt: 1_000,
      keptRowIds: ['row-gone', 'row-old'],
    });
    seedRow('row-old', 'manual');
    seedRow('row-new', 'manual');
    seedRow('row-import', 'import');
    seedRow('row-payment', 'monobank');

    await cardRead();

    expect(metadataBy('monobankId', CARD_KEY)).toEqual({
      monobankId: CARD_KEY,
      balanceReadAt: READ_AT,
      overwrittenRowIds: ['row-new'],
      keptRowIds: ['row-old'],
    });
  });

  it('a card that a read creates gets no key', async () => {
    seedHolding('h-other', { monobankId: 'card-other' });
    seedRow('row-other', 'manual', 'h-other');

    await cardRead();

    expect(metadataBy('monobankId', CARD_KEY)).toEqual({
      monobankId: CARD_KEY,
      balanceReadAt: READ_AT,
    });
  });
});

describe('a holding that is not Bybit, Binance or a wallet', () => {
  it('Monobank makes no read of the rows and gets no new key', async () => {
    seedHolding('h-kind', { monobankId: 'card-1', syncedAt: 1_000 });
    seedRow('row-typed', 'manual', 'h-kind');

    expect(await statementsOnLedgerDuring(() => upsertOf('monobankId', 'card-1'))).toEqual([]);
    expect(metadataBy('monobankId', 'card-1')).toEqual({ monobankId: 'card-1', syncedAt: READ_AT });
    expect(holdingBy('monobankId', 'card-1').balance).toBe(BALANCE_MINOR_UNITS);
  });
});
