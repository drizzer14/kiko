// The run order decides who gets the shared per-minute weight budget. These pins run the whole
// Binance arm over the REAL repos on a real `node:sqlite` engine with a fake Binance fetch that
// answers every endpoint with an empty page and reports the weight it has used in the header.
// The fetch is set inside the first `jest.mock` factory, because a fetch set after the import
// reaches the real network.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  globalThis.fetch = (input: RequestInfo | URL) => mockFetch(input);

  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL]>();
const mockWalkResults: Record<string, unknown[]> = {};

// A declaration, not a const: a `jest.mock` factory runs while the imports load, before a const
// below it is initialised.
function mockRecorded<Args extends unknown[]>(
  name: string,
  walk: (...args: Args) => Promise<unknown>,
): (...args: Args) => Promise<unknown> {
  return async (...args) => {
    const result = await walk(...args);

    mockWalkResults[name] = [...(mockWalkResults[name] ?? []), result];

    return result;
  };
}

jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.client'),
  fetchAccount: async () => ({
    balances: [{ asset: 'USDT', free: '5', locked: '0' }],
    uid: '12345',
  }),
  fetchFundingAsset: async () => [],
  fetchFlexiblePosition: async () => ({ rows: [], total: 0 }),
  fetchLockedPosition: async () => ({ rows: [], total: 0 }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  ...jest.requireActual('@kiko/crypto-sync/binance/binance.credentials'),
  readCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.trade-history', () => ({
  syncBinanceTradeHistory: async () => ({ imported: 0 }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transactions', () => {
  const actual = jest.requireActual('@kiko/crypto-sync/binance/binance.transactions');

  return {
    ...actual,
    syncBinanceTransactions: mockRecorded('capital', actual.syncBinanceTransactions),
  };
});
jest.mock('@kiko/crypto-sync/binance/binance.pay-history', () => {
  const actual = jest.requireActual('@kiko/crypto-sync/binance/binance.pay-history');

  return { ...actual, syncBinancePayHistory: mockRecorded('pay', actual.syncBinancePayHistory) };
});
jest.mock('@kiko/crypto-sync/binance/binance.convert-history', () => {
  const actual = jest.requireActual('@kiko/crypto-sync/binance/binance.convert-history');

  return {
    ...actual,
    syncBinanceConvertHistory: mockRecorded('convert', actual.syncBinanceConvertHistory),
  };
});
jest.mock('@kiko/crypto-sync/binance/binance.fiat-history', () => {
  const actual = jest.requireActual('@kiko/crypto-sync/binance/binance.fiat-history');

  return {
    ...actual,
    syncBinanceFiatOrderHistory: mockRecorded('fiatOrders', actual.syncBinanceFiatOrderHistory),
  };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { runCryptoSync } from './run-crypto-sync';

const ACCOUNT_ID = 'acc-new';

const WEIGHT_HEADER = 'X-SAPI-USED-UID-WEIGHT-1M';

// The weight one call of each endpoint adds to the UID's minute.
const UID_COST: Record<string, number> = {
  '/sapi/v1/capital/withdraw/history': 18_000,
  '/sapi/v1/pay/transactions': 3_000,
  '/sapi/v1/convert/tradeFlow': 3_000,
  '/sapi/v1/c2c/orderMatch/listUserOrderHistory': 900,
  '/sapi/v1/fiat/orders': 45_000,
};

const LANE_NEEDLES: readonly (readonly [string, string])[] = [
  ['c2c', 'p2p'],
  ['withdraw', 'capitalWithdraw'],
  ['pay/', 'pay'],
  ['convert', 'convert'],
  ['fiat/orders', 'fiatOrders'],
];

const laneOf = (path: string): string =>
  LANE_NEEDLES.find(([needle]) => path.includes(needle))?.[1] ?? path;

const bodyOf = (path: string): unknown => {
  if (path.includes('capital')) {
    return [];
  }

  if (path.includes('convert')) {
    return { list: [], moreData: false };
  }

  if (path.includes('dribblet')) {
    return { userAssetDribblets: [] };
  }

  if (path.includes('pay/') || path.includes('c2c') || path.includes('fiat')) {
    return { code: '000000', data: [], total: 0 };
  }

  return { rows: [], total: 0 };
};

type RunReport = {
  calls: Record<string, number>;
  complete: Record<string, boolean>;
};

// The world both pins share: weight headers on, five minutes between runs, an account with no
// stored state, so every walk starts from its floor.
const GAP_MS = 300_000;

const simulate = async (runs: number): Promise<RunReport[]> => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)')
    .run(ACCOUNT_ID, 'My Binance', 'crypto');

  let virtual = Date.now();
  const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => virtual);
  const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
    callback: () => void,
    milliseconds = 0,
  ) => {
    virtual += milliseconds;
    callback();

    return 0;
  }) as unknown as typeof setTimeout);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const weightLog: { at: number; weight: number }[] = [];
  let calls: Record<string, number> = {};

  mockFetch.mockImplementation(async (input) => {
    const { pathname } = new URL(String(input));
    const lane = laneOf(pathname);

    calls = { ...calls, [lane]: (calls[lane] ?? 0) + 1 };
    weightLog.push({ at: virtual, weight: UID_COST[pathname] ?? 0 });

    const used = weightLog
      .filter(({ at }) => at > virtual - 60_000)
      .reduce((sum, { weight }) => sum + weight, 0);
    const text = JSON.stringify(bodyOf(pathname));

    return {
      ok: true,
      status: 200,
      headers: new Headers({ [WEIGHT_HEADER]: String(used) }),
      text: async () => text,
      json: async () => JSON.parse(text),
    } as unknown as Response;
  });

  const reports: RunReport[] = [];

  try {
    for (let run = 1; run <= runs; run += 1) {
      calls = {};

      for (const name of Object.keys(mockWalkResults)) {
        delete mockWalkResults[name];
      }

      await runCryptoSync({ providerId: 'binance', targetAccountId: ACCOUNT_ID });

      reports.push({
        calls,
        complete: Object.fromEntries(
          Object.entries(mockWalkResults).map(([name, results]) => [
            name,
            results.some((result) => (result as { complete?: boolean }).complete === true),
          ]),
        ),
      });
      virtual += GAP_MS;
    }
  } finally {
    nowSpy.mockRestore();
    timeoutSpy.mockRestore();
    warn.mockRestore();
    mockDatabase.close();
  }

  return reports;
};

