// A disconnect and a reconnect over the REAL repositories on a real `node:sqlite` engine (the
// shipped migrations), with the transfer walk of the Bybit arm as the walk that has state to reset:
// the walk marks, the stored key date, the holdings the walk made and the rows it wrote sit side by
// side. The convert walk is the one that keeps a page index and the points of its pass. No page
// with a row was read live: the transfer and the convert are built from the docs pages' samples.
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
jest.mock('./bybit.credentials', () => ({
  ...jest.requireActual('./bybit.credentials'),
  clearBybitCredentials: async () => undefined,
}));

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import { fakeBybit } from './bybit.capital-test-fixtures';
import { convertAt } from './bybit.history-test-fixtures';
import { transferAt } from './bybit.transfer-test-fixtures';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { convertRouteOf } from './bybit.convert-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { syncBybitConvertHistory } from './bybit.convert-history';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { syncBybitTransferHistory } from './bybit.transfer-history';

const ACCOUNT_ID = 'acc-1';
const AT = NOW - 2 * DAY_MS;

const walkOver = (bybit: ReturnType<typeof fakeBybit>) =>
  syncBybitTransferHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined }),
    },
    {
      now: () => NOW,
      fetchImpl: bybit.fetchImpl,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
    },
  );

const storedState = (): Record<string, unknown> => {
  const row = mockDatabase
    .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
    .get(ACCOUNT_ID) as { exchange_state: string };

  return JSON.parse(row.exchange_state);
};

const institutionOfAccount = (): string | null =>
  (
    mockDatabase.prepare('SELECT institution FROM accounts WHERE id = ?').get(ACCOUNT_ID) as {
      institution: string | null;
    }
  ).institution;

const holdingKeys = async (): Promise<unknown[]> =>
  (await holdingsRepo.listByAccountQuery(ACCOUNT_ID))
    .map((holding) => (holding.metadata as { bybitAsset?: string } | null)?.bybitAsset)
    .sort();

const rowCount = (): number =>
  (mockDatabase.prepare('SELECT COUNT(*) AS total FROM transactions').get() as { total: number })
    .total;

// A connected account whose transfer walk has read one transfer, owes a waiting one, and whose
// key date is stored.
const connectedAccountWithOneTransfer = async () => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Bybit', 'crypto', 'bybit')",
    )
    .run(ACCOUNT_ID);
  seedWalkMarks(mockDatabase, ACCOUNT_ID, 'transfer', { cursor: NOW - 3 * DAY_MS });
  await exchangeStateDepsOf('bybit').patchExchangeState(ACCOUNT_ID, [
    { kind: 'keyExpiry', expiredAtMs: NOW + 10 * DAY_MS, readAtMs: NOW },
  ]);
  const bybit = fakeBybit();
  bybit.world.transfer = [
    transferAt(AT),
    transferAt(AT + 1_000, { transferId: 'waiting', status: 'PENDING' }),
  ];
  await walkOver(bybit);
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
});

describe('the Bybit arm over a real database: disconnect and reconnect', () => {
  it('a disconnect resets the walks and the stored key date and keeps holding keys', async () => {
    await connectedAccountWithOneTransfer();

    expect(walkMarksOf(mockDatabase, ACCOUNT_ID, 'transfer')).toMatchObject({
      cursor: NOW,
      cursorReadAt: NOW,
      pending: [expect.objectContaining({ kind: 'point', series: 'transfer' })],
    });
    expect(storedState()).toHaveProperty('keyExpiry');

    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

    expect(walkMarksOf(mockDatabase, ACCOUNT_ID, 'transfer')).toEqual({
      cursor: BYBIT_RESTART_FLOOR_MS,
      pending: [],
    });
    expect(storedState()).not.toHaveProperty('keyExpiry');
    expect(institutionOfAccount()).toBeNull();
    expect(await holdingKeys()).toEqual(['BTC:fund', 'BTC:unified']);
    expect(rowCount()).toBe(2);
  });

  it('a reconnect reads the transfer walk from its own floor and adopts the holdings the disconnect kept', async () => {
    await connectedAccountWithOneTransfer();
    await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
    mockDatabase.prepare("UPDATE accounts SET institution = 'bybit' WHERE id = ?").run(ACCOUNT_ID);
    const before = await holdingsRepo.listByAccountQuery(ACCOUNT_ID);
    const bybit = fakeBybit();
    const floor = NOW - 729 * DAY_MS;
    bybit.world.transfer = [transferAt(floor + DAY_MS, { transferId: 'after-reconnect' })];

    const result = await walkOver(bybit);

    expect(bybit.reads[0].startTime).toBe(floor);
    expect(result.imported).toBe(2);
    expect((await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).map(({ id }) => id).sort()).toEqual(
      before.map(({ id }) => id).sort(),
    );
    expect(rowCount()).toBe(4);
  });

  describe('the convert walk, which keeps a page index and the points of a pass', () => {
    const CONVERT_AT = NOW - 2 * DAY_MS;

    const convertWalkOver = (route: ReturnType<typeof convertRouteOf>) =>
      syncBybitConvertHistory(
        {
          targetAccountId: ACCOUNT_ID,
          run: createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined }),
        },
        {
          now: () => NOW,
          fetchImpl: route.fetchImpl,
          readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
        },
      );

    // Eleven pages, so a run of ten stops inside the pass; the first holds a convert that waits.
    const accountInsideAPass = async () => {
      mockDatabase
        .prepare(
          "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Bybit', 'crypto', 'bybit')",
        )
        .run(ACCOUNT_ID);
      const route = convertRouteOf();
      route.serve(
        Array.from({ length: 11 }, (_, page) => [
          convertAt(CONVERT_AT + page * 1_000, page === 0 ? { exchangeStatus: 'init' } : {}),
        ]),
      );

      await convertWalkOver(route);

      return route;
    };

    it('a disconnect drops the page index and the points of the pass, and keeps the rest of its marks as for any walk', async () => {
      await accountInsideAPass();

      expect(walkMarksOf(mockDatabase, ACCOUNT_ID, 'convert')).toMatchObject({
        pageIndex: 11,
        passOwed: [expect.objectContaining({ kind: 'point', series: 'convert' })],
        pending: [expect.objectContaining({ kind: 'point', series: 'convert' })],
      });

      await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');

      expect(walkMarksOf(mockDatabase, ACCOUNT_ID, 'convert')).toEqual({ pending: [] });
    });

    it('a reconnect starts the pass again at page 1', async () => {
      await accountInsideAPass();
      await disconnectCryptoAccount(ACCOUNT_ID, 'bybit');
      mockDatabase
        .prepare("UPDATE accounts SET institution = 'bybit' WHERE id = ?")
        .run(ACCOUNT_ID);
      const route = convertRouteOf();
      route.serve([[convertAt(CONVERT_AT)]]);

      await convertWalkOver(route);

      expect(route.indexes[0]).toBe(1);
    });
  });
});
