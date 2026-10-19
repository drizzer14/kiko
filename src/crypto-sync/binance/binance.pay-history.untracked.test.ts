import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { untrackedCoinsOf } from '@kiko/crypto-sync/exchange/history-status';
import { coinListPatchesOf, walkMarkWritesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinancePayOrder,
  type BinanceUntrackedPayOrder,
  fetchPayHistory,
  type PayHistoryPage,
} from './binance.history-client';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { createBinanceHistoryRun } from './binance.history-budget';
import { NOW, OTHER, OWN, party, payOrder } from './binance.pay-test-fixtures';
import { type BinancePayHistoryDeps, syncBinancePayHistory } from './binance.pay-history';

const ACCOUNT_ID = 'acc-1';
const CURSOR = NOW - 3_600_000;
const PAID_AT = NOW - 1_800_000;
const STOP_TAG = '[binance sync] history window stopped';

const spotHolding = { id: 'h-spot', metadata: { binanceAsset: 'BTC' } } as unknown as HoldingRow;

const payPage = (
  rows: BinancePayOrder[],
  untracked: BinanceUntrackedPayOrder[] = [],
): PayHistoryPage => ({
  rows,
  unreadable: [],
  untracked,
  gathered: rows.length + untracked.length,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
});

const order = (over: Partial<BinancePayOrder> = {}): BinancePayOrder =>
  payOrder({ transactionTime: PAID_AT, ...over });

/** An order that no tracked coin is in or paid in, as the client reports it. */
const untrackedOrder = (
  over: Partial<BinanceUntrackedPayOrder> = {},
): BinanceUntrackedPayOrder => ({
  tickers: ['PEPE'],
  transactionTime: PAID_AT,
  received: false,
  ...over,
});

/** A send in an untracked coin, paid in USDT from Funding. */
const xyzSend = (over: Partial<BinancePayOrder> = {}): BinancePayOrder =>
  order({
    currency: 'XYZ',
    amount: '-12.5',
    walletType: 1,
    fundsDetail: [
      {
        currency: 'USDT',
        amount: '12.5',
        walletAssetCost: [{ walletType: 1, amount: '12.5' }],
      },
    ],
    ...over,
  });

/** The span ending at now holds `page`; any other span holds nothing. */
const pageAtNow = (page: PayHistoryPage) =>
  jest.fn(async (_apiKey: string, _secret: string, query: { endTime: number }) =>
    query.endTime === NOW ? page : payPage([]),
  );

/** The holdings a walk creates are listed by the next read, as a real store lists them. */
const creatingStore = () => {
  let stored: HoldingRow[] = [spotHolding];
  const ensureHoldings = jest.fn(async (holdings: { metadataKey: string }[]) => {
    stored = [
      ...stored,
      ...holdings.map(
        ({ metadataKey }) =>
          ({
            id: `h-${metadataKey}`,
            metadata: { binanceAsset: metadataKey },
          }) as unknown as HoldingRow,
      ),
    ];
  });

  return { ensureHoldings, listHoldings: async () => stored };
};

const makeDeps = (over: Partial<BinancePayHistoryDeps> = {}): BinancePayHistoryDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  fetchAccount: jest.fn(async () => ({ balances: [], uid: OWN })),
  fetchPayHistory: jest.fn(async () => payPage([])),
  addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
  ...creatingStore(),
  ...walkStateFake({ accountId: ACCOUNT_ID, marks: { pay: { cursor: CURSOR } } }).deps,
  ...over,
});

const sync = (deps: BinancePayHistoryDeps) =>
  syncBinancePayHistory(
    {
      targetAccountId: ACCOUNT_ID,
      run: createBinanceHistoryRun({ now: deps.now, sleep: async () => undefined }),
    },
    deps,
  );

type AddedRow = {
  holdingId: string;
  amountMinorUnits: number;
  externalId: string;
  comment?: string;
};

