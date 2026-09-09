import type { HoldingRow } from '../../db/schema';

import type { BinanceDeposit, BinanceWithdrawal, HistoryWindow } from './binance.client';
import { HISTORY_PAGE_LIMIT } from './binance.client';
import {
  type BinanceTransactionRow,
  type BinanceTxSyncDeps,
  HISTORY_FLOOR_MS,
  parseWithdrawTime,
  syncBinanceTransactions,
} from './binance.transactions';

const NOW = 1_704_326_400_000; // 2024-01-04T00:00:00Z
const DAY = 86_400_000;
const ACCOUNT_ID = 'acc-1';

// The code reads only `id` and `metadata.binanceAsset` off a holding, so a
// minimal shape cast to HoldingRow is enough for these unit tests.
const spotHolding = { id: 'h-spot', metadata: { binanceAsset: 'BTC' } } as unknown as HoldingRow;
const fundingHolding = {
  id: 'h-funding',
  metadata: { binanceAsset: 'BTC:funding' },
} as unknown as HoldingRow;

const deposit = (over: Partial<BinanceDeposit> = {}): BinanceDeposit => ({
  id: '1',
  amount: '0.5',
  coin: 'BTC',
  txId: 'dep-tx',
  insertTime: NOW - DAY,
  status: 1,
  ...over,
});

const withdrawal = (over: Partial<BinanceWithdrawal> = {}): BinanceWithdrawal => ({
  id: '9',
  amount: '0.25',
  transactionFee: '0.0001',
  coin: 'BTC',
  txId: 'wd-tx',
  applyTime: '2024-01-03 00:00:00',
  status: 6,
  ...over,
});

// A typed, empty deposit-history mock. The explicit params type `mock.calls[n][2]`
// as the HistoryWindow so the window-walk assertions read it without a cast.
const emptyDepositFetch = () =>
  jest.fn(async (_apiKey: string, _secret: string, _window: HistoryWindow) => []);

const makeDeps = (over: Partial<BinanceTxSyncDeps> = {}): BinanceTxSyncDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [spotHolding],
  latestTransactionTime: async () => undefined,
  addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => rows.length),
  fetchDepositHistory: jest.fn(async () => []),
  fetchWithdrawHistory: jest.fn(async () => []),
  ...over,
});

describe('parseWithdrawTime', () => {
  it('reads a Binance applyTime string as UTC, not the device local zone', () => {
    // A naive Date.parse('2019-10-12 11:12:02') reads it in the LOCAL zone,
    // shifting the withdrawal by the local offset. It must be pinned to UTC.
    expect(parseWithdrawTime('2019-10-12 11:12:02')).toBe(Date.UTC(2019, 9, 12, 11, 12, 2));
  });

  it('passes an epoch-ms number through unchanged', () => {
    expect(parseWithdrawTime(NOW)).toBe(NOW);
  });
});

describe('syncBinanceTransactions', () => {
  it('maps a settled deposit and withdrawal onto the Spot holding, signed, and imports them', async () => {
    // A recent cursor keeps the walk to a single 89-day window.
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY,
      fetchDepositHistory: jest.fn(async () => [deposit()]),
      fetchWithdrawHistory: jest.fn(async () => [withdrawal()]),
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 2 });
    const rows = (deps.addTransactions as jest.Mock).mock.calls[0][0] as BinanceTransactionRow[];
    expect(rows).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: 50_000_000, // +0.5 BTC in satoshis
        time: NOW - DAY,
        source: 'binance',
        externalId: 'deposit:1',
        description: '',
      },
      {
        holdingId: 'h-spot',
        amountMinorUnits: -25_000_000, // -0.25 BTC, fee excluded
        time: Date.UTC(2024, 0, 3, 0, 0, 0),
        source: 'binance',
        externalId: 'withdraw:9',
        description: '',
      },
    ]);
  });

  it('excludes a non-settled deposit (status !== 1) and withdrawal (status !== 6)', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY,
      fetchDepositHistory: jest.fn(async () => [
        deposit({ id: '2', status: 0 }),
        deposit({ id: '3' }),
      ]),
      fetchWithdrawHistory: jest.fn(async () => [
        withdrawal({ id: '8', status: 3 }),
        withdrawal({ id: '7' }),
      ]),
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const rows = (deps.addTransactions as jest.Mock).mock.calls[0][0] as BinanceTransactionRow[];
    expect(rows.map((row) => row.externalId)).toEqual(['deposit:3', 'withdraw:7']);
  });

  it('offset-pages within a window until a short page, collecting every row', async () => {
    const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) =>
      deposit({ id: `d${index}` }),
    );
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) =>
        window.offset === 0 ? fullPage : [deposit({ id: 'last' })],
    );
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY,
      fetchDepositHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: HISTORY_PAGE_LIMIT + 1 });
    expect(fetchDepositHistory).toHaveBeenCalledTimes(2);
    expect(fetchDepositHistory.mock.calls[0][2].offset).toBe(0);
    expect(fetchDepositHistory.mock.calls[1][2].offset).toBe(HISTORY_PAGE_LIMIT);
  });

  it('re-sync from a recent cursor scans exactly the last 89-day window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY,
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(fetchDepositHistory).toHaveBeenCalledTimes(1);
    const window = fetchDepositHistory.mock.calls[0][2];
    expect(window.startTime).toBe(NOW - 89 * DAY);
    expect(window.endTime).toBe(NOW);
  });

  it('walks contiguous windows back to a cursor older than one window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    // A cursor 200 days back: overlap widens the start to 201 days, spanning
    // three 89-day windows (89 + 89 + 23).
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 200 * DAY,
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows).toHaveLength(3);
    expect(windows[0].startTime).toBe(NOW - 201 * DAY);
    expect(windows[2].endTime).toBe(NOW);
  });

  it('first sync (no cursor) walks from the history floor to now', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => undefined,
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
    expect(windows[windows.length - 1].endTime).toBe(NOW);
  });

  it('imports nothing and does not write when the window holds no settled records', async () => {
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 10 * DAY });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 0 });
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('does nothing when the account has no Spot BTC holding', async () => {
    const deps = makeDeps({
      listHoldings: async () => [fundingHolding],
      fetchDepositHistory: jest.fn(async () => [deposit()]),
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 0 });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('does nothing when no Binance credentials are stored', async () => {
    const deps = makeDeps({
      readCredentials: async () => undefined,
      fetchDepositHistory: jest.fn(async () => [deposit()]),
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 0 });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
  });

  it('rejects when a history request fails so the caller can surface it', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY,
      fetchDepositHistory: jest.fn(async () => {
        throw new Error('Too much request weight used');
      }),
    });

    await expect(syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps)).rejects.toThrow(
      'Too much request weight used',
    );
  });

  it('keys the same record identically across runs so a re-sync dedupes', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY,
      fetchDepositHistory: jest.fn(async () => [deposit({ id: '42' })]),
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);
    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const firstRun = (deps.addTransactions as jest.Mock).mock
      .calls[0][0] as BinanceTransactionRow[];
    const secondRun = (deps.addTransactions as jest.Mock).mock
      .calls[1][0] as BinanceTransactionRow[];
    expect(firstRun[0].externalId).toBe('deposit:42');
    expect(secondRun[0].externalId).toBe('deposit:42');
  });
});
