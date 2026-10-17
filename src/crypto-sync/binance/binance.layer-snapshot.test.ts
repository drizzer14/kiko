import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';

import {
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
  type FetchAccountOptions,
} from './binance.client';
import {
  type BinanceTransactionRow,
  type BinanceTransactionSyncDeps,
  syncBinanceTransactions,
} from './binance.transactions';
import {
  type BinanceDeposit,
  type BinanceUniversalTransfer,
  type BinanceWithdrawal,
  type EarnRecordKind,
  fetchDepositHistory,
  fetchEarnRecords,
  fetchPayHistory,
  fetchUniversalTransfers,
  fetchWithdrawHistory,
  type HistoryPage,
  type HistoryWindow,
  type PayHistoryPage,
  type TotalPage,
} from './binance.history-client';
import {
  type BinanceHistoryRow,
  type BinanceTransferHistoryDeps,
  syncBinanceTransferHistory,
} from './binance.transfer-history';
import {
  entryOf,
  flexibleRedemptionOf,
  flexibleRewardOf,
  flexibleSubscriptionOf,
  lockedRedemptionOf,
  lockedRewardOf,
  lockedSubscriptionOf,
  walkOnce,
  worldOf,
} from './binance.earn-test-fixtures';
import { createBinanceHistoryRun } from './binance.history-budget';
import { EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';
import { costOn, NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';
import { type BinancePayHistoryDeps, syncBinancePayHistory } from './binance.pay-history';

const API_KEY = 'key-fixture';
const SECRET = 'secret-fixture';
const ACCOUNT = 'acc-1';

type SentRequest = { url: string; init: { method: string; headers: Record<string, string> } };

// The one place a signed request leaves the client: the URL (path, signed query, signature) and
// the headers that a fixed clock, key and secret produce.
const sentBy = async (
  call: (options: FetchAccountOptions) => Promise<unknown>,
  body: unknown,
): Promise<SentRequest[]> => {
  const sent: SentRequest[] = [];
  const fetchImpl = (async (url: string, init: SentRequest['init']) => {
    sent.push({ url, init });

    return { ok: true, status: 200, headers: new Headers(), json: async () => body };
  }) as unknown as typeof fetch;

  await call({ fetchImpl, now: () => NOW });

  return sent;
};

const WINDOW: HistoryWindow = { startTime: NOW - 30 * DAY_MS, endTime: NOW, offset: 0 };
const PAGE = { startTime: NOW - 30 * DAY_MS, endTime: NOW, current: 1 };
const NO_ROWS = { rows: [], total: 0 };
const READ_HEADERS = { 'X-MBX-APIKEY': API_KEY, 'Cache-Control': 'no-store' };

const EARN_KINDS: EarnRecordKind[] = [
  'flexibleSubscription',
  'flexibleRedemption',
  'flexibleRewards',
  'lockedSubscription',
  'lockedRedemption',
  'lockedRewards',
];

// Binance signs the query string alone, so two paths that take the same query carry one signature.
const EXPECTED_URLS: Record<string, string> = {
  account:
    'https://api.binance.com/api/v3/account?timestamp=1791590400000&recvWindow=5000&signature=7490c3a7eb8acc21216096b21094601993e20d0f9e664482dabda0400bddd910',
  'funding asset':
    'https://api.binance.com/sapi/v1/asset/get-funding-asset?asset=BTC&timestamp=1791590400000&recvWindow=5000&signature=eb14368637c305ce120b05bf35e037d2ddd88f4ca619319eec47920ea4a237e2',
  'flexible position':
    'https://api.binance.com/sapi/v1/simple-earn/flexible/position?asset=BTC&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=c42d865d37f360be491740058338c38c84376a8b0c1255d15085bd791e69a2d4',
  'locked position':
    'https://api.binance.com/sapi/v1/simple-earn/locked/position?asset=BTC&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=c42d865d37f360be491740058338c38c84376a8b0c1255d15085bd791e69a2d4',
  'deposit history':
    'https://api.binance.com/sapi/v1/capital/deposit/hisrec?coin=BTC&startTime=1788998400000&endTime=1791590400000&offset=0&limit=1000&timestamp=1791590400000&recvWindow=5000&signature=9e960ba104e88789b4926156c1563c87d3230206b7b06f70b6935daf0136fc10',
  'withdraw history':
    'https://api.binance.com/sapi/v1/capital/withdraw/history?coin=BTC&startTime=1788998400000&endTime=1791590400000&offset=0&limit=1000&timestamp=1791590400000&recvWindow=5000&signature=9e960ba104e88789b4926156c1563c87d3230206b7b06f70b6935daf0136fc10',
  'pay history':
    'https://api.binance.com/sapi/v1/pay/transactions?startTime=1788998400000&endTime=1791590400000&limit=100&timestamp=1791590400000&recvWindow=5000&signature=2d01a2ba5565fd5577994b6383f937f9e3f6471e127fd900b9e144da6a64c90a',
  'universal transfers':
    'https://api.binance.com/sapi/v1/asset/transfer?type=MAIN_FUNDING&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=2fe25a56f30ba63772686f5a21443a89bc306df77b1d8f9f87cc7490b8042fe0',
  'earn flexibleSubscription':
    'https://api.binance.com/sapi/v1/simple-earn/flexible/history/subscriptionRecord?asset=BTC&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=6e3a3e4abd21a2b58e72792014d965262bc4fc5ec03da38af277e9e85db54c52',
  'earn flexibleRedemption':
    'https://api.binance.com/sapi/v1/simple-earn/flexible/history/redemptionRecord?asset=BTC&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=6e3a3e4abd21a2b58e72792014d965262bc4fc5ec03da38af277e9e85db54c52',
  'earn flexibleRewards':
    'https://api.binance.com/sapi/v1/simple-earn/flexible/history/rewardsRecord?asset=BTC&type=ALL&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=52c446f27f5fb5e96aa755baf6f28553489df9bca81a0d3bf969e34a45c250de',
  'earn lockedSubscription':
    'https://api.binance.com/sapi/v1/simple-earn/locked/history/subscriptionRecord?asset=BTC&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=6e3a3e4abd21a2b58e72792014d965262bc4fc5ec03da38af277e9e85db54c52',
  'earn lockedRedemption':
    'https://api.binance.com/sapi/v1/simple-earn/locked/history/redemptionRecord?asset=BTC&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=6e3a3e4abd21a2b58e72792014d965262bc4fc5ec03da38af277e9e85db54c52',
  'earn lockedRewards':
    'https://api.binance.com/sapi/v1/simple-earn/locked/history/rewardsRecord?asset=BTC&startTime=1788998400000&endTime=1791590400000&current=1&size=100&timestamp=1791590400000&recvWindow=5000&signature=6e3a3e4abd21a2b58e72792014d965262bc4fc5ec03da38af277e9e85db54c52',
};

type RequestCase = [
  label: string,
  method: 'GET' | 'POST',
  call: (options: FetchAccountOptions) => Promise<unknown>,
  body: unknown,
];

describe('the signed requests of every endpoint the walks call', () => {
  const cases: RequestCase[] = [
    [
      'account',
      'GET',
      (options: FetchAccountOptions) => fetchAccount(API_KEY, SECRET, options),
      { balances: [] },
    ],
    [
      'funding asset',
      'POST',
      (options: FetchAccountOptions) => fetchFundingAsset(API_KEY, SECRET, options),
      [],
    ],
    [
      'flexible position',
      'GET',
      (options: FetchAccountOptions) => fetchFlexiblePosition(API_KEY, SECRET, options),
      NO_ROWS,
    ],
    [
      'locked position',
      'GET',
      (options: FetchAccountOptions) => fetchLockedPosition(API_KEY, SECRET, options),
      NO_ROWS,
    ],
    [
      'deposit history',
      'GET',
      (options: FetchAccountOptions) => fetchDepositHistory(API_KEY, SECRET, WINDOW, options),
      [],
    ],
    [
      'withdraw history',
      'GET',
      (options: FetchAccountOptions) => fetchWithdrawHistory(API_KEY, SECRET, WINDOW, options),
      [],
    ],
    [
      'pay history',
      'GET',
      (options: FetchAccountOptions) => fetchPayHistory(API_KEY, SECRET, WINDOW, options),
      { code: '000000', data: [] },
    ],
    [
      'universal transfers',
      'GET',
      (options: FetchAccountOptions) =>
        fetchUniversalTransfers(API_KEY, SECRET, { ...PAGE, type: 'MAIN_FUNDING' }, options),
      NO_ROWS,
    ],
    ...EARN_KINDS.map(
      (kind): RequestCase => [
        `earn ${kind}`,
        'GET',
        (options) => fetchEarnRecords(API_KEY, SECRET, kind, PAGE, options),
        NO_ROWS,
      ],
    ),
  ];

  it.each(cases)(
    'signs %s with the key header and a fixed clock',
    async (label, method, call, body) => {
      const [request, ...rest] = await sentBy(call, body);

      expect(rest).toEqual([]);
      expect(request.init).toEqual({ method, headers: READ_HEADERS });
      expect(request.url).toBe(EXPECTED_URLS[label]);
    },
  );
});

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

const spotWith = (marks: Record<string, unknown>) =>
  holdingWith('h-spot', { binanceAsset: SPOT_KEY, ...marks });
const FUNDING = holdingWith('h-funding', { binanceAsset: FUNDING_KEY });
const EARN = holdingWith('h-earn', { binanceAsset: EARN_KEY });

const walkWrites = {
  writeWalkCursor: async () => undefined,
  writeWalkPending: async () => undefined,
  writeWalkHints: async () => undefined,
};

// A walk reads a span more than once (forward, owed ground, re-scan), so a row is kept once, by
// its key, in the order its keys sort.
const uniqueByKey = <Row extends { externalId: string }>(rows: Row[]): Row[] =>
  [...new Map(rows.map((row) => [row.externalId, row])).values()].sort((left, right) =>
    left.externalId.localeCompare(right.externalId),
  );

// The key of each row, the holding it lands on and its signed amount in minor units.
const placed = (rows: BinanceTransactionRow[]) =>
  rows.map(({ externalId, holdingId, amountMinorUnits }) => [
    externalId,
    holdingId,
    amountMinorUnits,
  ]);

const collector = <Row extends BinanceTransactionRow>() => {
  const added: Row[] = [];

  return {
    rows: () => uniqueByKey(added),
    addTransactions: async (rows: Row[]) => {
      added.push(...rows);

      return rows.length;
    },
  };
};

const within = (window: { startTime: number; endTime: number }, time: number): boolean =>
  window.startTime <= time && time <= window.endTime;

const unweighted = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

const TWO_DAYS_AGO = NOW - 2 * DAY_MS;
const WITHDRAWN_AT = Date.UTC(2026, 9, 8);

// The records as Binance sends them: a Funding deposit with no id of its own, keyed by its
// on-chain hash.
const DEPOSITS: BinanceDeposit[] = JSON.parse(`[
  {"id":"d-1","amount":"0.5","coin":"BTC","txId":"dep-tx","insertTime":${TWO_DAYS_AGO},"status":1},
  {"id":"","amount":"0.25","coin":"BTC","txId":"dep-tx-2","insertTime":${TWO_DAYS_AGO},"status":1,"walletType":1}
]`);

const WITHDRAWALS: BinanceWithdrawal[] = JSON.parse(`[
  {"id":"w-1","amount":"0.125","transactionFee":"0.0001","coin":"BTC","txId":"wd-tx","applyTime":"2026-10-08 00:00:00","status":6}
]`);

describe('the external ids and rows every walk writes for one fixture', () => {
  it('capital: a Spot deposit, a Funding deposit keyed by its hash, and a withdrawal', async () => {
    const { rows, addTransactions } = collector();
    const overrides: Partial<BinanceTransactionSyncDeps> = {
      ...walkWrites,
      addTransactions,
      now: () => NOW,
      ensureHoldings: async () => undefined,
      storedExternalIds: async () => new Set(),
      latestTransactionTime: async () => undefined,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
      listHoldings: async () => [spotWith({ binanceHistoryCursor: NOW - 5 * DAY_MS }), FUNDING],
      fetchDepositHistory: async (_key, _secret, window): Promise<HistoryPage<BinanceDeposit>> => ({
        rows: DEPOSITS.filter((record) => within(window, record.insertTime)),
        unreadable: [],
        ...unweighted,
      }),
      fetchWithdrawHistory: async (
        _key,
        _secret,
        window,
      ): Promise<HistoryPage<BinanceWithdrawal>> => ({
        rows: within(window, WITHDRAWN_AT) ? WITHDRAWALS : [],
        unreadable: [],
        ...unweighted,
      }),
    };

    await syncBinanceTransactions({ targetAccountId: ACCOUNT, run: freshRun() }, overrides);

    expect(placed(rows())).toEqual([
      ['acc-1:deposit:d-1', 'h-spot', 50_000_000],
      ['acc-1:deposit:dep-tx-2', 'h-funding', 25_000_000],
      ['acc-1:withdraw:w-1', 'h-spot', -12_500_000],
    ]);
    expect(new Set(rows().map((row) => row.description))).toEqual(new Set(['BTC']));
  });

  it('pay: a send from Spot, a send split over Spot and Funding, and a receive', async () => {
    const orders = [
      payOrder(),
      payOrder({
        transactionId: 'tx-2',
        amount: '-0.0015',
        walletType: 1,
        walletTypes: [2, 1],
        fundsDetail: [
          {
            currency: 'BTC',
            amount: '0.0015',
            walletAssetCost: [
              { walletType: 2, amount: '0.001' },
              { walletType: 1, amount: '0.0005' },
            ],
          },
        ],
        transactionTime: NOW - 9 * DAY_MS,
      }),
      payOrder({
        orderType: 'PAY',
        transactionId: 'tx-3',
        amount: '0.002',
        fundsDetail: costOn(2, '0.002'),
        payerInfo: party('Ann', OTHER),
        receiverInfo: party('Me', OWN),
        transactionTime: NOW - 8 * DAY_MS,
      }),
    ];
    const { rows, addTransactions } = collector();
    const overrides: Partial<BinancePayHistoryDeps> = {
      ...walkWrites,
      addTransactions,
      now: () => NOW,
      ensureHoldings: async () => undefined,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
      fetchAccount: async () => ({ balances: [], uid: OWN }),
      listHoldings: async () => [
        spotWith({ binancePayHistoryCursor: NOW - 30 * DAY_MS }),
        FUNDING,
        EARN,
      ],
      fetchPayHistory: async (_key, _secret, window): Promise<PayHistoryPage> => {
        const inWindow = orders.filter((order) => within(window, order.transactionTime));

        return {
          rows: inWindow,
          unreadable: [],
          gathered: inWindow.length,
          btcFundedOtherCoinOrders: [],
          ...unweighted,
        };
      },
    };

    await syncBinancePayHistory({ targetAccountId: ACCOUNT, run: freshRun() }, overrides);

    expect(placed(rows())).toEqual([
      ['acc-1:pay:C2C:tx-1:2', 'h-spot', -100_000],
      ['acc-1:pay:C2C:tx-2:1', 'h-funding', -50_000],
      ['acc-1:pay:C2C:tx-2:2', 'h-spot', -100_000],
      ['acc-1:pay:PAY:tx-3:2', 'h-spot', 200_000],
    ]);
  });

  it('transfer: a paired move in both directions under one id, and a move to an untracked wallet', async () => {
    const transfer = (type: string, tranId: string): BinanceUniversalTransfer => ({
      asset: 'BTC',
      amount: '0.001',
      type,
      status: 'CONFIRMED',
      tranId,
      timestamp: TWO_DAYS_AGO,
    });
    const transfers = [
      transfer('MAIN_FUNDING', 't-1'),
      transfer('FUNDING_MAIN', 't-1'),
      transfer('MAIN_MARGIN', 't-2'),
    ];
    const { rows, addTransactions } = collector<BinanceHistoryRow>();
    const overrides: Partial<BinanceTransferHistoryDeps> = {
      ...walkWrites,
      addTransactions,
      now: () => NOW,
      ensureHoldings: async () => undefined,
      readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
      listHoldings: async () => [
        spotWith({ binanceTransferHistoryCursor: NOW - 5 * DAY_MS }),
        FUNDING,
      ],
      fetchUniversalTransfers: async (
        _key,
        _secret,
        query,
      ): Promise<TotalPage<BinanceUniversalTransfer>> => {
        const inRead = transfers.filter(
          (record) => record.type === query.type && within(query, record.timestamp),
        );

        return {
          rows: inRead,
          unreadable: [],
          gathered: inRead.length,
          total: inRead.length,
          ...unweighted,
        };
      },
    };

    await syncBinanceTransferHistory({ targetAccountId: ACCOUNT, run: freshRun() }, overrides);

    expect(placed(rows())).toEqual([
      ['acc-1:xfer:FUNDING_MAIN:t-1:BTC', 'h-spot', 100_000],
      ['acc-1:xfer:FUNDING_MAIN:t-1:BTC:funding', 'h-funding', -100_000],
      ['acc-1:xfer:MAIN_FUNDING:t-1:BTC', 'h-spot', -100_000],
      ['acc-1:xfer:MAIN_FUNDING:t-1:BTC:funding', 'h-funding', 100_000],
      ['acc-1:xfer:MAIN_MARGIN:t-2:BTC', 'h-spot', -100_000],
    ]);
  });

  it('earn: both products subscribed and redeemed, a flexible reward on Earn and a locked reward on Spot', async () => {
    const world = worldOf({ binanceEarnHistoryCursor: NOW - 5 * DAY_MS });

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleSubscription', flexibleSubscriptionOf()),
        entryOf('lockedSubscription', lockedSubscriptionOf({ purchaseId: 'p-2' })),
        entryOf('flexibleRedemption', flexibleRedemptionOf()),
        entryOf('lockedRedemption', lockedRedemptionOf()),
        entryOf('flexibleRewards', flexibleRewardOf()),
        entryOf('lockedRewards', lockedRewardOf()),
      ],
    });

    expect(placed(uniqueByKey(world.added))).toEqual([
      ['acc-1:earn:redeem:flexible:r-1:BTC', 'h-spot', 100_000],
      ['acc-1:earn:redeem:flexible:r-1:BTC:earn', 'h-earn', -100_000],
      ['acc-1:earn:redeem:locked:r-1:BTC', 'h-spot', 100_000],
      ['acc-1:earn:redeem:locked:r-1:BTC:earn', 'h-earn', -100_000],
      ['acc-1:earn:reward:flexible:BTC001:REALTIME:1791417600000:0', 'h-earn', 12],
      ['acc-1:earn:reward:locked:pos-1:Booster:1791417600000:0', 'h-spot', 12],
      ['acc-1:earn:sub:flexible:p-1:BTC', 'h-spot', -100_000],
      ['acc-1:earn:sub:flexible:p-1:BTC:earn', 'h-earn', 100_000],
      ['acc-1:earn:sub:locked:p-2:BTC', 'h-spot', -100_000],
      ['acc-1:earn:sub:locked:p-2:BTC:earn', 'h-earn', 100_000],
    ]);
  });
});