const addedRows = (deps: BinancePayHistoryDeps): AddedRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap((call) => call[0]);

const untrackedPatchesOf = (deps: BinancePayHistoryDeps) =>
  coinListPatchesOf(deps).filter((patch) => patch.coins === 'untrackedCoins');

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('a Pay order of a coin that is not tracked', () => {
  it('counts a PEPE order beside a BTC one, imports no row for it and lists its ticker once', async () => {
    const deps = makeDeps({
      fetchPayHistory: pageAtNow(payPage([order()], [untrackedOrder()])),
    });

    const result = await sync(deps);

    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:pay:C2C:tx-1:2']);
    expect(result).toEqual({ imported: 1, complete: true });
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });

  it('writes the list after the rows and before the cursor of the window, once', async () => {
    const deps = makeDeps({
      fetchPayHistory: pageAtNow(
        payPage([order()], [untrackedOrder(), untrackedOrder({ tickers: ['XYZ', 'PEPE'] })]),
      ),
    });

    await sync(deps);

    const kinds = (deps.patchExchangeState as jest.Mock).mock.calls.flatMap(([, patches]) =>
      patches.map((patch: { kind: string }) => patch.kind),
    );
    expect(kinds.filter((kind: string) => kind === 'coinList')).toHaveLength(1);
    expect(kinds.indexOf('coinList')).toBeLessThan(kinds.indexOf('walk'));
    expect((deps.addTransactions as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (deps.patchExchangeState as jest.Mock).mock.invocationCallOrder[0],
    );
    expect([...untrackedPatchesOf(deps)[0].tickers].sort()).toEqual(['PEPE', 'XYZ']);
  });

  it('writes no list for a window of tracked orders', async () => {
    const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([order()])) });

    await sync(deps);

    expect(coinListPatchesOf(deps)).toEqual([]);
  });

  it('moves the cursor past a window that holds only untracked orders', async () => {
    const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([], [untrackedOrder()])) });

    const result = await sync(deps);

    expect(walkMarkWritesOf(deps, 'pay', 'cursor')).toEqual([NOW]);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(untrackedPatchesOf(deps)).toHaveLength(1);
    expect(result).toEqual({ imported: 0, complete: true });
  });

  it('lists an untracked order that has no usable time: it has no point to return', async () => {
    const deps = makeDeps({
      fetchPayHistory: pageAtNow(payPage([], [untrackedOrder({ transactionTime: undefined })])),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(untrackedPatchesOf(deps)[0].tickers).toEqual(['PEPE']);
  });

  it('counts an untracked order toward a full page, so a page of them is read in halves', async () => {
    const full = Array.from({ length: 100 }, () => untrackedOrder());
    const deps = makeDeps({
      fetchPayHistory: jest.fn(
        async (_apiKey: string, _secret: string, query: { startTime: number; endTime: number }) =>
          query.endTime - query.startTime > 1_000_000 ? payPage([], full) : payPage([]),
      ),
    });

    await sync(deps);

    const spans = (deps.fetchPayHistory as jest.Mock).mock.calls.map(
      ([, , query]) => query as { startTime: number; endTime: number },
    );
    const [first] = spans;
    expect(
      spans.some(
        (span) =>
          span.startTime >= first.startTime &&
          span.endTime <= first.endTime &&
          span.endTime - span.startTime <= (first.endTime - first.startTime) / 2 + 1,
      ),
    ).toBe(true);
  });

  it('lists nothing of a window that stops: nothing of it commits', async () => {
    const unbalanced = order({
      currency: 'USDT',
      amount: '-5',
      fundsDetail: [
        { currency: 'USDT', amount: '5', walletAssetCost: [{ walletType: 2, amount: '4' }] },
      ],
    });
    const deps = makeDeps({
      fetchPayHistory: pageAtNow(payPage([unbalanced], [untrackedOrder()])),
    });

    const result = await sync(deps);

    expect(result.complete).toBe(false);
    expect(coinListPatchesOf(deps)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(STOP_TAG, {
      name: 'BinanceWalkStop',
      code: 'pay-split-mismatch',
    });
  });
});

describe('a Pay order of an untracked coin paid in a tracked coin', () => {
  it('imports a send in XYZ paid in USDT as a USDT row, and lists XYZ', async () => {
    const store = creatingStore();
    const deps = makeDeps({ ...store, fetchPayHistory: pageAtNow(payPage([xyzSend()])) });

    const result = await sync(deps);

    expect(store.ensureHoldings).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'Binance Funding · USDT',
        metadataKey: 'USDT:funding',
        balanceMinorUnits: 0,
      }),
    ]);
    expect(addedRows(deps)).toEqual([
      expect.objectContaining({
        holdingId: 'h-USDT:funding',
        amountMinorUnits: -1_250_000_000,
        externalId: 'acc-1:pay:C2C:tx-1:1:USDT',
        comment: '12.5 XYZ',
      }),
    ]);
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
    ]);
    expect(result).toEqual({ imported: 1, complete: true });
  });

  it('imports no row for a receive in an untracked coin, and lists its ticker', async () => {
    const received = xyzSend({
      amount: '12.5',
      payerInfo: party('Bob', OTHER),
      receiverInfo: party('Me', OWN),
    });
    const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([received])) });

    const result = await sync(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
    ]);
    expect(walkMarkWritesOf(deps, 'pay', 'cursor')).toEqual([NOW]);
    expect(result).toEqual({ imported: 0, complete: true });
  });

  it('lists the untracked coin a tracked order was paid in, beside its tracked rows', async () => {
    const paidInTwo = order({
      walletType: 2,
      walletTypes: [2],
      fundsDetail: [
        {
          currency: 'BTC',
          amount: '0.0004',
          walletAssetCost: [{ walletType: 2, amount: '0.0004' }],
        },
        { currency: 'XYZ', amount: '5', walletAssetCost: [{ walletType: 2, amount: '5' }] },
      ],
    });
    const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([paidInTwo])) });

    await sync(deps);

    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:pay:C2C:tx-1:2']);
    expect(untrackedPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
    ]);
  });

  describe('by the direction of the order', () => {
    const receivedFromXyzPayer = {
      amount: '12.5',
      payerInfo: party('Bob', OTHER),
      receiverInfo: party('Me', OWN),
      fundsDetail: [{ currency: 'XYZ', amount: '3', walletAssetCost: [] }],
    };

    it('lists no coin of the funds of a USDT receive the payer paid in XYZ', async () => {
      const deps = makeDeps({
        fetchPayHistory: pageAtNow(
          payPage([order({ currency: 'USDT', walletType: undefined, ...receivedFromXyzPayer })]),
        ),
      });

      const result = await sync(deps);

      expect(addedRows(deps)).toEqual([
        expect.objectContaining({ holdingId: 'h-USDT', amountMinorUnits: 1_250_000_000 }),
      ]);
      expect(untrackedPatchesOf(deps)).toEqual([]);
      expect(result).toEqual({ imported: 1, complete: true });
    });

    it('still lists the own untracked coin of a receive, and not the coin of its funds', async () => {
      const received = xyzSend({
        ...receivedFromXyzPayer,
        fundsDetail: [
          { currency: 'USDT', amount: '1', walletAssetCost: [] },
          ...receivedFromXyzPayer.fundsDetail,
          { currency: 'ABC', amount: '2', walletAssetCost: [] },
        ],
      });
      const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([received])) });

      await sync(deps);

      expect(untrackedPatchesOf(deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
      ]);
    });

    it('lists the coin of the funds of a USDT send paid in XYZ', async () => {
      const sent = order({
        currency: 'USDT',
        amount: '-12.5',
        fundsDetail: receivedFromXyzPayer.fundsDetail,
      });
      const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([sent])) });

      await sync(deps);

      expect(untrackedPatchesOf(deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
      ]);
    });

    it('lists no coin of the funds of an order with no direction, which is owed', async () => {
      const owedDay = { start: NOW - 300 * DAY_MS, end: NOW - 299 * DAY_MS };
      const undirected = order({
        currency: 'USDT',
        amount: '-12.5',
        transactionTime: owedDay.start + 3_600_000,
        fundsDetail: receivedFromXyzPayer.fundsDetail,
        payerInfo: party('Bob', OTHER),
        receiverInfo: party('Ann', OTHER),
      });
      const deps = makeDeps({
        fetchPayHistory: jest.fn(async (_apiKey: string, _secret: string, query) =>
          query.endTime === owedDay.end ? payPage([undirected]) : payPage([]),
        ),
        ...walkStateFake({
          accountId: ACCOUNT_ID,
          marks: { pay: { cursor: NOW, pending: [owedDay] } },
        }).deps,
      });

      await sync(deps);

      expect(addedRows(deps)).toEqual([]);
      expect(untrackedPatchesOf(deps)).toEqual([]);
      expect(warn).toHaveBeenCalledWith(STOP_TAG, {
        name: 'BinanceWalkStop',
        code: 'pay-direction-ambiguous',
      });
    });

    it('lists only the own coin of an untracked order whose amount says receive', async () => {
      const deps = makeDeps({
        fetchPayHistory: pageAtNow(
          payPage([], [untrackedOrder({ tickers: ['XYZ', 'ABC'], received: true })]),
        ),
      });

      await sync(deps);

      expect(untrackedPatchesOf(deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
      ]);
    });

    it('lists the own coin and the funds coins of an untracked order whose amount says send', async () => {
      const deps = makeDeps({
        fetchPayHistory: pageAtNow(
          payPage([], [untrackedOrder({ tickers: ['XYZ', 'ABC'], received: false })]),
        ),
      });

      await sync(deps);

      expect(untrackedPatchesOf(deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ', 'ABC'] },
      ]);
    });
  });

  it('keeps a Pay-only untracked coin on the not-tracked line after the next balance read', async () => {
    const fake = walkStateFake({ accountId: ACCOUNT_ID, marks: { pay: { cursor: CURSOR } } });
    const balanceRead = (tickers: string[]) =>
      fake.deps.patchExchangeState(ACCOUNT_ID, [
        { kind: 'coinList', coins: 'untrackedCoins', list: 'balance', tickers },
      ]);
    const lineOf = async () =>
      untrackedCoinsOf(
        parseExchangeState((await fake.deps.readExchangeState(ACCOUNT_ID)) ?? ''),
        isTrackedBinanceAsset,
      );
    const payOver = (page: PayHistoryPage) =>
      makeDeps({ ...fake.deps, fetchPayHistory: pageAtNow(page) });

    await balanceRead(['PEPE']);
    expect(await lineOf()).toEqual(['PEPE']);

    await sync(payOver(payPage([], [untrackedOrder({ tickers: ['XYZ'] })])));
    expect(await lineOf()).toEqual(['PEPE', 'XYZ']);

    await balanceRead(['PEPE']);
    await sync(payOver(payPage([])));
    expect(await lineOf()).toEqual(['PEPE', 'XYZ']);
  });
});

