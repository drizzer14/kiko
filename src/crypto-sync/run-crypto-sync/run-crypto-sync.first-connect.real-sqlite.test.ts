// `run-crypto-sync.test.ts` fakes the repos. This file runs the Binance arm over the REAL repos
// on a real `node:sqlite` engine (the shipped migrations), where a coin-list write finds the
// account connected to Binance only once the sync has marked it: on the first Connect the
// account has no institution until then, so a list written before the mark is silently dropped.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

const mockFetchAccount = jest.fn();
jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.client'),
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
  fetchFundingAsset: async () => [],
  fetchFlexiblePosition: async () => ({ rows: [], total: 0 }),
  fetchLockedPosition: async () => ({ rows: [], total: 0 }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.credentials'),
  readCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transactions', () => ({
  syncBinanceTransactions: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.pay-history', () => ({
  syncBinancePayHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transfer-history', () => ({
  syncBinanceTransferHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.earn-history', () => ({
  syncBinanceEarnHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import { runCryptoSync } from './run-crypto-sync';

const OVERSIZED = '90071992.54740992';

const storedState = (accountId: string): string | null => {
  const row = mockDatabase
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(accountId) as { exchange_state: string | null } | undefined;

  return row?.exchange_state ?? null;
};

const listsOf = (accountId: string) => {
  const state = parseExchangeState(storedState(accountId));

  if (state.kind === 'malformed') {
    throw new Error('the stored state should read');
  }

  return { untracked: state.untrackedCoins.balance, oversized: state.oversizedCoins.balance };
};

// A refused coin amount logs its skip through the one console sink.
let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)')
    .run('acc-new', 'My Binance', 'crypto');
  mockFetchAccount.mockResolvedValue({
    balances: [
      { asset: 'PEPE', free: '1000', locked: '0' },
      { asset: 'ETH', free: OVERSIZED, locked: '0' },
      { asset: 'USDT', free: '5', locked: '0' },
    ],
    uid: null,
  });
});

afterEach(() => {
  warn.mockRestore();
  mockDatabase.close();
});

describe('runCryptoSync — the Binance arm over a real database', () => {
  it('the first Connect sync shows both lists', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-new' });

    expect(listsOf('acc-new')).toEqual({ untracked: ['PEPE'], oversized: ['ETH'] });
    expect(warn).toHaveBeenCalledWith('[binance sync] a coin amount was refused', {
      wallet: 'spot',
    });
  });

  it('a re-sync of a connected account replaces both lists', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-new' });
    mockFetchAccount.mockResolvedValue({
      balances: [{ asset: 'ABC', free: '1', locked: '0' }],
      uid: null,
    });

    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-new' });

    expect(listsOf('acc-new')).toEqual({ untracked: ['ABC'], oversized: [] });
  });
});
