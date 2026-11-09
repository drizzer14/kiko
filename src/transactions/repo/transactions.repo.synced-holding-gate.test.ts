// A holding that a sync owns right now takes no manual row: `recordManualTransaction` refuses it
// before the insert, and a refusal rolls back the whole write of the caller. This file
// runs the real repo on a migrated engine: each case reads back the balances and the rows, and
// the disconnect is the one the app runs for the kind.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.credentials'),
  clearCredentials: async () => undefined,
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/bybit/bybit.credentials'),
  clearBybitCredentials: async () => undefined,
}));

import { DatabaseSync } from 'node:sqlite';
import { accountsRepo } from '@kiko/accounts';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { MOVED, deleteCascadeFixture } from '@kiko/test-support/delete-cascade-fixture';

import { transactionsRepo } from './transactions.repo';

const { run, insertHolding, insertRow, balancesOf, rowIds } = deleteCascadeFixture(
  () => mockDatabase,
);

const SYNCED_ACCOUNT = 'synced-account';
const PLAIN_ACCOUNT = 'plain-account';
const SYNCED = 'synced';
const CASH = 'cash';
const OPENING = 100_000;
const AMOUNT = 5_000;
const REFUSAL = 'transactions/synced-holding';

// Each kind is its key in the holding's metadata and the institution that owns the key while the
// account is connected: a connect writes both.
const KINDS = [
  ['bybitAsset', 'bybit', 'crypto_asset', 'BTC'],
  ['binanceAsset', 'binance', 'crypto_asset', 'BTC'],
  ['monobankId', 'monobank', 'card', 'UAH'],
  ['walletAddress', 'btc_wallet', 'crypto_asset', 'BTC'],
] as const;

type Institution = (typeof KINDS)[number][1];

// The disconnect the app runs for the kind: Monobank's is `accountsRepo.disconnect`, the rest go
// through `disconnectCryptoAccount`.
const disconnect = (institution: Institution): Promise<void> =>
  institution === 'monobank'
    ? accountsRepo.disconnect(SYNCED_ACCOUNT)
    : disconnectCryptoAccount(SYNCED_ACCOUNT, institution satisfies BalanceProviderId);

// A Monobank connect lands on a bank account, the other kinds on a crypto account.
const accountKindOf = (institution: string | null): string =>
  institution === 'monobank' ? 'bank' : 'crypto';

const seedAccounts = (institution: string | null, kind = accountKindOf(institution)): void => {
  run(
    'INSERT INTO accounts (id, name, kind, institution) VALUES (?, ?, ?, ?)',
    SYNCED_ACCOUNT,
    'Synced',
    kind,
    institution,
  );
  run(`INSERT INTO accounts (id, name, kind) VALUES ('${PLAIN_ACCOUNT}', 'Plain', 'cash')`);
};

const seedCash = (): void => {
  insertHolding(CASH, 'cash', 'UAH', OPENING, { accountId: PLAIN_ACCOUNT });
};

// A connected holding of the kind, and a cash holding on a plain account.
const seedConnected = (
  key: string,
  institution: string,
  type: string,
  currency: string,
  metadata: object = { [key]: 'synced-key' },
): void => {
  seedAccounts(institution);
  insertHolding(SYNCED, type, currency, OPENING, { accountId: SYNCED_ACCOUNT, metadata });
  seedCash();
};

const typedRow = (holdingId: string) =>
  transactionsRepo.recordManual({ holdingId, amountMinorUnits: AMOUNT, time: MOVED });

