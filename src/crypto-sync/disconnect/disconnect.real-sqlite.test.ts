// The unit test in `disconnect.test.ts` fakes the repos. This file runs the disconnect over the
// REAL repos on a real `node:sqlite` engine (the shipped migrations), where the walk state, the
// institution, the holdings and the rows it must leave alone all sit side by side.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () =>
  require('./disconnect.test-fixtures').binanceCredentialsModule(),
);
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () =>
  require('./disconnect.test-fixtures').bybitCredentialsModule(),
);

import { DatabaseSync } from 'node:sqlite';
import {
  NOT_IMPORTED_KINDS,
  notImportedEntry,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';
import { HISTORY_FLOOR_MS } from '@kiko/crypto-sync/binance';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import { disconnectCryptoAccount } from './disconnect';
import { mockClearBybitCredentials, mockClearCredentials } from './disconnect.test-fixtures';

const NOW = 1_800_000_000_000;

const rowCount = (table: string): number =>
  (mockDatabase.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;

const storedState = (): string =>
  (
    mockDatabase
      .prepare("SELECT exchange_state FROM sync_state WHERE account_id = 'acc-1'")
      .get() as { exchange_state: string }
  ).exchange_state;

const institutionOfAccount = (): string | null =>
  (
    mockDatabase.prepare("SELECT institution FROM accounts WHERE id = 'acc-1'").get() as {
      institution: string | null;
    }
  ).institution;

const connectedBinanceAccount = (): void => {
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(
    "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Binance', 'crypto', 'binance')",
  );
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('h-spot', 'acc-1', 'Binance Spot', 'crypto_asset', 'BTC', 100, ?)`,
    )
    .run(JSON.stringify({ binanceAsset: 'BTC', syncedAt: NOW }));
  mockDatabase.exec(
    `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
     VALUES ('t-1', 'h-spot', 50, 1, 'binance', 'acc-1:deposit:1')`,
  );
  seedWalkMarks(mockDatabase, 'acc-1', 'capital', { cursor: NOW });
  seedWalkMarks(mockDatabase, 'acc-1', 'pay', {
    cursor: NOW,
    rescan: NOW - 1,
    pending: [{ start: 5, end: 7 }],
    pointCursor: 6,
  });
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockClearCredentials.mockClear();
  mockClearBybitCredentials.mockClear();
});

describe('disconnectCryptoAccount over the real repos', () => {
  it('for Binance, resets every walk to the floor and keeps the holdings and the rows', async () => {
    connectedBinanceAccount();

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(walkMarksOf(mockDatabase, 'acc-1', 'capital')).toEqual({ cursor: HISTORY_FLOOR_MS });
    expect(walkMarksOf(mockDatabase, 'acc-1', 'pay')).toEqual({
      cursor: HISTORY_FLOOR_MS,
      rescan: HISTORY_FLOOR_MS,
      pending: [],
    });
    expect(institutionOfAccount()).toBeNull();
    expect(rowCount('holdings')).toBe(1);
    expect(rowCount('transactions')).toBe(1);
    expect(mockClearCredentials).toHaveBeenCalledWith('acc-1');
  });

  it('for Bybit, resets the walks to its restart floor, drops the lists and keeps the holdings', async () => {
    mockDatabase.exec('PRAGMA foreign_keys = ON;');
    mockDatabase.exec(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Bybit', 'crypto', 'bybit')",
    );
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-unified', 'acc-1', 'Bybit BTC', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(JSON.stringify({ bybitAsset: 'BTC:unified', syncedAt: NOW }));
    seedWalkMarks(mockDatabase, 'acc-1', 'capital', { cursor: NOW });
    mockDatabase.prepare("UPDATE sync_state SET exchange_state = ? WHERE account_id = 'acc-1'").run(
      JSON.stringify({
        ...JSON.parse(storedState()),
        untrackedCoins: { balance: ['PEPE'] },
        balanceSyncedAt: NOW,
      }),
    );
    expect(storedState()).toContain('PEPE');

    await disconnectCryptoAccount('acc-1', 'bybit');

    expect(storedState()).not.toContain('PEPE');
    expect(storedState()).not.toContain('balanceSyncedAt');
    expect(walkMarksOf(mockDatabase, 'acc-1', 'capital')).toEqual({
      cursor: Date.UTC(2017, 0, 1),
    });
    expect(institutionOfAccount()).toBeNull();
    expect(rowCount('holdings')).toBe(1);
    expect(mockClearBybitCredentials).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  // The read time is what lets the line tell "read, and its rows count" from "never read" once the
  // stamp is gone, so a disconnect must leave it with the key.
  it('a disconnect keeps the read time of a Bybit holding and drops its stamp', async () => {
    mockDatabase.exec('PRAGMA foreign_keys = ON;');
    mockDatabase.exec(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Bybit', 'crypto', 'bybit')",
    );
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-unified', 'acc-1', 'Bybit BTC', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(JSON.stringify({ bybitAsset: 'BTC:unified', syncedAt: NOW, balanceReadAt: NOW }));
    mockDatabase.exec(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
       VALUES ('t-1', 'h-unified', 50, ${NOW - 1}, 'bybit', 'acc-1:fill:1')`,
    );

    await disconnectCryptoAccount('acc-1', 'bybit');

    const { metadata } = mockDatabase
      .prepare("SELECT metadata FROM holdings WHERE id = 'h-unified'")
      .get() as { metadata: string };

    expect(JSON.parse(metadata)).toEqual({ bybitAsset: 'BTC:unified', balanceReadAt: NOW });
  });

  // The list names the rows that the stored balance overwrote. A disconnected holding keeps both,
  // so the line still leaves those rows out.
  it('a disconnect keeps the mark of a Bybit holding', async () => {
    mockDatabase.exec('PRAGMA foreign_keys = ON;');
    mockDatabase.exec(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-1', 'Bybit', 'crypto', 'bybit')",
    );
    mockDatabase
      .prepare(
        `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
         VALUES ('h-unified', 'acc-1', 'Bybit BTC', 'crypto_asset', 'BTC', 100, ?)`,
      )
      .run(
        JSON.stringify({
          bybitAsset: 'BTC:unified',
          syncedAt: NOW,
          balanceReadAt: NOW,
          overwrittenRowIds: ['t-1'],
        }),
      );
    mockDatabase.exec(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
       VALUES ('t-1', 'h-unified', 50, ${NOW + 1}, 'manual')`,
    );

    await disconnectCryptoAccount('acc-1', 'bybit');

    const { metadata } = mockDatabase
      .prepare("SELECT metadata FROM holdings WHERE id = 'h-unified'")
      .get() as { metadata: string };

    expect(JSON.parse(metadata)).toEqual({
      bybitAsset: 'BTC:unified',
      balanceReadAt: NOW,
      overwrittenRowIds: ['t-1'],
    });
  });

  it('for Binance, clears the not-imported list with the rest of the state but the walks', async () => {
    connectedBinanceAccount();
    mockDatabase.prepare("UPDATE sync_state SET exchange_state = ? WHERE account_id = 'acc-1'").run(
      JSON.stringify({
        ...JSON.parse(storedState()),
        notImported: [
          ...NOT_IMPORTED_KINDS.map((kind) => notImportedEntry(kind, '3', 4)),
          'bybit-x:1:2',
        ],
      }),
    );
    expect(storedState()).toContain('notImported');

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(storedState()).not.toContain('notImported');
    expect(parseExchangeState(storedState())).toMatchObject({ kind: 'parsed', notImported: [] });
  });

  it('for Binance, clears the trade cursors with the rowless order ids and the held order', async () => {
    connectedBinanceAccount();
    mockDatabase.prepare("UPDATE sync_state SET exchange_state = ? WHERE account_id = 'acc-1'").run(
      JSON.stringify({
        ...JSON.parse(storedState()),
        trades: {
          symbols: {
            BTCEUR: { fromId: 9, rowlessOrderIds: [3, 5] },
            ETHEUR: { fromId: 4, heldOrderId: 2, rowlessOrderIds: [1] },
          },
          rotation: 'BTCEUR',
          balanceSnapshot: { BTC: '1/0' },
        },
      }),
    );
    expect(storedState()).toContain('rowlessOrderIds');

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(storedState()).not.toContain('rowlessOrderIds');
    expect(storedState()).not.toContain('trades');
    expect(parseExchangeState(storedState())).toMatchObject({
      kind: 'parsed',
      trades: { symbols: {}, rotation: '', balanceSnapshot: {} },
    });
  });

  it('for Binance, clears the stored funding match rows of the account and no other', async () => {
    connectedBinanceAccount();
    mockDatabase.exec(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('acc-2', 'Other', 'crypto', 'binance')",
    );
    mockDatabase.exec(
      `INSERT INTO funding_match_rows
         (account_id, side, record_key, coin, direction, amount, time_start, time_end)
       VALUES ('acc-1', 'ledger', 'k', 'USDT', 'I', '1', 1, 2),
              ('acc-1', 'source', 'k', 'USDT', 'I', '1', 1, 2),
              ('acc-2', 'ledger', 'k', 'USDT', 'I', '1', 1, 2)`,
    );

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(
      mockDatabase.prepare('SELECT account_id AS accountId FROM funding_match_rows').all(),
    ).toEqual([{ accountId: 'acc-2' }]);
  });

  // The paused caption promises this fix: "Disconnect and reconnect to fix this. Your holdings
  // and transactions are kept."
  it.each([
    ['text that is not JSON', '{not json'],
    ['a state of another version', '{"version":2,"walks":{}}'],
    ['a state with no walks', '{"version":1}'],
  ])(
    'for Binance, repairs %s to a state a run reads, and keeps the holdings and the rows',
    async (_label, malformed) => {
      connectedBinanceAccount();
      mockDatabase
        .prepare("UPDATE sync_state SET exchange_state = ? WHERE account_id = 'acc-1'")
        .run(malformed);
      expect(parseExchangeState(storedState()).kind).toBe('malformed');

      await disconnectCryptoAccount('acc-1', 'binance');

      expect(parseExchangeState(storedState()).kind).toBe('parsed');
      expect(storedState()).toBe(
        `{"version":1,"walks":{"capital":{"cursor":${HISTORY_FLOOR_MS}}}}`,
      );
      expect(rowCount('holdings')).toBe(1);
      expect(rowCount('transactions')).toBe(1);
    },
  );
});