describe('a Pay order of a tracked coin that is too large', () => {
  it('stops at it, owes its point and lists the coin as too large', async () => {
    const huge = order({
      currency: 'USDT',
      amount: '-90071992.54740992',
      fundsDetail: [],
    });
    const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([huge])) });

    const result = await sync(deps);

    expect(result.complete).toBe(false);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(coinListPatchesOf(deps)).toContainEqual({
      kind: 'coinList',
      coins: 'oversizedCoins',
      list: 'history',
      tickers: ['USDT'],
    });
    expect(warn).toHaveBeenCalledWith(STOP_TAG, {
      name: 'BinanceWalkStop',
      code: 'amount-too-large',
    });
  });
});

describe('a Pay order of a tracked coin whose amount rounds to nothing', () => {
  const dust = order({
    currency: 'XRP',
    amount: '-0.00004',
    walletType: 2,
    walletTypes: [2],
    fundsDetail: [
      {
        currency: 'XRP',
        amount: '0.00004',
        walletAssetCost: [{ walletType: 2, amount: '0.00004' }],
      },
    ],
  });

  it('imports no row, lists nothing, and moves the cursor past it without a stop', async () => {
    const deps = makeDeps({ fetchPayHistory: pageAtNow(payPage([dust, order()])) });

    const result = await sync(deps);

    expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:pay:C2C:tx-1:2']);
    expect(coinListPatchesOf(deps)).toEqual([]);
    expect(walkMarkWritesOf(deps, 'pay', 'cursor')).toEqual([NOW]);
    expect(warn).not.toHaveBeenCalledWith(STOP_TAG, expect.anything());
    expect(result).toEqual({ imported: 1, complete: true });
  });
});