// One-based, so a lane that never does it reads 0 and fails every row.
const firstRunWhere = (reports: RunReport[], holds: (report: RunReport) => boolean): number =>
  reports.findIndex(holds) + 1;

describe('the P2P budget share (headers on, 300 s between runs, empty state)', () => {
  let reports: RunReport[];

  beforeAll(async () => {
    reports = await simulate(30);
  });

  it('reads the P2P head window on both sides in the very first run, before the capital walk', () => {
    expect(reports[0].calls.p2p ?? 0).toBeGreaterThanOrEqual(2);
  });

  // P2P takes only its own lane cap (18000 of 180000 UID a minute) first, so the walks behind it
  // keep 162000: capital still fills the minute in the first run and Pay waits for it, and every
  // walk still starts and completes. The rows are the run order's measured values.
  it.each([
    ['capitalWithdraw', 'capital', 1, 5],
    ['pay', 'pay', 5, 5],
    ['convert', 'convert', 5, 11],
    ['fiatOrders', 'fiatOrders', 12, 27],
  ])(
    'the %s lane of the %s walk makes its first call in run %i and the walk completes in run %i',
    (lane, walk, firstCallRun, completeRun) => {
      expect({
        firstCallRun: firstRunWhere(reports, (report) => (report.calls[lane] ?? 0) >= 1),
        completeRun: firstRunWhere(reports, (report) => report.complete[walk] === true),
      }).toEqual({ firstCallRun, completeRun });
    },
  );
});
