import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';

import {
  BINANCE_REQUEST_INTERVAL_MS,
  type BinanceTransactionRow,
  type BinanceTransactionSyncDeps,
  HISTORY_FLOOR_MS,
  parseWithdrawTime,
  syncBinanceTransactions,
  UID_WEIGHT_BUDGET_1M,
  WITHDRAW_CALLS_PER_RUN_FALLBACK,
  WITHDRAW_UID_WEIGHT,
} from './binance.transactions';
import {
  type BinanceDeposit,
  type BinanceWithdrawal,
  HISTORY_PAGE_LIMIT,
  type HistoryPage,
  type HistoryWindow,
} from './binance.history-client';
import { BinanceRateLimitError } from './binance.client';

const NOW = 1_704_326_400_000; // 2024-01-04T00:00:00Z
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
  insertTime: NOW - DAY_MS,
  status: 1,
  walletType: undefined,
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
  walletType: undefined,
  ...over,
});

/** A history page with no weight reading in the fixture, unless one is given. */
const historyPage = <Row>(rows: Row[], usedUidWeight1m?: number): HistoryPage<Row> => ({
  rows,
  usedUidWeight1m,
  usedIpWeight1m: undefined,
});

const depositPage = (rows: BinanceDeposit[]) => historyPage(rows);

const withdrawPage = (rows: BinanceWithdrawal[]) => historyPage(rows);

// A typed, empty deposit-history mock. The explicit params type `mock.calls[n][2]`
// as the HistoryWindow so the window-walk assertions read it without a cast.
const emptyDepositFetch = () =>
  jest.fn(async (_apiKey: string, _secret: string, _window: HistoryWindow) => depositPage([]));

const makeDeps = (over: Partial<BinanceTransactionSyncDeps> = {}): BinanceTransactionSyncDeps => ({
  now: () => NOW,
  sleep: async () => undefined,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [spotHolding],
  latestTransactionTime: async () => undefined,
  addTransactions: jest.fn(async (rows: BinanceTransactionRow[]) => rows.length),
  writeHistoryCursor: jest.fn(async () => undefined),
  fetchDepositHistory: jest.fn(async () => depositPage([])),
  fetchWithdrawHistory: jest.fn(async () => withdrawPage([])),
  ...over,
});

/**
 * A stateful Spot holding + `writeHistoryCursor` pair for a multi-run test:
 * each run's `listHoldings` reads whatever the LAST run's `writeHistoryCursor`
 * wrote, so a resumed run genuinely picks up from where the prior one left off.
 */