describe('a page read by the real client beside an off-contract order of an untracked coin', () => {
  const bodyFetch = (body: unknown) =>
    (async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body,
    })) as unknown as typeof fetch;

  const btcOrderBody = {
    orderType: 'C2C',
    transactionId: 'tx-1',
    transactionTime: PAID_AT,
    amount: '-0.001',
    currency: 'BTC',
    walletType: 2,
    walletTypes: [2],
    fundsDetail: [{ currency: 'BTC', amount: '0.001', walletAssetCost: { '2': '0.001' } }],
    payerInfo: { name: 'Me', binanceId: OWN },
    receiverInfo: { name: 'Ann', binanceId: OTHER },
  };

  /** The same JSON body for the span that ends at now, nothing for any other span. */
  const servedAtNow = (data: unknown[]) =>
    jest.fn(async (apiKey: string, secret: string, query: { startTime: number; endTime: number }) =>
      fetchPayHistory(apiKey, secret, query, {
        fetchImpl: bodyFetch({ code: '000000', data: query.endTime === NOW ? data : [] }),
        now: () => NOW,
      }),
    );

  it.each([
    [
      'an amount that is a JSON number',
      { currency: 'PEPE', amount: 1000, transactionTime: PAID_AT },
    ],
    ['nothing but its currency', { currency: 'PEPE' }],
    ['funds that are not a list', { currency: 'PEPE', amount: '1', fundsDetail: 'x' }],
    ['a payer that is not an object', { currency: 'pepe', amount: '-1', payerInfo: 'Me' }],
  ])(
    'imports the BTC row, moves the cursor and lists PEPE past %s',
    async (_label, offContract) => {
      const deps = makeDeps({ fetchPayHistory: servedAtNow([offContract, btcOrderBody]) });

      const result = await sync(deps);

      expect(addedRows(deps).map((row) => row.externalId)).toEqual(['acc-1:pay:C2C:tx-1:2']);
      expect(result).toEqual({ imported: 1, complete: true });
      expect(walkMarkWritesOf(deps, 'pay', 'cursor')).toEqual([NOW]);
      expect(untrackedPatchesOf(deps).flatMap((patch) => patch.tickers)).toEqual(['PEPE']);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('stops at an order with a blank currency and owes its point, never listing it', async () => {
    const blank = { ...btcOrderBody, transactionId: 'tx-2', currency: '  ' };
    const deps = makeDeps({ fetchPayHistory: servedAtNow([blank, btcOrderBody]) });

    const result = await sync(deps);

    expect(result.complete).toBe(false);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(coinListPatchesOf(deps)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(STOP_TAG, {
      name: 'BinanceWalkStop',
      code: 'pay-row-unreadable',
    });
  });
});
