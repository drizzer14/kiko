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

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { exchangeFundingMatches } from '@kiko/statistics/exchange-funding-match';

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
  p2pSpans: { side: string; start: number; end: number }[];
};

// What a pin that needs more than the empty world adds, each pin on its own: the P2P orders
// Binance holds, rows seeded before the first run, and a read of the database after a run.
type P2pOrderBody = {
  orderNumber: string;
  createTime: number;
  orderStatus: string;
  tradeType: string;
  advertisementRole: string;
  asset: string;
  fiat: string;
  amount: string;
  totalPrice: string;
  takerAmount: string;
};

// A completed taker buy of 24.5 USDT, as Binance sends it, paid for with 1000 UAH.
const usdtBuyForUahOf = (orderNumber: string, createTime: number): P2pOrderBody => ({
  orderNumber,
  createTime,
  orderStatus: 'COMPLETED',
  tradeType: 'BUY',
  advertisementRole: 'TAKER',
  asset: 'USDT',
  fiat: 'UAH',
  amount: '24.5',
  totalPrice: '1000',
  takerAmount: '24.5',
});

type Seeding = {
  p2pOrders?: (now: number) => P2pOrderBody[];
  seed?: (database: DatabaseSync, now: number) => void;
  afterRun?: (run: number, database: DatabaseSync, now: number) => void;
};

// The world the pins share: weight headers on, five minutes between runs, an account with no
// stored state, so every walk starts from its floor.
const GAP_MS = 300_000;

