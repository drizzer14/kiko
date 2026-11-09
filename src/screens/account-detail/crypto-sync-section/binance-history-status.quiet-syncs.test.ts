import {
  createBinanceHistoryRun,
  syncBinanceConvertHistory,
  syncBinanceEarnHistory,
  syncBinanceFiatOrderHistory,
  syncBinanceFiatPaymentHistory,
  syncBinanceP2pHistory,
  syncBinancePayHistory,
  syncBinanceTransactions,
  syncBinanceTransferHistory,
} from '@kiko/crypto-sync/binance';
import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { type WalkName, walkStateFake } from '@kiko/test-support/walk-marks';

import { historyOwesRange } from './binance-history-status';

const HOUR_MS = 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 15);
const ACCOUNT_ID = 'acc-1';
const SYNCS = 6;

const SPOT = {
  id: 'h-spot',
  accountId: ACCOUNT_ID,
  metadata: { binanceAsset: 'BTC' },
} as HoldingRow;

type StateDeps = ReturnType<ReturnType<typeof walkStateFake>['freshDeps']>;

const weights = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

/** What Binance answers to every read of a quiet account: an empty page. */
const emptyAnswer = <Page>(page: Page) => jest.fn(async (): Promise<Page> => page);

const capitalPage = { rows: [], unreadable: [], untracked: [], ...weights };

const totalPage = { rows: [], unreadable: [], untracked: [], gathered: 0, total: 0, ...weights };

const convertPage = { rows: [], unreadable: [], moreData: false, ...weights };

const sharedDeps = (state: StateDeps, now: number) => ({
  ...state,
  now: () => now,
  fetchImpl: jest.fn(),
  readCredentials: async () => ({ apiKey: 'key', secret: 'secret' }),
  listHoldings: async () => [SPOT],
  ensureHoldings: jest.fn(async () => undefined),
  addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
});

const requestOf = (now: number) => ({
  targetAccountId: ACCOUNT_ID,
  run: createBinanceHistoryRun({ now: () => now, sleep: async () => undefined }),
});

type Walk = {
  name: WalkName;
  run: (state: StateDeps, now: number) => Promise<unknown>;
};

// The walks the history caption reads, each over a world with no record and no failure.
const WALKS: Walk[] = [
  {
    name: 'capital',
    run: (state, now) =>
      syncBinanceTransactions(requestOf(now), {
        ...sharedDeps(state, now),
        storedExternalIds: async () => new Set<string>(),
        latestTransactionTime: async () => undefined,
        fetchDepositHistory: emptyAnswer(capitalPage),
        fetchWithdrawHistory: emptyAnswer(capitalPage),
      }),
  },
  {
    name: 'pay',
    run: (state, now) =>
      syncBinancePayHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchAccount: async () => ({ balances: [], uid: '1001' }),
        fetchPayHistory: emptyAnswer(totalPage),
      }),
  },
  {
    name: 'transfer',
    run: (state, now) =>
      syncBinanceTransferHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchUniversalTransfers: emptyAnswer(totalPage),
      }),
  },
  {
    name: 'earn',
    run: (state, now) =>
      syncBinanceEarnHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchEarnRecords: emptyAnswer(totalPage),
      }),
  },
  {
    name: 'convert',
    run: (state, now) =>
      syncBinanceConvertHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchConvertHistory: emptyAnswer(convertPage),
      }),
  },
  {
    name: 'p2p',
    run: (state, now) =>
      syncBinanceP2pHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchP2pOrders: emptyAnswer(totalPage),
      }),
  },
  {
    name: 'fiatOrders',
    run: (state, now) =>
      syncBinanceFiatOrderHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchFiatOrders: emptyAnswer(totalPage),
      }),
  },
  {
    name: 'fiatPayments',
    run: (state, now) =>
      syncBinanceFiatPaymentHistory(requestOf(now), {
        ...sharedDeps(state, now),
        fetchFiatPayments: emptyAnswer(totalPage),
      }),
  },
];

describe.each(WALKS)('the history caption over syncs of a quiet $name walk', ({ name, run }) => {
  it.each([
    ['an hour', HOUR_MS],
    ['a day', DAY_MS],
    ['three days', 3 * DAY_MS],
  ])('shows no owed range after any of six syncs %s apart', async (_label, gap) => {
    const world = walkStateFake({
      accountId: ACCOUNT_ID,
      marks: { [name]: { cursor: START - gap, multiCoinSeen: true } },
    });

    const owing: boolean[] = [];

    for (let sync = 0; sync < SYNCS; sync += 1) {
      const now = START + sync * gap;

      await run(world.freshDeps(), now);

      const stored = await world.freshDeps().readExchangeState(ACCOUNT_ID);

      owing.push(historyOwesRange(parseExchangeState(stored), now, 'binance'));
    }

    // The walk ran: its cursor moved past the one it started from.
    expect(world.marksOf(name).cursor).toBeGreaterThan(START - gap);
    expect(owing).toEqual(Array.from({ length: SYNCS }, () => false));
  });
});