const makeStatefulSpotAccount = (): {
  listHoldings: () => Promise<HoldingRow[]>;
  writeHistoryCursor: jest.Mock<Promise<void>, [string, number]>;
  cursor: () => number | null;
} => {
  let cursor: number | null = null;

  return {
    listHoldings: async () => [
      {
        id: 'h-spot',
        metadata:
          cursor === null
            ? { binanceAsset: 'BTC' }
            : { binanceAsset: 'BTC', binanceHistoryCursor: cursor },
      } as unknown as HoldingRow,
    ],
    writeHistoryCursor: jest.fn(async (_holdingId: string, cursorMs: number) => {
      cursor = cursorMs;
    }),
    cursor: () => cursor,
  };
};

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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => depositPage([deposit()])),
      fetchWithdrawHistory: jest.fn(async () => withdrawPage([withdrawal()])),
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 2, complete: true });
    const rows = (deps.addTransactions as jest.Mock).mock.calls[0][0] as BinanceTransactionRow[];
    expect(rows).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: 50_000_000, // +0.5 BTC in satoshis
        time: NOW - DAY_MS,
        source: 'binance',
        // The synced external id is namespaced by the target account id
        // (`${accountId}:deposit:<id>`), so two Binance connections cannot collide
        // on the GLOBAL (source, external_id) index — Binance record ids are only
        // per-account unique.
        externalId: 'acc-1:deposit:1',
        // A stable, non-localized asset ticker so the row's normalized name is
        // non-blank and the category-apply sheet appears (parity with a Monobank
        // merchant row). See the item-12 fix.
        description: 'BTC',
      },
      {
        holdingId: 'h-spot',
        amountMinorUnits: -25_000_000, // -0.25 BTC, fee excluded
        time: Date.UTC(2024, 0, 3, 0, 0, 0),
        source: 'binance',
        externalId: 'acc-1:withdraw:9',
        description: 'BTC',
      },
    ]);
  });

  it('reads the credentials for the TARGET account id (per-account isolation)', async () => {
    const readCredentials = jest.fn(async () => ({ apiKey: 'api-key', secret: 'secret' }));
    const deps = makeDeps({ readCredentials });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(readCredentials).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it('paces the two endpoint requests in a window through a shared gate', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    // A recent cursor keeps the walk to ONE 89-day window: a deposit request then
    // a withdraw request, two requests total.
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 10 * DAY_MS, sleep });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    // The first request fires immediately; the second waits the pacing interval,
    // so the two are not fired back-to-back.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(BINANCE_REQUEST_INTERVAL_MS);
  });

  it('paces EVERY request across a wide first-sync window walk so it stays under the weight limit', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    // A first sync (no cursor) walks from the 2017 floor to now: many 89-day
    // windows, two requests each — the case that otherwise fires ~dozens of
    // requests back-to-back and hits a Binance weight-429.
    const deps = makeDeps({ latestTransactionTime: async () => undefined, sleep });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const requests =
      (deps.fetchDepositHistory as jest.Mock).mock.calls.length +
      (deps.fetchWithdrawHistory as jest.Mock).mock.calls.length;
    // A real wide walk (more than the single-window case above).
    expect(requests).toBeGreaterThan(2);
    // One gate wait before every request except the very first.
    expect(sleep).toHaveBeenCalledTimes(requests - 1);
    expect(sleep).toHaveBeenCalledWith(BINANCE_REQUEST_INTERVAL_MS);
  });

  it('excludes a non-settled deposit (status !== 1) and withdrawal (status !== 6)', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () =>
        depositPage([deposit({ id: '2', status: 0 }), deposit({ id: '3' })]),
      ),
      fetchWithdrawHistory: jest.fn(async () =>
        withdrawPage([withdrawal({ id: '8', status: 3 }), withdrawal({ id: '7' })]),
      ),
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const rows = (deps.addTransactions as jest.Mock).mock.calls[0][0] as BinanceTransactionRow[];
    expect(rows.map((row) => row.externalId)).toEqual(['acc-1:deposit:3', 'acc-1:withdraw:7']);
  });

  it('offset-pages within a window until a short page, collecting every row', async () => {
    const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) =>
      deposit({ id: `d${index}` }),
    );
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) =>
        depositPage(window.offset === 0 ? fullPage : [deposit({ id: 'last' })]),
    );
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: HISTORY_PAGE_LIMIT + 1, complete: true });
    expect(fetchDepositHistory).toHaveBeenCalledTimes(2);
    expect(fetchDepositHistory.mock.calls[0][2].offset).toBe(0);
    expect(fetchDepositHistory.mock.calls[1][2].offset).toBe(HISTORY_PAGE_LIMIT);
  });

  it('re-sync from a recent cursor scans exactly the last 89-day window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(fetchDepositHistory).toHaveBeenCalledTimes(1);
    const window = fetchDepositHistory.mock.calls[0][2];
    expect(window.startTime).toBe(NOW - 89 * DAY_MS);
    expect(window.endTime).toBe(NOW);
  });

  it('walks contiguous windows back to a cursor older than one window', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    // A cursor 200 days back: overlap widens the start to 201 days, spanning
    // three 89-day windows (89 + 89 + 23).
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 200 * DAY_MS,
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows).toHaveLength(3);
    expect(windows[0].startTime).toBe(NOW - 201 * DAY_MS);
    expect(windows[2].endTime).toBe(NOW);
  });

  it('first sync (no cursor) starts walking from the history floor', async () => {
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      latestTransactionTime: async () => undefined,
      fetchDepositHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
    // The withdraw-call budget stops a single run short of `now` — the
    // "resumable, budgeted walk" tests below cover the multi-run completion.
    expect(result.complete).toBe(false);
  });

  it('the watermark wins over a much older legacy latest — the headline "cursor beats latest" rule', async () => {
    // A holding whose watermark is nearly caught up (2 hours behind now), but
    // whose legacy `latestTransactionTime` (a pre-watermark imported row) is
    // stuck in 2019. `resolveStartTime` must be fed the WATERMARK, never the
    // stale `latest` — swapping `cursor ?? latest` for `latest ?? cursor`
    // would walk from 2019 instead and fail this test.
    const fetchDepositHistory = emptyDepositFetch();
    const cursor = NOW - 2 * 60 * 60 * 1000;
    const deps = makeDeps({
      listHoldings: async () =>
        [
          { id: 'h-spot', metadata: { binanceAsset: 'BTC', binanceHistoryCursor: cursor } },
        ] as unknown as HoldingRow[],
      latestTransactionTime: async () => Date.UTC(2019, 0, 1),
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows).toHaveLength(1);
    expect(windows[0].startTime).toBe(NOW - 89 * DAY_MS);
    expect(windows[0].endTime).toBe(NOW);
  });

  it('a same-account reconnect after a disconnect (watermark reset to the floor) walks from the floor, even with an old latest set', async () => {
    // Mirrors what a disconnect leaves behind (the watermark is
    // RESET to `HISTORY_FLOOR_MS`, not stripped) — a stale `latest` from
    // before the disconnect must not pull the walk forward past the floor.
    const fetchDepositHistory = emptyDepositFetch();
    const deps = makeDeps({
      listHoldings: async () =>
        [
          {
            id: 'h-spot',
            metadata: { binanceAsset: 'BTC', binanceHistoryCursor: HISTORY_FLOOR_MS },
          },
        ] as unknown as HoldingRow[],
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory,
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const windows = fetchDepositHistory.mock.calls.map((call) => call[2]);
    expect(windows[0].startTime).toBe(HISTORY_FLOOR_MS);
  });

  it('imports nothing but still advances the watermark when the window holds no settled records', async () => {
    const deps = makeDeps({ latestTransactionTime: async () => NOW - 10 * DAY_MS });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.writeHistoryCursor).toHaveBeenCalledWith('h-spot', NOW);
  });

  it('does nothing when the account has no Spot BTC holding', async () => {
    const deps = makeDeps({
      listHoldings: async () => [fundingHolding],
      fetchDepositHistory: jest.fn(async () => depositPage([deposit()])),
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('does nothing when no Binance credentials are stored', async () => {
    const deps = makeDeps({
      readCredentials: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([deposit()])),
    });

    const result = await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchDepositHistory).not.toHaveBeenCalled();
  });

  it('rejects when a history request fails so the caller can surface it', async () => {
    const deps = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
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
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => depositPage([deposit({ id: '42' })])),
    });

    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);
    await syncBinanceTransactions({ targetAccountId: ACCOUNT_ID }, deps);

    const firstRun = (deps.addTransactions as jest.Mock).mock
      .calls[0][0] as BinanceTransactionRow[];
    const secondRun = (deps.addTransactions as jest.Mock).mock
      .calls[1][0] as BinanceTransactionRow[];
    expect(firstRun[0].externalId).toBe('acc-1:deposit:42');
    expect(secondRun[0].externalId).toBe('acc-1:deposit:42');
  });

  // Binance deposit/withdrawal record ids are only
  // per-account unique, so two connections can each emit `deposit:<id>` with the
  // SAME raw id. Namespacing by the target account id keeps their external ids
  // distinct, so the global (source, external_id) upsert cannot refresh the wrong
  // connection's row.
  it('namespaces the external id per account so two connections cannot collide on one raw id', async () => {
    const depsA = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => depositPage([deposit({ id: '7' })])),
    });
    const depsB = makeDeps({
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => depositPage([deposit({ id: '7' })])),
    });

    await syncBinanceTransactions({ targetAccountId: 'acc-a' }, depsA);
    await syncBinanceTransactions({ targetAccountId: 'acc-b' }, depsB);

    const rowA = (depsA.addTransactions as jest.Mock).mock.calls[0][0] as BinanceTransactionRow[];
    const rowB = (depsB.addTransactions as jest.Mock).mock.calls[0][0] as BinanceTransactionRow[];
    expect(rowA[0].externalId).toBe('acc-a:deposit:7');
    expect(rowB[0].externalId).toBe('acc-b:deposit:7');
    expect(rowA[0].externalId).not.toBe(rowB[0].externalId);
  });
});