const simulate = async (runs: number, seeding: Seeding = {}): Promise<RunReport[]> => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare('INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)')
    .run(ACCOUNT_ID, 'My Binance', 'crypto');

  let virtual = Date.now();

  seeding.seed?.(mockDatabase, virtual);

  const p2pOrders = seeding.p2pOrders?.(virtual) ?? [];
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
  let p2pSpans: RunReport['p2pSpans'] = [];

  mockFetch.mockImplementation(async (input) => {
    const { pathname, searchParams } = new URL(String(input));
    const lane = laneOf(pathname);

    calls = { ...calls, [lane]: (calls[lane] ?? 0) + 1 };
    weightLog.push({ at: virtual, weight: UID_COST[pathname] ?? 0 });

    const used = weightLog
      .filter(({ at }) => at > virtual - 60_000)
      .reduce((sum, { weight }) => sum + weight, 0);
    const side = searchParams.get('tradeType') ?? '';
    const span = {
      start: Number(searchParams.get('startTimestamp')),
      end: Number(searchParams.get('endTimestamp')),
    };
    const found = p2pOrders.filter(
      ({ tradeType, createTime }) =>
        tradeType === side && createTime >= span.start && createTime <= span.end,
    );

    if (lane === 'p2p') {
      p2pSpans = [...p2pSpans, { side, ...span }];
    }

    const text = JSON.stringify(
      lane === 'p2p' ? { code: '000000', data: found, total: found.length } : bodyOf(pathname),
    );

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
      p2pSpans = [];

      for (const name of Object.keys(mockWalkResults)) {
        delete mockWalkResults[name];
      }

      await runCryptoSync({ providerId: 'binance', targetAccountId: ACCOUNT_ID });

      reports.push({
        calls,
        p2pSpans,
        complete: Object.fromEntries(
          Object.entries(mockWalkResults).map(([name, results]) => [
            name,
            results.some((result) => (result as { complete?: boolean }).complete === true),
          ]),
        ),
      });
      seeding.afterRun?.(run, mockDatabase, virtual);
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

const P2P_WINDOW_MS = 30 * DAY_MS;

const p2pExternalIdsOf = (database: DatabaseSync): string[] =>
  (
    database
      .prepare("SELECT external_id FROM transactions WHERE operation = 'p2p' ORDER BY external_id")
      .all() as { external_id: string }[]
  ).map(({ external_id }) => external_id);

type FundingLedger = Parameters<typeof exchangeFundingMatches>[0];

type StoredLedgerRow = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  currency: FundingLedger[number]['currency'];
  untrackedCounterpart: string | null;
  description: string;
  mcc: number | null;
  categorySetByHand: number;
};

const fundingLedgerOf = (database: DatabaseSync): FundingLedger =>
  (
    database
      .prepare(
        `SELECT transactions.id, holding_id AS holdingId, time,
                amount_minor_units AS amountMinorUnits, holdings.currency,
                untracked_counterpart AS untrackedCounterpart, description, mcc,
                category_set_by_hand AS categorySetByHand
           FROM transactions JOIN holdings ON holdings.id = transactions.holding_id`,
      )
      .all() as StoredLedgerRow[]
  ).map((row) => ({ ...row, categorySetByHand: row.categorySetByHand === 1 }));

const accountKindsOf = (database: DatabaseSync) =>
  new Map(
    (
      database
        .prepare(
          `SELECT holdings.id AS holdingId, accounts.kind AS kind
             FROM holdings JOIN accounts ON accounts.id = holdings.account_id`,
        )
        .all() as { holdingId: string; kind: 'bank' | 'crypto' }[]
    ).map(({ holdingId, kind }) => [holdingId, kind] as const),
  );

describe('the P2P orders of a first run (headers on, 300 s between runs, empty state)', () => {
  it('imports the newest order, made two days before the clock, in run 1', async () => {
    let imported: string[] = [];

    await simulate(1, {
      p2pOrders: (now) => [usdtBuyForUahOf('newest', now - 2 * DAY_MS)],
      afterRun: (_run, database) => {
        imported = p2pExternalIdsOf(database);
      },
    });

    expect(imported).toEqual([`${ACCOUNT_ID}:p2p:newest:USDT:funding`]);
  });

  // The previous calendar month is a user-visible span: whichever day the clock stands on, a
  // run reaches back at least 240 days behind the head window.
  it('imports every order of the previous calendar month in run 1 and reads deeper in run 2', async () => {
    let imported: string[] = [];
    let previousMonthStart = 0;
    let clockAtStart = 0;

    const reports = await simulate(2, {
      p2pOrders: (now) => {
        const clock = new Date(now);
        const first = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() - 1, 1);
        const next = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), 1);

        previousMonthStart = first;
        clockAtStart = now;

        return [
          usdtBuyForUahOf('first-day', first + 12 * 3_600_000),
          usdtBuyForUahOf('middle', first + 14 * DAY_MS + 12 * 3_600_000),
          usdtBuyForUahOf('last-day', next - 12 * 3_600_000),
        ];
      },
      afterRun: (run, database) => {
        if (run === 1) {
          imported = p2pExternalIdsOf(database);
        }
      },
    });
    const oldestStartOf = (report: RunReport) =>
      Math.min(...report.p2pSpans.map(({ start }) => start));

    expect(imported).toHaveLength(3);
    expect(reports[0].calls.p2p).toBeLessThanOrEqual(20);

    for (const side of ['BUY', 'SELL']) {
      const spans = reports[0].p2pSpans
        .filter((span) => span.side === side)
        .sort((left, right) => left.start - right.start);
      let covered = spans[0].start;

      for (const { start, end } of spans) {
        if (start <= covered) {
          covered = Math.max(covered, end);
        }
      }

      expect(spans[0].start).toBeLessThanOrEqual(previousMonthStart);
      expect(covered).toBeGreaterThanOrEqual(clockAtStart);
    }

    expect(oldestStartOf(reports[1])).toBeLessThanOrEqual(
      oldestStartOf(reports[0]) - 7 * P2P_WINDOW_MS,
    );
  });

  it('takes the bank debit that paid for the newest order out of spending in run 1', async () => {
    const orderAgo = 2 * DAY_MS;
    let excludedIds = new Set<string>();

    await simulate(1, {
      p2pOrders: (now) => [usdtBuyForUahOf('paid', now - orderAgo)],
      seed: (database, now) => {
        database
          .prepare("INSERT INTO accounts (id, name, kind) VALUES ('acc-bank', 'Monobank', 'bank')")
          .run();
        database
          .prepare(
            `INSERT INTO holdings (id, account_id, name, type, currency)
               VALUES ('h-card', 'acc-bank', 'Card', 'card', 'UAH')`,
          )
          .run();
        database
          .prepare(
            `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
               VALUES ('tx-debit', 'h-card', -100000, ?, 'monobank', 'mono-debit')`,
          )
          .run(now - orderAgo + 20 * 60_000);
      },
      afterRun: (_run, database) => {
        excludedIds = exchangeFundingMatches(
          fundingLedgerOf(database),
          accountKindsOf(database),
        ).excludedIds;
      },
    });

    expect([...excludedIds]).toEqual(['tx-debit']);
  });
});