const accountReadsDuring = async (work: () => Promise<unknown>): Promise<number> => {
  const prepare = jest.spyOn(mockDatabase, 'prepare');

  await work();

  return prepare.mock.calls.filter(([statement]) => statement.includes('"accounts"')).length;
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('recordManual on a holding a sync owns', () => {
  it.each(KINDS)('%s refuses a manual row while connected, and writes nothing', async (...kind) => {
    seedConnected(...kind);
    const balances = balancesOf();

    await expect(typedRow(SYNCED)).rejects.toThrow(new Error(REFUSAL));

    expect(balancesOf()).toEqual(balances);
    expect(rowIds()).toEqual([]);
  });

  it.each(KINDS)(
    '%s takes the row after its real disconnect, and the balance moves',
    async (key, institution, type, currency) => {
      seedConnected(key, institution, type, currency);
      await disconnect(institution);

      await typedRow(SYNCED);

      expect(balancesOf()[SYNCED]).toBe(OPENING + AMOUNT);
      expect(rowIds()).toHaveLength(1);
    },
  );

  // The key of a provider that the account used before: a disconnect keeps it, and no sync writes
  // the holding while the account is connected to another provider.
  it.each([
    ['binanceAsset', 'btc_wallet'],
    ['walletAddress', 'binance'],
  ] as const)(
    '%s takes a manual row while the account is connected to %s, and the balance moves',
    async (key, institution) => {
      seedConnected(key, institution, 'crypto_asset', 'BTC');

      await typedRow(SYNCED);

      expect(balancesOf()[SYNCED]).toBe(OPENING + AMOUNT);
      expect(rowIds()).toHaveLength(1);
    },
  );

  it('a holding with no synced key on a connected account takes the row, with no read of the account', async () => {
    seedConnected('iban', 'monobank', 'card', 'UAH', { iban: 'UA00' });

    const reads = await accountReadsDuring(() => typedRow(SYNCED));

    expect(balancesOf()[SYNCED]).toBe(OPENING + AMOUNT);
    expect(reads).toBe(0);
  });

  it('a keyed holding on a plain account takes the row after one read of the account', async () => {
    seedAccounts(null, 'bank');
    insertHolding(SYNCED, 'card', 'UAH', OPENING, {
      accountId: SYNCED_ACCOUNT,
      metadata: { monobankId: 'synced-key' },
    });

    const reads = await accountReadsDuring(() => typedRow(SYNCED));

    expect(balancesOf()[SYNCED]).toBe(OPENING + AMOUNT);
    expect(reads).toBe(1);
  });

  it('an Exchange leg onto a connected holding rolls the whole write back', async () => {
    seedConnected('bybitAsset', 'bybit', 'crypto_asset', 'BTC');
    const balances = balancesOf();

    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: CASH,
        valueOutMinorUnits: AMOUNT,
        destinationHoldingId: SYNCED,
        destinationType: 'crypto_asset',
        valueInMinorUnits: 1,
        time: MOVED,
      }),
    ).rejects.toThrow(new Error(REFUSAL));

    expect(balancesOf()).toEqual(balances);
    expect(rowIds()).toEqual([]);
  });

  it("a split's return onto a connected holding rolls the whole write back", async () => {
    seedConnected('monobankId', 'monobank', 'card', 'UAH');
    const balances = balancesOf();

    await expect(
      transactionsRepo.recordManualWithReturns({
        payment: { holdingId: CASH, amountMinorUnits: -AMOUNT, time: MOVED },
        returns: [{ holdingId: SYNCED, amountMinorUnits: 1_000 }],
      }),
    ).rejects.toThrow(new Error(REFUSAL));

    expect(balancesOf()).toEqual(balances);
    expect(rowIds()).toEqual([]);
  });
});

describe('recordExchangeCounterpart on a connected holding', () => {
  const convertOnto = (counterpartHoldingId: string, existingHoldingId = CASH) =>
    transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId,
      counterpartType: 'crypto_asset',
      amountMinorUnits: 1,
      existingTransactionId: 'existing',
      existingHoldingId,
      time: MOVED,
    });

  const pairIdOfExisting = (): unknown =>
    (
      mockDatabase
        .prepare("SELECT exchange_pair_id AS value FROM transactions WHERE id = 'existing'")
        .get() as { value: unknown }
    ).value;

  it.each(KINDS)(
    '%s: a Convert leg onto a connected holding gets the same refusal, and writes nothing',
    async (...kind) => {
      seedConnected(...kind);
      insertRow({ id: 'existing', holdingId: CASH, amountMinorUnits: -AMOUNT });
      const balances = balancesOf();

      await expect(convertOnto(SYNCED)).rejects.toThrow(new Error(REFUSAL));

      expect(balancesOf()).toEqual(balances);
      expect(rowIds()).toEqual(['existing']);
      expect(pairIdOfExisting()).toBeNull();
    },
  );

  it("a Convert leg onto a holding with an earlier provider's key saves", async () => {
    seedConnected('binanceAsset', 'btc_wallet', 'crypto_asset', 'BTC');
    insertRow({ id: 'existing', holdingId: CASH, amountMinorUnits: -AMOUNT });

    await convertOnto(SYNCED);

    expect(rowIds()).toHaveLength(2);
    expect(balancesOf()[SYNCED]).toBe(OPENING + 1);
    expect(pairIdOfExisting()).not.toBeNull();
  });

  it("a Convert from a row on a connected holding still saves: one new row on the other holding, and the connected holding's balance stays", async () => {
    seedConnected('monobankId', 'monobank', 'card', 'UAH');
    insertRow({ id: 'existing', holdingId: SYNCED, amountMinorUnits: -AMOUNT, source: 'monobank' });

    await convertOnto(CASH, SYNCED);

    expect(rowIds()).toHaveLength(2);
    expect(balancesOf()).toEqual({ [SYNCED]: OPENING, [CASH]: OPENING + 1 });
    expect(pairIdOfExisting()).not.toBeNull();
  });
});