// Each `it` below uses its OWN account id — `cooldownUntilByAccount` is
// module-level, so a shared id would leak a cooldown from one case into the
// next. There is no exported reset (no test code in `src/`).
describe('resumable, budgeted walk', () => {
  it('a first sync completes over several runs, each staying within the withdraw-call budget', async () => {
    let clock = NOW;
    const account = makeStatefulSpotAccount();
    // A per-UTC-minute call counter mirrors Binance's real weight ceiling: more
    // than 10 withdraw calls in one minute 429s. The fallback budget (9 per
    // run) must keep every run safely under this.
    let callsThisMinute = 0;
    let minuteBucket = -1;
    const fetchWithdrawHistory = jest.fn(async () => {
      const bucket = Math.floor(clock / 60_000);

      if (bucket !== minuteBucket) {
        minuteBucket = bucket;
        callsThisMinute = 0;
      }

      callsThisMinute += 1;

      if (callsThisMinute > 10) {
        throw new BinanceRateLimitError(429, 30_000);
      }

      return withdrawPage([withdrawal({ id: `w-${bucket}-${callsThisMinute}` })]);
    });
    const deps = makeDeps({
      now: () => clock,
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    let complete = false;
    let totalImported = 0;
    let runs = 0;
    let lastRunNow = clock;

    while (!complete && runs < 10) {
      lastRunNow = clock;
      const result = await syncBinanceTransactions({ targetAccountId: 'acc-first-sync' }, deps);
      complete = result.complete;
      totalImported += result.imported;
      runs += 1;
      clock += 61_000;
    }

    expect(complete).toBe(true);
    expect(runs).toBeGreaterThan(1);
    // Each run's own "now" moves forward with the clock; the finished walk
    // catches up to THAT run's own now, not the constant `NOW` the test started at.
    expect(account.cursor()).toBe(lastRunNow);
    expect(totalImported).toBeGreaterThan(0);
    // No call ever rejected — the fallback budget kept every run under the
    // fake's own 10-per-minute ceiling.
    expect(fetchWithdrawHistory.mock.results.every((call) => call.type !== 'throw')).toBe(true);
  });

  it('run 1 makes at most the fallback withdraw-call budget, one window per call', async () => {
    const account = makeStatefulSpotAccount();
    const fetchWithdrawHistory = jest.fn(async () => withdrawPage([withdrawal()]));
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: 'acc-budget' }, deps);

    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(WITHDRAW_CALLS_PER_RUN_FALLBACK);
    expect(result.complete).toBe(false);
  });

  it('a 429 stops the walk without rejecting, commits every EARLIER window, and cools down until Retry-After passes', async () => {
    const account = makeStatefulSpotAccount();
    let callCount = 0;
    const fetchWithdrawHistory = jest.fn(async () => {
      callCount += 1;

      if (callCount === 3) {
        throw new BinanceRateLimitError(429, 30_000);
      }

      return withdrawPage([]);
    });
    const depositWindows: HistoryWindow[] = [];
    const fetchDepositHistory = jest.fn(
      async (_key: string, _secret: string, window: HistoryWindow) => {
        depositWindows.push(window);

        return depositPage([]);
      },
    );
    let clock = NOW;
    const deps = makeDeps({
      now: () => clock,
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory,
      fetchWithdrawHistory,
    });

    const run1 = await syncBinanceTransactions({ targetAccountId: 'acc-429' }, deps);

    expect(run1).toEqual({ imported: 0, complete: false });
    // 2 windows committed (withdraw calls 1 and 2 succeeded); the 3rd's window is not.
    expect(account.writeHistoryCursor).toHaveBeenCalledTimes(2);

    const callsAfterRun1 = fetchWithdrawHistory.mock.calls.length;
    const firstWindowStart = depositWindows[0].startTime;

    clock += 10_000;
    const run2 = await syncBinanceTransactions({ targetAccountId: 'acc-429' }, deps);

    expect(run2).toEqual({ imported: 0, complete: false });
    expect(fetchWithdrawHistory.mock.calls.length).toBe(callsAfterRun1);

    clock += 21_000; // 31s total since the 429 — Retry-After has passed
    await syncBinanceTransactions({ targetAccountId: 'acc-429' }, deps);

    expect(fetchWithdrawHistory.mock.calls.length).toBeGreaterThan(callsAfterRun1);
    // Resumes from the cursor, not a re-walk from the floor.
    const resumedWindowStart = depositWindows[depositWindows.length - 1].startTime;
    expect(resumedWindowStart).toBeGreaterThan(firstWindowStart);
  });

  it('a 429 with no Retry-After header falls back to the default cooldown', async () => {
    const account = makeStatefulSpotAccount();
    let clock = NOW;
    const fetchWithdrawHistory = jest.fn(async () => {
      throw new BinanceRateLimitError(429, 60_000);
    });
    const deps = makeDeps({
      now: () => clock,
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    await syncBinanceTransactions({ targetAccountId: 'acc-default-cooldown' }, deps);

    clock += 59_000;
    const stillCoolingDown = await syncBinanceTransactions(
      { targetAccountId: 'acc-default-cooldown' },
      deps,
    );

    expect(stillCoolingDown).toEqual({ imported: 0, complete: false });
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(1);
  });

  it('a 418 IP ban is treated the same as a 429, with its own Retry-After', async () => {
    const account = makeStatefulSpotAccount();
    let clock = NOW;
    const fetchWithdrawHistory = jest.fn(async () => {
      throw new BinanceRateLimitError(418, 45_000);
    });
    const deps = makeDeps({
      now: () => clock,
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    const run1 = await syncBinanceTransactions({ targetAccountId: 'acc-418' }, deps);

    expect(run1).toEqual({ imported: 0, complete: false });

    clock += 44_000;
    const stillBanned = await syncBinanceTransactions({ targetAccountId: 'acc-418' }, deps);

    expect(stillBanned).toEqual({ imported: 0, complete: false });
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(1);
  });

  it('the used-UID-weight header stops the run after the window it was reported on', async () => {
    const account = makeStatefulSpotAccount();
    // Leaves no room for another withdraw call (one more would exceed the
    // per-minute ceiling).
    const reportedWeight = UID_WEIGHT_BUDGET_1M - WITHDRAW_UID_WEIGHT + 1;
    const fetchWithdrawHistory = jest.fn(async () =>
      historyPage<BinanceWithdrawal>([], reportedWeight),
    );
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: 'acc-weight' }, deps);

    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(1);
    expect(result.complete).toBe(false);
    expect(account.writeHistoryCursor).toHaveBeenCalledTimes(1);
  });

  it('a window needing a 2nd withdraw page when only 1 call is left is not committed and not marked', async () => {
    const account = makeStatefulSpotAccount();
    const fullPage = Array.from({ length: HISTORY_PAGE_LIMIT }, (_unused, index) =>
      withdrawal({ id: `w${index}` }),
    );
    let callCount = 0;
    const fetchWithdrawHistory = jest.fn(async () => {
      callCount += 1;

      // The LAST call the budget can afford starts a window whose first page
      // is FULL — it needs a 2nd page, a call the budget does not allow.
      if (callCount === WITHDRAW_CALLS_PER_RUN_FALLBACK) {
        return withdrawPage(fullPage);
      }

      return withdrawPage([]);
    });
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: 'acc-partial-window' }, deps);

    expect(result.complete).toBe(false);
    expect(fetchWithdrawHistory).toHaveBeenCalledTimes(WITHDRAW_CALLS_PER_RUN_FALLBACK);
    // The 8 EARLIER windows committed; the 9th (the unfinished one) did not.
    expect(account.writeHistoryCursor).toHaveBeenCalledTimes(WITHDRAW_CALLS_PER_RUN_FALLBACK - 1);
  });

  it('crash order: rows commit before the watermark advances, for the same window', async () => {
    const account = makeStatefulSpotAccount();
    const invocationCallOrder: string[] = [];
    const addTransactions = jest.fn(async (rows: BinanceTransactionRow[]) => {
      invocationCallOrder.push('addTransactions');

      return rows.length;
    });
    const writeHistoryCursor = jest.fn(async (holdingId: string, cursorMs: number) => {
      invocationCallOrder.push('writeHistoryCursor');
      await account.writeHistoryCursor(holdingId, cursorMs);
    });
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeHistoryCursor,
      addTransactions,
      latestTransactionTime: async () => NOW - 10 * DAY_MS,
      fetchDepositHistory: jest.fn(async () => depositPage([deposit()])),
      fetchWithdrawHistory: jest.fn(async () => withdrawPage([])),
    });

    await syncBinanceTransactions({ targetAccountId: 'acc-crash-order' }, deps);

    expect(invocationCallOrder).toEqual(['addTransactions', 'writeHistoryCursor']);
  });

  it('regression: rows from an earlier, committed window ARE written despite a later 429 (inverse of the all-or-nothing bug)', async () => {
    const account = makeStatefulSpotAccount();
    let callCount = 0;
    const fetchWithdrawHistory = jest.fn(async () => {
      callCount += 1;

      if (callCount === 2) {
        throw new BinanceRateLimitError(429, 30_000);
      }

      return withdrawPage([withdrawal({ id: `w${callCount}` })]);
    });
    const addTransactions = jest.fn(async (rows: BinanceTransactionRow[]) => rows.length);
    const deps = makeDeps({
      listHoldings: account.listHoldings,
      writeHistoryCursor: account.writeHistoryCursor,
      addTransactions,
      latestTransactionTime: async () => undefined,
      fetchDepositHistory: jest.fn(async () => depositPage([])),
      fetchWithdrawHistory,
    });

    const result = await syncBinanceTransactions({ targetAccountId: 'acc-regression' }, deps);

    expect(result.complete).toBe(false);
    // The 1st window's row WAS written before the 2nd window's 429 — the
    // opposite of the all-or-nothing bug this walk replaces.
    expect(addTransactions).toHaveBeenCalledTimes(1);
    expect(addTransactions.mock.calls[0][0]).toHaveLength(1);
  });
});
