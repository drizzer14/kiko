// A Binance disconnect resets the walk state and clears the institution in ONE write. A walk
// patch can be queued between two writes, and a write that fails halfway must not leave the
// reset behind a still-connected account; only a real engine with op-sqlite's one worker
// queue shows either.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);
  // op-sqlite runs one write at a time: a write issued while another runs waits for its commit.
  let queue: Promise<unknown> = Promise.resolve();
  const write = <T>(work: (database: unknown) => Promise<T>): Promise<T> => {
    const run = queue.then(() => client.write(work));

    queue = run.catch(() => undefined);

    return run;
  };

  return { database: client.database, write };
});

import { DatabaseSync } from 'node:sqlite';
import { syncStateRepo } from '@kiko/sync-state';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import type { ExchangeStatePatch } from '@kiko/crypto-sync/exchange/walk-state';

import { accountsRepo } from './accounts.repo';

const FLOOR_MS = 1;

const CONNECTED_STATE = JSON.stringify({
  version: 1,
  walks: {
    capital: { cursor: 500 },
    pay: { cursor: 700, pending: [{ start: 100, end: 200 }] },
  },
  untrackedCoins: { balance: ['AAA'], history: ['BBB'] },
});

const RESET_STATE = {
  version: 1,
  walks: { capital: { cursor: FLOOR_MS }, pay: { cursor: FLOOR_MS, pending: [] } },
};

const LATE_PATCHES: [string, ExchangeStatePatch][] = [
  ['a cursor', { kind: 'walk', walkId: 'capital', field: 'cursor', value: 999_999 }],
  [
    'a pending list',
    { kind: 'walk', walkId: 'pay', field: 'pending', value: [{ start: 300, end: 400 }] },
  ],
  [
    'a history coin list',
    { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['ZZZ'] },
  ],
];

const seedAccount = (institution: string | null, exchangeState: string): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', ?)",
    )
    .run(institution);
  mockDatabase
    .prepare("INSERT INTO sync_state (account_id, exchange_state) VALUES ('acc-1', ?)")
    .run(exchangeState);
};

const institutionOf = (): string | null =>
  (
    mockDatabase.prepare("SELECT institution FROM accounts WHERE id = 'acc-1'").get() as {
      institution: string | null;
    }
  ).institution;

const exchangeStateText = (): string =>
  (
    mockDatabase
      .prepare("SELECT exchange_state FROM sync_state WHERE account_id = 'acc-1'")
      .get() as { exchange_state: string }
  ).exchange_state;

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
});

describe('accountsRepo.disconnectExchange', () => {
  it('resets the walks to the floor and clears the institution', async () => {
    seedAccount('binance', CONNECTED_STATE);

    await accountsRepo.disconnectExchange('acc-1', 'binance', FLOOR_MS);

    expect(institutionOf()).toBeNull();
    expect(JSON.parse(exchangeStateText())).toEqual(RESET_STATE);
  });

  it('drops the synced stamp of a holding, as disconnect does', async () => {
    seedAccount('binance', CONNECTED_STATE);
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(JSON.stringify({ binanceAsset: 'BTC', syncedAt: 123 }));

    await accountsRepo.disconnectExchange('acc-1', 'binance', FLOOR_MS);

    expect(
      JSON.parse(
        (
          mockDatabase.prepare("SELECT metadata FROM holdings WHERE id = 'h-spot'").get() as {
            metadata: string;
          }
        ).metadata,
      ),
    ).toEqual({ binanceAsset: 'BTC' });
  });

  it.each(LATE_PATCHES)(
    'a walk patch issued after the reset began is not kept once the account disconnects: %s',
    async (_title, latePatch) => {
      seedAccount('binance', CONNECTED_STATE);

      // The walk's patch is queued behind the disconnect's write, as a walk that started before
      // the disconnect would issue it.
      await Promise.all([
        accountsRepo.disconnectExchange('acc-1', 'binance', FLOOR_MS),
        syncStateRepo.patchExchangeState('acc-1', 'binance', [latePatch]),
      ]);

      expect(institutionOf()).toBeNull();
      expect(JSON.parse(exchangeStateText())).toEqual(RESET_STATE);
    },
  );

  it.each(LATE_PATCHES)(
    'a walk patch queued before the disconnect is reset with the rest: %s',
    async (_title, earlyPatch) => {
      seedAccount('binance', CONNECTED_STATE);

      await Promise.all([
        syncStateRepo.patchExchangeState('acc-1', 'binance', [earlyPatch]),
        accountsRepo.disconnectExchange('acc-1', 'binance', FLOOR_MS),
      ]);

      expect(institutionOf()).toBeNull();
      expect(JSON.parse(exchangeStateText())).toEqual(RESET_STATE);
    },
  );

  it('keeps the walk state and the institution when the clear fails', async () => {
    seedAccount('binance', CONNECTED_STATE);
    mockDatabase.exec(
      `CREATE TRIGGER accounts_clear_fails BEFORE UPDATE OF institution ON accounts
       BEGIN SELECT RAISE(ABORT, 'the clear failed'); END`,
    );

    await expect(
      accountsRepo.disconnectExchange('acc-1', 'binance', FLOOR_MS),
    ).rejects.toHaveProperty('cause.message', expect.stringContaining('the clear failed'));

    expect(institutionOf()).toBe('binance');
    expect(exchangeStateText()).toBe(CONNECTED_STATE);
  });

  it('leaves the walk state of an account that already left the exchange as it is', async () => {
    seedAccount(null, CONNECTED_STATE);

    await accountsRepo.disconnectExchange('acc-1', 'binance', FLOOR_MS);

    expect(institutionOf()).toBeNull();
    expect(exchangeStateText()).toBe(CONNECTED_STATE);
  });
});
